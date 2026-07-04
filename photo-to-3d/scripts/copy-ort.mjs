// Vendor the ONNX Runtime Web wasm assets into dist/ort/ so the AI depth
// feature works without any CDN. The webgpu bundle imported by
// src/depth-worker.js resolves exactly one runtime: the .asyncify build,
// which serves both the WebGPU and plain WASM execution providers.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dest = path.join(root, 'dist', 'ort');

const FILES = [
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
];

await mkdir(dest, { recursive: true });
for (const f of FILES) {
  await copyFile(path.join(src, f), path.join(dest, f));
  console.log(`copied ${f}`);
}
