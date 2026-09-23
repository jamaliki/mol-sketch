/* A recording 2D canvas for the headless core: the engine draws on it exactly as on a browser canvas, and every call
   becomes an op in its canvas's list. The host (the Python SDK) replays the lists in Skia, the rasteriser Chrome's
   canvas uses. Validation follows the canvas spec as Chrome implements it, so what is recorded is what Chrome would
   have drawn: an out-of-range globalAlpha or a non-finite coordinate is ignored here, not passed on.

   Ops (arrays, first element the name):
     size w h                       the canvas was (re)sized: a fresh, transparent bitmap, state reset
     set key value                  a state property (fillStyle, lineWidth, font, …); patterns as {pat, snap, rep, m}
     m a b c d e f                  the current transform, after any transform call
     save / restore
     begin / close / M x y / L x y / Q cx cy x y / C c1x c1y c2x c2y x y / A x y r a0 a1 ccw / E … / R x y w h
     fill rule / stroke / clip rule
     fillRect x y w h / strokeRect … / clearRect …
     text kind(fill|stroke) s x y [maxWidth]
     img id snap … (the 2, 4 or 8 drawImage numbers)          snap: the source's op count at the time */

type Op = (string | number | boolean | object | null)[];
let nextId = 1;
/* Runs of moveTo / lineTo / closePath, the bulk of a large drawing, do not become one op each: their points go into
   one float32 stream and their verbs (Skia's: 0 move, 1 line, 5 close) into one byte stream, and the run into one op
     P pointIndex pointCount verbIndex verbCount continues
   `continues`: the run's first verb is a line from the current point, so the host extends the path's last contour
   with it rather than starting one (the run is stored with a move to that first point, which the host turns into a
   line). The host takes both streams as binary after the render. */
let PTS: number[] = [], VBS: number[] = [];
export function takeStreams() { const p = new Float32Array(PTS), v = new Uint8Array(VBS); PTS = []; VBS = []; return { points: p, verbs: v } }
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
  // the path as Skia would hold it: is there a current point, was the last verb a close, where did the contour start
  private hasCur = false; private closed = false; private start: [number, number] | null = null;
  private run: { p: number; v: number; cont: boolean } | null = null;
  constructor(public canvas: RecCanvas) { }
  reset() { this.s = fresh(); this.stack = []; this.newPath() }
  private newPath() { this.hasCur = false; this.closed = false; this.start = null }
  /** end the current run of moves and lines as one P op */
  settle() { const r = this.run; if (!r) return; this.run = null; this.canvas.push(['P', r.p / 2, (PTS.length - r.p) / 2, r.v, VBS.length - r.v, r.cont]) }
  private op(...o: Op) { this.settle(); this.canvas.push(o) }
  private runVerb(verb: number, x?: number, y?: number) {
    if (!this.run) { this.run = { p: PTS.length, v: VBS.length, cont: verb === 1 }; if (verb === 1) verb = 0 }   // a continuing run starts with a move the host turns into a line
    VBS.push(verb); if (x !== undefined) PTS.push(x, y!);
  }
  private setProp(k: keyof State, v: any, rec: any = v) { (this.s as any)[k] = v; this.op('set', k, rec) }

  /* state */
  get fillStyle() { return this.s.fillStyle } set fillStyle(v: any) { this.style('fillStyle', v) }
  get strokeStyle() { return this.s.strokeStyle } set strokeStyle(v: any) { this.style('strokeStyle', v) }
  private style(k: 'fillStyle' | 'strokeStyle', v: any) {
    if (v instanceof Pattern) this.setProp(k, v, { pat: v.id, snap: v.snap, rep: v.rep, m: v.m });
    else if (typeof v === 'string') this.setProp(k, v);   // the host parses; an unparsable colour is ignored there, as in Chrome
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
  private setM(m: M6) { this.s.m = m; this.op('m', ...m) }
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
  closePath() { if (!this.hasCur) return; if (this.run) this.runVerb(5); else this.op('close'); this.closed = true }   // closing nothing does nothing
  moveTo(x: number, y: number) { if (!fin(x, y)) return; this.runVerb(0, x, y); this.hasCur = true; this.closed = false; this.start = [x, y] }
  lineTo(x: number, y: number) {
    if (!fin(x, y)) return;
    if (!this.hasCur) return this.moveTo(x, y);   // no current point: a move, as Blink does
    if (this.closed) {   // after a close the line starts a new contour at the old one's start (Skia's injected move)
      if (!this.start) { this.op('L', x, y); this.closed = false; return }   // a contour an arc began: its start is Skia's to compute
      this.runVerb(0, this.start[0], this.start[1]); this.closed = false }
    this.runVerb(1, x, y);
  }
  private curve() { this.hasCur = true; this.closed = false; if (!this.start) this.start = null }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) { if (fin(cx, cy, x, y)) { const fresh = !this.hasCur; this.op('Q', cx, cy, x, y); if (fresh || this.closed) this.start = null; this.curve() } }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { if (fin(a, b, c, d, x, y)) { const fresh = !this.hasCur; this.op('C', a, b, c, d, x, y); if (fresh || this.closed) this.start = null; this.curve() } }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
    if (!fin(x, y, r, a0, a1)) return; if (r < 0) throw new RangeError("IndexSizeError: arc radius is negative"); const fresh = !this.hasCur || this.closed; this.op('A', x, y, r, a0, a1, !!ccw); if (fresh) this.start = null; this.curve() }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    if (!fin(x, y, rx, ry, rot, a0, a1)) return; if (rx < 0 || ry < 0) throw new RangeError('IndexSizeError: ellipse radius is negative'); const fresh = !this.hasCur || this.closed; this.op('E', x, y, rx, ry, rot, a0, a1, !!ccw); if (fresh) this.start = null; this.curve() }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) { if (!fin(x1, y1, x2, y2, r)) return; if (r < 0) throw new RangeError('IndexSizeError'); const fresh = !this.hasCur || this.closed; this.op('T', x1, y1, x2, y2, r); if (fresh) this.start = null; this.curve() }
  rect(x: number, y: number, w: number, h: number) { if (fin(x, y, w, h)) { this.op('R', x, y, w, h); this.hasCur = true; this.closed = true; this.start = [x, y] } }   // a closed contour from (x, y)
  fill(rule: string = 'nonzero') { this.op('fill', rule === 'evenodd' ? 'evenodd' : 'nonzero') }
  stroke() { this.op('stroke') }
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
    img.settle(); this.op('img', img.id, img.total, ...n);
  }
  createPattern(img: any, rep: string | null) {
    if (!(img instanceof RecCanvas)) throw new TypeError('createPattern: only canvases headless');
    img.settle(); return new Pattern(img.id, img.total, rep || 'repeat');
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
