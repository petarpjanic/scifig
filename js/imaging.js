// Pixel work: selection masks, flood fill, adjustments (non-destructive, pointwise), filters (destructive).
import { app } from './app.js';
import { mk, copyCanvas, nextRev, flatten, Doc } from './core.js';
import { hexToRgb, rgbToHex, rgbToLab, labToRgb } from './color.js';
export { hexToRgb, rgbToHex };

// ---------- colour helpers ----------
const TOLIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; TOLIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const fromLin = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
const lut = f => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) t[i] = clamp8(f(i)); return t; };
const lut3 = f => { const t = lut(f); return [t, t, t]; };
// filters may get float pixels ({width, height, data: Float32Array}); build results of the same kind
const like = (img, data) => img instanceof ImageData ? new ImageData(data, img.width, img.height) : { width: img.width, height: img.height, data };
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- selection ----------
// doc.sel is a document-sized canvas whose alpha is the selection mask (null = nothing selected = everything editable).
export function setSelection(doc, draw, mode = 'replace') {
  if (!doc.sel) { doc.sel = mk(doc.w, doc.h); if (mode !== 'add') mode = 'replace'; }
  if (doc.sel.width !== doc.w || doc.sel.height !== doc.h) doc.sel = mk(doc.w, doc.h);
  const ctx = doc.sel.getContext('2d');
  ctx.save();
  if (mode === 'replace') ctx.clearRect(0, 0, doc.w, doc.h);
  ctx.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
  ctx.fillStyle = '#fff';
  draw(ctx);
  ctx.restore();
  selChanged(doc);
}
export function clearSelection(doc) { doc.sel = null; selChanged(doc); }
export function selChanged(doc) { doc.selRev = nextRev(); ensureSelPath(doc); if (!doc.selPath) doc.sel = null; }
// Outline of the mask as a Path2D of pixel-edge runs (for the marching ants); also detects an empty mask.
export function ensureSelPath(doc) {
  if (doc._selPathRev === doc.selRev && doc.selPath !== undefined) return;
  doc._selPathRev = doc.selRev; doc.selPath = null; doc.selBounds = null;
  if (!doc.sel) return;
  const w = doc.w, h = doc.h, d = doc.sel.getContext('2d').getImageData(0, 0, w, h).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const p = new Path2D(); let any = false, x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const e = x < w && on(x, y - 1) !== on(x, y);
      if (e && start < 0) start = x;
      if (!e && start >= 0) { p.moveTo(start, y); p.lineTo(x, y); start = -1; any = true; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const e = y < h && on(x - 1, y) !== on(x, y);
      if (e && start < 0) start = y;
      if (!e && start >= 0) { p.moveTo(x, start); p.lineTo(x, y); start = -1; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
  }
  if (any) { doc.selPath = p; doc.selBounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
}
// Keep `fresh` only inside the selection and lay it over the layer (old pixels stay outside the selection).
export function applyThroughSelection(doc, L, fresh) {
  const ctx = L.ctx;
  if (!doc.sel) { ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); ctx.drawImage(fresh, 0, 0); return; }
  const t = copyCanvas(fresh), tc = t.getContext('2d');
  tc.globalCompositeOperation = 'destination-in'; tc.drawImage(doc.sel, -L.x, -L.y);
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(doc.sel, -L.x, -L.y); ctx.restore();
  ctx.drawImage(t, 0, 0);
}
// Grow a raster layer so it covers the whole document (painting outside a small pasted layer just works).
export function coverDoc(doc, L) {
  const x0 = Math.min(0, L.x), y0 = Math.min(0, L.y), x1 = Math.max(doc.w, L.x + L.canvas.width), y1 = Math.max(doc.h, L.y + L.canvas.height);
  if (x0 === L.x && y0 === L.y && x1 - x0 === L.canvas.width && y1 - y0 === L.canvas.height) return;
  const c = mk(x1 - x0, y1 - y0); c.getContext('2d').drawImage(L.canvas, L.x - x0, L.y - y0);
  if (L.hd) { // pad the float pixels the same way
    const o = L.hd, nd = new Float32Array(c.width * c.height * 4), dx = L.x - x0, dy = L.y - y0;
    for (let y = 0; y < o.h; y++) nd.set(o.data.subarray(y * o.w * 4, (y + 1) * o.w * 4), ((y + dy) * c.width + dx) * 4);
    L.hd = { ...o, w: c.width, h: c.height, data: nd, dev: { ...o.dev } };
  }
  L.canvas = c; L.x = x0; L.y = y0;
}
// Flood fill / magic wand on RGBA data. Returns Uint8Array mask (1 = selected).
export function floodMask(img, sx, sy, tol, contiguous) {
  const { width: w, height: h, data: d } = img, out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const i0 = (sy * w + sx) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const ok = i => { const k = i * 4; return Math.max(Math.abs(d[k] - r0), Math.abs(d[k + 1] - g0), Math.abs(d[k + 2] - b0), Math.abs(d[k + 3] - a0)) <= tol; };
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (ok(i)) out[i] = 1; return out; }
  const stack = [sy * w + sx]; out[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    if (x > 0 && !out[i - 1] && ok(i - 1)) { out[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && !out[i + 1] && ok(i + 1)) { out[i + 1] = 1; stack.push(i + 1); }
    if (i >= w && !out[i - w] && ok(i - w)) { out[i - w] = 1; stack.push(i - w); }
    if (i < w * (h - 1) && !out[i + w] && ok(i + w)) { out[i + w] = 1; stack.push(i + w); }
  }
  return out;
}
export function maskToCanvas(mask, w, h, color = [255, 255, 255]) {
  const c = mk(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { d[i * 4] = color[0]; d[i * 4 + 1] = color[1]; d[i * 4 + 2] = color[2]; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}

// Grow (r > 0) or shrink (r < 0) the selection by r pixels, smooth its outline, or feather it.
function morph(a, w, h, r, grow) {
  const pass = (n, lines, step, lineStep) => { const buf = new Uint8Array(n);
    for (let l = 0; l < lines; l++) { const base = l * lineStep; let cnt = 0;
      for (let i = 0; i < Math.min(n, r); i++) cnt += a[base + i * step] ? 1 : 0;
      for (let i = 0; i < n; i++) { if (i + r < n) cnt += a[base + (i + r) * step] ? 1 : 0; if (i - r - 1 >= 0) cnt -= a[base + (i - r - 1) * step] ? 1 : 0;
        const win = Math.min(n - 1, i + r) - Math.max(0, i - r) + 1; buf[i] = grow ? (cnt > 0 ? 255 : 0) : (cnt === win ? 255 : 0); }
      for (let i = 0; i < n; i++) a[base + i * step] = buf[i]; } };
  pass(w, h, 1, w); pass(h, w, w, 1);
}
export function refineSelection(doc, o) { // o: {shift, smooth, feather}; works on doc.sel in place
  if (!doc.sel) return;
  const w = doc.w, h = doc.h, x = doc.sel.getContext('2d'); let img = x.getImageData(0, 0, w, h);
  if (o.smooth > 0) { img = gaussian(img, o.smooth); const d = img.data; for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 127 ? 255 : 0; }
  if (o.shift) { const a = new Uint8Array(w * h), d = img.data; for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 127 ? 255 : 0; morph(a, w, h, Math.abs(Math.round(o.shift)), o.shift > 0); for (let i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a[i]; } }
  if (o.feather > 0) img = gaussian(img, o.feather);
  x.putImageData(img, 0, 0); selChanged(doc);
}
// Channel lock: when only some channels are editable (Channels panel), every edit is merged with the previous
// state of the layer just before it is recorded, so the locked channels keep their old values.
Doc.preCommit.push(doc => {
  const E = doc.chan && doc.chan.edit, last = doc.hist[doc.hi]; if (!E || !last) return;
  const lab = doc.chan.mode === 'lab', ok = c => E.includes(c);
  for (const L of doc.layers) {
    if (L.type !== 'raster') continue;
    const o = last.layers.find(q => q.id === L.id), w = L.canvas.width, h = L.canvas.height;
    if (!o || o.rev === L.rev || o.x !== L.x || o.y !== L.y || o.content.width !== w || o.content.height !== h) continue;
    const a = o.content.getContext('2d').getImageData(0, 0, w, h).data, img = L.ctx.getImageData(0, 0, w, h), b = img.data;
    for (let i = 0; i < b.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      if (!lab) { for (let c = 0; c < 4; c++) if (!ok(c)) b[i + c] = a[i + c]; }
      else { const p = rgbToLab(a[i], a[i + 1], a[i + 2]), q = rgbToLab(b[i], b[i + 1], b[i + 2]), r = labToRgb(ok(0) ? q[0] : p[0], ok(1) ? q[1] : p[1], ok(2) ? q[2] : p[2]); b[i] = r[0]; b[i + 1] = r[1]; b[i + 2] = r[2]; }
    }
    L.ctx.putImageData(img, 0, 0);
  }
});

// ---------- histogram ----------
export function histogram(doc) {
  const sc = Math.min(1, 400 / Math.max(doc.w, doc.h)), c = flatten(doc, sc);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256), Lm = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; R[d[i]]++; G[d[i + 1]]++; B[d[i + 2]]++; Lm[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++; }
  return { R, G, B, L: Lm };
}

// ---------- adjustments ----------
// Each is pointwise, so it can run on screen pixels. lut(p) -> [R,G,B] tables, or apply(data, p) for cross-channel maths.
const COLORMAPS = {
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
  fire: ['#000000', '#3c00a0', '#c81400', '#ffaa00', '#ffff64', '#ffffff'],
  jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#7f0000'],
  'cool-warm': ['#3b4cc0', '#8db0fe', '#dddddd', '#f4987a', '#b40426'],
  green: ['#000000', '#00ff00'], red: ['#000000', '#ff0000'], blue: ['#000000', '#0000ff'], cyan: ['#000000', '#00ffff'], magenta: ['#000000', '#ff00ff'], yellow: ['#000000', '#ffff00'],
};
export function colormap(name) {
  const stops = (COLORMAPS[name] || COLORMAPS.viridis).map(hexToRgb), n = stops.length - 1, t = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let i = 0; i < 256; i++) { const f = i / 255 * n, k = Math.min(n - 1, Math.floor(f)), u = f - k; for (let c = 0; c < 3; c++) t[c][i] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * u); }
  return t;
}
// Monotone cubic through curve control points [[x,y]..] in 0..1 -> 256-entry table
export function curveLut(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0]), n = P.length, t = new Uint8Array(256);
  if (n < 2) { for (let i = 0; i < 256; i++) t[i] = i; return t; }
  const dx = [], m = [], tg = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, P[i + 1][0] - P[i][0]); m[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
  tg[0] = m[0]; tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let y;
    if (x <= P[0][0]) y = P[0][1]; else if (x >= P[n - 1][0]) y = P[n - 1][1];
    else { let k = 0; while (x > P[k + 1][0]) k++; const h = dx[k], u = (x - P[k][0]) / h, u2 = u * u, u3 = u2 * u;
      y = (2 * u3 - 3 * u2 + 1) * P[k][1] + (u3 - 2 * u2 + u) * h * tg[k] + (-2 * u3 + 3 * u2) * P[k + 1][1] + (u3 - u2) * h * tg[k + 1]; }
    t[i] = clamp8(y * 255);
  }
  return t;
}
const TONEMAP = {
  reinhard: x => x / (1 + x),
  aces: x => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
  filmic: x => { const f = v => ((v * (0.15 * v + 0.05) + 0.004) / (v * (0.15 * v + 0.5) + 0.06)) - 0.02 / 0.3; return f(x * 2) / f(11.2); },
  log: x => Math.log2(1 + x * 15) / 4,
  linear: x => x,
};

function registerAdjustments() {
  const R = a => app.registerAdjustment(a);
  R({ id: 'brightness', title: 'Brightness / Contrast', keywords: 'bright dark contrast',
    params: [{ id: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, default: 0 }, { id: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, default: 0 }],
    lut: p => { const c = Math.tan((p.contrast / 100 + 1) * Math.PI / 4), b = p.brightness / 100 * 127; return lut3(v => (v - 127.5) * c + 127.5 + b); } });
  R({ id: 'exposure', title: 'Exposure', keywords: 'stops ev gamma linear light', desc: 'Exposure in stops, computed in linear light',
    params: [{ id: 'ev', label: 'Exposure (EV)', type: 'range', min: -5, max: 5, step: 0.05, default: 0 }, { id: 'offset', label: 'Offset', type: 'range', min: -0.5, max: 0.5, step: 0.005, default: 0 }, { id: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 4, step: 0.01, default: 1 }],
    lut: p => { const g = Math.pow(2, p.ev); return lut3(v => 255 * Math.pow(fromLin(TOLIN[v] * g + p.offset) / 255, 1 / p.gamma)); } });
  R({ id: 'levels', title: 'Levels', keywords: 'black point white point gamma histogram',
    params: [{ id: 'channel', label: 'Channel', type: 'select', options: ['RGB', 'Red', 'Green', 'Blue'], default: 'RGB' },
      { id: 'black', label: 'Input black', type: 'range', min: 0, max: 254, default: 0 }, { id: 'white', label: 'Input white', type: 'range', min: 1, max: 255, default: 255 },
      { id: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 5, step: 0.01, default: 1 },
      { id: 'outBlack', label: 'Output black', type: 'range', min: 0, max: 255, default: 0 }, { id: 'outWhite', label: 'Output white', type: 'range', min: 0, max: 255, default: 255 }],
    lut: p => { const w = Math.max(p.black + 1, p.white), id = lut(v => v);
      const t = lut(v => p.outBlack + (p.outWhite - p.outBlack) * Math.pow(Math.min(1, Math.max(0, (v - p.black) / (w - p.black))), 1 / p.gamma));
      return p.channel === 'Red' ? [t, id, id] : p.channel === 'Green' ? [id, t, id] : p.channel === 'Blue' ? [id, id, t] : [t, t, t]; } });
  R({ id: 'curves', title: 'Curves', keywords: 'tone curve', desc: 'Tone curve: click to add points, drag to shape, double-click to remove',
    params: [{ id: 'channel', label: 'Channel', type: 'select', options: ['RGB', 'Red', 'Green', 'Blue', 'Lab lightness', 'Lab a', 'Lab b'], default: 'RGB' }, { id: 'points', label: 'Curve', type: 'curve', default: [[0, 0], [1, 1]] }],
    useLut: p => !/^Lab/.test(p.channel),
    lut: p => { const t = curveLut(p.points), id = lut(v => v); return p.channel === 'Red' ? [t, id, id] : p.channel === 'Green' ? [id, t, id] : p.channel === 'Blue' ? [id, id, t] : [t, t, t]; },
    apply: (d, p) => { const t = curveLut(p.points), c = p.channel === 'Lab a' ? 1 : p.channel === 'Lab b' ? 2 : 0;
      for (let i = 0; i < d.length; i += 4) { const q = rgbToLab(d[i], d[i + 1], d[i + 2]); q[c] = c ? t[Math.round(Math.min(255, Math.max(0, q[c] + 128)))] - 128 : t[Math.round(q[0] * 2.55)] / 2.55; const r = labToRgb(q[0], q[1], q[2]); d[i] = r[0]; d[i + 1] = r[1]; d[i + 2] = r[2]; } } });
  R({ id: 'tonemap', title: 'Tone Mapping', keywords: 'hdr reinhard aces filmic highlight compression', desc: 'Compress highlights with a tone-mapping operator after an exposure boost',
    params: [{ id: 'op', label: 'Operator', type: 'select', options: ['reinhard', 'aces', 'filmic', 'log', 'linear'], default: 'aces' },
      { id: 'ev', label: 'Exposure (EV)', type: 'range', min: -4, max: 6, step: 0.05, default: 1 }, { id: 'contrast', label: 'Contrast', type: 'range', min: 0.5, max: 2, step: 0.01, default: 1 }],
    lut: p => { const f = TONEMAP[p.op] || TONEMAP.aces, g = Math.pow(2, p.ev); return lut3(v => fromLin(Math.pow(Math.max(0, f(TOLIN[v] * g)), p.contrast))); } });
  R({ id: 'whitebalance', title: 'White Balance', keywords: 'temperature tint color balance warm cool',
    params: [{ id: 'temp', label: 'Temperature', type: 'range', min: -100, max: 100, default: 0 }, { id: 'tint', label: 'Tint', type: 'range', min: -100, max: 100, default: 0 }],
    lut: p => { const t = p.temp / 100, n = p.tint / 100, g = [1 + 0.4 * t + 0.15 * n, 1 - 0.3 * n, 1 - 0.4 * t + 0.15 * n]; return g.map(k => lut(v => fromLin(TOLIN[v] * k))); } });
  R({ id: 'huesat', title: 'Hue / Saturation', keywords: 'color vibrance lightness',
    params: [{ id: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, default: 0 }, { id: 'sat', label: 'Saturation', type: 'range', min: -100, max: 100, default: 0 }, { id: 'light', label: 'Lightness', type: 'range', min: -100, max: 100, default: 0 }],
    apply: (d, p) => {
      const hs = p.hue / 360, sm = 1 + p.sat / 100, l = p.light / 100;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, v = (mx + mn) / 2;
        if (mx !== mn) { const dd = mx - mn; s = v > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h /= 6; }
        h = (h + hs + 1) % 1; s = Math.min(1, s * sm); v = l > 0 ? v + (1 - v) * l : v * (1 + l);
        const q = v < 0.5 ? v * (1 + s) : v + s - v * s, pp = 2 * v - q;
        const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
        d[i] = f(h + 1 / 3) * 255; d[i + 1] = f(h) * 255; d[i + 2] = f(h - 1 / 3) * 255;
      }
    } });
  R({ id: 'bw', title: 'Black & White', keywords: 'grayscale greyscale monochrome desaturate channel mixer',
    params: [{ id: 'r', label: 'Red', type: 'range', min: -100, max: 200, default: 21 }, { id: 'g', label: 'Green', type: 'range', min: -100, max: 200, default: 72 }, { id: 'b', label: 'Blue', type: 'range', min: -100, max: 200, default: 7 }],
    apply: (d, p) => { const r = p.r / 100, g = p.g / 100, b = p.b / 100; for (let i = 0; i < d.length; i += 4) { const v = d[i] * r + d[i + 1] * g + d[i + 2] * b; d[i] = d[i + 1] = d[i + 2] = v; } } });
  R({ id: 'falsecolor', title: 'False Colour (LUT)', keywords: 'colormap viridis magma fire jet pseudocolor lookup table fluorescence', desc: 'Map intensity through a scientific colour map',
    params: [{ id: 'map', label: 'Colour map', type: 'select', options: Object.keys(COLORMAPS), default: 'viridis' }, { id: 'invert', label: 'Invert', type: 'check', default: false }],
    apply: (d, p) => { const [R2, G2, B2] = colormap(p.map); for (let i = 0; i < d.length; i += 4) { let v = Math.round(luma(d[i], d[i + 1], d[i + 2])); if (p.invert) v = 255 - v; d[i] = R2[v]; d[i + 1] = G2[v]; d[i + 2] = B2[v]; } } });
  R({ id: 'invert', title: 'Invert', keywords: 'negative', params: [], lut: () => lut3(v => 255 - v) });
  R({ id: 'threshold', title: 'Threshold', keywords: 'binary binarize segment',
    params: [{ id: 'level', label: 'Level', type: 'range', min: 0, max: 255, default: 128 }],
    apply: (d, p) => { for (let i = 0; i < d.length; i += 4) { const v = luma(d[i], d[i + 1], d[i + 2]) >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } } });
  R({ id: 'posterize', title: 'Posterize', keywords: 'quantize levels',
    params: [{ id: 'levels', label: 'Levels', type: 'range', min: 2, max: 32, default: 4 }],
    lut: p => lut3(v => Math.round(Math.round(v / 255 * (p.levels - 1)) / (p.levels - 1) * 255)) });
}

// ---------- filter library (also exposed to plugins as app.lib) ----------
function boxPass(d, w, h, r, horiz) {
  const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4, buf = new Float32Array(n), win = 2 * r + 1;
  for (let c = 0; c < 4; c++) for (let l = 0; l < lines; l++) {
    const base = (horiz ? l * w * 4 : l * 4) + c;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += d[base + Math.min(n - 1, Math.max(0, i)) * step];
    for (let i = 0; i < n; i++) { buf[i] = sum / win; sum += d[base + Math.min(n - 1, i + r + 1) * step] - d[base + Math.max(0, i - r) * step]; }
    for (let i = 0; i < n; i++) d[base + i * step] = buf[i];
  }
}
// Gaussian blur as three box blurs on premultiplied data; returns a new ImageData.
export function gaussian(img, sigma) {
  const { width: w, height: h } = img, out = like(img, new img.data.constructor(img.data)), d = out.data;
  if (sigma <= 0.05) return out;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; d[i] *= a; d[i + 1] *= a; d[i + 2] *= a; }
  const wi = Math.sqrt(12 * sigma * sigma / 3 + 1); let lo = Math.floor(wi); if (lo % 2 === 0) lo--;
  const m = Math.round((12 * sigma * sigma - 3 * lo * lo - 12 * lo - 9) / (-4 * lo - 4));
  for (let k = 0; k < 3; k++) { const r = ((k < m ? lo : lo + 2) - 1) / 2; if (r < 1) continue; boxPass(d, w, h, r, true); boxPass(d, w, h, r, false); }
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a > 0 && a < 255) { const k = 255 / a; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; } }
  return out;
}
// Run fn on a copy of img sampled at inPct % (tones) and rendered on a grid of outPct % (dots), then scale back.
export function withResolution(img, inPct, outPct, fn) {
  const { width: w, height: h } = img; outPct = Math.min(100, Math.max(1, outPct || 100)); inPct = Math.min(outPct, Math.max(1, inPct || 100));
  if (inPct >= 100 && outPct >= 100) return fn(img);
  const a = mk(w, h), ax = a.getContext('2d'); ax.putImageData(img, 0, 0);
  const sz = p => [Math.max(1, Math.round(w * p / 100)), Math.max(1, Math.round(h * p / 100))], [gw, gh] = sz(outPct), [iw, ih] = sz(inPct);
  let src = a; if (inPct < outPct) { src = mk(iw, ih); const t = src.getContext('2d'); t.imageSmoothingQuality = 'high'; t.drawImage(a, 0, 0, iw, ih); }
  const g = mk(gw, gh), gx = g.getContext('2d'); gx.imageSmoothingQuality = 'high'; gx.drawImage(src, 0, 0, gw, gh);
  gx.putImageData(fn(gx.getImageData(0, 0, gw, gh)), 0, 0);
  ax.imageSmoothingEnabled = false; ax.globalCompositeOperation = 'copy'; ax.drawImage(g, 0, 0, w, h);
  return ax.getImageData(0, 0, w, h);
}
// 64×64 blue-noise threshold map (void-and-cluster), values 0..1, built on first use.
let BN = null;
export function blueNoise() {
  if (BN) return BN;
  const N = 64, n = N * N, R = 5, K = []; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) K.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / 4.5)]);
  let E = new Float32Array(n), on = new Uint8Array(n), seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const add = (i, s) => { const x = i % N, y = (i / N) | 0; for (const [dx, dy, w] of K) E[((y + dy + N) % N) * N + (x + dx + N) % N] += s * w; };
  const pick = want => { let b = -1, bv = want ? -Infinity : Infinity; for (let i = 0; i < n; i++) if (on[i] === want && (want ? E[i] > bv : E[i] < bv)) { bv = E[i]; b = i; } return b; };
  let ones = 0; while (ones < n / 10) { const i = (rnd() * n) | 0; if (!on[i]) { on[i] = 1; add(i, 1); ones++; } }
  for (let k = 0; k < 4000; k++) { const c = pick(1); on[c] = 0; add(c, -1); const v = pick(0); on[v] = 1; add(v, 1); if (v === c) break; }
  const rank = new Float32Array(n), E0 = new Float32Array(E), on0 = new Uint8Array(on);
  for (let r = ones - 1; r >= 0; r--) { const c = pick(1); on[c] = 0; add(c, -1); rank[c] = r; }
  E = E0; on = on0;
  for (let r = ones; r < n; r++) { const v = pick(0); on[v] = 1; add(v, 1); rank[v] = r; }
  for (let i = 0; i < n; i++) rank[i] = (rank[i] + 0.5) / n;
  return (BN = rank);
}
const BAYER8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

function registerFilters() {
  const F = f => app.registerFilter(f);
  F({ id: 'gaussian', float: true, title: 'Gaussian Blur', keywords: 'smooth soften', params: [{ id: 'sigma', label: 'Radius (px)', type: 'range', min: 0.1, max: 100, step: 0.1, default: 3 }], apply: (img, p) => gaussian(img, p.sigma) });
  F({ id: 'unsharp', float: true, title: 'Unsharp Mask / Sharpen', keywords: 'sharpen detail',
    params: [{ id: 'amount', label: 'Amount (%)', type: 'range', min: 0, max: 500, default: 100 }, { id: 'sigma', label: 'Radius (px)', type: 'range', min: 0.2, max: 50, step: 0.1, default: 1.5 }, { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 50, default: 0 }],
    apply: (img, p) => { const b = gaussian(img, p.sigma).data, d = img.data, k = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const df = d[i + c] - b[i + c]; if (Math.abs(df) >= p.threshold) d[i + c] = d[i + c] + df * k; }
      return img; } });
  F({ id: 'median', float: true, title: 'Median (denoise)', keywords: 'despeckle noise salt pepper', params: [{ id: 'r', label: 'Radius (px)', type: 'range', min: 1, max: 4, default: 1 }],
    apply: (img, p) => { const { width: w, height: h, data: s } = img, out = new s.constructor(s), r = p.r, win = new (s instanceof Float32Array ? Float32Array : Uint8Array)((2 * r + 1) ** 2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
        let n = 0;
        for (let dy = -r; dy <= r; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -r; dx <= r; dx++) win[n++] = s[(yy * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + c]; }
        out[(y * w + x) * 4 + c] = win.sort()[n >> 1];
      }
      return like(img, out); } });
  F({ id: 'noise', float: true, title: 'Add Noise', keywords: 'grain gaussian', params: [{ id: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, default: 15 }, { id: 'mono', label: 'Monochrome', type: 'check', default: true }],
    apply: (img, p) => { const d = img.data, g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * p.amount;
      for (let i = 0; i < d.length; i += 4) { if (p.mono) { const n = g(); d[i] += n; d[i + 1] += n; d[i + 2] += n; } else { d[i] += g(); d[i + 1] += g(); d[i + 2] += g(); } }
      return img; } });
  F({ id: 'edges', float: true, title: 'Find Edges (Sobel)', keywords: 'gradient outline', params: [{ id: 'invert', label: 'Dark edges on white', type: 'check', default: false }],
    apply: (img, p) => { const { width: w, height: h, data: s } = img, out = new s.constructor(s.length), L = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) L[i] = luma(s[i * 4], s[i * 4 + 1], s[i * 4 + 2]);
      const at = (x, y) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        let v = Math.hypot(gx, gy); if (p.invert) v = 255 - v; const i = (y * w + x) * 4; out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = s[i + 3];
      }
      return like(img, out); } });
  F({ id: 'pixelate', float: true, title: 'Pixelate', keywords: 'mosaic blocks', params: [{ id: 'size', label: 'Block (px)', type: 'range', min: 2, max: 100, default: 8 }],
    apply: (img, p) => { const { width: w, height: h, data: d } = img, b = p.size;
      for (let y = 0; y < h; y += b) for (let x = 0; x < w; x += b) { const acc = [0, 0, 0, 0]; let n = 0;
        for (let yy = y; yy < Math.min(h, y + b); yy++) for (let xx = x; xx < Math.min(w, x + b); xx++) { const i = (yy * w + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += d[i + c]; n++; }
        for (let yy = y; yy < Math.min(h, y + b); yy++) for (let xx = x; xx < Math.min(w, x + b); xx++) { const i = (yy * w + xx) * 4; for (let c = 0; c < 4; c++) d[i + c] = acc[c] / n; } }
      return img; } });
  F({ id: 'dither', title: 'Dither', keywords: 'floyd steinberg bayer blue noise void cluster ordered error diffusion 1-bit halftone fm stochastic resolution',
    desc: 'Reduce to a few levels with dots. Input resolution is where tones are sampled, output resolution is the dot grid (both in % of the layer pixels). To dither for a device finer than the image, first enlarge with Image ▸ Image Size, then lower the input resolution.',
    params: [{ id: 'method', label: 'Method', type: 'select', options: ['blue-noise', 'floyd-steinberg', 'bayer', 'threshold'], default: 'blue-noise' }, { id: 'levels', label: 'Levels', type: 'range', min: 2, max: 8, default: 2 },
      { id: 'color', label: 'Per channel (colour)', type: 'check', default: false }, { id: 'decor', label: 'Different pattern per channel (less white noise)', type: 'check', default: true },
      { id: 'inRes', label: 'Input resolution (%)', type: 'range', min: 5, max: 100, default: 100 }, { id: 'outRes', label: 'Output resolution (%)', type: 'range', min: 5, max: 100, default: 100 }],
    apply: (src, p) => withResolution(src, p.inRes, p.outRes, img => { const { width: w, height: h, data: d } = img, n = p.levels - 1, q = v => Math.round(Math.min(255, Math.max(0, v)) / 255 * n) / n * 255, bn = p.method === 'blue-noise' ? blueNoise() : null;
      if (!p.color) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
      for (let c = 0; c < (p.color ? 3 : 1); c++) {
        const f = new Float32Array(w * h); for (let i = 0; i < w * h; i++) f[i] = d[i * 4 + c];
        // channel-dependent masks: green uses the inverted map (its dots avoid the red ones), blue a shifted copy
        const th = !bn ? null : !p.decor || c === 0 ? (x, y) => bn[(y & 63) * 64 + (x & 63)] : c === 1 ? (x, y) => 1 - bn[(y & 63) * 64 + (x & 63)] : (x, y) => bn[((y + 29) & 63) * 64 + ((x + 37) & 63)];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = f[i];
          if (bn) v += (th(x, y) - 0.5) * 255 / n;
          else if (p.method === 'bayer') { const bx = p.decor ? x + c * 3 : x, by = p.decor ? y + c * 5 : y; v += ((BAYER8[(by & 7) * 8 + (bx & 7)] + 0.5) / 64 - 0.5) * 255 / n; }
          const o = q(v);
          if (p.method === 'floyd-steinberg') { const e = v - o; if (x + 1 < w) f[i + 1] += e * 7 / 16; if (y + 1 < h) { if (x > 0) f[i + w - 1] += e * 3 / 16; f[i + w] += e * 5 / 16; if (x + 1 < w) f[i + w + 1] += e / 16; } }
          d[i * 4 + c] = o; }
      }
      if (!p.color) for (let i = 0; i < d.length; i += 4) d[i + 1] = d[i + 2] = d[i];
      return img; }) });
  F({ id: 'grayscale', float: true, title: 'Grayscale', keywords: 'desaturate greyscale', params: [], apply: img => { const d = img.data; for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]); return img; } });
}

export function registerImaging() {
  Object.assign(app.lib, { gaussian, luma, hexToRgb, rgbToHex, rgbToLab, labToRgb, colormap, curveLut, floodMask, mk, copyCanvas, flatten, withResolution, blueNoise });
  registerAdjustments();
  registerFilters();
}
export const defaultParams = defs => { const o = {}; for (const p of defs || []) if (p.id) o[p.id] = JSON.parse(JSON.stringify(p.default ?? null)); return o; };
