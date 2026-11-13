// Checks for the third round: decorative dimensions, arrowheads, gradients and templates, presets, persistence, snapping. Run with ?test3.
import { app } from '../js/app.js';
import { view } from '../js/view.js';
import { newDoc, vectorLayer, rasterLayer, flatten, dimShapes, uid, dist } from '../js/core.js';
import { toSVG, parseSVG } from '../js/io.js';
import { setSelection, clearSelection } from '../js/imaging.js';

const out = []; let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; const s = (cond ? 'PASS ' : 'FAIL ') + name + (info !== '' ? '  ' + info : ''); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const over = document.getElementById('over');
const cl = (x, y) => { const r = over.getBoundingClientRect(), p = view.S({ x, y }); return { clientX: r.left + p.x, clientY: r.top + p.y }; };
const ptr = (type, x, y, o = {}) => over.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, ...cl(x, y), ...o }));
const click = (x, y, o) => { ptr('pointermove', x, y, { buttons: 0, ...o }); ptr('pointerdown', x, y, o); ptr('pointerup', x, y, o); };
const drag = (x0, y0, x1, y1, o) => { ptr('pointermove', x0, y0, { buttons: 0, ...o }); ptr('pointerdown', x0, y0, o); for (let i = 1; i <= 8; i++) ptr('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, o); ptr('pointerup', x1, y1, o); };
const near = (a, b, e = 0.01) => Math.abs(a - b) < e;
const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
const typeIn = (inp, v) => { inp.value = v; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
const waitFor = async q => { for (let i = 0; i < 60; i++) { const e = document.querySelector(q); if (e) return e; await sleep(30); } return null; };

async function run() {
  app.settings.snap.align = false; delete app.settings.dimStyle; 
  const d = newDoc({ name: 'T3', w: 800, h: 500, dpi: 300, unit: 'mm' }); app.addDoc(d); view.fit(); await sleep(120);
  const mm = d.pxPerUnit, V = d.add(vectorLayer('V'));
  const R = { id: uid(), type: 'rect', x: 100, y: 100, w: 200, h: 120, r: 0, rot: 0, st: { stroke: '#000000', sw: 4, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: 1 } };
  const C = { id: uid(), type: 'ellipse', cx: 600, cy: 250, rx: 80, ry: 80, rot: 0, st: { stroke: '#000000', sw: 4, fill: null, alpha: 1 } };
  V.shapes.push(R, C); V.touch(); app.commit('shapes');

  // ---- decorative dimensions ----
  app.setTool('dim'); click(200, 100); click(200, 70); // click the top edge, then place
  let dm = V.shapes[V.shapes.length - 1];
  ok('clicking an edge dimensions it', dm.type === 'dim' && near(dist(dm.a, dm.b), 200) && !dm.ra && dm.lock == null && !document.querySelector('.dim-edit'), `${dm.type}`);
  app.setTool('select'); d.selShapes = new Set([R.id]); app.refresh('all'); await sleep(40);
  const hr = app.tools.get('select').handles().pts.find(q => q.u === 1 && q.v === 0.5); drag(hr.x, hr.y, hr.x + 120, hr.y);
  ok('the shape changes freely and the dimension stays', near(R.w, 320, 0.5) && near(dist(dm.a, dm.b), 200), `${R.w} ${dist(dm.a, dm.b)}`);
  app.setTool('dim'); click(600 + 56.57, 250 - 56.57); click(600, 140); dm = V.shapes[V.shapes.length - 1];
  ok('clicking a circle dimensions its diameter', dm.type === 'dim' && near(dist(dm.a, dm.b), 160, 1e-6) && near(C.rx, 80), `${dist(dm.a, dm.b)}`);
  app.setTool('select'); d.selShapes = new Set([dm.id]); app.refresh('all'); await sleep(40);
  const lab = dimShapes(dm)[3]; click(lab.x, lab.y - lab.size * 0.3); let ed = await waitFor('.dim-edit');
  ok('clicking the value of a selected dimension edits its label', !!ed); if (ed) typeIn(ed, 'Ø 13.5 mm'); await sleep(30);
  ok('custom label', dimShapes(dm)[3].text === 'Ø 13.5 mm' && near(C.rx, 80));
  ed = (app.tools.get('select').dbl({ p: { x: lab.x, y: lab.y - lab.size * 0.3 } }), await waitFor('.dim-edit')); if (ed) typeIn(ed, ''); await sleep(30);
  ok('clearing the label shows the length again', dimShapes(dm)[3].text === (160 / mm).toFixed(2) + ' mm', dimShapes(dm)[3].text);
  // arrowheads: kinds, size and width
  const A = { id: uid(), type: 'path', closed: false, nodes: [{ x: 100, y: 450 }, { x: 300, y: 450 }], st: { stroke: '#ff0000', sw: 4, fill: null, dash: 'solid', as: 'none', ae: 'arrow', hs: 1, hw: 1, alpha: 1 } };
  V.shapes.push(A); V.touch(); app.commit('arrow');
  const spread = () => { const f = flatten(d); let top = 450; while (top > 400 && (q => q[0] > 200 && q[1] < 90)(px(f, 290, top - 1))) top--; return 450 - top; };
  const w1 = spread(); A.st.hw = 2; V.touch(); const w2 = spread(); A.st.hs = 2; V.touch(); const w3 = spread();
  ok('Head width makes arrows wider and Head size bigger', w2 > w1 * 1.6 && w3 >= w2, `${w1} ${w2} ${w3}`);
  let all = true; for (const k of ['stealth', 'triangle', 'open', 'half', 'bar', 'dot', 'circle', 'square', 'diamond']) { A.st.ae = k; V.touch(); { const q = px(flatten(d), 297, 450); if (!(q[0] > 200 && q[1] < 90) && !['triangle', 'circle', 'open', 'bar'].includes(k)) all = false; } }
  ok('every arrowhead kind draws', all);
  const svgA = toSVG(d); ok('arrowheads export to SVG', /<circle[^>]*fill="#ffffff"[^>]*stroke="#ff0000"/.test(svgA) || /fill="#ff0000"/.test(svgA));
  A.st.ae = 'arrow'; A.st.hs = 1; A.st.hw = 1; V.touch();
  // persistence: change the label size of this dimension, the next one uses it
  const sizeIn = [...document.querySelectorAll('#optbar .row')].find(r => r.textContent.startsWith('Size'));
  sizeIn.querySelector('input').value = '14'; sizeIn.querySelector('input').dispatchEvent(new Event('change')); await sleep(40);
  app.setTool('dim'); click(R.x, R.y + 30); click(R.x - 30, R.y + 30); const d2 = V.shapes[V.shapes.length - 1]; await sleep(20);
  ok('dimension text size is remembered for the next one', near(d2.size, 14 * d.ptPx, 1e-6) && app.settings.dimStyle.sizePt === 14, `${d2.size / d.ptPx}`);

  // ---- gradients, shadow, templates ----
  const B = { id: uid(), type: 'rect', x: 400, y: 380, w: 300, h: 80, r: 0, rot: 0, st: { stroke: null, sw: 0, fill: { g: 'linear', angle: 0, stops: [{ o: 0, c: '#ff0000', a: 1 }, { o: 1, c: '#0000ff', a: 1 }] }, alpha: 1 } };
  V.shapes.push(B); V.touch(); app.commit('grad'); let f = flatten(d);
  const L0 = px(f, 405, 420), L1 = px(f, 695, 420);
  ok('linear gradient fill renders', L0[0] > 230 && L0[2] < 30 && L1[2] > 230 && L1[0] < 30, L0 + ' ' + L1);
  B.st.fill.g = 'radial'; V.touch(); f = flatten(d); const c0 = px(f, 550, 420), c1 = px(f, 401, 381);
  ok('radial gradient fill renders', c0[0] > 230 && c1[2] > c0[2], c0 + ' ' + c1);
  B.st.fill.g = 'linear'; B.st.shadow = { c: '#000000', a: 1, blur: 0, x: 0, y: 20 }; V.touch(); f = flatten(d);
  ok('drop shadow renders', px(f, 550, 470)[0] < 30 && px(f, 550, 490)[0] > 200, px(f, 550, 470) + '');
  const svg = toSVG(d); ok('SVG export writes gradients and shadows', /<linearGradient id="g\d+" gradientUnits="userSpaceOnUse"/.test(svg) && /feDropShadow/.test(svg) && /fill="url\(#g\d+\)"/.test(svg));
  ok('exported SVG reads back', parseSVG(svg, d.dpi).shapes.length >= 4);
  app.setTool('select'); d.selShapes = new Set([B.id]); app.refresh('all'); await sleep(60);
  const chip = [...document.querySelectorAll('.stylechip')].find(b => b.title === 'Metal'); chip.click(); await sleep(30);
  ok('style template applies a gradient and shadow', B.st.fill && B.st.fill.stops && B.st.fill.stops.length === 4 && !!B.st.shadow && B.st.stroke === '#5b6068', JSON.stringify(B.st).slice(0, 80));
  const fillBtn = [...document.querySelectorAll('#optbar .row')].find(r => r.textContent.startsWith('Fill')).querySelector('.swatch'); fillBtn.click(); await sleep(40);
  const pop = document.querySelector('.popover.colorpop'); ok('fill opens the gradient editor', !!pop && !!pop.querySelector('.gbar') && pop.querySelectorAll('.gstop').length === 4);
  pop.querySelector('.gchip[title="Ocean"]').click(); await sleep(30); ok('gradient preset applies to the shape', B.st.fill.stops[0].c === '#6dd5ed', B.st.fill.stops[0].c);
  [...pop.querySelectorAll('.ptabs2 button')].find(b => b.textContent === 'Colour').click(); await sleep(30); ok('switch back to a solid colour', typeof B.st.fill === 'string', B.st.fill);
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); d.selShapes.clear(); app.refresh('all'); await sleep(30);
  app.setTool('rect'); await sleep(150); [...document.querySelectorAll('.stylechip')].find(b => b.title === 'Ocean').click(); click(50, 300); click(150, 380);
  const nw = V.shapes[V.shapes.length - 1]; ok('a template sets the style of the next shapes', nw.type === 'rect' && nw.st.fill && nw.st.fill.stops && app.settings.style.fill.stops, JSON.stringify(nw.st.fill).slice(0, 60));
  app.settings.style = { stroke: '#000000', swPt: 1, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: 1, hs: 1 };

  // ---- snapping for pixel selections ----
  const P = d.add(rasterLayer('Img', 200, 150, 333, 77)); P.ctx.fillStyle = '#888'; P.ctx.fillRect(0, 0, 200, 150); app.commit('img');
  app.setTool('marquee'); drag(335, 79, 531, 225);
  ok('marquee snaps to the image layer corners', d.selBounds && d.selBounds.x === 333 && d.selBounds.y === 77 && d.selBounds.w === 200 && d.selBounds.h === 150, JSON.stringify(d.selBounds));
  clearSelection(d); app.commit('cl');

  // ---- New dialog presets, Print, Full screen label ----
  const pNew = app.run('file.new'); await waitFor('.dialog .presets');
  [...document.querySelectorAll('.presets button')].find(b => b.textContent.startsWith('A4')).click(); await sleep(20);
  [...document.querySelectorAll('.orient button')].find(b => b.textContent.includes('Landscape')).click(); await sleep(20);
  document.querySelector('.dialog .primary').click(); await pNew; await sleep(80);
  ok('New: A4 landscape', near(app.doc.w / app.doc.dpi * 25.4, 297, 0.2) && near(app.doc.h / app.doc.dpi * 25.4, 210, 0.2) && app.doc.layers.length === 1, `${app.doc.w}x${app.doc.h}`);
  ok('New remembers the last page', app.settings.newDoc.preset === 'A4' && app.settings.newDoc.land === true);
  const p2 = app.run('file.new'); await waitFor('.dialog .presets'); const onB = document.querySelector('.presets button.on'), land = document.querySelector('.orient button.on');
  ok('the dialog opens on the remembered choice', onB && onB.textContent.startsWith('A4') && land && land.textContent.includes('Landscape')); document.querySelector('.dialog .buttons button:not(.primary)').click(); await p2;
  ok('Print command and Full screen label', app.commands.has('file.print') && document.getElementById('fsBtn').textContent === 'Full screen' && !!document.querySelector('.tab.add'));
  app.setDoc(app.docs[0]); view.fit();
}
run().catch(e => { fails++; console.log('FAIL exception ' + (e.stack || e)); }).finally(() => { console.log(`SELFTEST done: ${out.length} checks, ${fails} failed`); document.title = `selftest ${fails} failed`; });
