"""Replay the core's recorded canvases in Skia, the rasteriser behind Chrome's canvas, following Chrome's canvas
implementation (Blink) where it makes choices: arc angles, transforms applied to a path under construction, float
colours with the global alpha folded in, linear image sampling, the paper's blur filter."""
from __future__ import annotations

import functools
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


_PAD = (b"", b"\0\0\0", b"\0\0", b"\0")


def _run_path(pts: bytes, verbs: bytes, weights: bytes, n: int, nv: int, nw: int) -> skia.Path:
    """a run of path verbs as one Skia path, read from its binary form: header, points, conic weights, verbs"""
    path = skia.Path()
    if path.readFromMemory(struct.pack("<4i", 5, n, nw, nv) + pts + weights + verbs + _PAD[nv % 4]) == 0:   # a Skia that serialises differently
        p = np.frombuffer(pts, np.float32).tolist(); w = np.frombuffer(weights, np.float32).tolist(); k = 0; j = 0
        for v in verbs:
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


_UNSET = object()


class _State:
    __slots__ = ("fill", "stroke", "lineWidth", "lineCap", "lineJoin", "miterLimit", "globalAlpha", "composite", "font",
                 "textAlign", "textBaseline", "filter", "smoothing", "dash", "dashOffset", "m", "fp", "sp")

    def __init__(self):
        self.fill = (0.0, 0.0, 0.0, 1.0); self.stroke = (0.0, 0.0, 0.0, 1.0); self.lineWidth = 1.0; self.lineCap = "butt"; self.lineJoin = "miter"
        self.miterLimit = 10.0; self.globalAlpha = 1.0; self.composite = "source-over"; self.font = "10px sans-serif"; self.textAlign = "start"
        self.textBaseline = "alphabetic"; self.filter = "none"; self.smoothing = True; self.dash = []; self.dashOffset = 0.0; self.m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        self.fp = self.sp = _UNSET   # the fill and stroke paints of this state, made when first drawn with

    exec("def copy(self):\n t = _State.__new__(_State)\n" + "".join(f" t.{k} = self.{k}\n" for k in __slots__) + " return t")   # a copy without a loop


class Raster:
    """keeps every recorded canvas's ops (they arrive in pieces, render by render) and rasterises any of them as it was
    at a given op count; results are cached, so a canvas the engine reuses (the paper) is drawn once"""

    def __init__(self, text: TextEngine):
        self.ops: dict[int, list] = {}          # ops recorded after the canvas's base
        self.base: dict[int, tuple[int, skia.Image | None, int, int]] = {}   # ops folded into a snapshot: (count, image, w, h)
        self.cache: dict[int, tuple[int, skia.Image]] = {}
        self.shaders: dict[tuple, skia.Shader] = {}
        self.paints: dict[tuple, skia.Paint | None] = {}   # the paints of recent states
        self.templates: dict[tuple, skia.Paint] = {}         # paints without their colour, by the rest of the state
        self.text = text

    def add(self, canvases: dict, streams: tuple[bytes, bytes, bytes] | None = None):
        """take a render's ops; path runs (P ops) become Skia paths now, while their streams (points, verbs, conic
        weights, as bytes) are at hand"""
        for cid, c in canvases.items():
            cid = int(cid); lst = self.ops.setdefault(cid, []); n0 = self.base.get(cid, (0,))[0]
            if c["start"] != n0 + len(lst): raise RuntimeError(f"canvas {cid}: ops out of order ({c['start']} after {n0 + len(lst)})")
            ops = c["ops"]
            if streams is not None:
                pb, vb, wb = streams; first = np.frombuffer(pb, np.float32)
                for i, o in enumerate(ops):
                    k = o[0]
                    if k == "P":
                        p0, n, v0, nv, w0, nw = o[1], o[2], o[3], o[4], o[5], o[6]; verbs = vb[v0:v0 + nv]
                        ops[i] = (k, _run_path(pb[8 * p0:8 * (p0 + n)], verbs, wb[4 * w0:4 * (w0 + nw)], n, nv, nw), o[7], 5 in verbs,
                                  float(first[2 * p0]), float(first[2 * p0 + 1]))
                    elif k == "F":   # mode, then one or more paths: (path, has a close, first point)
                        runs = []
                        for j in range(2, len(o), 6):
                            p0, n, v0, nv, w0, nw = o[j:j + 6]; verbs = vb[v0:v0 + nv]
                            runs.append((_run_path(pb[8 * p0:8 * (p0 + n)], verbs, wb[4 * w0:4 * (w0 + nw)], n, nv, nw), 5 in verbs,
                                         float(first[2 * p0]), float(first[2 * p0 + 1])))
                        ops[i] = (k, o[1], runs)
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
        self.handed = None   # the path is an F op's own (read from memory): copied before anything changes it

    # ---- paint ----
    def _fill(self):
        s = self.s; p = s.fp
        if p is _UNSET: p = s.fp = self._paint(s.fill)
        return p

    def _stroke(self):
        s = self.s; p = s.sp
        if p is _UNSET: p = s.sp = self._paint(s.stroke, stroke=True)
        return p

    def _own(self):
        """make the path this replay's own before changing it: an F op's path is shared with the op list, and one read
        from memory carries a stale last-move index, so rebuild it from its first point"""
        seg, _, x, y = self.handed; self.handed = None
        p = skia.Path(); p.moveTo(x, y); p.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode); p.setFillType(seg.getFillType())
        self.path = p

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
        if isinstance(style, dict):
            p = self._pattern_paint(style)
            if p is None: return None
            p.setAlphaf(s.globalAlpha)
        else:
            # a colour on a copy of the template for the rest of the state (a copy is one call, the setters several)
            key = (s.composite, s.filter, (s.lineWidth, s.lineCap, s.lineJoin, s.miterLimit, tuple(s.dash) if s.dash else None, s.dashOffset) if stroke else None)
            t = self.r.templates.get(key)
            if t is None: t = self.r.templates[key] = self._template(stroke)
            p = skia.Paint(t)
            # colour precision as Chrome's Skia blends: normal drawing keeps the colour in float; the other blend modes
            # (multiply, screen: watercolour and paper) run at 8 bits, so the colour is rounded there first (measured)
            r, g, b, a = style
            if s.composite == "source-over": p.setColor4f(skia.Color4f(r, g, b, a * s.globalAlpha))
            else: p.setColor(skia.Color(round(r * 255), round(g * 255), round(b * 255), round(a * s.globalAlpha * 255)))
            return p
        return self._finish(p, stroke)

    def _template(self, stroke):
        return self._finish(skia.Paint(AntiAlias=True), stroke)

    def _finish(self, p, stroke):
        s = self.s
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
        if self.handed is not None: self._own()
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
        p = self._fill() if kind == "fill" else self._stroke()
        if p is None: return
        self.r.text.draw(self.c, s, x, y, st.font, st.textAlign, st.textBaseline, maxw, skia.Paint(p))

    # ---- the loop ----
    def run(self, ops, i0, i1):
        c = self.c
        for i in range(i0, i1):
            o = ops[i]; k = o[0]
            if k == "F":   # per path: begin, the path, then fill it (mode 0 nonzero, 1 even-odd) or stroke it (2)
                runs = o[2]; last = runs[-1]; self.path = last[0]; self.handed = last; self.has_close = last[1]
                if o[1] == 2:
                    p = self._stroke()
                    if p is not None:
                        for run in runs: self.path = run[0]; self.has_close = run[1]; self._draw_path(p)
                else:
                    p = self._fill()
                    if p is not None:
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
                    self.path.reset(); self.path.moveTo(o[4], o[5]); self.path.addPath(seg, skia.Path.AddPathMode.kExtend_AddPathMode)
                else: self.path.addPath(seg, skia.Path.AddPathMode.kAppend_AddPathMode)
                if o[3]: self.has_close = True
            elif k == "L":
                if self.path.countPoints() == 0: self.path.moveTo(o[1], o[2])
                else: self.path.lineTo(o[1], o[2])
            elif k == "M": self.path.moveTo(o[1], o[2])
            elif k == "S":
                for j in range(1, len(o), 2): self._set(o[j], o[j + 1])
            elif k == "begin": self.path = skia.Path(); self.handed = None; self.has_close = False
            elif k == "stroke":
                p = self._stroke()
                if p is not None: self._draw_path(p)
            elif k == "fill":
                p = self._fill()
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
                p = self._fill()
                if p is not None: c.drawRect(skia.Rect.MakeXYWH(*o[1:5]).makeSorted(), p)
            elif k == "strokeRect":
                p = self._stroke()
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
        return _treat_as_hairline(self.s.m, w)


    def _set(self, key, v):
        s = self.s; s.fp = s.sp = _UNSET
        if key in ("fillStyle", "strokeStyle"):
            val = v if isinstance(v, dict) else tuple(v) if isinstance(v, list) else parse_color(v)   # the recorder parses most colours
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
