/* What changes from one keyframe to the next, for the overlay the timeline shows while you hover it: atoms that move,
   leave or arrive, bonds that break, form or change order. The matching follows the engine's (asNext, leave). */
import type { Projector, SampledState } from '../classic/engine';

export interface KeyDiff { moved: Map<string, number>; gone: Set<string>; fresh: Map<string, number[]>; broken: [string, string][]; formed: [string, string][]; reorder: [string, string][]; charged: Set<string> }
const norm = (b: any) => Array.isArray(b) ? { a: b[0], b: b[1], order: b[2] ?? 1 } : { a: b.a, b: b.b, order: b.order ?? 1 };
const bkey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a;
const groupOf = (id: string, a: any) => a.group || ((a.resn || '') + (a.resi ?? '')) || id.split(':')[0];

export function keyDiff(doc: { keyframes: any[] }, i: number): KeyDiff | null {
  const K = doc.keyframes; const n = K.length; if (n < 2 && !(K[0]?.transition > 0)) return null;
  const Ki = K[i], Kj = K[(i + 1) % n]; const A = Ki.atoms || {}, B = Kj.atoms || {};
  const leave = new Set<string>(Ki.leave || []), alias = Ki.asNext || {};
  const leaving = (id: string) => leave.size > 0 && (leave.has(id) || (alias[id] === undefined && leave.has(groupOf(id, A[id]))));
  const nextOf: Record<string, string> = {}, prevOf: Record<string, string> = {};
  for (const id in A) { if (leaving(id)) continue; const m = alias[id] ?? id; if (B[m] && !(m in prevOf)) { nextOf[id] = m; prevOf[m] = id } }
  const d: KeyDiff = { moved: new Map(), gone: new Set(), fresh: new Map(), broken: [], formed: [], reorder: [], charged: new Set() };
  for (const id in A) { const m = nextOf[id]; if (!m) { d.gone.add(id); continue } const p = A[id].pos, q = B[m].pos; const dd = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (dd > 0.3) d.moved.set(id, dd); if ((A[id].charge || 0) !== (B[m].charge || 0)) d.charged.add(id) }
  for (const id in B) if (!prevOf[id]) d.fresh.set(id, B[id].pos);
  const Bi: Record<string, any> = {}, Bj: Record<string, any> = {};
  for (const b of (Ki.bonds || [])) { const o = norm(b); Bi[bkey(o.a, o.b)] = o }
  for (const b of (Kj.bonds || [])) { const o = norm(b); const a = prevOf[o.a], c = prevOf[o.b]; if (a && c) Bj[bkey(a, c)] = { a, b: c, order: o.order } }   // in Ki's ids, for bonds between atoms that exist now
  for (const k in Bi) { const bi = Bi[k], bj = Bj[k]; if (bi.order === 0) continue; if (!bj) { if (nextOf[bi.a] || nextOf[bi.b]) d.broken.push([bi.a, bi.b]) } else if (bj.order !== bi.order && bj.order !== 0) d.reorder.push([bi.a, bi.b]) }
  for (const k in Bj) { const bj = Bj[k]; if (bj.order === 0) continue; if (!Bi[k] || Bi[k].order === 0) d.formed.push([bj.a, bj.b]) }
  return d;
}

/** Draw the diff over the current frame. `dpr` scales CSS-pixel projections to the overlay's device pixels. */
export function drawDiff(ctx: CanvasRenderingContext2D, d: KeyDiff, st: SampledState, proj: Projector, dpr: number, pxPerA: number) {
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = 'round';
  const at = (id: string) => { const a = st.A[id]; return a ? proj.proj(a.pos) : null };
  const r = Math.max(6, pxPerA * 0.45);
  const line = (a: string, b: string, color: string, dash: number[]) => { const p = at(a), q = at(b); if (!p || !q) return; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash(dash); ctx.stroke() };
  for (const [a, b] of d.broken) line(a, b, 'rgba(239,68,68,.9)', [6, 5]);
  for (const [a, b] of d.formed) line(a, b, 'rgba(34,197,94,.9)', [2, 5]);
  for (const [a, b] of d.reorder) line(a, b, 'rgba(250,204,21,.9)', [10, 4]);
  ctx.setLineDash([]); ctx.lineWidth = 2;
  for (const [id, dd] of d.moved) { const p = at(id); if (!p) continue; ctx.beginPath(); ctx.arc(p.x, p.y, r * p.d, 0, Math.PI * 2); ctx.strokeStyle = `rgba(249,115,22,${Math.min(0.95, 0.25 + dd / 3).toFixed(2)})`; ctx.stroke() }   // the further it travels, the stronger the ring
  for (const id of d.gone) { const p = at(id); if (!p) continue; ctx.beginPath(); ctx.arc(p.x, p.y, r * p.d + 3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(239,68,68,.9)'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]) }
  for (const [, pos] of d.fresh) { const p = proj.proj(pos); ctx.beginPath(); ctx.arc(p.x, p.y, r * p.d, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(34,197,94,.9)'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]) }
  for (const id of d.charged) { const p = at(id); if (!p) continue; ctx.font = '600 12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(250,204,21,.95)'; ctx.fillText('±', p.x + r * p.d + 2, p.y - r * p.d - 2) }
  ctx.restore();
}

export function diffSummary(d: KeyDiff): string {
  const parts: string[] = [];
  if (d.moved.size) parts.push(`${d.moved.size} move`); if (d.gone.size) parts.push(`${d.gone.size} leave`); if (d.fresh.size) parts.push(`${d.fresh.size} arrive`);
  if (d.broken.length) parts.push(`${d.broken.length} bond${d.broken.length > 1 ? 's' : ''} break`); if (d.formed.length) parts.push(`${d.formed.length} form`); if (d.reorder.length) parts.push(`${d.reorder.length} change order`); if (d.charged.size) parts.push(`${d.charged.size} charge${d.charged.size > 1 ? 's' : ''} change`);
  return parts.length ? parts.join(' · ') : 'nothing changes';
}
