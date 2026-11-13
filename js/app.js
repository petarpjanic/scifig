// App singleton: registries (commands, tools, filters, adjustments, help), settings, events.
// Everything the UI shows is built from these registries, so plugins extend the app by registering.

const DEFAULTS = {
  theme: 'dark',
  rulers: true,
  wheelZoom: true,
  snap: { on: true, end: true, mid: true, center: true, inter: true, perp: true, near: true, align: true, grid: false, angle: 45 },
  grid: { show: false, size: 10 },
  style: { stroke: '#000000', swPt: 1, fill: null, dash: 'solid', as: 'none', ae: 'none', alpha: 1, hs: 1 },
  text: { font: 'Arial', sizePt: 10, bold: false, italic: false, align: 'left' },
  tools: {},
};

function merge(def, val) {
  if (val == null || typeof def !== 'object' || def === null || Array.isArray(def)) return val === undefined ? def : val;
  const o = {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(val)])) o[k] = k in def ? merge(def[k], val[k]) : val[k];
  return o;
}

class App {
  constructor() {
    this.docs = [];
    this.doc = null;
    this.tools = new Map();
    this.tool = null;
    this.commands = new Map();
    this.filters = new Map();
    this.adjustments = new Map();
    this.help = [];
    this.menus = [];
    this.listeners = {};
    this.fg = '#000000';
    this.bg = '#ffffff';
    this.clipboard = null;
    this.lib = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('scifig.settings') || localStorage.getItem('figura.settings') || '{}'); } catch (e) { /* first run */ }
    this.settings = merge(DEFAULTS, saved);
    this._pending = new Set();
  }

  on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  // Batched redraw: what is any of 'render', 'overlay', 'layers', 'props', 'docs', 'tool', 'all'.
  refresh(...what) {
    if (!what.length) what = ['all'];
    const first = !this._pending.size;
    for (const w of what) this._pending.add(w);
    if (first) requestAnimationFrame(() => {
      const p = this._pending; this._pending = new Set();
      const all = p.has('all');
      for (const ev of ['docs', 'layers', 'props', 'tool', 'render', 'overlay']) {
        if (all || p.has(ev) || (ev === 'overlay' && p.has('render'))) this.emit(ev);
      }
    });
  }

  saveSettings() { try { localStorage.setItem('scifig.settings', JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ } }

  registerCommand(c) { this.commands.set(c.id, c); return c; }
  registerTool(t) {
    this.tools.set(t.id, t);
    const def = {};
    for (const o of t.options || []) if (o.id) def[o.id] = o.default;
    this.settings.tools[t.id] = Object.assign(def, this.settings.tools[t.id] || {});
    t.opt = this.settings.tools[t.id];
    return t;
  }
  registerFilter(f) {
    this.filters.set(f.id, f);
    this.registerCommand({ id: 'filter.' + f.id, title: f.title + (f.params && f.params.length ? '…' : ''), desc: f.desc || 'Filter: ' + f.title, keywords: f.keywords, kind: 'filter',
      enabled: () => !!this.doc, run: () => this.emit('runFilter', f) });
    return f;
  }
  registerAdjustment(a) {
    this.adjustments.set(a.id, a);
    this.registerCommand({ id: 'adjust.' + a.id, title: a.title, desc: a.desc || 'Adjustment layer: ' + a.title, keywords: a.keywords, kind: 'adjust',
      enabled: () => !!this.doc, run: () => this.emit('addAdjustment', a) });
    return a;
  }
  registerHelp(h) { this.help.push(h); }

  run(id, ...args) {
    const c = this.commands.get(id);
    if (!c) { this.toast('Unknown command: ' + id); return; }
    if (c.enabled && !c.enabled()) return;
    try { return c.run(this, ...args); } catch (e) { console.error(e); this.toast(c.title + ' failed: ' + e.message); }
  }

  setTool(id) {
    const t = this.tools.get(id);
    if (!t || t === this.tool) return;
    if (this.tool && this.tool.deactivate) this.tool.deactivate();
    this.tool = t;
    if (t.activate) t.activate();
    this.refresh('tool', 'overlay', 'props');
  }

  addDoc(doc) { this.docs.push(doc); this.setDoc(doc); this.emit('changed'); }
  setDoc(doc) {
    if (this.tool && this.tool.cancel) this.tool.cancel();
    this.doc = doc;
    this.refresh('all');
  }
  closeDoc(doc) {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    this.docs.splice(i, 1);
    if (this.doc === doc) this.doc = this.docs[Math.min(i, this.docs.length - 1)] || null;
    this.refresh('all');
    this.emit('changed');
  }

  // Record an undo step for the current document and redraw everything.
  commit(label) {
    if (!this.doc) return;
    this.doc.commit(label);
    this.refresh('all');
    this.emit('changed');
  }
  undo() { if (this.doc && this.doc.undo()) { this.refresh('all'); this.emit('changed'); } }
  redo() { if (this.doc && this.doc.redo()) { this.refresh('all'); this.emit('changed'); } }

  setColor(which, c) { this[which] = c; this.emit('colors'); }

  toast(msg, ms = 2600) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  }
}

export const app = new App();
window.scifig = window.figura = app;
