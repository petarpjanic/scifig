// Colour maths (RGB, HSV, HSL, Lab, CMYK) and the colour picker used by the Colour panel and the style swatches.
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
export const hexToRgb = h => { let m = /^#?([0-9a-f]{6})/i.exec(h || ''); if (!m) { const s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(h || ''); m = s ? ['', s[1] + s[1] + s[2] + s[2] + s[3] + s[3]] : ['', '000000']; } const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clamp8(v).toString(16).padStart(2, '0')).join('');

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, mx ? d / mx * 100 : 0, mx * 100];
}
export function hsvToRgb(h, s, v) {
  s /= 100; v /= 100; h = ((h % 360) + 360) % 360 / 60;
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c, i = Math.floor(h);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i % 6];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export function rgbToHsl(r, g, b) {
  const [h] = rgbToHsv(r, g, b), mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) * 100 : 0, l * 100];
}
export function hslToRgb(h, s, l) {
  s /= 100; l /= 100; const c = (1 - Math.abs(2 * l - 1)) * s, v = l + c / 2;
  return hsvToRgb(h, v ? c / v * 100 : 0, v * 100);
}
// CIE Lab with the D50 white point (as Photoshop), from sRGB.
const TOLIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; TOLIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const enc = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const fL = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116, gL = t => t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787;
export function rgbToLab(r, g, b) {
  const R = TOLIN[clamp8(r)], G = TOLIN[clamp8(g)], B = TOLIN[clamp8(b)];
  const x = fL((0.4360747 * R + 0.3850649 * G + 0.1430804 * B) / 0.96422), y = fL(0.2225045 * R + 0.7168786 * G + 0.0606169 * B), z = fL((0.0139322 * R + 0.0971045 * G + 0.7141733 * B) / 0.82521);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, X = gL(fy + a / 500) * 0.96422, Y = gL(fy), Z = gL(fy - b / 200) * 0.82521;
  return [enc(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z), enc(-0.9787684 * X + 1.9161415 * Y + 0.033454 * Z), enc(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z)].map(v => cl(v, 0, 255));
}
export function rgbToCmyk(r, g, b) { const k = 1 - Math.max(r, g, b) / 255, d = 1 - k || 1; return [(1 - r / 255 - k) / d * 100, (1 - g / 255 - k) / d * 100, (1 - b / 255 - k) / d * 100, k * 100]; }
export function cmykToRgb(c, m, y, k) { k /= 100; return [255 * (1 - c / 100) * (1 - k), 255 * (1 - m / 100) * (1 - k), 255 * (1 - y / 100) * (1 - k)]; }

export const SPACES = {
  RGB: { ch: [['R', 0, 255], ['G', 0, 255], ['B', 0, 255]], from: (r, g, b) => [r, g, b], to: (r, g, b) => [r, g, b] },
  HSV: { ch: [['H', 0, 360], ['S', 0, 100], ['V', 0, 100]], from: rgbToHsv, to: hsvToRgb },
  HSL: { ch: [['H', 0, 360], ['S', 0, 100], ['L', 0, 100]], from: rgbToHsl, to: hslToRgb },
  Lab: { ch: [['L', 0, 100], ['a', -128, 127], ['b', -128, 127]], from: rgbToLab, to: labToRgb },
  CMYK: { ch: [['C', 0, 100], ['M', 0, 100], ['Y', 0, 100], ['K', 0, 100]], from: rgbToCmyk, to: cmykToRgb },
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let space = 'RGB';
try { space = localStorage.getItem('scifig.colorSpace') || 'RGB'; } catch (e) { /* storage unavailable */ }

// A picker: saturation/value square, hue strip, numeric channels in a switchable colour space, hex field.
// Returns {el, set(hex)}; onChange(hex, final) fires while dragging (final=false) and when a change is finished.
export function colorPicker(initial, onChange, compact = false) {
  const root = el('div', 'picker'), sv = el('canvas', 'sv'), hue = el('canvas', 'hue'), rows = el('div', 'chans'), top = el('div', 'pk-top'), sel = el('select'), hex = el('input');
  sv.width = 220; sv.height = 120; hue.width = 220; hue.height = 12; hex.type = 'text'; hex.spellcheck = false; hex.maxLength = 7;
  for (const k of Object.keys(SPACES)) sel.append(el('option', null, k));
  sel.value = SPACES[space] ? space : 'RGB'; sel.title = 'Colour space of the number fields';
  top.append(sel, el('span', null, 'Hex'), hex); root.append(sv, hue, top, rows);
  let h = 0, s = 0, v = 0, inputs = [];
  const rgb = () => hsvToRgb(h, s, v), cur = () => rgbToHex(...rgb());
  const paint = () => {
    const x = sv.getContext('2d'), W = sv.width, H = sv.height;
    x.fillStyle = `hsl(${h},100%,50%)`; x.fillRect(0, 0, W, H);
    let g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const px = s / 100 * W, py = (1 - v / 100) * H; x.lineWidth = 1.5; x.strokeStyle = v > 55 ? '#000' : '#fff'; x.beginPath(); x.arc(px, py, 5, 0, 7); x.stroke();
    const y = hue.getContext('2d'); g = y.createLinearGradient(0, 0, W, 0); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`); y.fillStyle = g; y.fillRect(0, 0, W, 12);
    y.fillStyle = '#fff'; y.strokeStyle = '#000'; y.lineWidth = 1; y.beginPath(); y.rect(Math.round(h / 360 * W) - 2.5, 0.5, 5, 11); y.fill(); y.stroke();
  };
  const fields = () => {
    const sp = SPACES[sel.value], vals = sp.from(...rgb()); if (sel.value === 'HSV') { vals[0] = h; vals[1] = s; vals[2] = v; }
    inputs.forEach(([r, n], i) => { const q = Math.round(vals[i]); if (document.activeElement !== n) n.value = q; r.value = q; });
    rows.classList.toggle('compact', compact);
    if (document.activeElement !== hex) hex.value = cur();
  };
  const build = () => {
    rows.innerHTML = ''; inputs = [];
    SPACES[sel.value].ch.forEach(([name, mn, mx], i) => {
      const row = el('div', 'ch'), r = el('input'), n = el('input'); r.type = 'range'; n.type = 'number'; r.min = n.min = mn; r.max = n.max = mx;
      const take = (src, fin) => { const vals = inputs.map(([a, b]) => +(src === r ? a : b).value || 0); vals[i] = cl(+src.value || 0, mn, mx);
        const c = SPACES[sel.value].to(...vals); if (sel.value === 'HSV') [h, s, v] = vals; else { const q = rgbToHsv(...c); if (q[1] > 0 && q[2] > 0) h = q[0]; s = q[1]; v = q[2]; }
        paint(); fields(); onChange(cur(), fin); };
      r.oninput = () => take(r, false); r.onchange = () => take(r, true); n.onchange = () => take(n, true); n.onkeydown = e => e.stopPropagation();
      row.title = `${name}  ${mn}…${mx}`; if (compact) row.append(el('label', null, name), n); else row.append(el('label', null, name), r, n); rows.append(row); inputs.push([r, n]);
    });
    fields();
  };
  const dragOn = (c, fn) => { c.onpointerdown = e => { c.setPointerCapture(e.pointerId); const mv = ev => { const r = c.getBoundingClientRect(); fn(cl((ev.clientX - r.left) / r.width, 0, 1), cl((ev.clientY - r.top) / r.height, 0, 1)); paint(); fields(); onChange(cur(), false); };
    mv(e); c.onpointermove = mv; c.onpointerup = () => { c.onpointermove = c.onpointerup = null; onChange(cur(), true); }; }; };
  dragOn(sv, (x, y) => { s = x * 100; v = (1 - y) * 100; }); dragOn(hue, x => { h = x * 359.999; });
  sel.onchange = () => { space = sel.value; try { localStorage.setItem('scifig.colorSpace', space); } catch (e) { /* storage unavailable */ } build(); };
  hex.onkeydown = e => e.stopPropagation();
  hex.onchange = () => { if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.value.trim())) { api.set(rgbToHex(...hexToRgb(hex.value.trim()))); onChange(cur(), true); } else hex.value = cur(); };
  const api = { el: root, set(c) { if (!c || c.toLowerCase() === cur()) { fields(); return; } const q = rgbToHsv(...hexToRgb(c)); if (q[1] > 0 && q[2] > 0) h = q[0]; s = q[1]; v = q[2]; paint(); fields(); } };
  [h, s, v] = rgbToHsv(...hexToRgb(initial || '#000000')); paint(); build();
  return api;
}

// Small popover with the picker, anchored to an element. opts: {color, none, onChange(hex|null, final)}
export function pickColor(anchor, opts) {
  document.querySelectorAll('.popover.colorpop').forEach(p => p.remove());
  const p = el('div', 'popover colorpop'), pk = colorPicker(opts.color || '#000000', (c, fin) => opts.onChange(c, fin));
  p.append(pk.el);
  if (opts.none) { const b = el('button', null, 'None (no colour)'); b.style.marginTop = '6px'; b.onclick = () => { opts.onChange(null, true); p.remove(); }; p.append(b); }
  document.body.append(p);
  const r = anchor.getBoundingClientRect(), q = p.getBoundingClientRect();
  p.style.left = Math.max(4, Math.min(r.left, innerWidth - q.width - 6)) + 'px'; p.style.top = (r.bottom + q.height + 8 < innerHeight ? r.bottom + 4 : Math.max(4, r.top - q.height - 4)) + 'px';
  const off = e => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  return p;
}
