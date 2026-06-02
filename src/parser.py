"""
Parser de HTML para la página global de transferencias de Transfermarkt.

Estructura verificada de la página:
  https://www.transfermarkt.com/segunda-division/transfers/wettbewerb/ES2/saison_id/YYYY

Cada club aparece en un <div class="box"> con <h2> = nombre del club.
Dentro: 2 tablas (arrivals primero, departures segundo), cada una con 9 columnas:
  Col 0: Jugador (nombre completo en <span class="hide-for-small">)
  Col 1: Edad    (clase alter-transfer-cell)
  Col 2: Nac.    (img title = país)
  Col 3: Posición (clase pos-transfer-cell)
  Col 4: Pos. abrev (clase kurzpos-transfer-cell)
  Col 5: Valor de mercado (clase mw-transfer-cell)
  Col 6: Logo club origen/destino (img title = nombre club)
  Col 7: Club + bandera país (clase verein-flagge-transfer-cell)
  Col 8: Importe / tipo (clase rechts, texto del <a>)
"""
import re
import logging
from typing import Optional
from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

SEASON_LABELS = {
    2021: "2021-22",
    2022: "2022-23",
    2023: "2023-24",
    2024: "2024-25",
    2025: "2025-26",
}

# Patrón para fecha embebida en celdas de importe (ej. "End of loan30/06/2025")
_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})")


# ── Conversión de importe a número ────────────────────────────────────────────

def _amount_to_number(text: str) -> Optional[float]:
    """
    Convierte una cadena de importe monetario a float.
    Formatos soportados (verificados con HTML real de Transfermarkt):
      €1.00m, €23m      → millones
      €200k, €750k      → miles (formato k)
      €750Th., €750th   → miles (formato Th., páginas antiguas)
    Devuelve None si no es parseable.
    """
    clean = re.sub(r"[€$£\s]", "", text).strip()
    if not clean:
        return None

    m = re.match(r"^([\d.]+)[mM]$", clean)
    if m:
        return float(m.group(1)) * 1_000_000

    m = re.match(r"^([\d.]+)[kK]$", clean)
    if m:
        return float(m.group(1)) * 1_000

    m = re.match(r"^([\d.]+)[Tt][Hh]\.?$", clean)
    if m:
        return float(m.group(1)) * 1_000

    try:
        return float(clean)
    except ValueError:
        return None


# ── Helpers de parsing ────────────────────────────────────────────────────────

def _player_name(cell: Tag) -> str:
    span = cell.find("span", {"class": "hide-for-small"})
    if span:
        a = span.find("a")
        if a:
            return a.get("title") or a.get_text(strip=True)
    a = cell.find("a", title=True)
    return a["title"] if a else cell.get_text(strip=True).split("\n")[0].strip()


def _club_and_country(cell_logo: Tag, cell_text: Tag) -> tuple[str, str]:
    """Devuelve (club_name, country_name) desde las celdas de club/bandera."""
    club = ""
    img_logo = cell_logo.find("img")
    if img_logo:
        club = img_logo.get("title", "") or img_logo.get("alt", "")

    country = ""
    img_flag = cell_text.find("img")
    if img_flag:
        country = img_flag.get("title", "")

    if not club:
        club = cell_text.get_text(strip=True)

    return club.strip(), country.strip()


def _parse_fee(cell: Tag) -> tuple[str, Optional[float], str, str]:
    """
    Devuelve (importe_original, importe_numerico, tipo_operacion, fecha).

    importe_original: texto exacto de Transfermarkt (sin fecha embebida).
    importe_numerico: valor float para ordenar en Excel (None si no aplica).

    Patrones conocidos (verificados con HTML real):
      "€200k", "€1.00m"         → traspaso
      "free transfer"            → libre, 0
      "loan transfer"            → cesión, 0
      "Loan fee:€100k"           → cesión, 100000
      "End of loan30/06/2025"    → retorno de cesión, 0, fecha extraída
      "-", "?"                   → desconocido, None
    """
    raw   = cell.get_text(strip=True)
    lower = raw.lower()

    if not raw or raw in ("-", "?"):
        return "-", None, "desconocido", "-"

    if lower.startswith("end of loan"):
        m = _DATE_RE.search(raw)
        fecha = m.group(1) if m else "-"
        return "End of loan", 0.0, "retorno de cesión", fecha

    if lower == "free transfer":
        return "free transfer", 0.0, "libre", "-"

    if lower == "loan transfer":
        return "loan transfer", 0.0, "cesión", "-"

    if lower.startswith("loan fee:"):
        amount_str = raw[len("Loan fee:"):].strip()
        num = _amount_to_number(amount_str)
        return f"Loan fee: {amount_str}", num, "cesión", "-"

    if re.search(r"[€$£][\d]", raw) or re.search(r"\d+[km]\b", raw, re.I):
        return raw, _amount_to_number(raw), "traspaso", "-"

    return raw, None, "otro", "-"


# ── Parser principal ──────────────────────────────────────────────────────────

def extract_clubs(soup: BeautifulSoup, season_id: int) -> list[dict]:
    """
    Extrae la lista de clubes y sus IDs desde la página global de competición.
    Retorna lista de {'name': str, 'club_id': str}.
    """
    clubs = []
    seen  = set()

    for box in soup.find_all("div", {"class": "box"}):
        h2 = box.find("h2")
        if not h2:
            continue
        name = h2.get_text(strip=True)
        if not name or name in ("Transfer record", ""):
            continue

        # club_id desde el enlace en el H2 (ej. /real-valladolid/transfers/verein/366/...)
        club_id = "-"
        link = h2.find("a", href=re.compile(r"/verein/\d+"))
        if link:
            m = re.search(r"/verein/(\d+)", link["href"])
            if m:
                club_id = m.group(1)

        if club_id not in seen:
            seen.add(club_id)
            clubs.append({"name": name, "club_id": club_id})

    season_label = SEASON_LABELS.get(season_id, str(season_id))
    logger.info(f"Temporada {season_label}: {len(clubs)} clubes encontrados")
    return clubs


def extract_transfers(soup: BeautifulSoup, season_id: int) -> list[dict]:
    """
    Extrae TODOS los movimientos (altas y bajas) de TODOS los clubes
    a partir de la página global de la competición.
    """
    season_label = SEASON_LABELS.get(season_id, str(season_id))
    records: list[dict] = []

    for box in soup.find_all("div", {"class": "box"}):
        h2 = box.find("h2")
        if not h2:
            continue
        club_name = h2.get_text(strip=True)
        if not club_name or club_name in ("Transfer record", ""):
            continue

        tables = box.find_all("table")
        if len(tables) < 2:
            logger.debug(f"Solo {len(tables)} tabla(s) en {club_name} – omitiendo")
            continue

        # Tabla 0 = altas, Tabla 1 = bajas
        for table_idx, movimiento in ((0, "alta"), (1, "baja")):
            table = tables[table_idx]
            rows  = table.find_all("tr")[1:]  # omitir cabecera

            for row in rows:
                record = _parse_row(row, club_name, season_label, movimiento)
                if record:
                    records.append(record)

    logger.info(f"Temporada {season_label}: {len(records)} movimientos extraídos")
    return records


def _parse_row(
    row: Tag,
    club_name: str,
    season_label: str,
    movimiento: str,
) -> Optional[dict]:
    cells = row.find_all("td")
    if len(cells) < 9:
        return None

    jugador = _player_name(cells[0])
    if not jugador:
        return None

    edad         = cells[1].get_text(strip=True) or "-"
    nats         = [img.get("title", "") for img in cells[2].find_all("img") if img.get("title")]
    nacionalidad = nats[0] if nats else "-"
    posicion     = cells[3].get_text(strip=True) or "-"
    valor_merc   = cells[5].get_text(strip=True) or "-"

    club_od, pais_od = _club_and_country(cells[6], cells[7])
    importe_orig, importe_num, tipo_op, fecha = _parse_fee(cells[8])

    if movimiento == "alta":
        club_origen  = club_od or "-"
        club_destino = club_name
    else:
        club_origen  = club_name
        club_destino = club_od or "-"

    return {
        "temporada":        season_label,
        "club":             club_name,
        "jugador":          jugador,
        "movimiento":       movimiento,
        "club_origen":      club_origen,
        "club_destino":     club_destino,
        "pais_club":        pais_od or "-",
        "fecha":            fecha,
        "importe_original": importe_orig,
        "importe_numerico": importe_num,
        "tipo_operacion":   tipo_op,
        "valor_mercado":    valor_merc,
        "posicion":         posicion,
        "edad":             edad,
        "nacionalidad":     nacionalidad,
    }
