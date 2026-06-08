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
| 8 | `python3 build_operation_model_dataset.py` | master + `historical_operation_events.csv` | `player_operation_model_dataset.csv`, `player_operation_model_report.json`, **`operation_success_v2_model.joblib`** |
| 9 | `python3 build_success_score.py` | `historical_operation_events.csv` | `historical_success_cases.csv`, `success_score_report.json`, **`success_score_model.joblib`** |
| 10 | `python3 build_betis_decisions.py` | success model + loan + demand + cases + modelo v2 | `betis_decision_recommendations.csv/json`, `betis_v2_destination_recommendations.csv` |

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

## player_operation_model_dataset.csv (dataset ML de operaciones)

Es la tabla de entrenamiento más completa para estudiar operaciones históricas.
Cada fila representa **jugador + temporada + club + operación** e incorpora:

| Bloque | Ejemplos |
|---|---|
| Foto previa | club anterior, temporada previa, edad, valor, minutos, goles, xG |
| Contexto destino | club, entrenador, demanda club-posición, minutos Sub23 en esa posición |
| Resultado misma temporada | partidos, minutos, goles, xG, revalorización |
| Seguimiento posterior | club siguiente, minutos siguientes, delta de valor, delta de minutos |
| Etiquetas | `loan_success_label`, `sale_success_label`, `operation_success_score_v2`, `label_confidence` |

La validación del modelo v2 evita fuga de información: el entrenamiento usa solo
variables disponibles **antes** de tomar la decisión (`pre_operation_only`) y excluye
minutos/goles/xG/revalorización de la temporada de destino. Por eso sus métricas son
más realistas y menos infladas que un modelo que aprende del resultado ya observado.

Definición completa en `data/final/player_operation_model_report.json`.

---

## Clubes válidos de Segunda (actualizar cada temporada)

Los destinos de cesión/venta se filtran a los **22 clubes que militan en Segunda
en la temporada vigente**. La lista está en `src/normalizer.py` → `SEGUNDA_2025_26`.

**Cada temporada nueva:** edita ese conjunto con los 22 equipos de LaLiga Hypermotion
y reejecuta los pasos 6→9. Así el sistema nunca recomienda clubes que han ascendido
(p. ej. Levante, ahora en Primera) o descendido.

> Nota: la columna "Entren. Sub-23 (hist.)" en los destinos muestra el entrenador que
> MÁS desarrolló jóvenes en ese club históricamente (evidencia), NO necesariamente el
> entrenador actual. Es un indicador de cultura de club, no un dato de plantilla viva.

---

## Dónde está desplegado

- **Dashboard:** https://juankibenitez57.github.io/segunda-division-dashboard/
- **Proxy IA/Transfermarkt:** https://segunda-division-dashboard.onrender.com
  - Variable de entorno en Render: `GEMINI_API_KEY` (NO se commitea nunca)

---

## Arquitectura multi-liga (preparada)

El dashboard está preparado para alojar **varias ligas que conviven** y se pueden
comparar, manteniendo la experiencia de trabajar una liga en profundidad.

### Cómo funciona
- `script.js` define un **registro `LEAGUES`** (id → nombre, carpeta de datos, temporada).
- Todo el código de "main" usa `dataPath(archivo)`, que resuelve a la carpeta de la
  **liga activa** (`ACTIVE_LEAGUE`). No hay rutas de datos hardcodeadas.
- El **selector "Liga"** de la cabecera se puebla solo desde `LEAGUES`. Al cambiar,
  recarga con estado limpio (recuerda la elección en sessionStorage).
- Segunda vive en `data/final/` (su carpeta histórica). Nuevas ligas van en
  `data/leagues/<id>/`.

### Añadir una liga nueva (sin tocar funciones de main)
1. Genera sus CSV con la **misma estructura** en `data/leagues/<id>/`
   (mismos nombres de archivo que Segunda: master_wyscout_players.csv,
   development_club_evidence.csv, club_position_demand.csv, etc.).
2. Añade una entrada al registro `LEAGUES` en `script.js`:
   ```js
   primera: { nombre: 'Primera División', pais: 'España',
              dataDir: 'data/leagues/primera', temporadaActual: '2025-26',
              fichajesFile: 'primera_division_fichajes.csv' },
   ```
3. Listo: aparece en el selector. El código de main no se toca.

### Para comparar entre ligas (fase futura)
Cuando haya 2+ ligas, se podrá cargar el master de cada una y cruzarlas. La capa de
datos ya es agnóstica; solo faltará la UI de comparación.
