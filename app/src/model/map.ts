/* Density maps (cryo-EM, or any 3D scalar grid in the MRC/CCP4 format): reading, downsampling, sampling, and the
   isosurface at a contour level.

   A map is values on a regular grid, x fastest, in the model's frame: voxel (i, j, k) sits at origin + (i, j, k) · step
   (Å). Its contour level is a choice, not a property of the molecule; EMDB records the depositors' recommended one,
   which the figure starts from and states. */

export interface DensityMap {
  name: string;
  nx: number; ny: number; nz: number;
  data: Float32Array;               // nx·ny·nz values, x fastest
  origin: [number, number, number]; // Å, the centre of voxel (0, 0, 0)
  step: [number, number, number];   // Å per voxel
  mean: number; rms: number; min: number; max: number;
  /** the recommended contour level (EMDB's, or the depositors'), if known */
  level?: number;
  /** how much it was downsampled from the file (1: not) */
  binned?: number;
  /** the sample's molecular mass (Da) and the map's resolution (Å), as deposited, if known */
  mass?: number; resolution?: number;
  /** the resolution (Å) it was low-passed to, if it was */
  lowpassed?: number;
}

export function mapStats(data: Float32Array) {
  let s = 0, s2 = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; s += v; s2 += v * v; if (v < mn) mn = v; if (v > mx) mx = v }
  const mean = s / data.length; return { mean, rms: Math.sqrt(Math.max(0, s2 / data.length - mean * mean)), min: mn, max: mx };
}

/** an MRC / CCP4 map (MRC2014; modes 0 int8, 1 int16, 2 float32, 6 uint16); axes reordered so x is fastest */
export function parseMRC(buf: ArrayBuffer, name = 'map'): DensityMap {
  const dv = new DataView(buf); let le = true;
  const i32 = (w: number) => dv.getInt32(w * 4, le), f32 = (w: number) => dv.getFloat32(w * 4, le);
  const mode0 = dv.getInt32(12, true); if (mode0 < 0 || mode0 > 16) le = false;   // big-endian files
  const nc = i32(0), nr = i32(1), ns = i32(2), mode = i32(3), ncstart = i32(4), nrstart = i32(5), nsstart = i32(6);
  const mx = i32(7), my = i32(8), mz = i32(9), cx = f32(10), cy = f32(11), cz = f32(12);
  const mapc = i32(16) || 1, mapr = i32(17) || 2, maps = i32(18) || 3, nsymbt = i32(23);
  const ox = f32(49), oy = f32(50), oz = f32(51);
  if (!(nc > 0 && nr > 0 && ns > 0) || [mapc, mapr, maps].sort().join() !== '1,2,3') throw new Error('not an MRC / CCP4 map');
  const bytes = { 0: 1, 1: 2, 2: 4, 6: 2 }[mode as 0 | 1 | 2 | 6]; if (!bytes) throw new Error(`MRC mode ${mode} is not supported (0, 1, 2 and 6 are)`);
  const off = 1024 + nsymbt, n = nc * nr * ns; if (off + n * bytes > buf.byteLength) throw new Error('the map file is cut short');
  const read = (i: number) => mode === 2 ? dv.getFloat32(off + i * 4, le) : mode === 1 ? dv.getInt16(off + i * 2, le) : mode === 6 ? dv.getUint16(off + i * 2, le) : dv.getInt8(off + i);
  // file axes (column, row, section) are x/y/z as mapc/mapr/maps say; put them in x, y, z order
  const dimOf = [0, 0, 0], startOf = [0, 0, 0]; const ax = [mapc - 1, mapr - 1, maps - 1];
  [nc, nr, ns].forEach((d, i) => { dimOf[ax[i]] = d }); [ncstart, nrstart, nsstart].forEach((s, i) => { startOf[ax[i]] = s });
  const [nx, ny, nz] = dimOf; const data = new Float32Array(n);
  const stride = [0, 0, 0]; stride[ax[0]] = 1; stride[ax[1]] = nc; stride[ax[2]] = nc * nr;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const o = k * nx * ny + j * nx; for (let i = 0; i < nx; i++) data[o + i] = read(i * stride[0] + j * stride[1] + k * stride[2]) }
  const step: [number, number, number] = [cx / (mx || nx), cy / (my || ny), cz / (mz || nz)];
  // MRC2014 puts the origin in Å; older files (and many that leave it 0) give the start voxel instead
  const origin: [number, number, number] = ox || oy || oz ? [ox, oy, oz] : [startOf[0] * step[0], startOf[1] * step[1], startOf[2] * step[2]];
  return { name, nx, ny, nz, data, origin, step, ...mapStats(data) };
}

/** a map averaged down by a whole factor, so no side is longer than `maxDim` voxels (a 1.1 Å, 700³ ribosome map becomes
   about 230³ at 3.3 Å per voxel: the drawing's lines are wider than that); with `above`, only the density at or above
   that level (the rest as 0) */
export function downsample(m: DensityMap, maxDim: number, above?: number): DensityMap {
  const f = Math.ceil(Math.max(m.nx, m.ny, m.nz) / maxDim);
  if (f <= 1) { if (above === undefined) return m; const d = m.data, a = new Float32Array(d.length); for (let i = 0; i < d.length; i++) { const v = d[i]; a[i] = v >= above ? v : 0 } return { ...m, data: a } }
  const nx = Math.floor(m.nx / f), ny = Math.floor(m.ny / f), nz = Math.floor(m.nz / f), out = new Float32Array(nx * ny * nz), w = 1 / (f * f * f), d = m.data;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let c = 0; c < f; c++) for (let b = 0; b < f; b++) { const o = (k * f + c) * m.nx * m.ny + (j * f + b) * m.nx + i * f;
      if (above === undefined) for (let a = 0; a < f; a++) s += d[o + a]; else for (let a = 0; a < f; a++) { const v = d[o + a]; s += v >= above ? v : 0 } }
    out[k * nx * ny + j * nx + i] = s * w;
  }
  const origin: [number, number, number] = [0, 1, 2].map(a => m.origin[a] + (f - 1) / 2 * m.step[a]) as any;
  return { ...m, nx, ny, nz, data: out, origin, step: [m.step[0] * f, m.step[1] * f, m.step[2] * f], ...mapStats(out), binned: (m.binned || 1) * f };
}

/** the map low-passed to a resolution (Å): a Gaussian of standard deviation 0.225·R (ChimeraX's "resolution" of a
    Gaussian filter, R/(π√2)), separable, with the edges clamped */
export function lowpass(m: DensityMap, R: number): DensityMap {
  const sd = 0.225 * R, n = [m.nx, m.ny, m.nz], strides = [1, m.nx, m.nx * m.ny];
  let a = Float32Array.from(m.data), b = new Float32Array(a.length);
  for (let ax = 0; ax < 3; ax++) {
    const s = sd / m.step[ax], r = Math.ceil(3 * s); if (r < 1) continue;
    const k = new Float32Array(2 * r + 1); let tot = 0; for (let i = -r; i <= r; i++) tot += k[i + r] = Math.exp(-i * i / (2 * s * s)); for (let i = 0; i < k.length; i++) k[i] /= tot;
    const len = n[ax], st = strides[ax], lines = a.length / len;
    const [o1, o2] = [0, 1, 2].filter(x => x !== ax), n1 = n[o1], s1 = strides[o1], s2 = strides[o2];
    for (let l = 0; l < lines; l++) { const base = (l % n1) * s1 + Math.floor(l / n1) * s2;
      for (let i = 0; i < len; i++) { let v = 0; for (let t = -r; t <= r; t++) { const q = Math.min(len - 1, Math.max(0, i + t)); v += a[base + q * st] * k[t + r] } b[base + i * st] = v } }
    [a, b] = [b, a];
  }
  return { ...m, data: a, ...mapStats(a), lowpassed: R };
}

/** the map resampled (trilinearly) to a finer voxel, so a close-up's surface is not faceted by the grid */
export function upsample(m: DensityMap, step: number): DensityMap {
  const f = m.step[0] / step; if (f <= 1.05) return m;
  const nx = Math.max(2, Math.round((m.nx - 1) * f) + 1), ny = Math.max(2, Math.round((m.ny - 1) * f) + 1), nz = Math.max(2, Math.round((m.nz - 1) * f) + 1);
  const st: [number, number, number] = [(m.nx - 1) * m.step[0] / (nx - 1), (m.ny - 1) * m.step[1] / (ny - 1), (m.nz - 1) * m.step[2] / (nz - 1)];
  const out = new Float32Array(nx * ny * nz), d = m.data, d0 = d[0];
  // trilinear, as sampleMap samples (the same arithmetic in the same order, so the same values), with each axis's
  // source cell and weight found once rather than per voxel
  const axis = (cnt: number, n: number, s: number, o: number, t: number) => { const c = new Int32Array(cnt), u = new Float64Array(cnt);
    for (let a = 0; a < cnt; a++) { const x = Math.min(a * t, (n - 1) * s - 1e-4), f = ((o + x) - o) / s, i = Math.floor(f); c[a] = i < 0 || i >= n - 1 ? -1 : i; u[a] = f - i } return { c, u } };
  const X = axis(nx, m.nx, m.step[0], m.origin[0], st[0]), Y = axis(ny, m.ny, m.step[1], m.origin[1], st[1]), Z = axis(nz, m.nz, m.step[2], m.origin[2], st[2]);
  const sy = m.nx, sz = m.nx * m.ny;
  for (let k = 0, q = 0; k < nz; k++) { const kk = Z.c[k], w = Z.u[k];
    for (let j = 0; j < ny; j++) { const jj = Y.c[j], v = Y.u[j];
      // the source cell's corners, read again only when the next voxel is in another cell
      let at = -1, a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0;
      for (let i = 0; i < nx; i++, q++) { const ii = X.c[i]; if (ii < 0 || jj < 0 || kk < 0) { out[q] = d0; continue }
        const u = X.u[i];
        if (ii !== at) { const o = kk * sz + jj * sy + ii; at = ii; a0 = d[o]; a1 = d[o + 1]; a2 = d[o + sy]; a3 = d[o + sy + 1]; a4 = d[o + sz]; a5 = d[o + sz + 1]; a6 = d[o + sz + sy]; a7 = d[o + sz + sy + 1] }
        const c00 = a0 * (1 - u) + a1 * u, c10 = a2 * (1 - u) + a3 * u;
        const c01 = a4 * (1 - u) + a5 * u, c11 = a6 * (1 - u) + a7 * u;
        out[q] = (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w } } }
  return { ...m, nx, ny, nz, data: out, step: st, ...mapStats(out), mean: m.mean, rms: m.rms };
}

/** Taubin smoothing of an isosurface (shrink-free: a smoothing step, then an inflating one), as ChimeraX smooths
    surfaces; the normals are then taken from the smoothed faces, pointing the way the density's gradient did */
export function smoothSurface(iso: Isosurface, iterations: number): Isosurface {
  const n = iso.positions.length / 3, tri = iso.triangles; if (!iterations || !n) return iso;
  // each vertex's neighbours, once for every triangle edge they share, in the order the triangles list them
  const deg = new Int32Array(n + 1);
  for (let t = 0; t < tri.length; t += 3) { deg[tri[t] + 1] += 2; deg[tri[t + 1] + 1] += 2; deg[tri[t + 2] + 1] += 2 }
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const at = deg.slice(0, n), nb = new Int32Array(deg[n]);
  for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) { const a = tri[t + e], b = tri[t + (e + 1) % 3]; nb[at[a]++] = b; nb[at[b]++] = a }
  let p = Float32Array.from(iso.positions), q = new Float32Array(p.length);
  for (let it = 0; it < iterations * 2; it++) { const w = it % 2 ? -0.53 : 0.5;
    for (let v = 0; v < n; v++) { const l0 = deg[v], l1 = deg[v + 1], o = v * 3; if (l0 === l1) { q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2]; continue }
      let sx = 0, sy = 0, sz = 0; for (let j = l0; j < l1; j++) { const u = nb[j] * 3; sx += p[u]; sy += p[u + 1]; sz += p[u + 2] } const k = 1 / (l1 - l0);
      q[o] = p[o] + w * (sx * k - p[o]); q[o + 1] = p[o + 1] + w * (sy * k - p[o + 1]); q[o + 2] = p[o + 2] + w * (sz * k - p[o + 2]) }
    const t = p; p = q; q = t }
  const nor = new Float32Array(p.length);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz; nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz; nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz }
  let agree = 0; for (let v = 0; v < n; v++) agree += nor[v * 3] * iso.normals[v * 3] + nor[v * 3 + 1] * iso.normals[v * 3 + 1] + nor[v * 3 + 2] * iso.normals[v * 3 + 2];
  const sg = agree < 0 ? -1 : 1;
  for (let v = 0; v < n; v++) { const L = Math.hypot(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]) || 1; for (let c = 0; c < 3; c++) nor[v * 3 + c] = sg * nor[v * 3 + c] / L }
  return { ...iso, positions: p, normals: nor };
}

/** the part of the map inside a box (Å, the map's frame): a sub-grid, or the map itself when the box holds it all */
export function cropMap(m: DensityMap, lo: number[], hi: number[]): DensityMap {
  const a = [0, 1, 2].map(k => Math.max(0, Math.floor((lo[k] - m.origin[k]) / m.step[k]))), n = [m.nx, m.ny, m.nz];
  const b = [0, 1, 2].map(k => Math.min(n[k] - 1, Math.ceil((hi[k] - m.origin[k]) / m.step[k])));
  if (a.every(v => v === 0) && b.every((v, k) => v === n[k] - 1)) return m;
  const [nx, ny, nz] = [0, 1, 2].map(k => Math.max(2, b[k] - a[k] + 1)), out = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const src = (a[2] + k) * m.nx * m.ny + (a[1] + j) * m.nx + a[0]; out.set(m.data.subarray(src, src + nx), (k * ny + j) * nx) }
  return { ...m, nx, ny, nz, data: out, origin: [0, 1, 2].map(k => m.origin[k] + a[k] * m.step[k]) as any };   // the stats stay the whole map's: σ means the same
}

/** the level at which the map encloses a volume (Å³), counting only the voxels of a zone if given */
export function levelEnclosing(m: DensityMap, volume: number, zone?: Uint8Array): number {
  const n = Math.round(volume / (m.step[0] * m.step[1] * m.step[2])), d = m.data;
  let len = d.length; if (zone) { len = 0; for (let i = 0; i < d.length; i++) if (zone[i]) len++ }
  const a = new Float32Array(len); if (zone) { for (let i = 0, k = 0; i < d.length; i++) if (zone[i]) a[k++] = d[i] } else a.set(d);
  return len ? kthOf(a, Math.max(0, Math.min(len - 1, len - n))) : (undefined as any);   // the value a sort would put there, without sorting
}
/** the k-th smallest value (0-based) of an array, as sorting it would place it (quickselect: the array is reordered) */
export function kthOf(a: Float32Array, k: number): number {
  let lo = 0, hi = a.length - 1;
  while (hi > lo) {
    const mid = (lo + hi) >> 1; const x = a[lo], y = a[mid], z = a[hi];
    const p = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);   // median of three
    let i = lo, j = hi;
    while (i <= j) { while (a[i] < p) i++; while (a[j] > p) j--; if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j-- } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}

/** the density at a point (Å, the map's frame), trilinear; outside the box, the map's minimum */
export function sampleMap(m: DensityMap, x: number, y: number, z: number): number {
  const fx = (x - m.origin[0]) / m.step[0], fy = (y - m.origin[1]) / m.step[1], fz = (z - m.origin[2]) / m.step[2];
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= m.nx - 1 || j >= m.ny - 1 || k >= m.nz - 1) return m.min;
  const u = fx - i, v = fy - j, w = fz - k, sx = 1, sy = m.nx, sz = m.nx * m.ny, o = k * sz + j * sy + i, d = m.data;
  const c00 = d[o] * (1 - u) + d[o + sx] * u, c10 = d[o + sy] * (1 - u) + d[o + sy + sx] * u;
  const c01 = d[o + sz] * (1 - u) + d[o + sz + sx] * u, c11 = d[o + sz + sy] * (1 - u) + d[o + sz + sy + sx] * u;
  return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
}

export interface Isosurface {
  level: number;
  positions: Float32Array;   // vertices, Å, the map's frame
  normals: Float32Array;     // outward unit normals (down the density gradient)
  triangles: Uint32Array;
}

/** The isosurface at `level`, by surface nets: one vertex in every voxel cell the surface crosses, at the mean of the
   crossing points on the cell's edges, and two triangles for every grid edge the surface crosses, joining the four
   cells round it. Watertight, and within a voxel of the exact (linearly interpolated) surface. */
// a cell's edges as pairs of its corners (corner c at x = c & 1, y = (c >> 1) & 1, z = c >> 2)
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
export function isosurface(m: DensityMap, level: number): Isosurface {
  const { nx, ny, nz, data: d } = m, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cxy = cx * cy, cellIndex = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  let pos = new Float32Array(1 << 12), nor = new Float32Array(1 << 12), nv = 0;
  let cells = new Int32Array(1 << 10), masks = new Uint8Array(1 << 10);   // the cells the surface crosses, in order, and their corners in or out
  const v = new Float64Array(8), o0 = m.origin[0], o1 = m.origin[1], o2 = m.origin[2], s0 = m.step[0], s1 = m.step[1], s2 = m.step[2];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) {
    // along the row, each cell's left corners are the last one's right ones: read once
    let o = k * sz + j * sy, v0 = d[o], v2 = d[o + sy], v4 = d[o + sz], v6 = d[o + sz + sy];
    let left = (v0 >= level ? 1 : 0) | (v2 >= level ? 4 : 0) | (v4 >= level ? 16 : 0) | (v6 >= level ? 64 : 0);
    for (let i = 0; i < nx - 1; i++, o++) {
      // the cell's corners in corner order (corner c at x = c & 1, y = (c >> 1) & 1, z = c >> 2)
      const v1 = d[o + 1], v3 = d[o + sy + 1], v5 = d[o + sz + 1], v7 = d[o + sz + sy + 1];
      const right = (v1 >= level ? 1 : 0) | (v3 >= level ? 4 : 0) | (v5 >= level ? 16 : 0) | (v7 >= level ? 64 : 0), mask = left | right << 1;
      if (mask !== 0 && mask !== 255) {
        v[0] = v0; v[1] = v1; v[2] = v2; v[3] = v3; v[4] = v4; v[5] = v5; v[6] = v6; v[7] = v7;
        let px = 0, py = 0, pz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGE_A[e], b = EDGE_B[e]; if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = (level - v[a]) / (v[b] - v[a]), ax = a & 1, ay = (a >> 1) & 1, az = a >> 2;
          px += ax + ((b & 1) - ax) * t; py += ay + (((b >> 1) & 1) - ay) * t; pz += az + ((b >> 2) - az) * t; n++;
        }
        px = i + px / n; py = j + py / n; pz = k + pz / n;
        // the normal: minus the density gradient, trilinear inside the cell
        const fx = px - i, fy = py - j, fz = pz - k;
        const gx = ((v[1] - v[0]) * (1 - fy) + (v[3] - v[2]) * fy) * (1 - fz) + ((v[5] - v[4]) * (1 - fy) + (v[7] - v[6]) * fy) * fz;
        const gy = ((v[2] - v[0]) * (1 - fx) + (v[3] - v[1]) * fx) * (1 - fz) + ((v[6] - v[4]) * (1 - fx) + (v[7] - v[5]) * fx) * fz;
        const gz = ((v[4] - v[0]) * (1 - fx) + (v[5] - v[1]) * fx) * (1 - fy) + ((v[6] - v[2]) * (1 - fx) + (v[7] - v[3]) * fx) * fy;
        const ux = -gx / s0, uy = -gy / s1, uz = -gz / s2, L = Math.hypot(ux, uy, uz) || 1;
        const c = k * cxy + j * cx + i; cellIndex[c] = nv;
        if (nv * 3 + 3 > pos.length) { const P = new Float32Array(pos.length * 2), N = new Float32Array(pos.length * 2); P.set(pos); N.set(nor); pos = P; nor = N }
        if (nv === cells.length) { const C = new Int32Array(nv * 2), M = new Uint8Array(nv * 2); C.set(cells); M.set(masks); cells = C; masks = M }
        const w = nv * 3; pos[w] = o0 + px * s0; pos[w + 1] = o1 + py * s1; pos[w + 2] = o2 + pz * s2; nor[w] = ux / L; nor[w + 1] = uy / L; nor[w + 2] = uz / L;
        cells[nv] = c; masks[nv] = mask; nv++;
      }
      v0 = v1; v2 = v3; v4 = v5; v6 = v7; left = right;
    }
  }
  // every grid edge the surface crosses: the four cells that share it make a quad, wound so the normal points out. Such an
  // edge is a crossed cell's own edge from its corner 0 (along x, y or z: to corner 1, 2 or 4), and every grid edge
  // that is one, so the crossed cells, in order, give them in grid order: all those along x, then y, then z
  let tri = new Uint32Array(1 << 12), nt = 0;
  const quad = (a: number, b: number, c: number, e: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (nt + 6 > tri.length) { const T = new Uint32Array(tri.length * 2); T.set(tri); tri = T }
    if (flip) { tri[nt] = a; tri[nt + 1] = c; tri[nt + 2] = b; tri[nt + 3] = b; tri[nt + 4] = c; tri[nt + 5] = e }
    else { tri[nt] = a; tri[nt + 1] = b; tri[nt + 2] = c; tri[nt + 3] = b; tri[nt + 4] = e; tri[nt + 5] = c }
    nt += 6;
  };
  for (let q = 0; q < nv; q++) { const c = cells[q], mask = masks[q], j = ((c / cx) | 0) % cy, k = (c / cxy) | 0;   // x edges
    if (j < 1 || k < 1 || ((mask ^ mask >> 1) & 1) === 0) continue;
    quad(cellIndex[c - cxy - cx], cellIndex[c - cxy], cellIndex[c - cx], q, (mask & 1) === 1) }
  for (let q = 0; q < nv; q++) { const c = cells[q], mask = masks[q], i = c % cx, k = (c / cxy) | 0;   // y edges
    if (i < 1 || k < 1 || ((mask ^ mask >> 2) & 1) === 0) continue;
    quad(cellIndex[c - cxy - 1], cellIndex[c - 1], cellIndex[c - cxy], q, (mask & 1) === 1) }
  for (let q = 0; q < nv; q++) { const c = cells[q], mask = masks[q], i = c % cx, j = ((c / cx) | 0) % cy;   // z edges
    if (i < 1 || j < 1 || ((mask ^ mask >> 4) & 1) === 0) continue;
    quad(cellIndex[c - cx - 1], cellIndex[c - cx], cellIndex[c - 1], q, (mask & 1) === 1) }
  return { level, positions: pos.slice(0, nv * 3), normals: nor.slice(0, nv * 3), triangles: tri.slice(0, nt) };
}

/** the contour lines of the map on a plane of the grid (axis 0 x, 1 y, 2 z; index along it), by marching squares:
   polylines in Å, the map's frame. The chicken wire of a mesh drawing is these, on every few planes of all three axes. */
export function sliceContours(m: DensityMap, axis: 0 | 1 | 2, index: number, level: number): number[][] {
  const dims = [m.nx, m.ny, m.nz], [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const nu = dims[ua], nv = dims[va], stride = [1, m.nx, m.nx * m.ny], su = stride[ua], sw = stride[va], d = m.data, base = index * stride[axis];
  const oU = m.origin[ua], hU = m.step[ua], oW = m.origin[va], hW = m.step[va], fixed = m.origin[axis] + index * m.step[axis];
  const segs: number[][] = [], pts = new Float64Array(8); let np = 0;
  // a point on a square's edge, (u, w) on the plane, kept until its segment is made
  const at = (u: number, w: number) => { pts[np++] = u; pts[np++] = w };
  const cross = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number) => { const t = (level - v0) / (v1 - v0); at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) };
  const xyz = (o: number, out: number[], k: number) => { out[k + axis] = fixed; out[k + ua] = oU + pts[o] * hU; out[k + va] = oW + pts[o + 1] * hW };
  for (let w = 0; w < nv - 1; w++) for (let u = 0; u < nu - 1; u++) {
    const q = base + u * su + w * sw, a = d[q], b = d[q + su], c = d[q + su + sw], e = d[q + sw];
    const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (e >= level ? 8 : 0); if (idx === 0 || idx === 15) continue;
    np = 0;
    if ((idx & 1) !== ((idx >> 1) & 1)) cross(u, w, a, u + 1, w, b);
    if (((idx >> 1) & 1) !== ((idx >> 2) & 1)) cross(u + 1, w, b, u + 1, w + 1, c);
    if (((idx >> 2) & 1) !== ((idx >> 3) & 1)) cross(u + 1, w + 1, c, u, w + 1, e);
    if (((idx >> 3) & 1) !== (idx & 1)) cross(u, w + 1, e, u, w, a);
    for (let s = 0; s + 3 < np; s += 4) { const seg = [0, 0, 0, 0, 0, 0]; xyz(s, seg, 0); xyz(s + 2, seg, 3); segs.push(seg) }
  }
  return segs;
}

/** segments (x0 y0 z0 x1 y1 z1 each) joined into polylines where their ends meet */
export function joinSegments(segs: number[][], tol = 1e-4): number[][][] {
  const key = (x: number, y: number, z: number) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  const n = segs.length, ka: string[] = new Array(n), kb: string[] = new Array(n);   // each segment's ends, as keys
  const ends = new Map<string, number[]>(); const used = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const s = segs[i]; ka[i] = key(s[0], s[1], s[2]); kb[i] = key(s[3], s[4], s[5]);
    for (const e of [ka[i], kb[i]]) { let l = ends.get(e); if (!l) ends.set(e, l = []); l.push(i) } }
  const next = (k: string) => { const cand = ends.get(k); if (cand) for (const c of cand) if (!used[c]) return c; return -1 };
  const lines: number[][][] = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue; used[i] = 1; const s = segs[i]; const line = [[s[0], s[1], s[2]], [s[3], s[4], s[5]]];
    // grow from the tail, then from the head (gathered back to front)
    for (let k = kb[i], c = next(k); c >= 0; c = next(k)) { used[c] = 1; const t = segs[c]; if (ka[c] === k) { line.push([t[3], t[4], t[5]]); k = kb[c] } else { line.push([t[0], t[1], t[2]]); k = ka[c] } }
    const head: number[][] = [];
    for (let k = ka[i], c = next(k); c >= 0; c = next(k)) { used[c] = 1; const t = segs[c]; if (ka[c] === k) { head.push([t[3], t[4], t[5]]); k = kb[c] } else { head.push([t[0], t[1], t[2]]); k = ka[c] } }
    lines.push(head.length ? head.reverse().concat(line) : line);
  }
  return lines;
}
