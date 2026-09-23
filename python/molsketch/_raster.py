"""Replay the core's recorded canvases in Skia, the rasteriser behind Chrome's canvas, following Chrome's canvas
implementation (Blink) where it makes choices: arc angles, transforms applied to a path under construction, float
colours with the global alpha folded in, linear image sampling, the paper's blur filter."""
from __future__ import annotations

import functools
import math
import re

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
NAMED = {"black": (0, 0, 0), "white": (255, 255, 255), "red": (255, 0, 0), "green": (0, 128, 0), "blue": (0, 0, 255),
         "gray": (128, 128, 128), "grey": (128, 128, 128), "yellow": (255, 255, 0), "orange": (255, 165, 0)}
LINEAR = skia.SamplingOptions(skia.FilterMode.kLinear)
BLUR_SCALES = False   # a canvas filter's blur is in bitmap pixels, whatever the transform (measured against Chrome at dpr 2)
PROPS = skia.SurfaceProps(0, skia.PixelGeometry.kRGB_H_PixelGeometry)


@functools.lru_cache(4096)
def parse_color(s):
    """a CSS colour as float RGBA (0..1), or None if Chrome would ignore it"""
    s = s.strip().lower()
    if s.startswith("#"):
        h = s[1:]
        if len(h) in (3, 4): h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8) or not re.fullmatch(r"[0-9a-f]+", h): return None
        v = [int(h[i:i + 2], 16) for i in range(0, len(h), 2)]
        return (v[0] / 255, v[1] / 255, v[2] / 255, v[3] / 255 if len(v) == 4 else 1.0)
    m = re.fullmatch(r"rgba?\(\s*([^)]*)\)", s)
    if m:
        parts = [p for p in re.split(r"[\s,/]+", m.group(1)) if p]
        if len(parts) not in (3, 4): return None
        try:
            ch = [(float(p[:-1]) * 2.55 if p.endswith("%") else float(p)) for p in parts[:3]]
            a = (float(parts[3][:-1]) / 100 if parts[3].endswith("%") else float(parts[3])) if len(parts) == 4 else 1.0
        except ValueError:
            return None
        ch = [min(255.0, max(0.0, round(c))) for c in ch]   # Blink rounds the channels to integers
        return (ch[0] / 255, ch[1] / 255, ch[2] / 255, min(1.0, max(0.0, a)))
    if s == "transparent": return (0.0, 0.0, 0.0, 0.0)
    if s in NAMED: r, g, b = NAMED[s]; return (r / 255, g / 255, b / 255, 1.0)
    return None


_HEADER = np.array([5, 0, 0, 0], np.int32)   # SkPath's serialised form, version 5: version | fill type, points, conics, verbs


def _run_path(points: np.ndarray, verbs: np.ndarray, p0: int, np_: int, v0: int, nv: int) -> skia.Path:
    """a run of moves, lines and closes as one Skia path, read from its binary form (no per-point Python)"""
    h = _HEADER.copy(); h[1] = np_; h[3] = nv
    data = h.tobytes() + points[2 * p0:2 * (p0 + np_)].tobytes() + verbs[v0:v0 + nv].tobytes()
    data += b"\0" * (-len(data) % 4)
    path = skia.Path()
    if path.readFromMemory(data) == 0:   # a Skia that serialises differently: build it point by point
        pts = points[2 * p0:2 * (p0 + np_)].reshape(-1, 2); k = 0
        for v in verbs[v0:v0 + nv]:
            if v == 0: path.moveTo(float(pts[k][0]), float(pts[k][1])); k += 1
            elif v == 1: path.lineTo(float(pts[k][0]), float(pts[k][1])); k += 1
            else: path.close()
    return path


def _reopened(path: skia.Path):
    """the path's closed contours with each close made a line back to its start, and its open contours: from the path's
    binary form (Skia's verbs: 0 move, 1 line, 2 quad, 3 conic, 4 cubic, 5 close)"""
    data = bytes(path.serialize()); h = np.frombuffer(data[:16], np.int32)
    npts, ncon, nvb = int(h[1]), int(h[2]), int(h[3])
    pts = np.frombuffer(data[16:16 + 8 * npts], np.float32).reshape(-1, 2)
    con = np.frombuffer(data[16 + 8 * npts:16 + 8 * npts + 4 * ncon], np.float32)
    vb = np.frombuffer(data[16 + 8 * npts + 4 * ncon:16 + 8 * npts + 4 * ncon + nvb], np.uint8)
    per = np.array([1, 1, 2, 2, 3, 0], np.int64)
    closed, rest = skia.Path(), skia.Path(); k = 0; w = 0; i = 0
    while i < nvb:   # one contour at a time
        j = i + 1
        while j < nvb and vb[j] != 0: j += 1
        cv = vb[i:j]; npt = int(per[cv].sum()); cp = pts[k:k + npt]; nw = int((cv == 3).sum()); cw = con[w:w + nw]
        is_closed = bool((cv == 5).any())
        if is_closed: cv = np.where(cv == 5, 1, cv).astype(np.uint8); cp = np.vstack([cp, cp[:1]]).astype(np.float32)   # the close → a line to the start
        hh = _HEADER.copy(); hh[1] = len(cp); hh[2] = nw; hh[3] = len(cv)
        blob = hh.tobytes() + cp.tobytes() + cw.tobytes() + cv.tobytes(); blob += b"\0" * (-len(blob) % 4)
        part = skia.Path(); part.readFromMemory(blob)
        (closed if is_closed else rest).addPath(part)
        k += npt; w += nw; i = j
    return closed, rest


def _mat(m):
    return skia.Matrix.MakeAll(m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1)


class _State:
    __slots__ = ("fill", "stroke", "lineWidth", "lineCap", "lineJoin", "miterLimit", "globalAlpha", "composite", "font",
                 "textAlign", "textBaseline", "filter", "smoothing", "dash", "dashOffset", "m")

    def __init__(self):
        self.fill = (0.0, 0.0, 0.0, 1.0); self.stroke = (0.0, 0.0, 0.0, 1.0); self.lineWidth = 1.0; self.lineCap = "butt"; self.lineJoin = "miter"
        self.miterLimit = 10.0; self.globalAlpha = 1.0; self.composite = "source-over"; self.font = "10px sans-serif"; self.textAlign = "start"
        self.textBaseline = "alphabetic"; self.filter = "none"; self.smoothing = True; self.dash = []; self.dashOffset = 0.0; self.m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

    def copy(self):
        t = _State.__new__(_State)
        for k in _State.__slots__: setattr(t, k, getattr(self, k))
        return t


class Raster:
    """keeps every recorded canvas's ops (they arrive in pieces, render by render) and rasterises any of them as it was
    at a given op count; results are cached, so a canvas the engine reuses (the paper) is drawn once"""

    def __init__(self, text: TextEngine):
        self.ops: dict[int, list] = {}          # ops recorded after the canvas's base
        self.base: dict[int, tuple[int, skia.Image | None, int, int]] = {}   # ops folded into a snapshot: (count, image, w, h)
        self.cache: dict[int, tuple[int, skia.Image]] = {}
        self.shaders: dict[tuple, skia.Shader] = {}
        self.paints: dict[tuple, skia.Paint | None] = {}   # the paints of recent states
        self.text = text

    def add(self, canvases: dict, points: np.ndarray | None = None, verbs: np.ndarray | None = None):
        """take a render's ops; runs of moves and lines (P ops) become Skia paths now, while their streams are at hand"""
        for cid, c in canvases.items():
            cid = int(cid); lst = self.ops.setdefault(cid, []); n0 = self.base.get(cid, (0,))[0]
            if c["start"] != n0 + len(lst): raise RuntimeError(f"canvas {cid}: ops out of order ({c['start']} after {n0 + len(lst)})")
            ops = c["ops"]
            if points is not None:
                for i, o in enumerate(ops):
                    if o[0] == "P": ops[i] = ("P", _run_path(points, verbs, o[1], o[2], o[3], o[4]), o[5], bool((verbs[o[3]:o[3] + o[4]] == 5).any()), float(points[2 * o[1]]), float(points[2 * o[1] + 1]))
            lst.extend(ops)

    def forget(self, cid: int):
        self.ops.pop(cid, None); self.cache.pop(cid, None); self.base.pop(cid, None)

    def compact(self):
        """fold every canvas's ops into a snapshot, so a canvas the engine keeps (the paper) costs an image, not its ops"""
        for cid in list(self.ops):
            if not self.ops[cid]: continue
            n = self.base.get(cid, (0,))[0] + len(self.ops[cid]); img = self.image(cid)
            w, h = (img.width(), img.height()) if img is not None else (0, 0)
            self.base[cid] = (n, img, w, h); self.ops[cid] = []; self.cache[cid] = (n, img) if img is not None else None
            if self.cache[cid] is None: del self.cache[cid]

    def image(self, cid: int, upto: int | None = None) -> skia.Image | None:
        ops = self.ops.get(cid, []); n0, bimg, bw, bh = self.base.get(cid, (0, None, 0, 0))
        n = n0 + len(ops) if upto is None else upto
        hit = self.cache.get(cid)
        if hit and hit[0] == n: return hit[1]
        if n < n0: raise RuntimeError(f"canvas {cid} as it was at op {n} is no longer kept")
        k = n - n0   # replay ops[0:k] on top of the base (or on a fresh bitmap after the last resize)
        resets = [i for i in range(k) if ops[i][0] == "size"]
        if resets: start = resets[-1]; w, h = ops[start][1], ops[start][2]; first = start + 1; under = None
        elif n0: w, h, first, under = bw, bh, 0, bimg
        else: return None
        if w <= 0 or h <= 0: return None
        surface = skia.Surface.MakeRaster(skia.ImageInfo.MakeN32Premul(w, h), 0, PROPS)   # Chrome's canvas text weight on the Mac: LCD-rendered, kept grey
        if under is not None:
            p = skia.Paint(); p.setBlendMode(skia.BlendMode.kSrc); surface.getCanvas().drawImage(under, 0, 0, skia.SamplingOptions(), p)
        _Replay(self, surface.getCanvas(), w, h).run(ops, first, k)
        img = surface.makeImageSnapshot().makeRasterImage()   # its own pixels: shaders and draws of it stay cheap
        self.cache[cid] = (n, img)
        return img


class _Replay:
    def __init__(self, raster: Raster, canvas: skia.Canvas, w: int = 0, h: int = 0):
        self.r = raster; self.c = canvas; self.w = w; self.h = h; self.s = _State(); self.stack: list[_State] = []
        self.path = skia.Path(); self.pm = self.s.m   # the matrix the path's points are in
        self.has_close = False

    # ---- paint ----
    def _paint(self, style, stroke=False):
        """the paint for this state (shared: callers that change it copy it first)"""
        s = self.s
        key = ((style["pat"], style["snap"], style.get("rep"), tuple(style["m"]), s.smoothing) if isinstance(style, dict) else style,
               s.composite, s.globalAlpha, s.filter,
               (s.lineWidth, s.lineCap, s.lineJoin, s.miterLimit, tuple(s.dash) if s.dash else None, s.dashOffset) if stroke else None)
        p = self.r.paints.get(key)
        if p is None:
            if len(self.r.paints) > 4096: self.r.paints.clear()
            p = self.r.paints[key] = self._make_paint(style, stroke)
        return p

    def _make_paint(self, style, stroke):
        s = self.s
        if isinstance(style, dict): p = self._pattern_paint(style)
        else: p = skia.Paint(AntiAlias=True)
        if p is None: return None
        if isinstance(style, dict):
            p.setAlphaf(s.globalAlpha)
        else:
            # colour precision as Chrome's Skia blends: normal drawing keeps the colour in float; the other blend modes
            # (multiply, screen: watercolour and paper) run at 8 bits, so the colour is rounded there first (measured)
            r, g, b, a = style
            if s.composite == "source-over": p.setColor4f(skia.Color4f(r, g, b, a * s.globalAlpha))
            else: p.setColor(skia.Color(round(r * 255), round(g * 255), round(b * 255), round(a * s.globalAlpha * 255)))
        p.setBlendMode(BLEND[s.composite])
        if stroke:
            p.setStyle(skia.Paint.kStroke_Style); p.setStrokeWidth(s.lineWidth); p.setStrokeCap(CAP[s.lineCap])
            p.setStrokeJoin(JOIN[s.lineJoin]); p.setStrokeMiter(s.miterLimit)
            if s.dash: p.setPathEffect(skia.DashPathEffect.Make(s.dash, s.dashOffset))
        f = self._filter()
        if f is not None: p.setImageFilter(f)
        return p

    def _pattern_paint(self, style):
        """a paint carrying the pattern's shader, copied from a cached template (skia-python's setShader on an image
        shader costs tens of milliseconds; copying a paint that holds one costs nothing)"""
        s = self.s
        if True:   # a pattern: the source canvas as it was when the pattern was made
            key = (style["pat"], style["snap"], style.get("rep", "repeat"), tuple(style["m"]), s.smoothing)
            sh = self.r.shaders.get(key)
            if sh is None:
                img = self.r.image(style["pat"], style["snap"])
                if img is None: return None
                rep = key[2]; tile = skia.TileMode.kRepeat
                tx = tile if rep in ("repeat", "repeat-x") else skia.TileMode.kDecal
                ty = tile if rep in ("repeat", "repeat-y") else skia.TileMode.kDecal
                sh = self.r.shaders[key] = skia.Paint(AntiAlias=True, Shader=img.makeShader(tx, ty, LINEAR if s.smoothing else skia.SamplingOptions(), _mat(style["m"])))
            return skia.Paint(sh)

    def _filter(self):
        f = self.s.filter
        if not f or f == "none": return None
        m = re.fullmatch(r"blur\(\s*([\d.]+)px\s*\)", f.strip())
        return skia.ImageFilters.Blur(float(m.group(1)), float(m.group(1))) if m else None

    # ---- the path, kept in the space of the matrix it was built under (Blink moves it when the matrix changes) ----
    def _set_matrix(self, m):
        if m == self.s.m: return
        if not self.path.isEmpty():
            inv = skia.Matrix()
            if _mat(m).invert(inv):
                t = skia.Matrix(); t.setConcat(inv, _mat(self.s.m)); self.path.transform(t)
        self.s.m = m; self.c.setMatrix(_mat(m))

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

    # ---- text ----
    def _text(self, kind, s, x, y, maxw):
        st = self.s
        style = st.fill if kind == "fill" else st.stroke
        p = self._paint(style, stroke=(kind == "stroke"))
        if p is None: return
        self.r.text.draw(self.c, s, x, y, st.font, st.textAlign, st.textBaseline, maxw, skia.Paint(p))

    # ---- the loop ----
    def run(self, ops, i0, i1):
        c = self.c
        for i in range(i0, i1):
            o = ops[i]; k = o[0]
            if k == "P":   # a run of moves and lines, already a path
                seg = o[1]
                if self.path.countVerbs() == 0:   # Skia copies a path added to an empty one, with the stale last-move index
                    self.path.moveTo(o[4], o[5]); self.path.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode)   # a read path has: begin at its first point instead
                elif o[2]: self.path.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode)
                else: self.path.addPath(seg, skia.Path.AddPathMode.kAppend_AddPathMode)
                if o[3]: self.has_close = True
            elif k == "L":
                if self.path.countPoints() == 0: self.path.moveTo(o[1], o[2])
                else: self.path.lineTo(o[1], o[2])
            elif k == "M": self.path.moveTo(o[1], o[2])
            elif k == "set": self._set(o[1], o[2])
            elif k == "begin": self.path.reset(); self.has_close = False
            elif k == "stroke":
                p = self._paint(self.s.stroke, stroke=True)
                if p is not None: self._draw_path(p)
            elif k == "fill":
                p = self._paint(self.s.fill)
                if p is not None:
                    self.path.setFillType(skia.PathFillType.kEvenOdd if o[1] == "evenodd" else skia.PathFillType.kWinding); self._draw_path(p)
            elif k == "close": self.path.close(); self.has_close = True
            elif k == "save": self.stack.append(self.s.copy()); c.save()
            elif k == "restore":
                if self.stack:
                    prev = self.s.m; self.s = self.stack.pop(); c.restore()
                    if self.s.m != prev:   # restoring a matrix moves the path under construction, as setting one does
                        m = self.s.m; self.s.m = prev; self._set_matrix(m)
            elif k == "m": self._set_matrix(tuple(o[1:7]))
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
            elif k == "fillRect":
                p = self._paint(self.s.fill)
                if p is not None: c.drawRect(skia.Rect.MakeXYWH(*o[1:5]).makeSorted(), p)
            elif k == "strokeRect":
                p = self._paint(self.s.stroke, stroke=True)
                if p is not None: c.drawRect(skia.Rect.MakeXYWH(*o[1:5]).makeSorted(), p)
            elif k == "clearRect":
                p = skia.Paint(); p.setBlendMode(skia.BlendMode.kClear); c.drawRect(skia.Rect.MakeXYWH(*o[1:5]).makeSorted(), p)
            elif k == "img": self._image(o)
            elif k == "text": self._text(o[1], o[2], o[3], o[4], o[5])
            elif k == "size": raise RuntimeError("resize inside a replay")
            else: raise RuntimeError(f"unknown op {k}")

    def _draw_path(self, p):
        if p.getStyle() == skia.Paint.kStroke_Style and self.has_close and self._hairline(p.getStrokeWidth()):
            # a stroke under a pixel is drawn as a hairline; Chrome's Skia draws a closed contour's hairline without the
            # double hit at its start that ours makes: open each closed contour (a line back to its start, butt caps)
            closed, rest = _reopened(self.path)
            q = skia.Paint(p); q.setStrokeCap(skia.Paint.kButt_Cap)
            if not rest.isEmpty(): self.c.drawPath(rest, p)
            self.c.drawPath(closed, q)
            return
        self.c.drawPath(self.path, p)

    def _hairline(self, w):
        """Skia's SkDrawTreatAsHairline: the stroke's width mapped through the matrix, measured with its fast_len,
        at most a pixel both ways"""
        m = self.s.m
        fast = lambda x, y: max(abs(x), abs(y)) + min(abs(x), abs(y)) / 2
        return fast(m[0] * w, m[1] * w) <= 1 and fast(m[2] * w, m[3] * w) <= 1

    def _has_close(self):
        it = skia.Path.Iter(self.path, False)
        while True:
            verb, _ = it.next()
            if verb == skia.Path.kDone_Verb: return False
            if verb == skia.Path.kClose_Verb: return True

    def _split_closed(self):
        """the path's closed contours reopened (each close a line back to its start), and its open contours"""
        it = skia.Path.Iter(self.path, False); closed, rest = skia.Path(), skia.Path(); cur = []; start = None
        def flush(target):
            for fn, args in cur: getattr(target, fn)(*args)
        while True:
            verb, pts = it.next()
            if verb == skia.Path.kDone_Verb: break
            if verb == skia.Path.kMove_Verb:
                if cur: flush(rest)
                cur = [("moveTo", (pts[0],))]; start = pts[0]
            elif verb == skia.Path.kLine_Verb: cur.append(("lineTo", (pts[1],)))
            elif verb == skia.Path.kQuad_Verb: cur.append(("quadTo", (pts[1], pts[2])))
            elif verb == skia.Path.kConic_Verb: cur.append(("conicTo", (pts[1], pts[2], it.conicWeight())))
            elif verb == skia.Path.kCubic_Verb: cur.append(("cubicTo", (pts[1], pts[2], pts[3])))
            elif verb == skia.Path.kClose_Verb:
                if start is not None: cur.append(("lineTo", (start,)))
                flush(closed); cur = []
        if cur: flush(rest)
        return closed, rest

    def _set(self, key, v):
        s = self.s
        if key in ("fillStyle", "strokeStyle"):
            val = v if isinstance(v, dict) else parse_color(v)
            if val is None: return
            if key == "fillStyle": s.fill = val
            else: s.stroke = val
        elif key == "globalCompositeOperation": s.composite = v
        elif key == "imageSmoothingEnabled": s.smoothing = v
        elif key == "lineDash": s.dash = v
        elif key == "lineDashOffset": s.dashOffset = v
        else: setattr(s, key, v)

    @staticmethod
    def _rects(img, n):
        if len(n) == 2: return skia.Rect.MakeWH(img.width(), img.height()), skia.Rect.MakeXYWH(n[0], n[1], img.width(), img.height())
        if len(n) == 4: return skia.Rect.MakeWH(img.width(), img.height()), skia.Rect.MakeXYWH(*n)
        return skia.Rect.MakeXYWH(*n[:4]), skia.Rect.MakeXYWH(*n[4:])

    def _blur_sigma(self):
        m = re.fullmatch(r"blur\(\s*([\d.]+)px\s*\)", (self.s.filter or "").strip())
        return float(m.group(1)) if m else None

    def _image(self, o):
        img = self.r.image(o[1], o[2])
        if img is None: return
        sigma = self._blur_sigma()
        if sigma is not None and self.w and self.h:
            # the filter as Chrome runs it (measured): the image drawn through the transform and the global alpha into a
            # transparent layer, that layer blurred with Skia's three-box pass, and the result composited with the blend mode
            layer = skia.Surface.MakeRaster(skia.ImageInfo.MakeN32Premul(self.w, self.h), 0, PROPS); lc = layer.getCanvas()
            lc.setMatrix(_mat(self.s.m)); src, dst = self._rects(img, o[3:])
            lp = skia.Paint(); lp.setAlphaf(self.s.globalAlpha)
            lc.drawImageRect(img, src, dst, LINEAR if self.s.smoothing else skia.SamplingOptions(), lp, skia.Canvas.kFast_SrcRectConstraint)
            px = layer.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
            k = math.sqrt(abs(self.s.m[0] * self.s.m[3] - self.s.m[1] * self.s.m[2])) if BLUR_SCALES else 1.0   # the filter's length: canvas units or bitmap pixels
            blurred = skia.Image.fromarray(np.ascontiguousarray(box_blur(px, sigma * k)), colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kPremul_AlphaType)
            p = skia.Paint(); p.setBlendMode(BLEND[self.s.composite])
            self.c.save(); self.c.resetMatrix(); self.c.drawImage(blurred, 0, 0, skia.SamplingOptions(), p); self.c.restore()
            return
        n = o[3:]
        src, dst = self._rects(img, n)
        p = skia.Paint(AntiAlias=True); p.setAlphaf(self.s.globalAlpha); p.setBlendMode(BLEND[self.s.composite])
        f = self._filter()
        if f is not None: p.setImageFilter(f)
        self.c.drawImageRect(img, src.makeSorted(), dst.makeSorted(), LINEAR if self.s.smoothing else skia.SamplingOptions(), p, skia.Canvas.kFast_SrcRectConstraint)
