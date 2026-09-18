/* Authoring the chemistry by clicking on the drawing: which atom or bond is under the pointer, and the edits to a
   keyframe that the Chemistry section makes — curly arrows (tail, then head), lone pairs, formal charges. Everything
   is written into the scene document's keyframes, so Save scene JSON keeps it and the CLI renders it. */
import type { Projector, SampledState } from '../classic/engine';

export type Hit = { kind: 'atom'; id: string; x: number; y: number } | { kind: 'bond'; a: string; b: string; x: number; y: number } | null;
export type Anchor = { atom: string } | { bond: [string, string] } | { lp: string; i?: number };

/** What is under (x, y) in canvas CSS pixels: the nearest atom within its drawn radius (plus a little), else the nearest
    bond within 6 px of its middle stretch. */
export function hitTest(st: SampledState, proj: Projector, x: number, y: number, pxPerA: number, stickRadius: number): Hit {
  let best: Hit = null, bd = Infinity;
  for (const a of st.atoms) {
    if (a.alpha < 0.3) continue; const p = proj.proj(a.pos); const r = Math.max(9, (a.sphere ? 0.55 : stickRadius * 1.6) * pxPerA * p.d + 4);
    const d = Math.hypot(p.x - x, p.y - y); if (d < r && d < bd) { bd = d; best = { kind: 'atom', id: a.id, x: p.x, y: p.y } }
  }
  if (best) return best;
  for (const b of st.bonds) {
    if (b.order === 0 || b.alpha < 0.3) continue; const A = st.A[b.a], B = st.A[b.b]; if (!A || !B) continue;
    const p = proj.proj(A.pos), q = proj.proj(B.pos); const dx = q.x - p.x, dy = q.y - p.y; const L2 = dx * dx + dy * dy || 1;
    const t = ((x - p.x) * dx + (y - p.y) * dy) / L2; if (t < 0.15 || t > 0.85) continue;
    const px = p.x + dx * t, py = p.y + dy * t; const d = Math.hypot(px - x, py - y);
    if (d < 7 && d < bd) { bd = d; best = { kind: 'bond', a: b.a, b: b.b, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }
  }
  return best;
}

const norm = (b: any) => Array.isArray(b) ? { a: b[0], b: b[1], order: b[2] ?? 1 } : { a: b.a, b: b.b, order: b.order ?? 1 };

/** A lone-pair direction for an atom: away from its bonds (their unit vectors summed and reversed); with no bonds,
    or bonds that cancel (a linear centre), a direction perpendicular to the first bond. */
export function lonePairDir(K: any, id: string): number[] {
  const a = K.atoms[id]; const sum = [0, 0, 0]; let first: number[] | null = null;
  for (const bb of (K.bonds || [])) { const b = norm(bb); if (b.order === 0) continue; const o = b.a === id ? b.b : b.b === id ? b.a : null; if (!o || !K.atoms[o]) continue;
    const q = K.atoms[o].pos; const v = [q[0] - a.pos[0], q[1] - a.pos[1], q[2] - a.pos[2]]; const L = Math.hypot(v[0], v[1], v[2]) || 1; for (let k = 0; k < 3; k++) { v[k] /= L; sum[k] += v[k] } if (!first) first = v }
  const L = Math.hypot(sum[0], sum[1], sum[2]);
  if (L > 0.2) return [-sum[0] / L, -sum[1] / L, -sum[2] / L];
  if (first) { const p = Math.abs(first[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = [first[1] * p[2] - first[2] * p[1], first[2] * p[0] - first[0] * p[2], first[0] * p[1] - first[1] * p[0]]; const cl = Math.hypot(c[0], c[1], c[2]) || 1; return [c[0] / cl, c[1] / cl, c[2] / cl] }
  return [0, 1, 0];
}

/** Toggle a lone pair on an atom of keyframe K: none → one (pointing away from the bonds); any → none. Returns what it did. */
export function toggleLonePair(K: any, id: string): string {
  const a = K.atoms[id]; if (!a) return '';
  if (a.lp && a.lp.length) { const n = a.lp.length; delete a.lp; return `removed the lone pair${n > 1 ? 's' : ''} of ${id}` }
  a.lp = [lonePairDir(K, id)]; return `lone pair on ${id}`;
}
/** Cycle the formal charge of an atom: 0 → +1 → −1 → 0. */
export function cycleCharge(K: any, id: string): string {
  const a = K.atoms[id]; if (!a) return ''; const c = a.charge || 0; const next = c === 0 ? 1 : c > 0 ? -1 : 0;
  if (next === 0) delete a.charge; else a.charge = next; return `${id}: ${next === 0 ? 'no charge' : next > 0 ? '+' : '−'}`;
}
/** The anchor an arrow gets from a hit: a bond, or an atom — its lone pair when it has one and the anchor is a tail. */
export function anchorFor(K: any, h: Exclude<Hit, null>, tail: boolean): Anchor {
  if (h.kind === 'bond') return { bond: [h.a, h.b] };
  const a = K.atoms[h.id]; if (tail && a && a.lp && a.lp.length) return { lp: h.id, i: 0 };
  return { atom: h.id };
}
export function anchorText(an: Anchor): string { return 'bond' in an ? `${an.bond[0]}–${an.bond[1]}` : 'lp' in an ? `lone pair of ${an.lp}` : an.atom }
/** Add an arrow; `side` is chosen so the bow points away from the drawing's centre in the current projection. */
export function addArrow(K: any, from: Anchor, to: Anchor, screen: (an: Anchor) => [number, number] | null, centre: [number, number]): any {
  const p = screen(from), q = screen(to); let side = 1;
  if (p && q) { const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; const dx = q[0] - p[0], dy = q[1] - p[1]; side = (-dy * (mx - centre[0]) + dx * (my - centre[1])) >= 0 ? 1 : -1 }
  const ar: any = { from, to, bulge: 0.4, side }; if (!K.arrows) K.arrows = []; K.arrows.push(ar); return ar;
}
/** Where an anchor sits on screen for the current frame (the same rule as the engine's, without the offsets). */
export function anchorScreen(an: Anchor, st: SampledState, proj: Projector): [number, number] | null {
  if ('bond' in an) { const a = st.A[an.bond[0]], b = st.A[an.bond[1]]; if (!a || !b) return null; const p = proj.proj(a.pos), q = proj.proj(b.pos); return [(p.x + q.x) / 2, (p.y + q.y) / 2] }
  const a = st.A['lp' in an ? an.lp : an.atom]; if (!a) return null; const p = proj.proj(a.pos); return [p.x, p.y];
}
