// Interface: parameter forms, dialogs, menus, toolbar, options bar, panels, status bar, command palette.
import { app } from './app.js';
import { view } from './view.js';
import { fmt, unitScale, BLENDS, bboxOf, transformShape, mTranslate, mScaleAbout, mRotateAbout, dist, UNITS, HEADS, DASHES, WEBFONTS, needFont, smoothShape } from './core.js';
import { histogram, curveLut } from './imaging.js';
import { thumb, maskThumb } from './ops.js';
import { TOOL_ORDER } from './tools.js';
import { colorPicker, pickColor } from './color.js';
import { DEV_PARAMS, developHD, autoRange } from './hd.js';
import { driveDim, relockDims } from './dims.js';
import { pickPaint, STYLES, styleOf, styleChip } from './styles.js';
import { cssPaint, isGrad } from './core.js';

const $ = id => document.getElementById(id);
export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const keyLabel = sc => !sc ? '' : sc.split('+').map(k => isMac ? ({ Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' }[k] || k) : ({ Mod: 'Ctrl' }[k] || k)).join(isMac ? '' : '+');
// Tooltip text for a command: its name and shortcut.
const tipOf = id => { const c = app.commands.get(id); return c ? c.title.replace(/…$/, '') + (c.shortcut ? `  (${keyLabel(c.shortcut)})` : '') : ''; };

// ---------- parameter forms ----------
// defs: [{id,label,type:'range'|'number'|'check'|'select'|'color'|'text'|'textarea'|'curve'|'button', ...}]; onChange(id, value, final)
export function paramUI(defs, vals, onChange, inline = false) {
  const root = el('div', 'params ' + (inline ? 'inline' : 'stack'));
  for (const p of defs) {
    const row = el('div', 'row'), id = p.id, v = vals[id] ?? p.default;
    const fire = (val, fin) => { vals[id] = val; onChange(id, val, fin); };
    if (p.tip) row.title = p.tip;
    if (p.type !== 'button' && p.type !== 'check' && p.label) row.appendChild(el('label', null, p.label)).title = p.tip || p.label;
    if (p.type === 'range') {
      const r = el('input'), n = el('input'); r.type = 'range'; n.type = 'number';
      for (const e of [r, n]) { e.min = p.min; e.max = p.max; e.step = p.step || 1; e.value = v; }
      r.oninput = () => { n.value = r.value; fire(+r.value, false); }; r.onchange = () => fire(+r.value, true);
      n.onchange = () => { const x = Math.min(p.max, Math.max(p.min, +n.value || 0)); n.value = r.value = x; fire(x, true); };
      row.append(r, n);
    } else if (p.type === 'number') {
      const n = el('input'); n.type = 'number'; if (p.min != null) n.min = p.min; if (p.max != null) n.max = p.max; n.step = p.step || 'any'; n.value = v;
      n.onchange = () => fire(+n.value || 0, true); row.classList.add('wide'); row.append(n);
    } else if (p.type === 'len') {
      // a length kept in pixels, shown in a unit of your choice; a unit can also be typed after the number (5mm, 40 px)
      const d = app.doc, FU = app.settings.fieldUnits || (app.settings.fieldUnits = {}), units = [...new Set([d.unit, 'px', 'mm', 'cm', 'in', 'pt'])], base = p.unit || d.unit;
      let u = units.includes(FU[id]) ? FU[id] : base;
      const k = x => x === d.unit ? d.pxPerUnit : unitScale(x, d.dpi), n = el('input'), s = el('select'); n.type = 'text'; n.spellcheck = false;
      for (const x of units) s.append(el('option', null, x)); s.value = u; s.title = 'Unit for this value';
      const show = () => { n.value = fmt((vals[id] ?? 0) / k(u), u === 'px' ? 2 : 3); };
      n.onchange = () => { const m = /^\s*(-?\d*\.?\d+)\s*([a-zµ]*)\s*$/i.exec(n.value), su = m ? m[2].toLowerCase() : '';
        if (!m || (su && !units.includes(su))) { app.toast('Type a number, optionally with a unit: ' + units.join(', ')); show(); return; }
        const px = parseFloat(m[1]) * k(su || u); if (p.min != null && px < p.min) { show(); return; } vals[id] = px; show(); fire(px, true); };
      n.onfocus = () => n.select();
      s.onchange = () => { u = s.value; if (u === base) delete FU[id]; else FU[id] = u; app.saveSettings(); show(); };
      show(); row.classList.add('lenrow'); row.append(n, s);
    } else if (p.type === 'check') {
      const l = el('label'), c = el('input'); c.type = 'checkbox'; c.checked = !!v; c.onchange = () => fire(c.checked, true);
      l.append(c, ' ' + p.label); l.style.display = 'flex'; l.style.gap = '6px'; l.style.color = 'inherit'; row.classList.add('full'); row.append(l);
    } else if (p.type === 'select') {
      const s = el('select'); for (const o of p.options) { const [val, lab] = Array.isArray(o) ? o : [o, o]; const op = el('option', null, lab); op.value = val; if (val === '-') op.disabled = true; s.append(op); }
      s.value = v; s.onchange = () => fire(s.value, true); row.classList.add('wide'); row.append(s);
    } else if (p.type === 'color') {
      const w = el('button', 'swatch'), show = c => { w.style.background = cssPaint(c); w.classList.toggle('none', !c); }; show(v); w.title = (p.label || 'Colour') + ': click to change' + (p.gradient ? ' (colour or gradient)' : '');
      w.onclick = e => { e.stopPropagation(); if (p.gradient) pickPaint(w, { paint: vals[id] ?? null, none: p.none, onChange: (c, fin) => { show(c); fire(c, fin); } });
        else pickColor(w, { color: vals[id] || p.fallback || '#000000', none: p.none, onChange: (c, fin) => { show(c); fire(c, fin); } }); };
      row.classList.add('wide'); row.append(w);
    } else if (p.type === 'text') { const t = el('input'); t.type = 'text'; t.value = v ?? ''; t.onchange = () => fire(t.value, true); row.classList.add('wide'); row.append(t); }
    else if (p.type === 'textarea') { const t = el('textarea'); t.value = v ?? ''; t.oninput = () => fire(t.value, false); t.onchange = () => fire(t.value, true); row.classList.add('full'); row.append(t); }
    else if (p.type === 'curve') { row.classList.add('full'); row.append(curveEditor(v, fire, p.hist)); }
    else if (p.type === 'button') { const b = el('button', null, p.label); b.onclick = p.click; if (p.tip) b.title = p.tip; row.classList.add('full'); row.append(b); }
    root.append(row);
  }
  return root;
}
function drawHistInto(x, W, H, h) {
  if (!h) return; let mx = 1; for (const ch of [h.R, h.G, h.B]) for (let i = 1; i < 255; i++) if (ch[i] > mx) mx = ch[i];
  x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5;
  for (const [ch, col] of [[h.R, '#e04848'], [h.G, '#3cb44b'], [h.B, '#4878e8']]) { x.fillStyle = col; x.beginPath(); x.moveTo(0, H); for (let i = 0; i < 256; i++) x.lineTo(i / 255 * W, H - Math.min(1, ch[i] / mx) * H * 0.96); x.lineTo(W, H); x.fill(); }
  x.restore();
}
function curveEditor(pts, fire, hist) {
  const c = el('canvas', 'curve'); c.width = 240; c.height = 240; let drag = -1;
  const draw = () => {
    const x = c.getContext('2d'), W = 240; x.clearRect(0, 0, W, W); drawHistInto(x, W, W, hist && hist());
    x.strokeStyle = 'rgba(128,128,128,.35)'; x.lineWidth = 1; x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(i * 60, 0); x.lineTo(i * 60, W); x.moveTo(0, i * 60); x.lineTo(W, i * 60); } x.moveTo(0, W); x.lineTo(W, 0); x.stroke();
    const t = curveLut(pts); x.strokeStyle = '#4c9ffe'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i < 256; i++) { const px = i / 255 * W, py = W - t[i] / 255 * W; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#4c9ffe'; for (const p of pts) { x.beginPath(); x.arc(p[0] * W, W - p[1] * W, 4.5, 0, 7); x.fill(); x.stroke(); }
  };
  const pos = e => { const r = c.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]; };
  const near = q => pts.findIndex(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05);
  c.onpointerdown = e => { c.setPointerCapture(e.pointerId); const q = pos(e); drag = near(q); if (drag < 0) { pts.push(q); pts.sort((a, b) => a[0] - b[0]); drag = pts.indexOf(q); } draw(); fire(pts, false); };
  c.onpointermove = e => { if (drag < 0) return; const q = pos(e), p = pts[drag]; p[0] = Math.min(drag < pts.length - 1 ? pts[drag + 1][0] - 0.01 : 1, Math.max(drag > 0 ? pts[drag - 1][0] + 0.01 : 0, q[0])); p[1] = q[1]; draw(); fire(pts, false); };
  c.onpointerup = () => { if (drag >= 0) { drag = -1; fire(pts, true); } };
  c.ondblclick = e => { const i = near(pos(e)); if (i >= 0 && pts.length > 2) { pts.splice(i, 1); draw(); fire(pts, true); } };
  draw(); return c;
}

// ---------- dialogs ----------
// Resolves with the values object (OK) or null (Cancel). opts: title, text, params, values, onChange, body, ok, floating
export function dialog(opts) {
  return new Promise(resolve => {
    const ov = el('div', 'overlay' + (opts.floating ? ' clear' : '')), dl = el('div', 'dialog'), content = el('div', 'content');
    const vals = opts.values || {}; for (const p of opts.params || []) if (p.id && vals[p.id] === undefined) vals[p.id] = JSON.parse(JSON.stringify(p.default ?? null));
    dl.append(el('h2', null, opts.title));
    if (opts.text) content.append(el('p', null, opts.text));
    if (opts.params) content.append(paramUI(opts.params, vals, (id, v, fin) => opts.onChange && opts.onChange(vals, id, fin)));
    if (opts.body) content.append(opts.body);
    const btns = el('div', 'buttons'), cancel = el('button', null, 'Cancel'), ok = el('button', 'primary', opts.ok || 'OK');
    const close = r => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(r); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.stopPropagation(); if (e.target.blur) e.target.blur(); close(vals); } };
    cancel.onclick = () => close(null); ok.onclick = () => close(vals);
    if (!opts.noCancel) btns.append(cancel); btns.append(ok);
    dl.append(content, btns); ov.append(dl); document.body.append(ov);
    document.addEventListener('keydown', onKey, true);
    const first = dl.querySelector('input[type=number], input[type=text], textarea'); if (first && !opts.floating) { first.focus(); first.select && first.select(); }
  });
}
export const dialogOpen = () => !!document.querySelector('.overlay');

// ---------- menus ----------
// An item is a command id, '-', a submenu [title, items], or {title, run, checked, disabled}.
let openMenus = [];
function closeMenus() { for (const m of openMenus) m.remove(); openMenus = []; document.querySelectorAll('.menu-title.open').forEach(t => t.classList.remove('open')); }
function menuItems(items) { return (typeof items === 'function' ? items() : items).flatMap(i => typeof i === 'function' ? i() : [i]); }
function showMenu(items, x, y, level = 0) {
  for (const m of openMenus.splice(level)) m.remove();
  const menu = el('div', 'menu');
  for (const it of menuItems(items)) {
    if (it === '-') { if (menu.lastChild && !menu.lastChild.classList.contains('sep')) menu.append(el('div', 'sep')); continue; }
    if (Array.isArray(it)) { // submenu
      const row = el('div', 'item sub', it[0]);
      row.onmouseenter = () => { const r = row.getBoundingClientRect(); showMenu(it[1], r.right - 2, r.top - 4, level + 1); };
      menu.append(row); continue;
    }
    const c = typeof it === 'string' ? app.commands.get(it) : { title: it.title, enabled: it.disabled ? () => false : null, checked: it.checked ? () => true : null, direct: it.run }; if (!c) continue;
    const row = el('div', 'item' + (c.enabled && !c.enabled() ? ' disabled' : '') + (c.checked && c.checked() ? ' checked' : ''));
    row.append(el('span', null, c.title)); if (c.shortcut) row.append(el('kbd', null, keyLabel(c.shortcut)));
    if (c.desc) row.title = c.desc;
    row.onmouseenter = () => { for (const m of openMenus.splice(level + 1)) m.remove(); };
    row.onclick = () => { closeMenus(); if (c.direct) c.direct(); else app.run(c.id); };
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px'; menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  openMenus.push(menu);
  return menu;
}
export function popupMenu(items, x, y) { closeMenus(); showMenu(items, x, y, 0); }
function buildMenubar() {
  const bar = $('menus'); bar.innerHTML = '';
  for (const [title, items] of app.menus) {
    const t = el('div', 'menu-title', title);
    const open = () => { closeMenus(); t.classList.add('open'); const r = t.getBoundingClientRect(); showMenu(items, r.left, r.bottom + 2, 0); };
    t.onpointerdown = e => { e.stopPropagation(); if (t.classList.contains('open')) closeMenus(); else open(); };
    t.onmouseenter = () => { if (openMenus.length && !t.classList.contains('open')) open(); };
    bar.append(t);
  }
  document.addEventListener('pointerdown', e => { if (openMenus.length && !e.target.closest('.menu')) closeMenus(); });
}

// ---------- toolbar ----------
const ICONS = {
  select: '<path d="M5 3l10 7-4.6 1 2.8 5-1.9 1-2.8-5L5 15z"/>',
  node: '<path d="M4 3l8 5.6-3.7.8L6 12.5z"/><rect x="12" y="12" width="5" height="5"/>',
  transform: '<rect x="4.500" y="4.500" width="11" height="11" stroke-dasharray="2 1.600"/><rect x="2.500" y="2.500" width="4" height="4" fill="currentColor"/><rect x="13.500" y="2.500" width="4" height="4" fill="currentColor"/><rect x="2.500" y="13.500" width="4" height="4" fill="currentColor"/><rect x="13.500" y="13.500" width="4" height="4" fill="currentColor"/>',
  line: '<path d="M5 15L15 5"/><circle cx="4.5" cy="15.5" r="1.5"/><circle cx="15.5" cy="4.5" r="1.5"/>',
  spline: '<path d="M3 14c3-10 6 6 9-2s3-6 5-6"/><circle cx="3" cy="14" r="1.300"/><circle cx="12" cy="12" r="1.300"/><circle cx="17" cy="6" r="1.300"/>',
  rect: '<rect x="3.5" y="5" width="13" height="10"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>',
  pen: '<path d="M4 16l1.5-6.5L12 3l5 5-6.5 6.5z"/><path d="M4 16l4-4"/>',
  text: '<path d="M4.5 6V4.5h11V6M10 4.5v11M8 15.5h4"/>',
  dim: '<path d="M3 5v10M17 5v10M4 10h12"/><path d="M6.500 8L4 10l2.500 2M13.500 8L16 10l-2.500 2"/>',
  measure: '<path d="M3 13L13 3l4 4L7 17z"/><path d="M6.5 9.5l2 2M9.5 6.5l2 2"/>',
  marquee: '<rect x="3.5" y="4.5" width="13" height="11" stroke-dasharray="2.6 2"/>',
  lasso: '<path d="M10 4c4 0 7 1.8 7 4.5S14 13 10 13s-7-1.800-7-4.500S6 4 10 4z"/><path d="M6.500 12.500c-1.200 1-1.500 3 .5 4.500"/>',
  wand: '<path d="M4 16l8.500-8.500"/><path d="M13 3v2M13 9v1.500M16.500 6.500h-2M9.500 6.500H11M15.500 4l-1 1M15.500 9l-1-1"/>',
  objsel: '<rect x="3" y="3" width="14" height="14" stroke-dasharray="2.400 2"/><circle cx="10" cy="8" r="2.200"/><path d="M6 15c.5-3 2-4 4-4s3.500 1 4 4"/>',
  crop: '<path d="M6 2v12h12M2 6h12v12"/>',
  brush: '<path d="M16 3l1.500 1.500-7.500 8-2.500.5.5-2.500z"/><path d="M6.500 12.500c-2 0-2.500 2-4 3.500 2.500.5 5 0 5-2.500"/>',
  eraser: '<path d="M8.500 16l-4.500-4.500 8-8 5 5-7.500 7.500z"/><path d="M8.500 16H17M7.500 8l5 5"/>',
  stamp: '<path d="M8 3h4l-.700 6h3.200v3h-9V9h3.200z"/><path d="M4 16.500h12M5.500 14.500h9"/>',
  remove: '<path d="M4 16l8-8 2.500 2.500-8 8z"/><path d="M14 3l.700 1.800L16.500 5.500l-1.800.700L14 8l-.700-1.800L11.500 5.500l1.800-.700zM17 10.500l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z" fill="currentColor" stroke="none"/>',
  bucket: '<path d="M9 3l6.500 6.500-5 5a1.800 1.800 0 01-2.500 0L4.500 11a1.800 1.800 0 010-2.500z"/><path d="M4.200 10h10.800"/><path d="M16.500 13c1 1.500 1.200 2.500 0 3.500-1.200-1-1-2 0-3.500z"/>',
  gradient: '<rect x="3.500" y="5" width="13" height="10"/><path d="M6.500 5v10M9 5v10M12.500 5v10" stroke-width=".8"/><path d="M4 5.500h2v9H4z" fill="currentColor" stroke="none"/>',
  eyedropper: '<path d="M14 3l3 3-2.200 2.200-3-3z"/><path d="M12.500 6.500l-7.500 7.500-1 2.500 2.500-1 7.500-7.500"/>',
  hand: '<path d="M7 10V5.200a1.100 1.100 0 012.200 0V9 4.200a1.100 1.100 0 012.200 0V9 5.200a1.100 1.100 0 012.200 0V10 7.500a1.100 1.100 0 012.200 0V13c0 2.800-2 4.500-5 4.500-2.500 0-3.800-1-5.300-4L4 11c-.3-1 1-1.800 2-.8z"/>',
  zoom: '<circle cx="8.500" cy="8.500" r="5"/><path d="M12.500 12.500L17 17M6.500 8.500h4M8.500 6.500v4"/>',
};
function buildToolbar() {
  const bar = $('toolbar'); bar.innerHTML = '';
  for (const id of TOOL_ORDER) {
    if (id === '-') { bar.append(el('div', 'tsep')); continue; }
    if (id[0] === '#') { bar.append(el('div', 'tlabel', id.slice(1))); continue; }
    const t = app.tools.get(id); if (!t) continue;
    const b = el('button', 'tool'); b.dataset.tool = id; b.title = `${t.title}  (${t.keyb})\n${t.hint || ''}`;
    b.innerHTML = `<svg viewBox="0 0 20 20">${t.icon || ICONS[id] || '<circle cx="10" cy="10" r="6"/>'}</svg>`;
    b.onclick = () => app.setTool(id); bar.append(b);
  }
}

// ---------- options bar: tool options, then the properties of what is selected or about to be drawn ----------
const FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Trebuchet MS', 'Palatino', 'Garamond', 'Tahoma', 'Impact', 'Comic Sans MS', 'Menlo', 'system-ui'];
const fontOpts = cur => { const loc = app.settings.localFonts || [], all = [...FONTS, ['-', '── Web fonts ──'], ...WEBFONTS, ...(loc.length ? [['-', '── This computer ──'], ...loc] : [])]; if (cur && !all.includes(cur)) all.unshift(cur); return all; };
const DASH_OPTS = Object.keys(DASHES), VECTOR_TOOLS = ['line', 'spline', 'pen', 'rect', 'ellipse', 'dim', 'text'];
const styleDefs = st => [{ id: 'stroke', label: 'Stroke', type: 'color', none: true, gradient: true }, { id: 'sw', label: 'Width', type: 'len', unit: 'pt', min: 0, tip: 'Line width' },
  { id: 'fill', label: 'Fill', type: 'color', none: true, gradient: true, fallback: '#ffffff' }, { id: 'dash', label: 'Line', type: 'select', options: DASH_OPTS, tip: 'Solid, dashed, dotted or dash-dot' },
  ...(st.dash && st.dash !== 'solid' ? [...(st.dash !== 'dotted' ? [{ id: 'dl', label: 'Dash', type: 'number', min: 0.1, step: 0.5, tip: 'Dash length, in line widths' }] : []), { id: 'dg', label: 'Gap', type: 'number', min: 0.1, step: 0.5, tip: 'Gap between dashes or dots, in line widths (smaller = denser)' }] : []),
  { id: 'as', label: 'Start', type: 'select', options: HEADS, tip: 'Arrowhead or marker at the start' }, { id: 'ae', label: 'End', type: 'select', options: HEADS, tip: 'Arrowhead or marker at the end' },
  ...((st.as && st.as !== 'none') || (st.ae && st.ae !== 'none') ? [{ id: 'hsPct', label: 'Head %', type: 'number', min: 10, step: 10, tip: 'Arrowhead size' }] : []),
  { id: 'alphaPct', label: 'Opacity', type: 'number', min: 0, max: 100, tip: 'Opacity in percent' }, { id: 'shadow', label: 'Drop shadow', type: 'check' },
  ...(st.shadow ? [{ id: 'shBlur', label: 'Blur', type: 'len', min: 0 }, { id: 'shX', label: 'Offset X', type: 'len' }, { id: 'shY', label: 'Offset Y', type: 'len' }, { id: 'shA', label: 'Shadow %', type: 'number', min: 0, max: 100 }] : [])];
const textDefs = f => [{ id: 'font', label: 'Font', type: 'select', options: fontOpts(f) }, { id: 'size', label: 'Size', type: 'len', unit: 'pt', min: 0.01, tip: 'Text size' }, { id: 'bold', label: 'B', type: 'check' }, { id: 'italic', label: 'I', type: 'check' }, { id: 'align', label: 'Align', type: 'select', options: ['left', 'center', 'right'] }];
const styleVals = (st, d) => ({ stroke: st.stroke || null, sw: st.sw || 0, fill: st.fill || null, dash: st.dash || 'solid', dl: st.dl || (DASHES[st.dash] || [4])[0], dg: st.dg || (DASHES[st.dash] || [0, 3])[1], as: st.as || 'none', ae: st.ae || 'none', hsPct: Math.round((st.hs || 1) * 100), alphaPct: Math.round((st.alpha ?? 1) * 100),
  shadow: !!st.shadow, shBlur: st.shadow ? st.shadow.blur ?? 6 : 6, shX: st.shadow ? st.shadow.x ?? 3 : 3, shY: st.shadow ? st.shadow.y ?? 3 : 3, shA: st.shadow ? Math.round((st.shadow.a ?? 0.45) * 100) : 45 });
// Apply one style field to a style object (shared by selected shapes and the defaults for new ones).
function setStyle(t, id, v, d) {
  if (id === 'alphaPct') t.alpha = v / 100; else if (id === 'hsPct') t.hs = v / 100; else if (id === 'shadow') { if (v) t.shadow = { c: '#000000', a: 0.4, blur: 2 * d.ptPx, x: d.ptPx, y: 1.5 * d.ptPx }; else delete t.shadow; }
  else if (id === 'shBlur' || id === 'shX' || id === 'shY' || id === 'shA') { if (t.shadow) t.shadow[{ shBlur: 'blur', shX: 'x', shY: 'y', shA: 'a' }[id]] = id === 'shA' ? v / 100 : v; }
  else t[id] = v;
  if (id === 'dash') { delete t.dl; delete t.dg; }
}
// Defaults for new shapes keep the line width in pt.
function setDefault(S, id, v, d) { if (id === 'sw') S.swPt = v / d.ptPx; else { const t = { ...S, sw: S.swPt * d.ptPx }; setStyle(t, id, v, d); delete t.sw; for (const k of Object.keys(S)) if (!(k in t)) delete S[k]; Object.assign(S, t); } }
const SHAPE_REBUILD = ['dash', 'as', 'ae', 'shadow'];
// One-click templates.
function stylesGroup(label, apply) { const box = el('div', 'stylegrid'); for (const t of STYLES) { const b = styleChip(t); b.onclick = () => apply(t); box.append(b); } return grp(label, box); }
const sep = () => el('span', 'osep');
const grp = (label, ...nodes) => { const g = el('div', 'grp'); g.append(el('span', 'gl', label), ...nodes); return g; };
const IN = false; // the options sidebar stacks its fields
function objectBar(bar, d) {
  const sel = d.selected(), S = app.settings, shapes = sel.map(o => o.s), s0 = shapes[0], U = v => +fmt(d.toU(v), 3);
  const touchAll = () => { for (const o of sel) o.L.touch(); };
  bar.append(el('span', 'tool-name', sel.length > 1 ? `${sel.length} objects` : { path: s0.nodes && s0.nodes.some(n => n.a) ? 'Spline' : s0.closed ? 'Closed path' : 'Path', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', dim: 'Dimension' }[s0.type]));
  const texts = shapes.filter(s => s.type === 'text'), geo = shapes.filter(s => s.type !== 'text');
  if (geo.length) {
    const st = geo[0].st || {};
    const onlyDims = geo.every(s => s.type === 'dim');
    if (!onlyDims) bar.append(stylesGroup('Style templates', t => { for (const s of geo) if (s.type !== 'dim') s.st = { ...s.st, ...styleOf(t, d) }; touchAll(); app.commit('Style ' + t.name); }));
    bar.append(grp(onlyDims ? 'Lines and arrows' : 'Line and fill', paramUI(styleDefs(st).filter(p => !onlyDims || !['fill', 'dash', 'dl', 'dg', 'shadow', 'shBlur', 'shX', 'shY', 'shA'].includes(p.id)), styleVals(st, d), (id, v, fin) => {
      for (const s of geo) setStyle(s.st || (s.st = {}), id, v, d);
      // what you change becomes the default for the next shape of that kind (dimensions keep their own)
      if (id !== 'alphaPct') { if (onlyDims) { const D2 = S.dimStyle || (S.dimStyle = {}); if (id === 'sw') D2.swPt = v / d.ptPx; else if (id === 'hsPct') D2.hs = v / 100; else D2[id] = v; } else setDefault(S.style, id, v, d); app.saveSettings(); }
      touchAll(); if (fin) app.commit('Style'); else app.refresh('render'); if (fin && SHAPE_REBUILD.includes(id)) app.refresh('props');
    }, IN)));
    const sp = geo.filter(s => s.type === 'path' && s.nodes.some(n => n.a));
    if (sp.length) bar.append(paramUI([{ id: 't', label: 'Smooth', type: 'number', min: 0, max: 3, step: 0.1, tip: 'Spline smoothness: 0 = straight segments, 1 = natural, more = rounder' }], { t: sp[0].tension ?? 1 }, (id, v) => { for (const s of sp) { s.tension = v; smoothShape(s); } touchAll(); app.commit('Spline smoothness'); }, IN));
  }
  const dims = shapes.filter(s => s.type === 'dim');
  if (texts.length || dims.length) {
    const t0 = texts[0] || dims[0], tv = { font: t0.font || 'Arial', size: t0.size, align: t0.align || 'left', bold: !!t0.bold, italic: !!t0.italic, fill: (t0.st && t0.st.fill) || '#000000', dec: t0.dec ?? 2, label: t0.text || '' };
    const defs = texts.length ? [...textDefs(tv.font), { id: 'fill', label: 'Colour', type: 'color', fallback: '#000000' }] : [...textDefs(tv.font).slice(0, 2), { id: 'dec', label: 'Decimals', type: 'number', min: 0, max: 6 }, { id: 'label', label: 'Label', type: 'text', tip: 'Leave empty to show the measured length' }];
    if (dims.length === 1 && sel.length === 1) { // a dimension both labels and constrains
      const dm = dims[0], att = (dm.ra ? 1 : 0) + (dm.rb ? 1 : 0);
      bar.append(grp('Dimension', paramUI([{ id: 'len', label: 'Value', type: 'len', min: 1e-9, tip: att ? 'Type a new value: the attached shape is resized or moved to match (or double-click the value on the drawing)' : 'Not attached to a shape: this only moves the end of the dimension' },
        { id: 'lock', label: 'Driving (constrains the shape)', type: 'check', tip: 'On, as in Fusion 360: the shape keeps this length; dragging it cannot change it. Off: a reference dimension that only shows the length and follows the shape.' }, { id: 'note', label: 'Show in export', type: 'check', tip: 'Off: the dimension is a working constraint only, shown faintly and left out of exported files' },
        { id: 'off', label: 'Offset', type: 'len', tip: 'Distance of the dimension line from the measured points' }],
        { len: dist(dm.a, dm.b), lock: dm.lock != null, note: dm.note !== false, off: dm.off || 0 }, (id, v) => {
          if (id === 'len' && v > 0) driveDim(d, dm, v); else if (id === 'lock') { if (v) dm.lock = dist(dm.a, dm.b); else delete dm.lock; const D2 = S.dimStyle || (S.dimStyle = {}); D2.driving = v; app.saveSettings(); }
          else if (id === 'note') dm.note = v; else if (id === 'off') dm.off = v;
          touchAll(); app.commit('Dimension');
        }, IN), el('span', 'gl', att === 2 ? 'attached to the shape' : att ? 'one end attached' : 'not attached')));
    }
    bar.append(grp(texts.length ? 'Text' : 'Label', paramUI(defs, tv, (id, v, fin) => {
      if (id === 'font') needFont(v);
      for (const s of [...texts, ...dims]) { if (id === 'size') s.size = v; else if (id === 'fill') (s.st || (s.st = {})).fill = v || '#000000'; else if (id === 'label') s.text = v || null; else s[id] = v; }
      if (texts.length && id !== 'fill') { if (id === 'size') S.text.sizePt = v / d.ptPx; else S.text[id] = v; app.saveSettings(); }
      if (!texts.length && id !== 'label') { const D2 = S.dimStyle || (S.dimStyle = {}); if (id === 'size') D2.sizePt = v / d.ptPx; else D2[id] = v; if (id === 'dec') app.tools.get('dim').opt.dec = v; app.saveSettings(); }
      touchAll(); if (fin) app.commit('Text style'); else app.refresh('render');
    }, IN)));
  }
  // exact geometry in document units
  const b = bboxOf(shapes), g = { x: b.x, y: b.y, w: b.w, h: b.h }, defs = [{ id: 'x', label: 'X', type: 'len', tip: 'Left edge' }, { id: 'y', label: 'Y', type: 'len', tip: 'Top edge' }, { id: 'w', label: 'Width', type: 'len', min: 0 }, { id: 'h', label: 'Height', type: 'len', min: 0 }];
  const line = sel.length === 1 && s0.type === 'path' && !s0.closed && s0.nodes.length === 2 && !s0.subs ? s0 : null;
  if (line) { const [a, c] = line.nodes; g.len = dist(a, c); g.ang = +fmt(((Math.atan2(-(c.y - a.y), c.x - a.x) * 180 / Math.PI) + 360) % 360, 2); defs.push({ id: 'len', label: 'Length', type: 'len', min: 0 }, { id: 'ang', label: 'Angle °', type: 'number' }); }
  else if (sel.length === 1 && (s0.type === 'rect' || s0.type === 'ellipse' || s0.type === 'text')) { g.rot = +fmt(-(s0.rot || 0) * 180 / Math.PI, 2); defs.push({ id: 'rot', label: 'Angle °', type: 'number' }); }
  else { g.turn = 0; defs.push({ id: 'turn', label: 'Turn °', type: 'number', tip: 'Rotate the selection counter-clockwise by this angle' }); }
  bar.append(grp('Position and size', paramUI(defs, g, (id, v) => {
    const px = v; let m;
    if (id === 'x') m = mTranslate(px - b.x, 0); else if (id === 'y') m = mTranslate(0, px - b.y);
    else if (id === 'w' && b.w > 0 && px > 0) m = mScaleAbout(px / b.w, 1, { x: b.x, y: b.y }); else if (id === 'h' && b.h > 0 && px > 0) m = mScaleAbout(1, px / b.h, { x: b.x, y: b.y });
    else if (id === 'rot') s0.rot = -v * Math.PI / 180;
    else if (id === 'turn' && v) m = mRotateAbout(-v * Math.PI / 180, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    else if (id === 'len' || id === 'ang') { const [a, c] = line.nodes, L = id === 'len' ? px : dist(a, c), an = (id === 'ang' ? v : g.ang) * Math.PI / 180; c.x = a.x + L * Math.cos(an); c.y = a.y - L * Math.sin(an); }
    if (m) for (const s of shapes) transformShape(s, m);
    relockDims(d, shapes); // a size typed here wins over driving dimensions on these shapes
    touchAll(); app.commit('Transform');
  }, IN)));
}
function buildOptbar() {
  const t = app.tool, bar = $('optbar'), d = app.doc; if (!t) return;
  if (bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'range') return; // do not rebuild under a slider being dragged
  const top = bar.scrollTop; bar.innerHTML = '';
  $('npTitle').textContent = t.title; $('npHead').title = `${t.title}  (${t.keyb})\n${t.hint || ''}\nClick to fold or unfold this panel`;
  if (!d) return;
  const tb = t.bar && t.bar();
  if (tb) bar.append(paramUI(tb.defs, tb.vals, (id, v) => tb.set(id, v), IN));
  else if (t.options && t.options.length) bar.append(paramUI(t.options, t.opt, () => { app.saveSettings(); app.refresh('overlay'); }, IN));
  if (d.editMask && d.active && d.active.mask) bar.appendChild(el('span', 'badge', 'Editing mask: white shows, black hides')).title = 'Click the layer thumbnail in the Layers panel to paint on the image again';
  if (d.chan.edit) bar.appendChild(el('span', 'badge', 'Channel lock on')).title = 'Only the channels selected in the Channels panel are changed by painting and filters';
  if (d.selShapes.size && d.selected().length) objectBar(bar, d);
  else if (VECTOR_TOOLS.includes(t.id)) { // style of the next shape
    const S = app.settings;
    if (t.id === 'text') bar.append(grp('New text', paramUI(textDefs(S.text.font), { ...S.text, size: S.text.sizePt * d.ptPx }, (id, v) => { if (id === 'font') needFont(v); if (id === 'size') S.text.sizePt = v / d.ptPx; else S.text[id] = v; app.saveSettings(); }, IN)));
    else {
      if (t.id === 'dim') { const D2 = S.dimStyle || {}; bar.append(grp('New dimension', el('div', 'props-note', `Text ${fmt(D2.sizePt ?? S.text.sizePt, 2)} pt ${D2.font || S.text.font}, line ${fmt(D2.swPt ?? 0.75, 2)} pt, ${D2.driving === false ? 'reference' : 'driving'}. Change a placed dimension and the next ones use the same settings.`))); }
      else {
        const vals = styleVals({ ...S.style, sw: S.style.swPt * d.ptPx }, d);
        bar.append(stylesGroup('Style templates', tp => { const o = styleOf(tp, d); o.swPt = (o.sw ?? S.style.swPt * d.ptPx) / d.ptPx; delete o.sw; for (const k of ['fill', 'stroke', 'shadow']) if (!(k in o)) o[k] = S.style[k]; Object.assign(S.style, o); if (!o.shadow) delete S.style.shadow; app.saveSettings(); app.refresh('tool'); app.toast('The next shapes use “' + tp.name + '”'); }));
        bar.append(grp('New shape', paramUI(styleDefs(S.style), vals, (id, v) => { setDefault(S.style, id, v, d); app.saveSettings(); if (SHAPE_REBUILD.includes(id)) app.refresh('tool'); }, IN)));
      }
    }
  }
  if (!bar.children.length) bar.append(el('div', 'props-note', t.hint || ''));
  bar.scrollTop = top;
}
function syncTool() {
  const t = app.tool; if (!t) return;
  document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t.id));
  buildOptbar(); view.cursor();
}

// ---------- tabs ----------
function buildTabs() {
  const bar = $('tabs'); bar.innerHTML = '';
  for (const d of app.docs) {
    const t = el('div', 'tab' + (d === app.doc ? ' active' : '')), x = el('span', 'x', '×');
    t.append(el('span', null, d.name + (d.dirty ? ' •' : '')), x);
    t.onclick = () => { if (d !== app.doc) { app.setDoc(d); if (d.view.fit) view.fit(); } };
    x.onclick = e => { e.stopPropagation(); app.run('file.close', d); }; x.title = 'Close';
    bar.append(t);
  }
  const add = el('div', 'tab add', '+'); add.title = tipOf('file.new') + '\nA4, Letter, journal columns, screen sizes or the clipboard image size'; add.onclick = () => app.run('file.new'); bar.append(add);
  document.title = app.doc ? app.doc.name + ' – SciFig' : 'SciFig';
}

// ---------- colour panel ----------
// The picker edits one target: the paint colours (foreground / background), or the stroke or fill of the
// selected shapes (of the next shape when nothing is selected), as in Illustrator.
function buildColorPanel() {
  const box = $('colorPanel'), top = el('div', 'cp-top'), sw = el('div', 'swatches'), fg = el('button', 'sw fg'), bg = el('button', 'sw bg'), swap = el('button', 'mini', '⇄'), tg = el('div', 'tgt'), recent = el('div', 'recent');
  const bS = el('button'), bF = el('button'), iS = el('i'), iF = el('i'), none = el('button', 'mini', '∅');
  bS.append(iS, 'Stroke'); bF.append(iF, 'Fill'); tg.append(bS, bF, none);
  let which = 'fg', hadSel = false;
  fg.title = 'Foreground colour: brush, bucket, new text'; bg.title = 'Background colour'; swap.title = 'Swap foreground and background  (X)';
  bS.title = 'Line colour of the selected shapes (or of the next shape)'; bF.title = 'Fill colour of the selected shapes (or of the next shape)'; none.title = 'No colour (for stroke or fill)';
  const shapes = () => { const d = app.doc; return d ? d.selected() : []; };
  const cur = t => { if (t === 'fg' || t === 'bg') return app[t]; const sel = shapes(); if (!sel.length) return app.settings.style[t]; const s = sel[0].s, st = s.st || {}; return s.type === 'text' ? st.fill : st[t]; };
  const set = (c, fin) => {
    if (which === 'fg' || which === 'bg') { app.setColor(which, c); if (fin && c) remember(c); return; }
    const sel = shapes(); app.settings.style[which] = c; app.saveSettings();
    for (const { s, L } of sel) { const st = s.st || (s.st = {}); if (s.type === 'text') { if (c) st.fill = c; } else if (s.type === 'dim') { if (c) st.stroke = c; } else st[which] = c; L.touch(); }
    if (fin) { if (sel.length) app.commit('Colour'); else app.refresh('tool'); if (c) remember(c); sync(); } else { app.refresh('render'); paintSw(); }
  };
  const pk = colorPicker(app.fg, set, true);
  const remember = c => { const r = app.settings.recent || (app.settings.recent = []); const i = r.indexOf(c); if (i >= 0) r.splice(i, 1); r.unshift(c); r.length = Math.min(r.length, 16); app.saveSettings(); drawRecent(); };
  const drawRecent = () => { recent.innerHTML = ''; for (const c of [...(app.settings.recent || []), '#000000', '#ffffff', '#e04848', '#ff9f1a', '#ffd23f', '#3cb44b', '#19c3c3', '#4878e8', '#9b59d0', '#888888'].slice(0, 20)) { const b = el('button', 'chip'); b.style.background = c; b.title = c; b.onclick = () => set(c, true); recent.append(b); } };
  const paintSw = () => { fg.style.background = app.fg; bg.style.background = app.bg; for (const [i, t] of [[iS, 'stroke'], [iF, 'fill']]) { const c = cur(t); i.style.background = cssPaint(c); i.classList.toggle('none', !c); } };
  const sync = () => {
    const has = shapes().length > 0;
    if (has && !hadSel && (which === 'fg' || which === 'bg')) which = shapes()[0].s.type === 'text' || !(shapes()[0].s.st || {}).stroke ? 'fill' : 'stroke'; // a shape was just selected: edit its colour
    if (!has && hadSel && which !== 'fg' && which !== 'bg') which = 'fg';
    hadSel = has; paintSw();
    fg.classList.toggle('on', which === 'fg'); bg.classList.toggle('on', which === 'bg'); bS.classList.toggle('on', which === 'stroke'); bF.classList.toggle('on', which === 'fill');
    none.style.visibility = which === 'stroke' || which === 'fill' ? '' : 'hidden';
    const c = cur(which); if (c) pk.set(isGrad(c) ? c.stops[0].c : c);
  };
  fg.onclick = () => { which = 'fg'; sync(); }; bg.onclick = () => { which = 'bg'; sync(); }; bS.onclick = () => { which = 'stroke'; sync(); }; bF.onclick = () => { which = 'fill'; sync(); };
  none.onclick = () => set(null, true);
  swap.onclick = () => { const a = app.fg; app.fg = app.bg; app.setColor('bg', a); };
  sw.append(bg, fg); top.append(sw, swap, tg); box.append(top, pk.el, recent);
  app.on('colors', sync); app.on('props', sync); sync(); drawRecent();
}

// ---------- layers panel ----------
function buildLayers() {
  const list = $('layers'), head = $('layerHead'), d = app.doc; list.innerHTML = ''; head.innerHTML = '';
  buildChannels();
  if (!d) return;
  const A = d.active;
  const blend = el('select'); for (const b of BLENDS) blend.append(el('option', null, b)); blend.value = A ? A.blend : 'normal'; blend.disabled = !A || A.type === 'adjust'; blend.title = 'Blend mode of the layer';
  blend.onchange = () => { A.blend = blend.value; app.commit('Blend mode'); };
  const op = el('input'); op.type = 'range'; op.min = 0; op.max = 100; op.value = A ? Math.round(A.opacity * 100) : 100; op.disabled = !A; op.title = 'Layer opacity';
  const lab = el('span', null, op.value + '%'); lab.style.width = '34px';
  op.oninput = () => { A.opacity = op.value / 100; lab.textContent = op.value + '%'; A._lut = null; app.refresh('render'); }; op.onchange = () => app.commit('Layer opacity');
  head.append(blend, op, lab);
  const selMode = e => e.shiftKey ? 'add' : e.altKey ? 'sub' : 'replace';
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const L = d.layers[i], row = el('div', 'layer' + (L === A ? ' active' : ''));
    const eye = el('span', 'eye' + (L.visible ? '' : ' off'), '●'); eye.title = 'Show / hide';
    eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; app.commit(L.visible ? 'Show layer' : 'Hide layer'); };
    const th = el('span', 'thumb' + (L === A && !d.editMask ? ' on' : '')); if (L.type === 'adjust') th.textContent = 'fx'; else th.append(thumb(d, L));
    th.title = `${isMac ? '⌘' : 'Ctrl'}-click: select what is on this layer (Shift adds, Alt subtracts)`;
    const pick = e => { e.preventDefault(); e.stopPropagation(); app.run('select.fromLayer', L, selMode(e)); };
    th.onclick = e => { if (e.metaKey || e.ctrlKey) { pick(e); return; } e.stopPropagation(); d.activeId = L.id; d.editMask = false; app.refresh('layers', 'props', 'tool', 'overlay'); };
    th.oncontextmenu = e => { if (e.ctrlKey) pick(e); };
    row.append(eye, th);
    if (L.mask) {
      const mt = el('span', 'thumb mask' + (L === A && d.editMask ? ' on' : '') + (L.maskOn ? '' : ' off')); mt.append(maskThumb(d, L));
      mt.title = `Layer mask. Click: paint on the mask. Shift-click: turn it off or on. ${isMac ? '⌘' : 'Ctrl'}-click: load it as a selection`;
      const load = e => { e.preventDefault(); e.stopPropagation(); app.run('select.fromMask', L, selMode(e)); };
      mt.onclick = e => { e.stopPropagation(); if (e.metaKey || e.ctrlKey) { load(e); return; } if (e.shiftKey) { L.maskOn = !L.maskOn; app.commit(L.maskOn ? 'Enable mask' : 'Disable mask'); return; } d.activeId = L.id; d.editMask = true; app.refresh('layers', 'props', 'tool', 'overlay'); };
      mt.oncontextmenu = e => { if (e.ctrlKey) load(e); };
      row.append(mt);
    }
    const name = el('span', 'name', L.name);
    name.ondblclick = e => { e.stopPropagation(); const inp = el('input'); inp.type = 'text'; inp.value = L.name; name.textContent = ''; name.append(inp); inp.focus(); inp.select();
      const done = () => { L.name = inp.value.trim() || L.name; app.commit('Rename layer'); }; inp.onblur = done; inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); }; };
    const kind = el('span', 'kind', L.type === 'raster' ? (L.hd ? `image · ${L.hd.bits}-bit` : 'image') : L.type === 'vector' ? `vector · ${L.shapes.length}` : 'adjust');
    const lock = el('span', 'lock' + (L.locked ? '' : ' off'), L.locked ? '🔒' : '🔓'); lock.title = 'Lock';
    lock.onclick = e => { e.stopPropagation(); L.locked = !L.locked; app.commit(L.locked ? 'Lock layer' : 'Unlock layer'); };
    row.append(name, kind, lock);
    row.onclick = () => { if (d.activeId !== L.id) { d.activeId = L.id; d.editMask = false; app.refresh('layers', 'props', 'tool', 'overlay'); } };
    row.oncontextmenu = e => { if (e.defaultPrevented) return; e.preventDefault(); d.activeId = L.id; app.refresh('layers', 'props', 'tool');
      popupMenu(['layer.duplicate', 'layer.delete', '-', 'layer.maskAdd', 'layer.maskHide', 'layer.maskInvert', 'layer.maskApply', 'layer.maskDelete', '-', 'select.fromLayer', 'layer.merge', 'layer.rasterize', 'edit.transform', '-', 'layer.flatten'], e.clientX, e.clientY); };
    row.draggable = true;
    row.ondragstart = e => { e.dataTransfer.setData('text/scifig-layer', L.id); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragover = e => { e.preventDefault(); row.classList.add('dragover'); };
    row.ondragleave = () => row.classList.remove('dragover');
    row.ondrop = e => { e.preventDefault(); row.classList.remove('dragover'); const src = d.layer(e.dataTransfer.getData('text/scifig-layer')); if (!src || src === L) return;
      d.layers.splice(d.layers.indexOf(src), 1); d.layers.splice(d.layers.indexOf(L) + 1, 0, src); app.commit('Reorder layers'); };
    list.append(row);
  }
}
function buildLayerFoot() {
  const f = $('layerFoot');
  const btn = (label, title, fn) => { const b = el('button', null, label); b.title = title; b.onclick = fn; f.append(b); return b; };
  const add = btn('＋', 'Add a layer: image, vector, adjustment, mask, from a file…', () => { const r = add.getBoundingClientRect();
    popupMenu(['layer.newRaster', 'layer.newVector', 'file.place', 'layer.fromSel', '-', ...[...app.adjustments.keys()].map(k => 'adjust.' + k), '-', 'layer.maskAdd', 'layer.maskHide'], r.left, r.top - 420); });
  btn('◐', tipOf('layer.maskAdd') + '\nWhite shows the layer, black hides it. Works on image, vector and adjustment layers.', () => app.run('layer.maskAdd'));
  btn('⧉', tipOf('layer.duplicate'), () => app.run('layer.duplicate'));
  btn('⤓', tipOf('layer.merge'), () => app.run('layer.merge'));
  btn('🗑', tipOf('layer.delete'), () => app.run('layer.delete'));
}

// ---------- channels panel ----------
const CHANS = { rgb: [['Red', '#e04848'], ['Green', '#3cb44b'], ['Blue', '#4878e8'], ['Alpha', '#999']], lab: [['Lightness', '#ddd'], ['a  (green–red)', '#c05a7a'], ['b  (blue–yellow)', '#c9b037']] };
function buildChannels() {
  const box = $('tabChannels'), d = app.doc; box.innerHTML = ''; if (!d) return;
  const head = el('div', 'layer-head'), mode = el('select'); for (const [v, t] of [['rgb', 'RGB + Alpha'], ['lab', 'Lab']]) { const o = el('option', null, t); o.value = v; mode.append(o); }
  mode.value = d.chan.mode; mode.title = 'Which channels to show and edit'; mode.onchange = () => { d.chan = { mode: mode.value, edit: null }; app.refresh('layers', 'render', 'tool'); };
  head.append(el('span', null, 'Mode'), mode); box.append(head);
  const E = d.chan.edit, names = CHANS[d.chan.mode], setE = e => { d.chan.edit = e && e.length && e.length < names.length ? e.slice().sort() : null; app.refresh('layers', 'render', 'tool'); };
  const comp = el('div', 'layer chan' + (!E ? ' active' : '')); comp.append(el('span', 'dot'), el('span', 'name', d.chan.mode === 'rgb' ? 'RGB (all channels)' : 'Lab (all channels)')); comp.onclick = () => setE(null); box.append(comp);
  names.forEach(([n, col], i) => {
    const on = !E || E.includes(i), row = el('div', 'layer chan' + (E && on ? ' active' : '')), dot = el('span', 'dot'); dot.style.background = col;
    const ld = el('span', 'load', '◌'); ld.title = 'Load this channel as a selection (bright = selected)'; ld.onclick = e => { e.stopPropagation(); app.run('select.fromChannel', i, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'replace'); };
    row.append(dot, el('span', 'name', n), ld);
    row.title = `Click: view and edit only this channel. Shift-click: add or remove it. ${isMac ? '⌘' : 'Ctrl'}-click: load it as a selection.`;
    row.onclick = e => { if (e.metaKey || e.ctrlKey) { app.run('select.fromChannel', i, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'replace'); return; }
      if (e.shiftKey) { const cur = E ? E.slice() : names.map((_, k) => k); const j = cur.indexOf(i); if (j >= 0) cur.splice(j, 1); else cur.push(i); setE(cur); } else setE([i]); };
    row.oncontextmenu = e => { if (e.ctrlKey) { e.preventDefault(); app.run('select.fromChannel', i, 'replace'); } };
    box.append(row);
  });
  box.append(el('div', 'chan-note', E ? 'Brush, eraser, stamp, fills and filters now change only the highlighted channel' + (E.length > 1 ? 's' : '') + ' of image layers. One channel alone is shown in grey.' : 'Click a channel to view it and to limit painting and filters to it.'));
}

// ---------- properties panel: settings of the active adjustment or high-bit layer, document facts ----------
function buildProps() {
  buildOptbar();
  const box = $('props'), d = app.doc; box.innerHTML = '';
  const A = d && d.active;
  $('p-props').classList.toggle('empty', !(A && (A.type === 'adjust' || A.hd))); // only shown when the layer has settings
  if (!d) return;
  if (A && A.type === 'adjust') {
    const adj = app.adjustments.get(A.adj); let hist = null;
    const below = () => { if (!hist) { const v = A.visible; A.visible = false; hist = histogram(d); A.visible = v; } return hist; };
    box.append(el('div', 'props-title', adj ? adj.title : A.adj));
    if (adj && adj.params.length) box.append(paramUI(adj.params.map(p => p.type === 'curve' ? { ...p, hist: below } : p), A.params, (id, v, fin) => { A.touch(); if (fin) app.commit(adj.title); else app.refresh('render'); }));
    else box.append(el('div', 'props-sub', 'No settings'));
    if (adj && adj.id === 'levels') { const c = el('canvas', 'histo'); c.width = 256; c.height = 70; drawHistInto(c.getContext('2d'), 256, 70, below()); box.append(c, paramUI([{ type: 'button', label: 'Auto (stretch to histogram)', click: () => app.run('image.autoLevels', A) }], {}, () => {})); }
    box.append(el('div', 'props-sub', 'Affects every layer below it' + (A.mask ? ', through its mask' : '')));
    return;
  }
  if (A && A.hd) {
    const hd = A.hd; let t = null;
    box.append(el('div', 'props-title', `Develop · ${hd.bits}-bit ${hd.src || 'image'}`));
    box.append(paramUI(DEV_PARAMS, hd.dev, (id, v, fin) => { clearTimeout(t); const go = () => { developHD(A); if (fin) app.commit('Develop'); else app.refresh('render'); }; if (fin) go(); else t = setTimeout(go, 60); }));
    box.append(paramUI([{ type: 'button', label: 'Auto range (black and white point)', tip: 'Stretch the display to the darkest and brightest 0.1% of the data', click: () => { Object.assign(hd.dev, autoRange(hd)); developHD(A); app.commit('Auto range'); } },
      { type: 'button', label: 'Reset', click: () => { Object.assign(hd.dev, { ev: 0, black: 0, white: 1, gamma: 1, temp: 0, tint: 0, tone: 'none' }); developHD(A); app.commit('Reset develop'); } }], {}, () => {}));
    box.append(el('div', 'props-note', 'The pixels stay in 32-bit float. These settings only decide how they are shown and exported; filters, transforms and File ▸ Export ▸ 16/32-bit keep the full precision.'));
    return;
  }
  box.append(el('div', 'props-title', A ? A.name : 'Document'));
  box.append(el('div', 'props-note', `${d.w} × ${d.h} px · ${fmt(d.w / d.dpi * 25.4, 1)} × ${fmt(d.h / d.dpi * 25.4, 1)} mm at ${d.dpi} dpi` + (A && A.type === 'raster' ? `\nLayer: ${A.canvas.width} × ${A.canvas.height} px at ${A.x}, ${A.y}` : '') + '\nThe bar under the menu shows the options of the tool and of the selected object.'));
}

// ---------- status bar ----------
function buildStatus() {
  const s = $('status'); s.innerHTML = '';
  const zoomEl = el('span', 'st-btn'), pos = el('span'), size = el('span'), unit = el('select'), snapB = el('span', 'st-btn', 'Snap'), snapMore = el('span', 'st-btn', '▾'), gridB = el('span', 'st-btn', 'Grid'), hint = el('span', 'grow');
  zoomEl.title = tipOf('view.fit'); zoomEl.onclick = () => app.run('view.fit');
  snapB.title = tipOf('view.snap'); snapB.onclick = () => app.run('view.snap'); gridB.title = tipOf('view.grid'); gridB.onclick = () => app.run('view.grid');
  snapMore.title = 'Snap settings'; snapMore.onclick = e => { e.stopPropagation(); snapPopover(snapMore); };
  unit.title = 'Units for rulers, typed lengths and sizes'; unit.onchange = () => { const d = app.doc; if (!d) return; if (unit.value === 'cal') { app.run('image.setScale'); return; } d.setUnit(unit.value); app.commit('Units'); };
  pos.style.minWidth = '170px'; s.append(zoomEl, pos, size, unit, snapB, snapMore, gridB, hint);
  const sync = () => { const d = app.doc, t = app.tool; zoomEl.textContent = d ? fmt(d.view.zoom * 100, 1) + '%' : ''; size.textContent = d ? `${d.w} × ${d.h} px` : '';
    if (document.activeElement !== unit) { unit.innerHTML = ''; unit.style.display = d ? '' : 'none';
      if (d) { const std = Object.keys(UNITS), opts = std.includes(d.unit) ? std : [d.unit, ...std]; for (const u of opts) unit.append(el('option', null, u)); const c = el('option', null, 'calibrate…'); c.value = 'cal'; unit.append(c); unit.value = d.unit; } }
    snapB.classList.toggle('on', app.settings.snap.on); gridB.classList.toggle('on', app.settings.grid.show);
    hint.textContent = t && t.hint ? t.hint : ''; hint.title = t && t.hint ? t.hint : ''; };
  app.on('render', sync); app.on('docs', sync); app.on('tool', sync);
  app.on('cursor', p => { const d = app.doc; if (d) pos.textContent = `${fmt(d.toU(p.x), 3)}, ${fmt(d.toU(p.y), 3)} ${d.unit}`; });
}
function snapPopover(anchor) {
  document.querySelectorAll('.popover').forEach(p => p.remove());
  const p = el('div', 'popover'), S = app.settings.snap;
  for (const [k, label] of [['end', 'Endpoints and corners'], ['mid', 'Midpoints'], ['center', 'Centres'], ['inter', 'Intersections'], ['perp', 'Perpendicular'], ['near', 'Nearest point on edge'], ['align', 'Alignment guides'], ['grid', 'Grid']]) {
    const l = el('label'), c = el('input'); c.type = 'checkbox'; c.checked = S[k]; c.onchange = () => { S[k] = c.checked; app.saveSettings(); }; l.append(c, label); p.append(l);
  }
  const l = el('label', null, 'Shift angle step ° '), n = el('input'); n.type = 'number'; n.value = S.angle; n.style.width = '56px'; n.onchange = () => { S.angle = Math.max(1, +n.value || 45); app.saveSettings(); }; l.append(n); p.append(l);
  const g = el('label', null, 'Grid spacing (units) '), gn = el('input'); gn.type = 'number'; gn.value = app.settings.grid.size; gn.style.width = '56px'; gn.onchange = () => { app.settings.grid.size = Math.max(1e-6, +gn.value || 10); app.saveSettings(); app.refresh('overlay'); }; g.append(gn); p.append(g);
  document.body.append(p);
  const r = anchor.getBoundingClientRect(), q = p.getBoundingClientRect(); p.style.left = Math.min(r.left, innerWidth - q.width - 6) + 'px'; p.style.top = r.top - q.height - 6 + 'px';
  const off = e => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}
// Small popover with a tool's options (right-click with a brush).
export function toolPopover(t, x, y) {
  document.querySelectorAll('.popover').forEach(p => p.remove());
  const p = el('div', 'popover'); p.append(el('div', 'props-title', t.title), paramUI(t.options, t.opt, () => { app.saveSettings(); app.refresh('tool', 'overlay'); }));
  p.style.width = '260px'; document.body.append(p);
  const q = p.getBoundingClientRect(); p.style.left = Math.max(4, Math.min(x, innerWidth - q.width - 6)) + 'px'; p.style.top = Math.max(4, Math.min(y, innerHeight - q.height - 6)) + 'px';
  const off = e => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}

// ---------- command palette / help search ----------
export function openPalette(initial = '') {
  if (document.querySelector('.palette')) return;
  const ov = el('div', 'overlay'), box = el('div', 'palette'), inp = el('input'), res = el('div', 'results'), detail = el('div', 'detail');
  inp.placeholder = 'Search tools, commands, filters and help…  (try "halftone", "perpendicular", "mask", "mtf")'; inp.value = initial; inp.spellcheck = false;
  box.append(inp, res, detail); ov.append(box); document.body.append(ov);
  const entries = [];
  for (const t of app.tools.values()) entries.push({ tag: 'Tool', title: t.title, desc: t.hint || '', key: t.keyb, text: (t.title + ' ' + (t.hint || '')).toLowerCase(), run: () => app.setTool(t.id) });
  for (const c of app.commands.values()) if (!c.hidden) entries.push({ tag: c.kind === 'filter' ? 'Filter' : c.kind === 'adjust' ? 'Adjust' : 'Command', title: c.title, desc: c.desc || '', key: keyLabel(c.shortcut), text: (c.title + ' ' + (c.desc || '') + ' ' + (c.keywords || '') + ' ' + c.id).toLowerCase(), run: () => app.run(c.id), off: c.enabled && !c.enabled() });
  for (const h of app.help) entries.push({ tag: 'Help', title: h.title, desc: h.text.split('\n')[0], text: (h.title + ' ' + h.text + ' ' + (h.keywords || '')).toLowerCase(), help: h.text });
  let list = [], idx = 0;
  const close = () => ov.remove();
  const render = () => {
    const words = inp.value.toLowerCase().split(/\s+/).filter(Boolean);
    list = entries.map(e => { let sc = 0; const tl = e.title.toLowerCase(); for (const w of words) { if (!e.text.includes(w)) return null; sc += tl.startsWith(w) ? 4 : tl.includes(w) ? 2 : 1; } return { e, sc: sc + (e.tag === 'Help' && words.length ? 0.5 : 0) }; })
      .filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 60).map(o => o.e);
    idx = Math.min(idx, Math.max(0, list.length - 1)); res.innerHTML = '';
    list.forEach((e, i) => { const r = el('div', 'res' + (i === idx ? ' sel' : '')); r.append(el('span', 'tag', e.tag), el('span', null, e.title), el('span', 'desc', e.desc)); if (e.key) r.append(el('kbd', null, e.key)); if (e.off) r.style.opacity = 0.5;
      r.onmousemove = () => { if (idx !== i) { idx = i; render(); } }; r.onclick = () => go(e); res.append(r); });
    const cur = list[idx]; detail.textContent = cur ? (cur.help || (cur.desc && cur.desc.length > 70 ? cur.desc : '')) : 'Nothing found. Try fewer or different words.';
    const selEl = res.children[idx]; if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  };
  const go = e => { if (e.help) return; close(); e.run(); };
  inp.oninput = () => { idx = 0; render(); };
  inp.onkeydown = e => { e.stopPropagation();
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowDown') { idx = Math.min(list.length - 1, idx + 1); render(); e.preventDefault(); } else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && list[idx]) go(list[idx]); };
  ov.onpointerdown = e => { if (e.target === ov) close(); };
  render(); inp.focus(); inp.select();
}

export function initUI() {
  buildMenubar(); buildToolbar(); buildLayerFoot(); buildStatus(); buildColorPanel();
  app.on('tool', syncTool); app.on('docs', buildTabs); app.on('layers', buildLayers); app.on('props', buildProps);
  $('searchBtn').onclick = () => openPalette(); $('searchKey').textContent = keyLabel('Mod+K'); $('searchBtn').title = 'Search every tool, command, filter and help topic  (' + keyLabel('Mod+K') + ')';
  document.querySelectorAll('[data-cmd]').forEach(b => { b.onclick = () => app.run(b.dataset.cmd); b.title = tipOf(b.dataset.cmd); });
  // panel tabs (Layers | Channels) and collapsible panels
  document.querySelectorAll('#p-layers [data-tab]').forEach(t => { t.onclick = () => { document.querySelectorAll('#p-layers [data-tab]').forEach(q => q.classList.toggle('on', q === t)); $('tabLayers').hidden = t.dataset.tab !== 'layers'; $('tabChannels').hidden = t.dataset.tab !== 'channels'; }; });
  const np = $('npanel'); np.classList.toggle('min', !!app.settings.npMin); $('npHead').onclick = () => { app.settings.npMin = !np.classList.toggle('min') ? false : true; app.saveSettings(); };
  np.addEventListener('wheel', e => e.stopPropagation()); np.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.blur) e.target.blur(); });
  document.querySelectorAll('.panel > h3.fold').forEach(h => { h.title = 'Click to fold or unfold'; h.onclick = () => h.parentElement.classList.toggle('folded'); });
  document.documentElement.dataset.theme = app.settings.theme;
  $('stage').classList.toggle('norulers', !app.settings.rulers);
}
export { UNITS };
