/* Suggest views: a scored search over orientations of a scene. What makes a mechanism read: the rings face-on, the
   reacting atoms in front of everything else and apart from each other on the page, the drawing wider than tall (a
   hero box, a phone's upper third and a figure are all wider than tall), and a leaving group going up and right, away
   from where a headline sits. Yaw and pitch are sampled on a grid; the roll for each is the one that lays the drawing's
   long axis flat (and its opposite, which is the same picture upside down: the exit rule decides between them). */
import type { Classic, Projector, SampledState } from '../classic/engine';
import { keyDiff } from './diff';

export interface ViewSuggestion { yaw: number; pitch: number; roll: number; score: number; parts: Record<string, number>; canvas?: HTMLCanvasElement }
const norm = (b: any) => Array.isArray(b) ? { a: b[0], b: b[1], order: b[2] ?? 1 } : { a: b.a, b: b.b, order: b.order ?? 1 };

/** The atoms the chemistry happens on: arrow anchors, and the ends of bonds that break or form. Falls back to the
    hetero atoms, then to everything. */
export function reactingAtoms(doc: { keyframes: any[] }): Set<string> {
  const out = new Set<string>(); const K = doc.keyframes;
  K.forEach((k, i) => {
    for (const ar of (k.arrows || [])) for (const end of ['from', 'to']) { const an = ar[end] || {}; if (an.atom) out.add(an.atom); if (an.lp) out.add(an.lp); if (an.bond) { out.add(an.bond[0]); out.add(an.bond[1]) } }
    const d = keyDiff(doc, i); if (d) { for (const [a, b] of d.broken) { out.add(a); out.add(b) } for (const [a, b] of d.formed) { out.add(a); out.add(b) } }
  });
  if (out.size) return out;
  for (const id in K[0].atoms) if (K[0].atoms[id].het) out.add(id);
  if (out.size) return out;
  for (const id in K[0].atoms) out.add(id); return out;
}

/** Rings of 5 or 6 heavy atoms in a keyframe's bond graph, as id lists in ring order. */
export function rings(K: any): string[][] {
  const adj: Record<string, string[]> = {};
  for (const bb of (K.bonds || [])) { const b = norm(bb); if (b.order === 0) continue; const A = K.atoms[b.a], B = K.atoms[b.b]; if (!A || !B || String(A.el).toUpperCase() === 'H' || String(B.el).toUpperCase() === 'H') continue; (adj[b.a] ||= []).push(b.b); (adj[b.b] ||= []).push(b.a) }
  const found = new Map<string, string[]>();
  for (const s in adj) {
    // depth-limited walks back to s
    const walk = (path: string[]) => {
      const last = path[path.length - 1];
      for (const nx of adj[last]) {
        if (nx === s && path.length >= 5) { const key = [...path].sort().join('|'); if (!found.has(key)) found.set(key, [...path]); continue }
        if (path.length >= 6 || path.includes(nx)) continue;
        walk([...path, nx]);
      }
    };
    walk([s]);
  }
  return [...found.values()];
}

interface Scored { yaw: number; pitch: number; roll: number; parts: Record<string, number> }

/** Score every candidate; returns the best `count`, distinct in direction. `frames` are the frames to project (one per
    keyframe, in their holds). Runs synchronously; a few hundred ms for a mechanism. */
export function suggestViews(E: Classic, doc: { keyframes: any[] }, W: number, H: number, frames: number[], count = 12, targetAspect = 1.4): ViewSuggestion[] {
  const g = suggesting(E, doc, W, H, frames, count, targetAspect); let r = g.next(); while (!r.done) r = g.next(); return r.value;
}
/** suggestViews a little at a time: `pause` is awaited every 30 ms or so (the engine is as it was meanwhile), so a page
    that asks stays responsive */
export async function suggestViewsAsync(E: Classic, doc: { keyframes: any[] }, W: number, H: number, frames: number[], count = 12, targetAspect = 1.4, pause: () => Promise<void>): Promise<ViewSuggestion[]> {
  const g = suggesting(E, doc, W, H, frames, count, targetAspect); let t = performance.now(), r = g.next();
  while (!r.done) { if (performance.now() - t > 30) { await pause(); t = performance.now() } r = g.next() }
  return r.value;
}
function* suggesting(E: Classic, doc: { keyframes: any[] }, W: number, H: number, frames: number[], count: number, targetAspect: number): Generator<void, ViewSuggestion[]> {
  const { score, flatRoll, total, restore } = makeScorer(E, doc, W, H, frames, targetAspect);
  const cands: Scored[] = [];
  for (let pitch = -60; pitch <= 60; pitch += 30) for (let yaw = 0; yaw < 360; yaw += 30) { const r0 = flatRoll(yaw, pitch); for (const roll of [r0, r0 + 180]) cands.push(score(yaw, pitch, ((Math.round(roll) + 180) % 360 + 360) % 360 - 180)); restore(); yield }
  restore();
  cands.sort((a, b) => total(b) - total(a));
  const dirOf = (c: Scored) => { const y = c.yaw * Math.PI / 180, p = c.pitch * Math.PI / 180; return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)] };
  const picks: Scored[] = [];
  for (const c of cands) { const d = dirOf(c); if (picks.some(p => { const e = dirOf(p); return d[0] * e[0] + d[1] * e[1] + d[2] * e[2] > Math.cos(28 * Math.PI / 180) })) continue; picks.push(c); if (picks.length >= count) break }
  return picks.map(c => ({ yaw: c.yaw, pitch: c.pitch, roll: c.roll, score: total(c), parts: c.parts }));
}
/** The score of one orientation, for comparing a view of your own with the suggestions. */
export function scoreView(E: Classic, doc: { keyframes: any[] }, W: number, H: number, frames: number[], yaw: number, pitch: number, roll: number, targetAspect = 1.4): ViewSuggestion {
  const { score, total, restore } = makeScorer(E, doc, W, H, frames, targetAspect); const c = score(yaw, pitch, roll); restore(); return { yaw, pitch, roll, score: total(c), parts: c.parts };
}
const WEIGHTS = { rings: 1.0, clear: 1.4, spread: 0.8, aspect: 0.7, exit: 0.6 };
function makeScorer(E: Classic, doc: { keyframes: any[] }, W: number, H: number, frames: number[], targetAspect: number) {
  const react = reactingAtoms(doc); const R = rings(doc.keyframes[0]);
  const exits: { id: string; dir: number[] }[] = [];
  for (const k of doc.keyframes) { const ex = k.exitDir; for (const id in k.atoms) { const a = k.atoms[id]; const d = a.exitTo ? [a.exitTo[0] - a.pos[0], a.exitTo[1] - a.pos[1], a.exitTo[2] - a.pos[2]] : (ex && (k.leave || []).some((g: string) => g === id || g === (a.group || ''))) ? ex : null; if (d) exits.push({ id, dir: d }) } }
  const cfg0 = E.cfg; const base = cfg0.view;
  const project = (yaw: number, pitch: number, roll: number, f: number) => { E.cfg = { ...cfg0, view: { ...base, yaw, pitch, roll, fixed: true } }; return E.projectFrame(W, H, f) };
  const score = (yaw: number, pitch: number, roll: number): Scored => {
    const parts = { rings: 0, clear: 0, spread: 0, aspect: 0, exit: 0 }; let nf = 0;
    for (const f of frames) {
      const { st, proj } = project(yaw, pitch, roll, f); nf++; const pxA = proj.pxPerA;
      const P: Record<string, { x: number; y: number; z: number; d: number }> = {}; for (const a of st.atoms) if (a.alpha > 0.5) P[a.id] = proj.proj(a.pos);
      // rings face-on
      if (R.length) { let s = 0, c = 0, mn = 1; for (const ring of R) { const pts = ring.map(id => st.A[id]?.pos).filter(Boolean) as number[][]; if (pts.length < 5) continue; const cen = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) cen[k] += p[k] / pts.length;
        const n = [0, 0, 0]; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const u = [p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]], v = [q[0] - cen[0], q[1] - cen[1], q[2] - cen[2]]; n[0] += u[1] * v[2] - u[2] * v[1]; n[1] += u[2] * v[0] - u[0] * v[2]; n[2] += u[0] * v[1] - u[1] * v[0] }
        const L = Math.hypot(n[0], n[1], n[2]) || 1; const a = proj.rot(cen), b = proj.rot([cen[0] + n[0] / L, cen[1] + n[1] / L, cen[2] + n[2] / L]); const face = Math.abs(b[2] - a[2]); s += face; if (face < mn) mn = face; c++ }
        parts.rings += c ? 0.5 * s / c + 0.5 * mn : 0.5 } else parts.rings += 0.5;   // the mean, and the worst: one ring seen edge-on is a line, whatever the others do
      // reacting atoms unoccluded: nothing within 0.8 Å on screen and nearer the eye
      const ids = [...react].filter(id => P[id]); let clear = 0;
      const nb = new Set<string>(); for (const bd of st.bonds) { nb.add(bd.a + '|' + bd.b); nb.add(bd.b + '|' + bd.a) }   // bonded neighbours do not hide an atom, they are its drawing
      const Q = st.atoms.map(o => P[o.id]);   // each atom where it is drawn (none: not drawn), looked up once, not per reacting atom
      for (const id of ids) { const p = P[id]; let blocked = false;   // (the cheap tests first; one atom in front is enough)
        for (let i = 0; i < Q.length && !blocked; i++) { const q = Q[i]; if (!q || !(q.z > p.z + 0.4) || !(Math.hypot(q.x - p.x, q.y - p.y) / pxA < 0.8)) continue; const o = st.atoms[i]; if (o.id !== id && !nb.has(id + '|' + o.id)) blocked = true }
        clear += blocked ? 0 : 1 }
      parts.clear += ids.length ? clear / ids.length : 1;
      // reacting atoms apart from each other
      let sp = 0, sc = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const p = P[ids[i]], q = P[ids[j]]; sp += Math.min(Math.hypot(p.x - q.x, p.y - q.y) / pxA, 2.5) / 2.5; sc++ }
      parts.spread += sc ? sp / sc : 1;
      // the whole drawing's aspect
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const id in P) { const p = P[id]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y }
      const asp = (x1 - x0 + 1) / (y1 - y0 + 1); parts.aspect += Math.max(0, 1 - Math.abs(Math.log(asp / targetAspect)) / Math.log(3));
      // leaving groups go up and right
      if (exits.length) { let s = 0, c = 0; for (const e of exits) { const a = st.A[e.id]; if (!a) continue; const d = proj.dir2(e.dir); const L = Math.hypot(d[0], d[1]) || 1; s += ((d[0] - d[1]) / L / Math.SQRT2 + 1) / 2; c++ } parts.exit += c ? s / c : 0.5 } else parts.exit += 0.5;
    }
    for (const k in parts) (parts as any)[k] /= Math.max(1, nf);
    return { yaw, pitch, roll, parts };
  };
  // the roll that lays the drawing flat: the principal axis of the projected atoms at roll 0
  const flatRoll = (yaw: number, pitch: number) => {
    const { st, proj } = project(yaw, pitch, 0, frames[0]); let sx = 0, sy = 0, n = 0; const pts: number[][] = [];
    for (const a of st.atoms) { if (a.alpha < 0.5) continue; const p = proj.proj(a.pos); pts.push([p.x, p.y]); sx += p.x; sy += p.y; n++ }
    if (n < 2) return 0; sx /= n; sy /= n; let xx = 0, xy = 0, yy = 0; for (const p of pts) { const dx = p[0] - sx, dy = p[1] - sy; xx += dx * dx; xy += dx * dy; yy += dy * dy }
    return Math.atan2(2 * xy, xx - yy) / 2 * 180 / Math.PI;   // the major axis's angle in screen coordinates (y down) is minus its angle in the engine's frame; rolling by it lays the axis flat
  };
  const total = (c: Scored) => Object.keys(WEIGHTS).reduce((s, k) => s + (WEIGHTS as any)[k] * (c.parts[k] ?? 0), 0) / Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  return { score, flatRoll, total, restore: () => { E.cfg = cfg0 } };
}

/** Frames to score: the last drawn frame of each keyframe's hold (arrows fully drawn), or frame 0. */
export function holdFrames(E: Classic, maxKeyframes = 8): number[] {
  const out: number[] = []; const segs = E.TL.segs.filter(s => s.type === 'hold');
  for (const s of segs) out.push(Math.max(s.start, s.start + Math.floor(s.len * 0.9 / 2) * 2));
  if (!out.length) out.push(0);
  if (out.length > maxKeyframes) { const step = out.length / maxKeyframes; return Array.from({ length: maxKeyframes }, (_, i) => out[Math.floor(i * step)]) }
  return out;
}
export type { Projector, SampledState };
