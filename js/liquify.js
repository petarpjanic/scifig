// Liquify: a displacement field over one layer. Every pixel x shows base(x + D(x)), sampled bilinearly with
// premultiplied alpha, so strokes never resample earlier strokes (no blur build-up) and Restore can return to the
// original. Coordinates are layer pixels with pixel centres on integers; the field is stored every f pixels.
import { mk } from './core.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = t => t * t * (3 - 2 * t);

export class Warp {
  constructor(canvas) {
    const w = this.w = Math.max(2, canvas.width), h = this.h = Math.max(2, canvas.height);
    this.f = w * h > 6e6 ? 2 : 1; // displacements are smooth: half resolution on big layers saves memory
    this.fw = Math.max(2, Math.ceil((w - 1) / this.f) + 1); this.fh = Math.max(2, Math.ceil((h - 1) / this.f) + 1);
    this.D = new Float32Array(this.fw * this.fh * 2);
    this.base = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  }
  // bilinear sample of a cell grid g (n values per cell) at pixel position (x, y) into out
  static at(g, fw, fh, f, n, x, y, out) {
    const u = clamp(x / f, 0, fw - 1), v = clamp(y / f, 0, fh - 1), i = Math.min(u | 0, fw - 2), j = Math.min(v | 0, fh - 2), a = u - i, b = v - j;
    const k = (j * fw + i) * n, k2 = k + fw * n;
    for (let c = 0; c < n; c++) out[c] = (g[k + c] * (1 - a) + g[k + n + c] * a) * (1 - b) + (g[k2 + c] * (1 - a) + g[k2 + n + c] * a) * b;
    return out;
  }
  // Redraw the pixel box [x0, x1) × [y0, y1) of ctx from the base picture and the field.
  render(ctx, x0, y0, x1, y1) {
    const w = this.w, h = this.h, B = this.base, d = [0, 0];
    x0 = clamp(Math.floor(x0), 0, w); y0 = clamp(Math.floor(y0), 0, h); x1 = clamp(Math.ceil(x1), 0, w); y1 = clamp(Math.ceil(y1), 0, h);
    if (x1 <= x0 || y1 <= y0) return;
    const img = ctx.createImageData(x1 - x0, y1 - y0), o = img.data;
    let q = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, q += 4) {
      Warp.at(this.D, this.fw, this.fh, this.f, 2, x, y, d);
      const sx = clamp(x + d[0], 0, w - 1), sy = clamp(y + d[1], 0, h - 1), i = Math.min(sx | 0, w - 2), j = Math.min(sy | 0, h - 2), a = sx - i, b = sy - j;
      const k00 = (j * w + i) * 4, k10 = k00 + 4, k01 = k00 + w * 4, k11 = k01 + 4;
      const a00 = B[k00 + 3] * (1 - a) * (1 - b), a10 = B[k10 + 3] * a * (1 - b), a01 = B[k01 + 3] * (1 - a) * b, a11 = B[k11 + 3] * a * b, A = a00 + a10 + a01 + a11;
      if (A <= 0) continue;
      for (let c = 0; c < 3; c++) o[q + c] = (B[k00 + c] * a00 + B[k10 + c] * a10 + B[k01 + c] * a01 + B[k11 + c] * a11) / A;
      o[q + 3] = A;
    }
    ctx.putImageData(img, x0, y0);
  }
  // One brush dab centred at (cx, cy), radius R, hardness 0..1, optional per-cell limit sel (0..1, e.g. a selection).
  //   push    (a, b): the brush moved by (a, b) and drags the pixels along
  //   twirl   a: rotation in radians at the centre
  //   scale   a: > 0 pulls pixels in (pucker), < 0 pushes them out (bloat)
  //   restore a: share of the way back to the original
  // Returns the changed pixel box [x0, y0, x1, y1].
  dab(cx, cy, R, hard, kind, a, b, sel) {
    const f = this.f, fw = this.fw, fh = this.fh, D = this.D;
    const i0 = clamp(Math.floor((cx - R) / f), 0, fw - 1), i1 = clamp(Math.ceil((cx + R) / f), 0, fw - 1), j0 = clamp(Math.floor((cy - R) / f), 0, fh - 1), j1 = clamp(Math.ceil((cy + R) / f), 0, fh - 1);
    const nw = i1 - i0 + 1, out = new Float32Array(nw * (j1 - j0 + 1) * 2), old = [0, 0], soft = R * (1 - hard) + 1e-3;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i * f, py = j * f, k = (j * fw + i) * 2, t = ((j - j0) * nw + i - i0) * 2;
      let s = smooth(clamp((R - Math.hypot(px - cx, py - cy)) / soft, 0, 1));
      if (sel) s *= sel[j * fw + i];
      if (s <= 0) { out[t] = D[k]; out[t + 1] = D[k + 1]; continue; }
      if (kind === 'restore') { out[t] = D[k] * (1 - a * s); out[t + 1] = D[k + 1] * (1 - a * s); continue; }
      let qx, qy; // where this pixel now takes its picture from, in the picture as it was before the dab
      if (kind === 'push') { qx = px - a * s; qy = py - b * s; }
      else if (kind === 'twirl') { const c = Math.cos(a * s), n = -Math.sin(a * s), dx = px - cx, dy = py - cy; qx = cx + dx * c - dy * n; qy = cy + dx * n + dy * c; }
      else { const k2 = 1 + a * s; qx = cx + (px - cx) * k2; qy = cy + (py - cy) * k2; }
      Warp.at(D, fw, fh, f, 2, qx, qy, old);
      out[t] = qx - px + old[0]; out[t + 1] = qy - py + old[1];
    }
    for (let j = j0; j <= j1; j++) D.set(out.subarray((j - j0) * nw * 2, (j - j0 + 1) * nw * 2), (j * fw + i0) * 2);
    return [(i0 - 1) * f, (j0 - 1) * f, (i1 + 1) * f + 1, (j1 + 1) * f + 1];
  }

  // Move selection: W (cells, 0..1) is 1 on what moves and fades out over the feather. beginMove keeps the field as
  // it was; move(vx, vy) shows the selection moved by (vx, vy) with the surroundings stretched. Returns the pixel box.
  beginMove(W) {
    const fw = this.fw, fh = this.fh; let i0 = fw, j0 = fh, i1 = -1, j1 = -1;
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (W[j * fw + i] > 1e-3) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    this.mv = i1 < 0 ? null : { W, D0: this.D.slice(), box: [i0, j0, i1, j1], last: null };
    return !!this.mv;
  }
  move(vx, vy) {
    const M = this.mv; if (!M) return null;
    const f = this.f, fw = this.fw, fh = this.fh, D = this.D, w1 = [0], d0 = [0, 0], [bi0, bj0, bi1, bj1] = M.box;
    // cells that can change: the moved shape where it was and where it is now
    const i0 = clamp(Math.min(bi0, Math.floor(bi0 + vx / f)) - 1, 0, fw - 1), i1 = clamp(Math.max(bi1, Math.ceil(bi1 + vx / f)) + 1, 0, fw - 1);
    const j0 = clamp(Math.min(bj0, Math.floor(bj0 + vy / f)) - 1, 0, fh - 1), j1 = clamp(Math.max(bj1, Math.ceil(bj1 + vy / f)) + 1, 0, fh - 1);
    const L = M.last; // put back the cells of the previous position that the new one does not cover
    if (L) for (let j = L[1]; j <= L[3]; j++) for (let i = L[0]; i <= L[2]; i++) if (i < i0 || i > i1 || j < j0 || j > j1) { const k = (j * fw + i) * 2; D[k] = M.D0[k]; D[k + 1] = M.D0[k + 1]; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // the source q = p - t·v with t = W(q): a root of t - W(p - t·v) on [0, 1], found by bisection (no fold-over trouble)
      const px = i * f, py = j * f; let lo = 0, hi = 1;
      if (Warp.at(M.W, fw, fh, f, 1, px, py, w1)[0] <= 1e-4 && Warp.at(M.W, fw, fh, f, 1, px - vx, py - vy, w1)[0] <= 1e-4) { const k = (j * fw + i) * 2; D[k] = M.D0[k]; D[k + 1] = M.D0[k + 1]; continue; }
      for (let it = 0; it < 9; it++) { const t = (lo + hi) / 2; if (t - Warp.at(M.W, fw, fh, f, 1, px - t * vx, py - t * vy, w1)[0] < 0) lo = t; else hi = t; }
      const t = (lo + hi) / 2, qx = px - t * vx, qy = py - t * vy;
      Warp.at(M.D0, fw, fh, f, 2, qx, qy, d0);
      const k = (j * fw + i) * 2; D[k] = qx - px + d0[0]; D[k + 1] = qy - py + d0[1];
    }
    const prev = L || [i0, j0, i1, j1]; M.last = [i0, j0, i1, j1];
    return [(Math.min(i0, prev[0]) - 1) * f, (Math.min(j0, prev[1]) - 1) * f, (Math.max(i1, prev[2]) + 1) * f + 1, (Math.max(j1, prev[3]) + 1) * f + 1];
  }
  endMove() { this.mv = null; }

  // A doc selection as a cell grid in layer coordinates: as it is (for limiting the brush), or with `feather` as the
  // Move weight: 1 on the selection, fading to 0 at `feather` pixels away from it (chamfer distance, two passes).
  cells(sel, ox, oy, feather = 0) {
    const fw = this.fw, fh = this.fh, f = this.f, n = fw * fh, c = mk(fw, fh), x = c.getContext('2d');
    x.drawImage(sel, -ox / f, -oy / f, sel.width / f, sel.height / f);
    const a = x.getImageData(0, 0, fw, fh).data, W = new Float32Array(n);
    for (let i = 0; i < n; i++) W[i] = a[i * 4 + 3] / 255;
    if (!(feather > 0)) return W;
    const g = new Float32Array(n), r2 = Math.SQRT2;
    for (let i = 0; i < n; i++) g[i] = W[i] >= 0.5 ? 0 : 1e9;
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      const k = j * fw + i; let v = g[k];
      if (i > 0) v = Math.min(v, g[k - 1] + 1);
      if (j > 0) { v = Math.min(v, g[k - fw] + 1); if (i > 0) v = Math.min(v, g[k - fw - 1] + r2); if (i < fw - 1) v = Math.min(v, g[k - fw + 1] + r2); }
      g[k] = v;
    }
    for (let j = fh - 1; j >= 0; j--) for (let i = fw - 1; i >= 0; i--) {
      const k = j * fw + i; let v = g[k];
      if (i < fw - 1) v = Math.min(v, g[k + 1] + 1);
      if (j < fh - 1) { v = Math.min(v, g[k + fw] + 1); if (i < fw - 1) v = Math.min(v, g[k + fw + 1] + r2); if (i > 0) v = Math.min(v, g[k + fw - 1] + r2); }
      g[k] = v;
    }
    for (let i = 0; i < n; i++) W[i] = Math.max(W[i], smooth(clamp(1 - g[i] * f / feather, 0, 1)));
    return W;
  }
}
