"""
Importador de exportaciones CSV de Wyscout.

Wyscout genera diferentes formatos según el tipo de exportación.
Este módulo detecta el formato y normaliza al esquema del master.

Formatos soportados:
  - Wyscout "Players" export (estadísticas de jugador por temporada)
  - Wyscout "Teams" export (estadísticas por equipo)
  - CSV manual con cabeceras equivalentes

Uso:
  from src.wyscout_importer import import_wyscout_file, import_all_wyscout
"""
import csv
import logging
from pathlib import Path
from typing import Optional

from src.normalizer import normalize_club, normalize_player_name, normalize_position

logger = logging.getLogger(__name__)

# ── Mapeo de cabeceras Wyscout → campos master ────────────────────────────────
# Wyscout usa varios idiomas y versiones; listamos las variantes conocidas.
HEADER_MAP: dict[str, str] = {
    # Jugador
    "player":            "nombre",
    "player name":       "nombre",
    "full name":         "nombre",
    "nombre":            "nombre",
    # Equipo / Club
    "team":              "club",
    "team name":         "club",
    "club":              "club",
    "equipo":            "club",
    # Temporada
    "season":            "temporada",
    "temporada":         "temporada",
    # Entrenador
    "coach":             "entrenador",
    "manager":           "entrenador",
    "entrenador":        "entrenador",
    # Posición
    "position":          "posicion",
    "primary position":  "posicion",
    "posición":          "posicion",
    "posicion":          "posicion",
    "role":              "posicion",
    # Edad / Fecha nacimiento
    "age":               "edad",
    "edad":              "edad",
    "birth date":        "fecha_nacimiento",
    "date of birth":     "fecha_nacimiento",
    "dob":               "fecha_nacimiento",
    # Participación
    "matches played":    "partidos",
    "matches":           "partidos",
    "games":             "partidos",
    "apps":              "partidos",
    "partidos":          "partidos",
    "appearances":       "partidos",
    "starts":            "titularidades",
    "titularidades":     "titularidades",
    "minutes":           "minutos",
    "minutes played":    "minutos",
    "min":               "minutos",
    "minutos":           "minutos",
    # Producción
    "goals":             "goles",
    "goles":             "goles",
    "assists":           "asistencias",
    "asistencias":       "asistencias",
    # Disciplina
    "yellow cards":      "amarillas",
    "yellow":            "amarillas",
    "red cards":         "rojas",
    "red":               "rojas",
    # Nacionalidad
    "nationality":       "nacionalidad",
    "nationalidad":      "nacionalidad",
    "nacionalidad":      "nacionalidad",
    "passport country":  "nacionalidad",
    # Fuente (columna opcional en CSV manual)
    "source":            "fuente",
    "fuente":            "fuente",
}

REQUIRED_OUTPUT_FIELDS = [
    "nombre", "club", "temporada", "posicion", "posicion_es",
    "edad", "fecha_nacimiento", "partidos", "titularidades", "minutos",
    "goles", "asistencias", "amarillas", "rojas",
    "entrenador", "nacionalidad", "fuente",
]


def _detect_delimiter(filepath: Path) -> str:
    """Detecta el separador del CSV (coma o punto y coma)."""
    with open(filepath, encoding="utf-8-sig") as f:
        sample = f.read(2048)
    return ";" if sample.count(";") > sample.count(",") else ","


def _map_headers(raw_headers: list[str]) -> dict[str, str]:
    """Mapea cabeceras del CSV a nombres de campo master."""
    mapping = {}
    for h in raw_headers:
        key = h.strip().lower().replace("_", " ")
        if key in HEADER_MAP:
            mapping[h] = HEADER_MAP[key]
    return mapping


def import_wyscout_file(filepath: str | Path, default_season: str = "") -> list[dict]:
    """
    Parsea un CSV de Wyscout y devuelve lista de registros normalizados.

    Args:
        filepath:       Ruta al archivo CSV exportado de Wyscout.
        default_season: Temporada por defecto si el CSV no la incluye (ej. "2023-24").

    Returns:
        Lista de dicts con campos del esquema master (campos faltantes = None).
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"No se encontró: {filepath}")

    delimiter = _detect_delimiter(filepath)
    records = []

    with open(filepath, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        raw_headers = reader.fieldnames or []
        header_map = _map_headers(raw_headers)

        if not header_map:
            logger.warning(f"No se reconoció ninguna cabecera en {filepath.name}. "
                           f"Cabeceras encontradas: {raw_headers}")

        for row in reader:
            rec: dict = {field: None for field in REQUIRED_OUTPUT_FIELDS}
            rec["fuente"] = filepath.stem

            # Mapear campos conocidos
            for raw_col, mapped_col in header_map.items():
                val = (row.get(raw_col) or "").strip()
                if val and val not in ("-", "N/A", "n/a", ""):
                    rec[mapped_col] = val

            # Normalizar nombre jugador
            if rec["nombre"]:
                rec["nombre"] = normalize_player_name(rec["nombre"])
            else:
                continue  # fila sin jugador = saltar

            # Normalizar club
            if rec["club"]:
                rec["club"] = normalize_club(rec["club"])

            # Temporada por defecto
            if not rec["temporada"] and default_season:
                rec["temporada"] = default_season

            # Normalizar posición
            if rec["posicion"]:
                en, es = normalize_position(rec["posicion"])
                rec["posicion"]    = en
                rec["posicion_es"] = es
            else:
                rec["posicion_es"] = None

            # Convertir numéricos
            for num_field in ["edad", "partidos", "titularidades", "minutos",
                              "goles", "asistencias", "amarillas", "rojas"]:
                raw = rec.get(num_field)
                if raw is not None:
                    try:
                        rec[num_field] = float(str(raw).replace(",", "."))
                    except ValueError:
                        rec[num_field] = None

            records.append(rec)

    logger.info(f"Wyscout {filepath.name}: {len(records)} registros importados")
    return records


def import_all_wyscout(directory: str | Path = "data/wyscout",
                       default_season: str = "") -> list[dict]:
    """
    Importa todos los CSV de Wyscout en un directorio.

    Args:
        directory:      Carpeta con archivos CSV de Wyscout.
        default_season: Temporada por defecto si los CSV no la incluyen.

    Returns:
        Lista combinada de todos los registros.
    """
    directory = Path(directory)
    all_records: list[dict] = []

    csv_files = sorted(directory.glob("*.csv"))
    if not csv_files:
        logger.info(f"No se encontraron CSV en {directory}")
        return []

    for f in csv_files:
        try:
            records = import_wyscout_file(f, default_season)
            all_records.extend(records)
        except Exception as e:
            logger.error(f"Error importando {f.name}: {e}")

    logger.info(f"Total registros Wyscout: {len(all_records)} de {len(csv_files)} archivo(s)")
    return all_records
