// Dimensions that are attached to geometry. An attached dimension follows the points it measures (annotation),
// and typing a new length, or locking it, moves the geometry instead (constraint), as in CAD.
// A dimension stores ra / rb = {id: shape id, k: anchor key} for its two ends and lock = length in px (or null).
import { Doc, dist, rectCorners, transformShape, mTranslate, smoothShape } from './core.js';

const subsOf = s => s.subs ? [s, ...s.subs] : [s];
// Points of a shape that a dimension can hold on to.
export function anchors(s) {
  if (s.type === 'path') { const out = []; subsOf(s).forEach((sp, si) => sp.nodes.forEach((n, i) => out.push({ x: n.x, y: n.y, k: si + ':' + i }))); return out; }
  if (s.type === 'rect') return [...rectCorners(s).map((p, i) => ({ x: p.x, y: p.y, k: 'c' + i })), { x: s.x + s.w / 2, y: s.y + s.h / 2, k: 'm' }];
  if (s.type === 'ellipse') { const c = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0); return [...[[s.rx, 0], [0, s.ry], [-s.rx, 0], [0, -s.ry]].map(([x, y], i) => ({ x: s.cx + x * c - y * si, y: s.cy + x * si + y * c, k: 'q' + i })), { x: s.cx, y: s.cy, k: 'm' }]; }
  if (s.type === 'text') return [{ x: s.x, y: s.y, k: 'm' }];
  return [];
}
export function findAnchor(doc, p, tol) {
  let best = null;
  for (const L of doc.layers) if (L.type === 'vector' && L.visible) for (const s of L.shapes) { if (s.type === 'dim') continue; for (const a of anchors(s)) { const dd = dist(a, p); if (dd <= tol && (!best || dd < best.d)) best = { d: dd, id: s.id, k: a.k }; } }
  return best ? { id: best.id, k: best.k } : null;
}
function at(doc, ref) { const o = ref && doc.findShape(ref.id); if (!o) return null; const a = anchors(o.s).find(q => q.k === ref.k); return a ? { x: a.x, y: a.y, o } : null; }
// Move one anchor of a shape to a new place: a path node moves alone, a rectangle corner resizes the rectangle,
// an ellipse quadrant changes its radius; anything else moves the whole shape.
function moveAnchor(o, k, to) {
  const s = o.s, a = anchors(s).find(q => q.k === k), dx = to.x - a.x, dy = to.y - a.y;
  if (s.type === 'path') { const [si, i] = k.split(':').map(Number), n = subsOf(s)[si].nodes[i]; for (const q of ['x', 'ix', 'ox']) if (n[q] != null) n[q] += dx; for (const q of ['y', 'iy', 'oy']) if (n[q] != null) n[q] += dy; smoothShape(s); }
  else if (s.type === 'rect' && !s.rot && k !== 'm') { const opp = rectCorners(s)[(+k[1] + 2) % 4]; s.x = Math.min(opp.x, to.x); s.y = Math.min(opp.y, to.y); s.w = Math.abs(to.x - opp.x); s.h = Math.abs(to.y - opp.y); }
  else if (s.type === 'ellipse' && !s.rot && k !== 'm') { if (+k[1] % 2 === 0) s.rx = Math.max(1e-6, Math.abs(to.x - s.cx)); else s.ry = Math.max(1e-6, Math.abs(to.y - s.cy)); }
  else transformShape(s, mTranslate(dx, dy));
  o.L.touch();
}
function drive(doc, s, len) {
  const A = s.a, B = s.b, L = dist(A, B); if (L < 1e-9 || !(len > 0)) return;
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L, ra = at(doc, s.ra), rb = at(doc, s.rb), same = ra && rb && ra.o.s === rb.o.s;
  if (same && ra.o.s.type === 'ellipse' && !ra.o.s.rot && s.ra.k[0] === 'q' && s.rb.k[0] === 'q' && (+s.ra.k[1] + 2) % 4 === +s.rb.k[1]) { ra.o.s[+s.ra.k[1] % 2 === 0 ? 'rx' : 'ry'] = len / 2; ra.o.L.touch(); } // a diameter
  else if (rb) { const to = { x: A.x + ux * len, y: A.y + uy * len }; if (same || !ra) moveAnchor(rb.o, s.rb.k, to); else { transformShape(rb.o.s, mTranslate(to.x - B.x, to.y - B.y)); rb.o.L.touch(); } }
  else if (ra) moveAnchor(ra.o, s.ra.k, { x: B.x - ux * len, y: B.y - uy * len });
  else s.b = { x: A.x + ux * len, y: A.y + uy * len };
}
// Bring every dimension up to date with its geometry; with enforce, locked dimensions push the geometry back.
export function syncDims(doc, enforce) {
  for (let pass = 0; pass < 4; pass++) {
    let pushed = false;
    for (const L of doc.layers) if (L.type === 'vector') for (const s of L.shapes) {
      if (s.type !== 'dim') continue;
      for (const [r, p] of [['ra', 'a'], ['rb', 'b']]) { if (!s[r]) continue; const q = at(doc, s[r]); if (!q) { delete s[r]; L.touch(); } else if (q.x !== s[p].x || q.y !== s[p].y) { s[p] = { x: q.x, y: q.y }; L.touch(); } }
      if (enforce && s.lock != null && (s.ra || s.rb) && Math.abs(dist(s.a, s.b) - s.lock) > 1e-6) { drive(doc, s, s.lock); pushed = true; }
    }
    if (!pushed) break;
  }
}
// Set the measured length: moves the attached geometry (and keeps a locked dimension locked at the new value).
export function driveDim(doc, s, len) { syncDims(doc, false); if (s.lock != null) s.lock = len; drive(doc, s, len); syncDims(doc, false); const o = doc.findShape(s.id); if (o) o.L.touch(); }
Doc.preCommit.push(doc => syncDims(doc, true));
