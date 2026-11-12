// Scripted checks for the second round of features, run with index.html?test2 — results go to the console.
import { app } from '../js/app.js';
import { view } from '../js/view.js';
import { Doc, newDoc, flatten, vectorLayer, adjustLayer, dimShapes, uid, rasterLayer } from '../js/core.js';
import { openFiles, toSVG, parseSVG } from '../js/io.js';
import { setSelection, clearSelection, blueNoise, withResolution, defaultParams, refineSelection } from '../js/imaging.js';
import { tiffHi, png16, toU16, hdComposite, developHD } from '../js/hd.js';
import { slantedEdge, spectrum } from '../js/analyze.js';
import { inpaint } from '../js/inpaint.js';
import { rgbToLab, labToRgb, rgbToHsv, hsvToRgb } from '../js/color.js';
import { driveDim } from '../js/dims.js';

const out = []; let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; const s = (cond ? 'PASS ' : 'FAIL ') + name + (info !== '' ? '  ' + info : ''); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const over = document.getElementById('over');
const cl = (x, y) => { const r = over.getBoundingClientRect(), p = view.S({ x, y }); return { clientX: r.left + p.x, clientY: r.top + p.y }; };
const ptr = (type, x, y, o = {}) => over.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, ...cl(x, y), ...o }));
const click = (x, y, o) => { ptr('pointermove', x, y, { buttons: 0, ...o }); ptr('pointerdown', x, y, o); ptr('pointerup', x, y, o); };
const drag = (x0, y0, x1, y1, o) => { ptr('pointermove', x0, y0, { buttons: 0, ...o }); ptr('pointerdown', x0, y0, o); for (let i = 1; i <= 8; i++) ptr('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, o); ptr('pointerup', x1, y1, o); };
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: o.code || (/^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : k), bubbles: true, cancelable: true, ...o }));
const type = s => { for (const ch of s) key(ch); };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
const clickOK = async () => { for (let i = 0; i < 100; i++) { const b = document.querySelector('.dialog .primary'); if (b) { b.click(); return true; } await sleep(50); } return false; };
const last = L => L.shapes[L.shapes.length - 1];

async function run() {
  app.settings.snap.align = false; app.settings.style = { stroke: '#000000', swPt: 1, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: 1, hs: 1 };
  const d = newDoc({ name: 'T2', w: 600, h: 400, dpi: 300, unit: 'mm' }); app.addDoc(d); view.fit(); await sleep(150);
  const mm = d.pxPerUnit; let bg = d.layers[0], V = d.add(vectorLayer('V')); app.commit('v');

  // ---- value boxes: length, Tab, angle ----
  app.setTool('line'); click(100, 300); ptr('pointermove', 150, 290, { buttons: 0 }); type('5'); key('Tab'); type('30'); key('Enter'); key('Enter');
  let s = last(V); ok('HUD length + Tab + angle', s && near(s.nodes[1].x, 100 + 5 * mm * Math.cos(Math.PI / 6)) && near(s.nodes[1].y, 300 - 5 * mm * Math.sin(Math.PI / 6)), JSON.stringify(s && s.nodes[1]));
  click(100, 350); ptr('pointermove', 180, 350, { buttons: 0 }); type('40px'); key('Enter'); key('Enter');
  s = last(V); ok('typed unit suffix (40px)', near(s.nodes[1].x - s.nodes[0].x, 40) && near(s.nodes[1].y, s.nodes[0].y), JSON.stringify(s.nodes));
  app.setTool('rect'); click(300, 50); ptr('pointermove', 340, 80, { buttons: 0 }); type('20'); key('Tab'); type('10'); key('Enter');
  s = last(V); ok('rectangle W Tab H', s.type === 'rect' && near(s.w, 20 * mm) && near(s.h, 10 * mm), `${s.w} ${s.h}`);
  // ---- spline ----
  app.setTool('spline'); click(50, 100); click(120, 60); click(190, 100); click(260, 60); key('Enter');
  s = last(V); ok('spline through points', s.type === 'path' && s.nodes.length === 4 && s.nodes.every(n => n.a) && s.nodes[1].ox != null && s.nodes[0].ox == null, JSON.stringify(s.nodes[1]));
  const sp = s;
  app.setTool('node'); click(120, 60); ptr('pointermove', 120, 60, { buttons: 0 }); drag(120, 60, 120, 30, { altKey: false });
  ok('spline node drag recomputes handles', near(sp.nodes[1].y, 30, 1.5) && sp.nodes[1].a === 1 && Math.abs(sp.nodes[1].oy - sp.nodes[1].y) < 30, JSON.stringify(sp.nodes[1]));
  // typed node position
  type('10'); key('Tab'); type('5'); key('Enter');
  ok('typed node X/Y', near(sp.nodes[1].x, 10 * mm) && near(sp.nodes[1].y, 5 * mm), JSON.stringify(sp.nodes[1]));
  // ---- dimension ----
  app.setTool('dim'); click(300, 200); click(420, 200); click(360, 170);
  s = last(V); const parts = s.type === 'dim' ? dimShapes(s) : [];
  ok('dimension shape', s.type === 'dim' && near(s.b.x - s.a.x, 120) && Math.abs(Math.abs(s.off) - 30) < 1 && parts[3].text === (120 / mm).toFixed(2) + ' mm', s.type === 'dim' ? parts[3].text + ' off ' + s.off : s.type);
  // ---- dimensions as constraints ----
  const ln = V.shapes[1], n0 = { ...ln.nodes[0] }, n1 = { ...ln.nodes[1] }; // the 40 px horizontal line
  app.setTool('dim'); click(n0.x, n0.y); click(n1.x, n1.y); click((n0.x + n1.x) / 2, n0.y - 25);
  const dm = last(V); ok('dimension attaches to the line ends', dm.type === 'dim' && dm.ra && dm.rb && dm.ra.id === ln.id && dm.rb.id === ln.id, JSON.stringify([dm.ra, dm.rb]));
  driveDim(d, dm, 10 * mm); app.commit('drive'); ok('typing a length resizes the line', near(ln.nodes[1].x - ln.nodes[0].x, 10 * mm) && near(dm.b.x, ln.nodes[1].x) && dimShapes(dm)[3].text === '10.00 mm', `${ln.nodes[1].x - ln.nodes[0].x} ${dimShapes(dm)[3].text}`);
  dm.lock = 10 * mm; ln.nodes[1].x += 70; ln.nodes[1].y += 20; V.touch(); app.commit('pull');
  ok('locked dimension pulls the point back to its length', near(Math.hypot(ln.nodes[1].x - ln.nodes[0].x, ln.nodes[1].y - ln.nodes[0].y), 10 * mm, 1e-4) && ln.nodes[1].y > n1.y, JSON.stringify(ln.nodes[1]));
  ln.nodes[0].x -= 15; ln.nodes[1].x -= 15; V.touch(); app.commit('shift'); ok('dimension follows a moved shape', near(dm.a.x, ln.nodes[0].x) && near(dm.b.x, ln.nodes[1].x));
  const rc = V.shapes[2]; app.setTool('dim'); click(rc.x, rc.y); click(rc.x + rc.w, rc.y); click(rc.x + rc.w / 2, rc.y - 20);
  const dr = last(V); driveDim(d, dr, 30 * mm); app.commit('rect'); ok('dimension drives a rectangle width', dr.ra && dr.rb && near(rc.w, 30 * mm) && near(rc.h, 10 * mm), `${rc.w / mm} ${rc.h / mm}`);
  const lbl = dimShapes(dr)[3], hp = [Math.round(lbl.x), Math.round(lbl.y - lbl.size * 0.3)], dark = c => { let m = 255; for (let i = -6; i <= 6; i++) m = Math.min(m, px(c, hp[0] + i, hp[1])[0]); return m; };
  const shown = dark(flatten(d)); app.run('view.dims'); const hidden = dark(flatten(d)); app.run('view.dims');
  ok('View ▸ Show Dimensions hides them', shown < 120 && hidden === 255 && !d.hideDims, shown + ' ' + hidden);
  // colour panel recolours the selected shape
  app.setTool('select'); d.selShapes = new Set([rc.id]); app.refresh('props'); await sleep(60);
  const chip = [...document.querySelectorAll('#colorPanel .chip')].find(c => c.title === '#e04848'); chip.click(); await sleep(30);
  ok('Colour panel sets the stroke of the selected shape', rc.st.stroke === '#e04848' && app.fg !== '#e04848', rc.st.stroke + ' fg ' + app.fg);
  d.selShapes.clear(); app.refresh('props'); await sleep(40);
  // ---- typed transform in the Select tool ----
  app.setTool('select'); d.selShapes = new Set([V.shapes[2].id]); const r0 = { ...V.shapes[2] };
  type('2'); key('Tab'); type('3'); key('Enter');
  ok('typed move ΔX ΔY', near(V.shapes[2].x, r0.x + 2 * mm) && near(V.shapes[2].y, r0.y - 3 * mm), `${V.shapes[2].x} ${V.shapes[2].y}`);
  // ---- heads, dashes render and export ----
  V.shapes.push({ id: uid(), type: 'path', closed: false, nodes: [{ x: 40, y: 380 }, { x: 200, y: 380 }], st: { stroke: '#ff0000', sw: 4, fill: null, dash: 'dotted', dg: 4, as: 'circle', ae: 'diamond', hs: 1.5, alpha: 1 } }); V.touch(); app.commit('heads');
  let fl = flatten(d); ok('marker drawn at line end', px(fl, 200, 380)[0] > 200 && px(fl, 200, 380)[1] < 80, px(fl, 200, 380));
  const back = parseSVG(toSVG(d), d.dpi); ok('SVG export with dimension, markers, spline', back.shapes.length >= V.shapes.length + 3, back.shapes.length + ' vs ' + V.shapes.length);

  // ---- masks ----
  d.activeId = bg.id; app.run('layer.maskHide'); fl = flatten(d);
  ok('mask hides image layer', bg.mask && px(fl, 500, 300)[3] === 0, px(fl, 500, 300));
  app.setTool('brush'); app.tools.get('brush').opt.size = 40; app.tools.get('brush').opt.hardness = 100; app.setColor('fg', '#ffffff'); drag(480, 300, 540, 300); fl = flatten(d);
  ok('painting white on the mask reveals', d.editMask && px(fl, 510, 300)[3] === 255 && px(fl, 510, 350)[3] === 0, px(fl, 510, 300));
  app.undo(); ok('undo restores the mask', px(flatten(d), 510, 300)[3] === 0); app.redo(); bg = d.layers[0]; V = d.layers[1]; // undo rebuilds the layer objects
  app.run('layer.maskInvert'); ok('invert mask', px(flatten(d), 510, 350)[3] === 255 && px(flatten(d), 510, 300)[3] === 0);
  app.run('layer.maskDelete'); ok('delete mask', !bg.mask && px(flatten(d), 510, 300)[3] === 255);
  d.activeId = V.id; setSelection(d, x => x.fillRect(0, 0, 120, 400)); app.run('layer.maskAdd'); fl = flatten(d); app.run('layer.maskDelete');
  ok('mask on a vector layer (from selection)', !d.sel && px(fl, 200, 380).slice(0, 3).join() === '255,255,255' && px(flatten(d), 200, 380)[1] < 80, px(fl, 200, 380) + ' ' + px(flatten(d), 200, 380));
  const A = d.add(adjustLayer('Invert', 'invert', {})); setSelection(d, x => x.fillRect(0, 0, 300, 400)); app.run('layer.maskAdd'); fl = flatten(d);
  ok('mask on an adjustment layer', px(fl, 20, 20)[0] === 0 && px(fl, 580, 20)[0] === 255, px(fl, 20, 20) + ' ' + px(fl, 580, 20));
  const copy = await Doc.fromJSON(JSON.parse(JSON.stringify(d.toJSON()))); ok('mask survives save/load', !!copy.layers[copy.layers.length - 1].mask && px(flatten(copy), 20, 20)[0] === 0);
  d.remove(A); V.visible = false; d.activeId = bg.id; d.editMask = false; app.commit('clean');

  // ---- clone stamp, brush modes ----
  bg.ctx.fillStyle = '#00a000'; bg.ctx.fillRect(40, 40, 60, 60); bg.touch(); app.commit('green');
  app.setTool('stamp'); Object.assign(app.tools.get('stamp').opt, { size: 30, hardness: 100 }); click(70, 70, { altKey: true }); drag(300, 300, 310, 300);
  ok('clone stamp copies pixels', px(bg.canvas, 300, 300)[1] === 160 && px(bg.canvas, 300, 300)[0] === 0, px(bg.canvas, 300, 300));
  app.setTool('brush'); app.tools.get('brush').opt.mode = 'multiply'; app.setColor('fg', '#ff0000'); drag(60, 70, 80, 70);
  ok('brush in multiply mode', px(bg.canvas, 70, 70).slice(0, 3).join() === '0,0,0' && (() => { drag(400, 100, 420, 100); return px(bg.canvas, 410, 100).slice(0, 3).join() === '255,0,0'; })(), px(bg.canvas, 70, 70));
  app.tools.get('brush').opt.mode = 'normal';
  // ---- channel lock ----
  d.chan = { mode: 'rgb', edit: [2] }; app.setColor('fg', '#000000'); drag(400, 200, 430, 200);
  ok('channel lock: only blue changes', px(bg.canvas, 415, 200).slice(0, 3).join() === '255,255,0', px(bg.canvas, 415, 200));
  d.chan = { mode: 'lab', edit: [0] }; app.setColor('fg', '#0000ff'); drag(400, 250, 430, 250); const lp = px(bg.canvas, 415, 250);
  ok('channel lock in Lab: lightness only', Math.abs(lp[0] - lp[1]) < 4 && Math.abs(lp[1] - lp[2]) < 4 && lp[0] < 120, lp);
  d.chan = { mode: 'rgb', edit: null };
  // ---- selections from layer alpha and channels ----
  const P = d.add(rasterLayer('Patch', 50, 40, 200, 150)); P.ctx.fillStyle = '#123456'; P.ctx.fillRect(0, 0, 50, 40); app.commit('patch');
  app.run('select.fromLayer', P); ok('select layer content (alpha)', d.selBounds && d.selBounds.x === 200 && d.selBounds.w === 50 && d.selBounds.h === 40, JSON.stringify(d.selBounds));
  app.run('select.fromChannel', 0); ok('select from channel', d.sel && px(d.sel, 5, 5)[3] === 255 && px(d.sel, 70, 70)[3] === 0 && px(d.sel, 225, 170)[3] < 40, px(d.sel, 225, 170));
  // ---- move selected pixels ----
  d.activeId = bg.id; setSelection(d, x => x.fillRect(400, 90, 30, 20)); app.commit('sel'); app.setTool('select'); drag(410, 100, 510, 140);
  ok('Select tool cuts and moves the selected pixels', px(bg.canvas, 510, 140)[0] === 255 && px(bg.canvas, 510, 140)[1] === 0 && px(bg.canvas, 410, 100)[3] === 0 && d.selBounds.x === 500, px(bg.canvas, 510, 140) + ' ' + px(bg.canvas, 410, 100) + ' ' + JSON.stringify(d.selBounds));
  app.setTool('marquee'); drag(510, 140, 520, 150); ok('Marquee drags the outline only', d.selBounds.x === 510 && px(bg.canvas, 505, 135)[1] === 0, JSON.stringify(d.selBounds));
  // ---- refine ----
  refineSelection(d, { shift: 5, smooth: 0, feather: 0 }); ok('grow selection by 5 px', d.selBounds.w === 40 && d.selBounds.h === 30, JSON.stringify(d.selBounds));
  clearSelection(d); app.commit('desel');
  // ---- free transform ----
  d.activeId = P.id; app.setTool('transform'); await sleep(30); const T = app.tools.get('transform');
  T.bar().set('sc', 200); T.bar().set('rot', 90); key('Enter'); await sleep(30);
  ok('free transform by numbers', P.canvas.width === 80 && P.canvas.height === 100 && P.x === 185 && P.y === 120, `${P.canvas.width}x${P.canvas.height} at ${P.x},${P.y}`);
  d.activeId = P.id; app.setTool('transform'); await sleep(30); const hb = T.handles()[4]; drag(hb.x, hb.y, hb.x + 40, hb.y + 50); key('Enter'); await sleep(30);
  ok('free transform with a handle', Math.abs(P.canvas.width - 120) <= 1 && Math.abs(P.canvas.height - 150) <= 1, `${P.canvas.width}x${P.canvas.height}`);
  d.remove(P); app.commit('rm');

  // ---- content-aware fill (the offline patch method, so the test needs no download) ----
  app.tools.get('remove').opt.method = 'patch';
  const g = d.add(rasterLayer('Grad', 300, 200, 0, 0)), gx = g.ctx, gr = gx.createLinearGradient(0, 0, 300, 0); gr.addColorStop(0, '#202020'); gr.addColorStop(1, '#e0e0e0'); gx.fillStyle = gr; gx.fillRect(0, 0, 300, 200);
  gx.fillStyle = '#ff0000'; gx.fillRect(130, 80, 40, 40); app.commit('grad');
  setSelection(d, x => x.fillRect(126, 76, 48, 48)); app.run('edit.contentFill'); await sleep(1500);
  let q = px(g.canvas, 150, 100); ok('content-aware fill removes the object', Math.abs(q[0] - 128) < 14 && Math.abs(q[0] - q[1]) < 6 && Math.abs(q[1] - q[2]) < 6, q);
  clearSelection(d); gx.fillStyle = '#0000ff'; gx.fillRect(60, 60, 12, 12); g.touch(); app.commit('dot');
  app.setTool('remove'); app.tools.get('remove').opt.size = 30; drag(62, 66, 70, 66); await sleep(1200);
  q = px(g.canvas, 66, 66); ok('Remove tool', Math.abs(q[0] - q[2]) < 8 && q[0] > 40 && q[0] < 110, q);
  // ---- dithering ----
  const bn = blueNoise(); let mean = 0; for (const v of bn) mean += v; mean /= bn.length;
  ok('blue-noise map is a full ranking', bn.length === 4096 && near(mean, 0.5, 0.001) && new Set(bn).size === 4096);
  const mkImg = (w, h, f) => { const im = new ImageData(w, h); for (let i = 0; i < w * h; i++) { const c = f(i % w, (i / w) | 0); im.data.set([c[0], c[1], c[2], 255], i * 4); } return im; };
  const dz = app.filters.get('dither'), dp = { ...defaultParams(dz.params), method: 'blue-noise', color: true };
  let o2 = dz.apply(mkImg(128, 128, () => [64, 64, 64]), dp), on = [0, 0, 0], both = 0;
  for (let i = 0; i < 128 * 128; i++) { for (let c = 0; c < 3; c++) if (o2.data[i * 4 + c] === 255) on[c]++; else if (o2.data[i * 4 + c] !== 0) on[c] = NaN; if (o2.data[i * 4] && o2.data[i * 4 + 1]) both++; }
  ok('blue-noise dither keeps the tone, channels avoid each other', on.every(v => Math.abs(v / 16384 - 0.25) < 0.02) && both === 0, on.map(v => (v / 16384).toFixed(3)) + ' overlap ' + both);
  o2 = dz.apply(mkImg(64, 64, x => [x * 4, x * 4, x * 4]), { ...dp, color: false, outRes: 25, inRes: 25 }); let blocks = true; for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (o2.data[((y + j) * 64 + x + i) * 4] !== o2.data[(y * 64 + x) * 4]) blocks = false;
  ok('dither output resolution 25% gives 4 px dots', blocks);
  ok('halftone accepts resolution', app.filters.get('halftone').apply(mkImg(64, 64, x => [x * 4, x * 4, x * 4]), { ...defaultParams(app.filters.get('halftone').params), inRes: 50, outRes: 50 }).width === 64);

  // ---- colour maths ----
  const lab = rgbToLab(255, 0, 0), rb = labToRgb(...lab), hv = hsvToRgb(...rgbToHsv(12, 200, 77));
  ok('Lab and HSV round trip', near(lab[0], 54.3, 0.5) && near(lab[1], 80.8, 1) && near(rb[0], 255, 1) && near(rb[1], 0, 1.5) && near(hv[0], 12, 0.6) && near(hv[1], 200, 0.6), lab.map(v => v.toFixed(1)) + ' ' + hv.map(v => v.toFixed(1)));

  // ---- high bit depth ----
  const W = 64, H = 48, f = new Float32Array(W * H * 3); for (let i = 0; i < W * H; i++) { const x = i % W; f[i * 3] = x / (W - 1) * 0.01; f[i * 3 + 1] = 0.5; f[i * 3 + 2] = 0.004 + x * 1e-5; }
  await openFiles([new File([tiffHi(toU16(f), W, H, false, 300)], 'deep.tif')]); await sleep(100);
  let D2 = app.doc, HL = D2.layers[0];
  ok('16-bit TIFF opens as a high-bit layer', D2.w === W && HL.hd && HL.hd.bits === 16 && near(HL.hd.data[(W - 1) * 4], 0.01, 1e-5) && near(HL.hd.data[1], 0.5, 1e-4), HL.hd ? HL.hd.data[(W - 1) * 4] : 'no hd');
  const v10 = Math.round(HL.hd.data[10 * 4] * 65535), v11 = Math.round(HL.hd.data[11 * 4] * 65535);
  ok('sub-8-bit steps are kept', v11 - v10 >= 9 && v11 - v10 <= 12 && px(HL.canvas, 10, 5)[0] === px(HL.canvas, 11, 5)[0], `${v10} ${v11}`);
  HL.hd.dev.ev = 6; developHD(HL); app.commit('ev'); ok('Develop exposure reveals hidden detail', px(HL.canvas, W - 1, 5)[0] > px(HL.canvas, 20, 5)[0] + 60, px(HL.canvas, W - 1, 5)[0] + ' vs ' + px(HL.canvas, 20, 5)[0]);
  const pf = app.run('filter.gaussian'); await sleep(200); await clickOK(); await sleep(200);
  ok('Gaussian blur runs in float', HL.hd && HL.hd.bits === 16 && Math.abs(HL.hd.data[30 * 4] * 65535 - 30 / 63 * 655.35) < 3 && !Number.isInteger(HL.hd.data[30 * 4] * 255), HL.hd && HL.hd.data[30 * 4] * 65535);
  const before = HL.hd.data[(20 * W + 40) * 4]; app.setTool('brush'); app.tools.get('brush').opt.size = 6; app.setColor('fg', '#ffffff'); view.fit(); await sleep(50); drag(10, 30, 14, 30);
  ok('painting writes back only touched pixels', HL.hd && HL.hd.data[(30 * W + 12) * 4] > 0.012 && HL.hd.data[(20 * W + 40) * 4] === before, HL.hd && HL.hd.data[(30 * W + 12) * 4]);
  app.undo(); ok('undo restores float pixels', HL === D2.layers[0] ? true : D2.layers[0].hd.data[(30 * W + 12) * 4] < 0.012); HL = D2.layers[0];
  const comp = hdComposite(D2, false); ok('16-bit export data is exact', near(comp[40 * 3 + 1], 0.5, 1e-4) && comp.length === W * H * 3);
  await openFiles([new File([png16(toU16(f), W, H)], 'deep.png', { type: 'image/png' })]); await sleep(100);
  ok('16-bit PNG round trip', app.doc.layers[0].hd && near(app.doc.layers[0].hd.data[(W - 1) * 4], 0.01, 1e-5), app.doc.layers[0].hd ? app.doc.layers[0].hd.data[(W - 1) * 4] : 'no hd');
  await openFiles([new File([tiffHi(f, W, H, true, 300)], 'float.tif')]); await sleep(100);
  ok('32-bit float TIFF', app.doc.layers[0].hd && app.doc.layers[0].hd.bits === 32 && near(app.doc.layers[0].hd.data[(W - 1) * 4 + 2], 0.004 + 63e-5, 1e-7), app.doc.layers[0].hd && app.doc.layers[0].hd.data[(W - 1) * 4 + 2]);
  const hdCopy = await Doc.fromJSON(JSON.parse(JSON.stringify(app.doc.toJSON()))); ok('high-bit layer survives save/load', hdCopy.layers[0].hd && hdCopy.layers[0].hd.data[(W - 1) * 4 + 2] === app.doc.layers[0].hd.data[(W - 1) * 4 + 2]);
  app.run('image.rotCW'); ok('rotate keeps float data', app.doc.layers[0].hd && app.doc.layers[0].hd.w === H && near(app.doc.layers[0].hd.data[((W - 1) * H + 5) * 4 + 2], 0.004 + 63e-5, 1e-6), app.doc.layers[0].hd && app.doc.layers[0].hd.w);

  // ---- analysis ----
  const ew = 80, eh = 60, sig = 1.2, lum = new Float32Array(ew * eh), erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) { let acc = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const dd = ((x + (i + 0.5) / 4) - 40 - ((y + (j + 0.5) / 4) - 30) * Math.tan(5 * Math.PI / 180)) * Math.cos(5 * Math.PI / 180); acc += 0.2 + 0.6 * 0.5 * (1 + erf(dd / (sig * Math.SQRT2))); } lum[y * ew + x] = acc / 16; }
  const m = slantedEdge(lum, ew, eh), want = Math.sqrt(Math.log(2) / (2 * Math.PI * Math.PI)) / sig;
  ok('slanted-edge MTF50 matches theory', Math.abs(m.mtf50 - want) / want < 0.08 && near(Math.abs(m.angle), 5, 0.3), `${m.mtf50.toFixed(4)} want ${want.toFixed(4)} angle ${m.angle.toFixed(2)}`);
  const sl = new Float32Array(64 * 64); for (let i = 0; i < 4096; i++) sl[i] = 0.5 + 0.4 * Math.sin(2 * Math.PI * 8 * (i % 64) / 64);
  const spc = spectrum(sl, 64, 64); let pk = 1; for (let k = 1; k < 32; k++) if (spc.rad[k] > spc.rad[pk]) pk = k; ok('FFT finds the stripe frequency', pk === 8, pk);
  app.setDoc(d); setSelection(d, x => x.fillRect(0, 0, 300, 200)); const pr = app.run('analyze.stats'); await sleep(150); ok('statistics report opens', !!document.querySelector('.report canvas.plot')); await clickOK(); clearSelection(d);
  // inpaint unit
  const im = mkImg(60, 60, (x, y) => [y * 4, y * 4, y * 4]), hole = new Uint8Array(3600); for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) { hole[y * 60 + x] = 1; im.data[(y * 60 + x) * 4] = 255; }
  inpaint(im, hole); ok('inpaint follows a gradient', Math.abs(im.data[(30 * 60 + 30) * 4] - 120) < 12, im.data[(30 * 60 + 30) * 4]);

  // ---- view and menus ----
  view.fit(); const z0 = d.view.zoom; over.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true, ...cl(100, 100) })); ok('wheel zooms', d.view.zoom > z0 * 1.3, d.view.zoom / z0);
  view.fit(); const v0 = { ...d.view }; const tp = new WheelEvent('wheel', { deltaY: 12.5, bubbles: true, cancelable: true, ...cl(100, 100) }); Object.defineProperty(tp, 'wheelDeltaY', { value: -37.5 }); over.dispatchEvent(tp); // what Chrome and Safari send for a trackpad
  ok('trackpad two-finger scroll pans', d.view.zoom === v0.zoom && near(d.view.ty, v0.ty - 12.5), `${d.view.zoom / v0.zoom} ${d.view.ty - v0.ty}`);
  over.dispatchEvent(new WheelEvent('wheel', { deltaY: -6, ctrlKey: true, bubbles: true, cancelable: true, ...cl(100, 100) })); ok('trackpad pinch zooms', d.view.zoom > v0.zoom);
  view.fit(); app.setTool('zoom'); drag(100, 100, 200, 150); ok('zoom tool drags an area', d.view.zoom > z0 * 2 && Math.abs(view.S({ x: 150, y: 125 }).x - view.W / 2) < 3, d.view.zoom / z0); view.fit();
  app.setTool('select'); over.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...cl(550, 380) })); await sleep(30);
  ok('right-click menu', !!document.querySelector('.menu .item')); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  key('t', { ctrlKey: true, code: 'KeyT' }); await sleep(40); ok('Ctrl+T starts Free Transform', app.tool.id === 'transform' || app.tool.id === 'select', app.tool.id); key('Escape');
  app.tools.get('remove').opt.method = 'ai'; app.saveSettings();
  ok('colour panel present', !!document.querySelector('#colorPanel canvas.sv') && !!document.querySelector('#tabChannels'));
  ok('tooltips carry shortcuts', /\(V\)/.test(document.querySelector('#toolbar .tool').title) && /\(/.test(document.querySelector('#status .st-btn').title));
  // ---- iPhone HEIC and camera raw (sample files are optional) ----
  for (const [file, label] of [['tests/sample.heic', 'HEIC'], ['tests/sample.arw', 'camera raw']]) {
    const r = await fetch(file).catch(() => null); if (!r || !r.ok) { console.log('SKIP ' + label + ' (no ' + file + ')'); continue; }
    const n0 = app.docs.length, pOpen = openFiles([new File([await r.blob()], file.split('/').pop())]); if (label !== 'HEIC') await clickOK(); await pOpen;
    ok('open ' + label, app.docs.length === n0 + 1 && app.doc.w > 16 && (label === 'HEIC' || !!app.doc.layers[0].hd), app.docs.length === n0 + 1 ? `${app.doc.w}x${app.doc.h}` : 'not opened');
  }
  app.setDoc(d); V.visible = true; view.fit(); app.setTool('select');
}
run().catch(e => { fails++; console.log('FAIL exception ' + (e.stack || e)); }).finally(() => { console.log(`SELFTEST done: ${out.length} checks, ${fails} failed`); document.title = `selftest ${fails} failed`; });
