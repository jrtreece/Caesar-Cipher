# Relief — turn any picture into a 3D model

A polished, entirely client-side web app that converts any photo into a
realistic, exportable 3D relief model. No uploads, no server, no account —
your pictures never leave the browser.

## Run it

Everything is pre-built. Either:

- **Double-click `index.html`** — it works straight from disk, or
- serve the folder: `npx serve photo-to-3d` (or `python3 -m http.server`)
  and open the printed URL.

Then drop, paste, or browse for any picture (PNG, JPEG, WebP, …).

## Features

- **Any picture in** — drag & drop anywhere, click to browse, or paste from
  the clipboard. EXIF orientation is respected, aspect ratio preserved.
- **AI depth (free, local, private)** — a real monocular depth-estimation
  neural network (Depth Anything V2 small) runs *inside your browser* via
  ONNX Runtime. Portraits and scenes pop out with true depth instead of
  brightness. No API key, no credits, no subscription usage, and the picture
  never leaves your machine. First use downloads the model once (≈25 MB from
  Hugging Face), then it's cached offline. Uses your GPU (WebGPU) when
  available, CPU otherwise. Requires the app to be served over http(s);
  the instant Brightness mode works everywhere, including from a local file.
- **Realistic preview** — physically based materials with image-based studio
  lighting, ACES tone mapping, and soft shadows. Material presets: photo
  print, sculpting clay, porcelain (lithophane), polished bronze, PLA plastic.
- **Live sculpting controls** — relief depth, physical model width, base
  thickness, Gaussian smoothing, and mesh detail (64–512 grid), plus height
  inversion for lithophanes. Rebuilds are coalesced so slider drags stay smooth.
- **Print-ready geometry** — “Solid” mode produces a watertight, manifold
  mesh (verified: every edge shared by exactly two triangles) sized in real
  millimetres, so STL exports slice cleanly.
- **Exports** — binary STL (3D printing), GLB (textured, for Blender/game
  engines/AR), OBJ, and a PNG render of the current view.

## How it works

1. Depth comes from one of two sources: **Brightness** converts the image to
   perceptual luminance (Rec. 709) on a working grid; **AI neural depth**
   runs Depth Anything V2 in a Web Worker (WebGPU with WASM fallback) and
   bilinearly resamples its depth map onto the same grid. The AI result is
   cached per picture, so sculpting sliders stay instant.
2. Levels are stretched between the 1st and 99th percentile so stray pixels
   can't flatten the model, then a separable Gaussian blur smooths sensor
   noise into printable surfaces.
3. The heightfield displaces a grid mesh; in Solid mode a flat bottom and
   hard-edged perimeter walls close it into a manifold slab.
4. The mesh is rendered with `MeshPhysicalMaterial` under a PMREM-filtered
   procedural studio environment, with the original photo as an sRGB texture.

## Development

```sh
npm install
npm run dev     # esbuild watch + local server
npm run build   # regenerate dist/app.js (committed, so users don't need npm)
```

Source layout:

| File | Responsibility |
| --- | --- |
| `src/depth.js` | image decoding → normalized heightfield pipeline |
| `src/ai-depth.js` | main-thread client for the AI depth worker |
| `src/depth-worker.js` | Depth Anything V2 inference via ONNX Runtime Web |
| `src/mesh.js` | heightfield → watertight indexed `BufferGeometry` |
| `src/viewer.js` | renderer, lighting, materials, camera |
| `src/exporters.js` | STL / GLB / OBJ download plumbing |
| `src/main.js` | UI wiring, rebuild scheduling, error handling |

The ONNX Runtime wasm binaries are vendored into `dist/ort/` by
`npm run assets`, so the only thing fetched at runtime is the model itself.
To self-host that too (fully offline use), download
[`model_quantized.onnx`](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx)
and save it as `models/depth-anything-v2-small.onnx` — the app checks that
local path before falling back to the Hugging Face CDN.
