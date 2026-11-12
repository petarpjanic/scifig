// Canvas view: zoom/pan, scene + overlay canvases, rulers, pointer dispatch to the active tool.
import { app } from './app.js';
import { renderDoc, mk, fmt, shapePath } from './core.js';
import { ensureSelPath } from './imaging.js';
import { SNAP_LABEL } from './snap.js';
import { rgbToLab } from './color.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const view = {
  dpr: 1, W: 0, H: 0, snapMark: null, mouse: null, space: false, panning: null, dash: 0,

  init() {
    this.vp = $('viewport'); this.scene = $('scene'); this.over = $('over'); this.rH = $('rulerH'); this.rV = $('rulerV');
    this.buf = mk(1, 1);
    new ResizeObserver(() => this.resize()).observe(this.vp);
    app.on('render', () => this.render());
    app.on('overlay', () => this.drawOverlay());
    const o = this.over;
    o.addEventListener('pointerdown', e => this.down(e));
    o.addEventListener('pointermove', e => this.move(e));
    o.addEventListener('pointerup', e => this.up(e));
    o.addEventListener('pointercancel', e => this.up(e));
    o.addEventListener('dblclick', e => { const t = app.tool; if (app.doc && t && t.dbl) t.dbl(this.ev(e)); });
    o.addEventListener('contextmenu', e => { e.preventDefault(); const t = app.tool, ev = this.ev(e); if (!app.doc) return; if (t && t.context && t.context(ev)) return; app.emit('context', ev, e); });
    o.addEventListener('pointerleave', () => { this.mouse = null; app.refresh('overlay'); });
    o.addEventListener('wheel', e => this.wheel(e), { passive: false });
    setInterval(() => { if (app.doc && app.doc.sel) { this.dash = (this.dash + 1) % 16; this.drawOverlay(); } }, 140);
    this.resize();
  },

  resize() {
    const r = this.vp.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1; this.W = r.width; this.H = r.height;
    for (const c of [this.scene, this.over, this.buf]) { c.width = Math.max(1, Math.round(this.W * this.dpr)); c.height = Math.max(1, Math.round(this.H * this.dpr)); }
    for (const c of [this.rH, this.rV]) { const q = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(q.width * this.dpr)); c.height = Math.max(1, Math.round(q.height * this.dpr)); }
    if (app.doc && app.doc.view.fit) this.fit();
    this.render(); this.drawOverlay(); // draw now: a resized canvas is blank until redrawn
  },

  toDoc(sx, sy) { const v = app.doc.view; return { x: (sx - v.tx) / v.zoom, y: (sy - v.ty) / v.zoom }; },
  S(p) { const v = app.doc.view; return { x: p.x * v.zoom + v.tx, y: p.y * v.zoom + v.ty }; },
  fit() {
    const d = app.doc; if (!d || !this.W) return;
    const z = Math.min((this.W - 50) / d.w, (this.H - 50) / d.h);
    d.view = { zoom: z, tx: (this.W - d.w * z) / 2, ty: (this.H - d.h * z) / 2, fit: true };
    app.refresh('render');
  },
  zoomAt(f, sx = this.W / 2, sy = this.H / 2) {
    const d = app.doc; if (!d) return; const v = d.view, z = Math.min(256, Math.max(0.01, v.zoom * f));
    v.tx = sx - (sx - v.tx) * z / v.zoom; v.ty = sy - (sy - v.ty) * z / v.zoom; v.zoom = z; v.fit = false;
    app.refresh('render');
  },
  setZoom(z) { const d = app.doc; if (d) this.zoomAt(z / d.view.zoom); },
  // Zoom so the document rectangle a..b fills the view.
  zoomRect(a, b) {
    const d = app.doc, w = Math.max(1e-6, b.x - a.x), h = Math.max(1e-6, b.y - a.y), z = Math.min(256, Math.min(this.W / w, this.H / h) * 0.96);
    d.view = { zoom: z, tx: this.W / 2 - (a.x + w / 2) * z, ty: this.H / 2 - (a.y + h / 2) * z, fit: false }; app.refresh('render');
  },

  ev(e) {
    const r = this.over.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, p: this.toDoc(sx, sy), shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey, button: e.button, buttons: e.buttons, pressure: e.pressure || 0.5, orig: e };
  },
  down(e) {
    if (!app.doc) return;
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    try { this.over.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
    const ev = this.ev(e), t = app.tool;
    if (e.button === 0 && e.ctrlKey && isMac) return; // Ctrl-click is the right click on a Mac
    if (e.button === 1 || (e.button === 0 && (this.space || t.id === 'hand'))) { const v = app.doc.view; this.panning = { sx: ev.sx, sy: ev.sy, tx: v.tx, ty: v.ty }; this.cursor(); return; }
    if (e.button === 0 && t.down) { this.dragging = true; t.down(ev); }
  },
  move(e) {
    if (!app.doc) return;
    const ev = this.ev(e); this.mouse = ev;
    if (this.panning) { const v = app.doc.view, p = this.panning; v.tx = p.tx + ev.sx - p.sx; v.ty = p.ty + ev.sy - p.sy; v.fit = false; app.refresh('render'); return; }
    ev.drag = !!this.dragging;
    const t = app.tool; if (t.move) t.move(ev);
    app.emit('cursor', ev.p);
    this.drawRulers();
    app.refresh('overlay');
  },
  up(e) {
    if (!app.doc) return;
    if (this.panning) { this.panning = null; this.cursor(); return; }
    if (!this.dragging) return;
    this.dragging = false;
    const t = app.tool; if (t.up) t.up(this.ev(e));
  },
  wheel(e) {
    e.preventDefault(); const d = app.doc; if (!d) return;
    const r = this.over.getBoundingClientRect();
    // the wheel zooms at the cursor (View ▸ Scroll Wheel Zooms); with that off it scrolls and Cmd/Ctrl/Alt + wheel zooms
    const zoomKey = e.ctrlKey || e.metaKey || e.altKey, wz = app.settings.wheelZoom !== false;
    if (zoomKey || (wz && !e.shiftKey)) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30 ? 0.012 : 0.003)), e.clientX - r.left, e.clientY - r.top);
    else { const v = d.view; v.tx -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; v.ty -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; v.fit = false; app.refresh('render'); }
  },
  cursor() {
    const t = app.tool;
    this.over.style.cursor = this.panning ? 'grabbing' : this.space || (t && t.id === 'hand') ? 'grab' : (t && (typeof t.cursor === 'function' ? t.cursor() : t.cursor)) || 'crosshair';
  },

  checker() {
    if (this._chk) return this._chk;
    const c = mk(16, 16), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#d4d4d4'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return (this._chk = this.scene.getContext('2d').createPattern(c, 'repeat'));
  },
  render() {
    const d = app.doc, ctx = this.scene.getContext('2d');
    this.vp.classList.toggle('nodoc', !d);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.scene.width, this.scene.height);
    this.cursor();
    if (!d) { this.drawRulers(); return; }
    const s = d.view.zoom * this.dpr, tx = Math.round(d.view.tx * this.dpr), ty = Math.round(d.view.ty * this.dpr);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(tx + 3, ty + 3, d.w * s, d.h * s);
    ctx.fillStyle = this.checker(); ctx.fillRect(tx, ty, d.w * s, d.h * s);
    const b = this.buf.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, this.buf.width, this.buf.height);
    renderDoc(b, d, s, tx, ty);
    const E = d.chan && d.chan.edit;
    if (E && E.length === 1) { // one channel selected in the Channels panel: show it in grey
      const x0 = Math.max(0, Math.floor(tx)), y0 = Math.max(0, Math.floor(ty)), x1 = Math.min(this.buf.width, Math.ceil(tx + d.w * s)), y1 = Math.min(this.buf.height, Math.ceil(ty + d.h * s));
      if (x1 > x0 && y1 > y0) { const img = b.getImageData(x0, y0, x1 - x0, y1 - y0), p = img.data, c = E[0], lab = d.chan.mode === 'lab';
        for (let i = 0; i < p.length; i += 4) { let v; if (lab) { const q = rgbToLab(p[i], p[i + 1], p[i + 2]); v = c === 0 ? q[0] * 2.55 : q[c] + 128; } else v = p[i + c]; p[i] = p[i + 1] = p[i + 2] = v; if (c === 3 && !lab) p[i + 3] = 255; }
        b.putImageData(img, x0, y0); }
    }
    ctx.drawImage(this.buf, 0, 0);
    this.drawRulers();
    app.emit('rendered');
  },

  drawOverlay() {
    const d = app.doc, ctx = this.over.getContext('2d'), dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.over.width, this.over.height);
    if (!d) return;
    const v = d.view, z = v.zoom, accent = css('--accent') || '#4c9ffe';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pixel grid when zoomed far in, unit grid when enabled
    const lines = (step, color) => {
      if (step * z < 5) return;
      ctx.beginPath();
      const a = this.toDoc(0, 0), b = this.toDoc(this.W, this.H);
      for (let x = Math.max(0, Math.ceil(a.x / step) * step); x <= Math.min(d.w, b.x); x += step) { const sx = Math.round(x * z + v.tx) + 0.5; ctx.moveTo(sx, Math.max(0, v.ty)); ctx.lineTo(sx, Math.min(this.H, v.ty + d.h * z)); }
      for (let y = Math.max(0, Math.ceil(a.y / step) * step); y <= Math.min(d.h, b.y); y += step) { const sy = Math.round(y * z + v.ty) + 0.5; ctx.moveTo(Math.max(0, v.tx), sy); ctx.lineTo(Math.min(this.W, v.tx + d.w * z), sy); }
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    };
    if (z >= 14) lines(1, 'rgba(128,128,128,.28)');
    if (app.settings.grid.show) lines(d.fromU(app.settings.grid.size), 'rgba(60,140,255,.35)');
    // marching ants
    ensureSelPath(d);
    if (d.selPath) {
      const so = this.selOffset || { x: 0, y: 0 };
      ctx.save(); ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (v.tx + so.x * z), dpr * (v.ty + so.y * z));
      ctx.lineWidth = 1 / z; ctx.strokeStyle = '#fff'; ctx.stroke(d.selPath);
      ctx.setLineDash([4 / z, 4 / z]); ctx.lineDashOffset = -this.dash / 2 / z; ctx.strokeStyle = '#000'; ctx.stroke(d.selPath);
      ctx.restore();
    }
    // selected vector shapes
    if (d.selShapes.size) {
      ctx.save(); ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * v.tx, dpr * v.ty);
      ctx.lineWidth = 1 / z; ctx.strokeStyle = accent;
      for (const { s } of d.selected()) ctx.stroke(shapePath(s));
      ctx.restore();
    }
    const t = app.tool; if (t && t.draw) { ctx.save(); t.draw(ctx, this); ctx.restore(); }
    const m = this.snapMark;
    if (m && m.kind) {
      const p = this.S(m); ctx.strokeStyle = '#19c37d'; ctx.fillStyle = '#19c37d'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      if (m.guides) { ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; for (const [a, b] of m.guides) { const A = this.S(a), B = this.S(b); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); } ctx.restore(); }
      ctx.beginPath();
      const r = 6;
      if (m.kind === 'end' || m.kind === 'quad') ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
      else if (m.kind === 'mid') { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.lineTo(p.x - r, p.y + r); ctx.closePath(); }
      else if (m.kind === 'center') ctx.arc(p.x, p.y, r, 0, 7);
      else if (m.kind === 'inter') { ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); }
      else if (m.kind === 'perp') { ctx.moveTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x, p.y + r); ctx.lineTo(p.x, p.y - r); }
      else if (m.kind === 'near') { ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.closePath(); }
      else if (m.kind === 'grid') { ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r); }
      ctx.stroke();
      if (m.kind !== 'grid' && m.kind !== 'align' && m.kind !== 'angle') this.label(ctx, SNAP_LABEL[m.kind], p.x + 12, p.y + 20, '#19c37d');
    }
  },
  // small text tag used by tools for dimensions and hints
  label(ctx, text, x, y, color = '#222') {
    ctx.save(); ctx.font = '11px -apple-system, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    x = Math.min(x, this.W - w - 2); y = Math.max(10, Math.min(y, this.H - 10));
    ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.rect(Math.round(x) + 0.5, Math.round(y - 9) + 0.5, w, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.fillText(text, x + 5, y + 0.5); ctx.restore();
  },

  // Row of value boxes next to the cursor. fields: [{label, text, unit, active, typed}]
  hud(ctx, fields, x, y) {
    ctx.save(); ctx.font = '12px -apple-system, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle'; ctx.setLineDash([]);
    const BW = 84, H = 24, accent = css('--accent') || '#4c9ffe', lay = fields.map(f => ({ f, lw: ctx.measureText(f.label).width + 8, uw: f.unit ? ctx.measureText(f.unit).width + 10 : 6 }));
    const W = lay.reduce((a, q) => a + q.lw + BW + q.uw, 8);
    x = Math.max(4, Math.min(x, this.W - W - 4)); y = Math.max(4, Math.min(y, this.H - H - 4));
    ctx.fillStyle = 'rgba(28,29,32,.94)'; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, W, H + 6); ctx.fill(); ctx.stroke();
    let cx = x + 6;
    for (const { f, lw, uw } of lay) {
      ctx.fillStyle = '#aab'; ctx.fillText(f.label, cx, y + 3 + H / 2); cx += lw;
      ctx.fillStyle = f.active ? '#fff' : 'rgba(255,255,255,.1)'; ctx.strokeStyle = f.active ? accent : 'rgba(255,255,255,.3)'; ctx.lineWidth = f.active ? 2 : 1;
      ctx.beginPath(); ctx.rect(Math.round(cx) + 0.5, Math.round(y + 3) + 0.5, BW, H - 1); ctx.fill(); ctx.stroke();
      ctx.fillStyle = f.active ? (f.typed ? '#0b57d0' : '#111') : (f.typed ? '#8fc0ff' : '#e6e6e6'); ctx.font = (f.typed ? 'bold ' : '') + '12px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(f.text + (f.active && f.typed ? '|' : ''), cx + 6, y + 3 + H / 2); ctx.font = '12px -apple-system, "Segoe UI", sans-serif'; cx += BW;
      ctx.fillStyle = '#aab'; if (f.unit) ctx.fillText(f.unit, cx + 4, y + 3 + H / 2); cx += uw;
    }
    ctx.restore();
  },

  drawRulers() {
    if (!app.settings.rulers) return;
    const d = app.doc, dpr = this.dpr, fg = css('--ruler-text') || '#888', line = css('--line') || '#444';
    for (const horiz of [true, false]) {
      const c = horiz ? this.rH : this.rV, ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const len = horiz ? this.W : this.H;
      ctx.strokeStyle = line; ctx.beginPath(); if (horiz) { ctx.moveTo(0, 19.5); ctx.lineTo(len, 19.5); } else { ctx.moveTo(19.5, 0); ctx.lineTo(19.5, len); } ctx.stroke();
      if (!d) continue;
      const v = d.view, off = horiz ? v.tx : v.ty, ppu = d.pxPerUnit * v.zoom; // screen px per unit
      let step = Math.pow(10, Math.ceil(Math.log10(70 / ppu)));
      if (step * ppu / 5 >= 70) step /= 5; else if (step * ppu / 2 >= 70) step /= 2;
      const sub = step / 10, i0 = Math.floor(-off / ppu / sub), i1 = Math.ceil((len - off) / ppu / sub);
      ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.font = '9px -apple-system, "Segoe UI", sans-serif'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const pos = Math.round(i * sub * ppu + off) + 0.5, major = i % 10 === 0, t = major ? 20 : i % 5 === 0 ? 8 : 4;
        if (horiz) { ctx.moveTo(pos, 20); ctx.lineTo(pos, 20 - t); } else { ctx.moveTo(20, pos); ctx.lineTo(20 - t, pos); }
        if (major) {
          const txt = fmt(i * sub, 6);
          if (horiz) ctx.fillText(txt, pos + 3, 9);
          else { ctx.save(); ctx.translate(9, pos + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(txt, 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
      if (this.mouse) { const m = horiz ? this.mouse.sx : this.mouse.sy; ctx.strokeStyle = css('--accent') || '#4c9ffe'; ctx.beginPath(); if (horiz) { ctx.moveTo(m + 0.5, 0); ctx.lineTo(m + 0.5, 20); } else { ctx.moveTo(0, m + 0.5); ctx.lineTo(20, m + 0.5); } ctx.stroke(); }
    }
  },
};
