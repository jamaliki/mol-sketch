/* Geometry builders: structure + selection + colours → instance arrays and meshes (CPU side, no GL). */
import { Structure, type Residue } from '../model/structure';
import { ColorScheme, elementClass } from '../model/color';
import { hexToRgb, type Style } from '../style';
import { SPHERE_STRIDE, CYL_STRIDE, MESH_STRIDE } from './batches';

export const REP_STICKS = 1, REP_CARTOON = 2, REP_SURFACE = 3;
export const CLS_CARTOON = 8, CLS_SURFACE = 9;

/* ---------------- sticks ---------------- */
export function buildSticks(s: Structure, mask: Uint8Array, scheme: ColorScheme, style: Style) {
  const r = style.stickRadius; const X = s.x, Y = s.y, Z = s.z;
  const col = new Map<number, [number, number, number]>();
  const colorOf = (i: number) => { let c = col.get(i); if (!c) { c = hexToRgb(scheme.atom(i)); col.set(i, c) } return c };
  const degree = new Uint8Array(s.count);
  const cyl: number[] = [];
  for (let b = 0; b < s.bonds.length; b += 2) {
    const i = s.bonds[b], j = s.bonds[b + 1]; if (!mask[i] || !mask[j]) continue;
    degree[i]++; degree[j]++;
    const mx = (X[i] + X[j]) / 2, my = (Y[i] + Y[j]) / 2, mz = (Z[i] + Z[j]) / 2;
    const ci = colorOf(i), cj = colorOf(j);
    const rh = (s.element[i] === 'H' || s.element[j] === 'H') ? r * 0.75 : r;
    cyl.push(X[i], Y[i], Z[i], mx, my, mz, rh, ci[0], ci[1], ci[2], i, elementClass(s.element[i]));
    cyl.push(mx, my, mz, X[j], Y[j], Z[j], rh, cj[0], cj[1], cj[2], j, elementClass(s.element[j]));
  }
  const sph: number[] = [];
  for (let i = 0; i < s.count; i++) {
    if (!mask[i]) continue; const c = colorOf(i);
    const rad = (s.flags[i] & 1) ? r * (1 + style.sphereScale * 4) : degree[i] ? (s.element[i] === 'H' ? r * 0.75 : r) : r * 1.7;
    sph.push(X[i], Y[i], Z[i], rad, c[0], c[1], c[2], i, elementClass(s.element[i]));
  }
  return { spheres: Float32Array.from(sph), cylinders: Float32Array.from(cyl) };
}

/* ---------------- surface (per-residue blobs, Goodsell style) ---------------- */
export function buildSurface(s: Structure, mask: Uint8Array, scheme: ColorScheme, style: Style) {
  const X = s.x, Y = s.y, Z = s.z; const out: number[] = [];
  for (const res of s.residues) {
    let n = 0, cx = 0, cy = 0, cz = 0;
    for (let i = res.atomStart; i < res.atomEnd; i++) if (mask[i]) { n++; cx += X[i]; cy += Y[i]; cz += Z[i] }
    if (!n) continue; cx /= n; cy /= n; cz /= n;
    let r2 = 0; for (let i = res.atomStart; i < res.atomEnd; i++) if (mask[i]) { const d = (X[i] - cx) ** 2 + (Y[i] - cy) ** 2 + (Z[i] - cz) ** 2; if (d > r2) r2 = d }
    const rad = Math.sqrt(r2) * 0.9 + style.probe;
    const c = hexToRgb(scheme.surface(res));
    out.push(cx, cy, cz, rad, c[0], c[1], c[2], res.index, CLS_SURFACE);
  }
  return Float32Array.from(out);
}

/* ---------------- cartoon ---------------- */
export interface Sample { p: number[]; t: number[]; n: number[]; w: number; th: number; flat: number; color: [number, number, number]; id: number; ss: string; nucleic: boolean }
export interface CartoonRun { id: number; samples: Sample[]; colorHex: string; ss: string }

const v3 = {
  sub: (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: number[], s: number) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: number[]) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] },
  lerp: (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  const g = (a: number, b: number, c: number, d: number) => 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
  return { p: [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])], d: [g(p0[0], p1[0], p2[0], p3[0]), g(p0[1], p1[1], p2[1], p3[1]), g(p0[2], p1[2], p2[2], p3[2])] };
}

export function buildCartoon(s: Structure, mask: Uint8Array, scheme: ColorScheme, style: Style, detail = 1) {
  const X = s.x, Y = s.y, Z = s.z; const sc = style.cartoonScale;
  const pos = (i: number) => [X[i], Y[i], Z[i]];
  const verts: number[] = []; const idx: number[] = []; let runId = 0; const runs: CartoonRun[] = [];
  const big = s.count > 60000;
  const perRes = Math.max(2, Math.round((big ? 3 : 6) * detail));

  for (const ch of s.chains) {
    // residues drawn: polymer with a trace atom that is selected
    const R = ch.residues.map(i => s.residues[i]).filter(r => !r.het && r.trace >= 0 && mask[r.trace]);
    // split at chain breaks
    const segs: Residue[][] = []; let cur: Residue[] = [];
    for (let i = 0; i < R.length; i++) {
      if (cur.length) { const a = cur[cur.length - 1], b = R[i]; const d = v3.len(v3.sub(pos(a.trace), pos(b.trace))); const lim = (a.nucleic || b.nucleic) ? 10 : 4.6; if (d > lim || a.nucleic !== b.nucleic) { segs.push(cur); cur = [] } }
      cur.push(R[i]);
    }
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      if (seg.length < 2) continue;
      const n = seg.length; const P = seg.map(r => pos(r.trace));
      // orientation reference: C=O direction (protein) with flips made consistent; nucleic: none
      const O: number[][] = seg.map((r, i) => {
        if (r.nucleic || r.orient < 0) return [0, 0, 0];
        const o = v3.sub(pos(r.orient), P[i]); return v3.norm(o);
      });
      for (let i = 1; i < n; i++) if (v3.dot(O[i], O[i - 1]) < 0) O[i] = v3.scale(O[i], -1);
      // smooth references over a small window
      const Os = O.map((_, i) => { let a = [0, 0, 0]; for (let k = -1; k <= 1; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); a = v3.add(a, O[j]) } return v3.norm(a) });
      // per-residue section parameters
      const par = seg.map(r => {
        if (r.nucleic) return { w: 1.1 * sc, th: 1.1 * sc, flat: 0 };
        if (r.ss === 'H') return { w: 1.6 * sc, th: 0.3 * sc, flat: 1 };
        if (r.ss === 'E') return { w: 1.5 * sc, th: 0.3 * sc, flat: 1 };
        return { w: 0.5 * sc, th: 0.5 * sc, flat: 0 };
      });
      // run ids: a new id at each SS change so the stylisation draws a line between helix and loop
      // run ids: a new id at each SS change, and every so often along long stretches so no single region grows huge
      let runLen = 0;
      const rid = seg.map((r, i) => { runLen++; if (i === 0 || r.ss !== seg[i - 1].ss || runLen > (r.nucleic ? 10 : r.ss === 'L' ? 16 : 40)) { runId++; runLen = 1 } return runId });
      const samples: Sample[] = [];
      let prevN: number[] | null = null;
      for (let i = 0; i < n - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
        const isArrow = seg[i].ss === 'E' && (i === n - 2 || seg[i + 1].ss !== 'E');
        const last = i === n - 2;
        for (let k = 0; k <= (last ? perRes : perRes - 1); k++) {
          const t = k / perRes; const { p, d } = catmull(p0, p1, p2, p3, t);
          const T = v3.norm(d);
          let ref = v3.lerp(Os[i], Os[i + 1], t);
          if (v3.len(ref) < 1e-3) ref = prevN ?? (Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
          let N = v3.norm(v3.sub(ref, v3.scale(T, v3.dot(ref, T))));
          if (prevN && v3.dot(N, prevN) < 0 && seg[i].nucleic) N = v3.scale(N, -1);
          if (prevN && v3.len(N) < 1e-3) N = prevN;
          prevN = N;
          const a = par[i], b = par[i + 1];
          let w = a.w + (b.w - a.w) * t, th = a.th + (b.th - a.th) * t, flat = a.flat + (b.flat - a.flat) * t;
          if (isArrow) { w = 2.4 * a.w * (1 - t) + 0.08; th = a.th; flat = 1 }
          const near = t < 0.5 ? i : i + 1;
          samples.push({ p, t: T, n: N, w, th, flat, color: hexToRgb(scheme.cartoon(seg[near])), id: rid[near], ss: seg[near].ss, nucleic: seg[near].nucleic });
        }
      }
      // split the samples into runs (one per SS stretch) so each run is one region family for the sketch pass
      let a = 0; while (a < samples.length) { let b = a; while (b + 1 < samples.length && samples[b + 1].id === samples[a].id) b++;
        const run = samples.slice(a, b + 2 <= samples.length ? b + 2 : b + 1);   // overlap by one sample so runs join
        runs.push({ id: samples[a].id, samples: run, colorHex: scheme.cartoon(seg[Math.min(seg.length - 1, Math.round(a / perRes))]), ss: samples[a].ss }); a = b + 1 }
      emitRibbon(samples, verts, idx);
    }
  }
  return { verts: Float32Array.from(verts), idx: Uint32Array.from(idx), runs };
}

/** 8-point superellipse rings swept along the samples; n=8 is a flat ribbon, n=2 a tube.
    Vertices are duplicated per quad so each quad carries a face id: id = run*4 + face, where face 0 is the +B side,
    1 the −B side, 2 and 3 the two edges; tubes have a single face. The sketch pass turns face boundaries into ribbon edge lines. */
function emitRibbon(S: Sample[], verts: number[], idx: number[]) {
  const RING = 8;
  const FACE = [0, 0, 0, 0, 1, 1, 1, 0];   // quad j (between ring points j and j+1) → face: 0 the +B side (with both thin edges), 1 the −B side
  const ring = (s: Sample) => {
    const B = v3.norm(v3.cross(s.t, s.n)); const N = s.n; const a = s.w / 2, b = s.th / 2; const nExp = 2 + 6 * s.flat; const e = 2 / nExp;
    const out: { p: number[]; n: number[] }[] = [];
    for (let j = 0; j < RING; j++) {
      const ang = (j + 0.5) / RING * Math.PI * 2; const c = Math.cos(ang), sn = Math.sin(ang);
      const x = Math.sign(c) * Math.pow(Math.abs(c), e), y = Math.sign(sn) * Math.pow(Math.abs(sn), e);
      const gx = nExp * Math.pow(Math.abs(x), nExp - 1) * Math.sign(x) / a, gy = nExp * Math.pow(Math.abs(y), nExp - 1) * Math.sign(y) / b;
      const gl = Math.hypot(gx, gy) || 1; const nx = gx / gl, ny = gy / gl;
      out.push({ p: [s.p[0] + N[0] * x * a + B[0] * y * b, s.p[1] + N[1] * x * a + B[1] * y * b, s.p[2] + N[2] * x * a + B[2] * y * b], n: v3.norm([N[0] * nx + B[0] * ny, N[1] * nx + B[1] * ny, N[2] * nx + B[2] * ny]) });
    }
    return out;
  };
  let prev = S.length ? ring(S[0]) : [];
  const push = (s: Sample, r: { p: number[]; n: number[] }, id: number) => { verts.push(r.p[0], r.p[1], r.p[2], r.n[0], r.n[1], r.n[2], s.color[0], s.color[1], s.color[2], id, CLS_CARTOON); return verts.length / MESH_STRIDE - 1 };
  for (let k = 1; k < S.length; k++) {
    const cur = ring(S[k]); const s0 = S[k - 1], s1 = S[k];
    for (let j = 0; j < RING; j++) {
      const j1 = (j + 1) % RING; const face = (s1.flat > 0.5 || s0.flat > 0.5) ? FACE[j] : 0; const id = s1.id * 4 + face;
      const a = push(s0, prev[j], id), b = push(s1, cur[j], id), c = push(s1, cur[j1], id), d = push(s0, prev[j1], id);
      idx.push(a, b, c, a, c, d);
    }
    prev = cur;
  }
  // end caps
  const cap = (k: number, flip: boolean) => { const s = S[k]; const r = ring(s); const id = s.id * 4; const c = push(s, { p: s.p, n: [-s.t[0] * (flip ? -1 : 1), -s.t[1] * (flip ? -1 : 1), -s.t[2] * (flip ? -1 : 1)] }, id);
    const vi = r.map(q => push(s, q, id)); for (let j = 0; j < RING; j++) { const j1 = (j + 1) % RING; if (flip) idx.push(c, vi[j1], vi[j]); else idx.push(c, vi[j], vi[j1]) } };
  if (S.length > 1) { cap(0, false); cap(S.length - 1, true) }
}

export { SPHERE_STRIDE, CYL_STRIDE };
