/**
 * Web Worker: monocular depth estimation with Depth Anything V2 (small),
 * running fully locally via ONNX Runtime Web. Nothing is sent to any AI
 * service — the model file is fetched once (then cached in the browser's
 * Cache API) and inference happens on this machine, so it costs nothing.
 *
 * Protocol (worker ← main):
 *   { type: 'init', ortBase }                       configure wasm asset path
 *   { type: 'estimate', id, bitmap, sources }       run depth on an ImageBitmap
 * Protocol (worker → main):
 *   { type: 'progress', id, phase, loaded, total }  model download progress
 *   { type: 'result', id, depth, width, height }    Float32Array (transferred)
 *   { type: 'error', id, message }
 */

import * as ort from 'onnxruntime-web/webgpu';

const MODEL_CACHE = 'relief-depth-models-v1';
const MAX_SIDE = 518;      // DINOv2 backbone: multiples of 14, 518 = training res
const PATCH = 14;

let session = null;
let sessionPromise = null;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      ort.env.logLevel = 'fatal'; // fallbacks are handled explicitly below
      ort.env.wasm.wasmPaths = msg.ortBase;
      // Multi-threaded wasm needs crossOriginIsolated (COOP/COEP headers),
      // which plain static hosting doesn't provide — pin to 1 in that case.
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency ?? 1))
        : 1;
      ort.env.wasm.proxy = false;
      return;
    }
    if (msg.type === 'estimate') {
      // Loading the session is memoized so concurrent requests share one download.
      sessionPromise ??= loadSession(msg.sources, msg.id);
      session = await sessionPromise;
      const { depth, width, height } = await estimate(session, msg.bitmap);
      msg.bitmap.close?.();
      self.postMessage({ type: 'result', id: msg.id, depth, width, height }, [depth.buffer]);
    }
  } catch (err) {
    if (msg.type === 'estimate') sessionPromise = null; // allow retry after failure
    self.postMessage({ type: 'error', id: msg.id, message: err?.message ?? String(err) });
  }
};

/** Fetch model bytes with progress reporting, backed by the Cache API. */
async function fetchModel(url, id) {
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // Cache API can be unavailable (private browsing); plain fetch still works.
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  let bytes;
  if (reader) {
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      self.postMessage({ type: 'progress', id, phase: 'download', loaded, total });
    }
    bytes = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  if (cache) {
    try {
      await cache.put(url, new Response(bytes.slice().buffer, {
        headers: { 'content-type': 'application/octet-stream' },
      }));
    } catch {
      // Quota exceeded etc. — caching is best-effort.
    }
  }
  return bytes.buffer;
}

/** Try model sources in order; prefer WebGPU, fall back to WASM (CPU). */
async function loadSession(sources, id) {
  let modelBytes = null;
  const errors = [];
  for (const url of sources) {
    try {
      self.postMessage({ type: 'progress', id, phase: 'connect', loaded: 0, total: 0 });
      modelBytes = await fetchModel(url, id);
      break;
    } catch (err) {
      errors.push(`${url}: ${err?.message ?? err}`);
    }
  }
  if (!modelBytes) {
    throw new Error(
      'Could not download the depth model. Check your internet connection ' +
      `(the model is fetched once, then cached). Details: ${errors.join(' | ')}`
    );
  }

  self.postMessage({ type: 'progress', id, phase: 'compile', loaded: 0, total: 0 });
  for (const providers of [['webgpu'], ['wasm']]) {
    try {
      return await ort.InferenceSession.create(modelBytes, {
        executionProviders: providers,
        graphOptimizationLevel: 'all',
      });
    } catch (err) {
      errors.push(`${providers[0]}: ${err?.message ?? err}`);
    }
  }
  throw new Error(`The depth model could not be initialized. ${errors.join(' | ')}`);
}

/** Aspect-preserving inference dims, both multiples of PATCH, longest = MAX_SIDE. */
function inferenceDims(w, h) {
  const scale = MAX_SIDE / Math.max(w, h);
  const rw = Math.max(PATCH, Math.round((w * scale) / PATCH) * PATCH);
  const rh = Math.max(PATCH, Math.round((h * scale) / PATCH) * PATCH);
  return { rw, rh };
}

/** Resize the bitmap and pack it as normalized NCHW float32 (ImageNet stats). */
function preprocess(bitmap, rw, rh) {
  const canvas = new OffscreenCanvas(rw, rh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, rw, rh);
  const { data } = ctx.getImageData(0, 0, rw, rh);

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const plane = rw * rh;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = (data[i * 4] / 255 - mean[0]) / std[0];
    chw[plane + i] = (data[i * 4 + 1] / 255 - mean[1]) / std[1];
    chw[2 * plane + i] = (data[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  return chw;
}

async function runWith(sess, bitmap, rw, rh) {
  const chw = preprocess(bitmap, rw, rh);
  const inputName = sess.inputNames[0];
  const outputName = sess.outputNames[0];
  const feeds = { [inputName]: new ort.Tensor('float32', chw, [1, 3, rh, rw]) };
  const results = await sess.run(feeds);
  const out = results[outputName];
  const dims = out.dims;
  // Output is [1, H, W] or [1, 1, H, W] depending on the export.
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  const depth = Float32Array.from(out.data);
  return { depth, width, height };
}

async function estimate(sess, bitmap) {
  const { rw, rh } = inferenceDims(bitmap.width, bitmap.height);
  try {
    return await runWith(sess, bitmap, rw, rh);
  } catch {
    // Some exports have static square inputs — retry at the canonical size.
    return await runWith(sess, bitmap, MAX_SIDE, MAX_SIDE);
  }
}
