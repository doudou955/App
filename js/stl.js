// Export STL binaire.

export function meshToSTL(mesh, name = 'photo2stl') {
  const P = mesh.positions, T = mesh.indices;
  const n = T.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = `${name} - genere par Photo2STL`.slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < T.length; t += 3) {
    const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, P[v], true); dv.setFloat32(o + 4, P[v + 1], true); dv.setFloat32(o + 8, P[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Lecture d'un STL binaire (utilisé par les tests). */
export function parseBinarySTL(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const positions = new Float32Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) { positions[t * 9 + k] = dv.getFloat32(o, true); o += 4; }
    o += 2;
  }
  return { count: n, positions };
}
