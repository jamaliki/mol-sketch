/* Antialiased clipping for OffscreenCanvas. Chrome antialiases clip() on a page's canvas but not on an OffscreenCanvas
   (in a worker or not), so the drawing worker's frames had hard, stair-stepped edges wherever the engine clips: the
   hatching inside every stick and ball, a watercolour pool's granulation. The page, the CLI and the Python package all
   draw those edges antialiased.

   Here clip() works the way a page canvas does it, as coverage. The pixels under the clip's bounds are kept, drawing
   goes on under a pixel-aligned box clip (which has no edge to antialias), and the restore() that ends the clip blends
   the old and the new pixels (premultiplied) through the path's antialiased mask c:
       result = before · (1 − c) + after · c
   which, as every composite operation is linear in its coverage, is what drawing each mark with its coverage scaled
   by c gives, up to 8-bit rounding. A clip made without a save() to end it, or on a path drawn under more than one
   transform, is left to the canvas. So are all clips while `setAAClips(false)`: a frame drawn while the view moves,
   where nobody sees a clip's edge, is drawn at the canvas's own speed. */

type Rec = { ops: number[]; x0: number; y0: number; x1: number; y1: number; moved: boolean };
type Clip = { depth: number; x: number; y: number; w: number; h: number; before: ImageData; path: Path2D; m: DOMMatrix; rule: CanvasFillRule };
type Ctx = OffscreenCanvasRenderingContext2D & { __rec?: Rec; __depth?: number; __clips?: Clip[]; __mask?: OffscreenCanvas };

let ON = true;
export function setAAClips(on: boolean) { ON = on }

const MOVE = 0, LINE = 1, CLOSE = 2, ARC = 3, ARCTO = 4, ELLIPSE = 5, RECT = 6, BEZIER = 7, QUAD = 8, ROUNDRECT = 9;
const recOf = (c: Ctx): Rec => c.__rec || (c.__rec = { ops: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, moved: false });
const grow = (r: Rec, x: number, y: number, e = 0) => { if (x - e < r.x0) r.x0 = x - e; if (x + e > r.x1) r.x1 = x + e; if (y - e < r.y0) r.y0 = y - e; if (y + e > r.y1) r.y1 = y + e };

/** the path as recorded, as a Path2D in the coordinates it was drawn in */
function pathOf(r: Rec): Path2D {
  const p = new Path2D(), o = r.ops;
  for (let i = 0; i < o.length;) {
    switch (o[i++]) {
      case MOVE: p.moveTo(o[i++], o[i++]); break;
      case LINE: p.lineTo(o[i++], o[i++]); break;
      case CLOSE: p.closePath(); break;
      case ARC: p.arc(o[i++], o[i++], o[i++], o[i++], o[i++], !!o[i++]); break;
      case ARCTO: p.arcTo(o[i++], o[i++], o[i++], o[i++], o[i++]); break;
      case ELLIPSE: p.ellipse(o[i++], o[i++], o[i++], o[i++], o[i++], o[i++], o[i++], !!o[i++]); break;
      case RECT: p.rect(o[i++], o[i++], o[i++], o[i++]); break;
      case BEZIER: p.bezierCurveTo(o[i++], o[i++], o[i++], o[i++], o[i++], o[i++]); break;
      case QUAD: p.quadraticCurveTo(o[i++], o[i++], o[i++], o[i++]); break;
      case ROUNDRECT: p.roundRect(o[i++], o[i++], o[i++], o[i++], o[i++]); break;
    }
  }
  return p;
}

/** a scratch canvas for the masks, per context, at least w × h, cleared */
function scratch(c: Ctx, w: number, h: number) {
  let o = c.__mask; if (!o) o = c.__mask = new OffscreenCanvas(w, h);
  if (o.width < w || o.height < h) { o.width = Math.max(o.width, w); o.height = Math.max(o.height, h) }
  const x = o.getContext('2d', { willReadFrequently: true })!; x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, w, h);
  return x;
}

export function installAAClips(P: any = (globalThis as any).OffscreenCanvasRenderingContext2D?.prototype) {
  if (!P || P.__aaclips) return; P.__aaclips = true;
  const N: Record<string, Function> = {};
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'bezierCurveTo', 'quadraticCurveTo', 'clip', 'save', 'restore', 'reset',
    'setTransform', 'transform', 'translate', 'scale', 'rotate', 'resetTransform']) N[k] = P[k];
  P.beginPath = function (this: Ctx) { N.beginPath.call(this); const r = this.__rec; if (r) { r.ops.length = 0; r.x0 = r.y0 = Infinity; r.x1 = r.y1 = -Infinity; r.moved = false } };
  P.moveTo = function (this: Ctx, x: number, y: number) { N.moveTo.call(this, x, y); const r = recOf(this); r.ops.push(MOVE, x, y); grow(r, x, y) };
  P.lineTo = function (this: Ctx, x: number, y: number) { N.lineTo.call(this, x, y); const r = recOf(this); r.ops.push(LINE, x, y); grow(r, x, y) };
  P.closePath = function (this: Ctx) { N.closePath.call(this); recOf(this).ops.push(CLOSE) };
  P.arc = function (this: Ctx, x: number, y: number, rad: number, a0: number, a1: number, ccw?: boolean) { N.arc.call(this, x, y, rad, a0, a1, ccw); const r = recOf(this); r.ops.push(ARC, x, y, rad, a0, a1, ccw ? 1 : 0); grow(r, x, y, Math.abs(rad)) };
  P.arcTo = function (this: Ctx, x1: number, y1: number, x2: number, y2: number, rad: number) { N.arcTo.call(this, x1, y1, x2, y2, rad); const r = recOf(this); r.ops.push(ARCTO, x1, y1, x2, y2, rad); grow(r, x1, y1); grow(r, x2, y2) };
  P.ellipse = function (this: Ctx, x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean) { N.ellipse.call(this, x, y, rx, ry, rot, a0, a1, ccw); const r = recOf(this); r.ops.push(ELLIPSE, x, y, rx, ry, rot, a0, a1, ccw ? 1 : 0); grow(r, x, y, Math.max(Math.abs(rx), Math.abs(ry))) };
  P.rect = function (this: Ctx, x: number, y: number, w: number, h: number) { N.rect.call(this, x, y, w, h); const r = recOf(this); r.ops.push(RECT, x, y, w, h); grow(r, x, y); grow(r, x + w, y + h) };
  P.roundRect = function (this: Ctx, x: number, y: number, w: number, h: number, rr: any) { N.roundRect.call(this, x, y, w, h, rr); const r = recOf(this); if (typeof rr === 'number' || rr === undefined) { r.ops.push(ROUNDRECT, x, y, w, h, rr || 0); grow(r, x, y); grow(r, x + w, y + h) } else r.moved = true };
  P.bezierCurveTo = function (this: Ctx, a: number, b: number, c: number, d: number, x: number, y: number) { N.bezierCurveTo.call(this, a, b, c, d, x, y); const r = recOf(this); r.ops.push(BEZIER, a, b, c, d, x, y); grow(r, a, b); grow(r, c, d); grow(r, x, y) };
  P.quadraticCurveTo = function (this: Ctx, a: number, b: number, x: number, y: number) { N.quadraticCurveTo.call(this, a, b, x, y); const r = recOf(this); r.ops.push(QUAD, a, b, x, y); grow(r, a, b); grow(r, x, y) };
  // a transform changed while a path is being made: the path is no longer in one coordinate system, and its clip is the canvas's
  for (const k of ['setTransform', 'transform', 'translate', 'scale', 'rotate', 'resetTransform']) P[k] = function (this: Ctx, ...a: any[]) { N[k].apply(this, a); const r = this.__rec; if (r && r.ops.length) r.moved = true };
  P.save = function (this: Ctx) { N.save.call(this); this.__depth = (this.__depth || 0) + 1 };
  P.restore = function (this: Ctx) {
    const d = this.__depth || 0, cl = this.__clips;
    if (cl) while (cl.length && cl[cl.length - 1].depth >= d) finish(this, cl.pop()!);
    N.restore.call(this); this.__depth = Math.max(0, d - 1);
  };
  P.reset = function (this: Ctx) { N.reset.call(this); this.__depth = 0; this.__clips = []; P.beginPath.call(this) };
  const native = (c: Ctx, a: any, b: any) => a === undefined ? N.clip.call(c) : b === undefined ? N.clip.call(c, a) : N.clip.call(c, a, b);   // (clip(undefined, undefined) would be the Path2D overload)
  P.clip = function (this: Ctx, a?: any, b?: any) {
    const r = this.__rec, depth = this.__depth || 0;
    if (!ON || a instanceof Path2D || !r || !r.ops.length || r.moved || !depth) return native(this, a, b);
    const rule: CanvasFillRule = a === 'evenodd' ? 'evenodd' : 'nonzero';
    const m = this.getTransform(), W = this.canvas.width, H = this.canvas.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) { const X = m.a * px + m.c * py + m.e, Y = m.b * px + m.d * py + m.f; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y }
    const x = Math.max(0, Math.floor(x0) - 1), y = Math.max(0, Math.floor(y0) - 1), w = Math.min(W, Math.ceil(x1) + 1) - x, h = Math.min(H, Math.ceil(y1) + 1) - y;
    if (!(w > 0 && h > 0)) return native(this, a, b);   // nothing of it on the canvas: no edge to soften
    const cl = this.__clips || (this.__clips = []);
    const before = this.getImageData(x, y, w, h);
    const box = new Path2D(); box.rect(x, y, w, h);
    N.setTransform.call(this, 1, 0, 0, 1, 0, 0); N.clip.call(this, box); N.setTransform.call(this, m);
    cl.push({ depth, x, y, w, h, before, path: pathOf(r), m, rule });
  };

  /** the end of a clip: what was drawn since, blended into what was there through the clip's antialiased mask */
  function finish(c: Ctx, k: Clip) {
    const { x, y, w, h, before, path, m, rule } = k;
    const mx = scratch(c, w, h); N.setTransform.call(mx, m.a, m.b, m.c, m.d, m.e - x, m.f - y); mx.fillStyle = '#000'; mx.fill(path, rule);
    const M = mx.getImageData(0, 0, w, h).data, A = c.getImageData(x, y, w, h).data, B = before.data;
    for (let i = 0; i < M.length; i += 4) {
      const cv = M[i + 3]; if (cv === 255) continue;   // inside: what was drawn stands
      if (cv === 0) { A[i] = B[i]; A[i + 1] = B[i + 1]; A[i + 2] = B[i + 2]; A[i + 3] = B[i + 3]; continue }   // outside: what was there
      const t = cv / 255, ba = B[i + 3] * (1 - t), aa = A[i + 3] * t, oa = ba + aa;   // premultiplied: alpha-weighted
      if (oa <= 0) { A[i] = A[i + 1] = A[i + 2] = A[i + 3] = 0; continue }
      A[i] = (B[i] * ba + A[i] * aa) / oa; A[i + 1] = (B[i + 1] * ba + A[i + 1] * aa) / oa; A[i + 2] = (B[i + 2] * ba + A[i + 2] * aa) / oa; A[i + 3] = oa;
    }
    c.putImageData(new ImageData(A, w, h), x, y);
  }
}
