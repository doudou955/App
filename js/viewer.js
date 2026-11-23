// Aperçu 3D (three.js).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(120, -160, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1, -1.5, 2);
    this.camera.add(sun);
    this.scene.add(this.camera);

    this.grid = null;
    this.setGrid(200);
    this.material = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.55, metalness: 0.05, flatShading: false });
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0x0b1530, wireframe: true, transparent: true, opacity: 0.25 });
    this.object = null;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  setGrid(size) {
    if (this.grid) this.scene.remove(this.grid);
    const step = size > 400 ? 50 : size > 100 ? 10 : 5;
    const n = Math.ceil(size / step) * step;
    this.grid = new THREE.GridHelper(n, n / step, 0x6b7a99, 0x2b3550);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.6;
    this.scene.add(this.grid);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setWireframe(on) {
    this._wire = on;
    if (this.wire) this.wire.visible = on;
  }

  setMesh(mesh) {
    if (this.object) {
      this.scene.remove(this.object);
      this.object.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    // Pose l'objet sur le plateau, centré.
    const group = new THREE.Group();
    const m = new THREE.Mesh(g, this.material);
    this.wire = new THREE.Mesh(g, this.wireMat);
    this.wire.visible = !!this._wire;
    group.add(m, this.wire);
    group.position.set(-center.x, -center.y, -bb.min.z);
    this.object = group;
    this.scene.add(group);

    const size = new THREE.Vector3();
    bb.getSize(size);
    const r = size.length() / 2 || 10;
    this.setGrid(Math.max(size.x, size.y) * 2);
    this.controls.target.set(0, 0, size.z / 2);
    const dir = new THREE.Vector3(0.9, -1.3, 0.8).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, r * 3);
    this.camera.near = r / 100;
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
  }
}
