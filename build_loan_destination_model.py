#!/usr/bin/env python3
"""
Modelo explicable de destinos de cesion para jugadores del Betis Deportivo.

No usa machine learning ni recomendaciones automaticas opacas. Genera un
ranking auditable jugador + club destino basado en evidencia historica Sub23:
minutos reales, utilizacion por posicion, produccion y entrenador principal.

Outputs:
  data/final/betis_deportivo_players.csv
  data/final/betis_loan_destination_model.csv
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from src.normalizer import normalize_club, normalize_development_position, normalize_player_name

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
BETIS_DIR = ROOT / "data" / "JUGADORES BETIS"
BETIS_XLSX = BETIS_DIR / "JUGADORES BETIS DEPORTIVO.xlsx"

EVIDENCE_PATH = DATA_FINAL / "betis_development_evidence.csv"
COACH_EVIDENCE_PATH = DATA_FINAL / "development_coach_evidence.csv"

OUT_PLAYERS = DATA_FINAL / "betis_deportivo_players.csv"
OUT_MODEL = DATA_FINAL / "betis_loan_destination_model.csv"

POSITION_MINUTES_COL = {
    "Delantero": "minutos_sub23_delanteros",
    "Extremo": "minutos_sub23_extremos",
    "Mediocentro": "minutos_sub23_mediocentros",
    "Central": "minutos_sub23_centrales",
    "Lateral": "minutos_sub23_laterales",
    "Portero": "minutos_sub23_porteros",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("loan_model")


def num(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([0] * len(df), index=df.index, dtype="float64")
    return pd.to_numeric(df[col], errors="coerce")


def normalize_player_position(raw: object) -> tuple[str, str]:
    original = "" if pd.isna(raw) else str(raw).strip()
    primary = original.split(",")[0].strip() if original else ""
    normalized = normalize_development_position(primary)
    return primary, normalized or ""


def load_betis_players() -> pd.DataFrame:
    if not BETIS_XLSX.exists():
        raise FileNotFoundError(f"No existe {BETIS_XLSX}")

    df = pd.read_excel(BETIS_XLSX)
    df = df.rename(columns={
        "Jugador": "jugador",
        "Equipo": "equipo",
        "Posición específica": "posicion_original",
        "Edad": "edad",
        "Valor de mercado": "valor_mercado",
        "Vencimiento contrato": "vencimiento_contrato",
        "Partidos jugados": "partidos_jugados",
        "Minutos jugados": "minutos_jugados",
        "Goles": "goles",
        "xG": "xg",
        "País de nacimiento": "pais_nacimiento",
        "Pasaporte": "pasaporte",
        "Pie": "pie",
        "Altura": "altura",
        "Peso": "peso",
        "En préstamo": "en_prestamo",
    })

    df = df[df["jugador"].notna()].copy()
    df["jugador"] = df["jugador"].apply(lambda x: normalize_player_name(str(x)))
    df["equipo"] = df["equipo"].apply(lambda x: normalize_club(str(x)) if pd.notna(x) else "")

    pos = df["posicion_original"].apply(normalize_player_position)
    df["posicion_primaria"] = pos.apply(lambda p: p[0])
    df["posicion_normalizada"] = pos.apply(lambda p: p[1])

    for col in ["edad", "valor_mercado", "partidos_jugados", "minutos_jugados", "goles", "xg", "altura", "peso"]:
        df[col] = num(df, col)

    df["es_sub23"] = (df["edad"] > 0) & (df["edad"] <= 23)
    df["goles_por_90"] = df.apply(
        lambda r: round((r["goles"] * 90 / r["minutos_jugados"]), 2)
        if r["minutos_jugados"] > 0 else None,
        axis=1,
    )
    df["xg_por_90"] = df.apply(
        lambda r: round((r["xg"] * 90 / r["minutos_jugados"]), 2)
        if r["minutos_jugados"] > 0 else None,
        axis=1,
    )

    cols = [
        "jugador", "equipo", "posicion_original", "posicion_primaria",
        "posicion_normalizada", "edad", "valor_mercado", "vencimiento_contrato",
        "partidos_jugados", "minutos_jugados", "goles", "xg",
        "goles_por_90", "xg_por_90", "pais_nacimiento", "pasaporte",
        "pie", "altura", "peso", "en_prestamo", "es_sub23",
    ]
    return df[[c for c in cols if c in df.columns]].copy()


def load_evidence() -> tuple[pd.DataFrame, pd.DataFrame]:
    if not EVIDENCE_PATH.exists():
        raise FileNotFoundError(f"No existe {EVIDENCE_PATH}. Ejecuta build_development_evidence.py")

    evidence = pd.read_csv(EVIDENCE_PATH, encoding="utf-8-sig", low_memory=False)
    coaches = pd.read_csv(COACH_EVIDENCE_PATH, encoding="utf-8-sig", low_memory=False) if COACH_EVIDENCE_PATH.exists() else pd.DataFrame()

    for col in ["jugadores_sub23", "minutos_sub23", "partidos_sub23", "goles_sub23", "xg_sub23",
                "valor_medio", "revalorizacion_media", "temporadas_analizadas", "pct_minutos_sub23_club"]:
        evidence[col] = num(evidence, col)

    if not coaches.empty:
        for col in POSITION_MINUTES_COL.values():
            coaches[col] = num(coaches, col)

    return evidence, coaches


def norm_value(value: float, max_value: float) -> float:
    if max_value <= 0:
        return 0.0
    return max(0.0, min(float(value) / max_value, 1.0))


def evidence_level(row: pd.Series) -> str:
    if row["minutos_sub23"] >= 5000 and row["jugadores_sub23"] >= 2 and row["temporadas_analizadas"] >= 2:
        return "Alta"
    if row["minutos_sub23"] >= 2000 and row["jugadores_sub23"] >= 1:
        return "Media"
    return "Baja"


def reason_text(row: pd.Series, coach_pos_minutes: float) -> str:
    parts = [
        f"{int(row['minutos_sub23'])} min Sub23 en {row['posicion']}",
        f"{int(row['jugadores_sub23'])} jugadores Sub23 usados",
    ]
    if row.get("entrenador_principal"):
        parts.append(f"entrenador principal: {row['entrenador_principal']}")
    if coach_pos_minutes > 0:
        parts.append(f"entrenador con {int(coach_pos_minutes)} min Sub23 en posicion")
    if pd.notna(row.get("goles_sub23")) and row["goles_sub23"] > 0:
        parts.append(f"{row['goles_sub23']:.0f} goles Sub23")
    if pd.notna(row.get("xg_sub23")) and row["xg_sub23"] > 0:
        parts.append(f"xG Sub23 {row['xg_sub23']:.2f}")
    return "; ".join(parts)


def build_model(players: pd.DataFrame, evidence: pd.DataFrame, coaches: pd.DataFrame, top_n: int) -> pd.DataFrame:
    coach_lookup = {}
    if not coaches.empty and "entrenador" in coaches.columns:
        coach_lookup = coaches.set_index("entrenador").to_dict("index")

    records = []
    for _, player in players.iterrows():
        pos = player["posicion_normalizada"]
        if not pos:
            continue

        candidates = evidence[evidence["posicion"] == pos].copy()
        if candidates.empty:
            continue

        max_minutes = float(candidates["minutos_sub23"].max() or 0)
        max_players = float(candidates["jugadores_sub23"].max() or 0)
        max_pct = float(candidates["pct_minutos_sub23_club"].max() or 0)
        production = candidates["goles_sub23"].fillna(0) + candidates["xg_sub23"].fillna(0)
        max_production = float(production.max() or 0)
        value_signal = candidates["revalorizacion_media"].clip(lower=0).fillna(0)
        if value_signal.max() <= 0:
            value_signal = candidates["valor_medio"].fillna(0)
        max_value_signal = float(value_signal.max() or 0)

        pos_col = POSITION_MINUTES_COL.get(pos)
        coach_pos_values = []
        for _, candidate in candidates.iterrows():
            coach = candidate.get("entrenador_principal")
            coach_row = coach_lookup.get(coach, {})
            coach_pos_values.append(float(coach_row.get(pos_col, 0) or 0) if pos_col else 0.0)
        max_coach_pos = max(coach_pos_values) if coach_pos_values else 0.0

        scored = []
        for idx, candidate in candidates.reset_index(drop=True).iterrows():
            coach_pos_minutes = coach_pos_values[idx] if idx < len(coach_pos_values) else 0.0
            prod_signal = float((candidate.get("goles_sub23") or 0) + (candidate.get("xg_sub23") or 0))
            val_signal = float(value_signal.iloc[idx]) if idx < len(value_signal) else 0.0

            score = (
                35 * norm_value(candidate["minutos_sub23"], max_minutes)
                + 15 * norm_value(candidate["jugadores_sub23"], max_players)
                + 15 * norm_value(candidate["pct_minutos_sub23_club"], max_pct)
                + 15 * norm_value(coach_pos_minutes, max_coach_pos)
                + 10 * norm_value(prod_signal, max_production)
                + 10 * norm_value(val_signal, max_value_signal)
            )

            scored.append({
                "jugador": player["jugador"],
                "edad": player["edad"],
                "equipo_actual": player["equipo"],
                "posicion_jugador": pos,
                "posicion_original": player["posicion_original"],
                "valor_mercado_jugador": player["valor_mercado"],
                "minutos_jugador": player["minutos_jugados"],
                "goles_jugador": player["goles"],
                "xg_jugador": player["xg"],
                "club_destino": candidate["club"],
                "posicion_destino": candidate["posicion"],
                "entrenador_principal": candidate.get("entrenador_principal", ""),
                "score_evidencia": round(score, 2),
                "nivel_evidencia": evidence_level(candidate),
                "jugadores_sub23_destino": int(candidate["jugadores_sub23"]),
                "minutos_sub23_destino": round(float(candidate["minutos_sub23"]), 2),
                "partidos_sub23_destino": round(float(candidate["partidos_sub23"]), 2),
                "goles_sub23_destino": round(float(candidate["goles_sub23"]), 2),
                "xg_sub23_destino": round(float(candidate["xg_sub23"]), 2),
                "valor_medio_destino": candidate.get("valor_medio"),
                "revalorizacion_media_destino": candidate.get("revalorizacion_media"),
                "temporadas_analizadas": int(candidate["temporadas_analizadas"]),
                "pct_minutos_sub23_club": round(float(candidate["pct_minutos_sub23_club"]), 2),
                "razones": reason_text(candidate, coach_pos_minutes),
            })

        scored_df = pd.DataFrame(scored).sort_values(
            ["score_evidencia", "minutos_sub23_destino"],
            ascending=False,
        ).head(top_n)
        scored_df.insert(9, "ranking_destino", range(1, len(scored_df) + 1))
        records.append(scored_df)

    if not records:
        return pd.DataFrame()
    return pd.concat(records, ignore_index=True)


def build_all(top_n: int = 12, validate_only: bool = False) -> tuple[pd.DataFrame, pd.DataFrame]:
    players = load_betis_players()
    evidence, coaches = load_evidence()
    model = build_model(players, evidence, coaches, top_n=top_n)

    logger.info(f"Jugadores Betis Deportivo cargados: {len(players)}")
    logger.info(f"Jugadores con posicion normalizada: {(players['posicion_normalizada'] != '').sum()}")
    logger.info(f"Filas modelo jugador+destino: {len(model)}")

    if not validate_only:
        DATA_FINAL.mkdir(parents=True, exist_ok=True)
        players.to_csv(OUT_PLAYERS, index=False, encoding="utf-8-sig")
        model.to_csv(OUT_MODEL, index=False, encoding="utf-8-sig")
        logger.info(f"Guardado: {OUT_PLAYERS}")
        logger.info(f"Guardado: {OUT_MODEL}")

    if not model.empty:
        logger.info("Ejemplo top destinos:")
        logger.info("\n" + model[["jugador", "posicion_jugador", "ranking_destino", "club_destino", "score_evidencia", "razones"]].head(12).to_string(index=False))

    return players, model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n", type=int, default=12, help="Destinos por jugador")
    parser.add_argument("--validate", action="store_true", help="Construye sin guardar")
    args = parser.parse_args()
    build_all(top_n=args.top_n, validate_only=args.validate)


if __name__ == "__main__":
    main()
