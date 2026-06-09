/* campograma.js — Campograma RBB
   Lee jugadores desde Excel OneDrive/SharePoint, los muestra en un campo táctico.
   Se inicializa la primera vez que se hace clic en la pestaña. */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────────
  // El Excel se descarga a través del proxy de Render para evitar bloqueos CORS.
  // El proxy cachea el archivo 30 min y lo sirve con los headers correctos.
  const EXCEL_URL  = 'https://segunda-division-dashboard.onrender.com/excel-bbdd';
  const REFRESH_MS = 30 * 60 * 1000;
  const TOP_N = 8;

  // ── State ─────────────────────────────────────────────────────────────────────
  let _all = [];
  let _refreshTimer = null;
  let _filters = emptyFilters();

  function emptyFilters() {
    return {
      procedencia: '',
      liga: '',
      yearMin: 0,
      yearMax: 9999,
      rendimiento: new Set(),
      proyeccion:  new Set(),
      ojeador:     new Set(),
      contexto:    new Set(),
      finContrato: null,
    };
  }

  // ── Position classification ───────────────────────────────────────────────────
  const _norm = s =>
    (s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim();

  // Rules checked in order; first match wins.
  // Each entry: [zone, [...substrings that trigger this zone]]
  // Pad with spaces so 'li' doesn't match 'delantero' etc.
  const ZONE_RULES = [
    ['EI',  ['extremo izquierdo', 'extremo izq', 'ei ', ' xi ', 'ala izquierda', 'ala izq', 'carrilero izq']],
    ['ED',  ['extremo derecho', 'extremo der', 'extremo dcho', ' ed ', ' xd ', 'ala derecha', 'ala der', 'carrilero der']],
    ['LI',  ['lateral izquierdo', 'lateral izq', ' li ', 'carrilero izquierdo']],
    ['LD',  ['lateral derecho', 'lateral der', 'lateral dcho', ' ld ', 'carrilero derecho']],
    ['DC',  ['delantero centro', 'delantero', ' dc ', 'punta', 'ariete', 'centro delantero', '9 ']],
    ['MP',  ['mediapunta', 'media punta', ' mp ', ' mco', 'segunda punta', 'enganche', 'ofensivo', 'trequartista']],
    ['MC',  ['mediocentro', 'centrocampista', ' mc ', 'pivote', ' mcd', 'interior', 'volante', ' cc ']],
    ['CTI', ['central izquierdo', 'central izq']],
    ['CTD', ['central derecho', 'central der', 'central dcho']],
    ['CT',  [' central', 'defensa central']],
    ['GK',  ['portero', ' po ', ' gk ']],
  ];

  function classifyPos(pos) {
    const p = ' ' + _norm(pos) + ' ';
    for (const [zone, kws] of ZONE_RULES) {
      if (kws.some(k => p.includes(k))) return zone;
    }
    return null;
  }

  // Zone metadata: id, label, side (for header colour)
  const CAMPO_LAYOUT = [
    ['EI',  'Extremos IZQ',   'left'],
    ['DC',  'Delanteros',     'center'],
    ['ED',  'Extremos DRCH',  'right'],
    ['LI',  'Laterales IZQ',  'left'],
    ['MP',  'Mediapuntas',    'center'],
    ['LD',  'Laterales DRCH', 'right'],
    ['CTI', 'Centrales IZQ',  'left'],
    ['MC',  'Mediocentros',   'center'],
    ['CTD', 'Centrales DRCH', 'right'],
  ];

  const HDR_COLOR = { left: '#e67e22', center: '#c0392b', right: '#2980b9' };

  // ── DOM shortcuts ─────────────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const mk = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  // ── Data loading ──────────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    hideError();
    try {
      if (typeof XLSX === 'undefined')
        throw new Error('SheetJS no está cargado. Recarga la página.');

      const resp = await fetch(EXCEL_URL);
      if (!resp.ok)
        throw new Error(`Error HTTP ${resp.status} al descargar el Excel de SharePoint`);

      const buf = await resp.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws  = wb.Sheets['JUGADORES'];
      if (!ws) throw new Error('No se encontró la hoja "JUGADORES" en el archivo');

      _all = XLSX.utils.sheet_to_json(ws, { defval: '' });
      populateFilters();
      renderCampograma();
      $('cg-last-update').textContent =
        'Actualizado: ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Filtering ─────────────────────────────────────────────────────────────────
  function col(player, ...names) {
    for (const n of names) {
      const v = player[n];
      if (v !== undefined && v !== '') return String(v).trim();
    }
    return '';
  }

  function applyFilters() {
    const f = _filters;
    return _all.filter(p => {
      if (f.procedencia && col(p, 'Procedencia') !== f.procedencia) return false;
      if (f.liga        && col(p, 'Liga') !== f.liga)               return false;

      const yr = parseInt(col(p, 'Año', 'Ano')) || 0;
      if (yr && (yr < f.yearMin || yr > f.yearMax)) return false;

      if (f.rendimiento.size && !f.rendimiento.has(col(p, 'Rendimiento'))) return false;
      if (f.proyeccion.size  && !f.proyeccion.has(col(p, 'Proyección', 'Proyeccion'))) return false;
      if (f.ojeador.size     && !f.ojeador.has(col(p, 'Ojeador')))     return false;
      if (f.contexto.size    && !f.contexto.has(col(p, 'Contexto')))   return false;

      if (f.finContrato) {
        const fc = col(p, 'fin_contrato', 'Fin Contrato', 'Fin contrato', 'FinContrato');
        if (fc) {
          const d = fc instanceof Date ? fc : new Date(fc);
          if (!isNaN(d.getTime()) && d > f.finContrato) return false;
        }
      }
      return true;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function parseMedia(p) {
    return parseFloat(String(col(p, 'Media')).replace(',', '.')) || 0;
  }

  function renderCampograma() {
    const filtered = applyFilters();

    // Group by zone
    const zones = {};
    for (const p of filtered) {
      let zone = classifyPos(col(p, 'Posición', 'Posicion', 'Pos'));
      if (!zone || zone === 'GK') continue;
      if (zone === 'CT') {
        // Generic central → appears in both left and right central columns
        (zones.CTI = zones.CTI || []).push(p);
        (zones.CTD = zones.CTD || []).push(p);
      } else {
        (zones[zone] = zones[zone] || []).push(p);
      }
    }

    // Sort by Media desc, take top N
    for (const z of Object.keys(zones)) {
      zones[z].sort((a, b) => parseMedia(b) - parseMedia(a));
      zones[z] = zones[z].slice(0, TOP_N);
    }

    // Update total count
    const totalEl = $('cg-total-count');
    if (totalEl) totalEl.textContent = filtered.length + ' jugadores';

    // Render each zone
    for (const [zoneId, label, side] of CAMPO_LAYOUT) {
      const container = $('cg-zone-' + zoneId);
      if (!container) continue;
      const players = zones[zoneId] || [];
      container.innerHTML = '';

      const color = HDR_COLOR[side];
      const wrap  = mk('div', 'cg-table');

      // Header
      const hdr = mk('div', 'cg-table-hdr');
      hdr.style.background = color;
      hdr.textContent = label + (players.length ? ` · ${players.length}` : '');
      wrap.appendChild(hdr);

      if (!players.length) {
        wrap.appendChild(mk('div', 'cg-empty', '—'));
      } else {
        const thead = mk('div', 'cg-thead');
        thead.innerHTML = `
          <span class="cgc-nota">Nota</span>
          <span class="cgc-nombre">Nombre</span>
          <span class="cgc-anio">Año</span>
          <span class="cgc-equipo">Equipo</span>`;
        wrap.appendChild(thead);

        for (const p of players) {
          const media  = parseMedia(p);
          const mStr   = media ? media.toFixed(1) : '—';
          const apodo  = col(p, 'Apodo') || col(p, 'Nombre');
          const nombre = col(p, 'Nombre');
          const equipo = col(p, 'Equipo');
          const yr     = col(p, 'Año', 'Ano') || '—';

          const disp  = apodo.length  > 16 ? apodo.slice(0,15)  + '…' : apodo;
          const eDisp = equipo.length > 14 ? equipo.slice(0,13) + '…' : equipo;

          const row = mk('div', 'cg-row');
          row.innerHTML = `
            <span class="cgc-nota" style="color:${color}">${mStr}</span>
            <span class="cgc-nombre" title="${nombre.replace(/"/g,'&quot;')}"><b>${disp}</b></span>
            <span class="cgc-anio">${yr}</span>
            <span class="cgc-equipo" title="${equipo.replace(/"/g,'&quot;')}">${eDisp}</span>`;
          wrap.appendChild(row);
        }
      }
      container.appendChild(wrap);
    }
  }

  // ── Filter population ─────────────────────────────────────────────────────────
  function uniqueVals(key, aliases = []) {
    const all = [key, ...aliases];
    const s   = new Set();
    for (const p of _all) {
      for (const k of all) {
        const v = String(p[k] || '').trim();
        if (v) { s.add(v); break; }
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function fillSelect(id, vals, placeholder) {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    vals.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  function populateFilters() {
    fillSelect('cg-filter-procedencia', uniqueVals('Procedencia'), 'Todas las procedencias');
    fillSelect('cg-filter-liga',        uniqueVals('Liga'),        'Todas las ligas');

    // Year range
    const years = _all
      .map(p => parseInt(col(p, 'Año', 'Ano')) || 0)
      .filter(y => y > 1975 && y < 2016);
    if (years.length) {
      const yMin = Math.min(...years), yMax = Math.max(...years);
      ['cg-year-min','cg-year-max'].forEach((id, i) => {
        const sl = $(id);
        if (!sl) return;
        sl.min = yMin; sl.max = yMax;
        sl.value = i === 0 ? yMin : yMax;
      });
      $('cg-year-min-val') && ($('cg-year-min-val').textContent = yMin);
      $('cg-year-max-val') && ($('cg-year-max-val').textContent = yMax);
      _filters.yearMin = yMin;
      _filters.yearMax = yMax;
    }
  }

  // ── UI state ──────────────────────────────────────────────────────────────────
  function setLoading(on) {
    const el = $('cg-loading');
    if (el) el.style.display = on ? 'inline-block' : 'none';
  }

  function showError(msg) {
    const err = $('cg-error');
    const txt = $('cg-error-msg');
    if (txt) txt.textContent = msg;
    if (err) err.style.display = 'flex';
    const c = $('campo-container');
    if (c) c.style.display = 'none';
  }

  function hideError() {
    const err = $('cg-error');
    if (err) err.style.display = 'none';
    const c = $('campo-container');
    if (c) c.style.display = 'block';
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Selects
    $('cg-filter-procedencia').addEventListener('change', e => {
      _filters.procedencia = e.target.value; renderCampograma();
    });
    $('cg-filter-liga').addEventListener('change', e => {
      _filters.liga = e.target.value; renderCampograma();
    });

    // Year sliders
    const onYear = () => {
      let a = parseInt($('cg-year-min').value);
      let b = parseInt($('cg-year-max').value);
      if (a > b) [a, b] = [b, a];
      _filters.yearMin = a; _filters.yearMax = b;
      $('cg-year-min-val').textContent = a;
      $('cg-year-max-val').textContent = b;
      renderCampograma();
    };
    $('cg-year-min').addEventListener('input', onYear);
    $('cg-year-max').addEventListener('input', onYear);

    // Checkboxes (Rendimiento, Proyección)
    const bindChecks = (cls, filterKey) => {
      document.querySelectorAll('.' + cls).forEach(cb => {
        cb.addEventListener('change', () => {
          _filters[filterKey] = new Set(
            [...document.querySelectorAll('.' + cls + ':checked')].map(c => c.value)
          );
          renderCampograma();
        });
      });
    };
    bindChecks('cg-chk-rend',  'rendimiento');
    bindChecks('cg-chk-proy',  'proyeccion');

    // Toggle buttons (Ojeador, Contexto)
    const bindToggles = (cls, filterKey) => {
      document.querySelectorAll('.' + cls).forEach(btn => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('cg-btn-active');
          _filters[filterKey] = new Set(
            [...document.querySelectorAll('.' + cls + '.cg-btn-active')].map(b => b.dataset.val)
          );
          renderCampograma();
        });
      });
    };
    bindToggles('cg-btn-ojeador',  'ojeador');
    bindToggles('cg-btn-contexto', 'contexto');

    // Fin de contrato
    $('cg-filter-contrato').addEventListener('change', e => {
      _filters.finContrato = e.target.value ? new Date(e.target.value) : null;
      renderCampograma();
    });

    // Retry
    $('cg-retry-btn').addEventListener('click', loadData);

    // Reset
    $('cg-reset-btn').addEventListener('click', () => {
      _filters = emptyFilters();
      $('cg-filter-procedencia').value = '';
      $('cg-filter-liga').value        = '';
      $('cg-filter-contrato').value    = '';
      document.querySelectorAll('.cg-chk-rend, .cg-chk-proy')
        .forEach(c => c.checked = false);
      document.querySelectorAll('.cg-btn-ojeador, .cg-btn-contexto')
        .forEach(b => b.classList.remove('cg-btn-active'));
      const sl1 = $('cg-year-min'), sl2 = $('cg-year-max');
      if (sl1 && sl2) {
        sl1.value = sl1.min; sl2.value = sl2.max;
        $('cg-year-min-val').textContent = sl1.min;
        $('cg-year-max-val').textContent = sl2.max;
        _filters.yearMin = parseInt(sl1.min) || 0;
        _filters.yearMax = parseInt(sl2.max) || 9999;
      }
      renderCampograma();
    });
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────────────
  function startAutoRefresh() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(loadData, REFRESH_MS);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    bindEvents();
    loadData();
    startAutoRefresh();
  }

  // Hook into the dashboard tab click
  document.addEventListener('DOMContentLoaded', () => {
    const link = document.querySelector('[data-tab="tab-campograma"]');
    if (link) {
      link.addEventListener('click', init);
    }
  });

})();
