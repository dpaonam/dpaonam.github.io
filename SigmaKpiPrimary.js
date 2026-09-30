/*
 * Sigma - Operational Performance: Primary KPI tiles
 * SAP Analytics Cloud custom widget (web component, no external libraries)
 *
 * One tile per primary KPI, as on the Sigma Operational Performance page:
 *   - KPI score            (numeric point, coloured by status band, band name in text)
 *   - Contribution         (numeric point: (score - target) x weight / 100, signed)
 *   - Impact               (dimension label: High / Medium / Low)
 *   - Trend                (line of the KPI score over the last 90 days, target line dashed)
 * Clicking a tile selects that KPI (onSelect event, getSelectedKpi method).
 *
 * Data bindings (both optional, at least one needed):
 *   kpiBinding   Dimensions: KPI_Primary [, Impact]
 *                Measures  : Score [, Contribution]
 *                -> the tile values, aggregated by SAC for the current filters.
 *   trendBinding Dimensions: KPI_Primary, Date (day or week)
 *                Measures  : Score
 *                -> the trend line. Filter it to the last 90 days in the builder;
 *                   the widget also keeps only the last `trendDays` days it receives.
 * If Contribution or Impact are not bound, the widget calculates them with the
 * prototype's rules (weights, target 80, High >= 3, Medium >= 1).
 * If kpiBinding is not bound, the tile score is the latest point of the trend.
 */
(function () {
  const TAG = 'com-alphaoak-sigma-kpiprimary';

  const DEFAULTS = {
    title: 'Primary KPIs',
    target: 80,
    weights: 'Safety:22,Productivity:16,Cost Effectiveness:16,Schedule Adherence:13,Quality:12,Customer Satisfaction:11,Human Performance:10',
    kpiOrder: 'Safety,Productivity,Cost Effectiveness,Schedule Adherence,Quality,Customer Satisfaction,Human Performance',
    excludeKpis: 'Overall Performance',
    trendDays: 90,
    showTarget: true,
    decimals: 0,
    theme: 'light',
    selectedKpi: ''
  };

  // Status bands from the prototype. The band name is always written, never colour alone.
  const BANDS = [
    { min: 85, name: 'Excellent', color: '#3f8f3f' },
    { min: 70, name: 'Healthy', color: '#7cb342' },
    { min: 55, name: 'Watch', color: '#e0b019' },
    { min: 40, name: 'At risk', color: '#e07b1a' },
    { min: -Infinity, name: 'Critical', color: '#c0392b' }
  ];
  const IMPACT_STYLE = {
    High: { bg: '#e7ebf0', fg: '#344054' },
    Medium: { bg: '#f2f4f7', fg: '#667085' },
    Low: { bg: '#f7f8fa', fg: '#98a2b3' }
  };
  const SHORT = {
    'Safety': 'Safety', 'Productivity': 'Wrench-time', 'Cost Effectiveness': 'Cost eff.',
    'Schedule Adherence': 'Schedule', 'Quality': 'Quality', 'Customer Satisfaction': 'Cust. sat.',
    'Human Performance': 'Human perf.'
  };

  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host { display:block; width:100%; height:100%; box-sizing:border-box;
        --ink:#101828; --ink-2:#475467; --ink-3:#667085; --line:#e4e7ec; --bg:#ffffff; --sel:#eaf1fb;
        --spark:#98a2b3; --accent:#1c6fd0; --good:#2e7d32; --bad:#c0392b;
        font-family:"72","72full",Arial,Helvetica,sans-serif; color:var(--ink); }
      :host([data-theme="dark"]) { --ink:#f2f4f7; --ink-2:#c3c9d2; --ink-3:#98a2b3; --line:#344054;
        --bg:#1d232c; --sel:#22324a; --spark:#667085; --accent:#6aa8ff; --good:#5cc462; --bad:#ff7a6b; }
      .wrap { height:100%; display:flex; flex-direction:column; gap:6px; overflow:auto; }
      .head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
      .title { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); font-weight:600; }
      .hint { font-size:11px; color:var(--ink-3); }
      .grid { flex:1; display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); align-content:start; }
      .tile { position:relative; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px 8px;
        display:flex; flex-direction:column; gap:4px; cursor:pointer; min-width:0; outline:none; }
      .tile:hover { border-color:#c8ced6; }
      .tile:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      .tile.sel { background:var(--sel); border-color:var(--accent); }
      .name { font-size:12px; color:var(--ink-2); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .row { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
      .score { font-size:30px; font-weight:600; line-height:1; }
      .band { display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--ink-2); }
      .dot { width:8px; height:8px; border-radius:50%; flex:none; }
      .meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; }
      .contrib { font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .contrib small { font-weight:400; color:var(--ink-3); margin-right:3px; }
      .chip { font-size:11px; padding:1px 8px; border-radius:999px; white-space:nowrap; }
      .spark { position:relative; height:34px; margin-top:2px; }
      .spark svg { width:100%; height:100%; display:block; overflow:visible; }
      .cap { display:flex; justify-content:space-between; font-size:10px; color:var(--ink-3); gap:6px; }
      .explore { font-size:11px; color:var(--accent); font-weight:600; }
      .tip { position:absolute; pointer-events:none; background:var(--ink); color:var(--bg); font-size:11px;
        padding:3px 7px; border-radius:4px; white-space:nowrap; transform:translate(-50%,-125%); opacity:0; z-index:2; }
      .empty { color:var(--ink-3); font-size:13px; padding:12px; }
      @media (forced-colors: active) { .dot { forced-color-adjust:none; } }
    </style>
    <div class="wrap">
      <div class="head"><span class="title" id="title"></span><span class="hint" id="hint">Click a tile to select the measure</span></div>
      <div class="grid" id="grid" role="listbox" aria-label="Primary KPIs"></div>
    </div>`;

  // ---- helpers ----------------------------------------------------------------------
  const num = v => (v == null || v === '' || isNaN(Number(v))) ? NaN : Number(v);
  const round = (v, d) => { const f = Math.pow(10, d || 0); return Math.round(v * f) / f; };
  const bandOf = s => BANDS.find(b => s >= b.min) || BANDS[BANDS.length - 1];
  const impactOf = c => Math.abs(c) >= 3 ? 'High' : Math.abs(c) >= 1 ? 'Medium' : 'Low';
  const signed = (v, d) => isNaN(v) ? '\u2013' : (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(d);
  const parseList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const parseWeights = s => {
    const w = {};
    parseList(s).forEach(p => { const i = p.lastIndexOf(':'); if (i > 0) w[p.slice(0, i).trim()] = num(p.slice(i + 1)); });
    return w;
  };
  // Date members arrive as IDs like 20260615, 2026-06-15, [Date].[...].[20260615] or 202606 (month)
  const parseDate = (id, label) => {
    const s = String(id || '') + ' ' + String(label || '');
    let m = s.match(/(\d{4})-?(\d{2})-?(\d{2})(?!\d)/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/(\d{4})-?(\d{2})(?!\d)/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return Date.UTC(+m[1], +m[2] - 1, 1);
    const t = Date.parse(label);
    return isNaN(t) ? NaN : t;
  };

  // Map SAC feed keys (dimensions_0, measures_1 ...) in feed order
  const feedKeys = (binding, feed, prefix) => {
    const md = binding && binding.metadata;
    if (md && md.feeds && md.feeds[feed] && Array.isArray(md.feeds[feed].values)) return md.feeds[feed].values;
    const row = binding && binding.data && binding.data[0];
    return row ? Object.keys(row).filter(k => k.indexOf(prefix) === 0).sort() : [];
  };
  const ok = b => b && b.state !== 'error' && Array.isArray(b.data) && b.data.length > 0;

  class SigmaKpiPrimary extends HTMLElement {
    constructor () {
      super();
      this._props = Object.assign({}, DEFAULTS);
      this._tiles = [];
      this._root = this.attachShadow({ mode: 'open' });
      this._root.appendChild(tpl.content.cloneNode(true));
      this._grid = this._root.getElementById('grid');
      this._ro = new ResizeObserver(() => this._drawSparks());
    }
    connectedCallback () { this._ro.observe(this); this._render(); }
    disconnectedCallback () { this._ro.disconnect(); }

    // ---- SAC lifecycle ----------------------------------------------------------------
    onCustomWidgetBeforeUpdate (changed) { Object.assign(this._props, changed); }
    onCustomWidgetAfterUpdate (changed) { Object.assign(this._props, changed); this._render(); }
    onCustomWidgetResize () { this._drawSparks(); }
    onCustomWidgetDestroy () { this._ro.disconnect(); }

    // ---- data ---------------------------------------------------------------------------
    _build () {
      const p = this._props;
      const weights = parseWeights(p.weights);
      const exclude = parseList(p.excludeKpis).map(s => s.toLowerCase());
      const target = num(p.target);
      const map = {};
      const get = name => (map[name] = map[name] || { name, score: NaN, contrib: NaN, impact: '', trend: [] });

      // Tile values
      const kb = this.kpiBinding;
      if (ok(kb)) {
        const dk = feedKeys(kb, 'dimensions', 'dimensions_');
        const mk = feedKeys(kb, 'measures', 'measures_');
        kb.data.forEach(r => {
          const kpi = r[dk[0]] && (r[dk[0]].label || r[dk[0]].id);
          if (!kpi) return;
          const t = get(String(kpi));
          const s = num(r[mk[0]] && r[mk[0]].raw);
          if (!isNaN(s)) t.score = s;
          if (mk[1]) { const c = num(r[mk[1]] && r[mk[1]].raw); if (!isNaN(c)) t.contrib = c; }
          if (dk[1] && r[dk[1]]) t.impact = String(r[dk[1]].label || r[dk[1]].id || '');
        });
      }

      // Trend
      const tb = this.trendBinding;
      if (ok(tb)) {
        const dk = feedKeys(tb, 'dimensions', 'dimensions_');
        const mk = feedKeys(tb, 'measures', 'measures_');
        tb.data.forEach(r => {
          const kd = r[dk[0]], dd = r[dk[1]];
          const kpi = kd && (kd.label || kd.id);
          const v = num(r[mk[0]] && r[mk[0]].raw);
          if (!kpi || !dd || isNaN(v)) return;
          get(String(kpi)).trend.push({ t: parseDate(dd.id, dd.label), id: String(dd.id), label: String(dd.label || dd.id), v });
        });
        const days = num(p.trendDays);
        Object.keys(map).forEach(k => {
          const tr = map[k].trend;
          tr.sort((a, b) => (!isNaN(a.t) && !isNaN(b.t)) ? a.t - b.t : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const last = tr.length ? tr[tr.length - 1].t : NaN;
          if (!isNaN(last) && days > 0) map[k].trend = tr.filter(x => isNaN(x.t) || x.t >= last - days * 86400000);
        });
      }

      // Fill the gaps with the prototype's rules
      Object.keys(map).forEach(k => {
        const t = map[k];
        if (isNaN(t.score) && t.trend.length) t.score = t.trend[t.trend.length - 1].v;
        const shown = round(t.score, num(p.decimals) || 0);
        const w = weights[k];
        if (isNaN(t.contrib) && !isNaN(shown) && !isNaN(target) && w != null && !isNaN(w))
          t.contrib = round((shown - target) * w / 100, 1);
        if (!t.impact && !isNaN(t.contrib)) t.impact = impactOf(t.contrib);
      });

      // Order and filter
      const order = parseList(p.kpiOrder);
      return Object.keys(map)
        .filter(k => exclude.indexOf(k.toLowerCase()) < 0)
        .sort((a, b) => {
          const ia = order.indexOf(a), ib = order.indexOf(b);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : 1);
        })
        .map(k => map[k]);
    }

    // ---- rendering ----------------------------------------------------------------------
    _render () {
      const p = this._props;
      this.setAttribute('data-theme', p.theme === 'dark' ? 'dark' : 'light');
      this._root.getElementById('title').textContent = p.title || '';
      this._tiles = this._build();
      const grid = this._grid;
      grid.innerHTML = '';
      if (!this._tiles.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = 'Bind KPI_Primary and Score to kpiBinding, and/or KPI_Primary, Date and Score to trendBinding.';
        grid.appendChild(e);
        return;
      }
      const d = num(p.decimals) || 0;
      this._tiles.forEach((t, i) => {
        const b = isNaN(t.score) ? null : bandOf(round(t.score, d));
        const sel = p.selectedKpi === t.name;
        const tile = document.createElement('div');
        tile.className = 'tile' + (sel ? ' sel' : '');
        tile.tabIndex = 0;
        tile.setAttribute('role', 'option');
        tile.setAttribute('aria-selected', sel ? 'true' : 'false');
        const first = t.trend[0], last = t.trend[t.trend.length - 1];
        tile.setAttribute('aria-label', `${t.name}: ${isNaN(t.score) ? 'no data' : round(t.score, d)}` +
          (b ? `, ${b.name}` : '') + (isNaN(t.contrib) ? '' : `, contribution ${signed(t.contrib, 1)}`) +
          (t.impact ? `, ${t.impact} impact` : ''));

        const cUp = t.contrib > 0, cFlat = !(Math.abs(t.contrib) > 0);
        const imp = IMPACT_STYLE[t.impact] || { bg: '#f2f4f7', fg: '#667085' };
        tile.innerHTML = `
          <div class="name"></div>
          <div class="row"><span class="score"></span><span class="band"><span class="dot"></span><span class="bn"></span></span></div>
          <div class="meta"><span class="contrib"><small>contrib</small><span class="cv"></span></span><span class="chip"></span></div>
          <div class="spark"><svg aria-hidden="true"></svg><div class="tip"></div></div>
          <div class="cap"><span class="c0"></span><span class="c1"></span></div>`;
        tile.querySelector('.name').textContent = SHORT[t.name] || t.name;
        tile.querySelector('.name').title = t.name;
        tile.querySelector('.score').textContent = isNaN(t.score) ? '\u2013' : round(t.score, d).toFixed(d);
        if (b) { tile.querySelector('.dot').style.background = b.color; tile.querySelector('.bn').textContent = b.name; }
        else tile.querySelector('.band').remove();
        const cv = tile.querySelector('.cv');
        cv.textContent = (cFlat ? '' : cUp ? '\u2191 ' : '\u2193 ') + signed(t.contrib, 1);
        cv.parentNode.style.color = cFlat ? 'var(--ink-3)' : (cUp ? 'var(--good)' : 'var(--bad)');
        const chip = tile.querySelector('.chip');
        if (t.impact) { chip.textContent = t.impact; chip.style.background = imp.bg; chip.style.color = imp.fg; }
        else chip.remove();
        if (t.trend.length) {
          tile.querySelector('.c0').textContent = `${p.trendDays}d: ${round(first.v, d)} \u2192 ${round(last.v, d)}`;
          tile.querySelector('.c1').textContent = last.label;
        } else {
          tile.querySelector('.spark').remove();
          tile.querySelector('.c0').textContent = 'No trend bound';
        }
        if (sel) {
          const ex = document.createElement('div'); ex.className = 'explore';
          ex.textContent = `Explore ${SHORT[t.name] || t.name} \u2192`;
          tile.appendChild(ex);
        }
        const pick = () => this._select(t.name);
        tile.addEventListener('click', pick);
        tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        const svg = tile.querySelector('svg');
        if (svg) {
          svg.addEventListener('mousemove', e => this._hover(i, e));
          svg.addEventListener('mouseleave', () => { this._drawSpark(i); const tip = this._tip(i); if (tip) tip.style.opacity = 0; });
        }
        grid.appendChild(tile);
      });
      this._drawSparks();
    }

    _select (name) {
      const next = this._props.selectedKpi === name ? '' : name;   // click again to clear
      this._props.selectedKpi = next;
      this.dispatchEvent(new CustomEvent('propertiesChanged', { detail: { properties: { selectedKpi: next } } }));
      this.dispatchEvent(new Event('onSelect'));
      this._render();
    }

    _tile (i) { return this._grid.children[i]; }
    _tip (i) { const t = this._tile(i); return t && t.querySelector('.tip'); }

    _geom (i) {
      const t = this._tiles[i], el = this._tile(i), svg = el && el.querySelector('svg');
      if (!svg || !t.trend.length) return null;
      const W = Math.max(40, svg.clientWidth || 140), H = Math.max(20, svg.clientHeight || 34);
      const vals = t.trend.map(x => x.v);
      const tg = num(this._props.target);
      if (this._props.showTarget && !isNaN(tg)) vals.push(tg);
      let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      const pad = Math.max(1.5, (hi - lo) * 0.12); lo -= pad; hi += pad;
      const n = t.trend.length, px = 4, py = 4;
      const x = k => px + (n === 1 ? (W - 2 * px) / 2 : k * (W - 2 * px) / (n - 1));
      const y = v => py + (hi - v) / (hi - lo) * (H - 2 * py);
      return { svg, W, H, x, y, n, t, tg };
    }

    _drawSparks () { this._tiles.forEach((_, i) => this._drawSpark(i)); }

    _drawSpark (i, hover) {
      const g = this._geom(i); if (!g) return;
      const { svg, W, H, x, y, n, t, tg } = g, ns = 'http://www.w3.org/2000/svg';
      const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = '';
      if (this._props.showTarget && !isNaN(tg))
        svg.appendChild(el('line', { x1: 0, x2: W, y1: y(tg), y2: y(tg), stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.8 }));
      svg.appendChild(el('polyline', { points: t.trend.map((p, k) => `${x(k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
        fill: 'none', stroke: 'var(--spark)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      svg.appendChild(el('circle', { cx: x(n - 1), cy: y(t.trend[n - 1].v), r: 3.5, fill: 'var(--accent)', stroke: 'var(--bg)', 'stroke-width': 1.5 }));
      if (hover != null) {
        svg.appendChild(el('line', { x1: x(hover), x2: x(hover), y1: 0, y2: H, stroke: 'var(--line)', 'stroke-width': 1 }));
        svg.appendChild(el('circle', { cx: x(hover), cy: y(t.trend[hover].v), r: 3.5, fill: 'var(--ink)', stroke: 'var(--bg)', 'stroke-width': 1.5 }));
      }
    }

    _hover (i, e) {
      const g = this._geom(i); if (!g) return;
      const r = g.svg.getBoundingClientRect(), mx = e.clientX - r.left;
      let best = 0, bd = Infinity;
      for (let k = 0; k < g.n; k++) { const dd = Math.abs(g.x(k) - mx); if (dd < bd) { bd = dd; best = k; } }
      const p = g.t.trend[best], tip = this._tip(i);
      tip.textContent = `${p.label}: ${round(p.v, Math.max(1, num(this._props.decimals) || 0))}`;
      tip.style.left = g.x(best) + 'px';
      tip.style.top = g.y(p.v) + 'px';
      tip.style.opacity = 1;
      this._drawSpark(i, best);
    }
  }

  // property accessors so SAC script methods (this.target = ...) re-render the widget
  Object.keys(DEFAULTS).forEach(k => {
    Object.defineProperty(SigmaKpiPrimary.prototype, k, {
      get () { return this._props[k]; },
      set (v) { this._props[k] = v; if (this.isConnected) this._render(); },
      configurable: true
    });
  });

  if (!customElements.get(TAG)) customElements.define(TAG, SigmaKpiPrimary);
})();
