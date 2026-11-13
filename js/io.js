// File input/output: images, HEIC, camera raw, 8/16/32-bit TIFF and PNG, PSD, SVG (editable vectors), PDF/AI, EPS, native .scifig; exports; autosave.
import { app } from './app.js';
import { Doc, Layer, mk, uid, rasterLayer, vectorLayer, flatten, transformShape, mMul, mTranslate, geomSubs, endDir, arrowLen, textLayout, textRuns, dashArr, dimShapes, BLENDS, fmt, setExporting, isGrad, solidOf, gradGeom, stopColor, shapeBBox, headParts, headBack } from './core.js';
import { hdFromInts, developHD, autoRange, hdComposite, toU16, png16, tiffHi } from './hd.js';
import { rasterOf } from './ops.js';
import { dialog } from './ui.js';

const ext = name => (/\.([a-z0-9]+)$/i.exec(name) || ['', ''])[1].toLowerCase();
const base = name => name.replace(/\.[a-z0-9]+$/i, '');
const loaded = {};
const loadScript = src => loaded[src] || (loaded[src] = new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s); }));
function fromBitmap(img, name) { const L = rasterLayer(name, img.width, img.height); L.ctx.drawImage(img, 0, 0); return L; }

// ---------- loaders: each returns {w, h, dpi?, unit?, layers} ----------
async function loadImage(file) {
  const img = await createImageBitmap(file);
  return { w: img.width, h: img.height, layers: [fromBitmap(img, base(file.name))] };
}
// A layer that keeps its pixels in float; the 8-bit canvas is made by its Develop settings.
function hdLayer(name, hd, stretch) {
  const L = new Layer({ type: 'raster', name }); L.hd = hd;
  const r = autoRange(hd); if (r.white < stretch) { hd.dev.white = r.white; if (!hd.dev.linear) hd.dev.black = r.black; app.toast('The data uses only part of the range, so the display was stretched (Properties ▸ Develop). The pixel values are unchanged.', 6000); }
  developHD(L); return L;
}
async function loadImage16(file) { // PNG: 16-bit files keep their depth
  const buf = await file.arrayBuffer(), u = new Uint8Array(buf, 0, 32);
  if (!(u[1] === 80 && u[2] === 78 && u[24] === 16)) return loadImage(file);
  await loadScript('vendor/UPNG.js');
  const p = UPNG.decode(buf), ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[p.ctype]; if (!ch) return loadImage(file);
  const n = p.width * p.height * ch, a = new Uint16Array(n), d = p.data; for (let i = 0; i < n; i++) a[i] = (d[i * 2] << 8) | d[i * 2 + 1];
  return { w: p.width, h: p.height, layers: [hdLayer(base(file.name), hdFromInts(a, p.width, p.height, ch, 65535, { bits: 16, src: 'PNG' }), 0.25)] };
}
async function loadHeic(file) { // iPhone photos
  let img; try { img = await createImageBitmap(file); } catch (e) { await loadScript('vendor/heic-to.js'); img = await HeicTo({ blob: file, type: 'bitmap' }); }
  return { w: img.width, h: img.height, layers: [fromBitmap(img, base(file.name))] };
}
async function loadRaw(file) {
  const v = await dialog({ title: 'Open ' + file.name, text: 'Camera raw files are developed by LibRaw in your browser and kept as 16-bit linear data, so exposure and white balance can be changed afterwards without loss (Properties ▸ Develop).',
    params: [{ id: 'wb', label: 'White balance', type: 'select', options: [['camera', 'As shot (camera)'], ['auto', 'Automatic'], ['none', 'None (daylight)']], default: 'camera' }, { id: 'half', label: 'Half size (faster, a quarter of the memory)', type: 'check', default: file.size > 60e6 }] });
  if (!v) return null;
  if (!window.crossOriginIsolated) throw new Error('the raw decoder needs the page to be reloaded once. Reload SciFig and open the file again');
  app.toast('Developing raw file…', 120000);
  const { default: LibRaw } = await import('../vendor/libraw/index.js'), raw = new LibRaw();
  try {
    await raw.open(new Uint8Array(await file.arrayBuffer()), { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: v.wb === 'camera', useAutoWb: v.wb === 'auto', outputColor: 1, halfSize: v.half, userQual: 3 });
    const im = await raw.imageData(); if (!im || !im.data) throw new Error('this raw format could not be decoded');
    app.toast('Done', 800);
    return { w: im.width, h: im.height, layers: [hdLayer(base(file.name), hdFromInts(im.data, im.width, im.height, im.colors, im.bits === 16 ? 65535 : 255, { bits: 16, linear: true, src: 'camera raw' }), 0.6)] };
  } finally { if (raw.dispose) raw.dispose(); }
}
// 16-bit and 32-bit TIFF samples as float pixels, or null when the layout is not one we keep in high depth.
function tiffHD(ifd) {
  const bps = ifd.t258 ? ifd.t258[0] : 8, spp = ifd.t277 ? ifd.t277[0] : 1, sf = ifd.t339 ? ifd.t339[0] : 1, pm = ifd.t262 ? ifd.t262[0] : 2, w = ifd.width, h = ifd.height, n = w * h * spp;
  if ((bps !== 16 && bps !== 32) || pm > 2 || spp > 4 || (ifd.t284 && ifd.t284[0] === 2) || !ifd.data || ifd.data.length < n * bps / 8) return null;
  let a, max = 1; const dv = new DataView(ifd.data.buffer, ifd.data.byteOffset, ifd.data.byteLength);
  if (bps === 16) { a = new Uint16Array(n); for (let i = 0; i < n; i++) a[i] = dv.getUint16(i * 2, true); max = 65535; } // UTIF already made 16-bit samples little-endian
  else if (sf === 3) { a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat32(i * 4, ifd.isLE); }
  else { a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = dv.getUint32(i * 4, ifd.isLE); max = 4294967295; }
  if (pm === 0) for (let i = 0; i < n; i++) a[i] = max - a[i];
  return hdFromInts(a, w, h, spp, max, { bits: bps, linear: sf === 3, src: 'TIFF' });
}
async function loadTiff(file) {
  const buf = await file.arrayBuffer(), ifds = UTIF.decode(buf).filter(i => i.t256), layers = [];
  for (const ifd of ifds.slice(0, 60)) {
    UTIF.decodeImage(buf, ifd);
    const name = ifds.length > 1 ? 'Page ' + (layers.length + 1) : base(file.name), hd = tiffHD(ifd);
    if (hd) { const H = hdLayer(name, hd, 0.25); if (layers.length) H.visible = false; layers.push(H); continue; }
    const rgba = UTIF.toRGBA8(ifd), L = rasterLayer(name, ifd.width, ifd.height);
    L.ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), ifd.width, ifd.height), 0, 0);
    if (layers.length) L.visible = false;
    layers.push(L);
  }
  if (!layers.length) throw new Error('No image found in TIFF');
  const xr = ifds[0].t282 && ifds[0].t282[0], ru = ifds[0].t296 && ifds[0].t296[0];
  return { w: layers[0].canvas.width, h: layers[0].canvas.height, layers, dpi: xr > 1 ? Math.round(ru === 3 ? xr * 2.54 : xr) : undefined };
}
async function loadPsd(file) {
  await loadScript('vendor/ag-psd.js');
  const psd = agPsd.readPsd(await file.arrayBuffer()), layers = [];
  const walk = (list, hidden, opacity) => { for (const c of list || []) {
    if (c.children) { walk(c.children, hidden || c.hidden, opacity * (c.opacity ?? 1)); continue; }
    if (!c.canvas) continue;
    const blend = (c.blendMode || 'normal').replace(/ /g, '-');
    layers.push(new Layer({ type: 'raster', name: c.name || 'Layer', canvas: c.canvas, x: c.left || 0, y: c.top || 0, opacity: opacity * (c.opacity ?? 1), visible: !(hidden || c.hidden), blend: BLENDS.includes(blend) ? blend : 'normal' }));
  } };
  walk(psd.children, false, 1);
  if (!layers.length && psd.canvas) layers.push(new Layer({ type: 'raster', name: 'Background', canvas: psd.canvas }));
  if (!layers.length) throw new Error('This PSD has no readable pixel layers');
  const res = psd.imageResources && psd.imageResources.resolutionInfo;
  return { w: psd.width, h: psd.height, layers, dpi: res && res.horizontalResolution ? Math.round(res.horizontalResolution) : undefined };
}
async function loadPdf(file) {
  await loadScript('vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const v = await dialog({ title: 'Open ' + file.name, text: `PDF and AI pages are rasterised at the resolution you choose. This file has ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}.`,
    params: [{ id: 'page', label: 'Page', type: 'number', min: 1, max: pdf.numPages, default: 1 }, { id: 'dpi', label: 'Resolution (dpi)', type: 'number', min: 20, max: 1200, default: 300 }, { id: 'white', label: 'White background', type: 'check', default: true }] });
  if (!v) return null;
  const page = await pdf.getPage(Math.min(pdf.numPages, Math.max(1, Math.round(v.page)))), vp = page.getViewport({ scale: v.dpi / 72 });
  const L = rasterLayer(base(file.name), vp.width, vp.height);
  await page.render({ canvasContext: L.ctx, viewport: vp, background: v.white ? '#fff' : 'rgba(0,0,0,0)' }).promise;
  return { w: L.canvas.width, h: L.canvas.height, dpi: v.dpi, unit: 'mm', layers: [L] };
}
async function loadEps(file) {
  const v = await dialog({ title: 'Open ' + file.name, text: 'EPS/PostScript is interpreted with Ghostscript in your browser and rasterised. The first use downloads the interpreter (16 MB).',
    params: [{ id: 'dpi', label: 'Resolution (dpi)', type: 'number', min: 20, max: 1200, default: 300 }] });
  if (!v) return null;
  app.toast('Interpreting PostScript…', 60000);
  await loadScript('vendor/gs.js');
  const log = [], gs = await window.Module({ locateFile: f => 'vendor/' + f, print: t => log.push(t), printErr: t => log.push(t) });
  gs.FS.writeFile('/in.eps', new Uint8Array(await file.arrayBuffer()));
  try { gs.callMain(['-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pngalpha', '-r' + v.dpi, '-dEPSCrop', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-sOutputFile=/out.png', '/in.eps']); } catch (e) { /* emscripten exit status */ }
  let png; try { png = gs.FS.readFile('/out.png'); } catch (e) { throw new Error('Ghostscript could not read this file. ' + log.slice(-3).join(' ')); }
  const img = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  app.toast('Done');
  return { w: img.width, h: img.height, dpi: v.dpi, unit: 'mm', layers: [fromBitmap(img, base(file.name))] };
}

// ---------- SVG import ----------
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0]; const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let t;
  while ((t = re.exec(str || ''))) {
    const a = (t[2].match(NUM) || []).map(Number); let n;
    if (t[1] === 'matrix') n = a; else if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; else if (t[1] === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (t[1] === 'rotate') { const r = a[0] * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0; n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; }
    else if (t[1] === 'skewX') n = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; else n = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0];
    if (n && n.length === 6) m = mMul(m, n);
  }
  return m;
}
function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  const out = []; if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const sp = Math.sin(phi), cp = Math.cos(phi), dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den)), cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2))), d = dth / n, k = 4 / 3 * Math.tan(d / 4);
  const pt = (t, ex, ey) => { const X = rx * (Math.cos(t) + ex), Y = ry * (Math.sin(t) + ey); return [cp * X - sp * Y + cx, sp * X + cp * Y + cy]; };
  for (let i = 0; i < n; i++) { const a = th1 + i * d, b = a + d; out.push([...pt(a, -k * Math.sin(a), k * Math.cos(a)), ...pt(b, k * Math.sin(b), -k * Math.cos(b)), ...pt(b, 0, 0)]); }
  return out;
}
function parsePathD(dstr) {
  const tok = dstr.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [], subs = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cur = null, lc = null, lq = null;
  const num = () => parseFloat(tok[i++]);
  const curve = (c1x, c1y, c2x, c2y, px, py) => { const a = cur.nodes[cur.nodes.length - 1]; a.ox = c1x; a.oy = c1y; cur.nodes.push({ x: px, y: py, ix: c2x, iy: c2y }); x = px; y = py; };
  const lineTo = (px, py) => { cur.nodes.push({ x: px, y: py }); x = px; y = py; };
  const start = (px, py) => { cur = { nodes: [{ x: px, y: py }], closed: false }; subs.push(cur); x = sx = px; y = sy = py; };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C !== 'Z' && i >= tok.length) break;
    if (C !== 'M' && C !== 'Z' && !cur) start(x, y);
    if (C !== 'M' && C !== 'Z' && cur.closed) start(sx, sy);
    let c2 = null, q = null;
    if (C === 'M') { start(ox + num(), oy + num()); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') lineTo(ox + num(), oy + num());
    else if (C === 'H') lineTo(ox + num(), y);
    else if (C === 'V') lineTo(x, oy + num());
    else if (C === 'C') { const a = [num(), num(), num(), num(), num(), num()]; c2 = [ox + a[2], oy + a[3]]; curve(ox + a[0], oy + a[1], c2[0], c2[1], ox + a[4], oy + a[5]); }
    else if (C === 'S') { const a = [num(), num(), num(), num()], r = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; c2 = [ox + a[0], oy + a[1]]; curve(r[0], r[1], c2[0], c2[1], ox + a[2], oy + a[3]); }
    else if (C === 'Q' || C === 'T') {
      q = C === 'Q' ? [ox + num(), oy + num()] : (lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]);
      const px = ox + num(), py = oy + num();
      curve(x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), px + 2 / 3 * (q[0] - px), py + 2 / 3 * (q[1] - py), px, py);
    } else if (C === 'A') { const a = [num(), num(), num(), num(), num(), num(), num()]; for (const s of arcToCubics(x, y, a[0], a[1], a[2] * Math.PI / 180, !!a[3], !!a[4], ox + a[5], oy + a[6])) curve(...s); }
    else if (C === 'Z') {
      if (cur) { cur.closed = true; const n = cur.nodes, f = n[0], l = n[n.length - 1];
        if (n.length > 2 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) { if (l.ix != null) { f.ix = l.ix; f.iy = l.iy; } n.pop(); }
        x = sx; y = sy; }
    } else i++;
    lc = c2; lq = q;
  }
  return subs.filter(s => s.nodes.length > 1);
}
const lenPx = (v, def) => { const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*(px|pt|mm|cm|in|pc|%|em)?/i.exec(v || ''); if (!m) return def; const k = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pc: 16, em: 16 }[(m[2] || 'px').toLowerCase()]; return k ? parseFloat(m[1]) * k : def; };
const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility'];
const paint = v => { if (v == null) return undefined; v = v.trim(); if (v === 'none' || v === 'transparent') return null; if (v === 'currentColor') return '#000000'; if (/^url\(/.test(v)) return '#888888'; return v; };

export function parseSVG(text, dpi = 300) {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml'), root = xml.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG file');
  const vb = (root.getAttribute('viewBox') || '').match(NUM);
  const wpx = lenPx(root.getAttribute('width'), vb ? +vb[2] : 800), hpx = lenPx(root.getAttribute('height'), vb ? +vb[3] : 600), k = dpi / 96;
  let M0 = [k, 0, 0, k, 0, 0];
  if (vb) M0 = mMul(M0, mMul([wpx / +vb[2], 0, 0, hpx / +vb[3], 0, 0], mTranslate(-vb[0], -vb[1])));
  const classes = {};
  for (const st of root.querySelectorAll('style')) { const re = /\.([\w-]+)\s*\{([^}]*)\}/g; let m; while ((m = re.exec(st.textContent))) classes[m[1]] = (classes[m[1]] || '') + ';' + m[2]; }
  const shapes = [], images = [];
  const styleOf = (el, inh) => {
    const s = { ...inh, opacity: 1 };
    const decl = t => { for (const d of (t || '').split(';')) { const j = d.indexOf(':'); if (j > 0) { const key = d.slice(0, j).trim(); if (STYLE_KEYS.includes(key)) s[key] = d.slice(j + 1).trim(); } } };
    for (const key of STYLE_KEYS) if (el.hasAttribute(key)) s[key] = el.getAttribute(key);
    for (const c of (el.getAttribute('class') || '').split(/\s+/)) if (classes[c]) decl(classes[c]);
    decl(el.getAttribute('style'));
    s.alpha = (inh.alpha ?? 1) * (parseFloat(s.opacity) || (s.opacity === '0' ? 0 : 1));
    return s;
  };
  const mkStyle = (s, M) => {
    const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
    const fill = paint(s.fill), stroke = paint(s.stroke) ?? null, sw = lenPx(s['stroke-width'], 1) * sc;
    const fo = parseFloat(s['fill-opacity'] ?? 1), so = parseFloat(s['stroke-opacity'] ?? 1), f = fill === undefined ? '#000000' : fill;
    const dash = s['stroke-dasharray'] && s['stroke-dasharray'] !== 'none' ? ((s['stroke-dasharray'].match(NUM) || [0])[0] / Math.max(0.01, lenPx(s['stroke-width'], 1)) < 1.6 ? 'dotted' : 'dashed') : 'solid';
    return { fill: f, stroke, sw: stroke ? sw : 0, dash, as: 'none', ae: 'none', alpha: s.alpha * (f ? (isNaN(fo) ? 1 : fo) : (isNaN(so) ? 1 : so)), cap: s['stroke-linecap'] || undefined, join: s['stroke-linejoin'] || undefined };
  };
  const A = (el, n, d = 0) => { const v = lenPx(el.getAttribute(n), NaN); return isNaN(v) ? d : v; };
  const push = (s, st, M) => { s.id = uid(); s.st = mkStyle(st, M); transformShape(s, M); shapes.push(s); };
  const walk = (el, M, inh, depth) => {
    if (el.nodeType !== 1 || depth > 40) return;
    const tag = el.localName;
    if (['defs', 'clipPath', 'mask', 'symbol', 'style', 'metadata', 'title', 'desc', 'pattern', 'linearGradient', 'radialGradient', 'marker', 'filter'].includes(tag) && depth > 0 && !inh._use) return;
    const st = styleOf(el, inh);
    if (st.display === 'none' || st.visibility === 'hidden') return;
    if (el.hasAttribute('transform')) M = mMul(M, parseTransform(el.getAttribute('transform')));
    if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch' || tag === 'symbol') { for (const c of el.children) walk(c, M, { ...st, _use: false }, depth + 1); return; }
    if (tag === 'use') {
      const href = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').replace(/^#/, ''), ref = href && xml.getElementById(href);
      if (ref) walk(ref, mMul(M, mTranslate(A(el, 'x'), A(el, 'y'))), { ...st, _use: true }, depth + 1);
      return;
    }
    if (tag === 'path') { const subs = parsePathD(el.getAttribute('d') || ''); if (subs.length) push({ type: 'path', nodes: subs[0].nodes, closed: subs[0].closed, ...(subs.length > 1 ? { subs: subs.slice(1) } : {}) }, st, M); }
    else if (tag === 'rect') { const w = A(el, 'width'), h = A(el, 'height'); if (w > 0 && h > 0) push({ type: 'rect', x: A(el, 'x'), y: A(el, 'y'), w, h, r: A(el, 'rx', A(el, 'ry')), rot: 0 }, st, M); }
    else if (tag === 'circle') { const r = A(el, 'r'); if (r > 0) push({ type: 'ellipse', cx: A(el, 'cx'), cy: A(el, 'cy'), rx: r, ry: r, rot: 0 }, st, M); }
    else if (tag === 'ellipse') { const rx = A(el, 'rx'), ry = A(el, 'ry'); if (rx > 0 && ry > 0) push({ type: 'ellipse', cx: A(el, 'cx'), cy: A(el, 'cy'), rx, ry, rot: 0 }, st, M); }
    else if (tag === 'line') push({ type: 'path', nodes: [{ x: A(el, 'x1'), y: A(el, 'y1') }, { x: A(el, 'x2'), y: A(el, 'y2') }], closed: false }, { ...st, fill: 'none' }, M);
    else if (tag === 'polyline' || tag === 'polygon') { const n = (el.getAttribute('points') || '').match(NUM) || [], nodes = []; for (let j = 0; j + 1 < n.length; j += 2) nodes.push({ x: +n[j], y: +n[j + 1] }); if (nodes.length > 1) push({ type: 'path', nodes, closed: tag === 'polygon' }, st, M); }
    else if (tag === 'text') {
      const first = el.querySelector('tspan'), xa = el.hasAttribute('x') ? el : first || el, ya = el.hasAttribute('y') ? el : first || el;
      const txt = el.textContent.replace(/\s+/g, ' ').trim(); if (!txt) return;
      const fs = el.querySelector('[font-size]'), size = lenPx(st['font-size'] || (fs && fs.getAttribute('font-size')), 16);
      const anchor = st['text-anchor'], s = { type: 'text', x: A(xa, 'x'), y: A(ya, 'y'), text: txt, size, font: (st['font-family'] || 'Arial').split(',')[0].replace(/['"]/g, '').trim(),
        bold: /bold|[6-9]00/.test(st['font-weight'] || ''), italic: /italic|oblique/.test(st['font-style'] || ''), align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', rot: 0 };
      const full = M, ang = Math.atan2(full[1], full[0]);
      s.id = uid(); const ms = mkStyle(st, M); s.st = { fill: ms.fill || '#000000', alpha: ms.alpha };
      transformShape(s, full); if (Math.abs(full[1]) < 1e-12 && Math.abs(full[2]) < 1e-12) s.rot = 0; else s.rot = ang;
      shapes.push(s);
    } else if (tag === 'image') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href'); if (href) images.push({ href, x: A(el, 'x'), y: A(el, 'y'), w: A(el, 'width'), h: A(el, 'height'), M, at: shapes.length });
    }
  };
  walk(root, M0, { alpha: 1 }, 0);
  return { w: wpx * k, h: hpx * k, shapes, images };
}
async function loadSvg(file) {
  const dpi = 300, r = parseSVG(await file.text(), dpi), layers = [];
  // embedded images become image layers; vector runs between them keep their stacking order
  let from = 0, n = 1;
  const flush = to => { if (to > from) { const L = vectorLayer(layers.some(l => l.type === 'vector') ? 'Vector ' + (++n) : base(file.name)); L.shapes = r.shapes.slice(from, to); layers.push(L); } from = to; };
  for (const im of r.images) {
    flush(im.at);
    try {
      const el = new Image(); el.src = im.href; await el.decode();
      const L = rasterLayer('Image', r.w, r.h), c = L.ctx; c.setTransform(...im.M); c.drawImage(el, im.x, im.y, im.w || el.naturalWidth, im.h || el.naturalHeight); layers.push(L);
    } catch (e) { /* linked image that is not available */ }
  }
  flush(r.shapes.length);
  if (!layers.length) throw new Error('No drawable content found in this SVG');
  return { w: Math.round(r.w), h: Math.round(r.h), dpi, unit: 'mm', layers, vector: true };
}
async function loadNative(file) { return { doc: await Doc.fromJSON(JSON.parse(await file.text())) }; }

const RAW_EXT = ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'raw', '3fr', 'erf', 'kdc', 'mrw', 'x3f', 'iiq', 'rwl', 'dcr'];
const LOADERS = { ...Object.fromEntries(RAW_EXT.map(e => [e, loadRaw])), heic: loadHeic, heif: loadHeic, scifig: loadNative, png: loadImage16, jpg: loadImage, jpeg: loadImage, webp: loadImage, gif: loadImage, bmp: loadImage, avif: loadImage, tif: loadTiff, tiff: loadTiff, psd: loadPsd, psb: loadPsd,
  svg: loadSvg, pdf: loadPdf, ai: loadPdf, eps: loadEps, ps: loadEps, figura: loadNative, json: loadNative };
export const ACCEPT = Object.keys(LOADERS).map(e => '.' + e).join(',');

// Build a document from what a loader returned.
function docOf(r, name) {
  const d = new Doc({ name, w: r.w, h: r.h, dpi: r.dpi || 300, unit: r.unit || 'px' });
  if (r.vector) { const bg = rasterLayer('Background', d.w, d.h); bg.ctx.fillStyle = '#fff'; bg.ctx.fillRect(0, 0, d.w, d.h); d.layers.push(bg); }
  for (const L of r.layers) d.layers.push(L);
  if (r.layers.length === 1 && r.layers[0].type === 'raster' && !r.vector) r.layers[0].name = 'Background';
  d.activeId = d.layers[d.layers.length - 1].id;
  d.commit('Open'); d.dirty = false;
  return d;
}
const loaderOf = file => LOADERS[ext(file.name)] || (file.type.startsWith('image/') ? loadImage : null);
export async function openFiles(files, place = false) {
  for (const file of files) {
    const fn = loaderOf(file);
    if (!fn) { app.toast(`Cannot open ${file.name}: unsupported format`); continue; }
    try {
      const r = await fn(file); if (!r) continue;
      if (r.doc) { r.doc.name = base(file.name); app.addDoc(r.doc); addRecent(r.doc, file, 'file'); continue; }
      if (place && app.doc) {
        const d = app.doc, dx = Math.round((d.w - r.w) / 2), dy = Math.round((d.h - r.h) / 2);
        for (const L of r.layers) { if (L.type === 'raster') { L.x += dx; L.y += dy; } else if (L.shapes) for (const s of L.shapes) transformShape(s, mTranslate(dx, dy)); d.add(L); }
        app.commit('Place ' + file.name);
      } else { const nd = docOf(r, base(file.name)); app.addDoc(nd); addRecent(nd, file, 'file'); }
    } catch (e) { console.error(e); app.toast(`Could not open ${file.name}: ${e.message || e}`, 7000); }
  }
}
// Open each file and save it straight away in another format (iPhone HEIC to JPEG, raw to 16-bit TIFF, …).
export async function convertFiles(files, format) {
  let n = 0;
  for (const file of files) {
    const fn = loaderOf(file); if (!fn) { app.toast(`Cannot read ${file.name}`); continue; }
    try { const r = await fn(file); if (!r) continue; const d = r.doc || docOf(r, base(file.name)); d.name = base(file.name); await exportDoc(d, format, { quiet: true }); n++; await new Promise(q => setTimeout(q, 250)); }
    catch (e) { console.error(e); app.toast(`Could not convert ${file.name}: ${e.message || e}`, 7000); }
  }
  app.toast(`Converted ${n} file${n === 1 ? '' : 's'} to ${format.toUpperCase()}. They are in your downloads folder.`, 5000);
}
export function pickFiles(place, then) {
  const inp = document.getElementById('fileInput');
  inp.accept = ACCEPT + ',image/*'; inp.value = '';
  inp.onchange = () => then ? then([...inp.files]) : openFiles([...inp.files], place);
  inp.click();
}

// ---------- export ----------
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = v => fmt(v, 3);
function pathD(subs) {
  let d = '';
  for (const sp of subs) {
    const n = sp.nodes; if (!n.length) continue;
    d += `M${n2(n[0].x)} ${n2(n[0].y)}`;
    const cnt = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < cnt; i++) { const a = n[i], b = n[(i + 1) % n.length];
      d += a.ox != null || b.ix != null ? `C${n2(a.ox ?? a.x)} ${n2(a.oy ?? a.y)} ${n2(b.ix ?? b.x)} ${n2(b.iy ?? b.y)} ${n2(b.x)} ${n2(b.y)}` : `L${n2(b.x)} ${n2(b.y)}`; }
    if (sp.closed) d += 'Z';
  }
  return d;
}
function shapeSVG(s) {
  const st = s.st || {}, op = (st.alpha != null && st.alpha < 1 ? ` opacity="${n2(st.alpha)}"` : '') + svgShadow(st.shadow);
  const bb = isGrad(st.fill) || isGrad(st.stroke) ? (s.type === 'text' ? shapeBBox({ ...s, rot: 0 }) : shapeBBox(s)) : null;
  if (s.type === 'dim') return d0.hideDims || s.note === false ? '' : `<g>${dimShapes(s).map(shapeSVG).join('')}</g>`;
  if (s.type === 'text') {
    const L = textLayout(s), anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start'; let body = '';
    L.lines.forEach((ln, i) => {
      let shift = 0, first = true;
      for (const r of textRuns(ln.runs.map(q => (q.mode ? q.mode + '{' + q.t + '}' : q.t)).join(''))) {
        const want = r.mode === '^' ? -s.size * 0.38 : r.mode === '_' ? s.size * 0.18 : 0, dy = want - shift + (first && i ? L.lh : 0); shift = want;
        body += `<tspan${first ? ' x="0"' : ''}${dy ? ` dy="${n2(dy)}"` : ''}${r.mode ? ` font-size="${n2(s.size * 0.65)}"` : ''}>${esc(r.t)}</tspan>`; first = false;
      }
      if (shift) body += `<tspan dy="${n2(-shift)}"></tspan>`;
    });
    return `<text transform="translate(${n2(s.x)} ${n2(s.y)}) rotate(${n2((s.rot || 0) * 180 / Math.PI)})" font-family="${esc(s.font || 'Arial')}" font-size="${n2(s.size)}"${s.bold ? ' font-weight="bold"' : ''}${s.italic ? ' font-style="italic"' : ''} text-anchor="${anchor}" fill="${isGrad(st.fill) ? svgGrad(st.fill, { ...bb, x: bb.x - s.x, y: bb.y - s.y }) : esc(st.fill || '#000')}"${op} xml:space="preserve">${body}</text>`;
  }
  const dash = dashArr(st).map(v => n2(v * st.sw)).join(' ');
  const pnt = p => isGrad(p) ? svgGrad(p, bb) : esc(p);
  const paintAttr = `fill="${st.fill ? pnt(st.fill) : 'none'}"${st.fill ? ' fill-rule="evenodd"' : ''}` + (st.stroke && st.sw > 0 ? ` stroke="${pnt(st.stroke)}" stroke-width="${n2(st.sw)}"${dash ? ` stroke-dasharray="${dash}"` : ''}${st.dash === 'dotted' || st.cap === 'round' ? ' stroke-linecap="round"' : ''}${st.join ? ` stroke-linejoin="${st.join}"` : ''}` : '');
  if (s.type === 'rect' && !s.rot) return `<rect x="${n2(s.x)}" y="${n2(s.y)}" width="${n2(s.w)}" height="${n2(s.h)}"${s.r ? ` rx="${n2(s.r)}"` : ''} ${paintAttr}${op}/>`;
  if (s.type === 'ellipse' && !s.rot) return `<ellipse cx="${n2(s.cx)}" cy="${n2(s.cy)}" rx="${n2(s.rx)}" ry="${n2(s.ry)}" ${paintAttr}${op}/>`;
  let subs = geomSubs(s), extra = '';
  const open = s.type === 'path' && !s.closed && s.nodes.length > 1 && st.stroke;
  if (open && ((st.as && st.as !== 'none') || (st.ae && st.ae !== 'none'))) {
    const nodes = s.nodes.map(q => ({ ...q })), col = esc(solidOf(st.stroke));
    const head = (kind, tip, d) => { if (!d || !kind || kind === 'none') return;
      for (const q of headParts(kind, tip, d, st)) {
        const paint = `fill="${q.fill ? (q.fill === 'paper' ? '#ffffff' : col) : 'none'}"${q.stroke ? ` stroke="${col}" stroke-width="${n2(st.sw)}"` : ''}`;
        extra += q.circle ? `<circle cx="${n2(q.circle[0])}" cy="${n2(q.circle[1])}" r="${n2(q.circle[2])}" ${paint}/>` : `<path d="M${q.poly.map(p => n2(p[0]) + ' ' + n2(p[1])).join('L')}${q.open ? '' : 'Z'}" ${paint}/>`;
      } };
    const d0 = endDir(s.nodes, false), d1 = endDir(s.nodes, true), e = s.nodes.length - 1;
    head(st.as, s.nodes[0], d0); head(st.ae, s.nodes[e], d1);
    const b0 = headBack(st.as, st), b1 = headBack(st.ae, st);
    if (b0 && d0) { nodes[0].x -= d0.x * b0; nodes[0].y -= d0.y * b0; }
    if (b1 && d1) { nodes[e].x -= d1.x * b1; nodes[e].y -= d1.y * b1; }
    subs = [{ nodes, closed: false }, ...(s.subs || [])];
  }
  const p = `<path d="${pathD(subs)}" ${paintAttr}/>`;
  return extra || op ? `<g${op}>${p}${extra}</g>` : p;
}
let d0 = {}, defs = [];
// gradients and shadows become <defs> entries that the shapes point to
function svgGrad(p, b) {
  const id = 'g' + defs.length, q = gradGeom(p, b), stops = p.stops.map(s => `<stop offset="${n2(s.o)}" stop-color="${esc(s.c)}"${(s.a ?? 1) < 1 ? ` stop-opacity="${n2(s.a)}"` : ''}/>`).join('');
  defs.push(p.g === 'radial' ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n2(q.cx)}" cy="${n2(q.cy)}" r="${n2(q.r)}">${stops}</radialGradient>`
    : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(q.x1)}" y1="${n2(q.y1)}" x2="${n2(q.x2)}" y2="${n2(q.y2)}">${stops}</linearGradient>`);
  return `url(#${id})`;
}
function svgShadow(sh) {
  if (!sh) return ''; const id = 'f' + defs.length;
  defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${n2(sh.x ?? 3)}" dy="${n2(sh.y ?? 3)}" stdDeviation="${n2((sh.blur ?? 6) / 2)}" flood-color="${esc(sh.c || '#000000')}" flood-opacity="${n2(sh.a ?? 0.45)}"/></filter>`);
  return ` filter="url(#${id})"`;
}
export function toSVG(d) {
  d0 = d; defs = [];
  const vis = d.layers.filter(L => L.visible); let lastAdj = -1; vis.forEach((L, i) => { if (L.type === 'adjust') lastAdj = i; });
  let body = '';
  const image = (c, x, y, L) => `<image x="${x}" y="${y}" width="${c.width}" height="${c.height}"${L && L.opacity < 1 ? ` opacity="${n2(L.opacity)}"` : ''}${L && L.blend !== 'normal' ? ` style="mix-blend-mode:${L.blend}"` : ''} href="${c.toDataURL('image/png')}"/>\n`;
  if (lastAdj >= 0) body += image(rasterOf(d, vis.slice(0, lastAdj + 1), 'flat').canvas, 0, 0, null); // adjustments are baked into one image
  for (const L of vis.slice(lastAdj + 1)) {
    if (L.mask && L.maskOn) body += image(rasterOf(d, [L], 'masked').canvas, 0, 0, null); // a masked layer is exported as pixels
    else if (L.type === 'raster') body += image(L.canvas, L.x, L.y, L);
    else if (L.type === 'vector') body += `<g id="${esc(L.name.replace(/\s+/g, '_'))}"${L.opacity < 1 ? ` opacity="${n2(L.opacity)}"` : ''}${L.blend !== 'normal' ? ` style="mix-blend-mode:${L.blend}"` : ''}>\n${L.shapes.map(shapeSVG).join('\n')}\n</g>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(d.w / d.dpi * 25.4)}mm" height="${n2(d.h / d.dpi * 25.4)}mm" viewBox="0 0 ${d.w} ${d.h}">\n${defs.length ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''}${body}</svg>\n`;
}
const blobOf = (c, type, q) => new Promise(ok => c.toBlob(ok, type, q));
export async function exportDoc(d, format, o = {}) { setExporting(true); try { await exportDoc2(d, format, o); } finally { setExporting(false); } }
async function exportDoc2(d, format, o) {
  const name = d.name || 'figure';
  if (format === 'tiff16' || format === 'tiff32' || format === 'png16') {
    // high bit depth: the high-bit layer at full precision; without one, the 8-bit picture is written in the deeper format
    const hasHD = d.layers.some(L => L.hd && L.visible); let asShown = true;
    if (hasHD && !o.quiet) { const v = await dialog({ title: 'Export ' + { tiff16: '16-bit TIFF', tiff32: '32-bit float TIFF', png16: '16-bit PNG' }[format], text: 'Writes the high-bit layer at full precision.',
      params: [{ id: 'shown', label: 'As displayed (Develop settings, with the layers above it; adjustment layers are left out)', type: 'check', default: true }] }); if (!v) return; asShown = v.shown; }
    let f = hasHD ? hdComposite(d, asShown) : null;
    if (!f) { const c = flatten(d, 1, { background: '#ffffff' }), p = c.getContext('2d').getImageData(0, 0, d.w, d.h).data; f = new Float32Array(d.w * d.h * 3); for (let i = 0, j = 0; i < p.length; i += 4, j += 3) { f[j] = p[i] / 255; f[j + 1] = p[i + 1] / 255; f[j + 2] = p[i + 2] / 255; } }
    if (format === 'png16') download(png16(toU16(f), d.w, d.h), name + '.png'); else download(tiffHi(format === 'tiff32' ? f : toU16(f), d.w, d.h, format === 'tiff32', d.dpi), name + '.tif');
  }
  else if (format === 'webp') download(await blobOf(flatten(d), 'image/webp', 0.92), name + '.webp');
  else if (format === 'png') download(await blobOf(flatten(d), 'image/png'), name + '.png');
  else if (format === 'jpg') download(await blobOf(flatten(d, 1, { background: '#ffffff' }), 'image/jpeg', 0.95), name + '.jpg');
  else if (format === 'svg') download(new Blob([toSVG(d)], { type: 'image/svg+xml' }), name + '.svg');
  else if (format === 'tiff') { const c = flatten(d), px = c.getContext('2d').getImageData(0, 0, c.width, c.height); download(new Blob([UTIF.encodeImage(px.data, c.width, c.height)], { type: 'image/tiff' }), name + '.tif'); }
  else if (format === 'psd') {
    await loadScript('vendor/ag-psd.js');
    const solo = L => { const sv = [L.visible, L.opacity, L.blend]; L.visible = true; L.opacity = 1; L.blend = 'normal'; const c = rasterOf(d, [L], L.name).canvas; [L.visible, L.opacity, L.blend] = sv; return c; };
    const children = d.layers.filter(L => L.type !== 'adjust').map(L => { const R = L.type === 'raster' && !(L.mask && L.maskOn) ? L : null, c = R ? R.canvas : solo(L);
      return { name: L.name, canvas: c, left: R ? R.x : 0, top: R ? R.y : 0, opacity: L.opacity, hidden: !L.visible, blendMode: L.blend.replace(/-/g, ' ') }; });
    download(new Blob([agPsd.writePsd({ width: d.w, height: d.h, children, canvas: flatten(d) })], { type: 'image/vnd.adobe.photoshop' }), name + '.psd');
    if (d.layers.some(L => L.type !== 'raster') && !o.quiet) app.toast('PSD export: vector layers were rasterised and adjustment layers left out of the layer list (the preview image includes them).', 6000);
  }
}
export async function saveDoc(d, saveAs) {
  const text = JSON.stringify(d.toJSON());
  if (window.showSaveFilePicker) {
    try {
      if (!d.fileHandle || saveAs) d.fileHandle = await window.showSaveFilePicker({ suggestedName: d.name + '.scifig', types: [{ description: 'SciFig document', accept: { 'application/json': ['.scifig'] } }] });
      const w = await d.fileHandle.createWritable(); await w.write(text); await w.close();
      d.name = base(d.fileHandle.name); d.dirty = false; app.toast('Saved ' + d.fileHandle.name); app.refresh('docs'); addRecent(d, new Blob([text]), 'doc'); return;
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  }
  download(new Blob([text], { type: 'application/json' }), d.name + '.scifig'); d.dirty = false; app.refresh('docs'); addRecent(d, new Blob([text]), 'doc');
}

// ---------- autosave (IndexedDB) ----------
const idb = () => new Promise((ok, bad) => { const r = indexedDB.open('scifig', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
async function kv(mode, fn) { const db = await idb(); return new Promise((ok, bad) => { const tx = db.transaction('kv', mode), rq = fn(tx.objectStore('kv')); tx.oncomplete = () => ok(rq.result); tx.onerror = () => bad(tx.error); }); }
let saveT = null;
export function scheduleAutosave() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try {
      const px = app.docs.reduce((a, d) => a + d.layers.reduce((b, L) => b + (L.canvas ? L.canvas.width * L.canvas.height : 0), 0), 0);
      if (px > 120e6 || !app.docs.length) return; // too large to mirror into browser storage (rely on File ▸ Save), or nothing open: keep the last session
      await kv('readwrite', s => s.put({ docs: app.docs.map(d => d.toJSON({ maxHD: 48e6 })), active: app.docs.indexOf(app.doc), time: Date.now() }, 'session'));
    } catch (e) { console.warn('autosave failed', e); }
  }, 2500);
}
export async function sessionInfo() { try { const s = await kv('readonly', st => st.get('session')); return s && s.docs && s.docs.length ? { n: s.docs.length, time: s.time, names: s.docs.map(o => o.name) } : null; } catch (e) { return null; } }
export async function restoreSession() {
  try {
    const s = await kv('readonly', st => st.get('session'));
    if (!s || !s.docs || !s.docs.length) return false;
    for (const o of s.docs) { const d = await Doc.fromJSON(o); app.docs.push(d); }
    app.setDoc(app.docs[Math.max(0, Math.min(app.docs.length - 1, s.active))]);
    return true;
  } catch (e) { console.warn('restore failed', e); return false; }
}

// ---------- recent files (copies kept in this browser, so they reopen without asking for the file again) ----------
const RECENT_MAX = 12;
export async function getRecent() { try { return (await kv('readonly', st => st.get('recent'))) || []; } catch (e) { return []; } }
async function putRecent(list) { await kv('readwrite', st => st.put(list, 'recent')); app.emit('recent'); }
export async function addRecent(d, blob, kind) {
  try {
    if (!blob || blob.size > 150e6) return;
    const k = Math.min(1, 160 / Math.max(d.w, d.h)), t = flatten(d, k, { background: '#ffffff' }).toDataURL('image/jpeg', 0.8);
    const name = kind === 'doc' ? d.name + '.scifig' : blob.name || d.name;
    const list = (await getRecent()).filter(e => e.name !== name);
    list.unshift({ id: uid('R'), name, kind, time: Date.now(), thumb: t, w: d.w, h: d.h, data: blob });
    await putRecent(list.slice(0, RECENT_MAX));
  } catch (e) { console.warn('recent list not saved', e); }
}
export async function openRecent(id) {
  const e = (await getRecent()).find(q => q.id === id); if (!e) { app.toast('That file is no longer in the recent list'); return; }
  await openFiles([new File([e.data], e.name)]);
}
export async function removeRecent(id) { await putRecent((await getRecent()).filter(q => q.id !== id)); }
export async function clearRecent() { await putRecent([]); }
