/* A lint pass over a scene: what is probably a mistake, and what will happen that you might not expect. Run on load
   and after edits; the messages are per keyframe, worst first. Nothing here changes the scene. */
export interface LintItem { level: 'error' | 'warn' | 'note'; kf: number | null; text: string }

const COV: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39, SE: 1.2, ZN: 1.22, MG: 1.41, CA: 1.76, FE: 1.32, NA: 1.66, K: 2.03 };
const norm = (b: any) => Array.isArray(b) ? { a: b[0], b: b[1], order: b[2] ?? 1 } : { a: b.a, b: b.b, order: b.order ?? 1 };
const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const bkey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a;
const groupOf = (id: string, a: any) => a.group || ((a.resn || '') + (a.resi ?? '')) || id.split(':')[0];

export function lintScene(doc: { keyframes: any[] }): LintItem[] {
  const out: LintItem[] = []; const K = doc.keyframes || []; const n = K.length;
  if (!n) return [{ level: 'error', kf: null, text: 'no keyframes' }];
  const push = (level: LintItem['level'], kf: number | null, text: string) => out.push({ level, kf, text });
  K.forEach((k, i) => {
    const atoms = k.atoms || {}; const ids = Object.keys(atoms);
    if (!ids.length) { push('error', i, 'no atoms'); return }
    if (!k.name) push('note', i, 'no name (the step label will say "step ' + (i + 1) + '")');
    // bonds: existence, duplicates, length
    const deg: Record<string, number> = {}; const seen = new Set<string>(); const bonds = (k.bonds || []).map(norm);
    for (const b of bonds) {
      if (!atoms[b.a] || !atoms[b.b]) { push('error', i, `bond ${b.a}–${b.b} names an atom that is not in this keyframe`); continue }
      const key = bkey(b.a, b.b); if (seen.has(key)) push('warn', i, `bond ${b.a}–${b.b} is listed twice`); seen.add(key);
      if (b.order === 0) continue;   // a hydrogen bond
      deg[b.a] = (deg[b.a] || 0) + 1; deg[b.b] = (deg[b.b] || 0) + 1;
      const A = atoms[b.a], B = atoms[b.b]; const d = dist(A.pos, B.pos);
      const ea = String(A.el || 'C').toUpperCase(), eb = String(B.el || 'C').toUpperCase(); const lim = ((COV[ea] ?? 0.9) + (COV[eb] ?? 0.9)) * 1.35 + 0.15;
      if (d > lim) push('warn', i, `bond ${b.a}–${b.b} is ${d.toFixed(2)} Å long (a ${ea}–${eb} bond is under ${lim.toFixed(2)}): a wrong pair, or a bond meant to be breaking?`);
      if (d < 0.6) push('warn', i, `bond ${b.a}–${b.b} is ${d.toFixed(2)} Å: two atoms on top of each other`);
    }
    // atoms without bonds (a lone ion or a water oxygen without hydrogens are fine; a carbon is not)
    for (const id of ids) if (!deg[id]) { const el = String(atoms[id].el || 'C').toUpperCase(); if (el === 'C' || el === 'N' || el === 'H') push('warn', i, `${id} (${el}) has no bond`) }
    // arrows: anchors must exist; a lone-pair tail needs a lone pair
    (k.arrows || []).forEach((ar: any, j: number) => {
      for (const end of ['from', 'to'] as const) {
        const an = ar[end]; if (!an) { push('error', i, `arrow ${j + 1} has no ${end}`); continue }
        if (an.atom && !atoms[an.atom]) push('error', i, `arrow ${j + 1} ${end}: atom ${an.atom} is not in this keyframe`);
        if (an.bond) { if (!atoms[an.bond[0]] || !atoms[an.bond[1]]) push('error', i, `arrow ${j + 1} ${end}: bond ${an.bond[0]}–${an.bond[1]} names an atom that is not in this keyframe`); else if (!seen.has(bkey(an.bond[0], an.bond[1]))) push('warn', i, `arrow ${j + 1} ${end}: ${an.bond[0]}–${an.bond[1]} is not a bond of this keyframe (the anchor still draws, at the midpoint)`) }
        if (an.lp) { const a = atoms[an.lp]; if (!a) push('error', i, `arrow ${j + 1} ${end}: atom ${an.lp} is not in this keyframe`); else if (!a.lp || !a.lp.length) push('error', i, `arrow ${j + 1} starts at a lone pair of ${an.lp}, which has none (the arrow is not drawn)`); else if ((an.i || 0) >= a.lp.length) push('warn', i, `arrow ${j + 1}: ${an.lp} has ${a.lp.length} lone pair(s), the arrow asks for #${an.i + 1}`) }
      }
      if (!ar.from?.lp && !ar.from?.bond && ar.from?.atom) push('note', i, `arrow ${j + 1} starts at atom ${ar.from.atom} itself; curly arrows usually start at a lone pair or a bond`);
    });
    // charges: an atom carrying a charge with no lone pair drawn and no arrow touching it is often a display choice, sometimes an oversight
    const touched = new Set<string>(); for (const ar of (k.arrows || [])) for (const end of ['from', 'to']) { const an = ar[end] || {}; if (an.atom) touched.add(an.atom); if (an.lp) touched.add(an.lp); if (an.bond) { touched.add(an.bond[0]); touched.add(an.bond[1]) } }
    for (const id of ids) { const a = atoms[id]; if (a.charge && !(a.lp && a.lp.length) && !touched.has(id)) push('note', i, `${id} carries ${a.charge > 0 ? '+' : ''}${a.charge} with no lone pair and no arrow: drawn as a bare charge`) }
    // the match to the next keyframe: what exits, what enters, and whether that is intended
    if (n > 1 || (k.transition ?? 48) > 0) {
      const j = (i + 1) % n; const Kj = K[j]; const next = Kj.atoms || {};
      const leave = new Set<string>(k.leave || []); const alias = k.asNext || {};
      const leaving = (id: string) => leave.size > 0 && (leave.has(id) || (alias[id] === undefined && leave.has(groupOf(id, atoms[id]))));
      for (const id in alias) { if (!atoms[id]) push('error', i, `asNext: ${id} is not in this keyframe`); if (!next[alias[id]]) push('error', i, `asNext: ${id} → ${alias[id]}, which is not in keyframe ${j + 1}`) }
      for (const g of leave) { const any = ids.some(id => id === g || groupOf(id, atoms[id]) === g); if (!any) push('warn', i, `leave: no atom or group named ${g} in this keyframe`) }
      const gone: string[] = [], fresh: string[] = []; const matched = new Set<string>();
      for (const id of ids) { if (leaving(id)) continue; const m = alias[id] ?? id; if (next[m]) matched.add(m); else gone.push(id) }
      for (const id in next) if (!matched.has(id)) fresh.push(id);
      const closing = leave.size > 0;   // a cycle closing with molecules exchanged: what enters is expected
      if (gone.length && j !== i) push(gone.length > 6 && !closing ? 'warn' : 'note', i, `${gone.length} atom(s) fade out on the way to keyframe ${j + 1} (in neither keyframe ${j + 1} nor leave${k.exitDir ? '; they drift along exitDir' : ''}): ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? '…' : ''}`);
      if (fresh.length && j !== i) push(fresh.length > 6 && !closing ? 'warn' : 'note', i, `${fresh.length} atom(s) enter at keyframe ${j + 1}${closing ? ' as the cycle closes' : ''}: ${fresh.slice(0, 6).join(', ')}${fresh.length > 6 ? '…' : ''}`);
      if (i === n - 1 && n > 1 && (k.transition ?? 48) > 0 && !leave.size && gone.length === 0) {
        // a loop that morphs back to the start: fine for a cycle of the same atoms, wrong when products should leave
        const moved = ids.filter(id => next[id] && dist(atoms[id].pos, next[id].pos) > 3).length;
        if (moved > 3) push('note', i, `the loop closes by morphing: ${moved} atoms travel more than 3 Å back to keyframe 1. If products should leave and a substrate enter, list them in leave (see scene-format.md)`);
      }
      // paths: every pose should name atoms of this keyframe
      if (k.path && k.path.length) { const bad = new Set<string>(); for (const pose of k.path) for (const id in pose) if (!atoms[id] && !next[id]) bad.add(id); if (bad.size) push('warn', i, `path names ${bad.size} id(s) in neither this keyframe nor the next: ${[...bad].slice(0, 4).join(', ')}`) }
    }
    if ((k.hold ?? 24) === 0 && (k.transition ?? 48) === 0) push('warn', i, 'hold and transition are both 0: this keyframe takes no time');
  });
  const order = { error: 0, warn: 1, note: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.kf ?? -1) - (b.kf ?? -1));
}

export function lintSummary(items: LintItem[]): string {
  const c = { error: 0, warn: 0, note: 0 }; for (const it of items) c[it.level]++;
  if (!items.length) return 'checks: nothing to report';
  return `checks: ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warn} warning${c.warn === 1 ? '' : 's'}, ${c.note} note${c.note === 1 ? '' : 's'}`;
}
