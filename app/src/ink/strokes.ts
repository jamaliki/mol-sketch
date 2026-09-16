/* The stroke engine, ported from the canvas page: jittered multi-pass strokes with pen pressure, sketched circles,
   hatching, watercolour shapes, pencil scribbles, pen textures for elements. All functions draw on a 2D context in CSS px. */
import { clamp, lerp, mulberry32, Noise1, rgba, mix, luminance, pathOf, polyArea, type Pt, type Rng } from './util';
import type { Style } from '../style';

export type Ctx = CanvasRenderingContext2D;

/** Everything the strokes need from the style, in one flat object. */
export interface Pen {
  rough: number; passes: number; pressure: number; hierarchy: number; inkWidth: number;
  hatchSpacing: number; hatchAngle: number; hatchDensity: number; lightAngle: number;
  shading: number; pencilFill: number; fillWobble: number;
  fill: Style['fill']; fogAmt: number;
  P: Style['palette'];
}
export function penOf(s: Style): Pen {
  return { rough: s.line.rough, passes: s.line.passes, pressure: s.line.pressure, hierarchy: s.line.hierarchy, inkWidth: s.line.width,
    hatchSpacing: s.hatch.spacing, hatchAngle: s.hatch.angle, hatchDensity: s.hatch.density, lightAngle: s.view.light,
    shading: s.shading, pencilFill: s.pencilFill, fillWobble: s.fillWobble, fill: s.fill, fogAmt: s.view.fog, P: s.palette };
}
export const isInk = (pen: Pen) => pen.fill === 'ink' || pen.fill === 'ink colour' || pen.fill === 'pencil' || pen.fill === 'watercolour';
export const isPencil = (pen: Pen) => pen.fill === 'pencil';
export const isWC = (pen: Pen) => pen.fill === 'watercolour';
/** line hierarchy: silhouettes heavier, interior marks lighter */
export const LW = { outer: (pen: Pen) => 1 + 0.45 * pen.hierarchy, inner: (pen: Pen) => 1 - 0.45 * pen.hierarchy, faint: (pen: Pen) => 0.5 - 0.15 * pen.hierarchy };
export function fogged(pen: Pen, col: string, fog: number) { return mix(col, pen.P.paper, clamp(fog * pen.fogAmt * 0.7, 0, 0.7)) }
export function fillFor(pen: Pen, col: string) { const m = pen.fill; if (isInk(pen)) return pen.P.paper; if (m === 'wash') return mix(col, pen.P.paper, 0.62); return col }

export interface StrokeOpts { seed?: number; width?: number; widthEnd?: number; color?: string; alpha?: number; passes?: number; rough?: number; pressure?: number; ampScale?: number; step?: number; overshoot?: boolean }

export function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = step - acc;
    while (s < L) { const u = s / L; out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); s += step }
    acc = (L - (s - step)) % step; if (i === pts.length - 1) out.push(b) }
  return out;
}

export interface Pass { pts: [number, number, number][]; alpha: number; width: number }
/** Build the jittered passes of a stroke: each pass is a list of [x,y,w] with pen-pressure width. */
export function sketchPasses(pen: Pen, pts: Pt[], o: StrokeOpts): Pass[] {
  if (pts.length < 2) return [];
  const rough = o.rough ?? pen.rough, passes = o.passes ?? pen.passes;
  const step = o.step === 0 ? 0 : (o.step || 4); const P = step ? resample(pts, step) : pts;
  let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const w0 = o.width ?? 1.5, w1 = o.widthEnd ?? w0; const pressure = o.pressure ?? pen.pressure;
  const out: Pass[] = [];
  for (let p = 0; p < passes; p++) {
    const rng = mulberry32((o.seed! | 0) + p * 7919 + 11); const nz = new Noise1(rng, 24), nw = new Noise1(rng, 16);
    const amp = rough * (p === 0 ? 1 : 1.25) * (o.ampScale ?? 1); const bow = (rng() - 0.5) * rough * 1.2 * (o.ampScale ?? 1);
    const over = o.overshoot === false ? 0 : rng() * rough * 2.2; const ph = rng() * 10;
    const q: [number, number, number][] = []; let s = 0;
    for (let i = 0; i < P.length; i++) {
      if (i > 0) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const u = L > 0 ? s / L : 0;
      let tx, ty; if (i < P.length - 1) { tx = P[i + 1][0] - P[i][0]; ty = P[i + 1][1] - P[i][1] } else { tx = P[i][0] - P[i - 1][0]; ty = P[i][1] - P[i - 1][1] }
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const off = amp * (nz.at(s * 0.07 + p * 3) + 0.35 * (rng() - 0.5)) + bow * Math.sin(u * Math.PI);
      let x = P[i][0] - ty * off, y = P[i][1] + tx * off;
      if (i === 0) { x -= tx * over; y -= ty * over } else if (i === P.length - 1) { x += tx * over * 0.6; y += ty * over * 0.6 }
      const wBase = lerp(w0, w1, u) * (p === 0 ? 1 : 0.72);
      const w = wBase * (1 + pressure * (0.45 * nw.at(s * 0.045 + ph) + 0.15 * (rng() - 0.5))) * (pressure > 0 ? (0.72 + 0.28 * Math.sin(Math.min(1, Math.min(u, 1 - u) * 6) * Math.PI / 2)) : 1);
      q.push([x, y, Math.max(0.25, w)]);
    }
    out.push({ pts: q, alpha: (o.alpha ?? 1) * (p === 0 ? 1 : 0.55), width: w0 * (p === 0 ? 1 : 0.72) });
  }
  return out;
}
/** Fill a variable-width stroke as one polygon with rounded ends. */
export function fillVarStroke(ctx: Ctx, q: [number, number, number][], color: string, alpha: number, i0?: number, i1?: number) {
  i0 = i0 ?? 0; i1 = i1 ?? q.length - 1; if (i1 - i0 < 1) return;
  const n = i1 - i0 + 1; const nx = new Array(n), ny = new Array(n);
  for (let k = 0; k < n; k++) { const i = i0 + k; const a = q[Math.max(i0, i - 1)], b = q[Math.min(i1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; nx[k] = -ty / l; ny[k] = tx / l }
  ctx.beginPath();
  for (let k = 0; k < n; k++) { const p = q[i0 + k], h = p[2] / 2; const x = p[0] + nx[k] * h, y = p[1] + ny[k] * h; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
  { const p = q[i1], h = p[2] / 2; const a0 = Math.atan2(ny[n - 1], nx[n - 1]); for (let k = 1; k < 5; k++) { const a = a0 - Math.PI * k / 5; ctx.lineTo(p[0] + Math.cos(a) * h, p[1] + Math.sin(a) * h) } }
  for (let k = n - 1; k >= 0; k--) { const p = q[i0 + k], h = p[2] / 2; ctx.lineTo(p[0] - nx[k] * h, p[1] - ny[k] * h) }
  { const p = q[i0], h = p[2] / 2; const a0 = Math.atan2(-ny[0], -nx[0]); for (let k = 1; k < 5; k++) { const a = a0 - Math.PI * k / 5; ctx.lineTo(p[0] + Math.cos(a) * h, p[1] + Math.sin(a) * h) } }
  ctx.closePath(); ctx.fillStyle = rgba(color, alpha); ctx.fill();
}
export function sketchLine(ctx: Ctx, pen: Pen, pts: Pt[], o: StrokeOpts) {
  const passes = sketchPasses(pen, pts, o); const usePoly = (o.pressure ?? pen.pressure) > 0.02 || o.widthEnd !== undefined;
  for (const ps of passes) {
    if (usePoly) { fillVarStroke(ctx, ps.pts, o.color || '#000', ps.alpha); continue }
    ctx.beginPath(); ps.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = ps.width; ctx.strokeStyle = rgba(o.color || '#000', ps.alpha); ctx.stroke();
  }
}
export function circlePts(cx: number, cy: number, r: number, seed: number, wob: number): Pt[] {
  const rng = mulberry32(seed); const nz = new Noise1(rng, 12); const n = Math.max(28, Math.round(r * 1.2));
  const a0 = rng() * Math.PI * 2; const pts: Pt[] = []; const extra = 0.35;
  for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI * 2 + extra); const rr = r * (1 + wob * nz.at(i / n * 6)) + wob * r * 0.3 * (rng() - 0.5); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]) }
  return pts;
}
export function sketchCircle(ctx: Ctx, pen: Pen, cx: number, cy: number, r: number, o: StrokeOpts & { wobScale?: number }) {
  const pts = circlePts(cx, cy, r, (o.seed! | 0) + 5, clamp(pen.rough * 0.035, 0, 0.12) * (o.wobScale ?? 1));
  sketchLine(ctx, pen, pts, { ...o, ampScale: 0.7, overshoot: false });
}
/** Hatch inside a circle, optionally only where dot(p-c, L) < thr (shadow side). */
export function hatchCircle(ctx: Ctx, pen: Pen, cx: number, cy: number, r: number, ang: number, spacing: number, o: StrokeOpts & { light?: Pt; thr?: number }) {
  const rng = mulberry32((o.seed! | 0) + 33);
  const dx = Math.cos(ang), dy = Math.sin(ang); const nx = -dy, ny = dx;
  const L = o.light; const thr = o.thr ?? 0;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r * 0.985, 0, Math.PI * 2); ctx.clip();
  const jit = spacing * 0.25;
  for (let d = -r + spacing * 0.5 + (rng() - 0.5) * jit; d < r; d += spacing + (rng() - 0.5) * jit) {
    const h = Math.sqrt(Math.max(0, r * r - d * d));
    let ax = cx + nx * d - dx * h, ay = cy + ny * d - dy * h, bx = cx + nx * d + dx * h, by = cy + ny * d + dy * h;
    if (L) { const fa = (ax - cx) * L[0] + (ay - cy) * L[1] - thr, fb = (bx - cx) * L[0] + (by - cy) * L[1] - thr;
      if (fa >= 0 && fb >= 0) continue;
      if (fa > 0 || fb > 0) { const u = fa / (fa - fb); if (fa > 0) { ax = ax + (bx - ax) * u; ay = ay + (by - ay) * u } else { bx = ax + (bx - ax) * u; by = ay + (by - ay) * u } } }
    if (Math.hypot(bx - ax, by - ay) < 1.5) continue;
    sketchLine(ctx, pen, [[ax, ay], [bx, by]], { seed: (o.seed! | 0) + Math.round(d * 13), passes: 1, width: o.width, color: o.color, alpha: o.alpha, ampScale: 0.5, step: 5, overshoot: false });
  }
  ctx.restore();
}

/* ---- watercolour ---- */
function wcGauss(rng: Rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
export function wcDeform(pts: Pt[], depth: number, variance: number, rng: Rng): Pt[] { let p = pts; for (let d = 0; d < depth; d++) { const out: Pt[] = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const ex = b[0] - a[0], ey = b[1] - a[1]; const len = Math.hypot(ex, ey) || 1; const nx = -ey / len, ny = ex / len; const dn = wcGauss(rng) * variance * len, dt = wcGauss(rng) * variance * len * 0.35; out.push(a, [mx + nx * dn + ex / len * dt, my + ny * dn + ey / len * dt]) } p = out } return p }
/** Watercolour fill of one polygon: stacked, lightly deformed transparent layers (multiply) with a drying ring and granulation.
    With `offscreen`, layers stack with source-over and the caller multiplies the result once. */
export function watercolourShape(ctx: Ctx, pen: Pen, pts: Pt[], col: string, seed: number, o: { layers?: number; fog?: number; strength?: number; offscreen?: boolean; noScale?: boolean; noRing?: boolean; granulate?: boolean } = {}) {
  const rng = mulberry32(seed + 4242); const layers = o.layers || 9; const fog = o.fog || 0;
  col = fogged(pen, col, fog); const light = luminance(pen.P.paper) > 0.5;
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1] } cx /= pts.length; cy /= pts.length;
  const shape = wcDeform(pts, 1, 0.06, rng);
  ctx.save(); ctx.globalCompositeOperation = o.offscreen ? 'source-over' : (light ? 'multiply' : 'screen');
  const aFill = (o.strength || 0.75) / layers * 1.15;
  for (let L = 0; L < layers; L++) { const sc = o.noScale ? 1 : 0.9 + rng() * 0.16; const lay = wcDeform(sc === 1 ? shape : shape.map(p => [cx + (p[0] - cx) * sc, cy + (p[1] - cy) * sc] as Pt), 2, (0.08 + rng() * 0.1) * (o.noScale ? 1.6 : 1), rng); pathOf(ctx, lay); ctx.fillStyle = rgba(col, aFill); ctx.fill() }
  if (!o.noRing) for (let e = 0; e < 2; e++) { const lay = wcDeform(shape, 1, 0.03, rng); pathOf(ctx, lay); ctx.lineWidth = 0.7 + rng() * 0.5; ctx.strokeStyle = rgba(mix(col, pen.P.ink, 0.25), 0.16 * (o.strength || 0.75) / 0.75); ctx.stroke() }
  if (o.granulate !== false) { ctx.save(); pathOf(ctx, shape); ctx.clip(); const area = Math.abs(polyArea(shape));
    const g = Math.round(area * 0.004); let xs = 1e9, ys = 1e9, xe = -1e9, ye = -1e9; for (const p of shape) { xs = Math.min(xs, p[0]); ys = Math.min(ys, p[1]); xe = Math.max(xe, p[0]); ye = Math.max(ye, p[1]) }
    for (let i = 0; i < g; i++) { ctx.fillStyle = rgba(mix(col, pen.P.ink, 0.4), 0.12 + rng() * 0.2); ctx.fillRect(xs + rng() * (xe - xs), ys + rng() * (ye - ys), 1, 1) } ctx.restore() }
  ctx.restore();
}
/** coloured-pencil scribble fill inside the current clip: back-and-forth strokes, two layers, ragged edges */
export function scribbleFill(ctx: Ctx, pen: Pen, x0: number, y0: number, x1: number, y1: number, col: string, seed: number, o: { fog?: number; d?: number }) {
  const fog = o.fog || 0, fk = 1 - fog * pen.fogAmt, d = o.d || 1; const rng = mulberry32(seed + 303);
  const c = fogged(pen, col, fog); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 3;
  const layers: [number, number, number][] = [[pen.hatchAngle * Math.PI / 180 + 0.9, pen.hatchSpacing * 0.55, 0.55], [pen.hatchAngle * Math.PI / 180 - 0.5, pen.hatchSpacing * 0.75, 0.35]];
  for (const [ang, sp, al] of layers) { const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx; const pts: Pt[] = []; let flip = 1;
    for (let dd = -R; dd < R; dd += sp * (0.8 + 0.4 * rng())) { const e0 = -R * (0.9 + 0.2 * rng()), e1 = R * (0.9 + 0.2 * rng()); pts.push([cx + nx * dd + dx * e0 * flip, cy + ny * dd + dy * e0 * flip]); pts.push([cx + nx * dd + dx * e1 * flip, cy + ny * dd + dy * e1 * flip]); flip = -flip }
    if (pts.length > 3) sketchLine(ctx, pen, pts, { seed: seed + Math.round(ang * 100), passes: 1, width: (1.1 + 0.6 * rng()) * d, color: c, alpha: al * (0.6 + 0.4 * fk), ampScale: 0.9, step: 6, overshoot: false, pressure: 0.8 }) }
}
/** Pen rendering of a sphere: hatch that thins toward the light and cross-hatches in the shadow, highlight left bare. */
export function penSphere(ctx: Ctx, pen: Pen, x: number, y: number, r: number, col: string, el: string, seed: number, o: { fog?: number; d?: number }) {
  const P = pen.P; const fog = o.fog || 0, fk = 1 - fog * pen.fogAmt, d = o.d || 1; const dens = pen.hatchDensity;
  const colour = pen.fill === 'ink colour' || isPencil(pen) || isWC(pen); const ink = fogged(pen, colour ? mix(col, P.hatch, isPencil(pen) ? 0.45 : isWC(pen) ? 0.6 : 0.15) : P.hatch, fog);
  const la = pen.lightAngle * Math.PI / 180; const light: Pt = [Math.cos(la), Math.sin(la)]; const ang = pen.hatchAngle * Math.PI / 180;
  const hs = pen.hatchSpacing * Math.max(0.7, d) / dens; const a = (0.55 + 0.45 * fk) * (colour ? 0.9 : 0.75) * (isWC(pen) ? 0.45 : 1);
  if (el === 'N' && r < 14) { const rng = mulberry32(seed + 5); const n = Math.round(r * r * 3.2 / (hs * hs) * dens * 2); ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = rgba(ink, a);
    for (let i = 0; i < n; i++) { const t = Math.sqrt(rng()), th = rng() * Math.PI * 2; const px = Math.cos(th) * t * r, py = Math.sin(th) * t * r; const lit = (px * light[0] + py * light[1]) / r; if (rng() < (lit + 1) / 2 * 0.9) continue; ctx.beginPath(); ctx.arc(x + px, y + py, 0.8 * d, 0, Math.PI * 2); ctx.fill() }
    ctx.restore(); return }
  hatchCircle(ctx, pen, x, y, r, ang, hs, { seed: seed + 11, width: 0.9 * d, color: ink, alpha: a * 0.8, light, thr: r * 0.45 });
  hatchCircle(ctx, pen, x, y, r, ang + 0.25, hs * 0.8, { seed: seed + 12, width: 0.9 * d, color: ink, alpha: a * 0.8, light, thr: -r * 0.1 });
  hatchCircle(ctx, pen, x, y, r, ang + 1.35, hs * 0.85, { seed: seed + 13, width: 0.85 * d, color: ink, alpha: a * 0.7, light, thr: -r * 0.5 });
}
/** Pen rendering of a stick: strokes along the axis, denser toward the shadow edge, a bare highlight strip, cross strokes in the shadow. Caller has clipped. */
export function penStick(ctx: Ctx, pen: Pen, ax: number, ay: number, mx: number, my: number, R: number, col: string, el: string, seed: number, o: { fog?: number; d?: number }) {
  const P = pen.P; const fog = o.fog || 0, fk = 1 - fog * pen.fogAmt, d = o.d || 1; const dens = pen.hatchDensity;
  const colour = pen.fill === 'ink colour' || isPencil(pen) || isWC(pen); const ink = fogged(pen, colour ? mix(col, P.hatch, isPencil(pen) ? 0.45 : isWC(pen) ? 0.6 : 0.15) : P.hatch, fog);
  const ux = mx - ax, uy = my - ay, L = Math.hypot(ux, uy) || 1, tx = ux / L, ty = uy / L, nx = -ty, ny = tx;
  const la = pen.lightAngle * Math.PI / 180; const litSign = (nx * Math.cos(la) + ny * Math.sin(la)) > 0 ? 1 : -1;
  const rng = mulberry32(seed + 21); const hs = pen.hatchSpacing * Math.max(0.7, d) / dens; const a = (0.55 + 0.45 * fk) * (colour ? 1.0 : 0.8) * (isWC(pen) ? 0.45 : 1);
  if (el === 'H') { for (const t of [-0.45, 0.2]) { sketchLine(ctx, pen, [[ax + nx * t * R - tx * R * 0.6, ay + ny * t * R - ty * R * 0.6], [mx + nx * t * R, my + ny * t * R]], { seed: seed + Math.round(t * 10), passes: 1, width: 0.7 * d, color: fogged(pen, P.hatch, fog), alpha: 0.35 * (0.5 + 0.5 * fk), ampScale: 0.5, step: 5, overshoot: false }) } return }
  if (el === 'N') { const n = Math.round((L + 2 * R) * 2 * R / (hs * hs) * 1.6 * dens); ctx.fillStyle = rgba(ink, a);
    for (let i = 0; i < n; i++) { const s = -R + rng() * (L + 2 * R), t = (rng() * 2 - 1); const lit = t * litSign; if (rng() < (lit + 1) / 2 * 0.85) continue; ctx.beginPath(); ctx.arc(ax + tx * s + nx * t * R, ay + ty * s + ny * t * R, 0.8 * d, 0, Math.PI * 2); ctx.fill() } return }
  const step = hs * 0.6 / R;
  for (let t = -1 + step * 0.5 + (rng() - 0.5) * step * 0.4; t < 1; t += step) {
    const lit = t * litSign; if (lit > 0.42) continue;
    if (lit > 0 && rng() < lit * 0.9) continue;
    const tone = clamp(0.55 - lit * 0.5, 0.3, 1);
    const s0 = -R * 0.7 + rng() * R * 0.5, s1 = L - rng() * R * 0.4;
    sketchLine(ctx, pen, [[ax + tx * s0 + nx * t * R, ay + ty * s0 + ny * t * R], [ax + tx * s1 + nx * t * R, ay + ty * s1 + ny * t * R]], { seed: seed + Math.round(t * 100), passes: 1, width: (0.9 + 0.45 * tone) * d * LW.inner(pen), color: ink, alpha: Math.min(1, a * (0.35 + tone)), ampScale: 0.6, step: 5, overshoot: false });
  }
  const cs = hs * 0.9; for (let sx = -R * 0.5 + rng() * cs; sx < L; sx += cs + (rng() - 0.5) * cs * 0.4) { const t0 = -0.98 * litSign, t1 = -0.35 * litSign;
    sketchLine(ctx, pen, [[ax + tx * sx + nx * t0 * R, ay + ty * sx + ny * t0 * R], [ax + tx * (sx + R * 0.35) + nx * t1 * R, ay + ty * (sx + R * 0.35) + ny * t1 * R]], { seed: seed + Math.round(sx * 7) + 500, passes: 1, width: 0.8 * d, color: ink, alpha: a * 0.65, ampScale: 0.5, step: 4, overshoot: false }) }
  if (el === 'S' || el === 'P') { for (let sx = -R * 0.5 + rng() * cs; sx < L; sx += cs) { sketchLine(ctx, pen, [[ax + tx * sx + nx * R * 0.9, ay + ty * sx + ny * R * 0.9], [ax + tx * (sx + R * 0.5) - nx * R * 0.9, ay + ty * (sx + R * 0.5) - ny * R * 0.9]], { seed: seed + Math.round(sx * 5) + 900, passes: 1, width: 0.8 * d, color: ink, alpha: a * 0.6, ampScale: 0.4, step: 4, overshoot: false }) } }
}
/** Pencil shadow strokes along the far side of a stick (colour modes). Caller has clipped. */
export function stickShadow(ctx: Ctx, pen: Pen, ax: number, ay: number, mx: number, my: number, R: number, col: string, seed: number, o: { fog?: number; d?: number }) {
  if (pen.shading <= 0) return; const P = pen.P; const fog = o.fog || 0, fk = 1 - fog * pen.fogAmt, d = o.d || 1;
  const ux = mx - ax, uy = my - ay, L = Math.hypot(ux, uy) || 1, tx = ux / L, ty = uy / L, nx = -ty, ny = tx;
  const la = pen.lightAngle * Math.PI / 180; const lx = Math.cos(la), ly = Math.sin(la); const side = (nx * lx + ny * ly) > 0 ? -1 : 1;
  for (const f of [0.5, 0.78]) { const off = R * f * side; sketchLine(ctx, pen, [[ax + nx * off - tx * R * 0.3, ay + ny * off - ty * R * 0.3], [mx + nx * off, my + ny * off]], { seed: seed + 7 + Math.round(f * 10), passes: 1, width: 0.9 * d, color: fogged(pen, pen.fill === 'ink colour' ? mix(col, P.hatch, 0.4) : P.hatch, fog), alpha: 0.35 * pen.shading * (0.5 + 0.5 * fk), ampScale: 0.5, step: 5, overshoot: false }) }
}
/** Dotted hydrogen bond / forming bond. */
export function drawDots(ctx: Ctx, ax: number, ay: number, bx: number, by: number, o: { seed: number; color: string; alpha: number; r?: number; gap?: number }) {
  const L = Math.hypot(bx - ax, by - ay); const ux = (bx - ax) / L, uy = (by - ay) / L; const rng = mulberry32(o.seed); const r = o.r || 0.9, gap = o.gap || 5.5;
  ctx.save(); ctx.fillStyle = rgba(o.color, o.alpha);
  for (let s = r + 1; s < L - r; s += gap) { const j = (rng() - 0.5) * 0.8; ctx.beginPath(); ctx.arc(ax + ux * s - uy * j, ay + uy * s + ux * j, r, 0, Math.PI * 2); ctx.fill() }
  ctx.restore();
}
