// Solide de révolution à partir de la silhouette (profil) d'un objet symétrique.

import { lathe, revolveSection } from './mesh.js';

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
  const diameter = 2 * Math.max(...profile.map((p) => p.r));
  if (opts.hollow) {
    return { ...hollowVase(profile, opts), height: H, diameter };
  }
  const mesh = lathe(profile, opts.segments || 96);
  return { mesh, height: H, diameter };
}

/**
 * Vase creux ouvert en haut : la paroi (épaisseur `wall`, mesurée
 * perpendiculairement à la paroi) suit le profil extérieur, avec un fond plein
 * d'épaisseur `bottom`.
 */
export function hollowVase(profile, opts = {}) {
  const wall = opts.wall ?? 2;
  const bottom = opts.bottom ?? 3;
  const minHole = opts.minHole ?? 0.5; // diamètre/2 minimal de l'ouverture intérieure
  const n = profile.length;
  const H = profile[n - 1].z;
  if (!(wall > 0)) throw new Error("L'épaisseur de paroi doit être positive.");
  if (!(bottom >= 0) || bottom >= H - wall) throw new Error(`Le fond (${bottom} mm) est trop épais pour un objet de ${H.toFixed(1)} mm de haut.`);
  const rAt = (z) => {
    let i = 0;
    while (i < n - 2 && profile[i + 1].z < z) i++;
    const a = profile[i], b = profile[i + 1];
    const t = b.z > a.z ? Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z))) : 0;
    return a.r + t * (b.r - a.r);
  };
  // Pente de la paroi lissée sur ±2 mm pour ne pas suivre le bruit du détourage.
  const slope = (z) => {
    const d = Math.min(2, H / 10);
    const z0 = Math.max(0, z - d), z1 = Math.min(H, z + d);
    return z1 > z0 ? (rAt(z1) - rAt(z0)) / (z1 - z0) : 0;
  };
  const outer = profile.map((p) => ({ r: Math.max(p.r, 0.05), z: p.z }));
  const inner = [];
  let thin = Infinity, thinZ = 0, capacity = 0, blocked = null;
  const zs = [bottom, ...profile.filter((p) => p.z > bottom).map((p) => p.z)];
  for (const z of zs) {
    const ro = Math.max(rAt(z), 0.05);
    const th = wall * Math.sqrt(1 + slope(z) ** 2); // épaisseur horizontale équivalente
    let ri = ro - th;
    const floor = Math.min(minHole, ro * 0.5);
    if (ri < floor) {
      ri = floor;
      if (z > bottom && (blocked == null || ro < blocked.ro)) blocked = { z, ro };
    }
    const real = (ro - ri) / Math.sqrt(1 + slope(z) ** 2);
    if (real < thin) { thin = real; thinZ = z; }
    inner.push({ r: ri, z });
  }
  for (let i = 1; i < inner.length; i++) {
    const a = inner[i - 1], b = inner[i];
    capacity += (Math.PI * (b.z - a.z) * (a.r * a.r + a.r * b.r + b.r * b.r)) / 3;
  }
  const section = [{ r: 0, z: 0 }, ...outer, ...inner.slice().reverse(), { r: 0, z: bottom }];
  const mesh = revolveSection(section, opts.segments || 96);
  let warning = '';
  if (blocked) {
    warning = `Col trop étroit (Ø ${(2 * blocked.ro).toFixed(1)} mm à z = ${blocked.z.toFixed(0)} mm) pour une paroi de ${wall} mm : l'ouverture y est quasi bouchée. Réduisez l'épaisseur de paroi`;
  } else if (thin < wall * 0.9) {
    warning = `Paroi amincie à ${thin.toFixed(1)} mm vers z = ${thinZ.toFixed(0)} mm (col étroit)`;
  }
  return { mesh, capacity, warning };
}
