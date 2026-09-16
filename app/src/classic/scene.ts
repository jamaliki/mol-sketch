/* Scene documents (the page's keyframed JSON) in the app: a Structure for the GPU preview from a sampled state. */
import { Structure, type AtomRecord } from '../model/structure';

export interface SceneDoc { name?: string; reps?: { sticks: string; cartoon: string; surface: string }; groupColors?: Record<string, string>; view?: any; keyframes: any[]; fitPoints?: Float32Array }

/** All keyframe atom positions, for a camera that does not jump between frames. */
export function sceneFitPoints(doc: SceneDoc): Float32Array {
  const out: number[] = [];
  for (const k of doc.keyframes) for (const id in k.atoms) { const p = k.atoms[id].pos; out.push(p[0], p[1], p[2]) }
  return Float32Array.from(out);
}

/** A Structure from the classic engine's sampled state (atoms with alpha, bonds with order/partial). */
export function structureFromState(st: any, name: string): Structure {
  const atoms: any[] = st.atoms.filter((a: any) => a.alpha > 0.05);
  // residues contiguous in first-appearance order so record index = atom index after grouping
  const keyOf = (a: any) => (a.chain || '') + '/' + (a.resi ?? 0) + '/' + (a.resn || 'UNK') + '/' + (a.het ? 1 : 0);
  const order: string[] = []; const groups = new Map<string, any[]>();
  for (const a of atoms) { const k = keyOf(a); if (!groups.has(k)) { groups.set(k, []); order.push(k) } groups.get(k)!.push(a) }
  const recs: AtomRecord[] = []; const index = new Map<string, number>();
  for (const k of order) for (const a of groups.get(k)!) { index.set(a.id, recs.length); recs.push({ serial: recs.length, name: a.name || a.id, el: a.el, resn: a.resn || 'UNK', chain: a.chain || '', resi: a.resi ?? 0, x: a.pos[0], y: a.pos[1], z: a.pos[2], het: !!a.het }) }
  const s = Structure.fromRecords(recs, { H: [], E: [] }, {}, {}); s.name = name;
  // the loader marks Cα; scenes mark their own cut points
  s.flags.fill(0); for (const a of atoms) { const i = index.get(a.id); if (i !== undefined && a.sphere) s.flags[i] |= 1 }
  const bonds: number[] = [];
  for (const b of st.bonds) { if (b.order === 0 || b.alpha < 0.05) continue; const i = index.get(b.a), j = index.get(b.b); if (i === undefined || j === undefined) continue; bonds.push(i, j) }
  s.bonds = Int32Array.from(bonds);
  return s;
}
