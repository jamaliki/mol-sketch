/* The sketch pass: G-buffer readback → visible regions per primitive → the original stroke engine draws each region,
   clipped to what the GPU says is visible. Occlusion comes from the pixels; the marks come from the pen. */
import type { Renderer } from '../render/renderer';
import type { Style } from '../style';
import { REP_STICKS, REP_CARTOON, REP_SURFACE } from '../render/geometry';
import { extractRegions, dilate, type Region, type Loop } from './regions';
import { penOf, isInk, isPencil, isWC, LW, fogged, fillFor, sketchLine, sketchPasses, fillVarStroke, sketchCircle, hatchCircle, watercolourShape, scribbleFill, penStick, penSphere, stickShadow, type Pen, type Ctx } from './strokes';
import { paper, grainOverlay } from './paper';
import { clamp, lerp, mulberry32, Noise1, rgba, mix, luminance, pathOf, polyArea, type Pt } from './util';

type Proj = { x: number; y: number; z: number; d: number; fog: number };

export interface SketchStats { readMs: number; regionMs: number; drawMs: number; regions: number }

export function drawSketch(ctx: Ctx, R: Renderer, style: Style, boil: number): SketchStats {
  const t0 = performance.now();
  const s = R.structure; const W = R.w, H = R.h; const dpr = 1;   // the overlay has the G-buffer's pixel size; strokes are scaled by `px`
  const px = W / 960;                                              // stroke widths are specified for a 960 px wide drawing
  const pen = penOf(style); pen.inkWidth *= px; pen.hatchSpacing *= px; pen.rough *= px;
  const P = style.palette;
  const seedBase = boil * 7919;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  // paper
  const pc = paper(style, W, H, dpr, boil); ctx.drawImage(pc, 0, 0, W, H);
  if (!s) { ctx.restore(); return { readMs: 0, regionMs: 0, drawMs: 0, regions: 0 } }
  // pixels → regions
  const rb = R.readback(); const t1 = performance.now();
  const depthJump = Math.max(0.35, R.camera.radius * 0.006);
  const regions = extractRegions(W, H, rb.label, rb.depth, depthJump, 0.75);
  const t2 = performance.now();
  // projections of the atoms the sticks need
  const proj = (i: number): Proj => R.project(s.x[i], s.y[i], s.z[i]);
  const projP = (p: number[]): Proj => R.project(p[0], p[1], p[2]);
  const stickMask = R.geom.stickMask; const scheme = R.geom.scheme!;
  const adj = new Map<number, number[]>();
  if (stickMask) for (let b = 0; b < s.bonds.length; b += 2) { const i = s.bonds[b], j = s.bonds[b + 1]; if (!stickMask[i] || !stickMask[j]) continue; (adj.get(i) ?? adj.set(i, []).get(i)!).push(j); (adj.get(j) ?? adj.set(j, []).get(j)!).push(i) }
  const R0 = style.stickRadius;
  const d0 = R.project(R.focus[0], R.focus[1], R.focus[2]).d || 1;   // pixels per Å at the focus: perspective factor d = p.d / d0
  const light = luminance(P.paper) > 0.5;
  const bondedTo = (i: number, j: number) => (adj.get(i) || []).includes(j);

  /* ---------- helpers ---------- */
  const clipRegion = (loops: Loop[], m: number) => { ctx.beginPath(); for (const L of loops) { const q = m ? dilate(L.pts, m) : L.pts; q.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath() } ctx.clip('nonzero') };
  const fillRegionPaper = (r: Region) => { ctx.fillStyle = P.paper; ctx.fillRect(r.x0 - 4, r.y0 - 4, r.x1 - r.x0 + 8, r.y1 - r.y0 + 8) };
  /** strokes along the region boundary: silhouette runs heavy; contact runs by `contact(other)` → weight or 0 */
  const outline = (r: Region, fog: number, d: number, seed: number, contact: (other: number) => number, passes?: number) => {
    const fk = 1 - fog * pen.fogAmt; const ink = fogged(pen, P.ink, fog);
    for (const L of r.loops) {
      const n = L.pts.length; if (n < 3) continue;
      // find a start where the kind changes so runs are contiguous
      let start = 0; for (let i = 0; i < n; i++) if (L.kind[i] !== L.kind[(i + n - 1) % n] || L.other[i] !== L.other[(i + n - 1) % n]) { start = i; break }
      const allSame = L.kind.every((k, i) => k === L.kind[0] && L.other[i] === L.other[0]);
      if (allSame) { const w = L.kind[0] ? LW.outer(pen) : contact(L.other[0]); if (w <= 0) continue; const pts = L.pts.concat([L.pts[0]]);
        sketchLine(ctx, pen, pts, { seed, width: pen.inkWidth * d * (0.75 + 0.25 * fk) * w, color: ink, alpha: (0.55 + 0.4 * fk) * (L.kind[0] ? 1 : 0.75), ampScale: 0.8, overshoot: false, step: 4 * px, passes }); continue }
      let i = start; let guard = 0;
      while (guard++ < n + 1) {
        const k = L.kind[i], o = L.other[i]; const run: Pt[] = [L.pts[i]]; let j = i;
        while (L.kind[j] === k && L.other[j] === o) { j = (j + 1) % n; run.push(L.pts[j]); if (j === start) break }
        const w = k ? LW.outer(pen) : contact(o);
        if (w > 0 && run.length >= 2) sketchLine(ctx, pen, run, { seed: seed + i * 3, width: pen.inkWidth * d * (0.75 + 0.25 * fk) * w, color: ink, alpha: (0.55 + 0.4 * fk) * (k ? 1 : 0.7), ampScale: 0.8, overshoot: k === 1, step: 4 * px, passes });
        if (j === start) break; i = j;
      }
    }
  };
  const capsulePts = (ax: number, ay: number, mx: number, my: number, Rr: number, Rm: number) => {
    const ux = mx - ax, uy = my - ay, L = Math.hypot(ux, uy) || 1; const tx = ux / L, ty = uy / L, nx = -ty, ny = tx;
    const pts: Pt[] = [[mx + nx * Rm, my + ny * Rm], [ax + nx * Rr, ay + ny * Rr]];
    const a0 = Math.atan2(ny, nx); for (let k = 1; k < 10; k++) { const an = a0 + Math.PI * k / 10; pts.push([ax + Math.cos(an) * Rr, ay + Math.sin(an) * Rr]) }
    pts.push([ax - nx * Rr, ay - ny * Rr], [mx - nx * Rm, my - ny * Rm]); return pts;
  };
  /** the interior of one half-stick (no outline: the region boundary provides it) */
  const halfStickFill = (ax: number, ay: number, mx: number, my: number, Rr: number, Rm: number, col: string, el: string, seed: number, fog: number, d: number) => {
    const q = capsulePts(ax, ay, mx, my, Math.max(0.5, Rr - 0.6 * px), Math.max(0.5, Rm - 0.6 * px));
    ctx.save(); pathOf(ctx, q); ctx.clip();
    ctx.fillStyle = P.paper; ctx.fillRect(Math.min(ax, mx) - Rr - 2, Math.min(ay, my) - Rr - 2, Math.abs(mx - ax) + 2 * Rr + 4, Math.abs(my - ay) + 2 * Rr + 4);
    if (!isInk(pen)) { ctx.fillStyle = fogged(pen, fillFor(pen, col), fog); ctx.fill() }
    if (isWC(pen) && el !== 'H') watercolourShape(ctx, pen, q, col, seed, { fog, layers: 7, strength: 0.8 });
    if (isInk(pen)) { if (isPencil(pen) && el !== 'H') { const xs = q.map(p => p[0]), ys = q.map(p => p[1]); scribbleFill(ctx, pen, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), col, seed, { fog, d }) } if (!isWC(pen) || pen.shading > 0) penStick(ctx, pen, ax, ay, mx, my, Rr, col, el, seed, { fog, d }) }
    else stickShadow(ctx, pen, ax, ay, mx, my, Rr, col, seed, { fog, d });
    ctx.restore();
  };
  const flatBall = (x: number, y: number, r: number, col: string, el: string, seed: number, fog: number, d: number) => {
    const fk = 1 - fog * pen.fogAmt; const la = pen.lightAngle * Math.PI / 180; const lt: Pt = [Math.cos(la), Math.sin(la)];
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = P.paper; ctx.fill(); if (!isInk(pen)) { ctx.fillStyle = rgba(fogged(pen, fillFor(pen, col), fog), 1); ctx.fill() }
    if (isWC(pen)) { const q: Pt[] = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; q.push([x + Math.cos(a) * r, y + Math.sin(a) * r]) } watercolourShape(ctx, pen, q, col, seed, { fog, layers: 8, strength: 0.8 }) }
    if (isInk(pen)) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r + (isPencil(pen) ? 1.5 : 0), 0, Math.PI * 2); ctx.clip(); if (isPencil(pen)) scribbleFill(ctx, pen, x - r, y - r, x + r, y + r, col, seed, { fog, d }); penSphere(ctx, pen, x, y, r, col, el, seed, { fog, d }); ctx.restore() }
    else if (pen.shading > 0 && r > 3) hatchCircle(ctx, pen, x, y, r, pen.hatchAngle * Math.PI / 180, pen.hatchSpacing * (1 + fog * 0.6) * Math.max(0.7, d), { seed: seed + 2, width: 0.9 * d * px, color: fogged(pen, pen.fill === 'ink colour' ? mix(col, P.hatch, 0.4) : P.hatch, fog), alpha: 0.45 * pen.shading * (0.5 + 0.5 * fk), light: lt, thr: -r * 0.15 });
    ctx.restore();
  };

  /* ---------- items, back to front ---------- */
  type Item = { z: number; draw: () => void };
  const items: Item[] = [];
  const cartoonRuns = new Map<number, Region[]>(); const surfaceRegions: Region[] = [];
  const posCache = new Map<number, Proj>(); const pos = (i: number) => { let p = posCache.get(i); if (!p) { p = proj(i); posCache.set(i, p) } return p };
  const midCache = new Map<string, Proj>(); const mid = (i: number, j: number) => { const k = i < j ? i + ':' + j : j + ':' + i; let p = midCache.get(k); if (!p) { p = R.project((s.x[i] + s.x[j]) / 2, (s.y[i] + s.y[j]) / 2, (s.z[i] + s.z[j]) / 2); midCache.set(k, p) } return p };
  const lowDetail = regions.size > 400;
  for (const r of regions.values()) {
    const rep = r.label >>> 24, id = r.label & 0xffffff;
    if (rep === REP_CARTOON) { const run = id >> 2; (cartoonRuns.get(run) ?? cartoonRuns.set(run, []).get(run)!).push(r); continue }
    if (rep === REP_SURFACE) { surfaceRegions.push(r); continue }
    if (rep !== REP_STICKS) continue;
    const i = id; const p = pos(i); const el = s.element[i]; const col = scheme.atom(i); const seed = seedBase + i * 131;
    const nb = adj.get(i) || []; const fog = p.fog, d = p.d / d0;   // d: relative perspective scale (1 at the focus)
    items.push({ z: r.z, draw: () => {
      const Rr = R0 * p.d * (el === 'H' ? 0.75 : 1);
      ctx.save(); clipRegion(r.loops, 2 * px + pen.rough * 1.2); fillRegionPaper(r);
      for (const j of nb) { const m = mid(i, j); const Rm = R0 * m.d * ((el === 'H' || s.element[j] === 'H') ? 0.75 : 1); halfStickFill(p.x, p.y, m.x, m.y, Rr, Rm, col, el, seed + j * 7, fog, d) }
      if (nb.length === 0) flatBall(p.x, p.y, R0 * 2.2 * p.d, col, el, seed, fog, d);
      if (nb.length >= 2) {   // junction: sketched ring under a disc of fill, as in the page
        const fk = 1 - fog * pen.fogAmt;
        sketchCircle(ctx, pen, p.x, p.y, Rr, { seed: seed + 4, width: pen.inkWidth * d * (0.75 + 0.25 * fk) * LW.outer(pen), color: fogged(pen, P.ink, fog), alpha: 0.55 + 0.4 * fk, passes: lowDetail ? 1 : undefined });
        ctx.beginPath(); ctx.arc(p.x, p.y, Rr - 0.6 * px, 0, Math.PI * 2); ctx.fillStyle = P.paper; ctx.fill(); if (!isInk(pen)) { ctx.fillStyle = fogged(pen, fillFor(pen, col), fog); ctx.fill() }
        if (isWC(pen)) { const q: Pt[] = []; for (let k = 0; k < 10; k++) { const an = k / 10 * Math.PI * 2; q.push([p.x + Math.cos(an) * (Rr - 0.8), p.y + Math.sin(an) * (Rr - 0.8)]) } watercolourShape(ctx, pen, q, col, seed, { fog, layers: 5, strength: 0.7, granulate: false }) }
        if (isInk(pen)) { ctx.save(); ctx.clip(); if (isPencil(pen)) scribbleFill(ctx, pen, p.x - Rr, p.y - Rr, p.x + Rr, p.y + Rr, col, seed, { fog, d }); penSphere(ctx, pen, p.x, p.y, Rr, col, el, seed, { fog, d }); ctx.restore() }
      }
      ctx.restore();
      // outline: silhouettes heavy; the seam to a bonded neighbour is a midpoint tick in ink modes, nothing in colour modes
      // the seam to a bonded neighbour is a midpoint tick in ink modes and nothing in colour modes; any other touching thing gets the full outline
      outline(r, fog, d, seed, other => { const orep = other >>> 24, oid = other & 0xffffff; if (orep === REP_STICKS && bondedTo(i, oid)) return isInk(pen) && !isWC(pen) && !isPencil(pen) && s.element[i] !== s.element[oid] && i < oid ? 0.7 * LW.inner(pen) : 0; return LW.outer(pen) }, lowDetail ? 1 : undefined);
    } });
  }
  /* ---- cartoon: one item per run; fills per face region, contour lines on the +B face, hatch on the −B face ---- */
  const runById = new Map<number, typeof R.geom.runs[number]>(); for (const run of R.geom.runs) runById.set(run.id, run);
  for (const [runId, regs] of cartoonRuns) {
    const run = runById.get(runId); if (!run) continue;
    const z = regs.reduce((a, r) => a + r.z * r.count, 0) / regs.reduce((a, r) => a + r.count, 0);
    items.push({ z, draw: () => {
      const S = run.samples; const pr = S.map(sm => projP(sm.p));
      const fog = pr.reduce((a, p) => a + p.fog, 0) / pr.length, fk = 1 - fog * pen.fogAmt; const d = 1;
      const seed = seedBase + runId * 977;
      const baseCol = run.colorHex; const ink = fogged(pen, P.ink, fog); const hatch = fogged(pen, pen.fill === 'ink colour' ? mix(baseCol, P.hatch, 0.2) : P.hatch, fog);
      const isRibbon = run.ss === 'H' || run.ss === 'E';
      for (const r of regs) {
        const face = (r.label & 0xffffff) & 3;
        ctx.save(); clipRegion(r.loops, 1.5 * px + pen.rough); fillRegionPaper(r);
        let col = fillFor(pen, baseCol); if (face === 1 && !isInk(pen)) col = mix(col, P.ink, 0.14); col = fogged(pen, col, fog);
        if (!isInk(pen)) { ctx.fillStyle = col; ctx.fillRect(r.x0 - 4, r.y0 - 4, r.x1 - r.x0 + 8, r.y1 - r.y0 + 8) }
        else if (isWC(pen)) { ctx.fillStyle = rgba(mix(fogged(pen, face === 1 ? mix(baseCol, P.ink, 0.12) : baseCol, fog), P.paper, 0.45), 0.6); ctx.fillRect(r.x0 - 4, r.y0 - 4, r.x1 - r.x0 + 8, r.y1 - r.y0 + 8) }   // a base tint so feathered edges never show bare paper
        const heavy = r.loops.reduce((a, L) => a + L.pts.length, 0) > 2500;
        for (const L of r.loops) { if (polyArea(L.pts) <= 0) continue;
          if (isWC(pen)) { if (heavy) { ctx.fillStyle = rgba(fogged(pen, baseCol, fog), 0.5); pathOf(ctx, L.pts); ctx.fill() } else watercolourShape(ctx, pen, L.pts, face === 1 ? mix(baseCol, P.ink, 0.12) : baseCol, seed + L.pts.length, { fog, layers: lowDetail ? 4 : 9, strength: 0.85, noScale: true }) }
          if (isPencil(pen)) scribbleFill(ctx, pen, r.x0, r.y0, r.x1, r.y1, baseCol, seed + face, { fog, d }) }
        ctx.restore();
      }
      // contour lines along the +B face, broken like pencil; hatch across the −B face
      if (isRibbon) {
        const Lp: Pt[] = [], Rp: Pt[] = [];
        for (let k = 0; k < S.length; k++) { const sm = S[k]; const hw = sm.w / 2; const a = projP([sm.p[0] + sm.n[0] * hw, sm.p[1] + sm.n[1] * hw, sm.p[2] + sm.n[2] * hw]), b = projP([sm.p[0] - sm.n[0] * hw, sm.p[1] - sm.n[1] * hw, sm.p[2] - sm.n[2] * hw]); Lp.push([a.x, a.y]); Rp.push([b.x, b.y]) }
        const wInk = pen.inkWidth * LW.outer(pen);
        const fr = [0.18, 0.38, 0.62, 0.82].map(f => { const c: Pt[] = Lp.map((p, k) => [lerp(p[0], Rp[k][0], f), lerp(p[1], Rp[k][1], f)]); return sketchPasses(pen, c, { step: 0, seed: seed + Math.round(f * 100), width: wInk * 0.55, passes: 1, ampScale: 1.3, overshoot: false })[0] });
        const frMid = sketchPasses(pen, Lp.map((p, k) => [(p[0] + Rp[k][0]) / 2, (p[1] + Rp[k][1]) / 2] as Pt), { step: 0, seed: seed + 77, width: wInk * 0.55, passes: 1, ampScale: 1.3, overshoot: false })[0];
        const skipRng = mulberry32(seed + 5); const skip = S.map(() => [skipRng(), skipRng(), skipRng()]);
        const front = regs.filter(r => ((r.label & 0xffffff) & 3) === 0), back = regs.filter(r => ((r.label & 0xffffff) & 3) === 1);
        if (front.length && fr[0]) { ctx.save(); clipRegion(front.flatMap(r => r.loops), 0.5);
          const lines = isInk(pen) ? (run.ss === 'H' ? [fr[0], fr[1], fr[2], fr[3]] : [fr[1], fr[2]]) : (run.ss === 'H' ? [fr[0], fr[1]] : [frMid]);
          lines.forEach((ln, li) => { if (!ln) return; for (let j = 0; j < S.length - 1; j++) { if (skip[j][li % 3] < 0.3) continue; fillVarStroke(ctx, ln.pts, hatch, (isInk(pen) ? 0.6 : 0.32) * (0.4 + 0.6 * fk), Math.max(0, j - 1), Math.min(ln.pts.length - 1, j + 2)) } });
          ctx.restore() }
        if (back.length && pen.shading > 0) { ctx.save(); clipRegion(back.flatMap(r => r.loops), 0.5);
          for (let j = 0; j < S.length - 1; j++) { if (skip[j][2] < 0.35) continue; const a: Pt = [lerp(Lp[j][0], Lp[j + 1][0], 0.5), lerp(Lp[j][1], Lp[j + 1][1], 0.5)], b: Pt = [lerp(Rp[j][0], Rp[j + 1][0], 0.5), lerp(Rp[j][1], Rp[j + 1][1], 0.5)];
            sketchLine(ctx, pen, [a, b], { seed: seed + j * 3, passes: 1, width: 0.8 * px, color: hatch, alpha: 0.4 * pen.shading, ampScale: 0.5, step: 5 * px, overshoot: false }) }
          ctx.restore() }
      }
      // edges: silhouettes heavy; the crease between the two faces and the boundary to the next run lighter
      // the crease between the two faces is a light line; the seam to the next run of the same kind is invisible, to a different kind light
      for (const r of regs) outline(r, fog, d, seed + (r.label & 3) * 17, other => { const orep = other >>> 24; if (orep !== REP_CARTOON) return 0; const orun = runById.get((other & 0xffffff) >> 2); if (!orun) return 0; if (orun.id === runId) return LW.inner(pen) * 0.9; return orun.ss === run.ss ? 0 : LW.inner(pen) * 0.8 }, lowDetail ? 1 : undefined);
    } });
  }
  /* ---- surface: residue patches back to front into an offscreen wash, then a silhouette band, multiplied once ---- */
  if (surfaceRegions.length) {
    const z = surfaceRegions.reduce((a, r) => a + r.z * r.count, 0) / surfaceRegions.reduce((a, r) => a + r.count, 0);
    items.push({ z, draw: () => {
      const off = document.createElement('canvas'); off.width = W; off.height = H; const x = off.getContext('2d')!;
      let zmin = Infinity, zmax = -Infinity, xmin = W, xmax = 0, ymin = H, ymax = 0;
      for (const r of surfaceRegions) { zmin = Math.min(zmin, r.z); zmax = Math.max(zmax, r.z); xmin = Math.min(xmin, r.x0); xmax = Math.max(xmax, r.x1); ymin = Math.min(ymin, r.y0); ymax = Math.max(ymax, r.y1) }
      const zs = Math.max(1e-6, zmax - zmin); const la = pen.lightAngle * Math.PI / 180; const lx = Math.cos(la), ly = Math.sin(la); const Rr = Math.max(xmax - xmin, ymax - ymin) / 2 || 1; const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
      const many = surfaceRegions.length > 600;
      const sorted = surfaceRegions.slice().sort((a, b) => b.z - a.z);
      const unionPath = (c: CanvasRenderingContext2D) => { c.beginPath(); for (const r of surfaceRegions) for (const L of r.loops) { L.pts.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath() } };
      for (const r of sorted) {
        const depth = (r.z - zmin) / zs; const lit = ((r.cx - cx) * lx + (r.cy - cy) * ly) / Rr;
        const tone = clamp(0.3 + 0.6 * depth - 0.2 * lit, 0.15, 1);
        const col = scheme.surface(s.residues[r.label & 0xffffff]);
        for (const L of r.loops) { if (polyArea(L.pts) <= 0 || L.pts.length < 3) continue;
          if (many && r.count < 40) { x.globalAlpha = 0.75 * tone; x.fillStyle = col; pathOf(x, L.pts); x.fill(); x.globalAlpha = 1; continue }   // tiny patches: one flat layer
          watercolourShape(x, pen, L.pts, col, seedBase + (r.label & 0xffffff) * 31, { fog: 0, layers: many ? 2 : 5, strength: tone, offscreen: true, granulate: false, noRing: many && depth < 0.15 }) }
      }
      // silhouette band along the boundary with anything that is not surface, and granulation, masked by the surface's union
      const band = document.createElement('canvas'); band.width = W; band.height = H; const bx = band.getContext('2d')!;
      bx.lineWidth = 4.4 * px; bx.lineCap = 'round'; bx.globalAlpha = 0.55;
      for (const r of surfaceRegions) { const col = mix(scheme.surface(s.residues[r.label & 0xffffff]), P.ink, 0.35); bx.strokeStyle = col;
        for (const L of r.loops) { const n = L.pts.length; let any = false; bx.beginPath(); let open = false; for (let i = 0; i < n; i++) { const sil = L.kind[i] === 1 && (L.other[i] >>> 24) !== REP_SURFACE; if (sil) { if (!open) { bx.moveTo(L.pts[i][0], L.pts[i][1]); open = true } bx.lineTo(L.pts[(i + 1) % n][0], L.pts[(i + 1) % n][1]); any = true } else open = false } if (any) bx.stroke() } }
      bx.globalAlpha = 1; const rng = mulberry32(seedBase + 7); const g = Math.round((xmax - xmin) * (ymax - ymin) * 0.0025);
      for (let i = 0; i < g; i++) { bx.fillStyle = rgba(mix(P.surface, P.ink, 0.4), 0.1 + rng() * 0.2); bx.fillRect(xmin + rng() * (xmax - xmin), ymin + rng() * (ymax - ymin), 1, 1) }
      bx.globalCompositeOperation = 'destination-in'; unionPath(bx); bx.fill('nonzero');
      x.drawImage(band, 0, 0);
      ctx.save();
      // paper under the surface, then the wash multiplied once
      unionPath(ctx); ctx.fillStyle = P.paper; ctx.fill('nonzero');
      ctx.globalCompositeOperation = light ? 'multiply' : 'screen'; ctx.drawImage(off, 0, 0); ctx.restore();
    } });
  }
  /* ---- construction lines: stick axes running past their ends, guide circles round N and O, centre ticks; under everything ---- */
  if (style.construction && stickMask) {
    const w = pen.inkWidth * LW.faint(pen); const ink = P.ink;
    ctx.save(); ctx.globalAlpha = 0.28;
    const seen = new Set<number>();
    for (const [i, nbs] of adj) { const pa = pos(i); for (const j of nbs) { if (j < i) continue; const pb = pos(j); const dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L; const e = d0 * 0.5;
      sketchLine(ctx, pen, [[pa.x - ux * e, pa.y - uy * e], [pb.x + ux * e, pb.y + uy * e]], { seed: seedBase + i * 31 + j, passes: 1, width: w, color: ink, alpha: 1, ampScale: 0.6, step: 8 * px, overshoot: false, pressure: 0.2 }) }
      seen.add(i) }
    for (const i of seen) { const p = pos(i); const r = R0 * p.d; const el = s.element[i];
      if (el === 'O' || el === 'N') sketchCircle(ctx, pen, p.x, p.y, r * 2.2, { seed: seedBase + i * 7, passes: 1, width: w, color: ink, alpha: 0.9, wobScale: 1.6 });
      const t = 3 * px; ctx.strokeStyle = rgba(ink, 0.7); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p.x - t, p.y); ctx.lineTo(p.x + t, p.y); ctx.moveTo(p.x, p.y - t); ctx.lineTo(p.x, p.y + t); ctx.stroke() }
    ctx.restore();
  }
  items.sort((a, b) => b.z - a.z);
  const lim = (window as any).__sketchLimit as number | undefined; let n = 0; const tItems = performance.now();
  for (const it of items) { it.draw(); if (lim && ++n >= lim) break }
  (window as any).__sketchProfile = { items: items.length, drawn: n || items.length, ms: performance.now() - tItems, regions: regions.size, runs: cartoonRuns.size };
  // paper grain over everything, so fills sit in the paper rather than on it
  if (style.paper.grain > 0) { ctx.save(); ctx.globalCompositeOperation = light ? 'multiply' : 'screen'; ctx.globalAlpha = clamp(0.55 * style.paper.grain, 0, 1); ctx.drawImage(grainOverlay(W, H, dpr, light), 0, 0, W, H); ctx.restore() }
  ctx.restore();
  const t3 = performance.now();
  return { readMs: t1 - t0, regionMs: t2 - t1, drawMs: t3 - t2, regions: regions.size };
}
