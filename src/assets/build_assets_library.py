#!/usr/bin/env python3
"""
build_assets_library.py
=======================
Construye la librería local de imágenes para el dashboard de scouting de Betis.

Descarga:
  - Fotos de jugadores  → assets/players/{safe_name}.jpg
  - Escudos de clubes   → assets/clubs/{safe_name}.png
  - Logos de ligas      → assets/leagues/{safe_name}.png

Genera:
  - assets/config/player_mapping.json
  - assets/config/club_mapping.json
  - assets/config/league_mapping.json
  - assets/config/missing_players.csv
  - assets/config/missing_clubs.csv
  - assets/config/missing_leagues.csv

Uso:
  python3 src/assets/build_assets_library.py               # todo
  python3 src/assets/build_assets_library.py --only-a      # solo rendimiento A
  python3 src/assets/build_assets_library.py --limit 50    # máx 50 jugadores
  python3 src/assets/build_assets_library.py --clubs-only  # solo escudos
  python3 src/assets/build_assets_library.py --dry-run     # sin descargas
"""
import argparse
import json
import logging
import random
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

# ── Rutas ─────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent.parent
ASSETS       = ROOT / "assets"
PLAYERS_DIR  = ASSETS / "players"
CLUBS_DIR    = ASSETS / "clubs"
LEAGUES_DIR  = ASSETS / "leagues"
DEFAULTS_DIR = ASSETS / "defaults"
CONFIG_DIR   = ASSETS / "config"
DATA_DIR     = ROOT / "data" / "final"

BBDD_CSV     = DATA_DIR / "Base de Datos 25-26 RBB.csv"
CONTRACTS_CSV = DATA_DIR / "transfermarkt_contracts.csv"

for d in [PLAYERS_DIR, CLUBS_DIR, LEAGUES_DIR, DEFAULTS_DIR, CONFIG_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("assets")

# ── HTTP ──────────────────────────────────────────────────────────────────────
BASE_TM  = "https://www.transfermarkt.es"
CDN_WAPPEN = "https://tmssl.akamaized.net/images/wappen/normquad"
CDN_LOGO   = "https://tmssl.akamaized.net/images/logo/normal"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": BASE_TM + "/",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def _get(url: str, stream: bool = False, retries: int = 3) -> requests.Response | None:
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=20, stream=stream)
            if r.status_code == 200:
                return r
            if r.status_code == 429:
                wait = 60 + random.uniform(10, 30)
                log.warning("Rate-limited (429). Waiting %.0fs…", wait)
                time.sleep(wait)
            elif r.status_code == 404:
                return None
        except Exception as e:
            log.debug("Request error (attempt %d): %s", attempt + 1, e)
            time.sleep(3 * (attempt + 1))
    return None


def _sleep(min_s=1.5, max_s=3.5):
    time.sleep(random.uniform(min_s, max_s))


def _save_image(url: str, dest: Path) -> bool:
    """Download binary image to dest. Returns True on success."""
    r = _get(url, stream=True)
    if not r:
        return False
    content_type = r.headers.get("content-type", "")
    if "image" not in content_type and "octet" not in content_type:
        return False
    dest.write_bytes(r.content)
    return True


# ── Normalización ─────────────────────────────────────────────────────────────
def safe_name(text: str) -> str:
    """'Kasper Boogaard' → 'kasper_boogaard'"""
    nfkd = unicodedata.normalize("NFKD", str(text))
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "_", ascii_str.lower()).strip("_")


# ── Mapeos de clubes → TM club_id (escudos de equipos padre) ─────────────────
# Para equipos filiales / sub-23, usamos el escudo del club padre
CLUB_PARENT_ID: dict[str, int] = {
    # Países Bajos
    "AZ Alkmaar II":            1290,
    "AZ Alkmaar":               1290,
    "PSV Eindhoven U21":         383,
    "PSV Eindhoven":             383,
    "FC Utrecht U21":            373,
    "FC Utrecht":                373,
    "SC Cambuur Leeuwarden":    4048,
    "Vitesse Arnhem":            396,
    "NEC Nijmegen":             1246,
    "Almere City FC":           1286,
    "Roda JC Kerkrade":         2274,
    "FC Dordrecht":              616,
    "FC Volendam":               451,
    "Helmond Sport":            4026,
    "VVV-Venlo":                 411,
    "TOP Oss":                  2540,
    "Jong Ajax":                 610,
    "Jong PSV":                  383,
    "Jong AZ":                  1290,
    "Jong Utrecht":              373,
    # Bélgica
    "RSC Anderlecht Futures":     16,
    "RSC Anderlecht":             16,
    "Koninklijke Racing Club Genk II": 681,
    "KRC Genk":                  681,
    "Club Brugge U23":           253,
    "Club Brugge":               253,
    "K.A.A. Gent U23":           614,
    "K.A.A. Gent":               614,
    "Standard Liège U21":       1200,
    "OH Leuven":                3512,
    # Francia
    "Montpellier HSC":           969,
    "Amiens SC":                1099,
    "ESTAC Troyes":             3524,
    "FC Lorient":               1156,
    "Grenoble Foot 38":         3714,
    "US Valenciennes FC":       3604,
    "AC Ajaccio":               2336,
    "Pau FC":                   4523,
    "Angers SCO":               1173,
    "Bordeaux":                 1290, # placeholder
    "Stade Brest 29":           1178,
    "Le Havre AC":              1110,
    # Portugal
    "SL Benfica U23":            294,
    "SL Benfica":                294,
    "Sporting CP U23":           336,
    "Sporting CP":               336,
    "FC Porto B":                720,
    "FC Porto":                  720,
    "SC Braga B":               2239,
    "CD Santa Clara U23":       2237,
    "CS Marítimo U23":          2290,
    "FC Famalicão U23":         2419,
    "Vitória SC":               2229,
    "Boavista FC":               672,
    # España
    "Málaga CF":                1050,
    "Elche CF":                 1524,
    "FC Andorra":              38260,
    "Real Betis":                150,
    "Real Betis B":              150,
    "Betis Deportivo":           150,
    "FC Barcelona B":            131,
    "Real Madrid Castilla":      418,
    "Villarreal B":              311,
    "Athletic Club Bilbao B":   1237,
    "Real Sociedad B":           681, # placeholder
    "Valencia CF B":             1049,
    "Sevilla FC B":              368,
    "CD Leganés":               1204,
    "UD Almería":               1124,
    "Deportivo Alavés":         1108,
    "Rayo Vallecano":           1239,
    "Getafe CF":                3709,
    "Celta de Vigo B":           940,
    "RCD Mallorca":             1272,
    "Real Valladolid":          1108, # placeholder
    "SD Eibar":                  681, # placeholder
    "CD Mirandes":              2542,
    # Argentina
    "CA Belgrano II":           1534,
    "CA Rosario Central II":       4,
    "CA River Plate II":          41,
    "CA Boca Juniors II":          1,
    "CSD Defensa y justicia II": 6278,
    "San Lorenzo de Almagro II": 1251,
    "CA Independiente II":       1379,
    # Ucrania
    "Kolos Kovalivka":          14867,
    # Suecia
    "BK Häcken":                 677,
    # Inglaterra
    "Arsenal U21":               11,
    "Chelsea U21":              631,
    "Manchester City U21":      281,
    "Manchester United U21":     985,
    "Liverpool U21":             31,
    "Tottenham Hotspur U21":    148,
    # Italia
    "FC Internazionale Milano U19":  46,
    "FC Internazionale Milano U23":  46,
    "AC Milan U19":               5,
    "Juventus U19":               506,
    # Alemania
    "FC Bayern München U19":    226,
    "Borussia Dortmund U19":    16,
    # Polonia
    "Pogon Grodzisk Mazowiecki": None,
}

# ── Mapeos de ligas → TM league_id ───────────────────────────────────────────
LEAGUE_IDS: dict[str, tuple[str, int | None]] = {
    "2ª División Países Bajos":      ("eerste-divisie", 4),
    "1ª División Países Bajos":      ("eredivisie", 3),
    "2ª División Bélgica":           ("challenger-pro-league", 1491),
    "1ª División Bélgica":           ("jupiler-pro-league", 1),
    "2ª División Francia":           ("ligue-2", 46),
    "1ª División Francia":           ("ligue-1", 16),
    "3ª División Francia":           ("national", 56),
    "Liga Revelação U23":            ("liga-revelacao", 1040),
    "2ª División España":            ("laliga-hypermotion", 16),
    "1ª División España":            ("laliga-santander", 3),
    "División de Honor Juvenil España": ("division-honor-juvenil", None),
    "Liga de Reservas Argentina U23": ("reservas-argentinas", None),
    "1ª División Argentina":         ("primera-division", 21),
    "2ª División Países Bajos":      ("eerste-divisie", 4),
    "2ª RFEF España":                ("2rfef", None),
    "1ª RFEF España":                ("primera-rfef", None),
    "3ª División Alemania":          ("3-liga", 42),
}


# ── FUNCIONES PRINCIPALES ─────────────────────────────────────────────────────

def get_player_photo_url(spieler_id: int) -> str | None:
    """Fetches TM profile page and extracts the portrait URL."""
    url = f"{BASE_TM}/p/profil/spieler/{spieler_id}"
    r = _get(url)
    if not r:
        return None
    soup = BeautifulSoup(r.text, "lxml")
    for img in soup.find_all("img", src=re.compile(r"portrait/(?:header|big)/\d+")):
        src = img.get("src", "")
        if src and "portrait" in src:
            return src
    return None


def download_player_photo(nombre: str, apodo: str, spieler_id: int,
                          dry_run: bool = False) -> dict:
    """Downloads player photo and returns result dict."""
    sn = safe_name(nombre)
    dest = PLAYERS_DIR / f"{sn}.jpg"

    result = {
        "nombre": nombre,
        "apodo": apodo,
        "spieler_id": spieler_id,
        "safe_name": sn,
        "file": f"assets/players/{sn}.jpg",
        "status": "unknown",
    }

    if dest.exists() and dest.stat().st_size > 5000:
        result["status"] = "exists"
        return result

    if dry_run:
        result["status"] = "dry_run"
        return result

    photo_url = get_player_photo_url(spieler_id)
    _sleep(1.5, 3.0)

    if not photo_url:
        result["status"] = "no_url"
        return result

    ok = _save_image(photo_url, dest)
    result["status"] = "ok" if ok else "download_failed"
    result["photo_url"] = photo_url
    return result


def download_club_shield(club_name: str, dry_run: bool = False) -> dict:
    """Downloads club shield using parent club TM ID."""
    sn = safe_name(club_name)
    dest = CLUBS_DIR / f"{sn}.png"

    result = {
        "club": club_name,
        "safe_name": sn,
        "file": f"assets/clubs/{sn}.png",
        "status": "unknown",
    }

    if dest.exists() and dest.stat().st_size > 1000:
        result["status"] = "exists"
        return result

    # Find parent club ID
    club_id = None
    for key, cid in CLUB_PARENT_ID.items():
        if key.lower() in club_name.lower() or club_name.lower() in key.lower():
            club_id = cid
            break

    if not club_id:
        # Try substring match
        cn = club_name.lower()
        for key, cid in CLUB_PARENT_ID.items():
            key_parts = key.lower().split()
            if any(p in cn for p in key_parts if len(p) > 4):
                club_id = cid
                break

    result["club_id"] = club_id

    if not club_id:
        result["status"] = "no_id"
        return result

    if dry_run:
        result["status"] = "dry_run"
        return result

    url = f"{CDN_WAPPEN}/{club_id}.png?lm=1"
    ok = _save_image(url, dest)
    result["status"] = "ok" if ok else "download_failed"
    return result


def download_league_logo(league_name: str, dry_run: bool = False) -> dict:
    """Downloads league logo from TM CDN."""
    sn = safe_name(league_name)
    dest = LEAGUES_DIR / f"{sn}.png"

    result = {
        "league": league_name,
        "safe_name": sn,
        "file": f"assets/leagues/{sn}.png",
        "status": "unknown",
    }

    if dest.exists() and dest.stat().st_size > 1000:
        result["status"] = "exists"
        return result

    # Find league slug + ID
    league_info = None
    for key, info in LEAGUE_IDS.items():
        if key.lower() == league_name.lower():
            league_info = info
            break

    if not league_info or not league_info[1]:
        result["status"] = "no_id"
        return result

    if dry_run:
        result["status"] = "dry_run"
        return result

    league_id = league_info[1]
    url = f"{CDN_LOGO}/{league_id}.png?lm=1"
    ok = _save_image(url, dest)
    result["status"] = "ok" if ok else "download_failed"
    return result


# ── DATA LOADING ──────────────────────────────────────────────────────────────
def load_players(only_a: bool = False, limit: int | None = None) -> pd.DataFrame:
    """Load player data from BBDD CSV + contracts CSV."""
    log.info("Loading BBDD from %s", BBDD_CSV)
    df = pd.read_csv(
        BBDD_CSV, sep=";", encoding="utf-8-sig",
        on_bad_lines="skip", dtype=str,
    )
    # Keep valid players
    df = df[df["Nombre"].notna() & df["Nombre"].str.strip().ne("") & df["Posición"].notna()].copy()
    log.info("Players loaded: %d", len(df))

    # Join with contracts for spieler_id
    log.info("Loading contracts from %s", CONTRACTS_CSV)
    df_c = pd.read_csv(CONTRACTS_CSV, dtype=str)
    df_c["spieler_id_int"] = pd.to_numeric(df_c["spieler_id"], errors="coerce").dropna().astype(int)
    # Build name→id lookup
    name_to_id = {}
    for _, row in df_c.iterrows():
        sid = row.get("spieler_id_int")
        if pd.notna(sid):
            for col in ["nombre", "apodo"]:
                v = str(row.get(col, "") or "").strip()
                if v:
                    name_to_id[v.lower()] = int(sid)

    def find_id(nombre, apodo):
        for n in [nombre, apodo]:
            if n and n.lower() in name_to_id:
                return name_to_id[n.lower()]
        return None

    df["spieler_id"] = df.apply(
        lambda r: find_id(r.get("Nombre", ""), r.get("Apodo", "")), axis=1
    )

    # Filter
    if only_a:
        df = df[df["Rendimiento"].str.strip() == "A"]
        log.info("Filtered to A-rated: %d players", len(df))

    # Sort by Media (best first)
    def parse_media(v):
        try:
            return float(str(v).replace(",", "."))
        except Exception:
            return 0.0

    df["_media_num"] = df["Media Javi G"].apply(parse_media)
    df = df.sort_values("_media_num", ascending=False)

    if limit:
        df = df.head(limit)
        log.info("Limited to %d players", len(df))

    return df


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Build Betis Scouting asset library")
    parser.add_argument("--only-a",    action="store_true", help="Only A-rated players")
    parser.add_argument("--only-ab",   action="store_true", help="Only A+B-rated players")
    parser.add_argument("--limit",     type=int, default=None, help="Max players to process")
    parser.add_argument("--clubs-only", action="store_true", help="Only download club shields")
    parser.add_argument("--leagues-only", action="store_true", help="Only download league logos")
    parser.add_argument("--dry-run",   action="store_true", help="No actual downloads")
    parser.add_argument("--workers",   type=int, default=1, help="Thread workers (use 1 to avoid TM ban)")
    args = parser.parse_args()

    df = load_players(only_a=args.only_a, limit=args.limit)

    if args.only_ab and not args.only_a:
        df = df[df["Rendimiento"].str.strip().isin(["A", "B"])]
        log.info("Filtered to A+B-rated: %d players", len(df))

    # ── 1. Club shields ────────────────────────────────────────────────────────
    log.info("=== CLUB SHIELDS ===")
    clubs = df["Equipo"].dropna().unique().tolist()
    club_results = {}
    club_mapping = {}

    for club in tqdm(clubs, desc="Shields", unit="club"):
        res = download_club_shield(club, dry_run=args.dry_run)
        club_results[club] = res
        if res["status"] in ("ok", "exists"):
            club_mapping[club] = res["file"]
        _sleep(0.5, 1.5)

    # ── 2. League logos ────────────────────────────────────────────────────────
    log.info("=== LEAGUE LOGOS ===")
    leagues = df["Liga"].dropna().unique().tolist()
    league_results = {}
    league_mapping = {}

    for league in tqdm(leagues, desc="Leagues", unit="liga"):
        res = download_league_logo(league, dry_run=args.dry_run)
        league_results[league] = res
        if res["status"] in ("ok", "exists"):
            league_mapping[league] = res["file"]
        _sleep(0.3, 0.8)

    if args.clubs_only or args.leagues_only:
        _save_mappings(club_mapping, league_mapping, {}, df, club_results, league_results, {})
        return

    # ── 3. Player photos ───────────────────────────────────────────────────────
    log.info("=== PLAYER PHOTOS ===")
    players_with_id = df[df["spieler_id"].notna()].copy()
    players_no_id   = df[df["spieler_id"].isna()].copy()
    log.info("Players with spieler_id: %d / without: %d",
             len(players_with_id), len(players_no_id))

    player_results = {}
    player_mapping = {}

    def process_player(row):
        nombre = str(row["Nombre"]).strip()
        apodo  = str(row.get("Apodo", "") or "").strip()
        sid    = int(float(row["spieler_id"]))
        res = download_player_photo(nombre, apodo, sid, dry_run=args.dry_run)
        return nombre, res

    if args.workers > 1:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {
                ex.submit(process_player, row): idx
                for idx, row in players_with_id.iterrows()
            }
            for fut in tqdm(as_completed(futures), total=len(futures),
                            desc="Photos", unit="player"):
                nombre, res = fut.result()
                player_results[nombre] = res
                if res["status"] in ("ok", "exists"):
                    player_mapping[nombre] = res["file"]
                    if res.get("apodo"):
                        player_mapping[res["apodo"]] = res["file"]
    else:
        for _, row in tqdm(players_with_id.iterrows(), total=len(players_with_id),
                           desc="Photos", unit="player"):
            nombre, res = process_player(row)
            player_results[nombre] = res
            if res["status"] in ("ok", "exists"):
                player_mapping[nombre] = res["file"]
                apodo = str(row.get("Apodo", "") or "").strip()
                if apodo:
                    player_mapping[apodo] = res["file"]
            _sleep(1.5, 3.0)

    # Players without ID → mark as missing
    for _, row in players_no_id.iterrows():
        nombre = str(row["Nombre"]).strip()
        player_results[nombre] = {
            "nombre": nombre, "status": "no_spieler_id",
            "safe_name": safe_name(nombre),
            "file": f"assets/defaults/player_default.svg",
        }

    _save_mappings(club_mapping, league_mapping, player_mapping,
                   df, club_results, league_results, player_results)


def _save_mappings(club_mapping, league_mapping, player_mapping,
                   df, club_results, league_results, player_results):
    log.info("=== SAVING MAPPINGS ===")

    # player_mapping.json
    pm_path = CONFIG_DIR / "player_mapping.json"
    with open(pm_path, "w", encoding="utf-8") as f:
        json.dump(player_mapping, f, ensure_ascii=False, indent=2)
    log.info("Saved %s (%d entries)", pm_path, len(player_mapping))

    # club_mapping.json
    cm_path = CONFIG_DIR / "club_mapping.json"
    with open(cm_path, "w", encoding="utf-8") as f:
        json.dump(club_mapping, f, ensure_ascii=False, indent=2)
    log.info("Saved %s (%d entries)", cm_path, len(club_mapping))

    # league_mapping.json
    lm_path = CONFIG_DIR / "league_mapping.json"
    with open(lm_path, "w", encoding="utf-8") as f:
        json.dump(league_mapping, f, ensure_ascii=False, indent=2)
    log.info("Saved %s (%d entries)", lm_path, len(league_mapping))

    # missing_players.csv
    missing_players = [
        {"nombre": k, "equipo": df.loc[df["Nombre"] == k, "Equipo"].iloc[0]
                                if k in df["Nombre"].values else "",
         "reason": v.get("status", "")}
        for k, v in player_results.items()
        if v.get("status") not in ("ok", "exists", "dry_run")
    ]
    if missing_players:
        pd.DataFrame(missing_players).to_csv(
            CONFIG_DIR / "missing_players.csv", index=False, encoding="utf-8-sig"
        )
        log.info("Missing players: %d → missing_players.csv", len(missing_players))

    # missing_clubs.csv
    missing_clubs = [
        {"club": k, "reason": v.get("status", "")}
        for k, v in club_results.items()
        if v.get("status") not in ("ok", "exists", "dry_run")
    ]
    if missing_clubs:
        pd.DataFrame(missing_clubs).to_csv(
            CONFIG_DIR / "missing_clubs.csv", index=False, encoding="utf-8-sig"
        )
        log.info("Missing clubs: %d → missing_clubs.csv", len(missing_clubs))

    # missing_leagues.csv
    missing_leagues = [
        {"league": k, "reason": v.get("status", "")}
        for k, v in league_results.items()
        if v.get("status") not in ("ok", "exists", "dry_run")
    ]
    if missing_leagues:
        pd.DataFrame(missing_leagues).to_csv(
            CONFIG_DIR / "missing_leagues.csv", index=False, encoding="utf-8-sig"
        )

    # Summary
    print("\n" + "=" * 60)
    print("RESUMEN FINAL")
    print("=" * 60)
    p_ok  = sum(1 for v in player_results.values() if v.get("status") in ("ok", "exists"))
    p_mis = len(player_results) - p_ok
    c_ok  = sum(1 for v in club_results.values() if v.get("status") in ("ok", "exists"))
    c_mis = len(club_results) - c_ok
    l_ok  = sum(1 for v in league_results.values() if v.get("status") in ("ok", "exists"))
    l_mis = len(league_results) - l_ok

    print(f"  Jugadores procesados : {len(player_results)}")
    print(f"  Fotos disponibles    : {p_ok}  |  Faltantes: {p_mis}")
    print(f"  Clubes               : {len(club_results)}  |  Escudos OK: {c_ok}  |  Sin escudo: {c_mis}")
    print(f"  Ligas                : {len(league_results)}  |  Logos OK: {l_ok}  |  Sin logo: {l_mis}")
    print("=" * 60)
    print(f"\nImágenes en  : {ASSETS}")
    print(f"Mappings en  : {CONFIG_DIR}")


if __name__ == "__main__":
    main()
