/**
 * Image → depth-map pipeline.
 *
 * Converts an image into a normalized Float32 heightfield:
 *   1. Resample the image onto the working grid (aspect-preserving).
 *   2. Perceptual luminance extraction.
 *   3. Contrast normalization (levels stretch, outlier-resistant).
 *   4. Separable Gaussian smoothing (edge-preserving enough for relief work).
 *   5. Optional inversion (for lithophanes: bright = thin).
 */

/**
 * Decode a File/Blob into an ImageBitmap, honoring EXIF orientation.
 * Falls back to an <img> element for browsers without createImageBitmap options.
 * @param {Blob} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img> path (e.g. unsupported options or codec quirks)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The file could not be decoded as an image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Compute the working grid dimensions for an image, capped at maxDim on the
 * longest side, preserving aspect ratio. Minimum 2 samples per axis.
 */
export function gridSizeFor(imgWidth, imgHeight, maxDim) {
  const scale = maxDim / Math.max(imgWidth, imgHeight);
  const w = Math.max(2, Math.round(imgWidth * Math.min(1, scale)));
  const h = Math.max(2, Math.round(imgHeight * Math.min(1, scale)));
  return { w, h };
}

/**
 * Rasterize the image at grid resolution and return raw RGBA pixels.
 * The canvas 2D resampler gives good-quality downscaling for our purposes.
 */
export function samplePixels(image, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Rec. 709 luma from RGBA bytes → Float32Array in [0, 1]. */
export function luminance(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
  }
  return out;
}

/**
 * Stretch values so the 1st–99th percentile spans [0, 1]. Percentiles (rather
 * than min/max) keep a few stray dark/bright pixels from flattening the model.
 * A perfectly uniform image maps to a flat 0.5 field instead of dividing by zero.
 */
export function normalize(field) {
  const sorted = Float32Array.from(field).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const range = hi - lo;
  const out = new Float32Array(field.length);
  if (range < 1e-6) {
    out.fill(0.5);
    return out;
  }
  for (let i = 0; i < field.length; i++) {
    out[i] = Math.min(1, Math.max(0, (field[i] - lo) / range));
  }
  return out;
}

/** Build a normalized 1-D Gaussian kernel for the given sigma. */
function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return { kernel, radius };
}

/**
 * Separable Gaussian blur with clamped (edge-replicate) sampling.
 * sigma <= 0 returns the input untouched.
 */
export function gaussianBlur(field, w, h, sigma) {
  if (sigma <= 0) return field;
  const { kernel, radius } = gaussianKernel(sigma);
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += field[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Bilinear resample of a row-major scalar field to new dimensions. */
export function resampleBilinear(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  const xr = dw > 1 ? (sw - 1) / (dw - 1) : 0;
  const yr = dh > 1 ? (sh - 1) / (dh - 1) : 0;
  for (let y = 0; y < dh; y++) {
    const fy = y * yr;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = x * xr;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * Pipeline for a precomputed depth map (e.g. from the AI depth estimator):
 * resample onto the working grid, then smooth/normalize/invert exactly like
 * the brightness path so all sculpting controls behave identically.
 *
 * @param {Float32Array} depthMap  row-major, larger = nearer/higher
 * @param {number} dw  depth map width
 * @param {number} dh  depth map height
 * @param {number} imageW  original image width (sets grid aspect)
 * @param {number} imageH  original image height
 */
export function buildFieldFromMap(depthMap, dw, dh, imageW, imageH, { resolution, smoothing, invert }) {
  const { w, h } = gridSizeFor(imageW, imageH, resolution);
  let field = resampleBilinear(depthMap, dw, dh, w, h);
  field = gaussianBlur(field, w, h, smoothing);
  field = normalize(field);
  if (invert) {
    for (let i = 0; i < field.length; i++) field[i] = 1 - field[i];
  }
  return { field, w, h };
}

/**
 * Full pipeline: image → { field, w, h } where field is a Float32Array
 * heightfield in [0, 1], row-major, top row first.
 *
 * @param {ImageBitmap|HTMLImageElement} image
 * @param {object} opts
 * @param {number} opts.resolution  longest-side sample count (grid detail)
 * @param {number} opts.smoothing   Gaussian sigma in grid cells (0 = off)
 * @param {boolean} opts.invert     true → bright areas become low
 */
export function buildDepthField(image, { resolution, smoothing, invert }) {
  const iw = image.width;
  const ih = image.height;
  const { w, h } = gridSizeFor(iw, ih, resolution);
  const rgba = samplePixels(image, w, h);
  let field = luminance(rgba, w, h);
  field = gaussianBlur(field, w, h, smoothing);
  field = normalize(field);
  if (invert) {
    for (let i = 0; i < field.length; i++) field[i] = 1 - field[i];
  }
  return { field, w, h };
}
