/* ============================================================
   ANÁLISIS DE MERCADO DE SEGUNDA DIVISIÓN
   Main Script — script.js
   ============================================================ */

'use strict';

/* ============================================================
   CONSTANTS & CONFIGURATION
   ============================================================ */

const CSV_PATH = 'data/final/segunda_division_fichajes_2021_2026.csv';

/** Chart color palette */
const PALETTE = [
  '#00c896','#3b82f6','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#ec4899','#84cc16','#a78bfa',
  '#34d399','#60a5fa','#fbbf24','#f87171','#c084fc'
];

/** Position translations EN → ES */
const POS_ES = {
  'Centre-Forward':   'Delantero Cen.',
  'Centre-Back':      'Central',
  'Central Midfield': 'Mediocentro',
  'Left Winger':      'Extremo Izq.',
  'Right Winger':     'Extremo Der.',
  'Right-Back':       'Lateral Der.',
  'Left-Back':        'Lateral Izq.',
  'Goalkeeper':       'Portero',
  'Attacking Midfield':'Mediapunta',
  'Defensive Midfield':'Pivote',
  'Second Striker':   '2º Delantero',
  'Right Midfield':   'Medio Der.',
  'Left Midfield':    'Medio Izq.',
  'Striker':          'Delantero'
};

/** Nationality → Plotly country name mappings for choropleth */
const NAC_COUNTRY_MAP = {
  'Spain': 'Spain', 'Argentina': 'Argentina', 'France': 'France',
  'Portugal': 'Portugal', 'Brazil': 'Brazil', 'Uruguay': 'Uruguay',
  'Serbia': 'Serbia', 'Colombia': 'Colombia', 'Ghana': 'Ghana',
  'Morocco': 'Morocco', 'Senegal': 'Senegal', 'Germany': 'Germany',
  'Italy': 'Italy', 'Netherlands': 'Netherlands', 'Belgium': 'Belgium',
  'Croatia': 'Croatia', 'Ecuador': 'Ecuador', 'Paraguay': 'Paraguay',
  'Chile': 'Chile', 'Mexico': 'Mexico', 'Nigeria': 'Nigeria',
  'Ivory Coast': "Cote d'Ivoire", 'Mali': 'Mali', 'Guinea': 'Guinea',
  'Cameroon': 'Cameroon', 'Romania': 'Romania', 'Hungary': 'Hungary',
  'Sweden': 'Sweden', 'Norway': 'Norway', 'Denmark': 'Denmark',
  'Poland': 'Poland', 'Slovakia': 'Slovakia', 'Czech Republic': 'Czechia',
  'Austria': 'Austria', 'Switzerland': 'Switzerland', 'Turkey': 'Turkey',
  'United States': 'United States', 'Canada': 'Canada', 'Venezuela': 'Venezuela',
  'Peru': 'Peru', 'Bolivia': 'Bolivia', 'Costa Rica': 'Costa Rica',
  'Honduras': 'Honduras', 'Jamaica': 'Jamaica', 'Zimbabwe': 'Zimbabwe',
  'Zambia': 'Zambia', 'DR Congo': 'Democratic Republic of the Congo',
  'Cape Verde': 'Cabo Verde', 'Guinea-Bissau': 'Guinea-Bissau',
  'Equatorial Guinea': 'Equatorial Guinea', 'Gabon': 'Gabon',
  'Egypt': 'Egypt', 'Algeria': 'Algeria', 'Tunisia': 'Tunisia',
  'South Africa': 'South Africa', 'Mozambique': 'Mozambique',
  'Sierra Leone': 'Sierra Leone', 'Gambia': 'Gambia', 'Togo': 'Togo',
  'Slovenia': 'Slovenia', 'Finland': 'Finland', 'Ukraine': 'Ukraine',
  'Russia': 'Russia', 'Montenegro': 'Montenegro', 'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Kosovo': 'Kosovo', 'North Macedonia': 'North Macedonia', 'Albania': 'Albania',
  'Greece': 'Greece', 'Cyprus': 'Cyprus', 'Israel': 'Israel'
};

/** Base layout for all Plotly charts */
const BASE_LAYOUT = {
  paper_bgcolor: 'transparent',
  plot_bgcolor:  'transparent',
  font: { family: 'Inter, sans-serif', color: '#f1f5f9', size: 12 },
  margin: { t: 20, r: 20, b: 40, l: 50 },
  legend: { bgcolor: 'transparent', font: { color: '#94a3b8', size: 11 } },
  xaxis: {
    gridcolor: 'rgba(255,255,255,0.07)',
    zerolinecolor: 'rgba(255,255,255,0.12)',
    tickfont: { color: '#94a3b8' },
    linecolor: 'rgba(255,255,255,0.1)'
  },
  yaxis: {
    gridcolor: 'rgba(255,255,255,0.07)',
    zerolinecolor: 'rgba(255,255,255,0.12)',
    tickfont: { color: '#94a3b8' },
    linecolor: 'rgba(255,255,255,0.1)'
  }
};

const PLOTLY_CONFIG = { responsive: true, displayModeBar: true, displaylogo: false };

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/**
 * Parse monetary string like "€300k", "€1.00m", "€22,950,000" → number
 */
function parseMonetary(s) {
  if (!s || s === '-' || s === '' || s === 'null') return 0;
  s = String(s).replace('€', '').replace(',', '.').trim();
  if (/m$/i.test(s)) return parseFloat(s) * 1e6;
  if (/k$/i.test(s)) return parseFloat(s) * 1e3;
  if (/th\.?$/i.test(s)) return parseFloat(s) * 1e3;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Group array of objects by key */
function groupBy(arr, key) {
  return arr.reduce((a, r) => {
    const k = (r[key] !== undefined && r[key] !== null && r[key] !== '') ? r[key] : '?';
    (a[k] = a[k] || []).push(r);
    return a;
  }, {});
}

/** Sum numeric field */
function sumBy(arr, key) {
  return arr.reduce((a, r) => a + (+r[key] || 0), 0);
}

/** Mean of numeric field */
function meanBy(arr, key) {
  if (!arr.length) return 0;
  return sumBy(arr, key) / arr.length;
}

/** Top N entries from object {key: value} */
function topN(obj, n = 10, asc = false) {
  return Object.entries(obj)
    .sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1])
    .slice(0, n);
}

/** Format number as monetary string */
function formatM(n) {
  if (isNaN(n) || n === null || n === undefined) return '—';
  if (n >= 1e6) return `€${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(0)}k`;
  return n > 0 ? `€${Math.round(n).toLocaleString('es-ES')}` : '—';
}

/** Format large number with thousand separators */
function formatNum(n) {
  if (isNaN(n)) return '0';
  return Math.round(n).toLocaleString('es-ES');
}

/** Deep merge layout objects */
function mergeLayout(overrides) {
  return Object.assign({}, BASE_LAYOUT,
    { xaxis: Object.assign({}, BASE_LAYOUT.xaxis, overrides.xaxis || {}) },
    { yaxis: Object.assign({}, BASE_LAYOUT.yaxis, overrides.yaxis || {}) },
    overrides
  );
}

/** Debounce */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Animated count-up */
function animateCount(el, target, duration = 1000, prefix = '', suffix = '', decimals = 0) {
  const start = performance.now();
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = eased * target;
    el.textContent = prefix + value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

/** Translate position to Spanish */
function translatePos(pos) {
  return POS_ES[pos] || pos;
}

/** Safe Plotly update — purge + newPlot */
function plotlyUpdate(divId, data, layout, config) {
  const el = document.getElementById(divId);
  if (!el) return;
  Plotly.purge(el);
  Plotly.newPlot(divId, data, mergeLayout(layout || {}), config || PLOTLY_CONFIG);
}

/* ============================================================
   APPLICATION STATE
   ============================================================ */

const STATE = {
  rawData: [],      // All parsed CSV rows
  filtered: [],     // Currently filtered rows
  dtTable: null,    // DataTables instance
  dtInitialized: false,
  filters: {
    temporadas: [],
    clubs: [],
    posiciones: [],
    movimientos: ['alta', 'baja'],
    tipos: [],
    nacionalidades: [],
    edadMin: 17,
    edadMax: 41,
    importeMin: 0
  }
};

/* ============================================================
   MULTI-SELECT COMPONENT
   ============================================================ */

const MultiSelect = {
  instances: {},

  /**
   * Initialize a multi-select component
   * @param {string} id - prefix id (e.g. 'ms-temporada')
   * @param {string[]} options - list of option values
   * @param {function} onChange - callback when selection changes
   * @param {boolean} hasSearch - show search input
   */
  init(id, options, onChange, hasSearch = false) {
    const btn = document.getElementById(`${id}-btn`);
    const drop = document.getElementById(`${id}-drop`);
    const optsContainer = document.getElementById(`${id}-opts`);
    const labelEl = document.getElementById(`${id}-label`);

    if (!btn || !drop || !optsContainer) return;

    const selected = new Set(options); // all selected by default
    this.instances[id] = { options, selected, onChange, labelEl };

    // Render options
    const renderOptions = (filter = '') => {
      optsContainer.innerHTML = '';
      options
        .filter(o => !filter || o.toLowerCase().includes(filter.toLowerCase()))
        .forEach(opt => {
          const div = document.createElement('div');
          div.className = 'multi-select-option';
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.value = opt;
          chk.checked = selected.has(opt);
          chk.addEventListener('change', () => {
            if (chk.checked) selected.add(opt);
            else selected.delete(opt);
            this._updateLabel(id);
            onChange(Array.from(selected));
          });
          const span = document.createElement('span');
          span.textContent = opt;
          div.appendChild(chk);
          div.appendChild(span);
          div.addEventListener('click', (e) => { if (e.target !== chk) chk.click(); });
          optsContainer.appendChild(div);
        });
    };

    renderOptions();

    // Search
    if (hasSearch) {
      const searchInput = document.getElementById(`${id}-search`);
      if (searchInput) {
        searchInput.addEventListener('input', () => renderOptions(searchInput.value));
      }
    }

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = drop.classList.contains('open');
      // Close all others
      document.querySelectorAll('.multi-select-dropdown.open').forEach(d => {
        if (d !== drop) {
          d.classList.remove('open');
          d.previousElementSibling && d.previousElementSibling.classList.remove('open');
        }
      });
      drop.classList.toggle('open', !isOpen);
      btn.classList.toggle('open', !isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target) && !drop.contains(e.target)) {
        drop.classList.remove('open');
        btn.classList.remove('open');
      }
    });

    // Action buttons (All / None)
    drop.querySelectorAll('.multi-select-actions button').forEach(actionBtn => {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actionBtn.dataset.action === 'all') {
          options.forEach(o => selected.add(o));
        } else {
          selected.clear();
        }
        renderOptions(hasSearch ? (document.getElementById(`${id}-search`) || {}).value || '' : '');
        this._updateLabel(id);
        onChange(Array.from(selected));
      });
    });

    this._updateLabel(id);
  },

  _updateLabel(id) {
    const inst = this.instances[id];
    if (!inst) return;
    const labelEl = inst.labelEl;
    const count = inst.selected.size;
    const total = inst.options.length;
    if (!labelEl) return;
    if (count === 0) labelEl.textContent = 'Ninguno';
    else if (count === total) labelEl.textContent = 'Todos';
    else if (count <= 2) labelEl.textContent = Array.from(inst.selected).slice(0, 2).join(', ');
    else labelEl.textContent = `${count} seleccionados`;
  },

  getSelected(id) {
    const inst = this.instances[id];
    return inst ? Array.from(inst.selected) : [];
  },

  setAll(id) {
    const inst = this.instances[id];
    if (!inst) return;
    inst.options.forEach(o => inst.selected.add(o));
    this._updateLabel(id);
    // Re-render checkboxes
    const optsContainer = document.getElementById(`${id}-opts`);
    if (optsContainer) {
      optsContainer.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
    }
  }
};

/* ============================================================
   FILTER LOGIC
   ============================================================ */

function applyFilters() {
  const f = STATE.filters;
  const temSet  = new Set(f.temporadas);
  const clubSet = new Set(f.clubs);
  const posSet  = new Set(f.posiciones);
  const tipSet  = new Set(f.tipos);
  const nacSet  = new Set(f.nacionalidades);
  const movSet  = new Set(f.movimientos);

  STATE.filtered = STATE.rawData.filter(r => {
    if (temSet.size  && !temSet.has(r.temporada))      return false;
    if (clubSet.size && !clubSet.has(r.club))          return false;
    if (posSet.size  && !posSet.has(r.posicion))       return false;
    if (tipSet.size  && !tipSet.has(r.tipo_operacion)) return false;
    if (nacSet.size  && !nacSet.has(r.nacionalidad))   return false;
    if (!movSet.has(r.movimiento))                     return false;
    const edad = +r.edad || 0;
    if (edad < f.edadMin || edad > f.edadMax)          return false;
    const imp = +r.importe_numerico || 0;
    if (imp < f.importeMin)                            return false;
    return true;
  });

  document.getElementById('filtered-count').textContent = formatNum(STATE.filtered.length);

  // Count active filters (non-default)
  let activeCount = 0;
  if (f.temporadas.length !== STATE._allTemporadas.length) activeCount++;
  if (f.clubs.length !== STATE._allClubs.length) activeCount++;
  if (f.posiciones.length !== STATE._allPosiciones.length) activeCount++;
  if (f.tipos.length !== STATE._allTipos.length) activeCount++;
  if (f.nacionalidades.length !== STATE._allNacionalidades.length) activeCount++;
  if (f.movimientos.length !== 2) activeCount++;
  if (f.edadMin !== 17 || f.edadMax !== 41) activeCount++;
  if (f.importeMin > 0) activeCount++;

  const badge = document.getElementById('filter-active-count');
  badge.textContent = activeCount;
  badge.classList.toggle('visible', activeCount > 0);
}

/* ============================================================
   RENDER ALL (debounced)
   ============================================================ */

const debouncedRender = debounce(renderAll, 300);

function renderAll() {
  applyFilters();
  renderKPIs();
  renderBloque1();
  renderBloque2();
  renderBloque3();
  renderBloque4();
  renderBloque5();
  renderInsights();
  updateDataTable();
}

/* ============================================================
   KPI RENDERING
   ============================================================ */

function renderKPIs() {
  const d = STATE.filtered;

  // Total operaciones
  const totalOps = d.length;
  const elOps = document.getElementById('kpi-total-ops');
  animateCount(elOps, totalOps, 800);

  // Jugadores únicos
  const uniqueJugadores = new Set(d.map(r => r.jugador)).size;
  const elJug = document.getElementById('kpi-jugadores');
  animateCount(elJug, uniqueJugadores, 800);

  // Importe total
  const totalImporte = sumBy(d.filter(r => r.importe_numerico > 0), 'importe_numerico');
  const elImp = document.getElementById('kpi-importe');
  const impM = totalImporte / 1e6;
  animateCount(elImp, impM, 1000, '€', 'M', 2);

  // Valor medio traspasos
  const traspasos = d.filter(r => r.tipo_operacion === 'traspaso' && r.importe_numerico > 0);
  const medioTrasp = traspasos.length ? sumBy(traspasos, 'importe_numerico') / traspasos.length : 0;
  const elMed = document.getElementById('kpi-medio');
  animateCount(elMed, medioTrasp / 1e6, 900, '€', 'M', 2);
  document.getElementById('kpi-medio-d').textContent = `${traspasos.length} traspasos`;

  // Edad media
  const edadMedia = meanBy(d, 'edad');
  const elEdad = document.getElementById('kpi-edad');
  animateCount(elEdad, edadMedia, 700, '', ' años', 1);

  // Clubes únicos
  const uniqueClubs = new Set(d.map(r => r.club)).size;
  const elClubs = document.getElementById('kpi-clubes');
  animateCount(elClubs, uniqueClubs, 700);

  // Secondary stats
  document.getElementById('kpi-total-ops-d').textContent = `${new Set(d.map(r => r.temporada)).size} temporadas`;
  document.getElementById('kpi-jugadores-d').textContent = `${formatM(totalImporte / Math.max(d.length, 1))} media/op`;
  document.getElementById('kpi-importe-d').textContent = `Suma importe declarado`;
  document.getElementById('kpi-edad-d').textContent = `Rango: ${Math.min(...d.map(r => +r.edad || 99))}–${Math.max(...d.map(r => +r.edad || 0))} años`;
  document.getElementById('kpi-clubes-d').textContent = `De los 39 en total`;

  // Update header badge
  document.getElementById('header-badge').textContent = `${formatNum(totalOps)} operaciones`;
}

/* ============================================================
   BLOQUE 1 — Radiografía Económica
   ============================================================ */

function renderBloque1() {
  const d = STATE.filtered;

  // --- chart-compradores: top 10 clubs by altas spend ---
  const altas = d.filter(r => r.movimiento === 'alta' && r.importe_numerico > 0);
  const gastoPorClub = {};
  altas.forEach(r => { gastoPorClub[r.club] = (gastoPorClub[r.club] || 0) + r.importe_numerico; });
  const topCompradores = topN(gastoPorClub, 10);
  plotlyUpdate('chart-compradores',
    [{
      type: 'bar', orientation: 'h',
      x: topCompradores.map(e => e[1]),
      y: topCompradores.map(e => e[0]),
      marker: { color: PALETTE[0], opacity: 0.85 },
      text: topCompradores.map(e => formatM(e[1])),
      textposition: 'outside',
      textfont: { size: 10, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>Gasto: %{text}<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 120 },
      xaxis: { tickformat: ',.0f', title: 'Importe (€)', tickprefix: '€' },
      yaxis: { automargin: true, tickfont: { size: 11 } }
    }
  );

  // --- chart-vendedores: top 10 clubs by bajas income ---
  const bajas = d.filter(r => r.movimiento === 'baja' && r.importe_numerico > 0);
  const ingresosPorClub = {};
  bajas.forEach(r => { ingresosPorClub[r.club] = (ingresosPorClub[r.club] || 0) + r.importe_numerico; });
  const topVendedores = topN(ingresosPorClub, 10);
  plotlyUpdate('chart-vendedores',
    [{
      type: 'bar', orientation: 'h',
      x: topVendedores.map(e => e[1]),
      y: topVendedores.map(e => e[0]),
      marker: { color: PALETTE[1], opacity: 0.85 },
      text: topVendedores.map(e => formatM(e[1])),
      textposition: 'outside',
      textfont: { size: 10, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>Ingreso: %{text}<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 120 },
      xaxis: { tickformat: ',.0f', title: 'Importe (€)', tickprefix: '€' },
      yaxis: { automargin: true, tickfont: { size: 11 } }
    }
  );

  // --- chart-balance: net balance per club ---
  const allClubsSet = new Set(d.map(r => r.club));
  const balances = {};
  allClubsSet.forEach(club => {
    const ga = sumBy(d.filter(r => r.club === club && r.movimiento === 'alta' && r.importe_numerico > 0), 'importe_numerico');
    const gi = sumBy(d.filter(r => r.club === club && r.movimiento === 'baja' && r.importe_numerico > 0), 'importe_numerico');
    balances[club] = ga - gi;
  });
  const sortedBalances = Object.entries(balances).sort((a, b) => a[1] - b[1]);
  const balColors = sortedBalances.map(e => e[1] >= 0 ? '#ef4444' : '#00c896'); // red = spent more, green = earned more
  plotlyUpdate('chart-balance',
    [{
      type: 'bar', orientation: 'h',
      x: sortedBalances.map(e => e[1]),
      y: sortedBalances.map(e => e[0]),
      marker: { color: balColors, opacity: 0.85 },
      text: sortedBalances.map(e => formatM(Math.abs(e[1]))),
      textposition: 'outside',
      textfont: { size: 9, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>Balance: %{x:,.0f}€<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 140 },
      xaxis: { title: 'Balance neto (€)', tickformat: ',.0f', zeroline: true, zerolinewidth: 1, zerolinecolor: 'rgba(255,255,255,0.2)' },
      yaxis: { automargin: true, tickfont: { size: 10 } },
      height: 420
    }
  );

  // --- chart-evolucion-eco: grouped bar by season ---
  const seasons = [...new Set(d.map(r => r.temporada))].sort();
  const gastoPorTemp = seasons.map(t => sumBy(d.filter(r => r.temporada === t && r.movimiento === 'alta' && r.importe_numerico > 0), 'importe_numerico'));
  const ingPorTemp   = seasons.map(t => sumBy(d.filter(r => r.temporada === t && r.movimiento === 'baja' && r.importe_numerico > 0), 'importe_numerico'));
  plotlyUpdate('chart-evolucion-eco',
    [
      { type: 'bar', name: 'Gasto Altas', x: seasons, y: gastoPorTemp,
        marker: { color: PALETTE[0] }, hovertemplate: '%{x}<br>Gasto: €%{y:,.0f}<extra></extra>' },
      { type: 'bar', name: 'Ingresos Bajas', x: seasons, y: ingPorTemp,
        marker: { color: PALETTE[1] }, hovertemplate: '%{x}<br>Ingreso: €%{y:,.0f}<extra></extra>' }
    ],
    {
      barmode: 'group',
      xaxis: { title: 'Temporada' },
      yaxis: { title: 'Importe (€)', tickprefix: '€', tickformat: ',.0f' },
      margin: { t: 20, r: 20, b: 50, l: 80 }
    }
  );

  // --- chart-treemap: total money moved per club ---
  const movidoPorClub = {};
  d.filter(r => r.importe_numerico > 0).forEach(r => {
    movidoPorClub[r.club] = (movidoPorClub[r.club] || 0) + r.importe_numerico;
  });
  const topMovido = topN(movidoPorClub, 25);
  plotlyUpdate('chart-treemap',
    [{
      type: 'treemap',
      labels: topMovido.map(e => e[0]),
      parents: topMovido.map(() => ''),
      values: topMovido.map(e => e[1]),
      textinfo: 'label+value+percent parent',
      texttemplate: '<b>%{label}</b><br>%{customdata}',
      customdata: topMovido.map(e => formatM(e[1])),
      hovertemplate: '<b>%{label}</b><br>Total: %{customdata}<extra></extra>',
      marker: {
        colors: topMovido.map((_, i) => PALETTE[i % PALETTE.length]),
        line: { width: 1, color: 'rgba(0,0,0,0.3)' }
      }
    }],
    {
      margin: { t: 10, r: 10, b: 10, l: 10 }
    }
  );
}

/* ============================================================
   BLOQUE 2 — Análisis por Posiciones
   ============================================================ */

function renderBloque2() {
  const d = STATE.filtered;

  const byPos = groupBy(d, 'posicion');
  const posNames = Object.keys(byPos).sort((a, b) => byPos[b].length - byPos[a].length);
  const posLabels = posNames.map(translatePos);

  // --- chart-pos-dinero ---
  const posDinero = posNames.map(p => sumBy(byPos[p].filter(r => r.importe_numerico > 0), 'importe_numerico'));
  const sortedPDIdx = [...posDinero.keys()].sort((a, b) => posDinero[b] - posDinero[a]);
  plotlyUpdate('chart-pos-dinero',
    [{
      type: 'bar',
      x: sortedPDIdx.map(i => posLabels[i]),
      y: sortedPDIdx.map(i => posDinero[i]),
      marker: { color: PALETTE, opacity: 0.85 },
      text: sortedPDIdx.map(i => formatM(posDinero[i])),
      textposition: 'outside',
      textfont: { size: 9 },
      hovertemplate: '<b>%{x}</b><br>%{text}<extra></extra>'
    }],
    {
      xaxis: { tickangle: -35, tickfont: { size: 10 } },
      yaxis: { title: 'Importe (€)', tickprefix: '€', tickformat: ',.0f' },
      margin: { t: 20, r: 20, b: 100, l: 80 }
    }
  );

  // --- chart-pos-ops ---
  const posOps = posNames.map(p => byPos[p].length);
  const sortedPOIdx = [...posOps.keys()].sort((a, b) => posOps[b] - posOps[a]);
  plotlyUpdate('chart-pos-ops',
    [{
      type: 'bar',
      x: sortedPOIdx.map(i => posLabels[i]),
      y: sortedPOIdx.map(i => posOps[i]),
      marker: { color: PALETTE.slice().reverse(), opacity: 0.85 },
      text: sortedPOIdx.map(i => posOps[i]),
      textposition: 'outside',
      textfont: { size: 10 },
      hovertemplate: '<b>%{x}</b><br>Operaciones: %{y}<extra></extra>'
    }],
    {
      xaxis: { tickangle: -35, tickfont: { size: 10 } },
      yaxis: { title: 'Número de operaciones' },
      margin: { t: 20, r: 20, b: 100, l: 60 }
    }
  );

  // --- chart-pos-valor-medio ---
  const posValMed = posNames.map(p => {
    const withVal = byPos[p].filter(r => r.importe_numerico > 0);
    return withVal.length ? meanBy(withVal, 'importe_numerico') : 0;
  });
  const sortedPVMIdx = [...posValMed.keys()].sort((a, b) => posValMed[b] - posValMed[a]);
  plotlyUpdate('chart-pos-valor-medio',
    [{
      type: 'bar',
      x: sortedPVMIdx.map(i => posLabels[i]),
      y: sortedPVMIdx.map(i => posValMed[i]),
      marker: { color: '#8b5cf6', opacity: 0.85 },
      text: sortedPVMIdx.map(i => formatM(posValMed[i])),
      textposition: 'outside',
      textfont: { size: 9 },
      hovertemplate: '<b>%{x}</b><br>Media: %{text}<extra></extra>'
    }],
    {
      xaxis: { tickangle: -35, tickfont: { size: 10 } },
      yaxis: { title: 'Importe medio (€)', tickprefix: '€', tickformat: ',.0f' },
      margin: { t: 20, r: 20, b: 100, l: 80 }
    }
  );

  // --- chart-pos-boxplot ---
  const boxTraces = posNames
    .filter(p => byPos[p].filter(r => r.importe_numerico > 0).length >= 2)
    .map((p, i) => ({
      type: 'box',
      name: translatePos(p),
      y: byPos[p].filter(r => r.importe_numerico > 0).map(r => r.importe_numerico),
      marker: { color: PALETTE[i % PALETTE.length] },
      boxpoints: 'outliers',
      jitter: 0.3,
      hovertemplate: '<b>%{x}</b><br>€%{y:,.0f}<extra></extra>'
    }));
  plotlyUpdate('chart-pos-boxplot',
    boxTraces,
    {
      xaxis: { tickangle: -35, tickfont: { size: 9 } },
      yaxis: { title: 'Importe (€)', tickprefix: '€', tickformat: ',.0f' },
      margin: { t: 20, r: 20, b: 100, l: 80 },
      showlegend: false
    }
  );

  // --- chart-pos-edad-media ---
  const posEdadMedia = posNames.map(p => meanBy(byPos[p], 'edad'));
  const sortedPEIdx = [...posEdadMedia.keys()].sort((a, b) => posEdadMedia[b] - posEdadMedia[a]);
  plotlyUpdate('chart-pos-edad-media',
    [{
      type: 'bar',
      x: sortedPEIdx.map(i => posLabels[i]),
      y: sortedPEIdx.map(i => posEdadMedia[i]),
      marker: { color: '#06b6d4', opacity: 0.85 },
      text: sortedPEIdx.map(i => posEdadMedia[i].toFixed(1)),
      textposition: 'outside',
      textfont: { size: 10 },
      hovertemplate: '<b>%{x}</b><br>Edad media: %{y:.1f} años<extra></extra>'
    }],
    {
      xaxis: { tickangle: -35, tickfont: { size: 10 } },
      yaxis: { title: 'Edad media (años)', range: [18, 32] },
      margin: { t: 20, r: 20, b: 100, l: 60 }
    }
  );
}

/* ============================================================
   BLOQUE 3 — Análisis de Scouting
   ============================================================ */

function renderBloque3() {
  const d = STATE.filtered;

  // --- chart-nac-pie: donut top 12 ---
  const nacCount = {};
  d.forEach(r => { nacCount[r.nacionalidad] = (nacCount[r.nacionalidad] || 0) + 1; });
  const topNac = topN(nacCount, 12);
  const otherCount = d.length - topNac.reduce((s, e) => s + e[1], 0);
  const pieLabels = topNac.map(e => e[0]);
  const pieValues = topNac.map(e => e[1]);
  if (otherCount > 0) { pieLabels.push('Otros'); pieValues.push(otherCount); }
  plotlyUpdate('chart-nac-pie',
    [{
      type: 'pie', hole: 0.45,
      labels: pieLabels, values: pieValues,
      marker: { colors: PALETTE },
      textinfo: 'label+percent',
      textposition: 'outside',
      textfont: { size: 11 },
      hovertemplate: '<b>%{label}</b><br>%{value} jugadores (%{percent})<extra></extra>'
    }],
    {
      margin: { t: 20, r: 20, b: 20, l: 20 },
      showlegend: false
    }
  );

  // --- chart-nac-mapa: choropleth ---
  const countries = Object.keys(nacCount).map(nac => NAC_COUNTRY_MAP[nac] || nac);
  const countryCount = {};
  Object.entries(nacCount).forEach(([nac, cnt]) => {
    const mapped = NAC_COUNTRY_MAP[nac] || nac;
    countryCount[mapped] = (countryCount[mapped] || 0) + cnt;
  });
  plotlyUpdate('chart-nac-mapa',
    [{
      type: 'choropleth',
      locationmode: 'country names',
      locations: Object.keys(countryCount),
      z: Object.values(countryCount),
      colorscale: [
        [0, '#1a2235'], [0.2, '#00503c'], [0.5, '#00c896'], [1, '#7fffdf']
      ],
      autocolorscale: false,
      colorbar: {
        title: 'Jugadores',
        tickfont: { color: '#94a3b8', size: 10 },
        bgcolor: 'transparent',
        outlinewidth: 0
      },
      hovertemplate: '<b>%{location}</b><br>%{z} jugadores<extra></extra>'
    }],
    {
      geo: {
        bgcolor: 'transparent',
        showframe: false,
        showcoastlines: true,
        coastlinecolor: 'rgba(255,255,255,0.15)',
        showland: true, landcolor: 'rgba(255,255,255,0.05)',
        showocean: true, oceancolor: 'rgba(0,0,0,0.3)',
        showlakes: false,
        showcountries: true, countrycolor: 'rgba(255,255,255,0.12)',
        projection: { type: 'natural earth' }
      },
      margin: { t: 10, r: 10, b: 10, l: 10 }
    }
  );

  // --- chart-edad-scatter ---
  const tiposUniq = [...new Set(d.map(r => r.tipo_operacion))];
  const scatterTraces = tiposUniq.map((tipo, i) => {
    const rows = d.filter(r => r.tipo_operacion === tipo && r.importe_numerico > 0);
    return {
      type: 'scatter', mode: 'markers', name: tipo,
      x: rows.map(r => +r.edad || 0),
      y: rows.map(r => r.importe_numerico),
      text: rows.map(r => r.jugador),
      marker: { color: PALETTE[i % PALETTE.length], size: 6, opacity: 0.7 },
      hovertemplate: '<b>%{text}</b><br>Edad: %{x}<br>Importe: €%{y:,.0f}<extra></extra>'
    };
  });
  plotlyUpdate('chart-edad-scatter',
    scatterTraces,
    {
      xaxis: { title: 'Edad', range: [15, 45] },
      yaxis: { title: 'Importe (€)', tickprefix: '€', tickformat: ',.0f' },
      margin: { t: 20, r: 20, b: 60, l: 100 },
      hovermode: 'closest'
    }
  );

  // --- chart-top-caros: top 15 by importe ---
  const withImp = [...d].filter(r => r.importe_numerico > 0)
    .sort((a, b) => b.importe_numerico - a.importe_numerico)
    .slice(0, 15);
  plotlyUpdate('chart-top-caros',
    [{
      type: 'bar', orientation: 'h',
      x: withImp.map(r => r.importe_numerico),
      y: withImp.map(r => `${r.jugador} — ${r.club}`),
      marker: { color: PALETTE[2], opacity: 0.85 },
      text: withImp.map(r => formatM(r.importe_numerico)),
      textposition: 'outside',
      textfont: { size: 10, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>%{text}<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 220 },
      xaxis: { title: 'Importe (€)', tickprefix: '€', tickformat: ',.0f' },
      yaxis: { automargin: true, tickfont: { size: 10 } }
    }
  );

  // --- chart-top-valor: top 15 by valor_mercado ---
  const withValor = d.map(r => ({ ...r, vm: parseMonetary(r.valor_mercado) }))
    .filter(r => r.vm > 0)
    .sort((a, b) => b.vm - a.vm)
    .slice(0, 15);
  plotlyUpdate('chart-top-valor',
    [{
      type: 'bar', orientation: 'h',
      x: withValor.map(r => r.vm),
      y: withValor.map(r => `${r.jugador} — ${r.club}`),
      marker: { color: PALETTE[4], opacity: 0.85 },
      text: withValor.map(r => formatM(r.vm)),
      textposition: 'outside',
      textfont: { size: 10, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>Valor mercado: %{text}<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 220 },
      xaxis: { title: 'Valor mercado (€)', tickprefix: '€', tickformat: ',.0f' },
      yaxis: { automargin: true, tickfont: { size: 10 } }
    }
  );

  // --- chart-dist-edad: histogram ---
  plotlyUpdate('chart-dist-edad',
    [{
      type: 'histogram',
      x: d.map(r => +r.edad || 0).filter(e => e >= 15 && e <= 45),
      xbins: { size: 1 },
      marker: { color: PALETTE[0], opacity: 0.8, line: { color: 'rgba(0,0,0,0.4)', width: 1 } },
      hovertemplate: 'Edad: %{x}<br>Jugadores: %{y}<extra></extra>'
    }],
    {
      xaxis: { title: 'Edad', dtick: 2 },
      yaxis: { title: 'Nº de jugadores' },
      bargap: 0.05,
      margin: { t: 20, r: 20, b: 50, l: 60 }
    }
  );
}

/* ============================================================
   BLOQUE 4 — Análisis de Mercado
   ============================================================ */

function renderBloque4() {
  const d = STATE.filtered;

  // --- chart-tipo-ops: donut ---
  const tipoCount = {};
  d.forEach(r => { tipoCount[r.tipo_operacion] = (tipoCount[r.tipo_operacion] || 0) + 1; });
  const tipoEntries = Object.entries(tipoCount).sort((a, b) => b[1] - a[1]);
  plotlyUpdate('chart-tipo-ops',
    [{
      type: 'pie', hole: 0.45,
      labels: tipoEntries.map(e => e[0]),
      values: tipoEntries.map(e => e[1]),
      marker: { colors: PALETTE },
      textinfo: 'label+percent',
      textfont: { size: 11 },
      hovertemplate: '<b>%{label}</b><br>%{value} ops (%{percent})<extra></extra>'
    }],
    {
      margin: { t: 20, r: 20, b: 20, l: 20 },
      legend: { orientation: 'v', font: { size: 11 }, x: 1.02, xanchor: 'left' }
    }
  );

  // --- chart-evolucion-mkt: area stacked ---
  const seasons = [...new Set(d.map(r => r.temporada))].sort();
  const altasSeasons = seasons.map(t => d.filter(r => r.temporada === t && r.movimiento === 'alta').length);
  const bajasSeasons = seasons.map(t => d.filter(r => r.temporada === t && r.movimiento === 'baja').length);
  plotlyUpdate('chart-evolucion-mkt',
    [
      {
        type: 'scatter', mode: 'lines', fill: 'tozeroy', name: 'Altas',
        x: seasons, y: altasSeasons,
        line: { color: PALETTE[0], width: 2 },
        fillcolor: 'rgba(0,200,150,0.15)',
        hovertemplate: '%{x}<br>Altas: %{y}<extra></extra>'
      },
      {
        type: 'scatter', mode: 'lines', fill: 'tonexty', name: 'Bajas',
        x: seasons, y: bajasSeasons,
        line: { color: PALETTE[1], width: 2 },
        fillcolor: 'rgba(59,130,246,0.15)',
        hovertemplate: '%{x}<br>Bajas: %{y}<extra></extra>'
      }
    ],
    {
      xaxis: { title: 'Temporada' },
      yaxis: { title: 'Nº operaciones' },
      margin: { t: 20, r: 20, b: 50, l: 60 }
    }
  );

  // --- chart-clubes-ops: top 15 by count ---
  const clubOpsCount = {};
  d.forEach(r => { clubOpsCount[r.club] = (clubOpsCount[r.club] || 0) + 1; });
  const topClubOps = topN(clubOpsCount, 15);
  plotlyUpdate('chart-clubes-ops',
    [{
      type: 'bar', orientation: 'h',
      x: topClubOps.map(e => e[1]),
      y: topClubOps.map(e => e[0]),
      marker: { color: PALETTE[5], opacity: 0.85 },
      text: topClubOps.map(e => e[1]),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>%{x} operaciones<extra></extra>'
    }],
    {
      margin: { t: 20, r: 60, b: 40, l: 140 },
      xaxis: { title: 'Nº operaciones' },
      yaxis: { automargin: true, tickfont: { size: 11 } }
    }
  );

  // --- chart-heatmap-club: top 20 clubs × position ---
  const top20clubs = topN(clubOpsCount, 20).map(e => e[0]);
  const allPos = [...new Set(d.map(r => r.posicion))].sort();
  const heatMatrix = top20clubs.map(club =>
    allPos.map(pos => d.filter(r => r.club === club && r.posicion === pos).length)
  );
  plotlyUpdate('chart-heatmap-club',
    [{
      type: 'heatmap',
      z: heatMatrix,
      x: allPos.map(translatePos),
      y: top20clubs,
      colorscale: 'Teal',
      hovertemplate: 'Club: <b>%{y}</b><br>Pos: <b>%{x}</b><br>Ops: %{z}<extra></extra>',
      colorbar: { tickfont: { color: '#94a3b8', size: 10 }, bgcolor: 'transparent', outlinewidth: 0 }
    }],
    {
      margin: { t: 20, r: 80, b: 120, l: 140 },
      xaxis: { tickangle: -40, tickfont: { size: 9 }, automargin: true },
      yaxis: { tickfont: { size: 10 }, automargin: true }
    }
  );

  // --- chart-heatmap-season: season × position ---
  const heatMatrixSeason = seasons.map(t =>
    allPos.map(pos => d.filter(r => r.temporada === t && r.posicion === pos).length)
  );
  plotlyUpdate('chart-heatmap-season',
    [{
      type: 'heatmap',
      z: heatMatrixSeason,
      x: allPos.map(translatePos),
      y: seasons,
      colorscale: 'Blues',
      hovertemplate: 'Temporada: <b>%{y}</b><br>Pos: <b>%{x}</b><br>Ops: %{z}<extra></extra>',
      colorbar: { tickfont: { color: '#94a3b8', size: 10 }, bgcolor: 'transparent', outlinewidth: 0 }
    }],
    {
      margin: { t: 20, r: 80, b: 120, l: 80 },
      xaxis: { tickangle: -40, tickfont: { size: 9 }, automargin: true },
      yaxis: { tickfont: { size: 11 } }
    }
  );
}

/* ============================================================
   BLOQUE 5 — Análisis Avanzado
   ============================================================ */

function renderBloque5() {
  const d = STATE.filtered;

  // ---- SANKEY ----
  renderSankey(d);

  // ---- SUNBURST ----
  const posGroups = groupBy(d, 'posicion');
  const sunIds = ['Total'];
  const sunParents = [''];
  const sunValues = [d.length];
  const sunColors = ['rgba(0,0,0,0)'];

  Object.entries(posGroups).forEach(([pos, rows], pi) => {
    const posLabel = translatePos(pos);
    sunIds.push(posLabel);
    sunParents.push('Total');
    sunValues.push(rows.length);
    sunColors.push(PALETTE[pi % PALETTE.length]);

    const tiposInPos = groupBy(rows, 'tipo_operacion');
    Object.entries(tiposInPos).forEach(([tipo, tRows]) => {
      const uid = `${posLabel}|${tipo}`;
      sunIds.push(uid);
      sunParents.push(posLabel);
      sunValues.push(tRows.length);
      sunColors.push(PALETTE[pi % PALETTE.length] + '99'); // semi-transparent
    });
  });

  plotlyUpdate('chart-sunburst',
    [{
      type: 'sunburst',
      ids: sunIds,
      labels: sunIds.map(id => id.includes('|') ? id.split('|')[1] : id),
      parents: sunParents,
      values: sunValues,
      marker: { colors: sunColors, line: { width: 0.5, color: 'rgba(0,0,0,0.3)' } },
      branchvalues: 'total',
      hovertemplate: '<b>%{label}</b><br>Ops: %{value}<extra></extra>',
      textfont: { size: 10 }
    }],
    {
      margin: { t: 10, r: 10, b: 10, l: 10 }
    }
  );

  // ---- RANKING ACTIVIDAD ----
  const clubSeasons = {};
  const clubTotalOps = {};
  d.forEach(r => {
    if (!clubSeasons[r.club]) clubSeasons[r.club] = new Set();
    clubSeasons[r.club].add(r.temporada);
    clubTotalOps[r.club] = (clubTotalOps[r.club] || 0) + 1;
  });
  const actividadMedia = {};
  Object.keys(clubTotalOps).forEach(club => {
    actividadMedia[club] = clubTotalOps[club] / (clubSeasons[club].size || 1);
  });
  const topActiv = topN(actividadMedia, 20);
  plotlyUpdate('chart-ranking-actividad',
    [{
      type: 'bar', orientation: 'h',
      x: topActiv.map(e => e[1]).reverse(),
      y: topActiv.map(e => e[0]).reverse(),
      marker: { color: PALETTE[6], opacity: 0.85 },
      text: topActiv.map(e => e[1].toFixed(1)).reverse(),
      textposition: 'outside',
      textfont: { size: 10 },
      hovertemplate: '<b>%{y}</b><br>Media: %{x:.1f} ops/temp<extra></extra>'
    }],
    {
      margin: { t: 20, r: 60, b: 40, l: 140 },
      xaxis: { title: 'Ops medias / temporada' },
      yaxis: { automargin: true, tickfont: { size: 10 } }
    }
  );

  // ---- RANKING EFICIENCIA ----
  const allClubsEf = [...new Set(d.map(r => r.club))];
  const eficiencia = {};
  allClubsEf.forEach(club => {
    const cRows = d.filter(r => r.club === club);
    const gasto   = sumBy(cRows.filter(r => r.movimiento === 'alta' && r.importe_numerico > 0), 'importe_numerico');
    const ingreso = sumBy(cRows.filter(r => r.movimiento === 'baja' && r.importe_numerico > 0), 'importe_numerico');
    const balance = ingreso - gasto;
    eficiencia[club] = cRows.length > 0 ? balance / cRows.length : 0;
  });
  const topEf = topN(eficiencia, 20);
  const efColors = topEf.map(e => e[1] >= 0 ? '#00c896' : '#ef4444');
  plotlyUpdate('chart-ranking-eficiencia',
    [{
      type: 'bar', orientation: 'h',
      x: topEf.map(e => e[1]).reverse(),
      y: topEf.map(e => e[0]).reverse(),
      marker: { color: efColors.reverse(), opacity: 0.85 },
      text: topEf.map(e => formatM(Math.abs(e[1]))).reverse(),
      textposition: 'outside',
      textfont: { size: 9, color: '#94a3b8' },
      hovertemplate: '<b>%{y}</b><br>Balance/op: €%{x:,.0f}<extra></extra>'
    }],
    {
      margin: { t: 20, r: 90, b: 40, l: 140 },
      xaxis: { title: 'Balance neto por operación (€)', zeroline: true, zerolinewidth: 1, zerolinecolor: 'rgba(255,255,255,0.2)' },
      yaxis: { automargin: true, tickfont: { size: 10 } }
    }
  );

  // ---- HEATMAP ACTIVOS TEMPORADA ----
  const seasons = [...new Set(d.map(r => r.temporada))].sort();
  const top20ClubsAct = topN(clubTotalOps, 20).map(e => e[0]);
  const heatActivos = seasons.map(t =>
    top20ClubsAct.map(club => d.filter(r => r.temporada === t && r.club === club).length)
  );
  plotlyUpdate('chart-activos-temporada',
    [{
      type: 'heatmap',
      z: heatActivos,
      x: top20ClubsAct,
      y: seasons,
      colorscale: [
        [0, '#0c0f1e'], [0.2, '#00503c'], [0.6, '#00c896'], [1, '#7fffdf']
      ],
      hovertemplate: 'Club: <b>%{x}</b><br>Temp: <b>%{y}</b><br>Ops: %{z}<extra></extra>',
      colorbar: { tickfont: { color: '#94a3b8', size: 10 }, bgcolor: 'transparent', outlinewidth: 0 }
    }],
    {
      margin: { t: 20, r: 80, b: 120, l: 80 },
      xaxis: { tickangle: -40, tickfont: { size: 9 }, automargin: true },
      yaxis: { tickfont: { size: 11 } }
    }
  );
}

/** Render Sankey separately (complex logic) */
function renderSankey(d) {
  const sankeyDiv = document.getElementById('chart-sankey');
  if (!sankeyDiv) return;

  // Only altas with importe_numerico > 0 and known clubs
  const flows = d.filter(r =>
    r.movimiento === 'alta' &&
    r.importe_numerico > 0 &&
    r.club_origen && r.club_origen !== '-' && r.club_origen !== '?' &&
    r.club_destino && r.club_destino !== '-' && r.club_destino !== '?' &&
    r.club_origen !== r.club_destino
  );

  // Aggregate flows
  const flowMap = {};
  flows.forEach(r => {
    const key = `${r.club_origen}|||${r.club_destino}`;
    flowMap[key] = (flowMap[key] || 0) + r.importe_numerico;
  });

  const topFlows = Object.entries(flowMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (topFlows.length < 3) {
    Plotly.purge(sankeyDiv);
    sankeyDiv.innerHTML = `
      <div style="height:400px; display:flex; align-items:center; justify-content:center;
           color:#64748b; font-size:14px; border:1px dashed rgba(255,255,255,0.1); border-radius:8px;">
        ⚠️ No hay datos suficientes para mostrar el diagrama Sankey con los filtros actuales.
      </div>`;
    return;
  }

  // Build node list
  const nodeSet = new Set();
  topFlows.forEach(([key]) => {
    const [src, tgt] = key.split('|||');
    nodeSet.add(src); nodeSet.add(tgt);
  });
  const nodes = [...nodeSet];
  const nodeIdx = {};
  nodes.forEach((n, i) => nodeIdx[n] = i);

  const sources = topFlows.map(([key]) => nodeIdx[key.split('|||')[0]]);
  const targets = topFlows.map(([key]) => nodeIdx[key.split('|||')[1]]);
  const values  = topFlows.map(([, v]) => v);

  Plotly.purge(sankeyDiv);
  Plotly.newPlot(sankeyDiv,
    [{
      type: 'sankey',
      orientation: 'h',
      node: {
        pad: 15, thickness: 20, line: { color: 'rgba(0,0,0,0.3)', width: 0.5 },
        label: nodes,
        color: nodes.map((_, i) => PALETTE[i % PALETTE.length]),
        hoverlabel: { bgcolor: '#1a2235', bordercolor: 'rgba(0,200,150,0.5)', font: { family: 'Inter', color: '#f1f5f9' } }
      },
      link: {
        source: sources, target: targets, value: values,
        color: sources.map(s => PALETTE[s % PALETTE.length] + '55'),
        customdata: values.map(v => formatM(v)),
        hovertemplate: '<b>%{source.label}</b> → <b>%{target.label}</b><br>%{customdata}<extra></extra>'
      }
    }],
    mergeLayout({
      margin: { t: 20, r: 20, b: 20, l: 20 },
      font: { size: 10, color: '#94a3b8' }
    }),
    PLOTLY_CONFIG
  );
}

/* ============================================================
   INSIGHTS PANEL
   ============================================================ */

function renderInsights() {
  const d = STATE.filtered;
  const container = document.getElementById('insights-grid');
  if (!container) return;

  if (d.length === 0) {
    container.innerHTML = '<p style="color:var(--muted); grid-column:1/-1;">No hay datos con los filtros actuales.</p>';
    return;
  }

  const insights = [];

  // 1. Club que más gastó
  const gastoPorClub = {};
  d.filter(r => r.movimiento === 'alta' && r.importe_numerico > 0).forEach(r => {
    gastoPorClub[r.club] = (gastoPorClub[r.club] || 0) + r.importe_numerico;
  });
  const topGastor = topN(gastoPorClub, 1)[0];
  insights.push({
    icon: '🏆', label: 'Mayor Inversor',
    value: topGastor ? topGastor[0] : '—',
    mini: topGastor ? formatM(topGastor[1]) + ' en altas' : ''
  });

  // 2. Club que más ingresó
  const ingresosPorClub = {};
  d.filter(r => r.movimiento === 'baja' && r.importe_numerico > 0).forEach(r => {
    ingresosPorClub[r.club] = (ingresosPorClub[r.club] || 0) + r.importe_numerico;
  });
  const topVendedor = topN(ingresosPorClub, 1)[0];
  insights.push({
    icon: '💸', label: 'Mayor Vendedor',
    value: topVendedor ? topVendedor[0] : '—',
    mini: topVendedor ? formatM(topVendedor[1]) + ' en bajas' : ''
  });

  // 3. Balance neto más positivo (mejor gestor — ingresó más de lo que gastó)
  const balanceNet = {};
  const allClubs = [...new Set(d.map(r => r.club))];
  allClubs.forEach(club => {
    const ga = sumBy(d.filter(r => r.club === club && r.movimiento === 'alta' && r.importe_numerico > 0), 'importe_numerico');
    const gi = sumBy(d.filter(r => r.club === club && r.movimiento === 'baja' && r.importe_numerico > 0), 'importe_numerico');
    balanceNet[club] = gi - ga;
  });
  const topBalance = topN(balanceNet, 1)[0];
  insights.push({
    icon: '📈', label: 'Mejor Balance Neto',
    value: topBalance ? topBalance[0] : '—',
    mini: topBalance ? formatM(topBalance[1]) + ' superávit' : ''
  });

  // 4. Posición más demandada
  const posCounts = {};
  d.forEach(r => { posCounts[r.posicion] = (posCounts[r.posicion] || 0) + 1; });
  const topPos = topN(posCounts, 1)[0];
  insights.push({
    icon: '⚽', label: 'Posición más Demandada',
    value: topPos ? translatePos(topPos[0]) : '—',
    mini: topPos ? `${formatNum(topPos[1])} operaciones` : ''
  });

  // 5. Fichaje más caro
  const caros = d.filter(r => r.importe_numerico > 0).sort((a, b) => b.importe_numerico - a.importe_numerico);
  const topCaro = caros[0];
  insights.push({
    icon: '💰', label: 'Fichaje más Caro',
    value: topCaro ? topCaro.jugador : '—',
    mini: topCaro ? `${formatM(topCaro.importe_numerico)} · ${topCaro.club}` : ''
  });

  // 6. Temporada más activa
  const tempCounts = {};
  d.forEach(r => { tempCounts[r.temporada] = (tempCounts[r.temporada] || 0) + 1; });
  const topTemp = topN(tempCounts, 1)[0];
  insights.push({
    icon: '📅', label: 'Temporada más Activa',
    value: topTemp ? topTemp[0] : '—',
    mini: topTemp ? `${formatNum(topTemp[1])} operaciones` : ''
  });

  // 7. Jugador con mayor valor de mercado
  const topValor = d.map(r => ({ ...r, vm: parseMonetary(r.valor_mercado) }))
    .filter(r => r.vm > 0)
    .sort((a, b) => b.vm - a.vm)[0];
  insights.push({
    icon: '⭐', label: 'Mayor Valor de Mercado',
    value: topValor ? topValor.jugador : '—',
    mini: topValor ? `${formatM(topValor.vm)} · ${topValor.club}` : ''
  });

  // 8. Nacionalidad más frecuente
  const nacCounts = {};
  d.forEach(r => { nacCounts[r.nacionalidad] = (nacCounts[r.nacionalidad] || 0) + 1; });
  const topNacI = topN(nacCounts, 1)[0];
  insights.push({
    icon: '🌍', label: 'Nac. más Frecuente',
    value: topNacI ? topNacI[0] : '—',
    mini: topNacI ? `${formatNum(topNacI[1])} jugadores` : ''
  });

  container.innerHTML = insights.map(ins => `
    <div class="insight-card">
      <div class="insight-icon-wrap">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-label">${ins.label}</div>
        <div class="insight-value" title="${ins.value}">${ins.value}</div>
        <div class="insight-mini">${ins.mini}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   DATATABLE
   ============================================================ */

function initDataTable() {
  if (STATE.dtInitialized) return;

  STATE.dtTable = $('#main-table').DataTable({
    data: [],
    columns: [
      { data: 'temporada' },
      { data: 'jugador' },
      { data: 'club' },
      {
        data: 'movimiento',
        render: (data) => {
          const cls = data === 'alta' ? 'badge-alta' : 'badge-baja';
          return `<span class="badge ${cls}">${data}</span>`;
        }
      },
      { data: 'club_origen', defaultContent: '—' },
      { data: 'club_destino', defaultContent: '—' },
      { data: 'posicion', render: (d) => translatePos(d) },
      { data: 'edad' },
      { data: 'nacionalidad' },
      { data: 'importe_original', defaultContent: '—' },
      {
        data: 'importe_numerico',
        render: (data) => data > 0 ? `€${formatNum(data)}` : '—',
        className: 'text-right'
      }
    ],
    pageLength: 25,
    lengthMenu: [10, 25, 50, 100],
    dom: 'Bfrtip',
    buttons: [
      { extend: 'csvHtml5', text: '⬇ CSV', className: 'dt-button', filename: 'segunda_division_fichajes' },
      { extend: 'excelHtml5', text: '⬇ Excel', className: 'dt-button', filename: 'segunda_division_fichajes' }
    ],
    language: {
      url: '',
      search: 'Buscar:',
      lengthMenu: 'Mostrar _MENU_ registros',
      info: 'Mostrando _START_ - _END_ de _TOTAL_ registros',
      infoFiltered: '(filtrado de _MAX_ total)',
      paginate: { first: '«', last: '»', next: '›', previous: '‹' },
      zeroRecords: 'No se encontraron resultados',
      emptyTable: 'Sin datos disponibles'
    },
    order: [[0, 'asc']],
    scrollX: false,
    autoWidth: false
  });

  // Move buttons to custom area
  const buttonsEl = $('.dt-buttons').detach();
  $('#dt-buttons-area').append(buttonsEl);

  STATE.dtInitialized = true;
}

function updateDataTable() {
  if (!STATE.dtInitialized) {
    initDataTable();
  }
  if (STATE.dtTable) {
    STATE.dtTable.clear();
    STATE.dtTable.rows.add(STATE.filtered);
    STATE.dtTable.draw();
  }
}

/* ============================================================
   FILTER UI INITIALIZATION
   ============================================================ */

function initFilters() {
  const raw = STATE.rawData;

  // Extract unique values
  STATE._allTemporadas   = [...new Set(raw.map(r => r.temporada))].sort();
  STATE._allClubs        = [...new Set(raw.map(r => r.club))].sort();
  STATE._allPosiciones   = [...new Set(raw.map(r => r.posicion))].sort();
  STATE._allTipos        = [...new Set(raw.map(r => r.tipo_operacion))].sort();
  STATE._allNacionalidades = [...new Set(raw.map(r => r.nacionalidad))].sort();

  // Set defaults
  STATE.filters.temporadas    = [...STATE._allTemporadas];
  STATE.filters.clubs         = [...STATE._allClubs];
  STATE.filters.posiciones    = [...STATE._allPosiciones];
  STATE.filters.tipos         = [...STATE._allTipos];
  STATE.filters.nacionalidades = [...STATE._allNacionalidades];

  document.getElementById('total-count').textContent = formatNum(raw.length);

  // Init multi-selects
  MultiSelect.init('ms-temporada', STATE._allTemporadas, (sel) => {
    STATE.filters.temporadas = sel; debouncedRender();
  });
  MultiSelect.init('ms-club', STATE._allClubs, (sel) => {
    STATE.filters.clubs = sel; debouncedRender();
  }, true);
  MultiSelect.init('ms-posicion', STATE._allPosiciones, (sel) => {
    STATE.filters.posiciones = sel; debouncedRender();
  });
  MultiSelect.init('ms-tipo', STATE._allTipos, (sel) => {
    STATE.filters.tipos = sel; debouncedRender();
  });
  MultiSelect.init('ms-nac', STATE._allNacionalidades, (sel) => {
    STATE.filters.nacionalidades = sel; debouncedRender();
  }, true);

  // Movimiento checkboxes
  const cbAlta = document.getElementById('cb-alta');
  const cbBaja = document.getElementById('cb-baja');
  const updateMov = () => {
    const movs = [];
    if (cbAlta.checked) movs.push('alta');
    if (cbBaja.checked) movs.push('baja');
    STATE.filters.movimientos = movs;
    debouncedRender();
  };
  cbAlta.addEventListener('change', updateMov);
  cbBaja.addEventListener('change', updateMov);

  // Edad
  const edadMinEl = document.getElementById('edad-min');
  const edadMaxEl = document.getElementById('edad-max');
  const updateEdad = debounce(() => {
    STATE.filters.edadMin = parseInt(edadMinEl.value) || 17;
    STATE.filters.edadMax = parseInt(edadMaxEl.value) || 41;
    debouncedRender();
  }, 200);
  edadMinEl.addEventListener('input', updateEdad);
  edadMaxEl.addEventListener('input', updateEdad);

  // Importe mínimo
  const importeMinEl = document.getElementById('importe-min');
  const updateImporte = debounce(() => {
    STATE.filters.importeMin = parseFloat(importeMinEl.value) || 0;
    debouncedRender();
  }, 300);
  importeMinEl.addEventListener('input', updateImporte);

  // Filter panel toggle
  const filterToggleBtn = document.getElementById('filter-toggle-btn');
  const filterBody      = document.getElementById('filter-body');
  const filterChevron   = document.getElementById('filter-chevron');
  filterToggleBtn.addEventListener('click', () => {
    const isOpen = filterBody.classList.contains('open');
    filterBody.classList.toggle('open', !isOpen);
    filterChevron.classList.toggle('open', !isOpen);
  });
  // Open by default
  filterBody.classList.add('open');
  filterChevron.classList.add('open');

  // Reset button
  document.getElementById('btn-reset').addEventListener('click', resetFilters);
}

function resetFilters() {
  STATE.filters.temporadas    = [...STATE._allTemporadas];
  STATE.filters.clubs         = [...STATE._allClubs];
  STATE.filters.posiciones    = [...STATE._allPosiciones];
  STATE.filters.tipos         = [...STATE._allTipos];
  STATE.filters.nacionalidades = [...STATE._allNacionalidades];
  STATE.filters.movimientos   = ['alta', 'baja'];
  STATE.filters.edadMin       = 17;
  STATE.filters.edadMax       = 41;
  STATE.filters.importeMin    = 0;

  // Reset UI
  ['ms-temporada','ms-club','ms-posicion','ms-tipo','ms-nac'].forEach(id => MultiSelect.setAll(id));
  document.getElementById('cb-alta').checked = true;
  document.getElementById('cb-baja').checked = true;
  document.getElementById('edad-min').value = 17;
  document.getElementById('edad-max').value = 41;
  document.getElementById('importe-min').value = 0;

  debouncedRender();
}

/* ============================================================
   SIDEBAR SCROLL SPY
   ============================================================ */

function initScrollSpy() {
  const sections = ['sec-kpis','sec-bloque1','sec-bloque2','sec-bloque3','sec-bloque4','sec-bloque5','sec-insights','sec-tabla'];

  const navItems = document.querySelectorAll('.nav-item');

  // Click handler
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.dataset.target;
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Scroll spy
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(item => {
          item.classList.toggle('active', item.dataset.target === id);
        });
      }
    });
  }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

/* ============================================================
   DATA LOADING
   ============================================================ */

/**
 * Parse a CSV row — coerce types
 */
function parseRow(row) {
  return {
    temporada:        (row.temporada || '').trim(),
    club:             (row.club || '').trim(),
    jugador:          (row.jugador || '').trim(),
    movimiento:       (row.movimiento || '').trim().toLowerCase(),
    club_origen:      (row.club_origen || '').trim(),
    club_destino:     (row.club_destino || '').trim(),
    pais_club:        (row.pais_club || '').trim(),
    fecha:            (row.fecha || '').trim(),
    importe_original: (row.importe_original || '').trim(),
    importe_numerico: parseFloat(row.importe_numerico) || 0,
    tipo_operacion:   (row.tipo_operacion || '').trim().toLowerCase(),
    valor_mercado:    (row.valor_mercado || '').trim(),
    posicion:         (row.posicion || '').trim(),
    edad:             parseInt(row.edad) || 0,
    nacionalidad:     (row.nacionalidad || '').trim()
  };
}

/**
 * Load CSV via PapaParse HTTP download
 */
function loadCSV() {
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (!results.data || results.data.length === 0) {
        showFileFallback();
        return;
      }
      STATE.rawData = results.data.map(parseRow);
      onDataLoaded();
    },
    error: (err) => {
      console.warn('PapaParse fetch error:', err);
      showFileFallback();
    }
  });
}

function showFileFallback() {
  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('file-fallback').classList.add('visible');

  document.getElementById('csv-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('file-fallback').classList.remove('visible');
    document.getElementById('loading-overlay').classList.remove('hidden');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        STATE.rawData = results.data.map(parseRow);
        onDataLoaded();
      },
      error: (err) => {
        console.error('PapaParse file error:', err);
        document.getElementById('loading-overlay').querySelector('.loading-text').textContent =
          'Error al procesar el archivo. Comprueba que sea el CSV correcto.';
      }
    });
  });
}

function onDataLoaded() {
  initFilters();
  initScrollSpy();
  initDataTable();
  renderAll();

  // Hide loading overlay with fade
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 400);
}

/* ============================================================
   ENTRY POINT
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  loadCSV();
});
