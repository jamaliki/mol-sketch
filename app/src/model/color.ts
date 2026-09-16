/* Colour schemes → per-atom and per-residue RGB. No blues or reds in the automatic palettes: those belong to N and O. */
import { Structure, type Residue } from './structure';
import { type Style, hexToRgb } from '../style';

export const GROUP_PALETTE = ['#f2e85a', '#7cbf72', '#5fc9c9', '#a98ad6', '#f0a050', '#d9a3c9', '#8fb8a8', '#b5c95a', '#c9a27a', '#9ad0b8'];
export const SUBUNIT_COLS: Record<string, string> = { S: '#9cc27a', L: '#e6a45a', T: '#c96d8a', X: '#b8b4a8' };

/** Element class for the stylisation pass: 0 none, 1 C, 2 N, 3 O, 4 S, 5 P, 6 H, 7 other. */
export function elementClass(el: string): number {
  switch (el) { case 'C': return 1; case 'N': return 2; case 'O': return 3; case 'S': return 4; case 'P': return 5; case 'H': return 6; default: return 7 }
}

export class ColorScheme {
  private chainIdx = new Map<string, number>();
  private entityIdx = new Map<string, number>();
  constructor(private s: Structure, private style: Style, private overrides: Record<string, string> = {}) {
    for (const ch of s.chains) { if (!this.chainIdx.has(ch.id)) this.chainIdx.set(ch.id, this.chainIdx.size); const e = ch.entity || 'chain:' + ch.id; if (!this.entityIdx.has(e)) this.entityIdx.set(e, this.entityIdx.size) }
  }
  private auto(i: number) { return GROUP_PALETTE[i % GROUP_PALETTE.length] }
  /** Colour of a residue under the carbon scheme (colorBy). */
  residueCarbon(r: Residue): string {
    const o = this.overrides; const P = this.style.palette;
    const key = r.resn + r.resi + (r.chain ? '.' + r.chain : '');
    if (o[key]) return o[key];
    switch (this.style.colorBy) {
      case 'element': return P.C;
      case 'chain': return o[r.chain] ?? this.auto(this.chainIdx.get(r.chain) ?? 0);
      case 'subunit': return o['subunit:' + r.subunit] ?? SUBUNIT_COLS[r.subunit] ?? SUBUNIT_COLS.X;
      case 'entity': { const e = r.entity || 'chain:' + r.chain; return o['entity:' + e] ?? this.auto(this.entityIdx.get(e) ?? 0) }
      default: return this.auto(r.index);
    }
  }
  atom(i: number): string {
    const el = this.s.element[i]; const P = this.style.palette;
    if (el === 'C') return this.residueCarbon(this.s.residues[this.s.residueOf[i]]);
    return (P as any)[el] ?? P.X;
  }
  cartoon(r: Residue): string {
    const P = this.style.palette;
    if (this.style.cartoonColor === 'carbon') return this.residueCarbon(r);
    if (r.nucleic) return P.nucleic;
    return r.ss === 'H' ? P.helix : r.ss === 'E' ? P.sheet : P.loop;
  }
  surface(r: Residue): string {
    const o = this.overrides; const P = this.style.palette;
    switch (this.style.surfaceColor) {
      case 'single': return P.surface;
      case 'chain': return o[r.chain] ?? this.auto(this.chainIdx.get(r.chain) ?? 0);
      case 'subunit': return o['subunit:' + r.subunit] ?? SUBUNIT_COLS[r.subunit] ?? SUBUNIT_COLS.X;
      case 'entity': { const e = r.entity || 'chain:' + r.chain; return o['entity:' + e] ?? this.auto(this.entityIdx.get(e) ?? 0) }
      default: return this.residueCarbon(r);
    }
  }
}

export function rgb255(hex: string): [number, number, number] { const [r, g, b] = hexToRgb(hex); return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] }
