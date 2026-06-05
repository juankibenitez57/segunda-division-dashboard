#!/usr/bin/env python3
"""
Sistema de apoyo a decisiones para jugadores del Betis Deportivo.

Combina TODA la evidencia en una recomendación explicable por jugador:
  · operation_success_score (modelo RF entrenado)  → probabilidad de éxito
  · betis_loan_destination_model                    → clubes que desarrollan
  · development_coach_evidence                       → entrenadores que usan jóvenes
  · club_position_demand                             → clubes que NECESITAN la posición
  · historical_success_cases                         → casos similares reales

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
PLAYER_RECS_PATH = DATA_FINAL / "betis_rf_player_recommendations.csv"

OUT_PATH = DATA_FINAL / "betis_decision_recommendations.csv"
OUT_JSON = DATA_FINAL / "betis_decision_recommendations.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("betis_decisions")

NUMERIC_FEATURES = ["edad", "valor_mercado", "minutos", "goles", "xg", "goles_por_90", "xg_por_90"]
CATEGORICAL_FEATURES = ["posicion_normalizada", "club", "entrenador", "tipo_operacion"]


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
                      jugador: str, posicion: str, top_n: int = 5) -> tuple[list[dict], list[str]]:
    """
    Ranking de clubes combinando: desarrollo (score_evidencia) + demanda (demand_score)
    + uso de jóvenes del entrenador. Devuelve (clubes, entrenadores_ideales).
    """
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
    for _, dest in dl.iterrows():
        club = dest["club_destino"]
        pos_dest = dest.get("posicion_destino", posicion)
        ent = dest.get("entrenador_principal", "")
        desarrollo = num(dest.get("score_evidencia")) / sev_max * 100
        demanda = dem_lookup.get((club, pos_dest), dem_lookup.get((club, posicion), 0.0))
        uso_coach = coach_minutos.get(ent, 0.0)
        # Combinación: 50% desarrollo + 30% demanda + 20% uso de jóvenes del coach
        combinado = 0.50 * desarrollo + 0.30 * demanda + 0.20 * uso_coach
        rows.append({
            "club": club, "entrenador": ent, "posicion": pos_dest,
            "score_combinado": round(combinado, 1),
            "desarrollo": round(desarrollo, 1), "demanda": round(demanda, 1),
            "uso_jovenes_coach": round(uso_coach, 1),
            "revalorizacion_media": fmt_money(num(dest.get("revalorizacion_media_destino"))),
        })
    rows.sort(key=lambda r: r["score_combinado"], reverse=True)
    top = rows[:top_n]
    entrenadores = list(dict.fromkeys(
        [str(r["entrenador"]) for r in top if r["entrenador"] and pd.notna(r["entrenador"]) and str(r["entrenador"]).strip()]
    ))[:5]
    return top, entrenadores


def decide_operation(player: pd.Series, model, loan: pd.DataFrame) -> tuple[str, float]:
    """
    Decide la operación recomendada comparando el success score esperado
    en CESIÓN (a su mejor destino) vs PERMANENCIA (seguir en el Betis B).
    """
    pos = player.get("posicion_normalizada", "")
    jugador = player.get("jugador", "")

    # Escenario cesión: usar el mejor destino histórico del jugador
    dl = loan[loan["jugador"] == jugador]
    if not dl.empty:
        best = dl.sort_values("score_evidencia", ascending=False).iloc[0]
        club_ces, ent_ces = best["club_destino"], best.get("entrenador_principal", "")
    else:
        club_ces, ent_ces = "", ""

    score_cesion = predict_success(model, player, "cesion", club_ces, ent_ces)
    score_permanencia = predict_success(model, player, "otro", "Real Betis B", "")
    score_traspaso = predict_success(model, player, "traspaso", club_ces, ent_ces)

    edad = num(player.get("edad"), 21)
    minutos = num(player.get("minutos_jugados"))

    # Lógica de decisión explicable
    if edad <= 21 and minutos < 900:
        # joven con pocos minutos → ceder para que juegue
        op = "CEDER"
        prob = score_cesion
    elif edad >= 23 and score_traspaso >= score_cesion and score_traspaso > 45:
        op = "VENDER"
        prob = score_traspaso
    elif score_permanencia >= max(score_cesion, score_traspaso):
        op = "MANTENER"
        prob = score_permanencia
    else:
        op = "CEDER"
        prob = score_cesion

    return op, round(prob, 1)


def build(top_n_dest: int = 5, top_n_sim: int = 3) -> pd.DataFrame:
    import joblib

    for p in [PLAYERS_PATH, LOAN_PATH, DEMAND_PATH, CASES_PATH, MODEL_PATH]:
        if not p.exists():
            raise FileNotFoundError(f"Falta {p}")

    players = pd.read_csv(PLAYERS_PATH)
    loan = pd.read_csv(LOAN_PATH)
    demand = pd.read_csv(DEMAND_PATH)
    coach = pd.read_csv(COACH_PATH) if COACH_PATH.exists() else pd.DataFrame()
    cases = pd.read_csv(CASES_PATH)
    model = joblib.load(MODEL_PATH)
    recs = pd.read_csv(PLAYER_RECS_PATH) if PLAYER_RECS_PATH.exists() else pd.DataFrame()
    rec_lookup = recs.set_index("jugador").to_dict("index") if not recs.empty else {}

    logger.info(f"Jugadores Betis Deportivo: {len(players)}")

    out_rows = []
    for _, player in players.iterrows():
        jugador = player["jugador"]
        pos = player.get("posicion_normalizada", "")
        op, prob = decide_operation(player, model, loan)
        dests, entrenadores = best_destinations(loan, demand, coach, jugador, pos, top_n_dest)
        sims = similar_cases(cases, player, top_n_sim)

        rec = rec_lookup.get(jugador, {})
        rev_esperada = rec.get("revalorizacion_esperada_media_top5", np.nan)

        clubes_str = " | ".join(f"{d['club']} ({d['score_combinado']:.0f})" for d in dests)
        entrenadores_str = " | ".join(entrenadores)
        sims_str = " | ".join(f"{s['jugador']} ({s['club']}, {s['score']:.0f})" for s in sims)

        justificacion = build_justification(player, op, prob, dests, sims, rev_esperada)

        out_rows.append({
            "jugador": jugador,
            "posicion": pos,
            "edad": int(num(player.get("edad"), 0)),
            "es_sub23": player.get("es_sub23"),
            "minutos_actuales": int(num(player.get("minutos_jugados"))),
            "goles_actuales": int(num(player.get("goles"))),
            "operacion_recomendada": op,
            "probabilidad_exito": prob,
            "revalorizacion_esperada": fmt_money(num(rev_esperada)) if pd.notna(rev_esperada) else "-",
            "clubes_ideales": clubes_str,
            "entrenadores_ideales": entrenadores_str,
            "casos_similares": sims_str,
            "justificacion": justificacion,
        })

    df = pd.DataFrame(out_rows).sort_values("probabilidad_exito", ascending=False)
    df.to_csv(OUT_PATH, index=False, encoding="utf-8-sig")
    # JSON estructurado para ScoutGPT
    OUT_JSON.write_text(json.dumps(df.to_dict("records"), ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"✓ {OUT_PATH.name} ({len(df)} jugadores)")
    logger.info(f"✓ {OUT_JSON.name}")
    return df


def build_justification(player, op, prob, dests, sims, rev_esperada) -> str:
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
        parts.append(f"Mejor destino: {d['club']} (desarrollo {d['desarrollo']:.0f}, demanda {d['demanda']:.0f}, uso jóvenes coach {d['uso_jovenes_coach']:.0f}).")
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
