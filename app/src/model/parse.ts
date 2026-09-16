/* PDB and mmCIF readers → Structure. Only the first model is returned by parseStructure; parseModels gives all. */
import { Structure, COV_R, type AtomRecord, type SSRecord } from './structure';

export function parseModels(text: string, name = ''): Structure[] {
  const out = (/^\s*data_/.test(text) || text.indexOf('_atom_site.') >= 0) ? parseCIF(text) : parsePDB(text);
  for (const s of out) { s.name = name; s.inferBonds() }
  return out;
}
export function parseStructure(text: string, name = ''): Structure { const m = parseModels(text, name); if (!m.length) throw new Error('no atoms found'); return m[0] }

function elementFromName(name: string): string {
  let el = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (el.length > 1 && !(el in COV_R)) el = el[0];
  return el;
}

/* ---------------- PDB ---------------- */
function parsePDB(text: string): Structure[] {
  const lines = text.split(/\r?\n/);
  const models: string[][] = []; let cur: string[] = []; let sawModel = false;
  const H: SSRecord[] = [], E: SSRecord[] = [];
  for (const line of lines) {
    const rec = line.substr(0, 6).trim();
    if (rec === 'MODEL') { sawModel = true; cur = [] }
    else if (rec === 'ENDMDL') { models.push(cur); cur = [] }
    else if (rec === 'HELIX') H.push({ chain: line.substr(19, 1).trim(), a: parseInt(line.substr(21, 4)), b: parseInt(line.substr(33, 4)) });
    else if (rec === 'SHEET') E.push({ chain: line.substr(21, 1).trim(), a: parseInt(line.substr(22, 4)), b: parseInt(line.substr(33, 4)) });
    else cur.push(line);
  }
  if (!sawModel || cur.some(l => /^(ATOM|HETATM)/.test(l))) models.push(cur);
  return models.filter(m => m.some(l => /^(ATOM|HETATM)/.test(l))).map(m => {
    const recs: AtomRecord[] = [];
    for (const line of m) {
      const rec = line.substr(0, 6).trim(); if (rec !== 'ATOM' && rec !== 'HETATM') continue;
      const alt = line.substr(16, 1).trim(); if (alt && alt !== 'A') continue;
      const name = line.substr(12, 4).trim(); let el = line.substr(76, 2).trim().toUpperCase(); if (!el) el = elementFromName(name);
      const resn = line.substr(17, 3).trim();
      recs.push({ serial: parseInt(line.substr(6, 5)), name, el, resn, chain: line.substr(21, 1).trim(), resi: parseInt(line.substr(22, 4)), x: parseFloat(line.substr(30, 8)), y: parseFloat(line.substr(38, 8)), z: parseFloat(line.substr(46, 8)), het: rec === 'HETATM' || resn === 'HOH' });
    }
    return Structure.fromRecords(recs, { H, E }, {}, {});
  });
}

/* ---------------- mmCIF ---------------- */
interface Cat { cols: string[]; rows: string[][] }
function tokenize(line: string): string[] {
  const out: string[] = []; let j = 0; const n = line.length;
  while (j < n) {
    const ch = line[j]; if (ch === ' ' || ch === '\t') { j++; continue }
    if (ch === "'" || ch === '"') { let k = j + 1; while (k < n && !(line[k] === ch && (k + 1 >= n || line[k + 1] === ' ' || line[k + 1] === '\t'))) k++; out.push(line.substring(j + 1, k)); j = k + 1; continue }
    let k = j; while (k < n && line[k] !== ' ' && line[k] !== '\t') k++; out.push(line.substring(j, k)); j = k;
  }
  return out;
}
function readCIF(text: string): Record<string, Cat> {
  const lines = text.split(/\r?\n/); const cats: Record<string, Cat> = {}; let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (line.startsWith('loop_')) {
      i++; const names: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('_')) { names.push(lines[i].trim().split(/\s+/)[0]); i++ }
      if (!names.length) continue;
      const cat = names[0].split('.')[0]; const cols = names.map(nm => nm.split('.')[1]); const rows: string[][] = []; let buf: string[] = [];
      while (i < lines.length) {
        line = lines[i];
        if (line.startsWith('#') || line.startsWith('loop_') || line.startsWith('_') || line.startsWith('data_')) break;
        if (line.startsWith(';')) { let txt = line.substring(1); i++; while (i < lines.length && !lines[i].startsWith(';')) { txt += '\n' + lines[i]; i++ } buf.push(txt); i++ }
        else { for (const v of tokenize(line)) buf.push(v); i++ }
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

function parseCIF(text: string): Structure[] {
  const cats = readCIF(text); const AS = cats['_atom_site']; if (!AS) return [];
  const ci = (n: string) => AS.cols.indexOf(n);
  const ix = { grp: ci('group_PDB'), id: ci('id'), el: ci('type_symbol'), name: ci('label_atom_id'), alt: ci('label_alt_id'), resn: ci('label_comp_id'), asym: ci('label_asym_id'), auth_asym: ci('auth_asym_id'), seq: ci('label_seq_id'), auth_seq: ci('auth_seq_id'), x: ci('Cartn_x'), y: ci('Cartn_y'), z: ci('Cartn_z'), model: ci('pdbx_PDB_model_num') };
  const models = new Map<string, AtomRecord[]>();
  for (const r of AS.rows) {
    const m = ix.model >= 0 ? r[ix.model] : '1'; let M = models.get(m); if (!M) { M = []; models.set(m, M) }
    const alt = ix.alt >= 0 ? r[ix.alt] : '.'; if (alt && alt !== '.' && alt !== '?' && alt !== 'A') continue;
    const name = r[ix.name], resn = r[ix.resn]; const chain = (ix.auth_asym >= 0 ? r[ix.auth_asym] : r[ix.asym]) || '';
    let seqS = ix.auth_seq >= 0 ? r[ix.auth_seq] : r[ix.seq]; if (seqS === '.' || seqS === '?') seqS = ix.seq >= 0 ? r[ix.seq] : '0';
    let el = (ix.el >= 0 ? r[ix.el] : '').toUpperCase(); if (!el || el === '.' || el === '?') el = elementFromName(name);
    const het = (ix.grp >= 0 ? r[ix.grp] : 'ATOM') === 'HETATM' || resn === 'HOH';
    M.push({ serial: +r[ix.id], name, el, resn, chain, resi: parseInt(seqS), x: +r[ix.x], y: +r[ix.y], z: +r[ix.z], het });
  }
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
