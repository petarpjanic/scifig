// Welcome screen (shown whenever no document is open) and File ▸ Open Recent.
import { app } from './app.js';
import { el, keyLabel } from './ui.js';
import { getRecent, openRecent, removeRecent, clearRecent, sessionInfo, restoreSession } from './io.js';

const ago = t => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
let recentCache = [];

async function build() {
  const box = document.getElementById('empty'); if (app.docs.length) return;
  const [list, sess] = await Promise.all([getRecent(), sessionInfo()]); recentCache = list;
  if (app.docs.length) return;
  box.innerHTML = '';
  const head = el('div', 'wl-head'); head.append(el('h1', null, 'SciFig'), el('p', null, 'Image editing and scientific figures'));
  const acts = el('div', 'wl-acts');
  const act = (label, sub, cmd, run) => { const b = el('button', 'wl-act'); b.append(el('b', null, label), el('small', null, sub)); const c = cmd && app.commands.get(cmd); if (c && c.shortcut) b.title = keyLabel(c.shortcut); b.onclick = run || (() => app.run(cmd)); acts.append(b); };
  act('New document', 'A4, Letter, journal sizes, screens…', 'file.new');
  act('Open file…', 'Images, PSD, TIFF, HEIC, raw, SVG, PDF, EPS', 'file.open');
  if (sess) act('Restore last session', `${sess.n} document${sess.n > 1 ? 's' : ''}, ${ago(sess.time)}`, null, async () => { if (!(await restoreSession())) app.toast('The last session could not be restored'); });
  act('Open sample figure', 'A small example to try the tools', 'help.sample');
  box.append(head, acts);
  if (list.length) {
    const rh = el('div', 'wl-rhead'), clr = el('button', 'mini', 'Clear list'); rh.append(el('span', null, 'Recent'), clr);
    clr.onclick = async () => { await clearRecent(); };
    const grid = el('div', 'wl-recent');
    for (const e of list) {
      const card = el('div', 'wl-card'), im = el('img'), x = el('button', 'wl-x', '×');
      im.src = e.thumb; im.alt = ''; x.title = 'Remove from the list'; card.title = `${e.name}\n${e.w} × ${e.h} px · opened ${ago(e.time)}`;
      card.append(im, el('span', 'wl-name', e.name), el('small', null, ago(e.time)), x);
      card.onclick = () => openRecent(e.id); x.onclick = ev => { ev.stopPropagation(); removeRecent(e.id); };
      grid.append(card);
    }
    box.append(rh, grid);
  }
  box.append(el('p', 'wl-drop', 'Or drop a file anywhere in this window'));
}

export function initWelcome() {
  app.on('docs', build); app.on('recent', () => { build(); getRecent().then(l => { recentCache = l; }); });
  getRecent().then(l => { recentCache = l; });
  app.registerCommand({ id: 'file.clearRecent', title: 'Clear Recent Files', run: () => clearRecent(), enabled: () => recentCache.length > 0 });
  app.registerCommand({ id: 'file.restore', title: 'Restore Last Session', run: () => restoreSession(), desc: 'Reopen the documents that were open last time (autosaved in this browser)', keywords: 'autosave recover reopen session' });
  const file = app.menus.find(m => m[0] === 'File')[1], i = file.indexOf('file.open');
  file.splice(i + 1, 0, ['Open Recent', () => recentCache.length ? [...recentCache.map(e => ({ title: e.name, run: () => openRecent(e.id) })), '-', 'file.clearRecent'] : [{ title: 'No recent files', disabled: true }]], 'file.restore');
  build();
}
