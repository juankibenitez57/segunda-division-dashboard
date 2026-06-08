#!/usr/bin/env python3
"""
Genera una lista de jugadores que no deben contar como plantilla actual.

Wyscout puede arrastrar futbolistas en 2025-26 aunque Transfermarkt ya registre
una baja del club en esa misma temporada. Esta tabla se usa en ScoutGPT para no
mostrar competencia falsa en análisis jugador+club.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
TRANSFERS = DATA_FINAL / "segunda_division_fichajes_2021_2026.csv"
OUT = DATA_FINAL / "current_squad_exclusions.csv"


def main() -> None:
    if not TRANSFERS.exists():
        raise FileNotFoundError(f"Falta {TRANSFERS}")

    df = pd.read_csv(TRANSFERS)
    required = {"temporada", "club", "jugador", "movimiento"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Faltan columnas en {TRANSFERS.name}: {sorted(missing)}")

    cols = ["temporada", "club", "jugador", "tipo_operacion"]
    if "club_destino" in df.columns:
        cols.append("club_destino")

    out = (
        df[
            df["temporada"].astype(str).eq("2025-26")
            & df["movimiento"].astype(str).str.lower().eq("baja")
        ][cols]
        .dropna(subset=["club", "jugador"])
        .drop_duplicates()
        .sort_values(["club", "jugador"])
    )
    out.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"OK {OUT} ({len(out)} bajas actuales)")


if __name__ == "__main__":
    main()
