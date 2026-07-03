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

1. The image is resampled onto a working grid and converted to perceptual
   luminance (Rec. 709).
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
| `src/mesh.js` | heightfield → watertight indexed `BufferGeometry` |
| `src/viewer.js` | renderer, lighting, materials, camera |
| `src/exporters.js` | STL / GLB / OBJ download plumbing |
| `src/main.js` | UI wiring, rebuild scheduling, error handling |
