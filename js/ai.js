// Automatic selections with neural networks that run in the browser (transformers.js + ONNX Runtime; WebGPU when the
// browser has it, else WebAssembly). The library and the models are downloaded on first use and then cached.
//   Select Subject : briaai/RMBG-1.4 (salient object / person matting, about 45 MB)
//   Object Select  : onnx-community/sam2.1-hiera-tiny-ONNX (Segment Anything 2.1: clicks, a box, include and exclude
//                    points; about 77 MB with WebGPU, 61 MB without)
import { app } from './app.js';
import { mk, flatten } from './core.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
let lib = null, dev = null;
async function T() {
  if (!lib) { lib = await import(/* @vite-ignore */ CDN); lib.env.allowLocalModels = false; }
  return lib;
}
// Load a model on WebGPU when there is one; if that fails, on WebAssembly.
async function load(fn) {
  if (!dev) { try { dev = navigator.gpu && (await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; } catch (e) { dev = 'wasm'; } }
  try { return await fn(dev); } catch (e) { if (dev !== 'webgpu') throw e; console.warn('WebGPU model failed, using WebAssembly', e); dev = 'wasm'; return await fn(dev); }
}
const busy = msg => { app.toast(msg, 120000); return new Promise(r => setTimeout(r, 60)); };
function picture(doc, max) {
  const k = Math.min(1, max / Math.max(doc.w, doc.h)), c = flatten(doc, k, { background: '#ffffff' });
  return { c, k, key: doc.id + ':' + doc.layers.map(L => L.rev + (L.visible ? 'v' : 'h')).join(',') };
}
const raw = async c => { const t = await T(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height); return new t.RawImage(d.data, c.width, c.height, 4).rgb(); };
// alpha plane (Uint8, model size) -> document-sized canvas whose alpha is the mask
function toMask(doc, a, w, h, hard) {
  const c = mk(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = hard ? (a[i] > 127 ? 255 : 0) : a[i]; }
  x.putImageData(img, 0, 0);
  const o = mk(doc.w, doc.h), ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, 0, 0, doc.w, doc.h);
  return o;
}

let rmbg = null;
export async function subjectMask(doc) {
  await busy('Finding the subject… (the first use downloads the model, about 45 MB)');
  const t = await T();
  if (!rmbg) rmbg = await load(async device => ({
    model: await t.AutoModel.from_pretrained('briaai/RMBG-1.4', { config: { model_type: 'custom' }, device }),
    proc: await t.AutoProcessor.from_pretrained('briaai/RMBG-1.4', { config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 } } }),
  }));
  const { c } = picture(doc, 1600), img = await raw(c), { pixel_values } = await rmbg.proc(img), { output } = await rmbg.model({ input: pixel_values });
  const m = await t.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(c.width, c.height);
  return toMask(doc, m.data, c.width, c.height, false);
}

// Segment Anything 2.1. The picture is encoded once (until a layer changes); every prompt after that is quick.
const SAM = 'onnx-community/sam2.1-hiera-tiny-ONNX';
let sam = null, emb = null;
// prompt: { points: [{x, y, add}], box: {x0, y0, x1, y1} } in document pixels. Returns a document-sized mask canvas.
// pick: 'best' (highest predicted quality) or 'small' (the smallest good mask: a part rather than the whole)
export async function objectMask(doc, prompt, pick = 'best') {
  const t = await T();
  if (!sam) { await busy('Loading the object model… (the first use downloads about 60–80 MB)');
    sam = await load(async device => ({ model: await t.Sam2Model.from_pretrained(SAM, { device, dtype: device === 'webgpu' ? 'fp16' : 'quantized' }), proc: await t.AutoProcessor.from_pretrained(SAM) })); }
  const pic = picture(doc, 1024);
  if (!emb || emb.key !== pic.key) { await busy('Looking at the picture…'); const inputs = await sam.proc(await raw(pic.c)); emb = { key: pic.key, inputs, e: await sam.model.get_image_embeddings(inputs), k: pic.k, w: pic.c.width, h: pic.c.height }; }
  const [rh, rw] = emb.inputs.reshaped_input_sizes[0], sx = rw / emb.w * emb.k, sy = rh / emb.h * emb.k, pts = prompt.points || [], b = prompt.box, feeds = { ...emb.e };
  if (pts.length) {
    feeds.input_points = new t.Tensor('float32', Float32Array.from(pts.flatMap(p => [p.x * sx, p.y * sy])), [1, 1, pts.length, 2]);
    feeds.input_labels = new t.Tensor('int64', BigInt64Array.from(pts.map(p => p.add === false ? 0n : 1n)), [1, 1, pts.length]);
  }
  if (b) feeds.input_boxes = new t.Tensor('float32', Float32Array.from([b.x0 * sx, b.y0 * sy, b.x1 * sx, b.y1 * sy]), [1, 1, 4]);
  const out = await sam.model(feeds);
  const [m] = await sam.proc.post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes, { binarize: false });
  const nd = m.dims.length, n = m.dims[nd - 3], h = m.dims[nd - 2], w = m.dims[nd - 1], sc = out.iou_scores.data; let best = 0;
  const src = m.data;
  for (let i = 1; i < n; i++) if (sc[i] > sc[best]) best = i;
  if (pick === 'small') { let area = Infinity; for (let i = 0; i < n; i++) { if (sc[i] < 0.6 * sc[best]) continue; let c = 0; for (let j = i * w * h, e = j + w * h; j < e; j++) if (src[j] > 0) c++; if (c > 0 && c < area) { area = c; best = i; } } }
  const a = new Uint8Array(w * h), o = best * w * h; // logits -> soft edge
  for (let i = 0; i < w * h; i++) a[i] = 255 / (1 + Math.exp(-2 * src[o + i]));
  app.toast('Done', 800);
  const c = toMask(doc, a, w, h, false);
  if (b) { // stay close to the box
    const mx = Math.max(8, (b.x1 - b.x0) * 0.04), my = Math.max(8, (b.y1 - b.y0) * 0.04), x = c.getContext('2d');
    x.globalCompositeOperation = 'destination-in'; x.fillRect(b.x0 - mx, b.y0 - my, b.x1 - b.x0 + 2 * mx, b.y1 - b.y0 + 2 * my);
  }
  return c;
}
// A rough selection (lasso, marquee, wand…) as a prompt: the box around it. null when it is empty.
export function selectionBox(doc, sel) {
  const k = Math.min(1, 1024 / Math.max(doc.w, doc.h)), w = Math.max(1, Math.round(doc.w * k)), h = Math.max(1, Math.round(doc.h * k)), c = mk(w, h), x = c.getContext('2d');
  x.drawImage(sel, 0, 0, w, h);
  const a = x.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (a[(y * w + i) * 4 + 3] > 127) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k };
}

// ---------- neural inpainting (MI-GAN, about 28 MB) for the Remove tool and Content-Aware Fill ----------
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
let migan = null;
// rgba: Uint8ClampedArray of a w×h crop; hole: Uint8Array (1 = rebuild). Writes the rebuilt pixels into rgba.
export async function neuralFill(rgba, hole, w, h, polarity = 0) {
  if (!migan) {
    const ort = await import(/* @vite-ignore */ ORT + 'esm/ort.min.js'); ort.env.wasm.wasmPaths = ORT;
    migan = { ort, s: await ort.InferenceSession.create('https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx', { executionProviders: ['wasm'] }) };
  }
  const { ort, s } = migan, n = w * h, img = new Uint8Array(n * 3), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) { img[i] = rgba[i * 4]; img[n + i] = rgba[i * 4 + 1]; img[2 * n + i] = rgba[i * 4 + 2]; m[i] = (hole[i] ? 0 : 255) ^ (polarity ? 255 : 0); }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('uint8', img, [1, 3, h, w]), [s.inputNames[1]]: new ort.Tensor('uint8', m, [1, 1, h, w]) }), r = out[s.outputNames[0]].data;
  for (let i = 0; i < n; i++) if (hole[i]) { rgba[i * 4] = r[i]; rgba[i * 4 + 1] = r[n + i]; rgba[i * 4 + 2] = r[2 * n + i]; rgba[i * 4 + 3] = 255; }
}
