// Reconstruction par enveloppe visuelle (« visual hull ») à partir de 1 à 3 silhouettes
// orthogonales. Repère : X = largeur, Y = profondeur, Z = hauteur.
//  - vue de face   (depuis l'avant)  : image x → X, image y (vers le bas) → -Z
//  - vue de droite (depuis la droite): image x → Y (gauche de la photo = avant), image y → -Z
//  - vue de dessus (depuis le haut)  : image x → X, image y → -Y (avant de l'objet en bas de la photo)
// Une vue absente est considérée comme pleine (extrusion).

import { cropResample, sampleBilinear } from './masks.js';
import { surfaceNets, taubinSmooth, ensureOutward } from './mesh.js';

const bw = (v) => v.bbox.x1 - v.bbox.x0 + 1;
const bh = (v) => v.bbox.y1 - v.bbox.y0 + 1;

/**
 * Détermine largeur W, profondeur D et hauteur H (mm) à partir des cotes saisies
 * (null = inconnue), de l'étalonnage éventuel de chaque vue et des proportions des silhouettes.
 */
export function resolveDims(views, user = {}) {
  const d = { W: user.W ?? null, D: user.D ?? null, H: user.H ?? null };
  const src = { W: d.W != null ? 'saisie' : null, D: d.D != null ? 'saisie' : null, H: d.H != null ? 'saisie' : null };
  const rel = [];
  if (views.front) rel.push({ v: views.front, a: 'W', b: 'H', name: 'face' });
  if (views.side) rel.push({ v: views.side, a: 'D', b: 'H', name: 'côté' });
  if (views.top) rel.push({ v: views.top, a: 'W', b: 'D', name: 'dessus' });

  // 1) Étalonnages (mm/px)
  for (const r of rel) {
    if (!r.v.scale) continue;
    if (d[r.a] == null) { d[r.a] = bw(r.v) * r.v.scale; src[r.a] = `étalonnage ${r.name}`; }
    if (d[r.b] == null) { d[r.b] = bh(r.v) * r.v.scale; src[r.b] = `étalonnage ${r.name}`; }
  }
  // 2) Propagation par les proportions
  for (let it = 0; it < 3; it++) {
    for (const r of rel) {
      const ratio = bw(r.v) / bh(r.v);
      if (d[r.a] != null && d[r.b] == null) { d[r.b] = d[r.a] / ratio; src[r.b] = `proportions ${r.name}`; }
      else if (d[r.b] != null && d[r.a] == null) { d[r.a] = d[r.b] * ratio; src[r.a] = `proportions ${r.name}`; }
    }
  }
  const missing = Object.keys(d).filter((k) => d[k] == null || !(d[k] > 0));
  if (missing.length) {
    const names = { W: 'largeur (X)', D: 'profondeur (Y)', H: 'hauteur (Z)' };
    throw new Error(`Cote manquante : ${missing.map((k) => names[k]).join(', ')}. Saisissez-la ou étalonnez une photo.`);
  }
  return { ...d, sources: src };
}

/** Table 2D des valeurs d'une vue échantillonnées aux centres des voxels. */
function viewTable(view, na, ha, A, nb, hb, B, flipV) {
  const ow = Math.max(2, Math.min(2 * na, 1024));
  const oh = Math.max(2, Math.min(2 * nb, 1024));
  const m = cropResample(view.mask, view.w, view.h, view.bbox, ow, oh);
  const t = new Float32Array(na * nb);
  for (let q = 0; q < nb; q++) {
    let v = ((q + 0.5) * hb) / B;
    if (flipV) v = 1 - v;
    for (let p = 0; p < na; p++) {
      let u = ((p + 0.5) * ha) / A;
      if (view.flip) u = 1 - u;
      t[q * na + p] = sampleBilinear(m, ow, oh, u, v);
    }
  }
  return t;
}

/**
 * Construit le maillage (mm) de l'intersection des cylindres de silhouettes.
 * views: {front?, side?, top?} chacun {mask, w, h, bbox, flip}
 */
export function buildVisualHull(views, dims, { resolution = 96, smoothing = 4 } = {}) {
  if (!views.front && !views.side && !views.top) throw new Error('Ajoutez au moins une photo.');
  const { W, D, H } = dims;
  const step = Math.max(W, D, H) / resolution;
  const cx = Math.max(2, Math.round(W / step));
  const cy = Math.max(2, Math.round(D / step));
  const cz = Math.max(2, Math.round(H / step));
  const hx = W / cx, hy = D / cy, hz = H / cz;
  const nx = cx + 2, ny = cy + 2, nz = cz + 2;

  const F = views.front ? viewTable(views.front, cx, hx, W, cz, hz, H, true) : null; // (i,k)
  const S = views.side ? viewTable(views.side, cy, hy, D, cz, hz, H, true) : null; // (j,k)
  const T = views.top ? viewTable(views.top, cx, hx, W, cy, hy, D, true) : null; // (i,j)

  const field = new Float32Array(nx * ny * nz);
  for (let k = 1; k <= cz; k++) {
    for (let j = 1; j <= cy; j++) {
      const s = S ? S[(k - 1) * cy + (j - 1)] : 1;
      if (s <= 0) continue;
      for (let i = 1; i <= cx; i++) {
        let v = s;
        if (F) { const f = F[(k - 1) * cx + (i - 1)]; if (f < v) v = f; }
        if (T) { const t = T[(j - 1) * cx + (i - 1)]; if (t < v) v = t; }
        field[i + nx * (j + ny * k)] = v;
      }
    }
  }

  const mesh = surfaceNets(field, nx, ny, nz, 0.5);
  if (mesh.indices.length === 0) throw new Error('Silhouettes vides ou incompatibles : aucune matière.');
  const P = mesh.positions;
  for (let p = 0; p < P.length; p += 3) {
    P[p] = (P[p] - 0.5) * hx;
    P[p + 1] = (P[p + 1] - 0.5) * hy;
    P[p + 2] = (P[p + 2] - 0.5) * hz;
  }
  taubinSmooth(mesh, smoothing);
  ensureOutward(mesh);
  return { mesh, grid: [cx, cy, cz], voxel: [hx, hy, hz] };
}
