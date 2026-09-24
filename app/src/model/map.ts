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
   about 230³ at 3.3 Å per voxel: the drawing's lines are wider than that) */
export function downsample(m: DensityMap, maxDim: number): DensityMap {
  const f = Math.ceil(Math.max(m.nx, m.ny, m.nz) / maxDim); if (f <= 1) return m;
  const nx = Math.floor(m.nx / f), ny = Math.floor(m.ny / f), nz = Math.floor(m.nz / f), out = new Float32Array(nx * ny * nz), w = 1 / (f * f * f);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0; for (let c = 0; c < f; c++) for (let b = 0; b < f; b++) { const o = (k * f + c) * m.nx * m.ny + (j * f + b) * m.nx + i * f; for (let a = 0; a < f; a++) s += m.data[o + a] }
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
  const n = Math.round(volume / (m.step[0] * m.step[1] * m.step[2])), sorted = (zone ? Float32Array.from(m.data.filter((_, i) => zone[i])) : Float32Array.from(m.data)).sort();
  return sorted[Math.max(0, Math.min(sorted.length - 1, sorted.length - n))];
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
export function isosurface(m: DensityMap, level: number): Isosurface {
  const { nx, ny, nz, data: d } = m, sy = nx, sz = nx * ny;
  const cx = nx - 1, cy = ny - 1, cellIndex = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos: number[] = [], nor: number[] = [], tri: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const q = corner[c]; const val = d[(k + q[2]) * sz + (j + q[1]) * sy + i + q[0]]; v[c] = val; if (val >= level) mask |= 1 << c }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (const [a, b] of edges) {
      const ia = (mask >> a) & 1, ib = (mask >> b) & 1; if (ia === ib) continue;
      const t = (level - v[a]) / (v[b] - v[a]), qa = corner[a], qb = corner[b];
      px += qa[0] + (qb[0] - qa[0]) * t; py += qa[1] + (qb[1] - qa[1]) * t; pz += qa[2] + (qb[2] - qa[2]) * t; n++;
    }
    px = i + px / n; py = j + py / n; pz = k + pz / n;
    // the normal: minus the density gradient, trilinear inside the cell
    const fx = px - i, fy = py - j, fz = pz - k;
    const gx = ((v[1] - v[0]) * (1 - fy) + (v[3] - v[2]) * fy) * (1 - fz) + ((v[5] - v[4]) * (1 - fy) + (v[7] - v[6]) * fy) * fz;
    const gy = ((v[2] - v[0]) * (1 - fx) + (v[3] - v[1]) * fx) * (1 - fz) + ((v[6] - v[4]) * (1 - fx) + (v[7] - v[5]) * fx) * fz;
    const gz = ((v[4] - v[0]) * (1 - fx) + (v[5] - v[1]) * fx) * (1 - fy) + ((v[6] - v[2]) * (1 - fx) + (v[7] - v[3]) * fx) * fy;
    const ux = -gx / m.step[0], uy = -gy / m.step[1], uz = -gz / m.step[2], L = Math.hypot(ux, uy, uz) || 1;
    cellIndex[k * cx * cy + j * cx + i] = pos.length / 3;
    pos.push(m.origin[0] + px * m.step[0], m.origin[1] + py * m.step[1], m.origin[2] + pz * m.step[2]); nor.push(ux / L, uy / L, uz / L);
  }
  const cell = (i: number, j: number, k: number) => cellIndex[k * cx * cy + j * cx + i];
  const quad = (a: number, b: number, c: number, e: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (flip) tri.push(a, c, b, b, c, e); else tri.push(a, b, c, b, e, c);
  };
  // every grid edge the surface crosses: the four cells that share it make a quad, wound so the normal points out
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {   // x edges
    const o = k * sz + j * sy + i, a = d[o] >= level, b = d[o + 1] >= level; if (a === b) continue;
    quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j - 1, k), cell(i, j, k), a);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // y edges
    const o = k * sz + j * sy + i, a = d[o] >= level, b = d[o + sy] >= level; if (a === b) continue;
    quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k - 1), cell(i, j, k), a);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // z edges
    const o = k * sz + j * sy + i, a = d[o] >= level, b = d[o + sz] >= level; if (a === b) continue;
    quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i - 1, j, k), cell(i, j, k), a);
  }
  return { level, positions: new Float32Array(pos), normals: new Float32Array(nor), triangles: new Uint32Array(tri) };
}

/** the contour lines of the map on a plane of the grid (axis 0 x, 1 y, 2 z; index along it), by marching squares:
   polylines in Å, the map's frame. The chicken wire of a mesh drawing is these, on every few planes of all three axes. */
export function sliceContours(m: DensityMap, axis: 0 | 1 | 2, index: number, level: number): number[][] {
  const dims = [m.nx, m.ny, m.nz], [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const nu = dims[ua], nv = dims[va], sy = m.nx, sz = m.nx * m.ny;
  const at = (u: number, w: number) => { const q = [0, 0, 0]; q[axis] = index; q[ua] = u; q[va] = w; return m.data[q[2] * sz + q[1] * sy + q[0]] };
  const P = (u: number, w: number) => { const q = [0, 0, 0]; q[axis] = index; q[ua] = u; q[va] = w; return [m.origin[0] + q[0] * m.step[0], m.origin[1] + q[1] * m.step[1], m.origin[2] + q[2] * m.step[2]] };
  const segs: number[][] = [];
  for (let w = 0; w < nv - 1; w++) for (let u = 0; u < nu - 1; u++) {
    const a = at(u, w), b = at(u + 1, w), c = at(u + 1, w + 1), e = at(u, w + 1);
    const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (e >= level ? 8 : 0); if (idx === 0 || idx === 15) continue;
    const cross = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number) => { const t = (level - v0) / (v1 - v0); return P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) };
    const pts: number[][] = [];
    if ((idx & 1) !== ((idx >> 1) & 1)) pts.push(cross(u, w, a, u + 1, w, b));
    if (((idx >> 1) & 1) !== ((idx >> 2) & 1)) pts.push(cross(u + 1, w, b, u + 1, w + 1, c));
    if (((idx >> 2) & 1) !== ((idx >> 3) & 1)) pts.push(cross(u + 1, w + 1, c, u, w + 1, e));
    if (((idx >> 3) & 1) !== (idx & 1)) pts.push(cross(u, w + 1, e, u, w, a));
    for (let s = 0; s + 1 < pts.length; s += 2) segs.push([...pts[s], ...pts[s + 1]]);
  }
  return segs;
}

/** segments (x0 y0 z0 x1 y1 z1 each) joined into polylines where their ends meet */
export function joinSegments(segs: number[][], tol = 1e-4): number[][][] {
  const key = (x: number, y: number, z: number) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  const ends = new Map<string, number[]>(); const used = new Uint8Array(segs.length);
  segs.forEach((s, i) => { for (const e of [key(s[0], s[1], s[2]), key(s[3], s[4], s[5])]) { let l = ends.get(e); if (!l) ends.set(e, l = []); l.push(i) } });
  const lines: number[][][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1; const s = segs[i]; const line = [[s[0], s[1], s[2]], [s[3], s[4], s[5]]];
    for (const dir of [1, 0]) {   // grow from the tail, then from the head
      for (;;) {
        const p = dir ? line[line.length - 1] : line[0]; const cand = ends.get(key(p[0], p[1], p[2])) || [];
        const nx = cand.find(c => !used[c]); if (nx === undefined) break; used[nx] = 1; const t = segs[nx];
        const a = [t[0], t[1], t[2]], b = [t[3], t[4], t[5]]; const far = key(a[0], a[1], a[2]) === key(p[0], p[1], p[2]) ? b : a;
        if (dir) line.push(far); else line.unshift(far);
      }
    }
    lines.push(line);
  }
  return lines;
}
