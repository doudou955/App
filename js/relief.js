// Relief / lithophanie : la luminosité de la photo devient une épaisseur.

import { cropResample, luminance, boxBlur } from './masks.js';
import { heightfieldSolid } from './mesh.js';

/**
 * img : ImageData-like. opts : {width (mm), minT, maxT (mm), lithophane (sombre = épais),
 * resolution (points sur la largeur), blur (px), border (mm)}
 */
export function buildRelief(img, opts = {}) {
  const width = opts.width || 100;
  const minT = opts.minT ?? 0.8;
  const maxT = opts.maxT ?? 3;
  if (!(maxT > minT)) throw new Error("L'épaisseur max doit être supérieure à l'épaisseur min.");
  const gx = Math.max(4, Math.round(opts.resolution || 200));
  const height = (width * img.height) / img.width;
  const gy = Math.max(4, Math.round((gx * img.height) / img.width));
  let lum = cropResample(luminance(img), img.width, img.height, null, gx, gy);
  lum = boxBlur(lum, gx, gy, opts.blur || 0);
  // Cadre éventuel à l'épaisseur max.
  const borderPts = Math.round(((opts.border || 0) / width) * (gx - 1));
  const hts = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      let t = lum[j * gx + i];
      if (opts.lithophane) t = 1 - t;
      let z = minT + t * (maxT - minT);
      if (borderPts > 0 && (i < borderPts || j < borderPts || i >= gx - borderPts || j >= gy - borderPts)) z = maxT;
      hts[j * gx + i] = z;
    }
  }
  const mesh = heightfieldSolid(hts, gx, gy, width, height);
  return { mesh, width, height };
}
