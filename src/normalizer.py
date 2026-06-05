"""
Normalización de nombres de clubes, jugadores y posiciones.
Garantiza que fuentes distintas (TM, Wyscout, CSV manual) converjan
al mismo identificador canónico.
"""
import re
import unicodedata
from difflib import get_close_matches

# ── Mapa canónico de clubes ────────────────────────────────────────────────────
# Clave = nombre canónico (el que usamos en el dataset maestro)
# Valor = lista de variantes conocidas
CLUB_ALIASES: dict[str, list[str]] = {
    "AD Alcorcón":            ["Alcorcón", "AD Alcorcon", "Alcorcon"],
    "AD Ceuta FC":            ["Ceuta", "AD Ceuta"],
    "Albacete Balompié":      ["Albacete", "Albacete BP"],
    "Burgos CF":              ["Burgos"],
    "CD Castellón":           ["Castellón", "Castellon"],
    "CD Eldense":             ["Eldense"],
    "CD Leganés":             ["Leganés", "Leganes", "CD Leganes"],
    "CD Lugo":                ["Lugo"],
    "CD Mirandés":            ["Mirandés", "Mirandes"],
    "CD Tenerife":            ["Tenerife"],
    "CF Fuenlabrada":         ["Fuenlabrada"],
    "Cultural Leonesa":       ["Cultural León", "Cultural Leon", "Cultural"],
    "Cádiz CF":               ["Cádiz", "Cadiz", "Cadiz CF"],
    "Córdoba CF":             ["Córdoba", "Cordoba", "Cordoba CF"],
    "Deportivo Alavés":       ["Alavés", "Alaves", "D. Alavés"],
    "Deportivo de La Coruña": ["Deportivo", "RC Deportivo", "Depor", "La Coruña", "Deportivo La Coruña"],
    "Elche CF":               ["Elche"],
    "FC Andorra":             ["Andorra"],
    "FC Cartagena":           ["Cartagena"],
    "Girona FC":              ["Girona"],
    "Granada CF":             ["Granada"],
    "Levante UD":             ["Levante"],
    "Málaga CF":              ["Málaga", "Malaga", "Malaga CF"],
    "RCD Espanyol Barcelona": ["Espanyol", "RCD Espanyol", "Espanyol B."],
    "Racing Ferrol":          ["Racing de Ferrol", "R. Ferrol"],
    "Racing Santander":       ["Racing", "Racing de Santander", "R. Santander"],
    "Real Oviedo":            ["Oviedo"],
    "Real Sociedad B":        ["Real Sociedad II", "R. Sociedad B"],
    "Real Valladolid CF":     ["Valladolid", "R. Valladolid", "Real Valladolid"],
    "Real Zaragoza":          ["Zaragoza", "R. Zaragoza", "Real Zaragoza CF", "R Zaragoza"],
    "SD Amorebieta":          ["Amorebieta"],
    "SD Eibar":               ["Eibar", "S.D. Eibar"],
    "SD Huesca":              ["Huesca"],
    "SD Ponferradina":        ["Ponferradina", "Ponfe"],
    "Sporting Gijón":         ["Sporting", "Sporting de Gijón", "Sp. Gijón"],
    "UD Almería":             ["Almería", "Almeria", "UD Almeria"],
    "UD Ibiza":               ["Ibiza"],
    "UD Las Palmas":          ["Las Palmas"],
    "Villarreal CF B":        ["Villarreal B", "Villarreal II"],
    # Wyscout suele usar nombres en inglés para clubes extranjeros
    "Real Betis":             ["R. Betis", "Betis", "Real Betis Balompié"],
    "Real Betis B":           ["Betis B", "Betis Deportivo", "Real Betis II"],
}

def _strip(s: str) -> str:
    """Normaliza para comparación: minúsculas, sin acentos, sin puntuación."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


# Re-construir índice usando _strip (ahora que está definida)
_ALIAS_INDEX = {}
for canonical, aliases in CLUB_ALIASES.items():
    _ALIAS_INDEX[_strip(canonical)] = canonical
    for alias in aliases:
        _ALIAS_INDEX[_strip(alias)] = canonical

_ALL_CANONICALS = list(CLUB_ALIASES.keys())

# Clubes que militan en Segunda División en la temporada vigente (2025-26).
# Solo estos son destinos válidos de cesión/venta dentro de la categoría.
# Actualizar cada temporada con los 22 equipos de LaLiga Hypermotion.
SEGUNDA_2025_26 = {
    "AD Ceuta FC", "Albacete Balompié", "Burgos CF", "CD Castellón", "CD Leganés",
    "CD Mirandés", "Cultural Leonesa", "Cádiz CF", "Córdoba CF", "Deportivo de La Coruña",
    "FC Andorra", "Granada CF", "Málaga CF", "Racing Santander", "Real Sociedad B",
    "Real Valladolid CF", "Real Zaragoza", "SD Eibar", "SD Huesca", "Sporting Gijón",
    "UD Almería", "UD Las Palmas",
}


def is_segunda_actual(club: str) -> bool:
    """True si el club milita en Segunda División 2025-26."""
    return normalize_club(club) in SEGUNDA_2025_26


def normalize_club(name: str) -> str:
    """
    Devuelve el nombre canónico del club.
    Prueba coincidencia exacta normalizada, luego fuzzy matching.
    """
    if not name:
        return name
    key = _strip(name)
    if key in _ALIAS_INDEX:
        return _ALIAS_INDEX[key]

    # Fuzzy fallback
    candidates = {_strip(c): c for c in _ALL_CANONICALS}
    matches = get_close_matches(key, candidates.keys(), n=1, cutoff=0.75)
    if matches:
        return candidates[matches[0]]

    return name  # sin cambios si no hay match


# ── Posiciones ─────────────────────────────────────────────────────────────────
# Mapeo Wyscout → posición canónica del proyecto
WYSCOUT_POS: dict[str, str] = {
    # Porteros
    "GK": "Goalkeeper",
    "Goalkeeper": "Goalkeeper",
    # Defensas
    "CB": "Centre-Back",
    "Centre-Back": "Centre-Back",
    "RB": "Right-Back",
    "Right Back": "Right-Back",
    "LB": "Left-Back",
    "Left Back": "Left-Back",
    "RWB": "Right-Back",
    "LWB": "Left-Back",
    # Medios
    "DM": "Defensive Midfield",
    "Defensive Midfielder": "Defensive Midfield",
    "CM": "Central Midfield",
    "Central Midfielder": "Central Midfield",
    "AM": "Attacking Midfield",
    "Attacking Midfielder": "Attacking Midfield",
    "RM": "Right Midfield",
    "LM": "Left Midfield",
    # Extremos
    "RW": "Right Winger",
    "Right Winger": "Right Winger",
    "LW": "Left Winger",
    "Left Winger": "Left Winger",
    # Delanteros
    "CF": "Centre-Forward",
    "ST": "Centre-Forward",
    "Centre Forward": "Centre-Forward",
    "Striker": "Centre-Forward",
    "SS": "Second Striker",
    "Second Striker": "Second Striker",
}

POS_ES: dict[str, str] = {
    "Goalkeeper":         "Portero",
    "Centre-Back":        "Central",
    "Right-Back":         "Lateral Der.",
    "Left-Back":          "Lateral Izq.",
    "Defensive Midfield": "Centrocampista",
    "Central Midfield":   "Centrocampista",
    "Right Midfield":     "Centrocampista",
    "Left Midfield":      "Centrocampista",
    "Attacking Midfield": "Mediapunta",
    "Right Winger":       "Extremo Der.",
    "Left Winger":        "Extremo Izq.",
    "Centre-Forward":     "Delantero",
    "Second Striker":     "Delantero",
}


def normalize_position(pos: str) -> tuple[str, str]:
    """Devuelve (posicion_en, posicion_es)."""
    en = WYSCOUT_POS.get(pos, pos)
    es = POS_ES.get(en, en)
    return en, es


DEVELOPMENT_POSITION_ALIASES: dict[str, str] = {
    # Delanteros
    "centre forward": "Delantero",
    "centre-forward": "Delantero",
    "center forward": "Delantero",
    "center-forward": "Delantero",
    "delantero centro": "Delantero",
    "segundo delantero": "Delantero",
    "second striker": "Delantero",
    "striker": "Delantero",
    "cf": "Delantero",
    "st": "Delantero",
    "ss": "Delantero",
    # Extremos
    "left winger": "Extremo",
    "right winger": "Extremo",
    "extremo izquierdo": "Extremo",
    "extremo derecho": "Extremo",
    "extremo izq": "Extremo",
    "extremo der": "Extremo",
    "lw": "Extremo",
    "rw": "Extremo",
    "lwf": "Extremo",
    "rwf": "Extremo",
    # Mediocentros / centrocampistas
    "pivote": "Mediocentro",
    "defensive midfield": "Mediocentro",
    "defensive midfielder": "Mediocentro",
    "mediocentro defensivo": "Mediocentro",
    "dm": "Mediocentro",
    "dmf": "Mediocentro",
    "ldmf": "Mediocentro",
    "rdmf": "Mediocentro",
    "mediocentro": "Centrocampista",
    "central midfield": "Centrocampista",
    "central midfielder": "Centrocampista",
    "centrocampista": "Centrocampista",
    "cm": "Centrocampista",
    "lcmf": "Centrocampista",
    "rcmf": "Centrocampista",
    "attacking midfield": "Mediapunta",
    "attacking midfielder": "Mediapunta",
    "mediapunta": "Mediapunta",
    "am": "Mediapunta",
    "amf": "Mediapunta",
    # Defensas
    "centre back": "Central",
    "centre-back": "Central",
    "center back": "Central",
    "center-back": "Central",
    "central": "Central",
    "cb": "Central",
    "lcb": "Central",
    "rcb": "Central",
    "left back": "Lateral",
    "left-back": "Lateral",
    "right back": "Lateral",
    "right-back": "Lateral",
    "lateral izquierdo": "Lateral",
    "lateral derecho": "Lateral",
    "lb": "Lateral",
    "rb": "Lateral",
    "lwb": "Lateral",
    "rwb": "Lateral",
    # Porteros
    "goalkeeper": "Portero",
    "portero": "Portero",
    "gk": "Portero",
}


def normalize_development_position(pos: str, default: str | None = None) -> str | None:
    """
    Bucket de posición para análisis de desarrollo.
    Devuelve categorías comparables entre TM y Wyscout.
    """
    if not pos:
        return default
    key = _strip(str(pos))
    if key in DEVELOPMENT_POSITION_ALIASES:
        return DEVELOPMENT_POSITION_ALIASES[key]

    # Wyscout a veces concatena posiciones: "LCMF, DMF, RCMF".
    primary = key.split()[0] if "," not in str(pos) else _strip(str(pos).split(",")[0])
    if primary in DEVELOPMENT_POSITION_ALIASES:
        return DEVELOPMENT_POSITION_ALIASES[primary]

    return default if default is not None else str(pos).strip()


# ── Jugadores ──────────────────────────────────────────────────────────────────
def normalize_player_name(name: str) -> str:
    """Limpia espacios y capitalización."""
    if not name:
        return ""
    return " ".join(w.capitalize() for w in name.strip().split())


def player_key(name: str) -> str:
    """Clave de comparación para detectar duplicados de nombre."""
    return _strip(name)
