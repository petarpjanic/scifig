// Content-aware fill (the "magic eraser"): multi-scale PatchMatch. The hole is rebuilt from patches of its surroundings.
const R = 3; // patch radius (7×7)

function down2(L) {
  const w = Math.ceil(L.w / 2), h = Math.ceil(L.h / 2), col = new Float32Array(w * h * 3), hole = new Uint8Array(w * h), bad = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, r = 0, g = 0, b = 0, hl = 0, bd = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const xx = Math.min(L.w - 1, 2 * x + i), yy = Math.min(L.h - 1, 2 * y + j), k = yy * L.w + xx; if (L.hole[k]) hl = 1; if (L.bad[k]) { bd = 1; continue; } r += L.col[k * 3]; g += L.col[k * 3 + 1]; b += L.col[k * 3 + 2]; n++; }
    const o = y * w + x; hole[o] = hl; bad[o] = bd; if (n) { col[o * 3] = r / n; col[o * 3 + 1] = g / n; col[o * 3 + 2] = b / n; }
  }
  return { w, h, col, hole, bad };
}
// Fill the hole from its rim inwards with neighbour averages (starting guess, and the fallback when nothing can be copied).
function diffuse(L) {
  const { w, h, col } = L, todo = new Uint8Array(L.bad); let left = 0; for (let i = 0; i < todo.length; i++) left += todo[i];
  while (left > 0) {
    const done = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; if (!todo[k]) continue; let n = 0, r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (todo[q]) continue; r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; n++; }
      if (n) done.push(k, r / n, g / n, b / n); }
    if (!done.length) break;
    for (let i = 0; i < done.length; i += 4) { const k = done[i]; col[k * 3] = done[i + 1]; col[k * 3 + 1] = done[i + 2]; col[k * 3 + 2] = done[i + 3]; todo[k] = 0; left--; }
  }
}
function dilate(m, w, h, r) {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r) && !v; i++) v = m[y * w + i]; t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r) && !v; j++) v = t[j * w + x]; o[y * w + x] = v; }
  return o;
}
function solve(L, coarse, iters) {
  const { w, h, col, hole } = L, T = dilate(hole, w, h, R), nb = dilate(L.bad, w, h, R), valid = new Uint8Array(w * h), vlist = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) if (!nb[y * w + x]) { valid[y * w + x] = 1; vlist.push(y * w + x); }
  if (!vlist.length) return null;
  const nnf = new Int32Array(w * h), cost = new Float32Array(w * h), cl = (v, m) => v < 0 ? 0 : v > m ? m : v;
  const ssd = (p, q, best) => { const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0; let s = 0;
    for (let dy = -R; dy <= R; dy++) { const ty = cl(py + dy, h - 1) * w, sy = (qy + dy) * w;
      for (let dx = -R; dx <= R; dx++) { const a = (ty + cl(px + dx, w - 1)) * 3, b = (sy + qx + dx) * 3, d0 = col[a] - col[b], d1 = col[a + 1] - col[b + 1], d2 = col[a + 2] - col[b + 2]; s += d0 * d0 + d1 * d1 + d2 * d2; }
      if (s >= best) return s; }
    return s; };
  for (let p = 0; p < w * h; p++) { if (!T[p]) continue; let q = -1;
    if (coarse) { const cx = Math.min(coarse.w - 1, (p % w) >> 1), cy = Math.min(coarse.h - 1, ((p / w) | 0) >> 1), c = coarse.nnf[cy * coarse.w + cx], x = (c % coarse.w) * 2 + ((p % w) & 1), y = ((c / coarse.w) | 0) * 2 + (((p / w) | 0) & 1); if (x < w && y < h && valid[y * w + x]) q = y * w + x; }
    nnf[p] = q < 0 ? vlist[(Math.random() * vlist.length) | 0] : q; }
  const acc = new Float32Array(w * h * 3), cnt = new Uint16Array(w * h);
  for (let it = 0; it < iters; it++) {
    for (let p = 0; p < w * h; p++) if (T[p]) cost[p] = ssd(p, nnf[p], Infinity);
    for (let pm = 0; pm < 2; pm++) {
      const fwd = pm % 2 === 0, d = fwd ? -1 : 1;
      for (let i = 0; i < w * h; i++) { const p = fwd ? i : w * h - 1 - i; if (!T[p]) continue; const px = p % w, py = (p / w) | 0;
        const tryq = q => { if (q < 0 || q >= w * h || !valid[q] || q === nnf[p]) return; const c = ssd(p, q, cost[p]); if (c < cost[p]) { cost[p] = c; nnf[p] = q; } };
        if (px + d >= 0 && px + d < w && T[p + d]) tryq(nnf[p + d] - d);
        if (py + d >= 0 && py + d < h && T[p + d * w]) tryq(nnf[p + d * w] - d * w);
        for (let rad = Math.max(w, h); rad >= 1; rad >>= 1) { const c = nnf[p], x = (c % w) + Math.round((Math.random() * 2 - 1) * rad), y = ((c / w) | 0) + Math.round((Math.random() * 2 - 1) * rad); if (x >= 0 && y >= 0 && x < w && y < h) tryq(y * w + x); }
      }
    }
    acc.fill(0); cnt.fill(0);
    for (let p = 0; p < w * h; p++) { if (!T[p]) continue; const px = p % w, py = (p / w) | 0, q = nnf[p], qx = q % w, qy = (q / w) | 0;
      for (let dy = -R; dy <= R; dy++) { const y = py + dy; if (y < 0 || y >= h) continue;
        for (let dx = -R; dx <= R; dx++) { const x = px + dx; if (x < 0 || x >= w) continue; const k = y * w + x; if (!hole[k]) continue; const s = ((qy + dy) * w + qx + dx) * 3; acc[k * 3] += col[s]; acc[k * 3 + 1] += col[s + 1]; acc[k * 3 + 2] += col[s + 2]; cnt[k]++; } } }
    for (let k = 0; k < w * h; k++) if (hole[k] && cnt[k]) { col[k * 3] = acc[k * 3] / cnt[k]; col[k * 3 + 1] = acc[k * 3 + 1] / cnt[k]; col[k * 3 + 2] = acc[k * 3 + 2] / cnt[k]; }
  }
  L.nnf = nnf; return L;
}

// img: {width, height, data (RGBA)}; hole: Uint8Array, 1 = pixel to rebuild. Changes img.data in place; returns false if there is no hole.
export function inpaint(img, hole) {
  const W = img.width, H = img.height, D = img.data; let bx0 = W, by0 = H, bx1 = -1, by1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { n++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (!n) return false;
  const m = Math.round(Math.min(220, Math.max(30, Math.max(bx1 - bx0, by1 - by0) * 0.8)));
  const x0 = Math.max(0, bx0 - m), y0 = Math.max(0, by0 - m), x1 = Math.min(W - 1, bx1 + m), y1 = Math.min(H - 1, by1 + m), rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  const f = Math.max(1, Math.ceil(Math.sqrt(n / 40000))), w = Math.ceil(rw / f), h = Math.ceil(rh / f); // big holes are solved at reduced size
  const top = { w, h, col: new Float32Array(w * h * 3), hole: new Uint8Array(w * h), bad: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = 0, r = 0, g = 0, b = 0, hl = 0, bd = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const xx = Math.min(W - 1, x0 + x * f + i), yy = Math.min(H - 1, y0 + y * f + j), k = yy * W + xx; if (hole[k]) { hl = bd = 1; continue; } if (D[k * 4 + 3] < 8) { bd = 1; continue; } r += D[k * 4]; g += D[k * 4 + 1]; b += D[k * 4 + 2]; c++; }
    const o = y * w + x; top.hole[o] = hl; top.bad[o] = bd; if (c) { top.col[o * 3] = r / c; top.col[o * 3 + 1] = g / c; top.col[o * 3 + 2] = b / c; } }
  const pyr = [top]; while (Math.min(pyr[pyr.length - 1].w, pyr[pyr.length - 1].h) >= 48 && pyr.length < 6) pyr.push(down2(pyr[pyr.length - 1]));
  diffuse(pyr[pyr.length - 1]);
  let coarse = null;
  for (let l = pyr.length - 1; l >= 0; l--) {
    const L = pyr[l];
    if (coarse) for (let k = 0; k < L.w * L.h; k++) if (L.bad[k]) { const c = (Math.min(coarse.h - 1, ((k / L.w) | 0) >> 1) * coarse.w + Math.min(coarse.w - 1, (k % L.w) >> 1)) * 3; L.col[k * 3] = coarse.col[c]; L.col[k * 3 + 1] = coarse.col[c + 1]; L.col[k * 3 + 2] = coarse.col[c + 2]; }
    const s = solve(L, coarse && coarse.nnf ? coarse : null, l === 0 ? 3 : 5);
    coarse = s || L;
  }
  const at = (x, y, c) => top.col[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3 + c];
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const k = y * W + x; if (!hole[k]) continue;
    const fx = (x - x0 + 0.5) / f - 0.5, fy = (y - y0 + 0.5) / f - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    for (let c = 0; c < 3; c++) D[k * 4 + c] = f === 1 ? at(x - x0, y - y0, c) : at(ix, iy, c) * (1 - u) * (1 - v) + at(ix + 1, iy, c) * u * (1 - v) + at(ix, iy + 1, c) * (1 - u) * v + at(ix + 1, iy + 1, c) * u * v;
    D[k * 4 + 3] = 255; }
  return true;
}
