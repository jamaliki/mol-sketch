/* Regions: from a label image (one label per visible primitive) to closed boundary polygons per label, with each
   boundary segment classified as a silhouette (against paper, or a depth jump) or a contact (touching primitives). */
import type { Pt } from './util';

export interface Loop { pts: Pt[]; kind: Uint8Array; other: Uint32Array }   // kind[i], other[i] describe segment pts[i]→pts[i+1]
export interface Region { label: number; count: number; cx: number; cy: number; z: number; zMin: number; zMax: number; x0: number; y0: number; x1: number; y1: number; loops: Loop[] }

export function extractRegions(W: number, H: number, label: Uint32Array, depth: Float32Array, depthJump: number, simplifyEps = 0.75): Map<number, Region> {
  const regions = new Map<number, Region>();
  const reg = (l: number) => { let r = regions.get(l); if (!r) { r = { label: l, count: 0, cx: 0, cy: 0, z: 0, zMin: Infinity, zMax: -Infinity, x0: W, y0: H, x1: 0, y1: 0, loops: [] }; regions.set(l, r) } return r };
  // per-label edge lists: [startCorner, endCorner, kind, other] flattened
  const edges = new Map<number, number[]>();
  const CW = W + 1;
  const emit = (l: number, s: number, e: number, kind: number, other: number) => { if (!l) return; let a = edges.get(l); if (!a) { a = []; edges.set(l, a) } a.push(s, e, kind, other) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x; const a = label[i]; if (a) { const r = reg(a); r.count++; r.cx += x; r.cy += y; const z = depth[i]; r.z += z; if (z < r.zMin) r.zMin = z; if (z > r.zMax) r.zMax = z; if (x < r.x0) r.x0 = x; if (x + 1 > r.x1) r.x1 = x + 1; if (y < r.y0) r.y0 = y; if (y + 1 > r.y1) r.y1 = y + 1 }
      // right neighbour
      const b = x + 1 < W ? label[i + 1] : 0;
      if (a !== b) { const jump = (a && b) ? Math.abs(depth[i] - depth[i + 1]) > depthJump : true; const kind = jump ? 1 : 0;
        const c0 = y * CW + x + 1, c1 = (y + 1) * CW + x + 1;
        emit(a, c0, c1, kind, b); emit(b, c1, c0, kind, a) }
      if (x === 0 && a) { emit(a, (y + 1) * CW, y * CW, 1, 0) }
      // bottom neighbour
      const c = y + 1 < H ? label[i + W] : 0;
      if (a !== c) { const jump = (a && c) ? Math.abs(depth[i] - depth[i + W]) > depthJump : true; const kind = jump ? 1 : 0;
        const c0 = (y + 1) * CW + x + 1, c1 = (y + 1) * CW + x;
        emit(a, c0, c1, kind, c); emit(c, c1, c0, kind, a) }
      if (y === 0 && a) { emit(a, y * CW + x, y * CW + x + 1, 1, 0) }
    }
  }
  for (const [l, E] of edges) {
    const r = reg(l); r.cx /= r.count; r.cy /= r.count; r.z /= r.count;
    const n = E.length / 4;
    // start corner → edge indices
    const byStart = new Map<number, number[]>();
    for (let k = 0; k < n; k++) { const s = E[k * 4]; let a = byStart.get(s); if (!a) { a = []; byStart.set(s, a) } a.push(k) }
    const used = new Uint8Array(n);
    for (let k0 = 0; k0 < n; k0++) {
      if (used[k0]) continue;
      const corners: number[] = [], kinds: number[] = [], others: number[] = [];
      let k = k0; let px = -1, py = -1;
      for (let guard = 0; guard < n + 2; guard++) {
        used[k] = 1; const s = E[k * 4], e = E[k * 4 + 1]; corners.push(s); kinds.push(E[k * 4 + 2]); others.push(E[k * 4 + 3]);
        const cand = byStart.get(e); if (!cand) break;
        let next = -1; const ex = e % CW, ey = (e - ex) / CW; const dx = ex - (s % CW), dy = ey - (s - s % CW) / CW; px = dx; py = dy;
        let best = -Infinity;
        for (const c of cand) { if (used[c]) continue; const ce = E[c * 4 + 1]; const cx = ce % CW - ex, cy = (ce - ce % CW) / CW - ey; const cross = px * cy - py * cx; if (cross > best) { best = cross; next = c } }
        if (next < 0) break; if (next === k0) break; k = next;
      }
      if (corners.length < 4) continue;
      const pts: Pt[] = corners.map(c => [c % CW, (c - c % CW) / CW]);
      const keep = simplify(pts, simplifyEps);
      if (keep.length < 3) continue;
      const kind = new Uint8Array(keep.length), other = new Uint32Array(keep.length); const out: Pt[] = [];
      for (let q = 0; q < keep.length; q++) { const i0 = keep[q], i1 = keep[(q + 1) % keep.length]; out.push(pts[i0]); let kd = 0; other[q] = others[i0]; for (let i = i0; i !== i1; i = (i + 1) % pts.length) { if (kinds[i]) { kd = 1; other[q] = others[i]; break } } kind[q] = kd }
      r.loops.push({ pts: out, kind, other });
    }
  }
  return regions;
}

/** Ramer–Douglas–Peucker on a closed polyline; returns kept indices in order. */
function simplify(pts: Pt[], eps: number): number[] {
  const n = pts.length; if (n < 4) return pts.map((_, i) => i);
  // split at the two points farthest apart so the closed loop becomes two open chains
  let a = 0, b = Math.floor(n / 2);
  const keep = new Uint8Array(n); keep[a] = 1; keep[b] = 1;
  const stack: [number, number][] = [[a, b], [b, n]];   // second chain wraps to index 0 (= n)
  const P = (i: number) => pts[i % n];
  while (stack.length) {
    const [i0, i1] = stack.pop()!; if (i1 - i0 < 2) continue;
    const p0 = P(i0), p1 = P(i1); const dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) { const p = P(i); const d = Math.abs((p[0] - p0[0]) * dy - (p[1] - p0[1]) * dx) / L; if (d > best) { best = d; bi = i } }
    if (best > eps) { keep[bi % n] = 1; stack.push([i0, bi], [bi, i1]) }
  }
  const out: number[] = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i); return out;
}

/** Push polygon vertices outward by `m` px along the vertex normal (for clip paths that must admit stroke overshoot). */
export function dilate(pts: Pt[], m: number): Pt[] {
  const n = pts.length; const out: Pt[] = new Array(n);
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % n]; return s + p[0] * q[1] - q[0] * p[1] }, 0);
  const sgn = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) { const a = pts[(i + n - 1) % n], p = pts[i], b = pts[(i + 1) % n];
    let e1x = p[0] - a[0], e1y = p[1] - a[1]; let l1 = Math.hypot(e1x, e1y) || 1; e1x /= l1; e1y /= l1;
    let e2x = b[0] - p[0], e2y = b[1] - p[1]; let l2 = Math.hypot(e2x, e2y) || 1; e2x /= l2; e2y /= l2;
    let nx = (e1y + e2y) * sgn, ny = -(e1x + e2x) * sgn; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    out[i] = [p[0] + nx * m, p[1] + ny * m] }
  return out;
}
