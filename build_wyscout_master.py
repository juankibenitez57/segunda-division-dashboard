#!/usr/bin/env python3
"""
Genera master_wyscout_players.csv unificando todos los Excel de Wyscout.

Uso:
  python3 build_wyscout_master.py            # build completo
  python3 build_wyscout_master.py --validate  # resumen sin guardar
  python3 build_wyscout_master.py --match-tm  # muestra calidad del cruce con TM
"""
import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from src.wyscout_loader import load_all
from src.normalizer import normalize_club, normalize_player_name, player_key

ROOT       = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
WYSCOUT_DIR= ROOT / "data" / "wyscout"
OUTPUT     = DATA_FINAL / "master_wyscout_players.csv"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("wyscout_master")

# Orden de columnas en el CSV final
FINAL_COLS = [
    'temporada', 'categoria',
    'jugador', 'equipo',
    'posicion_wyscout', 'posicion_primaria', 'posicion_normalizada',
    'edad', 'pais_nacimiento', 'pasaporte', 'pie', 'altura', 'peso',
    'valor_mercado', 'vencimiento_contrato',
    'partidos_jugados', 'minutos_jugados', 'goles', 'xg',
    'cesion',
    # Clave de unión con TM (generada aquí)
    '_match_key',
]


def build_match_key(jugador: str, equipo: str, temporada: str) -> str:
    """Clave normalizada para cruzar con master_player_development."""
    return f"{player_key(jugador)}|{player_key(equipo)}|{temporada}"


def match_with_tm(wyscout: pd.DataFrame) -> dict:
    """
    Cruza wyscout con el master TM y devuelve estadísticas de emparejamiento.
    """
    tm_path = DATA_FINAL / "master_player_development.csv"
    if not tm_path.exists():
        return {"error": "master_player_development.csv no encontrado"}

    tm = pd.read_csv(tm_path, encoding="utf-8-sig", low_memory=False)
    tm["_key"] = tm.apply(
        lambda r: build_match_key(str(r.get("nombre", "")),
                                   str(r.get("club", "")),
                                   str(r.get("temporada", ""))), axis=1
    )

    wy_keys  = set(wyscout["_match_key"])
    tm_keys  = set(tm["_key"])
    matched  = wy_keys & tm_keys
    only_wy  = wy_keys - tm_keys
    only_tm  = tm_keys - wy_keys

    pct = len(matched) / len(wy_keys) * 100 if wy_keys else 0
    return {
        "wyscout_total":    len(wy_keys),
        "tm_total":         len(tm_keys),
        "matched":          len(matched),
        "match_pct":        round(pct, 1),
        "only_wyscout":     len(only_wy),
        "only_tm":          len(only_tm),
        "sample_unmatched": list(only_wy)[:10],
    }


def build_master(validate_only: bool = False, show_match: bool = False) -> pd.DataFrame:
    logger.info("═" * 55)
    logger.info("  Master Wyscout Players")
    logger.info("═" * 55)

    # ── Cargar todos los archivos ─────────────────────────────────────────────
    df = load_all(WYSCOUT_DIR)
    if df.empty:
        logger.error("Sin datos. Coloca los .xlsx en data/wyscout/PLAYERS/")
        return df

    # ── Generar clave de cruce con TM ─────────────────────────────────────────
    df["_match_key"] = df.apply(
        lambda r: build_match_key(r["jugador"], r["equipo"], r["temporada"]), axis=1
    )

    # ── Deduplicar (mismo jugador+equipo+temporada → quedarse con mayor minutos) ──
    before = len(df)
    df = df.sort_values("minutos_jugados", ascending=False, na_position="last")
    df.drop_duplicates(subset=["jugador", "equipo", "temporada"], keep="first", inplace=True)
    dupes = before - len(df)

    # ── Asegurar columnas en orden ────────────────────────────────────────────
    available = [c for c in FINAL_COLS if c in df.columns]
    extra = [c for c in df.columns if c not in FINAL_COLS]
    df = df[available + extra].copy()

    # ── Resumen ───────────────────────────────────────────────────────────────
    logger.info(f"\n{'─'*55}")
    logger.info(f"  Registros totales:     {len(df):,}")
    logger.info(f"  Jugadores únicos:      {df['jugador'].nunique():,}")
    logger.info(f"  Equipos únicos:        {df['equipo'].nunique()}")
    logger.info(f"  Temporadas:            {sorted(df['temporada'].unique())}")
    logger.info(f"  Categorías:            {sorted(df['categoria'].unique())}")
    logger.info(f"  Duplicados eliminados: {dupes}")
    logger.info(f"  Con minutos > 0:       {(df['minutos_jugados'] > 0).sum():,}")
    logger.info(f"  En cesión:             {df['cesion'].sum():,}")
    logger.info(f"  Sub-23 (edad < 23):    {(df['edad'] < 23).sum():,}")

    by_temp = df.groupby(['temporada', 'categoria']).size().unstack(fill_value=0)
    logger.info(f"\n  Registros por temporada × categoría:\n{by_temp.to_string()}")

    if show_match or validate_only:
        stats = match_with_tm(df)
        if "error" not in stats:
            logger.info(f"\n  Cruce con TM (master_player_development):")
            logger.info(f"    Wyscout únicos:   {stats['wyscout_total']:,}")
            logger.info(f"    TM únicos:        {stats['tm_total']:,}")
            logger.info(f"    Emparejados:      {stats['matched']:,}  ({stats['match_pct']}%)")
            logger.info(f"    Solo en Wyscout:  {stats['only_wyscout']:,}  (jugadores fuera de 2ª División)")
            logger.info(f"    Solo en TM:       {stats['only_tm']:,}  (jugadores sin stats Wyscout)")
            if stats["sample_unmatched"]:
                logger.info(f"    Muestra sin cruzar: {stats['sample_unmatched'][:5]}")

    logger.info(f"{'─'*55}")

    if validate_only:
        logger.info("  (--validate: no se guarda el CSV)")
        return df

    DATA_FINAL.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT, index=False, encoding="utf-8-sig")
    logger.info(f"  Guardado: {OUTPUT}")
    logger.info("═" * 55)
    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate",  action="store_true", help="Resumen sin guardar")
    parser.add_argument("--match-tm",  action="store_true", help="Muestra calidad del cruce con TM")
    args = parser.parse_args()
    build_master(validate_only=args.validate, show_match=args.match_tm)


if __name__ == "__main__":
    main()
