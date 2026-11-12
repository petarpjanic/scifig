// High-bit-depth image layers. L.hd keeps the pixels as 32-bit float RGBA (0..1 nominal, may exceed 1);
// L.canvas is only the 8-bit picture of them made by the layer's Develop settings. Float arrays are never
// changed in place (history shares them), every edit makes a new array.
import { app } from './app.js';
import { Doc, mk, flatten } from './core.js';

export const DEV0 = { ev: 0, black: 0, white: 1, gamma: 1, temp: 0, tint: 0, tone: 'none', linear: false };
export const DEV_PARAMS = [
  { id: 'ev', label: 'Exposure (EV)', type: 'range', min: -8, max: 8, step: 0.05 },
  { id: 'black', label: 'Black point', type: 'number', step: 0.001 }, { id: 'white', label: 'White point', type: 'number', step: 0.001 },
  { id: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 4, step: 0.01 },
  { id: 'temp', label: 'Temperature', type: 'range', min: -100, max: 100 }, { id: 'tint', label: 'Tint', type: 'range', min: -100, max: 100 },
  { id: 'tone', label: 'Tone mapping', type: 'select', options: ['none', 'reinhard', 'aces', 'filmic', 'log'] },
  { id: 'linear', label: 'Data is linear light (apply sRGB curve)', type: 'check' },
];
const TONE = {
  none: x => x, reinhard: x => x / (1 + x), aces: x => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
  filmic: x => { const f = v => ((v * (0.15 * v + 0.05) + 0.004) / (v * (0.15 * v + 0.5) + 0.06)) - 0.02 / 0.3; return f(x * 2) / f(11.2); }, log: x => Math.log2(1 + x * 15) / 4,
};
const oetf = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
export const makeHD = (w, h, data, o = {}) => ({ w, h, data, bits: o.bits || 32, dev: { ...DEV0, linear: !!o.linear, ...(o.dev || {}) }, rev: 0, src: o.src || '' });

// Forward display curve for one channel: scene value -> 0..1 display value.
function curves(dev) {
  const t = dev.temp / 100, n = dev.tint / 100, wb = [1 + 0.4 * t + 0.15 * n, 1 - 0.3 * n, 1 - 0.4 * t + 0.15 * n], g = Math.pow(2, dev.ev), range = Math.max(1e-9, dev.white - dev.black);
  const tone = TONE[dev.tone] || TONE.none, ig = 1 / dev.gamma;
  const shape = u => { let v = tone(u < 0 ? 0 : u); if (dev.linear) v = oetf(v); v = v < 0 ? 0 : v > 1 ? 1 : v; return ig === 1 ? v : Math.pow(v, ig); };
  return { shape, pre: wb.map(k => k * g / range), black: dev.black, clip: dev.tone === 'none' };
}
// 8-bit RGBA of the developed layer.
export function developBytes(hd) {
  const { w, h, data } = hd, out = new Uint8ClampedArray(w * h * 4), c = curves(hd.dev), N = 4096, lut = new Uint8Array(N + 1);
  for (let i = 0; i <= N; i++) lut[i] = Math.round(c.shape(i / N) * 255);
  const top = c.clip ? 255 : -1, [p0, p1, p2] = c.pre, bl = c.black;
  const m = u => u <= 0 ? lut[0] : u < 1 ? lut[(u * N + 0.5) | 0] : top >= 0 ? top : Math.round(c.shape(u) * 255);
  for (let i = 0; i < out.length; i += 4) { out[i] = m((data[i] - bl) * p0); out[i + 1] = m((data[i + 1] - bl) * p1); out[i + 2] = m((data[i + 2] - bl) * p2); out[i + 3] = data[i + 3] * 255 + 0.5; }
  return out;
}
export function developHD(L) {
  const hd = L.hd; if (!hd) return;
  if (!L.canvas || L.canvas.width !== hd.w || L.canvas.height !== hd.h) L.canvas = mk(hd.w, hd.h);
  L.ctx.putImageData(new ImageData(developBytes(hd), hd.w, hd.h), 0, 0);
  L.touch(); hd.rev = L.rev;
}
// Pixels changed on the 8-bit canvas (paint, stamp, move…) are written back into the float data through the
// inverse of the develop curve. Untouched pixels keep their full precision.
export function syncHD(L) {
  const hd = L.hd; if (!hd || hd.rev === L.rev) return;
  if (L.canvas.width !== hd.w || L.canvas.height !== hd.h) { L.hd = null; app.toast(`"${L.name}" is now an 8-bit layer (that operation is not available in high bit depth)`, 5000); return; }
  const dev = developBytes(hd), cur = L.ctx.getImageData(0, 0, hd.w, hd.h).data, c = curves(hd.dev);
  let nd = null; const inv = [0, 1, 2].map(() => new Float32Array(256));
  for (let v = 0; v < 256; v++) { let lo = 0, hi = 64; const t = v / 255; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (c.shape(mid) < t) lo = mid; else hi = mid; } for (let ch = 0; ch < 3; ch++) inv[ch][v] = lo / c.pre[ch] + c.black; }
  for (let i = 0; i < cur.length; i += 4) {
    const a = cur[i + 3], tol = a === 255 ? 0 : 2;
    if (Math.abs(cur[i] - dev[i]) <= tol && Math.abs(cur[i + 1] - dev[i + 1]) <= tol && Math.abs(cur[i + 2] - dev[i + 2]) <= tol && a === dev[i + 3]) continue;
    if (!nd) nd = new Float32Array(hd.data);
    nd[i] = inv[0][cur[i]]; nd[i + 1] = inv[1][cur[i + 1]]; nd[i + 2] = inv[2][cur[i + 2]]; nd[i + 3] = a / 255;
  }
  if (nd) hd.data = nd;
  hd.rev = L.rev;
}
Doc.preCommit.push(doc => { for (const L of doc.layers) if (L.hd) syncHD(L); });

// Bilinear resampling: inv = [a,b,c,d,e,f] maps a destination pixel centre to source pixel coordinates.
export function hdResample(hd, inv, dw, dh) {
  const { w, h, data } = hd, out = new Float32Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = inv[0] * (x + 0.5) + inv[2] * (y + 0.5) + inv[4] - 0.5, sy = inv[1] * (x + 0.5) + inv[3] * (y + 0.5) + inv[5] - 0.5;
    if (sx < -1 || sy < -1 || sx > w || sy > h) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = (y * dw + x) * 4;
    let wsum = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const xx = x0 + i, yy = y0 + j, wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy); if (wt <= 0 || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = (yy * w + xx) * 4, a = data[k + 3] * wt; out[o] += data[k] * a; out[o + 1] += data[k + 1] * a; out[o + 2] += data[k + 2] * a; out[o + 3] += a; wsum += wt;
    }
    const a = out[o + 3]; if (a > 0) { out[o] /= a; out[o + 1] /= a; out[o + 2] /= a; }
  }
  return { ...hd, w: dw, h: dh, data: out, dev: { ...hd.dev } };
}
export const invert = m => { const det = m[0] * m[3] - m[1] * m[2]; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; };
// Apply the same affine map as an 8-bit layer operation: m maps old layer pixels to new layer pixels.
export function hdAffine(L, m, dw, dh) { if (!L.hd) return; L.hd = hdResample(L.hd, invert(m), dw, dh); developHD(L); }

// Run a filter on the float data (scaled to 0..255 so parameters mean the same as in 8-bit). Returns new float data.
export function hdFilter(doc, L, f, vals) {
  const hd = L.hd, n = hd.data.length, src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = hd.data[i] * 255;
  const out = (f.apply({ width: hd.w, height: hd.h, data: src }, vals, { doc, layer: L, float: true }) || { data: src }).data, res = new Float32Array(n);
  let sel = null;
  if (doc.sel) { const c = mk(hd.w, hd.h), x = c.getContext('2d'); x.drawImage(doc.sel, -L.x, -L.y); sel = x.getImageData(0, 0, hd.w, hd.h).data; }
  for (let i = 0; i < n; i += 4) { const k = sel ? sel[i + 3] / 255 : 1; for (let c = 0; c < 4; c++) res[i + c] = hd.data[i + c] + (out[i + c] / 255 - hd.data[i + c]) * k; }
  return res;
}
export function autoRange(hd, lo = 0.001, hi = 0.999) {
  const d = hd.data, step = Math.max(1, Math.floor(d.length / 4 / 400000)) * 4, v = [];
  for (let i = 0; i < d.length; i += step) v.push(Math.max(d[i], d[i + 1], d[i + 2]), Math.min(d[i], d[i + 1], d[i + 2]));
  v.sort((a, b) => a - b);
  return { black: v[Math.floor(v.length * lo)], white: Math.max(v[Math.floor(v.length * hi)], v[Math.floor(v.length * lo)] + 1e-6) };
}
export function hdFromInts(arr, w, h, ch, max, o) { // interleaved integer samples, ch = 1..4
  const data = new Float32Array(w * h * 4), k = 1 / max;
  for (let i = 0, j = 0; i < w * h; i++, j += ch) { const q = i * 4; if (ch < 3) { data[q] = data[q + 1] = data[q + 2] = arr[j] * k; data[q + 3] = ch === 2 ? arr[j + 1] * k : 1; } else { data[q] = arr[j] * k; data[q + 1] = arr[j + 1] * k; data[q + 2] = arr[j + 2] * k; data[q + 3] = ch === 4 ? arr[j + 3] * k : 1; } }
  return makeHD(w, h, data, o);
}

// ---------- saving ----------
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
Doc.packHD = (hd, o) => o.maxHD && hd.data.length > o.maxHD ? undefined : { w: hd.w, h: hd.h, bits: hd.bits, dev: hd.dev, src: hd.src, z: b64(pako.deflate(new Uint8Array(hd.data.buffer, hd.data.byteOffset, hd.data.byteLength))) };
Doc.unpackHD = p => { const u = pako.inflate(unb64(p.z)); return makeHD(p.w, p.h, new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4), { bits: p.bits, dev: p.dev, src: p.src }); };

// ---------- high-bit export ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = u => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function png16(rgb, w, h) { // rgb: Uint16Array w*h*3
  const raw = new Uint8Array(h * (1 + w * 6)); let o = 0;
  for (let y = 0; y < h; y++) { raw[o++] = 0; for (let i = y * w * 3, e = i + w * 3; i < e; i++) { raw[o++] = rgb[i] >> 8; raw[o++] = rgb[i] & 255; } }
  const chunk = (type, body) => { const u = new Uint8Array(12 + body.length), dv = new DataView(u.buffer); dv.setUint32(0, body.length); for (let i = 0; i < 4; i++) u[4 + i] = type.charCodeAt(i); u.set(body, 8); dv.setUint32(8 + body.length, crc(u.subarray(4, 8 + body.length))); return u; };
  const ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 16; ih[9] = 2;
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', pako.deflate(raw)), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
export function tiffHi(samples, w, h, float, dpi) { // samples: Uint16Array or Float32Array, w*h*3
  const bps = float ? 32 : 16, tags = [[256, 4, [w]], [257, 4, [h]], [258, 3, [bps, bps, bps]], [259, 3, [1]], [262, 3, [2]], [273, 4, [0]], [277, 3, [3]], [278, 4, [h]], [279, 4, [samples.byteLength]],
    [282, 5, [dpi, 1]], [283, 5, [dpi, 1]], [284, 3, [1]], [296, 3, [2]], [339, 3, float ? [3, 3, 3] : [1, 1, 1]]];
  const ifdAt = 8, ifdLen = 2 + tags.length * 12 + 4; let extra = ifdAt + ifdLen;
  const head = new DataView(new ArrayBuffer(ifdAt + ifdLen + 64)); head.setUint16(0, 0x4949, true); head.setUint16(2, 42, true); head.setUint32(4, ifdAt, true); head.setUint16(ifdAt, tags.length, true);
  const dataAt = head.byteLength;
  tags.forEach(([id, type, v], i) => {
    const p = ifdAt + 2 + i * 12, n = type === 5 ? 1 : v.length, size = type === 3 ? 2 : type === 4 ? 4 : 8; if (id === 273) v = [dataAt];
    head.setUint16(p, id, true); head.setUint16(p + 2, type, true); head.setUint32(p + 4, n, true);
    let at = p + 8; if (size * n > 4) { at = extra; head.setUint32(p + 8, extra, true); extra += size * n; }
    v.forEach((x, k) => { if (type === 3) head.setUint16(at + k * 2, x, true); else head.setUint32(at + k * 4, x, true); });
  });
  return new Blob([head.buffer, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)], { type: 'image/tiff' });
}
// The lowest visible high-bit layer, developed (or raw), with the visible layers above it composited on top.
export function hdComposite(doc, applyDev) {
  const L = doc.layers.find(q => q.hd && q.visible); if (!L) return null;
  syncHD(L);
  const hd = L.hd, w = doc.w, h = doc.h, out = new Float32Array(w * h * 3), c = curves(hd.dev);
  let over = null;
  if (applyDev) { const i = doc.layers.indexOf(L), top = new Set(doc.layers.slice(i + 1).filter(q => q.type !== 'adjust')); if (top.size) over = flatten(doc, 1, { skip: q => !top.has(q) }).getContext('2d').getImageData(0, 0, w, h).data; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - L.x, sy = y - L.y, o = (y * w + x) * 3; let r = applyDev ? 1 : 0, g = r, b = r;
    if (sx >= 0 && sy >= 0 && sx < hd.w && sy < hd.h) {
      const k = (sy * hd.w + sx) * 4, a = hd.data[k + 3];
      if (applyDev) { r = 1 + (c.shape((hd.data[k] - c.black) * c.pre[0]) - 1) * a; g = 1 + (c.shape((hd.data[k + 1] - c.black) * c.pre[1]) - 1) * a; b = 1 + (c.shape((hd.data[k + 2] - c.black) * c.pre[2]) - 1) * a; }
      else { r = hd.data[k]; g = hd.data[k + 1]; b = hd.data[k + 2]; }
    }
    if (over) { const q = (y * w + x) * 4, a = over[q + 3] / 255; if (a > 0) { r += (over[q] / 255 - r) * a; g += (over[q + 1] / 255 - g) * a; b += (over[q + 2] / 255 - b) * a; } }
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
  return out;
}
export const toU16 = f => { const u = new Uint16Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i]; u[i] = v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535); } return u; };
