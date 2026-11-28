// Segmentation objet / fond à partir d'une photo (ImageData-like : {data, width, height}).
// Tout est en JS pur pour pouvoir être testé sous Node.

/** Couleur médiane des pixels du bord de l'image : estimation du fond. */
export function estimateBackground(data, w, h) {
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/**
 * Couleurs du fond : regroupement (k-moyennes) des pixels d'une bande le long
 * du bord de la photo. Gère les fonds en plusieurs tons (mur + table, ombre
 * portée sur le bord, dégradé d'éclairage…). Les groupes trop rares (objet qui
 * touche le bord, bruit) sont ignorés.
 */
export function estimateBackgroundPalette(data, w, h, k = 5) {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const step = Math.max(1, Math.floor((w + h) / 600));
  const px = [];
  const push = (x, y) => { const i = (y * w + x) * 4; px.push([data[i], data[i + 1], data[i + 2]]); };
  for (let b = 0; b < band; b += Math.max(1, band >> 1)) {
    for (let x = 0; x < w; x += step) { push(x, b); push(x, h - 1 - b); }
    for (let y = 0; y < h; y += step) { push(b, y); push(w - 1 - b, y); }
  }
  const d2 = (a, c) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
  // Initialisation : point médian puis points les plus éloignés.
  const med = estimateBackground(data, w, h);
  const centers = [med];
  while (centers.length < k) {
    let best = null, bd = -1;
    for (const p of px) {
      const d = Math.min(...centers.map((c) => d2(p, c)));
      if (d > bd) { bd = d; best = p; }
    }
    if (bd < 20 * 20) break; // fond déjà bien couvert
    centers.push(best.slice());
  }
  let counts = [];
  for (let it = 0; it < 12; it++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const d = d2(p, centers[c]); if (d < bd) { bd = d; bi = c; } }
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; counts[bi]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c]) centers[c] = sums[c].map((v) => v / counts[c]);
    }
  }
  const keep = centers.filter((c, i) => counts[i] >= px.length * 0.06);
  keep.sort((a, b) => counts[centers.indexOf(b)] - counts[centers.indexOf(a)]);
  return keep.length ? keep.map((c) => c.map(Math.round)) : [med];
}

/** Vrai si une part significative de l'image est transparente (PNG détouré). */
export function hasTransparency(data) {
  let n = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) n++;
  return n > total * 0.01;
}

/** Distance RVB de chaque pixel à la couleur de fond la plus proche (bg : couleur ou liste de couleurs). */
export function distanceMap(data, w, h, bg, shadows = false) {
  const pal = Array.isArray(bg[0]) ? bg : [bg];
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    let m = Infinity;
    for (const c of pal) {
      const dr = data[i] - c[0], dg = data[i + 1] - c[1], db = data[i + 2] - c[2];
      let d = dr * dr + dg * dg + db * db;
      if (shadows) {
        // Ombre = même couleur que le fond, assombrie : on mesure l'écart de teinte seulement.
        const cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] || 1;
        const a = (data[i] * c[0] + data[i + 1] * c[1] + data[i + 2] * c[2]) / cc;
        if (a > 0.35 && a < 1) {
          const er = data[i] - a * c[0], eg = data[i + 1] - a * c[1], eb = data[i + 2] - a * c[2];
          const ds = (er * er + eg * eg + eb * eb) * 4;
          if (ds < d) d = ds;
        }
      }
      if (d < m) m = d;
    }
    out[p] = Math.sqrt(m);
  }
  return out;
}

/**
 * Choisit la composante « objet » : la plus grande, mais les régions collées
 * au bord de la photo (mur, table, bord de feuille…) sont fortement pénalisées.
 */
export function keepObjectComponent(mask, w, h) {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const comps = [{}];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    const label = comps.length;
    let head = 0, tail = 0, size = 0, edge = 0;
    queue[tail++] = s; labels[s] = label;
    while (head < tail) {
      const p = queue[head++]; size++;
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge++;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; queue[tail++] = p + w; }
    }
    comps.push({ size, edge });
  }
  const minSize = w * h * 0.002;
  let best = 0, bestScore = -1;
  for (let l = 1; l < comps.length; l++) {
    const c = comps[l];
    // Pénalité proportionnelle à la longueur de bord touchée.
    const edgeFrac = c.edge / (2 * (w + h));
    const score = c.size * (c.edge ? Math.max(0.02, 0.3 - edgeFrac) : 1) * (c.size >= minSize ? 1 : 0.001);
    if (score > bestScore) { bestScore = score; best = l; }
  }
  const out = new Uint8Array(w * h);
  if (best) for (let p = 0; p < w * h; p++) out[p] = labels[p] === best ? 1 : 0;
  return out;
}

/** Seuil d'Otsu sur un tableau de valeurs dans [0, max]. */
export function otsu(values, max, bins = 256) {
  const hist = new Float64Array(bins);
  const k = (bins - 1) / max;
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.round(values[i] * k))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return (bestT + 0.5) / k;
}

/** Ne garde que la composante connexe (4-connexité) contenant le pixel p. */
export function componentAt(mask, w, h, p) {
  const out = new Uint8Array(w * h);
  if (!mask[p]) return out;
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  queue[tail++] = p; out[p] = 1;
  while (head < tail) {
    const q = queue[head++];
    const x = q % w, y = (q - x) / w;
    if (x > 0 && mask[q - 1] && !out[q - 1]) { out[q - 1] = 1; queue[tail++] = q - 1; }
    if (x < w - 1 && mask[q + 1] && !out[q + 1]) { out[q + 1] = 1; queue[tail++] = q + 1; }
    if (y > 0 && mask[q - w] && !out[q - w]) { out[q - w] = 1; queue[tail++] = q - w; }
    if (y < h - 1 && mask[q + w] && !out[q + w]) { out[q + w] = 1; queue[tail++] = q + w; }
  }
  return out;
}

/** Pixel objet le plus proche de (x, y) dans un rayon r, ou -1. */
function nearestOn(mask, w, h, x, y, r) {
  x = Math.round(x); y = Math.round(y);
  let best = -1, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = yy * w + xx; }
    }
  }
  return best;
}

/**
 * Retire les composantes touchées par les segments donnés (ex. la règle sur
 * laquelle on a mesuré). Ne fait rien si cela vide le masque.
 */
export function excludeAlongSegments(mask, w, h, segments) {
  const out = mask.slice();
  for (const [a, b] of segments) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(len));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = nearestOn(out, w, h, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), 1);
      if (p < 0) continue;
      const comp = componentAt(out, w, h, p);
      for (let q = 0; q < w * h; q++) if (comp[q]) out[q] = 0;
    }
  }
  for (let q = 0; q < w * h; q++) if (out[q]) return out;
  return mask;
}

/** Ne garde que la plus grande composante connexe (4-connexité). */
export function keepLargestComponent(mask, w, h) {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let label = 0, bestLabel = 0, bestSize = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    label++;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; labels[s] = label;
    while (head < tail) {
      const p = queue[head++]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; queue[tail++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = label; }
  }
  const out = new Uint8Array(w * h);
  if (bestLabel) for (let p = 0; p < w * h; p++) out[p] = labels[p] === bestLabel ? 1 : 0;
  return out;
}

/** Bouche les trous : tout fond non relié au bord de l'image devient objet. */
export function fillHoles(mask, w, h) {
  const reached = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  const seed = (p) => { if (!mask[p] && !reached[p]) { reached[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  let head = 0;
  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = reached[p] ? 0 : 1;
  return out;
}

/** Filtre max (dilatation, value=1) ou min (érosion, value=0) carré séparable de rayon r. */
function morph(mask, w, h, r, dilate) {
  const target = dilate ? 1 : 0;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - target;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        if (mask[y * w + xx] === target) { v = target; break; }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - target;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x] === target) { v = target; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Ajuste le contour : n > 0 dilate, n < 0 érode (en pixels). */
export function adjustContour(mask, w, h, n) {
  if (!n) return mask;
  return morph(mask, w, h, Math.abs(n), n > 0);
}

/** Boîte englobante du masque {x0,y0,x1,y1} (bornes incluses) ou null. */
export function boundingBox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Calcule le masque objet (1) / fond (0).
 * opts: { bg?, tolerance? (null = auto Otsu), invert, largest, fillHoles, adjust, useAlpha? }
 */
export function computeMask(img, opts = {}) {
  const { data, width: w, height: h } = img;
  let mask = new Uint8Array(w * h);
  let threshold = null;
  let bg = opts.bg || null;
  const useAlpha = opts.useAlpha ?? hasTransparency(data);
  if (useAlpha) {
    for (let p = 0; p < w * h; p++) mask[p] = data[p * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const palette = estimateBackgroundPalette(data, w, h);
    if (opts.bg) palette.unshift(opts.bg); // couleur choisie à la pipette
    bg = palette[0];
    const dist = distanceMap(data, w, h, palette, !!opts.shadows);
    threshold = opts.tolerance ?? otsu(dist, 442);
    for (let p = 0; p < w * h; p++) mask[p] = dist[p] > threshold ? 1 : 0;
  }
  if (opts.invert) for (let p = 0; p < w * h; p++) mask[p] = 1 - mask[p];
  // Zone de l'objet : tout ce qui est hors du cadre est du fond.
  const roi = opts.roi;
  if (roi) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < roi.x0 || x > roi.x1 || y < roi.y0 || y > roi.y1) mask[y * w + x] = 0;
      }
    }
  }
  // Règle / objet de référence à exclure.
  if (opts.exclude?.length) mask = excludeAlongSegments(mask, w, h, opts.exclude);
  // Objet désigné par un clic, sinon la plus grande composante.
  let seeded = false;
  if (opts.seed) {
    const p = nearestOn(mask, w, h, opts.seed[0], opts.seed[1], 6);
    if (p >= 0) { mask = componentAt(mask, w, h, p); seeded = true; }
  }
  if (!seeded && opts.largest !== false) mask = keepObjectComponent(mask, w, h);
  if (opts.fillHoles !== false) mask = fillHoles(mask, w, h);
  if (opts.adjust) mask = adjustContour(mask, w, h, opts.adjust);
  const bbox = boundingBox(mask, w, h);
  // Part de la photo occupée par la boîte englobante : proche de 1 = détourage raté.
  const coverage = bbox ? ((bbox.x1 - bbox.x0 + 1) * (bbox.y1 - bbox.y0 + 1)) / (w * h) : 0;
  // Nombre de bords de la photo touchés par la silhouette : ≥ 2 = le fond a été pris pour l'objet.
  const edges = bbox ? (bbox.x0 === 0) + (bbox.y0 === 0) + (bbox.x1 === w - 1) + (bbox.y1 === h - 1) : 0;
  return { mask, threshold, bg, useAlpha, bbox, coverage, edges };
}
