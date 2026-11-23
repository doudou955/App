// Rééchantillonnage de masques / images en niveaux de gris par moyenne de surface.

/**
 * Recadre `src` (Float32/Uint8, w×h) sur `bbox` et le rééchantillonne en ow×oh
 * par moyenne de surface (image intégrale). Renvoie un Float32Array dans [0,1]
 * si la source est un masque 0/1.
 */
export function cropResample(src, w, h, bbox, ow, oh) {
  const W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
    }
  }
  const bx = bbox ? bbox.x0 : 0, by = bbox ? bbox.y0 : 0;
  const bw = bbox ? bbox.x1 - bbox.x0 + 1 : w;
  const bh = bbox ? bbox.y1 - bbox.y0 + 1 : h;
  const out = new Float32Array(ow * oh);
  const xs0 = new Int32Array(ow), xs1 = new Int32Array(ow);
  for (let ox = 0; ox < ow; ox++) {
    let a = Math.floor(bx + (ox * bw) / ow);
    let b = Math.ceil(bx + ((ox + 1) * bw) / ow);
    if (b <= a) b = a + 1;
    xs0[ox] = Math.max(0, Math.min(w - 1, a));
    xs1[ox] = Math.max(xs0[ox] + 1, Math.min(w, b));
  }
  for (let oy = 0; oy < oh; oy++) {
    let a = Math.floor(by + (oy * bh) / oh);
    let b = Math.ceil(by + ((oy + 1) * bh) / oh);
    if (b <= a) b = a + 1;
    const y0 = Math.max(0, Math.min(h - 1, a));
    const y1 = Math.max(y0 + 1, Math.min(h, b));
    for (let ox = 0; ox < ow; ox++) {
      const x0 = xs0[ox], x1 = xs1[ox];
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      out[oy * ow + ox] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Échantillonnage bilinéaire de m (mw×mh) en coordonnées normalisées u,v ∈ [0,1]. */
export function sampleBilinear(m, mw, mh, u, v) {
  let x = u * mw - 0.5, y = v * mh - 0.5;
  if (x < 0) x = 0; else if (x > mw - 1) x = mw - 1;
  if (y < 0) y = 0; else if (y > mh - 1) y = mh - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, mw - 1), y1 = Math.min(y0 + 1, mh - 1);
  const fx = x - x0, fy = y - y0;
  const a = m[y0 * mw + x0], b = m[y0 * mw + x1];
  const c = m[y1 * mw + x0], d = m[y1 * mw + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Luminance (0..1) d'une ImageData-like. */
export function luminance(img) {
  const { data, width: w, height: h } = img;
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    out[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  return out;
}

/** Flou boîte séparable de rayon r (en place sur une copie). */
export function boxBlur(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}
