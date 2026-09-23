/* Skia's SkPath::arcTo(oval, startAngle, sweepAngle, forceMoveTo), in float32 as Skia computes it: the conics an arc
   becomes, so the recorder can hand them to the host as path data instead of as an arc to build there. Checked against
   skia-python bit for bit (python/tests/test_arcs.py). */
const f = Math.fround;
const NEARLY_ZERO = f(1 / 4096);
const DEG = f(f(3.14159265) / 180);   // SkDegreesToRadians: degrees * (SK_ScalarPI / 180), in float
const ROOT2_OVER2 = f(0.707106781);

/** what the arc adds to a path, as Skia's verbs: 0 move, 1 line, 2 quad, 3 conic */
export interface ArcSink {
  /** has the path a point, and its last one */
  has(): boolean; lx(): number; ly(): number;
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  quad(x1: number, y1: number, x2: number, y2: number): void;
  conic(x1: number, y1: number, x2: number, y2: number, w: number): void;
}

const SINCOS_NEARLY_ZERO = f(1 / 65536);
const snap = (v: number) => (Math.abs(v) <= SINCOS_NEARLY_ZERO ? 0 : v);   // SkScalar[Sin|Cos]SnapToZero
const sinS = (r: number) => snap(f(Math.sin(r)));
const cosS = (r: number) => snap(f(Math.cos(r)));
const nearlyEq = (a: number, b: number) => Math.abs(f(a - b)) <= NEARLY_ZERO;
const mid = (a: number, b: number) => f((a + b) * 0.5);   // sk_float_midpoint, in double

/** SkPath::arcTo; the oval's edges and the angles are float32 already */
export function arcTo(sink: ArcSink, l: number, t: number, r: number, b: number, start: number, sweep: number, forceMove: boolean) {
  const w = f(r - l), h = f(b - t);
  if (w < 0 || h < 0) return;
  start = start % 360;   // SkScalarMod: fmodf, exact
  if (!sink.has()) forceMove = true;
  const lx = sink.lx(), ly = sink.ly();
  const addPt = (x: number, y: number) => {
    if (forceMove) sink.move(x, y);
    else if (!nearlyEq(lx, x) || !nearlyEq(ly, y)) sink.line(x, y);
  };
  // arc_is_lone_point
  const lone = (x: number, y: number) => forceMove ? sink.move(x, y) : sink.line(x, y);   // no nearness test here
  if (sweep === 0 && (start === 0 || start === 360)) return lone(r, mid(t, b));
  if (w === 0 && h === 0) return lone(r, t);
  // angles_to_unit_vectors
  const startRad = f(start * DEG); let stopRad = f(f(start + sweep) * DEG);
  const sx = cosS(startRad), sy = sinS(startRad);
  let ex = cosS(stopRad), ey = sinS(stopRad);
  if (sx === ex && sy === ey) {
    const sw = Math.abs(sweep);
    if (sw < 360 && sw > 359) {
      const d = f(Math.sign(sweep) * (1 / 512));
      do { stopRad = f(stopRad - d); ex = cosS(stopRad); ey = sinS(stopRad) } while (sx === ex && sy === ey);
    }
  }
  const cw = sweep > 0;
  const cx = mid(l, r), cy = mid(t, b), hw = f(w * 0.5), hh = f(h * 0.5);
  if (sx === ex && sy === ey) {   // too small a sweep for the unit vectors to tell apart
    const end = f(f(start + sweep) * DEG), rx = f(w / 2), ry = f(h / 2);
    return addPt(f(cx + f(rx * f(Math.cos(end)))), f(cy + f(ry * f(Math.sin(end)))));
  }
  // SkConic::BuildUnitArc
  let x = f(f(sx * ex) + f(sy * ey)), y = f(f(sx * ey) - f(sy * ex));
  const absY = Math.abs(y);
  // the user matrix: scale by the radii, then move to the centre; the unit arc is turned to start at uStart first
  const mapper = unitMap(sy, sx, cw, hw, hh, cx, cy);
  if (absY <= NEARLY_ZERO && x > 0 && ((y >= 0 && cw) || (y <= 0 && !cw))) {   // no conics: the stop point alone
    const p = mapper(ex, ey, true); return addPt(p[0], p[1]);
  }
  if (!cw) y = -y;
  let quadrant = 0;
  if (y === 0) quadrant = 2;
  else if (x === 0) quadrant = y > 0 ? 1 : 3;
  else { if (y < 0) quadrant += 2; if ((x < 0) !== (y < 0)) quadrant += 1 }
  const Q = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const conics: [number[], number[], number[], number][] = [];
  for (let i = 0; i < quadrant; i++) conics.push([Q[i * 2], Q[i * 2 + 1], Q[i * 2 + 2], ROOT2_OVER2]);
  const lastQ = Q[quadrant * 2];
  const dot = f(f(lastQ[0] * x) + f(lastQ[1] * y));
  if (dot < 1) {
    let ox = f(lastQ[0] + x), oy = f(lastQ[1] + y);
    const cosT2 = f(Math.sqrt(f(f(1 + dot) / 2)));
    // SkPoint::setLength, in double
    const len = f(1 / cosT2), mag = Math.sqrt(ox * ox + oy * oy), sc = len / mag;
    ox = f(ox * sc); oy = f(oy * sc);
    if (!(isFinite(ox) && isFinite(oy)) || (ox === 0 && oy === 0)) { ox = 0; oy = 0 }
    if (f(lastQ[0] - ox) !== 0 || f(lastQ[1] - oy) !== 0) conics.push([lastQ, [ox, oy], [x, y], cosT2]);
  }
  const p0 = mapper(conics[0][0][0], conics[0][0][1], false); addPt(p0[0], p0[1]);
  for (const c of conics) {
    const a = mapper(c[1][0], c[1][1], false), e = mapper(c[2][0], c[2][1], false);
    if (c[3] === 1) sink.quad(a[0], a[1], e[0], e[1]); else sink.conic(a[0], a[1], e[0], e[1], c[3]);
  }
}

/** the matrix BuildUnitArc maps its conics with: setSinCos(uStart), a flip for counter-clockwise, then the oval's
   scale and centre (concatenated as SkMatrix::setConcat does); `raw` maps an already-unit point by the oval alone */
function unitMap(s: number, c: number, cw: boolean, hw: number, hh: number, cx: number, cy: number) {
  // rotation [c -s; s c], then preScale(1, -1) when counter-clockwise (the second column negated)
  let a = c, kx = f(-s), ky = s, d = c;
  if (!cw) { kx = f(-kx); d = f(-d) }
  // postConcat(scale(hw, hh) + translate(cx, cy)): each entry one product, as muladdmul's other term is zero
  const rotId = a === 1 && kx === 0 && ky === 0 && d === 1;
  const SX = rotId ? hw : f(hw * a), KX = rotId ? 0 : f(hw * kx), KY = rotId ? 0 : f(hh * ky), SY = rotId ? hh : f(hh * d);
  const affine = KX !== 0 || KY !== 0;
  const map = (x: number, y: number): [number, number] => affine
    ? [f(f(f(x * SX) + f(y * KX)) + cx), f(f(f(y * SY) + f(x * KY)) + cy)]
    : [f(f(x * SX) + cx), f(f(y * SY) + cy)];
  // the stop point alone is mapped by the oval's matrix only (build_arc_conics' singlePt)
  return (x: number, y: number, raw: boolean): [number, number] => raw ? [f(f(x * hw) + cx), f(f(y * hh) + cy)] : map(x, y);
}
