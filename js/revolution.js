// Solide de révolution à partir de la silhouette (profil) d'un objet symétrique.

import { lathe, taubinSmooth } from './mesh.js';

/**
 * view : {mask, w, h, bbox, scale?}
 * opts : {height?, diameter?, axis: 'center'|'left'|'right', segments, maxRows, smoothing}
 */
export function buildRevolution(view, opts = {}) {
  const { mask, w, bbox } = view;
  if (!bbox) throw new Error('Aucune silhouette détectée.');
  const axis = opts.axis || 'center';
  const rowsPx = [];
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    let l = -1, r = -1;
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      if (mask[y * w + x]) { if (l < 0) l = x; r = x; }
    }
    let rad = 0;
    if (l >= 0) {
      if (axis === 'left') rad = r + 1 - bbox.x0;
      else if (axis === 'right') rad = bbox.x1 + 1 - l;
      else rad = (r - l + 1) / 2;
    }
    rowsPx.push(rad);
  }
  const nPx = rowsPx.length;
  const maxR = Math.max(...rowsPx);
  if (!(maxR > 0) || nPx < 2) throw new Error('Silhouette trop petite.');

  // Échelles (mm/px) verticale et radiale.
  let sz = null, sr = null;
  if (opts.height) sz = opts.height / nPx;
  if (opts.diameter) sr = opts.diameter / (2 * maxR);
  if (sz == null && sr == null && view.scale) sz = sr = view.scale;
  if (sz == null) sz = sr;
  if (sr == null) sr = sz;
  if (sz == null) throw new Error('Indiquez la hauteur ou le diamètre maximal, ou étalonnez la photo.');

  // Rééchantillonnage du profil.
  const rows = Math.max(2, Math.min(opts.maxRows || 300, nPx));
  const H = nPx * sz;
  const profile = [];
  for (let i = 0; i < rows; i++) {
    // i = 0 en bas
    const a = ((rows - 1 - i) * nPx) / rows, b = ((rows - i) * nPx) / rows;
    let s = 0, n = 0;
    for (let y = Math.floor(a); y < Math.max(Math.floor(a) + 1, Math.ceil(b)); y++) { s += rowsPx[Math.min(nPx - 1, y)]; n++; }
    profile.push({ z: (i / (rows - 1)) * H, r: Math.max(0, (s / n) * sr) });
  }
  // Lissage léger du profil (moyenne glissante).
  const k = opts.smoothing ?? 1;
  for (let it = 0; it < k; it++) {
    const rr = profile.map((p) => p.r);
    for (let i = 1; i < rows - 1; i++) profile[i].r = (rr[i - 1] + 2 * rr[i] + rr[i + 1]) / 4;
  }
  const mesh = lathe(profile, opts.segments || 96);
  return { mesh, height: H, diameter: 2 * Math.max(...profile.map((p) => p.r)) };
}
