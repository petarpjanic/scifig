// Dimension helpers. Dimensions are decorative vector shapes: clicking an edge or a circle with the Dimension
// tool picks its end points, but nothing is attached afterwards.
import { dist, rectCorners } from './core.js';

const subsOf = s => s.subs ? [s, ...s.subs] : [s];
// Points of a shape that the Dimension tool can measure from.
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
