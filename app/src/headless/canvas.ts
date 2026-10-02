/* A recording 2D canvas for the headless core: the engine draws on it exactly as on a browser canvas, and every call
   becomes an op in its canvas's list. The host (the Python SDK) replays the lists in Skia, the rasteriser Chrome's
   canvas uses. Validation follows the canvas spec as Chrome implements it, so what is recorded is what Chrome would
   have drawn: an out-of-range globalAlpha or a non-finite coordinate is ignored here, not passed on.

   Ops (arrays, first element the name):
     size w h                       the canvas was (re)sized: a fresh, transparent bitmap, state reset
     m a b c d e f                  the current transform, after any transform call
     save / restore                 only around a transform or clip change (the host keeps no other state)
     begin / close / P … (below) / L x y / Q cx cy x y / C … / A x y r a0 a1 ccw / E … / T …   path parts the host builds
     F mode paint (offset length hasClose)…   paths begun, made and drawn (below)
     fill rule paint / stroke paint / clip rule
     fillRect paint x y w h / strokeRect paint … / clearRect x y w h
     text kind(fill|stroke) s x y maxWidth|null paint font align baseline
     img id snap alpha composite smoothing filter … (the 2, 4 or 8 drawImage numbers)   snap: the source's snapshot
     snap id                        this canvas as it is now is snapshot `id` (drawn or patterned by another canvas)
     ext key / keep key             the host's texture `key` is this canvas's picture / keep this canvas as texture `key`
   Paints are ids into the render's paint table (see Paints). */

import { arcTo, type ArcSink } from './skarc';

type Op = (string | number | boolean | object | null)[];
let nextId = 1;
/* Paths, the bulk of a large drawing, do not become one op per call: moves, lines, curves, closes and arcs (as the
   conics Skia's arcTo makes of them, skarc.ts) are collected as Skia's points, conic weights and verbs (0 move, 1 line,
   2 quad, 3 conic, 4 cubic, 5 close), and each run of them is written, as a serialised SkPath (version 5: four int32
   version, points, conics, verbs; float32 points and weights; verb bytes padded to four), into one byte stream the
   host reads paths from directly. A run is one op
     P offset length continues hasClose
   `continues`: the run carries on the path's last contour; it starts with a move to the current point, which the
   host's extend joins without a line. What the recorder cannot follow exactly (a turned ellipse, arcTo, anything
   after a transform moved the path) stays an op for the host. */
class Stream<T extends Float32Array | Uint8Array> {
  n = 0;
  constructor(public a: T) { }
  push(v: number) { if (this.n === this.a.length) this.grow(); this.a[this.n++] = v }
  push2(x: number, y: number) { if (this.n + 2 > this.a.length) this.grow(); this.a[this.n++] = x; this.a[this.n++] = y }
  private grow() { const b = new (this.a.constructor as any)(this.a.length * 2); b.set(this.a); this.a = b }
  take(): T { const r = this.a.slice(0, this.n) as T; this.n = 0; return r }
}
let RUNS = new Uint8Array(1 << 20), R32 = new Int32Array(RUNS.buffer), RF32 = new Float32Array(RUNS.buffer), runsN = 0;   // runsN: bytes used, a multiple of 4
/** a run as a serialised SkPath at the end of RUNS (the host is little-endian, as typed arrays are here): its offset and
   length. Copied by hand: a run is small, and views made per run would be garbage by the million */
let runGen = 0;   // bumped when RUNS is handed over (offsets into it hold within one chunk)
function ensureRuns(n: number) {
  if (n <= RUNS.length) return;
  let c = RUNS.length * 2; while (n > c) c *= 2;
  const b = new Uint8Array(c); b.set(RUNS.subarray(0, runsN)); RUNS = b; R32 = new Int32Array(b.buffer); RF32 = new Float32Array(b.buffer);
}
/** a copy of a run at the end of RUNS; its offset */
function copyRun(off: number, len: number) { ensureRuns(runsN + len); RUNS.copyWithin(runsN, off, off + len); const o = runsN; runsN += len; return o }
function writeRun(pts: Stream<Float32Array>, vbs: Stream<Uint8Array>, wts: Stream<Float32Array>): [number, number] {
  const np = pts.n / 2, nw = wts.n, nv = vbs.n, len = 16 + 8 * np + 4 * nw + ((nv + 3) & ~3), off = runsN;
  ensureRuns(off + len);
  let q = off >> 2; R32[q] = 5; R32[q + 1] = np; R32[q + 2] = nw; R32[q + 3] = nv; q += 4;
  const P = pts.a, W = wts.a, V = vbs.a;
  for (let i = 0; i < 2 * np; i++) RF32[q + i] = P[i];
  q += 2 * np;
  for (let i = 0; i < nw; i++) RF32[q + i] = W[i];
  let v = (q + nw) << 2;
  for (let i = 0; i < nv; i++) RUNS[v + i] = V[i];
  for (v += nv; v < off + len; v++) RUNS[v] = 0;
  runsN = off + len; pts.n = vbs.n = wts.n = 0;
  return [off, len];
}

const f32 = Math.fround;

/** a CSS colour as RGBA, the channels integers 0..255 (Blink rounds them) and alpha 0..1: #hex, rgb()/rgba(), transparent
   and a few names; null if Chrome would ignore it. The host divides the channels by 255. */
const HEX = /^[0-9a-f]+$/, RGB = /^rgba?\(\s*([^)]*)\)$/;
const parsed = new Map<string, number[] | null>();   // the engine sets the same colours over and over
function parseColor(str: string): number[] | null {
  let v = parsed.get(str); if (v !== undefined) return v;
  v = parseColorOnce(str); if (parsed.size > 8192) parsed.clear(); parsed.set(str, v); return v;
}
function parseColorOnce(str: string): number[] | null {
  const s = str.trim().toLowerCase();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if ((h.length !== 6 && h.length !== 8) || !HEX.test(h)) return null;
    const v = [0, 2, 4, 6].slice(0, h.length / 2).map(i => parseInt(h.slice(i, i + 2), 16));
    return [v[0], v[1], v[2], v.length === 4 ? v[3] / 255 : 1];
  }
  const m = RGB.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const num = (p: string) => /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(p) ? Number(p) : NaN;
    const ch = parts.slice(0, 3).map(p => p.endsWith('%') ? num(p.slice(0, -1)) * 2.55 : num(p));
    const a = parts.length === 4 ? (parts[3].endsWith('%') ? num(parts[3].slice(0, -1)) / 100 : num(parts[3])) : 1;
    if (ch.some(isNaN) || isNaN(a)) return null;
    const c = ch.map(x => Math.min(255, Math.max(0, roundHalfEven(x))));   // Blink rounds the channels to integers
    return [c[0], c[1], c[2], Math.min(1, Math.max(0, a))];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  const n = NAMED[s]; return n ? [n[0], n[1], n[2], 1] : null;
}
const NAMED: Record<string, number[]> = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0] };
/** Python's round(): halves to even */
function roundHalfEven(x: number) { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r }
/* Canvases: those with ops not yet handed over, and every canvas by weak reference, so the host hears of the ones
   the engine has let go (their pixels can go too) */
const pending = new Set<RecCanvas>(), alive = new Map<number, WeakRef<RecCanvas>>();
let pendingOps = 0, nextSnap = 1;
/** width of `text` in the CSS `font`, as the host measures it (set by the host before rendering) */
let measureFn: (font: string, text: string) => number = (_f, t) => t.length * 8;
export function setMeasure(f: (font: string, text: string) => number) { measureFn = f }

const COMPOSITE = new Set(['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out', 'destination-atop',
  'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const ENUMS: Record<string, Set<string>> = {
  lineCap: new Set(['butt', 'round', 'square']), lineJoin: new Set(['miter', 'round', 'bevel']),
  textAlign: new Set(['start', 'end', 'left', 'right', 'center']), textBaseline: new Set(['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom']),
};
const fin = (...v: number[]) => v.every(x => typeof x === 'number' && isFinite(x));

type M6 = [number, number, number, number, number, number];
const mul = (m: M6, a: number, b: number, c: number, d: number, e: number, f: number): M6 =>   // m · [a b c d e f], as canvas composes
  [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];

export class DOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[]) { if (init && init.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init }
  scale(sx = 1, sy = sx) { return new DOMMatrix([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f]) }
  translate(tx = 0, ty = 0) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.a * tx + this.c * ty + this.e, this.b * tx + this.d * ty + this.f]) }
}

class Pattern {
  m: M6 = [1, 0, 0, 1, 0, 0];
  /** `src` is held so the canvas (and its snapshot, on the host) lives as long as the pattern */
  constructor(public src: RecCanvas, public snap: number, public rep: string) { }
  get id() { return this.src.id }
  setTransform(t?: DOMMatrix) { this.m = t ? [t.a, t.b, t.c, t.d, t.e, t.f] : [1, 0, 0, 1, 0, 0] }
}

interface State { m: M6; fillStyle: any; strokeStyle: any; lineWidth: number; lineCap: string; lineJoin: string; miterLimit: number; globalAlpha: number;
  globalCompositeOperation: string; font: string; textAlign: string; textBaseline: string; filter: string; imageSmoothingEnabled: boolean; lineDash: number[]; lineDashOffset: number;
  /** the styles in effect (a colour as float RGBA, or a pattern's record), and this state's paints once made (with their epoch) */
  fillV: any; strokeV: any; fid: number; fidE: number; sid: number; sidE: number; bid: number; bidE: number }
const fresh = (): State => ({ m: [1, 0, 0, 1, 0, 0], fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
  globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', filter: 'none', imageSmoothingEnabled: true, lineDash: [], lineDashOffset: 0,
  fillV: [0, 0, 0, 1], strokeV: [0, 0, 0, 1], fid: 0, fidE: -1, sid: 0, sidE: -1, bid: 0, bidE: -1 });

/* Paints: the state a draw depends on (its style, alpha, blend mode, filter and, for a stroke, the pen) becomes a paint
   spec; each distinct spec gets an id, and draw ops carry the id. The specs of a render go to the host beside its ops
     fill colour     0 r g b a alpha composite filter          r g b: 0..255, a and alpha 0..1
     stroke colour   1 r g b a alpha composite filter width cap join miter dash dashOffset
     fill pattern    2 pat snap rep m smoothing alpha composite filter
     stroke pattern  3 pat snap rep m smoothing alpha composite filter width cap join miter dash dashOffset
   Ids are never reused; a state keeps its paints' ids for the render they were made in (the epoch). */
let PAINTS = new Map<string, number>(), SPECS: any[] = [], nextPaint = 1, EPOCH = 0;
/* a plain colour's paint (most paints) is found by a hash of its fields and then the fields themselves: a key string
   built for every paint, and hashed, cost more than drawing with it */
let PLAIN = new Map<number, any[][]>();
const HB = new Float64Array(1), HW = new Int32Array(HB.buffer), STRH = new Map<string, number>();
const hashOf = (f: any[]) => { let h = f.length;
  for (const x of f) { let a: number, b: number;
    if (typeof x === 'number') { HB[0] = x === 0 ? 0 : x; a = HW[0]; b = HW[1] }   // (−0 is 0, as a key string has it)
    else { let k = STRH.get(x); if (k === undefined) { k = 0; for (let i = 0; i < x.length; i++) k = Math.imul(k ^ x.charCodeAt(i), 0x01000193); if (STRH.size > 1024) STRH.clear(); STRH.set(x, k) } a = k; b = 0x5bd1e995 }
    h = Math.imul(h ^ a, 0x9E3779B1); h = Math.imul(h ^ b, 0x85EBCA77); h ^= h >>> 15 }
  return h };

export class RecCanvas {
  id: number; private w = 300; private h = 150; ops: Op[] = []; total = 0; private ctx: RecContext | null = null;
  constructor() { this.id = nextId++; alive.set(this.id, new WeakRef(this)); this.push(['size', 300, 150]) }
  /** the op count when another canvas last took this one's picture: ops before it are never rewritten */
  frozen = 0; private lastMark = 0; private markAt = -1;
  push(op: Op) { if (!this.ops.length) pending.add(this); this.ops.push(op); this.total++; pendingOps++ }
  /** a snapshot of this canvas as it is now, for another canvas to draw or pattern with: a marker in its ops (one per
     state: a canvas unchanged since its last snapshot gives that one again) */
  mark(): number {
    this.settle();
    if (this.markAt === this.total) return this.lastMark;
    const sid = nextSnap++; this.push(['snap', sid]); this.frozen = this.total; this.lastMark = sid; this.markAt = this.total;
    return sid;
  }
  private resize() { this.ctx?.settle(); this.push(['size', this.w, this.h]); this.ctx?.reset() }
  /** every op so far pushed (a pending run included): before another canvas snapshots this one */
  settle() { this.ctx?.settle() }
  get width() { return this.w } set width(v: number) { const n = Math.floor(+v); this.w = n >= 0 && isFinite(n) ? n : 300; this.resize() }
  get height() { return this.h } set height(v: number) { const n = Math.floor(+v); this.h = n >= 0 && isFinite(n) ? n : 150; this.resize() }
  getContext(kind: string) { if (kind !== '2d') return null; return this.ctx || (this.ctx = new RecContext(this)) }
}

export class RecContext {
  private s: State = fresh(); private stack: State[] = [];
  // the path as Skia holds it, as far as the recorder knows: is there a current point, was the last verb a close, the
  // contour's start (Skia's last move) and the last point, as float32 (null: made by an op the host builds, unknown here)
  private hasCur = false; private closed = false; private hasStart = false; private sx = 0; private sy = 0; private hasLast = false; private lx = 0; private ly = 0;
  private run: { cont: boolean; close: boolean; moveAt: number } | null = null;   // moveAt: the run's trailing move, or -1
  // the path's version (any change bumps it); the run an F op last drew it from, while the path is unchanged and the
  // run's bytes are in this chunk; and the path's own bytes when the host's current path is a reopened copy of it
  private ver = 0; private fused: { ver: number; gen: number; off: number; len: number; close: boolean } | null = null;
  private shadow: Uint8Array | null = null; private shadowClose = false;
  // the run being made
  private PTS = new Stream(new Float32Array(1 << 10)); private VBS = new Stream(new Uint8Array(1 << 9)); private WTS = new Stream(new Float32Array(1 << 6));
  constructor(public canvas: RecCanvas) { }
  reset() { this.s = fresh(); this.stack = []; this.saves = []; this.newPath() }
  private newPath() { this.hasCur = false; this.closed = false; this.hasStart = false; this.hasLast = false; this.ver++; this.shadow = null }
  /** before the host next uses or extends its current path: if that is a reopened copy (see fuse), give it the path
     itself (F mode 4: set the path, draw nothing) */
  private restorePath() {
    const b = this.shadow; if (!b) return; this.shadow = null;
    ensureRuns(runsN + b.length); RUNS.set(b, runsN); const off = runsN; runsN += b.length;
    this.canvas.push(['F', 4, 0, off, b.length, this.shadowClose]);
  }
  /** end the current run of path verbs as one P op */
  settle() {
    const r = this.run; if (!r) return; this.run = null; this.restorePath();
    const [off, len] = writeRun(this.PTS, this.VBS, this.WTS);
    this.canvas.push(['P', off, len, r.cont, r.close]);
  }
  private op(...o: Op) { this.settle(); this.canvas.push(o) }
  /** an op the host builds the path with itself: what it leaves is unknown here */
  private hostOp(fresh: boolean, ...o: Op) { this.settle(); this.restorePath(); this.op(...o); this.ver++; this.hasCur = true; this.closed = false; this.hasLast = false; if (fresh) this.hasStart = false }
  private newRun(cont: boolean) { this.run = { cont, close: false, moveAt: -1 } }
  /** Skia's moveTo: a move after a move replaces it */
  private emitMove(x: number, y: number) {
    x = f32(x); y = f32(y);
    if (this.run && this.run.moveAt >= 0) { this.PTS.a[this.run.moveAt] = x; this.PTS.a[this.run.moveAt + 1] = y }
    else { if (!this.run) this.newRun(false); this.run!.moveAt = this.PTS.n; this.VBS.push(0); this.PTS.push2(x, y) }
    this.hasCur = true; this.closed = false; this.hasStart = this.hasLast = true; this.sx = this.lx = x; this.sy = this.ly = y; this.ver++;
  }
  /** a drawing verb (1 line, 2 quad, 3 conic, 4 cubic) from the current point; callers make sure `last` (and after a
     close, `start`) is known. After a close Skia first moves to the contour's start; a run that continues a contour
     begins with a move to the current point, which the host's extend joins without a line */
  private before() {
    if (this.closed) { if (this.run) this.run.moveAt = -1; this.emitMove(this.sx, this.sy) }
    else if (!this.run) { this.newRun(true); this.VBS.push(0); this.PTS.push2(this.lx, this.ly) }
    this.run!.moveAt = -1; this.hasCur = true; this.closed = false; this.ver++;
  }
  private emitEnd(x: number, y: number) { this.PTS.push2(x, y); this.lx = this.PTS.a[this.PTS.n - 2]; this.ly = this.PTS.a[this.PTS.n - 1]; this.hasLast = true }
  private emitLine(x: number, y: number) { this.before(); this.VBS.push(1); this.emitEnd(x, y) }
  private emitQuad(a: number, b: number, x: number, y: number) { this.before(); this.VBS.push(2); this.PTS.push2(a, b); this.emitEnd(x, y) }
  private emitConic(a: number, b: number, x: number, y: number, w: number) { this.before(); this.VBS.push(3); this.WTS.push(w); this.PTS.push2(a, b); this.emitEnd(x, y) }
  private emitCubic(a: number, b: number, c: number, d: number, x: number, y: number) { this.before(); this.VBS.push(4); this.PTS.push2(a, b); this.PTS.push2(c, d); this.emitEnd(x, y) }
  /** can the next drawing verb be recorded here (the points it starts from are known)? */
  private get knows() { return !this.hasCur || (this.hasLast && (!this.closed || this.hasStart)) }
  /** a state property: kept here, and the paints made from the state forgotten (draws carry what they need) */
  private setProp(k: keyof State, v: any) { const s = this.s as any; s[k] = v; s.fidE = s.sidE = s.bidE = -1 }
  /** the id of the paint this state fills (or strokes) with; `butt`: its stroke with butt caps (a reopened hairline) */
  private pid(stroke: boolean, butt = false): number {
    const s = this.s;
    if (butt) { if (s.bidE === EPOCH) return s.bid }
    else if (stroke ? s.sidE === EPOCH : s.fidE === EPOCH) return stroke ? s.sid : s.fid;
    const v = stroke ? s.strokeV : s.fillV, cap = butt ? 'butt' : s.lineCap;
    const spec = (): any[] => {
      const common = [s.globalAlpha, s.globalCompositeOperation, s.filter];
      const o: any[] = Array.isArray(v) ? [stroke ? 1 : 0, ...v, ...common] : [stroke ? 3 : 2, v.pat, v.snap, v.rep, v.m, s.imageSmoothingEnabled, ...common];
      if (stroke) o.push(s.lineWidth, cap, s.lineJoin, s.miterLimit, s.lineDash.length ? s.lineDash : null, s.lineDashOffset);
      return o;
    };
    let id: number | undefined;
    if (Array.isArray(v) && !s.lineDash.length) {   // a plain colour: its fields (the same paint as each field the same)
      const f = stroke ? [1, v[0], v[1], v[2], v[3], s.globalAlpha, s.globalCompositeOperation, s.filter, s.lineWidth, cap, s.lineJoin, s.miterLimit, s.lineDashOffset]
        : [0, v[0], v[1], v[2], v[3], s.globalAlpha, s.globalCompositeOperation, s.filter];
      const h = hashOf(f); let bucket = PLAIN.get(h);
      if (bucket) for (const e of bucket) { let same = true; for (let i = 0; i < f.length; i++) if (e[i] !== f[i]) { same = false; break } if (same) { id = e[f.length]; break } }
      if (id === undefined) { id = nextPaint++; f.push(id); if (bucket) bucket.push(f); else PLAIN.set(h, [f]); SPECS.push(id, spec()) }
    } else {   // anything else by its spec as JSON
      const key = JSON.stringify(spec()); id = PAINTS.get(key);
      if (id === undefined) { id = nextPaint++; PAINTS.set(key, id); SPECS.push(id, spec()) }
    }
    if (butt) { s.bid = id; s.bidE = EPOCH } else if (stroke) { s.sid = id; s.sidE = EPOCH } else { s.fid = id; s.fidE = EPOCH }
    return id;
  }

  /* state */
  get fillStyle() { return this.s.fillStyle } set fillStyle(v: any) { this.style('fillStyle', v) }
  get strokeStyle() { return this.s.strokeStyle } set strokeStyle(v: any) { this.style('strokeStyle', v) }
  private style(k: 'fillStyle' | 'strokeStyle', v: any) {
    let e: any = null;
    if (v instanceof Pattern) e = { pat: v.id, snap: v.snap, rep: v.rep, m: v.m };
    else if (typeof v === 'string') e = parseColor(v);   // an unparsable colour is ignored, as in Chrome
    if (e === null) return;
    this.setProp(k, v); if (k === 'fillStyle') this.s.fillV = e; else this.s.strokeV = e;
  }
  get lineWidth() { return this.s.lineWidth } set lineWidth(v: number) { v = +v; if (fin(v) && v > 0) this.setProp('lineWidth', v) }
  get miterLimit() { return this.s.miterLimit } set miterLimit(v: number) { v = +v; if (fin(v) && v > 0) this.setProp('miterLimit', v) }
  get globalAlpha() { return this.s.globalAlpha } set globalAlpha(v: number) { v = +v; if (fin(v) && v >= 0 && v <= 1) this.setProp('globalAlpha', v) }
  get globalCompositeOperation() { return this.s.globalCompositeOperation } set globalCompositeOperation(v: string) { if (COMPOSITE.has(v)) this.setProp('globalCompositeOperation', v) }
  get lineCap() { return this.s.lineCap } set lineCap(v: string) { if (ENUMS.lineCap.has(v)) this.setProp('lineCap', v) }
  get lineJoin() { return this.s.lineJoin } set lineJoin(v: string) { if (ENUMS.lineJoin.has(v)) this.setProp('lineJoin', v) }
  get textAlign() { return this.s.textAlign } set textAlign(v: string) { if (ENUMS.textAlign.has(v)) this.setProp('textAlign', v) }
  get textBaseline() { return this.s.textBaseline } set textBaseline(v: string) { if (ENUMS.textBaseline.has(v)) this.setProp('textBaseline', v) }
  get font() { return this.s.font } set font(v: string) { if (typeof v === 'string' && /\d(px|pt)/.test(v)) this.setProp('font', v) }
  get filter() { return this.s.filter } set filter(v: string) { if (typeof v === 'string') this.setProp('filter', v) }
  get imageSmoothingEnabled() { return this.s.imageSmoothingEnabled } set imageSmoothingEnabled(v: boolean) { this.setProp('imageSmoothingEnabled', !!v) }
  get lineDashOffset() { return this.s.lineDashOffset } set lineDashOffset(v: number) { v = +v; if (fin(v)) this.setProp('lineDashOffset', v) }
  setLineDash(d: number[]) { if (!d.every(x => fin(x) && x >= 0)) return; const v = d.length % 2 ? [...d, ...d] : [...d]; this.setProp('lineDash', v) }
  getLineDash() { return [...this.s.lineDash] }
  /* save and restore reach the host only around what it keeps state for, the transform and the clip: a save is
     recorded when one of those changes inside it (every save still open then), its restore only if it was */
  private saves: boolean[] = [];
  save() { this.stack.push({ ...this.s, lineDash: [...this.s.lineDash] }); this.saves.push(false) }
  restore() { const t = this.stack.pop(); if (!t) return; this.s = t; if (this.saves.pop()) this.op('restore') }
  private opened() { for (let i = 0; i < this.saves.length; i++) if (!this.saves[i]) { this.op('save'); this.saves[i] = true } }

  /* transform: the op carries the whole matrix, composed here in doubles as Chrome does */
  private setM(m: M6) {
    const c = this.s.m; if (m[0] === c[0] && m[1] === c[1] && m[2] === c[2] && m[3] === c[3] && m[4] === c[4] && m[5] === c[5]) return;
    this.opened(); if (this.hasCur) { this.settle(); this.restorePath(); this.ver++ }
    this.s.m = m; this.op('m', ...m); if (this.hasCur) this.hasLast = this.hasStart = false;   // the host moves the path into the new space
  }
  setTransform(a?: any, b?: number, c?: number, d?: number, e?: number, f?: number) {
    if (a === undefined) return this.setM([1, 0, 0, 1, 0, 0]);
    if (typeof a === 'object') { const t = a; return this.setM([t.a ?? 1, t.b ?? 0, t.c ?? 0, t.d ?? 1, t.e ?? 0, t.f ?? 0]) }
    if (fin(a, b!, c!, d!, e!, f!)) this.setM([a, b!, c!, d!, e!, f!]);
  }
  resetTransform() { this.setM([1, 0, 0, 1, 0, 0]) }
  getTransform() { return new DOMMatrix([...this.s.m]) }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { if (fin(a, b, c, d, e, f)) this.setM(mul(this.s.m, a, b, c, d, e, f)) }
  translate(x: number, y: number) { if (fin(x, y)) this.setM(mul(this.s.m, 1, 0, 0, 1, x, y)) }
  scale(x: number, y: number) { if (fin(x, y)) this.setM(mul(this.s.m, x, 0, 0, y, 0, 0)) }
  rotate(t: number) { if (fin(t)) { const c = Math.cos(t), s = Math.sin(t); this.setM(mul(this.s.m, c, s, -s, c, 0, 0)) } }

  /* paths: non-finite arguments are ignored, as the spec says */
  beginPath() { this.op('begin'); this.newPath() }
  closePath() {   // closing nothing does nothing, nor does closing twice
    if (!this.hasCur || this.closed) return;
    if (this.run) { this.VBS.push(5); this.run.moveAt = -1; this.run.close = true } else { this.restorePath(); this.op('close') }
    this.closed = true; this.ver++;
  }
  moveTo(x: number, y: number) { if (fin(x, y)) this.emitMove(x, y) }
  lineTo(x: number, y: number) {
    if (!fin(x, y)) return;
    if (!this.hasCur) return this.moveTo(x, y);   // no current point: a move, as Blink does
    if (!this.knows) { this.settle(); this.restorePath(); this.op('L', x, y); this.ver++; this.closed = false; this.hasLast = true; this.lx = f32(x); this.ly = f32(y); return }   // the host knows where it is
    this.emitLine(x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    if (!fin(cx, cy, x, y)) return;
    if (!this.hasCur) this.emitMove(cx, cy);
    if (!this.knows) return this.hostOp(false, 'Q', cx, cy, x, y);
    this.emitQuad(cx, cy, x, y);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    if (!fin(a, b, c, d, x, y)) return;
    if (!this.hasCur) this.emitMove(a, b);
    if (!this.knows) return this.hostOp(false, 'C', a, b, c, d, x, y);
    this.emitCubic(a, b, c, d, x, y);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
    if (!fin(x, y, r, a0, a1)) return; if (r < 0) throw new RangeError("IndexSizeError: arc radius is negative");
    if (!this.knows) return this.hostOp(!this.hasCur || this.closed, 'A', x, y, r, a0, a1, !!ccw);
    this.addEllipse(x, y, r, r, a0, a1, !!ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    if (!fin(x, y, rx, ry, rot, a0, a1)) return; if (rx < 0 || ry < 0) throw new RangeError('IndexSizeError: ellipse radius is negative');
    if (rot || !this.knows) return this.hostOp(!this.hasCur || this.closed, 'E', x, y, rx, ry, rot, a0, a1, !!ccw);   // a turned ellipse: the host places it
    this.addEllipse(x, y, rx, ry, a0, a1, !!ccw);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
    if (!fin(x1, y1, x2, y2, r)) return; if (r < 0) throw new RangeError('IndexSizeError');
    this.hostOp(!this.hasCur || this.closed, 'T', x1, y1, x2, y2, r);
  }
  /** Blink's arc: its angles adjusted (AdjustArcAngles), then Skia's arcTo on the oval, a whole turn as two halves */
  private addEllipse(x: number, y: number, rx: number, ry: number, a0: number, a1: number, ccw: boolean) {
    const T = 2 * Math.PI;
    if (a0 >= T || a0 <= -T) { const ns = a0 % T; a1 += ns - a0; a0 = ns }
    if (a0 < 0) { a0 += T; a1 += T }
    if (!ccw && a1 - a0 >= T) a1 = a0 + T;
    else if (ccw && a0 - a1 >= T) a1 = a0 - T;
    else if (!ccw && a0 > a1) a1 = a0 + (T - (a0 - a1) % T);
    else if (ccw && a0 < a1) a1 = a0 - (T - (a1 - a0) % T);
    const DEG = 180 / Math.PI, start = a0 * DEG, sweep = (a1 - a0) * DEG;
    const l = f32(x - rx), t = f32(y - ry), r = f32(x + rx), b = f32(y + ry);
    const move = !this.hasCur, sink = this.sink;
    if (Math.abs(sweep - 360) < 1e-4) { arcTo(sink, l, t, r, b, f32(start), 180, move); arcTo(sink, l, t, r, b, f32(start + 180), 180, false) }
    else if (Math.abs(sweep + 360) < 1e-4) { arcTo(sink, l, t, r, b, f32(start), -180, move); arcTo(sink, l, t, r, b, f32(start - 180), -180, false) }
    else arcTo(sink, l, t, r, b, f32(start), f32(sweep), move);
  }
  private sink: ArcSink = {
    has: () => this.hasCur, lx: () => this.lx, ly: () => this.ly,
    move: (x, y) => this.emitMove(x, y),
    line: (x, y) => this.emitLine(x, y),
    quad: (a, b, x, y) => this.emitQuad(a, b, x, y),
    conic: (a, b, x, y, w) => this.emitConic(a, b, x, y, w),
  };
  rect(x: number, y: number, w: number, h: number) {   // a closed contour from (x, y), as the host built it
    if (!fin(x, y, w, h)) return;
    this.emitMove(x, y);
    this.emitLine(x + w, y); this.emitLine(x + w, y + h); this.emitLine(x, y + h);
    this.VBS.push(5); this.run!.close = true; this.closed = true; this.ver++;
  }
  fill(rule: string = 'nonzero') {
    const eo = rule === 'evenodd', p = this.pid(false);
    if (!this.fuse(eo ? 1 : 0, p) && !this.again(eo ? 1 : 0, p)) { this.settle(); this.restorePath(); this.op('fill', eo ? 'evenodd' : 'nonzero', p) }
    handOver();
  }
  stroke() {
    const p = this.pid(true);
    if (!this.fuse(2, p) && !this.again(2, p)) { this.settle(); this.restorePath(); this.op('stroke', p) }
    handOver();
  }
  /** the common case, a path begun, made in one run and drawn (with only state set in between), as one op, and
     such draws one after another in the same state as one op too:
       F mode (0 fill, 1 even-odd fill, 2 stroke, 3 stroke as it is) paint then, per path, offset length hasClose
       (4: no draw, the path only). The host's current path afterwards is the op's last path.
     A stroke is decided here: one that needs nothing of the host is drawn as it is (3), and a hairline stroke of closed
     contours as Chrome's Skia draws it (the host's would hit each contour's start twice): each close a line back to the
     start, with butt caps, on a reopened copy of its run. */
  private fuse(mode: number, paint: number) {
    this.settle();
    const c = this.canvas, ops = c.ops, pi = ops.length - 1, bi = pi - 1, at = c.total - ops.length;   // at: the op count at ops[0]
    if (bi < 0 || ops[pi][0] !== 'P' || ops[pi][3] || ops[bi][0] !== 'begin' || at + bi < c.frozen) return false;
    const P = ops[pi], prev = ops[bi - 1], off = P[1] as number, len = P[2] as number, close = P[4] as boolean;
    const d = this.decide(mode, paint, off, len, close);
    if (prev && prev[0] === 'F' && prev[1] === d.mode && prev[2] === d.paint && at + bi - 1 >= c.frozen) {   // the same draw again: join it
      ops.length = bi; prev.push(d.off, d.len, d.close); c.total -= 2;
    } else { ops.length = bi; ops.push(['F', d.mode, d.paint, d.off, d.len, d.close]); c.total -= 1 }   // begin and P became F
    this.drew(off, len, close, d.off !== off);
    return true;
  }
  /** a fill or stroke of the path an F op just drew, unchanged since: another F op on the same run */
  private again(mode: number, paint: number) {
    const f = this.fused;
    if (!f || f.ver !== this.ver || f.gen !== runGen || this.run) return false;
    const d = this.decide(mode, paint, f.off, f.len, f.close);
    this.canvas.push(['F', d.mode, d.paint, d.off, d.len, d.close]);
    this.drew(f.off, f.len, f.close, d.off !== f.off);
    return true;
  }
  private decide(mode: number, paint: number, off: number, len: number, close: boolean) {
    if (mode !== 2) return { mode, paint, off, len, close };
    if (!close || !hairline(this.s.m, f32(this.s.lineWidth))) return { mode: 3, paint, off, len, close };   // nothing for the host to do
    const o = copyRun(off, len), l = reopenLastRun(o, len);
    if (l < 0) { runsN = o; return { mode, paint, off, len, close } }   // open contours too: the host splits it
    return { mode: 3, paint: this.pid(true, true), off: o, len: l, close: false };
  }
  private drew(off: number, len: number, close: boolean, reopened: boolean) {
    this.fused = { ver: this.ver, gen: runGen, off, len, close };
    this.shadow = reopened ? RUNS.slice(off, off + len) : null; this.shadowClose = close;
  }
  clip(rule: string = 'nonzero') { this.opened(); this.settle(); this.restorePath(); this.op('clip', rule === 'evenodd' ? 'evenodd' : 'nonzero') }
  fillRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) { this.op('fillRect', this.pid(false), x, y, w, h); handOver() } }
  strokeRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) { this.op('strokeRect', this.pid(true), x, y, w, h); handOver() } }
  clearRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) this.op('clearRect', x, y, w, h) }

  /* text: shaped and drawn by the host; measured through it too */
  fillText(t: string, x: number, y: number, maxW?: number) { this.text(false, t, x, y, maxW) }
  strokeText(t: string, x: number, y: number, maxW?: number) { this.text(true, t, x, y, maxW) }
  private text(stroke: boolean, t: string, x: number, y: number, maxW?: number) {
    if (!fin(x, y) || (maxW !== undefined && !fin(maxW))) return;
    const s = this.s; this.op('text', stroke ? 'stroke' : 'fill', String(t), x, y, maxW ?? null, this.pid(stroke), s.font, s.textAlign, s.textBaseline); handOver();
  }
  measureText(t: string) { return { width: measureFn(this.s.font, String(t)) } }

  /* images: other recording canvases, drawn as they were at this moment */
  drawImage(img: any, ...n: number[]) {
    if (!(img instanceof RecCanvas)) throw new TypeError('drawImage: only canvases can be drawn headless');
    if (!(n.length === 2 || n.length === 4 || n.length === 8) || !fin(...n)) return;
    if (img.width === 0 || img.height === 0) throw new Error('InvalidStateError: drawImage of an empty canvas');
    const s = this.s, sid = img.mark();
    this.op('img', img.id, sid, s.globalAlpha, s.globalCompositeOperation, s.imageSmoothingEnabled, s.filter, ...n); handOver();
  }
  createPattern(img: any, rep: string | null) {
    if (!(img instanceof RecCanvas)) throw new TypeError('createPattern: only canvases headless');
    return new Pattern(img, img.mark(), rep || 'repeat');
  }
  createLinearGradient(): never { throw new Error('gradients are not recorded headless') }
  createRadialGradient(): never { throw new Error('gradients are not recorded headless') }
}

/** Skia's SkDrawTreatAsHairline, as the host computes it (_raster.py _treat_as_hairline): the stroke's width
   (float32, as a paint holds it) through the matrix, measured with fast_len, at most a pixel both ways */
function hairline(m: M6, w: number) {
  const fast = (x: number, y: number) => { x = Math.abs(x); y = Math.abs(y); return Math.max(x, y) + Math.min(x, y) / 2 };
  return fast(m[0] * w, m[1] * w) <= 1 && fast(m[2] * w, m[3] * w) <= 1;
}
const PER_VERB = [1, 1, 2, 2, 3, 0];
/** the last run written, if it is `off`/`len` and every contour of it is closed, rewritten with each close a line to
   its contour's start; its new length, or -1 (left alone) */
function reopenLastRun(off: number, len: number): number {
  if (off + len !== runsN) return -1;
  const q = off >> 2, np = R32[q + 1], nw = R32[q + 2], nv = R32[q + 3], pq = q + 4, wq = pq + 2 * np, vb = (wq + nw) << 2;
  if (!nv || RUNS[vb + nv - 1] !== 5) return -1;
  let closes = 0;
  for (let i = 0; i < nv; i++) { const v = RUNS[vb + i]; if (v === 5) closes++; else if (v === 0 && i > 0 && RUNS[vb + i - 1] !== 5) return -1 }
  const pts = RF32.slice(pq, pq + 2 * np), wts = RF32.slice(wq, wq + nw), vbs = RUNS.slice(vb, vb + nv);
  const np2 = np + closes, len2 = 16 + 8 * np2 + 4 * nw + ((nv + 3) & ~3);
  ensureRuns(off + len2);
  R32[q + 1] = np2;
  let k = 0, o = pq, sx = 0, sy = 0;
  for (let i = 0; i < nv; i++) {
    const v = vbs[i];
    if (v === 0) { sx = pts[k]; sy = pts[k + 1] }
    if (v === 5) { RF32[o++] = sx; RF32[o++] = sy } else for (let j = 2 * PER_VERB[v]; j > 0; j--) RF32[o++] = pts[k++];
  }
  for (let j = 0; j < nw; j++) RF32[o + j] = wts[j];
  const v2 = (o + nw) << 2;
  for (let i = 0; i < nv; i++) RUNS[v2 + i] = vbs[i] === 5 ? 1 : vbs[i];
  for (let i = v2 + nv; i < off + len2; i++) RUNS[i] = 0;
  runsN = off + len2;
  return len2;
}

/* Handing ops to the host: a chunk is every canvas's new ops, the paint specs and path runs they refer to, and the
   canvases gone since the last one. While the engine draws, chunks go out as they fill (at a draw, so fused ops stay
   whole) through the host's stream if it has one; what the stream cannot take waits for the end of the render. */
export interface Chunk { canvases: Record<number, { start: number; ops: Op[] }>; paints: any[]; runs: Uint8Array; dead: number[] }
const STREAM_OPS = 20000, STREAM_BYTES = 4 << 20;
let stream: ((c: Chunk) => boolean) | null = null; const held: Chunk[] = [];
/** the host's stream: takes a chunk (and returns true) or declines it */
export function setStream(f: ((c: Chunk) => boolean) | null) { stream = f }
function takeChunk(): Chunk {
  for (const c of pending) c.settle();
  const canvases: Chunk['canvases'] = {};
  for (const c of pending) { canvases[c.id] = { start: c.total - c.ops.length, ops: c.ops }; c.ops = [] }
  pending.clear(); pendingOps = 0;
  const dead: number[] = [];
  for (const [id, r] of alive) if (!r.deref()) { dead.push(id); alive.delete(id) }
  const runs = RUNS.slice(0, runsN); runsN = 0; runGen++;
  const paints = SPECS; SPECS = [];
  return { canvases, paints, runs, dead };
}
function emit() { const c = takeChunk(); if (held.length || !stream || !stream(c)) held.push(c) }
/** after a draw: hand over what has built up, if enough has */
function handOver() { if (stream && (pendingOps >= STREAM_OPS || runsN >= STREAM_BYTES)) emit() }
/** the end of a render: the last chunk out, and the chunks the stream did not take (for the host to pull) */
export function endRender(): Chunk[] { emit(); PAINTS = new Map(); PLAIN = new Map(); EPOCH++; return held.splice(0) }
/** everything recorded so far, as one chunk (no stream) */
export function flush(): Chunk { return takeChunk() }
/** a canvas the host no longer needs (a finished frame): the host drops it itself */
export function release(id: number) { alive.delete(id) }
export const document = { createElement(tag: string) { if (tag !== 'canvas') throw new Error('headless: only canvases'); return new RecCanvas() } };

/* Textures the host keeps between runs (the engine's hostTexture: the paper, its grain, the chalk's tooth), by key: one
   it has is a canvas of one op, ext (the host puts its pixels there), instead of the ops that draw it; one drawn here
   ends with keep (the host keeps its pixels, and says so before the next render). No host keys (the drawing worker): none. */
let hostTextures: Set<string> | null = null;
export function setHostTextures(keys: string[] | null) { hostTextures = keys ? new Set(keys) : null }
export const textureHost = {
  take(key: string, w: number, h: number): RecCanvas | null {
    if (!hostTextures || !hostTextures.has(key)) return null;
    const c = new RecCanvas(); c.width = w; c.height = h; c.push(['ext', key]); return c;
  },
  keep(key: string, c: any) { if (!hostTextures || !(c instanceof RecCanvas)) return; c.settle(); c.push(['keep', key]) },
};
