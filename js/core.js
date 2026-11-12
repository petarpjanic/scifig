// Core model: geometry helpers, vector shapes, layers, document with history, renderer.
import { app } from './app.js';

// ---------- canvas helpers ----------
export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const copyCanvas = c => { const n = mk(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; };
let REV = 1;
export const nextRev = () => ++REV;
let IDN = 0;
export const uid = (p = 's') => p + Date.now().toString(36) + (IDN++).toString(36);

// ---------- geometry ----------
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function closestOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  const tc = Math.max(0, Math.min(1, t));
  const x = a.x + dx * tc, y = a.y + dy * tc;
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
}
export function segIntersect(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}
export function cubicPt(p0, p1, p2, p3, t) {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}
// 2x3 matrices [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f
export const mApply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const mMul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const mTranslate = (x, y) => [1, 0, 0, 1, x, y];
export const mScaleAbout = (sx, sy, c) => [sx, 0, 0, sy, c.x - sx * c.x, c.y - sy * c.y];
export const mRotateAbout = (a, c) => { const co = Math.cos(a), si = Math.sin(a); return [co, si, -si, co, c.x - co * c.x + si * c.y, c.y - si * c.x - co * c.y]; };

// ---------- units ----------
export const UNITS = { px: null, mm: 25.4, cm: 2.54, in: 1, pt: 72 };
export const unitScale = (unit, dpi) => unit === 'px' || !UNITS[unit] ? 1 : dpi / UNITS[unit];
export const fmt = (v, d = 2) => String(+(+v).toFixed(d));

// ---------- shapes ----------
// path: {nodes:[{x,y,ix,iy,ox,oy}], closed, subs:[{nodes,closed}]}  rect: {x,y,w,h,r,rot}
// ellipse: {cx,cy,rx,ry,rot}  text: {x,y,text,size,font,bold,italic,align,rot}
// style st: {stroke, sw, fill, dash, as, ae, alpha}
const hctx = mk(1, 1).getContext('2d');
export const DASHES = { solid: [], dashed: [4, 3], dotted: [0.1, 2.2], dashdot: [5, 2.5, 0.1, 2.5] };
export const HEADS = ['none', 'arrow', 'open', 'bar', 'dot', 'circle', 'square', 'diamond'];
// Dash pattern in stroke widths. st.dl / st.dg override the dash and gap length of the preset.
export function dashArr(st) {
  const p = DASHES[st.dash] || []; if (!p.length) return p;
  const dl = st.dl > 0 ? st.dl : p[0], dg = st.dg > 0 ? st.dg : p[1];
  return st.dash === 'dotted' ? [0.1, dg] : st.dash === 'dashdot' ? [dl, dg, 0.1, dg] : [dl, dg];
}
// Web fonts are fetched from Google Fonts the first time a text uses them.
export const WEBFONTS = ['Roboto', 'Open Sans', 'Lato', 'Inter', 'Source Sans 3', 'Noto Sans', 'Montserrat', 'IBM Plex Sans', 'Fira Sans', 'Nunito', 'Work Sans', 'Raleway', 'Poppins', 'Oswald', 'Barlow', 'DM Sans',
  'Merriweather', 'Lora', 'Source Serif 4', 'Noto Serif', 'EB Garamond', 'Libre Baskerville', 'Playfair Display', 'PT Serif', 'Crimson Text', 'STIX Two Text', 'Cormorant Garamond', 'Bitter',
  'Roboto Mono', 'Source Code Pro', 'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Inconsolata', 'Space Mono', 'Caveat', 'Patrick Hand', 'Architects Daughter', 'Bebas Neue', 'Abril Fatface'];
const fontSeen = new Set();
export function needFont(name) {
  if (!name || fontSeen.has(name)) return; fontSeen.add(name);
  if (!WEBFONTS.includes(name)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.crossOrigin = 'anonymous';
  l.href = 'https://fonts.googleapis.com/css?family=' + name.replace(/ /g, '+') + ':400,400i,700,700i&display=swap';
  l.onload = () => Promise.all(['', 'bold ', 'italic ', 'italic bold '].map(v => document.fonts.load(`${v}16px "${name}"`))).then(() => { for (const d of app.docs) for (const L of d.layers) if (L.type === 'vector') L.rev = nextRev(); app.refresh('all'); }, () => {});
  document.head.appendChild(l);
}

export function rectCorners(s) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, c = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const dx = a * s.w / 2, dy = b * s.h / 2; return { x: cx + dx * c - dy * si, y: cy + dx * si + dy * c }; });
}
export function ellipseNodes(s) {
  const k = 0.5522847498, { rx, ry } = s, c = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0);
  const T = (x, y) => ({ x: s.cx + x * c - y * si, y: s.cy + x * si + y * c });
  const raw = [[rx, 0, rx, -k * ry, rx, k * ry], [0, ry, k * rx, ry, -k * rx, ry], [-rx, 0, -rx, k * ry, -rx, -k * ry], [0, -ry, -k * rx, -ry, k * rx, -ry]];
  return raw.map(r => { const p = T(r[0], r[1]), i = T(r[2], r[3]), o = T(r[4], r[5]); return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; });
}
// Every non-text shape as a list of bezier subpaths.
export function geomSubs(s) {
  if (s.type === 'path') return s.subs ? [s, ...s.subs] : [s];
  if (s.type === 'rect') return [{ nodes: rectCorners(s), closed: true }];
  if (s.type === 'ellipse') return [{ nodes: ellipseNodes(s), closed: true }];
  if (s.type === 'dim') return dimShapes(s).filter(q => q.type === 'path');
  return [];
}
// A dimension {a, b, off, size, font, text, dec} drawn as ordinary shapes: dimension line, two extension lines, label.
let RD = null; // document being rendered (dimension labels show its units)
let EXPORTING = false; // while exporting, dimensions marked "constraint only" are left out
export const setExporting = v => { EXPORTING = v; };
const dimHidden = s => { const d = RD || app.doc; return (d && d.hideDims) || (EXPORTING && s.note === false); };
export function dimShapes(s) {
  const d = RD || app.doc, a = s.a, b = s.b, L = dist(a, b) || 1e-9, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, nx = -uy, ny = ux, off = s.off || 0, sg = off < 0 ? -1 : 1;
  const st = s.st || {}, A = { x: a.x + nx * off, y: a.y + ny * off }, B = { x: b.x + nx * off, y: b.y + ny * off }, g = Math.min(Math.abs(off), s.size * 0.25) * sg, e = s.size * 0.4 * sg;
  const line = { stroke: st.stroke, sw: st.sw, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: st.alpha };
  const ext = (p, P) => ({ type: 'path', closed: false, st: line, nodes: [{ x: p.x + nx * g, y: p.y + ny * g }, { x: P.x + nx * e, y: P.y + ny * e }] });
  let rot = Math.atan2(uy, ux); if (rot > Math.PI / 2 + 1e-9 || rot <= -Math.PI / 2 + 1e-9) rot += Math.PI;
  const up = s.size * 0.3 + (st.sw || 0), label = s.text || `${(d ? d.toU(L) : L).toFixed(s.dec ?? 2)}${s.unit === false || !d ? '' : ' ' + d.unit}`;
  return [{ type: 'path', closed: false, nodes: [{ x: A.x, y: A.y }, { x: B.x, y: B.y }], st: { ...line, as: st.as ?? 'arrow', ae: st.ae ?? 'arrow', hs: st.hs } }, ext(a, A), ext(b, B),
    { type: 'text', x: (A.x + B.x) / 2 + Math.sin(rot) * up, y: (A.y + B.y) / 2 - Math.cos(rot) * up, text: label, size: s.size, font: s.font || 'Arial', bold: s.lock != null, italic: false, align: 'center', rot, st: { fill: st.stroke || '#000', alpha: st.alpha } }];
}
// Spline nodes (flag a) get their handles from their neighbours; t is the smoothness (1 = natural).
export function autoSmooth(sp, t = 1) {
  const n = sp.nodes, L = n.length;
  for (let i = 0; i < L; i++) {
    const q = n[i]; if (!q.a) continue;
    const p = sp.closed ? n[(i - 1 + L) % L] : n[i - 1], x = sp.closed ? n[(i + 1) % L] : n[i + 1];
    delete q.ix; delete q.iy; delete q.ox; delete q.oy;
    if (!p || !x || p === q || x === q || L < 3) continue;
    const tx = x.x - p.x, ty = x.y - p.y, tl = Math.hypot(tx, ty) || 1, li = dist(q, p) * t / 3, lo = dist(q, x) * t / 3;
    q.ix = q.x - tx / tl * li; q.iy = q.y - ty / tl * li; q.ox = q.x + tx / tl * lo; q.oy = q.y + ty / tl * lo;
  }
}
export function smoothShape(s) { if (s.type === 'path') for (const sp of s.subs ? [s, ...s.subs] : [s]) autoSmooth(sp, s.tension ?? 1); }
const isCurve = (a, b) => a.ox != null || b.ix != null;
function buildPath(subs) {
  const p = new Path2D();
  for (const sp of subs) {
    const n = sp.nodes; if (!n.length) continue;
    p.moveTo(n[0].x, n[0].y);
    const cnt = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < cnt; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      if (isCurve(a, b)) p.bezierCurveTo(a.ox ?? a.x, a.oy ?? a.y, b.ix ?? b.x, b.iy ?? b.y, b.x, b.y);
      else p.lineTo(b.x, b.y);
    }
    if (sp.closed) p.closePath();
  }
  return p;
}
export function shapePath(s) {
  if (s.type === 'text') { const c = textCorners(s), p = new Path2D(); p.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) p.lineTo(c[i].x, c[i].y); p.closePath(); return p; }
  if (s.type === 'rect' && s.r > 0) {
    const r = Math.min(s.r, s.w / 2, s.h / 2), b = new Path2D();
    b.moveTo(s.x + r, s.y); b.arcTo(s.x + s.w, s.y, s.x + s.w, s.y + s.h, r); b.arcTo(s.x + s.w, s.y + s.h, s.x, s.y + s.h, r);
    b.arcTo(s.x, s.y + s.h, s.x, s.y, r); b.arcTo(s.x, s.y, s.x + s.w, s.y, r); b.closePath();
    if (!s.rot) return b;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, p = new Path2D();
    p.addPath(b, new DOMMatrix().translate(cx, cy).rotate(s.rot * 180 / Math.PI).translate(-cx, -cy));
    return p;
  }
  return buildPath(geomSubs(s));
}

// Straight pieces for snapping and hit maths. real = a true straight edge (midpoint / perpendicular make sense).
export function shapeSegs(s) {
  const out = [];
  if (s.type === 'text') { const c = textCorners(s); for (let i = 0; i < 4; i++) out.push({ a: c[i], b: c[(i + 1) % 4], real: false }); return out; }
  for (const sp of geomSubs(s)) {
    const n = sp.nodes, cnt = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < cnt; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      if (!isCurve(a, b)) { out.push({ a, b, real: true }); continue; }
      const p1 = { x: a.ox ?? a.x, y: a.oy ?? a.y }, p2 = { x: b.ix ?? b.x, y: b.iy ?? b.y };
      let prev = a;
      for (let k = 1; k <= 14; k++) { const q = cubicPt(a, p1, p2, b, k / 14); out.push({ a: prev, b: q, real: false }); prev = q; }
    }
  }
  return out;
}
export function keyPoints(s) {
  const out = [];
  if (s.type === 'text') { out.push({ x: s.x, y: s.y, kind: 'end' }); return out; }
  if (s.type === 'dim') return [{ x: s.a.x, y: s.a.y, kind: 'end' }, { x: s.b.x, y: s.b.y, kind: 'end' }];
  if (s.type === 'ellipse') out.push({ x: s.cx, y: s.cy, kind: 'center' });
  if (s.type === 'rect') out.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, kind: 'center' });
  for (const sp of geomSubs(s)) {
    const n = sp.nodes, cnt = sp.closed ? n.length : n.length - 1;
    for (const p of n) out.push({ x: p.x, y: p.y, kind: s.type === 'ellipse' ? 'quad' : 'end' });
    for (let i = 0; i < cnt; i++) { const a = n[i], b = n[(i + 1) % n.length]; if (!isCurve(a, b)) out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'mid' }); }
  }
  return out;
}
export function shapeBBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; };
  if (s.type === 'text') textCorners(s).forEach(add);
  else for (const g of shapeSegs(s)) { add(g.a); add(g.b); }
  if (s.type === 'dim') textCorners(dimShapes(s)[3]).forEach(add);
  if (x0 === Infinity && s.nodes && s.nodes[0]) add(s.nodes[0]);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function bboxOf(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) { const b = shapeBBox(s); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function hitShape(s, p, tol) {
  const path = shapePath(s);
  if (s.type === 'text') return hctx.isPointInPath(path, p.x, p.y);
  const st = s.st || {};
  if (s.type === 'dim' && dimHidden(s)) return false;
  if (s.type === 'dim' && hctx.isPointInPath(shapePath(dimShapes(s)[3]), p.x, p.y)) return true;
  if (st.fill && hctx.isPointInPath(path, p.x, p.y, 'evenodd')) return true;
  hctx.lineWidth = Math.max(st.stroke ? st.sw || 0 : 0, tol * 2);
  return hctx.isPointInStroke(path, p.x, p.y);
}

export function convertToPath(s) {
  if (s.type !== 'rect' && s.type !== 'ellipse') return s;
  const nodes = geomSubs(s)[0].nodes;
  for (const k of ['x', 'y', 'w', 'h', 'r', 'rot', 'cx', 'cy', 'rx', 'ry']) delete s[k];
  s.type = 'path'; s.nodes = nodes; s.closed = true;
  return s;
}
function mapNode(n, m) {
  const p = mApply(m, n); const o = { x: p.x, y: p.y };
  if (n.ix != null) { const q = mApply(m, { x: n.ix, y: n.iy }); o.ix = q.x; o.iy = q.y; }
  if (n.ox != null) { const q = mApply(m, { x: n.ox, y: n.oy }); o.ox = q.x; o.oy = q.y; }
  if (n.a) o.a = 1;
  return o;
}
export function transformShape(s, m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const sim = Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9;
  const axis = Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12;
  const k = Math.sqrt(Math.abs(det)), ang = Math.atan2(m[1], m[0]);
  if (s.type === 'text') {
    const p = mApply(m, s); s.x = p.x; s.y = p.y; s.size *= k;
    if (!axis) s.rot = (s.rot || 0) + ang;
    return s;
  }
  if (s.type === 'dim') { s.a = mApply(m, s.a); s.b = mApply(m, s.b); s.off = (s.off || 0) * k * (det < 0 ? -1 : 1); s.size *= k; return s; }
  if (s.type === 'rect') {
    if (sim) { const c = mApply(m, { x: s.x + s.w / 2, y: s.y + s.h / 2 }); s.w *= k; s.h *= k; if (s.r) s.r *= k; s.rot = (s.rot || 0) + ang; s.x = c.x - s.w / 2; s.y = c.y - s.h / 2; return s; }
    if (axis && !s.rot) { const a = mApply(m, s), b = mApply(m, { x: s.x + s.w, y: s.y + s.h }); s.x = Math.min(a.x, b.x); s.y = Math.min(a.y, b.y); s.w = Math.abs(b.x - a.x); s.h = Math.abs(b.y - a.y); return s; }
    convertToPath(s);
  }
  if (s.type === 'ellipse') {
    if (sim) { const c = mApply(m, { x: s.cx, y: s.cy }); s.cx = c.x; s.cy = c.y; s.rx *= k; s.ry *= k; s.rot = (s.rot || 0) + ang; return s; }
    if (axis && !s.rot) { const c = mApply(m, { x: s.cx, y: s.cy }); s.cx = c.x; s.cy = c.y; s.rx *= Math.abs(m[0]); s.ry *= Math.abs(m[3]); return s; }
    convertToPath(s);
  }
  s.nodes = s.nodes.map(n => mapNode(n, m));
  if (s.subs) s.subs = s.subs.map(sp => ({ nodes: sp.nodes.map(n => mapNode(n, m)), closed: sp.closed }));
  return s;
}

// ---------- text ----------
export const fontOf = (s, size = s.size) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${size}px ${/[ ,]/.test(s.font || '') && !/["',]/.test(s.font) ? '"' + s.font + '"' : s.font || 'Arial'}`;
// ^{..} superscript and _{..} subscript
export function textRuns(line) {
  const runs = []; const re = /([\^_])\{([^}]*)\}/g; let i = 0, m;
  while ((m = re.exec(line))) { if (m.index > i) runs.push({ t: line.slice(i, m.index), mode: '' }); runs.push({ t: m[2], mode: m[1] }); i = re.lastIndex; }
  if (i < line.length) runs.push({ t: line.slice(i), mode: '' });
  return runs;
}
export function textLayout(s) {
  const lines = String(s.text || '').split('\n').map(line => {
    const runs = textRuns(line); let w = 0;
    for (const r of runs) { hctx.font = fontOf(s, r.mode ? s.size * 0.65 : s.size); r.w = hctx.measureText(r.t).width; w += r.w; }
    return { runs, w };
  });
  const w = Math.max(1, ...lines.map(l => l.w)), lh = s.size * 1.25;
  const x0 = s.align === 'center' ? -w / 2 : s.align === 'right' ? -w : 0;
  return { lines, w, lh, x0, y0: -s.size * 0.85, h: (lines.length - 1) * lh + s.size * 1.12 };
}
export function textCorners(s) {
  const L = textLayout(s), c = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0);
  return [[L.x0, L.y0], [L.x0 + L.w, L.y0], [L.x0 + L.w, L.y0 + L.h], [L.x0, L.y0 + L.h]].map(([x, y]) => ({ x: s.x + x * c - y * si, y: s.y + x * si + y * c }));
}
function drawText(ctx, s) {
  needFont(s.font);
  const L = textLayout(s);
  ctx.translate(s.x, s.y); ctx.rotate(s.rot || 0);
  ctx.fillStyle = (s.st && s.st.fill) || '#000'; ctx.textBaseline = 'alphabetic';
  L.lines.forEach((ln, i) => {
    let x = s.align === 'center' ? -ln.w / 2 : s.align === 'right' ? -ln.w : 0;
    for (const r of ln.runs) {
      ctx.font = fontOf(s, r.mode ? s.size * 0.65 : s.size);
      ctx.fillText(r.t, x, i * L.lh + (r.mode === '^' ? -s.size * 0.38 : r.mode === '_' ? s.size * 0.18 : 0));
      x += r.w;
    }
  });
}

// ---------- drawing ----------
const hp = (n, k) => n[k + 'x'] != null ? { x: n[k + 'x'], y: n[k + 'y'] } : null;
// Unit vector pointing out of an open path at one end, or null.
export function endDir(nodes, atEnd) {
  const L = nodes.length; if (L < 2) return null;
  const p = atEnd ? nodes[L - 1] : nodes[0];
  let q = atEnd ? (hp(p, 'i') || hp(nodes[L - 2], 'o') || nodes[L - 2]) : (hp(p, 'o') || hp(nodes[1], 'i') || nodes[1]);
  if (dist(p, q) < 1e-9) q = atEnd ? nodes[L - 2] : nodes[1];
  const d = dist(p, q); if (d < 1e-9) return null;
  return { x: (p.x - q.x) / d, y: (p.y - q.y) / d };
}
export const arrowLen = (sw, hs = 1) => (sw * 4 + 3) * (hs || 1);
function drawHead(ctx, kind, tip, d, sw, color, hs) {
  const L = arrowLen(sw, hs), nx = -d.y, ny = d.x;
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = sw; ctx.setLineDash([]); ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
  ctx.beginPath();
  if (kind === 'arrow') { ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - d.x * L + nx * L * 0.36, tip.y - d.y * L + ny * L * 0.36); ctx.lineTo(tip.x - d.x * L - nx * L * 0.36, tip.y - d.y * L - ny * L * 0.36); ctx.closePath(); ctx.fill(); }
  else if (kind === 'open') { ctx.moveTo(tip.x - d.x * L + nx * L * 0.4, tip.y - d.y * L + ny * L * 0.4); ctx.lineTo(tip.x, tip.y); ctx.lineTo(tip.x - d.x * L - nx * L * 0.4, tip.y - d.y * L - ny * L * 0.4); ctx.stroke(); }
  else if (kind === 'bar') { ctx.moveTo(tip.x + nx * L * 0.5, tip.y + ny * L * 0.5); ctx.lineTo(tip.x - nx * L * 0.5, tip.y - ny * L * 0.5); ctx.stroke(); }
  else if (kind === 'dot') { ctx.arc(tip.x, tip.y, L * 0.3, 0, 7); ctx.fill(); }
  else if (kind === 'circle') { ctx.arc(tip.x, tip.y, L * 0.32, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
  else if (kind === 'square') { const r = L * 0.28; ctx.moveTo(tip.x + (d.x + nx) * r, tip.y + (d.y + ny) * r); ctx.lineTo(tip.x + (d.x - nx) * r, tip.y + (d.y - ny) * r); ctx.lineTo(tip.x - (d.x + nx) * r, tip.y - (d.y + ny) * r); ctx.lineTo(tip.x - (d.x - nx) * r, tip.y - (d.y - ny) * r); ctx.closePath(); ctx.fill(); }
  else if (kind === 'diamond') { const r = L * 0.4; ctx.moveTo(tip.x + d.x * r, tip.y + d.y * r); ctx.lineTo(tip.x + nx * r * 0.7, tip.y + ny * r * 0.7); ctx.lineTo(tip.x - d.x * r, tip.y - d.y * r); ctx.lineTo(tip.x - nx * r * 0.7, tip.y - ny * r * 0.7); ctx.closePath(); ctx.fill(); }
}
export function drawShape(ctx, s) {
  const st = s.st || {};
  ctx.save();
  if (st.alpha != null && st.alpha < 1) ctx.globalAlpha *= st.alpha;
  if (s.type === 'text') { drawText(ctx, s); ctx.restore(); return; }
  if (s.type === 'dim') { if (!dimHidden(s)) { if (s.note === false) ctx.globalAlpha *= 0.5; for (const q of dimShapes(s)) drawShape(ctx, q); } ctx.restore(); return; }
  let path;
  const open = s.type === 'path' && !s.closed && s.nodes.length > 1;
  const heads = open && st.stroke && ((st.as && st.as !== 'none') || (st.ae && st.ae !== 'none'));
  let d0 = null, d1 = null;
  if (heads) {
    // pull the stroke end back under a filled arrowhead so it does not poke through the tip
    const nodes = s.nodes.map(n => ({ ...n }));
    d0 = endDir(s.nodes, false); d1 = endDir(s.nodes, true);
    const back = arrowLen(st.sw || 1, st.hs) * 0.8;
    if (st.as === 'arrow' && d0) { nodes[0].x -= d0.x * back; nodes[0].y -= d0.y * back; }
    if (st.ae === 'arrow' && d1) { const e = nodes[nodes.length - 1]; e.x -= d1.x * back; e.y -= d1.y * back; }
    path = buildPath([{ nodes, closed: false }, ...(s.subs || [])]);
  } else path = shapePath(s);
  if (st.fill) { ctx.fillStyle = st.fill; ctx.fill(path, 'evenodd'); }
  if (st.stroke && st.sw > 0) {
    ctx.strokeStyle = st.stroke; ctx.lineWidth = st.sw;
    ctx.lineCap = st.cap || (st.dash === 'dotted' ? 'round' : 'butt'); ctx.lineJoin = st.join || 'miter';
    ctx.setLineDash(dashArr(st).map(v => v * st.sw));
    ctx.stroke(path);
    if (heads) {
      const n = s.nodes;
      if (d0 && st.as && st.as !== 'none') drawHead(ctx, st.as, n[0], d0, st.sw, st.stroke, st.hs);
      if (d1 && st.ae && st.ae !== 'none') drawHead(ctx, st.ae, n[n.length - 1], d1, st.sw, st.stroke, st.hs);
    }
  }
  ctx.restore();
}

// ---------- layers ----------
export class Layer {
  constructor(o) {
    this.id = o.id || uid('L'); this.name = o.name || 'Layer'; this.type = o.type;
    this.visible = o.visible !== false; this.opacity = o.opacity ?? 1; this.blend = o.blend || 'normal'; this.locked = !!o.locked;
    this.x = o.x || 0; this.y = o.y || 0;
    this.canvas = o.canvas || null; this.shapes = o.shapes || null; this.adj = o.adj || null; this.params = o.params || null;
    this.mask = o.mask || null; this.maskOn = o.maskOn !== false; this.hd = o.hd || null;
    this.rev = nextRev(); this.mrev = nextRev();
  }
  touch() { this.rev = nextRev(); this._lut = null; }
  touchMask() { this.mrev = nextRev(); }
  get ctx() { return this.canvas.getContext('2d'); }
}
export const rasterLayer = (name, w, h, x = 0, y = 0) => new Layer({ type: 'raster', name, canvas: mk(w, h), x, y });
export const vectorLayer = name => new Layer({ type: 'vector', name, shapes: [] });
export const adjustLayer = (name, adj, params) => new Layer({ type: 'adjust', name, adj, params });

export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

// ---------- document ----------
export class Doc {
  constructor(o = {}) {
    this.id = uid('D'); this.name = o.name || 'Untitled';
    this.w = Math.round(o.w || 1200); this.h = Math.round(o.h || 900);
    this.dpi = o.dpi || 300; this.unit = o.unit || 'px';
    this.pxPerUnit = o.pxPerUnit || unitScale(this.unit, this.dpi);
    this.layers = []; this.activeId = null;
    this.sel = null; this.selRev = 0; this.selPath = null;
    this.selShapes = new Set(); this.selNodes = [];
    this.view = { zoom: 1, tx: 0, ty: 0, fit: true };
    this.hist = []; this.hi = -1; this._cache = new Map(); this.dirty = false;
    this.fileHandle = null;
    this.chan = { mode: 'rgb', edit: null }; // edit: null = all channels, else the list of editable channel indices
    this.editMask = false;                   // painting goes to the active layer's mask
    this.hideDims = !!o.hideDims;            // View ▸ Show Dimensions
  }
  get active() { return this.layers.find(l => l.id === this.activeId) || null; }
  layer(id) { return this.layers.find(l => l.id === id); }
  add(layer, above = this.active) {
    const i = above ? this.layers.indexOf(above) + 1 : this.layers.length;
    this.layers.splice(i, 0, layer); this.activeId = layer.id; return layer;
  }
  remove(layer) {
    const i = this.layers.indexOf(layer); if (i < 0) return;
    this.layers.splice(i, 1);
    if (this.activeId === layer.id) this.activeId = (this.layers[Math.max(0, i - 1)] || {}).id || null;
  }
  uniqueName(base) { let n = 1; const names = new Set(this.layers.map(l => l.name)); while (names.has(base + ' ' + n)) n++; return base + ' ' + n; }
  toU(px) { return px / this.pxPerUnit; }
  fromU(u) { return u * this.pxPerUnit; }
  get ptPx() { return this.dpi / 72; }
  setUnit(unit) { this.unit = unit; this.pxPerUnit = unitScale(unit, this.dpi); }
  // Selected shapes with their layer, in drawing order.
  selected() {
    const out = [];
    if (!this.selShapes.size) return out;
    for (const L of this.layers) if (L.type === 'vector') for (const s of L.shapes) if (this.selShapes.has(s.id)) out.push({ s, L });
    return out;
  }
  findShape(id) { for (const L of this.layers) if (L.type === 'vector') { const s = L.shapes.find(q => q.id === id); if (s) return { s, L }; } return null; }

  // ----- history: snapshots share unchanged layer content by revision -----
  snapshot(label) {
    const cache = this._cache;
    const grab = (key, rev, make) => { let c = cache.get(key); if (!c || c.rev !== rev) { c = { rev, content: make() }; cache.set(key, c); } return c.content; };
    const layers = this.layers.map(L => ({
      id: L.id, name: L.name, type: L.type, visible: L.visible, opacity: L.opacity, blend: L.blend, locked: L.locked, x: L.x, y: L.y, adj: L.adj, rev: L.rev,
      content: grab(L.id, L.rev, () => L.type === 'raster' ? copyCanvas(L.canvas) : JSON.stringify(L.type === 'vector' ? L.shapes : L.params)),
      maskOn: L.maskOn, mrev: L.mrev, mask: L.mask ? grab(L.id + ':m', L.mrev, () => copyCanvas(L.mask)) : null,
      hd: L.hd ? { ...L.hd, dev: { ...L.hd.dev } } : null, // float pixels are shared by reference: they are replaced, never changed in place
    }));
    return { label, w: this.w, h: this.h, dpi: this.dpi, unit: this.unit, pxPerUnit: this.pxPerUnit, activeId: this.activeId, layers,
      sel: this.sel ? grab('__sel', this.selRev, () => copyCanvas(this.sel)) : null, selRev: this.selRev };
  }
  commit(label) {
    for (const f of Doc.preCommit) f(this);
    this.hist.length = this.hi + 1;
    this.hist.push(this.snapshot(label));
    if (this.hist.length > 40) this.hist.shift();
    this.hi = this.hist.length - 1; this.dirty = true;
  }
  restore(s) {
    Object.assign(this, { w: s.w, h: s.h, dpi: s.dpi, unit: s.unit, pxPerUnit: s.pxPerUnit, activeId: s.activeId });
    this.layers = s.layers.map(o => {
      const L = new Layer(o);
      if (o.type === 'raster') L.canvas = copyCanvas(o.content); else if (o.type === 'vector') L.shapes = JSON.parse(o.content); else L.params = JSON.parse(o.content);
      L.rev = o.rev; this._cache.set(L.id, { rev: o.rev, content: o.content });
      L.mask = o.mask ? copyCanvas(o.mask) : null; L.maskOn = o.maskOn; L.mrev = o.mrev; if (o.mask) this._cache.set(L.id + ':m', { rev: o.mrev, content: o.mask });
      L.hd = o.hd ? { ...o.hd, dev: { ...o.hd.dev } } : null;
      return L;
    });
    this.sel = s.sel ? copyCanvas(s.sel) : null; this.selRev = s.selRev;
    if (s.sel) this._cache.set('__sel', { rev: s.selRev, content: s.sel });
    this.selPath = undefined; // recomputed lazily by the view
    const alive = new Set(); for (const L of this.layers) if (L.shapes) for (const q of L.shapes) alive.add(q.id);
    for (const id of [...this.selShapes]) if (!alive.has(id)) this.selShapes.delete(id);
    this.selNodes = [];
    if (!this.active || !this.active.mask) this.editMask = false;
  }
  undo() { if (this.hi <= 0) return false; this.restore(this.hist[--this.hi]); this.dirty = true; return true; }
  redo() { if (this.hi >= this.hist.length - 1) return false; this.restore(this.hist[++this.hi]); this.dirty = true; return true; }

  // ----- native file format -----
  toJSON(o = {}) {
    return {
      format: 'scifig', version: 2, name: this.name, w: this.w, h: this.h, dpi: this.dpi, unit: this.unit, pxPerUnit: this.pxPerUnit, activeId: this.activeId, hideDims: this.hideDims,
      layers: this.layers.map(L => ({ id: L.id, name: L.name, type: L.type, visible: L.visible, opacity: L.opacity, blend: L.blend, locked: L.locked, x: L.x, y: L.y,
        png: L.type === 'raster' ? L.canvas.toDataURL('image/png') : undefined, shapes: L.shapes || undefined, adj: L.adj || undefined, params: L.params || undefined,
        mask: L.mask ? L.mask.toDataURL('image/png') : undefined, maskOn: L.maskOn, hd: L.hd && Doc.packHD ? Doc.packHD(L.hd, o) : undefined })),
    };
  }
  static async fromJSON(o) {
    if (!o || (o.format !== 'scifig' && o.format !== 'figura')) throw new Error('Not a SciFig document');
    const pic = async src => { const img = new Image(); img.src = src; await img.decode(); const c = mk(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0); return c; };
    const d = new Doc(o);
    for (const l of o.layers) {
      const L = new Layer({ ...l, mask: null, hd: null });
      if (l.type === 'raster') L.canvas = await pic(l.png);
      if (l.mask) L.mask = await pic(l.mask);
      if (l.hd && Doc.unpackHD) { try { L.hd = Doc.unpackHD(l.hd); L.hd.rev = L.rev; } catch (e) { console.warn('high-bit data lost', e); } }
      d.layers.push(L);
    }
    d.activeId = o.activeId && d.layer(o.activeId) ? o.activeId : (d.layers[d.layers.length - 1] || {}).id;
    d.commit('Open');
    d.dirty = false;
    return d;
  }
}

Doc.preCommit = []; // hooks run before every history snapshot (channel locks, high-bit sync)

// ---------- renderer ----------
// Draws the document into ctx (device pixels): doc point p lands at p*s + (tx,ty). Used for the screen and for export.
let tmpC = null, tmpM = null;
const scratch = (c, W, H) => { if (!c) c = mk(W, H); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } const t = c.getContext('2d'); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.clearRect(0, 0, W, H); return c; };
// m: optional RGBA data whose alpha is the layer mask for the same pixels
export function applyAdjust(L, d, m) {
  const A = app.adjustments.get(L.adj); if (!A) return;
  const orig = L.opacity < 1 || m ? new Uint8ClampedArray(d) : null;
  if (A.lut && (!A.useLut || A.useLut(L.params))) {
    if (!L._lut) L._lut = A.lut(L.params);
    const [R, G, B] = L._lut;
    for (let i = 0; i < d.length; i += 4) { d[i] = R[d[i]]; d[i + 1] = G[d[i + 1]]; d[i + 2] = B[d[i + 2]]; }
  } else A.apply(d, L.params);
  if (orig) { const k = L.opacity; for (let i = 0; i < d.length; i += 4) { const q = m ? k * m[i + 3] / 255 : k; d[i] = orig[i] + (d[i] - orig[i]) * q; d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * q; d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * q; } }
}
export function renderDoc(ctx, doc, s, tx, ty, opts = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(tx)), y0 = Math.max(0, Math.floor(ty)), x1 = Math.min(W, Math.ceil(tx + doc.w * s)), y1 = Math.min(H, Math.ceil(ty + doc.h * s));
  if (x1 <= x0 || y1 <= y0) return;
  const prev = RD; RD = doc;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.rect(tx, ty, doc.w * s, doc.h * s); ctx.clip();
  for (const L of doc.layers) {
    if (!L.visible || (opts.skip && opts.skip(L))) continue;
    const op = L.blend === 'normal' ? 'source-over' : L.blend, M = L.mask && L.maskOn ? L.mask : null;
    if (L.type === 'adjust') {
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0); let m = null;
      if (M) { tmpM = scratch(tmpM, W, H); const t = tmpM.getContext('2d'); t.setTransform(s, 0, 0, s, tx, ty); t.drawImage(M, 0, 0, doc.w, doc.h); m = t.getImageData(x0, y0, x1 - x0, y1 - y0).data; }
      applyAdjust(L, img.data, m);
      ctx.putImageData(img, x0, y0);
      continue;
    }
    const group = !!M || (L.type === 'vector' && (L.opacity < 1 || op !== 'source-over'));
    let t = ctx;
    if (group) { tmpC = scratch(tmpC, W, H); t = tmpC.getContext('2d'); }
    else { ctx.globalAlpha = L.type === 'raster' ? L.opacity : 1; ctx.globalCompositeOperation = L.type === 'raster' ? op : 'source-over'; }
    if (L.type === 'raster') {
      t.setTransform(s, 0, 0, s, tx + L.x * s, ty + L.y * s);
      t.imageSmoothingEnabled = s < 3; t.imageSmoothingQuality = 'high';
      t.drawImage(L.canvas, 0, 0);
    } else { t.setTransform(s, 0, 0, s, tx, ty); for (const sh of L.shapes) drawShape(t, sh); }
    if (group) {
      if (M) { t.setTransform(s, 0, 0, s, tx, ty); t.globalCompositeOperation = 'destination-in'; t.imageSmoothingEnabled = s < 3; t.drawImage(M, 0, 0, doc.w, doc.h); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = L.opacity; ctx.globalCompositeOperation = op; ctx.drawImage(tmpC, 0, 0);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  RD = prev;
}
// Flattened image of the whole document at the given scale.
export function flatten(doc, scale = 1, opts = {}) {
  const c = mk(doc.w * scale, doc.h * scale), ctx = c.getContext('2d');
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, c.width, c.height); }
  if (opts.background) { const t = mk(c.width, c.height); renderDoc(t.getContext('2d'), doc, scale, 0, 0, opts); ctx.drawImage(t, 0, 0); }
  else renderDoc(ctx, doc, scale, 0, 0, opts);
  return c;
}

// New document with a white background layer, like a fresh sheet.
export function newDoc(o) {
  const d = new Doc(o);
  const bg = rasterLayer('Background', d.w, d.h);
  if (o.background !== 'transparent') { bg.ctx.fillStyle = o.background || '#ffffff'; bg.ctx.fillRect(0, 0, d.w, d.h); }
  d.add(bg);
  d.commit('New'); d.dirty = false;
  return d;
}
