// Outils de maillage. Un maillage = { positions: Float32Array (xyz…), indices: Uint32Array (triangles) }.

/**
 * Extraction d'isosurface « Surface Nets » sur une grille de valeurs (nx×ny×nz,
 * index i + nx*(j + ny*k)). Intérieur = field > iso. Les coordonnées renvoyées
 * sont en unités de grille (indice d'échantillon). Les faces sont orientées
 * vers l'extérieur.
 */
export function surfaceNets(field, nx, ny, nz, iso = 0.5) {
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const verts = [];
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const cidx = (i, j, k) => i + cx * (j + cy * k);
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vals = new Float64Array(8);

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let m = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[idx(i + co[c][0], j + co[c][1], k + co[c][2])] - iso;
          vals[c] = v;
          if (v > 0) m |= 1 << c;
        }
        if (m === 0 || m === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = edges[e][0], b = edges[e][1];
          if (((m >> a) & 1) === ((m >> b) & 1)) continue;
          const t = vals[a] / (vals[a] - vals[b]);
          const A = co[a], B = co[b];
          sx += A[0] + t * (B[0] - A[0]);
          sy += A[1] + t * (B[1] - A[1]);
          sz += A[2] + t * (B[2] - A[2]);
          n++;
        }
        cell[cidx(i, j, k)] = verts.length / 3;
        verts.push(i + sx / n, j + sy / n, k + sz / n);
      }
    }
  }

  const positions = new Float32Array(verts);
  const tris = [];
  const P = positions;
  const quad = (a, b, c, d) => {
    // Diagonale la plus courte.
    const d2 = (p, q) => {
      const dx = P[3 * p] - P[3 * q], dy = P[3 * p + 1] - P[3 * q + 1], dz = P[3 * p + 2] - P[3 * q + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    if (d2(a, c) <= d2(b, d)) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const in0 = field[idx(i, j, k)] > iso;
        // Arête X
        if (i < cx && j >= 1 && j <= cy - 1 && k >= 1 && k <= cz - 1) {
          const in1 = field[idx(i + 1, j, k)] > iso;
          if (in0 !== in1) {
            const a = cell[cidx(i, j - 1, k - 1)], b = cell[cidx(i, j, k - 1)];
            const c = cell[cidx(i, j, k)], d = cell[cidx(i, j - 1, k)];
            if (in0) quad(a, b, c, d); else quad(a, d, c, b);
          }
        }
        // Arête Y
        if (j < cy && i >= 1 && i <= cx - 1 && k >= 1 && k <= cz - 1) {
          const in1 = field[idx(i, j + 1, k)] > iso;
          if (in0 !== in1) {
            const a = cell[cidx(i - 1, j, k - 1)], b = cell[cidx(i - 1, j, k)];
            const c = cell[cidx(i, j, k)], d = cell[cidx(i, j, k - 1)];
            if (in0) quad(a, b, c, d); else quad(a, d, c, b);
          }
        }
        // Arête Z
        if (k < cz && i >= 1 && i <= cx - 1 && j >= 1 && j <= cy - 1) {
          const in1 = field[idx(i, j, k + 1)] > iso;
          if (in0 !== in1) {
            const a = cell[cidx(i - 1, j - 1, k)], b = cell[cidx(i, j - 1, k)];
            const c = cell[cidx(i, j, k)], d = cell[cidx(i - 1, j, k)];
            if (in0) quad(a, b, c, d); else quad(a, d, c, b);
          }
        }
      }
    }
  }
  return { positions, indices: new Uint32Array(tris) };
}

/** Volume signé (positif si les normales pointent vers l'extérieur). */
export function signedVolume(mesh) {
  const P = mesh.positions, T = mesh.indices;
  let v = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
       - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
       + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Retourne toutes les faces si le volume est négatif. */
export function ensureOutward(mesh) {
  if (signedVolume(mesh) < 0) {
    const T = mesh.indices;
    for (let t = 0; t < T.length; t += 3) { const x = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = x; }
  }
  return mesh;
}

/** Arêtes orientées de bord (a→b sans b→a). */
export function boundaryEdges(indices) {
  const set = new Map();
  const key = (a, b) => a * 4294967296 + b;
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      set.set(key(a, b), [a, b]);
    }
  }
  const out = [];
  for (const [k, [a, b]] of set) if (!set.has(key(b, a))) out.push([a, b]);
  return out;
}

/** Vérifie que chaque arête orientée apparaît une fois et a sa jumelle inverse. */
export function isWatertight(mesh) {
  const count = new Map();
  const T = mesh.indices;
  const key = (a, b) => a * 4294967296 + b;
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(T[t + e], T[t + ((e + 1) % 3)]);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of count) {
    if (n !== 1) return false;
    const a = Math.floor(k / 4294967296), b = k - a * 4294967296;
    if (count.get(key(b, a)) !== 1) return false;
  }
  return true;
}

/** Lissage de Taubin (λ/μ) : lisse sans faire fondre le volume. */
export function taubinSmooth(mesh, iterations = 4, lambda = 0.5, mu = -0.53) {
  if (iterations <= 0) return mesh;
  const P = mesh.positions, T = mesh.indices;
  const n = P.length / 3;
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) deg[T[t + e]] += 2;
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const nb = new Uint32Array(start[n]);
  const fill = start.slice(0, n);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2];
    nb[fill[a]++] = b; nb[fill[a]++] = c;
    nb[fill[b]++] = a; nb[fill[b]++] = c;
    nb[fill[c]++] = a; nb[fill[c]++] = b;
  }
  const tmp = new Float32Array(P.length);
  const step = (f) => {
    for (let i = 0; i < n; i++) {
      const s = start[i], e = start[i + 1];
      if (e === s) { tmp[3 * i] = P[3 * i]; tmp[3 * i + 1] = P[3 * i + 1]; tmp[3 * i + 2] = P[3 * i + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let q = s; q < e; q++) { const v = 3 * nb[q]; x += P[v]; y += P[v + 1]; z += P[v + 2]; }
      const inv = 1 / (e - s);
      tmp[3 * i] = P[3 * i] + f * (x * inv - P[3 * i]);
      tmp[3 * i + 1] = P[3 * i + 1] + f * (y * inv - P[3 * i + 1]);
      tmp[3 * i + 2] = P[3 * i + 2] + f * (z * inv - P[3 * i + 2]);
    }
    P.set(tmp);
  };
  for (let it = 0; it < iterations; it++) { step(lambda); step(mu); }
  return mesh;
}

/** Boîte englobante {min:[x,y,z], max:[x,y,z]}. */
export function bounds(mesh) {
  const P = mesh.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (P[i + a] < min[a]) min[a] = P[i + a];
      if (P[i + a] > max[a]) max[a] = P[i + a];
    }
  }
  return { min, max };
}

/** Translate le maillage pour que son coin minimal soit à l'origine. */
export function moveToOrigin(mesh) {
  const { min } = bounds(mesh);
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) { P[i] -= min[0]; P[i + 1] -= min[1]; P[i + 2] -= min[2]; }
  return mesh;
}

export function meshStats(mesh) {
  const b = bounds(mesh);
  return {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    volume: Math.abs(signedVolume(mesh)),
  };
}

/**
 * Ferme un maillage ouvert dont chaque boucle de bord est plane et convexe
 * (en projection) en ajoutant un sommet central par boucle et un éventail.
 * `loops` : liste de { test(vertexIndex) => bool, center:[x,y,z] }.
 */
export function capBoundaries(mesh, loops) {
  const edges = boundaryEdges(mesh.indices);
  const pos = Array.from(mesh.positions);
  const tris = Array.from(mesh.indices);
  for (const loop of loops) {
    const c = pos.length / 3;
    pos.push(...loop.center);
    for (const [a, b] of edges) if (loop.test(a) && loop.test(b)) tris.push(c, b, a);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(tris) };
}

/**
 * Solide de révolution autour de l'axe Z.
 * profile : [{z, r}] du bas vers le haut. segments : nombre de facettes.
 */
export function lathe(profile, segments = 96) {
  const R = profile.length, S = segments;
  const rmax = Math.max(...profile.map((p) => p.r));
  const pos = new Float32Array(R * S * 3);
  for (let i = 0; i < R; i++) {
    for (let s = 0; s < S; s++) {
      const th = (2 * Math.PI * s) / S;
      const o = 3 * (i * S + s);
      pos[o] = rmax + profile[i].r * Math.cos(th);
      pos[o + 1] = rmax + profile[i].r * Math.sin(th);
      pos[o + 2] = profile[i].z;
    }
  }
  const tris = [];
  for (let i = 0; i < R - 1; i++) {
    for (let s = 0; s < S; s++) {
      const a = i * S + s, b = i * S + ((s + 1) % S);
      const c = (i + 1) * S + ((s + 1) % S), d = (i + 1) * S + s;
      tris.push(a, b, c, a, c, d);
    }
  }
  let mesh = { positions: pos, indices: new Uint32Array(tris) };
  mesh = capBoundaries(mesh, [
    { test: (v) => v < S, center: [rmax, rmax, profile[0].z] },
    { test: (v) => v >= (R - 1) * S && v < R * S, center: [rmax, rmax, profile[R - 1].z] },
  ]);
  return ensureOutward(mesh);
}

/**
 * Solide « champ de hauteur » : surface supérieure z = heights[j*gx+i] (mm),
 * fond plat à z = 0. La ligne j = 0 correspond au haut de l'image (y max).
 */
export function heightfieldSolid(heights, gx, gy, sizeX, sizeY) {
  const n = gx * gy;
  const pos = new Float32Array(n * 3);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const o = 3 * (j * gx + i);
      pos[o] = (i / (gx - 1)) * sizeX;
      pos[o + 1] = ((gy - 1 - j) / (gy - 1)) * sizeY;
      pos[o + 2] = heights[j * gx + i];
    }
  }
  const tris = [];
  for (let j = 0; j < gy - 1; j++) {
    for (let i = 0; i < gx - 1; i++) {
      const a = j * gx + i, b = a + 1, c = a + gx + 1, d = a + gx;
      tris.push(a, d, c, a, c, b);
    }
  }
  const top = new Uint32Array(tris);
  const edges = boundaryEdges(top);
  const all = Array.from(pos);
  const out = Array.from(top);
  const bottom = new Map();
  const low = (v) => {
    if (!bottom.has(v)) {
      bottom.set(v, all.length / 3);
      all.push(pos[3 * v], pos[3 * v + 1], 0);
    }
    return bottom.get(v);
  };
  const center = all.length / 3;
  all.push(sizeX / 2, sizeY / 2, 0);
  for (const [a, b] of edges) {
    const la = low(a), lb = low(b);
    out.push(b, a, la, b, la, lb); // paroi
    out.push(center, lb, la); // fond
  }
  return ensureOutward({ positions: new Float32Array(all), indices: new Uint32Array(out) });
}

/**
 * Révolution autour de Z d'une section fermée : polyligne [{r, z}] dont le
 * premier et le dernier point sont sur l'axe (r = 0). Les points intermédiaires
 * doivent avoir r > 0. Donne un solide fermé (ex. vase creux).
 */
export function revolveSection(points, segments = 96, center = null) {
  const S = segments;
  const rmax = Math.max(...points.map((p) => p.r));
  const cx = center ? center[0] : rmax, cy = center ? center[1] : rmax;
  const pos = [];
  const rings = points.map((p, i) => {
    const pole = i === 0 || i === points.length - 1;
    const start = pos.length / 3;
    if (pole) { pos.push(cx, cy, p.z); return { pole: true, start }; }
    for (let s = 0; s < S; s++) {
      const th = (2 * Math.PI * s) / S;
      pos.push(cx + p.r * Math.cos(th), cy + p.r * Math.sin(th), p.z);
    }
    return { pole: false, start };
  });
  const tris = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    if (A.pole && B.pole) continue;
    for (let s = 0; s < S; s++) {
      const s1 = (s + 1) % S;
      if (A.pole) tris.push(A.start, B.start + s1, B.start + s);
      else if (B.pole) tris.push(A.start + s, A.start + s1, B.start);
      else tris.push(A.start + s, A.start + s1, B.start + s1, A.start + s, B.start + s1, B.start + s);
    }
  }
  return ensureOutward({ positions: new Float32Array(pos), indices: new Uint32Array(tris) });
}
