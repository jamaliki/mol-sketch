/* A recording 2D canvas for the headless core: the engine draws on it exactly as on a browser canvas, and every call
   becomes an op in its canvas's list. The host (the Python SDK) replays the lists in Skia, the rasteriser Chrome's
   canvas uses. Validation follows the canvas spec as Chrome implements it, so what is recorded is what Chrome would
   have drawn: an out-of-range globalAlpha or a non-finite coordinate is ignored here, not passed on.

   Ops (arrays, first element the name):
     size w h                       the canvas was (re)sized: a fresh, transparent bitmap, state reset
     S key value [key value …]      state properties (fillStyle, lineWidth, font, …); colours as [r, g, b, a], patterns as {pat, snap, rep, m}
     m a b c d e f                  the current transform, after any transform call
     save / restore
     begin / close / M x y / L x y / Q cx cy x y / C c1x c1y c2x c2y x y / A x y r a0 a1 ccw / E … / R x y w h
     fill rule / stroke / clip rule
     fillRect x y w h / strokeRect … / clearRect …
     text kind(fill|stroke) s x y [maxWidth]
     img id snap … (the 2, 4 or 8 drawImage numbers)          snap: the source's op count at the time */

import { arcTo, type ArcSink } from './skarc';

type Op = (string | number | boolean | object | null)[];
let nextId = 1;
/* Paths, the bulk of a large drawing, do not become one op per call: moves, lines, curves, closes and arcs (as the
   conics Skia's arcTo makes of them, skarc.ts) go into a float32 point stream, a verb stream (Skia's: 0 move, 1 line,
   2 quad, 3 conic, 4 cubic, 5 close) and a conic-weight stream, and each run of them into one op
     P pointIndex pointCount verbIndex verbCount continues weightIndex weightCount
   `continues`: the run carries on the path's last contour; it starts with a move to the current point, which the
   host's extend joins without a line. The host takes the streams as binary after the render. What the recorder cannot
   follow exactly (a turned ellipse, arcTo, anything after a transform moved the path) stays an op for the host. */
class Stream<T extends Float32Array | Uint8Array> {
  n = 0;
  constructor(public a: T) { }
  push(v: number) { if (this.n === this.a.length) this.grow(); this.a[this.n++] = v }
  push2(x: number, y: number) { if (this.n + 2 > this.a.length) this.grow(); this.a[this.n++] = x; this.a[this.n++] = y }
  private grow() { const b = new (this.a.constructor as any)(this.a.length * 2); b.set(this.a); this.a = b }
  take(): T { const r = this.a.slice(0, this.n) as T; this.n = 0; return r }
}
const PTS = new Stream(new Float32Array(1 << 16)), VBS = new Stream(new Uint8Array(1 << 15)), WTS = new Stream(new Float32Array(1 << 12));
export function takeStreams() { return { points: PTS.take(), verbs: VBS.take(), weights: WTS.take() } }
const f32 = Math.fround;

/** a CSS colour as float RGBA (0..1), as the host parses it (python/molsketch/_raster.py parse_color): #hex and
   rgb()/rgba() here; anything else (a named colour) stays a string for the host; null if Chrome would ignore it */
const HEX = /^[0-9a-f]+$/, RGB = /^rgba?\(\s*([^)]*)\)$/;
function parseColor(str: string): number[] | string | null {
  const s = str.trim().toLowerCase();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if ((h.length !== 6 && h.length !== 8) || !HEX.test(h)) return null;
    const v = [0, 2, 4, 6].slice(0, h.length / 2).map(i => parseInt(h.slice(i, i + 2), 16));
    return [v[0] / 255, v[1] / 255, v[2] / 255, v.length === 4 ? v[3] / 255 : 1];
  }
  const m = RGB.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const num = (p: string) => /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(p) ? Number(p) : NaN;
    const ch = parts.slice(0, 3).map(p => p.endsWith('%') ? num(p.slice(0, -1)) * 2.55 : num(p));
    const a = parts.length === 4 ? (parts[3].endsWith('%') ? num(parts[3].slice(0, -1)) / 100 : num(parts[3])) : 1;
    if (ch.some(isNaN) || isNaN(a)) return str;   // an unusual number: the host's own parser decides
    const c = ch.map(x => Math.min(255, Math.max(0, roundHalfEven(x))));   // Blink rounds the channels to integers
    return [c[0] / 255, c[1] / 255, c[2] / 255, Math.min(1, Math.max(0, a))];
  }
  return s === 'transparent' ? [0, 0, 0, 0] : str;
}
/** Python's round(): halves to even */
function roundHalfEven(x: number) { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r }
export const canvases = new Map<number, RecCanvas>();
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
  constructor(public id: number, public snap: number, public rep: string) { }
  setTransform(t?: DOMMatrix) { this.m = t ? [t.a, t.b, t.c, t.d, t.e, t.f] : [1, 0, 0, 1, 0, 0] }
}

interface State { m: M6; fillStyle: any; strokeStyle: any; lineWidth: number; lineCap: string; lineJoin: string; miterLimit: number; globalAlpha: number;
  globalCompositeOperation: string; font: string; textAlign: string; textBaseline: string; filter: string; imageSmoothingEnabled: boolean; lineDash: number[]; lineDashOffset: number }
const fresh = (): State => ({ m: [1, 0, 0, 1, 0, 0], fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
  globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', filter: 'none', imageSmoothingEnabled: true, lineDash: [], lineDashOffset: 0 });

export class RecCanvas {
  id: number; private w = 300; private h = 150; ops: Op[] = []; total = 0; private ctx: RecContext | null = null;
  constructor() { this.id = nextId++; canvases.set(this.id, this); this.push(['size', 300, 150]) }
  /** the op count when another canvas last took this one's picture: ops before it are never rewritten */
  frozen = 0;
  push(op: Op) { this.ops.push(op); this.total++ }
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
  private run: { p: number; v: number; w: number; cont: boolean; moveAt: number } | null = null;   // moveAt: the run's trailing move, or -1
  constructor(public canvas: RecCanvas) { }
  reset() { this.s = fresh(); this.stack = []; this.newPath() }
  private newPath() { this.hasCur = false; this.closed = false; this.hasStart = false; this.hasLast = false }
  /** end the current run of path verbs as one P op */
  settle() {
    const r = this.run; if (!r) return; this.run = null;
    this.canvas.push(['P', r.p / 2, (PTS.n - r.p) / 2, r.v, VBS.n - r.v, r.w, WTS.n - r.w, r.cont]);
  }
  private op(...o: Op) { this.settle(); this.canvas.push(o) }
  /** an op the host builds the path with itself: what it leaves is unknown here */
  private hostOp(fresh: boolean, ...o: Op) { this.op(...o); this.hasCur = true; this.closed = false; this.hasLast = false; if (fresh) this.hasStart = false }
  private newRun(cont: boolean) { this.run = { p: PTS.n, v: VBS.n, w: WTS.n, cont, moveAt: -1 } }
  /** Skia's moveTo: a move after a move replaces it */
  private emitMove(x: number, y: number) {
    x = f32(x); y = f32(y);
    if (this.run && this.run.moveAt >= 0) { PTS.a[this.run.moveAt] = x; PTS.a[this.run.moveAt + 1] = y }
    else { if (!this.run) this.newRun(false); this.run!.moveAt = PTS.n; VBS.push(0); PTS.push2(x, y) }
    this.hasCur = true; this.closed = false; this.hasStart = this.hasLast = true; this.sx = this.lx = x; this.sy = this.ly = y;
  }
  /** a drawing verb (1 line, 2 quad, 3 conic, 4 cubic) from the current point; callers make sure `last` (and after a
     close, `start`) is known. After a close Skia first moves to the contour's start; a run that continues a contour
     begins with a move to the current point, which the host's extend joins without a line */
  private before() {
    if (this.closed) { if (this.run) this.run.moveAt = -1; this.emitMove(this.sx, this.sy) }
    else if (!this.run) { this.newRun(true); VBS.push(0); PTS.push2(this.lx, this.ly) }
    this.run!.moveAt = -1; this.hasCur = true; this.closed = false;
  }
  private emitEnd(x: number, y: number) { PTS.push2(x, y); this.lx = PTS.a[PTS.n - 2]; this.ly = PTS.a[PTS.n - 1]; this.hasLast = true }
  private emitLine(x: number, y: number) { this.before(); VBS.push(1); this.emitEnd(x, y) }
  private emitQuad(a: number, b: number, x: number, y: number) { this.before(); VBS.push(2); PTS.push2(a, b); this.emitEnd(x, y) }
  private emitConic(a: number, b: number, x: number, y: number, w: number) { this.before(); VBS.push(3); WTS.push(w); PTS.push2(a, b); this.emitEnd(x, y) }
  private emitCubic(a: number, b: number, c: number, d: number, x: number, y: number) { this.before(); VBS.push(4); PTS.push2(a, b); PTS.push2(c, d); this.emitEnd(x, y) }
  /** can the next drawing verb be recorded here (the points it starts from are known)? */
  private get knows() { return !this.hasCur || (this.hasLast && (!this.closed || this.hasStart)) }
  /** a state property: consecutive ones share one op, S key value key value … */
  private setProp(k: keyof State, v: any, rec: any = v) {
    (this.s as any)[k] = v; this.settle();
    const ops = this.canvas.ops, last = ops[ops.length - 1];
    if (last && last[0] === 'S') last.push(k, rec); else this.canvas.push(['S', k, rec]);
  }

  /* state */
  get fillStyle() { return this.s.fillStyle } set fillStyle(v: any) { this.style('fillStyle', v) }
  get strokeStyle() { return this.s.strokeStyle } set strokeStyle(v: any) { this.style('strokeStyle', v) }
  private style(k: 'fillStyle' | 'strokeStyle', v: any) {
    if (v instanceof Pattern) this.setProp(k, v, { pat: v.id, snap: v.snap, rep: v.rep, m: v.m });
    else if (typeof v === 'string') { const c = parseColor(v); if (c !== null) this.setProp(k, v, c) }   // an unparsable colour is ignored, as in Chrome
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
  save() { this.stack.push({ ...this.s, lineDash: [...this.s.lineDash] }); this.op('save') }
  restore() { const t = this.stack.pop(); if (!t) return; this.s = t; this.op('restore') }

  /* transform: the op carries the whole matrix, composed here in doubles as Chrome does */
  private setM(m: M6) { this.s.m = m; this.op('m', ...m); if (this.hasCur) this.hasLast = this.hasStart = false }   // the host moves the path into the new space
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
    if (this.run) { VBS.push(5); this.run.moveAt = -1 } else this.op('close');
    this.closed = true;
  }
  moveTo(x: number, y: number) { if (fin(x, y)) this.emitMove(x, y) }
  lineTo(x: number, y: number) {
    if (!fin(x, y)) return;
    if (!this.hasCur) return this.moveTo(x, y);   // no current point: a move, as Blink does
    if (!this.knows) { this.op('L', x, y); this.closed = false; this.hasLast = true; this.lx = f32(x); this.ly = f32(y); return }   // the host knows where it is
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
    VBS.push(5); this.closed = true;
  }
  fill(rule: string = 'nonzero') { const eo = rule === 'evenodd'; if (!this.fuse(eo ? 1 : 0)) this.op('fill', eo ? 'evenodd' : 'nonzero') }
  stroke() { if (!this.fuse(2)) this.op('stroke') }
  /** the common case, a path begun, made in one run and drawn (with only state set in between), as one op, and
     such draws one after another in the same state as one op too:
       F mode (0 fill, 1 even-odd fill, 2 stroke) then, per path, pointIndex pointCount verbIndex verbCount weightIndex weightCount */
  private fuse(mode: number) {
    this.settle();
    const c = this.canvas, ops = c.ops; let j = ops.length - 1;
    while (j >= 0 && ops[j][0] === 'S') j--;
    const pi = j; if (pi < 0 || ops[pi][0] !== 'P' || ops[pi][7]) return false;
    j--; while (j >= 0 && ops[j][0] === 'S') j--;
    const bi = j, at = c.total - ops.length;   // the op count at ops[0]
    if (bi < 0 || ops[bi][0] !== 'begin' || at + bi < c.frozen) return false;
    const P = ops[pi], sets = ops.slice(bi + 1, pi).concat(ops.slice(pi + 1)), run = [P[1], P[2], P[3], P[4], P[5], P[6]];
    const prev = ops[bi - 1];
    if (!sets.length && prev && prev[0] === 'F' && prev[1] === mode && at + bi - 1 >= c.frozen) {   // the same draw again: join it
      ops.length = bi; for (const v of run) prev.push(v); c.total -= 2; return true;
    }
    ops.length = bi; for (const o of sets) ops.push(o);
    ops.push(['F', mode, ...run]);
    c.total -= 1;   // begin and P became F
    return true;
  }
  clip(rule: string = 'nonzero') { this.op('clip', rule === 'evenodd' ? 'evenodd' : 'nonzero') }
  fillRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) this.op('fillRect', x, y, w, h) }
  strokeRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) this.op('strokeRect', x, y, w, h) }
  clearRect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) this.op('clearRect', x, y, w, h) }

  /* text: shaped and drawn by the host; measured through it too */
  fillText(t: string, x: number, y: number, maxW?: number) { if (!fin(x, y) || (maxW !== undefined && !fin(maxW))) return; this.op('text', 'fill', String(t), x, y, maxW ?? null) }
  strokeText(t: string, x: number, y: number, maxW?: number) { if (!fin(x, y) || (maxW !== undefined && !fin(maxW))) return; this.op('text', 'stroke', String(t), x, y, maxW ?? null) }
  measureText(t: string) { return { width: measureFn(this.s.font, String(t)) } }

  /* images: other recording canvases, drawn as they were at this moment */
  drawImage(img: any, ...n: number[]) {
    if (!(img instanceof RecCanvas)) throw new TypeError('drawImage: only canvases can be drawn headless');
    if (!(n.length === 2 || n.length === 4 || n.length === 8) || !fin(...n)) return;
    if (img.width === 0 || img.height === 0) throw new Error('InvalidStateError: drawImage of an empty canvas');
    img.settle(); img.frozen = img.total; this.op('img', img.id, img.total, ...n);
  }
  createPattern(img: any, rep: string | null) {
    if (!(img instanceof RecCanvas)) throw new TypeError('createPattern: only canvases headless');
    img.settle(); img.frozen = img.total; return new Pattern(img.id, img.total, rep || 'repeat');
  }
  createLinearGradient(): never { throw new Error('gradients are not recorded headless') }
  createRadialGradient(): never { throw new Error('gradients are not recorded headless') }
}

/** the ops recorded since the last flush, per canvas, and forget them here (the host keeps them) */
export function flush(): Record<number, { start: number; ops: Op[] }> {
  for (const c of canvases.values()) c.settle();
  const out: Record<number, { start: number; ops: Op[] }> = {};
  for (const [id, c] of canvases) if (c.ops.length) { out[id] = { start: c.total - c.ops.length, ops: c.ops }; c.ops = [] }
  return out;
}
/** a canvas the host no longer needs (a finished frame): drop it */
export function release(id: number) { canvases.delete(id) }
export const document = { createElement(tag: string) { if (tag !== 'canvas') throw new Error('headless: only canvases'); return new RecCanvas() } };
