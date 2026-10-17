/* PDB and mmCIF readers → Structure. Only the first model is returned by parseStructure; parseModels gives all. */
import { Structure, COV_R, type AtomRecord, type SSRecord } from './structure';
import { assignBondOrders, type OrderHints } from './bondorder';

export function parseModels(text: string, name = ''): Structure[] {
  const hints: OrderHints = {};
  const out = (/^\s*data_/.test(text) || text.indexOf('_atom_site.') >= 0) ? parseCIF(text, hints) : parsePDB(text, hints);
  for (const s of out) { s.name = name; s.deferBonds(() => { s.inferBonds(); assignBondOrders(s, hints) }) }
  return out;
}
export function parseStructure(text: string, name = ''): Structure { const m = parseModels(text, name); if (!m.length) throw new Error('no atoms found'); return m[0] }

function elementFromName(name: string): string {
  let el = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (el.length > 1 && !(el in COV_R)) el = el[0];
  return el;
}

/* ---------------- PDB ---------------- */
function parsePDB(text: string, hints: OrderHints): Structure[] {
  const lines = text.split(/\r?\n/);
  const models: string[][] = []; let cur: string[] = []; let sawModel = false;
  const H: SSRecord[] = [], E: SSRecord[] = [];
  // CONECT: the bonded partners of an atom, four to a line (the columns after them were once hydrogen bonds); a
  // partner listed twice or three times is a double or triple bond, as many programs write them
  const conect = new Map<number, Map<number, number>>(); let multiple = false;
  for (const line of lines) {
    const rec = line.substr(0, 6).trim();
    if (rec === 'CONECT') { const a = parseInt(line.substr(6, 5)); if (isNaN(a)) continue; let m = conect.get(a); if (!m) conect.set(a, m = new Map());
      for (let c = 11; c <= 26; c += 5) { const b = parseInt(line.substr(c, 5)); if (isNaN(b)) continue; const n = (m.get(b) || 0) + 1; m.set(b, n); if (n > 1) multiple = true } }
    else if (rec === 'MODEL') { sawModel = true; cur = [] }
    else if (rec === 'ENDMDL') { models.push(cur); cur = [] }
    else if (rec === 'HELIX') H.push({ chain: line.substr(19, 1).trim(), a: parseInt(line.substr(21, 4)), b: parseInt(line.substr(33, 4)) });
    else if (rec === 'SHEET') E.push({ chain: line.substr(21, 1).trim(), a: parseInt(line.substr(22, 4)), b: parseInt(line.substr(33, 4)) });
    else cur.push(line);
  }
  if (!sawModel || cur.some(l => /^(ATOM|HETATM)/.test(l))) models.push(cur);
  if (multiple) hints.conect = conect;   // (records with no partner listed twice say nothing of orders)
  return models.filter(m => m.some(l => /^(ATOM|HETATM)/.test(l))).map(m => {
    const recs: AtomRecord[] = [];
    for (const line of m) {
      const rec = line.substr(0, 6).trim(); if (rec !== 'ATOM' && rec !== 'HETATM') continue;
      const alt = line.substr(16, 1).trim(); if (alt && alt !== 'A') continue;
      const name = line.substr(12, 4).trim(); let el = line.substr(76, 2).trim().toUpperCase(); if (!el) el = elementFromName(name);
      const resn = line.substr(17, 3).trim();
      recs.push({ serial: parseInt(line.substr(6, 5)), name, el, resn, chain: line.substr(21, 1).trim(), resi: parseInt(line.substr(22, 4)), x: parseFloat(line.substr(30, 8)), y: parseFloat(line.substr(38, 8)), z: parseFloat(line.substr(46, 8)), het: rec === 'HETATM' || resn === 'HOH', b: parseFloat(line.substr(60, 6)) });
    }
    return Structure.fromRecords(recs, { H, E }, {}, {});
  });
}

/* ---------------- mmCIF ---------------- */
/** a category: its columns and rows -- or, for the atoms, also their lines as they are (`lines`, a row to a line), which
    parseCIF reads a column at a time: a ribosome's 220,000 atoms would be 4.6 million values, most of them never used */
interface Cat { cols: string[]; rows: string[][]; lines?: string[] }
/* (by character code, not one-character strings: an mmCIF of a ribosome is 4 million values) */
function tokenize(line: string): string[] {
  const out: string[] = []; let j = 0; const n = line.length;
  while (j < n) {
    const ch = line.charCodeAt(j); if (ch === 32 || ch === 9) { j++; continue }   // space, tab
    if (ch === 39 || ch === 34) {   // ' or ": to the same quote before a space, a tab or the end
      let k = j + 1; while (k < n) { if (line.charCodeAt(k) === ch) { const c = k + 1 < n ? line.charCodeAt(k + 1) : 32; if (c === 32 || c === 9) break } k++ }
      out.push(line.substring(j + 1, k)); j = k + 1; continue }
    let k = j; while (k < n) { const c = line.charCodeAt(k); if (c === 32 || c === 9) break; k++ } out.push(line.substring(j, k)); j = k;
  }
  return out;
}
/** the values of `line` whose places `want` marks, into `out` at those places (as tokenize reads them); how many values
    the line has */
function pick(line: string, want: Uint8Array, out: string[], val: Float64Array): number {
  let j = 0, k = 0; const n = line.length;
  while (j < n) {
    const ch = line.charCodeAt(j); if (ch === 32 || ch === 9) { j++; continue }
    if (ch === 39 || ch === 34) {
      let e = j + 1; while (e < n) { if (line.charCodeAt(e) === ch) { const c = e + 1 < n ? line.charCodeAt(e + 1) : 32; if (c === 32 || c === 9) break } e++ }
      if (want[k]) { out[k] = line.substring(j + 1, e); val[k] = NaN } k++; j = e + 1; continue }
    let e = j; while (e < n) { const c = line.charCodeAt(e); if (c === 32 || c === 9) break; e++ }
    const w = want[k];
    if (w === 2) { const v = decimal(line, j, e); if (v === v) val[k] = v; else { val[k] = NaN; out[k] = line.substring(j, e) } }
    else if (w) out[k] = line.substring(j, e);
    k++; j = e;
  }
  return k;
}
/** a plain decimal (-12.345: no exponent, at most 15 digits) as JavaScript reads it, read where it is; NaN for any other
    text (read from its text instead). Its digits as a whole number, divided by a power of ten: both exact, so the one
    rounding is the division's, as correct as the reading of its text */
const TEN = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];
function decimal(line: string, j: number, e: number): number {
  let i = j, neg = false; const c0 = line.charCodeAt(i); if (c0 === 45) { neg = true; i++ } else if (c0 === 43) i++;
  let m = 0, digits = 0, frac = -1;
  for (; i < e; i++) { const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) { m = m * 10 + (c - 48); digits++; if (frac >= 0) frac++ }
    else if (c === 46 && frac < 0) frac = 0;
    else return NaN }
  if (digits === 0 || digits > 15) return NaN;
  const v = frac > 0 ? m / TEN[frac] : m;
  return neg ? -v : v;
}
/** a loop's lines (with no text fields) as its rows, a row to as many lines as it takes, as readCIF reads any loop */
function rowsOf(lines: string[], n: number): string[][] {
  const rows: string[][] = []; const buf: string[] = [];
  for (const line of lines) { const t = tokenize(line); if (!buf.length && t.length === n) { rows.push(t); continue } for (const v of t) buf.push(v); while (buf.length >= n) rows.push(buf.splice(0, n)) }
  return rows;
}
/** the text's lines, without their line ends (\n or \r\n) */
function linesOf(text: string): string[] {
  const lines = text.split('\n');   // (a split on one character is V8's fastest)
  if (text.indexOf('\r') >= 0) for (let i = 0; i < lines.length; i++) { const l = lines[i]; if (l.charCodeAt(l.length - 1) === 13) lines[i] = l.slice(0, -1) }
  return lines;
}
function readCIF(text: string): Record<string, Cat> {
  const lines = linesOf(text); const cats: Record<string, Cat> = {}; let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (line.startsWith('loop_')) {
      i++; const names: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('_')) { names.push(lines[i].trim().split(/\s+/)[0]); i++ }
      if (!names.length) continue;
      const cat = names[0].split('.')[0]; const cols = names.map(nm => nm.split('.')[1]); const rows: string[][] = []; let buf: string[] = [];
      if (cat === '_atom_site' && !cats[cat]) {   // the atoms: their lines kept as they are (a text field among them: read as any loop)
        const from = i; let plain = true;
        for (; i < lines.length; i++) { const l = lines[i]; if (l.startsWith('#') || l.startsWith('loop_') || l.startsWith('_') || l.startsWith('data_')) break; if (l.startsWith(';')) { plain = false; break } }
        if (plain) { cats[cat] = { cols, rows, lines: lines.slice(from, i) }; continue }
        i = from;
      }
      while (i < lines.length) {
        line = lines[i];
        if (line.startsWith('#') || line.startsWith('loop_') || line.startsWith('_') || line.startsWith('data_')) break;
        if (line.startsWith(';')) { let txt = line.substring(1); i++; while (i < lines.length && !lines[i].startsWith(';')) { txt += '\n' + lines[i]; i++ } buf.push(txt); i++ }
        else { const t = tokenize(line); i++; if (!buf.length && t.length === cols.length) { rows.push(t); continue } for (const v of t) buf.push(v) }   // (a row to a line, the usual: as it is)
        while (buf.length >= cols.length) rows.push(buf.splice(0, cols.length));
      }
      if (!cats[cat]) cats[cat] = { cols, rows }; else cats[cat].rows.push(...rows);
      continue;
    }
    if (line.startsWith('_')) {
      const t = tokenize(line); const [catName, col] = t[0].split('.'); let val = t.slice(1).join(' ');
      if (t.length === 1) { i++; if (i < lines.length && lines[i].startsWith(';')) { val = lines[i].substring(1); i++; while (i < lines.length && !lines[i].startsWith(';')) { val += '\n' + lines[i]; i++ } } else { val = lines[i] ? lines[i].trim() : '' } }
      if (!cats[catName]) cats[catName] = { cols: [], rows: [[]] }; cats[catName].cols.push(col); cats[catName].rows[0].push(val); i++; continue;
    }
    i++;
  }
  return cats;
}

function parseCIF(text: string, hints: OrderHints): Structure[] {
  const cats = readCIF(text); const AS = cats['_atom_site']; if (!AS) return [];
  // the components' own bonds, when the file carries them: a ligand's double bonds as its author or the CCD gives them
  const CB = cats['_chem_comp_bond'];
  if (CB) { const c = (n: string) => CB.cols.indexOf(n); const id = c('comp_id'), a1 = c('atom_id_1'), a2 = c('atom_id_2'), vo = c('value_order');
    if (id >= 0 && a1 >= 0 && a2 >= 0 && vo >= 0) { const comp = new Map<string, Map<string, number>>();
      const ORD: Record<string, number> = { SING: 1, DOUB: 2, TRIP: 3, QUAD: 3, AROM: 4 };
      for (const r of CB.rows) { const o = ORD[(r[vo] || '').toUpperCase()] ?? 1; let m = comp.get(r[id]); if (!m) comp.set(r[id], m = new Map());
        m.set(r[a1] + '|' + r[a2], o); m.set(r[a2] + '|' + r[a1], o) }
      hints.comp = comp } }
  const ci = (n: string) => AS.cols.indexOf(n);
  const ix = { grp: ci('group_PDB'), id: ci('id'), el: ci('type_symbol'), name: ci('label_atom_id'), alt: ci('label_alt_id'), resn: ci('label_comp_id'), asym: ci('label_asym_id'), auth_asym: ci('auth_asym_id'), seq: ci('label_seq_id'), auth_seq: ci('auth_seq_id'), x: ci('Cartn_x'), y: ci('Cartn_y'), z: ci('Cartn_z'), model: ci('pdbx_PDB_model_num'), b: ci('B_iso_or_equiv') };
  const models = new Map<string, AtomRecord[]>();
  // (a row's numbers: from its text, or, for a line of atoms, as read in place where pick could)
  let row: string[] = [], val: Float64Array | null = null;
  const num = (k: number) => { if (val) { const v = val[k]; if (v === v) return v } return +row[k] };
  const real = (k: number) => { if (val) { const v = val[k]; if (v === v) return v } return parseFloat(row[k]) };
  const atom = (r: string[]) => { row = r;
    const m = ix.model >= 0 ? r[ix.model] : '1'; let M = models.get(m); if (!M) { M = []; models.set(m, M) }
    const alt = ix.alt >= 0 ? r[ix.alt] : '.'; if (alt && alt !== '.' && alt !== '?' && alt !== 'A') return;
    const name = r[ix.name], resn = r[ix.resn]; const chain = (ix.auth_asym >= 0 ? r[ix.auth_asym] : r[ix.asym]) || '';
    let seqS = ix.auth_seq >= 0 ? r[ix.auth_seq] : r[ix.seq]; if (seqS === '.' || seqS === '?') seqS = ix.seq >= 0 ? r[ix.seq] : '0';
    let el = (ix.el >= 0 ? r[ix.el] : '').toUpperCase(); if (!el || el === '.' || el === '?') el = elementFromName(name);
    const het = (ix.grp >= 0 ? r[ix.grp] : 'ATOM') === 'HETATM' || resn === 'HOH';
    M.push({ serial: num(ix.id), name, el, resn, chain, resi: parseInt(seqS), x: num(ix.x), y: num(ix.y), z: num(ix.z), het, b: ix.b >= 0 ? real(ix.b) : NaN });
  };
  if (AS.lines) {   // a row to a line: only the values used are cut from each (a line otherwise: all read as any loop)
    const n = AS.cols.length, want = new Uint8Array(n), r: string[] = new Array(n).fill(''), v = new Float64Array(n).fill(NaN); let ok = true;
    for (const k of Object.values(ix)) if (k >= 0) want[k] = 1;
    for (const k of [ix.id, ix.x, ix.y, ix.z, ix.b]) if (k >= 0) want[k] = 2;   // (numbers: read in place)
    val = v;
    for (const line of AS.lines) { const got = pick(line, want, r, v); if (got === 0) continue; if (got !== n) { ok = false; break } atom(r) }
    val = null;
    if (!ok) { models.clear(); for (const row of rowsOf(AS.lines, n)) atom(row) }
  }
  for (const r of AS.rows) atom(r);
  const H: SSRecord[] = [], E: SSRecord[] = [];
  const SC = cats['_struct_conf'];
  if (SC) { const c = (n: string) => SC.cols.indexOf(n); const ty = c('conf_type_id'), ch = c('beg_auth_asym_id') >= 0 ? c('beg_auth_asym_id') : c('beg_label_asym_id'), a = c('beg_auth_seq_id') >= 0 ? c('beg_auth_seq_id') : c('beg_label_seq_id'), b = c('end_auth_seq_id') >= 0 ? c('end_auth_seq_id') : c('end_label_seq_id');
    for (const r of SC.rows) { if (ty >= 0 && !/^HELX/.test(r[ty])) continue; H.push({ chain: r[ch], a: parseInt(r[a]), b: parseInt(r[b]) }) } }
  const SR = cats['_struct_sheet_range'];
  if (SR) { const c = (n: string) => SR.cols.indexOf(n); const ch = c('beg_auth_asym_id') >= 0 ? c('beg_auth_asym_id') : c('beg_label_asym_id'), a = c('beg_auth_seq_id') >= 0 ? c('beg_auth_seq_id') : c('beg_label_seq_id'), b = c('end_auth_seq_id') >= 0 ? c('end_auth_seq_id') : c('end_label_seq_id');
    for (const r of SR.rows) E.push({ chain: r[ch], a: parseInt(r[a]), b: parseInt(r[b]) }) }
  const ent: Record<string, { desc: string; chains: string[] }> = {};
  const EN = cats['_entity'];
  if (EN) { const c = (n: string) => EN.cols.indexOf(n); const id = c('id'), desc = c('pdbx_description'); for (const r of EN.rows) ent[r[id]] = { desc: desc >= 0 ? r[desc] : '', chains: [] } }
  const EP = cats['_entity_poly'];
  if (EP) { const c = (n: string) => EP.cols.indexOf(n); const id = c('entity_id'), sid = c('pdbx_strand_id'); for (const r of EP.rows) if (ent[r[id]] && sid >= 0) ent[r[id]].chains = r[sid].split(',').map(v => v.trim()) }
  const chainEnt: Record<string, string> = {}; for (const e in ent) for (const ch of ent[e].chains) chainEnt[ch] = e;
  const entities: Record<string, { desc: string }> = {}; for (const e in ent) entities[e] = { desc: ent[e].desc };
  return [...models.values()].map(recs => Structure.fromRecords(recs, { H, E }, entities, chainEnt));
}
