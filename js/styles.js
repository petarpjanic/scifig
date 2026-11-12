// Gradient presets, one-click style templates for shapes, and the paint popover (solid colour | gradient | none).
import { app } from './app.js';
import { isGrad, cssPaint, solidOf } from './core.js';
import { colorPicker } from './color.js';

const G = (name, g, angle, ...stops) => ({ name, paint: { g, angle, stops: stops.map(([o, c, a]) => ({ o, c, a: a ?? 1 })) } });
export const GRADIENTS = [
  G('Grey', 'linear', 270, [0, '#ffffff'], [1, '#b8bcc4']),
  G('Ocean', 'linear', 270, [0, '#6dd5ed'], [1, '#2193b0']),
  G('Sunset', 'linear', 270, [0, '#feb47b'], [1, '#ff7e5f']),
  G('Fire', 'linear', 270, [0, '#ffe259'], [0.5, '#ff7f2a'], [1, '#b0170f']),
  G('Forest', 'linear', 270, [0, '#a8e063'], [1, '#2f7a3b']),
  G('Night', 'linear', 270, [0, '#4b6cb7'], [1, '#182848']),
  G('Viridis', 'linear', 0, [0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']),
  G('Magma', 'linear', 0, [0, '#000004'], [0.3, '#3b0f70'], [0.55, '#8c2981'], [0.8, '#fe9f6d'], [1, '#fcfdbf']),
  G('Cool–warm', 'linear', 0, [0, '#3b4cc0'], [0.5, '#dddddd'], [1, '#b40426']),
  G('Rainbow', 'linear', 0, [0, '#e04848'], [0.2, '#ff9f1a'], [0.4, '#ffd23f'], [0.6, '#3cb44b'], [0.8, '#4878e8'], [1, '#9b59d0']),
  G('Metal', 'linear', 270, [0, '#f4f5f7'], [0.45, '#a3a8b0'], [0.55, '#8c929b'], [1, '#e1e3e7']),
  G('Gold', 'linear', 270, [0, '#fff3b0'], [0.5, '#d4a017'], [1, '#8a6200']),
  G('Glass', 'linear', 270, [0, '#ffffff', 0.85], [0.5, '#ffffff', 0.25], [1, '#ffffff', 0.05]),
  G('Fade out', 'linear', 0, [0, '#4878e8'], [1, '#4878e8', 0]),
  G('Glow', 'radial', 0, [0, '#fffbe0'], [0.35, '#ffd23f', 0.85], [1, '#ffd23f', 0]),
  G('Sphere', 'radial', 0, [0, '#ffffff'], [0.3, '#7db4ff'], [1, '#1a3f8a']),
  G('Spot', 'radial', 0, [0, '#000000', 0.55], [1, '#000000', 0]),
  G('Halo', 'radial', 0, [0, '#ffffff', 0], [0.7, '#4cc3ff', 0.6], [1, '#4cc3ff', 0]),
];
export const gradByName = n => JSON.parse(JSON.stringify((GRADIENTS.find(g => g.name === n) || GRADIENTS[0]).paint));
const SH = { c: '#000000', a: 0.4, blur: 8, x: 3, y: 4 };
// Style templates: what they set on a shape's style (line widths in pt; null removes).
export const STYLES = [
  { name: 'Outline', st: { stroke: '#000000', swPt: 1, fill: null, shadow: null } },
  { name: 'Filled', st: { stroke: null, fill: '#4878e8', shadow: null } },
  { name: 'Box', st: { stroke: '#333333', swPt: 0.75, fill: '#ffffff', shadow: null } },
  { name: 'Card', st: { stroke: null, fill: '#ffffff', shadow: SH } },
  { name: 'Soft', st: { stroke: '#9aa0a8', swPt: 0.75, fill: 'Grey', shadow: { ...SH, a: 0.25 } } },
  { name: 'Ocean', st: { stroke: '#1a6f86', swPt: 0.75, fill: 'Ocean', shadow: null } },
  { name: 'Sunset', st: { stroke: null, fill: 'Sunset', shadow: null } },
  { name: 'Metal', st: { stroke: '#5b6068', swPt: 0.75, fill: 'Metal', shadow: { ...SH, a: 0.3 } } },
  { name: 'Gold', st: { stroke: '#7a5600', swPt: 0.75, fill: 'Gold', shadow: null } },
  { name: 'Glass', st: { stroke: '#ffffff', swPt: 0.75, fill: 'Glass', shadow: null } },
  { name: 'Sphere', st: { stroke: null, fill: 'Sphere', shadow: { ...SH, a: 0.3 } } },
  { name: 'Glow', st: { stroke: null, fill: 'Glow', shadow: null } },
  { name: 'Highlight', st: { stroke: null, fill: '#ffd23f', alpha: 0.4, shadow: null } },
  { name: 'Heat map', st: { stroke: null, fill: 'Viridis', shadow: null } },
  { name: 'Callout', st: { stroke: '#000000', swPt: 1, fill: '#fffbe6', shadow: { ...SH, a: 0.25 } } },
  { name: 'Dashed', st: { stroke: '#000000', swPt: 1, fill: null, dash: 'dashed', shadow: null } },
];
// The style of a template, resolved for a document (gradient names become gradients, pt become px).
export function styleOf(t, d) {
  const o = {};
  for (const [k, v] of Object.entries(t.st)) {
    if (k === 'swPt') o.sw = v * d.ptPx; else if ((k === 'fill' || k === 'stroke') && typeof v === 'string' && !v.startsWith('#')) o[k] = gradByName(v);
    else o[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  if (!('alpha' in o)) o.alpha = 1; if (!('dash' in o)) o.dash = 'solid';
  return o;
}
// Small preview of a template.
export function styleChip(t) {
  const b = document.createElement('button'), i = document.createElement('i'), st = t.st, fill = typeof st.fill === 'string' && !st.fill.startsWith('#') ? gradByName(st.fill) : st.fill;
  b.className = 'stylechip'; b.title = t.name;
  i.style.background = fill ? cssPaint(fill) : 'transparent'; i.style.border = st.stroke ? `${Math.max(1, Math.round(st.swPt * 1.3))}px ${st.dash === 'dashed' ? 'dashed' : 'solid'} ${st.stroke}` : '1px solid transparent';
  if (st.shadow) i.style.boxShadow = `2px 3px 5px rgba(0,0,0,${st.shadow.a})`; if (st.alpha) i.style.opacity = st.alpha;
  b.append(i, document.createTextNode(t.name)); return b;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// Popover for a stroke or fill: Solid | Gradient | None. opts: {paint, none, gradient, onChange(paint, final)}
export function pickPaint(anchor, opts) {
  document.querySelectorAll('.popover.colorpop').forEach(p => p.remove());
  const pop = el('div', 'popover colorpop'), tabs = el('div', 'ptabs2'), body = el('div');
  let paint = opts.paint && typeof opts.paint === 'object' ? JSON.parse(JSON.stringify(opts.paint)) : opts.paint, mode = isGrad(paint) ? 'grad' : paint ? 'solid' : 'none', sel = 0;
  const fire = fin => opts.onChange(paint && typeof paint === 'object' ? JSON.parse(JSON.stringify(paint)) : paint, fin);
  const tabBtn = (m, label) => { const b = el('button', null, label); b.onclick = () => { if (m === 'grad' && !isGrad(paint)) paint = (() => { const g = gradByName('Grey'); if (paint) g.stops = [{ o: 0, c: '#ffffff', a: 1 }, { o: 1, c: paint, a: 1 }]; return g; })();
    if (m === 'solid' && typeof paint !== 'string') paint = solidOf(paint) || '#000000'; if (m === 'none') paint = null; mode = m; fire(true); draw(); }; b.dataset.m = m; tabs.append(b); };
  tabBtn('solid', 'Colour'); if (opts.gradient !== false) tabBtn('grad', 'Gradient'); if (opts.none) tabBtn('none', 'None');
  const draw = () => {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === mode)); body.innerHTML = '';
    if (mode === 'none') { body.append(el('div', 'props-note', 'No colour. Choose Colour or Gradient to paint.')); return; }
    if (mode === 'solid') { body.append(colorPicker(paint, (c, fin) => { paint = c; fire(fin); }).el); return; }
    // gradient: presets, type and angle, a bar with stops, and the picker for the selected stop
    const pre = el('div', 'gpresets');
    for (const g of GRADIENTS) { const b = el('button', 'gchip'); b.title = g.name; b.style.background = cssPaint(g.paint); b.onclick = () => { paint = gradByName(g.name); sel = 0; fire(true); draw(); }; pre.append(b); }
    const row = el('div', 'grow2'), type = el('select'), ang = el('input'), rev = el('button', null, '⇄');
    for (const [v, t] of [['linear', 'Linear'], ['radial', 'Radial']]) { const o = el('option', null, t); o.value = v; type.append(o); }
    type.value = paint.g; type.onchange = () => { paint.g = type.value; fire(true); draw(); };
    ang.type = 'number'; ang.value = paint.angle || 0; ang.title = 'Angle in degrees (0 = left to right, 90 = bottom to top)'; ang.disabled = paint.g === 'radial'; ang.onkeydown = e => e.stopPropagation();
    ang.onchange = () => { paint.angle = +ang.value || 0; fire(true); draw(); }; rev.title = 'Reverse'; rev.onclick = () => { for (const s of paint.stops) s.o = 1 - s.o; paint.stops.sort((a, b) => a.o - b.o); fire(true); draw(); };
    row.append(type, el('span', null, '∠'), ang, rev);
    const bar = el('div', 'gbar'), prev = el('div', 'gprev'); prev.style.background = cssPaint({ ...paint, g: 'linear', angle: 0 }); bar.append(prev);
    paint.stops.forEach((s, i) => { const h = el('div', 'gstop' + (i === sel ? ' on' : '')); h.style.left = s.o * 100 + '%'; h.style.background = s.c; h.title = 'Drag to move, double-click to remove';
      h.onpointerdown = e => { e.stopPropagation(); sel = i; h.setPointerCapture(e.pointerId); const r = bar.getBoundingClientRect();
        h.onpointermove = ev => { s.o = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); h.style.left = s.o * 100 + '%'; prev.style.background = cssPaint({ ...paint, g: 'linear', angle: 0 }); fire(false); };
        h.onpointerup = () => { h.onpointermove = h.onpointerup = null; const c = paint.stops[sel]; paint.stops.sort((a, b) => a.o - b.o); sel = paint.stops.indexOf(c); fire(true); draw(); }; };
      h.ondblclick = () => { if (paint.stops.length > 2) { paint.stops.splice(i, 1); sel = 0; fire(true); draw(); } }; bar.append(h); });
    bar.onpointerdown = e => { const r = bar.getBoundingClientRect(), o = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), near = paint.stops.reduce((a, b) => Math.abs(b.o - o) < Math.abs(a.o - o) ? b : a);
      paint.stops.push({ o, c: near.c, a: near.a ?? 1 }); paint.stops.sort((a, b) => a.o - b.o); sel = paint.stops.findIndex(s => s.o === o); fire(true); draw(); };
    const s = paint.stops[sel] || paint.stops[0], op = el('div', 'grow2'), on = el('input'); on.type = 'range'; on.min = 0; on.max = 100; on.value = Math.round((s.a ?? 1) * 100);
    on.oninput = () => { s.a = on.value / 100; fire(false); }; on.onchange = () => { fire(true); draw(); }; op.append(el('span', null, 'Stop opacity'), on);
    body.append(pre, row, bar, el('div', 'props-note', 'Click the bar to add a stop, drag stops, double-click to remove. The picker below colours the selected stop.'), colorPicker(s.c, (c, fin) => { s.c = c; if (fin) { fire(true); draw(); } else { fire(false); bar.querySelectorAll('.gstop')[sel].style.background = c; prev.style.background = cssPaint({ ...paint, g: 'linear', angle: 0 }); } }, true).el, op);
  };
  pop.append(tabs, body); draw(); document.body.append(pop);
  const r = anchor.getBoundingClientRect(), q = pop.getBoundingClientRect();
  pop.style.left = Math.max(4, Math.min(r.left - q.width - 8, innerWidth - q.width - 6)) + 'px'; pop.style.top = Math.max(4, Math.min(r.top - 40, innerHeight - q.height - 6)) + 'px';
  const off = e => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  return pop;
}
export { app };
