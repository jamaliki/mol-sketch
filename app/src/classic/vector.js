/* The flat look drawn as shapes (fill 'flat'). The engine's painter draws a cartoon face by face: a quadrilateral between
   two sections of a ribbon or a tube, its outline a few straight strokes, every face sorted by depth on its own. Drawn so,
   an SVG of a protein is thousands of slivers whose outlines break wherever the next sliver covers them. Here the faces
   are joined into pieces, as an illustrator draws a cartoon: one piece per visible stretch of one surface of one ribbon
   in one colour (a helix's face toward the viewer between two folds, its darker back between the next two, a strand's top
   or its side, a run of a loop's tube), each one closed path of cubic Béziers fitted through its edges, filled, and inked
   along its silhouette with one continuous stroke.

   Joining faces must not change what covers what. Two items overlap when their shapes, outlines included, do; the order
   by depth says which of two overlapping items is in front. Any order of the pieces that keeps every overlapping pair as
   the depth order has it paints the same picture, so a piece can be drawn at once wherever nothing that overlaps it
   needs to come between its faces. Where something does (a loop passing behind one end of a helix's face and in front
   of the other, a tube crossing itself), the pieces' order would go round in a circle; the piece is split there, and
   again until no circle is left. The order then keeps each element's pieces together where the overlaps allow, so the
   drawing's groups (chain, then helix, strand or loop, then pieces; sticks by residue) are as whole as they can be.

   Items other than faces (sticks, joints, labels) keep their own drawing and take part in the order by their box. One
   without a box (a surface's patch, a map) stands where the depth order puts it, between everything before and after. */

const TOL2 = 0.2 * 0.2;      // how far (px, squared) a fitted curve may stray from the edge it follows
const NEAR = 6;              // faces of one piece this close along it (one residue) may overlap: a tight bend, not a crossing
const EPS = 0.3;             // overlaps under this (px) do not count: shapes that only touch
const TAB = 3;               // how far (px) a piece's fill runs on under the next piece of its ribbon, painted after it

/* ---------------- curves ---------------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
/* Schneider's fit ("An algorithm for automatically fitting digitized curves", Graphics Gems, 1990): one cubic through
   the points by least squares, its parameters improved by Newton's method, split where it strays most if it still
   strays more than the tolerance. Segments go to `out` as [c1x, c1y, c2x, c2y, x, y], or [x, y] for a straight line.
   The curve being fitted (BZ) and the points' parameters on it (U) are scratch arrays: a range is fitted, and only then
   are its halves, so one of each serves every level */
const BZ = new Float64Array(8); let U = new Float64Array(256), SPLIT = 0;
export function fitCurve(P, out, tol2 = TOL2) {
  const n = P.length; if (n < 2) return out;
  if (n === 2) { out.push([P[1][0], P[1][1]]); return out }
  const t1 = endTangent(P, 0, 1), t2 = endTangent(P, n - 1, -1);
  fitRange(P, 0, n - 1, t1[0], t1[1], t2[0], t2[1], tol2, out, 0);
  return out;
}
/** the unit tangent at P[i] toward its neighbours on one side (dir ±1), past points that coincide with it */
function endTangent(P, i, dir) {
  for (let j = i + dir; j >= 0 && j < P.length; j += dir) { const x = P[j][0] - P[i][0], y = P[j][1] - P[i][1], l = Math.sqrt(x * x + y * y); if (l > 1e-6) return [x / l, y / l] }
  return [0, 0];
}
function fitRange(P, first, last, t1x, t1y, t2x, t2y, tol2, out, depth) {
  const n = last - first + 1;
  if (n === 2 || depth > 24) { out.push([P[last][0], P[last][1]]); return }
  if (U.length < n) U = new Float64Array(2 * n);
  let L = 0; U[0] = 0;
  for (let i = 1; i < n; i++) { const x = P[first + i][0] - P[first + i - 1][0], y = P[first + i][1] - P[first + i - 1][1]; L += Math.sqrt(x * x + y * y); U[i] = L }
  if (L < 1e-9) { out.push([P[last][0], P[last][1]]); return }
  for (let i = 1; i < n; i++) U[i] /= L;
  generate(P, first, n, t1x, t1y, t2x, t2y, L); let err = maxError(P, first, n);
  if (err < tol2 && sane(L)) { out.push([BZ[2], BZ[3], BZ[4], BZ[5], BZ[6], BZ[7]]); return }
  if (err < tol2 * 16) for (let it = 0; it < 3; it++) {
    reparam(P, first, n); generate(P, first, n, t1x, t1y, t2x, t2y, L); err = maxError(P, first, n);
    if (err < tol2 && sane(L)) { out.push([BZ[2], BZ[3], BZ[4], BZ[5], BZ[6], BZ[7]]); return }
  }
  const sp = SPLIT; let cx = P[sp - 1][0] - P[sp + 1][0], cy = P[sp - 1][1] - P[sp + 1][1], cl = Math.sqrt(cx * cx + cy * cy);
  if (cl < 1e-12) { cx = P[sp - 1][0] - P[sp][0]; cy = P[sp - 1][1] - P[sp][1]; cl = Math.sqrt(cx * cx + cy * cy) }
  if (cl > 1e-12) { cx /= cl; cy /= cl } else cx = cy = 0;
  fitRange(P, first, sp, t1x, t1y, cx, cy, tol2, out, depth + 1); fitRange(P, sp, last, -cx, -cy, t2x, t2y, tol2, out, depth + 1);
}
/** a curve is taken when it is no longer than the points it follows: its control points could otherwise throw a loop out
   between two of them */
function sane(L) { const B = BZ; return Math.hypot(B[2] - B[0], B[3] - B[1]) + Math.hypot(B[4] - B[2], B[5] - B[3]) + Math.hypot(B[6] - B[4], B[7] - B[5]) <= 1.5 * L + 0.5 }
/** the cubic from the first point to the last along the end tangents, its two lengths by least squares (into BZ) */
function generate(P, first, n, t1x, t1y, t2x, t2y, L) {
  const p0x = P[first][0], p0y = P[first][1], p3x = P[first + n - 1][0], p3y = P[first + n - 1][1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < n; i++) {
    const t = U[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a0x = t1x * b1, a0y = t1y * b1, a1x = t2x * b2, a1y = t2y * b2;
    c00 += a0x * a0x + a0y * a0y; c01 += a0x * a1x + a0y * a1y; c11 += a1x * a1x + a1y * a1y;
    const q = P[first + i], tx = q[0] - (p0x * (b0 + b1) + p3x * (b2 + b3)), ty = q[1] - (p0y * (b0 + b1) + p3y * (b2 + b3));
    x0 += a0x * tx + a0y * ty; x1 += a1x * tx + a1y * ty;
  }
  const det = c00 * c11 - c01 * c01, seg = Math.hypot(p3x - p0x, p3y - p0y);
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0, ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  if (Math.abs(det) < 1e-12 || al < 1e-6 * seg || ar < 1e-6 * seg || al > L || ar > L) al = ar = seg / 3;
  BZ[0] = p0x; BZ[1] = p0y; BZ[2] = p0x + t1x * al; BZ[3] = p0y + t1y * al; BZ[4] = p3x + t2x * ar; BZ[5] = p3y + t2y * ar; BZ[6] = p3x; BZ[7] = p3y;
}
/** the largest squared distance of a point from the curve at its parameter (and the point, as SPLIT) */
function maxError(P, first, n) {
  let mx = 0; SPLIT = first + (n >> 1); const B = BZ;
  for (let i = 1; i < n - 1; i++) {
    const t = U[i], s = 1 - t, a = s * s * s, c = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
    const dx = a * B[0] + c * B[2] + d * B[4] + e * B[6] - P[first + i][0], dy = a * B[1] + c * B[3] + d * B[5] + e * B[7] - P[first + i][1], q = dx * dx + dy * dy;
    if (q >= mx) { mx = q; SPLIT = first + i }
  }
  return mx;
}
/** each parameter moved by a step of Newton's method toward the point of the curve nearest its point */
function reparam(P, first, n) {
  const B = BZ;
  for (let i = 0; i < n; i++) {
    const t = U[i], s = 1 - t, a = s * s * s, c = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
    const qx = a * B[0] + c * B[2] + d * B[4] + e * B[6] - P[first + i][0], qy = a * B[1] + c * B[3] + d * B[5] + e * B[7] - P[first + i][1];
    const d1x = 3 * (s * s * (B[2] - B[0]) + 2 * s * t * (B[4] - B[2]) + t * t * (B[6] - B[4])), d1y = 3 * (s * s * (B[3] - B[1]) + 2 * s * t * (B[5] - B[3]) + t * t * (B[7] - B[5]));
    const d2x = 6 * (s * (B[4] - 2 * B[2] + B[0]) + t * (B[6] - 2 * B[4] + B[2])), d2y = 6 * (s * (B[5] - 2 * B[3] + B[1]) + t * (B[7] - 2 * B[5] + B[3]));
    const num = qx * d1x + qy * d1y, den = d1x * d1x + d1y * d1y + qx * d2x + qy * d2y;
    const v = Math.abs(den) > 1e-12 ? t - num / den : t; U[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}
/** where segment ab crosses cd, strictly inside both; null if it does not */
function crossing(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, w = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && w > 1e-9 && w < 1 - 1e-9 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}
/** an edge with its small loops cut out: where a band bends tighter than its width, its inner edge doubles back on
   itself (a swallowtail), and the outline would draw the loop */
export function untangle(P, K = 18) {
  const out = P.slice();
  for (let i = 0; i < out.length - 3; i++)
    for (let j = Math.min(out.length - 2, i + K); j >= i + 2; j--) { const x = crossing(out[i], out[i + 1], out[j], out[j + 1]); if (x) { out.splice(i + 1, j - i, x); break } }
  return out;
}
/** the curves through a polyline, split at its corners (indices into it): a path's segments */
function curves(P, corners) {
  const out = []; let a = 0;
  const cs = [...corners].filter(c => c > 0 && c < P.length - 1).sort((u, v) => u - v);
  for (const c of [...cs, P.length - 1]) { if (c > a) fitCurve(P.slice(a, c + 1), out); a = c }
  return out;
}
function trace(ctx, segs) { for (const s of segs) if (s.length === 2) ctx.lineTo(s[0], s[1]); else ctx.bezierCurveTo(s[0], s[1], s[2], s[3], s[4], s[5]) }
/** a pen on a path that draws no line of no length (where a strand's two edges meet at its point, say) */
function pen(ctx) {
  let x = NaN, y = NaN;
  const at = s => { if (s && s.length) { const e = s[s.length - 1]; x = e[e.length - 2]; y = e[e.length - 1] } };
  return { move(p) { ctx.moveTo(p[0], p[1]); x = p[0]; y = p[1] }, line(p) { if (Math.abs(p[0] - x) > 1e-3 || Math.abs(p[1] - y) > 1e-3) ctx.lineTo(p[0], p[1]); x = p[0]; y = p[1] },
    curves(s) { trace(ctx, s); at(s) } };
}

/* ---------------- overlaps ---------------- */

/* The primitives' hulls, in one array: hull i is HN[i] points from HX[2 * HO[i]], anticlockwise. Faces are quadrilaterals,
   a stick's half a rectangle, a joint a box: a few points each, so the hull is found by sorting them in place */
let HX = new Float64Array(1 << 16);
const SX = new Float64Array(16);
/** the convex hull of `pts` (at most 8 points) written at point offset `o` of HX; how many points it has */
function hullAt(pts, o) {
  const n = Math.min(pts.length, 8);
  if (HX.length < 2 * (o + n)) { const b = new Float64Array(Math.max(2 * HX.length, 2 * (o + n))); b.set(HX); HX = b }
  for (let i = 0; i < n; i++) {   // insertion sort by x, then y
    const x = pts[i][0], y = pts[i][1]; let j = i - 1;
    while (j >= 0 && (SX[2 * j] > x || (SX[2 * j] === x && SX[2 * j + 1] > y))) { SX[2 * j + 2] = SX[2 * j]; SX[2 * j + 3] = SX[2 * j + 1]; j-- }
    SX[2 * j + 2] = x; SX[2 * j + 3] = y;
  }
  if (n < 3) { for (let i = 0; i < 2 * n; i++) HX[2 * o + i] = SX[i]; return n }
  let k = 0; const H = HX, base = 2 * o;
  const cr = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < n; i++) {   // the lower hull, then the upper (Andrew's monotone chain)
    const x = SX[2 * i], y = SX[2 * i + 1];
    while (k >= 2 && cr(H[base + 2 * k - 4], H[base + 2 * k - 3], H[base + 2 * k - 2], H[base + 2 * k - 1], x, y) <= 0) k--;
    H[base + 2 * k] = x; H[base + 2 * k + 1] = y; k++;
  }
  for (let i = n - 2, t = k + 1; i >= 0; i--) {
    const x = SX[2 * i], y = SX[2 * i + 1];
    while (k >= t && cr(H[base + 2 * k - 4], H[base + 2 * k - 3], H[base + 2 * k - 2], H[base + 2 * k - 1], x, y) <= 0) k--;
    H[base + 2 * k] = x; H[base + 2 * k + 1] = y; k++;
  }
  return k - 1;
}
/* each hull's edges as axes: the edge's outward normal (unit) and the hull's extent along it, found once per hull */
let AX = new Float64Array(1 << 17);
function axesAt(o, n) {
  if (AX.length < 4 * (o + n)) { const b = new Float64Array(Math.max(2 * AX.length, 4 * (o + n))); b.set(AX); AX = b }
  const H = HX;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1; let nx = H[2 * (o + i) + 1] - H[2 * (o + j) + 1], ny = H[2 * (o + j)] - H[2 * (o + i)];
    const l = Math.sqrt(nx * nx + ny * ny), q = 4 * (o + i);
    if (l < 1e-9 || n < 2) { AX[q] = AX[q + 1] = 0; AX[q + 2] = -Infinity; AX[q + 3] = Infinity; continue }   // no axis
    nx /= l; ny /= l; let a0 = Infinity, a1 = -Infinity;
    for (let k = 2 * o, e = 2 * (o + n); k < e; k += 2) { const v = H[k] * nx + H[k + 1] * ny; if (v < a0) a0 = v; if (v > a1) a1 = v }
    AX[q] = nx; AX[q + 1] = ny; AX[q + 2] = a0; AX[q + 3] = a1;
  }
}
/** do hulls a and b come nearer than `m` (their outlines' half widths, less what only touching leaves)? */
function near(ao, an, bo, bn, m) { return !apart(ao, an, bo, bn, m) && !apart(bo, bn, ao, an, m) }
/** is there an edge of hull a with all of b more than m beyond it, or more than m behind a's far side? */
function apart(ao, an, bo, bn, m) {
  if (an < 3) return false;
  const H = HX, A = AX, e = 2 * (bo + bn);
  for (let i = 0; i < an; i++) {
    const q = 4 * (ao + i), nx = A[q], ny = A[q + 1]; if (nx === 0 && ny === 0) continue;
    const lo = A[q + 2] - m, hi = A[q + 3] + m; let below = true, above = true;
    for (let k = 2 * bo; k < e; k += 2) { const v = H[k] * nx + H[k + 1] * ny; if (v >= lo) below = false; if (v <= hi) above = false; if (!below && !above) break }
    if (below || above) return true;
  }
  return false;
}

/* ---------------- a small heap ---------------- */
class Heap {
  constructor(key) { this.a = []; this.key = key }
  get size() { return this.a.length }
  push(v) { const a = this.a, k = this.key; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k(a[p]) <= k(a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p } }
  top() { return this.a[0] }
  pop() { const a = this.a, k = this.key, r = a[0], x = a.pop(); if (a.length) { a[0] = x; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i;
    if (l < a.length && k(a[l]) < k(a[m])) m = l; if (rr < a.length && k(a[rr]) < k(a[m])) m = rr; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m } } return r }
}

/* ---------------- the painter ---------------- */

/**
 * Draw the painter's items as shapes, and in groups where the canvas has them (ctx.beginGroup / endGroup: the
 * recording canvas, for an SVG).
 *  items: {z, draw, box?, poly?, margin?, key?} drawn as they are (box [x0, y0, x1, y1] or poly, a few points, their
 *  extent; margin, how far their outline reaches past it), or {z, face}, the cartoon's faces (engine.js, vface): face =
 *  {s: its strip, q: [a0, a1, b1, b0] (screen points: a the strip's first edge, b its second, 0 the section it starts at,
 *  1 the one it ends at), fill, ink, lw, alpha, inkA, inkB (its start and end inked), cornerA, cornerB (those sections
 *  corners of its edges), sec (its section along its chain's trace), thin (a tube's: its outline thins with it)};
 *  a strip = {faces, trace, key, prev, next (the strips its ends run on into, with no line between), prevEnd, nextEnd}.
 *  key: {chain, id, label, data}, the group an item is drawn in; chain: {id, label, data}, its chain's.
 */
export function paintFlat(ctx, items, W, H) {
  const n0 = items.length;
  // the depth order, as the other looks paint (a stable sort by z)
  const rank = new Int32Array(n0), ix = new Map(); items.forEach((it, i) => ix.set(it, i));
  items.slice().sort((u, v) => u.z - v.z).forEach((it, r) => { rank[ix.get(it)] = r });
  // ---- the primitives: their boxes and hulls; faces gathered into their strips ----
  const strips = [], barrier = new Uint8Array(n0), traces = new Map();
  const bx0 = new Float64Array(n0), by0 = new Float64Array(n0), bx1 = new Float64Array(n0), by1 = new Float64Array(n0), mg = new Float64Array(n0);
  const HO = new Int32Array(n0), HN = new Int32Array(n0), ftr = new Int32Array(n0).fill(-1), fsec = new Float64Array(n0);
  let hp = 0;
  for (let i = 0; i < n0; i++) {
    const it = items[i]; let pts = null, m = 0;
    if (it.face) { const f = it.face; pts = f.q; m = f.lw / 2; f.item = i;
      if (f.s._n === undefined) { f.s._n = strips.length; strips.push(f.s); f.s.faces.forEach((g, k) => { g.i = k }) }
      let t = traces.get(f.s.trace); if (t === undefined) traces.set(f.s.trace, t = traces.size); ftr[i] = t; fsec[i] = f.sec}
    else if (it.poly) { pts = it.poly; m = it.margin || 0 }
    else if (it.box) { const b = it.box; pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; m = it.margin || 0 }
    else { barrier[i] = 1; continue }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1] }
    bx0[i] = x0 - m; by0[i] = y0 - m; bx1[i] = x1 + m; by1[i] = y1 + m; mg[i] = m; HO[i] = hp; HN[i] = hullAt(pts, hp); axesAt(hp, HN[i]); hp += HN[i];
  }
  // ---- which pairs overlap: a grid of cells about twice a typical primitive's size, each pair tested in the first cell
  // both boxes share ----
  const sizes = []; for (let i = 0; i < n0; i += Math.max(1, (n0 / 2000) | 0)) if (!barrier[i]) sizes.push(Math.max(bx1[i] - bx0[i], by1[i] - by0[i]));
  Float64Array.from(sizes).sort().forEach((v, k) => { sizes[k] = v });
  const C = Math.min(48, Math.max(8, 2 * (sizes[sizes.length >> 1] || 12))), GX = Math.max(1, Math.ceil(W / C) + 2), GY = Math.max(1, Math.ceil(H / C) + 2);
  const cell = (v, G) => { const c = Math.floor(v / C) + 1; return c < 0 ? 0 : c >= G ? G - 1 : c };
  const cx0 = new Int32Array(n0), cy0 = new Int32Array(n0), cx1 = new Int32Array(n0), cy1 = new Int32Array(n0), count = new Int32Array(GX * GY + 1);
  for (let i = 0; i < n0; i++) { if (barrier[i]) continue; cx0[i] = cell(bx0[i], GX); cx1[i] = cell(bx1[i], GX); cy0[i] = cell(by0[i], GY); cy1[i] = cell(by1[i], GY);
    for (let y = cy0[i]; y <= cy1[i]; y++) for (let x = cx0[i]; x <= cx1[i]; x++) count[y * GX + x + 1]++ }
  for (let c = 1; c <= GX * GY; c++) count[c] += count[c - 1];
  // each cell's primitives in order of their boxes' left edges, so a cell is swept left to right: a pair is tested only
  // while the second starts before the first ends
  // (sorted as numbers: each the edge to a sixteenth of a pixel, and its index, in one double)
  const keys = []; for (let i = 0; i < n0; i++) if (!barrier[i]) keys.push((Math.min(Math.max(Math.floor(bx0[i] * 16) + 65536, 0), 4194303)) * 2097152 + i);
  const byX = Float64Array.from(keys).sort().map(k => k % 2097152);
  const fill = count.slice(), list = new Int32Array(count[GX * GY]);
  for (const i of byX) for (let y = cy0[i]; y <= cy1[i]; y++) for (let x = cx0[i]; x <= cx1[i]; x++) list[fill[y * GX + x]++] = i;
  const PA = [], PB = [];   // overlapping pairs, PA the one behind (lower in the depth order)
  for (let c = 0; c < GX * GY; c++) {
    const s = count[c], e = count[c + 1], X = c % GX, Y = (c / GX) | 0;
    for (let p = s; p < e; p++) { const a = list[p];
      for (let q = p + 1; q < e; q++) { const b = list[q];
        if (bx0[b] - bx1[a] > 0.0625 - EPS) break;   // (and every one after it: they are in order to a sixteenth)
        if (bx0[b] - bx1[a] > -EPS) continue;
        if ((cx0[a] > cx0[b] ? cx0[a] : cx0[b]) !== X || (cy0[a] > cy0[b] ? cy0[a] : cy0[b]) !== Y) continue;   // tested in an earlier cell
        if (by0[b] - by1[a] > -EPS || by0[a] - by1[b] > -EPS) continue;
        if (ftr[a] >= 0 && ftr[a] === ftr[b] && Math.abs(fsec[a] - fsec[b]) <= 1) continue;   // faces that touch along the trace
        if (!near(HO[a], HN[a], HO[b], HN[b], mg[a] + mg[b] - EPS)) continue;
        if (rank[a] < rank[b]) { PA.push(a); PB.push(b) } else { PA.push(b); PB.push(a) }
      } }
  }
  // ---- the barriers (items with no box): every face is before or after each, as the depth order has it ----
  const bars = []; for (let i = 0; i < n0; i++) if (barrier[i]) bars.push(rank[i]); bars.sort((a, b) => a - b);
  const level = r => { let lo = 0, hi = bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m] < r) lo = m + 1; else hi = m } return lo };
  // ---- the first pieces: each strip cut where its faces cannot be one shape (colour, ink, a barrier between) ----
  const pieceOf = new Int32Array(n0).fill(-1); const pieces = [];   // a piece: {s, i0, i1} faces i0..i1 of strip s
  const same = (f, g) => f.fill === g.fill && f.ink === g.ink && f.lw === g.lw && f.alpha === g.alpha && !f.inkB && !g.inkA && level(rank[f.item]) === level(rank[g.item]);
  const cuts = strips.map(s => { const c = new Set(); for (let k = 1; k < s.faces.length; k++) if (!same(s.faces[k - 1], s.faces[k])) c.add(k); return c });
  // a strip that crosses itself is cut between the faces that cross (as few cuts as do it: by their far ends)
  const self = strips.map(() => []);
  for (let k = 0; k < PA.length; k++) { const f = items[PA[k]].face, g = items[PB[k]].face; if (f && g && f.s === g.s && Math.abs(f.i - g.i) > NEAR) self[f.s._n].push(f.i < g.i ? [f.i, g.i] : [g.i, f.i]) }
  strips.forEach((s, n) => { const iv = self[n].sort((u, v) => u[1] - v[1]), c = cuts[n];
    for (const [i, j] of iv) { let hit = false; for (let k = i + 1; k <= j; k++) if (c.has(k)) { hit = true; break } if (!hit) c.add(Math.round((i + j + 1) / 2)) } });
  strips.forEach((s, n) => { const c = [...cuts[n]].sort((u, v) => u - v); let a = 0;
    for (const k of [...c, s.faces.length]) { if (k > a) { const id = pieces.length; pieces.push({ s, i0: a, i1: k - 1 }); for (let i = a; i < k; i++) pieceOf[s.faces[i].item] = id } a = k } });
  // items: each its own node
  const nodeOf = new Int32Array(n0); const nodes = [];   // a node: {piece} or {item}; each primitive's node
  pieces.forEach((p, id) => { p.node = nodes.length; nodes.push({ piece: p }); for (let i = p.i0; i <= p.i1; i++) nodeOf[p.s.faces[i].item] = p.node });
  for (let i = 0; i < n0; i++) if (!items[i].face) { nodeOf[i] = nodes.length; nodes.push({ item: i }) }
  // ---- split pieces until their order has no circles ----
  // Splitting a piece can only make circles inside the knot of pieces it was in: each round looks again only at the pairs
  // within a knot of the last, two faces of one of its pieces among them (a helix seen end on, its turns over one
  // another): no order while they are one piece, they are one once it is cut between them, and can close a circle
  const nP = PA.length, to = new Int32Array(nP), nxt = new Int32Array(nP);
  let WA = Int32Array.from(PA), WB = Int32Array.from(PB), nW = nP;
  const range = l => { let lo = Infinity, hi = -Infinity; for (const v of l) { if (v < lo) lo = v; if (v > hi) hi = v } return [lo, hi] };
  for (let round = 0; round < 400; round++) {
    const N = nodes.length, head = new Int32Array(N).fill(-1); let ne = 0;
    for (let k = 0; k < nW; k++) { const u = nodeOf[WA[k]], v = nodeOf[WB[k]]; if (u !== v) { to[ne] = v; nxt[ne] = head[u]; head[u] = ne++ } }
    const comp = scc(N, head, nxt, to); if (!comp.many) break;
    let m = 0;   // the pairs left: those within a knot, a piece's own among them
    for (let k = 0; k < nW; k++) { const u = nodeOf[WA[k]], v = nodeOf[WB[k]]; if (comp.id[u] === comp.id[v] && comp.size[comp.id[u]] > 1) { WA[m] = WA[k]; WB[m] = WB[k]; m++ } }
    nW = m;
    // in each knot, the largest piece that something enters at one face and leaves at another is cut between them
    const ins = new Map(), outs = new Map();
    for (let k = 0; k < nW; k++) { const u = nodeOf[WA[k]], v = nodeOf[WB[k]]; if (u === v) continue;
      if (nodes[v].piece) { let l = ins.get(v); if (!l) ins.set(v, l = []); l.push(items[WB[k]].face.i) }
      if (nodes[u].piece) { let l = outs.get(u); if (!l) outs.set(u, l = []); l.push(items[WA[k]].face.i) } }
    const best = new Map();
    for (const [v, I] of ins) { const O = outs.get(v); if (!O) continue; const p = nodes[v].piece, c = comp.id[v];
      const [a0, a1] = range(I), [b0, b1] = range(O); if (Math.min(a0, b0) === Math.max(a1, b1)) continue;
      const b = best.get(c); if (!b || p.i1 - p.i0 > b.p.i1 - b.p.i0) best.set(c, { v, p, I, O }) }
    if (!best.size) break;   // (cannot happen: a circle passes through some piece at two faces)
    for (const { p, I, O } of best.values()) {
      const [mnI, mxI] = range(I), [mnO, mxO] = range(O);
      let k;   // the first face of the second half
      if (mxI < mnO) k = Math.round((mxI + mnO + 1) / 2); else if (mxO < mnI) k = Math.round((mxO + mnI + 1) / 2);
      else { const all = Int32Array.from([...I, ...O]).sort(); k = all[all.length >> 1]; if (k <= all[0]) k = all[0] + 1 }
      k = Math.min(Math.max(k, p.i0 + 1), p.i1);
      const q = { s: p.s, i0: k, i1: p.i1, node: nodes.length }; p.i1 = k - 1; const id = pieces.length; pieces.push(q); nodes.push({ piece: q });
      for (let i = q.i0; i <= q.i1; i++) { const it = p.s.faces[i].item; pieceOf[it] = id; nodeOf[it] = q.node }
    }
  }
  // ---- the order: depth order where it matters, each group kept together where it can be ----
  const N = nodes.length, indeg = new Int32Array(N), succ = Array.from({ length: N }, () => []);
  for (let k = 0; k < nP; k++) { const u = nodeOf[PA[k]], v = nodeOf[PB[k]]; if (u !== v) { succ[u].push(v); indeg[v]++ } }   // (an edge twice counts twice both ways)
  // barriers: between the nodes of the levels either side
  const lo = new Float64Array(N).fill(Infinity), lv = new Int32Array(N);
  nodes.forEach((nd, id) => { if (nd.piece) { const p = nd.piece; for (let i = p.i0; i <= p.i1; i++) lo[id] = Math.min(lo[id], rank[p.s.faces[i].item]) } else lo[id] = rank[nd.item]; lv[id] = level(lo[id]) });
  if (bars.length) {
    const barNode = new Map(); nodes.forEach((nd, id) => { if (nd.item !== undefined && barrier[nd.item]) barNode.set(rank[nd.item], id) });
    const chain = bars.map(r => barNode.get(r));
    for (let k = 1; k < chain.length; k++) { succ[chain[k - 1]].push(chain[k]); indeg[chain[k]]++ }
    nodes.forEach((nd, id) => { if (nd.item !== undefined && barrier[nd.item]) return; const l = lv[id];
      if (l > 0) { succ[chain[l - 1]].push(id); indeg[id]++ } if (l < chain.length) { succ[id].push(chain[l]); indeg[chain[l]]++ } });
  }
  const keyOf = id => { const nd = nodes[id]; return nd.piece ? nd.piece.s.key : items[nd.item].key };
  const gid = id => { const k = keyOf(id); return k && k.id ? k.id : '' }, cid = id => { const k = keyOf(id); return k && k.chain ? k.chain.id : '' };
  // Each step draws a node whose predecessors are drawn: the next of the group being drawn while it has one ready;
  // else, of the groups with nodes ready (the chain's own first), one that can then be drawn to its end, else the one
  // with the nearest in the depth order
  const byRank = (id) => lo[id];
  const all = new Heap(byRank), groups = new Map(), chains = new Map(), left = new Map(), ready = new Map(), G = new Array(N), Cc = new Array(N);
  for (let id = 0; id < N; id++) { G[id] = gid(id); Cc[id] = cid(id); left.set(G[id], (left.get(G[id]) || 0) + 1) }
  const avail = id => { all.push(id); const g = G[id]; let h = groups.get(g); if (!h) groups.set(g, h = new Heap(byRank)); h.push(id); ready.set(g, (ready.get(g) || 0) + 1);
    const c = Cc[id]; let st = chains.get(c); if (!st) chains.set(c, st = new Set()); st.add(g) };
  const done = new Uint8Array(N), out = [];
  const clean = h => { while (h.size && done[h.top()]) h.pop(); return h.size };
  /** the best of some groups to go on with: one ready to its end first, then the nearest */
  const choose = gs => { let best = null, whole = false, br = Infinity;
    for (const g of gs) { const h = groups.get(g); if (!clean(h)) { gs.delete(g); continue }
      const w = ready.get(g) === left.get(g), r = lo[h.top()]; if ((w && !whole) || (w === whole && r < br)) { best = g; whole = w; br = r } }
    return best };
  for (let id = 0; id < N; id++) if (!indeg[id]) avail(id);
  let curG = null, curC = null;
  while (out.length < N) {
    let pick = -1;
    const hg = curG !== null ? groups.get(curG) : null;
    if (hg && clean(hg)) pick = hg.pop();
    else {
      let g = curC !== null && chains.get(curC) ? choose(chains.get(curC)) : null;
      if (g === null) { const any = new Set(); for (const st of chains.values()) for (const x of st) any.add(x); g = choose(any) }
      if (g !== null) pick = groups.get(g).pop();
    }
    if (pick < 0) { while (all.size && done[all.top()]) all.pop(); if (!all.size) break; pick = all.pop() }
    done[pick] = 1; out.push(pick); curG = G[pick]; curC = Cc[pick]; left.set(curG, left.get(curG) - 1); ready.set(curG, ready.get(curG) - 1);
    for (const v of succ[pick]) if (--indeg[v] === 0) avail(v);
  }
  if (out.length < N) { for (let id = 0; id < N; id++) if (!done[id]) out.push(id) }   // (a circle left: drawn as it falls)
  else mergeRuns(out, G, succ, N);
  const at = new Int32Array(N); out.forEach((id, k) => { at[id] = k });
  // ---- draw, opening and closing the groups as the order goes in and out of them ----
  const grouped = typeof ctx.beginGroup === 'function', used = new Map();
  const uid = id => { const k = used.get(id) || 0; used.set(id, k + 1); return k ? `${id}-${k + 1}` : id };
  let openC = null, openG = null;
  const close = (level) => { if (level <= 1 && openG !== null) { if (openG) ctx.endGroup(); openG = null } if (level === 0 && openC !== null) { if (openC) ctx.endGroup(); openC = null } };
  for (const id of out) {
    if (grouped) { const k = keyOf(id), c = k && k.chain ? k.chain : null, g = k && k.id ? k : null;
      const cKey = c ? c.id : '', gKey = g ? g.id : '';
      if (openC !== null && openC !== cKey) close(0); else if (openG !== null && openG !== gKey) close(1);
      if (openC === null) { openC = cKey; if (c) ctx.beginGroup({ id: uid(c.id), label: c.label, data: c.data }) }
      if (openG === null) { openG = gKey; if (g) ctx.beginGroup({ id: uid(g.id), label: g.label, data: g.data }) } }
    const nd = nodes[id];
    if (nd.piece) drawPiece(ctx, nd.piece, pieceOf, pieces, at, items); else items[nd.item].draw(ctx);
  }
  if (grouped) close(0);
}

/** A group drawn in two runs with others between is drawn in one where it can be: its later run moved back to just
   after the earlier when nothing between must be drawn before it, or the earlier moved on to just before the later when
   nothing between must be drawn after it. `out` (an order that keeps every edge) is rearranged in place */
function mergeRuns(out, G, succ, N) {
  const pred = Array.from({ length: N }, () => []);
  for (let u = 0; u < N; u++) for (const v of succ[u]) pred[v].push(u);
  const runOf = new Array(N);
  for (let pass = 0; pass < 3; pass++) {
    // the runs, in order (a run's place never changes; one merged into another is gone, its nodes the other's)
    const runs = []; for (const id of out) { const g = G[id], r = runs[runs.length - 1]; if (r && r.g === g) r.n.push(id); else runs.push({ g, n: [id], at: runs.length, gone: false }) }
    for (const r of runs) for (const id of r.n) runOf[id] = r;
    const last = new Map(); let merged = 0;
    for (const rj of runs) {
      const ri = last.get(rj.g); last.set(rj.g, rj);
      if (!ri || rj.g === '') continue;
      const between = r => r.at > ri.at && r.at < rj.at;
      if (rj.n.every(v => pred[v].every(u => !between(runOf[u])))) {   // the later run back to the earlier
        for (const v of rj.n) runOf[v] = ri; ri.n.push(...rj.n); rj.gone = true; last.set(rj.g, ri); merged++;
      } else if (ri.n.every(u => succ[u].every(v => !between(runOf[v])))) {   // or the earlier on to the later
        for (const u of ri.n) runOf[u] = rj; rj.n.unshift(...ri.n); ri.gone = true; merged++;
      }
    }
    out.length = 0; for (const r of runs) if (!r.gone) out.push(...r.n);
    if (!merged) break;
  }
}
/** Tarjan's strongly connected components, without recursion: each node's component, and whether any has two nodes */
function scc(N, head, nxt, to) {
  const index = new Int32Array(N).fill(-1), low = new Int32Array(N), on = new Uint8Array(N), id = new Int32Array(N), size = [];
  const stack = [], call = []; let k = 0, c = 0, many = false;
  for (let s = 0; s < N; s++) { if (index[s] >= 0) continue;
    call.push([s, head[s]]); index[s] = low[s] = k++; stack.push(s); on[s] = 1;
    while (call.length) { const fr = call[call.length - 1], v = fr[0], e = fr[1];
      if (e >= 0) { fr[1] = nxt[e]; const w = to[e];
        if (index[w] < 0) { index[w] = low[w] = k++; stack.push(w); on[w] = 1; call.push([w, head[w]]) } else if (on[w] && index[w] < low[v]) low[v] = index[w] }
      else { call.pop(); if (call.length) { const u = call[call.length - 1][0]; if (low[v] < low[u]) low[u] = low[v] }
        if (low[v] === index[v]) { let n = 0, w; do { w = stack.pop(); on[w] = 0; id[w] = c; n++ } while (w !== v); size.push(n); if (n > 1) many = true; c++ } } } }
  return { id, size, many };
}

/** a piece of a strip: one closed path through its edges, filled, and inked along its silhouette */
function drawPiece(ctx, p, pieceOf, pieces, at, items) {
  const F = p.s.faces, f0 = F[p.i0], f1 = F[p.i1];
  const E1 = [f0.q[0]], E2 = [f0.q[3]], c1 = new Set(), c2 = new Set();
  for (let i = p.i0; i <= p.i1; i++) { const f = F[i], k = i - p.i0;
    if (f.cornerA) { c1.add(k); c2.add(k) } if (f.cornerB) { c1.add(k + 1); c2.add(k + 1) }
    E1.push(f.q[1]); E2.push(f.q[2]) }
  const A1 = untangle(E1), A2 = untangle(E2);
  const ok = (P, cs) => P.length === E1.length ? cs : new Set();   // (corners lost if loops were cut: the curve is fitted whole)
  const s1 = curves(A1, ok(A1, c1)), s2r = curves(A2.slice().reverse(), new Set([...ok(A2, c2)].map(c => A2.length - 1 - c)));
  // where the next piece of the ribbon is painted after this one, the fill runs on under it
  const me = at[pieces[pieceOf[f0.item]].node];
  const tab = (end) => {
    const inked = end ? f1.inkB : f0.inkA; if (inked || f0.alpha < 1) return null;
    let g = null;
    if (end) g = p.i1 + 1 < F.length ? F[p.i1 + 1] : p.s.next ? p.s.next.faces[p.s.next.faces.length && p.s.nextEnd ? p.s.next.faces.length - 1 : 0] : null;
    else g = p.i0 > 0 ? F[p.i0 - 1] : p.s.prev ? p.s.prev.faces[p.s.prevEnd ? p.s.prev.faces.length - 1 : 0] : null;
    if (!g || g.alpha < 1 || g.item === undefined || g.item < 0) return null;
    const gp = pieceOf[g.item]; if (gp < 0 || at[pieces[gp].node] < me) return null;
    const A = end ? A1[A1.length - 1] : A1[0], B = end ? A2[A2.length - 1] : A2[0];
    const far = { 0: 1, 1: 0, 2: 3, 3: 2 }, nearest = P => { let b = 0, d = Infinity; for (let k = 0; k < 4; k++) { const e = Math.hypot(g.q[k][0] - P[0], g.q[k][1] - P[1]); if (e < d) { d = e; b = k } } return b };
    const ka = nearest(A), kb = nearest(B); if (ka === kb || far[ka] === kb) return null;
    const meets = (P, k) => Math.hypot(g.q[k][0] - P[0], g.q[k][1] - P[1]) < 0.5;   // only where the two pieces' ends meet (a strand's top and bottom do not)
    if (!meets(A, ka) || !meets(B, kb)) return null;
    const step = (k) => { const a = g.q[k], b = g.q[far[k]], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) return [a[0], a[1]]; const t = Math.min(TAB, 0.5 * l) / l; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    return [step(ka), step(kb)];
  };
  const tA = tab(false), tB = tab(true);
  const e1 = A1[A1.length - 1], e2 = A2[A2.length - 1];
  ctx.save(); ctx.globalAlpha = f0.alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = pen(ctx);
  ctx.beginPath();
  if (tA) { P.move(tA[0]); P.line(A1[0]) } else P.move(A1[0]);
  P.curves(s1);
  if (tB) { P.line(tB[0]); P.line(tB[1]) }
  P.line(e2); P.curves(s2r);
  if (tA) P.line(tA[1]);
  ctx.closePath(); ctx.fillStyle = f0.fill; ctx.fill();
  // the outline: the same path when its ends are both inked, else the edges and whichever end is
  let lw = f0.lw;
  if (f0.thin) { let w = 0; for (let k = 0; k < E1.length; k++) w += Math.hypot(E1[k][0] - E2[k][0], E1[k][1] - E2[k][1]); lw = Math.min(lw, Math.max(0.4, w / E1.length * 0.28)) }   // a thin tube's outline leaves its colour showing
  ctx.lineWidth = lw; ctx.strokeStyle = f0.ink;
  const inA = f0.inkA, inB = f1.inkB;
  if (inA && inB && !tA && !tB) ctx.stroke();
  else {
    ctx.beginPath();
    if (inB && !inA) { P.move(A1[0]); P.curves(s1); P.line(e2); P.curves(s2r) }
    else if (inA && !inB) { P.move(e2); P.curves(s2r); P.line(A1[0]); P.curves(s1) }
    else { P.move(A1[0]); P.curves(s1); P.move(e2); P.curves(s2r) }
    ctx.stroke();
  }
  ctx.restore();
}
