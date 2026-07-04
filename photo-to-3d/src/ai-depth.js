/**
 * Main-thread client for the AI depth worker.
 *
 * The neural network (Depth Anything V2 small) runs entirely in the user's
 * browser — no AI service, no API key, no metered usage. Model sources are
 * tried in order: a locally hosted copy first (for self-hosted / offline
 * setups), then the public Hugging Face CDN, smallest variant first.
 */

const LOCAL_MODEL = 'models/depth-anything-v2-small.onnx';
const HF_BASE = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/';
const HF_VARIANTS = ['model_quantized.onnx', 'model_fp16.onnx', 'model.onnx'];

/** AI depth needs a real origin: workers cannot start on file:// pages. */
export function aiDepthSupported() {
  return typeof Worker === 'function' && location.protocol !== 'file:';
}

export class AiDepth {
  /** @param {(text: string) => void} onProgress status line updates */
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map(); // id → {resolve, reject}
  }

  _ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('dist/depth-worker.js', document.baseURI), { type: 'module' });
    this.worker.postMessage({
      type: 'init',
      ortBase: new URL('dist/ort/', document.baseURI).href,
    });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The AI depth worker failed to start.');
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.worker.terminate();
      this.worker = null;
    };
  }

  _onMessage(msg) {
    const entry = this.pending.get(msg.id);
    if (msg.type === 'progress') {
      if (msg.phase === 'download') {
        const mb = (msg.loaded / 1e6).toFixed(0);
        const totalMb = msg.total ? ` of ${(msg.total / 1e6).toFixed(0)}` : '';
        this.onProgress(`Downloading depth model (one-time)… ${mb}${totalMb} MB`);
      } else if (msg.phase === 'compile') {
        this.onProgress('Preparing the neural network…');
      } else {
        this.onProgress('Contacting model host…');
      }
      return;
    }
    if (!entry) return;
    this.pending.delete(msg.id);
    if (msg.type === 'result') {
      entry.resolve({ depth: msg.depth, width: msg.width, height: msg.height });
    } else {
      entry.reject(new Error(msg.message));
    }
  }

  /**
   * Estimate depth for an image. Returns { depth: Float32Array, width, height }
   * where larger values mean nearer to the camera.
   * @param {ImageBitmap|HTMLImageElement} image
   */
  async estimate(image) {
    if (!aiDepthSupported()) {
      throw new Error(
        'AI depth needs the app to be served over http(s) — run "npx serve" ' +
        'in the app folder. Brightness mode works everywhere.'
      );
    }
    this._ensureWorker();

    // The worker needs a transferable copy; keep the caller's image usable.
    const bitmap = await createImageBitmap(image);
    const id = this.nextId++;
    const sources = [
      new URL(LOCAL_MODEL, document.baseURI).href,
      ...HF_VARIANTS.map((v) => HF_BASE + v),
    ];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'estimate', id, bitmap, sources }, [bitmap]);
    });
  }
}
