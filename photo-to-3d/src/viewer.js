/**
 * Realistic Three.js viewer: ACES tone mapping, image-based lighting from a
 * procedural studio environment, PCF soft shadows, and PBR material presets.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const MATERIAL_PRESETS = {
  photo: {
    label: 'Photo print',
    usesTexture: true,
    params: { color: 0xffffff, roughness: 0.62, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  },
  clay: {
    label: 'Sculpting clay',
    usesTexture: false,
    params: { color: 0xb08d6a, roughness: 0.95, metalness: 0.0, clearcoat: 0.0, clearcoatRoughness: 1.0 },
  },
  porcelain: {
    label: 'Porcelain (lithophane)',
    usesTexture: false,
    params: { color: 0xf6f1e7, roughness: 0.25, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.25 },
  },
  bronze: {
    label: 'Polished bronze',
    usesTexture: false,
    params: { color: 0xc08a4e, roughness: 0.32, metalness: 1.0, clearcoat: 0.0, clearcoatRoughness: 1.0 },
  },
  plastic: {
    label: 'PLA plastic',
    usesTexture: false,
    params: { color: 0x2e86de, roughness: 0.45, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.35 },
  },
};

export class Viewer {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14171c);
    this.scene.fog = new THREE.Fog(0x14171c, 600, 1400);

    // Image-based lighting from a procedural studio room — this is what makes
    // PBR materials read as "real" without shipping an HDRI file.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 4000);
    this.camera.position.set(140, 110, 170);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 900;
    this.controls.target.set(0, 25, 0);

    // Key light with soft shadows
    this.keyLight = new THREE.DirectionalLight(0xfff2e0, 2.6);
    this.keyLight.position.set(120, 220, 140);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.radius = 6;
    this.keyLight.shadow.bias = -0.0004;
    const sc = this.keyLight.shadow.camera;
    sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160;
    sc.near = 40; sc.far = 700;
    this.scene.add(this.keyLight);

    // Cool rim/fill for shape definition
    const fill = new THREE.DirectionalLight(0x8fb8ff, 0.5);
    fill.position.set(-160, 80, -120);
    this.scene.add(fill);

    // Ground: shadow catcher + subtle grid for scale
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(1200, 60, 0x2c3340, 0x222833);
    grid.position.y = 0.02;
    this.scene.add(grid);

    this.material = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
    this.mesh = null;
    this.texture = null;
    this.autoRotate = false;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this.renderer.setAnimationLoop(() => {
      if (this.mesh && this.autoRotate) this.mesh.rotation.z += 0.0035;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Replace the displayed geometry, disposing the previous one. */
  setGeometry(geometry) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.mesh = new THREE.Mesh(geometry, this.material);
    // Lay the relief flat on the ground plane (model builds along +Z).
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    // Aim the camera target at the middle of the slab's height.
    const bb = geometry.boundingBox;
    this.controls.target.set(0, (bb.max.z - bb.min.z) / 2, 0);
  }

  /** Swap the photo texture (or null to clear). Disposes the old texture. */
  setTexture(image) {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    if (image) {
      this.texture = new THREE.CanvasTexture(image);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    this._applyTexture();
  }

  applyPreset(presetKey, textureEnabled) {
    const preset = MATERIAL_PRESETS[presetKey] ?? MATERIAL_PRESETS.photo;
    const p = preset.params;
    this.material.color.set(p.color);
    this.material.roughness = p.roughness;
    this.material.metalness = p.metalness;
    this.material.clearcoat = p.clearcoat;
    this.material.clearcoatRoughness = p.clearcoatRoughness;
    this._presetUsesTexture = preset.usesTexture;
    this._textureEnabled = textureEnabled;
    this._applyTexture();
  }

  _applyTexture() {
    const useMap = Boolean(this.texture) && this._presetUsesTexture && this._textureEnabled;
    this.material.map = useMap ? this.texture : null;
    this.material.needsUpdate = true;
  }

  setWireframe(on) {
    this.material.wireframe = on;
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    if (!on && this.mesh) this.mesh.rotation.z = 0;
  }

  /** Frame the current mesh nicely after a rebuild. */
  frameMesh() {
    if (!this.mesh) return;
    const bb = this.mesh.geometry.boundingBox;
    const radius = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const dist = radius * 1.9;
    this.camera.position.set(dist * 0.62, dist * 0.55, dist * 0.85);
    this.controls.target.set(0, (bb.max.z - bb.min.z) / 2, 0);
  }

  /** PNG snapshot of the current view. */
  snapshotBlob() {
    return new Promise((resolve) => {
      this.renderer.render(this.scene, this.camera);
      this.renderer.domElement.toBlob(resolve, 'image/png');
    });
  }
}
