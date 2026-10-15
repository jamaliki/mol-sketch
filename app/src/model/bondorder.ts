/* Bond orders for a structure read from a file. A PDB or mmCIF file gives atoms; their bonds are found by distance
   (Structure.inferBonds), and would all be single. Their orders come, most trusted first:
   - a standard residue's template: the amino acids (the backbone's C=O; Asp, Glu, Asn and Gln's C=O; Arg's C=N; the
     rings of Phe, Tyr, Trp and His in a Kekulé form, His's after its tautomer when the file has hydrogens) and their
     common variants, the nucleotides' bases, and a phosphate's P=O;
   - for any other residue (a ligand, a modified residue), what the file says: mmCIF's _chem_comp_bond, or a PDB file's
     CONECT records, which list a partner twice or three times for a double or triple bond;
   - failing that, the geometry (perceive): flat rings with aromatic bond lengths are put in a Kekulé form, a planar
     centre takes its double bond to a terminal O, S or N (C=O, C=S, an amidine or guanidine's C=N), short bonds between
     planar atoms are double and short, straight ones triple (C≡C, C≡N), and a phosphate or sulphate keeps its P=O and
     S=O. It is conservative: a bond becomes double only on clear evidence, as a wrong double bond misleads more than a
     missing one.
   A scene keeps the orders it was written with; this is only for structures. */
import type { Structure } from './structure';

export interface OrderHints {
  /** mmCIF _chem_comp_bond: per component, 'A|B' (both ways round) → order; 4 is aromatic, put in a Kekulé form here */
  comp?: Map<string, Map<string, number>>;
  /** a PDB file's CONECT records: serial → serial → how many times it is listed */
  conect?: Map<number, Map<number, number>>;
}

/* ---------------------------------------------------------------- templates */
type Tmpl = [string, string, number][];
const BB: Tmpl = [['C', 'O', 2]];   // a C-terminal carboxylate's other oxygen (OXT) stays single
const BENZYL: Tmpl = [['CG', 'CD1', 2], ['CE1', 'CZ', 2], ['CD2', 'CE2', 2]];
const HIS_E: Tmpl = [['CG', 'CD2', 2], ['ND1', 'CE1', 2]];   // H on NE2, as most histidines are; also the form without hydrogens, and the doubly protonated one
const HIS_D: Tmpl = [['CG', 'CD2', 2], ['CE1', 'NE2', 2]];   // H on ND1
const ADE: Tmpl = [['C8', 'N7', 2], ['C4', 'C5', 2], ['C6', 'N1', 2], ['C2', 'N3', 2]];
const GUA: Tmpl = [['C8', 'N7', 2], ['C4', 'C5', 2], ['C6', 'O6', 2], ['C2', 'N3', 2]];
const CYT: Tmpl = [['C2', 'O2', 2], ['N3', 'C4', 2], ['C5', 'C6', 2]];
const URA: Tmpl = [['C2', 'O2', 2], ['C4', 'O4', 2], ['C5', 'C6', 2]];
const RAW: Record<string, Tmpl> = {
  GLY: BB, ALA: BB, SER: BB, CYS: BB, VAL: BB, LEU: BB, ILE: BB, MET: BB, PRO: BB, THR: BB, LYS: BB,
  MSE: BB, HYP: BB, CYX: BB, CYM: BB, LYN: BB, SEP: BB, TPO: BB, SEC: BB,
  ASP: [...BB, ['CG', 'OD1', 2]], ASH: [...BB, ['CG', 'OD1', 2]], ASN: [...BB, ['CG', 'OD1', 2]],
  GLU: [...BB, ['CD', 'OE1', 2]], GLH: [...BB, ['CD', 'OE1', 2]], GLN: [...BB, ['CD', 'OE1', 2]],
  ARG: [...BB, ['CZ', 'NH2', 2]],
  PHE: [...BB, ...BENZYL], TYR: [...BB, ...BENZYL], PTR: [...BB, ...BENZYL],
  TRP: [...BB, ['CG', 'CD1', 2], ['CD2', 'CE2', 2], ['CE3', 'CZ3', 2], ['CZ2', 'CH2', 2]],
  HIS: [...BB, ...HIS_E], HIE: [...BB, ...HIS_E], HSE: [...BB, ...HIS_E], HIP: [...BB, ...HIS_E], HSP: [...BB, ...HIS_E], HSH: [...BB, ...HIS_E],
  HID: [...BB, ...HIS_D], HSD: [...BB, ...HIS_D],
  ACE: [['C', 'O', 2]], NME: [], NH2: [],
  A: ADE, DA: ADE, G: GUA, DG: GUA, I: GUA, DI: GUA, C: CYT, DC: CYT, U: URA, DU: URA, DT: URA,
};
const HIS_FAMILY = new Set(['HIS', 'HIE', 'HSE', 'HIP', 'HSP', 'HSH', 'HID', 'HSD']);
const WATER = new Set(['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'TIP3', 'SOL']);
const key = (a: string, b: string) => a + '|' + b;
function mapOf(t: Tmpl): Map<string, number> { const m = new Map<string, number>(); for (const [a, b, o] of t) { m.set(key(a, b), o); m.set(key(b, a), o) } return m }
const TEMPLATES = new Map<string, Map<string, number>>(Object.entries(RAW).map(([k, t]) => [k, mapOf(t)]));
const variants = new Map<string, Map<string, number>>();
/** a template with some of its double bonds moved (a tautomer, a protonated acid), made once per residue name and change */
function variant(resn: string, tag: string, change: (t: Tmpl) => Tmpl) {
  const k = resn + ':' + tag; let m = variants.get(k); if (!m) variants.set(k, m = mapOf(change(RAW[resn]))); return m }

/* ---------------------------------------------------------------- the structure's bond graph */
interface Graph { start: Int32Array; to: Int32Array; bond: Int32Array }
function graphOf(s: Structure): Graph {
  const n = s.count, B = s.bonds, m = B.length >> 1; const start = new Int32Array(n + 1);
  for (let k = 0; k < m; k++) { start[B[2 * k] + 1]++; start[B[2 * k + 1] + 1]++ }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n), to = new Int32Array(2 * m), bond = new Int32Array(2 * m);
  for (let k = 0; k < m; k++) { const i = B[2 * k], j = B[2 * k + 1]; to[fill[i]] = j; bond[fill[i]++] = k; to[fill[j]] = i; bond[fill[j]++] = k }
  return { start, to, bond };
}

export function assignBondOrders(s: Structure, hints: OrderHints = {}) {
  const m = s.bonds.length >> 1; const orders = new Uint8Array(m).fill(1); s.bondOrder = orders; if (!m) return;
  const B = s.bonds, el = s.element, name = s.atomName, res = s.residues, of = s.residueOf;
  // hydrogens on each atom (a tautomer, a protonated acid), when the file has them
  const hc = new Uint8Array(s.count); let anyH = false;
  for (let k = 0; k < m; k++) { const i = B[2 * k], j = B[2 * k + 1]; if (el[i] === 'H') { hc[j]++; anyH = true } if (el[j] === 'H') { hc[i]++; anyH = true } }
  // each residue's template (null: none), its hydrogens' variant where they say which
  const tmpl: (Map<string, number> | null)[] = res.map(r => {
    const base = TEMPLATES.get(r.resn); if (!base) return null;
    if (!anyH) return base;
    const at = (nm: string) => { for (let i = r.atomStart; i < r.atomEnd; i++) if (name[i] === nm) return i; return -1 };
    const H = (nm: string) => { const i = at(nm); return i < 0 ? -1 : hc[i] };
    let t = base, tag = '';
    if (HIS_FAMILY.has(r.resn)) { const d = H('ND1'), e = H('NE2'); if (d > 0 && e <= 0) tag = 'D'; else if (e > 0 && d <= 0) tag = 'E'; else if (d > 0 && e > 0) tag = 'P' }
    else if (r.resn === 'ARG') { if (H('NE') === 0 && H('NH1') > 0) tag = 'NE'; else if (H('NH1') === 1 && H('NH2') === 2) tag = 'NH1' }
    else if (r.resn === 'ASP' || r.resn === 'ASH') { if (H('OD1') > 0 && H('OD2') === 0) tag = 'OD2' }
    else if (r.resn === 'GLU' || r.resn === 'GLH') { if (H('OE1') > 0 && H('OE2') === 0) tag = 'OE2' }
    const cterm = H('O') > 0 && H('OXT') === 0;   // the carboxylic acid's hydrogen on O: the double bond is OXT's
    if (!tag && !cterm) return t;
    const swap = (t0: Tmpl, from: [string, string], to: [string, string]) => t0.map(b => (b[0] === from[0] && b[1] === from[1]) ? [to[0], to[1], b[2]] as [string, string, number] : b);
    t = variant(r.resn, tag + (cterm ? '+OXT' : ''), t0 => {
      let out = t0;
      if (tag === 'D') out = out.filter(b => !(b[0] === 'ND1' && b[1] === 'CE1')).concat([['CE1', 'NE2', 2]]);
      if (tag === 'E' || tag === 'P') out = out.filter(b => !(b[0] === 'CE1' && b[1] === 'NE2')).concat(out.some(b => b[0] === 'ND1') ? [] : [['ND1', 'CE1', 2]]);
      if (tag === 'NE') out = swap(out, ['CZ', 'NH2'], ['CZ', 'NE']); if (tag === 'NH1') out = swap(out, ['CZ', 'NH2'], ['CZ', 'NH1']);
      if (tag === 'OD2') out = swap(out, ['CG', 'OD1'], ['CG', 'OD2']); if (tag === 'OE2') out = swap(out, ['CD', 'OE1'], ['CD', 'OE2']);
      if (cterm) out = swap(out, ['C', 'O'], ['C', 'OXT']);
      return out });
    return t;
  });
  let other = false;
  for (let k = 0; k < m; k++) { const i = B[2 * k], j = B[2 * k + 1]; const ri = of[i]; if (ri !== of[j]) continue;
    const T = tmpl[ri]; if (!T) { other = true; continue } const o = T.get(key(name[i], name[j])); if (o) orders[k] = o }
  const hasP = res.some((r, ri) => tmpl[ri] && (r.nucleic || /^(SEP|TPO|PTR)$/.test(r.resn)));
  if (!other && !hasP) return;   // a protein or nucleic acid of standard residues only: done
  const g = graphOf(s); const ctx: Ctx = { s, g, orders, hc };
  // a phosphate in a standard residue (a nucleotide's, a phosphoserine's): P=O to its first free oxygen by name
  if (hasP) for (let ri = 0; ri < res.length; ri++) { const r = res[ri]; if (!tmpl[ri]) continue;
    for (let i = r.atomStart; i < r.atomEnd; i++) if (el[i] === 'P') phosphoryl(ctx, i, ['OP1', 'O1P', 'OP2', 'O2P', 'OP3', 'O3P']) }
  if (!other) return;
  const comp = hints.comp, conect = hints.conect;
  for (let ri = 0; ri < res.length; ri++) {
    const r = res[ri]; if (tmpl[ri] || WATER.has(r.resn) || r.atomEnd - r.atomStart < 2) continue;
    const atoms: number[] = []; for (let i = r.atomStart; i < r.atomEnd; i++) atoms.push(i);
    const cb = comp?.get(r.resn);
    if (cb) { fromComp(ctx, atoms, cb); continue }
    if (conect && atoms.some(i => { const c = conect.get(s.serial[i]); if (c) for (const v of c.values()) if (v > 1) return true; return false })) { fromConect(ctx, atoms, conect, tmpl); continue }
    perceive(ctx, atoms);
  }
}

interface Ctx { s: Structure; g: Graph; orders: Uint8Array; hc: Uint8Array }

/** P=O: a phosphate's (or phosphonate's) P, four-bonded, takes a double bond to one oxygen bonded to nothing else and
    holding no hydrogen: the first of `names` it has, else the first by name of those as short as the shortest (O1G,
    OP1, as the CCD writes them) */
function phosphoryl(c: Ctx, p: number, names: string[] = []): number {
  const { s, g, orders, hc } = c; const el = s.element;
  let deg = 0; const free: [number, number][] = [];
  for (let q = g.start[p]; q < g.start[p + 1]; q++) { const j = g.to[q]; if (!ORGANIC.has(el[j])) continue; deg++;
    if (el[j] === 'O' && hc[j] === 0 && heavyDegree(c, j) === 1) free.push([j, g.bond[q]]) }
  if (deg !== 4 || !free.length || free.some(([, k]) => orders[k] > 1)) return -1;
  const pick = names.map(nm => free.find(([j]) => s.atomName[j] === nm)).find(f => f) ?? byName(s, p, free)[0];
  if (dist(s, p, pick[0]) > 1.62) return -1;
  orders[pick[1]] = 2; return pick[0];
}
/** oxygens round a centre in the order they take its double bonds: those within 0.06 Å of the shortest bond, by name */
function byName(s: Structure, c: number, free: [number, number][]) {
  const L = (o: [number, number]) => dist(s, c, o[0]); const m = Math.min(...free.map(L));
  return free.filter(o => L(o) <= m + 0.06).sort((a, b) => s.atomName[a[0]].localeCompare(s.atomName[b[0]], undefined, { numeric: true })).concat(free.filter(o => L(o) > m + 0.06).sort((a, b) => L(a) - L(b)));
}
const ORGANIC = new Set(['H', 'C', 'N', 'O', 'S', 'P', 'SE', 'F', 'CL', 'BR', 'I', 'B', 'SI', 'AS']);
function heavyDegree(c: Ctx, i: number) { const { s, g } = c; let n = 0; for (let q = g.start[i]; q < g.start[i + 1]; q++) { const e = s.element[g.to[q]]; if (e !== 'H' && ORGANIC.has(e)) n++ } return n }
const dist = (s: Structure, i: number, j: number) => Math.hypot(s.x[i] - s.x[j], s.y[i] - s.y[j], s.z[i] - s.z[j]);

/** the residue's bonds as the file's _chem_comp_bond gives them; aromatic ones put in a Kekulé form */
function fromComp(c: Ctx, atoms: number[], cb: Map<string, number>) {
  const { s, g, orders } = c; const inR = new Set(atoms); const arom: [number, number, number][] = [];
  for (const i of atoms) for (let q = g.start[i]; q < g.start[i + 1]; q++) { const j = g.to[q]; if (j <= i || !inR.has(j)) continue;
    const o = cb.get(key(s.atomName[i], s.atomName[j])); if (!o) continue;
    if (o === 4) arom.push([i, j, g.bond[q]]); else orders[g.bond[q]] = Math.min(3, o) }
  if (arom.length) kekulize(c, arom);
}

/** the residue's bonds as its CONECT records give them: a partner listed n times is an n-fold bond */
function fromConect(c: Ctx, atoms: number[], conect: Map<number, Map<number, number>>, tmpl: (Map<string, number> | null)[]) {
  const { s, g, orders } = c; const sr = s.serial;
  for (const i of atoms) for (let q = g.start[i]; q < g.start[i + 1]; q++) { const j = g.to[q]; if (tmpl[s.residueOf[j]]) continue;
    const n = Math.max(conect.get(sr[i])?.get(sr[j]) ?? 0, conect.get(sr[j])?.get(sr[i]) ?? 0); if (n > 1) orders[g.bond[q]] = Math.min(3, n) }
}

/** aromatic bonds as alternating single and double: the matching of their atoms that pairs every carbon it can, a
    nitrogen with two neighbours next (a pyridine's), one with three (a pyrrole's NH) only if it must */
function kekulize(c: Ctx, arom: [number, number, number][]) {
  const { s, orders } = c; const ids = [...new Set(arom.flatMap(([i, j]) => [i, j]))]; const loc = new Map(ids.map((a, k) => [a, k]));
  const taken = new Set<number>(); for (const a of ids) { const { g } = c; for (let q = g.start[a]; q < g.start[a + 1]; q++) if (orders[g.bond[q]] > 1) taken.add(a) }
  const R = new Float64Array(ids.length); ids.forEach((a, k) => { const e = s.element[a], d = degreeOf(c, a);
    R[k] = taken.has(a) ? -1e3 : e === 'C' ? 10 : e === 'N' ? (d <= 2 ? 4 : -2) : -3 });
  const edges = arom.map(([i, j, b]) => [loc.get(i)!, loc.get(j)!, 0, b] as Edge);
  const mate = bestMatching(ids.length, R, edges);
  for (const e of edges) if (mate[e[0]] === e[1]) orders[e[3]] = 2;
}
function degreeOf(c: Ctx, i: number) { const { s, g } = c; let n = 0; for (let q = g.start[i]; q < g.start[i + 1]; q++) if (ORGANIC.has(s.element[g.to[q]])) n++; return n }

/* ---------------------------------------------------------------- orders from geometry */
// reference lengths (Å) of a pair's single and double bond; the longest bond outside a ring taken as double, the longest
// in a flat ring taken as aromatic, and the longest taken as triple
const PAIR: Record<string, { one: number; two: number; dmax: number; amax: number; tmax?: number }> = {
  'C-C': { one: 1.54, two: 1.34, dmax: 1.40, amax: 1.48, tmax: 1.25 },   // (a porphyrin's pyrroles have Cα–Cβ of 1.44–1.47)
  'C-N': { one: 1.47, two: 1.28, dmax: 1.36, amax: 1.45, tmax: 1.21 },
  'C-O': { one: 1.43, two: 1.21, dmax: 1.34, amax: 1.42 },
  'C-S': { one: 1.82, two: 1.62, dmax: 1.72, amax: 1.80 },
  'N-N': { one: 1.45, two: 1.25, dmax: 1.32, amax: 1.42 },
  'N-O': { one: 1.40, two: 1.21, dmax: 1.30, amax: 1.42 },
  'N-S': { one: 1.70, two: 1.55, dmax: 0, amax: 1.75 },
  'O-O': { one: 1.48, two: 1.21, dmax: 1.30, amax: 0 },   // dioxygen, not a peroxide
};
const pairOf = (a: string, b: string) => PAIR[a < b ? a + '-' + b : b + '-' + a];
type Edge = [number, number, number, number];   // two nodes, the weight, the bond

function perceive(c: Ctx, atoms: number[]) {
  const { s, g, orders } = c; const el = s.element, X = s.x, Y = s.y, Z = s.z;
  const heavy = atoms.filter(i => el[i] !== 'H'); if (heavy.length < 2) return;
  const inG = new Set(heavy), groupH = heavy.length < atoms.length;
  // an atom's neighbours for its geometry: all but metals (a ring nitrogen that holds a zinc is still a ring nitrogen)
  const nbr = new Map<number, number[]>(), deg = new Map<number, number>();
  for (const i of heavy) { const out: number[] = []; for (let q = g.start[i]; q < g.start[i + 1]; q++) if (ORGANIC.has(el[g.to[q]])) out.push(q); nbr.set(i, out); deg.set(i, out.length) }
  const D = (i: number) => deg.get(i)!;
  const vec = (i: number, j: number) => [X[j] - X[i], Y[j] - Y[i], Z[j] - Z[i]];
  const ang = (cA: number, a: number, b: number) => { const u = vec(cA, a), v = vec(cA, b); const L = Math.hypot(u[0], u[1], u[2]) * Math.hypot(v[0], v[1], v[2]) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / L))) * 180 / Math.PI };
  const around = (i: number) => nbr.get(i)!.map(q => g.to[q]);
  const planar = (i: number) => { const n = around(i); return n.length === 3 && ang(i, n[0], n[1]) + ang(i, n[0], n[2]) + ang(i, n[1], n[2]) >= 345 };   // (360 trigonal, 328 tetrahedral)
  const straight = (i: number) => { const n = around(i); return n.length === 2 && ang(i, n[0], n[1]) >= 160 };
  const bent = (i: number) => { const n = around(i); return n.length === 2 ? ang(i, n[0], n[1]) : 0 };
  const used = new Set<number>(); const set = (k: number, o: number, ...a: number[]) => { orders[k] = o; for (const x of a) used.add(x) };
  // the group's own heavy bonds
  const bonds: [number, number, number][] = [];
  for (const i of heavy) for (const q of nbr.get(i)!) { const j = g.to[q]; if (j > i && inG.has(j)) bonds.push([i, j, g.bond[q]]) }
  const len = (b: [number, number, number]) => dist(s, b[0], b[1]);

  // flat rings with aromatic bond lengths, every atom in them planar (pyridine, imidazole, a purine, a porphyrin's pyrroles)
  const adjG = new Map<number, number[]>(); for (const [i, j] of bonds) { (adjG.get(i) ?? adjG.set(i, []).get(i)!).push(j); (adjG.get(j) ?? adjG.set(j, []).get(j)!).push(i) }
  const flat = new Set<number>(), flat5 = new Set<number>(), six = new Set<number>(), flatBond = new Set<number>(), seen = new Set<string>();
  const inRing = new Set<number>(), ring5 = new Set<number>(), flatN = new Set<number>();
  for (const [u, v, k] of bonds) {
    const ring = shortestRing(adjG, u, v, 6); if (!ring) continue;
    const id = [...ring].sort((a, b) => a - b).join(','); if (seen.has(id)) continue; seen.add(id);
    for (const i of ring) { inRing.add(i); if (ring.length === 5) ring5.add(i) }
    if (ring.length < 5) continue;
    // every atom trigonal: planar with three neighbours, or with two at an angle not far below a hexagon's (a ring's CH2
    // is told by its bonds' lengths; a five-membered ring's angles are too alike to tell anything)
    if (!ring.every(i => /^[CNOS]$/.test(el[i]) && (D(i) === 2 ? ring.length === 5 || /^[OS]$/.test(el[i]) || bent(i) >= 108 : D(i) === 3 && /^[CN]$/.test(el[i]) && planar(i)))) continue;
    let ok = true; const rk: number[] = [];
    for (let t = 0; t < ring.length && ok; t++) { const a = ring[t], b = ring[(t + 1) % ring.length]; const P = pairOf(el[a], el[b]);
      if (!P || dist(s, a, b) > P.amax) ok = false; else rk.push(bondBetween(c, a, b)) }
    if (!ok || !flatEnough(s, ring)) continue;
    const hasN = ring.some(i => el[i] === 'N');
    for (const i of ring) { flat.add(i); (ring.length === 5 ? flat5 : six).add(i); if (hasN) flatN.add(i) } for (const b of rk) flatBond.add(b);
  }
  // a ring nitrogen beside a ring carbon that holds a terminal oxygen as short as a carbonyl's (a lactam, guanine's N1)
  const lactam = (i: number) => inRing.has(i) && around(i).some(cA => inRing.has(cA) && el[cA] === 'C' && around(cA).some(o => el[o] === 'O' && D(o) === 1 && dist(s, cA, o) <= 1.30));
  // triple bonds: short and straight (a nitrile C≡N, an alkyne C≡C)
  for (const b of bonds) { const [i, j, k] = b; const P = pairOf(el[i], el[j]); if (!P?.tmax || len(b) > P.tmax) continue;
    if ((D(i) === 1 || straight(i)) && (D(j) === 1 || straight(j)) && (D(i) === 2 || D(j) === 2)) set(k, 3, i, j) }
  // a straight atom between two short bonds: two double bonds (CO2, an azide, an isothiocyanate, an allene)
  for (const i of heavy) { if (used.has(i) || !straight(i)) continue; const qs = nbr.get(i)!;
    const two = qs.filter(q => { const j = g.to[q]; const P = pairOf(el[i], el[j]); return inG.has(j) && !used.has(j) && P && P.dmax && dist(s, i, j) <= P.dmax });
    if (two.length === 2) { for (const q of two) set(g.bond[q], 2, g.to[q]); used.add(i) } }
  // a phosphate's P=O; a sulphate's, sulphonate's, sulphone's or sulphonamide's two S=O; a sulphoxide's S=O
  for (const i of heavy) {
    if (el[i] === 'P') { const o = phosphoryl(c, i); if (o >= 0) used.add(o), used.add(i) }
    else if (el[i] === 'S' && D(i) >= 3) { const free = byName(s, i, nbr.get(i)!.filter(q => { const j = g.to[q]; return el[j] === 'O' && D(j) === 1 && dist(s, i, j) <= 1.55 }).map(q => [g.to[q], g.bond[q]] as [number, number]));
      const n = D(i) === 4 ? Math.min(2, free.length) : free.length === 1 ? 1 : 0;
      for (let t = 0; t < n; t++) set(free[t][1], 2, free[t][0]); if (n) used.add(i) }
  }
  // what may hold a double bond, and how much it wants one: a planar carbon must (unless it has nothing to share it with);
  // a terminal oxygen or sulphur on a planar centre is a carbonyl's or thione's; a nitrogen with two neighbours is a
  // pyridine's or an imine's, or an NH in a ring that cannot pair it: in a five-membered ring it is as often a pyrrole's
  // NH as not, and takes a double bond only when a carbon needs it (an imidazole's, a purine's, half a porphyrin's), and
  // beside a ring's carbonyl it is a lactam's NH (guanine's N1) unless nothing else will do; one with three only if it
  // must (a pyridinium, a guanidinium), and never in a five-membered ring, where it is a pyrrole's N with a substituent (a
  // purine's N9); a terminal nitrogen is an amidine's or guanidine's
  const want = new Map<number, number>();
  for (const i of heavy) { if (used.has(i)) continue; const e = el[i], d = D(i), f = flat.has(i);
    if (e === 'C') { if (d === 3 ? f || planar(i) : d === 2 ? f || (!groupH && bent(i) >= 115 && bent(i) < 160) : d === 1 && !groupH) want.set(i, 10) }
    else if (e === 'N') { if (d === 1) want.set(i, 4.5);
      else if (d === 2 && (f || bent(i) >= 114)) want.set(i, flat5.has(i) && !six.has(i) ? -3 : lactam(i) ? 1 : 4);
      else if (d === 3 && (f || planar(i))) want.set(i, ring5.has(i) ? -10 : -2) }
    else if (e === 'O') { if (d === 1) want.set(i, 6) }
    else if (e === 'S') { if (d === 1) want.set(i, 5) } }
  const nodes = [...want.keys()]; const loc = new Map(nodes.map((a, k) => [a, k]));
  // outside flat rings, a bond between two atoms that are not terminal is double only where it is clearly the shortest of
  // its conjugated run: the bonds its atoms make to others that could hold a double bond are longer by a clear margin (a
  // polyene refined to even lengths, or a cyclohexene whose C=C the refinement smeared over three bonds, gets none)
  const short = (i: number, j: number) => { const P = pairOf(el[i], el[j]); return P ? (P.one - dist(s, i, j)) / (P.one - P.two) : -1 };
  const clear = (i: number, j: number) => { const sij = short(i, j);
    for (const [a, b] of [[i, j], [j, i]]) for (const x of around(a)) if (x !== b && want.has(x) && D(x) >= 2 && short(a, x) > sij - 0.2) return false;
    return true };
  const edges: Edge[] = [];
  for (const b of bonds) { const [i, j, k] = b; if (!want.has(i) || !want.has(j) || orders[k] > 1) continue;
    // an amine on a ring stays one (adenine's N6, cytosine's N4, an aniline's NH2): no double bond from a ring atom to a
    // nitrogen outside the ring
    if ((inRing.has(i) && !inRing.has(j) && el[j] === 'N') || (inRing.has(j) && !inRing.has(i) && el[i] === 'N')) continue;
    const P = pairOf(el[i], el[j]); if (!P) continue; const L = len(b), ring = flatBond.has(k);
    // outside a flat ring, only a bond as short as a double bond; the carbonyl of a flat ring with a nitrogen in it (a
    // lactam, a pyrimidinone, guanine) a little longer, as such rings hold one, and refinements often leave it long
    if (!ring && L > ((el[i] + el[j] === 'CO' || el[i] + el[j] === 'OC') && (flatN.has(i) || flatN.has(j)) ? 1.38 : P.dmax)) continue;
    if (!ring && D(i) >= 2 && D(j) >= 2 && !flat.has(i) && !flat.has(j) && !clear(i, j)) continue;
    const sh = Math.max(-0.5, Math.min(1.3, (P.one - L) / (P.one - P.two)));
    edges.push([loc.get(i)!, loc.get(j)!, 6 * sh, k]) }
  if (!edges.length) return;
  const R = Float64Array.from(nodes.map(a => want.get(a)!));
  const mate = bestMatching(nodes.length, R, edges);
  for (const e of edges) if (mate[e[0]] === e[1]) orders[e[3]] = 2;
}

function bondBetween(c: Ctx, a: number, b: number) { const g = c.g; for (let q = g.start[a]; q < g.start[a + 1]; q++) if (g.to[q] === b) return g.bond[q]; return -1 }
/** the smallest ring through the bond u–v, as its atoms in order round it (up to `maxLen` atoms), or null */
function shortestRing(adj: Map<number, number[]>, u: number, v: number, maxLen: number): number[] | null {
  const prev = new Map<number, number>([[u, -1]]); let front = [u];
  for (let depth = 1; depth < maxLen && front.length; depth++) { const next: number[] = [];
    for (const a of front) for (const b of adj.get(a) || []) { if (a === u && b === v) continue; if (prev.has(b)) continue; prev.set(b, a);
      if (b === v) { const path = [v]; let x = a; while (x !== -1) { path.push(x); x = prev.get(x)! } return path.reverse() } next.push(b) }
    front = next }
  return null;
}
/** whether a ring's atoms lie in one plane (within a tenth of an ångström and a little) */
function flatEnough(s: Structure, ring: number[]) {
  const n = ring.length; let cx = 0, cy = 0, cz = 0; for (const i of ring) { cx += s.x[i]; cy += s.y[i]; cz += s.z[i] } cx /= n; cy /= n; cz /= n;
  let nx = 0, ny = 0, nz = 0;   // Newell's normal
  for (let t = 0; t < n; t++) { const a = ring[t], b = ring[(t + 1) % n]; const ax = s.x[a] - cx, ay = s.y[a] - cy, az = s.z[a] - cz, bx = s.x[b] - cx, by = s.y[b] - cy, bz = s.z[b] - cz;
    nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx }
  const L = Math.hypot(nx, ny, nz); if (L < 1e-6) return false;
  for (const i of ring) if (Math.abs(((s.x[i] - cx) * nx + (s.y[i] - cy) * ny + (s.z[i] - cz) * nz) / L) > 0.12) return false;
  return true;
}

/** the matching of a small graph that scores best: each node in at most one pair, a pair worth its two nodes' wants and
    its edge's weight, an unpaired node nothing. Searched exactly (branch and bound, most constrained node first) in each
    connected part; a part too large to finish keeps the best found, the first of which is the greedy one. */
function bestMatching(n: number, R: Float64Array, edges: Edge[]): Int32Array {
  const mate = new Int32Array(n).fill(-1); const adj: [number, number][][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < edges.length; t++) { const [u, v, w] = edges[t]; adj[u].push([v, w]); adj[v].push([u, w]) }
  for (const a of adj) a.sort((p, q) => (R[q[0]] + q[1]) - (R[p[0]] + p[1]));
  const half = new Float64Array(n); for (let u = 0; u < n; u++) for (const [v, w] of adj[u]) half[u] = Math.max(half[u], (R[u] + R[v] + w) / 2);
  const comp = new Int32Array(n).fill(-1); let nc = 0;
  for (let u = 0; u < n; u++) { if (comp[u] >= 0 || !adj[u].length) continue; const st = [u]; comp[u] = nc;
    while (st.length) { const a = st.pop()!; for (const [b] of adj[a]) if (comp[b] < 0) { comp[b] = nc; st.push(b) } } nc++ }
  const state = new Int32Array(n).fill(-2);   // -2 open, -1 unpaired, else the partner
  for (let k = 0; k < nc; k++) {
    const part: number[] = []; for (let u = 0; u < n; u++) if (comp[u] === k) part.push(u);
    let best = -Infinity, bestState: Int32Array | null = null, steps = 0; let bound = 0; for (const u of part) bound += half[u];
    const rec = (cur: number, bnd: number) => {
      if (++steps > 200000 && bestState) return;
      if (cur + bnd <= best + 1e-9) return;
      let u = -1, fewest = Infinity;
      for (const a of part) { if (state[a] !== -2) continue; let f = 0; for (const [b] of adj[a]) if (state[b] === -2) f++; if (f < fewest) { fewest = f; u = a; if (!f) break } }
      if (u < 0) { if (cur > best) { best = cur; bestState = state.slice() } return }
      for (const [v, w] of adj[u]) { if (state[v] !== -2) continue; state[u] = v; state[v] = u; rec(cur + R[u] + R[v] + w, bnd - half[u] - half[v]); state[u] = state[v] = -2 }
      state[u] = -1; rec(cur, bnd - half[u]); state[u] = -2;
    };
    rec(0, bound);
    if (bestState) for (const u of part) { const p = (bestState as Int32Array)[u]; mate[u] = p >= 0 ? p : -1 }
  }
  return mate;
}
