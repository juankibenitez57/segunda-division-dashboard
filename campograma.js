/* campograma.js — Campograma RBB
   Lee jugadores desde Base de Datos 25-26 RBB.csv y los muestra en un campo táctico.
   Se inicializa la primera vez que se hace clic en la pestaña. */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────────
  const CSV_FILE = 'Base de Datos 25-26 RBB.csv';
  const REFRESH_MS = 30 * 60 * 1000;
  const TOP_N = 8;

  // ── State ─────────────────────────────────────────────────────────────────────
  let _all = [];
  let _refreshTimer = null;
  let _filters = emptyFilters();

  function emptyFilters() {
    return {
      search: '',
      procedencia: '',
      equipo: '',
      liga: '',
      categoria: '',
      posicion: '',
      pierna: '',
      etapa: '',
      yearMin: 0,
      yearMax: 9999,
      mediaMin: 0,
      totalMin: 0,
      altura: '',
      complexion: '',
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
    ['EXT', [' extremo ']],
    ['LI',  ['lateral izquierdo', 'lateral izq', ' li ', 'carrilero izquierdo']],
    ['LD',  ['lateral derecho', 'lateral der', 'lateral dcho', ' ld ', 'carrilero derecho']],
    ['LAT', [' lateral ']],
    ['DC',  ['delantero centro', 'delantero', ' dc ', 'punta', 'ariete', 'centro delantero', '9 ']],
    ['MP',  ['mediapunta', 'media punta', ' mp ', ' mco', 'segunda punta', 'enganche', 'ofensivo', 'trequartista']],
    ['CC',  ['centrocampista', 'interior', 'volante', ' cc ']],
    ['MC',  ['mediocentro', ' mc ', 'pivote', ' mcd']],
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
    ['CC',  'Centrocampistas', 'center'],
    ['GK',  'Porteros',       'center'],
  ];

  const HDR_COLOR = { left: '#e67e22', center: '#5f8f18', right: '#2386d9' };
  const ZONE_COLOR = {
    LI: '#ef8200', LD: '#ef8200',
    EI: '#2386d9', ED: '#2386d9', DC: '#2386d9',
    CTI: '#c9202f', CTD: '#c9202f',
    MC: '#5f8f18', MP: '#5f8f18', CC: '#5f8f18',
    GK: '#333333',
  };

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
      if (typeof Papa === 'undefined')
        throw new Error('PapaParse no está cargado. Recarga la página.');

      const csvPath = typeof dataPath === 'function'
        ? dataPath(CSV_FILE)
        : `data/final/${CSV_FILE}`;
      const resp = await fetch(csvPath);
      if (!resp.ok)
        throw new Error(`Error HTTP ${resp.status} al cargar ${CSV_FILE}`);

      const buf = await resp.arrayBuffer();
      let csv;
      try {
        csv = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (_) {
        csv = new TextDecoder('windows-1252').decode(buf);
      }
      const parsed = Papa.parse(csv, {
        header: true,
        delimiter: ';',
        skipEmptyLines: 'greedy',
        transformHeader: h => String(h || '').trim(),
      });
      if (parsed.errors.length && !parsed.data.length) {
        const first = parsed.errors[0];
        throw new Error(`No se pudo leer bien el CSV: ${first.message || 'formato no válido'}`);
      }
      if (parsed.errors.length) console.warn('Campograma CSV warnings', parsed.errors.slice(0, 5));

      _all = parsed.data
        .map(normalizePlayerRow)
        .filter(p => col(p, 'Nombre') && col(p, 'Posición', 'Posicion', 'Pos'));
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

  function normalizePlayerRow(row) {
    const clean = {};
    for (const [k, v] of Object.entries(row || {})) {
      const key = String(k || '').replace(/\s+/g, ' ').trim();
      if (!key || key.startsWith('Unnamed')) continue;
      clean[key] = v == null ? '' : v;
    }
    if (row['Pierna\nDominante'] && !clean['Pierna Dominante']) {
      clean['Pierna Dominante'] = row['Pierna\nDominante'];
    }
    return clean;
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const s = String(value).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseNumValue(value) {
    return parseFloat(String(value || '').replace(',', '.')) || 0;
  }

  function applyFilters() {
    const f = _filters;
    return _all.filter(p => {
      if (f.search) {
        const haystack = [
          col(p, 'Nombre'), col(p, 'Apodo'), col(p, 'NOM PROPIO SIN TILDES'),
          col(p, 'Equipo'), col(p, 'Liga'), col(p, 'Procedencia'), col(p, 'Comentarios')
        ].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!haystack.includes(f.search)) return false;
      }
      if (f.procedencia && col(p, 'Procedencia') !== f.procedencia) return false;
      if (f.equipo      && col(p, 'Equipo') !== f.equipo)           return false;
      if (f.liga        && col(p, 'Liga') !== f.liga)               return false;
      if (f.categoria   && col(p, 'Categoría', 'Categoria') !== f.categoria) return false;
      if (f.posicion    && col(p, 'Posición', 'Posicion', 'Pos') !== f.posicion) return false;
      if (f.pierna      && col(p, 'Pierna Dominante', 'Pierna\nDominante') !== f.pierna) return false;
      if (f.etapa       && col(p, 'Etapa') !== f.etapa) return false;
      if (f.altura      && col(p, 'Altura') !== f.altura) return false;
      if (f.complexion  && col(p, 'Complexión', 'Complexion') !== f.complexion) return false;

      const yr = parseInt(col(p, 'Año', 'Ano')) || 0;
      if (yr && (yr < f.yearMin || yr > f.yearMax)) return false;
      if (f.mediaMin && parseMedia(p) < f.mediaMin) return false;
      if (f.totalMin && parseNumValue(col(p, 'Total')) < f.totalMin) return false;

      if (f.rendimiento.size && !f.rendimiento.has(col(p, 'Rendimiento'))) return false;
      if (f.proyeccion.size  && !f.proyeccion.has(col(p, 'Proyección', 'Proyeccion'))) return false;
      if (f.ojeador.size     && !f.ojeador.has(col(p, 'Ojeador')))     return false;
      if (f.contexto.size    && !f.contexto.has(col(p, 'Contexto')))   return false;

      if (f.finContrato) {
        const fc = col(p, 'CONTRATOS', 'fin_contrato', 'Fin Contrato', 'Fin contrato', 'FinContrato');
        if (fc) {
          const d = parseDate(fc);
          if (d && d > f.finContrato) return false;
        }
      }
      return true;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function parseMedia(p) {
    return parseNumValue(col(p, 'Media'));
  }

  function renderCampograma() {
    const filtered = applyFilters();

    // Group by zone
    const zones = {};
    for (const p of filtered) {
      let zone = classifyPos(col(p, 'Posición', 'Posicion', 'Pos'));
      if (!zone) continue;
      if (zone === 'CT') {
        // Generic central → appears in both left and right central columns
        (zones.CTI = zones.CTI || []).push(p);
        (zones.CTD = zones.CTD || []).push(p);
      } else if (zone === 'EXT') {
        (zones.EI = zones.EI || []).push(p);
        (zones.ED = zones.ED || []).push(p);
      } else if (zone === 'LAT') {
        (zones.LI = zones.LI || []).push(p);
        (zones.LD = zones.LD || []).push(p);
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

      const color = ZONE_COLOR[zoneId] || HDR_COLOR[side];
      const wrap  = mk('div', 'cg-table');
      wrap.style.borderColor = color;

      // Header
      const hdr = mk('div', 'cg-table-hdr');
      hdr.style.background = color;
      hdr.textContent = label + (players.length ? ` · ${players.length}` : '');
      wrap.appendChild(hdr);

      if (!players.length) {
        wrap.appendChild(mk('div', 'cg-empty', '—'));
      } else {
        const thead = mk('div', 'cg-thead');
        thead.style.background = color;
        thead.innerHTML = `
          <span class="cgc-nota">Nota</span>
          <span class="cgc-nombre">Nombre</span>
          <span class="cgc-anio">Y</span>
          <span class="cgc-equipo">Eq.</span>`;
        wrap.appendChild(thead);

        const body = mk('div', 'cg-table-body');
        for (const p of players) {
          const media  = parseMedia(p);
          const mStr   = media ? media.toFixed(1) : '—';
          const apodo  = col(p, 'Apodo') || col(p, 'Nombre');
          const nombre = col(p, 'Nombre');
          const equipo = col(p, 'Equipo');
          const yrRaw  = col(p, 'Año', 'Ano') || '—';
          const yr     = /^\d{4}$/.test(yrRaw) ? yrRaw.slice(2) : yrRaw;
          const rend   = col(p, 'Rendimiento') || '—';
          const proy   = col(p, 'Proyección', 'Proyeccion') || '—';

          const disp  = apodo.length  > 16 ? apodo.slice(0,15)  + '…' : apodo;
          const eDisp = equipo.length > 14 ? equipo.slice(0,13) + '…' : equipo;

          const row = mk('div', 'cg-row');
          row.innerHTML = `
            <span class="cgc-nota" style="color:${color}">${mStr}</span>
            <span class="cgc-nombre" title="${nombre.replace(/"/g,'&quot;')} · Rend. ${rend} · Proy. ${proy}"><b>${disp}</b></span>
            <span class="cgc-anio" style="color:${color}">${yr}</span>
            <span class="cgc-equipo" title="${equipo.replace(/"/g,'&quot;')}">${eDisp}</span>`;
          body.appendChild(row);
        }
        wrap.appendChild(body);
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
    fillSelect('cg-filter-equipo',      uniqueVals('Equipo'),      'Todos los equipos');
    fillSelect('cg-filter-liga',        uniqueVals('Liga'),        'Todas las ligas');
    fillSelect('cg-filter-categoria',   uniqueVals('Categoría', ['Categoria']), 'Todas las categorías');
    fillSelect('cg-filter-posicion',    uniqueVals('Posición', ['Posicion', 'Pos']), 'Todas las posiciones');
    fillSelect('cg-filter-pierna',      uniqueVals('Pierna Dominante', ['Pierna\nDominante']), 'Todas las piernas');
    fillSelect('cg-filter-etapa',       uniqueVals('Etapa'),       'Todas las etapas');
    fillSelect('cg-filter-altura',      uniqueVals('Altura'),      'Altura');
    fillSelect('cg-filter-complexion',  uniqueVals('Complexión', ['Complexion']), 'Complexión');

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
    if (c) c.style.display = 'flex';
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  function bindEvents() {
    if ($('cg-filter-procedencia')?.dataset.bound === '1') return;
    $('cg-filter-procedencia').dataset.bound = '1';
    // Selects
    $('cg-filter-search').addEventListener('input', e => {
      _filters.search = _norm(e.target.value || '');
      renderCampograma();
    });
    $('cg-filter-procedencia').addEventListener('change', e => {
      _filters.procedencia = e.target.value; renderCampograma();
    });
    $('cg-filter-equipo').addEventListener('change', e => {
      _filters.equipo = e.target.value; renderCampograma();
    });
    $('cg-filter-liga').addEventListener('change', e => {
      _filters.liga = e.target.value; renderCampograma();
    });
    $('cg-filter-categoria').addEventListener('change', e => {
      _filters.categoria = e.target.value; renderCampograma();
    });
    $('cg-filter-posicion').addEventListener('change', e => {
      _filters.posicion = e.target.value; renderCampograma();
    });
    $('cg-filter-pierna').addEventListener('change', e => {
      _filters.pierna = e.target.value; renderCampograma();
    });
    $('cg-filter-etapa').addEventListener('change', e => {
      _filters.etapa = e.target.value; renderCampograma();
    });
    $('cg-filter-altura').addEventListener('change', e => {
      _filters.altura = e.target.value; renderCampograma();
    });
    $('cg-filter-complexion').addEventListener('change', e => {
      _filters.complexion = e.target.value; renderCampograma();
    });
    $('cg-filter-media-min').addEventListener('input', e => {
      _filters.mediaMin = parseNumValue(e.target.value); renderCampograma();
    });
    $('cg-filter-total-min').addEventListener('input', e => {
      _filters.totalMin = parseNumValue(e.target.value); renderCampograma();
    });

    // Year range
    const onYear = () => {
      let a = parseInt($('cg-year-min').value);
      let b = parseInt($('cg-year-max').value);
      if (a > b) [a, b] = [b, a];
      _filters.yearMin = a; _filters.yearMax = b;
      renderCampograma();
    };
    $('cg-year-min').addEventListener('change', onYear);
    $('cg-year-max').addEventListener('change', onYear);

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
      $('cg-filter-search').value = '';
      $('cg-filter-procedencia').value = '';
      $('cg-filter-equipo').value      = '';
      $('cg-filter-liga').value        = '';
      $('cg-filter-categoria').value   = '';
      $('cg-filter-posicion').value    = '';
      $('cg-filter-pierna').value      = '';
      $('cg-filter-etapa').value       = '';
      $('cg-filter-altura').value      = '';
      $('cg-filter-complexion').value  = '';
      $('cg-filter-media-min').value   = '';
      $('cg-filter-total-min').value   = '';
      $('cg-filter-contrato').value    = '';
      document.querySelectorAll('.cg-chk-rend, .cg-chk-proy')
        .forEach(c => c.checked = false);
      document.querySelectorAll('.cg-btn-ojeador, .cg-btn-contexto')
        .forEach(b => b.classList.remove('cg-btn-active'));
      const sl1 = $('cg-year-min'), sl2 = $('cg-year-max');
      if (sl1 && sl2) {
        sl1.value = sl1.min; sl2.value = sl2.max;
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

  window.initCampograma = init;

  // Hook into the dashboard tab click
  document.addEventListener('DOMContentLoaded', () => {
    const link = document.querySelector('[data-tab="tab-campograma"]');
    if (link) {
      link.addEventListener('click', init);
    }
  });

})();
