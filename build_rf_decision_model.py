#!/usr/bin/env python3
"""
Modelo supervisado explicable para decisiones sobre jugadores Betis Deportivo.

Entrena Random Forests sobre sucesos historicos de Segunda Division:
- regresion de revalorizacion esperada
- clasificacion de revalorizacion positiva
- clasificacion de tipo de operacion observada

Despues aplica esos modelos a los jugadores de data/JUGADORES BETIS y a los
destinos historicos ya calculados. No sustituye la decision deportiva: produce
evidencia, sucesos similares y razones auditables para ScoutGPT.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"

MASTER_PATH = DATA_FINAL / "master_player_development.csv"
BETIS_PLAYERS_PATH = DATA_FINAL / "betis_deportivo_players.csv"
LOAN_DEST_PATH = DATA_FINAL / "betis_loan_destination_model.csv"
BETIS_EVIDENCE_PATH = DATA_FINAL / "betis_development_evidence.csv"
CLUB_EVIDENCE_PATH = DATA_FINAL / "development_club_evidence.csv"
COACH_EVIDENCE_PATH = DATA_FINAL / "development_coach_evidence.csv"

OUT_HISTORICAL = DATA_FINAL / "historical_operation_events.csv"
OUT_DEMAND = DATA_FINAL / "club_position_demand.csv"
OUT_DESTINATIONS = DATA_FINAL / "betis_rf_destination_recommendations.csv"
OUT_PLAYERS = DATA_FINAL / "betis_rf_player_recommendations.csv"
OUT_SIMILAR = DATA_FINAL / "betis_similar_historical_events.csv"
OUT_REPORT = DATA_FINAL / "betis_rf_model_report.json"

POSITION_MINUTES_COL = {
    "Delantero": "minutos_sub23_delanteros",
    "Extremo": "minutos_sub23_extremos",
    "Mediocentro": "minutos_sub23_mediocentros",
    "Centrocampista": "minutos_sub23_mediocentros",
    "Central": "minutos_sub23_centrales",
    "Lateral": "minutos_sub23_laterales",
    "Portero": "minutos_sub23_porteros",
}
POSITION_MINUTES_COLUMNS = list(dict.fromkeys(POSITION_MINUTES_COL.values()))

NUMERIC_FEATURES = [
    "edad",
    "valor_mercado",
    "partidos",
    "minutos",
    "goles",
    "xg",
    "goles_por_90",
    "xg_por_90",
    "club_pos_jugadores_sub23",
    "club_pos_minutos_sub23",
    "club_pos_goles_sub23",
    "club_pos_xg_sub23",
    "club_pos_pct_minutos",
    "club_total_jugadores_sub23",
    "club_total_minutos_sub23",
    "club_total_goles_sub23",
    "coach_total_jugadores_sub23",
    "coach_total_minutos_sub23",
    "coach_pos_minutos_sub23",
    "demand_total_altas",
    "demand_cesiones",
    "demand_traspasos",
    "demand_sub23",
    "demand_recent",
]

CATEGORICAL_FEATURES = [
    "posicion_normalizada",
    "tipo_operacion",
    "origen_desarrollo",
    "club",
    "entrenador",
]

OP_CLASS_FEATURES = [c for c in NUMERIC_FEATURES + CATEGORICAL_FEATURES if c != "tipo_operacion"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("rf_decision")


def num_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([0.0] * len(df), index=df.index)
    return pd.to_numeric(df[col], errors="coerce")


def num_value(value: Any) -> float:
    try:
        if pd.isna(value):
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def safe_str(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value)


def fmt_money(value: float) -> str:
    if pd.isna(value):
        return "-"
    sign = "-" if value < 0 else ""
    value = abs(float(value))
    if value >= 1_000_000:
        return f"{sign}€{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{sign}€{value / 1_000:.0f}k"
    return f"{sign}€{value:.0f}"


def minmax(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return max(0.0, min((float(value) - low) / (high - low), 1.0))


def canonical_operation(value: Any, es_sub23: bool, minutes: float) -> str:
    raw = safe_str(value).strip().lower()
    if raw in {"cesion", "traspaso", "libre", "retorno_cesion"}:
        return raw
    if es_sub23 and minutes > 0:
        return "sub23_wyscout"
    return raw or "otro"


def make_preprocessor(features: list[str]) -> ColumnTransformer:
    numeric = [c for c in features if c in NUMERIC_FEATURES]
    categorical = [c for c in features if c in CATEGORICAL_FEATURES]
    return ColumnTransformer(
        transformers=[
            ("num", SimpleImputer(strategy="median"), numeric),
            ("cat", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=3)),
            ]), categorical),
        ],
        remainder="drop",
    )


def make_regressor(features: list[str], random_state: int) -> Pipeline:
    return Pipeline([
        ("prep", make_preprocessor(features)),
        ("rf", RandomForestRegressor(
            n_estimators=350,
            random_state=random_state,
            min_samples_leaf=4,
            max_features="sqrt",
            n_jobs=-1,
        )),
    ])


def make_classifier(features: list[str], random_state: int) -> Pipeline:
    return Pipeline([
        ("prep", make_preprocessor(features)),
        ("rf", RandomForestClassifier(
            n_estimators=350,
            random_state=random_state,
            min_samples_leaf=4,
            max_features="sqrt",
            class_weight="balanced_subsample",
            n_jobs=-1,
        )),
    ])


def feature_importances(model: Pipeline, limit: int = 20) -> list[dict[str, Any]]:
    try:
        names = model.named_steps["prep"].get_feature_names_out()
        importances = model.named_steps["rf"].feature_importances_
    except Exception:
        return []
    pairs = sorted(zip(names, importances), key=lambda x: x[1], reverse=True)[:limit]
    return [{"feature": str(k), "importance": round(float(v), 5)} for k, v in pairs]


def load_inputs() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    required = [MASTER_PATH, BETIS_PLAYERS_PATH, LOAN_DEST_PATH, BETIS_EVIDENCE_PATH, CLUB_EVIDENCE_PATH, COACH_EVIDENCE_PATH]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise FileNotFoundError("Faltan entradas: " + ", ".join(missing))

    master = pd.read_csv(MASTER_PATH, low_memory=False)
    players = pd.read_csv(BETIS_PLAYERS_PATH, low_memory=False)
    loan_dest = pd.read_csv(LOAN_DEST_PATH, low_memory=False)
    club_pos = pd.read_csv(BETIS_EVIDENCE_PATH, low_memory=False)
    club_ev = pd.read_csv(CLUB_EVIDENCE_PATH, low_memory=False)
    coach_ev = pd.read_csv(COACH_EVIDENCE_PATH, low_memory=False)
    return master, players, loan_dest, club_pos, club_ev, coach_ev


def build_demand(master: pd.DataFrame) -> pd.DataFrame:
    df = master.copy()
    for col in ["edad", "minutos"]:
        df[col] = num_series(df, col)
    df["tipo_operacion_norm"] = df.apply(
        lambda r: canonical_operation(r.get("tipo_operacion"), str(r.get("es_sub23")).lower() == "true", num_value(r.get("minutos"))),
        axis=1,
    )
    df = df[df["club"].notna() & df["posicion_normalizada"].notna()].copy()
    df = df[~df["tipo_operacion_norm"].isin(["plantilla_wyscout", "retorno_cesion"])]
    df["is_recent"] = df["temporada"].astype(str).isin(["2024-25", "2025-26"])
    df["is_sub23"] = df["edad"].between(1, 23, inclusive="both")

    rows = []
    for (club, pos), g in df.groupby(["club", "posicion_normalizada"], dropna=True):
        rows.append({
            "club": club,
            "posicion": pos,
            "demand_total_altas": int(len(g)),
            "demand_cesiones": int((g["tipo_operacion_norm"] == "cesion").sum()),
            "demand_traspasos": int((g["tipo_operacion_norm"] == "traspaso").sum()),
            "demand_libres": int((g["tipo_operacion_norm"] == "libre").sum()),
            "demand_sub23": int(g["is_sub23"].sum()),
            "demand_recent": int(g["is_recent"].sum()),
            "demand_minutos_sub23": float(g.loc[g["is_sub23"], "minutos"].sum()),
            "temporadas_con_demanda": int(g["temporada"].nunique()),
            "ultima_temporada_demanda": sorted(g["temporada"].dropna().astype(str).unique())[-1] if len(g) else "",
        })

    out = pd.DataFrame(rows)
    if out.empty:
        return out

    out["demand_score"] = (
        30 * out["demand_total_altas"].rank(pct=True)
        + 25 * out["demand_recent"].rank(pct=True)
        + 20 * out["demand_cesiones"].rank(pct=True)
        + 15 * out["demand_sub23"].rank(pct=True)
        + 10 * out["demand_minutos_sub23"].rank(pct=True)
    ).round(2)
    return out.sort_values(["demand_score", "demand_recent", "demand_total_altas"], ascending=False)


def merge_context(df: pd.DataFrame, club_pos: pd.DataFrame, club_ev: pd.DataFrame, coach_ev: pd.DataFrame, demand: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    club_pos_cols = {
        "jugadores_sub23": "club_pos_jugadores_sub23",
        "minutos_sub23": "club_pos_minutos_sub23",
        "goles_sub23": "club_pos_goles_sub23",
        "xg_sub23": "club_pos_xg_sub23",
        "pct_minutos_sub23_club": "club_pos_pct_minutos",
    }
    cp = club_pos.rename(columns={"posicion": "posicion_normalizada", **club_pos_cols})
    out = out.merge(
        cp[["club", "posicion_normalizada", *club_pos_cols.values()]],
        on=["club", "posicion_normalizada"],
        how="left",
    )

    ce = club_ev.rename(columns={
        "jugadores_sub23_utilizados": "club_total_jugadores_sub23",
        "minutos_sub23": "club_total_minutos_sub23",
        "goles_sub23": "club_total_goles_sub23",
    })
    out = out.merge(
        ce[["club", "club_total_jugadores_sub23", "club_total_minutos_sub23", "club_total_goles_sub23"]],
        on="club",
        how="left",
    )

    coach = coach_ev.rename(columns={
        "jugadores_sub23_utilizados": "coach_total_jugadores_sub23",
        "minutos_sub23": "coach_total_minutos_sub23",
    })
    out = out.merge(
        coach[["entrenador", "coach_total_jugadores_sub23", "coach_total_minutos_sub23", *POSITION_MINUTES_COLUMNS]],
        on="entrenador",
        how="left",
    )
    out["coach_pos_minutos_sub23"] = out.apply(
        lambda r: num_value(r.get(POSITION_MINUTES_COL.get(r.get("posicion_normalizada"), ""))),
        axis=1,
    )

    dem = demand.rename(columns={"posicion": "posicion_normalizada"})
    out = out.merge(
        dem[["club", "posicion_normalizada", "demand_total_altas", "demand_cesiones", "demand_traspasos", "demand_sub23", "demand_recent", "demand_score"]],
        on=["club", "posicion_normalizada"],
        how="left",
    )

    for col in NUMERIC_FEATURES + ["demand_score"]:
        if col not in out.columns:
            out[col] = 0
        out[col] = num_series(out, col).fillna(0)
    for col in CATEGORICAL_FEATURES:
        if col not in out.columns:
            out[col] = ""
        out[col] = out[col].fillna("").astype(str)
    return out


def build_historical_events(master: pd.DataFrame, club_pos: pd.DataFrame, club_ev: pd.DataFrame, coach_ev: pd.DataFrame, demand: pd.DataFrame) -> pd.DataFrame:
    df = master.copy()
    for col in ["edad", "valor_mercado", "partidos", "minutos", "goles", "xg", "goles_por_90", "xg_por_90", "revalorizacion_absoluta", "revalorizacion_porcentual"]:
        df[col] = num_series(df, col)
    df["posicion_normalizada"] = df["posicion_normalizada"].fillna(df.get("posicion_es", "")).fillna("")
    df["es_sub23_bool"] = df["es_sub23"].astype(str).str.lower().eq("true")
    df["tipo_suceso"] = df.apply(lambda r: canonical_operation(r.get("tipo_operacion"), bool(r["es_sub23_bool"]), num_value(r.get("minutos"))), axis=1)
    df["tipo_operacion"] = df["tipo_suceso"].replace({"sub23_wyscout": "otro"}).fillna("otro")
    df["revalorizacion_positiva"] = (df["revalorizacion_absoluta"] > 0).astype(int)
    df["valor_mercado"] = df["valor_mercado"].fillna(df.get("valor_mercado_wyscout", 0)).fillna(df.get("valor_llegada", 0))
    df["origen_desarrollo"] = df["origen_desarrollo"].fillna("")

    keep = df[
        df["club"].notna()
        & df["posicion_normalizada"].notna()
        & df["tipo_suceso"].isin(["cesion", "traspaso", "libre", "otro", "sub23_wyscout"])
    ].copy()
    keep = merge_context(keep, club_pos, club_ev, coach_ev, demand)

    cols = [
        "nombre", "temporada", "club", "entrenador", "edad", "posicion_normalizada",
        "tipo_suceso", "tipo_operacion", "origen_desarrollo", "partidos", "minutos",
        "goles", "xg", "goles_por_90", "xg_por_90", "valor_mercado",
        "valor_llegada", "valor_salida", "revalorizacion_absoluta",
        "revalorizacion_porcentual", "revalorizacion_positiva", "tiene_wyscout",
        "club_pos_jugadores_sub23", "club_pos_minutos_sub23", "club_pos_goles_sub23",
        "club_pos_xg_sub23", "club_pos_pct_minutos", "club_total_jugadores_sub23",
        "club_total_minutos_sub23", "club_total_goles_sub23", "coach_total_jugadores_sub23",
        "coach_total_minutos_sub23", "coach_pos_minutos_sub23", "demand_total_altas",
        "demand_cesiones", "demand_traspasos", "demand_sub23", "demand_recent",
        "demand_score",
    ]
    return keep[[c for c in cols if c in keep.columns]].copy()


def train_models(events: pd.DataFrame, random_state: int) -> tuple[dict[str, Pipeline], dict[str, Any]]:
    report: dict[str, Any] = {}
    models: dict[str, Pipeline] = {}

    rev = events[events["revalorizacion_absoluta"].notna()].copy()
    rev = rev[rev["tipo_suceso"].isin(["cesion", "traspaso", "libre", "otro"])]
    rev = rev[rev["edad"] > 0]
    if len(rev) >= 80:
        X = rev[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
        y = rev["revalorizacion_absoluta"]
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=random_state)
        reg = make_regressor(NUMERIC_FEATURES + CATEGORICAL_FEATURES, random_state)
        reg.fit(X_train, y_train)
        pred = reg.predict(X_test)
        models["revaluation"] = reg
        report["revaluation_model"] = {
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "mae_eur": round(float(mean_absolute_error(y_test, pred)), 2),
            "r2": round(float(r2_score(y_test, pred)), 4),
            "target_mean_eur": round(float(y.mean()), 2),
            "feature_importances": feature_importances(reg),
        }

        clf = make_classifier(NUMERIC_FEATURES + CATEGORICAL_FEATURES, random_state + 1)
        y_bin = (rev["revalorizacion_absoluta"] > 0).astype(int)
        strat = y_bin if y_bin.nunique() > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(X, y_bin, test_size=0.25, random_state=random_state, stratify=strat)
        clf.fit(X_train, y_train)
        pred_bin = clf.predict(X_test)
        proba = clf.predict_proba(X_test)[:, 1] if len(clf.classes_) == 2 else pred_bin
        models["positive_revaluation"] = clf
        report["positive_revaluation_model"] = {
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "accuracy": round(float(accuracy_score(y_test, pred_bin)), 4),
            "roc_auc": round(float(roc_auc_score(y_test, proba)), 4) if y_test.nunique() > 1 else None,
            "positive_rate": round(float(y_bin.mean()), 4),
            "feature_importances": feature_importances(clf),
        }
    else:
        report["revaluation_model"] = {"error": "No hay suficientes filas con revalorizacion etiquetada"}

    op = events[events["tipo_suceso"].isin(["cesion", "traspaso", "libre", "otro"])].copy()
    op = op[op["edad"] > 0]
    class_counts = op["tipo_suceso"].value_counts()
    usable_classes = class_counts[class_counts >= 20].index.tolist()
    op = op[op["tipo_suceso"].isin(usable_classes)]
    if len(op) >= 150 and len(usable_classes) >= 2:
        X = op[OP_CLASS_FEATURES]
        y = op["tipo_suceso"]
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=random_state, stratify=y)
        op_clf = make_classifier(OP_CLASS_FEATURES, random_state + 2)
        op_clf.fit(X_train, y_train)
        pred = op_clf.predict(X_test)
        models["operation_type"] = op_clf
        report["operation_type_model"] = {
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "classes": list(op_clf.classes_),
            "class_counts": {k: int(v) for k, v in class_counts.to_dict().items()},
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "feature_importances": feature_importances(op_clf),
        }
    else:
        report["operation_type_model"] = {"error": "No hay suficientes clases historicas para clasificar tipo de operacion"}

    return models, report


def make_destination_frame(players: pd.DataFrame, loan_dest: pd.DataFrame, club_pos: pd.DataFrame, club_ev: pd.DataFrame, coach_ev: pd.DataFrame, demand: pd.DataFrame) -> pd.DataFrame:
    rows = []
    player_lookup = players.set_index("jugador").to_dict("index")
    for _, dest in loan_dest.iterrows():
        p = player_lookup.get(dest["jugador"], {})
        rows.append({
            "jugador": dest["jugador"],
            "edad": num_value(p.get("edad", dest.get("edad"))),
            "valor_mercado": num_value(p.get("valor_mercado", dest.get("valor_mercado_jugador"))),
            "partidos": num_value(p.get("partidos_jugados", 0)),
            "minutos": num_value(p.get("minutos_jugados", dest.get("minutos_jugador"))),
            "goles": num_value(p.get("goles", dest.get("goles_jugador"))),
            "xg": num_value(p.get("xg", dest.get("xg_jugador"))),
            "goles_por_90": num_value(p.get("goles_por_90", 0)),
            "xg_por_90": num_value(p.get("xg_por_90", 0)),
            "posicion_normalizada": dest["posicion_jugador"],
            "tipo_operacion": "cesion",
            "origen_desarrollo": "Betis Deportivo",
            "club": dest["club_destino"],
            "entrenador": dest.get("entrenador_principal", ""),
            "ranking_destino_base": dest.get("ranking_destino"),
            "score_evidencia_base": dest.get("score_evidencia"),
            "nivel_evidencia": dest.get("nivel_evidencia"),
            "razones_base": dest.get("razones"),
            "minutos_sub23_destino": dest.get("minutos_sub23_destino"),
            "jugadores_sub23_destino": dest.get("jugadores_sub23_destino"),
            "goles_sub23_destino": dest.get("goles_sub23_destino"),
            "xg_sub23_destino": dest.get("xg_sub23_destino"),
            "vencimiento_contrato": p.get("vencimiento_contrato", ""),
            "equipo_actual": p.get("equipo", ""),
        })
    frame = pd.DataFrame(rows)
    return merge_context(frame, club_pos, club_ev, coach_ev, demand)


def predict_destinations(destinations: pd.DataFrame, models: dict[str, Pipeline]) -> pd.DataFrame:
    out = destinations.copy()
    if "revaluation" in models:
        out["rf_revalorizacion_esperada"] = models["revaluation"].predict(out[NUMERIC_FEATURES + CATEGORICAL_FEATURES])
    else:
        out["rf_revalorizacion_esperada"] = 0.0

    if "positive_revaluation" in models and len(models["positive_revaluation"].classes_) == 2:
        classes = list(models["positive_revaluation"].classes_)
        pos_idx = classes.index(1) if 1 in classes else -1
        out["rf_prob_revalorizacion_positiva"] = models["positive_revaluation"].predict_proba(out[NUMERIC_FEATURES + CATEGORICAL_FEATURES])[:, pos_idx]
    else:
        out["rf_prob_revalorizacion_positiva"] = 0.0

    if "operation_type" in models:
        proba = models["operation_type"].predict_proba(out[OP_CLASS_FEATURES])
        classes = list(models["operation_type"].classes_)
        for idx, cls in enumerate(classes):
            out[f"prob_tipo_{cls}"] = proba[:, idx]
        out["tipo_operacion_mas_parecida"] = models["operation_type"].predict(out[OP_CLASS_FEATURES])
    else:
        out["tipo_operacion_mas_parecida"] = ""

    rev_low = float(out["rf_revalorizacion_esperada"].quantile(0.05)) if len(out) else 0
    rev_high = float(out["rf_revalorizacion_esperada"].quantile(0.95)) if len(out) else 1
    out["rf_revalorizacion_score"] = out["rf_revalorizacion_esperada"].apply(lambda v: minmax(v, rev_low, rev_high) * 100)
    out["score_destino_rf"] = (
        35 * (num_series(out, "score_evidencia_base") / 100).clip(0, 1)
        + 25 * (num_series(out, "rf_revalorizacion_score") / 100).clip(0, 1)
        + 20 * (num_series(out, "demand_score") / 100).clip(0, 1)
        + 20 * num_series(out, "rf_prob_revalorizacion_positiva").clip(0, 1)
    ).round(2)
    out = out.sort_values(["jugador", "score_destino_rf", "score_evidencia_base"], ascending=[True, False, False])
    out["ranking_destino_rf"] = out.groupby("jugador").cumcount() + 1
    out["razonamiento_rf"] = out.apply(destination_reason, axis=1)
    return out


def destination_reason(row: pd.Series) -> str:
    parts = [
        f"encaje historico {num_value(row.get('score_evidencia_base')):.1f}/100",
        f"demanda club-posicion {num_value(row.get('demand_score')):.1f}/100",
        f"revalorizacion esperada {fmt_money(num_value(row.get('rf_revalorizacion_esperada')))}",
        f"prob. revalorizacion positiva {num_value(row.get('rf_prob_revalorizacion_positiva')):.0%}",
    ]
    if safe_str(row.get("tipo_operacion_mas_parecida")):
        parts.append(f"se parece a historicos de {row['tipo_operacion_mas_parecida']}")
    if safe_str(row.get("entrenador")):
        parts.append(f"entrenador: {row['entrenador']}")
    return "; ".join(parts)


def similar_events(players: pd.DataFrame, events: pd.DataFrame, top_n: int) -> pd.DataFrame:
    hist = events.copy()
    hist = hist[hist["edad"] > 0].copy()
    hist["valor_mercado"] = num_series(hist, "valor_mercado")
    hist["minutos"] = num_series(hist, "minutos")
    hist["goles"] = num_series(hist, "goles")
    hist["xg"] = num_series(hist, "xg")

    rows = []
    for _, p in players.iterrows():
        pos = safe_str(p.get("posicion_normalizada"))
        pool = hist[hist["posicion_normalizada"] == pos].copy()
        if pool.empty:
            pool = hist.copy()
        p_age = num_value(p.get("edad"))
        p_min = num_value(p.get("minutos_jugados"))
        p_goals = num_value(p.get("goles"))
        p_xg = num_value(p.get("xg"))
        p_value = num_value(p.get("valor_mercado"))

        pool["similaridad_score"] = pool.apply(lambda r: (
            35 * (1 - min(abs(num_value(r.get("edad")) - p_age) / 8, 1))
            + 25 * (1 - min(abs(math.log1p(num_value(r.get("minutos"))) - math.log1p(p_min)) / 5, 1))
            + 15 * (1 - min(abs(num_value(r.get("goles")) - p_goals) / 12, 1))
            + 10 * (1 - min(abs(num_value(r.get("xg")) - p_xg) / 12, 1))
            + 10 * (1 - min(abs(math.log1p(num_value(r.get("valor_mercado"))) - math.log1p(p_value)) / 8, 1))
            + 5 * (1 if safe_str(r.get("tipo_suceso")) == "cesion" else 0)
        ), axis=1)

        for rank, (_, r) in enumerate(pool.sort_values("similaridad_score", ascending=False).head(top_n).iterrows(), start=1):
            rows.append({
                "jugador_betis": p["jugador"],
                "ranking_similar": rank,
                "jugador_historico": r.get("nombre"),
                "temporada": r.get("temporada"),
                "club": r.get("club"),
                "entrenador": r.get("entrenador"),
                "posicion": r.get("posicion_normalizada"),
                "edad": r.get("edad"),
                "tipo_suceso": r.get("tipo_suceso"),
                "minutos": r.get("minutos"),
                "goles": r.get("goles"),
                "xg": r.get("xg"),
                "valor_mercado": r.get("valor_mercado"),
                "revalorizacion": r.get("revalorizacion_absoluta"),
                "similaridad_score": round(float(r.get("similaridad_score")), 2),
            })
    return pd.DataFrame(rows)


def player_recommendations(players: pd.DataFrame, destinations: pd.DataFrame, similar: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, p in players.iterrows():
        d = destinations[destinations["jugador"] == p["jugador"]].sort_values("ranking_destino_rf").head(5)
        s = similar[similar["jugador_betis"] == p["jugador"]].sort_values("ranking_similar").head(5)
        if d.empty:
            rows.append({
                "jugador": p["jugador"],
                "posicion": p.get("posicion_normalizada"),
                "edad": p.get("edad"),
                "operacion_sugerida": "Mantener / evaluar",
                "confianza_modelo": "Baja",
                "razonamiento": "No hay destinos historicos suficientes para su posicion normalizada.",
            })
            continue

        prob_cesion = float(d.get("prob_tipo_cesion", pd.Series([0])).mean()) if "prob_tipo_cesion" in d else 0.0
        prob_traspaso = float(d.get("prob_tipo_traspaso", pd.Series([0])).mean()) if "prob_tipo_traspaso" in d else 0.0
        prob_pos = float(d["rf_prob_revalorizacion_positiva"].mean())
        rev_mean = float(d["rf_revalorizacion_esperada"].mean())
        dest_score = float(d["score_destino_rf"].mean())
        age = num_value(p.get("edad"))
        minutes = num_value(p.get("minutos_jugados"))

        if age <= 21 and dest_score >= 45 and prob_pos >= 0.45:
            op = "Ceder"
        elif age <= 22 and rev_mean > 0 and minutes < 900:
            op = "Renovar y ceder"
        elif prob_traspaso > prob_cesion and rev_mean <= 0:
            op = "Vender con porcentaje"
        elif prob_traspaso > prob_cesion and rev_mean > 0:
            op = "Vender con recompra"
        elif minutes < 300 and age <= 20:
            op = "Mantener"
        else:
            op = "Ceder"

        confianza = "Alta" if dest_score >= 60 and len(d) >= 5 else "Media" if dest_score >= 40 else "Baja"
        top_dest = " | ".join(f"{r.club} ({r.score_destino_rf:.1f})" for r in d.itertuples())
        top_coaches = " | ".join(dict.fromkeys([safe_str(x) for x in d["entrenador"].tolist() if safe_str(x)]).keys())
        sim_text = " | ".join(f"{r.jugador_historico} {r.club} {r.tipo_suceso}" for r in s.itertuples())
        rows.append({
            "jugador": p["jugador"],
            "posicion": p.get("posicion_normalizada"),
            "edad": p.get("edad"),
            "minutos_actuales": p.get("minutos_jugados"),
            "goles_actuales": p.get("goles"),
            "xg_actual": p.get("xg"),
            "operacion_sugerida": op,
            "confianza_modelo": confianza,
            "revalorizacion_esperada_media_top5": round(rev_mean, 2),
            "prob_revalorizacion_positiva_media_top5": round(prob_pos, 4),
            "prob_cesion_historica": round(prob_cesion, 4),
            "prob_traspaso_historico": round(prob_traspaso, 4),
            "score_destino_medio_top5": round(dest_score, 2),
            "clubes_ideales": top_dest,
            "entrenadores_ideales": top_coaches,
            "sucesos_similares": sim_text,
            "razonamiento": (
                f"{op}: top destinos con score medio {dest_score:.1f}; "
                f"revalorizacion esperada media {fmt_money(rev_mean)}; "
                f"probabilidad de revalorizacion positiva {prob_pos:.0%}; "
                f"similitud historica cesion {prob_cesion:.0%}, traspaso {prob_traspaso:.0%}."
            ),
        })
    return pd.DataFrame(rows)


def build_all(top_n_similar: int, random_state: int, validate_only: bool = False) -> dict[str, Any]:
    master, players, loan_dest, club_pos, club_ev, coach_ev = load_inputs()
    demand = build_demand(master)
    events = build_historical_events(master, club_pos, club_ev, coach_ev, demand)
    models, report = train_models(events, random_state=random_state)
    destinations = make_destination_frame(players, loan_dest, club_pos, club_ev, coach_ev, demand)
    destinations = predict_destinations(destinations, models)
    similar = similar_events(players, events, top_n=top_n_similar)
    player_summary = player_recommendations(players, destinations, similar)

    report.update({
        "historical_events_rows": int(len(events)),
        "club_position_demand_rows": int(len(demand)),
        "betis_players_rows": int(len(players)),
        "destination_recommendation_rows": int(len(destinations)),
        "similar_events_rows": int(len(similar)),
        "note": "Modelo Random Forest explicable basado en historicos disponibles; las predicciones son evidencia de apoyo, no decision automatica.",
    })

    if not validate_only:
        events.to_csv(OUT_HISTORICAL, index=False, encoding="utf-8-sig")
        demand.to_csv(OUT_DEMAND, index=False, encoding="utf-8-sig")
        destinations.to_csv(OUT_DESTINATIONS, index=False, encoding="utf-8-sig")
        player_summary.to_csv(OUT_PLAYERS, index=False, encoding="utf-8-sig")
        similar.to_csv(OUT_SIMILAR, index=False, encoding="utf-8-sig")
        OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("Sucesos historicos: %s", len(events))
    logger.info("Demanda club-posicion: %s", len(demand))
    logger.info("Recomendaciones destino: %s", len(destinations))
    logger.info("Resumen jugadores: %s", len(player_summary))
    logger.info("Top ejemplo:\n%s", player_summary.head(8).to_string(index=False))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n-similar", type=int, default=10)
    parser.add_argument("--random-state", type=int, default=42)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    build_all(args.top_n_similar, args.random_state, validate_only=args.validate)


if __name__ == "__main__":
    main()
