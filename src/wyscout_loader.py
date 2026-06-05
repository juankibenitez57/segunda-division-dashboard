"""
Cargador automático de archivos Wyscout PLAYERS.

Detecta todos los .xlsx en data/wyscout/PLAYERS/ (y subdirectorios)
con el patrón  YY-YY_categoria.xlsx  (ej: 23-24_att.xlsx).
No requiere configuración manual: cualquier nuevo archivo compatible
es detectado automáticamente.
"""
import re
import logging
from pathlib import Path

import pandas as pd

from src.normalizer import normalize_club, normalize_player_name

logger = logging.getLogger(__name__)

# ── Patrón de nombre de archivo ───────────────────────────────────────────────
_FNAME_RE = re.compile(r'^(\d{2}-\d{2})_([a-zA-Z]+)\.xlsx$', re.IGNORECASE)

# ── Mapeo de columnas Wyscout → master ────────────────────────────────────────
COL_MAP = {
    'Jugador':              'jugador',
    'Equipo':               'equipo',
    'Posición específica':  'posicion_wyscout',
    'Edad':                 'edad',
    'Valor de mercado':     'valor_mercado',
    'Vencimiento contrato': 'vencimiento_contrato',
    'Partidos jugados':     'partidos_jugados',
    'Minutos jugados':      'minutos_jugados',
    'Goles':                'goles',
    'xG':                   'xg',
    'País de nacimiento':   'pais_nacimiento',
    'Pasaporte':            'pasaporte',
    'Pie':                  'pie',
    'Altura':               'altura',
    'Peso':                 'peso',
    'En préstamo':          'cesion',
}

# ── Códigos de posición Wyscout → categoría normalizada ──────────────────────
# Usamos el PRIMER código (posición principal) para la clasificación.
POS_CODE_MAP = {
    'GK':   'Portero',
    # Defensas
    'CB':   'Central',
    'LCB':  'Central',
    'RCB':  'Central',
    'LB':   'Lateral',
    'RB':   'Lateral',
    'LWB':  'Carrilero',
    'RWB':  'Carrilero',
    # Mediocampistas defensivos
    'DMF':  'Mediocentro',
    'LDMF': 'Mediocentro',
    'RDMF': 'Mediocentro',
    # Mediocampistas centrales
    'LCMF': 'Centrocampista',
    'RCMF': 'Centrocampista',
    # Mediocampistas ofensivos
    'AMF':  'Mediapunta',
    'LAMF': 'Mediapunta',
    'RAMF': 'Mediapunta',
    # Extremos
    'LW':   'Extremo',
    'RW':   'Extremo',
    'LWF':  'Extremo',
    'RWF':  'Extremo',
    # Delanteros
    'CF':   'Delantero',
    'SS':   'Delantero',
}

# Categoría de archivo → posición normalizada por defecto (si no hay código)
CATEGORY_DEFAULT = {
    'att': 'Delantero',
    'med': 'Centrocampista',
    'def': 'Defensa',
    'gk':  'Portero',
}


def _parse_filename(name: str) -> tuple[str, str] | None:
    """
    '23-24_att.xlsx' → ('2023-24', 'att')
    Devuelve None si el nombre no encaja con el patrón.
    """
    m = _FNAME_RE.match(name)
    if not m:
        return None
    short, cat = m.group(1), m.group(2).lower()
    yy = short[:2]
    temporada = f"20{yy}-{short[3:]}"   # '23-24' → '2023-24'
    return temporada, cat


def _normalize_position(raw: str, default_cat: str) -> tuple[str, str]:
    """
    'LCMF, DMF, RCMF' → posicion_primaria='LCMF', posicion_normalizada='Centrocampista'
    """
    if not raw:
        return '', CATEGORY_DEFAULT.get(default_cat, '')
    primary = str(raw).split(',')[0].strip()
    normalized = POS_CODE_MAP.get(primary, CATEGORY_DEFAULT.get(default_cat, primary))
    return primary, normalized


def load_all(directory: str | Path = 'data/wyscout') -> pd.DataFrame:
    """
    Carga todos los .xlsx compatibles en `directory` y subdirectorios.
    Devuelve un DataFrame unificado con los campos del master.

    Cualquier nuevo archivo con patrón YY-YY_cat.xlsx es detectado
    automáticamente sin modificar este código.
    """
    directory = Path(directory)
    xlsx_files = sorted(directory.rglob('*.xlsx'))
    # Ignorar archivos Zone.Identifier y el CSV de muestra
    xlsx_files = [f for f in xlsx_files
                  if ':' not in f.name and _FNAME_RE.match(f.name)]

    if not xlsx_files:
        logger.warning(f'No se encontraron archivos Wyscout compatibles en {directory}')
        return pd.DataFrame()

    frames = []
    for path in xlsx_files:
        parsed = _parse_filename(path.name)
        if not parsed:
            continue
        temporada, categoria = parsed
        try:
            df = _load_single(path, temporada, categoria)
            frames.append(df)
            logger.info(f'  ✓ {path.name}: {len(df)} registros → temporada={temporada}, cat={categoria}')
        except Exception as e:
            logger.error(f'  ✗ {path.name}: {e}')

    if not frames:
        return pd.DataFrame()

    master = pd.concat(frames, ignore_index=True)
    logger.info(f'Total Wyscout: {len(master):,} registros | {len(xlsx_files)} archivos')
    return master


def _load_single(path: Path, temporada: str, categoria: str) -> pd.DataFrame:
    df = pd.read_excel(path)

    # Renombrar columnas
    df.rename(columns=COL_MAP, inplace=True)

    # Añadir metadatos del archivo
    df['temporada']  = temporada
    df['categoria']  = categoria

    # Normalizar jugador y equipo
    df['jugador'] = df['jugador'].apply(
        lambda x: normalize_player_name(str(x)) if pd.notna(x) else ''
    )
    df['equipo'] = df['equipo'].apply(
        lambda x: normalize_club(str(x)) if pd.notna(x) else ''
    )

    # Normalizar posición
    pos_raw = df.get('posicion_wyscout', pd.Series([''] * len(df)))
    pos_results = pos_raw.apply(lambda x: _normalize_position(str(x) if pd.notna(x) else '', categoria))
    df['posicion_primaria']    = pos_results.apply(lambda t: t[0])
    df['posicion_normalizada'] = pos_results.apply(lambda t: t[1])

    # Normalizar cesión (sí/no → bool)
    if 'cesion' in df.columns:
        df['cesion'] = df['cesion'].apply(
            lambda x: True if str(x).strip().lower() in ('sí', 'si', 'yes', '1', 'true') else False
        )

    # Valor de mercado: asegurar que es numérico
    if 'valor_mercado' in df.columns:
        df['valor_mercado'] = pd.to_numeric(df['valor_mercado'], errors='coerce')

    # Eliminar filas sin jugador
    df = df[df['jugador'].str.strip() != ''].copy()

    return df
