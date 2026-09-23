/* PCA orientation of a structure, without the GPU (the renderer and the headless core both use it). */
import type { Structure } from '../model/structure';

/** Rotation that puts the structure's principal axes on screen x, y (largest spread in-plane), right-handed. */
export function pcaBasis(s: Structure): Float32Array {
  const n = s.count; const c = s.center; const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) { const d = [s.x[i] - c[0], s.y[i] - c[1], s.z[i] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += d[a] * d[b] }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; const A = M.map(r => r.slice());
  for (let it = 0; it < 60; it++) {
    let p = 0, q = 1, mx = Math.abs(A[0][1]); if (Math.abs(A[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(A[0][2]) } if (Math.abs(A[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(A[1][2]) }
    if (mx < 1e-9) break; const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]); const cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq }
    for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq }
  }
  const ev = [0, 1, 2].map(i => ({ l: A[i][i], v: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.l - a.l);
  const e1 = ev[0].v, e2 = ev[1].v; const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  // rows e1,e2,e3 → column-major mat4 (rotation R with R*d = (e1·d, e2·d, e3·d))
  const m = new Float32Array(16); m[15] = 1;
  m[0] = e1[0]; m[4] = e1[1]; m[8] = e1[2]; m[1] = e2[0]; m[5] = e2[1]; m[9] = e2[2]; m[2] = e3[0]; m[6] = e3[1]; m[10] = e3[2];
  return m;
}
