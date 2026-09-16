/* Structure: atoms in typed arrays plus residue / chain bookkeeping.
   Everything downstream (selections, colours, geometry) indexes into these arrays. */

export const COV_R: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39, SE: 1.2, ZN: 1.22, MG: 1.41, CA: 1.76, FE: 1.32, NA: 1.66, K: 2.03 };
export const VDW_R: Record<string, number> = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98, ZN: 1.39, MG: 1.73, CA: 2.0, FE: 1.5, NA: 2.27, K: 2.75 };

export const NUCLEIC_RESN = new Set(['A', 'C', 'G', 'U', 'I', 'DA', 'DC', 'DG', 'DT', 'DI', 'N', 'PSU', '5MC', '7MG', 'OMG', 'OMC', '1MA', '2MG', 'M2G', '4SU', 'H2U', '5MU', 'YG', 'UR3', 'MA6', '6MZ', 'A2M', 'CM0', 'G7M', 'QUO']);
export const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT']);

export type SS = 'H' | 'E' | 'L' | 'N';
export type Subunit = 'S' | 'L' | 'T' | 'X';

export interface Residue {
  index: number;
  chain: string;
  resi: number;
  resn: string;
  atomStart: number;  // atoms are stored contiguously per residue
  atomEnd: number;    // exclusive
  het: boolean;
  nucleic: boolean;
  trace: number;      // atom index of CA / P (-1 if none)
  ss: SS;
  entity: string;
  subunit: Subunit;
  /** carbonyl O (protein) for ribbon orientation, or C1' for nucleotides */
  orient: number;
}

export interface Chain { id: string; residues: number[]; entity: string; subunit: Subunit }

export interface SSRecord { chain: string; a: number; b: number }

export class Structure {
  name = '';
  count = 0;
  x!: Float32Array; y!: Float32Array; z!: Float32Array;
  element: string[] = [];
  atomName: string[] = [];
  residueOf!: Int32Array;      // atom → residue index
  het!: Uint8Array;
  residues: Residue[] = [];
  chains: Chain[] = [];
  bonds: Int32Array = new Int32Array(0);   // pairs
  entities: Record<string, { desc: string }> = {};
  center: [number, number, number] = [0, 0, 0];
  radius = 1;

  static fromRecords(recs: AtomRecord[], ss: { H: SSRecord[]; E: SSRecord[] }, entities: Record<string, { desc: string }>, chainEntity: Record<string, string>): Structure {
    const s = new Structure();
    // group into residues in file order (a residue is contiguous in well-formed files; we regroup anyway)
    const key = (r: AtomRecord) => r.chain + '/' + r.resi + '/' + r.resn + '/' + (r.het ? 1 : 0);
    const order = new Map<string, AtomRecord[]>();
    for (const r of recs) { let g = order.get(key(r)); if (!g) { g = []; order.set(key(r), g) } g.push(r) }
    const n = recs.length; s.count = n;
    s.x = new Float32Array(n); s.y = new Float32Array(n); s.z = new Float32Array(n);
    s.residueOf = new Int32Array(n); s.het = new Uint8Array(n);
    let ai = 0;
    const subunitOf = (d: string): Subunit => {
      if (/\b(30S|16S|18S|40S|small)\b/i.test(d)) return 'S';
      if (/\b(50S|23S|28S|25S|5\.8S|5S|60S|large)\b/i.test(d)) return 'L';
      if (/tRNA|mRNA/i.test(d)) return 'T';
      return 'X';
    };
    const chainMap = new Map<string, Chain>();
    for (const [, g] of order) {
      const first = g[0];
      const names = new Set(g.map(a => a.name));
      const nucleic = !first.het && (names.has("O3'") || names.has("C4'") || NUCLEIC_RESN.has(first.resn)) && !names.has('CA');
      const ri = s.residues.length;
      const res: Residue = { index: ri, chain: first.chain, resi: first.resi, resn: first.resn, atomStart: ai, atomEnd: ai + g.length, het: first.het, nucleic, trace: -1, ss: nucleic ? 'N' : 'L', entity: chainEntity[first.chain] ?? '', subunit: 'X', orient: -1 };
      res.subunit = res.entity && entities[res.entity] ? subunitOf(entities[res.entity].desc) : 'X';
      for (const a of g) {
        s.x[ai] = a.x; s.y[ai] = a.y; s.z[ai] = a.z; s.element.push(a.el); s.atomName.push(a.name); s.residueOf[ai] = ri; s.het[ai] = a.het ? 1 : 0;
        if (nucleic) { if (a.name === 'P') res.trace = ai; else if (res.trace < 0 && a.name === "C4'") res.trace = ai; if (a.name === "C1'") res.orient = ai }
        else { if (a.name === 'CA') res.trace = ai; if (a.name === 'O') res.orient = ai }
        ai++;
      }
      if (res.trace < 0 && !first.het && g.length > 0) res.trace = res.atomStart;
      s.residues.push(res);
      let ch = chainMap.get(first.chain);
      if (!ch) { ch = { id: first.chain, residues: [], entity: res.entity, subunit: res.subunit }; chainMap.set(first.chain, ch); s.chains.push(ch) }
      ch.residues.push(ri);
    }
    s.entities = entities;
    s.assignSS(ss);
    s.computeBounds();
    return s;
  }

  computeBounds() {
    const n = this.count; if (!n) return;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += this.x[i]; cy += this.y[i]; cz += this.z[i] }
    cx /= n; cy /= n; cz /= n; this.center = [cx, cy, cz];
    let r2 = 0;
    for (let i = 0; i < n; i++) { const dx = this.x[i] - cx, dy = this.y[i] - cy, dz = this.z[i] - cz; const d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d }
    this.radius = Math.sqrt(r2) + 2;
  }

  /** Secondary structure from HELIX/SHEET style records when present, else from Cα geometry (P-SEA-like). */
  assignSS(rec: { H: SSRecord[]; E: SSRecord[] }) {
    const protein = this.residues.filter(r => !r.het && !r.nucleic);
    if (rec.H.length || rec.E.length) {
      const byKey = new Map<string, Residue>();
      for (const r of protein) { r.ss = 'L'; byKey.set(r.chain + '/' + r.resi, r) }
      for (const h of rec.H) for (let i = h.a; i <= h.b; i++) { const r = byKey.get(h.chain + '/' + i); if (r) r.ss = 'H' }
      for (const e of rec.E) for (let i = e.a; i <= e.b; i++) { const r = byKey.get(e.chain + '/' + i); if (r) r.ss = 'E' }
      return;
    }
    const X = this.x, Y = this.y, Z = this.z;
    const pos = (r: Residue) => r.trace;
    for (const ch of this.chains) {
      const A = ch.residues.map(i => this.residues[i]).filter(r => !r.het && !r.nucleic && r.trace >= 0);
      const n = A.length; if (n < 5) continue;
      const P = A.map(r => pos(r));
      const d = (i: number, j: number) => (i < 0 || j < 0 || i >= n || j >= n) ? NaN : Math.hypot(X[P[i]] - X[P[j]], Y[P[i]] - Y[P[j]], Z[P[i]] - Z[P[j]]);
      const vec = (i: number, j: number) => [X[P[j]] - X[P[i]], Y[P[j]] - Y[P[i]], Z[P[j]] - Z[P[i]]];
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]) || 1;
      const ang = (i: number) => { const u = vec(i, i - 1), v = vec(i, i + 1); return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v))))) * 180 / Math.PI };
      const dih = (i: number) => { const b1 = vec(i - 1, i), b2 = vec(i, i + 1), b3 = vec(i + 1, i + 2); const n1 = cross(b1, b2), n2 = cross(b2, b3); const b2n = b2.map(v => v / len(b2)); const m = cross(n1, b2n); return Math.atan2(dot(m, n2), dot(n1, n2)) * 180 / Math.PI };
      const within = (x: number, c: number, w: number) => Math.abs(x - c) <= w;
      const ss: SS[] = new Array(n).fill('L');
      for (let i = 1; i < n - 1; i++) {
        const d2 = d(i - 1, i + 1), d3 = d(i - 1, i + 2), d4 = d(i - 1, i + 3); const tau = ang(i); const al = i + 2 < n ? dih(i) : NaN;
        const helixD = within(d2, 5.5, 0.5) && within(d3, 5.3, 0.5) && within(d4, 6.4, 0.6); const helixA = within(tau, 89, 12) && within(al, 50, 20);
        const strandD = within(d2, 6.7, 0.6) && within(d3, 9.9, 0.9) && within(d4, 12.4, 1.1); const strandA = within(tau, 124, 14) && Math.abs(al) >= 125;
        if (helixD || helixA) ss[i] = 'H'; else if (strandD || strandA) ss[i] = 'E';
      }
      for (let i = 1; i < n - 1; i++) if (ss[i] === 'L' && ss[i - 1] === ss[i + 1] && ss[i - 1] !== 'L') ss[i] = ss[i - 1];
      for (const [type, min] of [['H', 4], ['E', 3]] as [SS, number][]) { let i = 0; while (i < n) { if (ss[i] !== type) { i++; continue } let j = i; while (j < n && ss[j] === type) j++; if (j - i < min) for (let k = i; k < j; k++) ss[k] = 'L'; i = j } }
      const ext = ss.slice(); for (let i = 0; i < n; i++) if (ss[i] === 'H') { if (i > 0 && ss[i - 1] === 'L') ext[i - 1] = 'H'; if (i < n - 1 && ss[i + 1] === 'L') ext[i + 1] = 'H' }
      A.forEach((r, i) => r.ss = ext[i]);
    }
  }

  /** Bonds by covalent distance on a 2.2 Å grid; linear in atom count. */
  inferBonds() {
    const n = this.count; const cell = 2.2; const X = this.x, Y = this.y, Z = this.z; const el = this.element;
    const grid = new Map<number, number[]>();
    const K = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    for (let i = 0; i < n; i++) { const k = K(Math.floor(X[i] / cell), Math.floor(Y[i] / cell), Math.floor(Z[i] / cell)); let g = grid.get(k); if (!g) { g = []; grid.set(k, g) } g.push(i) }
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(X[i] / cell), gy = Math.floor(Y[i] / cell), gz = Math.floor(Z[i] / cell); const ri = COV_R[el[i]] ?? 0.76;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const g = grid.get(K(gx + dx, gy + dy, gz + dz)); if (!g) continue;
        for (const j of g) { if (j <= i) continue; if (el[i] === 'H' && el[j] === 'H') continue;
          const d = Math.hypot(X[i] - X[j], Y[i] - Y[j], Z[i] - Z[j]); const rs = ri + (COV_R[el[j]] ?? 0.76);
          if (d < rs * 1.15 && d > 0.4) out.push(i, j) }
      }
    }
    this.bonds = Int32Array.from(out);
  }
}

export interface AtomRecord { serial: number; name: string; el: string; resn: string; chain: string; resi: number; x: number; y: number; z: number; het: boolean }
