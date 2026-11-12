// Analyze menu: slanted-edge MTF (sharpness), line profile, region statistics / noise, Fourier spectrum.
import { app } from './app.js';
import { mk, flatten, fmt, rasterLayer } from './core.js';
import { dialog, el } from './ui.js';

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TOLIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; TOLIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

// Pixels of the selection rectangle (or the whole page) as float planes. A high-bit active layer is read at full
// precision; otherwise the visible picture is used, optionally converted from sRGB to linear light.
function grab(linear = true) {
  const d = app.doc, b = d.sel && d.selBounds ? d.selBounds : { x: 0, y: 0, w: d.w, h: d.h }, L = d.active, n = b.w * b.h;
  const r = new Float32Array(n), g = new Float32Array(n), bl = new Float32Array(n); let src, max = 1;
  if (L && L.hd) {
    const hd = L.hd; src = `${hd.bits}-bit layer "${L.name}"${hd.dev.linear ? ', linear' : ''}`;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const sx = b.x + x - L.x, sy = b.y + y - L.y; if (sx < 0 || sy < 0 || sx >= hd.w || sy >= hd.h) continue; const k = (sy * hd.w + sx) * 4, o = y * b.w + x; r[o] = hd.data[k]; g[o] = hd.data[k + 1]; bl[o] = hd.data[k + 2]; }
  } else {
    const p = flatten(d, 1, { background: '#ffffff' }).getContext('2d').getImageData(b.x, b.y, b.w, b.h).data; src = '8-bit picture' + (linear ? ', linearised' : ', as displayed');
    for (let i = 0; i < n; i++) { r[i] = linear ? TOLIN[p[i * 4]] : p[i * 4] / 255; g[i] = linear ? TOLIN[p[i * 4 + 1]] : p[i * 4 + 1] / 255; bl[i] = linear ? TOLIN[p[i * 4 + 2]] : p[i * 4 + 2] / 255; }
  }
  const lum = new Float32Array(n); for (let i = 0; i < n; i++) lum[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * bl[i];
  return { w: b.w, h: b.h, r, g, b: bl, lum, src, box: b, max, whole: !(d.sel && d.selBounds) };
}

// Minimal line plot. series: [{x:[], y:[], color, label}]
export function plot(series, o = {}) {
  const W = o.w || 520, H = o.h || 230, c = mk(W * 2, H * 2), x = c.getContext('2d'); c.style.width = W + 'px'; c.style.height = H + 'px'; c.className = 'plot'; x.scale(2, 2);
  const fg = css('--text') || '#ddd', dim = css('--dim') || '#888', line = css('--line') || '#444', m = { l: 46, r: 10, t: 10, b: 30 };
  let x0 = o.xmin ?? Infinity, x1 = o.xmax ?? -Infinity, y0 = o.ymin ?? Infinity, y1 = o.ymax ?? -Infinity;
  for (const s of series) for (let i = 0; i < s.x.length; i++) { if (o.xmin == null && s.x[i] < x0) x0 = s.x[i]; if (o.xmax == null && s.x[i] > x1) x1 = s.x[i]; if (o.xmax != null && s.x[i] > o.xmax) continue; if (o.ymin == null && s.y[i] < y0) y0 = s.y[i]; if (o.ymax == null && s.y[i] > y1) y1 = s.y[i]; }
  if (!(x1 > x0)) x1 = x0 + 1; if (!(y1 > y0)) y1 = y0 + 1;
  const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  x.font = '10px -apple-system, "Segoe UI", sans-serif'; x.lineWidth = 1;
  const ticks = (a, b) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / 4))), k = [1, 2, 5, 10].find(q => (b - a) / (st * q) <= 6) * st, out = []; for (let v = Math.ceil(a / k - 1e-9) * k; v <= b + 1e-9; v += k) out.push(+v.toPrecision(10)); return out; };
  x.strokeStyle = line; x.fillStyle = dim; x.beginPath();
  for (const v of ticks(x0, x1)) { x.moveTo(X(v), m.t); x.lineTo(X(v), H - m.b); x.textAlign = 'center'; x.fillText(fmt(v, 4), X(v), H - m.b + 12); }
  for (const v of ticks(y0, y1)) { x.moveTo(m.l, Y(v)); x.lineTo(W - m.r, Y(v)); x.textAlign = 'right'; x.fillText(fmt(v, 4), m.l - 5, Y(v) + 3); }
  x.stroke(); x.strokeStyle = dim; x.strokeRect(m.l, m.t, W - m.l - m.r, H - m.t - m.b);
  x.textAlign = 'center'; if (o.xlabel) x.fillText(o.xlabel, (m.l + W - m.r) / 2, H - 4);
  if (o.ylabel) { x.save(); x.translate(11, (m.t + H - m.b) / 2); x.rotate(-Math.PI / 2); x.fillText(o.ylabel, 0, 0); x.restore(); }
  x.save(); x.beginPath(); x.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); x.clip();
  for (const mk2 of o.marks || []) { x.strokeStyle = dim; x.setLineDash([4, 3]); x.beginPath(); if (mk2.x != null) { x.moveTo(X(mk2.x), m.t); x.lineTo(X(mk2.x), H - m.b); } else { x.moveTo(m.l, Y(mk2.y)); x.lineTo(W - m.r, Y(mk2.y)); } x.stroke(); x.setLineDash([]); }
  for (const s of series) { x.strokeStyle = s.color || fg; x.lineWidth = 1.6; x.beginPath(); for (let i = 0; i < s.x.length; i++) i ? x.lineTo(X(s.x[i]), Y(s.y[i])) : x.moveTo(X(s.x[i]), Y(s.y[i])); x.stroke(); }
  x.restore(); x.textAlign = 'left'; let lx = m.l + 8;
  for (const s of series) if (s.label) { x.fillStyle = s.color || fg; x.fillRect(lx, m.t + 6, 10, 3); x.fillStyle = fg; x.fillText(s.label, lx + 14, m.t + 11); lx += x.measureText(s.label).width + 30; }
  return c;
}
function report(title, lines, plots, csv) {
  const body = el('div', 'report'), pre = el('pre', null, lines.join('\n')), b = el('button', null, 'Copy data (CSV)');
  body.append(pre, ...plots);
  if (csv) { b.onclick = () => { navigator.clipboard.writeText(csv).then(() => app.toast('Copied'), () => app.toast('Clipboard is not available')); }; body.append(b); }
  return dialog({ title, body, ok: 'Close', noCancel: true });
}
const needRoi = (g, what) => { if (g.whole) app.toast(`Tip: drag a rectangle with the Marquee tool (M) first to choose the region for ${what}.`, 5000); };

// ---------- slanted-edge MTF (after ISO 12233) ----------
export function slantedEdge(lum, w, h) {
  let gx = 0, gy = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { gx += Math.abs(lum[y * w + x + 1] - lum[y * w + x - 1]); gy += Math.abs(lum[(y + 1) * w + x] - lum[(y - 1) * w + x]); }
  let rot = false;
  if (gy > gx) { const t = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = lum[y * w + x]; lum = t; [w, h] = [h, w]; rot = true; } // make the edge near-vertical
  if (w < 12 || h < 8) throw new Error('The region is too small: use at least 12 × 8 pixels across an edge');
  // edge position in every row = centroid of the windowed derivative; two passes, the second centred on the fitted line
  let a = (w - 1) / 2, b = 0;
  for (let pass = 0; pass < 3; pass++) {
    let sy = 0, sc = 0, syy = 0, syc = 0, n = 0;
    for (let y = 0; y < h; y++) {
      const c0 = pass ? a + b * y : (w - 1) / 2, half = pass ? Math.max(6, w / 4) : w / 2; let num = 0, den = 0;
      for (let x = 1; x < w - 1; x++) { const u = (x - c0) / half; if (Math.abs(u) >= 1) continue; const d = (lum[y * w + x + 1] - lum[y * w + x - 1]) * (0.54 + 0.46 * Math.cos(Math.PI * u)); num += x * d; den += d; }
      if (Math.abs(den) < 1e-9) continue;
      const c = num / den; if (c < 0 || c > w - 1) continue;
      sy += y; sc += c; syy += y * y; syc += y * c; n++;
    }
    if (n < 4) throw new Error('No clear edge found in the region');
    b = (n * syc - sy * sc) / (n * syy - sy * sy); a = (sc - b * sy) / n;
  }
  // 4× oversampled edge spread function
  const N = w * 4, esf = new Float64Array(N), cnt = new Uint32Array(N), mid = a + b * (h - 1) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = Math.round((x - (a + b * y) + mid) * 4); if (k >= 0 && k < N) { esf[k] += lum[y * w + x]; cnt[k]++; } }
  for (let k = 0; k < N; k++) if (cnt[k]) esf[k] /= cnt[k];
  for (let k = 0; k < N; k++) if (!cnt[k]) { let i = k - 1, j = k + 1; while (i >= 0 && !cnt[i]) i--; while (j < N && !cnt[j]) j++; esf[k] = i < 0 ? esf[Math.min(N - 1, j)] : j >= N ? esf[i] : esf[i] + (esf[j] - esf[i]) * (k - i) / (j - i); }
  const lo = (esf[0] + esf[1] + esf[2] + esf[3]) / 4, hi = (esf[N - 1] + esf[N - 2] + esf[N - 3] + esf[N - 4]) / 4;
  if (Math.abs(hi - lo) < 1e-6) throw new Error('The region has no contrast across the edge');
  const lsf = new Float64Array(N); let peak = 0, pk = 0;
  for (let k = 1; k < N - 1; k++) { lsf[k] = (esf[k + 1] - esf[k - 1]) / 2 * Math.sign(hi - lo); if (lsf[k] > peak) { peak = lsf[k]; pk = k; } }
  const win = new Float64Array(N), half = Math.max(pk, N - 1 - pk); for (let k = 0; k < N; k++) win[k] = lsf[k] * (0.54 + 0.46 * Math.cos(Math.PI * (k - pk) / half));
  const nf = Math.floor(N / 4), mtf = new Float64Array(nf + 1), freq = new Float64Array(nf + 1); // up to 1 cycle/pixel
  for (let k = 0; k <= nf; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const ph = -2 * Math.PI * k * i / N; re += win[i] * Math.cos(ph); im += win[i] * Math.sin(ph); }
    const t = Math.PI * 2 * k / N, corr = k ? Math.min(10, t / Math.sin(t)) : 1; mtf[k] = Math.hypot(re, im) * corr; freq[k] = k * 4 / N; }
  const m0 = mtf[0] || 1; for (let k = 0; k <= nf; k++) mtf[k] /= m0;
  const cross = lv => { for (let k = 1; k <= nf; k++) if (mtf[k] < lv) return freq[k - 1] + (freq[k] - freq[k - 1]) * (mtf[k - 1] - lv) / (mtf[k - 1] - mtf[k]); return null; };
  const at = lv => { const t = lo + (hi - lo) * lv, up = hi > lo; for (let k = 1; k < N; k++) if (up ? esf[k] >= t : esf[k] <= t) return (k - 1 + (t - esf[k - 1]) / (esf[k] - esf[k - 1] || 1)) / 4; return NaN; };
  return { esf, lsf, mtf, freq, mtf50: cross(0.5), mtf10: cross(0.1), rise: Math.abs(at(0.9) - at(0.1)), angle: Math.atan(b) * 180 / Math.PI, vertical: !rot, contrast: Math.abs(hi - lo) / (hi + lo || 1), lo, hi, n: N };
}
function mtfReport() {
  const g = grab(true), d = app.doc; needRoi(g, 'the edge');
  let r; try { r = slantedEdge(g.lum, g.w, g.h); } catch (e) { app.toast(e.message, 6000); return; }
  const ppu = d.pxPerUnit, cy = v => v == null ? 'not reached' : `${fmt(v, 4)} cycles/px` + (d.unit !== 'px' ? `  =  ${fmt(v * ppu, 3)} cycles/${d.unit}` : '') + `  (${fmt(v * 2 * 100, 1)}% of Nyquist)`;
  const lines = [`Region ${g.w} × ${g.h} px · ${g.src}`, `Edge: ${r.vertical ? 'near-vertical' : 'near-horizontal'}, tilt ${fmt(Math.abs(r.angle), 2)}°, contrast ${fmt(r.contrast * 100, 1)}%`,
    `MTF50: ${cy(r.mtf50)}`, `MTF10: ${cy(r.mtf10)}`, `10–90% edge rise: ${fmt(r.rise, 2)} px` + (d.unit !== 'px' ? `  =  ${fmt(r.rise / ppu, 4)} ${d.unit}` : '')];
  const ta = Math.abs(r.angle); if (ta < 1.5 || ta > 20) lines.push('Note: a tilt of about 3–10° gives the most reliable result.');
  const xs = Array.from(r.esf, (_, i) => i / 4), pk = Math.max(...r.lsf) || 1;
  const p1 = plot([{ x: xs, y: Array.from(r.esf, v => (v - r.lo) / (r.hi - r.lo)), color: '#4c9ffe', label: 'Edge profile (ESF)' }, { x: xs, y: Array.from(r.lsf, v => v / pk), color: '#ff9f1a', label: 'Line spread (LSF)' }], { xlabel: 'Position across the edge (px)', h: 190 });
  const p2 = plot([{ x: Array.from(r.freq), y: Array.from(r.mtf), color: '#19c37d', label: 'MTF' }], { xlabel: 'Spatial frequency (cycles/px), Nyquist = 0.5', ylabel: 'Contrast', xmin: 0, xmax: 1, ymin: 0, ymax: Math.max(1.05, ...r.mtf), marks: [{ y: 0.5 }, { x: 0.5 }] });
  let csv = 'frequency_cy_per_px,MTF\n'; for (let i = 0; i < r.mtf.length; i++) csv += `${fmt(r.freq[i], 5)},${fmt(r.mtf[i], 5)}\n`;
  report('Sharpness (slanted-edge MTF)', lines, [p1, p2], csv);
}

// ---------- line profile ----------
function profile() {
  const d = app.doc, t = app.tools.get('measure'); let a = t.a, b = t.b;
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 2) { const q = d.sel && d.selBounds ? d.selBounds : { x: 0, y: 0, w: d.w, h: d.h }; a = { x: q.x, y: q.y + q.h / 2 }; b = { x: q.x + q.w, y: q.y + q.h / 2 }; app.toast('Tip: draw a line with the Measure tool (U) to choose where the profile is taken. Using the middle row for now.', 5000); }
  const sel = d.sel, sb = d.selBounds; d.sel = null; d.selBounds = null; const g = grab(false); d.sel = sel; d.selBounds = sb;
  const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(2, Math.round(len)), xs = [], R = [], G = [], B = [], Lm = [];
  const samp = (pl, x, y) => { x = Math.min(g.w - 1.001, Math.max(0, x - 0.5)); y = Math.min(g.h - 1.001, Math.max(0, y - 0.5)); const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, k = iy * g.w + ix; return pl[k] * (1 - u) * (1 - v) + pl[k + 1] * u * (1 - v) + pl[k + g.w] * (1 - u) * v + pl[k + g.w + 1] * u * v; };
  for (let i = 0; i <= n; i++) { const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n; xs.push(d.toU(len * i / n)); R.push(samp(g.r, x, y)); G.push(samp(g.g, x, y)); B.push(samp(g.b, x, y)); Lm.push(samp(g.lum, x, y)); }
  const p = plot([{ x: xs, y: R, color: '#e04848', label: 'R' }, { x: xs, y: G, color: '#3cb44b', label: 'G' }, { x: xs, y: B, color: '#4878e8', label: 'B' }, { x: xs, y: Lm, label: 'Luminance' }], { xlabel: `Distance (${d.unit})`, ylabel: 'Value (0–1)', h: 260 });
  let csv = `distance_${d.unit},R,G,B,luminance\n`; for (let i = 0; i < xs.length; i++) csv += [xs[i], R[i], G[i], B[i], Lm[i]].map(v => fmt(v, 5)).join(',') + '\n';
  report('Line profile', [`${n + 1} samples over ${fmt(d.toU(len), 3)} ${d.unit} · ${g.src}`], [p], csv);
}

// ---------- statistics and noise ----------
function stats() {
  const g = grab(false), n = g.w * g.h, rows = [], H = {}; needRoi(g, 'the statistics');
  for (const [name, pl] of [['Red', g.r], ['Green', g.g], ['Blue', g.b], ['Luminance', g.lum]]) {
    let s = 0, s2 = 0, mn = Infinity, mx = -Infinity; const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) { const v = pl[i]; s += v; s2 += v * v; if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, Math.floor((pl[i] - mn) / (mx - mn || 1) * 255.999)))]++;
    const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
    rows.push(`${name.padEnd(10)} mean ${fmt(mean, 5).padEnd(9)} sd ${fmt(sd, 5).padEnd(9)} min ${fmt(mn, 5).padEnd(9)} max ${fmt(mx, 5).padEnd(9)} SNR ${sd ? fmt(mean / sd, 2) + ' (' + fmt(20 * Math.log10(mean / sd), 1) + ' dB)' : '∞'}`);
    H[name] = { hist, mn, mx };
  }
  const ax = k => Array.from({ length: 256 }, (_, i) => H[k].mn + (H[k].mx - H[k].mn) * i / 255);
  const p = plot([['Red', '#e04848'], ['Green', '#3cb44b'], ['Blue', '#4878e8'], ['Luminance', undefined]].map(([k, color]) => ({ x: ax(k), y: Array.from(H[k].hist), color, label: k })), { xlabel: 'Value (0–1)', ylabel: 'Pixels', ymin: 0 });
  report('Statistics and noise', [`Region ${g.w} × ${g.h} px (${n} pixels) · ${g.src}`, 'Values are on a 0–1 scale. SNR = mean / standard deviation; measure it on a uniform patch.', '', ...rows], [p], rows.join('\n'));
}

// ---------- Fourier spectrum ----------
function fft1(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
export function spectrum(lum, w, h) {
  const N = Math.min(1024, 2 ** Math.floor(Math.log2(Math.min(w, h)))); if (N < 16) throw new Error('The region is too small for a spectrum (at least 16 × 16 px)');
  const ox = (w - N) >> 1, oy = (h - N) >> 1, re = new Float64Array(N * N), im = new Float64Array(N * N); let mean = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) mean += lum[(y + oy) * w + x + ox]; mean /= N * N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) re[y * N + x] = (lum[(y + oy) * w + x + ox] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * x / (N - 1))) * (0.5 - 0.5 * Math.cos(2 * Math.PI * y / (N - 1)));
  const r = new Float64Array(N), i2 = new Float64Array(N);
  for (let y = 0; y < N; y++) { fft1(re.subarray(y * N, y * N + N), im.subarray(y * N, y * N + N), N); }
  for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) { r[y] = re[y * N + x]; i2[y] = im[y * N + x]; } fft1(r, i2, N); for (let y = 0; y < N; y++) { re[y * N + x] = r[y]; im[y * N + x] = i2[y]; } }
  const mag = new Float32Array(N * N), rad = new Float64Array(N / 2), rc = new Uint32Array(N / 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const m = Math.hypot(re[y * N + x], im[y * N + x]), sx = (x + N / 2) % N, sy = (y + N / 2) % N; mag[sy * N + sx] = m;
    const fx = x < N / 2 ? x : x - N, fy = y < N / 2 ? y : y - N, k = Math.round(Math.hypot(fx, fy)); if (k < N / 2) { rad[k] += m * m; rc[k]++; } }
  for (let k = 0; k < N / 2; k++) rad[k] = rc[k] ? rad[k] / rc[k] : 0;
  return { N, mag, rad };
}
function fftReport() {
  const g = grab(true), d = app.doc; let s; needRoi(g, 'the spectrum');
  try { s = spectrum(g.lum, g.w, g.h); } catch (e) { app.toast(e.message, 5000); return; }
  const N = s.N, c = mk(N, N), x = c.getContext('2d'), img = x.createImageData(N, N); let mx = 0; for (let i = 0; i < N * N; i++) mx = Math.max(mx, Math.log1p(s.mag[i]));
  for (let i = 0; i < N * N; i++) { const v = Math.log1p(s.mag[i]) / (mx || 1) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); c.className = 'plot'; c.style.width = c.style.height = Math.min(360, Math.max(200, N)) + 'px'; c.style.imageRendering = 'pixelated';
  const fx = Array.from({ length: N / 2 - 1 }, (_, i) => (i + 1) / N), p = plot([{ x: fx, y: fx.map((_, i) => 10 * Math.log10(s.rad[i + 1] + 1e-20)), color: '#19c37d', label: 'Radially averaged power' }], { xlabel: 'Spatial frequency (cycles/px)', ylabel: 'Power (dB)', h: 190 });
  const add = el('button', null, 'Add spectrum as a layer'); add.onclick = () => { const L = rasterLayer(d.uniqueName('Spectrum'), N, N, g.box.x, g.box.y); L.ctx.drawImage(c, 0, 0); d.add(L); app.commit('Spectrum layer'); app.toast('Added'); };
  let csv = 'frequency_cy_per_px,power\n'; for (let k = 1; k < N / 2; k++) csv += `${fmt(k / N, 5)},${s.rad[k]}\n`;
  report('Fourier spectrum', [`Centre ${N} × ${N} px of the region · ${g.src} · log magnitude, zero frequency in the middle`], [c, add, p], csv);
}

export function registerAnalyze() {
  const C = (id, title, run, desc, keywords) => app.registerCommand({ id, title, run, desc, keywords, enabled: () => !!app.doc });
  C('analyze.mtf', 'Sharpness (Slanted-Edge MTF)…', mtfReport, 'Measure lens/system sharpness from a slightly tilted edge: MTF curve, MTF50, edge rise. Select a rectangle across the edge first.', 'mtf sfr sharpness resolution iso 12233 edge lens blur lp/mm analysis');
  C('analyze.profile', 'Line Profile…', profile, 'Plot pixel values along the last Measure-tool line', 'plot intensity cross section profile imagej');
  C('analyze.stats', 'Statistics and Noise…', stats, 'Mean, standard deviation, min, max, signal-to-noise and histogram of the selected region', 'histogram snr noise mean std measure roi');
  C('analyze.fft', 'Fourier Spectrum…', fftReport, '2-D FFT magnitude and radially averaged power of the selected region', 'fft frequency spectrum periodic noise power');
}
