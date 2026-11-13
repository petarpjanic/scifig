// Boot: register everything, wire keyboard / drag-drop / paste, restore the last session.
import { app } from './app.js';
import { view } from './view.js';
import { newDoc, vectorLayer, adjustLayer, uid } from './core.js';
import { registerImaging, defaultParams } from './imaging.js';
import { registerTools } from './tools.js';
import { registerCommands, loadUserPlugins, pasteInternal } from './commands.js';
import { initUI, dialogOpen } from './ui.js';
import { openFiles, scheduleAutosave } from './io.js';
import { initWelcome } from './welcome.js';
import { registerAnalyze } from './analyze.js';
import plugins from '../plugins/index.js';

registerImaging(); registerTools(); registerCommands(); registerAnalyze();
for (const p of plugins) p(app);
loadUserPlugins();

// A small example figure: a synthetic micrograph, annotations, a scale bar and an adjustment layer.
function sample() {
  const d = newDoc({ name: 'Sample figure', w: 1400, h: 1000, dpi: 300, unit: 'mm' }), bg = d.layers[0], x = bg.ctx;
  const g = x.createLinearGradient(0, 0, 1400, 1000); g.addColorStop(0, '#10131c'); g.addColorStop(1, '#232a3a'); x.fillStyle = g; x.fillRect(0, 0, 1400, 1000);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) { const cx = rnd() * 1400, cy = rnd() * 1000, r = 18 + rnd() * 46, rg = x.createRadialGradient(cx, cy, 0, cx, cy, r), v = 120 + rnd() * 135; rg.addColorStop(0, `rgba(${v * 0.5 | 0},${v | 0},${v * 0.6 | 0},.95)`); rg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
  bg.name = 'Micrograph'; bg.touch();
  const pt = d.ptPx, st = (o = {}) => ({ stroke: '#ffffff', sw: 1.5 * pt, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: 1, ...o });
  const V = d.add(vectorLayer('Annotations'));
  V.shapes.push({ id: uid(), type: 'ellipse', cx: 520, cy: 420, rx: 150, ry: 110, rot: 0, st: st({ stroke: '#ffd23f', dash: 'dashed' }) },
    { id: uid(), type: 'path', nodes: [{ x: 900, y: 250 }, { x: 680, y: 370 }], closed: false, st: st({ stroke: '#ffd23f', ae: 'arrow' }) },
    { id: uid(), type: 'text', x: 912, y: 246, text: 'Cluster A', size: 11 * pt, font: 'Arial', bold: true, italic: false, align: 'left', rot: 0, st: { fill: '#ffd23f', alpha: 1 } },
    { id: uid(), type: 'rect', x: 980, y: 560, w: 300, h: 220, r: 0, rot: 0, st: st() },
    { id: uid(), type: 'text', x: 990, y: 548, text: 'ROI 2 · 25 µm^{2}', size: 9 * pt, font: 'Arial', bold: false, italic: false, align: 'left', rot: 0, st: { fill: '#ffffff', alpha: 1 } },
    { id: uid(), type: 'rect', x: 1100, y: 920, w: 236, h: 14, r: 0, rot: 0, st: st({ stroke: null, sw: 0, fill: '#ffffff' }) },
    { id: uid(), type: 'text', x: 1218, y: 906, text: '20 mm', size: 9 * pt, font: 'Arial', bold: false, italic: false, align: 'center', rot: 0, st: { fill: '#ffffff', alpha: 1 } });
  V.touch();
  const A = adjustLayer('Exposure', 'exposure', defaultParams(app.adjustments.get('exposure').params)); A.params.ev = 0.6; d.layers.splice(1, 0, A);
  d.activeId = V.id; d.hist = []; d.hi = -1; d.commit('Sample'); d.dirty = false;
  return d;
}
app.registerCommand({ id: 'help.sample', title: 'Open Sample Figure', run: () => app.addDoc(sample()), desc: 'A small example document to try the tools on' });
app.menus.find(m => m[0] === 'Help')[1].push('-', 'help.sample');

initUI(); initWelcome(); view.init(); app.setTool('select');
app.on('changed', scheduleAutosave);
let fitKey = '';
app.on('docs', () => { const d = app.doc, k = d ? d.id + ':' + d.w + 'x' + d.h : ''; if (d && d.view.fit && k !== fitKey) view.fit(); fitKey = k; });

// ---------- keyboard ----------
const CODE = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Quote: "'", Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Backquote: '`' };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const combo = (e, ctrl) => { const p = []; if (ctrl) p.push('Ctrl'); else if (e.metaKey || e.ctrlKey) p.push('Mod'); if (e.shiftKey) p.push('Shift'); if (e.altKey) p.push('Alt'); p.push(CODE[e.code] || (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key)); return p.join('+'); };
const inField = e => { const t = e.target; return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
const reMove = e => { const m = view.mouse, t = app.tool; if (m && t && t.move && app.doc) { t.move({ ...m, shift: e.shiftKey, alt: e.altKey, drag: !!view.dragging }); app.refresh('render'); } };
document.addEventListener('keydown', e => {
  if (inField(e)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (dialogOpen()) return;
  const c = combo(e);
  if (c === 'Mod+K' || c === 'F1') { e.preventDefault(); app.run(c === 'F1' ? 'help.guide' : 'help.search'); return; }
  if (e.key === ' ') { e.preventDefault(); if (!view.space) { view.space = true; view.cursor(); } return; }
  if (e.key === 'Shift' || e.key === 'Alt') { reMove(e); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (app.doc && app.tool && app.tool.key && !mod && app.tool.key(e)) { e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); return; }
  // a "Ctrl+" shortcut is the Control key on a Mac (where Cmd+T and friends belong to the browser) and Ctrl elsewhere
  const cc = e.ctrlKey && !e.metaKey ? combo(e, true) : null;
  if (cc) for (const cmd of app.commands.values()) if (cmd.shortcut === cc) { e.preventDefault(); app.run(cmd.id); return; }
  if (!(isMac && cc)) for (const cmd of app.commands.values()) if (cmd.shortcut === c) { e.preventDefault(); app.run(cmd.id); return; }
  if (mod || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); app.run('edit.delete'); return; }
  if (e.key === 'x' || e.key === 'X') { const a = app.fg; app.fg = app.bg; app.setColor('bg', a); return; }
  if (e.key.length === 1) for (const t of app.tools.values()) if (t.keyb && t.keyb.toLowerCase() === e.key.toLowerCase()) { app.setTool(t.id); e.preventDefault(); return; }
});
document.addEventListener('keyup', e => {
  if (e.key === ' ') { view.space = false; view.cursor(); }
  if (e.key === 'Shift' || e.key === 'Alt') reMove(e);
});

// ---------- drag-drop and paste ----------
const vp = document.getElementById('viewport');
window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); vp.classList.add('drop'); } });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) vp.classList.remove('drop'); });
window.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); vp.classList.remove('drop'); openFiles([...e.dataTransfer.files], e.altKey); });
document.addEventListener('paste', e => {
  if (inField(e) || dialogOpen()) return;
  const imgs = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/')), cb = app.clipboard;
  e.preventDefault();
  if (cb && cb.fresh && app.doc) pasteInternal();
  else if (imgs.length) openFiles(imgs.map(f => new File([f], 'Pasted.png', { type: f.type })), !!app.doc);
  else pasteInternal();
});
window.addEventListener('blur', () => { if (app.clipboard) app.clipboard.fresh = false; view.space = false; });
window.addEventListener('beforeunload', () => scheduleAutosave());

// ---------- start ----------
const q = new URLSearchParams(location.search);
(async () => {
  // nothing opens by itself: the welcome screen offers New, Open, Recent and Restore last session
  if (q.has('sample')) app.addDoc(sample()); else app.refresh('all');
  window.scifigReady = window.figuraReady = true;
  if (q.has('test')) import('../tests/selftest.js');
  if (q.has('test2')) import('../tests/selftest2.js');
  if (q.has('test3')) import('../tests/selftest3.js');
})();
