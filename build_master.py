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
    # Participación (Wyscout)
    "partidos",
    "titularidades",
    "minutos",
    # Producción (Wyscout)
    "goles",
    "asistencias",
    "amarillas",
    "rojas",
    # Mercado (Transfermarkt)
    "valor_mercado",        # VM en el momento del fichaje
    "valor_llegada",        # VM al llegar al club
    "valor_salida",         # VM al salir del club
    "revalorizacion_absoluta",
    "revalorizacion_porcentual",
    # Operación
    "tipo_operacion",       # cesion, traspaso, libre, retorno_cesion, otro
    "movimiento",           # alta / baja
    "origen_desarrollo",    # Cantera/Filial, Segunda, Primera División, Extranjero
    # Metadata
    "fuente",               # tm, wyscout, manual
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

    # ── Merge con Wyscout ─────────────────────────────────────────────────────
    if include_wyscout:
        wyscout_records = import_all_wyscout(DATA_WYSCOUT)
        # Excluir el archivo de muestra
        wyscout_records = [r for r in wyscout_records if r.get("nombre") not in ("Jugador Ejemplo", "Otro Jugador")]

        if wyscout_records:
            wy = pd.DataFrame(wyscout_records)
            wy["_key"] = wy["nombre"].apply(lambda x: player_key(x) if x else "")
            master["_key"] = master["nombre"].apply(lambda x: player_key(x) if x else "")

            wy_cols = ["_key", "club", "temporada", "partidos", "titularidades",
                       "minutos", "goles", "asistencias", "amarillas", "rojas",
                       "entrenador", "fecha_nacimiento"]

            wy_merge = wy[[c for c in wy_cols if c in wy.columns]].copy()
            master = master.merge(
                wy_merge, on=["_key", "club", "temporada"],
                how="left", suffixes=("", "_wy")
            )

            # Priorizar datos Wyscout para stats, entrenador
            for col in ["partidos", "titularidades", "minutos", "goles",
                        "asistencias", "amarillas", "rojas"]:
                if f"{col}_wy" in master.columns:
                    master[col] = master[f"{col}_wy"].combine_first(master[col])
                    master.drop(columns=[f"{col}_wy"], inplace=True)

            if "entrenador_wy" in master.columns:
                master["entrenador"] = master["entrenador_wy"].combine_first(master["entrenador"])
                master.drop(columns=["entrenador_wy"], inplace=True)

            if "fecha_nacimiento_wy" in master.columns:
                master["fecha_nacimiento"] = master["fecha_nacimiento_wy"].combine_first(master["fecha_nacimiento"])
                master.drop(columns=["fecha_nacimiento_wy"], inplace=True)

            master.drop(columns=["_key"], errors="ignore", inplace=True)
            logger.info(f"Wyscout mergeado: {len(wyscout_records)} registros")
        else:
            master.drop(columns=["_key"], errors="ignore", inplace=True)
            logger.info("Sin datos Wyscout disponibles (columnas de stats quedan vacías)")
    else:
        master.drop(columns=["_key"], errors="ignore", inplace=True)

    # ── Deduplicar ────────────────────────────────────────────────────────────
    before = len(master)
    master.drop_duplicates(subset=["nombre", "club", "temporada", "movimiento"],
                           keep="first", inplace=True)
    if before > len(master):
        logger.info(f"Deduplicados: {before - len(master)} filas eliminadas")

    master.reset_index(drop=True, inplace=True)
    logger.info(f"\n{'─'*55}")
    logger.info(f"  MASTER generado: {len(master):,} registros")
    logger.info(f"  Jugadores únicos: {master['nombre'].nunique():,}")
    logger.info(f"  Clubes:           {master['club'].nunique()}")
    logger.info(f"  Entrenadores:     {master['entrenador'].nunique()}")
    logger.info(f"  Temporadas:       {master['temporada'].nunique()}")
    logger.info(f"  Con datos Wyscout: {master['minutos'].notna().sum()}")
    logger.info(f"{'─'*55}")

    return master


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
