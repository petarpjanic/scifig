// Scripted checks, run with index.html?sample&test — results go to the console and to document.title.
import { app } from '../js/app.js';
import { view } from '../js/view.js';
import { Doc, flatten } from '../js/core.js';
import { openFiles, toSVG, parseSVG } from '../js/io.js';

const out = []; let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; const s = (cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const over = document.getElementById('over');
const cl = (x, y) => { const r = over.getBoundingClientRect(), p = view.S({ x, y }); return { clientX: r.left + p.x, clientY: r.top + p.y }; };
const ptr = (type, x, y, o = {}) => over.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, ...cl(x, y), ...o }));
const click = (x, y, o) => { ptr('pointermove', x, y, { buttons: 0, ...o }); ptr('pointerdown', x, y, o); ptr('pointerup', x, y, o); };
const drag = (x0, y0, x1, y1, o) => { ptr('pointermove', x0, y0, { buttons: 0, ...o }); ptr('pointerdown', x0, y0, o); for (let i = 1; i <= 6; i++) ptr('pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, o); ptr('pointerup', x1, y1, o); };
const CODES = { '<': 'Comma', ',': 'Comma', '.': 'Period', '-': 'Minus', '#': 'Digit3' };
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: o.code || (/^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : CODES[k] || k), bubbles: true, cancelable: true, ...o }));
const type = s => { for (const ch of s) key(ch); };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
const clickOK = async () => { for (let i = 0; i < 100; i++) { const b = document.querySelector('.dialog .primary'); if (b) { b.click(); return true; } await sleep(50); } return false; };

async function run() {
  const d = app.doc, mm = d.pxPerUnit, V = d.layers.find(l => l.name === 'Annotations'), n0 = V.shapes.length;

  // CAD typed input: right 5 mm, then up 3 mm with Shift lock
  app.setTool('line');
  click(100, 800);
  ptr('pointermove', 160, 803, { buttons: 0, shiftKey: true }); type('5'); key('Enter');
  ptr('pointermove', 100 + 5 * mm + 2, 700, { buttons: 0, shiftKey: true }); type('3'); key('Enter'); key('Enter');
  let s = V.shapes[V.shapes.length - 1];
  ok('typed polyline made', V.shapes.length === n0 + 1 && s.type === 'path' && s.nodes.length === 3);
  ok('typed length right 5', near(s.nodes[1].x, 100 + 5 * mm) && near(s.nodes[1].y, 800), JSON.stringify(s.nodes[1]));
  ok('typed length up 3 (perpendicular)', near(s.nodes[2].x, 100 + 5 * mm) && near(s.nodes[2].y, 800 - 3 * mm), JSON.stringify(s.nodes[2]));

  // polar and relative input
  click(300, 900); ptr('pointermove', 340, 890, { buttons: 0 }); type('10<90'); key('Enter'); type('4,-2'); key('Enter'); key('Enter');
  s = V.shapes[V.shapes.length - 1];
  const q0 = s.nodes[0]; // the first click may snap to an alignment guide, so measure from where it landed
  ok('polar 10<90', near(s.nodes[1].x, q0.x) && near(s.nodes[1].y, q0.y - 10 * mm), JSON.stringify(s.nodes[1]));
  ok('relative 4,-2', near(s.nodes[2].x, q0.x + 4 * mm) && near(s.nodes[2].y, q0.y - 8 * mm), JSON.stringify(s.nodes[2]));

  // endpoint snap: start a line near the corner of the ROI rectangle (980,560)
  click(984, 563); click(700, 700);
  ptr('pointermove', 702, 702, { buttons: 0 }); key('Enter');
  s = V.shapes[V.shapes.length - 1];
  ok('endpoint snap', near(s.nodes[0].x, 980) && near(s.nodes[0].y, 560), JSON.stringify(s.nodes[0]));
  // perpendicular snap onto the bottom edge of the ROI rect (y=780) from a point above it
  click(1100, 650); ptr('pointermove', 1103, 778, { buttons: 0 });
  ok('perpendicular marker', view.snapMark && view.snapMark.kind === 'perp', view.snapMark && view.snapMark.kind);
  click(1103, 778); key('Enter');
  s = V.shapes[V.shapes.length - 1];
  ok('perpendicular foot', near(s.nodes[1].x, 1100) && near(s.nodes[1].y, 780), JSON.stringify(s.nodes[1]));
  // midpoint snap on the top edge of the ROI rect: (1130,560)
  click(1132, 563); click(1200, 400); key('Enter');
  s = V.shapes[V.shapes.length - 1];
  ok('midpoint snap', near(s.nodes[0].x, 1130) && near(s.nodes[0].y, 560), JSON.stringify(s.nodes[0]));

  // rectangle with typed size
  app.setTool('rect'); click(150, 150); ptr('pointermove', 200, 190, { buttons: 0 }); type('20,10'); key('Enter');
  s = V.shapes[V.shapes.length - 1];
  ok('typed rectangle 20x10', s.type === 'rect' && near(s.w, 20 * mm) && near(s.h, 10 * mm) && near(s.x, 150), `${s.w} ${s.h}`);
  app.settings.snap.on = false; app.setTool('ellipse'); drag(400, 700, 500, 760); app.settings.snap.on = true;
  s = V.shapes[V.shapes.length - 1];
  ok('ellipse by drag', s.type === 'ellipse' && near(s.rx, 50) && near(s.ry, 30));

  // select, move, undo, redo
  app.setTool('select'); app.settings.snap.on = false;
  const r = V.shapes.find(q => q.type === 'rect' && near(q.w, 20 * mm)), x0 = r.x;
  drag(150 + 10, 150, 150 + 60, 150 + 40);
  let r2 = app.doc.findShape(r.id).s;
  ok('move shape', near(r2.x, x0 + 50) && near(r2.y, 190), `${r2.x},${r2.y}`);
  app.undo(); ok('undo move', near(app.doc.findShape(r.id).s.x, x0));
  app.redo(); ok('redo move', near(app.doc.findShape(r.id).s.x, x0 + 50));
  // scale by the bottom-right handle
  r2 = app.doc.findShape(r.id).s; const w0 = r2.w;
  drag(r2.x + r2.w, r2.y + r2.h, r2.x + r2.w + 40, r2.y + r2.h + 20);
  r2 = app.doc.findShape(r.id).s;
  ok('scale by handle', near(r2.w, w0 + 40, 0.5), `${r2.w} vs ${w0 + 40}`);
  // node tool converts and moves a node
  app.setTool('node'); click(r2.x + 5, r2.y); r2 = app.doc.findShape(r.id).s;
  ok('node tool converts rect to path', r2.type === 'path' && r2.nodes.length === 4);
  drag(r2.nodes[0].x, r2.nodes[0].y, r2.nodes[0].x - 30, r2.nodes[0].y - 20); const r3 = app.doc.findShape(r.id).s;
  ok('drag node', near(r3.nodes[0].x, r2.nodes[0].x - 30 + 0, 0.5) || near(r3.nodes[0].x, x0 + 20, 0.5), `${r3.nodes[0].x}`);
  app.settings.snap.on = true;

  // painting on the image layer, selection clipping, undo
  const M = app.doc.layers.find(l => l.name === 'Micrograph'); app.doc.activeId = M.id; app.doc.selShapes.clear();
  app.setColor('fg', '#ff0000'); app.setTool('brush'); app.tool.opt.size = 20; app.tool.opt.hardness = 100; app.tool.opt.opacity = 100;
  drag(100, 100, 300, 100);
  let ML = app.doc.layer(M.id);
  ok('brush paints', px(ML.canvas, 200, 100)[0] === 255 && px(ML.canvas, 200, 100)[1] === 0, px(ML.canvas, 200, 100).join());
  app.undo(); ML = app.doc.layer(M.id); ok('undo brush', px(ML.canvas, 200, 100)[1] !== 0); app.doc.activeId = M.id;
  app.setTool('marquee'); drag(50, 50, 150, 150);
  ok('marquee selection', !!app.doc.sel && app.doc.selBounds && app.doc.selBounds.w === 100, JSON.stringify(app.doc.selBounds));
  app.doc.activeId = M.id; app.setTool('brush'); drag(100, 100, 300, 100); ML = app.doc.layer(M.id);
  ok('brush clipped to selection', px(ML.canvas, 120, 100)[0] === 255 && px(ML.canvas, 120, 100)[1] === 0 && !(px(ML.canvas, 220, 100)[0] === 255 && px(ML.canvas, 220, 100)[1] === 0));
  app.run('filter.grayscale'); ML = app.doc.layer(M.id);
  const g = px(ML.canvas, 60, 60); ok('filter inside selection', g[0] === g[1] && g[1] === g[2], g.join());
  const o = px(ML.canvas, 322, 372); ok('filter leaves outside alone', !(o[0] === o[1] && o[1] === o[2]), o.join());
  app.setTool('wand'); click(120, 100); ok('magic wand', !!app.doc.sel && app.doc.selBounds.h <= 40, JSON.stringify(app.doc.selBounds));
  app.run('select.none'); ok('deselect', !app.doc.sel);

  // halftone plugin and other filters run
  for (const id of ['halftone', 'gaussian', 'unsharp', 'dither', 'edges']) {
    const f = app.filters.get(id), img = new ImageData(64, 64); for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i + 1] = img.data[i + 2] = (i / 4 % 64) * 4; img.data[i + 3] = 255; }
    const p = {}; for (const q of f.params) p[q.id] = q.default; const res = f.apply(img, p) || img;
    let lo = 0, hi = 0; for (let i = 0; i < res.data.length; i += 4) { if (res.data[i] < 40) lo++; if (res.data[i] > 215) hi++; }
    ok('filter ' + id, res.width === 64 && (id !== 'halftone' || (lo > 800 && hi > 800)), `dark ${lo} light ${hi}`);
  }
  // adjustments
  for (const a of app.adjustments.values()) { const p = {}; for (const q of a.params) p[q.id] = JSON.parse(JSON.stringify(q.default)); const dd = new Uint8ClampedArray([10, 100, 200, 255, 250, 128, 0, 255]); try { if (a.lut) a.lut(p); else a.apply(dd, p); ok('adjust ' + a.id, true); } catch (e) { ok('adjust ' + a.id, false, e.message); } }
  app.run('adjust.falsecolor'); ok('adjustment layer added', app.doc.active.type === 'adjust' && app.doc.active.adj === 'falsecolor');
  const flat = flatten(app.doc); ok('flatten renders', flat.width === 1400); app.undo();

  // round trips
  const svg = toSVG(app.doc), back = parseSVG(svg, app.doc.dpi), nShapes = app.doc.layers.filter(l => l.type === 'vector').reduce((a, l) => a + l.shapes.length, 0);
  ok('SVG export/import keeps shapes', back.shapes.length >= nShapes && Math.round(back.w) === 1400, `${back.shapes.length} vs ${nShapes}, w ${back.w}`);
  const e0 = app.doc.layers.find(l => l.type === 'vector').shapes.find(q => q.type === 'ellipse'), e1 = back.shapes.find(q => q.type === 'ellipse');
  ok('SVG geometry preserved', e1 && near(e1.cx, e0.cx, 0.05) && near(e1.rx, e0.rx, 0.05), e1 && `${e1.cx} ${e0.cx}`);
  const copy = await Doc.fromJSON(JSON.parse(JSON.stringify(app.doc.toJSON())));
  ok('native save/load', copy.layers.length === app.doc.layers.length && copy.w === 1400);
  const before = app.docs.length;
  await openFiles([new File([svg], 'round.svg', { type: 'image/svg+xml' })]);
  ok('open SVG as document', app.docs.length === before + 1 && app.doc.layers.some(l => l.type === 'vector'));
  // PSD
  await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/ag-psd.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  const c1 = document.createElement('canvas'); c1.width = 80; c1.height = 60; c1.getContext('2d').fillStyle = '#00f'; c1.getContext('2d').fillRect(0, 0, 80, 60);
  const psd = agPsd.writePsd({ width: 200, height: 100, children: [{ name: 'Blue', canvas: c1, left: 20, top: 10, opacity: 0.5, blendMode: 'multiply' }, { name: 'G', children: [{ name: 'Inner', canvas: c1, left: 0, top: 0, hidden: true }] }] });
  await openFiles([new File([psd], 'test.psd')]);
  let L = app.doc.layers;
  ok('open PSD layers', app.doc.w === 200 && L.length === 2 && L[0].name === 'Blue' && L[0].x === 20 && near(L[0].opacity, 0.5, 0.01) && L[0].blend === 'multiply' && L[1].visible === false, L.map(l => l.name + ':' + l.opacity + ':' + l.blend + ':' + l.visible).join(' '));
  // TIFF
  const tif = UTIF.encodeImage(new Uint8Array(c1.getContext('2d').getImageData(0, 0, 80, 60).data.buffer), 80, 60);
  await openFiles([new File([tif], 'test.tif')]); ok('open TIFF', app.doc.w === 80 && px(app.doc.layers[0].canvas, 5, 5)[2] === 255);
  // EPS through Ghostscript
  if (!location.search.includes('noeps')) {
    const eps = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n1 0 0 setrgbcolor 0 0 50 50 rectfill\n0 0 1 setrgbcolor 50 0 50 50 rectfill\nshowpage\n%%EOF\n';
    const pEps = openFiles([new File([eps], 'test.eps')]); await clickOK(); await pEps;
    const E = app.doc; ok('open EPS', E.name === 'test' && E.w > 400 && px(E.layers[0].canvas, 50, 100)[0] > 200 && px(E.layers[0].canvas, E.w - 50, 100)[2] > 200, `${E.name} ${E.w}x${E.h} ${px(E.layers[0].canvas, 50, 100)}`);
    // minimal PDF
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 50] /Contents 4 0 R >>'];
    const stream = '0 1 0 rg 0 0 100 50 re f'; objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    let pdf = '%PDF-1.4\n'; const offs = []; objs.forEach((b, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const pPdf = openFiles([new File([pdf], 'test.pdf')]); await clickOK(); await pPdf;
    const Pd = app.doc; ok('open PDF', Pd.name === 'test' && Pd.w > 400 && px(Pd.layers[0].canvas, 50, 100)[1] > 200 && px(Pd.layers[0].canvas, 50, 100)[0] < 50, `${Pd.w}x${Pd.h} ${px(Pd.layers[0].canvas, 50, 100)}`);
  }
  app.setDoc(app.docs[0]); view.fit(); app.setTool('select');
}
run().catch(e => { fails++; console.log('FAIL exception ' + (e.stack || e)); }).finally(() => { console.log(`SELFTEST done: ${out.length} checks, ${fails} failed`); document.title = `selftest ${fails} failed`; });
