"""
HTTP client para Transfermarkt.
Gestiona reintentos, pausa aleatoria y logging de errores.
"""
import time
import random
import logging
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://www.transfermarkt.com"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}


class Scraper:
    def __init__(self, delay_min: float = 3.0, delay_max: float = 7.0, max_retries: int = 3):
        self.delay_min   = delay_min
        self.delay_max   = delay_max
        self.max_retries = max_retries
        self.session     = requests.Session()
        self.session.headers.update(HEADERS)
        self._n_requests = 0

    def _wait(self) -> None:
        delay = random.uniform(self.delay_min, self.delay_max)
        # Pausa larga cada 10 requests para no saturar el servidor
        if self._n_requests > 0 and self._n_requests % 10 == 0:
            delay += random.uniform(5, 12)
            logger.debug(f"Pausa periódica (request #{self._n_requests}): {delay:.1f}s")
        time.sleep(delay)

    def fetch(self, url: str) -> Optional[BeautifulSoup]:
        """Descarga una URL y devuelve el BeautifulSoup parseado. Retries automáticos."""
        for attempt in range(1, self.max_retries + 1):
            try:
                self._wait()
                self._n_requests += 1
                self.session.headers["Referer"] = BASE_URL + "/"

                response = self.session.get(url, timeout=30)

                if response.status_code == 429:
                    wait = random.uniform(60, 120)
                    logger.warning(f"Rate limited (429). Esperando {wait:.0f}s …")
                    time.sleep(wait)
                    continue

                if response.status_code == 503:
                    wait = random.uniform(20, 45)
                    logger.warning(f"Servicio no disponible (503). Esperando {wait:.0f}s …")
                    time.sleep(wait)
                    continue

                response.raise_for_status()
                return BeautifulSoup(response.content, "html.parser")

            except Exception as exc:
                logger.error(f"[Intento {attempt}/{self.max_retries}] Error en {url}: {exc}")
                if attempt < self.max_retries:
                    backoff = random.uniform(8, 20) * attempt
                    logger.info(f"Reintentando en {backoff:.0f}s …")
                    time.sleep(backoff)

        logger.error(f"Abandonando tras {self.max_retries} intentos: {url}")
        return None

    @staticmethod
    def season_url(season_id: int) -> str:
        """URL de la página global de transferencias de Segunda División para una temporada."""
        return f"{BASE_URL}/segunda-division/transfers/wettbewerb/ES2/saison_id/{season_id}"
