#!/usr/bin/env python3
"""
Benchmark ML methods for historical player-operation decisions.

It compares several model families on the same pre-operation features used by
the v2 dataset:
  - classification targets: global_success_label, loan_success_label,
    sale_success_label
  - regression target: operation_success_score_v2

The goal is not to replace sporting judgement, but to decide which ML method is
the best current approximation of our rule/score framework on past operations.

Outputs:
  data/final/operation_model_benchmark.csv
  data/final/operation_model_benchmark_report.json
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
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (
    ExtraTreesClassifier,
    ExtraTreesRegressor,
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    f1_score,
    mean_absolute_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
DATASET_PATH = DATA_FINAL / "player_operation_model_dataset.csv"
OUT_CSV = DATA_FINAL / "operation_model_benchmark.csv"
OUT_REPORT = DATA_FINAL / "operation_model_benchmark_report.json"

RANDOM_STATE = 42

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

CLASS_TARGETS = [
    ("global_success_label", "Exito global historico"),
    ("loan_success_label", "Exito cesion"),
    ("sale_success_label", "Exito venta"),
]

REG_TARGETS = [
    ("operation_success_score_v2", "Score operacion 0-100"),
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("model_benchmark")


def available_features(df: pd.DataFrame) -> list[str]:
    return [c for c in PRE_OPERATION_NUMERIC_FEATURES + CATEGORICAL_FEATURES if c in df.columns]


def make_preprocessor(features: list[str], scale_numeric: bool = False) -> ColumnTransformer:
    numeric = [c for c in features if c in PRE_OPERATION_NUMERIC_FEATURES]
    categorical = [c for c in features if c in CATEGORICAL_FEATURES]
    num_steps: list[tuple[str, Any]] = [("imputer", SimpleImputer(strategy="median"))]
    if scale_numeric:
        num_steps.append(("scaler", StandardScaler()))
    return ColumnTransformer([
        ("num", Pipeline(num_steps), numeric),
        ("cat", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=3, sparse_output=False)),
        ]), categorical),
    ], sparse_threshold=0)


def classifier_models() -> dict[str, tuple[Any, bool]]:
    return {
        "dummy_most_frequent": (DummyClassifier(strategy="most_frequent"), False),
        "logistic_regression": (
            LogisticRegression(max_iter=2000, class_weight="balanced", solver="liblinear", random_state=RANDOM_STATE),
            True,
        ),
        "random_forest": (
            RandomForestClassifier(
                n_estimators=500,
                min_samples_leaf=5,
                max_features="sqrt",
                class_weight="balanced_subsample",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
            False,
        ),
        "extra_trees": (
            ExtraTreesClassifier(
                n_estimators=500,
                min_samples_leaf=5,
                max_features="sqrt",
                class_weight="balanced",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
            False,
        ),
        "hist_gradient_boosting": (
            HistGradientBoostingClassifier(
                learning_rate=0.05,
                max_iter=250,
                l2_regularization=0.1,
                random_state=RANDOM_STATE,
            ),
            False,
        ),
    }


def regressor_models() -> dict[str, tuple[Any, bool]]:
    return {
        "dummy_mean": (DummyRegressor(strategy="mean"), False),
        "ridge": (Ridge(alpha=10.0, random_state=RANDOM_STATE), True),
        "random_forest": (
            RandomForestRegressor(
                n_estimators=500,
                min_samples_leaf=5,
                max_features="sqrt",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
            False,
        ),
        "extra_trees": (
            ExtraTreesRegressor(
                n_estimators=500,
                min_samples_leaf=5,
                max_features="sqrt",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
            False,
        ),
        "hist_gradient_boosting": (
            HistGradientBoostingRegressor(
                learning_rate=0.05,
                max_iter=250,
                l2_regularization=0.1,
                random_state=RANDOM_STATE,
            ),
            False,
        ),
    }


def build_pipeline(model: Any, features: list[str], scale_numeric: bool) -> Pipeline:
    return Pipeline([
        ("prep", make_preprocessor(features, scale_numeric=scale_numeric)),
        ("model", model),
    ])


def probability_or_score(model: Pipeline, X: pd.DataFrame) -> np.ndarray:
    if hasattr(model.named_steps["model"], "predict_proba"):
        return model.predict_proba(X)[:, 1]
    if hasattr(model.named_steps["model"], "decision_function"):
        raw = model.decision_function(X)
        return 1 / (1 + np.exp(-raw))
    return model.predict(X)


def benchmark_classifier(df: pd.DataFrame, target: str, label: str, features: list[str]) -> list[dict[str, Any]]:
    data = df[df[target].notna()].copy()
    data[target] = pd.to_numeric(data[target], errors="coerce")
    data = data[data[target].isin([0, 1])].copy()
    if len(data) < 80 or data[target].nunique() < 2 or data[target].value_counts().min() < 8:
        logger.warning("Skipping %s: not enough target diversity", target)
        return []

    X = data[features]
    y = data[target].astype(int)
    strat = y if y.value_counts().min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=RANDOM_STATE, stratify=strat,
    )
    cv_splits = min(5, int(y.value_counts().min()))
    cv = StratifiedKFold(n_splits=cv_splits, shuffle=True, random_state=RANDOM_STATE)
    scoring = {
        "f1": "f1",
        "f1_macro": "f1_macro",
        "balanced_accuracy": "balanced_accuracy",
        "roc_auc": "roc_auc",
        "average_precision": "average_precision",
    }

    rows = []
    for name, (model, scale) in classifier_models().items():
        pipe = build_pipeline(model, features, scale)
        cv_scores = cross_validate(pipe, X, y, cv=cv, scoring=scoring, n_jobs=-1, error_score=np.nan)
        pipe.fit(X_train, y_train)
        pred = pipe.predict(X_test)
        score = probability_or_score(pipe, X_test)
        try:
            auc = roc_auc_score(y_test, score)
        except Exception:
            auc = np.nan
        try:
            ap = average_precision_score(y_test, score)
        except Exception:
            ap = np.nan
        rows.append({
            "task": "classification",
            "target": target,
            "target_label": label,
            "model": name,
            "rows": int(len(data)),
            "positive_rows": int(y.sum()),
            "positive_rate": round(float(y.mean()), 4),
            "cv_f1_mean": round(float(np.nanmean(cv_scores["test_f1"])), 4),
            "cv_f1_std": round(float(np.nanstd(cv_scores["test_f1"])), 4),
            "cv_f1_macro_mean": round(float(np.nanmean(cv_scores["test_f1_macro"])), 4),
            "cv_balanced_accuracy_mean": round(float(np.nanmean(cv_scores["test_balanced_accuracy"])), 4),
            "cv_roc_auc_mean": round(float(np.nanmean(cv_scores["test_roc_auc"])), 4),
            "cv_average_precision_mean": round(float(np.nanmean(cv_scores["test_average_precision"])), 4),
            "holdout_accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "holdout_balanced_accuracy": round(float(balanced_accuracy_score(y_test, pred)), 4),
            "holdout_precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
            "holdout_recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
            "holdout_f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
            "holdout_roc_auc": round(float(auc), 4) if not np.isnan(auc) else np.nan,
            "holdout_average_precision": round(float(ap), 4) if not np.isnan(ap) else np.nan,
        })
    return rows


def benchmark_regressor(df: pd.DataFrame, target: str, label: str, features: list[str]) -> list[dict[str, Any]]:
    data = df[df[target].notna()].copy()
    data[target] = pd.to_numeric(data[target], errors="coerce")
    data = data[data[target].notna()].copy()
    if len(data) < 120:
        logger.warning("Skipping %s: not enough rows", target)
        return []

    X = data[features]
    y = data[target]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=RANDOM_STATE)
    rows = []
    for name, (model, scale) in regressor_models().items():
        pipe = build_pipeline(model, features, scale)
        pipe.fit(X_train, y_train)
        pred = pipe.predict(X_test)
        cv = cross_validate(
            pipe,
            X,
            y,
            cv=5,
            scoring={"r2": "r2", "neg_mae": "neg_mean_absolute_error"},
            n_jobs=-1,
            error_score=np.nan,
        )
        rows.append({
            "task": "regression",
            "target": target,
            "target_label": label,
            "model": name,
            "rows": int(len(data)),
            "positive_rows": "",
            "positive_rate": "",
            "cv_r2_mean": round(float(np.nanmean(cv["test_r2"])), 4),
            "cv_r2_std": round(float(np.nanstd(cv["test_r2"])), 4),
            "cv_mae_mean": round(float(-np.nanmean(cv["test_neg_mae"])), 2),
            "holdout_mae": round(float(mean_absolute_error(y_test, pred)), 2),
            "holdout_r2": round(float(r2_score(y_test, pred)), 4),
        })
    return rows


def choose_best(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    df = pd.DataFrame(rows)
    if df.empty:
        return best
    for target, group in df.groupby("target"):
        task = group.iloc[0]["task"]
        candidates = group[~group["model"].astype(str).str.startswith("dummy")].copy()
        if candidates.empty:
            candidates = group.copy()
        if task == "classification":
            # F1 is primary because positives are rare; AP/AUC break ties.
            candidates["_rank"] = (
                pd.to_numeric(candidates["cv_f1_mean"], errors="coerce").fillna(0) * 0.55
                + pd.to_numeric(candidates["cv_average_precision_mean"], errors="coerce").fillna(0) * 0.25
                + pd.to_numeric(candidates["cv_balanced_accuracy_mean"], errors="coerce").fillna(0) * 0.20
            )
            best_row = candidates.sort_values("_rank", ascending=False).iloc[0].drop(labels=["_rank"]).to_dict()
        else:
            candidates["_rank"] = (
                pd.to_numeric(candidates["cv_r2_mean"], errors="coerce").fillna(-99)
                - (pd.to_numeric(candidates["cv_mae_mean"], errors="coerce").fillna(999) / 100)
            )
            best_row = candidates.sort_values("_rank", ascending=False).iloc[0].drop(labels=["_rank"]).to_dict()
        best[target] = best_row
    return best


def json_clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: json_clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_clean(v) for v in value]
    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
        return None
    if pd.isna(value) if not isinstance(value, (str, bytes, dict, list, tuple)) else False:
        return None
    return value


def build(validate_only: bool = False) -> tuple[pd.DataFrame, dict[str, Any]]:
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Missing {DATASET_PATH}. Run build_operation_model_dataset.py first.")
    df = pd.read_csv(DATASET_PATH, low_memory=False)
    features = available_features(df)

    rows: list[dict[str, Any]] = []
    for target, label in CLASS_TARGETS:
        if target in df.columns:
            logger.info("Benchmark classification: %s", target)
            rows.extend(benchmark_classifier(df, target, label, features))
    for target, label in REG_TARGETS:
        if target in df.columns:
            logger.info("Benchmark regression: %s", target)
            rows.extend(benchmark_regressor(df, target, label, features))

    result = pd.DataFrame(rows)
    best = choose_best(rows)
    report = {
        "dataset": {
            "path": str(DATASET_PATH.relative_to(ROOT)),
            "rows": int(len(df)),
            "features": features,
            "feature_policy": "pre_operation_only: excludes same-season minutes/goals/xG, revaluation and follow-up outcomes as inputs.",
        },
        "selection_policy": {
            "classification": "Primary metric is cross-validated F1 because positive outcomes are rare; average precision and balanced accuracy break ties.",
            "regression": "Primary metric is cross-validated R2 with MAE as penalty.",
        },
        "best_models": json_clean(best),
        "notes": [
            "Loan and sale labels have few positive cases, so metrics should be interpreted as directional evidence.",
            "Random Forest is no longer assumed to be best; it is compared against linear, ExtraTrees and gradient boosting baselines.",
        ],
    }

    if not validate_only:
        result.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")
        OUT_REPORT.write_text(json.dumps(json_clean(report), ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("Saved: %s", OUT_CSV)
        logger.info("Saved: %s", OUT_REPORT)

    return result, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    result, report = build(validate_only=args.validate)
    if args.validate:
        print(result.to_string(index=False))
        print(json.dumps(report["best_models"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
