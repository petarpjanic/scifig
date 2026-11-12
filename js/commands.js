// Menu commands, menu layout, filter/adjustment runners, plugin editor and help topics.
import { app } from './app.js';
import { view } from './view.js';
import { mk, copyCanvas, uid, newDoc, rasterLayer, vectorLayer, adjustLayer, bboxOf, shapeBBox, transformShape, convertToPath, mTranslate, mScaleAbout, unitScale, fmt, UNITS, flatten, drawShape, smoothShape, hitShape } from './core.js';
import { setSelection, clearSelection, selChanged, applyThroughSelection, coverDoc, gaussian, histogram, defaultParams, hexToRgb, refineSelection } from './imaging.js';
import { rgbToLab } from './color.js';
import { hdFilter, developHD } from './hd.js';
import { subjectMask } from './ai.js';
import { cropDoc, scaleDoc, rotateDoc, flipDoc, transformLayer, mergeDown, flattenDoc, rasterizeLayer, duplicateLayer } from './ops.js';
import { dialog, openPalette, el, popupMenu, toolPopover, paramUI } from './ui.js';
import { pickFiles, saveDoc, exportDoc, openFiles, convertFiles } from './io.js';
import { vectorTarget, curStyle, contentFill, editText } from './tools.js';

const D = () => app.doc, has = () => !!app.doc;
const hasSel = () => has() && D().selShapes.size > 0;
const clone = o => JSON.parse(JSON.stringify(o));
const C = (id, title, run, extra = {}) => app.registerCommand({ id, title, run, enabled: has, ...extra });
const activeRaster = quiet => { const L = D() && D().active; if (L && L.type === 'raster' && !L.locked) return L; if (!quiet) app.toast('Select an unlocked image layer first'); return null; };

// ---------- filters with live preview ----------
async function runFilter(f) {
  const d = D(); if (d.editMask) { app.toast('Filters change the image. Click the layer thumbnail (not the mask) in the Layers panel first.', 5000); return; }
  const L = activeRaster(); if (!L) return;
  const hd0 = L.hd, float = hd0 && f.float; // high-bit layers are filtered in float when the filter supports it
  if (hd0 && !float) app.toast(`"${f.title}" works in 8-bit: the pixels it changes lose their extra depth.`, 5000);
  const w = L.canvas.width, h = L.canvas.height, base = copyCanvas(L.canvas), orig = L.ctx.getImageData(0, 0, w, h);
  const put = c => { const x = L.ctx; x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(c, 0, 0); x.restore(); };
  const restore = () => { if (float) { L.hd = hd0; developHD(L); } else put(base); app.refresh('render'); };
  const apply = vals => {
    if (float) { L.hd = { ...hd0, dev: { ...L.hd.dev }, data: hdFilter(d, { ...L, hd: hd0 }, f, vals) }; developHD(L); app.refresh('render'); return; }
    const src = new ImageData(new Uint8ClampedArray(orig.data), w, h), out = f.apply(src, vals, { doc: d, layer: L }) || src;
    const c = mk(w, h); c.getContext('2d').putImageData(out, 0, 0);
    put(base); applyThroughSelection(d, L, c); app.refresh('render');
  };
  const FV = app.settings.filterVals || (app.settings.filterVals = {}), vals = { ...defaultParams(f.params), ...(FV[f.id] || {}) }; // last used settings
  try {
    if (f.params && f.params.length) {
      let t = null; apply(vals);
      const ok = await dialog({ title: f.title, params: f.params, values: vals, floating: true, text: f.desc, onChange: () => { clearTimeout(t); t = setTimeout(() => apply(vals), float ? 250 : 90); } });
      clearTimeout(t);
      if (!ok) { restore(); return; }
    }
    apply(vals); if (!float) L.touch(); app.commit(f.title); FV[f.id] = JSON.parse(JSON.stringify(vals)); app.saveSettings();
  } catch (e) { restore(); console.error(e); app.toast(f.title + ' failed: ' + e.message, 5000); }
}
function addAdjustment(a) {
  const d = D(), L = adjustLayer(a.title, a.id, defaultParams(a.params));
  d.add(L); d.selShapes.clear(); app.commit('Add ' + a.title);
}

// ---------- clipboard ----------
function copy(cut) {
  const d = D(), sel = d.selected();
  if (sel.length) {
    app.clipboard = { type: 'shapes', shapes: sel.map(o => clone(o.s)), fresh: true, n: 0 };
    if (cut) { for (const { s, L } of sel) { L.shapes.splice(L.shapes.indexOf(s), 1); L.touch(); } d.selShapes.clear(); app.commit('Cut'); }
    return;
  }
  const L = activeRaster(); if (!L) return;
  const b = d.selBounds && d.sel ? d.selBounds : { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height };
  const c = mk(b.w, b.h), x = c.getContext('2d'); x.drawImage(L.canvas, L.x - b.x, L.y - b.y);
  if (d.sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(d.sel, -b.x, -b.y); }
  app.clipboard = { type: 'pixels', canvas: c, x: b.x, y: b.y, fresh: true };
  try { c.toBlob(bl => navigator.clipboard && navigator.clipboard.write && navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]).catch(() => {})); } catch (e) { /* clipboard permission */ }
  if (cut && d.sel) { const cx = L.ctx; cx.save(); cx.globalCompositeOperation = 'destination-out'; cx.drawImage(d.sel, -L.x, -L.y); cx.restore(); L.touch(); app.commit('Cut'); }
  else app.toast('Copied');
}
export function pasteInternal() {
  const d = D(), cb = app.clipboard; if (!d || !cb) return false;
  if (cb.type === 'shapes') {
    const L = vectorTarget(), off = (++cb.n) * 12 / d.view.zoom, ids = new Set();
    for (const s of cb.shapes) { const c = clone(s); c.id = uid(); transformShape(c, mTranslate(off, off)); L.shapes.push(c); ids.add(c.id); }
    L.touch(); d.selShapes = ids; app.setTool('select'); app.commit('Paste');
  } else {
    const L = rasterLayer(d.uniqueName('Pasted'), cb.canvas.width, cb.canvas.height, cb.x, cb.y); L.ctx.drawImage(cb.canvas, 0, 0);
    d.add(L); app.setTool('select'); app.commit('Paste');
  }
  return true;
}
function deleteSel() {
  const d = D(), sel = d.selected();
  if (sel.length) { for (const { s, L } of sel) { L.shapes.splice(L.shapes.indexOf(s), 1); L.touch(); } d.selShapes.clear(); d.selNodes = []; app.commit('Delete'); return; }
  const L = activeRaster(true);
  if (L && d.sel) { const x = L.ctx; x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(d.sel, -L.x, -L.y); x.restore(); L.touch(); app.commit('Clear'); }
}

// ---------- object helpers ----------
function order(mode) {
  const d = D(); let any = false;
  for (const L of d.layers) { if (L.type !== 'vector') continue;
    const selIdx = L.shapes.map((s, i) => d.selShapes.has(s.id) ? i : -1).filter(i => i >= 0); if (!selIdx.length) continue; any = true;
    const pickd = selIdx.map(i => L.shapes[i]), rest = L.shapes.filter(s => !d.selShapes.has(s.id));
    if (mode === 'front') L.shapes = rest.concat(pickd); else if (mode === 'back') L.shapes = pickd.concat(rest);
    else { const at = mode === 'forward' ? Math.min(rest.length, selIdx[selIdx.length - 1] - pickd.length + 2) : Math.max(0, selIdx[0] - 1); rest.splice(at, 0, ...pickd); L.shapes = rest; }
    L.touch(); }
  if (any) app.commit('Arrange');
}
function align(mode) {
  const d = D(), sel = d.selected(); if (!sel.length) return;
  const all = sel.length > 1 ? bboxOf(sel.map(o => o.s)) : { x: 0, y: 0, w: d.w, h: d.h };
  for (const { s, L } of sel) { const b = shapeBBox(s); let dx = 0, dy = 0;
    if (mode === 'left') dx = all.x - b.x; else if (mode === 'hcenter') dx = all.x + all.w / 2 - b.x - b.w / 2; else if (mode === 'right') dx = all.x + all.w - b.x - b.w;
    else if (mode === 'top') dy = all.y - b.y; else if (mode === 'vcenter') dy = all.y + all.h / 2 - b.y - b.h / 2; else if (mode === 'bottom') dy = all.y + all.h - b.y - b.h;
    transformShape(s, mTranslate(dx, dy)); L.touch(); }
  app.commit('Align');
}
function distribute(horiz) {
  const d = D(), sel = d.selected(); if (sel.length < 3) { app.toast('Select three or more objects to distribute'); return; }
  const it = sel.map(o => ({ ...o, b: shapeBBox(o.s) })).sort((a, b) => horiz ? a.b.x - b.b.x : a.b.y - b.b.y);
  const first = it[0].b, last = it[it.length - 1].b, total = it.reduce((a, o) => a + (horiz ? o.b.w : o.b.h), 0);
  const gap = ((horiz ? last.x + last.w - first.x : last.y + last.h - first.y) - total) / (it.length - 1);
  let pos = horiz ? first.x : first.y;
  for (const o of it) { transformShape(o.s, horiz ? mTranslate(pos - o.b.x, 0) : mTranslate(0, pos - o.b.y)); pos += (horiz ? o.b.w : o.b.h) + gap; o.L.touch(); }
  app.commit('Distribute');
}
function flipSel(horiz) {
  const d = D(), sel = d.selected(); if (!sel.length) return; const b = bboxOf(sel.map(o => o.s)), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  for (const { s, L } of sel) { transformShape(s, mScaleAbout(horiz ? -1 : 1, horiz ? 1 : -1, c)); L.touch(); } app.commit('Flip');
}

// ---------- plugins ----------
const PLUGIN_TEMPLATE = `// A plugin receives the app and registers filters, adjustments, commands, tools or help.
// This one adds Filter ▸ Swap Red/Blue. Press Run to try it, Save to keep it.
app.registerFilter({
  id: 'swap-rb', title: 'Swap Red/Blue',
  params: [{ id: 'amount', label: 'Amount', type: 'range', min: 0, max: 100, default: 100 }],
  apply(img, p) {            // img is an ImageData; change img.data in place or return a new one
    const d = img.data, k = p.amount / 100;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], b = d[i + 2];
      d[i] = r + (b - r) * k; d[i + 2] = b + (r - b) * k;
    }
    return img;
  },
});
// Also available: app.registerAdjustment({id,title,params,lut(p)|apply(data,p)}),
// app.registerCommand({id,title,menu:'Plugins',shortcut:'Mod+Shift+H',run(app){}}), app.registerTool({...}),
// app.lib (gaussian, luma, colormap, ...), app.doc (layers, selection), app.commit('label').
`;
const loadPlugins = () => { try { return JSON.parse(localStorage.getItem('scifig.plugins') || localStorage.getItem('figura.plugins') || '[]'); } catch (e) { return []; } };
function runPlugin(p) { new Function('app', p.code)(app); }
export function loadUserPlugins() { for (const p of loadPlugins()) if (p.on !== false) { try { runPlugin(p); } catch (e) { console.error('Plugin ' + p.name, e); app.toast(`Plugin "${p.name}" failed: ${e.message}`, 5000); } } }
function pluginEditor() {
  const list = loadPlugins(); let cur = list[0] || null;
  const body = el('div', 'plugin-ed'), left = el('div'), names = el('div', 'list'), right = el('div', 'right'), name = el('input'), code = el('textarea'), err = el('div', 'err'), bar = el('div');
  name.type = 'text'; name.placeholder = 'Plugin name'; code.spellcheck = false; names.style.height = 'calc(100% - 34px)';
  const save = () => localStorage.setItem('scifig.plugins', JSON.stringify(list));
  const show = () => { names.innerHTML = ''; for (const p of list) { const r = el('div', p === cur ? 'sel' : '', p.name || 'Untitled'); r.onclick = () => { cur = p; show(); }; names.append(r); } name.value = cur ? cur.name : ''; code.value = cur ? cur.code : ''; code.disabled = name.disabled = !cur; };
  const add = el('button', null, '+ New plugin'); add.style.marginTop = '6px'; add.onclick = () => { cur = { name: 'My plugin ' + (list.length + 1), code: PLUGIN_TEMPLATE, on: true }; list.push(cur); show(); };
  const run = el('button', null, 'Run now'), sv = el('button', 'primary', 'Save'), del = el('button', null, 'Delete');
  const sync = () => { if (cur) { cur.name = name.value; cur.code = code.value; } };
  run.onclick = () => { sync(); if (!cur) return; try { runPlugin(cur); err.style.color = 'inherit'; err.textContent = 'Ran without errors. New filters appear in the Filter menu and in search.'; } catch (e) { err.style.color = ''; err.textContent = String(e); } };
  sv.onclick = () => { sync(); save(); err.style.color = 'inherit'; err.textContent = 'Saved in this browser. It loads automatically next time.'; show(); };
  del.onclick = () => { if (!cur) return; list.splice(list.indexOf(cur), 1); cur = list[0] || null; save(); show(); };
  code.onkeydown = e => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('  ', s, code.selectionEnd, 'end'); } };
  name.onkeydown = e => e.stopPropagation();
  bar.style.display = 'flex'; bar.style.gap = '8px'; bar.style.alignItems = 'center'; bar.append(run, sv, del, err);
  left.append(names, add); right.append(name, code, bar); body.append(left, right); show();
  dialog({ title: 'Plugins', body, ok: 'Close', noCancel: true, text: 'Plugins are small scripts stored in this browser. For permanent built-in plugins, add a file to the plugins/ folder of the site (see plugins/halftone.js).' });
}

export function registerCommands() {
  app.on('runFilter', runFilter); app.on('addAdjustment', addAdjustment);

  // ----- File -----
  // ----- New: page presets, the clipboard image size, and the last choice remembered -----
  const PRESETS = [['A4', 210, 297, 'mm'], ['A3', 297, 420, 'mm'], ['A5', 148, 210, 'mm'], ['Letter', 215.9, 279.4, 'mm'], ['Legal', 215.9, 355.6, 'mm'], ['Journal 1 col', 85, 85, 'mm'],
    ['Journal 2 col', 180, 120, 'mm'], ['Poster A0', 841, 1189, 'mm'], ['Slide 16:9', 1920, 1080, 'px'], ['Full HD', 1920, 1080, 'px'], ['4K', 3840, 2160, 'px'], ['Square', 1080, 1080, 'px']];
  C('file.new', 'New…', async () => {
    // the image on the system clipboard (or copied inside SciFig) can set the size; it is pasted only when asked
    let clip = null;
    try { if (navigator.clipboard && navigator.clipboard.read) { const items = await Promise.race([navigator.clipboard.read(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 3000))]);
      for (const it of items) { const t = it.types.find(q => q.startsWith('image/')); if (t) { clip = await createImageBitmap(await it.getType(t)); break; } } } } catch (e) { /* no permission or nothing there */ }
    if (!clip && app.clipboard && app.clipboard.type === 'pixels') clip = app.clipboard.canvas;
    const last = app.settings.newDoc || { preset: 'Journal 2 col', w: 180, h: 120, unit: 'mm', dpi: 300, bg: 'white', land: false };
    const v = { name: 'Figure ' + (app.docs.length + 1), unit: last.unit, w: last.w, h: last.h, dpi: last.dpi, bg: last.bg, paste: false };
    let preset = last.preset, land = !!last.land;
    if (clip) { preset = 'Clipboard'; v.unit = 'px'; v.w = clip.width; v.h = clip.height; land = false; }
    const body = el('div'), grid = el('div', 'presets'), orient = el('div', 'orient'), form = el('div');
    const items = [...(clip ? [['Clipboard', clip.width, clip.height, 'px']] : []), ...PRESETS];
    const sized = ([, w, h]) => land !== w > h ? [h, w] : [w, h];
    const pick = it => { preset = it[0]; const [w, h] = it[0] === 'Clipboard' ? [it[1], it[2]] : sized(it); v.w = w; v.h = h; v.unit = prevUnit = it[3]; draw(); };
    const draw = () => {
      grid.innerHTML = ''; orient.innerHTML = '';
      for (const it of items) { const b = el('button', it[0] === preset ? 'on' : ''); b.append(el('span', null, it[0]), el('small', null, `${+it[1].toFixed(1)} × ${+it[2].toFixed(1)} ${it[3]}`)); b.onclick = () => pick(it); grid.append(b); }
      for (const [o, t] of [[false, '▯ Portrait'], [true, '▭ Landscape']]) { const b = el('button', land === o ? 'on' : '', t); b.onclick = () => { if (land !== o) { land = o; [v.w, v.h] = [v.h, v.w]; draw(); } }; orient.append(b); }
      form.innerHTML = '';
      form.append(paramUI([{ id: 'name', label: 'Name', type: 'text' }, { id: 'w', label: 'Width', type: 'number', min: 0 }, { id: 'h', label: 'Height', type: 'number', min: 0 }, { id: 'unit', label: 'Units', type: 'select', options: ['mm', 'cm', 'in', 'pt', 'px'] },
        { id: 'dpi', label: 'Resolution (dpi)', type: 'number', min: 10 }, { id: 'bg', label: 'Background', type: 'select', options: ['white', 'transparent'] }, ...(clip ? [{ id: 'paste', label: 'Also paste the clipboard image', type: 'check' }] : [])],
        v, id => {
          if (id === 'w' || id === 'h') { preset = 'Custom'; grid.querySelectorAll('.on').forEach(b => b.classList.remove('on')); }
          if (id === 'unit') { const k = unitScale(prevUnit, v.dpi) / unitScale(v.unit, v.dpi); v.w = +(v.w * k).toFixed(3); v.h = +(v.h * k).toFixed(3); prevUnit = v.unit; draw(); } // same page, new unit
        }));
    };
    let prevUnit = v.unit;
    body.append(grid, orient, form); draw();
    const ok = await dialog({ title: 'New document', body, values: v, text: clip ? `Sized to the image on the clipboard (${clip.width} × ${clip.height} px). Pick another size below if you want.` : null });
    if (!ok) return;
    const k = unitScale(v.unit, v.dpi), w = Math.round(v.w * k), h = Math.round(v.h * k);
    if (!(w > 0 && h > 0) || w * h > 2e8) { app.toast('That size is not usable (too large or empty)'); return; }
    if (preset !== 'Clipboard') { app.settings.newDoc = { preset, w: v.w, h: v.h, unit: v.unit, dpi: v.dpi, bg: v.bg, land }; app.saveSettings(); }
    const nd = newDoc({ name: v.name, w, h, dpi: v.dpi, unit: v.unit === 'px' ? 'px' : v.unit, background: v.bg === 'white' ? '#ffffff' : 'transparent' });
    if (clip && v.paste) { const L = nd.add(rasterLayer('Pasted', clip.width, clip.height, Math.round((w - clip.width) / 2), Math.round((h - clip.height) / 2))); L.ctx.drawImage(clip, 0, 0); nd.hist = []; nd.hi = -1; nd.commit('New'); nd.dirty = false; }
    app.addDoc(nd);
  }, { enabled: null, shortcut: 'Alt+N', desc: 'A blank page: A4, A3, Letter, journal columns, slides and screens, portrait or landscape, or the size of the image on the clipboard', keywords: 'create document page clipboard a4 letter landscape portrait paper' });
  C('file.print', 'Print…', () => {
    const d = D(), c = flatten(d, 1, { background: '#ffffff' }), wmm = d.w / d.dpi * 25.4, hmm = d.h / d.dpi * 25.4, f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f);
    const doc = f.contentDocument; doc.open();
    doc.write(`<!doctype html><title>${d.name}</title><style>@page { size: auto; margin: 10mm; } html, body { margin: 0; } img { display: block; margin: 0 auto; width: ${wmm.toFixed(2)}mm; max-width: 100%; height: auto; }</style><img src="${c.toDataURL('image/png')}">`);
    doc.close();
    const img = doc.querySelector('img'), go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); };
    if (img.complete) setTimeout(go, 50); else img.onload = go;
  }, { shortcut: 'Mod+P', desc: 'Print the picture at its real size (shrunk only if it does not fit the paper). Choose paper, orientation or "Save as PDF" in the print window.', keywords: 'print paper pdf' });
  C('file.open', 'Open…', () => pickFiles(false), { enabled: null, shortcut: 'Mod+O', desc: 'Open PNG, JPEG, TIFF, PSD, SVG, PDF, AI, EPS or SciFig files', keywords: 'import load psd eps svg tiff pdf' });
  C('file.place', 'Place as Layers…', () => pickFiles(true), { desc: 'Import a file into the current document as new layers', keywords: 'import embed insert image' });
  C('file.save', 'Save', () => saveDoc(D(), false), { shortcut: 'Mod+S', desc: 'Save the layered document (.scifig)' });
  C('file.saveAs', 'Save As…', () => saveDoc(D(), true), { shortcut: 'Mod+Shift+S' });
  for (const [f, t, sc] of [['png', 'PNG', 'Mod+E'], ['jpg', 'JPEG'], ['tiff', 'TIFF'], ['svg', 'SVG (vector)'], ['psd', 'PSD (layers)']])
    C('export.' + f, 'Export ' + t, () => exportDoc(D(), f), { shortcut: sc, keywords: 'save download export ' + f });
  C('file.close', 'Close', async (a, doc) => { doc = doc || D(); if (doc.dirty && !(await dialog({ title: 'Close ' + doc.name + '?', text: 'This document has changes that were not saved to a file.', ok: 'Close without saving' }))) return; app.closeDoc(doc); });

  // ----- Edit -----
  C('edit.undo', 'Undo', () => app.undo(), { shortcut: 'Mod+Z' });
  C('edit.redo', 'Redo', () => app.redo(), { shortcut: 'Mod+Shift+Z' });
  C('edit.cut', 'Cut', () => copy(true), { shortcut: 'Mod+X' });
  C('edit.copy', 'Copy', () => copy(false), { shortcut: 'Mod+C' });
  C('edit.paste', 'Paste', () => { if (!pasteInternal()) app.toast('Nothing copied inside SciFig yet. Use ' + (navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V') + ' to paste an image from another app.'); }, { desc: 'Paste shapes or pixels (Cmd/Ctrl+V also pastes images from other apps)' });
  C('edit.delete', 'Delete', deleteSel, { desc: 'Delete selected shapes, or clear the selected pixels' });
  C('edit.duplicate', 'Duplicate', () => {
    const d = D(), sel = d.selected();
    if (sel.length) { const ids = new Set(), off = 12 / d.view.zoom; for (const { s, L } of sel) { const c = clone(s); c.id = uid(); transformShape(c, mTranslate(off, off)); L.shapes.push(c); ids.add(c.id); L.touch(); } d.selShapes = ids; app.commit('Duplicate'); }
    else if (d.active) { duplicateLayer(d, d.active); app.commit('Duplicate layer'); }
  }, { shortcut: 'Mod+J', desc: 'Duplicate the selected shapes, or the active layer' });
  C('edit.fill', 'Fill with Foreground Colour', () => {
    const d = D(), L = activeRaster(); if (!L) return; coverDoc(d, L);
    const c = mk(L.canvas.width, L.canvas.height), x = c.getContext('2d'); x.fillStyle = app.fg; x.fillRect(0, 0, c.width, c.height);
    applyThroughSelection(d, L, c); L.touch(); app.commit('Fill');
  }, { shortcut: 'Alt+Backspace', keywords: 'paint selection color' });
  C('edit.transformLayer', 'Transform Layer by Numbers…', async () => {
    const d = D(), L = d.active; if (!L || L.type === 'adjust') return;
    const v = await dialog({ title: 'Transform layer', params: [{ id: 'scale', label: 'Scale %', type: 'number', default: 100, min: 1 }, { id: 'rot', label: 'Rotate ° (clockwise)', type: 'number', default: 0 }] });
    if (v && (v.scale !== 100 || v.rot)) { transformLayer(d, L, v.scale / 100, v.rot); app.commit('Transform layer'); }
  }, { keywords: 'scale rotate resize layer free transform' });

  // ----- Image -----
  C('image.size', 'Image Size…', async () => {
    const d = D(), v = await dialog({ title: 'Image size', text: `Resamples everything. Now ${d.w} × ${d.h} px.`, params: [{ id: 'w', label: 'Width (px)', type: 'number', default: d.w, min: 1 }, { id: 'pct', label: 'or scale %', type: 'number', default: 100, min: 1 }] });
    if (!v) return; const k = v.pct !== 100 ? v.pct / 100 : v.w / d.w; if (k > 0 && k !== 1) { scaleDoc(d, k); d.view.fit = true; app.commit('Image size'); view.fit(); }
  }, { keywords: 'resize resample pixels' });
  C('image.canvas', 'Canvas Size…', async () => {
    const d = D(), U = x => +fmt(d.toU(x), 4), v = await dialog({ title: 'Canvas size', text: 'Changes the page without resampling. The content stays centred.', params: [{ id: 'w', label: `Width (${d.unit})`, type: 'number', default: U(d.w), min: 0 }, { id: 'h', label: `Height (${d.unit})`, type: 'number', default: U(d.h), min: 0 }] });
    if (!v) return; const w = Math.round(d.fromU(v.w)), h = Math.round(d.fromU(v.h)); if (w < 1 || h < 1) return;
    cropDoc(d, Math.round((d.w - w) / 2), Math.round((d.h - h) / 2), w, h); d.view.fit = true; app.commit('Canvas size'); view.fit();
  }, { keywords: 'page size extend artboard' });
  C('image.cropSel', 'Crop to Selection', () => { const d = D(), b = d.selBounds; if (!d.sel || !b) { app.toast('Make a pixel selection first (Marquee tool)'); return; } cropDoc(d, b.x, b.y, b.w, b.h); d.view.fit = true; app.commit('Crop'); view.fit(); });
  C('image.rotCW', 'Rotate 90° Clockwise', () => { rotateDoc(D(), true); D().view.fit = true; app.commit('Rotate'); view.fit(); });
  C('image.rotCCW', 'Rotate 90° Counter-clockwise', () => { rotateDoc(D(), false); D().view.fit = true; app.commit('Rotate'); view.fit(); });
  C('image.flipH', 'Flip Horizontal', () => { flipDoc(D(), true); app.commit('Flip'); });
  C('image.flipV', 'Flip Vertical', () => { flipDoc(D(), false); app.commit('Flip'); });
  C('image.units', 'Units and Resolution…', async () => {
    const d = D(), v = await dialog({ title: 'Units and resolution', text: 'Sets the ruler and drawing units and the print resolution. Pixels are not changed.', params: [{ id: 'unit', label: 'Units', type: 'select', options: ['px', 'mm', 'cm', 'in', 'pt'], default: UNITS[d.unit] !== undefined ? d.unit : 'mm' }, { id: 'dpi', label: 'Resolution (dpi)', type: 'number', default: d.dpi, min: 1 }] });
    if (!v) return; d.dpi = v.dpi; d.setUnit(v.unit); app.commit('Units');
  }, { keywords: 'dpi ppi mm inch ruler' });
  C('image.setScale', 'Set Scale (calibrate)…', async () => {
    const d = D(), v = await dialog({ title: 'Set scale', text: 'Calibrate real-world units, for example from a micrograph scale bar: measure it with the Measure tool (U), then enter its known length here.',
      params: [{ id: 'px', label: 'Distance (px)', type: 'number', default: +fmt(app.lastMeasure || 100, 2), min: 0 }, { id: 'known', label: 'Known length', type: 'number', default: 100, min: 0 }, { id: 'unit', label: 'Unit name', type: 'text', default: UNITS[d.unit] !== undefined ? 'µm' : d.unit }] });
    if (!v || !(v.px > 0) || !(v.known > 0)) return; d.unit = v.unit || 'unit'; d.pxPerUnit = v.px / v.known; app.commit('Set scale'); app.toast(`1 ${d.unit} = ${fmt(d.pxPerUnit, 4)} px`);
  }, { keywords: 'calibration micron scale bar microscope units imagej' });
  C('image.autoLevels', 'Auto Contrast', (a, layer) => {
    const d = D(), L = layer && layer.type === 'adjust' ? layer : null, vis = L ? L.visible : false; if (L) L.visible = false;
    const h = histogram(d).L; if (L) L.visible = vis;
    const total = h.reduce((x, y) => x + y, 0); let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += h[i]; if (acc > total * 0.002) { lo = i; break; } } acc = 0;
    for (let i = 255; i >= 0; i--) { acc += h[i]; if (acc > total * 0.002) { hi = i; break; } }
    const T = L || d.add(adjustLayer('Levels', 'levels', defaultParams(app.adjustments.get('levels').params)));
    T.params.black = Math.min(lo, 254); T.params.white = Math.max(hi, T.params.black + 1); T.touch(); app.commit('Auto contrast');
  }, { desc: 'Add a Levels layer stretched to the histogram', keywords: 'auto levels normalize stretch' });

  // ----- Layer -----
  C('layer.newRaster', 'New Image Layer', () => { const d = D(); d.add(rasterLayer(d.uniqueName('Layer'), d.w, d.h)); app.commit('New layer'); }, { keywords: 'pixel raster paint' });
  C('layer.newVector', 'New Vector Layer', () => { const d = D(); d.add(vectorLayer(d.uniqueName('Vector'))); app.commit('New vector layer'); }, { keywords: 'drawing shapes' });
  C('layer.duplicate', 'Duplicate Layer', () => { const d = D(); if (d.active) { duplicateLayer(d, d.active); app.commit('Duplicate layer'); } });
  C('layer.delete', 'Delete Layer', () => { const d = D(); if (d.active) { d.remove(d.active); app.commit('Delete layer'); } });
  C('layer.up', 'Move Layer Up', () => { const d = D(), i = d.layers.indexOf(d.active); if (i >= 0 && i < d.layers.length - 1) { d.layers.splice(i + 1, 0, d.layers.splice(i, 1)[0]); app.commit('Reorder layers'); } }, { shortcut: 'Mod+Alt+]' });
  C('layer.down', 'Move Layer Down', () => { const d = D(), i = d.layers.indexOf(d.active); if (i > 0) { d.layers.splice(i - 1, 0, d.layers.splice(i, 1)[0]); app.commit('Reorder layers'); } }, { shortcut: 'Mod+Alt+[' });
  C('layer.merge', 'Merge Down', () => { const d = D(); if (d.active && mergeDown(d, d.active)) app.commit('Merge down'); else app.toast('Nothing below to merge into'); }, { desc: 'Merge into the layer below (an adjustment layer bakes everything below it)', keywords: 'bake apply adjustment' });
  C('layer.flatten', 'Flatten Image', () => { flattenDoc(D()); app.commit('Flatten'); });
  C('layer.rasterize', 'Rasterize Layer', () => { const d = D(); if (d.active && d.active.type === 'vector') { rasterizeLayer(d, d.active); app.commit('Rasterize'); } }, { keywords: 'convert vector to pixels' });

  // ----- Select -----
  C('select.all', 'Select All', () => {
    const d = D(), L = d.active;
    if (L && L.type === 'vector') { d.selShapes = new Set(L.shapes.map(s => s.id)); app.setTool('select'); app.refresh('props', 'overlay'); }
    else { setSelection(d, x => x.fillRect(0, 0, d.w, d.h)); app.commit('Select all'); }
  }, { shortcut: 'Mod+A', desc: 'All shapes on a vector layer, or all pixels on an image layer' });
  C('select.none', 'Deselect', () => { const d = D(); d.selShapes.clear(); d.selNodes = []; if (d.sel) { clearSelection(d); app.commit('Deselect'); } else app.refresh('props', 'overlay'); }, { shortcut: 'Mod+D' });
  C('select.invert', 'Invert Selection', () => { const d = D(); if (!d.sel) return; const c = mk(d.w, d.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); x.globalCompositeOperation = 'destination-out'; x.drawImage(d.sel, 0, 0); d.sel = c; selChanged(d); app.commit('Invert selection'); }, { shortcut: 'Mod+Shift+I' });
  C('select.feather', 'Feather…', async () => { const d = D(); if (!d.sel) { app.toast('Make a pixel selection first'); return; } const v = await dialog({ title: 'Feather selection', params: [{ id: 'r', label: 'Radius (px)', type: 'number', default: 5, min: 0.5 }] }); if (!v) return;
    const x = d.sel.getContext('2d'); x.putImageData(gaussian(x.getImageData(0, 0, d.w, d.h), v.r), 0, 0); selChanged(d); app.commit('Feather'); }, { keywords: 'soften edge selection' });

  // ----- Object -----
  for (const [m, t, sc] of [['front', 'Bring to Front', 'Mod+Shift+]'], ['forward', 'Bring Forward', 'Mod+]'], ['backward', 'Send Backward', 'Mod+['], ['back', 'Send to Back', 'Mod+Shift+[']]) C('object.' + m, t, () => order(m), { shortcut: sc, enabled: hasSel, keywords: 'arrange order stack' });
  for (const [m, t] of [['left', 'Align Left'], ['hcenter', 'Align Centre (horizontal)'], ['right', 'Align Right'], ['top', 'Align Top'], ['vcenter', 'Align Middle (vertical)'], ['bottom', 'Align Bottom']]) C('align.' + m, t, () => align(m), { enabled: hasSel, desc: 'One object aligns to the page, several align to each other' });
  C('distribute.h', 'Distribute Horizontally', () => distribute(true), { enabled: hasSel, keywords: 'space evenly' });
  C('distribute.v', 'Distribute Vertically', () => distribute(false), { enabled: hasSel, keywords: 'space evenly' });
  C('object.flipH', 'Flip Selection Horizontal', () => flipSel(true), { enabled: hasSel, keywords: 'mirror' });
  C('object.flipV', 'Flip Selection Vertical', () => flipSel(false), { enabled: hasSel, keywords: 'mirror' });
  C('object.toPath', 'Convert to Path', () => { const sel = D().selected(); for (const { s, L } of sel) { convertToPath(s); L.touch(); } app.commit('Convert to path'); }, { enabled: hasSel, desc: 'Turn rectangles and ellipses into editable node paths' });
  C('object.scaleBar', 'Insert Scale Bar…', async () => {
    const d = D(), nice = (() => { const t = d.toU(d.w) / 5, p = Math.pow(10, Math.floor(Math.log10(t))); return [5, 2, 1].map(k => k * p).find(x => x <= t) || p; })();
    const v = await dialog({ title: 'Insert scale bar', text: `Uses the document scale: 1 ${d.unit} = ${fmt(d.pxPerUnit, 4)} px. Calibrate first with Image ▸ Set Scale.`, params: [{ id: 'len', label: `Length (${d.unit})`, type: 'number', default: nice, min: 0 }, { id: 'thick', label: 'Thickness (pt)', type: 'number', default: 3, min: 0.1 },
      { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' }, { id: 'label', label: 'Show label', type: 'check', default: true }, { id: 'size', label: 'Label size (pt)', type: 'number', default: 9, min: 1 }] });
    if (!v || !(v.len > 0)) return;
    const L = vectorTarget(), w = d.fromU(v.len), h = v.thick * d.ptPx, m = Math.min(d.w, d.h) * 0.04, x = d.w - m - w, y = d.h - m - h, ids = [];
    const bar = { id: uid(), type: 'rect', x, y, w, h, r: 0, rot: 0, st: { stroke: null, sw: 0, fill: v.color, dash: 'solid', as: 'none', ae: 'none', alpha: 1 } }; L.shapes.push(bar); ids.push(bar.id);
    if (v.label) { const t = { id: uid(), type: 'text', x: x + w / 2, y: y - v.size * d.ptPx * 0.45, text: `${fmt(v.len, 6)} ${d.unit}`, size: v.size * d.ptPx, font: 'Arial', bold: false, italic: false, align: 'center', rot: 0, st: { fill: v.color, alpha: 1 } }; L.shapes.push(t); ids.push(t.id); }
    L.touch(); d.selShapes = new Set(ids); app.setTool('select'); app.commit('Scale bar');
  }, { keywords: 'micron microscope calibration bar legend' });

  // ----- View -----
  C('view.zoomIn', 'Zoom In', () => view.zoomAt(1.5), { shortcut: 'Mod+=' });
  C('view.zoomOut', 'Zoom Out', () => view.zoomAt(1 / 1.5), { shortcut: 'Mod+-' });
  C('view.fit', 'Fit Page', () => view.fit(), { shortcut: 'Mod+0' });
  C('view.100', 'Actual Pixels (100%)', () => view.setZoom(1 / view.dpr), { shortcut: 'Mod+Alt+0' });
  C('view.grid', 'Show Grid', () => { app.settings.grid.show = !app.settings.grid.show; app.saveSettings(); app.refresh('render'); }, { shortcut: "Mod+'", enabled: null, checked: () => app.settings.grid.show, desc: 'Grid in document units; spacing is in the Snap settings (▾ in the status bar)' });
  C('view.snap', 'Snapping', () => { app.settings.snap.on = !app.settings.snap.on; app.saveSettings(); app.refresh('render'); }, { shortcut: 'Mod+;', enabled: null, checked: () => app.settings.snap.on, keywords: 'snap endpoint midpoint perpendicular' });
  C('view.rulers', 'Rulers', () => { app.settings.rulers = !app.settings.rulers; app.saveSettings(); document.getElementById('stage').classList.toggle('norulers', !app.settings.rulers); view.resize(); }, { enabled: null, checked: () => app.settings.rulers });
  C('view.theme', 'Light / Dark Interface', () => { app.settings.theme = app.settings.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = app.settings.theme; app.saveSettings(); app.refresh('render'); }, { enabled: null, keywords: 'appearance colour scheme' });

  // ----- transform, content-aware fill, masks, selections from layers and channels -----
  C('edit.transform', 'Free Transform', () => app.setTool('transform'), { shortcut: 'Ctrl+T', desc: 'Move, scale and rotate the layer, the selected pixels or the selected shapes with handles or exact numbers', keywords: 'scale rotate resize move handles ctrl t' });
  C('edit.contentFill', 'Content-Aware Fill', () => {
    const d = D(), L = activeRaster(); if (!L) return; if (!d.sel) { app.toast('Select the area to remove first, or paint over it with the Remove tool (J)'); return; }
    coverDoc(d, L); const m = mk(L.canvas.width, L.canvas.height); m.getContext('2d').drawImage(d.sel, -L.x, -L.y);
    app.toast('Filling…', 60000); setTimeout(async () => { try { if (await contentFill({ L, canvas: L.canvas, ctx: L.ctx, x: L.x, y: L.y, touch: () => L.touch() }, m, app.tools.get('remove').opt.method)) app.commit('Content-aware fill'); app.toast('Done', 700); } catch (e) { console.error(e); app.toast('Fill failed: ' + e.message, 5000); } }, 30);
  }, { shortcut: 'Shift+Backspace', desc: 'Make the selected area disappear by rebuilding it from its surroundings', keywords: 'magic eraser remove object inpaint heal patch delete' });
  const maskOf = (d, reveal) => { const c = mk(d.w, d.h), x = c.getContext('2d');
    if (d.sel) { if (reveal) x.drawImage(d.sel, 0, 0); else { x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); x.globalCompositeOperation = 'destination-out'; x.drawImage(d.sel, 0, 0); } }
    else if (reveal) { x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); }
    return c; };
  const addMask = reveal => { const d = D(), L = d.active; if (!L) return; if (L.mask) { app.toast('This layer already has a mask. Click it in the Layers panel to paint on it.'); d.editMask = true; app.refresh('layers', 'tool'); return; }
    L.mask = maskOf(d, reveal); L.maskOn = true; L.touchMask(); const had = !!d.sel; if (had) clearSelection(d); d.editMask = true; d.selShapes.clear(); app.commit('Add mask');
    if (!['brush', 'eraser', 'gradient', 'bucket'].includes(app.tool.id)) app.setTool('brush'); // masks are painted, so pick up the brush
    app.toast(had ? 'Mask made from the selection. Paint with white to show, black to hide.' : 'Mask added. Paint with black to hide parts of the layer, white to bring them back (X swaps).', 5000); };
  const hasMask = () => has() && !!(D().active && D().active.mask);
  C('layer.maskAdd', 'Add Mask (show all / show selection)', () => addMask(true), { desc: 'Add a layer mask: white shows the layer, black hides it. With a selection, only the selection stays visible. Works on image, vector and adjustment layers.', keywords: 'mask hide reveal clip' });
  C('layer.maskHide', 'Add Mask (hide all / hide selection)', () => addMask(false), { keywords: 'mask hide' });
  C('layer.maskDelete', 'Delete Mask', () => { const d = D(), L = d.active; L.mask = null; d.editMask = false; app.commit('Delete mask'); }, { enabled: hasMask });
  C('layer.maskInvert', 'Invert Mask', () => { const d = D(), L = d.active, c = mk(d.w, d.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); x.globalCompositeOperation = 'destination-out'; x.drawImage(L.mask, 0, 0, d.w, d.h); L.mask = c; L.touchMask(); app.commit('Invert mask'); }, { enabled: hasMask });
  C('layer.maskApply', 'Apply Mask', () => { const d = D(), L = d.active; if (L.type !== 'raster') { app.toast('Only image layers can have their mask applied (rasterize the layer first)'); return; }
    const x = L.ctx; x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(L.mask, -L.x, -L.y, d.w, d.h); x.restore(); L.mask = null; d.editMask = false; L.touch(); app.commit('Apply mask'); }, { enabled: hasMask, desc: 'Erase the hidden pixels for good and remove the mask' });
  C('layer.fromSel', 'New Layer from Selection (copy)', () => { const d = D(), L = activeRaster(); if (!L) return; if (!d.sel || !d.selBounds) { app.toast('Make a pixel selection first'); return; }
    const b = d.selBounds, N = rasterLayer(d.uniqueName('Layer'), b.w, b.h, b.x, b.y), x = N.ctx; x.drawImage(L.canvas, L.x - b.x, L.y - b.y); x.globalCompositeOperation = 'destination-in'; x.drawImage(d.sel, -b.x, -b.y); d.add(N); app.commit('Layer from selection'); }, { shortcut: 'Mod+Shift+J', keywords: 'layer via copy' });
  const loadSel = (label, paint, mode) => { const d = D(); setSelection(d, paint, mode || 'replace'); app.commit(label); if (!d.sel) app.toast('Nothing to select there'); };
  C('select.fromLayer', 'Select Layer Content', (a, L, mode) => { const d = D(); L = L || d.active; if (!L) return;
    if (L.type === 'adjust' && !L.mask) { app.toast('An adjustment layer has no pixels of its own'); return; }
    loadSel('Select layer content', x => { if (L.type === 'raster') x.drawImage(L.canvas, L.x, L.y); else if (L.type === 'vector') for (const s of L.shapes) drawShape(x, s); else x.drawImage(L.mask, 0, 0, d.w, d.h); }, mode);
  }, { desc: 'Select everything that is not transparent on the layer. Same as Cmd/Ctrl-clicking its thumbnail; Shift adds, Alt subtracts.', keywords: 'alpha transparency load selection opaque' });
  C('select.fromMask', 'Select from Mask', (a, L, mode) => { const d = D(); L = L || d.active; if (L && L.mask) loadSel('Select from mask', x => x.drawImage(L.mask, 0, 0, d.w, d.h), mode); }, { enabled: hasMask });
  C('select.fromChannel', 'Select from Channel (brightness)', (a, ch, mode) => {
    const d = D(), E = d.chan.edit; if (ch == null) ch = E && E.length === 1 ? E[0] : -1;
    const c = flatten(d), x = c.getContext('2d'), img = x.getImageData(0, 0, d.w, d.h), p = img.data, lab = d.chan.mode === 'lab';
    for (let i = 0; i < p.length; i += 4) { let v; if (ch < 0) v = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; else if (lab) { const q = rgbToLab(p[i], p[i + 1], p[i + 2]); v = ch === 0 ? q[0] * 2.55 : q[ch] + 128; } else v = p[i + ch]; p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = ch === 3 && !lab ? v : v * p[i + 3] / 255; }
    x.putImageData(img, 0, 0); loadSel('Select from channel', k => k.drawImage(c, 0, 0), mode);
  }, { desc: 'Turn the brightness of the channel chosen in the Channels panel (or the overall brightness) into a selection: bright = selected, grey = partly selected', keywords: 'luminosity mask channel load selection' });
  C('select.subject', 'Subject (AI)', async () => { const d = D(); try { const m = await subjectMask(d); if (app.doc !== d) return; const x = m.getContext('2d'), im = x.getImageData(0, 0, d.w, d.h); let any = false; for (let i = 3; i < im.data.length; i += 4) if (im.data[i] > 127) { any = true; break; }
      if (!any) { app.toast('No clear subject found'); return; } setSelection(d, c => c.drawImage(m, 0, 0)); app.commit('Select subject'); app.toast('Subject selected. Select ▸ Refine can smooth, grow or feather it.', 4000); }
    catch (e) { console.error(e); app.toast('Subject selection failed: ' + (e.message || e) + ' — the first use needs an internet connection', 8000); } },
    { desc: 'Find the main object or person automatically with a neural network that runs in your browser (first use downloads about 45 MB)', keywords: 'object person automatic background remove ai segment' });
  C('select.refine', 'Refine Selection…', async () => { const d = D(); if (!d.sel) { app.toast('Make a pixel selection first'); return; }
    const orig = copyCanvas(d.sel); let t = null; const run = v => { d.sel = copyCanvas(orig); refineSelection(d, v); app.refresh('overlay'); };
    const v = await dialog({ title: 'Refine selection', floating: true, text: 'The outline updates as you change the values.', params: [{ id: 'smooth', label: 'Smooth (px)', type: 'range', min: 0, max: 50, step: 0.5, default: 0 }, { id: 'shift', label: 'Grow / shrink (px)', type: 'range', min: -100, max: 100, default: 0 }, { id: 'feather', label: 'Feather (px)', type: 'range', min: 0, max: 100, step: 0.5, default: 0 }],
      onChange: vals => { clearTimeout(t); t = setTimeout(() => run(vals), 120); } });
    clearTimeout(t); if (!v) { d.sel = orig; selChanged(d); app.refresh('overlay'); return; } run(v); if (d.sel) app.commit('Refine selection'); else { d.sel = orig; selChanged(d); app.toast('That would leave nothing selected'); }
  }, { desc: 'Smooth the outline, grow or shrink it, and feather the edge of any selection', keywords: 'expand contract grow shrink smooth feather edge select and mask' });
  C('view.dims', 'Show Dimensions', () => { const d = D(); d.hideDims = !d.hideDims; if (d.hideDims) for (const { s } of d.selected()) if (s.type === 'dim') d.selShapes.delete(s.id); app.refresh('all'); app.emit('changed'); }, { checked: () => has() && !D().hideDims, desc: 'Show or hide every dimension. Hidden dimensions still constrain their shapes and are left out of exports.', keywords: 'dimension hide constraint annotation' });
  C('view.fullscreen', 'Full Screen', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => app.toast('The browser did not allow full screen')); }, { enabled: null, shortcut: 'Mod+Shift+F', checked: () => !!document.fullscreenElement, desc: 'Hide the browser bars and use the whole screen (Esc leaves). Installing SciFig from the browser menu (Install / Add to Dock) also gives it its own window without browser bars.', keywords: 'fullscreen maximize space' });
  C('view.panels', 'Hide Toolbar and Panels', () => { document.getElementById('main').classList.toggle('bare'); view.resize(); }, { enabled: null, shortcut: 'Mod+\\', checked: () => document.getElementById('main').classList.contains('bare'), desc: 'Leave only the picture, the menu and the options bar', keywords: 'hide panels space clean' });
  C('view.wheelZoom', 'Mouse Wheel Zooms', () => { app.settings.wheelZoom = app.settings.wheelZoom === false; app.saveSettings(); }, { enabled: null, checked: () => app.settings.wheelZoom !== false, desc: 'On: a mouse wheel zooms at the cursor (Shift + wheel scrolls). Off: the wheel scrolls and Cmd/Ctrl + wheel zooms. A trackpad always pans with two fingers and zooms with a pinch.', keywords: 'trackpad pan scroll two finger pinch' });
  C('text.localFonts', 'Add Fonts from This Computer…', async () => {
    if (!window.queryLocalFonts) { app.toast('This browser cannot list installed fonts (Chrome and Edge can). You can still type any installed font name in a saved document.', 6000); return; }
    try { const f = await window.queryLocalFonts(); app.settings.localFonts = [...new Set(f.map(q => q.family))].sort(); app.saveSettings(); app.refresh('tool'); app.toast(`${app.settings.localFonts.length} font families added to the Font list`); } catch (e) { app.toast('Font access was not allowed'); }
  }, { enabled: null, desc: 'List every font installed on this computer in the Font menu (asks for permission once)', keywords: 'typeface system fonts' });
  for (const [f, t] of [['tiff16', '16-bit TIFF'], ['tiff32', '32-bit Float TIFF'], ['png16', '16-bit PNG'], ['webp', 'WebP']]) C('export.' + f, 'Export ' + t, () => exportDoc(D(), f), { keywords: 'save download export high bit depth hdr ' + f });
  C('file.convert', 'Convert Files…', () => pickFiles(false, async files => { if (!files.length) return;
    const v = await dialog({ title: `Convert ${files.length} file${files.length > 1 ? 's' : ''}`, text: 'Each file is opened and saved in the chosen format into your downloads folder, for example iPhone HEIC photos to JPEG or camera raw to 16-bit TIFF.', params: [{ id: 'fmt', label: 'Format', type: 'select', options: [['jpg', 'JPEG'], ['png', 'PNG'], ['tiff', 'TIFF (8-bit)'], ['tiff16', 'TIFF (16-bit)'], ['tiff32', 'TIFF (32-bit float)'], ['png16', 'PNG (16-bit)'], ['webp', 'WebP'], ['psd', 'PSD']], default: 'jpg' }] });
    if (v) convertFiles(files, v.fmt); }), { enabled: null, desc: 'Batch-convert images between formats: HEIC, raw, TIFF, PNG, JPEG, WebP, PSD', keywords: 'batch heic iphone raw convert format' });
  // node editing from the right-click menu
  const nodeOp = (label, f) => () => { const d = D(), o = d.selShapes.size === 1 && d.findShape([...d.selShapes][0]); if (!o || o.s.type !== 'path' || !d.selNodes.length) return; const subs = o.s.subs ? [o.s, ...o.s.subs] : [o.s];
    for (const sn of d.selNodes) { const sp = subs[sn.sub], n = sp && sp.nodes[sn.i]; if (n) f(n, sp, sn.i); } smoothShape(o.s); o.L.touch(); app.commit(label); };
  const hasNodes = () => has() && D().selNodes.length > 0;
  C('node.corner', 'Make Corner', nodeOp('Corner node', n => { for (const k of ['a', 'ix', 'iy', 'ox', 'oy']) delete n[k]; }), { enabled: hasNodes });
  C('node.smooth', 'Make Smooth (handles)', nodeOp('Smooth node', (n, sp, i) => { const L = sp.nodes.length, a = sp.nodes[(i - 1 + L) % L], b = sp.nodes[(i + 1) % L]; delete n.a; const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; n.ix = n.x - dx; n.iy = n.y - dy; n.ox = n.x + dx; n.oy = n.y + dy; }), { enabled: hasNodes });
  C('node.auto', 'Make Spline Point (automatic)', nodeOp('Spline node', n => { n.a = 1; }), { enabled: hasNodes, desc: 'The curve passes smoothly through the point without handles to adjust' });
  C('path.toggleClose', 'Close / Open Path', () => { const d = D(); for (const { s, L } of d.selected()) if (s.type === 'path') { s.closed = !s.closed; smoothShape(s); L.touch(); } app.commit('Close/open path'); }, { enabled: hasSel });

  // right-click: what makes sense for the tool, the object under the cursor and the selection
  app.on('context', (ev, e) => {
    const d = D(), t = app.tool, x = e.clientX, y = e.clientY, items = [];
    if (['brush', 'eraser', 'stamp', 'remove'].includes(t.id)) { toolPopover(t, x, y); return; }
    const pixelTool = ['marquee', 'lasso', 'wand', 'objsel', 'bucket', 'gradient', 'crop', 'transform'].includes(t.id);
    if (!pixelTool) { // pick up the shape under the cursor
      const tol = 5 / d.view.zoom; let hit = null;
      for (let i = d.layers.length - 1; i >= 0 && !hit; i--) { const L = d.layers[i]; if (L.type !== 'vector' || !L.visible || L.locked) continue; for (let j = L.shapes.length - 1; j >= 0; j--) if (hitShape(L.shapes[j], ev.p, tol)) { hit = { s: L.shapes[j], L }; break; } }
      if (hit && !d.selShapes.has(hit.s.id)) { d.selShapes = new Set([hit.s.id]); d.selNodes = []; d.activeId = hit.L.id; app.refresh('layers', 'props', 'overlay'); }
      else if (!hit && d.selShapes.size && t.id !== 'node') { d.selShapes.clear(); app.refresh('props', 'overlay'); }
    }
    const sel = d.selected();
    if (t.id === 'node' && d.selNodes.length) items.push('node.corner', 'node.smooth', 'node.auto', { title: 'Delete Node', run: () => t.key({ key: 'Delete' }) }, '-');
    if (sel.length && !pixelTool) {
      if (sel.length === 1 && sel[0].s.type === 'text') items.push({ title: 'Edit Text', run: () => editText(sel[0].s, sel[0].L, false) });
      if (t.id !== 'node' && sel.some(o => o.s.type !== 'text' && o.s.type !== 'dim')) items.push({ title: 'Edit Nodes', run: () => app.setTool('node') });
      items.push('edit.cut', 'edit.copy', 'edit.duplicate', 'edit.delete', '-', ['Arrange', ['object.front', 'object.forward', 'object.backward', 'object.back']], ['Align', ['align.left', 'align.hcenter', 'align.right', '-', 'align.top', 'align.vcenter', 'align.bottom', '-', 'distribute.h', 'distribute.v']],
        'object.flipH', 'object.flipV', 'object.toPath', 'path.toggleClose', '-');
    } else if (d.sel) items.push('select.none', 'select.invert', 'select.refine', '-', 'edit.transform', 'edit.contentFill', 'edit.fill', 'edit.delete', '-', 'edit.copy', 'edit.cut', 'layer.fromSel', 'layer.maskAdd', 'image.cropSel', '-');
    else items.push('edit.paste', 'select.all', 'select.subject', 'edit.transform', '-');
    if (t.options && t.options.length) items.push({ title: t.title + ' Options…', run: () => toolPopover(t, x, y) });
    items.push('view.fit', 'view.100', 'view.grid', 'view.snap', '-', ['New Layer', ['layer.newRaster', 'layer.newVector', () => [...app.adjustments.keys()].map(k => 'adjust.' + k)]]);
    popupMenu(items, x, y);
  });

  // ----- Plugins / Help -----
  C('plugins.editor', 'Plugin Editor…', pluginEditor, { enabled: null, desc: 'Write your own filters, adjustments and commands in JavaScript', keywords: 'extend script custom add feature' });
  C('help.search', 'Search Tools and Help…', () => openPalette(), { shortcut: 'Mod+K', enabled: null });
  C('help.guide', 'Guide', () => openPalette('guide'), { enabled: null, shortcut: 'F1' });

  const adj = () => [...app.adjustments.keys()].map(k => 'adjust.' + k);
  app.menus = [
    ['File', ['file.new', 'file.open', 'file.place', '-', 'file.save', 'file.saveAs', 'file.print', ['Export', ['export.png', 'export.jpg', 'export.tiff', 'export.webp', 'export.svg', 'export.psd', '-', 'export.tiff16', 'export.tiff32', 'export.png16']], 'file.convert', '-', 'file.close']],
    ['Edit', ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'edit.duplicate', '-', 'edit.fill', 'edit.contentFill', '-', 'edit.transform', 'edit.transformLayer']],
    ['Image', [['Adjustments (new layer)', adj], 'image.autoLevels', '-', 'image.size', 'image.canvas', 'image.cropSel', '-', 'image.rotCW', 'image.rotCCW', 'image.flipH', 'image.flipV', '-', 'image.units', 'image.setScale']],
    ['Layer', ['layer.newRaster', 'layer.newVector', ['New Adjustment Layer', adj], 'layer.fromSel', '-', ['Mask', ['layer.maskAdd', 'layer.maskHide', '-', 'layer.maskInvert', 'layer.maskApply', 'layer.maskDelete', '-', 'select.fromMask']], '-', 'layer.duplicate', 'layer.delete', 'layer.up', 'layer.down', '-', 'layer.merge', 'layer.rasterize', 'layer.flatten', '-', 'edit.transform']],
    ['Select', ['select.all', 'select.none', 'select.invert', '-', 'select.subject', 'select.fromLayer', 'select.fromChannel', '-', 'select.refine', 'select.feather']],
    ['Filter', () => [...app.filters.keys()].map(k => 'filter.' + k)],
    ['Object', ['object.front', 'object.forward', 'object.backward', 'object.back', '-', ['Align', ['align.left', 'align.hcenter', 'align.right', '-', 'align.top', 'align.vcenter', 'align.bottom', '-', 'distribute.h', 'distribute.v']], 'object.flipH', 'object.flipV', 'object.toPath', 'path.toggleClose', '-', 'object.scaleBar', 'text.localFonts']],
    ['Analyze', ['analyze.mtf', 'analyze.profile', 'analyze.stats', 'analyze.fft']],
    ['View', ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.100', '-', 'view.fullscreen', 'view.panels', '-', 'view.rulers', 'view.grid', 'view.snap', 'view.dims', 'view.wheelZoom', '-', 'view.theme']],
    ['Plugins', () => ['plugins.editor', '-', ...[...app.commands.values()].filter(c => c.menu === 'Plugins').map(c => c.id)]],
    ['Help', ['help.search', 'help.guide']],
  ];

  const H = (title, text, keywords = '') => app.registerHelp({ title, text, keywords: keywords + ' guide' });
  H('Guide: precise drawing with typed lengths', `Pick the Line tool (N) and click a start point. Then, instead of clicking:
  5        go 5 units in the direction the cursor points
  5<30     go 5 units at 30° (counter-clockwise from the right)
  3,4      go 3 units right and 4 units up
  #10,20   go to the absolute position x=10, y=20
Press Enter to place the point. Enter again (or double-click) ends the line, C closes it into a polygon, Backspace removes the last point.
Hold Shift to lock the direction to 45° steps or to parallel/perpendicular to the previous segment, then type the length. So "right 5, then straight up 3" is: Shift toward the right, 5, Enter, Shift upward, 3, Enter, Enter.
Rectangle (R) and Ellipse (O): click once, type width,height (or one number for a square or circle), Enter.
Units are the document units (Image ▸ Units and Resolution, or Image ▸ Set Scale).`, 'cad numeric input length angle coordinates units polyline perpendicular ortho');
  H('Guide: snapping', `While drawing or moving, the cursor snaps to nearby geometry and a green marker shows what it found:
  square = endpoint or corner      triangle = midpoint      circle = centre
  cross = intersection             ⟂ = perpendicular foot from the previous point      hourglass = nearest point on an edge
Dotted green lines are alignment guides (level with another point) or the Shift angle lock.
Turn kinds on or off with the ▾ next to Snap in the status bar; ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}; toggles all snapping. The grid (Show Grid) can be snapped to as well. The page corners, edge midpoints and centre are snap points too.`, 'snap endpoint midpoint center intersection perpendicular nearest align grid guides');
  H('Guide: units, scale calibration and scale bars', `Rulers, the cursor readout, typed lengths and sizes all use the document units.
• Switch between px, mm, cm, in and pt with the unit menu in the status bar (or Image ▸ Units and Resolution for the dpi).
• Real-world units for a micrograph: measure a known feature with the Measure tool (U), then Image ▸ Set Scale and type its true length and unit (for example 50 µm).
• Object ▸ Insert Scale Bar draws a bar of an exact length with a label.
Stroke widths and font sizes are always in points.`, 'mm micron dpi calibrate ruler measure scale bar');
  H('Guide: layers, adjustments and filters', `A document is a stack of layers: image layers (pixels), vector layers (shapes and text) and adjustment layers.
• Adjustment layers (Image ▸ Adjustments or ＋ in the Layers panel) change everything below them without destroying pixels: Exposure, Levels, Curves, Tone Mapping, White Balance, Hue/Saturation, False Colour and more. Select the layer to edit its settings in Properties; hide or delete it to undo the effect.
• Filters (Filter menu) change the pixels of the active image layer, inside the selection if there is one: blur, sharpen, median, halftone, dither, edges…
• Blend mode and opacity are at the top of the Layers panel. Drag layers to reorder.`, 'layer adjustment filter exposure levels curves tone mapping blend non-destructive');
  H('Guide: selecting and editing pixels', `Marquee (M), Lasso (L) and Magic Wand (W) select pixels; Shift adds, Alt subtracts. Brush, Eraser, Fill, Gradient and filters then only affect the selection.
Copy/Cut/Paste make a new layer from the selection; move it with the Select tool (V). Select ▸ Feather softens the edge. Delete clears the selected pixels. Image ▸ Crop to Selection or the Crop tool (C) trims the page.`, 'selection marquee lasso wand copy paste crop feather');
  H('Guide: editing vector shapes', `Select tool (V): click shapes (Shift adds), drag to move with snapping, drag the square handles to scale (Shift keeps proportions, Alt scales about the centre), drag the round knob to rotate (Shift = 15° steps). Arrow keys nudge. Alt-drag makes a copy.
Edit Nodes (A): drag nodes and curve handles, double-click an edge to add a node, Alt-click a node to switch corner/smooth, Delete removes nodes. Rectangles and ellipses turn into paths when you edit their nodes.
The bar under the menu: exact position and size in units, stroke, fill, dashes, arrowheads, opacity. Object menu: stacking order, align, distribute, flip.`, 'vector node bezier handles arrow stroke fill align distribute');
  H('Guide: text, superscripts and subscripts', `Text tool (T): click and type; Cmd/Ctrl+Enter or clicking elsewhere finishes. Double-click text with the Select tool to edit it again.
Write ^{2} for a superscript and _{2} for a subscript, for example  H_{2}O,  10^{-3} m s^{-1}.  Greek letters and symbols can be typed or pasted directly (µ, α, β, °, ±, Å).
Font, size (pt), alignment and colour are in the bar under the menu. The Font list has system fonts and web fonts; Object ▸ Add Fonts from This Computer lists every installed font.`, 'label font greek superscript subscript');
  H('Guide: file formats', `Open (or drag in, or paste): PNG, JPEG, WebP, GIF, BMP, TIFF (multi-page; 16 and 32-bit keep their depth), 16-bit PNG, iPhone HEIC/HEIF, camera raw (DNG, CR2, CR3, NEF, ARW, RAF…), PSD/PSB with layers, SVG as editable vectors, PDF and Illustrator .ai (rasterised at the dpi you choose), EPS/PS (rasterised by Ghostscript in the browser), and SciFig documents.
File ▸ Place as Layers adds a file to the current document.
Save writes a .scifig file with all layers editable. Export writes PNG, JPEG, TIFF, WebP, SVG (shapes stay vector), PSD (layers), and 16-bit or 32-bit TIFF and 16-bit PNG. File ▸ Convert Files converts many files at once.
Work is also autosaved in this browser and restored when you come back, but only on this device, so save a file to move between computers.`, 'psd eps svg pdf ai tiff import export save open autosave');
  H('Guide: adding your own features (plugins)', `Everything in the menus is registered through a small API, so new features plug in the same way:
• Plugins ▸ Plugin Editor: write a script in the browser, Run to try, Save to keep it on this device.
• Permanent: add a file in the site's plugins/ folder and list it in plugins/index.js (plugins/halftone.js is a complete example).
A plugin can call app.registerFilter, app.registerAdjustment, app.registerCommand, app.registerTool and app.registerHelp. New entries show up in the menus and in this search automatically.`, 'extend script api custom halftone developer');
  H('Guide: keyboard shortcuts', `Tools: V select, A nodes, F free transform, N line, Y spline, P pen, R rectangle, O ellipse, T text, K dimension, U measure, M marquee, L lasso, W wand, Q object select, C crop, B brush, E eraser, S clone stamp, J remove, G bucket, D gradient, I eyedropper, H hand, Z zoom.
Space-drag or two fingers on a trackpad pan, pinch or the mouse wheel zooms, X swaps colours, [ ] brush size, Ctrl+T free transform, Tab moves between value boxes while drawing.
Every menu command shows its shortcut; this search (Cmd/Ctrl+K or F1) finds anything by name.`, 'keys hotkeys shortcut');
  H('Guide: value boxes while drawing (length, angle, Tab)', `While you draw a line, spline, rectangle or ellipse, boxes next to the cursor show the length and angle (or width and height).
Type a number: it goes into the highlighted box and locks that value. Press Tab to move to the next box and type again. Enter places the point; clicking does too, using the locked values.
A number can carry its own unit: 5mm, 0.25in, 40px, 12pt. Without one it is in the document units (the unit menu in the status bar).
With shapes selected in the Select tool, just start typing to move (ΔX, ΔY), resize (W, H) or rotate (∠) by exact amounts. With a node selected in the Edit Nodes tool, type its X and Y.
The bar under the menu also has X, Y, W, H, rotation, and for a single line its length and angle.`, 'hud numeric input tab typed values transform exact');
  H('Guide: the options bar and the right-click menu', `The bar under the menu changes with what you are doing: first the options of the tool, then the properties of the selected object (line colour, width, fill, dashes, arrowheads, font…) or of the next shape you will draw.
Right-click in the picture for a menu that fits the tool, the object under the cursor and the selection. With a brush, eraser or stamp it opens the size and hardness sliders.
Hover over any button to see its name and keyboard shortcut.`, 'context menu properties toolbar tooltip');
  H('Guide: arrows, dashes, dots, dimensions and splines', `Style templates in the side panel give one-click looks (outline, card, metal, glass, gradients, glow, highlight). Fill and Stroke open a picker with Colour, Gradient (presets, linear or radial, angle, editable stops) and None, and Drop shadow adds a soft shadow. Line style is in the side panel: solid, dashed, dotted (round dots) or dash-dot, with Dash and Gap lengths in line widths, so a smaller Gap gives a denser line. Start and End add arrowheads or markers: arrow, open arrow, bar, dot, circle, square, diamond; Head % sets their size.
Dimension tool (K) works like a Fusion 360 sketch dimension. Click a line, an edge of a rectangle or a circle (or click two points), then click where the dimension should sit and type the value: the shape changes to match. Dimensions are driving by default, so the shape keeps that length when you drag it; untick "Driving" in the side panel for a reference dimension that only shows the length and follows the shape. Double-click a value (or click the value of a selected dimension) to change it later; a unit can be typed (25mm, 1in). Locked values are bold.
"Show in export" off makes a dimension a working constraint only; View ▸ Show Dimensions hides them all. Text size, font, arrows and decimals are in the side panel and are remembered for the next dimensions.
Spline tool (Y): click points and a smooth curve passes through them. In Edit Nodes (A) the round nodes are spline points; drag them and the curve follows. Drag a handle, or right-click a node, to turn it into an ordinary smooth or corner point. Smooth sets how round the spline is. The Pen (P) draws bezier curves with handles directly.`, 'arrow dash dot dimension spline bezier marker');
  H('Guide: layer masks', `A mask hides parts of a layer without erasing them. It works on image, vector and adjustment layers.
Add one with ◐ in the Layers panel (with a selection active, only the selection stays visible). A second thumbnail appears: click it and paint with black to hide, white to show (X swaps the colours); gradients and the bucket work too. Click the first thumbnail to paint on the picture again.
Shift-click the mask to switch it off and on. Cmd/Ctrl-click it to load it as a selection. Layer ▸ Mask has Invert, Apply and Delete.
Cmd/Ctrl-click a layer's own thumbnail to select everything that is not transparent on it.`, 'mask hide reveal alpha layer thumbnail');
  H('Guide: channels (RGB, Alpha, Lab)', `The Channels tab next to Layers lists Red, Green, Blue and Alpha, or Lightness, a and b in Lab mode.
Click a channel: it is shown in grey, and brush, eraser, stamp, fills and filters change only that channel of image layers (Shift-click selects several). Click the top row to go back to all channels. So you can blur only the blue channel, or sharpen only Lightness.
◌ (or Cmd/Ctrl-click) loads a channel as a selection: bright areas are selected. Curves can also work on Red, Green, Blue or the Lab channels, with the histogram behind the curve.`, 'channel red green blue alpha lab lightness luminosity');
  H('Guide: moving and transforming pixels', `Make a selection, then with the Select tool (V) drag: the selected pixels are cut out and moved (Alt-drag moves a copy); arrow keys nudge. With the Marquee tool, dragging inside a selection moves only its outline.
Free Transform (Ctrl+T, key F, or the third button of the toolbar) puts handles around the layer or the selected pixels: drag inside to move, handles to scale, outside to rotate, or type exact values in the bar. Enter applies, Esc cancels. For shapes the Select tool has the same handles.
The Remove tool (J) deletes what you paint over and fills it from the surroundings; Edit ▸ Content-Aware Fill does the same for a selection. The Clone Stamp (S) copies from an Alt-clicked point.`, 'move selection cut transform stamp clone remove heal magic eraser');
  H('Guide: automatic selections', `Select ▸ Subject finds the main object or person. The Object Select tool (Q) selects the object you click on; Shift adds, Alt subtracts.
Both run a neural network inside your browser: nothing is uploaded, but the first use downloads the model (15–45 MB) and it takes a few seconds per picture.
Select ▸ Refine then smooths the outline, grows or shrinks it and feathers the edge, with a live preview. Any selection can become a layer mask (◐).`, 'ai object subject person select refine feather');
  H('Guide: high bit depth, camera raw and iPhone photos', `16-bit and 32-bit TIFF, 16-bit PNG and camera raw files (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 and more) open as high-bit layers: the pixels stay in 32-bit float. The Properties panel then shows Develop: exposure, black and white point, gamma, white balance and tone mapping, all computed from the full-precision data.
Blur, sharpen, median, noise, pixelate, edges and grayscale, plus resize, rotate, flip and Free Transform, work on the float data. Painting tools write back only the pixels they touch. Adjustment layers and blending with other layers happen on the 8-bit display.
File ▸ Export ▸ 16-bit TIFF, 32-bit Float TIFF or 16-bit PNG writes the full precision. Merging or flattening makes an 8-bit layer.
iPhone HEIC/HEIF photos open directly. File ▸ Convert Files turns any set of files into JPEG, PNG, TIFF, WebP or PSD in one go.`, 'raw dng heic iphone 16-bit 32-bit float hdr develop convert');
  H('Guide: measuring image quality (Analyze menu)', `Sharpness (Slanted-Edge MTF): photograph a straight, slightly tilted edge (about 5°), drag a Marquee rectangle across it, and run the command. You get the edge profile, the MTF curve, MTF50 and MTF10 in cycles/pixel (and per unit if the scale is calibrated) and the 10–90% rise.
Line Profile plots the values along the last Measure-tool line. Statistics and Noise gives mean, standard deviation and signal-to-noise of the selected patch with its histogram. Fourier Spectrum shows the 2-D FFT and the radially averaged power.
Every report has Copy data (CSV). High-bit layers are measured at full precision.`, 'mtf sharpness sfr snr noise fft profile analysis');
}
