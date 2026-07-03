/**
 * Heightfield → 3D geometry.
 *
 * Builds an indexed BufferGeometry that is watertight (manifold) so STL
 * exports slice cleanly for 3D printing:
 *
 *   - Top surface: smooth-shaded displaced grid carrying the photo UVs.
 *   - Bottom: flat grid at z = 0, mirroring the top's tessellation so the
 *     perimeter edges match the walls exactly (no T-junctions).
 *   - Walls: one quad per perimeter edge with duplicated vertices, so the
 *     sides stay crisp instead of smearing into the top surface's normals.
 *
 * Coordinate system: the model lies in the XY plane (x right, y up in image
 * terms) and displaces along +Z. The caller rotates it flat for display.
 */

import * as THREE from 'three';

/**
 * @param {Float32Array} field  heightfield in [0,1], row-major, top row first
 * @param {number} w            samples across
 * @param {number} h            samples down
 * @param {object} opts
 * @param {number} opts.size       longest side of the model, world units (mm)
 * @param {number} opts.depth      relief height above the base, world units
 * @param {number} opts.base       base slab thickness, world units (>= 0.1)
 * @param {boolean} opts.solid     true → closed solid; false → top surface only
 * @returns {THREE.BufferGeometry}
 */
export function buildReliefGeometry(field, w, h, { size, depth, base, solid }) {
  const aspect = w / h;
  const sx = aspect >= 1 ? size : size * aspect;
  const sy = aspect >= 1 ? size / aspect : size;
  const baseZ = Math.max(0.1, base);

  const topCount = w * h;
  const perimEdges = 2 * (w - 1) + 2 * (h - 1);
  const vertCount = solid ? topCount * 2 + perimEdges * 4 : topCount;
  const triCount = solid
    ? 4 * (w - 1) * (h - 1) + 2 * perimEdges
    : 2 * (w - 1) * (h - 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const IndexArray = vertCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triCount * 3);

  // --- Top surface vertices (smooth, textured) ---
  // Image row 0 is the top of the picture → +Y in model space.
  const px = (x) => (x / (w - 1) - 0.5) * sx;
  const py = (y) => (0.5 - y / (h - 1)) * sy;
  const pz = (x, y) => baseZ + field[y * w + x] * depth;

  let v = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      positions[v * 3] = px(x);
      positions[v * 3 + 1] = py(y);
      positions[v * 3 + 2] = pz(x, y);
      uvs[v * 2] = x / (w - 1);
      uvs[v * 2 + 1] = 1 - y / (h - 1);
      v++;
    }
  }

  let t = 0;
  const quad = (a, b, c, d) => {
    // Two CCW triangles for the quad a-b-c-d (a=top-left … d going CW visually)
    indices[t++] = a; indices[t++] = c; indices[t++] = b;
    indices[t++] = a; indices[t++] = d; indices[t++] = c;
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      quad(a, a + 1, a + w + 1, a + w);
    }
  }

  if (solid) {
    // --- Bottom vertices (flat at z=0, wound to face -Z) ---
    const bottomStart = v;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        positions[v * 3] = px(x);
        positions[v * 3 + 1] = py(y);
        positions[v * 3 + 2] = 0;
        uvs[v * 2] = 0;
        uvs[v * 2 + 1] = 0;
        v++;
      }
    }
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = bottomStart + y * w + x;
        // Reverse winding so faces point downward
        quad(a, a + w, a + w + 1, a + 1);
      }
    }

    // --- Walls: duplicated vertices per perimeter edge for hard shading ---
    // Each edge contributes 4 vertices: top(i), top(j), bottom(j), bottom(i),
    // wound to face outward from the slab.
    const wall = (xi, yi, xj, yj) => {
      const zTi = pz(xi, yi);
      const zTj = pz(xj, yj);
      const startV = v;
      const corners = [
        [px(xi), py(yi), zTi],
        [px(xj), py(yj), zTj],
        [px(xj), py(yj), 0],
        [px(xi), py(yi), 0],
      ];
      for (const [cx, cy, cz] of corners) {
        positions[v * 3] = cx;
        positions[v * 3 + 1] = cy;
        positions[v * 3 + 2] = cz;
        uvs[v * 2] = 0;
        uvs[v * 2 + 1] = 0;
        v++;
      }
      indices[t++] = startV; indices[t++] = startV + 1; indices[t++] = startV + 2;
      indices[t++] = startV; indices[t++] = startV + 2; indices[t++] = startV + 3;
    };

    // Perimeter, traversed CCW when viewed from +Z (top): the i→j direction
    // below keeps every wall quad facing outward.
    for (let x = 0; x < w - 1; x++) wall(x, h - 1, x + 1, h - 1);      // south edge (y max → -Y side)
    for (let y = h - 1; y > 0; y--) wall(w - 1, y, w - 1, y - 1);      // east edge (+X side)
    for (let x = w - 1; x > 0; x--) wall(x, 0, x - 1, 0);              // north edge (+Y side)
    for (let y = 0; y < h - 1; y++) wall(0, y, 0, y + 1);              // west edge (-X side)
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Human-readable stats for the UI. */
export function geometryStats(geometry) {
  const bb = geometry.boundingBox;
  return {
    vertices: geometry.getAttribute('position').count,
    triangles: geometry.getIndex().count / 3,
    size: {
      x: bb.max.x - bb.min.x,
      y: bb.max.y - bb.min.y,
      z: bb.max.z - bb.min.z,
    },
  };
}
