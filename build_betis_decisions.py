#!/usr/bin/env python3
"""
Sistema de apoyo a decisiones para jugadores del Betis Deportivo.

Combina TODA la evidencia en una recomendación explicable por jugador:
  · operation_success_score (modelo RF entrenado)  → probabilidad de éxito
  · betis_loan_destination_model                    → clubes que desarrollan
  · development_coach_evidence                       → entrenadores que usan jóvenes
  · club_position_demand                             → clubes que NECESITAN la posición
  · historical_success_cases                         → casos similares reales
  · operation_success_v2_model                       → modelo honesto pre-operación

NO es una caja negra: cada recomendación incluye el desglose de por qué.

Salida:
  data/final/betis_decision_recommendations.csv

Uso:
  python3 build_betis_decisions.py
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"

PLAYERS_PATH = DATA_FINAL / "betis_deportivo_players.csv"
LOAN_PATH = DATA_FINAL / "betis_loan_destination_model.csv"
COACH_PATH = DATA_FINAL / "development_coach_evidence.csv"
DEMAND_PATH = DATA_FINAL / "club_position_demand.csv"
CASES_PATH = DATA_FINAL / "historical_success_cases.csv"
MODEL_PATH = DATA_FINAL / "success_score_model.joblib"
MODEL_V2_PATH = DATA_FINAL / "operation_success_v2_model.joblib"
CLUB_EVIDENCE_PATH = DATA_FINAL / "development_club_evidence.csv"
PLAYER_RECS_PATH = DATA_FINAL / "betis_rf_player_recommendations.csv"

OUT_PATH = DATA_FINAL / "betis_decision_recommendations.csv"
OUT_JSON = DATA_FINAL / "betis_decision_recommendations.json"
OUT_V2_DEST_PATH = DATA_FINAL / "betis_v2_destination_recommendations.csv"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("betis_decisions")

NUMERIC_FEATURES = ["edad", "valor_mercado", "minutos", "goles", "xg", "goles_por_90", "xg_por_90"]
CATEGORICAL_FEATURES = ["posicion_normalizada", "club", "entrenador", "tipo_operacion"]

V2_NUMERIC_FEATURES = [
    "edad", "pre_edad", "pre_valor_mercado", "pre_partidos", "pre_minutos",
    "pre_goles", "pre_xg", "pre_goles_por_90", "pre_xg_por_90",
    "valor_mercado", "valor_llegada", "club_pos_minutos_sub23",
    "club_pos_jugadores_sub23", "club_pos_pct_minutos",
    "club_total_minutos_sub23", "club_total_jugadores_sub23",
    "coach_total_minutos_sub23", "coach_total_jugadores_sub23",
    "coach_pos_minutos_sub23", "demand_total_altas", "demand_cesiones",
    "demand_traspasos", "demand_sub23", "demand_recent", "demand_score",
]
V2_CATEGORICAL_FEATURES = [
    "posicion_normalizada", "tipo_suceso", "tipo_operacion",
    "origen_desarrollo", "club", "entrenador", "pre_club",
]

POSITION_MINUTES_COL = {
    "Delantero": "minutos_sub23_delanteros",
    "Extremo": "minutos_sub23_extremos",
    "Mediocentro": "minutos_sub23_mediocentros",
    "Centrocampista": "minutos_sub23_mediocentros",
    "Central": "minutos_sub23_centrales",
    "Lateral": "minutos_sub23_laterales",
    "Portero": "minutos_sub23_porteros",
}

BETIS_DEPORTIVO_DESCENDED = True
STAY_RELEGATION_PENALTY = 18.0
LOAN_HIGHER_LEVEL_BONUS = 10.0
YOUNG_SALE_PENALTY = 6.0

ROLE_NAME_OVERRIDES = {
    "r marina": {
        "role": "delantero referencia",
        "needs": ["centros laterales", "presencia de área", "minutos reales para delanteros jóvenes"],
    },
    "rodrigo marina": {
        "role": "delantero referencia",
        "needs": ["centros laterales", "presencia de área", "minutos reales para delanteros jóvenes"],
    },
    "pablo garcia": {
        "role": "extremo encarador",
        "needs": ["juego por banda", "duelos exteriores", "espacio para recibir abierto"],
    },
}


def fmt_money(v: float) -> str:
    if pd.isna(v) or v == 0:
        return "-"
    sign = "-" if v < 0 else ""
    v = abs(float(v))
    if v >= 1e6:
        return f"{sign}€{v/1e6:.1f}M"
    if v >= 1e3:
        return f"{sign}€{v/1e3:.0f}k"
    return f"{sign}€{v:.0f}"


def num(v, default=0.0):
    try:
        return float(v) if pd.notna(v) else default
    except Exception:
        return default


def norm_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.lower().replace(".", " ").split())


def minmax(v: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return max(0.0, min((num(v) - low) / (high - low), 1.0))


def player_tactical_profile(player: pd.Series) -> dict:
    name_key = norm_text(player.get("jugador", ""))
    pos = str(player.get("posicion_normalizada", "") or "")
    original = str(player.get("posicion_original", "") or "")
    height = num(player.get("altura"))
    goals90 = num(player.get("goles_por_90"))
    xg90 = num(player.get("xg_por_90"))

    if name_key in ROLE_NAME_OVERRIDES:
        base = ROLE_NAME_OVERRIDES[name_key].copy()
    elif pos == "Delantero" and (height >= 185 or xg90 >= 0.30):
        base = {
            "role": "delantero referencia",
            "needs": ["centros laterales", "presencia de área", "minutos reales para delanteros jóvenes"],
        }
    elif pos == "Extremo":
        base = {
            "role": "extremo encarador",
            "needs": ["juego por banda", "duelos exteriores", "espacio para recibir abierto"],
        }
    elif pos in {"Mediocentro", "Centrocampista"}:
        base = {
            "role": "centrocampista de desarrollo",
            "needs": ["volumen de balón", "continuidad competitiva", "estructura estable por dentro"],
        }
    elif pos == "Central":
        base = {
            "role": "central joven",
            "needs": ["minutos defensivos", "equipo que use centrales sub23", "protección competitiva"],
        }
    elif pos == "Lateral":
        base = {
            "role": "lateral de recorrido",
            "needs": ["juego exterior", "minutos para laterales jóvenes", "recorrido por banda"],
        }
    else:
        base = {
            "role": pos.lower() or "perfil por definir",
            "needs": ["minutos reales", "demanda posicional", "contexto sub23"],
        }

    traits = []
    if height >= 185:
        traits.append("altura para atacar centros")
    if goals90 >= 0.35 or xg90 >= 0.35:
        traits.append("producción ofensiva alta")
    if any(code in original for code in ["RW", "LW", "RWF", "LWF"]):
        traits.append("amenaza exterior")
    return {**base, "traits": traits}


def club_tactical_context(club_row: pd.Series | None, demand_score: float, pos: str) -> dict:
    if club_row is None:
        return {
            "wide_game_score": 0.0,
            "cross_supply_proxy": 0.0,
            "striker_environment": 0.0,
            "position_minutes_score": 0.0,
        }

    total = num(club_row.get("minutos_sub23"))
    if total <= 0:
        total = sum(num(club_row.get(c)) for c in POSITION_MINUTES_COL.values())
    total = max(total, 1.0)

    ext = num(club_row.get("minutos_sub23_extremos"))
    lat = num(club_row.get("minutos_sub23_laterales"))
    fwd = num(club_row.get("minutos_sub23_delanteros"))
    mid = num(club_row.get("minutos_sub23_mediocentros"))
    pos_col = POSITION_MINUTES_COL.get(pos, "")
    pos_minutes = num(club_row.get(pos_col)) if pos_col else 0.0

    wide_share = (ext + lat) / total
    wide_game_score = (
        45 * minmax(wide_share, 0.18, 0.48)
        + 30 * minmax(ext, 0, 6500)
        + 25 * minmax(lat, 0, 8500)
    )
    cross_supply_proxy = (
        55 * minmax(wide_share, 0.20, 0.52)
        + 25 * minmax(lat, 0, 8500)
        + 20 * minmax(ext, 0, 6500)
    )
    striker_environment = (
        40 * minmax(fwd, 0, 9000)
        + 25 * minmax(num(club_row.get("goles_sub23")), 0, 45)
        + 20 * minmax(num(club_row.get("xg_sub23")), 0, 45)
        + 15 * minmax(demand_score, 30, 95)
    )
    interior_environment = (
        55 * minmax(mid, 0, 12000)
        + 25 * minmax(total, 5000, 32000)
        + 20 * minmax(demand_score, 30, 95)
    )
    return {
        "wide_game_score": round(float(wide_game_score), 1),
        "cross_supply_proxy": round(float(cross_supply_proxy), 1),
        "striker_environment": round(float(striker_environment), 1),
        "interior_environment": round(float(interior_environment), 1),
        "position_minutes_score": round(100 * minmax(pos_minutes, 0, 8000), 1),
        "wide_share": round(float(wide_share * 100), 1),
        "position_minutes": round(float(pos_minutes), 0),
    }


def tactical_fit(player: pd.Series, club: str, club_row: pd.Series | None, demand_score: float, pos: str) -> tuple[float, str]:
    profile = player_tactical_profile(player)
    ctx = club_tactical_context(club_row, demand_score, pos)
    role = profile["role"]

    if role == "delantero referencia":
        score = 0.58 * ctx["cross_supply_proxy"] + 0.22 * ctx["striker_environment"] + 0.20 * ctx["position_minutes_score"]
        reason = (
            f"{club}: encaje para delantero de área. El perfil necesita {', '.join(profile['needs'][:2])}; "
            f"el club muestra proxy de centros/juego exterior {ctx['cross_supply_proxy']:.0f}/100, "
            f"entorno de delanteros {ctx['striker_environment']:.0f}/100 y {ctx['position_minutes']:.0f} min Sub23 en la posición."
        )
    elif role == "extremo encarador":
        score = 0.52 * ctx["wide_game_score"] + 0.28 * ctx["position_minutes_score"] + 0.20 * minmax(demand_score, 30, 95) * 100
        reason = (
            f"{club}: encaje para extremo abierto. El perfil necesita {', '.join(profile['needs'][:2])}; "
            f"el club tiene juego exterior proxy {ctx['wide_game_score']:.0f}/100, "
            f"{ctx['wide_share']:.0f}% de sus minutos Sub23 en perfiles de banda/lateral y demanda {demand_score:.0f}/100."
        )
    elif role == "centrocampista de desarrollo":
        score = 0.55 * ctx["interior_environment"] + 0.25 * ctx["position_minutes_score"] + 0.20 * minmax(demand_score, 30, 95) * 100
        reason = (
            f"{club}: encaje interior. El club acumula {ctx['position_minutes']:.0f} min Sub23 en la zona y demanda {demand_score:.0f}/100."
        )
    elif role == "lateral de recorrido":
        score = 0.50 * ctx["wide_game_score"] + 0.30 * ctx["position_minutes_score"] + 0.20 * minmax(demand_score, 30, 95) * 100
        reason = (
            f"{club}: encaje exterior para lateral. Juego por fuera {ctx['wide_game_score']:.0f}/100 y {ctx['position_minutes']:.0f} min Sub23 en laterales."
        )
    else:
        score = 0.45 * ctx["position_minutes_score"] + 0.35 * minmax(demand_score, 30, 95) * 100 + 0.20 * minmax(num(club_row.get("minutos_sub23")) if club_row is not None else 0, 5000, 32000) * 100
        reason = (
            f"{club}: encaje por oportunidad competitiva. Demanda {demand_score:.0f}/100 y {ctx['position_minutes']:.0f} min Sub23 en la posición."
        )

    traits = profile.get("traits") or []
    if traits:
        reason += f" Rasgos del jugador considerados: {', '.join(traits)}."
    reason += " Fuente táctica actual: proxy construido con minutos/posición Wyscout; faltan eventos de centros, regates, duelos y mapas de calor para afinar."
    return round(float(max(0, min(score, 100))), 1), reason


def lookup_row(df: pd.DataFrame, **criteria) -> pd.Series | None:
    if df.empty:
        return None
    mask = pd.Series([True] * len(df), index=df.index)
    for col, value in criteria.items():
        if col not in df.columns:
            return None
        mask &= df[col].astype(str).eq(str(value))
    hit = df[mask]
    return hit.iloc[0] if not hit.empty else None


def predict_success(model, player: pd.Series, tipo_operacion: str, club: str, entrenador: str) -> float:
    """Predice operation_success_score (0-100) para un escenario hipotético."""
    row = {
        "edad": num(player.get("edad")),
        "valor_mercado": num(player.get("valor_mercado")),
        "minutos": num(player.get("minutos_jugados")),
        "goles": num(player.get("goles")),
        "xg": num(player.get("xg")),
        "goles_por_90": num(player.get("goles_por_90")),
        "xg_por_90": num(player.get("xg_por_90")),
        "posicion_normalizada": player.get("posicion_normalizada", ""),
        "club": club,
        "entrenador": entrenador,
        "tipo_operacion": tipo_operacion,
    }
    X = pd.DataFrame([row])[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    return float(model.predict(X)[0])


def coach_pos_minutes(coach_row: pd.Series | None, pos: str) -> float:
    if coach_row is None:
        return 0.0
    col = POSITION_MINUTES_COL.get(pos, "")
    return num(coach_row.get(col)) if col else 0.0


def scenario_row_v2(
    player: pd.Series,
    tipo_operacion: str,
    club: str,
    entrenador: str = "",
    dest: pd.Series | None = None,
    demand_row: pd.Series | None = None,
    club_row: pd.Series | None = None,
    coach_row: pd.Series | None = None,
) -> dict:
    pos = player.get("posicion_normalizada", "")
    return {
        "edad": num(player.get("edad")),
        "pre_edad": num(player.get("edad")),
        "pre_valor_mercado": num(player.get("valor_mercado")),
        "pre_partidos": num(player.get("partidos_jugados")),
        "pre_minutos": num(player.get("minutos_jugados")),
        "pre_goles": num(player.get("goles")),
        "pre_xg": num(player.get("xg")),
        "pre_goles_por_90": num(player.get("goles_por_90")),
        "pre_xg_por_90": num(player.get("xg_por_90")),
        "valor_mercado": num(player.get("valor_mercado")),
        "valor_llegada": num(player.get("valor_mercado")),
        "club_pos_minutos_sub23": num(dest.get("minutos_sub23_destino")) if dest is not None else 0.0,
        "club_pos_jugadores_sub23": num(dest.get("jugadores_sub23_destino")) if dest is not None else 0.0,
        "club_pos_pct_minutos": num(dest.get("pct_minutos_sub23_club")) if dest is not None else 0.0,
        "club_total_minutos_sub23": num(club_row.get("minutos_sub23")) if club_row is not None else 0.0,
        "club_total_jugadores_sub23": num(club_row.get("jugadores_sub23_utilizados")) if club_row is not None else 0.0,
        "coach_total_minutos_sub23": num(coach_row.get("minutos_sub23")) if coach_row is not None else 0.0,
        "coach_total_jugadores_sub23": num(coach_row.get("jugadores_sub23_utilizados")) if coach_row is not None else 0.0,
        "coach_pos_minutos_sub23": coach_pos_minutes(coach_row, pos),
        "demand_total_altas": num(demand_row.get("demand_total_altas")) if demand_row is not None else 0.0,
        "demand_cesiones": num(demand_row.get("demand_cesiones")) if demand_row is not None else 0.0,
        "demand_traspasos": num(demand_row.get("demand_traspasos")) if demand_row is not None else 0.0,
        "demand_sub23": num(demand_row.get("demand_sub23")) if demand_row is not None else 0.0,
        "demand_recent": num(demand_row.get("demand_recent")) if demand_row is not None else 0.0,
        "demand_score": num(demand_row.get("demand_score")) if demand_row is not None else 0.0,
        "posicion_normalizada": pos,
        "tipo_suceso": tipo_operacion,
        "tipo_operacion": tipo_operacion,
        "origen_desarrollo": "Betis Deportivo",
        "club": club,
        "entrenador": entrenador,
        "pre_club": player.get("equipo", "Real Betis B"),
    }


def predict_success_v2(model, row: dict) -> float:
    X = pd.DataFrame([row])
    return float(predict_success_v2_batch(model, X)[0])


def predict_success_v2_batch(model, rows: list[dict] | pd.DataFrame) -> np.ndarray:
    X = pd.DataFrame(rows)
    for col in V2_NUMERIC_FEATURES:
        if col not in X.columns:
            X[col] = 0.0
    for col in V2_CATEGORICAL_FEATURES:
        if col not in X.columns:
            X[col] = ""
    return model.predict(X[V2_NUMERIC_FEATURES + V2_CATEGORICAL_FEATURES])


def current_development_score(player: pd.Series) -> float:
    minutes = num(player.get("minutos_jugados"))
    goals90 = num(player.get("goles_por_90"))
    xg90 = num(player.get("xg_por_90"))
    age = num(player.get("edad"), 21)
    age_fit = 1.0 if age <= 20 else 0.75 if age <= 22 else 0.45
    score = (
        45 * minmax(minutes, 0, 2600)
        + 25 * (0.6 * minmax(goals90, 0, 0.55) + 0.4 * minmax(xg90, 0, 0.55))
        + 20 * age_fit
        + 10 * minmax(num(player.get("partidos_jugados")), 0, 30)
    )
    return round(score, 1)


def similar_cases(cases: pd.DataFrame, player: pd.Series, top_n: int = 3) -> list[dict]:
    """Casos históricos similares: misma posición, edad parecida, mejores scores."""
    pos = player.get("posicion_normalizada", "")
    edad = num(player.get("edad"), 21)
    pool = cases[cases["posicion"] == pos].copy()
    if pool.empty:
        pool = cases.copy()
    pool["dist_edad"] = (pd.to_numeric(pool["edad"], errors="coerce") - edad).abs()
    # priorizar similar edad y alto score
    pool = pool.sort_values(["dist_edad", "operation_success_score"], ascending=[True, False])
    out = []
    for _, r in pool.head(top_n).iterrows():
        out.append({
            "jugador": r["jugador"], "club": r["club"], "temporada": r["temporada"],
            "tipo": r.get("tipo_operacion", ""), "score": round(num(r["operation_success_score"]), 1),
            "revalorizacion": fmt_money(num(r.get("revalorizacion_absoluta"))),
        })
    return out


def best_destinations(loan: pd.DataFrame, demand: pd.DataFrame, coach: pd.DataFrame,
                      club_ev: pd.DataFrame, player: pd.Series, top_n: int = 5,
                      model_v2=None) -> tuple[list[dict], list[str]]:
    """
    Ranking de clubes combinando: desarrollo (score_evidencia) + demanda (demand_score)
    + uso de jóvenes del entrenador. Devuelve (clubes, entrenadores_ideales).
    """
    jugador = player.get("jugador", "")
    posicion = player.get("posicion_normalizada", "")
    dl = loan[loan["jugador"] == jugador].copy()
    if dl.empty:
        return [], []

    # Demanda por club+posición
    dem_lookup = {}
    for _, d in demand.iterrows():
        dem_lookup[(d["club"], d["posicion"])] = num(d.get("demand_score"))

    # Uso de jóvenes por entrenador (normalizado)
    coach_minutos = {}
    if not coach.empty:
        mx = pd.to_numeric(coach["minutos_sub23"], errors="coerce").max() or 1
        for _, c in coach.iterrows():
            coach_minutos[c["entrenador"]] = num(c.get("minutos_sub23")) / mx * 100

    # Normalizar score_evidencia
    sev = pd.to_numeric(dl["score_evidencia"], errors="coerce")
    sev_max = sev.max() or 1

    rows = []
    scenario_cesion_rows = []
    scenario_traspaso_rows = []
    for _, dest in dl.iterrows():
        club = dest["club_destino"]
        pos_dest = dest.get("posicion_destino", posicion)
        ent = dest.get("entrenador_principal", "")
        desarrollo = num(dest.get("score_evidencia")) / sev_max * 100
        demand_row = lookup_row(demand, club=club, posicion=pos_dest)
        if demand_row is None:
            demand_row = lookup_row(demand, club=club, posicion=posicion)
        club_row = lookup_row(club_ev, club=club)
        coach_row = lookup_row(coach, entrenador=ent)
        demanda = num(demand_row.get("demand_score")) if demand_row is not None else dem_lookup.get((club, pos_dest), dem_lookup.get((club, posicion), 0.0))
        uso_coach = coach_minutos.get(ent, 0.0)
        tactical_score, tactical_reason = tactical_fit(player, club, club_row, demanda, pos_dest)
        rows.append({
            "club": club, "entrenador": ent, "posicion": pos_dest,
            "score_combinado": np.nan,
            "score_v2_cesion": np.nan,
            "score_v2_traspaso": np.nan,
            "desarrollo": round(desarrollo, 1), "demanda": round(demanda, 1),
            "uso_jovenes_coach": round(uso_coach, 1),
            "encaje_tactico": tactical_score,
            "explicacion_tactica": tactical_reason,
            "revalorizacion_media": fmt_money(num(dest.get("revalorizacion_media_destino"))),
        })
        if model_v2 is not None:
            scenario_cesion_rows.append(scenario_row_v2(player, "cesion", club, ent, dest, demand_row, club_row, coach_row))
            scenario_traspaso_rows.append(scenario_row_v2(player, "traspaso", club, ent, dest, demand_row, club_row, coach_row))

    if model_v2 is not None and rows:
        cesion_scores = predict_success_v2_batch(model_v2, scenario_cesion_rows)
        traspaso_scores = predict_success_v2_batch(model_v2, scenario_traspaso_rows)
        for row, v2_cesion, v2_traspaso in zip(rows, cesion_scores, traspaso_scores):
            row["score_v2_cesion"] = round(float(v2_cesion), 1)
            row["score_v2_traspaso"] = round(float(v2_traspaso), 1)
            row["score_combinado"] = round(
                0.40 * float(v2_cesion)
                + 0.22 * row["desarrollo"]
                + 0.18 * row["demanda"]
                + 0.10 * row["uso_jovenes_coach"]
                + 0.10 * row["encaje_tactico"],
                1,
            )
    else:
        for row in rows:
            row["score_combinado"] = round(
                0.45 * row["desarrollo"]
                + 0.25 * row["demanda"]
                + 0.15 * row["uso_jovenes_coach"]
                + 0.15 * row["encaje_tactico"],
                1,
            )
    rows.sort(key=lambda r: r["score_combinado"], reverse=True)
    top = rows[:top_n]
    entrenadores = list(dict.fromkeys(
        [str(r["entrenador"]) for r in top if r["entrenador"] and pd.notna(r["entrenador"]) and str(r["entrenador"]).strip()]
    ))[:5]
    return top, entrenadores


def decide_operation(player: pd.Series, model, loan: pd.DataFrame, dests: list[dict]) -> tuple[str, float, dict]:
    """
    Decide la operación recomendada comparando el success score esperado
    en CESIÓN (a su mejor destino) vs PERMANENCIA (seguir en el Betis B).
    """
    pos = player.get("posicion_normalizada", "")
    jugador = player.get("jugador", "")

    best_dest = dests[0] if dests else {}
    club_ces = best_dest.get("club", "")
    ent_ces = best_dest.get("entrenador", "")

    score_cesion_raw = num(best_dest.get("score_v2_cesion"), np.nan)
    if pd.isna(score_cesion_raw):
        score_cesion_raw = predict_success(model, player, "cesion", club_ces, ent_ces)
    score_permanencia = predict_success(model, player, "otro", "Real Betis B", "")
    score_mantener_actual = current_development_score(player)
    score_mantener_raw = 0.55 * score_mantener_actual + 0.45 * score_permanencia
    score_traspaso_raw = num(best_dest.get("score_v2_traspaso"), np.nan)
    if pd.isna(score_traspaso_raw):
        score_traspaso_raw = predict_success(model, player, "traspaso", club_ces, ent_ces)

    edad = num(player.get("edad"), 21)
    minutos = num(player.get("minutos_jugados"))
    competitive_loan_available = bool(dests) and num(best_dest.get("desarrollo")) >= 45 and num(best_dest.get("demanda")) >= 35
    relegation_penalty = STAY_RELEGATION_PENALTY if BETIS_DEPORTIVO_DESCENDED else 0.0
    loan_level_bonus = LOAN_HIGHER_LEVEL_BONUS if BETIS_DEPORTIVO_DESCENDED and competitive_loan_available else 0.0
    young_sale_penalty = YOUNG_SALE_PENALTY if edad <= 21 else 0.0

    score_cesion = min(score_cesion_raw + loan_level_bonus, 100.0)
    score_mantener = max(score_mantener_raw - relegation_penalty, 0.0)
    score_traspaso = max(score_traspaso_raw - young_sale_penalty, 0.0)

    # Lógica de decisión explicable
    if edad <= 20 and minutos < 1000 and score_cesion >= 30:
        op = "CEDER"
        prob = score_cesion
    elif edad <= 21 and score_cesion >= max(score_traspaso, score_mantener - 8):
        op = "CEDER"
        prob = score_cesion
    elif edad <= 22 and BETIS_DEPORTIVO_DESCENDED and competitive_loan_available and score_cesion >= score_mantener - 6:
        op = "CEDER"
        prob = score_cesion
    elif edad >= 22 and score_traspaso >= score_cesion + 6 and score_traspaso >= score_mantener + 4:
        op = "VENDER"
        prob = score_traspaso
    elif score_mantener >= max(score_cesion, score_traspaso):
        op = "MANTENER"
        prob = score_mantener
    else:
        op = "CEDER"
        prob = score_cesion

    audit = {
        "score_v2_cesion": round(float(score_cesion_raw), 1),
        "score_cesion_ajustado": round(float(score_cesion), 1),
        "score_mantener": round(float(score_mantener), 1),
        "score_mantener_raw": round(float(score_mantener_raw), 1),
        "score_mantener_actual": round(float(score_mantener_actual), 1),
        "score_traspaso": round(float(score_traspaso_raw), 1),
        "score_traspaso_ajustado": round(float(score_traspaso), 1),
        "club_modelo": club_ces,
        "entrenador_modelo": ent_ces,
        "contexto_descenso_filial": BETIS_DEPORTIVO_DESCENDED,
        "penalizacion_mantener_descenso": round(float(relegation_penalty), 1),
        "bonus_cesion_categoria_superior": round(float(loan_level_bonus), 1),
        "penalizacion_venta_joven": round(float(young_sale_penalty), 1),
    }
    return op, round(prob, 1), audit


def build(top_n_dest: int = 5, top_n_sim: int = 3) -> pd.DataFrame:
    import joblib

    for p in [PLAYERS_PATH, LOAN_PATH, DEMAND_PATH, CASES_PATH, MODEL_PATH]:
        if not p.exists():
            raise FileNotFoundError(f"Falta {p}")

    players = pd.read_csv(PLAYERS_PATH)
    loan = pd.read_csv(LOAN_PATH)
    demand = pd.read_csv(DEMAND_PATH)
    coach = pd.read_csv(COACH_PATH) if COACH_PATH.exists() else pd.DataFrame()
    club_ev = pd.read_csv(CLUB_EVIDENCE_PATH) if CLUB_EVIDENCE_PATH.exists() else pd.DataFrame()
    cases = pd.read_csv(CASES_PATH)
    model = joblib.load(MODEL_PATH)
    model_v2 = joblib.load(MODEL_V2_PATH) if MODEL_V2_PATH.exists() else None
    if model_v2 is not None:
        logger.info("Modelo v2 de operaciones cargado: %s", MODEL_V2_PATH.name)
    else:
        logger.warning("No existe %s; usando fallback anterior", MODEL_V2_PATH.name)
    recs = pd.read_csv(PLAYER_RECS_PATH) if PLAYER_RECS_PATH.exists() else pd.DataFrame()
    rec_lookup = recs.set_index("jugador").to_dict("index") if not recs.empty else {}

    logger.info(f"Jugadores Betis Deportivo: {len(players)}")

    out_rows = []
    out_dest_rows = []
    for _, player in players.iterrows():
        jugador = player["jugador"]
        pos = player.get("posicion_normalizada", "")
        dests, entrenadores = best_destinations(loan, demand, coach, club_ev, player, top_n_dest, model_v2=model_v2)
        op, prob, audit = decide_operation(player, model, loan, dests)
        sims = similar_cases(cases, player, top_n_sim)

        rec = rec_lookup.get(jugador, {})
        rev_esperada = rec.get("revalorizacion_esperada_media_top5", np.nan)

        clubes_str = " | ".join(f"{d['club']} ({d['score_combinado']:.0f})" for d in dests)
        entrenadores_str = " | ".join(entrenadores)
        sims_str = " | ".join(f"{s['jugador']} ({s['club']}, {s['score']:.0f})" for s in sims)
        tactical_str = " | ".join(d.get("explicacion_tactica", "") for d in dests[:3] if d.get("explicacion_tactica"))

        justificacion = build_justification(player, op, prob, dests, sims, rev_esperada, audit)

        for rank, dest in enumerate(dests, start=1):
            out_dest_rows.append({
                "jugador": jugador,
                "ranking_destino_v2": rank,
                "club": dest["club"],
                "entrenador": dest["entrenador"],
                "posicion": dest["posicion"],
                "score_destino_v2": dest["score_combinado"],
                "score_v2_cesion": dest["score_v2_cesion"],
                "score_v2_traspaso": dest["score_v2_traspaso"],
                "desarrollo": dest["desarrollo"],
                "demanda": dest["demanda"],
                "uso_jovenes_coach": dest["uso_jovenes_coach"],
                "encaje_tactico": dest["encaje_tactico"],
                "explicacion_tactica": dest["explicacion_tactica"],
                "revalorizacion_media": dest["revalorizacion_media"],
            })

        out_rows.append({
            "jugador": jugador,
            "posicion": pos,
            "edad": int(num(player.get("edad"), 0)),
            "es_sub23": player.get("es_sub23"),
            "minutos_actuales": int(num(player.get("minutos_jugados"))),
            "goles_actuales": int(num(player.get("goles"))),
            "operacion_recomendada": op,
            "probabilidad_exito": prob,
            "modelo_decision": "operation_success_v2" if model_v2 is not None else "operation_success_v1",
            "score_v2_cesion": audit["score_v2_cesion"],
            "score_cesion_ajustado": audit["score_cesion_ajustado"],
            "score_mantener": audit["score_mantener"],
            "score_mantener_raw": audit["score_mantener_raw"],
            "score_traspaso": audit["score_traspaso"],
            "score_traspaso_ajustado": audit["score_traspaso_ajustado"],
            "contexto_descenso_filial": audit["contexto_descenso_filial"],
            "penalizacion_mantener_descenso": audit["penalizacion_mantener_descenso"],
            "bonus_cesion_categoria_superior": audit["bonus_cesion_categoria_superior"],
            "club_modelo": audit["club_modelo"],
            "entrenador_modelo": audit["entrenador_modelo"],
            "revalorizacion_esperada": fmt_money(num(rev_esperada)) if pd.notna(rev_esperada) else "-",
            "clubes_ideales": clubes_str,
            "entrenadores_ideales": entrenadores_str,
            "explicaciones_tacticas": tactical_str,
            "casos_similares": sims_str,
            "justificacion": justificacion,
        })

    df = pd.DataFrame(out_rows).sort_values("probabilidad_exito", ascending=False)
    dest_df = pd.DataFrame(out_dest_rows)
    df.to_csv(OUT_PATH, index=False, encoding="utf-8-sig")
    dest_df.to_csv(OUT_V2_DEST_PATH, index=False, encoding="utf-8-sig")
    # JSON estructurado para ScoutGPT
    OUT_JSON.write_text(json.dumps(df.to_dict("records"), ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"✓ {OUT_PATH.name} ({len(df)} jugadores)")
    logger.info(f"✓ {OUT_V2_DEST_PATH.name} ({len(dest_df)} destinos)")
    logger.info(f"✓ {OUT_JSON.name}")
    return df


def build_justification(player, op, prob, dests, sims, rev_esperada, audit=None) -> str:
    audit = audit or {}
    edad = int(num(player.get("edad"), 0))
    minutos = int(num(player.get("minutos_jugados")))
    pos = player.get("posicion_normalizada", "")
    parts = [f"{player['jugador']} ({pos}, {edad} años, {minutos}' esta temporada)."]

    if op == "CEDER":
        parts.append(f"Recomendación CEDER: probabilidad de éxito estimada {prob:.0f}/100.")
        if minutos < 900:
            parts.append("Pocos minutos en el filial: necesita competir para desarrollarse.")
    elif op == "VENDER":
        parts.append(f"Recomendación VENDER: mejor retorno esperado vía traspaso ({prob:.0f}/100).")
    elif op == "MANTENER":
        parts.append(f"Recomendación MANTENER: rinde en el filial, score {prob:.0f}/100.")

    if dests:
        d = dests[0]
        if pd.notna(d.get("score_v2_cesion", np.nan)):
            parts.append(f"Mejor destino: {d['club']} (score v2 cesión {d['score_v2_cesion']:.0f}, desarrollo {d['desarrollo']:.0f}, demanda {d['demanda']:.0f}).")
        else:
            parts.append(f"Mejor destino: {d['club']} (desarrollo {d['desarrollo']:.0f}, demanda {d['demanda']:.0f}, uso jóvenes coach {d['uso_jovenes_coach']:.0f}).")
        if d.get("explicacion_tactica"):
            parts.append(f"Lectura táctica: {d['explicacion_tactica']}")
    if audit:
        if audit.get("contexto_descenso_filial"):
            parts.append(
                "Contexto clave: el Betis Deportivo ha descendido, por lo que mantener en el filial "
                f"se penaliza (-{audit.get('penalizacion_mantener_descenso', 0):.0f}) y una cesión a categoría superior "
                f"con destino competitivo recibe bonus (+{audit.get('bonus_cesion_categoria_superior', 0):.0f})."
            )
        parts.append(
            f"Comparativa interna ajustada: cesión {audit.get('score_cesion_ajustado', 0):.0f}, "
            f"mantener {audit.get('score_mantener', 0):.0f}, venta {audit.get('score_traspaso_ajustado', 0):.0f}."
        )
    if sims:
        parts.append(f"Casos similares: {', '.join(s['jugador'] for s in sims)}.")
    if pd.notna(rev_esperada) and num(rev_esperada) != 0:
        parts.append(f"Revalorización esperada (modelo): {fmt_money(num(rev_esperada))}.")
    return " ".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=int, default=5)
    ap.add_argument("--sim", type=int, default=3)
    args = ap.parse_args()
    df = build(args.dest, args.sim)
    # Mostrar ejemplo Pablo García si existe
    ej = df[df["jugador"].str.contains("Pablo Garcia", case=False, na=False)]
    if not ej.empty:
        logger.info("\n  EJEMPLO — " + ej.iloc[0]["jugador"])
        for k in ["operacion_recomendada", "probabilidad_exito", "clubes_ideales", "casos_similares"]:
            logger.info(f"    {k}: {ej.iloc[0][k]}")


if __name__ == "__main__":
    main()
