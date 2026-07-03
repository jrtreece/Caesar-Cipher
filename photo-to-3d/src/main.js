/**
 * Relief — turn any picture into a 3D model.
 * App shell: file handling, controls wiring, rebuild scheduling, exports.
 */

import { decodeImage, buildDepthField } from './depth.js';
import { buildReliefGeometry, geometryStats } from './mesh.js';
import { Viewer, MATERIAL_PRESETS } from './viewer.js';
import { exportSTL, exportGLB, exportOBJ } from './exporters.js';

const $ = (id) => document.getElementById(id);

const state = {
  image: null,        // decoded ImageBitmap/HTMLImageElement
  imageName: 'model',
  building: false,    // a rebuild is in flight
  dirty: false,       // a rebuild was requested while one was in flight
  hasModel: false,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.body.innerHTML =
    '<div class="fatal">This app needs WebGL to render 3D. ' +
    'Please use a modern browser with hardware acceleration enabled.</div>';
  throw new Error('WebGL unavailable');
}

const viewer = new Viewer($('viewport'));

// Populate material preset dropdown from the single source of truth.
const presetSelect = $('material');
for (const [key, preset] of Object.entries(MATERIAL_PRESETS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = preset.label;
  presetSelect.appendChild(opt);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function controls() {
  return {
    resolution: Number($('resolution').value),
    smoothing: Number($('smoothing').value),
    depth: Number($('depth').value),
    base: Number($('base').value),
    size: Number($('size').value),
    invert: $('invert').checked,
    solid: $('solid').checked,
    material: presetSelect.value,
    texture: $('texture').checked,
    wireframe: $('wireframe').checked,
    autorotate: $('autorotate').checked,
  };
}

function syncSliderLabels() {
  const c = controls();
  $('resolution-value').textContent = `${c.resolution} px`;
  $('smoothing-value').textContent = c.smoothing === 0 ? 'off' : c.smoothing.toFixed(1);
  $('depth-value').textContent = `${c.depth.toFixed(0)} mm`;
  $('base-value').textContent = `${c.base.toFixed(1)} mm`;
  $('size-value').textContent = `${c.size.toFixed(0)} mm`;
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// ---------------------------------------------------------------------------
// Rebuild pipeline
// ---------------------------------------------------------------------------

/**
 * Rebuilds are coalesced: dragging a slider fires many requests, but only one
 * build runs at a time and at most one more is queued behind it.
 */
function requestRebuild() {
  if (!state.image) return;
  if (state.building) {
    state.dirty = true;
    return;
  }
  state.building = true;
  setStatus('Building model…');
  // Let the browser paint the status before the (synchronous) build work.
  requestAnimationFrame(() => setTimeout(runBuild, 0));
}

function runBuild() {
  try {
    const c = controls();
    const { field, w, h } = buildDepthField(state.image, {
      resolution: c.resolution,
      smoothing: c.smoothing,
      invert: c.invert,
    });
    const geometry = buildReliefGeometry(field, w, h, {
      size: c.size,
      depth: c.depth,
      base: c.base,
      solid: c.solid,
    });
    viewer.setGeometry(geometry);
    if (!state.hasModel) {
      viewer.frameMesh();
      state.hasModel = true;
      document.body.classList.add('has-model');
    }

    const stats = geometryStats(geometry);
    $('stat-tris').textContent = stats.triangles.toLocaleString();
    $('stat-verts').textContent = stats.vertices.toLocaleString();
    $('stat-size').textContent =
      `${stats.size.x.toFixed(0)} × ${stats.size.y.toFixed(0)} × ${stats.size.z.toFixed(1)} mm`;
    setStatus('Ready');
  } catch (err) {
    console.error(err);
    setStatus('Could not build the model from this image.', true);
  } finally {
    state.building = false;
    if (state.dirty) {
      state.dirty = false;
      requestRebuild();
    }
  }
}

function applyAppearance() {
  const c = controls();
  viewer.applyPreset(c.material, c.texture);
  viewer.setWireframe(c.wireframe);
  viewer.setAutoRotate(c.autorotate);
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus(`"${file.name}" is not an image file.`, true);
    return;
  }
  setStatus('Reading image…');
  try {
    const image = await decodeImage(file);
    if (state.image && typeof state.image.close === 'function') state.image.close();
    state.image = image;
    state.imageName = (file.name.replace(/\.[^.]+$/, '') || 'model').slice(0, 60);
    state.hasModel = false; // re-frame the camera for the new picture

    // Thumbnail in the sidebar
    const thumb = $('thumb');
    const tctx = thumb.getContext('2d');
    const scale = Math.min(thumb.width / image.width, thumb.height / image.height);
    const tw = image.width * scale;
    const th = image.height * scale;
    tctx.clearRect(0, 0, thumb.width, thumb.height);
    tctx.drawImage(image, (thumb.width - tw) / 2, (thumb.height - th) / 2, tw, th);
    document.body.classList.add('has-image');

    viewer.setTexture(image);
    applyAppearance();
    requestRebuild();
  } catch (err) {
    console.error(err);
    setStatus('That file could not be read as an image.', true);
  }
}

const fileInput = $('file-input');
fileInput.addEventListener('change', () => {
  loadFile(fileInput.files[0]);
  fileInput.value = ''; // allow re-selecting the same file
});
$('drop-zone').addEventListener('click', () => fileInput.click());
$('drop-zone').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

// Drag & drop anywhere on the page
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) loadFile(file);
  else setStatus('Drop an image file (PNG, JPEG, WebP…).', true);
});

// Paste an image from the clipboard
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) loadFile(file);
});

// ---------------------------------------------------------------------------
// Control wiring
// ---------------------------------------------------------------------------

// Geometry-affecting controls → rebuild
for (const id of ['resolution', 'smoothing', 'depth', 'base', 'size']) {
  $(id).addEventListener('input', () => {
    syncSliderLabels();
    requestRebuild();
  });
}
for (const id of ['invert', 'solid']) {
  $(id).addEventListener('change', requestRebuild);
}

// Appearance-only controls → no geometry rebuild needed
for (const id of ['material', 'texture', 'wireframe', 'autorotate']) {
  $(id).addEventListener('change', applyAppearance);
}

$('frame').addEventListener('click', () => viewer.frameMesh());

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function guardExport(fn) {
  return async () => {
    if (!viewer.mesh) {
      setStatus('Load a picture first — there is no model to export yet.', true);
      return;
    }
    try {
      setStatus('Exporting…');
      await fn();
      setStatus('Export saved.');
    } catch (err) {
      console.error(err);
      setStatus('Export failed.', true);
    }
  };
}

$('export-stl').addEventListener('click', guardExport(() =>
  exportSTL(viewer.mesh, `${state.imageName}.stl`)));
$('export-glb').addEventListener('click', guardExport(() =>
  exportGLB(viewer.mesh, `${state.imageName}.glb`)));
$('export-obj').addEventListener('click', guardExport(() =>
  exportOBJ(viewer.mesh, `${state.imageName}.obj`)));
$('export-png').addEventListener('click', guardExport(async () => {
  const blob = await viewer.snapshotBlob();
  if (!blob) throw new Error('Snapshot failed');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.imageName}-render.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}));

syncSliderLabels();
applyAppearance();
setStatus('Drop a picture to begin.');

// Exposed for automated end-to-end tests.
window.__app = { state, viewer };
