#!/usr/bin/env python3
"""
Constructor del Dataset Maestro de Desarrollo de Talento.

Combina:
  1. CSV de fichajes Segunda División (Transfermarkt)
  2. CSV de revalorizaciones
  3. CSV de entrenadores por club/temporada
  4. Exportaciones Wyscout (opcionales, en data/wyscout/)
  5. jugador_ids.csv (IDs de Transfermarkt)

Output:
  data/final/master_player_development.csv

Uso:
  python3 build_master.py                  # build completo
  python3 build_master.py --no-wyscout     # solo datos TM + coaches
  python3 build_master.py --validate       # muestra resumen sin guardar
"""
import argparse
import csv
import logging
import sys
from pathlib import Path
from collections import defaultdict

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from src.normalizer import normalize_club, normalize_player_name, player_key
from src.wyscout_importer import import_all_wyscout

ROOT        = Path(__file__).parent
DATA_FINAL  = ROOT / "data" / "final"
DATA_COACHES= ROOT / "data" / "coaches"
DATA_WYSCOUT= ROOT / "data" / "wyscout"
OUTPUT_PATH = DATA_FINAL / "master_player_development.csv"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("master")

# ── Columnas del dataset maestro ──────────────────────────────────────────────
MASTER_COLS = [
    # Identificación
    "player_id",            # spieler_id de Transfermarkt (si está disponible)
    "nombre",
    "nacionalidad",
    "fecha_nacimiento",     # disponible si se importa de Wyscout
    # Temporada y club
    "temporada",
    "club",
    "entrenador",           # de coaches CSV o Wyscout
    # Perfil
    "edad",
    "posicion",             # inglés (TM canonical)
    "posicion_es",          # español
    "posicion_normalizada", # Wyscout normalizada (Delantero, Extremo, etc.)
    # Participación (Wyscout)
    "partidos",
    "titularidades",
    "minutos",
    # Producción (Wyscout)
    "goles",
    "asistencias",
    "xg",
    "amarillas",
    "rojas",
    # Físico (Wyscout)
    "altura",
    "peso",
    "pie",
    # Métricas derivadas
    "minutos_por_partido",
    "goles_por_90",
    "xg_por_90",
    "es_sub23",
    # Mercado (Transfermarkt)
    "valor_mercado",        # VM en el momento del fichaje
    "valor_mercado_wyscout",# VM según Wyscout (más actual/preciso)
    "valor_llegada",        # VM al llegar al club
    "valor_salida",         # VM al salir del club
    "revalorizacion_absoluta",
    "revalorizacion_porcentual",
    # Operación
    "tipo_operacion",       # cesion, traspaso, libre, retorno_cesion, otro
    "movimiento",           # alta / baja
    "cesion",               # bool (Wyscout)
    "origen_desarrollo",    # Cantera/Filial, Segunda, Primera División, Extranjero
    # Metadata
    "fuente",               # tm, wyscout, manual
    "tiene_wyscout",        # bool — si la fila tiene datos de rendimiento
]


def _parse_vm(text: str) -> float | None:
    """€2.5M, €750k → float en euros."""
    if not text or text in ("-", "?", ""):
        return None
    t = str(text).replace("€", "").replace(",", ".").strip()
    if t.endswith("m") or t.endswith("M"):
        try:
            return float(t[:-1]) * 1_000_000
        except ValueError:
            pass
    if t.lower().endswith("k") or t.lower().endswith("th."):
        try:
            return float(t[:-1].rstrip("tTkKhH.")) * 1_000
        except ValueError:
            pass
    try:
        return float(t)
    except ValueError:
        return None


def _norm_tipo(raw: str) -> str:
    """Normaliza tipo de operación a vocabulario canónico."""
    r = (raw or "").lower().strip()
    if "libre" in r or "free" in r:
        return "libre"
    if "retorno" in r or "end of loan" in r:
        return "retorno_cesion"
    if "cesión" in r or "cesion" in r or "loan" in r:
        return "cesion"
    if "traspaso" in r or "transfer" in r:
        return "traspaso"
    return "otro"


# ── Cargadores ────────────────────────────────────────────────────────────────

def load_fichajes() -> pd.DataFrame:
    path = DATA_FINAL / "segunda_division_fichajes_2021_2026.csv"
    df   = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)
    df["nombre"]       = df["jugador"].apply(normalize_player_name)
    df["club"]         = df["club"].apply(normalize_club)
    df["valor_mercado"]= df["valor_mercado"].apply(_parse_vm)
    df["tipo_operacion"] = df["tipo_operacion"].apply(_norm_tipo)
    df["fuente"]       = "tm"
    logger.info(f"Fichajes: {len(df)} registros")
    return df


def load_revalorizacion() -> pd.DataFrame:
    path = DATA_FINAL / "revalorizacion.csv"
    df   = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)
    df["nombre"] = df["jugador"].apply(normalize_player_name)
    df["club"]   = df["club"].apply(normalize_club)
    logger.info(f"Revalorización: {len(df)} registros")
    return df


def load_player_ids() -> dict[str, str]:
    """Devuelve dict {nombre_key → spieler_id}."""
    path = DATA_FINAL / "jugador_ids.csv"
    if not path.exists():
        return {}
    mapping = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            mapping[player_key(row["jugador"])] = row["spieler_id"]
    return mapping


def load_coaches() -> dict[tuple, str]:
    """Devuelve dict {(club_norm, temporada) → entrenador}."""
    mapping = {}
    for csv_file in DATA_COACHES.glob("*.csv"):
        with open(csv_file, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                club = normalize_club(row.get("club", ""))
                temp = (row.get("temporada") or "").strip()
                coach= (row.get("entrenador") or "").strip()
                if club and temp and coach:
                    mapping[(club, temp)] = coach
    logger.info(f"Entrenadores: {len(mapping)} registros (club × temporada)")
    return mapping


# ── Builder principal ─────────────────────────────────────────────────────────

def build_master(include_wyscout: bool = True) -> pd.DataFrame:
    logger.info("═" * 55)
    logger.info("  Dataset Maestro — Desarrollo de Talento")
    logger.info("═" * 55)

    fichajes  = load_fichajes()
    rev       = load_revalorizacion()
    player_ids= load_player_ids()
    coaches   = load_coaches()

    # ── Construir base desde altas (fichajes de entrada al club) ──────────────
    altas = fichajes[fichajes["movimiento"] == "alta"].copy()

    # Crear clave de join (nombre_key, club, temporada)
    altas["_key"] = altas["nombre"].apply(player_key)

    # ── Join con revalorizacion ───────────────────────────────────────────────
    rev["_key"]  = rev["nombre"].apply(player_key)
    rev_indexed  = rev.set_index(["_key", "club", "temporada_llegada"])

    records = []
    for _, row in altas.iterrows():
        rec = {col: None for col in MASTER_COLS}

        # Básico desde fichajes
        rec["nombre"]       = row["nombre"]
        rec["nacionalidad"] = row.get("nacionalidad")
        rec["temporada"]    = row.get("temporada")
        rec["club"]         = row["club"]
        rec["edad"]         = row.get("edad")
        rec["posicion"]     = row.get("posicion")
        rec["valor_mercado"]= row.get("valor_mercado")
        rec["tipo_operacion"] = row.get("tipo_operacion")
        rec["movimiento"]   = "alta"
        rec["origen_desarrollo"] = row.get("origen_desarrollo")
        rec["fuente"]       = "tm"

        # Posición ES desde POS_ES en normalizer
        from src.normalizer import POS_ES
        rec["posicion_es"]  = POS_ES.get(row.get("posicion", ""), row.get("posicion", ""))

        # player_id desde TM
        rec["player_id"] = player_ids.get(row["_key"])

        # Entrenador desde coaches
        coach_key = (row["club"], row.get("temporada", ""))
        rec["entrenador"] = coaches.get(coach_key)

        # Join con revalorizacion
        try:
            rv = rev_indexed.loc[(row["_key"], row["club"], row.get("temporada"))]
            if isinstance(rv, pd.DataFrame):
                rv = rv.iloc[0]
            rec["valor_llegada"]             = rv["vm_llegada"] if "vm_llegada" in rv.index else None
            rec["valor_salida"]              = rv["vm_salida"]  if "vm_salida"  in rv.index else None
            rec["revalorizacion_absoluta"]   = rv["revalorizacion_abs"] if "revalorizacion_abs" in rv.index else None
            rec["revalorizacion_porcentual"] = rv["revalorizacion_pct"] if "revalorizacion_pct" in rv.index else None
        except KeyError:
            pass

        records.append(rec)

    master = pd.DataFrame(records, columns=MASTER_COLS)

    # ── Deduplicar antes del merge ────────────────────────────────────────────
    before = len(master)
    master.drop_duplicates(subset=["nombre", "club", "temporada", "movimiento"],
                           keep="first", inplace=True)
    master.reset_index(drop=True, inplace=True)
    if before > len(master):
        logger.info(f"Deduplicados TM: {before - len(master)} filas")

    # ── Merge con Wyscout (matching robusto) ──────────────────────────────────
    match_stats = {"exact": 0, "fuzzy_temp": 0, "total_master": len(master)}
    if include_wyscout:
        wy = load_wyscout(DATA_WYSCOUT)
        if not wy.empty:
            master = _merge_wyscout(master, wy, match_stats)
            logger.info(f"Wyscout cargado: {len(wy)} registros")
        else:
            logger.info("Sin datos Wyscout disponibles")

    # ── Métricas derivadas ────────────────────────────────────────────────────
    master = _compute_metrics(master)

    # ── Resumen ───────────────────────────────────────────────────────────────
    con_wy = int(master["tiene_wyscout"].sum())
    matched_pct = con_wy / len(master) * 100 if len(master) else 0
    logger.info(f"\n{'─'*55}")
    logger.info(f"  MASTER generado: {len(master):,} registros")
    logger.info(f"  Jugadores únicos:  {master['nombre'].nunique():,}")
    logger.info(f"  Clubes:            {master['club'].nunique()}")
    logger.info(f"  Entrenadores:      {master['entrenador'].nunique()}")
    logger.info(f"  Temporadas:        {master['temporada'].nunique()}")
    logger.info(f"  Sub-23:            {int(master['es_sub23'].sum())}")
    logger.info(f"  ── Matching Wyscout ──")
    logger.info(f"    Match exacto (jugador+club+temp): {match_stats['exact']}")
    logger.info(f"    Match por jugador+temporada:      {match_stats['fuzzy_temp']}")
    logger.info(f"    TOTAL con datos Wyscout:          {con_wy} ({matched_pct:.1f}%)")
    logger.info(f"{'─'*55}")

    return master


def load_wyscout(directory) -> pd.DataFrame:
    """Carga Wyscout usando el loader robusto (Excel + normalización)."""
    try:
        from src.wyscout_loader import load_all
        return load_all(directory)
    except Exception as e:
        logger.warning(f"No se pudo cargar Wyscout: {e}")
        return pd.DataFrame()


def _merge_wyscout(master: pd.DataFrame, wy: pd.DataFrame, stats: dict) -> pd.DataFrame:
    """
    Enriquece el master con datos Wyscout mediante matching en dos niveles:
      1. Exacto: (jugador_key, club_key, temporada)
      2. Fallback: (jugador_key, temporada) — para casos de club no normalizado
    """
    # Claves de Wyscout
    wy = wy.copy()
    wy["_kct"] = wy.apply(lambda r: f"{player_key(str(r['jugador']))}|{player_key(str(r['equipo']))}|{r['temporada']}", axis=1)
    wy["_kt"]  = wy.apply(lambda r: f"{player_key(str(r['jugador']))}|{r['temporada']}", axis=1)

    # Quedarse con el registro de más minutos por clave (evita duplicados att/med/def)
    wy = wy.sort_values("minutos_jugados", ascending=False, na_position="last")
    wy_kct = wy.drop_duplicates("_kct").set_index("_kct")
    wy_kt  = wy.drop_duplicates("_kt").set_index("_kt")

    wy_fields = ["edad", "posicion_normalizada", "partidos_jugados", "minutos_jugados",
                 "goles", "xg", "valor_mercado", "altura", "peso", "pie", "cesion",
                 "pais_nacimiento", "pasaporte"]

    def enrich(row):
        kct = f"{player_key(str(row['nombre']))}|{player_key(str(row['club']))}|{row['temporada']}"
        kt  = f"{player_key(str(row['nombre']))}|{row['temporada']}"
        src = None
        if kct in wy_kct.index:
            src = wy_kct.loc[kct]
            stats["exact"] += 1
        elif kt in wy_kt.index:
            src = wy_kt.loc[kt]
            stats["fuzzy_temp"] += 1
        if src is None:
            row["tiene_wyscout"] = False
            return row
        row["tiene_wyscout"]         = True
        row["partidos"]              = src.get("partidos_jugados")
        row["minutos"]               = src.get("minutos_jugados")
        row["goles"]                 = src.get("goles")
        row["xg"]                    = src.get("xg")
        row["altura"]                = src.get("altura")
        row["peso"]                  = src.get("peso")
        row["pie"]                   = src.get("pie")
        row["cesion"]                = src.get("cesion")
        row["valor_mercado_wyscout"] = src.get("valor_mercado")
        row["posicion_normalizada"]  = src.get("posicion_normalizada")
        # edad: priorizar Wyscout si master no la tiene
        if pd.isna(row.get("edad")) or not row.get("edad"):
            row["edad"] = src.get("edad")
        return row

    master = master.apply(enrich, axis=1)
    return master


def _compute_metrics(master: pd.DataFrame) -> pd.DataFrame:
    """Calcula minutos_por_partido, goles_por_90, xg_por_90, es_sub23."""
    def safe_div(a, b):
        try:
            a, b = float(a), float(b)
            return round(a / b, 2) if b > 0 else None
        except (TypeError, ValueError):
            return None

    master["minutos_por_partido"] = master.apply(
        lambda r: safe_div(r.get("minutos"), r.get("partidos")), axis=1)
    master["goles_por_90"] = master.apply(
        lambda r: safe_div((float(r["goles"]) * 90) if pd.notna(r.get("goles")) else None, r.get("minutos")), axis=1)
    master["xg_por_90"] = master.apply(
        lambda r: safe_div((float(r["xg"]) * 90) if pd.notna(r.get("xg")) else None, r.get("minutos")), axis=1)
    master["es_sub23"] = master["edad"].apply(
        lambda e: bool(pd.notna(e) and 0 < float(e) < 23) if pd.notna(e) else False)
    if "tiene_wyscout" not in master.columns:
        master["tiene_wyscout"] = False
    master["tiene_wyscout"] = master["tiene_wyscout"].fillna(False)

    # Rellenar posicion_normalizada desde la posición TM cuando falta Wyscout
    master["posicion_normalizada"] = master.apply(
        lambda r: r["posicion_normalizada"] if pd.notna(r.get("posicion_normalizada"))
        else _tm_pos_to_normalized(r.get("posicion")), axis=1)
    return master


# Mapeo de posición TM (inglés) → posición normalizada
_TM_TO_NORM = {
    "Goalkeeper": "Portero",
    "Centre-Back": "Central", "Left-Back": "Lateral", "Right-Back": "Lateral",
    "Defensive Midfield": "Mediocentro",
    "Central Midfield": "Centrocampista",
    "Attacking Midfield": "Mediapunta", "Left Midfield": "Centrocampista", "Right Midfield": "Centrocampista",
    "Left Winger": "Extremo", "Right Winger": "Extremo",
    "Centre-Forward": "Delantero", "Second Striker": "Delantero",
}

def _tm_pos_to_normalized(pos):
    if pos is None or (isinstance(pos, float) and pd.isna(pos)):
        return None
    return _TM_TO_NORM.get(str(pos), None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-wyscout", action="store_true")
    parser.add_argument("--validate",   action="store_true",
                        help="Muestra resumen sin guardar")
    args = parser.parse_args()

    master = build_master(include_wyscout=not args.no_wyscout)

    if args.validate:
        print("\nVista previa (5 filas):")
        print(master[["nombre","club","temporada","entrenador","posicion","minutos","goles"]].head())
        return

    DATA_FINAL.mkdir(parents=True, exist_ok=True)
    master.to_csv(OUTPUT_PATH, index=False, encoding="utf-8-sig")
    logger.info(f"  Guardado: {OUTPUT_PATH}")
    logger.info("═" * 55)


if __name__ == "__main__":
    main()
