// CAD-style object snapping: endpoint, midpoint, centre, intersection, perpendicular, nearest, alignment, grid.
import { app } from './app.js';
import { shapeSegs, keyPoints, closestOnSeg, segIntersect, dist } from './core.js';

const PRIO = { end: 1, quad: 1, inter: 2, mid: 3, center: 4, perp: 5, near: 7 };
export const SNAP_LABEL = { end: 'Endpoint', quad: 'Quadrant', inter: 'Intersection', mid: 'Midpoint', center: 'Centre', perp: 'Perpendicular', near: 'On edge', align: 'Aligned', grid: 'Grid', angle: 'Angle lock' };

const cache = new Map(); // layer id -> {rev, items}
function layerGeom(L) {
  let c = cache.get(L.id);
  if (!c || c.rev !== L.rev || c.n !== L.shapes.length) {
    c = { rev: L.rev, n: L.shapes.length, items: L.shapes.map(s => {
      const segs = shapeSegs(s), keys = keyPoints(s);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const g of segs) for (const q of [g.a, g.b]) { if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y; }
      return { id: s.id, segs, keys, x0, y0, x1, y1 };
    }) };
    cache.set(L.id, c);
  }
  return c.items;
}

// opt: ref (previous point, enables perpendicular), exclude (Set of shape ids), extra (points of the shape being drawn)
export function snapPoint(p, opt = {}) {
  const d = app.doc, S = app.settings.snap, out = { x: p.x, y: p.y };
  if (!d || !S.on || opt.off) return out;
  const tol = 10 / d.view.zoom, ex = opt.exclude;
  let best = null;
  const cand = (kind, q) => { const dd = dist(p, q); if (dd > tol) return; const pr = PRIO[kind]; if (!best || pr < best.pr || (pr === best.pr && dd < best.d)) best = { x: q.x, y: q.y, kind, pr, d: dd }; };
  const keys = [], near = [];
  const addKey = k => { keys.push(k); if ((k.kind === 'end' || k.kind === 'quad') && S.end) cand(k.kind, k); else if (k.kind === 'mid' && S.mid) cand('mid', k); else if (k.kind === 'center' && S.center) cand('center', k); };
  // the page itself: corners, edge midpoints, centre
  for (const [x, y, kind] of [[0, 0, 'end'], [d.w, 0, 'end'], [d.w, d.h, 'end'], [0, d.h, 'end'], [d.w / 2, 0, 'mid'], [d.w, d.h / 2, 'mid'], [d.w / 2, d.h, 'mid'], [0, d.h / 2, 'mid'], [d.w / 2, d.h / 2, 'center']]) addKey({ x, y, kind });
  let total = 0;
  for (const L of d.layers) {
    if (L.type !== 'vector' || !L.visible) continue;
    for (const it of layerGeom(L)) {
      if (ex && ex.has(it.id)) continue;
      total++;
      const close = p.x >= it.x0 - tol && p.x <= it.x1 + tol && p.y >= it.y0 - tol && p.y <= it.y1 + tol;
      if (close) { for (const k of it.keys) addKey(k); for (const g of it.segs) near.push(g); }
      else if (total < 600) for (const k of it.keys) keys.push(k);
      if (opt.ref && S.perp && !close) for (const g of it.segs) if (g.real) near.push(g);
    }
  }
  if (opt.extra && opt.extra.length) {
    const e = opt.extra;
    for (let i = 0; i < e.length; i++) { addKey({ x: e[i].x, y: e[i].y, kind: 'end' }); if (i) { addKey({ x: (e[i].x + e[i - 1].x) / 2, y: (e[i].y + e[i - 1].y) / 2, kind: 'mid' }); if (i < e.length - 1) near.push({ a: e[i - 1], b: e[i], real: true }); } }
  }
  const hot = [];
  for (const g of near) {
    const c = closestOnSeg(p, g.a, g.b);
    if (c.d <= tol) { hot.push(g); if (S.near) cand('near', c); }
    if (opt.ref && S.perp && g.real) {
      const f = closestOnSeg(opt.ref, g.a, g.b);
      if (f.t > 0.001 && f.t < 0.999 && dist(f, opt.ref) > 1e-6) cand('perp', f);
    }
  }
  if (S.inter && hot.length > 1 && hot.length < 60) for (let i = 0; i < hot.length; i++) for (let j = i + 1; j < hot.length; j++) {
    const a = hot[i], b = hot[j];
    if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
    const q = segIntersect(a.a, a.b, b.a, b.b); if (q) cand('inter', q);
  }
  if (best) return best;
  if (S.align) {
    let bx = null, by = null;
    const all = opt.ref ? keys.concat([{ x: opt.ref.x, y: opt.ref.y }]) : keys;
    for (const k of all) {
      const dx = Math.abs(k.x - p.x), dy = Math.abs(k.y - p.y);
      if (dx < tol * 0.6 && (!bx || dx < bx.d)) bx = { d: dx, k };
      if (dy < tol * 0.6 && (!by || dy < by.d)) by = { d: dy, k };
    }
    if (bx || by) {
      const r = { x: bx ? bx.k.x : p.x, y: by ? by.k.y : p.y, kind: 'align', guides: [] };
      if (bx) r.guides.push([bx.k, { x: r.x, y: r.y }]);
      if (by) r.guides.push([by.k, { x: r.x, y: r.y }]);
      return r;
    }
  }
  if (S.grid) { const g = d.fromU(app.settings.grid.size); if (g > 0) return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g, kind: 'grid' }; }
  return out;
}

// Angle lock (Shift): multiples of the snap angle, plus parallel / perpendicular to the previous segment.
export function lockAngle(last, p, prevDir) {
  const step = (app.settings.snap.angle || 45) * Math.PI / 180, a = Math.atan2(p.y - last.y, p.x - last.x);
  let best = Math.round(a / step) * step;
  if (prevDir) {
    const base = Math.atan2(prevDir.y, prevDir.x);
    for (let k = 0; k < 4; k++) { const c = base + k * Math.PI / 2; let df = Math.atan2(Math.sin(a - c), Math.cos(a - c)); if (Math.abs(df) < Math.abs(Math.atan2(Math.sin(a - best), Math.cos(a - best)))) best = c; }
  }
  return { x: Math.cos(best), y: Math.sin(best) };
}
// Resolve a pointer event to a drawing point: object snap, then Shift angle lock relative to `last`.
export function resolve(ev, last, opt = {}) {
  let r = snapPoint(ev.p, { ref: last, ...opt });
  if (ev.shift && last) {
    const dir = lockAngle(last, ev.p, opt.prevDir);
    const hard = r.kind && r.kind !== 'near' && r.kind !== 'align' && r.kind !== 'grid';
    const q = hard ? r : ev.p, t = (q.x - last.x) * dir.x + (q.y - last.y) * dir.y;
    r = { x: last.x + dir.x * t, y: last.y + dir.y * t, kind: hard ? r.kind : 'angle', guides: [[last, { x: last.x + dir.x * t, y: last.y + dir.y * t }]] };
  }
  return r;
}
