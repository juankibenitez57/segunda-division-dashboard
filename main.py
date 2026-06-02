#!/usr/bin/env python3
"""
Segunda División (LaLiga Hypermotion) — Scraper de Transferencias
Fuente: Transfermarkt (página global de competición ES2)
Temporadas: 2021-22 → 2025-26

Estrategia: una sola petición HTTP por temporada a la página global
  https://www.transfermarkt.com/segunda-division/transfers/wettbewerb/ES2/saison_id/{YYYY}
que contiene todos los clubes y sus movimientos en una sola página sin paginación.

Uso:
  python3 main.py                  # todas las temporadas
  python3 main.py --season 2024    # solo temporada 2024-25
  python3 main.py --dry-run        # usa HTML en caché sin hacer peticiones HTTP
"""
import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path

from tqdm import tqdm

# ── Directorios ───────────────────────────────────────────────────────────────
ROOT      = Path(__file__).parent
DATA_RAW  = ROOT / "data" / "raw"
DATA_FINAL= ROOT / "data" / "final"
LOGS_DIR  = ROOT / "logs"

for d in (DATA_RAW, DATA_FINAL, LOGS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────────────
log_file = LOGS_DIR / f"scraper_{datetime.now():%Y%m%d_%H%M%S}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("main")

# ── Módulos del proyecto ──────────────────────────────────────────────────────
sys.path.insert(0, str(ROOT))
from src.scraper  import Scraper
from src.parser   import SEASON_LABELS, extract_clubs, extract_transfers
from src.exporter import build_dataframe, to_csv, to_excel

# ── Constantes ────────────────────────────────────────────────────────────────
ALL_SEASONS  = [2021, 2022, 2023, 2024, 2025]
OUTPUT_STEM  = "segunda_division_fichajes_2021_2026"


# ── Helpers ───────────────────────────────────────────────────────────────────

def process_season(scraper: Scraper, season_id: int, dry_run: bool) -> list[dict]:
    """Descarga y parsea la página global de una temporada. Devuelve lista de registros."""
    season_label = SEASON_LABELS[season_id]
    cache_file   = DATA_RAW / f"raw_html_{season_id}.html"

    # Modo dry-run: usar HTML en caché si existe
    if dry_run and cache_file.exists():
        logger.info(f"[DRY-RUN] Cargando caché: {cache_file}")
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(cache_file.read_text(encoding="utf-8", errors="replace"), "html.parser")
    else:
        url  = Scraper.season_url(season_id)
        logger.info(f"Descargando temporada {season_label}: {url}")
        soup = scraper.fetch(url)
        if not soup:
            logger.error(f"No se pudo descargar la página de {season_label}")
            return []
        # Guardar caché para consultas futuras / debugging
        cache_file.write_text(str(soup), encoding="utf-8")

    # Extraer clubes (para el CSV auxiliar de clubs)
    clubs = extract_clubs(soup, season_id)
    clubs_df = build_dataframe([
        {"temporada": SEASON_LABELS[season_id], "club": c["name"], "club_id": c["club_id"],
         "jugador": "-", "movimiento": "-", "club_origen": "-", "club_destino": "-",
         "pais_club": "-", "fecha": "-", "importe": "-", "tipo_operacion": "-",
         "valor_mercado": "-", "posicion": "-", "edad": "-", "nacionalidad": "-"}
        for c in clubs
    ])
    # Solo guardamos la lista de clubs como CSV de referencia
    import pandas as pd
    pd.DataFrame(clubs).to_csv(
        DATA_RAW / f"clubs_{season_id}.csv", index=False, encoding="utf-8-sig"
    )

    # Extraer todos los movimientos
    records = extract_transfers(soup, season_id)

    # CSV por temporada
    if records:
        season_df = build_dataframe(records)
        to_csv(season_df, DATA_RAW / f"transfers_{season_id}.csv")
        logger.info(f"  ✓ {season_label}: {len(season_df):,} movimientos ({len(clubs)} clubes)")
    else:
        logger.warning(f"  ✗ {season_label}: sin movimientos")

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Scraper de transferencias de Segunda División")
    parser.add_argument("--season", type=int, choices=ALL_SEASONS,
                        help="Procesar solo una temporada (ej. 2024 = 2024-25)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Usar HTML en caché local sin hacer peticiones HTTP")
    args = parser.parse_args()

    seasons = [args.season] if args.season else ALL_SEASONS

    logger.info("━" * 60)
    logger.info("  Segunda División Transfer Scraper")
    logger.info(f"  Temporadas: {[SEASON_LABELS[s] for s in seasons]}")
    logger.info(f"  Estrategia: página global ES2 (1 request/temporada)")
    logger.info("━" * 60)

    scraper     = Scraper(delay_min=3.0, delay_max=7.0, max_retries=3)
    all_records: list[dict] = []

    pbar = tqdm(seasons, desc="Temporadas", unit="temp")
    for season_id in pbar:
        pbar.set_description(f"Temporada {SEASON_LABELS[season_id]}")
        try:
            records = process_season(scraper, season_id, dry_run=args.dry_run)
            all_records.extend(records)
        except Exception as exc:
            logger.error(f"Error procesando temporada {season_id}: {exc}", exc_info=True)

    # ── Exportación final consolidada ─────────────────────────────────────────
    logger.info(f"\n{'─'*60}")
    logger.info(f"  Total registros brutos: {len(all_records):,}")

    df = build_dataframe(all_records)

    if df.empty:
        logger.error("Sin datos. Abortando exportación.")
        return

    csv_path   = DATA_FINAL / f"{OUTPUT_STEM}.csv"
    excel_path = DATA_FINAL / f"{OUTPUT_STEM}.xlsx"

    to_csv  (df, csv_path)
    to_excel(df, excel_path)

    # ── Resumen ───────────────────────────────────────────────────────────────
    logger.info(f"\n{'━'*60}")
    logger.info(f"  RESUMEN FINAL")
    logger.info(f"  Total movimientos: {len(df):,}")
    logger.info(f"  Temporadas:        {df['temporada'].nunique()}")
    logger.info(f"  Clubes únicos:     {df['club'].nunique()}")
    logger.info(f"  Altas:             {(df['movimiento']=='alta').sum():,}")
    logger.info(f"  Bajas:             {(df['movimiento']=='baja').sum():,}")
    logger.info(f"\n  Archivos generados:")
    logger.info(f"    CSV:   {csv_path}")
    logger.info(f"    Excel: {excel_path}")
    logger.info(f"    Log:   {log_file}")
    logger.info("━" * 60)

    # Resumen por temporada en consola
    print("\n  Movimientos por temporada:")
    summary = df.groupby("temporada").size().reset_index(name="total")
    for _, row in summary.iterrows():
        print(f"    {row['temporada']}: {row['total']:,}")


if __name__ == "__main__":
    main()
