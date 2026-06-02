/* ============================================================
   ANÁLISIS DE MERCADO DE SEGUNDA DIVISIÓN
   Main Script — script.js
   ============================================================ */

'use strict';

/* ===================== CONSTANTS ===================== */
const CHART_COLORS = ['#009a44','#1d6fa4','#e07b39','#8b5cf6','#d4a017','#0891b2','#be185d','#059669','#7c3aed','#b45309'];

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

function layout(overrides) {
  return Object.assign({}, BASE_LAYOUT, overrides,
    overrides.xaxis ? { xaxis: Object.assign({}, BASE_LAYOUT.xaxis, overrides.xaxis) } : {},
    overrides.yaxis ? { yaxis: Object.assign({}, BASE_LAYOUT.yaxis, overrides.yaxis) } : {}
  );
}

function plot(id, data, layoutOverrides, config = {}) {
  try {
    Plotly.purge(id);
    Plotly.newPlot(id, data, layout(layoutOverrides), Object.assign({ responsive: true, displayModeBar: false }, config));
  } catch(e) { console.warn('plot error', id, e); }
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

  Papa.parse('data/final/segunda_division_fichajes_2021_2026.csv', {
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

  Papa.parse('data/final/revalorizacion.csv', {
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
  populateFilters();
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
}

/* ===================== TAB SWITCHING ===================== */
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

  currentTab = tabId;
  renderCurrentTab();
}

function renderCurrentTab() {
  if (ALL_DATA.length === 0 && currentTab !== 'tab-inicio') return;

  switch (currentTab) {
    case 'tab-inicio':       renderInicioTab(); break;
    case 'tab-mercado':      if (!chartsRendered['tab-mercado']) { renderMercadoTab(); chartsRendered['tab-mercado'] = true; } break;
    case 'tab-clubes':       if (!chartsRendered['tab-clubes']) { renderClubesTab(); chartsRendered['tab-clubes'] = true; } break;
    case 'tab-posiciones':   if (!chartsRendered['tab-posiciones']) { renderPosicionesTab(); chartsRendered['tab-posiciones'] = true; } break;
    case 'tab-jugadores':    if (!chartsRendered['tab-jugadores']) { renderJugadoresTab(); chartsRendered['tab-jugadores'] = true; } break;
    case 'tab-revalorizacion': if (!chartsRendered['tab-revalorizacion']) { renderRevalorizacionTab(); chartsRendered['tab-revalorizacion'] = true; } break;
    case 'tab-temporadas':   renderTemporadasTab(); break;
    case 'tab-sub23':        renderSub23Tab(); break;
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
  const season = document.getElementById('jug-season').value;
  const club = document.getElementById('jug-club').value;
  const pos = document.getElementById('jug-pos').value;
  return ALL_DATA.filter(d =>
    (season === 'all' || d.temporada === season) &&
    (club === 'all' || d.club === club) &&
    (pos === 'all' || d.posicion === pos)
  );
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

  // Top revalorized
  if (REV_DATA.length) {
    const topRev = [...REV_DATA].sort((a, b) => (b.revalorizacion_pct||0) - (a.revalorizacion_pct||0))[0];
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
    yaxis: { title: 'Millones €', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    xaxis: { gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
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
    yaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    xaxis: { gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' }
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
  container.innerHTML = `
    <div style="padding:8px 0">
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">
        TOP 15 CLUBES POR DINERO TOTAL MOVIDO
      </div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
}

function renderSankey(data) {
  const flows = data.filter(d => d.movimiento === 'alta' && d.importe_numerico > 0 && d.club_origen && d.club);
  const flowMap = {};
  flows.forEach(d => {
    const key = `${d.club_origen}|||${d.club}`;
    flowMap[key] = (flowMap[key] || 0) + d.importe_numerico;
  });

  const sorted = Object.entries(flowMap).sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (sorted.length === 0) return;

  const nodeSet = new Set();
  sorted.forEach(([key]) => { const [o, d] = key.split('|||'); nodeSet.add(o); nodeSet.add(d); });
  const nodes = [...nodeSet];
  const nodeIndex = Object.fromEntries(nodes.map((n, i) => [n, i]));

  const sources = sorted.map(([k]) => nodeIndex[k.split('|||')[0]]);
  const targets = sorted.map(([k]) => nodeIndex[k.split('|||')[1]]);
  const values = sorted.map(([,v]) => v / 1e6);

  plot('chart-sankey', [
    {
      type: 'sankey',
      orientation: 'h',
      node: {
        pad: 12, thickness: 20,
        label: nodes,
        color: nodes.map(() => '#009a44')
      },
      link: {
        source: sources, target: targets, value: values,
        color: sources.map(() => 'rgba(0,154,68,0.25)'),
        hovertemplate: '%{source.label} → %{target.label}: €%{value:.2f}M<extra></extra>'
      }
    }
  ], {
    margin: { t: 20, r: 30, b: 20, l: 30 },
    font: { size: 10, color: '#1a2332' }
  });
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
  if (REV_DATA.length === 0) {
    document.getElementById('rev-kpi-pares').textContent = 'N/D';
    return;
  }

  const positives = REV_DATA.filter(d => (+d.revalorizacion_abs || 0) > 0);

  document.getElementById('rev-kpi-pares').textContent = fmt(REV_DATA.length);
  document.getElementById('rev-kpi-pos').textContent = fmt(positives.length);
  document.getElementById('rev-kpi-total').textContent = formatM(sumBy(positives, 'revalorizacion_abs'));
  const meanPct = meanBy(positives.filter(d => d.revalorizacion_pct != null), 'revalorizacion_pct');
  document.getElementById('rev-kpi-media').textContent = `+${meanPct.toFixed(0)}%`;

  renderRevClubes();
  renderRevClubesMedia();
  renderRevJugadores();
  renderRevPos();
  renderRevEdad();
  renderRevTemporada();
  renderRevNac();
  renderRevROI();
  renderRevTable();
}

function renderRevClubes() {
  const byClub = groupBy(REV_DATA, 'club');
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

function renderRevClubesMedia() {
  const byClub = groupBy(REV_DATA.filter(d => d.revalorizacion_pct != null), 'club');
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

function renderRevJugadores() {
  const sorted = [...REV_DATA].sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0,15);
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

function renderRevPos() {
  const byPos = groupBy(REV_DATA, 'posicion');
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

function renderRevEdad() {
  const data = REV_DATA.filter(d => d.edad_llegada && d.revalorizacion_pct != null);
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

function renderRevTemporada() {
  const byTemp = groupBy(REV_DATA.filter(d => d.temporada_salida), 'temporada_salida');
  const seasons = Object.keys(byTemp).sort();
  const vals = seasons.map(s => sumBy(byTemp[s],'revalorizacion_abs') / 1e6);

  plot('chart-rev-temporada', [
    { x: seasons, y: vals, type: 'bar',
      marker: { color: vals.map(v => v >= 0 ? CHART_COLORS[0] : '#dc2626') },
      text: vals.map(v => `€${v.toFixed(1)}M`), textposition: 'outside', textfont: { size: 10 },
      hovertemplate: '%{x}: €%{y:.2f}M<extra></extra>' }
  ], {
    xaxis: { title: 'Temporada salida', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    yaxis: { title: 'Revalorización (M€)', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
    margin: { t: 40, r: 20, b: 60, l: 70 }
  });
}

function renderRevNac() {
  const byNac = groupBy(REV_DATA.filter(d => d.revalorizacion_pct != null), 'nacionalidad');
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

function renderRevROI() {
  const data = REV_DATA.filter(d => (+d.vm_llegada||0) > 0);
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

function renderRevTable() {
  const sorted = [...REV_DATA].sort((a,b) => (+b.revalorizacion_abs||0) - (+a.revalorizacion_abs||0)).slice(0,20);
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
      yaxis: { title: 'Operaciones', gridcolor: '#e5e7eb', linecolor: '#e5e7eb', zerolinecolor: '#e5e7eb' },
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

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
});
