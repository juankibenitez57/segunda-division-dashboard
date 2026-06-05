#!/usr/bin/env python3
"""
operation_success_score — variable objetivo del sistema de decisión Betis.

Mide, en una escala 0-100, si una operación histórica (cesión, traspaso,
fichaje libre, uso de cantera) resultó EXITOSA combinando cuatro dimensiones:

    1. DESARROLLO   (minutos jugados)            peso base 40%
    2. MERCADO      (revalorización)             peso base 25%
    3. RENDIMIENTO  (goles + xG por 90)          peso base 20%
    4. PROGRESIÓN   (revalorización positiva +    peso base 15%
                     permanencia en el club)

Pesos AUTO-AJUSTABLES: si una dimensión no tiene datos para una fila
(p. ej. sin Wyscout no hay minutos), su peso se reparte proporcionalmente
entre las dimensiones disponibles. El score nunca es una caja negra:
se guarda el desglose por componente.

Salidas:
    data/final/historical_success_cases.csv   (casos etiquetados + desglose)
    data/final/success_score_report.json      (definición + importancias RF)

Entrena además un RandomForestRegressor explicable que predice el score a
partir de edad, posición, valor de mercado, minutos, goles, xG, club,
entrenador y tipo de operación.

Uso:
    python3 build_success_score.py
    python3 build_success_score.py --validate   # resumen sin guardar
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).parent
DATA_FINAL = ROOT / "data" / "final"
EVENTS_PATH = DATA_FINAL / "historical_operation_events.csv"
OUT_CASES = DATA_FINAL / "historical_success_cases.csv"
OUT_REPORT = DATA_FINAL / "success_score_report.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("success_score")

# ── Definición de pesos base (documentada y explicable) ──────────────────────
WEIGHTS = {
    "desarrollo": 0.40,   # minutos jugados
    "mercado": 0.25,      # revalorización
    "rendimiento": 0.20,  # goles + xG por 90
    "progresion": 0.15,   # revalorización positiva + permanencia
}

# Bandas de normalización (calibradas con percentiles reales del dataset)
BAND_MINUTOS = (0.0, 2700.0)          # 2700' ≈ 30 partidos completos = tope
BAND_REV_PCT = (-50.0, 150.0)         # -50% → 0 ; +150% → 1 (cap outliers)
BAND_GOLES90 = (0.0, 0.5)             # 0.5 goles/90 ya es élite en 2ª
BAND_XG90 = (0.0, 0.5)

# Features para el Random Forest
NUMERIC_FEATURES = ["edad", "valor_mercado", "minutos", "goles", "xg",
                    "goles_por_90", "xg_por_90"]
CATEGORICAL_FEATURES = ["posicion_normalizada", "club", "entrenador", "tipo_operacion"]


def minmax(value: float, low: float, high: float) -> float:
    if pd.isna(value) or high <= low:
        return np.nan
    return max(0.0, min((float(value) - low) / (high - low), 1.0))


def num(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series([np.nan] * len(df), index=df.index)
    return pd.to_numeric(df[col], errors="coerce")


def compute_components(row: pd.Series) -> dict[str, float]:
    """Devuelve cada componente en [0,1] o NaN si no hay datos para esa dimensión."""
    tiene_wy = str(row.get("tiene_wyscout", "")).lower() == "true"
    minutos = row.get("minutos")
    rev_pct = row.get("revalorizacion_porcentual")
    rev_abs = row.get("revalorizacion_absoluta")
    g90 = row.get("goles_por_90")
    xg90 = row.get("xg_por_90")

    # 1. Desarrollo — minutos (solo si hay datos Wyscout reales)
    desarrollo = minmax(minutos, *BAND_MINUTOS) if tiene_wy else np.nan

    # 2. Mercado — revalorización porcentual (solo si está etiquetada)
    if pd.notna(rev_pct):
        mercado = minmax(rev_pct, *BAND_REV_PCT)
    else:
        mercado = np.nan

    # 3. Rendimiento ofensivo — goles/90 y xG/90 (solo con Wyscout)
    if tiene_wy and (pd.notna(g90) or pd.notna(xg90)):
        g = minmax(g90, *BAND_GOLES90) if pd.notna(g90) else 0.0
        x = minmax(xg90, *BAND_XG90) if pd.notna(xg90) else 0.0
        rendimiento = 0.6 * g + 0.4 * x
    else:
        rendimiento = np.nan

    # 4. Progresión — revalorización positiva + permanencia (proxy)
    if pd.notna(rev_abs) or pd.notna(rev_pct):
        positiva = 1.0 if (pd.notna(rev_abs) and float(rev_abs) > 0) else 0.0
        # bonus por revalorización fuerte (>50%)
        fuerte = 0.0
        if pd.notna(rev_pct) and float(rev_pct) >= 50:
            fuerte = min((float(rev_pct) - 50) / 100.0, 1.0)
        progresion = 0.7 * positiva + 0.3 * fuerte
    else:
        progresion = np.nan

    return {
        "comp_desarrollo": desarrollo,
        "comp_mercado": mercado,
        "comp_rendimiento": rendimiento,
        "comp_progresion": progresion,
    }


def score_from_components(comp: dict[str, float]) -> tuple[float, dict[str, float]]:
    """
    Combina componentes con pesos auto-ajustables.
    Devuelve (score 0-100, pesos efectivos aplicados).
    """
    mapping = {
        "desarrollo": comp["comp_desarrollo"],
        "mercado": comp["comp_mercado"],
        "rendimiento": comp["comp_rendimiento"],
        "progresion": comp["comp_progresion"],
    }
    available = {k: v for k, v in mapping.items() if pd.notna(v)}
    if not available:
        return np.nan, {}

    total_w = sum(WEIGHTS[k] for k in available)
    eff = {k: WEIGHTS[k] / total_w for k in available}
    score = sum(eff[k] * available[k] for k in available) * 100.0
    return round(score, 2), eff


def build_success_cases(events: pd.DataFrame) -> pd.DataFrame:
    df = events.copy()
    # Asegurar numéricos
    for c in ["edad", "minutos", "goles", "xg", "goles_por_90", "xg_por_90",
              "revalorizacion_porcentual", "revalorizacion_absoluta", "valor_mercado"]:
        df[c] = num(df, c)

    comps = df.apply(compute_components, axis=1, result_type="expand")
    df = pd.concat([df, comps], axis=1)

    scores, weights_used = [], []
    for _, row in df.iterrows():
        s, eff = score_from_components({
            "comp_desarrollo": row["comp_desarrollo"],
            "comp_mercado": row["comp_mercado"],
            "comp_rendimiento": row["comp_rendimiento"],
            "comp_progresion": row["comp_progresion"],
        })
        scores.append(s)
        weights_used.append("+".join(sorted(eff.keys())) if eff else "")
    df["operation_success_score"] = scores
    df["dimensiones_usadas"] = weights_used

    # Solo casos con al menos una dimensión medible
    cases = df[df["operation_success_score"].notna()].copy()
    return cases


def train_success_model(cases: pd.DataFrame, random_state: int = 42) -> dict[str, Any]:
    df = cases[cases["operation_success_score"].notna()].copy()
    df = df[num(df, "edad") > 0]
    for c in NUMERIC_FEATURES:
        df[c] = num(df, c)

    X = df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y = df["operation_success_score"]
    if len(df) < 100:
        return {"error": f"Solo {len(df)} filas; insuficiente para entrenar"}

    pre = ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
        ("cat", Pipeline([
            ("imp", SimpleImputer(strategy="most_frequent")),
            ("oh", OneHotEncoder(handle_unknown="ignore", min_frequency=3)),
        ]), CATEGORICAL_FEATURES),
    ])
    model = Pipeline([
        ("prep", pre),
        ("rf", RandomForestRegressor(n_estimators=400, min_samples_leaf=4,
                                     max_features="sqrt", random_state=random_state, n_jobs=-1)),
    ])

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=random_state)
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    # Validación cruzada (R²) sobre todo el set
    cv = cross_val_score(model, X, y, cv=5, scoring="r2", n_jobs=-1)

    # Importancia de variables
    try:
        names = model.named_steps["prep"].get_feature_names_out()
        imps = model.named_steps["rf"].feature_importances_
        top = sorted(zip(names, imps), key=lambda t: t[1], reverse=True)[:20]
        importances = [{"feature": str(n), "importance": round(float(i), 5)} for n, i in top]
    except Exception:
        importances = []

    # Guardar el modelo entrenado para uso posterior (predicción Betis)
    import joblib
    joblib.dump(model, DATA_FINAL / "success_score_model.joblib")

    return {
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "mae": round(float(mean_absolute_error(y_test, pred)), 2),
        "r2_holdout": round(float(r2_score(y_test, pred)), 4),
        "r2_cv_mean": round(float(cv.mean()), 4),
        "r2_cv_std": round(float(cv.std()), 4),
        "target_mean": round(float(y.mean()), 2),
        "target_std": round(float(y.std()), 2),
        "feature_importances": importances,
    }


def build_all(validate_only: bool = False, random_state: int = 42) -> dict[str, Any]:
    if not EVENTS_PATH.exists():
        raise FileNotFoundError(f"Falta {EVENTS_PATH}. Ejecuta build_rf_decision_model.py primero.")

    logger.info("═" * 55)
    logger.info("  operation_success_score — Sistema de decisión Betis")
    logger.info("═" * 55)

    events = pd.read_csv(EVENTS_PATH, low_memory=False)
    logger.info(f"Sucesos históricos cargados: {len(events)}")

    cases = build_success_cases(events)
    logger.info(f"Casos con score calculable: {len(cases)} ({len(cases)/len(events)*100:.1f}%)")

    # Distribución del score
    s = cases["operation_success_score"]
    logger.info(f"\n  operation_success_score:")
    logger.info(f"    media={s.mean():.1f}  mediana={s.median():.1f}  p25={s.quantile(.25):.1f}  p75={s.quantile(.75):.1f}")
    logger.info(f"    dimensiones usadas (combos más frecuentes):")
    for combo, n in cases["dimensiones_usadas"].value_counts().head(6).items():
        logger.info(f"      {combo or '(ninguna)'}: {n}")

    logger.info("\n  Entrenando Random Forest explicable…")
    model_report = train_success_model(cases, random_state)
    if "error" not in model_report:
        logger.info(f"    R² holdout={model_report['r2_holdout']} · R² CV={model_report['r2_cv_mean']}±{model_report['r2_cv_std']} · MAE={model_report['mae']}")
        logger.info(f"    Top 5 variables:")
        for fi in model_report["feature_importances"][:5]:
            logger.info(f"      {fi['feature']}: {fi['importance']}")
    else:
        logger.warning(f"    {model_report['error']}")

    report = {
        "definicion": {
            "escala": "0-100",
            "pesos_base": WEIGHTS,
            "auto_ajuste": "Si una dimensión carece de datos, su peso se reparte proporcionalmente entre las disponibles.",
            "bandas_normalizacion": {
                "minutos": BAND_MINUTOS, "revalorizacion_pct": BAND_REV_PCT,
                "goles_por_90": BAND_GOLES90, "xg_por_90": BAND_XG90,
            },
            "componentes": {
                "desarrollo": "minutos jugados normalizados (requiere Wyscout)",
                "mercado": "revalorización porcentual normalizada (requiere etiqueta TM)",
                "rendimiento": "0.6·goles/90 + 0.4·xG/90 (requiere Wyscout)",
                "progresion": "0.7·revalorización_positiva + 0.3·bonus_revalorización_fuerte",
            },
        },
        "dataset": {
            "sucesos_totales": int(len(events)),
            "casos_con_score": int(len(cases)),
            "score_medio": round(float(s.mean()), 2),
            "score_mediana": round(float(s.median()), 2),
        },
        "modelo_random_forest": model_report,
    }

    # Top casos de éxito como ejemplos
    top_cases = cases.sort_values("operation_success_score", ascending=False).head(10)
    report["ejemplos_top_exito"] = [
        {
            "jugador": r["nombre"], "temporada": r["temporada"], "club": r["club"],
            "posicion": r["posicion_normalizada"], "tipo": r["tipo_suceso"],
            "score": r["operation_success_score"],
        }
        for _, r in top_cases.iterrows()
    ]

    if validate_only:
        logger.info("\n  (--validate: no se guarda nada)")
        print(json.dumps(report["definicion"], ensure_ascii=False, indent=2))
        return report

    # Guardar casos
    keep_cols = [
        "nombre", "temporada", "club", "entrenador", "edad", "posicion_normalizada",
        "tipo_operacion", "tipo_suceso", "minutos", "goles", "xg",
        "valor_mercado", "revalorizacion_porcentual", "revalorizacion_absoluta",
        "comp_desarrollo", "comp_mercado", "comp_rendimiento", "comp_progresion",
        "dimensiones_usadas", "operation_success_score",
    ]
    out = cases[[c for c in keep_cols if c in cases.columns]].copy()
    out = out.rename(columns={"nombre": "jugador", "posicion_normalizada": "posicion"})
    out.to_csv(OUT_CASES, index=False, encoding="utf-8-sig")
    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"\n  ✓ {OUT_CASES.name}  ({len(out)} casos)")
    logger.info(f"  ✓ {OUT_REPORT.name}")
    logger.info(f"  ✓ success_score_model.joblib")
    logger.info("═" * 55)
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    build_all(validate_only=args.validate, random_state=args.seed)


if __name__ == "__main__":
    main()
