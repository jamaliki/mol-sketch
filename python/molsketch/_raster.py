"""Replay the core's recorded canvases in Skia, the rasteriser behind Chrome's canvas, following Chrome's canvas
implementation (Blink) where it makes choices: arc angles, transforms applied to a path under construction, float
colours with the global alpha folded in, linear image sampling, the paper's blur filter."""
from __future__ import annotations

import functools
import json
import math
import re
import struct

import numpy as np
import skia

from ._blur import blur as box_blur
from ._text import TextEngine

TWO_PI = 2 * math.pi
BLEND = {
    "source-over": skia.BlendMode.kSrcOver, "source-in": skia.BlendMode.kSrcIn, "source-out": skia.BlendMode.kSrcOut,
    "source-atop": skia.BlendMode.kSrcATop, "destination-over": skia.BlendMode.kDstOver, "destination-in": skia.BlendMode.kDstIn,
    "destination-out": skia.BlendMode.kDstOut, "destination-atop": skia.BlendMode.kDstATop, "lighter": skia.BlendMode.kPlus,
    "copy": skia.BlendMode.kSrc, "xor": skia.BlendMode.kXor, "multiply": skia.BlendMode.kMultiply, "screen": skia.BlendMode.kScreen,
    "overlay": skia.BlendMode.kOverlay, "darken": skia.BlendMode.kDarken, "lighten": skia.BlendMode.kLighten,
    "color-dodge": skia.BlendMode.kColorDodge, "color-burn": skia.BlendMode.kColorBurn, "hard-light": skia.BlendMode.kHardLight,
    "soft-light": skia.BlendMode.kSoftLight, "difference": skia.BlendMode.kDifference, "exclusion": skia.BlendMode.kExclusion,
    "hue": skia.BlendMode.kHue, "saturation": skia.BlendMode.kSaturation, "color": skia.BlendMode.kColor, "luminosity": skia.BlendMode.kLuminosity,
}
CAP = {"butt": skia.Paint.kButt_Cap, "round": skia.Paint.kRound_Cap, "square": skia.Paint.kSquare_Cap}
JOIN = {"miter": skia.Paint.kMiter_Join, "round": skia.Paint.kRound_Join, "bevel": skia.Paint.kBevel_Join}
LINEAR = skia.SamplingOptions(skia.FilterMode.kLinear)
BLUR_SCALES = False   # a canvas filter's blur is in bitmap pixels, whatever the transform (measured against Chrome at dpr 2)
PROPS = skia.SurfaceProps(0, skia.PixelGeometry.kRGB_H_PixelGeometry)


_PAD = (b"", b"\0\0\0", b"\0\0", b"\0")


def _read_path(data) -> skia.Path:
    """a path from its serialised form (SkPath version 5, as the recorder writes it)"""
    path = skia.Path()
    if path.readFromMemory(data) == 0: path = _build_path(bytes(data))   # a Skia that reads it differently
    return path


def _build_path(data: bytes) -> skia.Path:
    _, n, nw, nv = struct.unpack_from("<4i", data)
    p = list(struct.unpack_from(f"<{2 * n}f", data, 16)); w = struct.unpack_from(f"<{nw}f", data, 16 + 8 * n); vb = data[16 + 8 * n + 4 * nw:16 + 8 * n + 4 * nw + nv]
    path = skia.Path(); k = j = 0
    for v in vb:
        if v == 0: path.moveTo(p[k], p[k + 1]); k += 2
        elif v == 1: path.lineTo(p[k], p[k + 1]); k += 2
        elif v == 2: path.quadTo(*p[k:k + 4]); k += 4
        elif v == 3: path.conicTo(*p[k:k + 4], w[j]); k += 4; j += 1
        elif v == 4: path.cubicTo(*p[k:k + 6]); k += 6
        else: path.close()
    return path


def _from_parts(pts: list, wts: list, vbs: list, n: int, nw: int, nv: int) -> skia.Path:
    path = skia.Path()
    if nv: path.readFromMemory(struct.pack("<4i", 5, n, nw, nv) + b"".join(pts) + b"".join(wts) + b"".join(vbs) + _PAD[nv % 4])
    return path


def _reopened(path: skia.Path):
    """the path's closed contours with each close made a line back to its start, and its open contours, worked on the
    path's binary form (Skia's verbs: 0 move, 1 line, 2 quad, 3 conic, 4 cubic, 5 close; a close ends its contour)"""
    data = bytes(path.serialize()); _, npts, ncon, nvb = struct.unpack_from("<4i", data)
    W = 16 + 8 * npts; V = W + 4 * ncon
    pts = data[16:W]; wts = data[W:V]; vb = data[V:V + nvb]
    if vb.count(0) == 1 and vb[-1] == 5:   # the usual case: one closed contour
        return _from_parts([pts, pts[:8]], [wts], [vb.replace(b"\5", b"\1")], npts + 1, ncon, nvb), skia.Path()
    parts = ([], [], [], [0, 0, 0]), ([], [], [], [0, 0, 0])   # closed, open: points, weights, verbs, counts
    i = k = w = 0
    while i < nvb:   # one contour at a time
        j = vb.find(b"\0", i + 1)
        if j < 0: j = nvb
        cv = vb[i:j]; n = cv.count(0) + cv.count(1) + 2 * (cv.count(2) + cv.count(3)) + 3 * cv.count(4); nc = cv.count(3)
        cp = pts[k:k + 8 * n]; cw = wts[w:w + 4 * nc]
        P, Wt, Vb, cnt = parts[0] if 5 in cv else parts[1]
        if 5 in cv: P += [cp, cp[:8]]; Vb.append(cv.replace(b"\5", b"\1")); cnt[0] += n + 1
        else: P.append(cp); Vb.append(cv); cnt[0] += n
        Wt.append(cw); cnt[1] += nc; cnt[2] += len(cv)
        k += 8 * n; w += 4 * nc; i = j
    return tuple(_from_parts(P, Wt, Vb, *cnt) for P, Wt, Vb, cnt in parts)


_CHANGES_PATH = frozenset(("P", "L", "M", "close", "A", "Q", "C", "E", "T", "R"))   # ops that change the current path


@functools.lru_cache(1024)
def _treat_as_hairline(m, w):
    fast = lambda x, y: max(abs(x), abs(y)) + min(abs(x), abs(y)) / 2
    return fast(m[0] * w, m[1] * w) <= 1 and fast(m[2] * w, m[3] * w) <= 1


def _mat(m):
    return skia.Matrix.MakeAll(m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1)


class _Live:
    """a canvas as the host keeps it: its pixels so far, the replay drawing on them (and the transform it holds), and
    the ops received but not drawn yet"""
    __slots__ = ("cid", "surface", "replay", "q", "i", "n")

    def __init__(self, cid: int):
        self.cid = cid; self.surface = None; self.replay = None; self.q: list = []; self.i = 0; self.n = 0


class Raster:
    """the recorded canvases, drawn as their ops arrive (in chunks, while the engine is still drawing). A canvas
    another one draws or patterns with is snapshot where the recording marks it; the engine's long-lived canvases (the
    paper) stay, the ones it drops go"""

    def __init__(self, text: TextEngine):
        self.live: dict[int, _Live] = {}
        self.snaps: dict[int, skia.Image | None] = {}         # snapshot id → the canvas as it was then
        self.snap_of: dict[int, list[int]] = {}                # canvas → its snapshots' ids
        self.shaders: dict[tuple, skia.Paint] = {}
        self.specs: dict[int, list] = {}                      # the recorder's paint table, by id (see canvas.ts)
        self.paints: dict[int, skia.Paint | None] = {}        # and the paints made from it
        self.templates: dict[tuple, skia.Paint] = {}         # paints without their colour, by the rest of the spec
        self.meta: dict[int, dict] = {}                        # what SVG needs of a paint that it does not tell: its pattern, its blur
        self.lazy = False                                      # draw canvases only when their pixels are needed (for SVG)
        self.text = text

    # ---- chunks in ----
    def feed(self, js: str | dict, runs: bytes):
        """take a chunk (see canvas.ts): its ops queued on their canvases, path runs read into Skia paths, then drawn"""
        d = json.loads(js) if isinstance(js, str) else js
        p = d["paints"]
        if p: self.specs.update(zip(p[0::2], p[1::2]))
        mv = memoryview(runs); fed = []
        for cid, c in d["canvases"].items():
            cid = int(cid); lv = self.live.get(cid)
            if lv is None: lv = self.live[cid] = _Live(cid)
            if c["start"] != lv.n: raise RuntimeError(f"canvas {cid}: ops out of order ({c['start']} after {lv.n})")
            ops = c["ops"]; lv.n += len(ops)
            for i, o in enumerate(ops):
                k = o[0]
                if k == "F": ops[i] = ("F", o[1], o[2], [(_read_path(mv[o[j]:o[j] + o[j + 1]]), o[j + 2]) for j in range(3, len(o), 3)])
                elif k == "P": ops[i] = ("P", _read_path(mv[o[1]:o[1] + o[2]]), o[3], o[4])
            if lv.i: lv.q = lv.q[lv.i:]; lv.i = 0
            lv.q.extend(ops); fed.append(lv)
        if not self.lazy:
            for lv in fed: self._pump(lv)
        for cid in d["dead"]: self.drop(cid)

    def _pump(self, lv: _Live, until: int | None = None):
        """draw a canvas's queued ops (up to and including snapshot `until`)"""
        q = lv.q; end = len(q)
        if until is not None:
            end = next((j + 1 for j in range(lv.i, len(q)) if q[j][0] == "snap" and q[j][1] == until), None)
            if end is None: raise RuntimeError(f"canvas {lv.cid}: snapshot {until} was never recorded")
        while lv.i < end:
            o = q[lv.i]
            if o[0] == "size":   # a fresh, transparent bitmap, and fresh state
                w, h = o[1], o[2]; lv.i += 1
                lv.surface = skia.Surface.MakeRaster(skia.ImageInfo.MakeN32Premul(w, h), 0, PROPS) if w > 0 and h > 0 else None   # PROPS: Chrome's canvas text weight on the Mac
                lv.replay = _Replay(self, lv, lv.surface.getCanvas(), w, h) if lv.surface is not None else None
                continue
            if lv.replay is None:   # an empty canvas: nothing to draw, but its snapshots exist (empty)
                if o[0] == "snap": self._snapped(lv, o[1])
                lv.i += 1; continue
            lv.i = lv.replay.run(q, lv.i, end)

    def _snapped(self, lv: _Live, sid: int):
        self.snaps[sid] = lv.surface.makeImageSnapshot() if lv.surface is not None else None   # copy-on-write: free until drawn on
        self.snap_of.setdefault(lv.cid, []).append(sid)

    # ---- images out ----
    def snapshot(self, cid: int, sid: int) -> skia.Image | None:
        """canvas `cid` as snapshot `sid` recorded it (drawing its queued ops that far, if they are not yet)"""
        try: return self.snaps[sid]
        except KeyError: pass
        lv = self.live.get(cid)
        if lv is None: raise RuntimeError(f"snapshot {sid} of canvas {cid}: the canvas is gone")
        self._pump(lv, sid)
        return self.snaps[sid]

    def image(self, cid: int) -> skia.Image | None:
        """a canvas as it is, every op received drawn"""
        lv = self.live.get(cid)
        if lv is None: return None
        self._pump(lv)
        return lv.surface.makeImageSnapshot() if lv.surface is not None else None

    def vector(self, cid: int, scale: float = 1) -> str:
        """a canvas as SVG: its ops (none drawn yet: see ``lazy``) replayed onto an SVG canvas"""
        from ._svg import SvgCanvas
        lv = self.live.get(cid)
        if lv is None: raise RuntimeError(f"canvas {cid} is not here")
        q = lv.q; start = max((i for i in range(lv.i, len(q)) if q[i][0] == "size"), default=None)
        if start is None: raise RuntimeError("the canvas was drawn on before SVG was asked for")
        w, h = q[start][1], q[start][2]
        c = SvgCanvas(w, h, scale, meta=lambda p: self.meta.get(id(p)))
        rp = _Replay(self, lv, c, w, h); i = start + 1
        while i < len(q):
            i = rp.run(q, i, len(q))
            if i < len(q): i += 1   # a resize after drawing: SVG keeps what was drawn
        lv.i = len(q)
        return c.svg()

    def drop(self, cid: int):
        """a canvas gone: its pixels and snapshots"""
        self.live.pop(cid, None)
        for sid in self.snap_of.pop(cid, ()):
            self.snaps.pop(sid, None)
            for k in [k for k in self.shaders if k[1] == sid]: del self.shaders[k]

    def end_render(self):
        """the render's paints: no op still to draw refers to them"""
        for p in self.paints.values():
            if p is not None and p.__class__ is not tuple: self.meta.pop(id(p), None)
        self.specs.clear(); self.paints.clear()

    # ---- paints ----
    def paint(self, pid: int) -> skia.Paint | None:
        """the paint of an id, for a draw made now: a colour is set on its template's one paint (shared, so whoever keeps
        a paint copies it); None when a pattern has no pixels"""
        try: e = self.paints[pid]
        except KeyError: e = self.paints[pid] = self._make_paint(self.specs[pid])
        if e.__class__ is tuple:
            t, col, f4 = e
            if f4: t.setColor4f(col)
            else: t.setColor(col)
            return t
        return e

    def _make_paint(self, spec):
        kind = spec[0]
        if kind < 2:   # a colour, and the template for the rest of the spec (one paint per template, recoloured per draw)
            r, g, b, a, alpha, comp, filt = spec[1:8]; pen = spec[8:14] if kind == 1 else None
            r /= 255; g /= 255; b /= 255   # the recorder's channels are Blink's integers
            key = (comp, filt, (*pen[:4], tuple(pen[4]) if pen[4] else None, pen[5]) if pen else None)
            t = self.templates.get(key)
            if t is None:
                t = self.templates[key] = _finish(skia.Paint(AntiAlias=True), comp, filt, pen)
                if _blur_sigma(filt) is not None: self.meta[id(t)] = {"blur": _blur_sigma(filt)}
            # colour precision as Chrome's Skia blends: normal drawing keeps the colour in float; the other blend modes
            # (multiply, screen: watercolour and paper) run at 8 bits, so the colour is rounded there first (measured)
            if comp == "source-over": return (t, skia.Color4f(r, g, b, a * alpha), True)
            return (t, skia.Color(round(r * 255), round(g * 255), round(b * 255), round(a * alpha * 255)), False)
        pat, snap, rep, m, smooth, alpha, comp, filt = spec[1:9]; pen = spec[9:15] if kind == 3 else None
        # a pattern: the source canvas as snapshot `snap` holds it; the shader lives on a cached paint, since
        # skia-python's setShader on an image shader costs tens of milliseconds and copying a paint that holds one nothing
        key = (pat, snap, rep, tuple(m), smooth)
        sh = self.shaders.get(key)
        if sh is None:
            img = self.snapshot(pat, snap)
            if img is None: return None
            tile = skia.TileMode.kRepeat
            tx = tile if rep in ("repeat", "repeat-x") else skia.TileMode.kDecal
            ty = tile if rep in ("repeat", "repeat-y") else skia.TileMode.kDecal
            sh = self.shaders[key] = skia.Paint(AntiAlias=True, Shader=img.makeShader(tx, ty, LINEAR if smooth else skia.SamplingOptions(), _mat(m)))
            self.meta[id(sh)] = {"pattern": (img, rep, m)}
        p = skia.Paint(sh); p.setAlphaf(alpha)
        self.meta[id(p)] = dict(self.meta.get(id(sh), {}))
        p = _finish(p, comp, filt, pen)
        if _blur_sigma(filt) is not None: self.meta.setdefault(id(p), {})["blur"] = _blur_sigma(filt)
        return p


def _finish(p: skia.Paint, comp: str, filt: str, pen) -> skia.Paint:
    p.setBlendMode(BLEND[comp])
    if pen:
        w, cap, join, miter, dash, off = pen
        p.setStyle(skia.Paint.kStroke_Style); p.setStrokeWidth(w); p.setStrokeCap(CAP[cap]); p.setStrokeJoin(JOIN[join]); p.setStrokeMiter(miter)
        if dash: p.setPathEffect(skia.DashPathEffect.Make(dash, off))
    f = _filter(filt)
    if f is not None: p.setImageFilter(f)
    return p


def _blur_sigma(filt):
    m = re.fullmatch(r"blur\(\s*([\d.]+)px\s*\)", (filt or "").strip())
    return float(m.group(1)) if m else None


def _filter(filt):
    sigma = _blur_sigma(filt) if filt and filt != "none" else None
    return skia.ImageFilters.Blur(sigma, sigma) if sigma is not None else None


class _Replay:
    """one canvas's ops replayed onto a Skia canvas. The only state kept is the transform (and Skia's clip, through
    save and restore): every draw carries its paint"""

    def __init__(self, raster: Raster, live: _Live, canvas: skia.Canvas, w: int = 0, h: int = 0):
        self.r = raster; self.live = live; self.c = canvas; self.w = w; self.h = h; self.m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0); self.stack: list[tuple] = []
        self.path = skia.Path()   # in the space of the matrix it was built under (Blink moves it when the matrix changes)
        self.has_close = False
        self.handed = None   # the path is an F op's own (read from memory): copied before anything changes it

    def _own(self):
        """make the path this replay's own before changing it: an F op's path is shared with the op list, and one read
        from memory carries a stale last-move index, so rebuild it from its first point"""
        seg = self.handed[0]; self.handed = None
        p = skia.Path(); p.moveTo(seg.getPoint(0)); p.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode); p.setFillType(seg.getFillType())
        self.path = p

    # ---- the path ----
    def _set_matrix(self, m):
        if m == self.m: return
        if self.handed is not None: self._own()
        if not self.path.isEmpty():
            inv = skia.Matrix()
            if _mat(m).invert(inv):
                t = skia.Matrix(); t.setConcat(inv, _mat(self.m)); self.path.transform(t)
        self.m = m; self.c.setMatrix(_mat(m))

    def _ensure(self, x, y):
        if self.path.countPoints() == 0: self.path.moveTo(x, y)

    def _arc(self, x, y, rx, ry, rot, a0, a1, ccw):
        # Blink's AdjustArcAngles: the start into [0, 2π), the end so the sweep has the right sign and is at most 2π
        if a0 >= TWO_PI or a0 <= -TWO_PI:
            ns = math.fmod(a0, TWO_PI); a1 += ns - a0; a0 = ns
        if a0 < 0: a0 += TWO_PI; a1 += TWO_PI
        if not ccw and a1 - a0 >= TWO_PI: a1 = a0 + TWO_PI
        elif ccw and a0 - a1 >= TWO_PI: a1 = a0 - TWO_PI
        elif not ccw and a0 > a1: a1 = a0 + (TWO_PI - math.fmod(a0 - a1, TWO_PI))
        elif ccw and a0 < a1: a1 = a0 - (TWO_PI - math.fmod(a1 - a0, TWO_PI))
        start = math.degrees(a0); sweep = math.degrees(a1 - a0)
        if rot:   # a rotated ellipse: built at the origin, then placed
            sub = skia.Path(); oval = skia.Rect.MakeLTRB(-rx, -ry, rx, ry); self._arc_into(sub, oval, start, sweep, True)
            t = skia.Matrix.Translate(x, y); t.preRotate(math.degrees(rot)); sub.transform(t)
            mode = skia.Path.AddPathMode.kExtend_AddPathMode if self.path.countPoints() else skia.Path.AddPathMode.kAppend_AddPathMode
            self.path.addPath(sub, mode); return
        # Blink's Path::AddEllipse: the oval round the centre, arcTo on the path itself (a line from the current point)
        oval = skia.Rect.MakeLTRB(x - rx, y - ry, x + rx, y + ry)
        self._arc_into(self.path, oval, start, sweep, self.path.countPoints() == 0)

    @staticmethod
    def _arc_into(path, oval, start, sweep, move):
        if abs(sweep - 360) < 1e-4: path.arcTo(oval, start, 180, move); path.arcTo(oval, start + 180, 180, False)
        elif abs(sweep + 360) < 1e-4: path.arcTo(oval, start, -180, move); path.arcTo(oval, start - 180, -180, False)
        else: path.arcTo(oval, start, sweep, move)

    def _arc_to(self, x1, y1, x2, y2, r):
        self._ensure(x1, y1)
        self.path.arcTo(x1, y1, x2, y2, r)

    # ---- the loop ----
    def run(self, ops, i0, i1) -> int:
        """replay ops[i0:i1], stopping at a resize (for the canvas to handle); returns where it stopped"""
        c = self.c; paint = self.r.paint
        for i in range(i0, i1):
            o = ops[i]; k = o[0]
            if k == "F":   # per path: begin, the path, then fill it (mode 0 nonzero, 1 even-odd) or stroke it (2; 3 as it is)
                runs = o[3]; last = runs[-1]; self.path = last[0]; self.handed = last; self.has_close = last[1]
                if o[1] == 4: continue   # the path only (the recorder's, after drawing a reopened copy of it)
                p = paint(o[2])
                if p is None: continue
                if o[1] == 2:
                    for run in runs: self.path = run[0]; self.has_close = run[1]; self._draw_path(p)
                    self.has_close = last[1]
                elif o[1] == 3:   # a stroke to draw as it is (a hairline the recorder reopened)
                    for run in runs: c.drawPath(run[0], p)
                else:
                    draw = c.drawPath
                    if o[1] == 1:
                        for run in runs: run[0].setFillType(skia.PathFillType.kEvenOdd); draw(run[0], p)
                    else:
                        for run in runs: draw(run[0], p)   # a path read from memory fills non-zero
                continue
            if self.handed is not None and k in _CHANGES_PATH: self._own()
            if k == "P":   # a run of path verbs, already a path
                seg = o[1]
                if o[2]: self.path.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode)   # carrying on the last contour
                elif self.path.countVerbs() <= 1:
                    # Skia replaces an (effectively) empty path with the one added, copying its stale last-move index
                    # (a path read from memory has one): start the path at the run's first point and extend it instead
                    self.path.reset(); self.path.moveTo(seg.getPoint(0)); self.path.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode)
                else: self.path.addPath(seg, skia.Path.AddPathMode.kAppend_AddPathMode)
                if o[3]: self.has_close = True
            elif k == "begin": self.path = skia.Path(); self.handed = None; self.has_close = False
            elif k == "fillRect":
                p = paint(o[1])
                if p is not None: c.drawRect(skia.Rect.MakeXYWH(*o[2:6]).makeSorted(), p)
            elif k == "save": self.stack.append(self.m); c.save()
            elif k == "restore":
                if self.stack:
                    m = self.stack.pop(); prev = self.m; c.restore(); self.m = prev
                    self._set_matrix(m)   # restoring a matrix moves the path under construction, as setting one does
            elif k == "m": self._set_matrix(tuple(o[1:7]))
            elif k == "stroke":
                p = paint(o[1])
                if p is not None: self._draw_path(p)
            elif k == "fill":
                p = paint(o[2])
                if p is not None:
                    self.path.setFillType(skia.PathFillType.kEvenOdd if o[1] == "evenodd" else skia.PathFillType.kWinding); self._draw_path(p)
            elif k == "L":
                if self.path.countPoints() == 0: self.path.moveTo(o[1], o[2])
                else: self.path.lineTo(o[1], o[2])
            elif k == "M": self.path.moveTo(o[1], o[2])
            elif k == "close": self.path.close(); self.has_close = True
            elif k == "A": self._arc(o[1], o[2], o[3], o[3], 0, o[4], o[5], o[6])
            elif k == "Q": self._ensure(o[1], o[2]); self.path.quadTo(o[1], o[2], o[3], o[4])
            elif k == "C": self._ensure(o[1], o[2]); self.path.cubicTo(o[1], o[2], o[3], o[4], o[5], o[6])
            elif k == "E": self._arc(o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8])
            elif k == "T": self._arc_to(o[1], o[2], o[3], o[4], o[5])
            elif k == "R":
                x, y, w, h = o[1:5]; self.path.moveTo(x, y); self.path.lineTo(x + w, y); self.path.lineTo(x + w, y + h); self.path.lineTo(x, y + h); self.path.close(); self.has_close = True
            elif k == "clip":
                self.path.setFillType(skia.PathFillType.kEvenOdd if o[1] == "evenodd" else skia.PathFillType.kWinding)
                c.clipPath(self.path, skia.ClipOp.kIntersect, True)
            elif k == "strokeRect":
                p = paint(o[1])
                if p is not None: c.drawRect(skia.Rect.MakeXYWH(*o[2:6]).makeSorted(), p)
            elif k == "clearRect":
                p = skia.Paint(); p.setBlendMode(skia.BlendMode.kClear); c.drawRect(skia.Rect.MakeXYWH(*o[1:5]).makeSorted(), p)
            elif k == "img": self._image(o)
            elif k == "text":
                p = paint(o[6])
                if p is not None: self.r.text.draw(c, o[2], o[3], o[4], o[7], o[8], o[9], o[5], skia.Paint(p))
            elif k == "snap": self.r._snapped(self.live, o[1])
            elif k == "size": return i
            else: raise RuntimeError(f"unknown op {k}")
        return i1

    def _draw_path(self, p):
        if p.getStyle() == skia.Paint.kStroke_Style and self.has_close and _treat_as_hairline(self.m, p.getStrokeWidth()):
            # a stroke under a pixel is drawn as a hairline; Chrome's Skia draws a closed contour's hairline without the
            # double hit at its start that ours makes: open each closed contour (a line back to its start, butt caps)
            closed, rest = _reopened(self.path)
            q = skia.Paint(p); q.setStrokeCap(skia.Paint.kButt_Cap)
            if not rest.isEmpty(): self.c.drawPath(rest, p)
            self.c.drawPath(closed, q)
            return
        self.c.drawPath(self.path, p)

    @staticmethod
    def _rects(img, n):
        if len(n) == 2: return skia.Rect.MakeWH(img.width(), img.height()), skia.Rect.MakeXYWH(n[0], n[1], img.width(), img.height())
        if len(n) == 4: return skia.Rect.MakeWH(img.width(), img.height()), skia.Rect.MakeXYWH(*n)
        return skia.Rect.MakeXYWH(*n[:4]), skia.Rect.MakeXYWH(*n[4:])

    def _image(self, o):
        _, cid, snap, alpha, comp, smooth, filt, *n = o
        img = self.r.snapshot(cid, snap)
        if img is None: return
        sampling = LINEAR if smooth else skia.SamplingOptions()
        sigma = _blur_sigma(filt)
        if sigma is not None and self.w and self.h:
            # the filter as Chrome runs it (measured): the image drawn through the transform and the global alpha into a
            # transparent layer, that layer blurred with Skia's three-box pass, and the result composited with the blend mode
            layer = skia.Surface.MakeRaster(skia.ImageInfo.MakeN32Premul(self.w, self.h), 0, PROPS); lc = layer.getCanvas()
            lc.setMatrix(_mat(self.m)); src, dst = self._rects(img, n)
            lp = skia.Paint(); lp.setAlphaf(alpha)
            lc.drawImageRect(img, src, dst, sampling, lp, skia.Canvas.kFast_SrcRectConstraint)
            px = layer.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
            k = math.sqrt(abs(self.m[0] * self.m[3] - self.m[1] * self.m[2])) if BLUR_SCALES else 1.0   # the filter's length: canvas units or bitmap pixels
            blurred = skia.Image.fromarray(np.ascontiguousarray(box_blur(px, sigma * k)), colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
            p = skia.Paint(); p.setBlendMode(BLEND[comp])
            self.c.save(); self.c.resetMatrix(); self.c.drawImage(blurred, 0, 0, skia.SamplingOptions(), p); self.c.restore()
            return
        src, dst = self._rects(img, n)
        p = skia.Paint(AntiAlias=True); p.setAlphaf(alpha); p.setBlendMode(BLEND[comp])
        f = _filter(filt)
        if f is not None: p.setImageFilter(f)
        self.c.drawImageRect(img, src.makeSorted(), dst.makeSorted(), sampling, p, skia.Canvas.kFast_SrcRectConstraint)
