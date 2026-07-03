/**
 * Model export: binary STL (3D printing), GLB (full scene/texture), OBJ.
 * All exports bake the display orientation (relief lying flat, +Y up) so the
 * file opens the way the user sees it on screen.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** A standalone mesh clone with the on-screen orientation baked in. */
function exportMesh(sourceMesh) {
  const mesh = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
  mesh.rotation.copy(sourceMesh.rotation);
  mesh.updateMatrixWorld(true);
  return mesh;
}

export function exportSTL(sourceMesh, filename) {
  const result = new STLExporter().parse(exportMesh(sourceMesh), { binary: true });
  download(new Blob([result], { type: 'model/stl' }), filename);
}

export function exportGLB(sourceMesh, filename) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      exportMesh(sourceMesh),
      (result) => {
        download(new Blob([result], { type: 'model/gltf-binary' }), filename);
        resolve();
      },
      (err) => reject(err instanceof Error ? err : new Error('GLB export failed.')),
      { binary: true }
    );
  });
}

export function exportOBJ(sourceMesh, filename) {
  const result = new OBJExporter().parse(exportMesh(sourceMesh));
  download(new Blob([result], { type: 'text/plain' }), filename);
}
