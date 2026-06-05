# Pipeline de datos — Betis Scouting

Documentación del flujo completo: desde la captura de datos hasta el dashboard.

## Arquitectura en 3 capas

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  TU PC      │     │  GitHub (repo)   │     │  Desplegado         │
│  (local)    │     │                  │     │                     │
│             │     │                  │     │                     │
│ scrapers +  │ ──> │ CSVs + código    │ ──> │ GitHub Pages        │
│ modelos ML  │     │ (NO binarios)    │     │ (dashboard estático)│
│             │     │                  │     │                     │
│             │     │                  │     │ Render (proxy IA +  │
│             │     │                  │     │  Transfermarkt)     │
└─────────────┘     └──────────────────┘     └─────────────────────┘
```

**Regla clave:** en git van **datos (CSV) y código**, nunca artefactos compilados
(`.joblib`, `__pycache__`, `.log`). Estos se regeneran desde el código.

---

## Orden de ejecución del pipeline (en local)

Ejecuta en este orden cuando actualices datos. Cada script genera entradas del siguiente.

| # | Script | Lee | Genera |
|---|--------|-----|--------|
| 1 | `python3 main.py` | Transfermarkt (web) | `segunda_division_fichajes_*.csv` |
| 2 | `python3 fetch_market_values.py` | HTML cacheado | `jugador_ids.csv`, `historico_valores.csv` |
| 3 | `python3 build_wyscout_master.py` | `data/wyscout/PLAYERS/*.xlsx` | `master_wyscout_players.csv` |
| 4 | `python3 build_master.py` | fichajes + revalorización + Wyscout + coaches | `master_player_development.csv` |
| 5 | `python3 build_development_evidence.py` | master | `development_*_evidence.csv` |
| 6 | `python3 build_loan_destination_model.py` | JUGADORES BETIS + evidencia | `betis_deportivo_players.csv`, `betis_loan_destination_model.csv` |
| 7 | `python3 build_rf_decision_model.py` | master + betis + evidencia | `historical_operation_events.csv`, `club_position_demand.csv`, `betis_rf_*.csv` |
| 8 | `python3 build_success_score.py` | `historical_operation_events.csv` | `historical_success_cases.csv`, `success_score_report.json`, **`success_score_model.joblib`** |
| 9 | `python3 build_betis_decisions.py` | success model + loan + demand + cases | `betis_decision_recommendations.csv/json` |

Después: `git add -A && git commit && git push` para que el dashboard lea los nuevos CSV.

---

## ¿Quién usa el modelo `success_score_model.joblib`?

| Componente | ¿Usa el .joblib? | Por qué |
|---|---|---|
| **Tu PC** (paso 9) | ✅ Sí | `build_betis_decisions.py` lo carga para predecir el success score de cada jugador |
| **Dashboard** (GitHub Pages) | ❌ No | Lee directamente `betis_decision_recommendations.csv`, ya calculado |
| **Render** (proxy ScoutGPT) | ❌ No | Solo hace de puente con Gemini y Transfermarkt; no ejecuta modelos |

**Por eso el `.joblib` NO se sube a ningún sitio.** Es un artefacto intermedio
que solo vive en tu PC durante los pasos 8→9. Está en `.gitignore` y se regenera
de forma determinista (`random_state=42`) ejecutando `python3 build_success_score.py`.

---

## operation_success_score (variable objetivo del sistema de decisión)

Escala 0-100. Combina 4 dimensiones con **pesos auto-ajustables** (si falta una
dimensión, su peso se reparte entre las disponibles):

| Dimensión | Peso base | Fuente |
|---|---|---|
| Desarrollo (minutos) | 40% | Wyscout |
| Mercado (revalorización %) | 25% | Transfermarkt |
| Rendimiento (goles + xG/90) | 20% | Wyscout |
| Progresión (rev. positiva + bonus) | 15% | Transfermarkt |

Definición completa e importancias del Random Forest en `data/final/success_score_report.json`.

---

## Dónde está desplegado

- **Dashboard:** https://juankibenitez57.github.io/segunda-division-dashboard/
- **Proxy IA/Transfermarkt:** https://segunda-division-dashboard.onrender.com
  - Variable de entorno en Render: `GEMINI_API_KEY` (NO se commitea nunca)
