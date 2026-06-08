#!/usr/bin/env python3
"""
Build a stronger historical modelling table for player operations.

The output is deliberately wider than the current RF inputs. Each row is one
historical player operation with:
  - player snapshot before the operation
  - destination/coach/club-position context
  - same-season performance after the operation
  - next observed season follow-up
  - separate target labels for loans, sales and global success

Outputs:
  data/final/player_operation_model_dataset.csv
  data/final/player_operation_model_report.json
  data/final/operation_success_v2_model.joblib  (ignored by git)
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score, roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"

MASTER_PATH = DATA_FINAL / "master_player_development.csv"
EVENTS_PATH = DATA_FINAL / "historical_operation_events.csv"
OUT_DATASET = DATA_FINAL / "player_operation_model_dataset.csv"
OUT_REPORT = DATA_FINAL / "player_operation_model_report.json"
OUT_MODEL = DATA_FINAL / "operation_success_v2_model.joblib"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("operation_dataset")

NUMERIC_FEATURES = [
    "edad",
    "pre_edad",
    "pre_valor_mercado",
    "pre_partidos",
    "pre_minutos",
    "pre_goles",
    "pre_xg",
    "pre_goles_por_90",
    "pre_xg_por_90",
    "valor_mercado",
    "valor_llegada",
    "partidos",
    "minutos",
    "goles",
    "xg",
    "goles_por_90",
    "xg_por_90",
    "club_pos_minutos_sub23",
    "club_pos_jugadores_sub23",
    "club_pos_pct_minutos",
    "club_total_minutos_sub23",
    "club_total_jugadores_sub23",
    "coach_total_minutos_sub23",
    "coach_total_jugadores_sub23",
    "coach_pos_minutos_sub23",
    "demand_total_altas",
    "demand_cesiones",
    "demand_traspasos",
    "demand_sub23",
    "demand_recent",
    "demand_score",
]

PRE_OPERATION_NUMERIC_FEATURES = [
    "edad",
    "pre_edad",
    "pre_valor_mercado",
    "pre_partidos",
    "pre_minutos",
    "pre_goles",
    "pre_xg",
    "pre_goles_por_90",
    "pre_xg_por_90",
    "valor_mercado",
    "valor_llegada",
    "club_pos_minutos_sub23",
    "club_pos_jugadores_sub23",
    "club_pos_pct_minutos",
    "club_total_minutos_sub23",
    "club_total_jugadores_sub23",
    "coach_total_minutos_sub23",
    "coach_total_jugadores_sub23",
    "coach_pos_minutos_sub23",
    "demand_total_altas",
    "demand_cesiones",
    "demand_traspasos",
    "demand_sub23",
    "demand_recent",
    "demand_score",
]

CATEGORICAL_FEATURES = [
    "posicion_normalizada",
    "tipo_suceso",
    "tipo_operacion",
    "origen_desarrollo",
    "club",
    "entrenador",
    "pre_club",
]


def num_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([np.nan] * len(df), index=df.index, dtype="float64")
    return pd.to_numeric(df[col], errors="coerce")


def num_value(value: Any, default: float = 0.0) -> float:
    try:
        if pd.isna(value):
            return default
        return float(value)
    except Exception:
        return default


def safe_str(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value)


def season_index(value: Any) -> int:
    text = safe_str(value)
    try:
        return int(text.split("-")[0])
    except Exception:
        return -1


def player_key(row: pd.Series) -> str:
    pid = safe_str(row.get("player_id")).strip()
    if pid and pid.lower() not in {"nan", "none"}:
        return f"id:{pid}"
    return "name:" + safe_str(row.get("nombre")).strip().lower()


def minmax(value: Any, low: float, high: float) -> float:
    if pd.isna(value) or high <= low:
        return np.nan
    return max(0.0, min((float(value) - low) / (high - low), 1.0))


def weighted_score(parts: dict[str, tuple[float, float]]) -> tuple[float, str]:
    available = {k: (v, w) for k, (v, w) in parts.items() if pd.notna(v)}
    if not available:
        return np.nan, ""
    total = sum(w for _, w in available.values())
    score = sum(v * (w / total) for v, w in available.values()) * 100.0
    return round(float(score), 2), "+".join(sorted(available))


def value_pct_delta(new_value: Any, old_value: Any) -> float:
    new = num_value(new_value, np.nan)
    old = num_value(old_value, np.nan)
    if pd.isna(new) or pd.isna(old) or old <= 0:
        return np.nan
    return (new - old) / old * 100.0


def add_player_history(master: pd.DataFrame) -> pd.DataFrame:
    df = master.copy()
    df["player_key"] = df.apply(player_key, axis=1)
    df["season_idx"] = df["temporada"].apply(season_index)
    df["valor_mercado_any"] = num_series(df, "valor_mercado").fillna(num_series(df, "valor_mercado_wyscout")).fillna(num_series(df, "valor_llegada"))

    numeric_cols = [
        "edad", "valor_mercado_any", "partidos", "titularidades", "minutos", "goles", "xg",
        "goles_por_90", "xg_por_90", "valor_llegada", "valor_salida",
        "revalorizacion_absoluta", "revalorizacion_porcentual",
    ]
    text_cols = ["temporada", "club", "entrenador", "posicion_normalizada", "tipo_operacion", "movimiento", "tiene_wyscout"]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.sort_values(["player_key", "season_idx", "club"]).copy()
    grouped = df.groupby("player_key", dropna=False)

    for col in numeric_cols + text_cols:
        if col not in df.columns:
            continue
        df[f"pre_{col}"] = grouped[col].shift(1)
        df[f"post_{col}"] = grouped[col].shift(-1)

    df["has_pre_history"] = df["pre_temporada"].notna().astype(int)
    df["has_post_history"] = df["post_temporada"].notna().astype(int)
    df["post_valor_delta"] = df["post_valor_mercado_any"] - df["valor_mercado_any"]
    df["post_valor_delta_pct"] = df.apply(lambda r: value_pct_delta(r["post_valor_mercado_any"], r["valor_mercado_any"]), axis=1)
    df["post_minutos_delta"] = df["post_minutos"] - df["minutos"]

    keep = [
        "nombre", "temporada", "club", "player_key", "has_pre_history", "has_post_history",
        "pre_temporada", "pre_club", "pre_entrenador", "pre_edad", "pre_valor_mercado_any",
        "pre_partidos", "pre_titularidades", "pre_minutos", "pre_goles", "pre_xg",
        "pre_goles_por_90", "pre_xg_por_90", "pre_tipo_operacion", "pre_movimiento",
        "post_temporada", "post_club", "post_entrenador", "post_edad", "post_valor_mercado_any",
        "post_partidos", "post_titularidades", "post_minutos", "post_goles", "post_xg",
        "post_goles_por_90", "post_xg_por_90", "post_tipo_operacion", "post_movimiento",
        "post_valor_delta", "post_valor_delta_pct", "post_minutos_delta",
    ]
    return df[[c for c in keep if c in df.columns]].copy()


def build_targets(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in [
        "edad", "valor_mercado", "valor_llegada", "valor_salida", "partidos", "titularidades",
        "minutos", "goles", "xg", "goles_por_90", "xg_por_90", "revalorizacion_absoluta",
        "revalorizacion_porcentual", "club_pos_minutos_sub23", "club_pos_jugadores_sub23",
        "club_pos_pct_minutos", "club_total_minutos_sub23", "coach_total_minutos_sub23",
        "coach_pos_minutos_sub23", "demand_score", "post_valor_delta_pct", "post_minutos",
        "post_minutos_delta", "post_valor_delta",
    ]:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    out["same_season_minutes_score"] = out["minutos"].apply(lambda v: minmax(v, 0, 2700))
    out["same_season_starts_score"] = out["titularidades"].apply(lambda v: minmax(v, 0, 25)) if "titularidades" in out.columns else np.nan
    out["market_score"] = out["revalorizacion_porcentual"].apply(lambda v: minmax(v, -50, 150))
    missing_market = out["market_score"].isna()
    out.loc[missing_market, "market_score"] = out.loc[missing_market, "post_valor_delta_pct"].apply(lambda v: minmax(v, -50, 150))
    out["offensive_score"] = (
        0.6 * out["goles_por_90"].apply(lambda v: minmax(v, 0, 0.55)).fillna(0)
        + 0.4 * out["xg_por_90"].apply(lambda v: minmax(v, 0, 0.55)).fillna(0)
    )
    out.loc[out["goles_por_90"].isna() & out["xg_por_90"].isna(), "offensive_score"] = np.nan
    out["context_score"] = (
        0.40 * out["club_pos_minutos_sub23"].rank(pct=True)
        + 0.20 * out["club_pos_jugadores_sub23"].rank(pct=True)
        + 0.20 * out["coach_pos_minutos_sub23"].rank(pct=True)
        + 0.20 * (out["demand_score"] / 100).clip(0, 1)
    )
    out["followup_score"] = (
        0.55 * out["post_minutos"].apply(lambda v: minmax(v, 0, 2200)).fillna(0)
        + 0.45 * out["post_valor_delta_pct"].apply(lambda v: minmax(v, -50, 100)).fillna(0)
    )
    out.loc[out["post_temporada"].isna(), "followup_score"] = np.nan

    scores = []
    dims = []
    for _, row in out.iterrows():
        score, used = weighted_score({
            "opportunity": (row.get("same_season_minutes_score"), 0.35),
            "market": (row.get("market_score"), 0.25),
            "offensive": (row.get("offensive_score"), 0.15),
            "context": (row.get("context_score"), 0.15),
            "followup": (row.get("followup_score"), 0.10),
        })
        scores.append(score)
        dims.append(used)
    out["operation_success_score_v2"] = scores
    out["target_dimensions_used"] = dims

    out["loan_success_label"] = np.where(
        out["tipo_suceso"].astype(str).str.lower().eq("cesion"),
        ((out["minutos"].fillna(0) >= 900) & (out["operation_success_score_v2"].fillna(0) >= 45)).astype(int),
        np.nan,
    )
    out["sale_success_label"] = np.where(
        out["tipo_suceso"].astype(str).str.lower().eq("traspaso"),
        ((out["revalorizacion_absoluta"].fillna(0) > 0) | (out["post_valor_delta"].fillna(0) > 0)).astype(int),
        np.nan,
    )
    out["global_success_label"] = (out["operation_success_score_v2"].fillna(-1) >= 55).astype(int)
    out.loc[out["operation_success_score_v2"].isna(), "global_success_label"] = np.nan

    evidence_count = (
        out["has_pre_history"].fillna(0).astype(int)
        + out["has_post_history"].fillna(0).astype(int)
        + out["tiene_wyscout"].astype(str).str.lower().eq("true").astype(int)
        + out["market_score"].notna().astype(int)
    )
    out["label_confidence"] = np.select(
        [evidence_count >= 3, evidence_count == 2],
        ["Alta", "Media"],
        default="Baja",
    )
    return out


def make_dataset(master: pd.DataFrame, events: pd.DataFrame) -> pd.DataFrame:
    history = add_player_history(master)
    df = events.merge(history, on=["nombre", "temporada", "club"], how="left")

    rename_cols = {
        "pre_valor_mercado_any": "pre_valor_mercado",
        "post_valor_mercado_any": "post_valor_mercado",
    }
    df = df.rename(columns=rename_cols)
    if "valor_mercado" not in df.columns:
        df["valor_mercado"] = np.nan
    df["valor_mercado"] = pd.to_numeric(df["valor_mercado"], errors="coerce").fillna(pd.to_numeric(df.get("valor_llegada"), errors="coerce"))
    df = build_targets(df)

    ordered = [
        "nombre", "temporada", "club", "entrenador", "edad", "posicion_normalizada",
        "tipo_suceso", "tipo_operacion", "origen_desarrollo",
        "pre_temporada", "pre_club", "pre_entrenador", "pre_edad", "pre_valor_mercado",
        "pre_partidos", "pre_titularidades", "pre_minutos", "pre_goles", "pre_xg",
        "pre_goles_por_90", "pre_xg_por_90",
        "valor_mercado", "valor_llegada", "valor_salida", "partidos", "titularidades",
        "minutos", "goles", "xg", "goles_por_90", "xg_por_90",
        "revalorizacion_absoluta", "revalorizacion_porcentual",
        "club_pos_jugadores_sub23", "club_pos_minutos_sub23", "club_pos_goles_sub23",
        "club_pos_xg_sub23", "club_pos_pct_minutos", "club_total_jugadores_sub23",
        "club_total_minutos_sub23", "coach_total_jugadores_sub23", "coach_total_minutos_sub23",
        "coach_pos_minutos_sub23", "demand_total_altas", "demand_cesiones",
        "demand_traspasos", "demand_sub23", "demand_recent", "demand_score",
        "post_temporada", "post_club", "post_entrenador", "post_edad", "post_valor_mercado",
        "post_partidos", "post_titularidades", "post_minutos", "post_goles", "post_xg",
        "post_goles_por_90", "post_xg_por_90", "post_valor_delta", "post_valor_delta_pct",
        "post_minutos_delta", "same_season_minutes_score", "market_score",
        "offensive_score", "context_score", "followup_score", "operation_success_score_v2",
        "target_dimensions_used", "loan_success_label", "sale_success_label",
        "global_success_label", "label_confidence", "has_pre_history", "has_post_history",
        "tiene_wyscout",
    ]
    return df[[c for c in ordered if c in df.columns]].copy()


def make_preprocessor(features: list[str], numeric_pool: list[str]) -> ColumnTransformer:
    numeric = [c for c in features if c in numeric_pool]
    categorical = [c for c in features if c in CATEGORICAL_FEATURES]
    return ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), numeric),
        ("cat", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=3)),
        ]), categorical),
    ])


def feature_importances(model: Pipeline, limit: int = 20) -> list[dict[str, Any]]:
    try:
        names = model.named_steps["prep"].get_feature_names_out()
        imps = model.named_steps["rf"].feature_importances_
    except Exception:
        return []
    return [
        {"feature": str(name), "importance": round(float(imp), 5)}
        for name, imp in sorted(zip(names, imps), key=lambda t: t[1], reverse=True)[:limit]
    ]


def train_report(dataset: pd.DataFrame, random_state: int, validate_only: bool) -> dict[str, Any]:
    report: dict[str, Any] = {
        "dataset": {
            "rows": int(len(dataset)),
            "columns": int(len(dataset.columns)),
            "with_pre_history": int(dataset["has_pre_history"].fillna(0).sum()),
            "with_post_history": int(dataset["has_post_history"].fillna(0).sum()),
            "with_wyscout": int(dataset["tiene_wyscout"].astype(str).str.lower().eq("true").sum()),
            "label_confidence": {str(k): int(v) for k, v in dataset["label_confidence"].value_counts().to_dict().items()},
            "operation_types": {str(k): int(v) for k, v in dataset["tipo_suceso"].value_counts().to_dict().items()},
        },
        "target_definition": {
            "operation_success_score_v2": "0-100 weighted target: opportunity 35%, market 25%, offensive production 15%, development context 15%, follow-up 10%; missing dimensions are reweighted.",
            "loan_success_label": "Only for cesion rows: 1 if same-season minutes >=900 and score_v2 >=45.",
            "sale_success_label": "Only for traspaso rows: 1 if revaluation or next observed market value is positive.",
            "label_confidence": "Alta/Media/Baja based on pre-history, post-history, Wyscout and market evidence availability.",
        },
    }

    model_df = dataset[dataset["operation_success_score_v2"].notna()].copy()
    for col in NUMERIC_FEATURES:
        if col in model_df.columns:
            model_df[col] = pd.to_numeric(model_df[col], errors="coerce")
    features = [c for c in PRE_OPERATION_NUMERIC_FEATURES + CATEGORICAL_FEATURES if c in model_df.columns]

    if len(model_df) >= 120:
        X = model_df[features]
        y = model_df["operation_success_score_v2"]
        reg = Pipeline([
            ("prep", make_preprocessor(features, PRE_OPERATION_NUMERIC_FEATURES)),
            ("rf", RandomForestRegressor(
                n_estimators=450,
                min_samples_leaf=5,
                max_features="sqrt",
                random_state=random_state,
                n_jobs=-1,
            )),
        ])
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=random_state)
        reg.fit(X_train, y_train)
        pred = reg.predict(X_test)
        cv = cross_val_score(reg, X, y, cv=5, scoring="r2", n_jobs=-1)
        report["operation_success_regressor"] = {
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "mae": round(float(mean_absolute_error(y_test, pred)), 2),
            "r2_holdout": round(float(r2_score(y_test, pred)), 4),
            "r2_cv_mean": round(float(cv.mean()), 4),
            "r2_cv_std": round(float(cv.std()), 4),
            "target_mean": round(float(y.mean()), 2),
            "target_std": round(float(y.std()), 2),
            "feature_policy": "pre_operation_only: excludes same-season minutes, matches, goals, xG, revaluation and follow-up outcomes to avoid leakage.",
            "feature_importances": feature_importances(reg),
        }
        if not validate_only:
            import joblib
            joblib.dump(reg, OUT_MODEL)
    else:
        report["operation_success_regressor"] = {"error": f"Only {len(model_df)} labelled rows"}

    labelled = model_df[model_df["global_success_label"].notna()].copy()
    if len(labelled) >= 120 and labelled["global_success_label"].nunique() == 2:
        X = labelled[features]
        y = labelled["global_success_label"].astype(int)
        clf = Pipeline([
            ("prep", make_preprocessor(features, PRE_OPERATION_NUMERIC_FEATURES)),
            ("rf", RandomForestClassifier(
                n_estimators=450,
                min_samples_leaf=5,
                max_features="sqrt",
                class_weight="balanced_subsample",
                random_state=random_state + 1,
                n_jobs=-1,
            )),
        ])
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, stratify=y, random_state=random_state)
        clf.fit(X_train, y_train)
        pred = clf.predict(X_test)
        proba = clf.predict_proba(X_test)[:, 1]
        report["global_success_classifier"] = {
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
            "positive_rate": round(float(y.mean()), 4),
            "feature_importances": feature_importances(clf),
        }
    else:
        report["global_success_classifier"] = {"error": "Not enough binary target diversity"}

    return report


def build_all(validate_only: bool = False, random_state: int = 42) -> dict[str, Any]:
    for path in [MASTER_PATH, EVENTS_PATH]:
        if not path.exists():
            raise FileNotFoundError(f"Missing {path}")

    master = pd.read_csv(MASTER_PATH, low_memory=False)
    events = pd.read_csv(EVENTS_PATH, low_memory=False)
    dataset = make_dataset(master, events)
    report = train_report(dataset, random_state=random_state, validate_only=validate_only)

    logger.info("Rows: %s", len(dataset))
    logger.info("With pre history: %s", report["dataset"]["with_pre_history"])
    logger.info("With post history: %s", report["dataset"]["with_post_history"])
    logger.info("Label confidence: %s", report["dataset"]["label_confidence"])
    if "operation_success_regressor" in report:
        logger.info("Regressor: %s", report["operation_success_regressor"])

    if not validate_only:
        dataset.to_csv(OUT_DATASET, index=False, encoding="utf-8-sig")
        OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("Saved: %s", OUT_DATASET)
        logger.info("Saved: %s", OUT_REPORT)
        logger.info("Saved model: %s", OUT_MODEL)

    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    report = build_all(validate_only=args.validate, random_state=args.seed)
    if args.validate:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
