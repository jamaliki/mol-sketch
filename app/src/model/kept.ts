/* A structure read from its text, as bytes to be kept between runs: the host keeps them as files by a hash of the
   text, and a later run reads the structure back from them in a fraction of the time the text takes to parse (a
   ribosome's 25 MB of mmCIF: a third of a second, read back in a few hundredths). Read back, it is the structure the
   text gives, field for field: its atoms' typed arrays as they were, its names, residues, chains and entities, and what
   its bonds' orders will be worked out with (its bonds themselves are still worked out when first asked for).

   Layout (little-endian, each part padded to 4 bytes):
     int32 MAGIC, VERSION, count, residues, JSON length (UTF-16 code units), 0; float64 centre x, y, z, radius
     the JSON: { strings, entities, chains, hints }   (UTF-16 code units)
     float32 x, y, z, b; int32 residueOf, serial; uint8 het, flags   (one per atom)
     uint16 element, atomName   (indices into strings)
     float64 resi; int32 atomStart, atomEnd, trace, orient, chain, resn, entity (strings); uint8 het | nucleic << 1, ss, subunit
   Change VERSION whenever Structure or this layout changes: a file of another version is not read. */
import { Structure, type Residue, type SS, type Subunit } from './structure';
import { assignBondOrders, type OrderHints } from './bondorder';

const MAGIC = 0x4d534d4b, VERSION = 2, HEAD = 56;

export function modelBytes(s: Structure, hints: OrderHints): ArrayBuffer | null {
  const n = s.count, R = s.residues, nr = R.length;
  const strings: string[] = [], index = new Map<string, number>();
  const str = (v: string) => { let k = index.get(v); if (k === undefined) { k = strings.length; strings.push(v); index.set(v, k) } return k };
  const el = new Uint16Array(n), nm = new Uint16Array(n);
  for (let i = 0; i < n; i++) { el[i] = str(s.element[i]); nm[i] = str(s.atomName[i]) }
  const chain = new Int32Array(nr), resn = new Int32Array(nr), entity = new Int32Array(nr);
  for (let r = 0; r < nr; r++) { chain[r] = str(R[r].chain); resn[r] = str(R[r].resn); entity[r] = str(R[r].entity) }
  if (strings.length > 0xffff) return null;   // (more names than an index holds: not kept)
  const entries = <K, V>(m: Map<K, Map<K, V>> | undefined) => m ? [...m].map(([k, v]) => [k, [...v]]) : null;
  const json = JSON.stringify({ strings, entities: s.entities, chains: s.chains,
    hints: { comp: entries(hints.comp), conect: entries(hints.conect) } });
  const pad = (b: number) => (b + 3) & ~3;
  const size = ((HEAD + pad(2 * json.length) + 24 * n + 2 * pad(n) + 2 * pad(2 * n) + 7) & ~7) + 8 * nr + 28 * nr + pad(3 * nr);
  const buf = new ArrayBuffer(size); let o = 0;
  new Int32Array(buf, 0, 6).set([MAGIC, VERSION, n, nr, json.length, 0]); new Float64Array(buf, 24, 4).set([...s.center, s.radius]); o = HEAD;   // (a centre of NaN stays NaN, as JSON would not keep it)
  const J = new Uint16Array(buf, o, json.length); for (let i = 0; i < json.length; i++) J[i] = json.charCodeAt(i); o += pad(2 * json.length);
  const put = <T extends Float32Array | Int32Array | Uint8Array | Uint16Array | Float64Array>(src: T, Kind: any, bytes: number) => { new Kind(buf, o, src.length).set(src); o += pad(bytes) };
  for (const a of [s.x, s.y, s.z, s.b]) put(a, Float32Array, 4 * n);
  put(s.residueOf, Int32Array, 4 * n); put(s.serial, Int32Array, 4 * n);
  put(s.het, Uint8Array, n); put(s.flags, Uint8Array, n);
  put(el, Uint16Array, 2 * n); put(nm, Uint16Array, 2 * n);
  o = (o + 7) & ~7;   // (float64s on an 8-byte boundary)
  const resi = new Float64Array(buf, o, nr); for (let r = 0; r < nr; r++) resi[r] = R[r].resi; o += 8 * nr;
  const cols = [Int32Array.from(R, r => r.atomStart), Int32Array.from(R, r => r.atomEnd), Int32Array.from(R, r => r.trace), Int32Array.from(R, r => r.orient), chain, resn, entity];
  for (const c of cols) put(c, Int32Array, 4 * nr);
  const flags = new Uint8Array(buf, o, 3 * nr);
  for (let r = 0; r < nr; r++) { flags[r] = (R[r].het ? 1 : 0) | (R[r].nucleic ? 2 : 0); flags[nr + r] = R[r].ss.charCodeAt(0); flags[2 * nr + r] = R[r].subunit.charCodeAt(0) }
  return buf;
}

/** the structure kept as `buf` (named `name`), or null for bytes that are not one of this version */
export function modelFrom(buf: ArrayBuffer, name: string): Structure | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 20) return null;
  const [magic, version, n, nr, jl] = new Int32Array(buf, 0, 5);
  if (magic !== MAGIC || version !== VERSION) return null;
  if (buf.byteLength < HEAD) return null;
  const pad = (b: number) => (b + 3) & ~3; let o = HEAD; const cr = new Float64Array(buf, 24, 4);
  const J = new Uint16Array(buf, o, jl); let json = '';
  for (let i = 0; i < jl; i += 8192) json += String.fromCharCode.apply(null, J.subarray(i, Math.min(jl, i + 8192)) as any);
  o += pad(2 * jl);
  const d = JSON.parse(json); const S: string[] = d.strings;
  const take = (Kind: any, len: number, bytes: number) => { const a = new Kind(buf.slice(o, o + bytes)); o += pad(bytes); return a };
  const s = new Structure(); s.name = name; s.count = n;
  s.x = take(Float32Array, n, 4 * n); s.y = take(Float32Array, n, 4 * n); s.z = take(Float32Array, n, 4 * n); s.b = take(Float32Array, n, 4 * n);
  s.residueOf = take(Int32Array, n, 4 * n); s.serial = take(Int32Array, n, 4 * n);
  s.het = take(Uint8Array, n, n); s.flags = take(Uint8Array, n, n);
  const el: Uint16Array = take(Uint16Array, n, 2 * n), nm: Uint16Array = take(Uint16Array, n, 2 * n);
  for (let i = 0; i < n; i++) { s.element.push(S[el[i]]); s.atomName.push(S[nm[i]]) }
  o = (o + 7) & ~7;
  const resi = new Float64Array(buf, o, nr); o += 8 * nr;
  const [atomStart, atomEnd, trace, orient, chain, resn, entity] = Array.from({ length: 7 }, () => new Int32Array(buf, (o += 4 * nr) - 4 * nr, nr));
  const flags = new Uint8Array(buf, o, 3 * nr);
  for (let r = 0; r < nr; r++) {
    const res: Residue = { index: r, chain: S[chain[r]], resi: resi[r], resn: S[resn[r]], atomStart: atomStart[r], atomEnd: atomEnd[r], het: !!(flags[r] & 1),
      nucleic: !!(flags[r] & 2), trace: trace[r], ss: String.fromCharCode(flags[nr + r]) as SS, entity: S[entity[r]], subunit: String.fromCharCode(flags[2 * nr + r]) as Subunit, orient: orient[r] };
    s.residues.push(res);
  }
  s.chains = d.chains; s.entities = d.entities; s.center = [cr[0], cr[1], cr[2]]; s.radius = cr[3];
  const maps = <K>(e: [K, [K, number][]][] | null) => e ? new Map(e.map(([k, v]) => [k, new Map(v)])) : undefined;
  const hints: OrderHints = {}; const comp = maps<string>(d.hints.comp), conect = maps<number>(d.hints.conect);
  if (comp) hints.comp = comp; if (conect) hints.conect = conect;
  s.deferBonds(() => { s.inferBonds(); assignBondOrders(s, hints) });   // (as parseModels does)
  return s;
}
