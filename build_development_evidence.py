#!/usr/bin/env python3
"""
Genera evidencia historica para decisiones de cesion.

No recomienda destinos ni calcula scores. Solo agrega utilizacion real Sub23
desde master_player_development.csv:
  - edad <= 23
  - minutos > 0

Outputs:
  data/final/development_club_evidence.csv
  data/final/development_position_evidence.csv
  data/final/development_coach_evidence.csv
  data/final/betis_development_evidence.csv
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
MASTER_PATH = DATA_FINAL / "master_player_development.csv"

OUT_CLUB = DATA_FINAL / "development_club_evidence.csv"
OUT_POSITION = DATA_FINAL / "development_position_evidence.csv"
OUT_COACH = DATA_FINAL / "development_coach_evidence.csv"
OUT_BETIS = DATA_FINAL / "betis_development_evidence.csv"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("development_evidence")

POSITION_GROUPS = {
    "Delantero": "Delantero",
    "Extremo": "Extremo",
    "Mediocentro": "Mediocentro",
    "Centrocampista": "Mediocentro",
    "Mediapunta": "Mediocentro",
    "Central": "Central",
    "Lateral": "Lateral",
    "Portero": "Portero",
}

POSITION_COLUMNS = {
    "Delantero": "minutos_sub23_delanteros",
    "Extremo": "minutos_sub23_extremos",
    "Mediocentro": "minutos_sub23_mediocentros",
    "Central": "minutos_sub23_centrales",
    "Lateral": "minutos_sub23_laterales",
    "Portero": "minutos_sub23_porteros",
}


def num_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([0] * len(df), index=df.index, dtype="float64")
    return pd.to_numeric(df[col], errors="coerce")


def first_positive_mean(series: pd.Series) -> float | None:
    values = pd.to_numeric(series, errors="coerce")
    values = values[values > 0]
    if values.empty:
        return None
    return round(float(values.mean()), 2)


def plain_mean(series: pd.Series) -> float | None:
    values = pd.to_numeric(series, errors="coerce").dropna()
    if values.empty:
        return None
    return round(float(values.mean()), 2)


def sum_or_none(rows: pd.DataFrame, numeric_col: str, raw_col: str) -> float | None:
    if raw_col not in rows.columns or rows[raw_col].notna().sum() == 0:
        return None
    return round(float(rows[numeric_col].sum()), 2)


def normalize_position_group(pos: object) -> str | None:
    raw = "" if pd.isna(pos) else str(pos).strip()
    return POSITION_GROUPS.get(raw)


def load_master() -> pd.DataFrame:
    if not MASTER_PATH.exists():
        raise FileNotFoundError(f"No existe {MASTER_PATH}")

    df = pd.read_csv(MASTER_PATH, encoding="utf-8-sig", low_memory=False)
    df["edad_num"] = num_series(df, "edad")
    df["minutos_num"] = num_series(df, "minutos")
    df["partidos_num"] = num_series(df, "partidos")
    df["titularidades_num"] = num_series(df, "titularidades")
    df["goles_num"] = num_series(df, "goles")
    df["xg_num"] = num_series(df, "xg")
    df["revalorizacion_num"] = num_series(df, "revalorizacion_absoluta")
    df["valor_base"] = num_series(df, "valor_mercado_wyscout")
    missing_value = df["valor_base"].fillna(0) <= 0
    df.loc[missing_value, "valor_base"] = num_series(df.loc[missing_value], "valor_mercado")
    df["posicion_evidencia"] = df["posicion_normalizada"].apply(normalize_position_group)

    # Sub23 real: edad <= 23 y minutos jugados.
    sub23 = df[
        (df["edad_num"] > 0)
        & (df["edad_num"] <= 23)
        & (df["minutos_num"] > 0)
        & df["club"].notna()
        & df["nombre"].notna()
        & df["posicion_evidencia"].notna()
    ].copy()

    before = len(sub23)
    sub23 = sub23.sort_values(["minutos_num", "valor_base"], ascending=False)
    sub23 = sub23.drop_duplicates(subset=["nombre", "club", "temporada"], keep="first")
    removed = before - len(sub23)
    if removed:
        logger.info(f"Duplicados Sub23 eliminados para evidencia: {removed}")

    return sub23


def base_agg(rows: pd.DataFrame, player_col_name: str = "jugadores_sub23_utilizados") -> dict:
    return {
        player_col_name: int(rows["nombre"].nunique()),
        "minutos_sub23": round(float(rows["minutos_num"].sum()), 2),
        "partidos_sub23": round(float(rows["partidos_num"].sum()), 2),
        "titularidades_sub23": sum_or_none(rows, "titularidades_num", "titularidades"),
        "goles_sub23": round(float(rows["goles_num"].sum()), 2),
        "xg_sub23": round(float(rows["xg_num"].sum()), 2),
        "valor_mercado_medio_sub23": first_positive_mean(rows["valor_base"]),
        "revalorizacion_media_sub23": plain_mean(rows["revalorizacion_num"]),
        "temporadas_analizadas": int(rows["temporada"].nunique()),
    }


def build_club_evidence(sub23: pd.DataFrame) -> pd.DataFrame:
    records = []
    for club, rows in sub23.groupby("club", dropna=False):
        rec = {"club": club}
        rec.update(base_agg(rows))
        rec["edad_media_sub23"] = plain_mean(rows["edad_num"])
        for pos, col in POSITION_COLUMNS.items():
            rec[col] = round(float(rows.loc[rows["posicion_evidencia"] == pos, "minutos_num"].sum()), 2)
        records.append(rec)

    return pd.DataFrame(records).sort_values(
        ["minutos_sub23", "jugadores_sub23_utilizados"],
        ascending=False,
    )


def principal_coach(rows: pd.DataFrame) -> str:
    valid = rows[rows["entrenador"].notna() & (rows["entrenador"].astype(str).str.strip() != "")]
    if valid.empty:
        return ""
    by_coach = valid.groupby("entrenador")["minutos_num"].sum().sort_values(ascending=False)
    return str(by_coach.index[0])


def coach_minutes_distribution(rows: pd.DataFrame) -> str:
    total = float(rows["minutos_num"].sum())
    if total <= 0:
        return ""
    by_pos = rows.groupby("posicion_evidencia")["minutos_num"].sum().sort_values(ascending=False)
    parts = []
    for pos, value in by_pos.items():
        if value <= 0:
            continue
        pct = value / total * 100
        label = "<1%" if 0 < pct < 1 else f"{pct:.0f}%"
        parts.append(f"{pos} {label}")
    return "; ".join(parts)


def build_position_evidence(sub23: pd.DataFrame) -> pd.DataFrame:
    records = []
    club_minutes = sub23.groupby("club")["minutos_num"].sum().to_dict()

    for (club, pos), rows in sub23.groupby(["club", "posicion_evidencia"], dropna=False):
        total_club = club_minutes.get(club, 0) or 0
        rec = {
            "club": club,
            "posicion": pos,
            "jugadores_sub23": int(rows["nombre"].nunique()),
            "minutos_sub23": round(float(rows["minutos_num"].sum()), 2),
            "partidos_sub23": round(float(rows["partidos_num"].sum()), 2),
            "titularidades_sub23": sum_or_none(rows, "titularidades_num", "titularidades"),
            "goles_sub23": round(float(rows["goles_num"].sum()), 2),
            "xg_sub23": round(float(rows["xg_num"].sum()), 2),
            "valor_medio": first_positive_mean(rows["valor_base"]),
            "revalorizacion_media": plain_mean(rows["revalorizacion_num"]),
            "entrenador_principal": principal_coach(rows),
            "temporadas_analizadas": int(rows["temporada"].nunique()),
            "pct_minutos_sub23_club": round(float(rows["minutos_num"].sum()) / total_club * 100, 2)
            if total_club else 0,
        }
        records.append(rec)

    cols = [
        "club", "posicion", "jugadores_sub23", "minutos_sub23",
        "partidos_sub23", "titularidades_sub23", "goles_sub23", "xg_sub23",
        "valor_medio", "revalorizacion_media", "entrenador_principal",
        "temporadas_analizadas", "pct_minutos_sub23_club",
    ]
    return pd.DataFrame(records, columns=cols).sort_values(
        ["posicion", "minutos_sub23", "jugadores_sub23"],
        ascending=[True, False, False],
    )


def build_coach_evidence(sub23: pd.DataFrame) -> pd.DataFrame:
    rows_with_coach = sub23[
        sub23["entrenador"].notna()
        & (sub23["entrenador"].astype(str).str.strip() != "")
    ].copy()

    records = []
    for coach, rows in rows_with_coach.groupby("entrenador", dropna=False):
        rec = {"entrenador": coach}
        rec.update(base_agg(rows))
        rec["valor_generado_sub23"] = round(float(rows["revalorizacion_num"].sum()), 2)
        rec["clubes"] = "; ".join(sorted(rows["club"].dropna().astype(str).unique()))
        rec["posiciones_sub23_utilizadas"] = coach_minutes_distribution(rows)
        for pos, col in POSITION_COLUMNS.items():
            rec[col] = round(float(rows.loc[rows["posicion_evidencia"] == pos, "minutos_num"].sum()), 2)
        records.append(rec)

    return pd.DataFrame(records).sort_values(
        ["minutos_sub23", "jugadores_sub23_utilizados"],
        ascending=False,
    )


def build_all(validate_only: bool = False) -> dict[str, pd.DataFrame]:
    logger.info("Construyendo evidencia historica Sub23 real")
    sub23 = load_master()
    logger.info(f"Filas Sub23 reales con minutos: {len(sub23):,}")
    logger.info(f"Jugadores: {sub23['nombre'].nunique():,}")
    logger.info(f"Clubes: {sub23['club'].nunique():,}")
    logger.info(f"Entrenadores: {sub23['entrenador'].nunique():,}")

    outputs = {
        "club": build_club_evidence(sub23),
        "position": build_position_evidence(sub23),
        "coach": build_coach_evidence(sub23),
    }
    outputs["betis"] = outputs["position"].copy()

    if not validate_only:
        DATA_FINAL.mkdir(parents=True, exist_ok=True)
        outputs["club"].to_csv(OUT_CLUB, index=False, encoding="utf-8-sig")
        outputs["position"].to_csv(OUT_POSITION, index=False, encoding="utf-8-sig")
        outputs["coach"].to_csv(OUT_COACH, index=False, encoding="utf-8-sig")
        outputs["betis"].to_csv(OUT_BETIS, index=False, encoding="utf-8-sig")
        logger.info(f"Guardado: {OUT_CLUB}")
        logger.info(f"Guardado: {OUT_POSITION}")
        logger.info(f"Guardado: {OUT_COACH}")
        logger.info(f"Guardado: {OUT_BETIS}")

    logger.info("Top clubes por minutos Sub23:")
    logger.info("\n" + outputs["club"][["club", "jugadores_sub23_utilizados", "minutos_sub23"]].head(10).to_string(index=False))
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true", help="Construye y resume sin guardar CSVs")
    args = parser.parse_args()
    build_all(validate_only=args.validate)


if __name__ == "__main__":
    main()
