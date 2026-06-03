#!/usr/bin/env python3
"""
Descarga el histórico de valor de mercado de cada jugador desde Transfermarkt.

Dos pasos:
  1. extract  — lee los HTML cacheados en data/raw/ y extrae (jugador, spieler_id)
  2. fetch    — para cada jugador llama al endpoint JSON de TM y guarda el histórico

Uso:
  python3 fetch_market_values.py              # extrae IDs + descarga todo
  python3 fetch_market_values.py --extract    # solo extrae IDs → jugador_ids.csv
  python3 fetch_market_values.py --fetch      # solo descarga (asume jugador_ids.csv)
  python3 fetch_market_values.py --resume     # reanuda desde checkpoint (omite ya procesados)

El proceso puede interrumpirse y reanudarse sin perder progreso (checkpoint JSON).
"""
import argparse
import json
import logging
import random
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

# ── Rutas ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).parent
DATA_RAW    = ROOT / "data" / "raw"
DATA_FINAL  = ROOT / "data" / "final"
LOGS_DIR    = ROOT / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

IDS_CSV        = DATA_FINAL / "jugador_ids.csv"
HISTORICO_CSV  = DATA_FINAL / "historico_valores.csv"
CHECKPOINT     = DATA_RAW   / "mv_checkpoint.json"

SEASONS = [2021, 2022, 2023, 2024, 2025]

# ── Logging ───────────────────────────────────────────────────────────────────
log_file = LOGS_DIR / f"market_values_{datetime.now():%Y%m%d_%H%M%S}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("mv")

# ── Headers para el endpoint JSON (simula petición XHR del navegador) ─────────
BASE_URL = "https://www.transfermarkt.com"

HEADERS_HTML = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
}

HEADERS_JSON = {
    **HEADERS_HTML,
    "Accept":           "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer":          BASE_URL + "/",
}

# ── Endpoint ──────────────────────────────────────────────────────────────────
def mv_url(spieler_id: str) -> str:
    return f"{BASE_URL}/ceapi/marketValueDevelopment/graph/{spieler_id}"


# ══════════════════════════════════════════════════════════════════════════════
# PASO 1: Extraer IDs de jugadores desde el HTML cacheado
# ══════════════════════════════════════════════════════════════════════════════

_PLAYER_HREF = re.compile(r"^/[^/]+/profil/spieler/(\d+)$")
_SEASON_LABELS = {2021:"2021-22", 2022:"2022-23", 2023:"2023-24",
                  2024:"2024-25", 2025:"2025-26"}


def _player_name_and_id(cell) -> tuple[str, str] | None:
    """
    Extrae (nombre_jugador, spieler_id) de la primera celda de una fila
    de transferencias. Devuelve None si no hay un link válido.
    """
    span = cell.find("span", {"class": "hide-for-small"})
    a = span.find("a") if span else cell.find("a", href=_PLAYER_HREF)
    if not a:
        return None
    href = a.get("href", "")
    m = _PLAYER_HREF.match(href)
    if not m:
        return None
    name = (a.get("title") or a.get_text(strip=True)).strip()
    return name, m.group(1)


def extract_ids_from_cache() -> pd.DataFrame:
    """
    Lee los 5 HTML cacheados y devuelve un DataFrame con columnas:
      jugador, spieler_id
    deduplicado por spieler_id (la misma persona puede aparecer en varias temporadas).
    """
    records: dict[str, str] = {}   # spieler_id → jugador_name

    for season_id in SEASONS:
        html_file = DATA_RAW / f"raw_html_{season_id}.html"
        if not html_file.exists():
            logger.warning(f"HTML no encontrado: {html_file} — ejecuta main.py primero")
            continue

        logger.info(f"Procesando {html_file.name} …")
        soup = BeautifulSoup(html_file.read_text(encoding="utf-8", errors="replace"),
                             "html.parser")

        for box in soup.find_all("div", {"class": "box"}):
            for table in box.find_all("table"):
                for row in table.find_all("tr")[1:]:
                    cells = row.find_all("td")
                    if len(cells) < 2:
                        continue
                    result = _player_name_and_id(cells[0])
                    if result:
                        name, sid = result
                        if sid not in records:
                            records[sid] = name

        logger.info(f"  Acumulado: {len(records):,} jugadores únicos")

    if not records:
        logger.error("No se encontraron IDs. ¿Están los HTML en data/raw/?")
        sys.exit(1)

    df = pd.DataFrame(
        [(name, sid) for sid, name in records.items()],
        columns=["jugador", "spieler_id"]
    ).sort_values("jugador").reset_index(drop=True)

    DATA_FINAL.mkdir(parents=True, exist_ok=True)
    df.to_csv(IDS_CSV, index=False, encoding="utf-8-sig")
    logger.info(f"✓ jugador_ids.csv — {len(df):,} jugadores únicos → {IDS_CSV}")
    return df


# ══════════════════════════════════════════════════════════════════════════════
# PASO 2: Descargar histórico de valor de mercado
# ══════════════════════════════════════════════════════════════════════════════

def _load_checkpoint() -> set[str]:
    """Devuelve el conjunto de spieler_ids ya procesados."""
    if CHECKPOINT.exists():
        data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        done = set(data.get("completed", []))
        logger.info(f"Checkpoint cargado: {len(done):,} jugadores ya procesados")
        return done
    return set()


def _save_checkpoint(completed: set[str], failed: set[str]) -> None:
    CHECKPOINT.write_text(
        json.dumps({"completed": sorted(completed), "failed": sorted(failed)},
                   ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def _parse_mv_response(data: dict, jugador: str, spieler_id: str) -> list[dict]:
    """
    Convierte la respuesta JSON del endpoint en filas para el CSV.

    Estructura del JSON de Transfermarkt:
      {"list": [{"datum_mw": "Jun 30, 2021", "mw": "800.000 €", "verein": "Club", ...}, ...]}
    El campo "y" contiene el valor numérico en euros.
    """
    rows = []
    for entry in data.get("list", []):
        raw_date = entry.get("datum_mw", "")
        try:
            fecha = datetime.strptime(raw_date, "%b %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            fecha = raw_date

        valor = entry.get("y", None)          # numérico en €
        club  = entry.get("verein", "")
        if valor is None:
            continue
        rows.append({
            "jugador":       jugador,
            "spieler_id":    spieler_id,
            "fecha":         fecha,
            "valor_mercado": int(valor),
            "club":          club,
        })
    return rows


def _wait(n_requests: int, delay_min=3.0, delay_max=6.0) -> None:
    delay = random.uniform(delay_min, delay_max)
    if n_requests > 0 and n_requests % 15 == 0:
        extra = random.uniform(8, 18)
        logger.debug(f"Pausa periódica tras {n_requests} requests (+{extra:.0f}s)")
        delay += extra
    time.sleep(delay)


def fetch_histories(ids_df: pd.DataFrame, resume: bool = False) -> None:
    """
    Itera sobre ids_df y descarga el histórico de VM de cada jugador.
    Guarda resultados incrementalmente en historico_valores.csv.
    """
    completed = _load_checkpoint() if resume else set()
    failed    = set()

    # Determinar si el CSV ya existe (para append vs create)
    csv_exists = HISTORICO_CSV.exists() and resume

    session = requests.Session()
    session.headers.update(HEADERS_JSON)

    total   = len(ids_df)
    pending = ids_df[~ids_df["spieler_id"].isin(completed)]
    logger.info(f"Jugadores totales: {total:,} · Pendientes: {len(pending):,}")

    n_requests = 0
    n_ok = 0
    n_fail = 0
    all_rows: list[dict] = []
    FLUSH_EVERY = 50   # guardar a disco cada N jugadores

    for i, (_, row) in enumerate(pending.iterrows(), 1):
        jugador   = row["jugador"]
        spieler_id = str(row["spieler_id"])
        url       = mv_url(spieler_id)

        _wait(n_requests)
        n_requests += 1

        try:
            resp = session.get(url, timeout=20)

            if resp.status_code == 429:
                wait = random.uniform(90, 150)
                logger.warning(f"Rate limit (429). Pausa {wait:.0f}s …")
                time.sleep(wait)
                resp = session.get(url, timeout=20)

            if resp.status_code == 404:
                logger.debug(f"[{i}/{len(pending)}] 404 {jugador} (id={spieler_id})")
                failed.add(spieler_id)
                n_fail += 1
                continue

            resp.raise_for_status()
            data  = resp.json()
            rows  = _parse_mv_response(data, jugador, spieler_id)

            if rows:
                all_rows.extend(rows)
                completed.add(spieler_id)
                n_ok += 1
                logger.info(f"[{i}/{len(pending)}] ✓ {jugador} — {len(rows)} puntos")
            else:
                logger.info(f"[{i}/{len(pending)}] ø {jugador} — sin datos históricos")
                completed.add(spieler_id)

        except Exception as exc:
            logger.error(f"[{i}/{len(pending)}] ✗ {jugador} (id={spieler_id}): {exc}")
            failed.add(spieler_id)
            n_fail += 1

        # Flush incremental
        if len(all_rows) >= FLUSH_EVERY * 5 or i % FLUSH_EVERY == 0:
            _flush(all_rows, csv_exists or i > FLUSH_EVERY)
            all_rows = []
            csv_exists = True
            _save_checkpoint(completed, failed)

    # Flush final
    if all_rows:
        _flush(all_rows, csv_exists)
    _save_checkpoint(completed, failed)

    logger.info("─" * 55)
    logger.info(f"COMPLETADO — OK: {n_ok:,} · Sin datos: — · Errores: {n_fail:,}")
    logger.info(f"CSV: {HISTORICO_CSV}")
    if HISTORICO_CSV.exists():
        df = pd.read_csv(HISTORICO_CSV)
        logger.info(f"Filas totales en historico_valores.csv: {len(df):,}")


def _flush(rows: list[dict], append: bool) -> None:
    """Escribe filas al CSV en modo append o write según corresponda."""
    if not rows:
        return
    df = pd.DataFrame(rows)
    DATA_FINAL.mkdir(parents=True, exist_ok=True)
    df.to_csv(
        HISTORICO_CSV,
        mode="a" if append else "w",
        header=not append,
        index=False,
        encoding="utf-8-sig"
    )
    logger.debug(f"Flush: {len(rows)} filas → {HISTORICO_CSV.name}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="Histórico de valores de mercado — Transfermarkt")
    parser.add_argument("--extract", action="store_true", help="Solo extrae IDs desde el HTML cacheado")
    parser.add_argument("--fetch",   action="store_true", help="Solo descarga históricos (necesita jugador_ids.csv)")
    parser.add_argument("--resume",  action="store_true", help="Reanuda desde checkpoint (no reprocesa ya descargados)")
    args = parser.parse_args()

    do_extract = args.extract or (not args.fetch)
    do_fetch   = args.fetch   or (not args.extract)

    logger.info("═" * 55)
    logger.info("  Histórico de Valores de Mercado — Transfermarkt")
    logger.info("═" * 55)

    if do_extract:
        logger.info("\n── PASO 1: Extracción de IDs desde HTML cacheado ──")
        ids_df = extract_ids_from_cache()
    else:
        if not IDS_CSV.exists():
            logger.error(f"No se encontró {IDS_CSV}. Ejecuta primero sin --fetch.")
            sys.exit(1)
        ids_df = pd.read_csv(IDS_CSV, dtype={"spieler_id": str})
        logger.info(f"Cargado {IDS_CSV.name}: {len(ids_df):,} jugadores")

    if do_fetch:
        logger.info("\n── PASO 2: Descarga de históricos de valor de mercado ──")
        logger.info(f"Endpoint: {mv_url('{id}')}")
        logger.info(f"Delay entre requests: 3-6s (+pausa larga cada 15)")
        logger.info(f"Tiempo estimado: ~{len(ids_df) * 4 / 60:.0f} minutos\n")
        fetch_histories(ids_df, resume=args.resume)


if __name__ == "__main__":
    main()
