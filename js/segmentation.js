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

/** Vrai si une part significative de l'image est transparente (PNG détouré). */
export function hasTransparency(data) {
  let n = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) n++;
  return n > total * 0.01;
}

/** Distance RVB de chaque pixel à la couleur de fond. */
export function distanceMap(data, w, h, bg) {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    out[p] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
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
    if (!bg) bg = estimateBackground(data, w, h);
    const dist = distanceMap(data, w, h, bg);
    threshold = opts.tolerance ?? otsu(dist, 442);
    for (let p = 0; p < w * h; p++) mask[p] = dist[p] > threshold ? 1 : 0;
  }
  if (opts.invert) for (let p = 0; p < w * h; p++) mask[p] = 1 - mask[p];
  if (opts.largest !== false) mask = keepLargestComponent(mask, w, h);
  if (opts.fillHoles !== false) mask = fillHoles(mask, w, h);
  if (opts.adjust) mask = adjustContour(mask, w, h, opts.adjust);
  return { mask, threshold, bg, useAlpha, bbox: boundingBox(mask, w, h) };
}
