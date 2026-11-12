// Whole-document and layer operations shared by tools and menu commands. None of these commit history; callers do.
import { mk, copyCanvas, transformShape, mTranslate, mMul, rasterLayer, renderDoc, drawShape, Doc, UNITS, unitScale } from './core.js';
import { selChanged } from './imaging.js';
import { hdAffine } from './hd.js';

const eachShape = (d, f) => { for (const L of d.layers) if (L.type === 'vector') { L.shapes.forEach(f); L.touch(); } };
const dropSel = d => { d.sel = null; selChanged(d); };

export function cropDoc(d, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  for (const L of d.layers) if (L.type === 'raster') { L.x -= x; L.y -= y; }
  eachShape(d, s => transformShape(s, mTranslate(-x, -y)));
  for (const L of d.layers) if (L.mask) { const m = mk(w, h), c = m.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.clearRect(-x, -y, L.mask.width, L.mask.height); c.drawImage(L.mask, -x, -y); L.mask = m; L.touchMask(); }
  d.w = w; d.h = h; dropSel(d);
}
// Apply an affine map to the whole document (used by scale, rotate 90, flip). newW/newH = resulting page size.
function mapDoc(d, m, newW, newH, strokeK = 1) {
  for (const L of d.layers) if (L.type === 'raster') {
    // bounding box of the transformed layer rectangle
    const cs = [[L.x, L.y], [L.x + L.canvas.width, L.y], [L.x, L.y + L.canvas.height], [L.x + L.canvas.width, L.y + L.canvas.height]].map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
    const x0 = Math.floor(Math.min(...cs.map(c => c[0]))), y0 = Math.floor(Math.min(...cs.map(c => c[1])));
    const x1 = Math.ceil(Math.max(...cs.map(c => c[0]))), y1 = Math.ceil(Math.max(...cs.map(c => c[1])));
    const c = mk(x1 - x0, y1 - y0), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
    ctx.drawImage(L.canvas, L.x, L.y);
    const lm = [m[0], m[1], m[2], m[3], m[0] * L.x + m[2] * L.y + m[4] - x0, m[1] * L.x + m[3] * L.y + m[5] - y0];
    L.canvas = c; L.x = x0; L.y = y0; L.touch();
    hdAffine(L, lm, c.width, c.height);
  }
  for (const L of d.layers) if (L.mask) { const c = mk(newW, newH), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); x.drawImage(L.mask, 0, 0, d.w, d.h); L.mask = c; L.touchMask(); }
  eachShape(d, s => { transformShape(s, m); if (strokeK !== 1 && s.st && s.st.sw) s.st.sw *= strokeK; });
  d.w = Math.max(1, Math.round(newW)); d.h = Math.max(1, Math.round(newH)); dropSel(d);
}
export function scaleDoc(d, k) {
  // a calibrated image scale (e.g. px per µm) follows the resampling; print units stay tied to the dpi
  const calibrated = UNITS[d.unit] === undefined || Math.abs(d.pxPerUnit - unitScale(d.unit, d.dpi)) > 1e-9;
  mapDoc(d, [k, 0, 0, k, 0, 0], d.w * k, d.h * k, k);
  if (calibrated) d.pxPerUnit *= k;
}
export function rotateDoc(d, cw) { mapDoc(d, cw ? [0, 1, -1, 0, d.h, 0] : [0, -1, 1, 0, 0, d.w], d.h, d.w); }
export function flipDoc(d, horiz) { mapDoc(d, horiz ? [-1, 0, 0, 1, d.w, 0] : [1, 0, 0, -1, 0, d.h], d.w, d.h); }

// Scale / rotate one layer about its centre.
export function transformLayer(d, L, scale, deg) {
  const a = deg * Math.PI / 180, co = Math.cos(a) * scale, si = Math.sin(a) * scale;
  if (L.type === 'raster') {
    const w = L.canvas.width, h = L.canvas.height, cx = L.x + w / 2, cy = L.y + h / 2;
    const nw = Math.ceil(Math.abs(w * co) + Math.abs(h * si)), nh = Math.ceil(Math.abs(w * si) + Math.abs(h * co));
    const c = mk(nw, nh), ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.translate(nw / 2, nh / 2); ctx.transform(co, si, -si, co, 0, 0); ctx.drawImage(L.canvas, -w / 2, -h / 2);
    L.canvas = c; L.x = Math.round(cx - nw / 2); L.y = Math.round(cy - nh / 2); L.touch();
    hdAffine(L, [co, si, -si, co, nw / 2 - (co * w - si * h) / 2, nh / 2 - (si * w + co * h) / 2], nw, nh);
  } else if (L.type === 'vector') {
    const c = { x: d.w / 2, y: d.h / 2 };
    const m = mMul([co, si, -si, co, c.x, c.y], mTranslate(-c.x, -c.y));
    for (const s of L.shapes) { transformShape(s, m); if (s.st && s.st.sw) s.st.sw *= scale; }
  }
  L.touch();
}

// Render a set of layers into one document-sized raster layer.
export function rasterOf(d, layers, name) {
  const R = rasterLayer(name, d.w, d.h), keep = new Set(layers);
  renderDoc(R.ctx, d, 1, 0, 0, { skip: L => !keep.has(L) });
  return R;
}
export function mergeDown(d, L) {
  const i = d.layers.indexOf(L); if (i < 1) return false;
  const below = d.layers[i - 1];
  const vis = [below.visible, L.visible]; below.visible = L.visible = true;
  const R = rasterOf(d, L.type === 'adjust' ? d.layers.slice(0, i + 1) : [below, L], below.name);
  below.visible = vis[0];
  if (L.type === 'adjust') d.layers.splice(0, i + 1, R); else d.layers.splice(i - 1, 2, R);
  d.activeId = R.id; return true;
}
export function flattenDoc(d) {
  const R = rasterOf(d, d.layers, 'Background');
  const bg = mk(d.w, d.h), b = bg.getContext('2d'); b.fillStyle = '#fff'; b.fillRect(0, 0, d.w, d.h); b.drawImage(R.canvas, 0, 0);
  R.canvas = bg; d.layers = [R]; d.activeId = R.id;
}
export function rasterizeLayer(d, L) {
  const i = d.layers.indexOf(L), o = L.opacity, bl = L.blend; L.opacity = 1; L.blend = 'normal';
  const vis = L.visible; L.visible = true;
  const R = rasterOf(d, [L], L.name); R.opacity = o; R.blend = bl; R.visible = vis;
  d.layers[i] = R; d.activeId = R.id; return R;
}
export function duplicateLayer(d, L) {
  const o = { name: L.name + ' copy', type: L.type, visible: L.visible, opacity: L.opacity, blend: L.blend, x: L.x, y: L.y, adj: L.adj };
  const N = new (L.constructor)(o);
  if (L.mask) { N.mask = copyCanvas(L.mask); N.maskOn = L.maskOn; }
  if (L.hd) N.hd = { ...L.hd, dev: { ...L.hd.dev } };
  if (L.type === 'raster') { N.canvas = copyCanvas(L.canvas); if (N.hd) N.hd.rev = N.rev; }
  else if (L.type === 'vector') { N.shapes = JSON.parse(JSON.stringify(L.shapes)); for (const s of N.shapes) s.id = 's' + Math.random().toString(36).slice(2, 10); }
  else N.params = JSON.parse(JSON.stringify(L.params));
  d.add(N, L); return N;
}
// Small canvas preview of a layer for the layers panel.
export function thumb(d, L, W = 30, H = 24) {
  const c = mk(W, H), ctx = c.getContext('2d'), k = Math.min(W / d.w, H / d.h);
  ctx.translate((W - d.w * k) / 2, (H - d.h * k) / 2); ctx.scale(k, k);
  if (L.type === 'raster') ctx.drawImage(L.canvas, L.x, L.y);
  else if (L.type === 'vector') for (const s of L.shapes.slice(0, 400)) { const sw = s.st && s.st.sw; if (sw) s.st.sw = Math.max(sw, 1 / k); drawShape(ctx, s); if (sw) s.st.sw = sw; }
  return c;
}
export function maskThumb(d, L, W = 30, H = 24) {
  const c = mk(W, H), ctx = c.getContext('2d'), k = Math.min(W / d.w, H / d.h), w = d.w * k, h = d.h * k;
  ctx.fillStyle = '#000'; ctx.fillRect((W - w) / 2, (H - h) / 2, w, h); ctx.drawImage(L.mask, (W - w) / 2, (H - h) / 2, w, h);
  return c;
}
export { Doc };
