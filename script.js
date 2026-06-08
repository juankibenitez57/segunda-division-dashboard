/* ============================================================
   ANÁLISIS DE MERCADO DE SEGUNDA DIVISIÓN
   Main Script — script.js
   ============================================================ */

'use strict';

/* ===================== CONSTANTS ===================== */
const CHART_COLORS = ['#009a44','#1d6fa4','#e07b39','#8b5cf6','#d4a017','#0891b2','#be185d','#059669','#7c3aed','#b45309'];
const DATA_VERSION = '2026-06-08-f675267';

/* ============================================================
   REGISTRO DE LIGAS (multi-liga)
   ------------------------------------------------------------
   Cada liga es una entrada con su carpeta de datos. El código de
   "main" es agnóstico: lee siempre dataPath(archivo), que resuelve
   a la carpeta de la liga activa.

   Para AÑADIR una liga (sin tocar funciones de main):
     1. Genera sus CSV con la misma estructura en data/leagues/<id>/
        (o deja Segunda en data/final, que es su carpeta por defecto).
     2. Añade una entrada aquí con { nombre, dataDir, temporadaActual }.
     3. Aparecerá automáticamente en el selector de liga de la cabecera.
   ============================================================ */
const LEAGUES = {
  segunda: {
    nombre: 'Segunda División',
    pais: 'España',
    dataDir: 'data/final',          // Segunda vive en su carpeta histórica
    temporadaActual: '2025-26',
    fichajesFile: 'segunda_division_fichajes_2021_2026.csv',
  },
  // Ejemplo para el futuro (descomentar y crear data/leagues/primera/):
  // primera: { nombre: 'Primera División', pais: 'España', dataDir: 'data/leagues/primera', temporadaActual: '2025-26' },
};

// Liga activa: se recuerda entre recargas; por defecto Segunda
let ACTIVE_LEAGUE = (() => {
  try {
    const saved = sessionStorage.getItem('activeLeague');
    return saved && LEAGUES[saved] ? saved : 'segunda';
  } catch { return 'segunda'; }
})();

// Resuelve el nombre de un CSV a la carpeta de la liga activa
function dataPath(file) {
  const dir = (LEAGUES[ACTIVE_LEAGUE] || LEAGUES.segunda).dataDir;
  return `${dir}/${file}?v=${DATA_VERSION}`;
}

// Pobla el selector de liga y conecta el cambio (recarga limpia)
function setupLeagueSelector() {
  const sel = document.getElementById('league-global');
  if (!sel) return;
  sel.innerHTML = Object.entries(LEAGUES)
    .map(([id, lg]) => `<option value="${id}">${lg.nombre}</option>`).join('');
  sel.value = ACTIVE_LEAGUE;
  // Reflejar la liga activa en el título de la cabecera
  const titleSpan = document.querySelector('.header-title span');
  if (titleSpan) titleSpan.textContent = (LEAGUES[ACTIVE_LEAGUE] || LEAGUES.segunda).nombre;
  // Si solo hay una liga, el selector queda informativo (sin cambios posibles)
  sel.disabled = Object.keys(LEAGUES).length < 2;
  sel.addEventListener('change', () => {
    try { sessionStorage.setItem('activeLeague', sel.value); } catch {}
    location.reload();   // recarga con la liga nueva → estado limpio, sin caches
  });
}

const CLUB_IDS = {
  "AD Alcorcón":"11596","AD Ceuta FC":"8568","Albacete Balompié":"1532",
  "Burgos CF":"1536","CD Castellón":"2502","CD Eldense":"12567",
  "CD Leganés":"1244","CD Lugo":"11000","CD Mirandés":"13222",
  "CD Tenerife":"648","CF Fuenlabrada":"16486","Cultural Leonesa":"4542",
  "Cádiz CF":"2687","Córdoba CF":"993","Deportivo Alavés":"1108",
  "Deportivo de La Coruña":"897","Elche CF":"1531","FC Andorra":"10718",
  "FC Cartagena":"7077","Girona FC":"12321","Granada CF":"16795",
  "Levante UD":"3368","Málaga CF":"1084","RCD Espanyol Barcelona":"714",
  "Racing Ferrol":"1176","Racing Santander":"630","Real Oviedo":"2497",
  "Real Sociedad B":"9899","Real Valladolid CF":"366","Real Zaragoza":"142",
  "SD Amorebieta":"16575","SD Eibar":"1533","SD Huesca":"5358",
  "SD Ponferradina":"4032","Sporting Gijón":"2448","UD Almería":"3302",
  "UD Ibiza":"13241","UD Las Palmas":"472","Villarreal CF B":"11972"
};

const CLUB_IDS_SET = new Set(Object.keys(CLUB_IDS));

const POS_ES = {
  'Centre-Forward':  'Delantero',
  'Second Striker':  'Delantero',
  'Striker':         'Delantero',
  'Centre-Back':     'Central',
  'Central Midfield':'Centrocampista',
  'Defensive Midfield':'Centrocampista',
  'Right Midfield':  'Centrocampista',
  'Left Midfield':   'Centrocampista',
  'Left Winger':     'Extremo Izq.',
  'Right Winger':    'Extremo Der.',
  'Right-Back':      'Lateral Der.',
  'Left-Back':       'Lateral Izq.',
  'Goalkeeper':      'Portero',
  'Attacking Midfield':'Mediapunta',
};

const POSITION_QUERY_ALIASES = {
  'delantero': 'Delantero',
  'delanteros': 'Delantero',
  'segundo delantero': 'Delantero',
  'delantero centro': 'Delantero',
  'striker': 'Delantero',
  'extremo': 'Extremo',
  'extremos': 'Extremo',
  'extremo derecho': 'Extremo',
  'extremo izquierdo': 'Extremo',
  'mediocentro': 'Mediocentro',
  'mediocentros': 'Mediocentro',
  'pivote': 'Mediocentro',
  'pivotes': 'Mediocentro',
  'centrocampista': 'Centrocampista',
  'centrocampistas': 'Centrocampista',
  'mediapunta': 'Mediapunta',
  'mediapuntas': 'Mediapunta',
  'central': 'Central',
  'centrales': 'Central',
  'lateral': 'Lateral',
  'laterales': 'Lateral',
  'portero': 'Portero',
  'porteros': 'Portero'
};

/* ===================== UTILITY FUNCTIONS ===================== */
function tPos(p) { return POS_ES[p] || p; }

function playerAvatar(name, size = 34) {
  const parts = (name || '?').trim().split(/\s+/);
  const initials = (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  const palette = ['#009a44','#1d6fa4','#c8a951','#8b5cf6','#e07b39','#0891b2','#be185d'];
  const bg = palette[(name || '').charCodeAt(0) % palette.length];
  const fs = Math.round(size * 0.38);
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};
    display:inline-flex;align-items:center;justify-content:center;
    font-size:${fs}px;font-weight:700;color:#fff;flex-shrink:0;
    border:2px solid rgba(255,255,255,0.15)">${initials}</div>`;
}

function clubShield(name) {
  const id = CLUB_IDS[name];
  return id ? `https://tmssl.akamaized.net/images/wappen/normquad/${id}.png` : '';
}

function parseMonetary(s) {
  if (!s || s === '-') return 0;
  s = String(s).replace('€','').replace(',','.').trim();
  if (/m$/i.test(s)) return parseFloat(s) * 1e6;
  if (/k$/i.test(s)) return parseFloat(s) * 1e3;
  if (/th\.?$/i.test(s)) return parseFloat(s) * 1e3;
  return parseFloat(s) || 0;
}

function groupBy(arr, key) {
  return arr.reduce((a, r) => {
    const k = r[key] || '?';
    (a[k] = a[k] || []).push(r);
    return a;
  }, {});
}

function sumBy(arr, key) { return arr.reduce((a, r) => a + (+r[key] || 0), 0); }
function meanBy(arr, key) { return arr.length ? sumBy(arr, key) / arr.length : 0; }
function topN(obj, n = 10, asc = false) {
  return Object.entries(obj).sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]).slice(0, n);
}
function formatM(n) {
  if (n >= 1e6) return `€${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}k`;
  return n > 0 ? `€${n}` : '-';
}
function formatDeltaM(n) {
  const v = +n || 0;
  if (v === 0) return '-';
  return `${v > 0 ? '+' : '-'}${formatM(Math.abs(v))}`;
}
function fmt(n) { return new Intl.NumberFormat('es-ES').format(Math.round(n)); }

const BASE_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#1a2332', family: 'Inter, sans-serif', size: 11 },
  xaxis: { gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
  yaxis: { gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
  margin: { t: 45, r: 20, b: 50, l: 60 },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10 } }
};

function isCategoricalAxisValue(v) {
  return v !== null && v !== undefined && v !== '' && typeof v !== 'number' && isNaN(+v);
}

function axisCategoriesFromTraces(data, axisKey) {
  const seen = new Set();
  const categories = [];
  data.forEach(trace => {
    const values = Array.isArray(trace[axisKey]) ? trace[axisKey] : [];
    values.forEach(v => {
      if (isCategoricalAxisValue(v) && !seen.has(v)) {
        seen.add(v);
        categories.push(v);
      }
    });
  });
  return categories;
}

function layout(overrides = {}, data = []) {
  const next = Object.assign({}, BASE_LAYOUT, overrides,
    overrides.xaxis ? { xaxis: Object.assign({}, BASE_LAYOUT.xaxis, overrides.xaxis) } : {},
    overrides.yaxis ? { yaxis: Object.assign({}, BASE_LAYOUT.yaxis, overrides.yaxis) } : {}
  );

  const hasHorizontalBar = data.some(trace => trace.type === 'bar' && trace.orientation === 'h');
  if (hasHorizontalBar && !(next.yaxis && next.yaxis.categoryorder)) {
    const yCategories = axisCategoriesFromTraces(data, 'y');
    if (yCategories.length) {
      next.yaxis = Object.assign({}, next.yaxis, {
        type: 'category',
        categoryorder: 'array',
        categoryarray: yCategories,
      });
    }
  }

  const xCategories = axisCategoriesFromTraces(data, 'x');
  const hasNumericX = data.some(trace => Array.isArray(trace.x) && trace.x.some(v => typeof v === 'number' || (!isNaN(+v) && v !== '')));
  if (xCategories.length && !hasNumericX && !(next.xaxis && next.xaxis.categoryorder)) {
    next.xaxis = Object.assign({}, next.xaxis, {
      type: 'category',
      categoryorder: 'array',
      categoryarray: xCategories,
    });
  }

  return next;
}

function plot(id, data, layoutOverrides, config = {}) {
  try {
    const el = document.getElementById(id);
    if (!el) return;

    const render = () => {
      Plotly.purge(el);
      Plotly.newPlot(el, data, layout(layoutOverrides, data), Object.assign({ responsive: true, displayModeBar: false }, config))
        .then(() => {
          requestAnimationFrame(() => Plotly.Plots.resize(el));
          setTimeout(() => Plotly.Plots.resize(el), 120);
        })
        .catch(e => console.warn('plot error', id, e));
    };

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(render);
    } else {
      render();
    }
  } catch(e) { console.warn('plot error', id, e); }
}

function resizeVisibleCharts() {
  if (typeof Plotly === 'undefined') return;
  document.querySelectorAll('.tab-content.active .js-plotly-plot').forEach(el => {
    Plotly.Plots.resize(el);
  });
}

/* ===================== GLOBAL STATE ===================== */
let ALL_DATA = [];
let REV_DATA = [];
let currentTab = 'tab-inicio';
let selectedSeason = '2025-26';
let currentMetric = 'gasto';
let dtInstance = null;
let chartsRendered = {};

/* ===================== DATA LOADING ===================== */
function loadAll() {
  let loaded = 0;
  const check = () => { if (++loaded === 2) onAllLoaded(); };

  const fichajesFile = (LEAGUES[ACTIVE_LEAGUE] || LEAGUES.segunda).fichajesFile;
  Papa.parse(dataPath(fichajesFile), {
    header: true,
    dynamicTyping: true,
    download: true,
    complete: r => {
      processMain(r.data.filter(d => d.jugador));
      check();
    },
    error: () => {
      showFileInputFallback();
    }
  });

  Papa.parse(dataPath('revalorizacion.csv'), {
    header: true,
    dynamicTyping: true,
    download: true,
    complete: r => {
      REV_DATA = r.data.filter(d => d.jugador);
      check();
    },
    error: () => {
      REV_DATA = [];
      check();
    }
  });
}

function processMain(data) {
  // Ensure importe_numerico is numeric
  ALL_DATA = data.map(d => {
    const imp = +d.importe_numerico || 0;
    const vm = parseMonetary(d.valor_mercado);
    return Object.assign({}, d, {
      importe_numerico: imp,
      _vm: vm
    });
  });
}

/* ===================== ORIGEN DETECTION ===================== */
const LIGAS_MAYORES_EXT = new Set([
  'England','Germany','France','Italy','Netherlands','Portugal',
  'Brazil','Argentina','Scotland','Belgium','Turkey','Russia','Ukraine'
]);

// Clubes de Segunda División que tuvieron temporadas en Primera dentro del período 2021-2026.
// Un jugador cuyo club pasó por Primera durante su estancia tiene valor inflado por esa etapa.
const CLUBS_PRIMERA_SEASONS = {
  'Cádiz CF':               new Set(['2021-22','2022-23','2023-24','2024-25']),
  'Levante UD':             new Set(['2021-22']),
  'Granada CF':             new Set(['2021-22']),
  'Elche CF':               new Set(['2021-22','2022-23']),
  'UD Almería':             new Set(['2022-23','2023-24']),
  'Girona FC':              new Set(['2022-23','2023-24','2024-25','2025-26']),
  'Real Valladolid CF':     new Set(['2022-23']),
  'RCD Espanyol Barcelona': new Set(['2022-23']),
  'Deportivo Alavés':       new Set(['2023-24','2024-25','2025-26']),
  'UD Las Palmas':          new Set(['2023-24','2024-25']),
  'CD Leganés':             new Set(['2024-25','2025-26']),
};

const ALL_SEASONS_ORD = ['2021-22','2022-23','2023-24','2024-25','2025-26'];

function seasonsBetween(from, to) {
  const fi = ALL_SEASONS_ORD.indexOf(from);
  const ti = ALL_SEASONS_ORD.indexOf(to);
  if (fi === -1 || ti === -1) return [from, to].filter(Boolean);
  return ALL_SEASONS_ORD.slice(Math.min(fi,ti), Math.max(fi,ti) + 1);
}

function isExternoMain(d) {
  const pais   = (d.pais_club      || '').trim();
  const origen = (d.club_origen    || '').trim();
  const dest   = (d.club_destino   || '').trim();
  const tipo   = (d.tipo_operacion || '').trim();

  // Procedente de o hacia liga extranjera mayor
  if (LIGAS_MAYORES_EXT.has(pais)) return true;

  // Alta desde club español de Primera (no aparece en Segunda)
  if (d.movimiento === 'alta' && pais === 'Spain' && origen && !CLUB_IDS_SET.has(origen) && (d._vm || 0) > 1000000) return true;

  // Retorno de cesión a club español que no es de Segunda = vuelve a Primera
  // (ej: Bryan Gil devuelto a Sevilla FC tras cesión en Eibar)
  if (tipo === 'retorno de cesión' && pais === 'Spain' && dest && !CLUB_IDS_SET.has(dest)) return true;

  // Club del jugador estuvo en Primera esa temporada
  const clubPrim = CLUBS_PRIMERA_SEASONS[d.club];
  if (clubPrim && clubPrim.has(d.temporada)) return true;

  return false;
}

function enrichRevData() {
  REV_DATA.forEach(rev => {
    const altaRecord = ALL_DATA.find(d =>
      d.jugador === rev.jugador &&
      d.club === rev.club &&
      d.movimiento === 'alta' &&
      d.temporada === rev.temporada_llegada
    );

    // Detectar origen desde el fichaje de alta
    if (altaRecord) {
      const origen = (altaRecord.club_origen || '').trim();
      const pais   = (altaRecord.pais_club   || '').trim();
      const vm     = +rev.vm_llegada || 0;

      if (LIGAS_MAYORES_EXT.has(pais)) {
        rev._origen = 'extranjero';
      } else if (pais === 'Spain' && origen && !CLUB_IDS_SET.has(origen) && vm > 1000000) {
        rev._origen = 'primera';
      } else {
        rev._origen = 'segunda';
      }
    } else {
      rev._origen = 'desconocido';
    }

    // Si el club tuvo temporadas en Primera durante la estancia del jugador,
    // su revalorización no es atribuible exclusivamente a Segunda División.
    if (rev._origen === 'segunda' || rev._origen === 'desconocido') {
      const clubPrim = CLUBS_PRIMERA_SEASONS[rev.club];
      if (clubPrim) {
        const seasons = seasonsBetween(rev.temporada_llegada, rev.temporada_salida);
        if (seasons.some(s => clubPrim.has(s))) rev._origen = 'primera';
      }
    }
  });
}

function getRevData() {
  const excluir = document.getElementById('rev-filter-primera')?.checked;
  const data = excluir
    ? REV_DATA.filter(d => d._origen === 'segunda' || d._origen === 'desconocido')
    : REV_DATA;

  // Update info label
  const info = document.getElementById('rev-filter-info');
  if (info) {
    if (excluir) {
      const excluidos = REV_DATA.length - data.length;
      info.textContent = excluidos > 0
        ? `${excluidos} jugador(es) excluido(s) por proceder de ligas superiores`
        : 'No se encontraron jugadores de ligas superiores con los criterios actuales';
    } else {
      info.textContent = '';
    }
  }
  return data;
}

function showFileInputFallback() {
  const overlay = document.getElementById('loading-overlay');
  overlay.innerHTML = `
    <div style="color:white;text-align:center;padding:40px">
      <h3 style="font-size:1.3rem;margin-bottom:12px">No se pudieron cargar los datos</h3>
      <p style="color:rgba(255,255,255,0.7);margin-bottom:20px">Asegúrate de que los archivos CSV están disponibles en <code>data/final/</code></p>
      <p style="color:rgba(255,255,255,0.5);font-size:0.8rem">Ejecuta el dashboard desde un servidor local (ej: <code>python -m http.server</code>)</p>
    </div>`;
}

function onAllLoaded() {
  hideLoading();
  enrichRevData();
  populateFilters();
  setupLeagueSelector();
  renderCurrentTab();
  setupEventListeners();
}

function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

/* ===================== EVENT LISTENERS ===================== */
function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tab = link.dataset.tab;
      switchTab(tab);
    });
  });

  // Metric selector (Clubes tab)
  document.querySelectorAll('.metric-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentMetric = card.dataset.metric;
      renderClubRanking(ALL_DATA);
    });
  });

  // Season cards (Temporadas tab)
  document.querySelectorAll('.season-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.season-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedSeason = card.dataset.season;
      renderTemporadasTab();
    });
  });

  // Mercado filter
  document.getElementById('mkt-apply').addEventListener('click', () => {
    chartsRendered['tab-mercado'] = false;
    renderMercadoTab();
  });

  // Jugadores filter
  document.getElementById('jug-apply').addEventListener('click', () => {
    chartsRendered['tab-jugadores'] = false;
    renderJugadoresTab();
  });

  // Club filter in Clubes tab
  document.getElementById('club-filter').addEventListener('change', () => {
    renderClubesTab();
  });

  // Revalorización origin filter
  document.getElementById('rev-filter-primera')?.addEventListener('change', () => {
    chartsRendered['tab-revalorizacion'] = false;
    renderRevalorizacionTab();
  });

  // Jugadores origin filter
  document.getElementById('jug-filter-primera')?.addEventListener('change', () => {
    chartsRendered['tab-jugadores'] = false;
    renderJugadoresTab();
  });
}

/* ===================== TAB SWITCHING ===================== */
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

  currentTab = tabId;
  renderCurrentTab();
  requestAnimationFrame(resizeVisibleCharts);
}

function renderCurrentTab() {
  if (ALL_DATA.length === 0 && currentTab !== 'tab-inicio') return;

  switch (currentTab) {
    case 'tab-inicio':       renderInicioTab(); break;
    case 'tab-mercado':      renderMercadoTab(); break;
    case 'tab-clubes':       renderClubesTab(); break;
    case 'tab-posiciones':   renderPosicionesTab(); break;
    case 'tab-jugadores':    renderJugadoresTab(); break;
    case 'tab-revalorizacion': renderRevalorizacionTab(); break;
    case 'tab-temporadas':   renderTemporadasTab(); break;
    case 'tab-sub23':        renderSub23Tab(); break;
    case 'tab-buscador':     if (!chartsRendered['tab-buscador']) { renderBuscadorTab(); chartsRendered['tab-buscador'] = true; } break;
    case 'tab-scoutgpt':     if (!chartsRendered['tab-scoutgpt']) { renderScoutGPTTab(); chartsRendered['tab-scoutgpt'] = true; } break;
    case 'tab-wyscout':      renderWyscoutTab(); break;
    case 'tab-clubes-dev':   renderClubesDevTab(); break;
    case 'tab-entrenadores': renderEntrenadoresTab(); break;
    case 'tab-pos-dev':      renderPosDevTab(); break;
    case 'tab-bbdd':         if (!chartsRendered['tab-bbdd']) { renderBBDDTab(); chartsRendered['tab-bbdd'] = true; } break;
  }
}

/* ===================== FILTER HELPERS ===================== */
function populateFilters() {
  const clubs = [...new Set(ALL_DATA.map(d => d.club))].filter(Boolean).sort();
  const positions = [...new Set(ALL_DATA.map(d => d.posicion))].filter(Boolean).sort();

  // Clubes tab filter
  const clubFilter = document.getElementById('club-filter');
  clubs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    clubFilter.appendChild(opt);
  });

  // Jugadores filters
  const jugClub = document.getElementById('jug-club');
  clubs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    jugClub.appendChild(opt);
  });

  const jugPos = document.getElementById('jug-pos');
  positions.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = tPos(p);
    jugPos.appendChild(opt);
  });
}

function getMktData() {
  const season = document.getElementById('mkt-season').value;
  const tipo = document.getElementById('mkt-tipo').value;
  const mov = document.getElementById('mkt-mov').value;
  return ALL_DATA.filter(d =>
    (season === 'all' || d.temporada === season) &&
    (tipo === 'all' || (d.tipo_operacion || '').toLowerCase() === tipo.toLowerCase()) &&
    (mov === 'all' || (d.movimiento || '').toLowerCase() === mov.toLowerCase())
  );
}

function getJugData() {
  const season  = document.getElementById('jug-season').value;
  const club    = document.getElementById('jug-club').value;
  const pos     = document.getElementById('jug-pos').value;
  const excluir = document.getElementById('jug-filter-primera')?.checked;
  return ALL_DATA.filter(d => {
    if (season !== 'all' && d.temporada !== season) return false;
    if (club   !== 'all' && d.club      !== club)   return false;
    if (pos    !== 'all' && d.posicion  !== pos)     return false;
    if (excluir && isExternoMain(d)) return false;
    return true;
  });
}

/* ===================== TAB 1: INICIO ===================== */
function renderInicioTab() {
  if (ALL_DATA.length === 0) return;

  const totalOps = ALL_DATA.length;
  const uniquePlayers = new Set(ALL_DATA.map(d => d.jugador)).size;
  const uniqueClubs = new Set(ALL_DATA.map(d => d.club)).size;
  const totalMoney = sumBy(ALL_DATA, 'importe_numerico');

  animateCount('kpi-ops', 0, totalOps, 1200, v => fmt(v));
  animateCount('kpi-jugadores', 0, uniquePlayers, 1200, v => fmt(v));
  animateCount('kpi-clubs', 0, uniqueClubs, 800, v => fmt(v));
  animateCountMoney('kpi-money', totalMoney, 1500);
  animateCount('kpi-temps', 0, 5, 500, v => String(v));

  // Top fichaje
  const withImport = ALL_DATA.filter(d => d.importe_numerico > 0)
    .sort((a, b) => b.importe_numerico - a.importe_numerico);
  if (withImport.length) {
    const top = withImport[0];
    document.getElementById('hl-top-fichaje').textContent = `${top.jugador} — ${formatM(top.importe_numerico)}`;
    document.getElementById('hl-top-fichaje-sub').textContent = `${top.club} · ${top.temporada}`;
  }

  // Most active club
  const byClub = groupBy(ALL_DATA, 'club');
  const topClub = topN(Object.fromEntries(Object.entries(byClub).map(([k,v])=>[k,v.length])), 1)[0];
  if (topClub) {
    document.getElementById('hl-club-activo').textContent = `${topClub[0]} — ${fmt(topClub[1])} ops`;
  }

  // Top revalorized — excluir jugadores de Primera/ligas mayores
  const revSegunda = REV_DATA.filter(d => d._origen === 'segunda' || d._origen === 'desconocido');
  if (revSegunda.length) {
    const topRev = [...revSegunda].sort((a, b) => (b.revalorizacion_pct||0) - (a.revalorizacion_pct||0))[0];
    if (topRev) {
      const pct = +topRev.revalorizacion_pct;
      document.getElementById('hl-top-rev').textContent =
        `${topRev.jugador} — +${fmt(pct)}%`;
      document.getElementById('hl-top-rev-sub').textContent = topRev.club || '';
    }
  }
}

function animateCount(id, start, end, duration, format) {
  const el = document.getElementById(id);
  if (!el) return;
  const startTime = performance.now();
  const step = now => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = format(Math.round(start + (end - start) * eased));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function animateCountMoney(id, end, duration) {
  const el = document.getElementById(id);
  if (!el) return;
  const startTime = performance.now();
  const step = now => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = end * eased;
    el.textContent = formatM(val);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ===================== TAB 2: MERCADO GENERAL ===================== */
function renderMercadoTab() {
  const data = getMktData();
  renderEvolucion(data);
  renderTipoOp(data);
  renderEvolucionOps(data);
  renderTreemap(data);
  renderSankey(data);
  renderInsights(data);
}

function renderEvolucion(data) {
  const seasons = [...new Set(data.map(d => d.temporada))].filter(Boolean).sort();
  const altas = seasons.map(s => sumBy(data.filter(d => d.temporada === s && d.movimiento === 'alta'), 'importe_numerico') / 1e6);
  const bajas = seasons.map(s => sumBy(data.filter(d => d.temporada === s && d.movimiento === 'baja'), 'importe_numerico') / 1e6);

  plot('chart-evolucion', [
    { x: seasons, y: altas, name: 'Altas', type: 'bar', marker: { color: CHART_COLORS[0] },
      text: altas.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 } },
    { x: seasons, y: bajas, name: 'Bajas', type: 'bar', marker: { color: CHART_COLORS[2] },
      text: bajas.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 } }
  ], {
    barmode: 'group',
    yaxis: { title: 'Millones €', type: 'linear', rangemode: 'tozero', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    xaxis: { type: 'category', categoryorder: 'array', categoryarray: seasons, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 45, r: 20, b: 50, l: 70 }
  });
}

function renderTipoOp(data) {
  const byTipo = groupBy(data, 'tipo_operacion');
  const labels = Object.keys(byTipo);
  const values = labels.map(k => byTipo[k].length);

  plot('chart-tipo-op', [
    { labels, values, type: 'pie', hole: 0.45,
      marker: { colors: CHART_COLORS },
      textinfo: 'percent+label',
      textfont: { size: 11 },
      hovertemplate: '%{label}: %{value} ops (%{percent})<extra></extra>' }
  ], { margin: { t: 20, r: 20, b: 20, l: 20 }, showlegend: true });
}

function renderEvolucionOps(data) {
  const seasons = [...new Set(data.map(d => d.temporada))].filter(Boolean).sort();
  const altas = seasons.map(s => data.filter(d => d.temporada === s && d.movimiento === 'alta').length);
  const bajas = seasons.map(s => data.filter(d => d.temporada === s && d.movimiento === 'baja').length);

  plot('chart-evolucion-ops', [
    { x: seasons, y: altas, name: 'Altas', type: 'scatter', mode: 'lines+markers',
      fill: 'tozeroy', fillcolor: 'rgba(0,154,68,0.15)', line: { color: CHART_COLORS[0], width: 2 },
      marker: { color: CHART_COLORS[0], size: 7 } },
    { x: seasons, y: bajas, name: 'Bajas', type: 'scatter', mode: 'lines+markers',
      fill: 'tozeroy', fillcolor: 'rgba(224,123,57,0.15)', line: { color: CHART_COLORS[2], width: 2 },
      marker: { color: CHART_COLORS[2], size: 7 } }
  ], {
    yaxis: { title: 'Operaciones', type: 'linear', rangemode: 'tozero', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    xaxis: { type: 'category', categoryorder: 'array', categoryarray: seasons, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' }
  });
}

function renderTreemap(data) {
  // Top-15 club ranking by total money moved
  const byClub = groupBy(data, 'club');
  const ranking = Object.entries(byClub)
    .map(([club, rows]) => ({ club, total: sumBy(rows, 'importe_numerico') }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const max = ranking[0]?.total || 1;

  const rows = ranking.map((r, i) => {
    const shield = clubShield(r.club);
    const shieldHtml = shield
      ? `<img src="${shield}" width="24" height="24" style="border-radius:3px;object-fit:contain;vertical-align:middle;margin-right:8px" onerror="this.style.display='none'">`
      : '';
    const pct = (r.total / max * 100).toFixed(1);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
    return `
      <tr>
        <td style="width:32px;text-align:center;font-size:0.8rem;color:var(--text-muted)">${medal}</td>
        <td style="padding:8px 6px">${shieldHtml}<span style="font-weight:600;font-size:0.85rem">${r.club}</span></td>
        <td style="width:45%;padding:8px 6px">
          <div style="background:#f3f4f6;border-radius:4px;height:10px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:4px"></div>
          </div>
        </td>
        <td style="width:80px;text-align:right;font-weight:700;color:var(--primary);font-size:0.85rem;padding:8px 6px">${formatM(r.total)}</td>
      </tr>`;
  }).join('');

  const container = document.getElementById('chart-treemap');
  if (!container) return;
  container.style.height = 'auto';
  container.style.minHeight = '0';
  container.innerHTML = `
    <div style="padding:8px 0">
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">
        TOP 15 CLUBES POR DINERO TOTAL MOVIDO
      </div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
}

function renderSankey(data) {
  const container = document.getElementById('chart-sankey');
  if (!container) return;

  const traspasos = data
    .filter(d => d.movimiento === 'alta' && d.importe_numerico > 0 && d.club_origen && d.club)
    .sort((a, b) => b.importe_numerico - a.importe_numerico)
    .slice(0, 25);

  if (traspasos.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:28px">No hay traspasos con importe conocido para los filtros seleccionados.</p>';
    return;
  }

  const maxImp = traspasos[0].importe_numerico;

  const rows = traspasos.map((d, i) => {
    const srcShield = clubShield(d.club_origen);
    const dstShield = clubShield(d.club);
    const pct = (d.importe_numerico / maxImp * 100).toFixed(1);
    const pos = i + 1;
    const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉'
      : `<span style="font-size:0.75rem;font-weight:700;color:var(--text-muted)">${pos}</span>`;
    return `
      <tr style="border-bottom:1px solid var(--border)"
          onmouseover="this.style.background='var(--primary-light)'"
          onmouseout="this.style.background=''">
        <td style="padding:10px 8px;text-align:center;width:36px">${medal}</td>
        <td style="padding:10px 8px">
          <div style="display:flex;align-items:center;gap:9px">
            ${playerAvatar(d.jugador, 30)}
            <div>
              <div style="font-weight:700;font-size:0.85rem">${d.jugador}</div>
              <div style="font-size:0.72rem;color:var(--text-muted)">${tPos(d.posicion || '')}${d.edad ? ' · ' + d.edad + ' años' : ''}</div>
            </div>
          </div>
        </td>
        <td style="padding:10px 8px;text-align:center;width:82px">
          <span style="background:rgba(200,169,81,0.18);color:#7a5c00;padding:3px 9px;border-radius:12px;font-size:0.72rem;font-weight:700;letter-spacing:0.02em;white-space:nowrap">${d.temporada}</span>
        </td>
        <td style="padding:10px 12px;min-width:260px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:5px">
              ${srcShield ? `<img src="${srcShield}" width="20" height="20" style="object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">` : ''}
              <span style="font-size:0.82rem;color:var(--text-muted)">${d.club_origen}</span>
            </div>
            <span style="color:var(--primary);font-weight:800;font-size:0.95rem">→</span>
            <div style="display:flex;align-items:center;gap:5px">
              ${dstShield ? `<img src="${dstShield}" width="20" height="20" style="object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">` : ''}
              <span style="font-size:0.82rem;font-weight:700;color:var(--text)">${d.club}</span>
            </div>
          </div>
        </td>
        <td style="padding:10px 14px;text-align:right;white-space:nowrap">
          <div style="font-size:0.95rem;font-weight:800;color:var(--primary)">${formatM(d.importe_numerico)}</div>
          <div style="margin-top:4px;background:var(--border);border-radius:4px;height:4px;width:80px;margin-left:auto">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:4px"></div>
          </div>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:580px">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="padding:8px 8px 10px;text-align:center;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">#</th>
            <th style="padding:8px 8px 10px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Jugador</th>
            <th style="padding:8px 8px 10px;text-align:center;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Temporada</th>
            <th style="padding:8px 12px 10px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Origen → Destino</th>
            <th style="padding:8px 14px 10px;text-align:right;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Importe</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderInsights(data) {
  const container = document.getElementById('chart-mercado-insights');
  if (!container) return;

  const byClubAlta = groupBy(data.filter(d => d.movimiento === 'alta'), 'club');
  const byClubBaja = groupBy(data.filter(d => d.movimiento === 'baja'), 'club');
  const byTemp = groupBy(data, 'temporada');

  const topGastoEntry = topN(Object.fromEntries(
    Object.entries(byClubAlta).map(([k,v]) => [k, sumBy(v,'importe_numerico')])), 1)[0];
  const topIngresoEntry = topN(Object.fromEntries(
    Object.entries(byClubBaja).map(([k,v]) => [k, sumBy(v,'importe_numerico')])), 1)[0];
  const topTempEntry = topN(Object.fromEntries(
    Object.entries(byTemp).map(([k,v]) => [k, v.length])), 1)[0];

  const withImport = data.filter(d => d.importe_numerico > 0).sort((a,b) => b.importe_numerico - a.importe_numerico);
  const topPlayer = withImport[0];

  const cards = [
    { label: 'Club que más gastó', value: topGastoEntry ? topGastoEntry[0] : '—', sub: topGastoEntry ? formatM(topGastoEntry[1]) : '' },
    { label: 'Club que más ingresó', value: topIngresoEntry ? topIngresoEntry[0] : '—', sub: topIngresoEntry ? formatM(topIngresoEntry[1]) : '' },
    { label: 'Temporada más activa', value: topTempEntry ? topTempEntry[0] : '—', sub: topTempEntry ? `${fmt(topTempEntry[1])} operaciones` : '' },
    { label: 'Jugador más caro', value: topPlayer ? topPlayer.jugador : '—', sub: topPlayer ? `${topPlayer.club} · ${formatM(topPlayer.importe_numerico)}` : '' }
  ];

  container.innerHTML = cards.map(c => `
    <div class="insight-card">
      <div class="insight-label">${c.label}</div>
      <div class="insight-value">${c.value}</div>
      <div class="insight-sub">${c.sub}</div>
    </div>`).join('');
}

/* ===================== TAB 3: CLUBES ===================== */
function renderClubesTab() {
  const filter = document.getElementById('club-filter').value;
  const data = filter === 'all' ? ALL_DATA : ALL_DATA.filter(d => d.club === filter);

  renderClubRanking(data);
  renderCompradores(data);
  renderVendedores(data);
  renderBalance(data);
}

function getClubMetric(data, metric) {
  const byClub = groupBy(data, 'club');
  switch (metric) {
    case 'gasto':
      return Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, sumBy(v.filter(d => d.movimiento==='alta'), 'importe_numerico')]));
    case 'ingreso':
      return Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, sumBy(v.filter(d => d.movimiento==='baja'), 'importe_numerico')]));
    case 'balance': {
      return Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k,
        sumBy(v.filter(d=>d.movimiento==='baja'),'importe_numerico') - sumBy(v.filter(d=>d.movimiento==='alta'),'importe_numerico')
      ]));
    }
    case 'ops':
      return Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length]));
    default: return {};
  }
}

function renderClubRanking(data) {
  const titles = {
    gasto: 'Ranking de clubes — Mayor gasto',
    ingreso: 'Ranking de clubes — Mayor ingreso',
    balance: 'Ranking de clubes — Balance neto',
    ops: 'Ranking de clubes — Más operaciones'
  };
  document.getElementById('ranking-title').textContent = titles[currentMetric];

  const metrics = getClubMetric(data, currentMetric);
  const sorted = Object.entries(metrics).sort((a, b) => {
    if (currentMetric === 'balance') return b[1] - a[1];
    return b[1] - a[1];
  }).slice(0, 20);

  if (sorted.length === 0) return;
  const maxVal = Math.max(...sorted.map(([,v]) => Math.abs(v)));

  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = sorted.map(([club, val], i) => {
    const shield = clubShield(club);
    const shieldImg = shield ? `<img src="${shield}" width="28" height="28" style="object-fit:contain" onerror="this.onerror=null;this.style.opacity='0'">` : '';
    const display = currentMetric === 'ops' ? fmt(val) : formatM(val);
    const pct = maxVal > 0 ? Math.abs(val) / maxVal * 100 : 0;
    const isNeg = val < 0;
    return `<tr>
      <td>${i + 1}</td>
      <td><div class="club-cell">${shieldImg}<span>${club}</span></div></td>
      <td style="font-weight:600;color:${isNeg ? 'var(--danger)' : 'var(--success)'}">${display}</td>
      <td class="bar-cell">
        <div class="inline-bar-wrap">
          <div class="inline-bar ${isNeg ? 'negative' : ''}" style="width:${pct}%"></div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderCompradores(data) {
  const altas = data.filter(d => d.movimiento === 'alta');
  const byClub = groupBy(altas, 'club');
  const top = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, sumBy(v,'importe_numerico')])), 10);
  const clubs = top.map(d => d[0]).reverse();
  const vals = top.map(d => d[1] / 1e6).reverse();

  plot('chart-compradores', [
    { x: vals, y: clubs, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[0] },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 80, b: 50, l: 150 }
  });
}

function renderVendedores(data) {
  const bajas = data.filter(d => d.movimiento === 'baja');
  const byClub = groupBy(bajas, 'club');
  const top = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, sumBy(v,'importe_numerico')])), 10);
  const clubs = top.map(d => d[0]).reverse();
  const vals = top.map(d => d[1] / 1e6).reverse();

  plot('chart-vendedores', [
    { x: vals, y: clubs, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[2] },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 80, b: 50, l: 150 }
  });
}

function renderBalance(data) {
  const byClub = groupBy(data, 'club');
  const balances = Object.entries(byClub).map(([club, rows]) => ({
    club,
    balance: sumBy(rows.filter(d=>d.movimiento==='baja'),'importe_numerico') - sumBy(rows.filter(d=>d.movimiento==='alta'),'importe_numerico')
  })).sort((a, b) => b.balance - a.balance);

  const clubs = balances.map(d => d.club).reverse();
  const vals = balances.map(d => d.balance / 1e6).reverse();

  plot('chart-balance', [
    { x: vals, y: clubs, type: 'bar', orientation: 'h',
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[0] : '#dc2626') },
      text: vals.map(v => `${v >= 0 ? '+' : ''}€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 9 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 100, b: 50, l: 160 }
  });
}

/* ===================== TAB 4: POSICIONES ===================== */
function renderPosicionesTab() {
  renderPosOps();
  renderPosDinero();
  renderPosValorMedio();
  renderPosEdadMedia();
  renderPosTipo();
  renderPosSunburst();
}

function renderPosOps() {
  const byPos = groupBy(ALL_DATA, 'posicion');
  const sorted = topN(Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k,v.length])), 14);
  const labels = sorted.map(d => tPos(d[0])).reverse();
  const vals = sorted.map(d => d[1]).reverse();

  plot('chart-pos-ops', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[0] },
      text: vals.map(v => fmt(v)), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x} ops<extra></extra>' }
  ], {
    xaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 60, b: 50, l: 140 }
  });
}

function renderPosDinero() {
  const byPos = groupBy(ALL_DATA, 'posicion');
  const sorted = topN(Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k, sumBy(v,'importe_numerico')])), 14);
  const labels = sorted.map(d => tPos(d[0])).reverse();
  const vals = sorted.map(d => d[1] / 1e6).reverse();

  plot('chart-pos-dinero', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[1] },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 80, b: 50, l: 140 }
  });
}

function renderPosValorMedio() {
  const byPos = groupBy(ALL_DATA, 'posicion');
  const sorted = topN(Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k, meanBy(v,'_vm')])), 14);
  const labels = sorted.map(d => tPos(d[0])).reverse();
  const vals = sorted.map(d => d[1] / 1e6).reverse();

  plot('chart-pos-valor-medio', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[3] },
      text: vals.map(v => `€${v.toFixed(2)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'VM Medio (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 90, b: 50, l: 140 }
  });
}

function renderPosEdadMedia() {
  const byPos = groupBy(ALL_DATA.filter(d => d.edad), 'posicion');
  const sorted = Object.entries(byPos).map(([k,v]) => [k, meanBy(v,'edad')]).sort((a,b) => b[1]-a[1]).slice(0, 14);
  const labels = sorted.map(d => tPos(d[0])).reverse();
  const vals = sorted.map(d => +d[1].toFixed(1)).reverse();

  plot('chart-pos-edad-media', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[4] },
      text: vals.map(v => `${v} años`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x} años<extra></extra>' }
  ], {
    xaxis: { title: 'Edad media', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 80, b: 50, l: 140 }
  });
}

function renderPosTipo() {
  const tipos = [...new Set(ALL_DATA.map(d => d.tipo_operacion))].filter(Boolean);
  const byPos = groupBy(ALL_DATA, 'posicion');
  const topPos = topN(Object.fromEntries(Object.entries(byPos).map(([k,v])=>[k,v.length])), 8).map(d=>d[0]);

  const traces = tipos.map((tipo, i) => ({
    x: topPos.map(p => tPos(p)),
    y: topPos.map(p => (byPos[p]||[]).filter(d => d.tipo_operacion === tipo).length),
    name: tipo,
    type: 'bar',
    marker: { color: CHART_COLORS[i % CHART_COLORS.length] }
  }));

  plot('chart-pos-tipo', traces, {
    barmode: 'stack',
    xaxis: { title: 'Posición', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 40, r: 20, b: 80, l: 60 }
  });
}

function renderPosSunburst() {
  // Bubble chart: position (x) vs mean importe (y) vs count (size)
  const grouped = groupBy(ALL_DATA.filter(r => r.importe_numerico > 0), 'posicion');
  const bubbles = Object.entries(grouped).map(([pos, rows]) => ({
    pos: tPos(pos),
    mean: meanBy(rows, 'importe_numerico'),
    count: rows.length,
    total: sumBy(rows, 'importe_numerico'),
  })).sort((a, b) => b.mean - a.mean);

  const trace = {
    type: 'scatter',
    mode: 'markers+text',
    x: bubbles.map((_, i) => i),
    y: bubbles.map(b => b.mean / 1e6),
    text: bubbles.map(b => b.pos),
    textposition: 'top center',
    marker: {
      size: bubbles.map(b => Math.sqrt(b.count) * 6 + 10),
      color: bubbles.map(b => b.total / 1e6),
      colorscale: [[0,'#e8f5ee'],[0.5,'#009a44'],[1,'#c8a951']],
      showscale: true,
      colorbar: { title: 'Total M€', thickness: 12, tickfont: { color: '#1a2332', size: 10 } },
      line: { color: 'rgba(255,255,255,0.2)', width: 1 }
    },
    hovertemplate: '<b>%{text}</b><br>Valor medio: €%{y:.2f}M<br>Operaciones: %{marker.size}<extra></extra>'
  };

  plot('chart-sunburst', [trace], {
    title: 'Posiciones: valor medio vs volumen (tamaño = nº operaciones)',
    xaxis: { showticklabels: false, showgrid: false },
    yaxis: { title: 'Valor medio por operación (M€)' },
    height: 420,
    margin: { t: 50, r: 80, b: 40, l: 70 }
  });
}

/* ===================== TAB 5: JUGADORES ===================== */
function renderJugadoresTab() {
  const data = getJugData();
  renderTopCaros(data);
  renderTopValorMercado(data);
  renderEdadImporte(data);
  renderDistEdad(data);
  renderNacBar(data);
  renderNacMapa(data);
}

function renderTopCaros(data) {
  const sorted = data.filter(d => d.importe_numerico > 0)
    .sort((a, b) => b.importe_numerico - a.importe_numerico).slice(0, 15);
  const labels = sorted.map(d => `${d.jugador} — ${d.club}`).reverse();
  const vals = sorted.map(d => d.importe_numerico / 1e6).reverse();
  const customdata = sorted.map(d => [d.club, tPos(d.posicion), d.temporada, d.edad]).reverse();

  plot('chart-top-caros', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      customdata,
      marker: { color: CHART_COLORS[0] },
      text: vals.map(v => `€${v.toFixed(2)}M`), textposition: 'outside', textfont: { size: 9 },
      hovertemplate: '<b>%{y}</b><br>Temporada: %{customdata[2]}<br>Posición: %{customdata[1]}<br>Edad: %{customdata[3]}<br>Importe: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb', tickfont: { size: 9 } },
    margin: { t: 30, r: 90, b: 50, l: 220 }
  });
}

function renderTopValorMercado(data) {
  const sorted = data.filter(d => d._vm > 0)
    .sort((a, b) => b._vm - a._vm).slice(0, 15);
  const labels = sorted.map(d => `${d.jugador} — ${d.club}`).reverse();
  const vals = sorted.map(d => d._vm / 1e6).reverse();

  plot('chart-top-valor-mercado', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[1] },
      text: vals.map(v => `€${v.toFixed(2)}M`), textposition: 'outside', textfont: { size: 9 },
      hovertemplate: '%{y}: €%{x:.2f}M VM<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb', tickfont: { size: 9 } },
    margin: { t: 30, r: 90, b: 50, l: 200 }
  });
}

function renderEdadImporte(data) {
  const traspasos = data.filter(d => d.tipo_operacion === 'traspaso' && d.importe_numerico > 0 && d.edad);
  const positions = [...new Set(traspasos.map(d => d.posicion))].filter(Boolean);

  const traces = positions.map((pos, i) => {
    const rows = traspasos.filter(d => d.posicion === pos);
    return {
      x: rows.map(d => d.edad),
      y: rows.map(d => d.importe_numerico / 1e6),
      mode: 'markers',
      name: tPos(pos),
      type: 'scatter',
      marker: {
        color: CHART_COLORS[i % CHART_COLORS.length],
        size: rows.map(d => Math.max(6, Math.min(20, d.importe_numerico / 1e6 * 3))),
        opacity: 0.75,
        line: { width: 1, color: 'rgba(0,0,0,0.1)' }
      },
      text: rows.map(d => `${d.jugador} (${d.temporada})`),
      hovertemplate: '%{text}<br>Edad: %{x} · €%{y:.2f}M<extra></extra>'
    };
  });

  plot('chart-edad-importe', traces, {
    xaxis: { title: 'Edad', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Importe (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    showlegend: true,
    legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 9 } },
    margin: { t: 40, r: 20, b: 50, l: 70 }
  });
}

function renderDistEdad(data) {
  const altas = data.filter(d => d.movimiento === 'alta' && d.edad).map(d => d.edad);
  const bajas = data.filter(d => d.movimiento === 'baja' && d.edad).map(d => d.edad);

  plot('chart-dist-edad', [
    { x: altas, name: 'Altas', type: 'histogram', xbins: { size: 1 },
      marker: { color: 'rgba(0,154,68,0.75)', line: { color: '#009a44', width: 1 } },
      opacity: 0.8 },
    { x: bajas, name: 'Bajas', type: 'histogram', xbins: { size: 1 },
      marker: { color: 'rgba(224,123,57,0.75)', line: { color: '#e07b39', width: 1 } },
      opacity: 0.8 }
  ], {
    barmode: 'overlay',
    xaxis: { title: 'Edad', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Frecuencia', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 40, r: 20, b: 50, l: 60 }
  });
}

function renderNacBar(data) {
  const byNac = groupBy(data, 'nacionalidad');
  const top = topN(Object.fromEntries(Object.entries(byNac).map(([k,v]) => [k,v.length])), 15);
  const labels = top.map(d => d[0]).reverse();
  const vals = top.map(d => d[1]).reverse();

  plot('chart-nac-bar', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[5] },
      text: vals.map(v => fmt(v)), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x} jugadores<extra></extra>' }
  ], {
    xaxis: { title: 'Jugadores', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 60, b: 50, l: 120 }
  });
}

function renderNacMapa(data) {
  const byNac = groupBy(data, 'nacionalidad');
  const nacData = Object.entries(byNac).map(([k,v]) => ({ country: k, count: v.length }));

  plot('chart-nac-mapa', [
    {
      type: 'choropleth',
      locationmode: 'country names',
      locations: nacData.map(d => d.country),
      z: nacData.map(d => d.count),
      colorscale: [[0,'#e8f5ee'],[1,'#009a44']],
      colorbar: { title: 'Jugadores', tickfont: { size: 10 } },
      hovertemplate: '%{location}: %{z} jugadores<extra></extra>'
    }
  ], {
    geo: {
      showframe: false, showcoastlines: true,
      projection: { type: 'natural earth' },
      bgcolor: 'rgba(0,0,0,0)',
      coastlinecolor: '#e5e7eb',
      landcolor: '#f4f6f9',
      countrycolor: '#e2e8f0'
    },
    margin: { t: 10, r: 10, b: 10, l: 10 }
  });
}

/* ===================== TAB 6: REVALORIZACIÓN ===================== */
function renderRevalorizacionTab() {
  const revData = getRevData();
  if (revData.length === 0) {
    document.getElementById('rev-kpi-pares').textContent = 'N/D';
    return;
  }

  const positives = revData.filter(d => (+d.revalorizacion_abs || 0) > 0);

  document.getElementById('rev-kpi-pares').textContent = fmt(revData.length);
  document.getElementById('rev-kpi-pos').textContent = fmt(positives.length);
  document.getElementById('rev-kpi-total').textContent = formatM(sumBy(positives, 'revalorizacion_abs'));
  const meanPct = meanBy(positives.filter(d => d.revalorizacion_pct != null), 'revalorizacion_pct');
  document.getElementById('rev-kpi-media').textContent = `+${meanPct.toFixed(0)}%`;

  renderRevClubes(revData);
  renderRevClubesMedia(revData);
  renderRevJugadores(revData);
  renderRevPos(revData);
  renderRevEdad(revData);
  renderRevTemporada(revData);
  renderRevNac(revData);
  renderRevROI(revData);
  renderRevTable(revData);
}

function renderRevClubes(revData) {
  const byClub = groupBy(revData, 'club');
  const top = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, sumBy(v,'revalorizacion_abs')])), 15);
  const labels = top.map(d => d[0]).reverse();
  const vals = top.map(d => d[1] / 1e6).reverse();

  plot('chart-rev-clubes', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[0] : '#dc2626') },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Revalorización (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 90, b: 50, l: 160 }
  });
}

function renderRevClubesMedia(revData) {
  const byClub = groupBy(revData.filter(d => d.revalorizacion_pct != null), 'club');
  const clubMeans = Object.entries(byClub)
    .filter(([,v]) => v.length >= 2)
    .map(([k,v]) => [k, meanBy(v,'revalorizacion_pct')]);
  const top = clubMeans.sort((a,b) => b[1]-a[1]).slice(0,15);
  const labels = top.map(d => d[0]).reverse();
  const vals = top.map(d => +d[1].toFixed(1)).reverse();

  plot('chart-rev-clubes-media', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[1] },
      text: vals.map(v => `${v}%`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x:.1f}%<extra></extra>' }
  ], {
    xaxis: { title: '% Medio', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 70, b: 50, l: 160 }
  });
}

function renderRevJugadores(revData) {
  const sorted = [...revData].sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0,15);
  const labels = sorted.map(d => `${d.jugador} (${d.club}) ${d.temporada_llegada||''}→${d.temporada_salida||''}`).reverse();
  const vals = sorted.map(d => (+d.revalorizacion_abs||0) / 1e6).reverse();
  const customdata = sorted.map(d => [d.temporada_llegada||'—', d.temporada_salida||'—', tPos(d.posicion||'')]).reverse();

  plot('chart-rev-jugadores', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      customdata,
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[0] : '#dc2626') },
      text: vals.map(v => `€${v.toFixed(2)}M`), textposition: 'outside', textfont: { size: 9 },
      hovertemplate: '<b>%{y}</b><br>Temp. llegada: %{customdata[0]}<br>Temp. salida: %{customdata[1]}<br>Posición: %{customdata[2]}<br>Revalorización: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Revalorización (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb', tickfont: { size: 9 } },
    margin: { t: 30, r: 90, b: 50, l: 260 }
  });
}

function renderRevPos(revData) {
  const byPos = groupBy(revData, 'posicion');
  const top = topN(Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k, sumBy(v,'revalorizacion_abs')])), 14);
  const labels = top.map(d => tPos(d[0])).reverse();
  const vals = top.map(d => d[1] / 1e6).reverse();

  plot('chart-rev-pos', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[3] },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Revalorización (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 90, b: 50, l: 140 }
  });
}

function renderRevEdad(revData) {
  const data = revData.filter(d => d.edad_llegada && d.revalorizacion_pct != null);
  const positions = [...new Set(data.map(d => d.posicion))].filter(Boolean);

  const traces = positions.slice(0, 8).map((pos, i) => {
    const rows = data.filter(d => d.posicion === pos);
    return {
      x: rows.map(d => +d.edad_llegada),
      y: rows.map(d => +d.revalorizacion_pct),
      mode: 'markers',
      name: tPos(pos),
      type: 'scatter',
      marker: { color: CHART_COLORS[i % CHART_COLORS.length], size: 7, opacity: 0.7 },
      text: rows.map(d => d.jugador),
      hovertemplate: '%{text}<br>Edad llegada: %{x}<br>Revalorización: %{y:.1f}%<extra></extra>'
    };
  });

  plot('chart-rev-edad', traces, {
    xaxis: { title: 'Edad de llegada', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Revalorización %', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    showlegend: true,
    legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 9 } },
    margin: { t: 40, r: 20, b: 50, l: 70 }
  });
}

function renderRevTemporada(revData) {
  const byTemp = groupBy(revData.filter(d => d.temporada_salida), 'temporada_salida');
  const seasons = Object.keys(byTemp).sort();
  const vals = seasons.map(s => sumBy(byTemp[s],'revalorizacion_abs') / 1e6);

  plot('chart-rev-temporada', [
    { x: seasons, y: vals, type: 'bar',
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[0] : '#dc2626') },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{x}: €%{y:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Temporada salida', type: 'category', categoryorder: 'array', categoryarray: seasons, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Revalorización (M€)', type: 'linear', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 40, r: 20, b: 60, l: 70 }
  });
}

function renderRevNac(revData) {
  const byNac = groupBy(revData.filter(d => d.revalorizacion_pct != null), 'nacionalidad');
  const nacMeans = Object.entries(byNac).filter(([,v]) => v.length >= 2)
    .map(([k,v]) => [k, meanBy(v,'revalorizacion_pct')]);
  const top = nacMeans.sort((a,b) => b[1]-a[1]).slice(0,10);
  const labels = top.map(d => d[0]).reverse();
  const vals = top.map(d => +d[1].toFixed(1)).reverse();

  plot('chart-rev-nac', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[6] },
      text: vals.map(v => `${v}%`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x:.1f}%<extra></extra>' }
  ], {
    xaxis: { title: '% Medio', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 70, b: 50, l: 130 }
  });
}

function renderRevROI(revData) {
  const data = revData.filter(d => (+d.vm_llegada||0) > 0);
  const byClub = groupBy(data, 'club');
  const clubROI = Object.entries(byClub)
    .filter(([,v]) => v.length >= 2)
    .map(([k,v]) => {
      const roi = sumBy(v,'revalorizacion_abs') / sumBy(v,'vm_llegada') * 100;
      return [k, roi];
    });
  const top = clubROI.sort((a,b) => b[1]-a[1]).slice(0,15);
  const labels = top.map(d => d[0]).reverse();
  const vals = top.map(d => +d[1].toFixed(1)).reverse();

  plot('chart-rev-roi', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[7] : '#dc2626') },
      text: vals.map(v => `${v}%`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: ROI %{x:.1f}%<extra></extra>' }
  ], {
    xaxis: { title: 'ROI %', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 80, b: 50, l: 160 }
  });
}

function renderRevTable(revData) {
  const sorted = [...revData].sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0,20);
  const tbody = document.getElementById('rev-top-tbody');
  if (!tbody) return;

  tbody.innerHTML = sorted.map((d, i) => {
    const abs = +d.revalorizacion_abs || 0;
    const pct = +d.revalorizacion_pct || 0;
    const isPos = abs >= 0;
    const arrow = isPos ? '<span class="arrow-up">▲</span>' : '<span class="arrow-down">▼</span>';
    return `<tr class="${isPos ? 'row-positive' : 'row-negative'}">
      <td>${i + 1}</td>
      <td style="font-weight:600">${d.jugador || '—'}</td>
      <td>${d.club || '—'}</td>
      <td>${tPos(d.posicion || '')}</td>
      <td>${d.temporada_llegada || '—'}</td>
      <td>${d.temporada_salida || '—'}</td>
      <td>${formatM(+d.vm_llegada||0)}</td>
      <td>${formatM(+d.vm_salida||0)}</td>
      <td>${arrow} ${formatM(Math.abs(abs))}</td>
      <td style="font-weight:700;color:${isPos ? 'var(--success)' : 'var(--danger)'}">
        ${isPos ? '+' : ''}${pct.toFixed(1)}%
      </td>
    </tr>`;
  }).join('');
}

/* ===================== TAB 7: TEMPORADAS ===================== */
function renderTemporadasTab() {
  const data = ALL_DATA.filter(d => d.temporada === selectedSeason);

  // KPIs
  document.getElementById('temp-kpi-ops').textContent = fmt(data.length);
  document.getElementById('temp-kpi-money').textContent = formatM(sumBy(data,'importe_numerico'));
  document.getElementById('temp-kpi-clubs').textContent = fmt(new Set(data.map(d=>d.club)).size);

  // Charts
  renderTempClubesOps(data);
  renderTempTipo(data);
  renderTempTopFichajes(data);
  renderTempPosiciones(data);
  renderTempTraspasos(data);
}

function renderTempClubesOps(data) {
  const byClub = groupBy(data, 'club');
  const sorted = topN(Object.fromEntries(Object.entries(byClub).map(([k,v])=>[k,v.length])), 20);
  const labels = sorted.map(d => d[0]).reverse();
  const vals = sorted.map(d => d[1]).reverse();

  plot('chart-temp-clubes-ops', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[0] },
      text: vals.map(v => fmt(v)), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x} ops<extra></extra>' }
  ], {
    xaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 60, b: 50, l: 160 }
  });
}

function renderTempTipo(data) {
  const byTipo = groupBy(data, 'tipo_operacion');
  const labels = Object.keys(byTipo);
  const values = labels.map(k => byTipo[k].length);

  plot('chart-temp-tipo', [
    { labels, values, type: 'pie', hole: 0.45,
      marker: { colors: CHART_COLORS },
      textinfo: 'percent+label',
      textfont: { size: 11 },
      hovertemplate: '%{label}: %{value} ops (%{percent})<extra></extra>' }
  ], { margin: { t: 20, r: 20, b: 20, l: 20 }, showlegend: true });
}

function renderTempTopFichajes(data) {
  const sorted = data.filter(d => d.importe_numerico > 0).sort((a,b) => b.importe_numerico - a.importe_numerico).slice(0,10);
  const labels = sorted.map(d => `${d.jugador} — ${d.club}`).reverse();
  const vals = sorted.map(d => d.importe_numerico / 1e6).reverse();

  if (vals.length === 0) return;

  plot('chart-temp-top-fichajes', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[4] },
      text: vals.map(v => `€${v.toFixed(2)}M`), textposition: 'outside', textfont: { size: 9 },
      hovertemplate: '%{y}: €%{x:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb', tickfont: { size: 9 } },
    margin: { t: 30, r: 90, b: 50, l: 200 }
  });
}

function renderTempPosiciones(data) {
  const byPos = groupBy(data, 'posicion');
  const sorted = topN(Object.fromEntries(Object.entries(byPos).map(([k,v])=>[k,v.length])), 14);
  const labels = sorted.map(d => tPos(d[0])).reverse();
  const vals = sorted.map(d => d[1]).reverse();

  plot('chart-temp-posiciones', [
    { x: vals, y: labels, type: 'bar', orientation: 'h',
      marker: { color: CHART_COLORS[2] },
      text: vals.map(v => fmt(v)), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{y}: %{x} ops<extra></extra>' }
  ], {
    xaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 30, r: 60, b: 50, l: 140 }
  });
}

function renderTempTraspasos(data) {
  const sorted = data.filter(d => d.tipo_operacion === 'traspaso')
    .sort((a,b) => (+b.importe_numerico||0) - (+a.importe_numerico||0));
  const tbody = document.getElementById('temp-traspasos-tbody');
  if (!tbody) return;

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">No hay traspasos en esta temporada</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(d => `<tr>
    <td style="font-weight:600">${d.jugador || '—'}</td>
    <td><span style="padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;background:${d.movimiento==='alta'?'#e8f5ee':'#fff1f2'};color:${d.movimiento==='alta'?'var(--success)':'var(--danger)'}">${d.movimiento || '—'}</span></td>
    <td>${d.club || '—'}</td>
    <td style="font-weight:600;color:var(--primary)">${d.importe_original || '—'}</td>
    <td>${tPos(d.posicion || '')}</td>
    <td>${d.edad || '—'}</td>
  </tr>`).join('');
}

/* ===================== TAB 8: BASE DE DATOS ===================== */
function renderBBDDTab() {
  if (dtInstance) { dtInstance.destroy(); dtInstance = null; }

  const tbody = document.querySelector('#bbdd-table tbody');
  tbody.innerHTML = ALL_DATA.map(d => `<tr>
    <td>${d.temporada||''}</td>
    <td>${d.jugador||''}</td>
    <td>${d.club||''}</td>
    <td>${d.movimiento||''}</td>
    <td>${d.club_origen||''}</td>
    <td>${d.club_destino||''}</td>
    <td>${tPos(d.posicion||'')}</td>
    <td>${d.edad||''}</td>
    <td>${d.nacionalidad||''}</td>
    <td>${d.importe_original||''}</td>
    <td>${d.importe_numerico > 0 ? fmt(d.importe_numerico) : ''}</td>
    <td>${d.tipo_operacion||''}</td>
    <td>${d.valor_mercado||''}</td>
  </tr>`).join('');

  dtInstance = $('#bbdd-table').DataTable({
    pageLength: 25,
    order: [[0, 'desc']],
    language: {
      search: 'Buscar:',
      lengthMenu: 'Mostrar _MENU_ registros',
      info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
      infoEmpty: 'Mostrando 0 registros',
      paginate: { first:'Inicio', last:'Fin', next:'Siguiente', previous:'Anterior' }
    },
    dom: 'Bfrtip',
    buttons: [
      { extend: 'csv', text: 'Exportar CSV', filename: 'fichajes_segunda_division' },
      { extend: 'excel', text: 'Exportar Excel', filename: 'fichajes_segunda_division' }
    ],
    columnDefs: [
      { targets: '_all', defaultContent: '' }
    ]
  });
}

/* ═══════════════════════════════════════════════
   SUB-23 TAB
   ═══════════════════════════════════════════════ */
function renderSub23Tab() {
  const d = ALL_DATA.filter(r => r.edad <= 22);
  const rev = REV_DATA.filter(r => (+r.edad_llegada || 99) <= 22);

  // KPIs
  const kpiEl = document.getElementById('kpis-sub23');
  if (kpiEl) {
    const totalMoney = sumBy(d.filter(r => r.importe_numerico > 0), 'importe_numerico');
    const uniquePlayers = new Set(d.map(r => r.jugador)).size;
    const uniqueClubs   = new Set(d.map(r => r.club)).size;
    kpiEl.innerHTML = [
      { v: d.length,          l: 'Operaciones Sub-23',  c: 'var(--primary)'  },
      { v: uniquePlayers,     l: 'Jugadores únicos',    c: '#c8a951'         },
      { v: uniqueClubs,       l: 'Clubes implicados',   c: '#1d6fa4'         },
      { v: formatM(totalMoney), l: 'Dinero movido',     c: 'var(--primary)', raw: true },
    ].map(k => `
      <div class="kpi-card">
        <div class="kpi-value" style="color:${k.c}">${k.raw ? k.v : k.v.toLocaleString('es-ES')}</div>
        <div class="kpi-label">${k.l}</div>
      </div>`).join('');
  }

  // Chart 1 — Top fichajes Sub-23 by importe
  const topCaros = d.filter(r => r.importe_numerico > 0 && r.movimiento === 'alta')
    .sort((a, b) => b.importe_numerico - a.importe_numerico)
    .slice(0, 12);

  if (topCaros.length > 0) {
    plot('chart-sub23-caros', [{
      type: 'bar', orientation: 'h',
      x: topCaros.map(r => r.importe_numerico / 1e6).reverse(),
      y: topCaros.map(r => `${r.jugador} (${r.temporada})`).reverse(),
      customdata: topCaros.map(r => [r.club, tPos(r.posicion), r.temporada, r.edad]).reverse(),
      hovertemplate: '<b>%{y}</b><br>Club: %{customdata[0]}<br>Posición: %{customdata[1]}<br>Temporada: %{customdata[2]}<br>Edad: %{customdata[3]} años<br>Importe: €%{x:.2f}M<extra></extra>',
      marker: { color: CHART_COLORS[0] },
      text: topCaros.map(r => formatM(r.importe_numerico)).reverse(),
      textposition: 'outside', textfont: { color: '#1a2332', size: 10 }
    }], {
      yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      xaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      height: 380, margin: { t: 30, r: 100, b: 50, l: 200 }
    });
  }

  // Chart 2 — Clubs that sign most U23
  const altasU23 = d.filter(r => r.movimiento === 'alta');
  const byClub = groupBy(altasU23, 'club');
  const clubRanks = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length])), 12);
  if (clubRanks.length > 0) {
    plot('chart-sub23-clubes', [{
      type: 'bar', orientation: 'h',
      x: clubRanks.map(([,v]) => v).reverse(),
      y: clubRanks.map(([k]) => k).reverse(),
      marker: { color: CHART_COLORS[0] },
      hovertemplate: '<b>%{y}</b><br>Fichajes Sub-23: %{x}<extra></extra>',
      text: clubRanks.map(([,v]) => v).reverse(), textposition: 'outside', textfont: { color: '#1a2332', size: 10 }
    }], {
      yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      xaxis: { title: 'Nº fichajes', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      height: 380, margin: { t: 30, r: 60, b: 50, l: 160 }
    });
  }

  // Chart 3 — Positions
  const posCnt = groupBy(d, 'posicion');
  const posRanks = topN(Object.fromEntries(Object.entries(posCnt).map(([k,v]) => [tPos(k), v.length])), 10);
  if (posRanks.length > 0) {
    plot('chart-sub23-pos', [{
      type: 'bar', orientation: 'h',
      x: posRanks.map(([,v]) => v).reverse(),
      y: posRanks.map(([k]) => k).reverse(),
      marker: { color: '#c8a951' },
      text: posRanks.map(([,v]) => v).reverse(), textposition: 'outside', textfont: { color: '#1a2332', size: 10 }
    }], {
      yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      xaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      height: 360, margin: { t: 30, r: 60, b: 50, l: 140 }
    });
  }

  // Chart 4 — Nationalities
  const nacCnt = groupBy(d, 'nacionalidad');
  const nacRanks = topN(Object.fromEntries(Object.entries(nacCnt).map(([k,v]) => [k, v.length])), 12);
  if (nacRanks.length > 0) {
    plot('chart-sub23-nac', [{
      type: 'bar', orientation: 'h',
      x: nacRanks.map(([,v]) => v).reverse(),
      y: nacRanks.map(([k]) => k).reverse(),
      marker: { color: '#1d6fa4' },
      text: nacRanks.map(([,v]) => v).reverse(), textposition: 'outside', textfont: { color: '#1a2332', size: 10 }
    }], {
      yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      xaxis: { title: 'Jugadores', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      height: 380, margin: { t: 30, r: 60, b: 50, l: 130 }
    });
  }

  // Chart 5 — Mean value by position Sub-23 (using _vm field)
  const posVal = Object.entries(groupBy(d.filter(r => r._vm > 0), 'posicion'))
    .map(([p, rows]) => ({ pos: tPos(p), mean: meanBy(rows, '_vm') }))
    .sort((a, b) => b.mean - a.mean);
  if (posVal.length > 0) {
    plot('chart-sub23-valor-pos', [{
      type: 'bar', orientation: 'h',
      x: posVal.map(r => r.mean / 1e6).reverse(),
      y: posVal.map(r => r.pos).reverse(),
      marker: { color: CHART_COLORS[4] },
      text: posVal.map(r => formatM(r.mean)).reverse(), textposition: 'outside', textfont: { color: '#1a2332', size: 10 },
      hovertemplate: '<b>%{y}</b><br>Valor medio: €%{x:.2f}M<extra></extra>'
    }], {
      yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      xaxis: { title: 'Valor medio (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      height: 360, margin: { t: 30, r: 100, b: 50, l: 140 }
    });
  }

  // Chart 6 — Evolution by season
  const bySeason = groupBy(d, 'temporada');
  const seasons  = Object.keys(bySeason).sort();
  if (seasons.length > 0) {
    plot('chart-sub23-evolucion', [{
      type: 'bar',
      x: seasons,
      y: seasons.map(s => bySeason[s].length),
      name: 'Operaciones',
      marker: { color: CHART_COLORS[0] }
    }, {
      type: 'scatter', mode: 'lines+markers',
      x: seasons,
      y: seasons.map(s => sumBy(bySeason[s].filter(r => r.importe_numerico > 0), 'importe_numerico') / 1e6),
      name: 'Dinero (M€)', yaxis: 'y2',
      line: { color: '#c8a951', width: 2 },
      marker: { size: 6 }
    }], {
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: seasons, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      yaxis: { title: 'Operaciones', type: 'linear', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      yaxis2: { title: 'M€', overlaying: 'y', side: 'right', showgrid: false, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
      legend: { orientation: 'h', y: 1.1, bgcolor: 'rgba(0,0,0,0)', font: { size: 10 } },
      height: 340, margin: { t: 50, r: 80, b: 50, l: 60 }
    });
  }

  // Chart 7 — Most revalued U23 (from REV_DATA)
  if (rev.length > 0) {
    const topRev = rev.filter(r => (+r.revalorizacion_abs || 0) > 0)
      .sort((a, b) => (+b.revalorizacion_abs || 0) - (+a.revalorizacion_abs || 0))
      .slice(0, 12);
    if (topRev.length > 0) {
      plot('chart-sub23-rev', [{
        type: 'bar', orientation: 'h',
        x: topRev.map(r => (+r.revalorizacion_abs || 0) / 1e6).reverse(),
        y: topRev.map(r => `${r.jugador} (${r.temporada_llegada||''}→${r.temporada_salida||''})`).reverse(),
        customdata: topRev.map(r => [r.club, tPos(r.posicion), (+r.revalorizacion_pct||0).toFixed(0), r.edad_llegada]).reverse(),
        hovertemplate: '<b>%{y}</b><br>Club: %{customdata[0]}<br>Pos: %{customdata[1]}<br>Revalorización: +%{customdata[2]}%<br>Edad llegada: %{customdata[3]}<extra></extra>',
        marker: { color: CHART_COLORS[0] },
        text: topRev.map(r => `+${formatM(+r.revalorizacion_abs || 0)}`).reverse(),
        textposition: 'outside', textfont: { color: '#1a2332', size: 10 }
      }], {
        yaxis: { automargin: true, gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
        xaxis: { title: 'Revalorización (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
        height: 400, margin: { t: 30, r: 100, b: 50, l: 220 }
      });
    }
  }

  // Table — top Sub-23 operations
  const topOps = d.filter(r => r.importe_numerico > 0 || r._vm > 0)
    .sort((a, b) => (b._vm || 0) - (a._vm || 0))
    .slice(0, 25);

  const tableEl = document.getElementById('table-sub23');
  if (tableEl) {
    tableEl.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="border-bottom:2px solid #009a44">
            <th style="padding:10px 8px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Jugador</th>
            <th style="padding:10px 8px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Club</th>
            <th style="padding:10px 8px;text-align:center;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Temporada</th>
            <th style="padding:10px 8px;text-align:center;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Mov.</th>
            <th style="padding:10px 8px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Edad</th>
            <th style="padding:10px 8px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Posición</th>
            <th style="padding:10px 8px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Importe</th>
            <th style="padding:10px 8px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;font-size:0.72rem">Valor Mdo.</th>
          </tr>
        </thead>
        <tbody>
          ${topOps.map((r, i) => `
            <tr style="border-bottom:1px solid #e5e7eb;background:${i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}">
              <td style="padding:9px 8px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${playerAvatar(r.jugador, 28)}
                  <span style="font-weight:600">${r.jugador || '—'}</span>
                </div>
              </td>
              <td style="padding:9px 8px">
                <div style="display:flex;align-items:center;gap:6px">
                  ${clubShield(r.club) ? `<img src="${clubShield(r.club)}" width="20" height="20" style="object-fit:contain" onerror="this.style.display='none'">` : ''}
                  ${r.club || '—'}
                </div>
              </td>
              <td style="padding:9px 8px;text-align:center;color:#c8a951;font-weight:600">${r.temporada || '—'}</td>
              <td style="padding:9px 8px;text-align:center">
                <span style="background:${r.movimiento==='alta'?'rgba(0,154,68,0.2)':'rgba(220,82,82,0.2)'};
                  color:${r.movimiento==='alta'?'#009a44':'#dc2626'};
                  padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">
                  ${r.movimiento === 'alta' ? '▲ Alta' : '▼ Baja'}
                </span>
              </td>
              <td style="padding:9px 8px;text-align:right;font-weight:700">${r.edad || '—'}</td>
              <td style="padding:9px 8px;color:var(--text-muted)">${tPos(r.posicion || '')}</td>
              <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--primary)">${r.importe_original || '-'}</td>
              <td style="padding:9px 8px;text-align:right;color:var(--text-muted)">${r.valor_mercado || '-'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

/* ============================================================
   BUSCADOR INTELIGENTE
   ============================================================ */

let _buscadorType = 'auto';
let _buscadorReady = false;

function renderBuscadorTab() {
  if (_buscadorReady) return;
  _buscadorReady = true;

  const input = document.getElementById('buscador-input');
  const btn   = document.getElementById('buscador-btn');

  btn.addEventListener('click', () => {
    const q = input.value.trim();
    if (q) executeSearch(q, _buscadorType);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) executeSearch(q, _buscadorType);
    }
  });

  document.querySelectorAll('.search-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.search-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      _buscadorType = pill.dataset.type;
    });
  });

  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.query;
      executeSearch(chip.dataset.query, 'auto');
    });
  });
}

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

async function executeSearch(query, type) {
  if (!query.trim()) return;
  const results = document.getElementById('buscador-results');
  const t = type === 'auto' ? detectSearchType(query) : type;

  let html = '';
  if (t === 'jugador' || t === 'club' || t === 'auto') {
    await new Promise(resolve => loadMasterData(resolve));
    await new Promise(resolve => loadLoanModelData(resolve));
  }
  switch (t) {
    case 'club':         html = searchClub(query); break;
    case 'temporada':    html = searchSeason(query); break;
    case 'posicion':     html = searchPosition(query); break;
    case 'nacionalidad': html = searchNationality(query); break;
    default:             html = searchPlayer(query);
  }

  // Si no hay resultados locales → intentar Transfermarkt
  if (html.includes('no-results') || html.includes('Sin resultados')) {
    await searchWithTM(query, results);
  } else {
    results.innerHTML = html;
  }
}

/* ── Transfermarkt — proxy propio en Render + fallbacks CORS ── */
const TM_BASE = 'https://www.transfermarkt.com';

// URL del proxy desplegado en Render (funciona para todos los usuarios)
// Cuando tengas la URL de Render, actualiza esta constante:
const RENDER_PROXY = 'https://segunda-division-dashboard.onrender.com';

async function tmFetch(url) {
  // 1. Intentar con el proxy propio de Render (más fiable, sin bloqueos)
  try {
    const endpoint = `${RENDER_PROXY}/tm?url=${encodeURIComponent(url)}`;
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(35000) });
    if (r.ok) return r;
  } catch { /* continuar con fallbacks */ }

  // 2. Fallbacks CORS públicos
  const proxies = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const proxy of proxies) {
    try {
      const r = await fetch(proxy(url), { signal: AbortSignal.timeout(9000) });
      if (r.ok) return r;
    } catch { /* probar siguiente */ }
  }
  throw new Error('No se pudo conectar con Transfermarkt');
}

async function tmSearchPlayers(query) {
  const url = `${TM_BASE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(query)}&Spieler_page=0`;
  const r   = await tmFetch(url);
  const html = await r.text();
  return parseTMSearchHTML(html);
}

async function tmPlayerValue(spielerId) {
  const url = `${TM_BASE}/ceapi/marketValueDevelopment/graph/${spielerId}`;
  const r   = await tmFetch(url);
  const data = await r.json();
  const list = data.list || [];
  return list.length ? list[list.length - 1] : null;
}

function parseTMSearchHTML(html) {
  const doc     = new DOMParser().parseFromString(html, 'text/html');
  const players = [];
  const idRe    = /\/spieler\/(\d+)/;

  for (const table of doc.querySelectorAll('table.items')) {
    for (const row of table.querySelectorAll('tbody tr')) {
      const tds = [...row.querySelectorAll('td')];
      if (tds.length < 6) continue;

      // Nombre e ID: están en td con class "hauptlink"
      const nameCell = tds.find(td => td.classList.contains('hauptlink'));
      if (!nameCell) continue;
      const nameLink = nameCell.querySelector('a[href*="/spieler/"]');
      if (!nameLink) continue;

      const href = nameLink.getAttribute('href') || '';
      const m    = href.match(idRe);
      if (!m) continue;

      const pid  = m[1];
      const name = (nameLink.title || nameLink.textContent).trim();
      if (!name || name.length < 2) continue;

      // Foto: extraer src de la img en td[0] o td[1]
      let photoUrl = null;
      for (const td of tds.slice(0, 3)) {
        const img = td.querySelector('img[src*="portrait"]');
        if (img) { photoUrl = img.src || img.getAttribute('src'); break; }
      }

      // Columnas reales de TM (verificadas contra HTML real):
      // td[3]=club, td[4]=posición abrev, td[6]=edad, td[7]=bandera, td[8]=VM
      const club    = tds[3]?.textContent.trim() || '';
      const pos     = tds[4]?.textContent.trim() || '';
      const age     = tds[6]?.textContent.trim() || '';
      const natImg  = tds[7]?.querySelector('img');
      const nat     = natImg?.title || natImg?.alt || '';
      const mvCell  = tds.find(td => td.classList.contains('rechts') && td.classList.contains('hauptlink'))
                   || tds[tds.length - 2];
      const mvText  = mvCell?.textContent.trim() || '';
      const mvNum   = parseTMMV(mvText);

      players.push({
        id: pid, name,
        photo: photoUrl,
        position: pos,
        age,
        nationality: nat,
        club,
        mv_display: mvNum ? mvText.replace(/\s+/g,' ').trim() : '—',
        market_value: mvNum,
        profile_url: `${TM_BASE}${href}`,
      });
      if (players.length >= 8) break;
    }
    if (players.length) break;
  }
  return players;
}

function parseTMMV(text) {
  const m = text.replace(/\s/g,'').match(/([\d,.]+)(Mio\.|k)€/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\./g,'').replace(',','.'));
  return m[2].toLowerCase().includes('mio') ? Math.round(n * 1e6) : Math.round(n * 1e3);
}

async function searchWithTM(query, container) {
  const tmBadge = `<span style="background:rgba(0,154,68,0.12);color:var(--primary-dark);
    padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;margin-left:6px">🌐 Transfermarkt</span>`;

  container.innerHTML = `
    <div class="no-results">
      <p style="color:var(--text-muted)">
        <span style="display:inline-flex;gap:6px;align-items:center">
          <span class="sgpt-typing" style="display:inline-flex"><span></span><span></span><span></span></span>
          Buscando <strong>${query}</strong> en Transfermarkt…
        </span>
      </p>
    </div>`;

  try {
    const players = await tmSearchPlayers(query);
    if (!players.length) {
      container.innerHTML = `<div class="no-results"><p>Sin resultados para "<strong>${query}</strong>".</p></div>`;
      return;
    }
    container.innerHTML = `
      <div class="result-header-bar">
        <span class="result-type-tag player-tag">👤 Jugadores</span>
        ${tmBadge}
        <span class="result-count">${players.length} resultado${players.length !== 1 ? 's' : ''}</span>
      </div>
      ${players.map(buildTMPlayerCard).join('')}`;
  } catch (e) {
    container.innerHTML = `<div class="no-results"><p>No se pudo conectar con Transfermarkt.<br>
      <span style="font-size:0.8rem;color:var(--text-muted)">${e.message}</span></p></div>`;
  }
}

/* Función global de fallback para errores de foto — NO inline para evitar bugs de escape */
window._tmPhotoError = function(el, name, size) {
  const tmp = document.createElement('div');
  tmp.innerHTML = playerAvatar(name, size);
  el.replaceWith(tmp.firstElementChild || tmp);
};

function playerPhoto(name, photoUrl, size = 60) {
  if (!photoUrl) return playerAvatar(name, size);
  const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  // Proporción retrato TM (3:4) → más foto visible, menos zoom
  const w = size, h = Math.round(size * 1.33);
  return `<img src="${photoUrl}" alt="${name}"
    style="width:${w}px;height:${h}px;border-radius:10px;object-fit:cover;
           object-position:center top;border:2px solid var(--border);
           flex-shrink:0;background:var(--bg-2)"
    onerror="_tmPhotoError(this,'${safeName}',${size})">`;
}

async function playerPhotoFromProxy(name, spielerId, size = 60) {
  if (!spielerId) return playerAvatar(name, size);
  try {
    const r = await fetch(`${RENDER_PROXY}/player-photo/${spielerId}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      if (d.url) return playerPhoto(name, d.url, size);
    }
  } catch { /* fallback */ }
  return playerAvatar(name, size);
}

/* Carga evolución del valor de mercado desde TM JSON endpoint */
async function loadPlayerMVHistory(spielerId, containerId) {
  if (!spielerId) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const url  = `${TM_BASE}/ceapi/marketValueDevelopment/graph/${spielerId}`;
    const resp = await tmFetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    const list = (data.list || []).filter(e => e.y);
    if (!list.length) return;

    // Agrupar por año para mostrar resumen compacto
    const maxVal = Math.max(...list.map(e => e.y));
    const rows = list.map(e => {
      const pct  = Math.round((e.y / maxVal) * 100);
      const fmt  = e.y >= 1e6 ? `€${(e.y/1e6).toFixed(2).replace('.00','')}M` : `€${(e.y/1e3).toFixed(0)}k`;
      const color = e.y === maxVal ? 'var(--success)' : 'var(--text)';
      return `<tr>
        <td style="color:var(--text-muted);font-size:0.78rem">${e.datum_mw}</td>
        <td style="font-size:0.8rem">${e.verein || '—'}</td>
        <td style="font-weight:700;color:${color};text-align:right">${fmt}</td>
        <td style="width:100px;padding-left:8px">
          <div style="background:var(--border);border-radius:3px;height:6px">
            <div style="width:${pct}%;height:100%;background:${e.y===maxVal?'var(--success)':'var(--primary)'};border-radius:3px"></div>
          </div>
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="ppc-section-title" style="margin-bottom:10px">📈 Evolución del valor de mercado <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem">— Transfermarkt</span></div>
      <table class="ppc-table" style="font-size:0.8rem">
        <thead><tr><th>Fecha</th><th>Club</th><th style="text-align:right">Valor</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch { /* sin datos */ }
}

function buildTMPlayerCard(p) {
  const mv = p.market_value
    ? `<span class="ppc-badge vm">VM: ${fmtMv(p.market_value)}</span>` : '';
  const photoHtml = p.photo
    ? playerPhoto(p.name, p.photo, 60)
    : playerAvatar(p.name, 60);
  return `
    <div class="player-profile-card">
      <div class="ppc-header">
        ${photoHtml}
        <div class="ppc-header-info">
          <h3 class="ppc-name">${p.name}</h3>
          <div class="ppc-badges">
            ${p.position ? `<span class="ppc-badge pos">${p.position}</span>` : ''}
            ${p.nationality ? `<span class="ppc-badge nac">🌍 ${p.nationality}</span>` : ''}
            ${p.age ? `<span class="ppc-badge age">Edad: ${p.age}</span>` : ''}
            ${mv}
          </div>
          ${p.club ? `<div class="ppc-clubs-list">Club actual: <span class="ppc-club-chip">${p.club}</span></div>` : ''}
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);padding:4px 0 0">
        <a href="${p.profile_url}" target="_blank"
           style="color:var(--primary);text-decoration:none;font-weight:600">
          Ver perfil completo en Transfermarkt ↗
        </a>
      </div>
    </div>`;
}

function detectSearchType(query) {
  const q = norm(query);
  if (/^\d{4}-\d{2}$/.test(query.trim())) return 'temporada';
  const clubs = [...new Set(ALL_DATA.map(d => d.club))].filter(Boolean);
  if (clubs.some(c => norm(c).includes(q) || q.includes(norm(c)))) return 'club';
  const posES = Object.values(POS_ES).map(norm);
  const posEN = Object.keys(POS_ES).map(norm);
  if (posES.some(p => p.includes(q) || q.includes(p)) || posEN.some(p => p.includes(q))) return 'posicion';
  const nacs = [...new Set(ALL_DATA.map(d => d.nacionalidad))].filter(Boolean);
  if (nacs.some(n => norm(n).includes(q))) return 'nacionalidad';
  return 'jugador';
}

function playerNameMatches(rowName, queryName) {
  const a = norm(rowName);
  const b = norm(queryName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = b.split(/\s+/).filter(w => w.length >= 4);
  return words.length && words.every(w => a.includes(w));
}

function getPlayerSeasonStats(name) {
  const masterStats = (MASTER_DATA || [])
    .filter(d => playerNameMatches(d.nombre, name))
    .map(d => ({
      temporada: d.temporada || '—',
      club: d.club || '—',
      entrenador: d.entrenador || '',
      posicion: normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion),
      nacionalidad: d.nacionalidad || '',
      edad: num(d.edad),
      partidos: num(d.partidos),
      minutos: num(d.minutos),
      goles: num(d.goles),
      xg: num(d.xg),
      goles90: num(d.goles_por_90),
      xg90: num(d.xg_por_90),
      valor: num(d.valor_mercado_wyscout) || num(d.valor_mercado),
      sub23: isTrue(d.es_sub23),
      tieneWyscout: isTrue(d.tiene_wyscout),
    }))
    .sort((a, b) => ['2025-26','2024-25','2023-24','2022-23','2021-22'].indexOf(a.temporada) -
      ['2025-26','2024-25','2023-24','2022-23','2021-22'].indexOf(b.temporada));

  if (masterStats.length) return masterStats;

  return (BETIS_PLAYERS_DATA || [])
    .filter(d => playerNameMatches(d.jugador, name))
    .map(d => ({
      temporada: '2025-26',
      club: d.equipo || 'Betis Deportivo',
      entrenador: '',
      posicion: d.posicion_normalizada || d.posicion_primaria || d.posicion_original || '',
      nacionalidad: d.pais_nacimiento || d.pasaporte || '',
      edad: num(d.edad),
      partidos: num(d.partidos_jugados),
      minutos: num(d.minutos_jugados),
      goles: num(d.goles),
      xg: num(d.xg),
      goles90: num(d.goles_por_90),
      xg90: num(d.xg_por_90),
      valor: num(d.valor_mercado),
      sub23: isTrue(d.es_sub23),
      tieneWyscout: true,
    }));
}

function summarizePlayerStats(stats) {
  return {
    temporadas: new Set(stats.map(s => s.temporada)).size,
    clubes: new Set(stats.map(s => s.club).filter(Boolean)).size,
    partidos: stats.reduce((s, r) => s + num(r.partidos), 0),
    minutos: stats.reduce((s, r) => s + num(r.minutos), 0),
    goles: stats.reduce((s, r) => s + num(r.goles), 0),
    xg: stats.reduce((s, r) => s + num(r.xg), 0),
  };
}

function getClubSeasonStats(club) {
  if (!MASTER_DATA || !MASTER_DATA.length) return [];
  const rows = MASTER_DATA.filter(d => d.club === club && num(d.minutos) > 0);
  const bySeason = {};
  rows.forEach(d => {
    const s = d.temporada || '—';
    if (!bySeason[s]) bySeason[s] = { temporada:s, jugadores:new Set(), sub23:new Set(), minutos:0, partidos:0, goles:0, xg:0 };
    bySeason[s].jugadores.add(d.nombre);
    if (isTrue(d.es_sub23)) bySeason[s].sub23.add(d.nombre);
    bySeason[s].minutos += num(d.minutos);
    bySeason[s].partidos += num(d.partidos);
    bySeason[s].goles += num(d.goles);
    bySeason[s].xg += num(d.xg);
  });
  return Object.values(bySeason)
    .map(v => Object.assign({}, v, { jugadores: v.jugadores.size, sub23: v.sub23.size }))
    .sort((a, b) => ['2025-26','2024-25','2023-24','2022-23','2021-22'].indexOf(a.temporada) -
      ['2025-26','2024-25','2023-24','2022-23','2021-22'].indexOf(b.temporada));
}

function getClubTopPerformers(club, limit = 8) {
  if (!MASTER_DATA || !MASTER_DATA.length) return [];
  const byPlayer = {};
  MASTER_DATA.filter(d => d.club === club && num(d.minutos) > 0).forEach(d => {
    const key = d.nombre;
    if (!byPlayer[key]) byPlayer[key] = { nombre:key, posicion:normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion), minutos:0, partidos:0, goles:0, xg:0, temporadas:new Set() };
    byPlayer[key].minutos += num(d.minutos);
    byPlayer[key].partidos += num(d.partidos);
    byPlayer[key].goles += num(d.goles);
    byPlayer[key].xg += num(d.xg);
    byPlayer[key].temporadas.add(d.temporada);
  });
  return Object.values(byPlayer)
    .map(d => Object.assign({}, d, { temporadas: [...d.temporadas].join(', ') }))
    .sort((a, b) => (b.goles - a.goles) || (b.minutos - a.minutos))
    .slice(0, limit);
}

/* --- PLAYER SEARCH --- */
function searchPlayer(query) {
  const q = norm(query);
  const players = [...new Set(ALL_DATA.map(d => d.jugador))].filter(Boolean);
  const masterPlayers = [...new Set((MASTER_DATA || []).map(d => d.nombre))].filter(Boolean);
  const betisPlayers = [...new Set((BETIS_PLAYERS_DATA || []).map(d => d.jugador))].filter(Boolean);
  const matches = [...new Set([
    ...players.filter(p => norm(p).includes(q)),
    ...masterPlayers.filter(p => norm(p).includes(q)),
    ...betisPlayers.filter(p => norm(p).includes(q))
  ])];
  if (!matches.length) return noResults(query);
  const shown = matches.slice(0, 6);
  return `
    <div class="result-header-bar">
      <span class="result-type-tag player-tag">👤 Jugadores</span>
      <span class="result-count">${matches.length} resultado${matches.length !== 1 ? 's' : ''}</span>
    </div>
    ${shown.map(buildPlayerCard).join('')}
    ${matches.length > 6 ? `<p class="more-results">… y ${matches.length - 6} más. Afina la búsqueda.</p>` : ''}`;
}

function buildPlayerCard(name) {
  const ops = ALL_DATA.filter(d => d.jugador === name);
  const stats = getPlayerSeasonStats(name);
  if (!ops.length && !stats.length) return '';
  const ord = ['2021-22','2022-23','2023-24','2024-25','2025-26'];
  const latest = [...ops].sort((a,b) => ord.indexOf(b.temporada) - ord.indexOf(a.temporada))[0];
  const latestStats = stats[0] || null;
  const pos  = tPos(latest?.posicion || latestStats?.posicion || '');
  const nac  = latest?.nacionalidad || latestStats?.nacionalidad || '—';
  const age  = latest?.edad || latestStats?.edad || '—';
  const vm   = latest?._vm ? formatM(latest._vm) : latestStats?.valor ? formatM(latestStats.valor) : '—';
  const clubs = [...new Set(ops.map(d => d.club))];
  const opsSorted = [...ops].sort((a,b) => ord.indexOf(a.temporada) - ord.indexOf(b.temporada));
  const revRows = REV_DATA.filter(d => d.jugador === name);

  const opsHTML = `
    <div class="ppc-section">
      <div class="ppc-section-title">📋 Historial de operaciones</div>
      <table class="ppc-table"><thead><tr>
        <th>Temp.</th><th>Club</th><th>Mov.</th><th>Tipo</th><th>Importe</th><th>VM</th>
      </tr></thead><tbody>
        ${opsSorted.map(op => `<tr>
          <td>${op.temporada||'—'}</td>
          <td>${op.club||'—'}</td>
          <td><span class="mov-badge ${op.movimiento}">${op.movimiento === 'alta' ? '⬆ Alta' : '⬇ Baja'}</span></td>
          <td style="color:var(--text-muted);font-size:0.78rem">${op.tipo_operacion||'—'}</td>
          <td>${op.importe_original||'—'}</td>
          <td>${op._vm ? formatM(op._vm) : '—'}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;

  const statsHTML = stats.length ? `
    <div class="ppc-section">
      <div class="ppc-section-title">📊 Rendimiento por temporada</div>
      <table class="ppc-table"><thead><tr>
        <th>Temp.</th><th>Club</th><th>Entrenador</th><th>Pos.</th><th>Edad</th><th>Part.</th><th>Min</th><th>Goles</th><th>xG</th>
      </tr></thead><tbody>
        ${stats.map(s => `<tr>
          <td>${s.temporada}</td><td class="bold">${s.club}</td><td>${s.entrenador || '—'}</td>
          <td class="muted">${s.posicion || '—'}</td><td>${s.edad || '—'}</td><td>${fmt(s.partidos)}</td>
          <td>${fmt(s.minutos)}</td><td>${fmt(s.goles)}</td><td>${s.xg ? s.xg.toFixed(2) : '—'}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>` : '';

  let revHTML = '';
  if (revRows.length) {
    const rv = revRows[0];
    const abs = +rv.revalorizacion_abs || 0;
    const pct = +rv.revalorizacion_pct || 0;
    revHTML = `
      <div class="ppc-section">
        <div class="ppc-section-title">📈 Revalorización</div>
        <div class="ppc-rev-grid">
          <div class="ppc-rev-item"><span class="ppc-rev-label">VM llegada</span><span class="ppc-rev-value">${rv.vm_llegada ? formatM(+rv.vm_llegada) : '—'}</span></div>
          <div class="ppc-rev-item"><span class="ppc-rev-label">VM salida</span><span class="ppc-rev-value">${rv.vm_salida ? formatM(+rv.vm_salida) : '—'}</span></div>
          <div class="ppc-rev-item"><span class="ppc-rev-label">Revalorización</span><span class="ppc-rev-value ${abs > 0 ? 'positive' : abs < 0 ? 'negative' : ''}">${formatM(abs)}</span></div>
          <div class="ppc-rev-item"><span class="ppc-rev-label">ROI %</span><span class="ppc-rev-value ${pct > 0 ? 'positive' : pct < 0 ? 'negative' : ''}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span></div>
        </div>
      </div>`;
  }

  // IDs únicos para foto y stats
  const idEntry   = window._jugadorIds?.find(r => r.jugador === name);
  const spielerId = idEntry?.spieler_id || null;
  const uid       = name.replace(/[^a-zA-Z0-9]/g,'_');
  const photoId   = `photo_${uid}`;
  const statsId   = `stats_${uid}`;

  // Carga foto y evolución de VM en background
  setTimeout(async () => {
    if (spielerId) {
      const el = document.getElementById(photoId);
      if (el) {
        const html = await playerPhotoFromProxy(name, spielerId, 75);
        el.outerHTML = html;
      }
      loadPlayerMVHistory(spielerId, statsId);
    }
  }, 0);

  return `
    <div class="player-profile-card">
      <div class="ppc-header">
        <div id="${photoId}">${playerAvatar(name, 72)}</div>
        <div class="ppc-header-info">
          <h3 class="ppc-name">${name}</h3>
          <div class="ppc-badges">
            <span class="ppc-badge pos">${pos}</span>
            <span class="ppc-badge nac">🌍 ${nac}</span>
            <span class="ppc-badge age">Edad: ${age}</span>
            <span class="ppc-badge vm">VM: ${vm}</span>
          </div>
          ${clubs.length ? `<div class="ppc-clubs-list">Clubes en 2ª:
            ${clubs.map(c => `<span class="ppc-club-chip">${c}</span>`).join('')}
          </div>` : ''}
        </div>
      </div>
      ${ops.length ? opsHTML : ''}${statsHTML}${revHTML}
      <div class="ppc-section" id="${statsId}" style="min-height:20px"></div>
    </div>`;
}

/* --- CLUB SEARCH --- */
function searchClub(query) {
  const q = norm(query);
  const clubs = [...new Set(ALL_DATA.map(d => d.club))].filter(Boolean);
  const matches = clubs.filter(c => norm(c).includes(q));
  if (!matches.length) return noResults(query);
  return `
    <div class="result-header-bar">
      <span class="result-type-tag club-tag">🏟️ Clubes</span>
      <span class="result-count">${matches.length} resultado${matches.length !== 1 ? 's' : ''}</span>
    </div>
    ${matches.slice(0, 4).map(buildClubCard).join('')}`;
}

function buildClubCard(clubName) {
  const ops    = ALL_DATA.filter(d => d.club === clubName);
  const altas  = ops.filter(d => d.movimiento === 'alta');
  const bajas  = ops.filter(d => d.movimiento === 'baja');
  const gasto  = sumBy(altas, 'importe_numerico');
  const ingreso= sumBy(bajas, 'importe_numerico');
  const balance= ingreso - gasto;
  const shield = clubShield(clubName);
  const seasonStats = getClubSeasonStats(clubName);
  const topPerformers = getClubTopPerformers(clubName, 6);

  const revOps = REV_DATA.filter(d => d.club === clubName);
  const totalRev = revOps.reduce((s,d) => s + (+d.revalorizacion_abs || 0), 0);
  const roiMean  = revOps.length ? revOps.reduce((s,d) => s + (+d.revalorizacion_pct || 0), 0) / revOps.length : null;

  const topJugadores = [...new Set(bajas.filter(d => d.importe_numerico > 0)
    .sort((a,b) => b.importe_numerico - a.importe_numerico)
    .map(d => d.jugador))].slice(0, 5);

  const topDevs = revOps.sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0, 5);

  return `
    <div class="club-result-card">
      <div class="crc-header">
        ${shield ? `<img src="${shield}" class="crc-shield" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="crc-name">${clubName}</div>
          <div style="font-size:0.75rem;color:var(--text-muted)">${ops.length} operaciones · ${altas.length} altas · ${bajas.length} bajas</div>
        </div>
      </div>
      <div class="crc-kpis">
        <div class="crc-kpi"><div class="crc-kpi-value red">${formatM(gasto)}</div><div class="crc-kpi-label">Gasto total</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value green">${formatM(ingreso)}</div><div class="crc-kpi-label">Ingresos</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value ${balance >= 0 ? 'green' : 'red'}">${balance >= 0 ? '+' : ''}${formatM(balance)}</div><div class="crc-kpi-label">Balance neto</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value green">${formatM(totalRev)}</div><div class="crc-kpi-label">Valor generado</div></div>
        ${roiMean !== null ? `<div class="crc-kpi"><div class="crc-kpi-value ${roiMean >= 0 ? 'green' : 'red'}">${roiMean >= 0 ? '+' : ''}${roiMean.toFixed(0)}%</div><div class="crc-kpi-label">ROI medio</div></div>` : ''}
      </div>
      ${topJugadores.length ? `
        <div class="ppc-section">
          <div class="ppc-section-title">💰 Mayores traspasos de salida</div>
          <div class="ppc-clubs-list">${topJugadores.map(j => `<span class="ppc-club-chip">${j}</span>`).join('')}</div>
        </div>` : ''}
      ${topDevs.length ? `
        <div class="ppc-section">
          <div class="ppc-section-title">📈 Jugadores más revalorizados</div>
          <table class="ppc-table"><thead><tr><th>Jugador</th><th>Posición</th><th>Revalorización</th><th>ROI %</th></tr></thead>
          <tbody>${topDevs.map(d => `<tr>
            <td>${d.jugador}</td>
            <td style="color:var(--text-muted)">${d.posicion_es || tPos(d.posicion||'')}</td>
            <td style="color:var(--success);font-weight:700">${formatM(+d.revalorizacion_abs||0)}</td>
            <td style="color:var(--success);font-weight:700">${(+d.revalorizacion_pct||0).toFixed(0)}%</td>
          </tr>`).join('')}</tbody></table>
        </div>` : ''}
      ${seasonStats.length ? `
        <div class="ppc-section">
          <div class="ppc-section-title">📊 Rendimiento agregado por temporada</div>
          <table class="ppc-table"><thead><tr>
            <th>Temp.</th><th>Jugadores</th><th>Sub23</th><th>Partidos</th><th>Min</th><th>Goles</th><th>xG</th>
          </tr></thead><tbody>
            ${seasonStats.map(s => `<tr>
              <td>${s.temporada}</td><td>${s.jugadores}</td><td>${s.sub23}</td><td>${fmt(s.partidos)}</td>
              <td>${fmt(s.minutos)}</td><td>${fmt(s.goles)}</td><td>${s.xg ? s.xg.toFixed(2) : '—'}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>` : ''}
      ${topPerformers.length ? `
        <div class="ppc-section">
          <div class="ppc-section-title">⚽ Producción ofensiva destacada</div>
          <table class="ppc-table"><thead><tr>
            <th>Jugador</th><th>Pos.</th><th>Temp.</th><th>Min</th><th>Goles</th><th>xG</th>
          </tr></thead><tbody>
            ${topPerformers.map(p => `<tr>
              <td class="bold">${p.nombre}</td><td class="muted">${p.posicion || '—'}</td><td>${p.temporadas || '—'}</td>
              <td>${fmt(p.minutos)}</td><td>${fmt(p.goles)}</td><td>${p.xg ? p.xg.toFixed(2) : '—'}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>` : ''}
    </div>`;
}

/* --- SEASON SEARCH --- */
function searchSeason(query) {
  const q = query.trim();
  const data = ALL_DATA.filter(d => d.temporada === q);
  if (!data.length) return noResults(query);

  const altas  = data.filter(d => d.movimiento === 'alta');
  const bajas  = data.filter(d => d.movimiento === 'baja');
  const byClub = groupBy(data, 'club');
  const topClubs = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length])), 5);
  const topFichajes = [...data].filter(d => d.importe_numerico > 0).sort((a,b) => b.importe_numerico - a.importe_numerico).slice(0, 10);
  const byPos = groupBy(data, 'posicion');
  const topPos = topN(Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k, v.length])), 6);

  return `
    <div class="result-header-bar">
      <span class="result-type-tag season-tag">📅 Temporada</span>
      <span class="result-count">${data.length} operaciones</span>
    </div>
    <div class="season-result-card">
      <div class="crc-kpis" style="margin-bottom:20px">
        <div class="crc-kpi"><div class="crc-kpi-value">${data.length}</div><div class="crc-kpi-label">Operaciones</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value">${altas.length}</div><div class="crc-kpi-label">Altas</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value">${bajas.length}</div><div class="crc-kpi-label">Bajas</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value">${formatM(sumBy(data,'importe_numerico'))}</div><div class="crc-kpi-label">Dinero total</div></div>
        <div class="crc-kpi"><div class="crc-kpi-value">${Object.keys(byClub).length}</div><div class="crc-kpi-label">Clubes activos</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;flex-wrap:wrap">
        <div>
          <div class="ppc-section-title" style="margin-bottom:10px">💰 Top fichajes</div>
          ${topFichajes.map((d,i) => `
            <div class="result-list-row" style="padding:7px 0;border-bottom:1px solid var(--border)">
              <span class="rr-pos">${i+1}</span>
              <span class="rr-name" style="font-size:0.82rem">${d.jugador}</span>
              <span class="rr-val" style="font-size:0.82rem">${formatM(d.importe_numerico)}</span>
            </div>`).join('')}
        </div>
        <div>
          <div class="ppc-section-title" style="margin-bottom:10px">⚽ Posiciones más demandadas</div>
          ${topPos.map(([pos,cnt],i) => `
            <div class="result-list-row" style="padding:7px 0;border-bottom:1px solid var(--border)">
              <span class="rr-pos">${i+1}</span>
              <span class="rr-name" style="font-size:0.82rem">${tPos(pos)}</span>
              <span class="rr-val" style="font-size:0.82rem">${cnt} ops</span>
            </div>`).join('')}
        </div>
        <div>
          <div class="ppc-section-title" style="margin-bottom:10px">🏟️ Clubes más activos</div>
          ${topClubs.map(([club,cnt],i) => `
            <div class="result-list-row" style="padding:7px 0;border-bottom:1px solid var(--border)">
              <span class="rr-pos">${i+1}</span>
              <span class="rr-name" style="font-size:0.82rem">${club}</span>
              <span class="rr-val" style="font-size:0.82rem">${cnt} ops</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

/* --- POSITION SEARCH --- */
function searchPosition(query) {
  const q = norm(query);
  const posMap = {};
  Object.entries(POS_ES).forEach(([en, es]) => { posMap[en] = es; posMap[es] = es; });
  const matchedES = Object.entries(posMap).filter(([k]) => norm(k).includes(q)).map(([,v]) => v);
  const uniqueES = [...new Set(matchedES)];
  if (!uniqueES.length) return noResults(query);

  const reverseMap = {};
  Object.entries(POS_ES).forEach(([en, es]) => { (reverseMap[es] = reverseMap[es] || []).push(en); });

  const out = uniqueES.map(posES => {
    const posENs = reverseMap[posES] || [];
    const data = ALL_DATA.filter(d => posENs.includes(d.posicion) || tPos(d.posicion||'') === posES);
    const byClub = groupBy(data, 'club');
    const topClubs = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length])), 8);
    const revRows = REV_DATA.filter(d => (d.posicion_es || tPos(d.posicion||'')) === posES);
    const avgVM = data.length ? meanBy(data, '_vm') : 0;

    return `
      <div class="club-result-card">
        <div class="crc-header">
          <div>
            <div class="crc-name">⚽ ${posES}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${data.length} operaciones · VM medio: ${formatM(avgVM)}</div>
          </div>
        </div>
        <div class="crc-kpis">
          <div class="crc-kpi"><div class="crc-kpi-value">${data.length}</div><div class="crc-kpi-label">Operaciones</div></div>
          <div class="crc-kpi"><div class="crc-kpi-value">${formatM(avgVM)}</div><div class="crc-kpi-label">VM medio</div></div>
          <div class="crc-kpi"><div class="crc-kpi-value">${formatM(sumBy(data,'importe_numerico'))}</div><div class="crc-kpi-label">Dinero movido</div></div>
          <div class="crc-kpi"><div class="crc-kpi-value">${revRows.length > 0 ? (revRows.reduce((s,d) => s + (+d.revalorizacion_pct||0), 0) / revRows.length).toFixed(0) + '%' : '—'}</div><div class="crc-kpi-label">ROI medio</div></div>
        </div>
        <div class="ppc-section">
          <div class="ppc-section-title">🏟️ Clubes con más fichajes en esta posición</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${topClubs.map(([c,n]) => `<span class="ppc-club-chip">${c} (${n})</span>`).join('')}
          </div>
        </div>
      </div>`;
  });

  return `
    <div class="result-header-bar">
      <span class="result-type-tag pos-tag">⚽ Posición</span>
    </div>
    ${out.join('')}`;
}

/* --- NATIONALITY SEARCH --- */
function searchNationality(query) {
  const q = norm(query);
  const nacs = [...new Set(ALL_DATA.map(d => d.nacionalidad))].filter(Boolean);
  const matches = nacs.filter(n => norm(n).includes(q));
  if (!matches.length) return noResults(query);

  const out = matches.slice(0, 3).map(nac => {
    const data = ALL_DATA.filter(d => d.nacionalidad === nac);
    const revRows = REV_DATA.filter(d => d.nacionalidad === nac);
    const topPlayers = [...data].sort((a,b) => b._vm - a._vm).slice(0, 6);
    const avgROI = revRows.length ? revRows.reduce((s,d) => s + (+d.revalorizacion_pct||0), 0) / revRows.length : null;

    return `
      <div class="club-result-card">
        <div class="crc-header">
          <div>
            <div class="crc-name">🌍 ${nac}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${data.length} operaciones · ${[...new Set(data.map(d=>d.jugador))].length} jugadores únicos</div>
          </div>
        </div>
        <div class="crc-kpis">
          <div class="crc-kpi"><div class="crc-kpi-value">${[...new Set(data.map(d=>d.jugador))].length}</div><div class="crc-kpi-label">Jugadores</div></div>
          <div class="crc-kpi"><div class="crc-kpi-value">${formatM(meanBy(data,'_vm'))}</div><div class="crc-kpi-label">VM medio</div></div>
          <div class="crc-kpi"><div class="crc-kpi-value">${formatM(sumBy(data,'importe_numerico'))}</div><div class="crc-kpi-label">Dinero movido</div></div>
          ${avgROI !== null ? `<div class="crc-kpi"><div class="crc-kpi-value ${avgROI>=0?'green':'red'}">${avgROI>=0?'+':''}${avgROI.toFixed(0)}%</div><div class="crc-kpi-label">ROI medio</div></div>` : ''}
        </div>
        <div class="ppc-section">
          <div class="ppc-section-title">👤 Jugadores destacados (por VM)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${topPlayers.map(d => `<span class="ppc-club-chip">${d.jugador} · ${formatM(d._vm)}</span>`).join('')}
          </div>
        </div>
      </div>`;
  });

  return `
    <div class="result-header-bar">
      <span class="result-type-tag nac-tag">🌍 Nacionalidad</span>
      <span class="result-count">${matches.length} resultado${matches.length !== 1 ? 's' : ''}</span>
    </div>
    ${out.join('')}`;
}

function noResults(query) {
  return `<div class="no-results"><p>Sin resultados para "<strong>${query}</strong>".<br><span style="font-size:0.8rem;color:var(--text-muted)">Prueba con el nombre exacto o cambia el tipo de búsqueda.</span></p></div>`;
}

/* ============================================================
   SCOUTGPT — Motor de consultas en lenguaje natural
   ============================================================ */

let _sgptReady = false;
let _aiEnabled = false;   // true cuando el proxy confirma que Groq está activo

function renderScoutGPTTab() {
  if (_sgptReady) return;
  _sgptReady = true;

  // Precargar el master para consultas de desarrollo/entrenadores
  loadMasterData(() => {});
  loadLoanModelData(() => {});
  loadDecisionModelData(() => {});
  loadOperationContext(() => {});
  loadOperationModelReport(() => {});

  const input = document.getElementById('scoutgpt-input');
  const btn   = document.getElementById('scoutgpt-send');

  const send = async () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    addSgptMessage('user', q);
    addSgptTyping();

    let html;
    const qn = norm(q);
    if (isDecisionModelQuery(qn) || isLocalStatsQuery(qn) || isOperationModelQualityQuery(qn)) {
      await new Promise(resolve => loadLoanModelData(resolve));
      await new Promise(resolve => loadDecisionModelData(resolve));
      await new Promise(resolve => loadOperationModelReport(resolve));
      await new Promise(resolve => loadMasterData(resolve));
      html = processScoutQuery(q);
    } else {
      await new Promise(resolve => loadLoanModelData(resolve));
      await new Promise(resolve => loadDecisionModelData(resolve));
      await new Promise(resolve => loadOperationContext(resolve));
      const betisPlayer = detectBetisPlayerInQuery(qn);
      const opClub = detectSegundaActualInQuery(qn);
      if (betisPlayer) {
        html = processScoutQuery(q);
      } else if (opClub && detectAnyPlayerInQuery(qn, opClub)) {
        // Análisis de operación jugador→club (cualquier jugador de Segunda)
        html = sgptAnalyzeOperation(detectAnyPlayerInQuery(qn, opClub), opClub);
      } else if (_aiEnabled && !isDirectTMQuery(q)) {
        html = await processWithAI(q);
      } else if (isDirectTMQuery(q)) {
        html = await processLiveQuery(q);
      } else {
        await new Promise(r => setTimeout(r, 260));
        html = processScoutQuery(q);
      }
    }
    removeTyping();
    addSgptMessage('bot', html);
  };

  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  document.querySelectorAll('.sgpt-chip').forEach(chip => {
    chip.addEventListener('click', () => { input.value = chip.textContent.trim(); send(); });
  });

  // Comprobar estado del proxy y si tiene IA
  fetch(`${RENDER_PROXY}/status`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(d => {
      _aiEnabled = d.ai === true;
      const aiNote = _aiEnabled
        ? `<span style="color:var(--success);font-weight:600">🤖 IA activa</span> — respondo con inteligencia artificial sobre los datos de Segunda División.`
        : `Respondo sobre Segunda División 2021-2026. <span class="muted">(IA no configurada — usando motor de reglas)</span>`;
      addSgptMessage('bot', `<strong>Hola, soy ScoutGPT 👋</strong><br>${aiNote}<br>
        <span class="muted">También puedo buscar cualquier jugador en Transfermarkt. 🌐</span>`);
    })
    .catch(() => {
      addSgptMessage('bot', `<strong>Hola, soy ScoutGPT 👋</strong><br>
        Respondo preguntas sobre Segunda División 2021-2026.`);
    });
}

/* --- Typing indicator helpers --- */
function addSgptTyping() {
  const c = document.getElementById('scoutgpt-messages');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'sgpt-msg bot sgpt-typing-row';
  el.innerHTML = `<div class="sgpt-avatar bot">🤖</div>
    <div class="sgpt-typing"><span></span><span></span><span></span></div>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}
function removeTyping() {
  document.querySelectorAll('.sgpt-typing-row').forEach(el => el.remove());
}

/* --- Detecta si la pregunta es explícitamente para TM (buscar jugador externo) --- */
function isDirectTMQuery(raw) {
  const q = norm(raw);
  // Palabras clave de búsqueda en TM
  if (/busca|encuentra|valor actual|cuanto vale|cuánto vale|transfermarkt|quien es|quién es/.test(q)) return true;
  // Palabras que claramente son del dataset local → NO ir a TM
  const localKw = /sub.?23|revalori|temporada|ranking|top|gasto|invirti|vendi|fich|traspas|posici|naciona|roi|segunda|division|club|equipo|balance|importe/;
  if (localKw.test(q)) return false;
  // Consulta muy corta con palabras capitalizadas no en el dataset → nombre propio para TM
  const words = raw.trim().split(/\s+/).filter(w => w.length > 3);
  if (words.length <= 3 && words.every(w => /^[A-ZÁÉÍÓÚÑÜ]/.test(w))) {
    const players = new Set(ALL_DATA.map(d => norm(d.jugador)));
    const inDataset = words.some(w => [...players].some(p => p.includes(norm(w))));
    return !inDataset;  // si no está en dataset → buscarlo en TM
  }
  return false;
}

/* --- Procesa consulta con IA (Groq) --- */
async function processWithAI(question) {
  const context = buildQueryContext(question);
  try {
    const r = await fetch(`${RENDER_PROXY}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error);

    const rawAnswer = d.answer || '';
    const html      = formatAIResponse(rawAnswer);
    const photos    = await buildPhotoChips(rawAnswer);
    return (photos ? photos + '<br>' : '') + html;
  } catch (e) {
    // Fallback al motor de reglas
    return processScoutQuery(question) +
      `<br><span class="muted" style="font-size:0.75rem">⚠ IA no disponible: ${e.message}</span>`;
  }
}

/* --- Convierte respuesta markdown de la IA a HTML --- */
function formatAIResponse(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(\d+)\.\s/gm, '<br><span style="color:var(--text-muted);font-size:0.75rem">$1.</span> ')
    .replace(/^[-•]\s/gm, '<br>• ')
    .replace(/\n\n+/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .replace(/^<br>/, '');
}

/* --- Genera chips con foto para jugadores mencionados en la respuesta --- */
async function buildPhotoChips(text) {
  if (!window._jugadorIds) return '';
  const mentioned = window._jugadorIds.filter(r =>
    text.includes(r.jugador) || text.includes(r.jugador.split(' ')[0])
  ).slice(0, 6);
  if (!mentioned.length) return '';

  const chips = await Promise.all(mentioned.map(async r => {
    let photoHtml = playerAvatar(r.jugador, 36);
    try {
      const resp = await fetch(`${RENDER_PROXY}/player-photo/${r.spieler_id}`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const d = await resp.json();
        if (d.url) photoHtml = playerPhoto(r.jugador, d.url, 36);
      }
    } catch { /* usa avatar */ }
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);
      border:1px solid var(--border);border-radius:20px;padding:3px 10px 3px 3px;
      font-size:0.78rem;font-weight:600">${photoHtml} ${r.jugador}</span>`;
  }));
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${chips.join('')}</div>`;
}

/* --- Live query handler (usa CORS proxy, sin instalación) --- */
async function processLiveQuery(raw) {
  const badge = `<span style="background:rgba(0,154,68,0.12);color:var(--primary-dark);
    padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;margin-left:6px">🌐 Transfermarkt</span>`;

  try {
    // Si tenemos el ID del jugador en nuestro dataset → buscar valor actual directo
    const idMatch = matchLocalPlayerById(raw);
    if (idMatch) {
      const last = await tmPlayerValue(idMatch.id);
      if (last) {
        return `<strong>${idMatch.name}</strong>${badge}<br>
          Valor actual: <span style="color:var(--success);font-weight:800;font-size:1.1rem">${fmtMv(last.y)}</span><br>
          Club: ${last.verein || '—'} · ${last.datum_mw || ''}`;
      }
    }

    // Búsqueda libre por nombre
    const term    = extractSearchTerm(raw);
    const players = await tmSearchPlayers(term);

    if (!players.length) {
      return `Sin resultados en Transfermarkt para "<strong>${term}</strong>".${badge}<br>
        <span class="muted">Intenta con el nombre completo o en inglés.</span>`;
    }

    const rows = players.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="bold"><a href="${p.profile_url}" target="_blank"
          style="color:var(--primary);text-decoration:none">${p.name} ↗</a></td>
        <td class="muted">${p.position || '—'}</td>
        <td class="muted">${p.age || '—'}</td>
        <td class="muted">${p.nationality || '—'}</td>
        <td>${p.club || '—'}</td>
        <td class="green">${p.mv_display || '—'}</td>
      </tr>`).join('');

    return `Resultados para "<strong>${term}</strong>"${badge}<br>
      <table>
        <thead><tr><th>#</th><th>Jugador</th><th>Posición</th><th>Edad</th><th>Nac.</th><th>Club</th><th>VM</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

  } catch (e) {
    return processScoutQuery(raw) +
      `<br><span class="muted" style="font-size:0.78rem">⚠ Sin conexión a Transfermarkt: ${e.message}</span>`;
  }
}

function matchLocalPlayerById(raw) {
  if (!window._jugadorIds) return null;
  const q = norm(raw);
  const m = window._jugadorIds.find(r =>
    norm(r.jugador).split(' ').some(w => w.length > 3 && q.includes(w))
  );
  return m ? { id: m.spieler_id, name: m.jugador } : null;
}

function extractSearchTerm(raw) {
  return raw
    .replace(/busca|encuentra|dime|cuánto vale|cuanto vale|valor de mercado de|quién es|quien es|información de|datos de/gi, '')
    .replace(/en transfermarkt|tiempo real|valor actual|ahora/gi, '')
    .replace(/[¿?¡!]/g, '')
    .trim();
}

function fmtMv(n) {
  if (!n) return '—';
  if (n >= 1e6) return `€${(n / 1e6).toFixed(2).replace('.00', '')}M`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}k`;
  return `€${n}`;
}

/* --- Carga opcional de jugador_ids.csv para match por ID --- */
(function loadJugadorIds() {
  Papa.parse(dataPath('jugador_ids.csv'), {
    header: true, download: true,
    complete: r => { window._jugadorIds = r.data.filter(d => d.jugador && d.spieler_id); },
    error: () => {}
  });
})();

function addSgptMessage(role, html) {
  const container = document.getElementById('scoutgpt-messages');
  if (!container) return;

  if (role === 'user') {
    const msg = document.createElement('div');
    msg.className = 'sgpt-msg user';
    msg.innerHTML = `
      <div class="sgpt-avatar user">Tú</div>
      <div class="sgpt-bubble">${html}</div>`;
    container.appendChild(msg);
  } else {
    const typing = document.createElement('div');
    typing.className = 'sgpt-msg bot';
    typing.innerHTML = `<div class="sgpt-avatar bot">🤖</div>
      <div class="sgpt-typing"><span></span><span></span><span></span></div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    setTimeout(() => {
      container.removeChild(typing);
      const msg = document.createElement('div');
      msg.className = 'sgpt-msg bot';
      msg.innerHTML = `<div class="sgpt-avatar bot">🤖</div><div class="sgpt-bubble">${html}</div>`;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    }, 260);
  }
  container.scrollTop = container.scrollHeight;
}

/* --- Query Parser --- */
function processScoutQuery(raw) {
  const q = norm(raw);

  // Amount detection (millones)
  const mMatch = q.match(/m[aá]s de (\d+(?:[.,]\d+)?)\s*(?:millon(?:es)?|m\b)/);
  const amount  = mMatch ? parseFloat(mMatch[1].replace(',','.')) * 1e6 : null;
  const kMatch  = !mMatch && q.match(/m[aá]s de (\d+(?:[.,]\d+)?)\s*(?:mil|k\b)/);
  const amountK = kMatch ? parseFloat(kMatch[1].replace(',','.')) * 1e3 : null;
  const threshold = amount || amountK || null;

  // Top N
  const topMatch = q.match(/(?:top|los?|las?)\s+(\d+)/);
  const topLimit = topMatch ? +topMatch[1] : 20;

  // Club detection
  const detectedClub = detectClubInQuery(q);

  // Age range detection
  const ageMatch = q.match(/(\d{1,2})\s*(?:y|a)\s*(?:los\s*)?(\d{1,2})\s*a[nñ]o/);
  const ageRange = ageMatch ? [+ageMatch[1], +ageMatch[2]].sort((a,b)=>a-b) : null;

  // Position detection
  const detectedPos = detectPositionInQuery(q);

  // Temporada dentro de la query: "23-24", "2023-24", "la 22-23"…
  const detectedSeason = detectSeasonInQuery(q);

  // Flags
  const isVenta    = /vendid|baj[ao]|sal[ei]|traspas.*sal|ingres/.test(q);
  const isCompra   = /compra|fich|alta|contrat|incorpora|adquiri/.test(q);
  const isGasto    = /gast[oó]|gastaron|invirti[oó]|desembolso|desembolsaron|spend/.test(q);
  const isSub23    = /sub.?23|jov[ei]n|menor.*23/.test(q);
  const isROI      = /\broi\b|retorno|rendimiento/.test(q);
  const isRev      = /revalori|valor.*subi|creci|valor.*genera/.test(q);
  const isNac      = /nacional|pa[ií]s/.test(q);
  const isClubs    = /club|equipo|equipos|clubes/.test(q);
  const isJugadors = /jugador|jugadores/.test(q) || !isClubs;
  const isPosicion = !!detectedPos || /posici[oó]n/.test(q);
  const isMasCaro  = /m[aá]s caro|fichaje caro|traspaso caro|mayor importe/.test(q);
  const isActivo   = /activ|operacion|movimiento|m[aá]s.*fich/.test(q);
  const isRanking  = /ranking|top|m[aá]s|mayor|mejor/.test(q);
  const isLoanDestination = isLoanDestinationQuery(q);
  const isDecisionModel = isDecisionModelQuery(q);

  // --- Routing ---

  if (isOperationModelQualityQuery(q)) return sgptOperationModelReport();

  // Evaluación DIRIGIDA: jugador Betis + club destino concreto + operación
  // Ej: "¿sería buena la cesión de Rodrigo Marina al Ceuta?" / "¿vender a Morante al Andorra?"
  if ((isDecisionModel || isLoanDestination) && RF_DESTINATION_RECOMMENDATIONS.length) {
    const betisPlayer = detectBetisPlayerInQuery(q);
    const destClub = detectDestinationClubInQuery(q, betisPlayer);
    if (betisPlayer && destClub) {
      const operacion = /vend|traspas|vent/.test(q) ? 'venta' : 'cesion';
      return sgptEvaluateMove(betisPlayer.jugador, destClub, operacion);
    }
  }

  // ANÁLISIS DE OPERACIÓN general: cualquier jugador + club de Segunda 2025-26
  // Ej: "¿cómo ves a Pablo García en el Cádiz?" · "X al Sporting" · "encaje de X en Y"
  if (WY_DATA.length) {
    const segClub = detectSegundaActualInQuery(q);
    if (segClub) {
      const anyPlayer = detectAnyPlayerInQuery(q, segClub);
      if (anyPlayer) return sgptAnalyzeOperation(anyPlayer, segClub);
    }
  }

  // Modelo RF para decision/operacion recomendada de jugadores Betis Deportivo
  if (isDecisionModel) {
    const betisPlayer = detectBetisPlayerInQuery(q);
    if (betisPlayer) return sgptDecisionForBetisPlayer(betisPlayer.jugador);
    if (detectedPos) return sgptDecisionForPosition(detectedPos, topLimit);
    return sgptDecisionOverview(topLimit);
  }

  // Modelo explicable de destinos de cesión para jugadores del Betis Deportivo
  if (isLoanDestination) {
    const betisPlayer = detectBetisPlayerInQuery(q);
    if (betisPlayer && RF_DESTINATION_RECOMMENDATIONS.length) return sgptDecisionForBetisPlayer(betisPlayer.jugador);
    if (betisPlayer) return sgptLoanDestinationsForPlayer(betisPlayer.jugador, topLimit);
    if (detectedPos) return sgptLoanDestinationsForPosition(detectedPos, topLimit);
    return sgptLoanDestinationsOverview(topLimit);
  }

  // Club + temporada
  if (detectedClub && detectedSeason) return sgptClubEnTemporada(detectedClub, detectedSeason);

  // Temporada sola + intención
  if (detectedSeason && (isGasto || isCompra || isRanking) && !isVenta) return sgptTopGastadoresSeason(detectedSeason, topLimit);
  if (detectedSeason && isVenta) return sgptTopVendedoresSeason(detectedSeason, topLimit);
  if (detectedSeason && isActivo) return sgptTopActivosSeason(detectedSeason, topLimit);
  if (detectedSeason && isMasCaro) return sgptTopFichajesSeason(detectedSeason, topLimit);
  if (detectedSeason) return sgptResumenTemporada(detectedSeason);

  // Club solo
  if (detectedClub && (isVenta || threshold)) return sgptClubVentas(detectedClub, threshold);
  if (detectedClub && (isCompra || isGasto)) return sgptClubCompras(detectedClub, threshold);
  if (detectedClub) return sgptClubOverview(detectedClub);

  // Desarrollo de talento desde master_player_development.csv
  if (/entrenador/.test(q) && detectedPos && /desarroll|mejor|utiliza|usa/.test(q)) return sgptEntrenadoresDesarrollanPosicion(detectedPos, topLimit);
  if (isClubs && detectedPos && /desarroll|mejor|utiliza|usa|valor/.test(q)) return sgptClubesDesarrollanPosicion(detectedPos, topLimit);
  if (isSub23 && detectedPos) return sgptSub23PorPosicion(detectedPos, q, topLimit);
  if (/entrenador/.test(q) && isSub23) return sgptEntrenadoresSub23Uso(topLimit);
  if (isClubs && isSub23) return sgptClubesSub23Uso(topLimit);

  // Gasto / compras globales sin club ni temporada
  if (isClubs && (isGasto || isCompra) && isRanking) return sgptTopGastadoresSeason(null, topLimit);

  if (isSub23 && isRev) return sgptSub23Revalorizados(topLimit);
  if (isSub23) return sgptSub23General(topLimit);

  if (isNac && isROI) return sgptNacionalidadesROI(topLimit);
  if (isNac && isRev) return sgptNacionalidadesRev(topLimit);

  if (isClubs && (isRev || /genera|valor/.test(q))) return sgptClubesValor(topLimit);
  if (isClubs && isActivo) return sgptClubesActivos(topLimit);

  if (isPosicion && isClubs && /desarroll|mejor/.test(q)) return sgptClubesPorPosicion(detectedPos);
  if (isPosicion && (isRev || /valor|genera/.test(q))) return sgptPosicionValor();
  if (isPosicion) return sgptPosicionStats(detectedPos);

  if (threshold && (isVenta || isJugadors)) return sgptJugadoresVendidos(threshold, topLimit);

  if (isJugadors && isRev && ageRange) return sgptJugadoresEdadRev(ageRange, topLimit);
  if (isJugadors && isRev) return sgptTopJugadoresRev(topLimit);
  if (isROI) return sgptNacionalidadesROI(topLimit);

  // Estadísticas concretas de jugador: goles, minutos, partidos, xG, temporadas
  if (isLocalStatsQuery(q)) {
    const betisStatsPlayer = detectBetisPlayerInQuery(q);
    if (betisStatsPlayer) return sgptPlayerInfo(betisStatsPlayer.jugador);
    const masterStatsPlayer = [...new Set((MASTER_DATA || []).map(d => d.nombre))].filter(Boolean)
      .find(p => playerNameMatches(p, raw));
    if (masterStatsPlayer) return sgptPlayerInfo(masterStatsPlayer);
  }

  // Fallback: jugador de la carpeta Betis Deportivo → informe de decisión local
  const betisPlayerFallback = detectBetisPlayerInQuery(q);
  if (betisPlayerFallback && RF_PLAYER_RECOMMENDATIONS.length) {
    return sgptDecisionForBetisPlayer(betisPlayerFallback.jugador);
  }

  // Fallback: jugador con estadísticas en master_player_development.csv
  const masterPlayers = [...new Set((MASTER_DATA || []).map(d => d.nombre))].filter(Boolean);
  const masterPlayerMatch = masterPlayers.find(p => playerNameMatches(p, raw));
  if (masterPlayerMatch) return sgptPlayerInfo(masterPlayerMatch);

  // Fallback: nombre propio → jugador
  const players = [...new Set(ALL_DATA.map(d => d.jugador))].filter(Boolean);
  const playerMatch = players.find(p => norm(p).split(' ').some(w => w.length > 3 && q.includes(w)));
  if (playerMatch) return sgptPlayerInfo(playerMatch);

  return sgptDefault(raw);
}

function detectSeasonInQuery(q) {
  // "2023-24", "23-24", "2023/24", "23/24"
  const full = q.match(/\b(202[1-5])[/-](\d{2})\b/);
  if (full) return `${full[1]}-${full[2]}`;
  const short = q.match(/\b(2[1-5])[/-](\d{2})\b/);
  if (short) return `20${short[1]}-${short[2]}`;
  // "temporada 23" solo → mapear a temporada completa
  const single = q.match(/temporada\s+(202[1-5])\b/);
  if (single) {
    const y = +single[1];
    return `${y}-${String(y + 1).slice(2)}`;
  }
  return null;
}

/* --- Handlers de temporada --- */
function sgptTopGastadoresSeason(season, n) {
  const data  = season ? ALL_DATA.filter(d => d.temporada === season && d.movimiento === 'alta') : ALL_DATA.filter(d => d.movimiento === 'alta');
  const label = season ? `temporada ${season}` : 'todas las temporadas';
  const byClub = groupBy(data, 'club');
  const ranked = Object.entries(byClub)
    .map(([k, v]) => [k, sumBy(v, 'importe_numerico'), v.length])
    .sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!ranked.length) return `Sin datos${season ? ` para ${season}` : ''}.`;
  return `<strong>Clubes que más gastaron — ${label}:</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Gasto</th><th>Altas</th></tr></thead>
    <tbody>${ranked.map(([c, g, ops], i) => `<tr>
      <td>${i+1}</td><td class="bold">${c}</td>
      <td class="red">${formatM(g)}</td><td class="muted">${ops}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptTopVendedoresSeason(season, n) {
  const data  = season ? ALL_DATA.filter(d => d.temporada === season && d.movimiento === 'baja') : ALL_DATA.filter(d => d.movimiento === 'baja');
  const label = season ? `temporada ${season}` : 'todas las temporadas';
  const byClub = groupBy(data, 'club');
  const ranked = Object.entries(byClub)
    .map(([k, v]) => [k, sumBy(v, 'importe_numerico'), v.length])
    .sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!ranked.length) return `Sin datos${season ? ` para ${season}` : ''}.`;
  return `<strong>Clubes que más ingresaron — ${label}:</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Ingresos</th><th>Bajas</th></tr></thead>
    <tbody>${ranked.map(([c, g, ops], i) => `<tr>
      <td>${i+1}</td><td class="bold">${c}</td>
      <td class="green">${formatM(g)}</td><td class="muted">${ops}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptTopActivosSeason(season, n) {
  const data   = season ? ALL_DATA.filter(d => d.temporada === season) : ALL_DATA;
  const label  = season ? `temporada ${season}` : 'todas las temporadas';
  const byClub = groupBy(data, 'club');
  const ranked = Object.entries(byClub)
    .map(([k, v]) => [k, v.length, v.filter(d => d.movimiento === 'alta').length, v.filter(d => d.movimiento === 'baja').length])
    .sort((a, b) => b[1] - a[1]).slice(0, n);
  return `<strong>Equipos más activos — ${label}:</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Total ops</th><th>Altas</th><th>Bajas</th></tr></thead>
    <tbody>${ranked.map(([c, t, a, b], i) => `<tr>
      <td>${i+1}</td><td class="bold">${c}</td><td>${t}</td>
      <td class="green">${a}</td><td class="red">${b}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptTopFichajesSeason(season, n) {
  const data = (season ? ALL_DATA.filter(d => d.temporada === season) : ALL_DATA)
    .filter(d => d.importe_numerico > 0)
    .sort((a, b) => b.importe_numerico - a.importe_numerico)
    .slice(0, n);
  const label = season ? `temporada ${season}` : 'historial completo';
  if (!data.length) return `Sin traspasos con importe registrado${season ? ` en ${season}` : ''}.`;
  return `<strong>Fichajes más caros — ${label}:</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Tipo</th><th>Importe</th></tr></thead>
    <tbody>${data.map((d, i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.club}</td>
      <td class="muted">${d.movimiento === 'alta' ? '⬆ Alta' : '⬇ Baja'}</td>
      <td class="green">${formatM(d.importe_numerico)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptResumenTemporada(season) {
  const data   = ALL_DATA.filter(d => d.temporada === season);
  if (!data.length) return `No hay datos para la temporada <strong>${season}</strong>.`;
  const altas  = data.filter(d => d.movimiento === 'alta');
  const bajas  = data.filter(d => d.movimiento === 'baja');
  const byClub = groupBy(data, 'club');
  const topClub = Object.entries(byClub).sort((a,b) => b[1].length - a[1].length)[0];
  const topFich = [...data].filter(d=>d.importe_numerico>0).sort((a,b)=>b.importe_numerico-a.importe_numerico)[0];
  return `<strong>Resumen temporada ${season}:</strong><br>
    📊 ${data.length} operaciones · ${altas.length} altas · ${bajas.length} bajas<br>
    💰 Dinero total: <span class="green">${formatM(sumBy(data,'importe_numerico'))}</span><br>
    🏟️ Equipo más activo: <span class="bold">${topClub?.[0] || '—'}</span> (${topClub?.[1].length || 0} ops)<br>
    ${topFich ? `💎 Fichaje más caro: <span class="bold">${topFich.jugador}</span> · ${topFich.club} · <span class="green">${formatM(topFich.importe_numerico)}</span>` : ''}`;
}

function sgptClubEnTemporada(club, season) {
  const data   = ALL_DATA.filter(d => d.club === club && d.temporada === season);
  if (!data.length) return `No hay datos para <strong>${club}</strong> en la temporada <strong>${season}</strong>.`;
  const altas  = data.filter(d => d.movimiento === 'alta');
  const bajas  = data.filter(d => d.movimiento === 'baja');
  const gasto  = sumBy(altas, 'importe_numerico');
  const ingreso= sumBy(bajas, 'importe_numerico');
  return `<strong>${club} — Temporada ${season}:</strong><br>
    ${data.length} operaciones · ${altas.length} altas · ${bajas.length} bajas<br>
    💸 Gasto: <span class="red">${formatM(gasto)}</span> ·
    💰 Ingresos: <span class="green">${formatM(ingreso)}</span> ·
    ⚖️ Balance: <span class="${ingreso-gasto>=0?'green':'red'}">${formatM(ingreso-gasto)}</span><br>
    <table><thead><tr><th>Jugador</th><th>Mov.</th><th>Tipo</th><th>Importe</th></tr></thead>
    <tbody>${[...data].sort((a,b)=>b.importe_numerico-a.importe_numerico).map(d=>`<tr>
      <td class="bold">${d.jugador}</td>
      <td><span class="mov-badge ${d.movimiento}">${d.movimiento==='alta'?'⬆ Alta':'⬇ Baja'}</span></td>
      <td class="muted">${d.tipo_operacion||'—'}</td>
      <td>${d.importe_numerico>0?formatM(d.importe_numerico):'—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function detectClubInQuery(q) {
  const clubs = [...new Set(ALL_DATA.map(d => d.club))].filter(Boolean);
  // Intento 1: nombre completo normalizado en la query
  const exact = clubs.find(c => q.includes(norm(c)));
  if (exact) return exact;
  // Intento 2: cualquier palabra del club (≥4 chars) aparece en la query
  return clubs.find(c => {
    const words = norm(c).split(/\s+/).filter(w => w.length >= 4);
    return words.some(w => q.includes(w));
  }) || null;
}

function detectPositionInQuery(q) {
  for (const [alias, canonical] of Object.entries(POSITION_QUERY_ALIASES)) {
    if (q.includes(norm(alias))) return canonical;
  }
  const entries = [...Object.entries(POS_ES), ...Object.values(POS_ES).map(v => [v, v])];
  for (const [en, es] of entries) {
    if (q.includes(norm(en)) || q.includes(norm(es))) return es;
  }
  return null;
}

/* --- SGPT Handlers --- */

function sgptClubVentas(club, threshold) {
  let data = ALL_DATA.filter(d => d.club === club && d.movimiento === 'baja' && d.importe_numerico > 0);
  if (threshold) data = data.filter(d => d.importe_numerico >= threshold);
  data.sort((a,b) => b.importe_numerico - a.importe_numerico);
  if (!data.length) return `<strong>${club}</strong> no tiene ventas${threshold ? ` por más de ${formatM(threshold)}` : ''} registradas.`;
  return `<strong>${club}</strong> — ventas${threshold ? ` superiores a ${formatM(threshold)}` : ''}:<br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Temp.</th><th>Importe</th></tr></thead>
    <tbody>${data.map((d,i) => `<tr><td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.temporada}</td><td class="green">${formatM(d.importe_numerico)}</td></tr>`).join('')}</tbody></table>`;
}

function sgptClubCompras(club, threshold) {
  let data = ALL_DATA.filter(d => d.club === club && d.movimiento === 'alta' && d.importe_numerico > 0);
  if (threshold) data = data.filter(d => d.importe_numerico >= threshold);
  data.sort((a,b) => b.importe_numerico - a.importe_numerico);
  if (!data.length) return `<strong>${club}</strong> no tiene compras${threshold ? ` por más de ${formatM(threshold)}` : ''} registradas.`;
  return `<strong>${club}</strong> — fichajes${threshold ? ` superiores a ${formatM(threshold)}` : ''}:<br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Temp.</th><th>Importe</th></tr></thead>
    <tbody>${data.map((d,i) => `<tr><td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.temporada}</td><td class="red">${formatM(d.importe_numerico)}</td></tr>`).join('')}</tbody></table>`;
}

function sgptClubOverview(club) {
  const ops    = ALL_DATA.filter(d => d.club === club);
  const altas  = ops.filter(d => d.movimiento === 'alta');
  const bajas  = ops.filter(d => d.movimiento === 'baja');
  const gasto  = sumBy(altas,'importe_numerico');
  const ingreso= sumBy(bajas,'importe_numerico');
  const revOps = REV_DATA.filter(d => d.club === club);
  const totalRev = revOps.reduce((s,d) => s + (+d.revalorizacion_abs||0), 0);
  const seasonStats = getClubSeasonStats(club);
  const topPerformers = getClubTopPerformers(club, 6);
  const totals = seasonStats.reduce((acc, s) => {
    acc.jugadores += s.jugadores;
    acc.sub23 += s.sub23;
    acc.partidos += s.partidos;
    acc.minutos += s.minutos;
    acc.goles += s.goles;
    acc.xg += s.xg;
    return acc;
  }, { jugadores:0, sub23:0, partidos:0, minutos:0, goles:0, xg:0 });

  return `<strong>${club}</strong><br>
    <span class="muted">Lectura para dirección deportiva: actividad de mercado, producción deportiva registrada y uso de jóvenes.</span>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Operaciones</span><br><strong>${ops.length}</strong></div>
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Gasto</span><br><strong class="red">${formatM(gasto)}</strong></div>
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Ingresos</span><br><strong class="green">${formatM(ingreso)}</strong></div>
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Balance</span><br><strong class="${ingreso-gasto >= 0 ? 'green' : 'red'}">${formatDeltaM(ingreso-gasto)}</strong></div>
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Valor generado</span><br><strong class="green">${formatM(totalRev)}</strong></div>
      ${seasonStats.length ? `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)"><span class="muted">Goles/xG</span><br><strong>${fmt(totals.goles)} / ${totals.xg.toFixed(1)}</strong></div>` : ''}
    </div>
    ${seasonStats.length ? `<strong>Rendimiento por temporada</strong><br>
    <table><thead><tr><th>Temp.</th><th>Jug.</th><th>Sub23</th><th>Part.</th><th>Min</th><th>Goles</th><th>xG</th></tr></thead>
    <tbody>${seasonStats.map(s => `<tr>
      <td>${s.temporada}</td><td>${s.jugadores}</td><td>${s.sub23}</td><td>${fmt(s.partidos)}</td>
      <td>${fmt(s.minutos)}</td><td>${fmt(s.goles)}</td><td>${s.xg ? s.xg.toFixed(2) : '—'}</td>
    </tr>`).join('')}</tbody></table>` : ''}
    ${topPerformers.length ? `<br><strong>Jugadores con más producción ofensiva registrada</strong><br>
    <table><thead><tr><th>Jugador</th><th>Pos.</th><th>Temp.</th><th>Min</th><th>Goles</th><th>xG</th></tr></thead>
    <tbody>${topPerformers.map(p => `<tr>
      <td class="bold">${p.nombre}</td><td class="muted">${p.posicion || '—'}</td><td>${p.temporadas || '—'}</td>
      <td>${fmt(p.minutos)}</td><td>${fmt(p.goles)}</td><td>${p.xg ? p.xg.toFixed(2) : '—'}</td>
    </tr>`).join('')}</tbody></table>` : ''}
    <br><span class="muted">Justificación: el bloque deportivo se calcula con registros Wyscout/master; el bloque de mercado se calcula con operaciones Transfermarkt consolidadas.</span>`;
}

function sgptSub23Revalorizados(n) {
  const sub23 = REV_DATA.filter(d => (+d.edad_llegada || 99) < 23)
    .sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0))
    .slice(0, n);
  if (!sub23.length) return 'No hay datos de revalorización Sub-23 disponibles.';
  return `<strong>Top ${n} Sub-23 más revalorizados:</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Edad llegada</th><th>Revalorización</th><th>ROI %</th></tr></thead>
    <tbody>${sub23.map((d,i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.club}</td>
      <td style="text-align:center">${d.edad_llegada||'—'}</td>
      <td class="green">${formatM(+d.revalorizacion_abs||0)}</td>
      <td class="green">+${(+d.revalorizacion_pct||0).toFixed(0)}%</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptSub23General(n) {
  const data = ALL_DATA.filter(d => (+d.edad || 99) < 23);
  const byClub = groupBy(data, 'club');
  const top = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length])), Math.min(n, 15));
  return `<strong>Clubes que más fichan Sub-23:</strong> ${data.length} operaciones con jugadores menores de 23 años.<br>
    <table><thead><tr><th>#</th><th>Club</th><th>Operaciones Sub-23</th></tr></thead>
    <tbody>${top.map(([c,n],i) => `<tr><td>${i+1}</td><td class="bold">${c}</td><td>${n}</td></tr>`).join('')}</tbody></table>`;
}

function sgptMasterReady() {
  return MASTER_DATA && MASTER_DATA.length;
}

function sgptSub23PorPosicion(pos, q, n) {
  if (!sgptMasterReady()) return sgptSub23General(n);
  const wantValue = /valor|genera|revalori/.test(q);
  const wantGoals = /gol/.test(q);
  const rows = MASTER_DATA
    .filter(d => isTrue(d.es_sub23) && devPosMatch(d, pos) && num(d.minutos) > 0)
    .sort((a, b) => {
      if (wantValue) return (num(b.revalorizacion_absoluta) || num(b.valor_mercado_wyscout) || num(b.valor_mercado)) -
        (num(a.revalorizacion_absoluta) || num(a.valor_mercado_wyscout) || num(a.valor_mercado));
      if (wantGoals) return num(b.goles) - num(a.goles);
      return num(b.minutos) - num(a.minutos);
    })
    .slice(0, n);
  if (!rows.length) return `No hay ${pos} Sub-23 con minutos Wyscout en el master.`;
  const metricTitle = wantValue ? 'valor/revalorización' : wantGoals ? 'goles' : 'minutos';
  return `<strong>${pos} Sub-23 por ${metricTitle}:</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Temp.</th><th>Edad</th><th>Min</th><th>Goles</th><th>xG</th><th>Valor</th></tr></thead>
    <tbody>${rows.map((d,i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.nombre}</td><td>${d.club}</td><td>${d.temporada}</td>
      <td>${d.edad || '—'}</td><td>${fmt(num(d.minutos))}</td><td>${num(d.goles)}</td><td>${num(d.xg).toFixed(2)}</td>
      <td class="green">${formatM(num(d.revalorizacion_absoluta) || num(d.valor_mercado_wyscout) || num(d.valor_mercado))}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptClubesSub23Uso(n) {
  if (!sgptMasterReady()) return sgptSub23General(n);
  const sub23 = MASTER_DATA.filter(d => isTrue(d.es_sub23));
  const by = groupBy(sub23, 'club');
  const ranked = Object.entries(by)
    .map(([club, rows]) => [club, sumBy(rows, 'minutos'), new Set(rows.map(d => d.nombre)).size, sumBy(rows, 'goles')])
    .sort((a,b) => b[1] - a[1])
    .slice(0, n);
  return `<strong>Clubes que más utilizan Sub-23</strong> (orden por minutos):<br>
    <table><thead><tr><th>#</th><th>Club</th><th>Min Sub-23</th><th>Jugadores</th><th>Goles</th></tr></thead>
    <tbody>${ranked.map(([c,m,j,g],i) => `<tr><td>${i+1}</td><td class="bold">${c}</td><td>${fmt(m)}</td><td>${j}</td><td>${g}</td></tr>`).join('')}</tbody></table>`;
}

function sgptEntrenadoresSub23Uso(n) {
  if (!sgptMasterReady()) return 'El master de desarrollo todavía no está cargado. Vuelve a lanzar la pregunta en unos segundos.';
  const rows = MASTER_DATA.filter(d => d.entrenador && isTrue(d.es_sub23));
  const by = groupBy(rows, 'entrenador');
  const ranked = Object.entries(by)
    .map(([coach, list]) => [coach, sumBy(list, 'minutos'), new Set(list.map(d => d.nombre)).size, sumBy(list, 'goles'), [...new Set(list.map(d => normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion)).filter(Boolean))].sort().join(', ')])
    .sort((a,b) => b[1] - a[1])
    .slice(0, n);
  return `<strong>Entrenadores que más utilizan Sub-23</strong> (orden por minutos):<br>
    <table><thead><tr><th>#</th><th>Entrenador</th><th>Min Sub-23</th><th>Jugadores</th><th>Goles</th><th>Posiciones</th></tr></thead>
    <tbody>${ranked.map(([c,m,j,g,p],i) => `<tr><td>${i+1}</td><td class="bold">${c}</td><td>${fmt(m)}</td><td>${j}</td><td>${g}</td><td class="muted">${p || '—'}</td></tr>`).join('')}</tbody></table>`;
}

function sgptClubesDesarrollanPosicion(pos, n) {
  if (!sgptMasterReady()) return sgptClubesPorPosicion(pos);
  const rows = MASTER_DATA.filter(d => isTrue(d.es_sub23) && devPosMatch(d, pos));
  const by = groupBy(rows, 'club');
  const ranked = Object.entries(by)
    .map(([club, list]) => [club, sumBy(list, 'minutos'), new Set(list.map(d => d.nombre)).size, sumBy(list, 'goles'), sumBy(list, 'revalorizacion_absoluta')])
    .sort((a,b) => (b[4] || b[1]) - (a[4] || a[1]))
    .slice(0, n);
  return `<strong>Clubes que mejor desarrollan ${pos}</strong> (Sub-23):<br>
    <table><thead><tr><th>#</th><th>Club</th><th>Valor gen.</th><th>Min</th><th>Jugadores</th><th>Goles</th></tr></thead>
    <tbody>${ranked.map(([c,m,j,g,v],i) => `<tr><td>${i+1}</td><td class="bold">${c}</td><td class="green">${v ? formatM(v) : '—'}</td><td>${fmt(m)}</td><td>${j}</td><td>${g}</td></tr>`).join('')}</tbody></table>`;
}

function sgptEntrenadoresDesarrollanPosicion(pos, n) {
  if (!sgptMasterReady()) return 'El master de desarrollo todavía no está cargado. Vuelve a lanzar la pregunta en unos segundos.';
  const rows = MASTER_DATA.filter(d => d.entrenador && isTrue(d.es_sub23) && devPosMatch(d, pos));
  const by = groupBy(rows, 'entrenador');
  const ranked = Object.entries(by)
    .map(([coach, list]) => [coach, sumBy(list, 'minutos'), new Set(list.map(d => d.nombre)).size, sumBy(list, 'goles'), sumBy(list, 'revalorizacion_absoluta')])
    .sort((a,b) => (b[4] || b[1]) - (a[4] || a[1]))
    .slice(0, n);
  return `<strong>Entrenadores que mejor desarrollan ${pos}</strong> (Sub-23):<br>
    <table><thead><tr><th>#</th><th>Entrenador</th><th>Valor gen.</th><th>Min</th><th>Jugadores</th><th>Goles</th></tr></thead>
    <tbody>${ranked.map(([c,m,j,g,v],i) => `<tr><td>${i+1}</td><td class="bold">${c}</td><td class="green">${v ? formatM(v) : '—'}</td><td>${fmt(m)}</td><td>${j}</td><td>${g}</td></tr>`).join('')}</tbody></table>`;
}

function sgptNacionalidadesROI(n) {
  const byNac = groupBy(REV_DATA.filter(d => d.revalorizacion_pct != null), 'nacionalidad');
  const ranked = Object.entries(byNac)
    .map(([k,v]) => [k, meanBy(v,'revalorizacion_pct'), v.length])
    .filter(([,, cnt]) => cnt >= 3)
    .sort((a,b) => b[1] - a[1])
    .slice(0, n);
  return `<strong>Nacionalidades con mejor ROI medio</strong> (mín. 3 jugadores):<br>
    <table><thead><tr><th>#</th><th>Nacionalidad</th><th>ROI medio</th><th>Jugadores</th></tr></thead>
    <tbody>${ranked.map(([nac, roi, cnt], i) => `<tr>
      <td>${i+1}</td><td class="bold">${nac}</td>
      <td class="green">+${roi.toFixed(1)}%</td>
      <td class="muted">${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptNacionalidadesRev(n) {
  const byNac = groupBy(REV_DATA, 'nacionalidad');
  const ranked = Object.entries(byNac)
    .map(([k,v]) => [k, v.reduce((s,d) => s + (+d.revalorizacion_abs||0), 0), v.length])
    .sort((a,b) => b[1] - a[1])
    .slice(0, n);
  return `<strong>Nacionalidades por valor total generado:</strong><br>
    <table><thead><tr><th>#</th><th>Nacionalidad</th><th>Valor generado</th><th>Jugadores</th></tr></thead>
    <tbody>${ranked.map(([nac, total, cnt], i) => `<tr>
      <td>${i+1}</td><td class="bold">${nac}</td>
      <td class="green">${formatM(total)}</td>
      <td class="muted">${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptClubesValor(n) {
  const byClub = groupBy(REV_DATA, 'club');
  const ranked = Object.entries(byClub)
    .map(([k,v]) => [k, v.reduce((s,d) => s + (+d.revalorizacion_abs||0), 0), v.length])
    .sort((a,b) => b[1] - a[1])
    .slice(0, n);
  return `<strong>Clubes que más valor generan</strong> (suma revalorización):<br>
    <table><thead><tr><th>#</th><th>Club</th><th>Valor generado</th><th>Jugadores</th></tr></thead>
    <tbody>${ranked.map(([club, total, cnt], i) => `<tr>
      <td>${i+1}</td><td class="bold">${club}</td>
      <td class="green">${formatM(total)}</td>
      <td class="muted">${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptClubesActivos(n) {
  const byClub = groupBy(ALL_DATA, 'club');
  const ranked = topN(Object.fromEntries(Object.entries(byClub).map(([k,v]) => [k, v.length])), n);
  return `<strong>Clubes más activos en el mercado</strong> (total operaciones):<br>
    <table><thead><tr><th>#</th><th>Club</th><th>Operaciones</th></tr></thead>
    <tbody>${ranked.map(([club, cnt], i) => `<tr>
      <td>${i+1}</td><td class="bold">${club}</td><td>${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptPosicionValor() {
  const byPos = groupBy(REV_DATA.filter(d => d.posicion_es), 'posicion_es');
  const ranked = Object.entries(byPos)
    .map(([k,v]) => [k, v.reduce((s,d) => s + (+d.revalorizacion_abs||0), 0), meanBy(v,'revalorizacion_pct'), v.length])
    .sort((a,b) => b[1] - a[1]);
  return `<strong>Posiciones por valor total generado:</strong><br>
    <table><thead><tr><th>Posición</th><th>Valor total</th><th>ROI medio</th><th>Jugadores</th></tr></thead>
    <tbody>${ranked.map(([pos, total, roi, cnt]) => `<tr>
      <td class="bold">${pos}</td>
      <td class="green">${formatM(total)}</td>
      <td class="${roi>=0?'green':'red'}">${roi>=0?'+':''}${roi.toFixed(0)}%</td>
      <td class="muted">${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptPosicionStats(posES) {
  if (!posES) return sgptPosicionValor();
  const data = ALL_DATA.filter(d => tPos(d.posicion||'') === posES);
  const revRows = REV_DATA.filter(d => (d.posicion_es || tPos(d.posicion||'')) === posES);
  return `<strong>Posición: ${posES}</strong><br>
    ${data.length} operaciones · VM medio: ${formatM(meanBy(data,'_vm'))} ·
    ROI medio: ${revRows.length ? (revRows.reduce((s,d)=>s+(+d.revalorizacion_pct||0),0)/revRows.length).toFixed(0)+'%' : '—'}`;
}

function sgptClubesPorPosicion(posES) {
  if (!posES) return 'Especifica la posición (Ej: "¿Qué clubes desarrollan mejor delanteros?")';
  const revRows = REV_DATA.filter(d => (d.posicion_es || tPos(d.posicion||'')) === posES);
  const byClub = groupBy(revRows, 'club');
  const ranked = Object.entries(byClub)
    .map(([k,v]) => [k, v.reduce((s,d) => s + (+d.revalorizacion_abs||0), 0), v.length])
    .sort((a,b) => b[1] - a[1])
    .slice(0, 15);
  return `<strong>Clubes que mejor desarrollan: ${posES}</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Valor generado</th><th>Jugadores</th></tr></thead>
    <tbody>${ranked.map(([club, total, cnt], i) => `<tr>
      <td>${i+1}</td><td class="bold">${club}</td>
      <td class="green">${formatM(total)}</td><td class="muted">${cnt}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptJugadoresVendidos(threshold, n) {
  const data = ALL_DATA.filter(d => d.movimiento === 'baja' && d.importe_numerico >= threshold)
    .sort((a,b) => b.importe_numerico - a.importe_numerico)
    .slice(0, n);
  if (!data.length) return `No hay jugadores vendidos por más de ${formatM(threshold)}.`;
  return `<strong>Jugadores vendidos por más de ${formatM(threshold)}:</strong> ${data.length} registros<br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Temp.</th><th>Importe</th></tr></thead>
    <tbody>${data.map((d,i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.club}</td>
      <td>${d.temporada}</td><td class="green">${formatM(d.importe_numerico)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptJugadoresEdadRev(ageRange, n) {
  const [minAge, maxAge] = ageRange;
  const data = REV_DATA.filter(d => {
    const a = +d.edad_llegada;
    return a >= minAge && a <= maxAge;
  }).sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0, n);
  if (!data.length) return `No hay datos para ese rango de edad.`;
  return `<strong>Jugadores revalorizados entre ${minAge} y ${maxAge} años:</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Edad</th><th>Revalorización</th><th>ROI %</th></tr></thead>
    <tbody>${data.map((d,i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.club}</td>
      <td style="text-align:center">${d.edad_llegada}</td>
      <td class="green">${formatM(+d.revalorizacion_abs||0)}</td>
      <td class="green">+${(+d.revalorizacion_pct||0).toFixed(0)}%</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptTopJugadoresRev(n) {
  const data = [...REV_DATA].sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0, n);
  return `<strong>Top ${n} jugadores más revalorizados:</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Posición</th><th>Revalorización</th><th>ROI %</th></tr></thead>
    <tbody>${data.map((d,i) => `<tr>
      <td>${i+1}</td><td class="bold">${d.jugador}</td><td>${d.club}</td>
      <td class="muted">${d.posicion_es||tPos(d.posicion||'')}</td>
      <td class="green">${formatM(+d.revalorizacion_abs||0)}</td>
      <td class="green">+${(+d.revalorizacion_pct||0).toFixed(0)}%</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptPlayerInfo(name) {
  const ops = ALL_DATA.filter(d => d.jugador === name);
  const rev = REV_DATA.find(d => d.jugador === name);
  const stats = getPlayerSeasonStats(name);
  if (!ops.length && !stats.length) return `No encuentro registros para <strong>${name}</strong>.`;

  const order = ['2021-22','2022-23','2023-24','2024-25','2025-26'];
  const sortedOps = [...ops].sort((a,b) => order.indexOf(b.temporada) - order.indexOf(a.temporada));
  const latest = sortedOps[0] || null;
  const latestStats = stats[0] || null;
  const totalImporte = sumBy(ops, 'importe_numerico');
  const clubes = [...new Set(ops.map(d => d.club).filter(Boolean))];
  const totals = summarizePlayerStats(stats);
  const mainPos = tPos(latest?.posicion || latestStats?.posicion || '') || '—';
  const mainClub = latestStats?.club || latest?.club || '—';
  const statText = stats.length
    ? `${fmt(totals.partidos)} partidos, ${fmt(totals.minutos)} minutos, ${fmt(totals.goles)} goles y ${totals.xg.toFixed(2)} xG en ${totals.temporadas} temporada${totals.temporadas !== 1 ? 's' : ''}.`
    : 'No hay registros Wyscout/master de rendimiento para este jugador.';

  // KPIs esenciales (solo los que aportan), como chips compactos
  const chips = [];
  if (stats.length) {
    chips.push(['Partidos', fmt(totals.partidos)]);
    chips.push(['Minutos', fmt(totals.minutos)]);
    chips.push(['Goles', fmt(totals.goles)]);
    chips.push(['xG', totals.xg.toFixed(1)]);
  }
  if (rev) {
    const v = +rev.revalorizacion_abs || 0;
    chips.push(['Revalorización', `<span class="${v >= 0 ? 'green' : 'red'}">${formatDeltaM(v)} (${(+rev.revalorizacion_pct||0).toFixed(0)}%)</span>`]);
  } else if (ops.length) {
    chips.push(['Importe total', formatM(totalImporte)]);
  }

  const chipRow = chips.map(([k, v]) =>
    `<span style="display:inline-flex;flex-direction:column;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);line-height:1.3">
      <span class="muted" style="font-size:0.72rem">${k}</span><strong>${v}</strong></span>`).join('');

  // Tabla principal: rendimiento por temporada (o, si no hay, operaciones)
  let tabla = '';
  if (stats.length) {
    tabla = `<table><thead><tr><th>Temp.</th><th>Club</th><th>Pos.</th><th>Edad</th><th>Part.</th><th>Min</th><th>Goles</th><th>xG</th></tr></thead>
    <tbody>${stats.map(s => `<tr>
      <td>${s.temporada}</td><td class="bold">${s.club}</td>
      <td class="muted">${s.posicion || '—'}</td><td>${s.edad || '—'}</td><td>${fmt(s.partidos)}</td>
      <td>${fmt(s.minutos)}</td><td>${fmt(s.goles)}</td><td>${s.xg ? s.xg.toFixed(1) : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
  } else if (ops.length) {
    tabla = `<table><thead><tr><th>Temp.</th><th>Club</th><th>Mov.</th><th>Tipo</th><th>Importe</th></tr></thead>
    <tbody>${sortedOps.slice(0, 6).map(op => `<tr>
      <td>${op.temporada || '—'}</td><td class="bold">${op.club || '—'}</td>
      <td>${op.movimiento || '—'}</td><td class="muted">${prettyTipo(op.tipo_operacion || op.movimiento)}</td>
      <td>${op.importe_numerico ? formatM(op.importe_numerico) : (op.importe_original || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  return `<strong style="font-size:1.05rem">${name}</strong>
    <span class="muted"> · ${mainPos} · ${latest?.nacionalidad || latestStats?.nacionalidad || '—'} · ${mainClub}</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${chipRow}</div>
    ${tabla}`;
}

function sgptDefault(raw) {
  return `No he encontrado una respuesta directa para "<em>${raw}</em>".<br>
    <span class="muted">Prueba con preguntas como:<br>
    · "¿Qué jugadores ha vendido el Eibar por más de 2 millones?"<br>
    · "Top 20 Sub-23 más revalorizados"<br>
    · "¿Qué clubes generan más valor?"<br>
    · "¿Qué nacionalidades tienen mejor ROI?"</span>`;
}

/* ============================================================
   WYSCOUT DATA — Tab
   ============================================================ */

let WY_DATA = [];
let CLUB_EVIDENCE_DATA = [];   // development_club_evidence.csv
let CLUB_DEMAND_DATA = [];     // club_position_demand.csv

function loadWyscoutData(callback) {
  if (WY_DATA.length) { callback(WY_DATA); return; }
  Papa.parse(dataPath('master_wyscout_players.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => {
      WY_DATA = r.data.filter(d => d.jugador);
      callback(WY_DATA);
    },
    error: () => callback([])
  });
}

// Carga datos de encaje club-posición (para análisis de operaciones)
function loadOperationContext(callback) {
  let pending = 3;
  const done = () => { if (--pending === 0) callback(); };
  loadWyscoutData(() => done());
  if (CLUB_EVIDENCE_DATA.length) { done(); }
  else Papa.parse(dataPath('development_club_evidence.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { CLUB_EVIDENCE_DATA = r.data.filter(d => d.club); done(); },
    error: () => { CLUB_EVIDENCE_DATA = []; done(); }
  });
  if (CLUB_DEMAND_DATA.length) { done(); }
  else Papa.parse(dataPath('club_position_demand.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { CLUB_DEMAND_DATA = r.data.filter(d => d.club); done(); },
    error: () => { CLUB_DEMAND_DATA = []; done(); }
  });
}

function renderWyscoutTab() {
  loadWyscoutData(data => {
    if (!data.length) {
      document.getElementById('wy-kpis').innerHTML =
        '<p style="color:var(--text-muted)">No se pudo cargar master_wyscout_players.csv. Ejecuta python3 build_wyscout_master.py</p>';
      return;
    }
    renderWyKPIs(data);
    renderWyEdad(data);
    renderWyPosicion(data);
    renderWyMinutos(data);
    renderWyVM(data);
    renderWySub23(data);
    renderWyEquipos(data);
    renderWyTablaResumen(data);
  });
}

function renderWyKPIs(data) {
  const jugadores  = new Set(data.map(d => d.jugador)).size;
  const equipos    = new Set(data.map(d => d.equipo)).size;
  const temporadas = new Set(data.map(d => d.temporada)).size;
  const sub23      = data.filter(d => (+d.edad||99) < 23).length;
  const cesiones   = data.filter(d => d.cesion === true || d.cesion === 'True').length;
  const conGoles   = data.filter(d => (+d.goles||0) > 0).length;

  document.getElementById('wy-kpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-value">${data.length.toLocaleString('es-ES')}</div><div class="kpi-label">Registros totales</div></div>
    <div class="kpi-card"><div class="kpi-value">${jugadores.toLocaleString('es-ES')}</div><div class="kpi-label">Jugadores únicos</div></div>
    <div class="kpi-card"><div class="kpi-value">${equipos}</div><div class="kpi-label">Equipos</div></div>
    <div class="kpi-card"><div class="kpi-value">${temporadas}</div><div class="kpi-label">Temporadas</div></div>
    <div class="kpi-card"><div class="kpi-value">${sub23}</div><div class="kpi-label">Sub-23</div></div>
    <div class="kpi-card"><div class="kpi-value">${cesiones}</div><div class="kpi-label">En cesión</div></div>`;
}

function renderWyEdad(data) {
  const edades = data.map(d => +d.edad).filter(e => e > 14 && e < 42);
  const bins = {};
  edades.forEach(e => { const b = Math.floor(e); bins[b] = (bins[b]||0)+1; });
  const x = Object.keys(bins).sort((a,b)=>+a-+b).map(Number);
  const y = x.map(b => bins[b]);
  plot('chart-wy-edad', [{ type:'bar', x, y, marker:{color:'#009a44'} }],
    { margin:{t:20,r:10,b:50,l:50}, xaxis:{title:'Edad'}, yaxis:{title:'Jugadores'} });
}

function renderWyPosicion(data) {
  const byPos = {};
  data.forEach(d => { const p = d.posicion_normalizada || 'Desconocida'; byPos[p] = (byPos[p]||0)+1; });
  const sorted = Object.entries(byPos).sort((a,b)=>b[1]-a[1]);
  plot('chart-wy-posicion',
    [{ type:'bar', orientation:'h',
       x: sorted.map(([,v])=>v).reverse(),
       y: sorted.map(([k])=>k).reverse(),
       marker:{color:'#1d6fa4'} }],
    { margin:{t:20,r:20,b:30,l:130} });
}

function renderWyMinutos(data) {
  const buckets = {'0-500':0,'500-1000':0,'1000-1500':0,'1500-2000':0,'2000-2500':0,'2500+':0};
  data.forEach(d => {
    const m = +d.minutos_jugados||0;
    if (m < 500)  buckets['0-500']++;
    else if (m < 1000) buckets['500-1000']++;
    else if (m < 1500) buckets['1000-1500']++;
    else if (m < 2000) buckets['1500-2000']++;
    else if (m < 2500) buckets['2000-2500']++;
    else buckets['2500+']++;
  });
  plot('chart-wy-minutos',
    [{ type:'bar', x: Object.keys(buckets), y: Object.values(buckets), marker:{color:'#e07b39'} }],
    { margin:{t:20,r:10,b:50,l:50}, xaxis:{title:'Minutos jugados'} });
}

function renderWyVM(data) {
  const vms = data.map(d => +d.valor_mercado||0).filter(v => v > 0);
  const buckets = {'<500k':0,'500k-1M':0,'1-5M':0,'5-15M':0,'15M+':0};
  vms.forEach(v => {
    if (v < 500000)  buckets['<500k']++;
    else if (v < 1e6)  buckets['500k-1M']++;
    else if (v < 5e6)  buckets['1-5M']++;
    else if (v < 15e6) buckets['5-15M']++;
    else buckets['15M+']++;
  });
  plot('chart-wy-vm',
    [{ type:'bar', x: Object.keys(buckets), y: Object.values(buckets), marker:{color:'#c8a951'} }],
    { margin:{t:20,r:10,b:50,l:50}, xaxis:{title:'Valor de mercado'} });
}

function renderWySub23(data) {
  const temps = ['2021-22','2022-23','2023-24','2024-25','2025-26'];
  const sub23  = temps.map(t => data.filter(d => d.temporada===t && (+d.edad||99)<23).length);
  const senior = temps.map(t => data.filter(d => d.temporada===t && (+d.edad||99)>=23).length);
  plot('chart-wy-sub23', [
    { type:'bar', name:'Sub-23', x:temps, y:sub23, marker:{color:'#009a44'} },
    { type:'bar', name:'Senior', x:temps, y:senior, marker:{color:'#e5e7eb'} }
  ], { barmode:'stack', margin:{t:20,r:10,b:50,l:50}, showlegend:true });
}

function renderWyEquipos(data) {
  const byTeam = {};
  data.forEach(d => { byTeam[d.equipo] = (byTeam[d.equipo]||0)+1; });
  const top = Object.entries(byTeam).sort((a,b)=>b[1]-a[1]).slice(0,20);
  plot('chart-wy-equipos',
    [{ type:'bar', orientation:'h',
       x: top.map(([,v])=>v).reverse(),
       y: top.map(([k])=>k).reverse(),
       marker:{color:'#8b5cf6'} }],
    { margin:{t:20,r:20,b:30,l:170} });
}

function renderWyTablaResumen(data) {
  const temps = ['2021-22','2022-23','2023-24','2024-25','2025-26'];
  const cats  = ['att','med','def'];
  const header = `<tr><th>Temporada</th>${cats.map(c=>`<th>${c}</th>`).join('')}<th>Total</th><th>Sub-23</th><th>Con goles</th></tr>`;
  const rows = temps.map(t => {
    const tData = data.filter(d => d.temporada === t);
    const byCat = cats.map(c => tData.filter(d => d.categoria===c).length);
    const sub23 = tData.filter(d => (+d.edad||99)<23).length;
    const goals = tData.filter(d => (+d.goles||0)>0).length;
    return `<tr><td><strong>${t}</strong></td>${byCat.map(n=>`<td>${n}</td>`).join('')}<td><strong>${tData.length}</strong></td><td style="color:var(--success)">${sub23}</td><td>${goals}</td></tr>`;
  }).join('');
  const totals = cats.map(c => data.filter(d=>d.categoria===c).length);
  document.getElementById('wy-table-resumen').innerHTML = `
    <table class="ppc-table">
      <thead>${header}</thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)"><td><strong>Total</strong></td>${totals.map(n=>`<td><strong>${n}</strong></td>`).join('')}<td><strong>${data.length}</strong></td><td style="color:var(--success)"><strong>${data.filter(d=>(+d.edad||99)<23).length}</strong></td><td><strong>${data.filter(d=>(+d.goles||0)>0).length}</strong></td></tr></tfoot>
    </table>`;
}

/* ============================================================
   MASTER DATA — Carga compartida
   ============================================================ */

let MASTER_DATA = [];
let LOAN_MODEL_DATA = [];
let BETIS_PLAYERS_DATA = [];
let RF_PLAYER_RECOMMENDATIONS = [];
let RF_DESTINATION_RECOMMENDATIONS = [];
let V2_DESTINATION_RECOMMENDATIONS = [];
let RF_SIMILAR_EVENTS = [];
let BETIS_DECISIONS = [];          // betis_decision_recommendations.csv (operation_success_score)
let OPERATION_MODEL_REPORT = null; // player_operation_model_report.json

function loadMasterData(callback) {
  if (MASTER_DATA.length) { callback(MASTER_DATA); return; }
  Papa.parse(dataPath('master_player_development.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => {
      MASTER_DATA = r.data.filter(d => d.nombre);
      callback(MASTER_DATA);
    },
    error: () => { callback([]); }
  });
}

function loadLoanModelData(callback) {
  if (LOAN_MODEL_DATA.length && BETIS_PLAYERS_DATA.length) { callback(LOAN_MODEL_DATA); return; }

  let pending = 2;
  const done = () => {
    pending -= 1;
    if (pending === 0) callback(LOAN_MODEL_DATA);
  };

  Papa.parse(dataPath('betis_loan_destination_model.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => {
      LOAN_MODEL_DATA = r.data.filter(d => d.jugador && d.club_destino);
      done();
    },
    error: () => { LOAN_MODEL_DATA = []; done(); }
  });

  Papa.parse(dataPath('betis_deportivo_players.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => {
      BETIS_PLAYERS_DATA = r.data.filter(d => d.jugador);
      done();
    },
    error: () => { BETIS_PLAYERS_DATA = []; done(); }
  });
}

function loadDecisionModelData(callback) {
  if (RF_PLAYER_RECOMMENDATIONS.length && RF_DESTINATION_RECOMMENDATIONS.length && RF_SIMILAR_EVENTS.length && BETIS_DECISIONS.length && V2_DESTINATION_RECOMMENDATIONS.length) {
    callback(RF_PLAYER_RECOMMENDATIONS);
    return;
  }

  let pending = 5;
  const done = () => {
    pending -= 1;
    if (pending === 0) callback(RF_PLAYER_RECOMMENDATIONS);
  };

  Papa.parse(dataPath('betis_decision_recommendations.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { BETIS_DECISIONS = r.data.filter(d => d.jugador); done(); },
    error: () => { BETIS_DECISIONS = []; done(); }
  });

  Papa.parse(dataPath('betis_rf_player_recommendations.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { RF_PLAYER_RECOMMENDATIONS = r.data.filter(d => d.jugador); done(); },
    error: () => { RF_PLAYER_RECOMMENDATIONS = []; done(); }
  });

  Papa.parse(dataPath('betis_rf_destination_recommendations.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { RF_DESTINATION_RECOMMENDATIONS = r.data.filter(d => d.jugador && d.club); done(); },
    error: () => { RF_DESTINATION_RECOMMENDATIONS = []; done(); }
  });

  Papa.parse(dataPath('betis_v2_destination_recommendations.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { V2_DESTINATION_RECOMMENDATIONS = r.data.filter(d => d.jugador && d.club); done(); },
    error: () => { V2_DESTINATION_RECOMMENDATIONS = []; done(); }
  });

  Papa.parse(dataPath('betis_similar_historical_events.csv'), {
    header: true, dynamicTyping: true, download: true,
    complete: r => { RF_SIMILAR_EVENTS = r.data.filter(d => d.jugador_betis); done(); },
    error: () => { RF_SIMILAR_EVENTS = []; done(); }
  });
}

function loadOperationModelReport(callback) {
  if (OPERATION_MODEL_REPORT) { callback(OPERATION_MODEL_REPORT); return; }
  fetch(dataPath('player_operation_model_report.json'))
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      OPERATION_MODEL_REPORT = d || null;
      callback(OPERATION_MODEL_REPORT);
    })
    .catch(() => {
      OPERATION_MODEL_REPORT = null;
      callback(null);
    });
}

const SEGUNDA_CLUBS_SET = new Set([
  'AD Alcorcón','AD Ceuta FC','Albacete Balompié','Burgos CF','CD Castellón','CD Eldense',
  'CD Leganés','CD Lugo','CD Mirandés','CD Tenerife','CF Fuenlabrada','Cultural Leonesa',
  'Cádiz CF','Córdoba CF','Deportivo Alavés','Deportivo de La Coruña','Elche CF','FC Andorra',
  'FC Cartagena','Girona FC','Granada CF','Levante UD','Málaga CF','RCD Espanyol Barcelona',
  'Racing Ferrol','Racing Santander','Real Oviedo','Real Sociedad B','Real Valladolid CF',
  'Real Zaragoza','SD Amorebieta','SD Eibar','SD Huesca','SD Ponferradina','Sporting Gijón',
  'UD Almería','UD Ibiza','UD Las Palmas','Villarreal CF B','Real Betis','Real Betis B'
]);

// Clubes que militan EN Segunda 2025-26 (espejo de SEGUNDA_2025_26 en normalizer.py)
const SEGUNDA_ACTUAL = new Set([
  'AD Ceuta FC','Albacete Balompié','Burgos CF','CD Castellón','CD Leganés','CD Mirandés',
  'Cultural Leonesa','Cádiz CF','Córdoba CF','Deportivo de La Coruña','FC Andorra','Granada CF',
  'Málaga CF','Racing Santander','Real Sociedad B','Real Valladolid CF','Real Zaragoza','SD Eibar',
  'SD Huesca','Sporting Gijón','UD Almería','UD Las Palmas'
]);

// posición normalizada → columna de minutos Sub-23 en development_club_evidence
const POS_TO_EVIDENCE_COL = {
  'Delantero': 'minutos_sub23_delanteros', 'Mediapunta': 'minutos_sub23_delanteros',
  'Extremo': 'minutos_sub23_extremos',
  'Mediocentro': 'minutos_sub23_mediocentros', 'Centrocampista': 'minutos_sub23_mediocentros',
  'Central': 'minutos_sub23_centrales',
  'Lateral': 'minutos_sub23_laterales', 'Carrilero': 'minutos_sub23_laterales',
  'Portero': 'minutos_sub23_porteros',
};

function isTrue(v) { return v === true || v === 'True' || v === 'true'; }
function num(v) { const n = +v; return isNaN(n) ? 0 : n; }
function normDevPos(p) {
  const raw = (p || '').toString().trim();
  if (!raw || raw === 'nan') return '';
  const q = norm(raw);
  return POSITION_QUERY_ALIASES[q] || raw;
}
function devPosMatch(row, pos) {
  if (!pos) return true;
  const p = normDevPos(row.posicion_normalizada || row.posicion_es || tPos(row.posicion || ''));
  if (pos === 'Mediocentro') return p === 'Mediocentro' || p === 'Centrocampista';
  return p === pos;
}

function isLoanDestinationQuery(q) {
  return /destin|cesi[oó]n|ceder|cedido|prestam|d[oó]nde|mejor.*club|mejor.*equipo|encaje/.test(q);
}

function isDecisionModelQuery(q) {
  return /recomend|operaci[oó]n|decision|decidir|salida|ceder|cesi[oó]n|destin|renovar|recompra|porcentaje|modelo|random|forest|ideal|encaje|vend(er)?|traspas|vent[a]?|interes/.test(q);
}

function isLocalStatsQuery(q) {
  return /gol|goles|xg|minut|partid|estad[ií]stic|rendimiento|temporada|temporadas|asist|equipo|club|jugador/.test(q);
}

function detectBetisPlayerInQuery(q) {
  if (!BETIS_PLAYERS_DATA.length) return null;
  const exact = BETIS_PLAYERS_DATA.find(p => q.includes(norm(p.jugador)));
  if (exact) return exact;
  return BETIS_PLAYERS_DATA.find(p => {
    const words = norm(p.jugador).split(/\s+/).filter(w => w.length >= 4);
    return words.length && words.some(w => q.includes(w));
  }) || null;
}

function loanRowsForPlayer(playerName) {
  return LOAN_MODEL_DATA
    .filter(d => norm(d.jugador) === norm(playerName))
    .sort((a, b) => num(a.ranking_destino) - num(b.ranking_destino));
}

function rfRowsForPlayer(playerName) {
  return RF_DESTINATION_RECOMMENDATIONS
    .filter(d => norm(d.jugador) === norm(playerName))
    .sort((a, b) => num(a.ranking_destino_rf) - num(b.ranking_destino_rf));
}

function v2RowsForPlayer(playerName) {
  return V2_DESTINATION_RECOMMENDATIONS
    .filter(d => norm(d.jugador) === norm(playerName))
    .sort((a, b) => num(a.ranking_destino_v2) - num(b.ranking_destino_v2));
}

function rfSummaryForPlayer(playerName) {
  return RF_PLAYER_RECOMMENDATIONS.find(d => norm(d.jugador) === norm(playerName)) || null;
}

function pct(v) {
  return `${Math.round(num(v) * 100)}%`;
}

function isOperationModelQualityQuery(q) {
  return /exact|precision|fiab|validaci[oó]n|m[eé]trica|r2|mae|auc|calidad|dataset|entren|machine|learning|modelo.*operaci|operaci.*modelo/.test(q);
}

function sgptOperationModelReport() {
  if (!OPERATION_MODEL_REPORT) {
    return 'El informe del modelo de operaciones todavía se está cargando. Vuelve a preguntar en unos segundos.';
  }
  const ds = OPERATION_MODEL_REPORT.dataset || {};
  const reg = OPERATION_MODEL_REPORT.operation_success_regressor || {};
  const clf = OPERATION_MODEL_REPORT.global_success_classifier || {};
  const defs = OPERATION_MODEL_REPORT.target_definition || {};
  const labels = ds.label_confidence || {};
  const ops = ds.operation_types || {};
  const topFeatures = (reg.feature_importances || []).slice(0, 8);

  return `<strong>Modelo ML de operaciones — estado actual</strong><br>
    <span class="muted">Nueva capa: <strong>player_operation_model_dataset.csv</strong>. Una fila representa jugador + temporada + club + operación.</span><br>
    <div style="margin:10px 0;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">
      <strong>Volumen de entrenamiento</strong><br>
      <table><thead><tr><th>Filas</th><th>Columnas</th><th>Hist. previa</th><th>Seguimiento posterior</th><th>Wyscout</th></tr></thead>
      <tbody><tr>
        <td>${fmt(ds.rows || 0)}</td><td>${fmt(ds.columns || 0)}</td>
        <td>${fmt(ds.with_pre_history || 0)}</td><td>${fmt(ds.with_post_history || 0)}</td><td>${fmt(ds.with_wyscout || 0)}</td>
      </tr></tbody></table>
    </div>
    <strong>Calidad de etiquetas</strong><br>
    <span class="muted">Alta: ${fmt(labels.Alta || 0)} · Media: ${fmt(labels.Media || 0)} · Baja: ${fmt(labels.Baja || 0)}</span><br><br>
    <strong>Tipos de operación observados</strong><br>
    <span class="muted">Cesiones: ${fmt(ops.cesion || 0)} · Traspasos: ${fmt(ops.traspaso || 0)} · Libres: ${fmt(ops.libre || 0)} · Otros/Sub23: ${fmt((ops.otro || 0) + (ops.sub23_wyscout || 0))}</span><br><br>
    <strong>Validación honesta</strong><br>
    <table><thead><tr><th>Modelo</th><th>Métrica</th><th>Valor</th><th>Lectura</th></tr></thead>
    <tbody>
      <tr><td>Regresor score operación</td><td>MAE</td><td>${reg.mae ?? '—'}</td><td>Error medio en puntos sobre 100</td></tr>
      <tr><td>Regresor score operación</td><td>R² CV</td><td>${reg.r2_cv_mean ?? '—'}</td><td>Poder predictivo fuera de muestra</td></tr>
      <tr><td>Clasificador éxito global</td><td>AUC</td><td>${clf.roc_auc ?? '—'}</td><td>Separación éxito/no éxito</td></tr>
    </tbody></table>
    <div style="margin:10px 0 12px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">
      <strong>Lectura deportiva:</strong><br>
      <span class="muted">El modelo ya detecta señales útiles, sobre todo contexto club-posición, minutos Sub23 históricos, demanda y valor. La precisión todavía está limitada porque solo ${fmt(ds.with_pre_history || 0)} filas tienen historial previo y ${fmt(ds.with_post_history || 0)} seguimiento posterior. Es una base seria para apoyar decisiones, no una predicción cerrada.</span>
    </div>
    ${reg.feature_policy ? `<span class="muted"><strong>Control anti-fuga:</strong> ${reg.feature_policy}</span><br><br>` : ''}
    ${topFeatures.length ? `<strong>Variables que más pesan</strong><br>
    <table><thead><tr><th>#</th><th>Variable</th><th>Importancia</th></tr></thead>
    <tbody>${topFeatures.map((f, i) => `<tr><td>${i + 1}</td><td>${String(f.feature).replace(/^num__|^cat__/, '')}</td><td>${num(f.importance).toFixed(3)}</td></tr>`).join('')}</tbody></table>` : ''}
    <span class="muted">${defs.operation_success_score_v2 || ''}</span>`;
}

// Traduce tipos de suceso crudos a etiquetas legibles para el usuario
function prettyTipo(t) {
  const map = {
    'sub23_wyscout': 'Promoción / plantilla',
    'cesion': 'Cesión',
    'traspaso': 'Traspaso',
    'libre': 'Fichaje libre',
    'retorno_cesion': 'Retorno de cesión',
    'otro': 'Continuidad',
    'plantilla_wyscout': 'Promoción / plantilla',
  };
  return map[String(t || '').toLowerCase()] || (t || '—');
}

// Detecta el club destino mencionado en la pregunta (de los destinos del jugador)
function detectDestinationClubInQuery(q, betisPlayer) {
  // Universo de clubes destino reales (Segunda 2025-26)
  const clubs = [...new Set(RF_DESTINATION_RECOMMENDATIONS.map(d => d.club))].filter(Boolean);
  // Intento 1: nombre completo
  let hit = clubs.find(c => q.includes(norm(c)));
  if (hit) return hit;
  // Intento 2: por palabra significativa del nombre (Ceuta, Andorra, Eibar…)
  return clubs.find(c => {
    const words = norm(c).split(/\s+/).filter(w => w.length >= 4 &&
      !['real','club','deportivo','union','balompie'].includes(w));
    return words.some(w => q.includes(w));
  }) || null;
}

// Evalúa una operación concreta jugador → club y la justifica con un veredicto
function sgptEvaluateMove(playerName, clubName, operacion) {
  const row = RF_DESTINATION_RECOMMENDATIONS.find(
    d => norm(d.jugador) === norm(playerName) && norm(d.club) === norm(clubName));
  const summary = rfSummaryForPlayer(playerName);

  if (!row) {
    return `<strong>${playerName} → ${clubName}</strong><br>
      <span class="muted">No tengo evidencia de desarrollo de <strong>${clubName}</strong> para la posición de ${playerName},
      o ese club no milita en Segunda 2025-26. Pregúntame por sus destinos ideales para ver alternativas con evidencia.</span>`;
  }

  // Señales clave
  const score = num(row.score_destino_rf);          // 0-100 ranking destino RF
  const demand = num(row.demand_score);              // 0-100 necesidad del club
  const revEsp = num(row.rf_revalorizacion_esperada);
  const probPos = num(row.rf_prob_revalorizacion_positiva);
  const minSub23 = num(row.minutos_sub23_destino);
  const jugSub23 = num(row.jugadores_sub23_destino);
  const nivel = row.nivel_evidencia || '—';
  const ranking = num(row.ranking_destino_rf);

  // ¿Es de los mejores destinos del jugador? (ranking dentro de su top)
  const allDest = rfRowsForPlayer(playerName);
  const total = allDest.length;
  const mejorTop = ranking > 0 && ranking <= Math.max(3, Math.ceil(total * 0.25));

  // Veredicto basado en evidencia
  let veredicto, color, emoji;
  if (score >= 55 && demand >= 40 && minSub23 >= 1500) {
    veredicto = 'SÍ, buena opción'; color = 'var(--success)'; emoji = '✅';
  } else if (score >= 40 && (demand >= 35 || minSub23 >= 1500)) {
    veredicto = 'Opción razonable, con matices'; color = 'var(--warning)'; emoji = '🟡';
  } else {
    veredicto = 'Poco recomendable'; color = 'var(--danger)'; emoji = '🔻';
  }

  // Justificación
  const just = [];
  just.push(minSub23 >= 1500
    ? `${clubName} ha dado <strong>${fmt(minSub23)} min</strong> a Sub-23 en esa posición (${jugSub23} jugadores): desarrolla el perfil.`
    : `${clubName} ha dado solo <strong>${fmt(minSub23)} min</strong> a Sub-23 en esa posición: poca evidencia de que dé minutos.`);
  just.push(demand >= 40
    ? `Demanda del club en la posición <strong>alta</strong> (${demand.toFixed(0)}/100): probablemente necesita el perfil.`
    : `Demanda del club <strong>baja</strong> (${demand.toFixed(0)}/100): puede que no busque ese perfil ahora.`);
  if (revEsp !== 0) just.push(`Revalorización esperada por el modelo: <span class="green">${formatM(revEsp)}</span> (prob. positiva ${pct(probPos)}).`);
  just.push(mejorTop
    ? `Es de los <strong>mejores destinos</strong> calculados para ${playerName} (ranking ${ranking}/${total}).`
    : `No está entre los destinos óptimos de ${playerName} (ranking ${ranking}/${total}); hay opciones mejores.`);

  const opLabel = operacion === 'venta' ? 'VENTA' : 'CESIÓN';

  return `<strong>¿${opLabel} de ${playerName} al ${clubName}?</strong>
    <span style="background:rgba(0,154,68,0.12);color:var(--primary-dark);padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;margin-left:6px">🤖 Evidencia histórica</span><br>
    <div style="margin:10px 0;padding:14px;border:2px solid ${color};border-radius:10px;background:var(--bg)">
      <div style="font-size:1.05rem;font-weight:800;color:${color};margin-bottom:8px">${emoji} ${veredicto}</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px;font-size:0.85rem">
        <div><span class="muted">Score destino</span><br><strong>${score.toFixed(1)}/100</strong></div>
        <div><span class="muted">Demanda club</span><br><strong>${demand.toFixed(0)}/100</strong></div>
        <div><span class="muted">Nivel evidencia</span><br><strong>${nivel}</strong></div>
        <div><span class="muted">Reval. esperada</span><br><strong class="green">${formatM(revEsp)}</strong></div>
      </div>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:0.85rem;line-height:1.6">
        ${just.map(j => `<li>${j}</li>`).join('')}
      </ul>
    </div>
    ${summary ? `<span class="muted">Operación que el modelo sugiere de forma global para ${playerName}: <strong>${summary.operacion_sugerida || '—'}</strong>. Pregúntame "destinos de ${playerName}" para ver el ranking completo.</span>` : ''}`;
}

/* ============================================================
   ANÁLISIS DE OPERACIÓN — cualquier jugador → club de Segunda
   "¿Cómo ves a [jugador] en el [club]?"
   ============================================================ */

// Busca el perfil de un jugador en Wyscout (plantillas completas) + master
function findPlayerProfile(playerName) {
  const qn = norm(playerName);

  // 0. Jugador del Betis Deportivo (datos propios, evita colisión de nombres comunes)
  const betis = BETIS_PLAYERS_DATA.find(d => norm(d.jugador) === qn);
  if (betis) {
    return {
      nombre: betis.jugador,
      posicion: betis.posicion_normalizada,
      edad: num(betis.edad), minutos: num(betis.minutos_jugados),
      goles: num(betis.goles), xg: num(betis.xg), valor: num(betis.valor_mercado),
      equipo: 'Real Betis B', temporada: '2025-26',
      pie: betis.pie || '', altura: num(betis.altura),
      rev: MASTER_DATA.find(d => norm(d.nombre) === qn && d.revalorizacion_absoluta != null),
    };
  }

  // 1. Wyscout (plantilla completa) — registro más reciente
  let wyRows = WY_DATA.filter(d => norm(d.jugador) === qn);
  if (!wyRows.length) wyRows = WY_DATA.filter(d => norm(d.jugador).includes(qn) || qn.includes(norm(d.jugador)));
  const order = ['2021-22','2022-23','2023-24','2024-25','2025-26'];
  wyRows.sort((a,b) => order.indexOf(b.temporada) - order.indexOf(a.temporada));
  const wy = wyRows[0];

  // 2. Revalorización (master)
  const rev = MASTER_DATA.find(d => norm(d.nombre) === qn && d.revalorizacion_absoluta != null);

  if (!wy && !rev) return null;
  return {
    nombre: wy ? wy.jugador : playerName,
    posicion: wy ? wy.posicion_normalizada : (rev?.posicion_normalizada || ''),
    edad: wy ? num(wy.edad) : num(rev?.edad),
    minutos: wy ? num(wy.minutos_jugados) : num(rev?.minutos),
    goles: wy ? num(wy.goles) : num(rev?.goles),
    xg: wy ? num(wy.xg) : num(rev?.xg),
    valor: wy ? num(wy.valor_mercado) : num(rev?.valor_mercado),
    equipo: wy ? wy.equipo : (rev?.club || ''),
    temporada: wy ? wy.temporada : (rev?.temporada || ''),
    pie: wy?.pie || '', altura: wy ? num(wy.altura) : 0,
    rev,
  };
}

// Detecta un club de Segunda 2025-26 en la pregunta
function detectSegundaActualInQuery(q) {
  const clubs = [...SEGUNDA_ACTUAL];
  const exact = clubs.find(c => q.includes(norm(c)));
  if (exact) return exact;
  return clubs.find(c => {
    const words = norm(c).split(/\s+/).filter(w => w.length >= 4 &&
      !['real','club','union','deportivo','balompie'].includes(w));
    return words.some(w => q.includes(w));
  }) || null;
}

// Detecta cualquier jugador (Betis o Wyscout) mencionado, excluyendo el club
function detectAnyPlayerInQuery(q, excludeClub) {
  // 1. Jugadores del Betis Deportivo (prioridad)
  const betis = detectBetisPlayerInQuery(q);
  if (betis) return betis.jugador;
  if (!WY_DATA.length) return null;

  // 2. Quitar el nombre del club del texto para no confundir
  let qClean = q;
  if (excludeClub) norm(excludeClub).split(/\s+/).forEach(w => { if (w.length >= 4) qClean = qClean.replace(w, ' '); });

  // 3. Buscar jugador de Wyscout: nombre completo, o apellido distintivo (≥5 chars)
  const names = [...new Set(WY_DATA.map(d => d.jugador))].filter(Boolean);
  // Coincidencia de nombre completo normalizado
  let hit = names.find(n => qClean.includes(norm(n)) && norm(n).length >= 5);
  if (hit) return hit;
  // Coincidencia por 2+ palabras significativas del nombre
  hit = names.find(n => {
    const words = norm(n).split(/\s+/).filter(w => w.length >= 4);
    if (words.length < 2) return false;
    const matches = words.filter(w => qClean.includes(w)).length;
    return matches >= 2;
  });
  return hit || null;
}

function sgptAnalyzeOperation(playerName, clubName) {
  if (!WY_DATA.length) return 'Cargando datos de plantillas… vuelve a preguntar en unos segundos.';

  const p = findPlayerProfile(playerName);
  if (!p) return `No encuentro datos de rendimiento para <strong>${playerName}</strong>.`;
  if (!SEGUNDA_ACTUAL.has(clubName)) {
    return `<strong>${clubName}</strong> no milita en Segunda División 2025-26, así que no puedo analizar el encaje en esta categoría.`;
  }

  const pos = p.posicion;
  const esSub23 = p.edad > 0 && p.edad < 23;

  // --- Contexto del club en esa posición ---
  // 1. Demanda
  const demandRow = CLUB_DEMAND_DATA.find(d => d.club === clubName && normDevPos(d.posicion) === normDevPos(pos));
  const demand = demandRow ? num(demandRow.demand_score) : 0;

  // 2. Evidencia de desarrollo (minutos Sub-23 dados a esa posición)
  const evRow = CLUB_EVIDENCE_DATA.find(d => d.club === clubName);
  const evCol = POS_TO_EVIDENCE_COL[normDevPos(pos)] || '';
  const minDevPos = evRow && evCol ? num(evRow[evCol]) : 0;
  const sub23Club = evRow ? num(evRow.jugadores_sub23_utilizados) : 0;

  // 3. Profundidad de plantilla actual en esa posición (Wyscout 2025-26)
  const squad = WY_DATA.filter(d => d.equipo === clubName && d.temporada === '2025-26' &&
    normDevPos(d.posicion_normalizada) === normDevPos(pos));
  const competidores = squad.filter(d => norm(d.jugador) !== norm(p.nombre));
  const titulares = competidores.filter(d => num(d.minutos_jugados) > 1500);

  // --- Veredicto ---
  let veredicto, color, emoji;
  const buenDesarrollo = minDevPos >= 1500;
  const necesita = demand >= 45 || titulares.length <= 1;
  if (buenDesarrollo && necesita) { veredicto = 'Encaje fuerte'; color = 'var(--success)'; emoji = '✅'; }
  else if (buenDesarrollo || necesita) { veredicto = 'Encaje con matices'; color = 'var(--warning)'; emoji = '🟡'; }
  else { veredicto = 'Encaje difícil'; color = 'var(--danger)'; emoji = '🔻'; }

  // --- Justificación analista ---
  const just = [];
  just.push(`Perfil: ${pos}${esSub23 ? ' (Sub-23)' : ''}, ${p.edad} años, ${fmt(p.minutos)} min y ${p.goles} goles esta temporada en ${p.equipo}${p.valor ? `, valor ${formatM(p.valor)}` : ''}.`);
  just.push(buenDesarrollo
    ? `El ${clubName} ha dado <strong>${fmt(minDevPos)} min</strong> a jóvenes en ${pos}: club que apuesta por ese perfil.`
    : `El ${clubName} ha dado pocos minutos a jóvenes en ${pos} (<strong>${fmt(minDevPos)} min</strong>): no es su patrón habitual.`);
  just.push(`Profundidad actual del club en ${pos}: <strong>${competidores.length} jugadores</strong> (${titulares.length} con +1500 min). ${titulares.length <= 1 ? 'Hay hueco real.' : 'Posición ya cubierta, habría competencia.'}`);
  just.push(demand >= 45
    ? `Demanda histórica del club en la posición <strong>alta</strong> (${demand.toFixed(0)}/100).`
    : `Demanda histórica <strong>moderada/baja</strong> (${demand.toFixed(0)}/100).`);

  // Competencia concreta (nombres)
  const compList = competidores
    .sort((a,b) => num(b.minutos_jugados) - num(a.minutos_jugados))
    .slice(0, 5)
    .map(d => `${d.jugador} (${num(d.edad)}a, ${fmt(num(d.minutos_jugados))}min)`);

  return `<strong>¿Cómo encaja ${p.nombre} en el ${clubName}?</strong>
    <span style="background:rgba(0,154,68,0.12);color:var(--primary-dark);padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;margin-left:6px">📊 Análisis de operación</span><br>
    <div style="margin:10px 0;padding:14px;border:2px solid ${color};border-radius:10px;background:var(--bg)">
      <div style="font-size:1.05rem;font-weight:800;color:${color};margin-bottom:8px">${emoji} ${veredicto}</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px;font-size:0.85rem">
        <div><span class="muted">Demanda club</span><br><strong>${demand.toFixed(0)}/100</strong></div>
        <div><span class="muted">Min. jóvenes en ${pos}</span><br><strong>${fmt(minDevPos)}</strong></div>
        <div><span class="muted">Profundidad ${pos}</span><br><strong>${competidores.length} jug.</strong></div>
      </div>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:0.85rem;line-height:1.6">
        ${just.map(j => `<li>${j}</li>`).join('')}
      </ul>
    </div>
    ${compList.length ? `<strong>Competencia en ${pos} en el ${clubName}:</strong><br>
    <span class="muted" style="font-size:0.82rem">${compList.join(' · ')}</span>` : ''}`;
}

function sgptDecisionForBetisPlayer(playerName) {
  if (!RF_PLAYER_RECOMMENDATIONS.length || !RF_DESTINATION_RECOMMENDATIONS.length) {
    return 'El modelo RF de decisiones todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const summary = rfSummaryForPlayer(playerName);
  const v2Rows = v2RowsForPlayer(playerName).slice(0, 5);
  const rows = v2Rows.length ? v2Rows : rfRowsForPlayer(playerName).slice(0, 5);
  const similar = RF_SIMILAR_EVENTS
    .filter(d => norm(d.jugador_betis) === norm(playerName))
    .sort((a, b) => num(a.ranking_similar) - num(b.ranking_similar))
    .slice(0, 5);

  if (!summary) return `No encuentro recomendación RF para <strong>${playerName}</strong>.`;

  const dec = BETIS_DECISIONS.find(d => norm(d.jugador) === norm(playerName));
  const operacion = dec?.operacion_recomendada || summary.operacion_sugerida || 'Evaluar';
  const prob = dec ? num(dec.probabilidad_exito) : num(summary.score_destino_medio_top5);
  const probColor = prob >= 55 ? 'var(--success)' : prob >= 35 ? 'var(--warning)' : 'var(--danger)';
  const revalText = dec?.revalorizacion_esperada || formatDeltaM(num(summary.revalorizacion_esperada_media_top5));
  const justificacion = dec?.justificacion || summary.razonamiento || '';
  const clubesText = dec?.clubes_ideales || summary.clubes_ideales || '';
  const entrenadoresText = dec?.entrenadores_ideales || summary.entrenadores_ideales || '';
  const modeloDecision = dec?.modelo_decision || (v2Rows.length ? 'operation_success_v2' : 'RF histórico');
  const stats = getPlayerSeasonStats(playerName);
  const totals = summarizePlayerStats(stats);
  const lectura = justificacion
    ? justificacion
    : `${summary.jugador} acumula ${fmt(totals.minutos)} minutos y ${fmt(totals.goles)} goles en los datos disponibles. El modelo prioriza destinos donde haya demanda real de su posición, minutos Sub-23 y precedentes de revalorización.`;

  return `<strong>${summary.jugador}</strong> · ${summary.posicion || '—'} · ${num(summary.edad).toFixed(0)} años<br>
    <div style="margin:10px 0;padding:14px;border:2px solid var(--primary);border-radius:10px;background:var(--primary-light)">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div class="muted" style="font-size:0.78rem">Operación recomendada</div>
          <div style="font-size:1.15rem;font-weight:900;color:var(--primary-dark)">${operacion}</div>
        </div>
        <div>
          <div class="muted" style="font-size:0.78rem">Score / confianza</div>
          <div style="font-size:1.15rem;font-weight:900;color:${probColor}">${prob.toFixed(0)}/100</div>
          <div class="muted" style="font-size:0.68rem">${modeloDecision}</div>
        </div>
        <div>
          <div class="muted" style="font-size:0.78rem">Revalorización esperada</div>
          <div style="font-size:1.05rem;font-weight:900" class="green">${revalText}</div>
        </div>
      </div>
    </div>
    <strong>Datos técnicos del jugador</strong><br>
    <table><thead><tr><th>Part.</th><th>Min</th><th>Goles</th><th>xG</th><th>Prob +</th><th>Cesión hist.</th><th>Traspaso hist.</th></tr></thead>
    <tbody><tr>
      <td>${fmt(totals.partidos)}</td><td>${fmt(totals.minutos)}</td><td>${fmt(totals.goles)}</td><td>${totals.xg.toFixed(2)}</td>
      <td>${pct(summary.prob_revalorizacion_positiva_media_top5)}</td>
      <td>${pct(summary.prob_cesion_historica)}</td><td>${pct(summary.prob_traspaso_historico)}</td>
    </tr></tbody></table>
    <div style="margin:10px 0 12px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">
      <strong>Justificación deportiva:</strong><br>
      <span class="muted">${lectura}</span>
    </div>
    ${clubesText ? `<div style="margin-bottom:6px"><strong>Clubes ideales:</strong> <span class="muted">${clubesText}</span></div>` : ''}
    ${entrenadoresText ? `<div style="margin-bottom:10px"><strong>Entrenadores ideales:</strong> <span class="muted">${entrenadoresText}</span></div>` : ''}
    ${rows.length && v2Rows.length ? `<strong>Destinos calculados — modelo v2</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Entrenador</th><th>Score v2</th><th>Cesión</th><th>Venta</th><th>Demanda</th></tr></thead>
    <tbody>${rows.map(d => `<tr>
      <td>${num(d.ranking_destino_v2)}</td><td class="bold">${d.club}</td><td>${d.entrenador || '—'}</td>
      <td class="green">${num(d.score_destino_v2).toFixed(1)}</td><td>${num(d.score_v2_cesion).toFixed(1)}</td>
      <td>${num(d.score_v2_traspaso).toFixed(1)}</td><td>${num(d.demanda).toFixed(0)}/100</td>
    </tr>`).join('')}</tbody></table>` : rows.length ? `<strong>Destinos calculados</strong><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Entrenador</th><th>Score</th><th>Reval.</th><th>Prob +</th><th>Demanda</th></tr></thead>
    <tbody>${rows.map(d => `<tr>
      <td>${num(d.ranking_destino_rf)}</td><td class="bold">${d.club}</td><td>${d.entrenador || '—'}</td>
      <td class="green">${num(d.score_destino_rf).toFixed(1)}</td><td>${formatDeltaM(num(d.rf_revalorizacion_esperada))}</td>
      <td>${pct(d.rf_prob_revalorizacion_positiva)}</td><td>${num(d.demand_score).toFixed(0)}/100</td>
    </tr>`).join('')}</tbody></table>` : ''}
    ${similar.length ? `<br><strong>Casos históricos parecidos</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Club</th><th>Tipo</th><th>Edad</th><th>Min</th><th>Goles</th><th>Sim.</th></tr></thead>
    <tbody>${similar.map(d => `<tr>
      <td>${num(d.ranking_similar)}</td><td class="bold">${d.jugador_historico}</td><td>${d.club}</td>
      <td>${prettyTipo(d.tipo_suceso)}</td><td>${num(d.edad).toFixed(0)}</td><td>${fmt(num(d.minutos))}</td>
      <td>${fmt(num(d.goles))}</td><td>${num(d.similaridad_score).toFixed(1)}</td>
    </tr>`).join('')}</tbody></table>` : ''}`;
}

function sgptDecisionForPosition(pos, n) {
  if (!RF_PLAYER_RECOMMENDATIONS.length) {
    return 'El modelo RF de decisiones todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const rows = RF_PLAYER_RECOMMENDATIONS
    .filter(d => devPosMatch({ posicion_normalizada: d.posicion }, pos))
    .sort((a, b) => num(b.score_destino_medio_top5) - num(a.score_destino_medio_top5))
    .slice(0, n);
  if (!rows.length) return `No encuentro jugadores Betis Deportivo para <strong>${pos}</strong> en el modelo RF.`;
  return `<strong>Operaciones sugeridas por modelo RF para ${pos}</strong><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Edad</th><th>Operación</th><th>Confianza</th><th>Score top5</th><th>Prob +</th><th>Clubes ideales</th></tr></thead>
    <tbody>${rows.map((d, i) => `<tr>
      <td>${i + 1}</td><td class="bold">${d.jugador}</td><td>${num(d.edad).toFixed(0)}</td>
      <td>${d.operacion_sugerida}</td><td>${d.confianza_modelo}</td>
      <td>${num(d.score_destino_medio_top5).toFixed(1)}</td><td>${pct(d.prob_revalorizacion_positiva_media_top5)}</td>
      <td class="muted">${d.clubes_ideales || '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptDecisionOverview(n) {
  if (!RF_PLAYER_RECOMMENDATIONS.length) {
    return 'El modelo RF de decisiones todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const rows = [...RF_PLAYER_RECOMMENDATIONS]
    .sort((a, b) => num(b.score_destino_medio_top5) - num(a.score_destino_medio_top5))
    .slice(0, n);
  return `<strong>Resumen de operaciones sugeridas — Betis Deportivo</strong><br>
    <span class="muted">Pregunta por un jugador concreto para ver clubes, entrenadores y sucesos similares.</span><br>
    <table><thead><tr><th>#</th><th>Jugador</th><th>Pos.</th><th>Edad</th><th>Operación</th><th>Confianza</th><th>Score top5</th><th>Reval. esp.</th></tr></thead>
    <tbody>${rows.map((d, i) => `<tr>
      <td>${i + 1}</td><td class="bold">${d.jugador}</td><td>${d.posicion}</td><td>${num(d.edad).toFixed(0)}</td>
      <td>${d.operacion_sugerida}</td><td>${d.confianza_modelo}</td>
      <td>${num(d.score_destino_medio_top5).toFixed(1)}</td><td>${formatM(num(d.revalorizacion_esperada_media_top5))}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptLoanDestinationsForPlayer(playerName, n) {
  if (!LOAN_MODEL_DATA.length) {
    return 'El modelo de destinos de cesión todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const rows = loanRowsForPlayer(playerName).slice(0, n);
  if (!rows.length) return `No encuentro destinos calculados para <strong>${playerName}</strong>.`;

  const first = rows[0];
  return `<strong>Mejores destinos por evidencia histórica para ${first.jugador}</strong><br>
    <span class="muted">Modelo explicable: minutos reales Sub-23, jugadores utilizados, posición, entrenador, producción y valor. No es una recomendación automática cerrada.</span><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Entren. Sub-23 (hist.)</th><th>Score</th><th>Evidencia</th><th>Min Sub-23</th><th>Jug.</th><th>Razones</th></tr></thead>
    <tbody>${rows.map(d => `<tr>
      <td>${num(d.ranking_destino)}</td>
      <td class="bold">${d.club_destino}</td>
      <td>${d.entrenador_principal || '—'}</td>
      <td class="green">${num(d.score_evidencia).toFixed(2)}</td>
      <td>${d.nivel_evidencia || '—'}</td>
      <td>${fmt(num(d.minutos_sub23_destino))}</td>
      <td>${num(d.jugadores_sub23_destino)}</td>
      <td class="muted">${d.razones || '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptLoanDestinationsForPosition(pos, n) {
  if (!LOAN_MODEL_DATA.length) {
    return 'El modelo de destinos de cesión todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const rows = LOAN_MODEL_DATA
    .filter(d => devPosMatch({ posicion_normalizada: d.posicion_jugador }, pos))
    .sort((a, b) => num(b.score_evidencia) - num(a.score_evidencia));

  const seen = new Set();
  const unique = rows.filter(d => {
    const key = `${d.club_destino}|${d.posicion_destino}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, n);

  if (!unique.length) return `No encuentro destinos calculados para la posición <strong>${pos}</strong>.`;
  return `<strong>Destinos con más evidencia para ${pos}</strong><br>
    <span class="muted">Ranking por oportunidades históricas Sub-23 en esa posición.</span><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Entren. Sub-23 (hist.)</th><th>Score</th><th>Evidencia</th><th>Min Sub-23</th><th>Jug.</th><th>Goles+xG</th></tr></thead>
    <tbody>${unique.map((d, i) => `<tr>
      <td>${i + 1}</td>
      <td class="bold">${d.club_destino}</td>
      <td>${d.entrenador_principal || '—'}</td>
      <td class="green">${num(d.score_evidencia).toFixed(2)}</td>
      <td>${d.nivel_evidencia || '—'}</td>
      <td>${fmt(num(d.minutos_sub23_destino))}</td>
      <td>${num(d.jugadores_sub23_destino)}</td>
      <td>${num(d.goles_sub23_destino).toFixed(0)} + ${num(d.xg_sub23_destino).toFixed(2)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function sgptLoanDestinationsOverview(n) {
  if (!LOAN_MODEL_DATA.length) {
    return 'El modelo de destinos de cesión todavía se está cargando. Vuelve a lanzar la pregunta en unos segundos.';
  }
  const seen = new Set();
  const rows = [...LOAN_MODEL_DATA]
    .sort((a, b) => num(b.score_evidencia) - num(a.score_evidencia))
    .filter(d => {
      const key = `${d.club_destino}|${d.posicion_destino}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n);
  return `<strong>Destinos con más evidencia histórica para cesiones Sub-23</strong><br>
    <span class="muted">Pregunta por un jugador concreto, por ejemplo: “mejores destinos para Pablo Garcia”.</span><br>
    <table><thead><tr><th>#</th><th>Club</th><th>Posición</th><th>Entren. Sub-23 (hist.)</th><th>Score</th><th>Min Sub-23</th><th>Jug.</th></tr></thead>
    <tbody>${rows.map((d, i) => `<tr>
      <td>${i + 1}</td><td class="bold">${d.club_destino}</td><td>${d.posicion_destino}</td>
      <td>${d.entrenador_principal || '—'}</td><td class="green">${num(d.score_evidencia).toFixed(2)}</td>
      <td>${fmt(num(d.minutos_sub23_destino))}</td><td>${num(d.jugadores_sub23_destino)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function devBarH(id, entries, color, fmtFn) {
  const top = entries.slice(0, 15);
  plot(id, [{
    type: 'bar', orientation: 'h',
    x: top.map(e => e[1]).reverse(),
    y: top.map(e => e[0]).reverse(),
    text: top.map(e => fmtFn ? fmtFn(e[1]) : e[1]).reverse(),
    textposition: 'auto',
    marker: { color }
  }], { margin: { t: 20, r: 30, b: 30, l: 150 } });
}

/* ============================================================
   CLUBES DESARROLLADORES — Tab
   ============================================================ */

function renderClubesDevTab() {
  loadMasterData(data => {
    const notice = document.getElementById('cdev-notice');
    if (!data.length) { notice.textContent = 'No se pudo cargar el dataset maestro.'; return; }

    // Listeners (una vez)
    if (!window._cdevInit) {
      window._cdevInit = true;
      document.getElementById('cdev-season').addEventListener('change', () => renderClubesDevTab());
      document.getElementById('cdev-only-segunda').addEventListener('change', () => renderClubesDevTab());
    }

    const season = document.getElementById('cdev-season').value;
    const onlySegunda = document.getElementById('cdev-only-segunda').checked;

    let sub23 = data.filter(d => isTrue(d.es_sub23));
    if (season !== 'all') sub23 = sub23.filter(d => d.temporada === season);
    if (onlySegunda) sub23 = sub23.filter(d => SEGUNDA_CLUBS_SET.has(d.club));

    const conWy = sub23.filter(d => isTrue(d.tiene_wyscout));
    notice.innerHTML = `📊 ${sub23.length} registros Sub-23 · ${conWy.length} con datos de rendimiento Wyscout` +
      (season !== 'all' ? ` · Temporada ${season}` : '');

    // Agregaciones por club
    const byClub = {};
    sub23.forEach(d => {
      const c = d.club;
      if (!byClub[c]) byClub[c] = { minutos:0, jugadores:new Set(), goles:0, vmSum:0, vmCount:0, revSum:0, edadSum:0, edadCount:0 };
      byClub[c].minutos += num(d.minutos);
      byClub[c].jugadores.add(d.nombre);
      byClub[c].goles += num(d.goles);
      if (num(d.edad) > 0) { byClub[c].edadSum += num(d.edad); byClub[c].edadCount++; }
      const vm = num(d.valor_mercado_wyscout) || num(d.valor_mercado);
      if (vm > 0) { byClub[c].vmSum += vm; byClub[c].vmCount++; }
      byClub[c].revSum += num(d.revalorizacion_absoluta);
    });

    const arr = Object.entries(byClub).map(([c, v]) => ({
      club: c, minutos: v.minutos, jugadores: v.jugadores.size, goles: v.goles,
      edadMedia: v.edadCount ? v.edadSum / v.edadCount : 0,
      vmMedio: v.vmCount ? v.vmSum / v.vmCount : 0, rev: v.revSum
    }));

    const byMin  = arr.filter(a=>a.minutos>0).sort((a,b)=>b.minutos-a.minutos).map(a=>[a.club,Math.round(a.minutos)]);
    const byJug  = [...arr].sort((a,b)=>b.jugadores-a.jugadores).map(a=>[a.club,a.jugadores]);
    const byGol  = arr.filter(a=>a.goles>0).sort((a,b)=>b.goles-a.goles).map(a=>[a.club,a.goles]);
    const byVal  = arr.filter(a=>a.vmMedio>0).sort((a,b)=>b.vmMedio-a.vmMedio).map(a=>[a.club,Math.round(a.vmMedio)]);
    const byRev  = arr.filter(a=>a.rev>0).sort((a,b)=>b.rev-a.rev).map(a=>[a.club,Math.round(a.rev)]);

    devBarH('chart-cdev-minutos', byMin, '#009a44', v => fmt(v));
    devBarH('chart-cdev-jugadores', byJug, '#1d6fa4');
    devBarH('chart-cdev-goles', byGol, '#e07b39');
    devBarH('chart-cdev-valor', byVal, '#c8a951', v => formatM(v));
    devBarH('chart-cdev-revalorizacion', byRev, '#8b5cf6', v => formatM(v));

    // Tabla
    const ranked = [...arr].sort((a,b)=>b.minutos-a.minutos).slice(0,25);
    document.getElementById('cdev-table').innerHTML = `
      <table class="ppc-table"><thead><tr>
        <th>#</th><th>Club</th><th>Min Sub-23</th><th>Jugadores</th><th>Edad media</th><th>Goles</th><th>VM medio</th><th>Revalorización</th>
      </tr></thead><tbody>
        ${ranked.map((a,i)=>`<tr>
          <td>${i+1}</td><td><strong>${a.club}</strong></td>
          <td>${fmt(a.minutos)}</td><td>${a.jugadores}</td><td>${a.edadMedia ? a.edadMedia.toFixed(1) : '—'}</td><td>${a.goles}</td>
          <td>${a.vmMedio>0?formatM(a.vmMedio):'—'}</td>
          <td style="color:${a.rev>0?'var(--success)':'var(--text-muted)'}">${a.rev!==0?formatM(a.rev):'—'}</td>
        </tr>`).join('')}
      </tbody></table>`;
  });
}

/* ============================================================
   ENTRENADORES — Tab
   ============================================================ */

function renderEntrenadoresTab() {
  loadMasterData(data => {
    const notice = document.getElementById('ent-notice');
    if (!data.length) { notice.textContent = 'No se pudo cargar el dataset maestro.'; return; }

    const conEnt = data.filter(d => d.entrenador);
    const sub23  = conEnt.filter(d => isTrue(d.es_sub23));
    notice.innerHTML = `👔 ${new Set(conEnt.map(d=>d.entrenador)).size} entrenadores · ${sub23.length} registros Sub-23 con entrenador asignado`;

    // Agregación por entrenador
    const byCoach = {};
    conEnt.forEach(d => {
      const c = d.entrenador;
      if (!byCoach[c]) byCoach[c] = { minTotal:0, minSub23:0, jugSub23:new Set(), golesSub23:0, valorSub23:0, posiciones:new Set() };
      byCoach[c].minTotal += num(d.minutos);
      if (isTrue(d.es_sub23)) {
        byCoach[c].minSub23 += num(d.minutos);
        byCoach[c].jugSub23.add(d.nombre);
        byCoach[c].golesSub23 += num(d.goles);
        byCoach[c].valorSub23 += num(d.revalorizacion_absoluta);
        const pos = normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion);
        if (pos) byCoach[c].posiciones.add(pos);
      }
    });

    const arr = Object.entries(byCoach).map(([c,v]) => ({
      coach: c, minSub23: v.minSub23, jugSub23: v.jugSub23.size,
      golesSub23: v.golesSub23, valorSub23: v.valorSub23,
      pctSub23: v.minTotal > 0 ? (v.minSub23 / v.minTotal * 100) : 0,
      posiciones: [...v.posiciones].sort().join(', ')
    }));

    devBarH('chart-ent-minutos', arr.filter(a=>a.minSub23>0).sort((a,b)=>b.minSub23-a.minSub23).map(a=>[a.coach,Math.round(a.minSub23)]), '#009a44', v=>fmt(v));
    devBarH('chart-ent-jugadores', [...arr].sort((a,b)=>b.jugSub23-a.jugSub23).map(a=>[a.coach,a.jugSub23]), '#1d6fa4');
    devBarH('chart-ent-goles', arr.filter(a=>a.golesSub23>0).sort((a,b)=>b.golesSub23-a.golesSub23).map(a=>[a.coach,a.golesSub23]), '#e07b39');
    devBarH('chart-ent-valor', arr.filter(a=>a.valorSub23>0).sort((a,b)=>b.valorSub23-a.valorSub23).map(a=>[a.coach,Math.round(a.valorSub23)]), '#c8a951', v=>formatM(v));
    devBarH('chart-ent-pct', arr.filter(a=>a.minSub23>200).sort((a,b)=>b.pctSub23-a.pctSub23).map(a=>[a.coach,Math.round(a.pctSub23)]), '#be185d', v=>v+'%');

    const ranked = arr.filter(a=>a.minSub23>0).sort((a,b)=>b.minSub23-a.minSub23).slice(0,25);
    document.getElementById('ent-table').innerHTML = `
      <table class="ppc-table"><thead><tr>
        <th>#</th><th>Entrenador</th><th>Min Sub-23</th><th>Jugadores Sub-23</th><th>Goles Sub-23</th><th>Valor generado</th><th>% Utilización</th><th>Posiciones utilizadas</th>
      </tr></thead><tbody>
        ${ranked.map((a,i)=>`<tr>
          <td>${i+1}</td><td><strong>${a.coach}</strong></td>
          <td>${fmt(a.minSub23)}</td><td>${a.jugSub23}</td><td>${a.golesSub23}</td>
          <td style="color:${a.valorSub23>0?'var(--success)':'var(--text-muted)'}">${a.valorSub23!==0?formatM(a.valorSub23):'—'}</td>
          <td>${a.pctSub23.toFixed(0)}%</td><td>${a.posiciones || '—'}</td>
        </tr>`).join('')}
      </tbody></table>`;
  });
}

/* ============================================================
   DESARROLLO POR POSICIÓN — Tab
   ============================================================ */

function renderPosDevTab() {
  loadMasterData(data => {
    if (!data.length) {
      document.getElementById('posdev-kpis').innerHTML = '<p style="color:var(--text-muted)">No se pudo cargar el dataset.</p>';
      return;
    }

    const conPos = data.filter(d => normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion));
    const byPos = {};
    conPos.forEach(d => {
      const p = normDevPos(d.posicion_normalizada || d.posicion_es || d.posicion);
      if (!byPos[p]) byPos[p] = { minutos:[], goles:0, xg90:[], vm:[], rev:[], count:0 };
      byPos[p].count++;
      if (num(d.minutos) > 0) byPos[p].minutos.push(num(d.minutos));
      byPos[p].goles += num(d.goles);
      if (num(d.xg_por_90) > 0) byPos[p].xg90.push(num(d.xg_por_90));
      const vm = num(d.valor_mercado_wyscout) || num(d.valor_mercado);
      if (vm > 0) byPos[p].vm.push(vm);
      if (num(d.revalorizacion_absoluta) !== 0) byPos[p].rev.push(num(d.revalorizacion_absoluta));
    });

    const avg = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
    const stats = Object.entries(byPos).map(([p,v]) => ({
      pos: p, count: v.count,
      minMedio: avg(v.minutos), goles: v.goles,
      xg90: avg(v.xg90), vmMedio: avg(v.vm), revMedio: avg(v.rev)
    }));

    // KPIs
    const totalConWy = conPos.filter(d=>isTrue(d.tiene_wyscout)).length;
    document.getElementById('posdev-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-value">${stats.length}</div><div class="kpi-label">Posiciones</div></div>
      <div class="kpi-card"><div class="kpi-value">${conPos.length}</div><div class="kpi-label">Registros</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalConWy}</div><div class="kpi-label">Con datos Wyscout</div></div>
      <div class="kpi-card"><div class="kpi-value">${conPos.filter(d=>isTrue(d.es_sub23)).length}</div><div class="kpi-label">Sub-23</div></div>`;

    const sBy = (key, asc=false) => [...stats].sort((a,b)=>asc?a[key]-b[key]:b[key]-a[key]);
    devBarH('chart-posdev-minutos', sBy('minMedio').map(s=>[s.pos,Math.round(s.minMedio)]), '#009a44', v=>fmt(v));
    devBarH('chart-posdev-goles', sBy('goles').map(s=>[s.pos,s.goles]), '#e07b39');
    devBarH('chart-posdev-xg', sBy('xg90').map(s=>[s.pos,+s.xg90.toFixed(2)]), '#0891b2');
    devBarH('chart-posdev-vm', sBy('vmMedio').map(s=>[s.pos,Math.round(s.vmMedio)]), '#c8a951', v=>formatM(v));
    devBarH('chart-posdev-rev', sBy('revMedio').map(s=>[s.pos,Math.round(s.revMedio)]), '#8b5cf6', v=>formatM(v));

    const ranked = sBy('vmMedio');
    document.getElementById('posdev-table').innerHTML = `
      <table class="ppc-table"><thead><tr>
        <th>Posición</th><th>Registros</th><th>Min medio</th><th>Goles tot.</th><th>xG/90 medio</th><th>VM medio</th><th>Revalorización media</th>
      </tr></thead><tbody>
        ${ranked.map(s=>`<tr>
          <td><strong>${s.pos}</strong></td><td>${s.count}</td>
          <td>${fmt(s.minMedio)}</td><td>${s.goles}</td>
          <td>${s.xg90.toFixed(2)}</td><td>${formatM(s.vmMedio)}</td>
          <td style="color:${s.revMedio>0?'var(--success)':'var(--text-muted)'}">${formatM(s.revMedio)}</td>
        </tr>`).join('')}
      </tbody></table>`;
  });
}

/* ============================================================
   SCOUTGPT — Extensión para datos de desarrollo
   ============================================================ */

function buildQueryContext(question) {
  const q = norm(question);
  const MAX = 80;

  const M = MASTER_DATA;
  const isSub23 = d => d.es_sub23 === true || d.es_sub23 === 'True' || (+d.edad > 0 && +d.edad < 23);
  const posMatch = (d, kw) => devPosMatch(d, POSITION_QUERY_ALIASES[kw] || kw);

  // Modelo RF de decisiones Betis Deportivo
  if (RF_PLAYER_RECOMMENDATIONS.length && isDecisionModelQuery(q)) {
    const player = detectBetisPlayerInQuery(q);
    if (player) {
      const summary = rfSummaryForPlayer(player.jugador);
      const rows = rfRowsForPlayer(player.jugador).slice(0, 8);
      const similar = RF_SIMILAR_EVENTS
        .filter(d => norm(d.jugador_betis) === norm(player.jugador))
        .sort((a, b) => num(a.ranking_similar) - num(b.ranking_similar))
        .slice(0, 8);
      return `Modelo RF de decision para ${player.jugador}. No es decision automatica, es evidencia:\n` +
        `Resumen: operacion:${summary?.operacion_sugerida||''}|confianza:${summary?.confianza_modelo||''}|reval_media_top5:${summary?.revalorizacion_esperada_media_top5||''}|prob_rev_positiva:${summary?.prob_revalorizacion_positiva_media_top5||''}|razonamiento:${summary?.razonamiento||''}\n` +
        `Destinos:\n` +
        rows.map(d => `${d.ranking_destino_rf}|${d.club}|entrenador:${d.entrenador||''}|score_rf:${d.score_destino_rf}|reval_esperada:${d.rf_revalorizacion_esperada}|prob_rev_pos:${d.rf_prob_revalorizacion_positiva}|demanda:${d.demand_score}|razon:${d.razonamiento_rf||''}`).join('\n') +
        `\nSucesos similares:\n` +
        similar.map(d => `${d.ranking_similar}|${d.jugador_historico}|${d.club}|${prettyTipo(d.tipo_suceso)}|edad:${d.edad}|min:${d.minutos}|goles:${d.goles}|rev:${d.revalorizacion}|sim:${d.similaridad_score}`).join('\n');
    }
  }

  // Modelo de destinos de cesión Betis Deportivo
  if (LOAN_MODEL_DATA.length && isLoanDestinationQuery(q)) {
    const player = detectBetisPlayerInQuery(q);
    if (player) {
      const rows = loanRowsForPlayer(player.jugador).slice(0, 15);
      return `Modelo de destinos para ${player.jugador}. Es evidencia histórica, no recomendación automática:\n` +
        rows.map(d => `${d.ranking_destino}|${d.club_destino}|${d.posicion_destino}|entrenador:${d.entrenador_principal||''}|score:${d.score_evidencia}|evidencia:${d.nivel_evidencia}|min_sub23:${d.minutos_sub23_destino}|jug_sub23:${d.jugadores_sub23_destino}|goles:${d.goles_sub23_destino}|xg:${d.xg_sub23_destino}|razones:${d.razones||''}`).join('\n');
    }
    const pos = detectPositionInQuery(q);
    if (pos) {
      const rows = LOAN_MODEL_DATA
        .filter(d => devPosMatch({ posicion_normalizada: d.posicion_jugador }, pos))
        .sort((a, b) => num(b.score_evidencia) - num(a.score_evidencia))
        .slice(0, 25);
      return `Modelo de destinos para posición ${pos}. Ranking por evidencia histórica Sub-23:\n` +
        rows.map(d => `${d.club_destino}|${d.posicion_destino}|entrenador:${d.entrenador_principal||''}|score:${d.score_evidencia}|min_sub23:${d.minutos_sub23_destino}|jug_sub23:${d.jugadores_sub23_destino}|goles:${d.goles_sub23_destino}|xg:${d.xg_sub23_destino}`).join('\n');
    }
  }

  // Entrenador que desarrolla mejor una posición concreta
  if (M.length && /entrenador/.test(q) && /(delant|extrem|central|lateral|medio|portero|centrocampista)/.test(q)) {
    const posKw = /delant/.test(q)?'delantero':/extrem/.test(q)?'extremo':/central/.test(q)?'central':/lateral/.test(q)?'lateral':/portero/.test(q)?'portero':/medio|centrocampista/.test(q)?'mediocentro':'';
    const rows = M.filter(d => d.entrenador && isSub23(d) && posMatch(d, posKw) && +d.minutos > 0);
    const by = groupBy(rows, 'entrenador');
    const ranked = Object.entries(by)
      .map(([c,v]) => [c, v.reduce((s,d)=>s+(+d.minutos||0),0), v.reduce((s,d)=>s+(+d.goles||0),0), new Set(v.map(d=>d.nombre)).size])
      .sort((a,b)=>b[1]-a[1]).slice(0,20);
    return `Entrenadores que más desarrollan Sub-23 en posición "${posKw}":\n` +
      ranked.map(([c,m,g,j])=>`${c}|minutos:${Math.round(m)}|goles:${g}|jugadores:${j}`).join('\n');
  }

  // Entrenador + Sub-23 (minutos, jugadores, utilización)
  if (M.length && /entrenador/.test(q) && /sub.?23|jov/.test(q)) {
    const sub23 = M.filter(d => isSub23(d) && d.entrenador);
    const by = groupBy(sub23, 'entrenador');
    const ranked = Object.entries(by)
      .map(([c,v]) => [c, new Set(v.map(d=>d.nombre)).size, v.reduce((s,d)=>s+(+d.minutos||0),0), v.reduce((s,d)=>s+(+d.goles||0),0)])
      .sort((a,b)=>b[2]-a[2]).slice(0,20);
    return 'Entrenadores que más utilizan Sub-23 (orden por minutos):\n' +
      ranked.map(([c,j,m,g]) => `${c}|jugadores_sub23:${j}|minutos_sub23:${Math.round(m)}|goles_sub23:${g}`).join('\n');
  }

  // Club + Sub-23 (minutos / utilización / jugadores)
  if (M.length && /club|equipo/.test(q) && /sub.?23|jov/.test(q)) {
    const sub23 = M.filter(d => isSub23(d));
    const by = groupBy(sub23, 'club');
    const ranked = Object.entries(by)
      .map(([c,v]) => [c, v.reduce((s,d)=>s+(+d.minutos||0),0), new Set(v.map(d=>d.nombre)).size, v.reduce((s,d)=>s+(+d.goles||0),0)])
      .sort((a,b)=>b[1]-a[1]).slice(0,25);
    return 'Clubes que más desarrollan Sub-23 (minutos, jugadores, goles):\n' +
      ranked.map(([c,m,j,g]) => `${c}|minutos_sub23:${Math.round(m)}|jugadores_sub23:${j}|goles_sub23:${g}`).join('\n');
  }

  // Posición Sub-23 por minutos o goles (extremos, delanteros, etc.)
  if (M.length && /(delant|extrem|central|lateral|medio|portero|centrocampista|mediapunta)/.test(q) && /sub.?23/.test(q)) {
    const posKw = /delant/.test(q)?'delantero':/extrem/.test(q)?'extremo':/central/.test(q)?'central':/lateral/.test(q)?'lateral':/portero/.test(q)?'portero':/mediapunta/.test(q)?'mediapunta':'mediocentro';
    const wantGoles = /gol/.test(q);
    const wantValor = /valor|revalori|genera/.test(q);
    let rows = M.filter(d => isSub23(d) && posMatch(d, posKw) && +d.minutos > 0);
    rows = rows.sort((a,b) => {
      if (wantValor) return (num(b.revalorizacion_absoluta)||num(b.valor_mercado_wyscout)||num(b.valor_mercado)) -
        (num(a.revalorizacion_absoluta)||num(a.valor_mercado_wyscout)||num(a.valor_mercado));
      return wantGoles ? (+b.goles||0)-(+a.goles||0) : (+b.minutos||0)-(+a.minutos||0);
    }).slice(0,30);
    const season = detectSeasonInQuery(q);
    if (season) rows = rows.filter(d => d.temporada === season);
    return `${posKw} Sub-23 por ${wantValor?'valor':wantGoles?'goles':'minutos'}:\n` +
      rows.map(d => `${d.nombre}|${d.club}|${d.temporada}|edad:${d.edad}|min:${d.minutos}|goles:${d.goles||0}|xG/90:${d.xg_por_90||0}|VM:${formatM(num(d.valor_mercado_wyscout)||num(d.valor_mercado))}|rev:${formatM(num(d.revalorizacion_absoluta))}`).join('\n');
  }

  // Sub-23 revalorizados genéricos
  if (/sub.?23/.test(q) && /revalori|valor/.test(q)) {
    const rows = REV_DATA.filter(d => (+d.edad_llegada || 99) < 23)
      .sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0))
      .slice(0, MAX);
    return 'Sub-23 más revalorizados en Segunda División:\n' +
      rows.map(d => `${d.jugador}|${d.club}|edad:${d.edad_llegada}|VM entrada:${formatM(+d.vm_llegada||0)}|VM salida:${formatM(+d.vm_salida||0)}|rev:${formatM(+d.revalorizacion_abs||0)}|ROI:${(+d.revalorizacion_pct||0).toFixed(0)}%`).join('\n');
  }

  // Entrenador específico
  const coaches_list = M.length ? [...new Set(M.map(d=>d.entrenador).filter(Boolean))] : [];
  const coachMatch = coaches_list.find(c => norm(c).split(' ').some(w => w.length > 4 && q.includes(norm(w))));
  if (coachMatch && M.length) {
    const rows = M.filter(d => d.entrenador === coachMatch);
    const sub23 = rows.filter(isSub23);
    return `Datos del entrenador ${coachMatch}:\n` +
      `registros:${rows.length}|jugadores_unicos:${new Set(rows.map(d=>d.nombre)).size}|sub23:${sub23.length}|minutos_sub23:${Math.round(sub23.reduce((s,d)=>s+(+d.minutos||0),0))}\n` +
      rows.slice(0,40).map(d=>`${d.nombre}|${d.club}|${d.temporada}|edad:${d.edad}|${d.posicion_normalizada||''}|min:${d.minutos||0}`).join('\n');
  }

  // Clubes por valor generado
  if (/club|equipo/.test(q) && /valor|revalori|generar/.test(q)) {
    const byClub = groupBy(REV_DATA, 'club');
    const rows = Object.entries(byClub)
      .map(([c,v]) => [c, v.reduce((s,d)=>s+(+d.revalorizacion_abs||0),0), v.length, v.reduce((s,d)=>s+(+d.revalorizacion_pct||0),0)/v.length])
      .sort((a,b) => b[1]-a[1]).slice(0, MAX);
    return 'Clubes por valor generado:\n' +
      rows.map(([c,t,n,r]) => `${c}|valor_total:${formatM(t)}|jugadores:${n}|ROI_medio:${r.toFixed(0)}%`).join('\n');
  }

  // Temporada específica
  const detectedSeason = detectSeasonInQuery(q);
  if (detectedSeason) {
    const data = ALL_DATA.filter(d => d.temporada === detectedSeason).slice(0, MAX);
    const resumen = `Temporada ${detectedSeason}: ${data.length} ops, dinero:${formatM(sumBy(data,'importe_numerico'))}`;
    const rows = [...data].filter(d=>d.importe_numerico>0).sort((a,b)=>b.importe_numerico-a.importe_numerico).slice(0,30);
    return resumen + '\nTop fichajes:\n' + rows.map(d=>`${d.jugador}|${d.club}|${d.movimiento}|${formatM(d.importe_numerico)}`).join('\n');
  }

  // Club específico
  const club = detectClubInQuery(q);
  if (club) {
    const data = ALL_DATA.filter(d => d.club === club).slice(0, MAX);
    return `Datos de ${club}:\n` + data.map(d=>`${d.temporada}|${d.jugador}|${d.movimiento}|${d.tipo_operacion}|${formatM(d.importe_numerico||0)}`).join('\n');
  }

  // ROI / nacionalidades
  if (/roi|nacional|pa[ií]s/.test(q)) {
    const byNac = groupBy(REV_DATA.filter(d=>d.revalorizacion_pct!=null), 'nacionalidad');
    const rows = Object.entries(byNac)
      .map(([n,v])=>[n, v.reduce((s,d)=>s+(+d.revalorizacion_pct||0),0)/v.length, v.length])
      .filter(([,,cnt])=>cnt>=3).sort((a,b)=>b[1]-a[1]).slice(0,30);
    return 'ROI medio por nacionalidad:\n' + rows.map(([n,r,c])=>`${n}|ROI:${r.toFixed(0)}%|jugadores:${c}`).join('\n');
  }

  // Posición
  const pos = detectPositionInQuery(q);
  if (pos) {
    const rows = REV_DATA.filter(d=>(d.posicion_es||tPos(d.posicion||''))===pos).slice(0,MAX);
    return `Stats para posición ${pos}:\n` + rows.map(d=>`${d.jugador}|${d.club}|rev:${formatM(+d.revalorizacion_abs||0)}|ROI:${(+d.revalorizacion_pct||0).toFixed(0)}%`).join('\n');
  }

  // General
  const topRev = [...REV_DATA].sort((a,b)=>(+b.revalorizacion_abs||0)-(+a.revalorizacion_abs||0)).slice(0,MAX);
  return `Resumen dataset: ${ALL_DATA.length} operaciones, ${REV_DATA.length} revalorizaciones, 5 temporadas (2021-26)\n` +
    `Master: ${MASTER_DATA.length} registros, ${new Set(MASTER_DATA.map(d=>d.entrenador).filter(Boolean)).size} entrenadores\n` +
    'Top revalorizados:\n' + topRev.map(d=>`${d.jugador}|${d.club}|${d.posicion_es||''}|rev:${formatM(+d.revalorizacion_abs||0)}|ROI:${(+d.revalorizacion_pct||0).toFixed(0)}%`).join('\n');
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
});
