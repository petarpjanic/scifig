// Printing: paper, orientation, scale (real size, fit or %), margins, position, what to print, with a preview.
import { app } from './app.js';
import { mk, flatten, fmt, setExporting } from './core.js';
import { dialog, paramUI, el } from './ui.js';

const PAPER = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };

function layout(d, o, pic) {
  let [pw, ph] = PAPER[o.paper] || PAPER.A4;
  const iw = pic.width / d.dpi * 25.4, ih = pic.height / d.dpi * 25.4; // real size of the picture in mm
  if (o.orient === 'landscape' || (o.orient === 'auto' && iw > ih)) [pw, ph] = [Math.max(pw, ph), Math.min(pw, ph)]; else [pw, ph] = [Math.min(pw, ph), Math.max(pw, ph)];
  const aw = Math.max(1, pw - 2 * o.margin), ah = Math.max(1, ph - 2 * o.margin);
  const k = o.scale === 'fit' ? Math.min(aw / iw, ah / ih) : o.scale === 'percent' ? o.pct / 100 : 1;
  const w = iw * k, h = ih * k, x = o.center ? (pw - w) / 2 : o.margin, y = o.center ? (ph - h) / 2 : o.margin;
  return { pw, ph, w, h, x, y, k, clipped: w > aw + 0.01 || h > ah + 0.01 };
}
// The picture to print: the whole page or the selected area, with "export" visibility (hidden working dimensions left out).
function picture(d, what) {
  setExporting(true);
  try {
    const c = flatten(d, 1, { background: '#ffffff' });
    if (what !== 'selection' || !d.sel || !d.selBounds) return c;
    const b = d.selBounds, o = mk(b.w, b.h); o.getContext('2d').drawImage(c, -b.x, -b.y); return o;
  } finally { setExporting(false); }
}

export async function printDoc(d) {
  const S = app.settings, o = { paper: 'A4', orient: 'auto', scale: 'actual', pct: 100, margin: 10, center: true, what: 'page', marks: false, ...(S.print || {}) };
  if (o.what === 'selection' && !d.sel) o.what = 'page';
  let pic = picture(d, o.what);
  const body = el('div', 'printdlg'), prev = el('canvas', 'printprev'), info = el('div', 'props-note'), form = el('div');
  const draw = () => {
    const L = layout(d, o, pic), H = 300, W = Math.round(H * L.pw / L.ph), x = prev.getContext('2d');
    prev.width = W * 2; prev.height = H * 2; prev.style.width = W + 'px'; prev.style.height = H + 'px'; x.scale(2 * W / L.pw, 2 * H / L.ph);
    x.fillStyle = '#fff'; x.fillRect(0, 0, L.pw, L.ph);
    x.save(); x.beginPath(); x.rect(0, 0, L.pw, L.ph); x.clip(); x.drawImage(pic, L.x, L.y, L.w, L.h); x.restore();
    x.strokeStyle = 'rgba(76,159,254,.8)'; x.lineWidth = L.pw / W * 0.8; x.setLineDash([2, 2]); x.strokeRect(o.margin, o.margin, L.pw - 2 * o.margin, L.ph - 2 * o.margin);
    info.textContent = `Paper ${fmt(L.pw, 1)} × ${fmt(L.ph, 1)} mm. Printed size ${fmt(L.w, 1)} × ${fmt(L.h, 1)} mm (${fmt(L.k * 100, 1)}% of real size, ${Math.round(d.dpi / L.k)} dpi).` + (L.clipped ? '  It does not fit inside the margins; choose Fit to page or a smaller scale.' : '');
  };
  const defs = () => [{ id: 'paper', label: 'Paper', type: 'select', options: Object.keys(PAPER) }, { id: 'orient', label: 'Orientation', type: 'select', options: [['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
    { id: 'scale', label: 'Scale', type: 'select', options: [['actual', 'Real size (document dpi)'], ['fit', 'Fit to page'], ['percent', 'Percentage']] }, ...(o.scale === 'percent' ? [{ id: 'pct', label: 'Percent', type: 'number', min: 1 }] : []),
    { id: 'margin', label: 'Margins (mm)', type: 'number', min: 0 }, { id: 'center', label: 'Centre on the page', type: 'check' }, { id: 'marks', label: 'Crop marks', type: 'check' },
    ...(d.sel ? [{ id: 'what', label: 'Print', type: 'select', options: [['page', 'Whole picture'], ['selection', 'Selected area']] }] : [])];
  const build = () => { form.innerHTML = ''; form.append(paramUI(defs(), o, id => { if (id === 'what') pic = picture(d, o.what); if (id === 'scale') build(); draw(); })); };
  body.append(prev, form, info); build(); draw();
  if (!(await dialog({ title: 'Print ' + d.name, body, ok: 'Print…', values: o }))) return;
  S.print = { ...o }; app.saveSettings();
  const L = layout(d, o, pic), f = document.createElement('iframe');
  const marks = !o.marks ? '' : [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]].map(([cx, cy]) =>
    `<div style="position:absolute;left:${cx - 0.1}mm;top:${cy < L.y + 1 ? cy - 6 : cy + 1}mm;width:0.2mm;height:5mm;background:#000"></div><div style="position:absolute;top:${cy - 0.1}mm;left:${cx < L.x + 1 ? cx - 6 : cx + 1}mm;height:0.2mm;width:5mm;background:#000"></div>`).join('');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(f);
  const w = f.contentDocument; w.open();
  w.write(`<!doctype html><title>${d.name}</title><style>@page { size: ${fmt(L.pw, 2)}mm ${fmt(L.ph, 2)}mm; margin: 0; } html, body { margin: 0; width: ${fmt(L.pw, 2)}mm; height: ${fmt(L.ph, 2)}mm; overflow: hidden; position: relative; }
    img { position: absolute; left: ${fmt(L.x, 3)}mm; top: ${fmt(L.y, 3)}mm; width: ${fmt(L.w, 3)}mm; height: ${fmt(L.h, 3)}mm; image-rendering: ${L.k > 1.5 ? 'pixelated' : 'auto'}; }</style><img src="${pic.toDataURL('image/png')}">${marks}`);
  w.close();
  const img = w.querySelector('img'), go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); };
  if (img.complete) setTimeout(go, 60); else img.onload = go;
}
