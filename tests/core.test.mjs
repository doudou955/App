import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceNets, isWatertight, signedVolume, meshStats, lathe, heightfieldSolid } from '../js/mesh.js';
import { computeMask, otsu } from '../js/segmentation.js';
import { resolveDims, buildVisualHull } from '../js/hull.js';
import { buildRevolution } from '../js/revolution.js';
import { buildRelief } from '../js/relief.js';
import { meshToSTL, parseBinarySTL } from '../js/stl.js';

/** Image synthétique : fond blanc, disque/rectangle rouge. */
function makeImage(w, h, inside) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = inside(x, y);
      data[i] = on ? 200 : 245; data[i + 1] = on ? 30 : 245; data[i + 2] = on ? 40 : 245; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function viewFrom(img) {
  const r = computeMask(img);
  return { mask: r.mask, w: img.width, h: img.height, bbox: r.bbox, flip: false, scale: null };
}

test('surface nets : sphère étanche, orientée, volume correct', () => {
  const n = 40, R = 15, c = n / 2;
  const f = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i - c, j - c, k - c);
    f[i + n * (j + n * k)] = Math.max(0, Math.min(1, R - d + 0.5));
  }
  const m = surfaceNets(f, n, n, n, 0.5);
  assert.ok(isWatertight(m), 'maillage étanche');
  const v = signedVolume(m);
  const expected = (4 / 3) * Math.PI * R ** 3;
  assert.ok(v > 0, 'normales vers l’extérieur');
  assert.ok(Math.abs(v - expected) / expected < 0.03, `volume ${v} ≈ ${expected}`);
});

test('segmentation : détecte le disque sur fond uni', () => {
  const img = makeImage(100, 80, (x, y) => Math.hypot(x - 50, y - 40) < 20);
  const r = computeMask(img);
  assert.deepEqual(r.bbox, { x0: 31, y0: 21, x1: 69, y1: 59 });
  assert.ok(otsu(new Float32Array([0, 0, 0, 100, 100]), 100) > 0);
});

test('dimensions : propagation par les proportions', () => {
  const front = viewFrom(makeImage(120, 120, (x, y) => x >= 10 && x < 110 && y >= 10 && y < 60)); // 100×50
  const side = viewFrom(makeImage(120, 120, (x, y) => x >= 10 && x < 35 && y >= 10 && y < 60)); // 25×50
  const d = resolveDims({ front, side }, { W: 40 });
  assert.equal(d.W, 40);
  assert.ok(Math.abs(d.H - 20) < 1e-9);
  assert.ok(Math.abs(d.D - 10) < 1e-9);
  assert.throws(() => resolveDims({ front }, {}), /Cote manquante/);
});

test('enveloppe visuelle : cylindre (face + dessus)', () => {
  const front = viewFrom(makeImage(200, 200, (x, y) => x >= 50 && x < 150 && y >= 20 && y < 180));
  const top = viewFrom(makeImage(200, 200, (x, y) => Math.hypot(x - 100 + 0.5, y - 100 + 0.5) < 50));
  const dims = resolveDims({ front, top }, { W: 20 });
  const { mesh } = buildVisualHull({ front, top }, dims, { resolution: 64, smoothing: 0 });
  assert.ok(isWatertight(mesh));
  const st = meshStats(mesh);
  const expected = Math.PI * 10 * 10 * 32;
  assert.ok(Math.abs(st.volume - expected) / expected < 0.05, `volume ${st.volume} ≈ ${expected}`);
  assert.ok(Math.abs(st.size[2] - 32) < 0.6, `hauteur ${st.size[2]}`);
});

test('extrusion : une seule vue + profondeur', () => {
  const front = viewFrom(makeImage(100, 100, (x, y) => x >= 10 && x < 90 && y >= 30 && y < 70));
  const dims = resolveDims({ front }, { W: 80, D: 5 });
  const { mesh } = buildVisualHull({ front }, dims, { resolution: 80, smoothing: 2 });
  const st = meshStats(mesh);
  assert.ok(Math.abs(st.volume - 80 * 40 * 5) / (80 * 40 * 5) < 0.05, `volume ${st.volume}`);
});

test('révolution : cylindre depuis un rectangle', () => {
  const view = viewFrom(makeImage(100, 200, (x, y) => x >= 30 && x < 70 && y >= 20 && y < 180));
  const { mesh, height, diameter } = buildRevolution(view, { height: 80, segments: 128, smoothing: 0 });
  assert.ok(isWatertight(mesh));
  assert.ok(Math.abs(height - 80) < 1e-6);
  assert.ok(Math.abs(diameter - 20) < 1e-6);
  const v = signedVolume(mesh);
  const expected = Math.PI * 100 * 80;
  assert.ok(Math.abs(v - expected) / expected < 0.02, `volume ${v}`);
});

test('lathe et heightfield étanches', () => {
  const l = lathe([{ z: 0, r: 0 }, { z: 1, r: 2 }, { z: 3, r: 1 }, { z: 4, r: 0 }], 32);
  assert.ok(signedVolume(l) > 0);
  const h = new Float32Array(25).fill(2);
  const s = heightfieldSolid(h, 5, 5, 10, 10);
  assert.ok(isWatertight(s));
  assert.ok(Math.abs(signedVolume(s) - 200) < 1e-3);
});

test('relief : lithophanie', () => {
  const img = makeImage(60, 40, (x) => x < 30);
  const { mesh, height } = buildRelief(img, { width: 60, minT: 1, maxT: 3, lithophane: true, resolution: 60 });
  assert.ok(isWatertight(mesh));
  assert.equal(height, 40);
  const st = meshStats(mesh);
  assert.ok(st.size[2] <= 3.0001 && st.size[2] > 1.5);
});

test('STL binaire : aller-retour', () => {
  const h = new Float32Array(9).fill(1);
  const s = heightfieldSolid(h, 3, 3, 2, 2);
  const buf = meshToSTL(s, 'test');
  assert.equal(buf.byteLength, 84 + 50 * (s.indices.length / 3));
  const p = parseBinarySTL(buf);
  assert.equal(p.count, s.indices.length / 3);
});

test('règle à côté : exclusion par le segment étalonné, zone et choix de l\'objet', () => {
  // Objet 40×40 et règle 200×20 (plus grande que l'objet), séparés.
  const img = makeImage(300, 200, (x, y) => (x >= 30 && x < 70 && y >= 30 && y < 70) || (x >= 50 && x < 250 && y >= 150 && y < 170));
  assert.deepEqual(computeMask(img).bbox, { x0: 50, y0: 150, x1: 249, y1: 169 }, 'sans aide, la règle gagne');
  const obj = { x0: 30, y0: 30, x1: 69, y1: 69 };
  assert.deepEqual(computeMask(img, { exclude: [[[60, 160], [160, 160]]] }).bbox, obj);
  assert.deepEqual(computeMask(img, { roi: { x0: 10, y0: 10, x1: 100, y1: 100 } }).bbox, obj);
  assert.deepEqual(computeMask(img, { seed: [45, 45] }).bbox, obj);
  // Mesure faite sur l'objet lui-même sans autre composante : on ne vide pas le masque.
  const solo = makeImage(100, 100, (x, y) => x >= 30 && x < 70 && y >= 30 && y < 70);
  assert.ok(computeMask(solo, { exclude: [[[30, 50], [69, 50]]] }).bbox);
});

test('révolution creuse : vase cylindrique étanche, volume et contenance', async () => {
  const { hollowVase } = await import('../js/revolution.js');
  const profile = Array.from({ length: 101 }, (_, i) => ({ z: i, r: 20 }));
  const { mesh, capacity, warning } = hollowVase(profile, { wall: 2, bottom: 3, segments: 256 });
  assert.ok(isWatertight(mesh));
  const v = signedVolume(mesh);
  const expected = Math.PI * 20 * 20 * 100 - Math.PI * 18 * 18 * 97;
  assert.ok(v > 0 && Math.abs(v - expected) / expected < 0.01, `volume ${v} ≈ ${expected}`);
  assert.ok(Math.abs(capacity - Math.PI * 18 * 18 * 97) / capacity < 0.001);
  assert.equal(warning, '');
  // Col étroit : paroi amincie signalée, maillage toujours étanche.
  const neck = Array.from({ length: 101 }, (_, i) => ({ z: i, r: i > 80 ? 2 : 20 }));
  const r2 = hollowVase(neck, { wall: 2, bottom: 3, segments: 64 });
  assert.ok(isWatertight(r2.mesh));
  assert.match(r2.warning, /Col trop étroit/);
  assert.throws(() => hollowVase(profile, { wall: 2, bottom: 99 }), /fond/);
});

test('fond en deux tons (mur + table) et ombre portée : pas de « gros cube »', () => {
  const w = 300, h = 220;
  const img = makeImage(w, h, () => false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c = y < 80 ? [205, 200, 190] : [150, 110, 80];
    if (Math.hypot(x - 180, y - 165) < 45 && y >= 80) c = [90, 66, 48]; // ombre sur la table
    if (x >= 120 && x < 180 && y >= 60 && y < 180) c = [60, 70, 90]; // objet
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
  }
  const r = computeMask(img, { shadows: true });
  assert.deepEqual(r.bbox, { x0: 120, y0: 60, x1: 179, y1: 179 });
  assert.ok(r.coverage < 0.2);
});
