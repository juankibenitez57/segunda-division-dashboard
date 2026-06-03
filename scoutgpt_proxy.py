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
import random
import re
import time
import logging
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request

# ── Config ────────────────────────────────────────────────────────────────────
import os
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

@app.route("/status")
def status():
    return jsonify({"ok": True, "source": "transfermarkt", "version": "1.1"})


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
