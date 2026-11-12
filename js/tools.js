// All canvas tools. A tool is {id, title, key, icon, hint, options, down, move, up, dbl, key(e), draw(ctx, view), cancel}.
import { app } from './app.js';
import { view } from './view.js';
import { mk, copyCanvas, uid, dist, fmt, vectorLayer, hitShape, shapeBBox, bboxOf, keyPoints, transformShape, convertToPath, geomSubs, textCorners, textLayout, fontOf,
  mTranslate, mScaleAbout, mRotateAbout, mMul, mApply, closestOnSeg, cubicPt, renderDoc, flatten, drawShape, dimShapes, smoothShape, unitScale, shapePath, BLENDS } from './core.js';
import { snapPoint, resolve } from './snap.js';
import { setSelection, clearSelection, selChanged, applyThroughSelection, coverDoc, floodMask, maskToCanvas, hexToRgb, rgbToHex } from './imaging.js';
import { cropDoc } from './ops.js';
import { hdAffine } from './hd.js';
import { inpaint } from './inpaint.js';
import { objectMask, neuralFill } from './ai.js';
import { findAnchor, syncDims, driveDim, anchors } from './dims.js';

const D = () => app.doc;
const clone = o => JSON.parse(JSON.stringify(o));
const restoreShape = (s, o) => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, clone(o)); };
const scr = (a, b) => dist(a, b) * D().view.zoom; // distance in screen px

// What the pixel tools draw on: the active image layer, or its mask when the mask is being edited.
// The result looks like a layer ({canvas, ctx, x, y, touch}) so the same code paints both.
function paintTarget() {
  const d = D(), L = d.active;
  if (L && (L.locked || !L.visible)) { app.toast('That layer is locked or hidden'); return null; }
  if (d.editMask && L && L.mask) return { L, mask: true, canvas: L.mask, ctx: L.mask.getContext('2d'), x: 0, y: 0, touch: () => L.touchMask() };
  if (!L || L.type !== 'raster') { app.toast('Select an image layer to paint on (＋ in the Layers panel)'); return null; }
  coverDoc(d, L);
  return { L, mask: false, canvas: L.canvas, ctx: L.ctx, x: L.x, y: L.y, touch: () => L.touch() };
}
const maskLum = c => { const [r, g, b] = hexToRgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
// Move (or Alt: copy) the selected pixels of a layer by whole pixels; the selection outline moves with them.
function liftPixels(d, L, copy) {
  coverDoc(d, L);
  const fl = copyCanvas(L.canvas), f = fl.getContext('2d'); f.globalCompositeOperation = 'destination-in'; f.drawImage(d.sel, -L.x, -L.y);
  const base = copyCanvas(L.canvas); if (!copy) { const b = base.getContext('2d'); b.globalCompositeOperation = 'destination-out'; b.drawImage(d.sel, -L.x, -L.y); }
  return { fl, base };
}
function dropPixels(d, L, lift, dx, dy) {
  const x = L.ctx; x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(lift.base, 0, 0); x.globalCompositeOperation = 'source-over'; x.drawImage(lift.fl, dx, dy); x.restore();
}
export function shiftSelection(d, dx, dy) { const c = mk(d.w, d.h); c.getContext('2d').drawImage(d.sel, dx, dy); d.sel = c; selChanged(d); }
const inSel = (d, p) => !!d.sel && p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h && d.sel.getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 127;
// Rebuild the pixels under a mask (canvas in layer coordinates, alpha = where) from their surroundings.
// method 'ai' uses a neural network (downloaded on first use) and falls back to patch matching when it is not available.
export async function contentFill(T, maskCanvas, method = 'ai') {
  const w = T.canvas.width, h = T.canvas.height, m = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data, hole = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) if (m[i * 4 + 3] > 40) { hole[i] = 1; const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return false;
  if (method === 'ai') try {
    const pad = Math.max(96, Math.round(Math.max(x1 - x0, y1 - y0) * 1.2)), rx = Math.max(0, x0 - pad), ry = Math.max(0, y0 - pad), rw = Math.min(w, x1 + pad + 1) - rx, rh = Math.min(h, y1 + pad + 1) - ry;
    const img = T.ctx.getImageData(rx, ry, rw, rh), hc = new Uint8Array(rw * rh); for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) hc[y * rw + x] = hole[(y + ry) * w + x + rx];
    await neuralFill(img.data, hc, rw, rh); T.ctx.putImageData(img, rx, ry); T.touch(); return true;
  } catch (e) { console.warn('neural fill failed, using patch fill', e); app.toast('The AI fill could not be loaded (it needs the internet the first time). Used the quick patch method instead.', 5000); }
  const img = T.ctx.getImageData(0, 0, w, h);
  if (!inpaint(img, hole)) return false;
  T.ctx.putImageData(img, 0, 0); T.touch(); return true;
}
export function vectorTarget() {
  const d = D(); let L = d.active;
  if (!L || L.type !== 'vector' || L.locked) { L = vectorLayer(d.uniqueName('Vector')); d.add(L); }
  return L;
}
export function curStyle() {
  const s = app.settings.style;
  return { stroke: s.stroke, sw: s.swPt * D().ptPx, fill: s.fill, dash: s.dash, as: s.as, ae: s.ae, alpha: s.alpha, ...(s.dl ? { dl: s.dl } : {}), ...(s.dg ? { dg: s.dg } : {}), ...(s.hs && s.hs !== 1 ? { hs: s.hs } : {}) };
}
function addShape(s, label) {
  const d = D(), L = vectorTarget();
  s.id = uid(); L.shapes.push(s); L.touch();
  d.selShapes = new Set([s.id]); d.selNodes = [];
  app.commit(label);
  return s;
}
// Topmost shape under a document point.
function pick(p) {
  const d = D(), tol = 5 / d.view.zoom;
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const L = d.layers[i]; if (L.type !== 'vector' || !L.visible || L.locked) continue;
    for (let j = L.shapes.length - 1; j >= 0; j--) if (hitShape(L.shapes[j], p, tol)) return { s: L.shapes[j], L };
  }
  return null;
}
const dimText = (len, ang) => `${fmt(D().toU(len), 3)} ${D().unit}   ∠ ${fmt(ang, 1)}°`;
const angDeg = (a, b) => { const v = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI; return v < 0 ? v + 360 : v; };

// Typed coordinates while drawing. 5 = length along the cursor direction, 5<30 = length and angle,
// 3,4 = offset right/up, #3,4 = absolute position. Angles are counter-clockwise, y is up.
function typedPoint(buf, last, cur) {
  const d = D(), U = v => d.fromU(parseFloat(v)); let m;
  if ((m = /^#(-?[\d.]+),(-?[\d.]+)$/.exec(buf))) return { x: U(m[1]), y: U(m[2]) };
  if ((m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(buf))) return { x: last.x + U(m[1]), y: last.y - U(m[2]) };
  if ((m = /^(-?[\d.]*)<(-?[\d.]+)$/.exec(buf))) { const len = m[1] ? U(m[1]) : dist(last, cur), a = parseFloat(m[2]) * Math.PI / 180; return { x: last.x + len * Math.cos(a), y: last.y - len * Math.sin(a) }; }
  if (/^-?\d*\.?\d+$/.test(buf)) { const L = dist(last, cur), dx = L > 1e-9 ? (cur.x - last.x) / L : 1, dy = L > 1e-9 ? (cur.y - last.y) / L : 0, len = U(buf); return { x: last.x + dx * len, y: last.y + dy * len }; }
  return null;
}
const TYPE_KEY = /^[0-9.,<#\-]$/;
// Value boxes next to the cursor. Typing fills the active box (a typed box is locked), Tab moves to the next one.
// Lengths are in document units, or carry their own unit: 5mm, 0.2in, 40px, 12pt.
class Hud {
  constructor(defs) { this.defs = defs; this.reset(); } // defs: [{id, label, kind: 'len' | 'ang' | 'pos'}]
  reset() { this.i = 0; this.buf = this.defs.map(() => ''); }
  get any() { return this.buf.some(b => b !== ''); }
  key(e) {
    const k = e.key, b = this.buf[this.i];
    if (k === 'Tab') { const n = this.defs.length; this.i = (this.i + (e.shiftKey ? n - 1 : 1)) % n; return true; }
    if (e.metaKey || e.ctrlKey) return false;
    if (TYPE_KEY.test(k) || (b && /^[a-z]$/i.test(k) && 'pxmcint'.includes(k.toLowerCase()) && /[\da-z]$/i.test(b))) { this.buf[this.i] += k; return true; }
    if (k === 'Backspace' && b) { this.buf[this.i] = b.slice(0, -1); return true; }
    return false;
  }
  val(id) {
    const j = this.defs.findIndex(f => f.id === id), b = this.buf[j]; if (!b) return null;
    if (this.defs[j].kind === 'ang') { const v = parseFloat(b); return isFinite(v) ? v : null; }
    const m = /^(-?\d*\.?\d+)\s*(px|mm|cm|in|pt)?$/i.exec(b.trim()); if (!m) return null;
    return m[2] ? parseFloat(m[1]) * unitScale(m[2].toLowerCase(), D().dpi) : D().fromU(parseFloat(m[1]));
  }
  draw(ctx, live, x, y) {
    const d = D();
    view.hud(ctx, this.defs.map((f, j) => ({ label: f.label, typed: !!this.buf[j], active: j === this.i, unit: f.kind === 'ang' ? '°' : d.unit,
      text: this.buf[j] || (live[f.id] == null ? '' : f.kind === 'ang' ? fmt(live[f.id], 1) : fmt(d.toU(live[f.id]), 3)) })), x, y);
  }
}

// ---------- text editing overlay ----------
export function editText(s, L, isNew) {
  const d = D(), c = textCorners(s), p = view.S(c[0]), z = d.view.zoom;
  const ta = document.createElement('textarea');
  ta.className = 'text-edit'; ta.value = s.text || ''; ta.spellcheck = false;
  ta.style.left = p.x - 5 + 'px'; ta.style.top = p.y - 3 + 'px';
  ta.style.font = fontOf(s, Math.max(9, s.size * z)); ta.style.lineHeight = '1.25';
  ta.style.width = Math.max(120, textLayout(s).w * z + 40) + 'px'; ta.style.height = Math.max(1.6 * s.size * z, textLayout(s).h * z + 14) + 'px';
  view.vp.appendChild(ta);
  const old = s.text; s.text = ''; app.refresh('render');
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = ok ? ta.value : (isNew ? '' : old);
    ta.remove();
    s.text = v;
    if (!v.trim()) { const i = L.shapes.indexOf(s); if (i >= 0) L.shapes.splice(i, 1); d.selShapes.delete(s.id); }
    L.touch();
    if (v !== old || isNew) app.commit(isNew ? 'Text' : 'Edit text'); else app.refresh('all');
  };
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') finish(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true); });
  ta.addEventListener('blur', () => finish(true));
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
}

// ---------- navigation ----------
const hand = { id: 'hand', title: 'Hand', keyb: 'H', hint: 'Drag to pan. Hold Space with any tool to pan temporarily.', cursor: 'grab' };
const zoom = { id: 'zoom', title: 'Zoom', keyb: 'Z', hint: 'Drag a rectangle to zoom into that area. Click zooms in, Alt-click zooms out. The scroll wheel zooms with any tool.', cursor: 'zoom-in', a: null, b: null,
  down(ev) { this.a = { x: ev.sx, y: ev.sy }; this.b = this.a; },
  move(ev) { if (ev.drag && this.a) this.b = { x: ev.sx, y: ev.sy }; },
  up(ev) { const a = this.a, b = this.b; this.a = null; if (!a) return;
    if (dist(a, b) < 6) view.zoomAt(ev.alt ? 0.5 : 2, ev.sx, ev.sy); else view.zoomRect(view.toDoc(Math.min(a.x, b.x), Math.min(a.y, b.y)), view.toDoc(Math.max(a.x, b.x), Math.max(a.y, b.y))); },
  cancel() { this.a = null; },
  draw(ctx) { if (!this.a) return; ctx.strokeStyle = '#4c9ffe'; ctx.fillStyle = 'rgba(76,159,254,.12)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.rect(this.a.x, this.a.y, this.b.x - this.a.x, this.b.y - this.a.y); ctx.fill(); ctx.stroke(); } };

// ---------- select / move ----------
const select = {
  id: 'select', title: 'Select / Move', keyb: 'V', cursor: 'default',
  hint: 'Click a shape to select, drag to move (Alt-drag copies). Handles scale, the round knob rotates. Type numbers to move, size or rotate exactly (Tab changes box). On an image layer, drag moves the layer, or cuts and moves the selected pixels.',
  m: null, typing: false, num: new Hud([{ id: 'dx', label: 'ΔX', kind: 'len' }, { id: 'dy', label: 'ΔY', kind: 'len' }, { id: 'w', label: 'W', kind: 'len' }, { id: 'h', label: 'H', kind: 'len' }, { id: 'rot', label: '∠', kind: 'ang' }]),
  dimHandles() { const sel = D().selected(); if (sel.length !== 1 || sel[0].s.type !== 'dim') return null; const s = sel[0].s, q = dimShapes(s)[0].nodes; return { o: sel[0], pts: [{ ...s.a, k: 'a' }, { ...s.b, k: 'b' }, { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2, k: 'off' }] }; },
  handles() {
    const sel = D().selected(); if (!sel.length) return null;
    const b = bboxOf(sel.map(o => o.s)), z = D().view.zoom;
    const pts = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].map(([u, v]) => ({ x: b.x + b.w * u, y: b.y + b.h * v, u, v }));
    return { b, pts, knob: { x: b.x + b.w / 2, y: b.y - 24 / z } };
  },
  down(ev) {
    const d = D(), h = this.handles(), dh = this.dimHandles();
    const orig = () => new Map(d.selected().map(o => [o.s.id, clone(o.s)]));
    this.typing = false;
    if (dh) { const q = dh.pts.find(k => scr(ev.p, k) < 8); if (q) { this.m = { mode: 'dim', k: q.k, o: dh.o, moved: false }; return; } }
    if (h && !dh) {
      if (scr(ev.p, h.knob) < 8) { this.m = { mode: 'rotate', c: { x: h.b.x + h.b.w / 2, y: h.b.y + h.b.h / 2 }, start: ev.p, orig: orig() }; return; }
      const hp = h.pts.find(q => scr(ev.p, q) < 7);
      if (hp && (h.b.w > 0 || h.b.h > 0)) { this.m = { mode: 'scale', hp, b: h.b, orig: orig() }; return; }
    }
    const hit = pick(ev.p);
    if (hit && hit.s.type === 'dim' && !ev.shift && d.selShapes.size === 1 && d.selShapes.has(hit.s.id) && hitShape(dimShapes(hit.s)[3], ev.p, 2 / d.view.zoom)) { editDimValue(hit.s, hit.L); return; } // click the value of a selected dimension
    if (hit) {
      if (ev.shift) { if (d.selShapes.has(hit.s.id)) d.selShapes.delete(hit.s.id); else d.selShapes.add(hit.s.id); }
      else if (!d.selShapes.has(hit.s.id)) d.selShapes = new Set([hit.s.id]);
      d.activeId = hit.L.id; d.selNodes = [];
      // snap by the closest key point of what is being dragged
      let anchor = ev.p, best = 14 / d.view.zoom;
      const bb = bboxOf(d.selected().map(o => o.s));
      const cands = d.selected().flatMap(o => keyPoints(o.s)).concat([{ x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x, y: bb.y + bb.h }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 }]);
      for (const k of cands) { const q = dist(k, ev.p); if (q < best) { best = q; anchor = { x: k.x, y: k.y }; } }
      this.m = { mode: 'move', start: ev.p, anchor, orig: orig(), hit: hit.s.id, copy: ev.alt, moved: false, multi: !ev.shift };
      app.refresh('layers', 'props', 'overlay');
      return;
    }
    const L = d.active;
    if (!ev.shift && d.selShapes.size) { d.selShapes.clear(); app.refresh('props'); }
    if (L && L.type === 'raster' && !L.locked && d.sel && d.selBounds) this.m = { mode: 'pixels', start: ev.p, L, lift: liftPixels(d, L, ev.alt), dx: 0, dy: 0, moved: false };
    else if (L && L.type === 'raster' && !L.locked) this.m = { mode: 'layer', start: ev.p, ox: L.x, oy: L.y, L, moved: false };
    else this.m = { mode: 'marquee', start: ev.p, cur: ev.p };
  },
  move(ev) {
    const m = this.m, d = D(); view.snapMark = null;
    if (!m || !ev.drag) return;
    if (m.mode === 'move') {
      if (!m.moved && dist({ x: ev.sx, y: ev.sy }, view.S(m.start)) < 3) return;
      if (!m.moved && m.copy) { // leave the originals, drag fresh copies
        const ids = new Set(), no = new Map();
        for (const { s, L } of d.selected()) { const c = clone(s); c.id = uid(); L.shapes.push(c); ids.add(c.id); no.set(c.id, clone(c)); }
        d.selShapes = ids; m.orig = no;
      }
      m.moved = true;
      let dx = ev.p.x - m.start.x, dy = ev.p.y - m.start.y;
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      else { const r = snapPoint({ x: m.anchor.x + dx, y: m.anchor.y + dy }, { exclude: d.selShapes }); view.snapMark = r; dx = r.x - m.anchor.x; dy = r.y - m.anchor.y; }
      for (const { s } of d.selected()) { restoreShape(s, m.orig.get(s.id)); transformShape(s, mTranslate(dx, dy)); }
    } else if (m.mode === 'scale') {
      const { b, hp } = m, r = snapPoint(ev.p, { exclude: d.selShapes }); view.snapMark = r;
      const anchor = ev.alt ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: b.x + b.w * (1 - hp.u), y: b.y + b.h * (1 - hp.v) };
      let sx = hp.u === 0.5 || !b.w ? 1 : (r.x - anchor.x) / (hp.x - anchor.x), sy = hp.v === 0.5 || !b.h ? 1 : (r.y - anchor.y) / (hp.y - anchor.y);
      if (ev.shift) { if (hp.u === 0.5) sx = Math.abs(sy); else if (hp.v === 0.5) sy = Math.abs(sx); else { const k = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * k; sy = Math.sign(sy || 1) * k; } }
      if (Math.abs(sx) < 1e-4) sx = 1e-4; if (Math.abs(sy) < 1e-4) sy = 1e-4;
      for (const { s } of d.selected()) { restoreShape(s, m.orig.get(s.id)); transformShape(s, mScaleAbout(sx, sy, anchor)); }
      m.moved = true; m.info = `${fmt(sx * 100, 1)}% × ${fmt(sy * 100, 1)}%`;
    } else if (m.mode === 'rotate') {
      let a = Math.atan2(ev.p.y - m.c.y, ev.p.x - m.c.x) - Math.atan2(m.start.y - m.c.y, m.start.x - m.c.x);
      if (ev.shift) { const st = Math.PI / 12; a = Math.round(a / st) * st; }
      for (const { s } of d.selected()) { restoreShape(s, m.orig.get(s.id)); transformShape(s, mRotateAbout(a, m.c)); }
      m.moved = true; m.info = `${fmt(-a * 180 / Math.PI, 1)}°`;
    } else if (m.mode === 'dim') {
      const s = m.o.s;
      if (m.k === 'off') { const L = dist(s.a, s.b) || 1; s.off = ((ev.p.x - s.a.x) * -(s.b.y - s.a.y) + (ev.p.y - s.a.y) * (s.b.x - s.a.x)) / L; }
      else { const r = snapPoint(ev.p, { exclude: d.selShapes }); view.snapMark = r; s[m.k] = { x: r.x, y: r.y }; const ref = findAnchor(d, r, 2 / d.view.zoom); if (ref) s['r' + m.k] = ref; else delete s['r' + m.k]; if (s.lock != null) s.lock = dist(s.a, s.b); }
      m.moved = true;
    } else if (m.mode === 'pixels') {
      let dx = Math.round(ev.p.x - m.start.x), dy = Math.round(ev.p.y - m.start.y);
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      m.dx = dx; m.dy = dy; m.moved = m.moved || dx || dy; dropPixels(d, m.L, m.lift, dx, dy); view.selOffset = { x: dx, y: dy };
      m.info = `Δ ${fmt(d.toU(dx), 3)}, ${fmt(d.toU(-dy), 3)} ${d.unit}`;
    } else if (m.mode === 'layer') {
      let dx = Math.round(ev.p.x - m.start.x), dy = Math.round(ev.p.y - m.start.y);
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      m.L.x = m.ox + dx; m.L.y = m.oy + dy; m.moved = dx || dy;
    } else if (m.mode === 'marquee') m.cur = ev.p;
    if (m.mode !== 'marquee' && m.mode !== 'layer' && m.mode !== 'pixels') syncDims(d, m.mode !== 'dim'); // dimensions follow, and driving ones hold their length, while dragging
    app.refresh('render');
  },
  up(ev) {
    const m = this.m, d = D(); this.m = null; view.snapMark = null;
    if (!m) return;
    if (m.mode === 'marquee') {
      const x0 = Math.min(m.start.x, m.cur.x), y0 = Math.min(m.start.y, m.cur.y), x1 = Math.max(m.start.x, m.cur.x), y1 = Math.max(m.start.y, m.cur.y);
      if (scr(m.start, m.cur) > 3) for (const L of d.layers) if (L.type === 'vector' && L.visible && !L.locked) for (const s of L.shapes) {
        const b = shapeBBox(s); if (b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) d.selShapes.add(s.id);
      }
      app.refresh('props', 'overlay'); return;
    }
    if (m.mode === 'pixels') { view.selOffset = null; if (m.moved) { shiftSelection(d, m.dx, m.dy); m.L.touch(); app.commit('Move pixels'); } return; }
    if (m.moved) {
      if (m.mode !== 'layer') for (const { L } of d.selected()) L.touch();
      app.commit({ move: m.copy ? 'Copy shapes' : 'Move', scale: 'Scale', rotate: 'Rotate', layer: 'Move layer', dim: 'Edit dimension' }[m.mode]);
    } else if (m.mode === 'move' && m.multi && d.selShapes.size > 1) { d.selShapes = new Set([m.hit]); app.refresh('props', 'overlay'); }
  },
  dbl(ev) { const hit = pick(ev.p); if (hit && hit.s.type === 'text') editText(hit.s, hit.L, false); else if (hit && hit.s.type === 'dim') editDimValue(hit.s, hit.L); else if (hit) app.setTool('node'); },
  applyTyped() {
    const d = D(), sel = d.selected(), n = this.num, b = bboxOf(sel.map(o => o.s)), dx = n.val('dx') || 0, dy = n.val('dy') || 0, w = n.val('w'), h = n.val('h'), rot = n.val('rot');
    let m = mTranslate(dx, -dy);
    if ((w > 0 && b.w > 0) || (h > 0 && b.h > 0)) m = mMul(m, mScaleAbout(w > 0 && b.w > 0 ? w / b.w : 1, h > 0 && b.h > 0 ? h / b.h : 1, { x: b.x, y: b.y }));
    if (rot) m = mMul(m, mRotateAbout(-rot * Math.PI / 180, { x: b.x + b.w / 2, y: b.y + b.h / 2 }));
    for (const { s, L } of sel) { transformShape(s, m); L.touch(); }
    this.typing = false; app.commit('Transform');
  },
  key(e) {
    const d = D(), sel = d.selected(), L = d.active;
    if (!sel.length) { // nudge the selected pixels
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!mv || !L || L.type !== 'raster' || L.locked || !d.sel) return false;
      const k = e.shiftKey ? 10 : 1; dropPixels(d, L, liftPixels(d, L, false), mv[0] * k, mv[1] * k); shiftSelection(d, mv[0] * k, mv[1] * k); L.touch(); app.commit('Nudge pixels'); return true;
    }
    if (this.typing) {
      if (e.key === 'Enter') this.applyTyped(); else if (e.key === 'Escape') this.typing = false; else if (!this.num.key(e)) return false;
      app.refresh('overlay'); return true;
    }
    if (/^[0-9.\-]$/.test(e.key) && !e.metaKey && !e.ctrlKey) { this.typing = true; this.num.reset(); this.num.key(e); app.refresh('overlay'); return true; }
    const step = (e.shiftKey ? 10 : 1) / Math.max(1, d.view.zoom);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { for (const { s, L } of sel) { transformShape(s, mTranslate(mv[0], mv[1])); L.touch(); } app.commit('Nudge'); return true; }
    if (e.key === 'Escape') { d.selShapes.clear(); app.refresh('props', 'overlay'); return true; }
    return false;
  },
  draw(ctx) {
    const m = this.m, d = D(), accent = '#4c9ffe';
    if (m && m.mode === 'marquee') { const a = view.S(m.start), b = view.S(m.cur); ctx.strokeStyle = accent; ctx.fillStyle = 'rgba(76,159,254,.12)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.fill(); ctx.stroke(); return; }
    if (m && m.mode === 'pixels' && m.info && view.mouse) view.label(ctx, m.info, view.mouse.sx + 14, view.mouse.sy + 18, accent);
    const h = this.handles(); if (!h) return;
    const dh = this.dimHandles();
    if (dh) { ctx.strokeStyle = accent; ctx.fillStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([]); for (const q of dh.pts) { const p = view.S(q); ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill(); ctx.stroke(); } return; }
    const a = view.S(h.b), w = h.b.w * d.view.zoom, hh = h.b.h * d.view.zoom;
    if (this.typing) { const c = view.S({ x: h.b.x + h.b.w, y: h.b.y }); this.num.draw(ctx, { w: h.b.w, h: h.b.h }, c.x + 14, c.y - 6); }
    ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, w, hh);
    const k = view.S(h.knob), top = view.S({ x: h.b.x + h.b.w / 2, y: h.b.y });
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(k.x, k.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(k.x, k.y, 4.5, 0, 7); ctx.fill(); ctx.stroke();
    for (const q of h.pts) { const p = view.S(q); ctx.beginPath(); ctx.rect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7); ctx.fill(); ctx.stroke(); }
    if (m && m.info && view.mouse) view.label(ctx, m.info, view.mouse.sx + 14, view.mouse.sy + 18, accent);
    else if (m && m.mode === 'move' && m.moved && view.mouse) { const o = [...m.orig.values()][0], n = d.findShape(o.id); if (n) { const b0 = shapeBBox(o), b1 = shapeBBox(n.s); view.label(ctx, `Δ ${fmt(d.toU(b1.x - b0.x), 3)}, ${fmt(d.toU(b0.y - b1.y), 3)} ${d.unit}`, view.mouse.sx + 14, view.mouse.sy + 18, accent); } }
  },
};

// ---------- node editing ----------
const subsOf = s => s.subs ? [s, ...s.subs] : [s];
const node = {
  id: 'node', title: 'Edit Nodes', keyb: 'A', cursor: 'default',
  hint: 'Click a shape to show its nodes. Drag nodes or handles (they snap). Double-click an edge to add a node, Alt-click a node to toggle smooth/corner, Delete removes. Type numbers to place the selected node exactly (Tab changes box). Round nodes are spline points.',
  m: null, typing: false, num: new Hud([{ id: 'x', label: 'X', kind: 'pos' }, { id: 'y', label: 'Y', kind: 'pos' }, { id: 'dx', label: 'ΔX', kind: 'len' }, { id: 'dy', label: 'ΔY', kind: 'len' }]),
  shape() { const d = D(); if (d.selShapes.size !== 1) return null; const o = d.findShape([...d.selShapes][0]); return o && o.s.type === 'path' ? o : null; },
  down(ev) {
    const d = D(), o = this.shape(), tol = 7 / d.view.zoom;
    this.typing = false;
    if (o) {
      const subs = subsOf(o.s);
      for (const sn of d.selNodes) { // handles of selected nodes
        const n = subs[sn.sub] && subs[sn.sub].nodes[sn.i]; if (!n) continue;
        for (const w of ['i', 'o']) if (n[w + 'x'] != null && dist(ev.p, { x: n[w + 'x'], y: n[w + 'y'] }) < tol) { delete n.a; this.m = { mode: 'handle', sub: sn.sub, i: sn.i, w, o }; return; }
      }
      for (let si = 0; si < subs.length; si++) for (let i = 0; i < subs[si].nodes.length; i++) {
        const n = subs[si].nodes[i];
        if (dist(ev.p, n) < tol) {
          if (ev.alt) { this.toggleSmooth(o, subs[si], i); return; }
          const has = d.selNodes.findIndex(q => q.sub === si && q.i === i);
          if (ev.shift) { if (has >= 0) d.selNodes.splice(has, 1); else d.selNodes.push({ sub: si, i }); }
          else if (has < 0) d.selNodes = [{ sub: si, i }];
          this.m = { mode: 'nodes', o, grab: { x: n.x, y: n.y }, orig: clone(o.s), moved: false };
          app.refresh('overlay'); return;
        }
      }
    }
    const hit = pick(ev.p);
    d.selNodes = [];
    if (!hit) { d.selShapes.clear(); app.refresh('props', 'overlay'); return; }
    d.selShapes = new Set([hit.s.id]); d.activeId = hit.L.id;
    if (hit.s.type === 'text') { app.toast('Text has no nodes. Double-click it with the Select tool to edit.'); app.refresh('all'); return; }
    if (hit.s.type === 'dim') { app.setTool('select'); app.refresh('all'); return; }
    if (hit.s.type !== 'path') { convertToPath(hit.s); hit.L.touch(); app.commit('Convert to path'); return; }
    app.refresh('all');
  },
  toggleSmooth(o, sp, i) {
    const n = sp.nodes[i], L = sp.nodes.length;
    if (n.a) delete n.a; else
    if (n.ix != null || n.ox != null) { delete n.ix; delete n.iy; delete n.ox; delete n.oy; }
    else {
      const a = sp.nodes[(i - 1 + L) % L], b = sp.nodes[(i + 1) % L]; if (!a || !b || a === n || b === n) return;
      const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; n.ix = n.x - dx; n.iy = n.y - dy; n.ox = n.x + dx; n.oy = n.y + dy;
    }
    o.L.touch(); app.commit('Convert node');
  },
  move(ev) {
    const m = this.m, d = D(); view.snapMark = null;
    if (!m || !ev.drag) return;
    const r = ev.alt && m.mode === 'nodes' ? ev.p : snapPoint(ev.p, { exclude: d.selShapes }); view.snapMark = r;
    const subs = subsOf(m.o.s);
    if (m.mode === 'nodes') {
      let dx = r.x - m.grab.x, dy = r.y - m.grab.y;
      if (ev.shift) { dx = ev.p.x - m.grab.x; dy = ev.p.y - m.grab.y; if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; view.snapMark = null; }
      const os = subsOf(m.orig);
      for (const sn of d.selNodes) { const n = subs[sn.sub].nodes[sn.i], q = os[sn.sub].nodes[sn.i]; for (const k of ['x', 'ix', 'ox']) if (q[k] != null) n[k] = q[k] + dx; for (const k of ['y', 'iy', 'oy']) if (q[k] != null) n[k] = q[k] + dy; }
      smoothShape(m.o.s); m.o.L.touch(); syncDims(d, true);
      m.moved = true;
    } else {
      const n = subs[m.sub].nodes[m.i], w = m.w, v = w === 'i' ? 'o' : 'i';
      n[w + 'x'] = r.x; n[w + 'y'] = r.y;
      if (!ev.alt && n[v + 'x'] != null) { const len = dist(n, { x: n[v + 'x'], y: n[v + 'y'] }), dl = dist(n, r) || 1; n[v + 'x'] = n.x - (r.x - n.x) / dl * len; n[v + 'y'] = n.y - (r.y - n.y) / dl * len; }
      m.moved = true;
    }
    app.refresh('render');
  },
  up() { const m = this.m; this.m = null; view.snapMark = null; if (m && m.moved) { m.o.L.touch(); app.commit('Edit path'); } },
  dbl(ev) {
    const o = this.shape(), d = D(); if (!o) return;
    const subs = subsOf(o.s), tol = 7 / d.view.zoom;
    for (let si = 0; si < subs.length; si++) {
      const sp = subs[si], n = sp.nodes, cnt = sp.closed ? n.length : n.length - 1;
      for (let i = 0; i < cnt; i++) {
        const a = n[i], b = n[(i + 1) % n.length];
        if (a.ox == null && b.ix == null) {
          const c = closestOnSeg(ev.p, a, b); if (c.d > tol) continue;
          n.splice(i + 1, 0, { x: c.x, y: c.y });
        } else if (a.a && b.a) { let bt = -1, bd = tol; const p1 = { x: a.ox ?? a.x, y: a.oy ?? a.y }, p2 = { x: b.ix ?? b.x, y: b.iy ?? b.y }; let bp = null;
          for (let k = 1; k < 60; k++) { const q = cubicPt(a, p1, p2, b, k / 60), dd = dist(q, ev.p); if (dd < bd) { bd = dd; bt = k; bp = q; } }
          if (bt < 0) continue; n.splice(i + 1, 0, { x: bp.x, y: bp.y, a: 1 }); smoothShape(o.s);
        } else {
          const p1 = { x: a.ox ?? a.x, y: a.oy ?? a.y }, p2 = { x: b.ix ?? b.x, y: b.iy ?? b.y };
          let bt = -1, bd = tol; for (let k = 1; k < 60; k++) { const q = cubicPt(a, p1, p2, b, k / 60), dd = dist(q, ev.p); if (dd < bd) { bd = dd; bt = k / 60; } }
          if (bt < 0) continue;
          const lp = (u, w2, t) => ({ x: u.x + (w2.x - u.x) * t, y: u.y + (w2.y - u.y) * t });
          const q0 = lp(a, p1, bt), q1 = lp(p1, p2, bt), q2 = lp(p2, b, bt), r0 = lp(q0, q1, bt), r1 = lp(q1, q2, bt), mid = lp(r0, r1, bt);
          a.ox = q0.x; a.oy = q0.y; b.ix = q2.x; b.iy = q2.y;
          n.splice(i + 1, 0, { x: mid.x, y: mid.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y });
        }
        d.selNodes = [{ sub: si, i: i + 1 }]; o.L.touch(); app.commit('Add node'); return;
      }
    }
  },
  moveNodes(o, dx, dy) { const d = D(), subs = subsOf(o.s); for (const sn of d.selNodes) { const n = subs[sn.sub].nodes[sn.i]; for (const k of ['x', 'ix', 'ox']) if (n[k] != null) n[k] += dx; for (const k of ['y', 'iy', 'oy']) if (n[k] != null) n[k] += dy; } smoothShape(o.s); o.L.touch(); },
  key(e) {
    const d = D(), o = this.shape();
    if (this.typing && o && d.selNodes.length) {
      if (e.key === 'Enter') { const n = this.num, f = subsOf(o.s)[d.selNodes[0].sub].nodes[d.selNodes[0].i], x = n.val('x'), y = n.val('y');
        this.moveNodes(o, (x != null ? x - f.x : 0) + (n.val('dx') || 0), (y != null ? y - f.y : 0) - (n.val('dy') || 0)); this.typing = false; app.commit('Place node'); return true; }
      if (e.key === 'Escape') this.typing = false; else if (!this.num.key(e)) return false;
      app.refresh('overlay'); return true;
    }
    if (e.key === 'Escape') { if (d.selNodes.length) d.selNodes = []; else d.selShapes.clear(); app.refresh('props', 'overlay'); return true; }
    if (!o || !d.selNodes.length) return false;
    if (/^[0-9.\-]$/.test(e.key) && !e.metaKey && !e.ctrlKey) { this.typing = true; this.num.reset(); this.num.key(e); app.refresh('overlay'); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const subs = subsOf(o.s);
      for (const sn of d.selNodes.slice().sort((a, b) => b.i - a.i)) subs[sn.sub].nodes.splice(sn.i, 1);
      if (o.s.subs) o.s.subs = o.s.subs.filter(sp => sp.nodes.length > 1);
      if (o.s.nodes.length < 2) { if (o.s.subs && o.s.subs.length) { const f = o.s.subs.shift(); o.s.nodes = f.nodes; o.s.closed = f.closed; } else { o.L.shapes.splice(o.L.shapes.indexOf(o.s), 1); d.selShapes.clear(); } }
      d.selNodes = []; smoothShape(o.s); o.L.touch(); app.commit('Delete node'); return true;
    }
    const step = (e.shiftKey ? 10 : 1) / Math.max(1, d.view.zoom), mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { this.moveNodes(o, mv[0], mv[1]); app.commit('Nudge node'); return true; }
    return false;
  },
  draw(ctx) {
    const o = this.shape(), d = D(); if (!o) return;
    const subs = subsOf(o.s), accent = '#4c9ffe', isSel = (si, i) => d.selNodes.some(q => q.sub === si && q.i === i);
    ctx.lineWidth = 1; ctx.strokeStyle = accent; ctx.setLineDash([]);
    subs.forEach((sp, si) => sp.nodes.forEach((n, i) => {
      const p = view.S(n), sel = isSel(si, i);
      if (sel) for (const w of ['i', 'o']) if (n[w + 'x'] != null) { const h = view.S({ x: n[w + 'x'], y: n[w + 'y'] }); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = sel ? accent : '#fff'; ctx.beginPath(); if (n.a) ctx.arc(p.x, p.y, 4, 0, 7); else ctx.rect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7); ctx.fill(); ctx.stroke();
    }));
    if (d.selNodes.length) { const f = subs[d.selNodes[0].sub] && subs[d.selNodes[0].sub].nodes[d.selNodes[0].i];
      if (f && this.typing) { const p = view.S(f); this.num.draw(ctx, { x: f.x, y: f.y }, p.x + 16, p.y - 30); } }
  },
};

// ---------- line / polyline (CAD style) and spline ----------
function polyTool(id, title, keyb, spline) {
  return {
    id, title, keyb, pts: [], cur: null, hud: new Hud([{ id: 'len', label: 'L', kind: 'len' }, { id: 'ang', label: '∠', kind: 'ang' }]),
    hint: (spline ? 'Click points; a smooth curve is drawn through them. ' : 'Click points. ') + 'Shift locks the angle (also perpendicular to the last segment). Type a length, Tab, type an angle, Enter — or 3,4 for an offset. Units can be typed too (5mm). Enter or double-click ends, C closes, Esc cancels.',
    point(ev) {
      let r;
      if (!this.pts.length) r = snapPoint(ev.p);
      else {
        const last = this.pts[this.pts.length - 1], pv = this.pts[this.pts.length - 2], h = this.hud, b0 = h.buf[0];
        r = resolve(ev, last, { extra: this.pts, prevDir: pv ? { x: last.x - pv.x, y: last.y - pv.y } : null });
        if (/[,<#]/.test(b0)) { const t = typedPoint(b0, last, r); if (t) r = { ...t, kind: null }; }
        else {
          const len = h.val('len'), ang = h.val('ang');
          if (len != null || ang != null) {
            const dx = r.x - last.x, dy = r.y - last.y, L = Math.hypot(dx, dy); let ux = L > 1e-9 ? dx / L : 1, uy = L > 1e-9 ? dy / L : 0;
            if (ang != null) { ux = Math.cos(ang * Math.PI / 180); uy = -Math.sin(ang * Math.PI / 180); }
            const l = len != null ? len : Math.max(0, dx * ux + dy * uy);
            r = { x: last.x + ux * l, y: last.y + uy * l, kind: null };
          }
        }
      }
      view.snapMark = r; this.lastEv = ev;
      return { x: r.x, y: r.y };
    },
    down(ev) {
      const p = this.point(ev);
      if (this.pts.length >= 3 && scr(p, this.pts[0]) < 1) { this.finish(true); return; }
      this.pts.push(p); this.hud.reset(); this.cur = p; app.refresh('overlay');
    },
    move(ev) { this.cur = this.point(ev); },
    dbl() { this.finish(false); },
    context() { if (!this.pts.length) return false; this.finish(false); return true; },
    key(e) {
      if (!this.pts.length) return false;
      const k = e.key, h = this.hud, last = this.pts[this.pts.length - 1];
      if ((k === 'c' || k === 'C') && !h.any && this.pts.length >= 3) { this.finish(true); return true; }
      if (h.key(e)) { /* typed into a value box */ }
      else if (k === 'Backspace') this.pts.pop();
      else if (k === 'Enter') {
        if (!h.any) { this.finish(false); return true; }
        const b0 = h.buf[0], ok = /[,<#]/.test(b0) ? !!typedPoint(b0, last, this.cur || last) : h.buf.every((b, j) => !b || h.val(h.defs[j].id) != null);
        if (ok) { this.pts.push(this.point(this.lastEv || { p: this.cur || last, shift: false })); h.reset(); }
        else app.toast('Could not read that. Try 5, 5mm, 5<30, 3,4 or #3,4');
      } else if (k === 'Escape') { if (h.any) h.reset(); else this.cancel(); }
      else return false;
      if (this.lastEv && this.pts.length) this.cur = this.point(this.lastEv);
      app.refresh('overlay'); return true;
    },
    shape(pts, close) {
      const s = { type: 'path', nodes: pts.map(p => spline ? { x: p.x, y: p.y, a: 1 } : { x: p.x, y: p.y }), closed: !!close, st: curStyle() };
      if (spline) smoothShape(s);
      return s;
    },
    finish(close) {
      const pts = this.pts.filter((p, i, a) => !i || dist(p, a[i - 1]) > 1e-6);
      this.cancel();
      if (pts.length < 2) return;
      const s = this.shape(pts, close); if (!close) s.st.fill = null; else s.st.as = s.st.ae = 'none';
      addShape(s, close ? 'Polygon' : spline ? 'Spline' : 'Line');
    },
    cancel() { this.pts = []; this.hud.reset(); this.cur = null; view.snapMark = null; app.refresh('overlay'); },
    deactivate() { this.finish(false); },
    draw(ctx) {
      if (!this.pts.length || !this.cur) return;
      const P = this.pts.map(p => view.S(p)), c = view.S(this.cur), last = this.pts[this.pts.length - 1], v = D().view;
      ctx.strokeStyle = '#4c9ffe'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      if (spline) { ctx.save(); ctx.translate(v.tx, v.ty); ctx.scale(v.zoom, v.zoom); ctx.lineWidth = 1.5 / v.zoom; ctx.stroke(shapePath(this.shape([...this.pts, this.cur], false))); ctx.restore(); }
      else { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); for (const p of P.slice(1)) ctx.lineTo(p.x, p.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
      ctx.fillStyle = '#fff'; for (const p of P) { ctx.beginPath(); ctx.rect(p.x - 3, p.y - 3, 6, 6); ctx.fill(); ctx.stroke(); }
      this.hud.draw(ctx, { len: dist(last, this.cur), ang: angDeg(last, this.cur) }, c.x + 16, c.y - 34);
    },
  };
}

// ---------- rectangle / ellipse ----------
function boxTool(id, title, keyb, kind) {
  return {
    id, title, keyb, p0: null, cur: null, click: false, flags: {}, hud: new Hud([{ id: 'w', label: 'W', kind: 'len' }, { id: 'h', label: 'H', kind: 'len' }]),
    hint: `Drag, or click then click. Shift = ${kind === 'rect' ? 'square' : 'circle'}, Alt = from centre. After the first click type the width, Tab, the height, then Enter (one number makes a ${kind === 'rect' ? 'square' : 'circle'}).`,
    box() {
      const { p0, cur, flags } = this; let dx = cur.x - p0.x, dy = cur.y - p0.y;
      const lw = this.hud.val('w'), lh = this.hud.val('h'), k = flags.alt ? 0.5 : 1;
      if (lw != null) dx = (dx < 0 ? -1 : 1) * lw * k; if (lh != null) dy = (dy < 0 ? -1 : 1) * lh * k;
      if (flags.shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
      return flags.alt ? { x: p0.x - Math.abs(dx), y: p0.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) } : { x: Math.min(p0.x, p0.x + dx), y: Math.min(p0.y, p0.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
    },
    down(ev) {
      if (this.click && this.p0) { this.move(ev); this.make(); return; }
      const r = snapPoint(ev.p); this.p0 = { x: r.x, y: r.y }; this.cur = this.p0; this.s0 = { x: ev.sx, y: ev.sy }; this.hud.reset();
    },
    move(ev) {
      this.flags = { shift: ev.shift, alt: ev.alt };
      const r = snapPoint(ev.p, this.p0 ? { ref: this.p0 } : {}); view.snapMark = r;
      if (this.p0) this.cur = { x: r.x, y: r.y };
    },
    up(ev) { if (!this.p0) return; if (dist(this.s0, { x: ev.sx, y: ev.sy }) > 4) this.make(); else this.click = true; },
    key(e) {
      if (!this.p0) return false;
      const k = e.key, h = this.hud;
      if (h.key(e)) { /* typed into a value box */ }
      else if (k === 'Escape') this.cancel();
      else if (k === 'Enter') {
        const m = /^([\d.]+),([\d.]+)$/.exec(h.buf[0]);
        if (m) h.buf = [m[1], m[2]]; else if (h.buf[0] && !h.buf[1]) h.buf[1] = h.buf[0]; else if (h.buf[1] && !h.buf[0]) h.buf[0] = h.buf[1];
        if (h.any && (h.val('w') == null || h.val('h') == null)) { app.toast('Type the width and height, e.g. 20 Tab 10'); return true; }
        if (h.any) this.flags = { alt: this.flags.alt };
        this.make();
      } else return false;
      app.refresh('overlay'); return true;
    },
    make() {
      const b = this.box(); this.cancel();
      if (b.w < 1e-6 || b.h < 1e-6) return;
      const st = curStyle(); st.as = st.ae = 'none';
      addShape(kind === 'rect' ? { type: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, r: 0, rot: 0, st } : { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, rot: 0, st }, title);
    },
    cancel() { this.p0 = null; this.cur = null; this.click = false; this.hud.reset(); view.snapMark = null; app.refresh('overlay'); },
    deactivate() { this.cancel(); },
    draw(ctx) {
      if (!this.p0 || !this.cur) return;
      const b = this.box(), a = view.S(b), z = D().view.zoom, d = D();
      ctx.strokeStyle = '#4c9ffe'; ctx.lineWidth = 1.5; ctx.beginPath();
      if (kind === 'rect') ctx.rect(a.x, a.y, b.w * z, b.h * z); else ctx.ellipse(a.x + b.w * z / 2, a.y + b.h * z / 2, b.w * z / 2, b.h * z / 2, 0, 0, 7);
      ctx.stroke();
      const c = view.S(this.cur);
      this.hud.draw(ctx, { w: b.w, h: b.h }, c.x + 16, c.y + 14);
    },
  };
}

// ---------- pen (bezier) ----------
const pen = {
  id: 'pen', title: 'Pen (curves)', keyb: 'P', nodes: [], cur: null,
  hint: 'Click for corner points, click-drag for smooth curves. Click the first point to close, Enter or double-click to end, Backspace removes the last point.',
  down(ev) {
    const r = snapPoint(ev.p, { extra: this.nodes });
    if (this.nodes.length >= 2 && scr(r, this.nodes[0]) < 8) { this.finish(true); return; }
    this.nodes.push({ x: r.x, y: r.y }); this.s0 = { x: ev.sx, y: ev.sy };
  },
  move(ev) {
    if (ev.drag && this.nodes.length) {
      const n = this.nodes[this.nodes.length - 1];
      if (dist(this.s0, { x: ev.sx, y: ev.sy }) > 3) { const h = ev.shift ? resolve(ev, n) : ev.p; n.ox = h.x; n.oy = h.y; n.ix = 2 * n.x - h.x; n.iy = 2 * n.y - h.y; }
      this.cur = null; view.snapMark = null;
    } else { const last = this.nodes[this.nodes.length - 1]; const r = last && ev.shift ? resolve(ev, last) : snapPoint(ev.p, { extra: this.nodes }); view.snapMark = r; this.cur = { x: r.x, y: r.y }; }
  },
  dbl() { this.nodes.pop(); this.finish(false); },
  context() { this.finish(false); },
  key(e) {
    if (!this.nodes.length) return false;
    if (e.key === 'Enter') this.finish(false); else if (e.key === 'Escape') this.finish(false); else if (e.key === 'Backspace') this.nodes.pop(); else return false;
    app.refresh('overlay'); return true;
  },
  finish(close) {
    const nodes = this.nodes; this.cancel();
    if (nodes.length < 2) return;
    const st = curStyle(); if (!close) st.fill = null; else st.as = st.ae = 'none';
    addShape({ type: 'path', nodes, closed: !!close, st }, 'Path');
  },
  cancel() { this.nodes = []; this.cur = null; view.snapMark = null; app.refresh('overlay'); },
  deactivate() { this.finish(false); },
  draw(ctx) {
    const n = this.nodes; if (!n.length) return;
    ctx.strokeStyle = '#4c9ffe'; ctx.lineWidth = 1.5; ctx.beginPath();
    const S = q => view.S(q), seg = (a, b) => { const B = S(b); if (a.ox != null || b.ix != null) { const c1 = S({ x: a.ox ?? a.x, y: a.oy ?? a.y }), c2 = S({ x: b.ix ?? b.x, y: b.iy ?? b.y }); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, B.x, B.y); } else ctx.lineTo(B.x, B.y); };
    const p0 = S(n[0]); ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
    if (this.cur) seg(n[n.length - 1], this.cur);
    ctx.stroke();
    ctx.lineWidth = 1; ctx.fillStyle = '#fff';
    for (const q of n) { const p = S(q); if (q.ox != null) { const a = S({ x: q.ox, y: q.oy }), b = S({ x: q.ix, y: q.iy }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } ctx.beginPath(); ctx.rect(p.x - 3, p.y - 3, 6, 6); ctx.fill(); ctx.stroke(); }
  },
};

// ---------- text ----------
const text = {
  id: 'text', title: 'Text', keyb: 'T', cursor: 'text',
  hint: 'Click to place text, click existing text to edit. ^{2} makes a superscript, _{2} a subscript. Cmd/Ctrl+Enter or click away to finish.',
  move(ev) { view.snapMark = snapPoint(ev.p); },
  down(ev) {
    const hit = pick(ev.p);
    if (hit && hit.s.type === 'text') { editText(hit.s, hit.L, false); return; }
    const d = D(), t = app.settings.text, r = snapPoint(ev.p), L = vectorTarget();
    const s = { id: uid(), type: 'text', x: r.x, y: r.y, text: '', size: t.sizePt * d.ptPx, font: t.font, bold: t.bold, italic: t.italic, align: t.align, rot: 0, st: { fill: app.settings.style.stroke || '#000000', alpha: 1 } };
    L.shapes.push(s); d.selShapes = new Set([s.id]); view.snapMark = null;
    app.refresh('layers');
    editText(s, L, true);
  },
};

// ---------- measure ----------
const measure = {
  id: 'measure', title: 'Measure', keyb: 'U', a: null, b: null,
  hint: 'Drag to measure distance and angle (snaps; Shift locks the angle). Image ▸ Set Scale turns a measured length into real units.',
  down(ev) { const r = snapPoint(ev.p); this.a = { x: r.x, y: r.y }; this.b = this.a; },
  move(ev) { if (ev.drag && this.a) { const r = resolve(ev, this.a); view.snapMark = r; this.b = { x: r.x, y: r.y }; app.lastMeasure = dist(this.a, this.b); } else view.snapMark = snapPoint(ev.p); },
  up() { view.snapMark = null; if (this.a) app.emit('measured', dist(this.a, this.b)); },
  cancel() { this.a = this.b = null; },
  key(e) { if (e.key === 'Escape' && this.a) { this.cancel(); app.refresh('overlay'); return true; } return false; },
  draw(ctx) {
    if (!this.a) return; const d = D(), A = view.S(this.a), B = view.S(this.b);
    ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    for (const p of [A, B]) { ctx.beginPath(); ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.stroke(); }
    const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y;
    view.label(ctx, `${dimText(Math.hypot(dx, dy), angDeg(this.a, this.b))}   Δx ${fmt(d.toU(dx), 3)}  Δy ${fmt(d.toU(-dy), 3)}   (${fmt(Math.hypot(dx, dy), 1)} px)`, B.x + 14, B.y + 20, '#ff9f1a');
  },
};

// ---------- pixel selections ----------
const selMode = ev => ev.shift ? 'add' : ev.alt ? 'sub' : 'replace';
const marquee = {
  id: 'marquee', title: 'Marquee Select', keyb: 'M', a: null, b: null,
  hint: 'Drag to select pixels. Shift adds, Alt subtracts, click to deselect. Drag inside a selection to move its outline; the Select tool (V) cuts and moves the pixels. Paint, fill and filters stay inside the selection.',
  options: [{ id: 'shape', label: 'Shape', type: 'select', options: ['rectangle', 'ellipse'], default: 'rectangle' }],
  down(ev) { this.mv = selMode(ev) === 'replace' && inSel(D(), ev.p); const r = this.mv ? ev.p : snapPoint(ev.p); this.a = { x: Math.round(r.x), y: Math.round(r.y) }; this.b = this.a; },
  move(ev) { if (!ev.drag || !this.a) { view.snapMark = snapPoint(ev.p); return; }
    if (!this.mv) { const r = snapPoint(ev.p); view.snapMark = r; ev = { ...ev, p: { x: r.x, y: r.y } }; }
    if (ev.drag && this.a && this.mv) { this.b = { x: Math.round(ev.p.x), y: Math.round(ev.p.y) }; view.selOffset = { x: this.b.x - this.a.x, y: this.b.y - this.a.y }; return; }
    if (ev.drag && this.a) { let x = Math.round(ev.p.x), y = Math.round(ev.p.y); if (ev.orig.ctrlKey) { const m = Math.max(Math.abs(x - this.a.x), Math.abs(y - this.a.y)); x = this.a.x + Math.sign(x - this.a.x) * m; y = this.a.y + Math.sign(y - this.a.y) * m; } this.b = { x, y }; } },
  rect() { return { x: Math.min(this.a.x, this.b.x), y: Math.min(this.a.y, this.b.y), w: Math.abs(this.b.x - this.a.x), h: Math.abs(this.b.y - this.a.y) }; },
  up(ev) {
    const d = D(), r = this.rect(), ell = this.opt.shape === 'ellipse';
    if (this.mv) { const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y; this.a = null; this.mv = false; view.selOffset = null; if (dx || dy) { shiftSelection(d, dx, dy); app.commit('Move selection'); } else { clearSelection(d); app.commit('Deselect'); } return; }
    this.a = null;
    if (r.w < 1 || r.h < 1) { if (d.sel && selMode(ev) === 'replace') { clearSelection(d); app.commit('Deselect'); } return; }
    setSelection(d, ctx => { ctx.beginPath(); if (ell) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, 7); else ctx.rect(r.x, r.y, r.w, r.h); ctx.fill(); }, selMode(ev));
    app.commit('Select');
  },
  cancel() { this.a = null; view.selOffset = null; },
  draw(ctx) {
    if (!this.a || this.mv) return; const r = this.rect(), p = view.S(r), z = D().view.zoom, d = D();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
    if (this.opt.shape === 'ellipse') ctx.ellipse(p.x + r.w * z / 2, p.y + r.h * z / 2, r.w * z / 2, r.h * z / 2, 0, 0, 7); else ctx.rect(p.x, p.y, r.w * z, r.h * z);
    ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke();
    view.label(ctx, `${r.w} × ${r.h} px  (${fmt(d.toU(r.w), 2)} × ${fmt(d.toU(r.h), 2)} ${d.unit})`, p.x + r.w * z + 10, p.y + r.h * z + 14);
  },
};
const lasso = {
  id: 'lasso', title: 'Lasso Select', keyb: 'L', pts: null,
  hint: 'Draw a freehand outline to select pixels. Shift adds, Alt subtracts.',
  down(ev) { this.pts = [ev.p]; },
  move(ev) { if (ev.drag && this.pts) this.pts.push(ev.p); },
  up(ev) {
    const pts = this.pts, d = D(); this.pts = null;
    if (!pts || pts.length < 3) { if (d.sel && selMode(ev) === 'replace') { clearSelection(d); app.commit('Deselect'); } return; }
    setSelection(d, ctx => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); }, selMode(ev));
    app.commit('Lasso');
  },
  cancel() { this.pts = null; },
  draw(ctx) { if (!this.pts) return; ctx.beginPath(); this.pts.forEach((q, i) => { const p = view.S(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke(); },
};
// Pixels of one layer (or the whole picture) in document coordinates.
function docPixels(all) {
  const d = D(), L = d.active;
  const c = all || !L || L.type !== 'raster' ? flatten(d) : flatten(d, 1, { skip: q => q !== L });
  return c.getContext('2d').getImageData(0, 0, d.w, d.h);
}
const wand = {
  id: 'wand', title: 'Magic Wand', keyb: 'W',
  hint: 'Click to select an area of similar colour. Shift adds, Alt subtracts.',
  options: [{ id: 'tol', label: 'Tolerance', type: 'range', min: 0, max: 255, default: 32 }, { id: 'contig', label: 'Contiguous', type: 'check', default: true }, { id: 'all', label: 'Sample all layers', type: 'check', default: true }],
  down(ev) {
    const d = D(), x = Math.floor(ev.p.x), y = Math.floor(ev.p.y);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const m = maskToCanvas(floodMask(docPixels(this.opt.all), x, y, this.opt.tol, this.opt.contig), d.w, d.h);
    setSelection(d, ctx => ctx.drawImage(m, 0, 0), selMode(ev));
    app.commit('Magic wand');
  },
};

// ---------- painting ----------
// mode: 'paint' | 'erase' | 'stamp' (clone). All three build the stroke on its own canvas and lay it over a copy of the layer.
function paintTool(id, title, keyb, mode) {
  const erase = mode === 'erase', stamp = mode === 'stamp';
  let tip = null, tipKey = '', dab = null;
  return {
    id, title, keyb, cursor: 'none', s: null, lastEnd: null, src: null, off: null,
    hint: stamp ? 'Alt-click sets the point to copy from, then paint to clone pixels from there. [ and ] change the size. "Aligned" keeps the same offset between strokes.'
      : `Drag to ${erase ? 'erase' : 'paint'} on the active image layer or mask. [ and ] change the size, Shift-click draws a straight line from the last stroke.` + (erase ? '' : ' Mode paints only the hue, colour, luminosity, or multiplies, screens and so on.'),
    options: [{ id: 'size', label: 'Size', type: 'range', min: 1, max: 500, default: erase || stamp ? 40 : 12 }, { id: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, default: stamp ? 50 : 80 }, { id: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, default: 100 },
      ...(mode === 'paint' ? [{ id: 'mode', label: 'Mode', type: 'select', options: BLENDS, default: 'normal' }] : []),
      ...(stamp ? [{ id: 'aligned', label: 'Aligned', type: 'check', default: true }, { id: 'all', label: 'Sample all layers', type: 'check', default: false }] : [])],
    tip(color) {
      const o = this.opt, key = [o.size, o.hardness, color].join();
      if (key === tipKey) return tip;
      const n = Math.ceil(o.size) + 2, c = mk(n, n), ctx = c.getContext('2d'), r = o.size / 2, [R, G, B] = hexToRgb(color);
      const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, Math.max(0.5, r)), h = Math.min(0.98, o.hardness / 100);
      g.addColorStop(0, `rgba(${R},${G},${B},1)`); g.addColorStop(h, `rgba(${R},${G},${B},1)`); g.addColorStop(1, `rgba(${R},${G},${B},${o.size <= 2 ? 1 : 0})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
      tipKey = key; return (tip = c);
    },
    stamp(p) {
      const s = this.s, t = this.tip(s.color), n = t.width, x = p.x - s.T.x - n / 2, y = p.y - s.T.y - t.height / 2;
      if (!stamp) { s.sctx.drawImage(t, x, y); return; }
      if (!dab || dab.width !== n) dab = mk(n, n);
      const c = dab.getContext('2d'); c.globalCompositeOperation = 'copy'; c.drawImage(s.source, s.sx - (p.x + s.off.x - n / 2), s.sy - (p.y + s.off.y - n / 2));
      c.globalCompositeOperation = 'destination-in'; c.drawImage(t, 0, 0);
      s.sctx.drawImage(dab, x, y);
    },
    lineTo(a, b) {
      const sp = Math.max(0.5, this.opt.size * 0.12), n = Math.max(1, Math.ceil(dist(a, b) / sp));
      for (let i = 1; i <= n; i++) this.stamp({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
    },
    compose() {
      const { T, base, stroke, tmp } = this.s, d = D(), ctx = T.ctx;
      let src = stroke, op = erase ? 'destination-out' : !T.mask && this.opt.mode && this.opt.mode !== 'normal' ? this.opt.mode : 'source-over', al = this.opt.opacity / 100;
      if (T.mask && !erase) { const l = maskLum(app.fg); if (l < 0.5) { op = 'destination-out'; al *= 1 - l; } else al *= l; } // white reveals, black hides
      if (d.sel) { const t = tmp.getContext('2d'); t.globalCompositeOperation = 'copy'; t.drawImage(stroke, 0, 0); t.globalCompositeOperation = 'destination-in'; t.drawImage(d.sel, -T.x, -T.y); src = tmp; }
      ctx.save(); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(base, 0, 0);
      ctx.globalCompositeOperation = op; ctx.globalAlpha = al; ctx.drawImage(src, 0, 0); ctx.restore();
      app.refresh('render');
    },
    down(ev) {
      if (stamp && ev.alt) { this.src = { x: ev.p.x, y: ev.p.y }; this.off = null; app.toast('Source point set. Now paint.', 1500); app.refresh('overlay'); return; }
      const T = paintTarget(); if (!T) return;
      if (stamp && T.mask) { app.toast('The clone stamp works on image layers (click the layer thumbnail, not the mask)'); return; }
      if (stamp && !this.src) { app.toast('Alt-click first to choose where to copy from'); return; }
      const w = T.canvas.width, h = T.canvas.height, stroke = mk(w, h);
      this.s = { T, base: copyCanvas(T.canvas), stroke, sctx: stroke.getContext('2d'), tmp: D().sel ? mk(w, h) : null, last: ev.p, color: erase || stamp ? '#000000' : T.mask ? '#ffffff' : app.fg };
      if (stamp) {
        if (!this.opt.aligned || !this.off) this.off = { x: this.src.x - ev.p.x, y: this.src.y - ev.p.y };
        Object.assign(this.s, { off: this.off, source: this.opt.all ? flatten(D()) : this.s.base, sx: this.opt.all ? 0 : T.x, sy: this.opt.all ? 0 : T.y });
      }
      if (ev.shift && this.lastEnd && !stamp) this.lineTo(this.lastEnd, ev.p); else this.stamp(ev.p);
      this.compose();
    },
    move(ev) { if (!ev.drag || !this.s) return; this.lineTo(this.s.last, ev.p); this.s.last = ev.p; this.compose(); },
    up() { if (!this.s) return; this.lastEnd = this.s.last; this.s.T.touch(); const m = this.s.T.mask; this.s = null; app.commit(m ? 'Paint mask' : title); },
    key(e) { if (e.key === '[' || e.key === ']') { const o = this.opt; o.size = Math.max(1, Math.min(500, Math.round(o.size * (e.key === ']' ? 1.25 : 0.8) + (e.key === ']' ? 1 : -1)))); app.saveSettings(); app.refresh('tool', 'overlay'); return true; } return false; },
    draw(ctx) {
      const m = view.mouse, z = D().view.zoom;
      if (stamp && this.src) {
        const o = this.s ? { x: this.s.last.x + this.off.x, y: this.s.last.y + this.off.y } : this.off && this.opt.aligned && m ? { x: m.p.x + this.off.x, y: m.p.y + this.off.y } : this.src, p = view.S(o);
        for (const [c, lw] of [['#fff', 3], ['#000', 1]]) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke(); }
      }
      if (!m) return; const r = this.opt.size / 2 * z;
      ctx.beginPath(); ctx.arc(m.sx, m.sy, Math.max(1.5, r), 0, 7); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(m.sx, m.sy, Math.max(1.5, r) + 1, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
    },
  };
}
// Paint over something to make it disappear: the painted area is rebuilt from its surroundings.
const remove = {
  id: 'remove', title: 'Remove (magic eraser)', keyb: 'J', cursor: 'none', m: null,
  hint: 'Paint over an object, scratch or label; on release it is rebuilt from its surroundings. "AI" gives the best result (first use downloads 28 MB); "patch" works offline. For a selection use Edit ▸ Content-Aware Fill.',
  options: [{ id: 'size', label: 'Size', type: 'range', min: 3, max: 400, default: 30 }, { id: 'method', label: 'Method', type: 'select', options: [['ai', 'AI (best)'], ['patch', 'Patch (offline)']], default: 'ai' }],
  seg(a, b) { const c = this.m.c.getContext('2d'), T = this.m.T; c.strokeStyle = '#ff2d55'; c.lineWidth = this.opt.size; c.lineCap = c.lineJoin = 'round'; c.beginPath(); c.moveTo(a.x - T.x, a.y - T.y); c.lineTo(b.x - T.x + 0.01, b.y - T.y); c.stroke(); },
  down(ev) { const T = paintTarget(); if (!T) return; if (T.mask) { app.toast('Remove works on image layers (click the layer thumbnail, not the mask)'); return; } this.m = { T, c: mk(T.canvas.width, T.canvas.height), last: ev.p }; this.seg(ev.p, ev.p); },
  move(ev) { if (ev.drag && this.m) { this.seg(this.m.last, ev.p); this.m.last = ev.p; } },
  up() {
    const m = this.m, d = D(); if (!m) return;
    if (d.sel) { const c = m.c.getContext('2d'); c.globalCompositeOperation = 'destination-in'; c.drawImage(d.sel, -m.T.x, -m.T.y); }
    app.toast('Removing…', 60000); app.refresh('overlay');
    setTimeout(async () => { try { if (await contentFill(m.T, m.c, this.opt.method)) app.commit('Remove'); app.toast('Done', 700); } catch (e) { console.error(e); app.toast('Remove failed: ' + e.message, 5000); } this.m = null; app.refresh('render'); }, 30);
  },
  cancel() { this.m = null; },
  key(e) { if (e.key === '[' || e.key === ']') { const o = this.opt; o.size = Math.max(3, Math.min(400, Math.round(o.size * (e.key === ']' ? 1.25 : 0.8)))); app.saveSettings(); app.refresh('tool', 'overlay'); return true; } return false; },
  draw(ctx) {
    const m = this.m, z = D().view.zoom, mo = view.mouse;
    if (m) { const p = view.S({ x: m.T.x, y: m.T.y }); ctx.save(); ctx.globalAlpha = 0.45; ctx.imageSmoothingEnabled = false; ctx.drawImage(m.c, p.x, p.y, m.c.width * z, m.c.height * z); ctx.restore(); }
    if (!mo) return; const r = Math.max(1.5, this.opt.size / 2 * z);
    ctx.beginPath(); ctx.arc(mo.sx, mo.sy, r, 0, 7); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); ctx.beginPath(); ctx.arc(mo.sx, mo.sy, r + 1, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
  },
};
const bucket = {
  id: 'bucket', title: 'Paint Bucket', keyb: 'G',
  hint: 'Click to fill an area of similar colour with the foreground colour. On a mask it fills the mask (or the selection) with the grey level of the foreground colour.',
  options: [{ id: 'tol', label: 'Tolerance', type: 'range', min: 0, max: 255, default: 32 }, { id: 'contig', label: 'Contiguous', type: 'check', default: true }, { id: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, default: 100 }],
  down(ev) {
    const T = paintTarget(), d = D(); if (!T) return;
    const w = T.canvas.width, h = T.canvas.height;
    if (T.mask) { const c = mk(w, h), x = c.getContext('2d'); x.fillStyle = `rgba(255,255,255,${maskLum(app.fg)})`; x.fillRect(0, 0, w, h); applyThroughSelection(d, T, c); T.touch(); app.commit('Fill mask'); return; }
    const img = T.ctx.getImageData(0, 0, w, h);
    const m = maskToCanvas(floodMask(img, ev.p.x - T.x, ev.p.y - T.y, this.opt.tol, this.opt.contig), w, h, hexToRgb(app.fg));
    const fresh = copyCanvas(T.canvas), f = fresh.getContext('2d'); f.globalAlpha = this.opt.opacity / 100; f.drawImage(m, 0, 0);
    applyThroughSelection(d, T, fresh); T.touch(); app.commit('Fill');
  },
};
const gradient = {
  id: 'gradient', title: 'Gradient', keyb: 'D', a: null, b: null,
  hint: 'Drag to draw a gradient from the foreground to the background colour on the active image layer (inside the selection, if any). On a mask it fades the layer in and out.',
  options: [{ id: 'kind', label: 'Type', type: 'select', options: ['linear', 'radial'], default: 'linear' }, { id: 'transparent', label: 'To transparent', type: 'check', default: false }],
  down(ev) { const r = snapPoint(ev.p); this.a = { x: r.x, y: r.y }; this.b = this.a; },
  move(ev) { if (ev.drag && this.a) { const r = ev.shift ? resolve(ev, this.a) : snapPoint(ev.p); view.snapMark = r; this.b = { x: r.x, y: r.y }; } else view.snapMark = snapPoint(ev.p); },
  up() {
    const a = this.a, b = this.b; this.a = null; if (!a || dist(a, b) < 1) return;
    const T = paintTarget(), d = D(); if (!T) return;
    const fresh = T.mask ? mk(T.canvas.width, T.canvas.height) : copyCanvas(T.canvas), f = fresh.getContext('2d'), [R, G, B] = hexToRgb(app.fg);
    const g = this.opt.kind === 'radial' ? f.createRadialGradient(a.x - T.x, a.y - T.y, 0, a.x - T.x, a.y - T.y, dist(a, b)) : f.createLinearGradient(a.x - T.x, a.y - T.y, b.x - T.x, b.y - T.y);
    if (T.mask) { g.addColorStop(0, `rgba(255,255,255,${maskLum(app.fg)})`); g.addColorStop(1, `rgba(255,255,255,${maskLum(app.bg)})`); }
    else { g.addColorStop(0, app.fg); g.addColorStop(1, this.opt.transparent ? `rgba(${R},${G},${B},0)` : app.bg); }
    f.fillStyle = g; f.fillRect(0, 0, fresh.width, fresh.height);
    applyThroughSelection(d, T, fresh); T.touch(); app.commit('Gradient');
  },
  cancel() { this.a = null; },
  draw(ctx) { if (!this.a) return; const A = view.S(this.a), B = view.S(this.b); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); },
};
const eyedropper = {
  id: 'eyedropper', title: 'Eyedropper', keyb: 'I',
  hint: 'Click to pick the foreground colour from the picture (Alt-click sets the background colour).',
  sample(ev) {
    const c = mk(1, 1), ctx = c.getContext('2d'); renderDoc(ctx, D(), 1, -Math.floor(ev.p.x), -Math.floor(ev.p.y));
    const p = ctx.getImageData(0, 0, 1, 1).data; if (p[3] === 0) return;
    app.setColor(ev.alt ? 'bg' : 'fg', rgbToHex(p[0], p[1], p[2]));
  },
  down(ev) { this.sample(ev); }, move(ev) { if (ev.drag) this.sample(ev); },
};
const crop = {
  id: 'crop', title: 'Crop', keyb: 'C', a: null, b: null, ready: false,
  hint: 'Drag the area to keep, then press Enter to crop (Esc cancels). Dragging outside the page enlarges the canvas.',
  down(ev) { const r = snapPoint(ev.p); this.a = { x: Math.round(r.x), y: Math.round(r.y) }; this.b = this.a; this.ready = false; },
  move(ev) { if (ev.drag && this.a) { const r = snapPoint(ev.p); view.snapMark = r; this.b = { x: Math.round(r.x), y: Math.round(r.y) }; } },
  up() { view.snapMark = null; this.ready = !!this.a && Math.abs(this.b.x - this.a.x) > 1 && Math.abs(this.b.y - this.a.y) > 1; if (!this.ready) this.a = null; app.refresh('overlay'); },
  rect() { return { x: Math.min(this.a.x, this.b.x), y: Math.min(this.a.y, this.b.y), w: Math.abs(this.b.x - this.a.x), h: Math.abs(this.b.y - this.a.y) }; },
  key(e) {
    if (!this.a) return false;
    if (e.key === 'Enter' && this.ready) { const r = this.rect(); this.cancel(); cropDoc(D(), r.x, r.y, r.w, r.h); D().view.fit = true; app.commit('Crop'); view.fit(); return true; }
    if (e.key === 'Escape') { this.cancel(); app.refresh('overlay'); return true; }
    return false;
  },
  cancel() { this.a = null; this.ready = false; },
  draw(ctx) {
    if (!this.a) return; const r = this.rect(), p = view.S(r), z = D().view.zoom, d = D();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.rect(0, 0, view.W, view.H); ctx.rect(p.x, p.y, r.w * z, r.h * z); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(p.x + 0.5, p.y + 0.5, r.w * z, r.h * z);
    view.label(ctx, `${r.w} × ${r.h} px  (${fmt(d.toU(r.w), 2)} × ${fmt(d.toU(r.h), 2)} ${d.unit})` + (this.ready ? '   Enter to crop' : ''), p.x + 6, p.y + r.h * z + 14);
  },
};

// ---------- dimension ----------
// Edit a dimension's value right on the drawing (as in Fusion 360): Enter drives the attached shape.
export function editDimValue(s, L) {
  const d = D(), lab = dimShapes(s)[3], p = view.S({ x: lab.x, y: lab.y - lab.size * 0.35 }), inp = document.createElement('input');
  document.querySelectorAll('.dim-edit').forEach(e => e.remove());
  inp.className = 'dim-edit'; inp.value = fmt(d.toU(dist(s.a, s.b)), s.dec ?? 3); inp.spellcheck = false; inp.title = 'New value, Enter to apply (a unit can be typed: 25mm, 1in, 300px), Esc to cancel';
  inp.style.left = p.x - 55 + 'px'; inp.style.top = p.y - 14 + 'px'; view.vp.appendChild(inp);
  let done = false;
  const finish = ok => {
    if (done) return; done = true; const t = inp.value.trim(); inp.remove(); if (!ok) return;
    const m = /^(-?\d*\.?\d+)\s*(px|mm|cm|in|pt)?$/i.exec(t); if (!m) { if (t) app.toast('Type a number, for example 25 or 25mm'); return; }
    const px = m[2] ? parseFloat(m[1]) * unitScale(m[2].toLowerCase(), d.dpi) : d.fromU(parseFloat(m[1]));
    if (!(px > 0) || Math.abs(px - dist(s.a, s.b)) < 1e-9) return;
    driveDim(d, s, px); L.touch(); app.commit('Dimension value');
    if (!s.ra && !s.rb) app.toast('This dimension is not attached to a shape, so only the dimension changed');
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
// What a click lands on: a point of a shape, a straight edge, or a circle/ellipse outline (its diameter).
function dimTarget(p) {
  const d = D(), tol = 6 / d.view.zoom, pt = findAnchor(d, p, tol);
  if (pt) return null; // a point: handled one end at a time
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const L = d.layers[i]; if (L.type !== 'vector' || !L.visible) continue;
    for (let j = L.shapes.length - 1; j >= 0; j--) {
      const s = L.shapes[j], an = anchors(s), by = k => an.find(q => q.k === k);
      if (s.type === 'path') { const subs = s.subs ? [s, ...s.subs] : [s];
        for (let si = 0; si < subs.length; si++) { const n = subs[si].nodes, cnt = subs[si].closed ? n.length : n.length - 1;
          for (let k = 0; k < cnt; k++) { const a = n[k], b = n[(k + 1) % n.length]; if (a.ox != null || b.ix != null) continue;
            if (closestOnSeg(p, a, b).d < tol) return [by(si + ':' + k), by(si + ':' + (k + 1) % n.length), s.id]; } } }
      else if (s.type === 'rect') { for (let k = 0; k < 4; k++) { const a = by('c' + k), b = by('c' + (k + 1) % 4); if (closestOnSeg(p, a, b).d < tol) return [a, b, s.id]; } }
      else if (s.type === 'ellipse' && hitShape({ ...s, st: { stroke: '#000', sw: 0 } }, p, tol)) { const a = by('q2'), b = by('q0'); return [a, b, s.id]; }
    }
  }
  return null;
}
const dimension = {
  id: 'dim', title: 'Dimension', keyb: 'K', a: null, b: null, cur: null,
  hint: 'Click a line, an edge of a rectangle or a circle to dimension it, or click two points. Then click where the dimension should sit and type the value: the shape follows it. Driving dimensions hold their shape like Fusion 360 sketch dimensions; double-click a value later to change it.',
  options: [{ id: 'dec', label: 'Decimals', type: 'number', min: 0, max: 6, default: 2 }, { id: 'unit', label: 'Show unit', type: 'check', default: true }, { id: 'driving', label: 'Driving (constrains)', type: 'check', default: true }],
  pt(ev) { const r = this.a ? resolve(ev, this.a) : snapPoint(ev.p); view.snapMark = r; this.ref = findAnchor(D(), r, 2 / D().view.zoom); return { x: r.x, y: r.y }; },
  shape() {
    const d = D(), a = this.a, b = this.b || this.cur, S = app.settings, DS = S.dimStyle || {}, L = dist(a, b) || 1, st = curStyle();
    const off = this.b ? ((this.cur.x - a.x) * -(b.y - a.y) + (this.cur.y - a.y) * (b.x - a.x)) / L : 0;
    return { type: 'dim', a: { ...a }, b: { ...b }, off, ...(this.ra ? { ra: this.ra } : {}), ...(this.rb ? { rb: this.rb } : {}), size: (DS.sizePt ?? S.text.sizePt) * d.ptPx, font: DS.font || S.text.font, dec: this.opt.dec, unit: this.opt.unit,
      st: { stroke: DS.stroke || (typeof st.stroke === 'string' ? st.stroke : null) || '#000000', sw: (DS.swPt ?? 0.75) * d.ptPx, as: DS.as || 'arrow', ae: DS.ae || 'arrow', hs: DS.hs ?? 1, alpha: 1 } };
  },
  down(ev) {
    const d = D(); d.hideDims = false;
    if (!this.a) {
      const e = dimTarget(ev.p);
      if (e) { this.a = { x: e[0].x, y: e[0].y }; this.b = { x: e[1].x, y: e[1].y }; this.ra = { id: e[2], k: e[0].k }; this.rb = { id: e[2], k: e[1].k }; this.cur = ev.p; view.snapMark = null; return; }
      this.a = this.pt(ev); this.ra = this.ref; this.cur = this.a;
    }
    else if (!this.b) { const p = this.pt(ev); if (dist(p, this.a) > 1e-6) { this.b = p; this.rb = this.ref; this.cur = ev.p; view.snapMark = null; } }
    else {
      this.cur = ev.p; const s = this.shape(); this.cancel();
      if ((s.ra || s.rb) && this.opt.driving) s.lock = dist(s.a, s.b);
      addShape(s, 'Dimension'); const o = d.findShape(s.id); if (o) editDimValue(o.s, o.L); // type the value straight away
    }
  },
  move(ev) { if (this.b) this.cur = ev.p; else if (this.a) this.cur = this.pt(ev); else { view.snapMark = snapPoint(ev.p); this.hover = dimTarget(ev.p); } },
  key(e) { if (e.key === 'Escape' && this.a) { this.cancel(); return true; } return false; },
  context() { if (!this.a) return false; this.cancel(); return true; },
  cancel() { this.a = this.b = this.cur = this.ra = this.rb = this.hover = null; view.snapMark = null; app.refresh('overlay'); },
  deactivate() { this.cancel(); },
  draw(ctx) {
    if (!this.a && this.hover) { const A = view.S(this.hover[0]), B = view.S(this.hover[1]); ctx.strokeStyle = '#19c37d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); return; }
    if (!this.a || !this.cur) return; const v = D().view; ctx.save(); ctx.translate(v.tx, v.ty); ctx.scale(v.zoom, v.zoom); ctx.globalAlpha = 0.85; drawShape(ctx, this.shape()); ctx.restore();
  },
};

// ---------- free transform (image layers and selected pixels) ----------
const rotM = a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const backToSelect = msg => setTimeout(() => { app.setTool('select'); if (msg) app.toast(msg, 4000); }, 0);
const transform = {
  id: 'transform', title: 'Free Transform', keyb: 'F', t: null, m: null, cursor: 'default',
  hint: 'Drag inside to move, a handle to scale (Shift keeps proportions, Alt scales about the centre), outside to rotate (Shift = 15° steps). Exact values go in the boxes above. Enter applies, Esc cancels.',
  activate() {
    const d = D(), L = d && d.active; this.t = null;
    if (!d) return;
    if (d.selShapes.size || (L && L.type === 'vector')) { // shapes use the Select tool's handles and typed values
      if (!d.selShapes.size) d.selShapes = new Set(L.shapes.map(s => s.id));
      backToSelect('Shapes: drag the handles, or type numbers (Tab changes box) and press Enter'); return;
    }
    if (!L || L.type !== 'raster' || L.locked) { backToSelect('Select an unlocked image layer or some shapes to transform'); return; }
    let src, r, base = null, selC = null, ox = 0, oy = 0;
    if (d.sel && d.selBounds) {
      coverDoc(d, L); r = d.selBounds;
      src = mk(r.w, r.h); const x = src.getContext('2d'); x.drawImage(L.canvas, L.x - r.x, L.y - r.y); x.globalCompositeOperation = 'destination-in'; x.drawImage(d.sel, -r.x, -r.y);
      base = copyCanvas(L.canvas); const b = base.getContext('2d'); b.globalCompositeOperation = 'destination-out'; b.drawImage(d.sel, -L.x, -L.y);
      selC = mk(r.w, r.h); selC.getContext('2d').drawImage(d.sel, -r.x, -r.y);
    } else { // trim to the layer's content
      const w = L.canvas.width, h = L.canvas.height, a = L.ctx.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { backToSelect('This layer is empty'); return; }
      ox = x0; oy = y0; r = { x: L.x + x0, y: L.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      src = mk(r.w, r.h); src.getContext('2d').drawImage(L.canvas, -x0, -y0);
    }
    this.t = { L, src, base, selC, ox, oy, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0, orig: { canvas: L.canvas, x: L.x, y: L.y }, x0: r.x, y0: r.y, changed: false };
  },
  M(t = this.t) { return mMul(mMul(mMul(mTranslate(t.cx, t.cy), rotM(t.rot)), [t.sx, 0, 0, t.sy, 0, 0]), mTranslate(-t.w / 2, -t.h / 2)); },
  box(t = this.t) {
    const M = this.M(t), c = [[0, 0], [t.w, 0], [t.w, t.h], [0, t.h]].map(([x, y]) => mApply(M, { x, y })), xs = c.map(p => p.x), ys = c.map(p => p.y);
    return { c, x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) };
  },
  preview() {
    const t = this.t, L = t.L, M = this.M(); t.changed = true;
    if (t.base) { const x = L.ctx; x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(t.base, 0, 0); x.globalCompositeOperation = 'source-over'; x.imageSmoothingQuality = 'high'; x.setTransform(M[0], M[1], M[2], M[3], M[4] - L.x, M[5] - L.y); x.drawImage(t.src, 0, 0); x.restore(); }
    else { const b = this.box(), w = Math.min(16000, Math.max(1, b.x1 - b.x)), h = Math.min(16000, Math.max(1, b.y1 - b.y)), c = mk(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.setTransform(M[0], M[1], M[2], M[3], M[4] - b.x, M[5] - b.y); x.drawImage(t.src, 0, 0); L.canvas = c; L.x = b.x; L.y = b.y; }
    app.refresh('render', 'tool');
  },
  apply() {
    const t = this.t, d = D(); if (!t) return; this.t = null; this.m = null;
    if (!t.changed) { app.refresh('overlay', 'tool'); return; }
    const M = this.M(t), L = t.L;
    if (t.selC) setSelection(d, x => { x.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); x.drawImage(t.selC, 0, 0); });
    L.touch();
    if (L.hd && !t.base) hdAffine(L, mMul(mMul(mTranslate(-L.x, -L.y), M), mTranslate(-t.ox, -t.oy)), L.canvas.width, L.canvas.height);
    app.commit('Free transform');
  },
  cancel() {
    const t = this.t; if (!t) return; this.t = null; this.m = null;
    if (t.changed) { if (t.base) { const x = t.L.ctx; x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(t.base, 0, 0); x.globalCompositeOperation = 'source-over'; x.drawImage(t.src, t.x0 - t.L.x, t.y0 - t.L.y); x.restore(); } else Object.assign(t.L, { canvas: t.orig.canvas, x: t.orig.x, y: t.orig.y }); }
    app.refresh('render', 'tool');
  },
  deactivate() { this.apply(); },
  handles() { const t = this.t, M = this.M(); return [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([u, v]) => ({ u, v, ...mApply(M, { x: (u + 1) / 2 * t.w, y: (v + 1) / 2 * t.h }) })); },
  local(p, t) { const dx = p.x - t.cx, dy = p.y - t.cy, c = Math.cos(-t.rot), s = Math.sin(-t.rot); return { x: dx * c - dy * s, y: dx * s + dy * c }; },
  down(ev) {
    const t = this.t; if (!t) return;
    const h = this.handles().find(q => scr(ev.p, q) < 9), q = this.local(ev.p, t), t0 = { ...t };
    if (h) this.m = { mode: 'scale', h, t0 };
    else if (Math.abs(q.x) <= Math.abs(t.w * t.sx) / 2 && Math.abs(q.y) <= Math.abs(t.h * t.sy) / 2) this.m = { mode: 'move', start: ev.p, t0 };
    else this.m = { mode: 'rot', a0: Math.atan2(ev.p.y - t.cy, ev.p.x - t.cx), t0 };
  },
  move(ev) {
    const m = this.m, t = this.t; if (!m || !t || !ev.drag) return;
    const t0 = m.t0;
    if (m.mode === 'move') { let dx = ev.p.x - m.start.x, dy = ev.p.y - m.start.y; if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } t.cx = t0.cx + dx; t.cy = t0.cy + dy; }
    else if (m.mode === 'rot') { let a = Math.atan2(ev.p.y - t0.cy, ev.p.x - t0.cx) - m.a0; if (ev.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); t.rot = t0.rot + a; }
    else {
      const { u, v } = m.h, q = this.local(ev.p, t0), hw = t0.w * t0.sx / 2, hh = t0.h * t0.sy / 2; let sx = t0.sx, sy = t0.sy;
      if (u) sx = ev.alt ? 2 * q.x * u / t0.w : (q.x + u * hw) * u / t0.w;
      if (v) sy = ev.alt ? 2 * q.y * v / t0.h : (q.y + v * hh) * v / t0.h;
      if (ev.shift) { const k = Math.max(u ? Math.abs(sx / t0.sx) : 0, v ? Math.abs(sy / t0.sy) : 0); sx = t0.sx * k; sy = t0.sy * k; }
      if (Math.abs(sx) < 1e-3) sx = 1e-3; if (Math.abs(sy) < 1e-3) sy = 1e-3;
      const lx = ev.alt || !u ? 0 : -u * hw + u * t0.w * sx / 2, ly = ev.alt || !v ? 0 : -v * hh + v * t0.h * sy / 2, c = Math.cos(t0.rot), s = Math.sin(t0.rot);
      t.sx = sx; t.sy = sy; t.cx = t0.cx + lx * c - ly * s; t.cy = t0.cy + lx * s + ly * c;
    }
    this.preview();
  },
  up() { this.m = null; },
  key(e) { if (!this.t) return false; if (e.key === 'Enter') { this.apply(); app.setTool('select'); return true; } if (e.key === 'Escape') { this.cancel(); app.setTool('select'); return true; } return false; },
  // numeric boxes for the options bar
  bar() {
    const t = this.t, d = D(); if (!t) return null; const U = v => +fmt(d.toU(v), 3);
    return { defs: [{ id: 'x', label: 'X', type: 'len', tip: 'Centre, horizontal' }, { id: 'y', label: 'Y', type: 'len', tip: 'Centre, vertical' }, { id: 'w', label: 'Width', type: 'len' }, { id: 'h', label: 'Height', type: 'len' }, { id: 'sc', label: 'Scale %', type: 'number' }, { id: 'rot', label: 'Rotate °', type: 'number' },
      { type: 'button', label: 'Apply ⏎', click: () => { this.apply(); app.setTool('select'); } }, { type: 'button', label: 'Cancel', click: () => { this.cancel(); app.setTool('select'); } }],
      vals: { x: t.cx, y: t.cy, w: t.w * Math.abs(t.sx), h: t.h * Math.abs(t.sy), sc: +fmt(Math.abs(t.sx) * 100, 2), rot: +fmt(-t.rot * 180 / Math.PI, 2) },
      set: (id, v) => {
        if (id === 'x') t.cx = v; else if (id === 'y') t.cy = v; else if (id === 'w' && v > 0) t.sx = Math.sign(t.sx) * v / t.w; else if (id === 'h' && v > 0) t.sy = Math.sign(t.sy) * v / t.h;
        else if (id === 'sc' && v > 0) { t.sx = Math.sign(t.sx) * v / 100; t.sy = Math.sign(t.sy) * v / 100; } else if (id === 'rot') t.rot = -v * Math.PI / 180;
        this.preview();
      } };
  },
  draw(ctx) {
    const t = this.t; if (!t) return; const c = this.box().c.map(p => view.S(p));
    ctx.strokeStyle = '#4c9ffe'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#fff'; for (const q of this.handles()) { const p = view.S(q); ctx.beginPath(); ctx.rect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8); ctx.fill(); ctx.stroke(); }
    const o = view.S({ x: t.cx, y: t.cy }); ctx.beginPath(); ctx.moveTo(o.x - 5, o.y); ctx.lineTo(o.x + 5, o.y); ctx.moveTo(o.x, o.y - 5); ctx.lineTo(o.x, o.y + 5); ctx.stroke();
  },
};

// ---------- object select (neural network) ----------
const objsel = {
  id: 'objsel', title: 'Object Select (AI)', keyb: 'Q', busy: false,
  hint: 'Click an object to select it (Shift adds, Alt subtracts). Select ▸ Subject picks the main subject automatically; Select ▸ Refine softens or grows the result. Runs in your browser; the first use downloads the model.',
  async down(ev) {
    if (this.busy) return; this.busy = true; const d = D(), mode = selMode(ev);
    try { const m = await objectMask(d, [{ x: ev.p.x, y: ev.p.y }]); if (app.doc === d) { setSelection(d, c => c.drawImage(m, 0, 0), mode); app.commit('Object select'); } }
    catch (e) { console.error(e); app.toast('Object selection failed: ' + (e.message || e) + ' — the first use needs an internet connection', 8000); }
    this.busy = false;
  },
};

// toolbar order; '-' is a divider
// '#Name' starts a labelled group
export const TOOL_ORDER = ['#Move', 'select', 'node', 'transform', 'crop', '#Select', 'marquee', 'lasso', 'wand', 'objsel', '#Draw', 'line', 'spline', 'pen', 'text', 'rect', 'ellipse', '#Measure', 'dim', 'measure', '#Paint', 'brush', 'eraser', 'stamp', 'remove', 'bucket', 'gradient', '#View', 'eyedropper', 'hand', 'zoom'];
export function registerTools() {
  for (const t of [select, node, transform, polyTool('line', 'Line / Polyline', 'N', false), polyTool('spline', 'Spline (smooth curve)', 'Y', true), pen, boxTool('rect', 'Rectangle', 'R', 'rect'), boxTool('ellipse', 'Ellipse', 'O', 'ellipse'), text, dimension, measure, marquee, lasso, wand, objsel, crop,
    paintTool('brush', 'Brush', 'B', 'paint'), paintTool('eraser', 'Eraser', 'E', 'erase'), paintTool('stamp', 'Clone Stamp', 'S', 'stamp'), remove, bucket, gradient, eyedropper, hand, zoom]) app.registerTool(t);
}
