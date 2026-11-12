// Automatic selections with neural networks that run in the browser (transformers.js + ONNX).
// The library and the models are downloaded on first use and then cached by the browser.
//   Select Subject  : briaai/RMBG-1.4 (salient object / person matting, about 45 MB)
//   Object Select   : Xenova/slimsam-77-uniform (Segment Anything, click an object, about 15 MB)
import { app } from './app.js';
import { mk, flatten } from './core.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
let lib = null;
async function T() {
  if (!lib) { lib = await import(/* @vite-ignore */ CDN); lib.env.allowLocalModels = false; }
  return lib;
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
  if (!rmbg) rmbg = {
    model: await t.AutoModel.from_pretrained('briaai/RMBG-1.4', { config: { model_type: 'custom' } }),
    proc: await t.AutoProcessor.from_pretrained('briaai/RMBG-1.4', { config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 } } }),
  };
  const { c } = picture(doc, 1600), img = await raw(c), { pixel_values } = await rmbg.proc(img), { output } = await rmbg.model({ input: pixel_values });
  const m = await t.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(c.width, c.height);
  return toMask(doc, m.data, c.width, c.height, false);
}

let sam = null, emb = null;
export async function objectMask(doc, pts) { // pts: [{x, y, add}] in document pixels
  const t = await T();
  if (!sam) { await busy('Loading the object model… (first use downloads about 15 MB)'); sam = { model: await t.SamModel.from_pretrained('Xenova/slimsam-77-uniform'), proc: await t.AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform') }; }
  const pic = picture(doc, 1024);
  if (!emb || emb.key !== pic.key) { await busy('Looking at the picture…'); const inputs = await sam.proc(await raw(pic.c)); emb = { key: pic.key, inputs, e: await sam.model.get_image_embeddings(inputs), w: pic.c.width, h: pic.c.height, k: pic.k }; }
  const rs = emb.inputs.reshaped_input_sizes[0], sx = rs[1] / emb.w, sy = rs[0] / emb.h;
  const input_points = new t.Tensor('float32', pts.flatMap(p => [p.x * emb.k * sx, p.y * emb.k * sy]), [1, 1, pts.length, 2]);
  const input_labels = new t.Tensor('int64', pts.map(p => BigInt(p.add === false ? 0 : 1)), [1, 1, pts.length]);
  const out = await sam.model({ ...emb.e, input_points, input_labels });
  const masks = await sam.proc.post_process_masks(out.pred_masks, emb.inputs.original_sizes, emb.inputs.reshaped_input_sizes);
  const mt = masks[0], [, n, h, w] = mt.dims.length === 4 ? mt.dims : [1, ...mt.dims], sc = out.iou_scores.data; let best = 0;
  for (let i = 1; i < n; i++) if (sc[i] > sc[best]) best = i;
  const a = new Uint8Array(w * h), src = mt.data; for (let i = 0; i < w * h; i++) a[i] = src[best * w * h + i] ? 255 : 0;
  app.toast('Done', 800);
  return toMask(doc, a, w, h, true);
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
