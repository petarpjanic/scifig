// Example plugin: AM halftone screen. A plugin is a function that receives the app and registers things.
// Copy this file as a starting point, then add it to plugins/index.js.
export default function (app) {
  const SPOTS = {
    round: (x, y) => 1 - Math.hypot(x, y) / Math.SQRT2,                       // x,y in -1..1 across one cell
    euclidean: (x, y) => 0.5 + 0.25 * (Math.cos(Math.PI * x) + Math.cos(Math.PI * y)),
    line: (x, y) => 1 - Math.abs(y),
    diamond: (x, y) => 1 - (Math.abs(x) + Math.abs(y)) / 2,
  };
  // coverage (0..1) of the dot for tone t at pixel (px,py), supersampled for smooth edges
  function screen(px, py, t, cell, ang, spot, aa) {
    const c = Math.cos(ang), s = Math.sin(ang), n = aa ? 3 : 1; let hit = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = px + (i + 0.5) / n, y = py + (j + 0.5) / n;
      const u = (x * c + y * s) / cell, v = (-x * s + y * c) / cell;
      if (spot((u - Math.floor(u)) * 2 - 1, (v - Math.floor(v)) * 2 - 1) > 1 - t) hit++;
    }
    return hit / (n * n);
  }
  app.registerFilter({
    id: 'halftone', title: 'Halftone', keywords: 'screen dots print am raster cmyk newspaper',
    desc: 'Clustered-dot (AM) halftone screen, mono or CMYK',
    params: [
      { id: 'cell', label: 'Cell size (px)', type: 'range', min: 2, max: 80, step: 0.5, default: 8 },
      { id: 'angle', label: 'Angle (°)', type: 'range', min: 0, max: 90, default: 45 },
      { id: 'spot', label: 'Dot shape', type: 'select', options: Object.keys(SPOTS), default: 'round' },
      { id: 'mode', label: 'Mode', type: 'select', options: ['mono', 'cmyk'], default: 'mono' },
      { id: 'aa', label: 'Smooth edges', type: 'check', default: true },
      { id: 'inRes', label: 'Input resolution (%)', type: 'range', min: 5, max: 100, default: 100 },
      { id: 'outRes', label: 'Output resolution (%)', type: 'range', min: 5, max: 100, default: 100 },
    ],
    apply(src, p) { return app.lib.withResolution(src, p.inRes, p.outRes, img => this.screenImage(img, p)); },
    screenImage(img, p) {
      const { width: w, height: h, data: d } = img, spot = SPOTS[p.spot] || SPOTS.round, rad = a => a * Math.PI / 180;
      // the spot functions are not linear in area, so remap tone through the measured coverage curve
      const N = 64, cov = new Float32Array(N + 1);
      for (let k = 0; k <= N; k++) { let a = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) if (spot((i + 0.5) / 20 - 1, (j + 0.5) / 20 - 1) > 1 - k / N) a++; cov[k] = a / 1600; }
      const tone = t => { let k = 0; while (k < N && cov[k] < t) k++; return k / N; };
      const T = new Float32Array(256); for (let i = 0; i < 256; i++) T[i] = tone(i / 255);
      const angles = p.mode === 'cmyk' ? [p.angle - 30, p.angle + 30, p.angle - 45, p.angle] : [p.angle];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (p.mode === 'mono') {
          const ink = 255 - Math.round(app.lib.luma(d[i], d[i + 1], d[i + 2]));
          const v = 255 * (1 - screen(x, y, T[ink], p.cell, rad(angles[0]), spot, p.aa));
          d[i] = d[i + 1] = d[i + 2] = v;
        } else {
          const k = 255 - Math.max(d[i], d[i + 1], d[i + 2]), inv = k < 255 ? 255 / (255 - k) : 0;
          const cmy = [0, 1, 2].map(c => Math.round((255 - d[i + c] - k) * inv));
          const kd = screen(x, y, T[k], p.cell, rad(angles[3]), spot, p.aa);
          for (let c = 0; c < 3; c++) d[i + c] = 255 * (1 - screen(x, y, T[cmy[c]], p.cell, rad(angles[c]), spot, p.aa)) * (1 - kd);
        }
      }
      return img;
    },
  });
}
