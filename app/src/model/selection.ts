/* PyMOL-flavoured selection language → per-atom mask.
   all none polymer hetatm water protein nucleic backbone sidechain hydro
   resi 10-20+35  resn SER+HIS  name CA  chain A+B  elem C  ss H+E  subunit S+L  entity 1
   and / or / not / parentheses */
import { Structure, BACKBONE } from './structure';

type Pred = (s: Structure, i: number) => boolean;

const cache = new Map<string, Pred>();

export function compileSelection(str: string): Pred {
  str = (str || '').trim();
  const hit = cache.get(str); if (hit) return hit;
  const toks = str.match(/\(|\)|[^\s()]+/g) || []; let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const listArg = () => { const t = next(); return t === undefined ? [] : t.split('+') };
  const R = (s: Structure, a: number) => s.residues[s.residueOf[a]];
  function factor(): Pred {
    const t = next(); if (t === undefined) return () => false; const tl = t.toLowerCase();
    if (tl === '(') { const e = expr(); if (peek() === ')') next(); return e }
    if (tl === 'not' || tl === '!') { const f = factor(); return (s, a) => !f(s, a) }
    switch (tl) {
      case 'all': case '*': return () => true;
      case 'none': return () => false;
      case 'hetatm': case 'het': return (s, a) => s.het[a] === 1;
      case 'polymer': case 'poly': return (s, a) => s.het[a] === 0;
      case 'backbone': case 'bb': return (s, a) => BACKBONE.has(s.atomName[a]);
      case 'sidechain': case 'sc': return (s, a) => s.het[a] === 0 && !BACKBONE.has(s.atomName[a]);
      case 'hydro': case 'h.': case 'hydrogens': return (s, a) => s.element[a] === 'H';
      case 'nucleic': case 'na': return (s, a) => R(s, a).nucleic;
      case 'protein': case 'prot': return (s, a) => { const r = R(s, a); return !r.het && !r.nucleic };
      case 'water': case 'solvent': return (s, a) => { const n = R(s, a).resn; return n === 'HOH' || n === 'WAT' };
      case 'subunit': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(R(s, a).subunit) }
      case 'entity': { const S = new Set(listArg()); return (s, a) => S.has(R(s, a).entity) }
      case 'resi': case 'i.': { const ranges = listArg().map(v => { const m = v.match(/^(-?\d+)(?:-(-?\d+))?$/); return m ? [+m[1], m[2] !== undefined ? +m[2] : +m[1]] : null }).filter(Boolean) as number[][]; return (s, a) => { const r = R(s, a).resi; return ranges.some(([lo, hi]) => r >= lo && r <= hi) } }
      case 'resn': case 'r.': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(R(s, a).resn.toUpperCase()) }
      case 'name': case 'n.': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(s.atomName[a].toUpperCase()) }
      case 'chain': case 'c.': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(R(s, a).chain.toUpperCase()) }
      case 'elem': case 'e.': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(s.element[a]) }
      case 'ss': { const S = new Set(listArg().map(v => v.toUpperCase())); return (s, a) => S.has(R(s, a).ss) }
      default: return () => false;
    }
  }
  function term(): Pred { let f = factor(); while (peek() && (peek().toLowerCase() === 'and' || peek() === '&')) { next(); const g = factor(), f0 = f; f = (s, a) => f0(s, a) && g(s, a) } return f }
  function expr(): Pred { let f = term(); while (peek() && (peek().toLowerCase() === 'or' || peek() === '|')) { next(); const g = term(), f0 = f; f = (s, a) => f0(s, a) || g(s, a) } return f }
  const f: Pred = str ? expr() : () => false;
  cache.set(str, f); return f;
}

export function selectAtoms(s: Structure, sel: string): Uint8Array {
  const f = compileSelection(sel); const m = new Uint8Array(s.count);
  for (let i = 0; i < s.count; i++) m[i] = f(s, i) ? 1 : 0;
  return m;
}
