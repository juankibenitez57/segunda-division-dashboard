#!/usr/bin/env python3
"""
ScoutGPT Proxy — servidor local que actúa de puente entre el dashboard
y Transfermarkt, evitando los bloqueos CORS del navegador.

Uso:
  pip install flask
  python3 scoutgpt_proxy.py

El servidor arranca en http://localhost:5050
Déjalo corriendo mientras usas el dashboard.
"""
import os
import random
import re
import time
import logging
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request

# Proveedores de IA (opcionales — el proxy funciona sin ellos)
try:
    from groq import Groq as GroqClient
    _groq_available = True
except ImportError:
    _groq_available = False

# ── Config ────────────────────────────────────────────────────────────────────
PORT    = int(os.environ.get("PORT", 5050))
BASE_TM = "https://www.transfermarkt.com"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("proxy")

app = Flask(__name__)

# ── CORS (permite llamadas desde cualquier origen, incluido GitHub Pages) ─────
@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# ── HTTP Session hacia TM ──────────────────────────────────────────────────────
_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language":    "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding":    "gzip, deflate, br",
    "Referer":            BASE_TM + "/",
    "Connection":         "keep-alive",
})
_last_request_time = 0.0


def _fetch_html(url: str, extra_headers: dict | None = None) -> BeautifulSoup | None:
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < 2.5:
        time.sleep(2.5 - elapsed + random.uniform(0.2, 0.8))

    headers = {}
    if extra_headers:
        headers.update(extra_headers)

    try:
        resp = _session.get(url, headers=headers, timeout=15)
        _last_request_time = time.time()
        if resp.status_code == 429:
            logger.warning("TM rate limit (429) — esperando 60s …")
            time.sleep(60)
            resp = _session.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        return BeautifulSoup(resp.content, "html.parser")
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return None


def _fetch_json(url: str) -> dict | None:
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < 2.5:
        time.sleep(2.5 - elapsed + random.uniform(0.2, 0.8))
    try:
        resp = _session.get(url, headers={
            "Accept":           "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        }, timeout=15)
        _last_request_time = time.time()
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error(f"Error JSON {url}: {e}")
        return None


# ── Parsers ───────────────────────────────────────────────────────────────────

_ID_RE = re.compile(r"/spieler/(\d+)")
_MV_RE = re.compile(r"([\d.,]+)\s*(Mio\.|k)\s*€")


def _parse_mv_text(text: str) -> int | None:
    """Convierte '12,50 Mio. €' o '650 k €' a entero en euros."""
    m = _MV_RE.search(text.replace("\xa0", " "))
    if not m:
        return None
    num = float(m.group(1).replace(".", "").replace(",", "."))
    return int(num * 1_000_000) if "Mio" in m.group(2) else int(num * 1_000)


def parse_player_search(soup: BeautifulSoup) -> list[dict]:
    """
    Parsea los resultados de búsqueda de jugadores de TM.
    Estructura: tabla con clase 'items' dentro de la sección de jugadores.
    """
    players = []
    # TM usa varias tablas items; la de jugadores viene tras el h2 "Players"
    for section in soup.find_all("div", {"class": "box"}):
        h2 = section.find("h2")
        if not h2:
            continue
        # Buscar la sección de jugadores (Players / Jugadores)
        heading = h2.get_text(strip=True).lower()
        if "player" not in heading and "jugador" not in heading and "spieler" not in heading:
            continue
        table = section.find("table", {"class": "items"})
        if not table:
            continue
        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            # Celda nombre
            name_cell = cells[1] if len(cells) > 1 else cells[0]
            a_name = name_cell.find("a", href=_ID_RE)
            if not a_name:
                continue
            name    = a_name.get_text(strip=True)
            href    = a_name.get("href", "")
            m_id    = _ID_RE.search(href)
            pid     = m_id.group(1) if m_id else None
            if not pid:
                continue

            # Posición, edad, club, VM (columnas variables según TM)
            position    = cells[2].get_text(strip=True) if len(cells) > 2 else ""
            age_text    = cells[3].get_text(strip=True) if len(cells) > 3 else ""
            nationality = ""
            nat_img = cells[4].find("img") if len(cells) > 4 else None
            if nat_img:
                nationality = nat_img.get("title", "")
            club = cells[5].get_text(strip=True) if len(cells) > 5 else ""
            mv_text = cells[-1].get_text(strip=True) if cells else ""
            mv_num  = _parse_mv_text(mv_text)

            players.append({
                "id":          pid,
                "name":        name,
                "position":    position,
                "age":         age_text,
                "nationality": nationality,
                "club":        club,
                "market_value": mv_num,
                "mv_display":  mv_text if mv_num else "-",
                "profile_url": BASE_TM + href,
            })
            if len(players) >= 8:
                break
        if players:
            break

    # Fallback: búsqueda amplia en cualquier tabla si la sección no se encontró
    if not players:
        for table in soup.find_all("table", {"class": "items"}):
            for row in table.find_all("tr")[1:]:
                cells = row.find_all("td")
                if len(cells) < 4:
                    continue
                a_name = row.find("a", href=_ID_RE)
                if not a_name:
                    continue
                href = a_name.get("href", "")
                m_id = _ID_RE.search(href)
                if not m_id:
                    continue
                mv_text = cells[-1].get_text(strip=True)
                mv_num  = _parse_mv_text(mv_text)
                players.append({
                    "id":          m_id.group(1),
                    "name":        a_name.get_text(strip=True),
                    "position":    cells[2].get_text(strip=True) if len(cells) > 2 else "",
                    "age":         cells[3].get_text(strip=True) if len(cells) > 3 else "",
                    "nationality": "",
                    "club":        cells[5].get_text(strip=True) if len(cells) > 5 else "",
                    "market_value": mv_num,
                    "mv_display":  mv_text if mv_num else "-",
                    "profile_url": BASE_TM + href,
                })
                if len(players) >= 8:
                    break
            if players:
                break

    return players


def parse_player_profile(soup: BeautifulSoup, pid: str) -> dict:
    """Extrae datos básicos del perfil de un jugador."""
    result = {"id": pid}

    # Nombre
    h1 = soup.find("h1", {"class": re.compile("data-header")})
    if not h1:
        h1 = soup.find("h1", {"itemprop": "name"})
    if h1:
        result["name"] = h1.get_text(strip=True)

    # Info rápida (tabla de datos del perfil)
    for item in soup.find_all("li", {"class": "data-header__label"}):
        label = item.get_text(strip=True).lower()
        val_el = item.find_next_sibling() or item.find("span", {"class": "data-header__content"})
        val = val_el.get_text(strip=True) if val_el else ""
        if "date of birth" in label or "fecha" in label:
            result["dob"] = val
        elif "position" in label or "posici" in label:
            result["position"] = val
        elif "citizenship" in label or "nationalit" in label:
            result["nationality"] = val

    # Valor de mercado actual
    mv_el = soup.find("a", {"class": re.compile("data-header__market-value")})
    if mv_el:
        mv_text = mv_el.get_text(strip=True)
        result["market_value"] = _parse_mv_text(mv_text)
        result["mv_display"]   = mv_text

    # Club actual
    club_el = soup.find("span", {"class": re.compile("data-header__club")})
    if club_el:
        a = club_el.find("a")
        result["current_club"] = a.get_text(strip=True) if a else club_el.get_text(strip=True)

    return result


# ── Rutas API ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres ScoutGPT, asistente experto en análisis de mercado y desarrollo de talento de la Segunda División española (temporadas 2021-22 a 2025-26).
Tienes acceso a datos reales de:
- Fichajes, traspasos, cesiones y revalorizaciones (Transfermarkt).
- Rendimiento: minutos, partidos, goles, xG, valor de mercado (Wyscout).
- Entrenadores por club y temporada.
Responde SIEMPRE en español, de forma concisa y útil para un analista de scouting profesional.
Cuando hagas rankings o listas, usa formato: 1. **Nombre** — dato clave.
Basa tus respuestas EXCLUSIVAMENTE en los DATOS RELEVANTES proporcionados. Si no son suficientes, dilo claramente.
Máximo 40 líneas."""


def _ai_provider() -> str:
    """Devuelve el proveedor de IA disponible: 'gemini', 'groq' o ''."""
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("GROQ_API_KEY") and _groq_available:
        return "groq"
    return ""


# Modelos a probar en orden (free tier más generoso primero).
# Si el usuario fija GEMINI_MODEL, ese se prueba primero.
GEMINI_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash-8b",
]


def _ask_gemini(question: str, context: str) -> str:
    """Llama a Google Gemini vía REST (sin SDK). Prueba varios modelos ante 429."""
    key    = os.environ["GEMINI_API_KEY"]
    prompt = f"{SYSTEM_PROMPT}\n\nDATOS RELEVANTES:\n{context}\n\nPREGUNTA: {question}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1400},
    }

    forced = os.environ.get("GEMINI_MODEL")
    models = ([forced] if forced else []) + [m for m in GEMINI_MODELS if m != forced]

    last_err = None
    for model in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        try:
            r = requests.post(url, json=payload, timeout=30)
            if r.status_code == 429:
                last_err = f"429 en {model}"
                logger.warning(f"Gemini 429 con {model}, probando siguiente…")
                continue
            r.raise_for_status()
            data = r.json()
            logger.info(f"Gemini OK con modelo {model}")
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            last_err = str(e)
            logger.warning(f"Gemini error con {model}: {e}")
            continue

    raise RuntimeError(f"Todos los modelos Gemini fallaron. Último: {last_err}")


def _ask_groq(question: str, context: str) -> str:
    client = GroqClient(api_key=os.environ["GROQ_API_KEY"])
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"DATOS RELEVANTES:\n{context}\n\nPREGUNTA: {question}"},
        ],
        max_tokens=1200, temperature=0.2,
    )
    return response.choices[0].message.content


@app.route("/ask", methods=["POST", "OPTIONS"])
def ask():
    if request.method == "OPTIONS":
        return "", 204

    provider = _ai_provider()
    if not provider:
        return jsonify({"error": "No hay proveedor de IA configurado (GEMINI_API_KEY o GROQ_API_KEY)"}), 503

    body     = request.get_json(force=True) or {}
    question = body.get("question", "").strip()
    context  = body.get("context", "").strip()
    if not question:
        return jsonify({"error": "Pregunta vacía"}), 400

    try:
        if provider == "gemini":
            answer = _ask_gemini(question, context)
        else:
            answer = _ask_groq(question, context)
        logger.info(f"{provider} → {len(answer)} chars para: {question[:60]}")
        return jsonify({"answer": answer, "provider": provider})
    except Exception as e:
        logger.error(f"{provider} error: {e}")
        return jsonify({"error": str(e)}), 503


@app.route("/status")
def status():
    provider = _ai_provider()
    return jsonify({
        "ok": True, "source": "transfermarkt", "version": "2.1",
        "ai": bool(provider), "provider": provider or None,
    })


_photo_cache: dict[str, str] = {}   # spieler_id → photo URL

@app.route("/player-photo/<pid>")
def player_photo_url(pid: str):
    """
    Devuelve la URL de la foto de un jugador de TM.
    Busca en el HTML del perfil la etiqueta og:image o la primera imagen
    del jugador. Cachea el resultado para no repetir peticiones.
    """
    if pid in _photo_cache:
        return jsonify({"url": _photo_cache[pid]})

    url  = f"{BASE_TM}/x/profil/spieler/{pid}"
    soup = _fetch_html(url)
    photo_url = None

    if soup:
        # 1. og:image (más fiable)
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            photo_url = og["content"]
        # 2. img con clase data-main-header-img
        if not photo_url:
            img = soup.find("img", {"class": re.compile(r"data-main|tm-foto|main-foto")})
            if img:
                photo_url = img.get("src") or img.get("data-src")
        # 3. Cualquier portrait URL en la página
        if not photo_url:
            m = re.search(r'(https://img\.a\.transfermarkt\.technology/portrait/[^"\']+\.jpg[^"\']*)', str(soup))
            if m:
                photo_url = m.group(1)

    if photo_url:
        _photo_cache[pid] = photo_url
        return jsonify({"url": photo_url})
    return jsonify({"url": None}), 404


@app.route("/player-stats/<pid>")
def player_stats(pid: str):
    """
    Devuelve estadísticas por temporada de un jugador.
    Scrape de https://www.transfermarkt.com/x/leistungsdaten/spieler/{id}/plus/1
    """
    url  = f"{BASE_TM}/x/leistungsdaten/spieler/{pid}/plus/1"
    soup = _fetch_html(url)
    if not soup:
        return jsonify({"stats": []}), 503

    stats = []
    for table in soup.find_all("table", {"class": "items"}):
        for row in table.find_all("tr", class_=["odd", "even"]):
            cells = row.find_all("td")
            if len(cells) < 7:
                continue

            # Temporada (primera celda con formato YYYY/YY)
            season_text = cells[0].get_text(strip=True)
            if not re.match(r"\d{4}/\d{2}", season_text):
                continue

            # Competición
            comp_img = cells[1].find("img")
            competition = comp_img.get("title", "") if comp_img else cells[1].get_text(strip=True)

            # Club (buscar celda con link a club)
            club = ""
            for c in cells[2:5]:
                a = c.find("a")
                if a and a.get_text(strip=True):
                    club = a.get_text(strip=True)
                    break

            def safe_int(cell_idx):
                try:
                    t = cells[cell_idx].get_text(strip=True).replace(".", "").replace("-", "0")
                    return int(t) if t.isdigit() else None
                except (IndexError, ValueError):
                    return None

            # Columnas típicas de TM leistungsdaten:
            # [4]=apariciones [5]=desde_el_banco [6]=goles [7]=asistencias [8]=...
            # [9 o 10]=amarillas [10 o 11]=amarilla-roja [11 o 12]=rojas [13]=minutos
            apps    = safe_int(4)
            goals   = safe_int(6)
            assists = safe_int(7)

            # Minutos: última celda numérica con "'" o gran número
            minutes = None
            for c in reversed(cells):
                t = c.get_text(strip=True).replace("'", "").replace(".", "").replace(" ", "")
                if t.isdigit() and int(t) > 100:
                    minutes = int(t)
                    break

            # Tarjetas: buscar celdas con colores o texto numérico en posiciones correctas
            yellow = safe_int(9) if len(cells) > 9 else None
            red    = safe_int(11) if len(cells) > 11 else None

            if apps is None:
                continue

            stats.append({
                "season":      season_text,
                "competition": competition,
                "club":        club,
                "appearances": apps,
                "goals":       goals,
                "assists":     assists,
                "minutes":     minutes,
                "yellow":      yellow or 0,
                "red":         red or 0,
            })

    return jsonify({"stats": stats})


@app.route("/tm")
def tm_relay():
    """
    Relay genérico: recibe ?url=https://www.transfermarkt.com/...
    y devuelve la respuesta tal cual. Usado por el frontend para
    evitar bloqueos CORS sin depender de proxies públicos.
    """
    url = request.args.get("url", "")
    if not url or not url.startswith("https://www.transfermarkt.com"):
        return jsonify({"error": "URL no permitida"}), 400

    accept = request.headers.get("Accept", "text/html")
    is_json = "json" in accept or "javascript" in accept

    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < 1.5:
        time.sleep(1.5 - elapsed)

    try:
        headers = {}
        if is_json:
            headers = {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
            }
        resp = _session.get(url, headers=headers, timeout=15)
        _last_request_time = time.time()
        resp.raise_for_status()

        content_type = resp.headers.get("Content-Type", "text/html")
        return resp.content, resp.status_code, {"Content-Type": content_type}
    except Exception as e:
        logger.error(f"Relay error {url}: {e}")
        return jsonify({"error": str(e)}), 503


@app.route("/search/player")
def search_player():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Parámetro ?q requerido"}), 400

    logger.info(f"Búsqueda jugador: '{q}'")
    url  = f"{BASE_TM}/schnellsuche/ergebnis/schnellsuche?query={quote(q)}&Spieler_page=0"
    soup = _fetch_html(url)
    if not soup:
        return jsonify({"error": "No se pudo conectar con Transfermarkt"}), 503

    players = parse_player_search(soup)
    logger.info(f"  → {len(players)} resultados")
    return jsonify({"query": q, "players": players, "source": "transfermarkt"})


@app.route("/player/<pid>/value")
def player_value(pid: str):
    logger.info(f"Valor actual jugador id={pid}")
    url  = f"{BASE_TM}/x/profil/spieler/{pid}"
    data = _fetch_json(f"{BASE_TM}/ceapi/marketValueDevelopment/graph/{pid}")
    if not data:
        return jsonify({"error": "Sin datos"}), 503

    entries = data.get("list", [])
    current = entries[-1] if entries else {}
    return jsonify({
        "id":            pid,
        "market_value":  current.get("y"),
        "mv_display":    current.get("mw", "-"),
        "club":          current.get("verein", ""),
        "date":          current.get("datum_mw", ""),
        "history_count": len(entries),
        "source":        "transfermarkt",
    })


@app.route("/player/<pid>/history")
def player_history(pid: str):
    logger.info(f"Histórico id={pid}")
    data = _fetch_json(f"{BASE_TM}/ceapi/marketValueDevelopment/graph/{pid}")
    if not data:
        return jsonify({"error": "Sin datos"}), 503

    history = [
        {
            "date":  e.get("datum_mw", ""),
            "value": e.get("y"),
            "club":  e.get("verein", ""),
        }
        for e in data.get("list", [])
        if e.get("y") is not None
    ]
    return jsonify({"id": pid, "history": history, "source": "transfermarkt"})


@app.route("/player/<pid>/profile")
def player_profile(pid: str):
    logger.info(f"Perfil id={pid}")
    url  = f"{BASE_TM}/x/profil/spieler/{pid}"
    soup = _fetch_html(url)
    if not soup:
        return jsonify({"error": "Sin datos"}), 503
    profile = parse_player_profile(soup, pid)
    # Añadir valor actual desde JSON endpoint (más fiable)
    mv_data = _fetch_json(f"{BASE_TM}/ceapi/marketValueDevelopment/graph/{pid}")
    if mv_data and mv_data.get("list"):
        last = mv_data["list"][-1]
        profile["market_value"] = last.get("y")
        profile["mv_display"]   = last.get("mw", "-")
        profile["current_club"] = profile.get("current_club") or last.get("verein", "")
    profile["source"] = "transfermarkt"
    return jsonify(profile)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 52)
    print("  ScoutGPT Proxy — Transfermarkt")
    print(f"  Escuchando en http://localhost:{PORT}")
    print("=" * 52)
    app.run(host="0.0.0.0", port=PORT, debug=False)
