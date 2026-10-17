"""SVG output: a canvas with the few calls the replay makes (paths, rects, images, clips, transforms), writing SVG.

A figure's main canvas is replayed onto it, so every line, fill and letter becomes a vector element. What the engine
draws off screen and then composites (the paper texture, watercolour layers, blurs) is raster by nature; those
images are embedded as PNGs, as are patterns. Blend modes become CSS mix-blend-mode, which browsers, Inkscape and
Affinity honour (Illustrator flattens them). Text is drawn as glyph outlines, so the file looks the same without the
fonts installed.
"""
from __future__ import annotations

import base64
import itertools
import re
import struct
from xml.sax.saxutils import quoteattr

import skia

from ._image import png_of

# the blend modes an SVG can say (as CSS mix-blend-mode); source-over is the default
_BLEND = {skia.BlendMode.kMultiply: "multiply", skia.BlendMode.kScreen: "screen", skia.BlendMode.kOverlay: "overlay",
          skia.BlendMode.kDarken: "darken", skia.BlendMode.kLighten: "lighten", skia.BlendMode.kColorDodge: "color-dodge",
          skia.BlendMode.kColorBurn: "color-burn", skia.BlendMode.kHardLight: "hard-light", skia.BlendMode.kSoftLight: "soft-light",
          skia.BlendMode.kDifference: "difference", skia.BlendMode.kExclusion: "exclusion", skia.BlendMode.kHue: "hue",
          skia.BlendMode.kSaturation: "saturation", skia.BlendMode.kColor: "color", skia.BlendMode.kLuminosity: "luminosity",
          skia.BlendMode.kPlus: "plus-lighter"}
_CAP = {skia.Paint.kButt_Cap: "butt", skia.Paint.kRound_Cap: "round", skia.Paint.kSquare_Cap: "square"}
_JOIN = {skia.Paint.kMiter_Join: "miter", skia.Paint.kRound_Join: "round", skia.Paint.kBevel_Join: "bevel"}
_UNFILLED = 'fill="none" '   # how a stroke's attributes begin


def _n(v: float) -> str:
    """a number, short: 2 decimals are well under a hundredth of a pixel"""
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


# path_d works on the path's serialised form (as _raster reads it: an int32 header of version, point, conic weight and
# verb counts, then float32 points, float32 weights and the verb bytes: 0 move, 1 line, 2 quad, 3 conic, 4 cubic, 5
# close) and writes all of a path's numbers with one format: a large drawing is tens of thousands of paths and millions
# of numbers, which one Python call each made most of the time an SVG took. It writes what Skia's path iterator would
# (a closed contour whose last point is not its first gets the line back to it; a move at the very end is dropped;
# conics become two quadratic curves each) with the numbers as _n writes them, character for character.
_HEAD = struct.Struct("<4i")
_VERB = {0: "M%.2f %.2f", 1: "L%.2f %.2f", 2: "Q%.2f %.2f %.2f %.2f", 4: "C%.2f %.2f %.2f %.2f %.2f %.2f", 5: "Z"}
_PTS = (1, 1, 2, 2, 3, 0)   # the points each verb takes from the path's list
_ZERO = tuple((f".{i}0", f".{i}") for i in range(1, 10))   # (every number has two decimals, so these are whole ones)
_NEG0 = re.compile(r"(?<![\d.])-0(?![\d.])")          # a number that rounds to -0 is 0


def path_d(path: skia.Path) -> str:
    """an SVG path's d attribute (conics become quadratic curves)"""
    data = bytes(path.serialize())
    kind, npts, nw, nv = _HEAD.unpack_from(data)
    if kind >> 28: return _iter_d(path)   # an oval or rounded rectangle, which Skia writes as one
    v0 = 16 + 8 * npts + 4 * nw
    vb = data[v0:v0 + nv]
    n = npts
    if vb[-1:] == b"\0": vb = vb[:-1]; n -= 1   # a move at the very end draws nothing: the iterator leaves it out
    if not vb: return ""
    xy = struct.unpack_from(f"<{2 * n}f", data, 16)
    if b"\3" in vb or b"\5" in vb[:-1] or b"\0" in vb[1:]: fmt, xy = _special(vb, xy, struct.unpack_from(f"<{nw}f", data, 16 + 8 * npts))
    elif vb[-1] == 5 and vb[0] == 0:   # one closed contour, the usual shape: a line back to its start unless it is there already
        fmt = vb[:-1].decode("latin-1").translate(_VERB)
        if xy[-2:] != xy[:2]: fmt += "L%.2f %.2fZ"; xy += xy[:2]
        else: fmt += "Z"
    else: fmt = vb.decode("latin-1").translate(_VERB)
    d = (fmt % xy).replace(".00", "")   # %.2f's trailing zeros: both (with the point), or the last
    for z, k in _ZERO: d = d.replace(z, k)
    return _NEG0.sub("0", d) if "-0" in d else d


def _special(vb: bytes, xy: tuple, wts: tuple) -> tuple[str, tuple]:
    """the format and numbers of a path with closes or conics, as Skia's iterator gives them: a close after a line back
    to its contour's start where the pen is not there already, a conic as the quadratic curves Skia makes of it"""
    fmt: list[str] = []; out: list[float] = []
    k = w = 0; move = last = (0.0, 0.0)   # k: the next point; move: the contour's start; last: where the pen is
    for v in vb:
        if v == 5:
            if last != move: fmt.append("L%.2f %.2fZ"); out += move
            else: fmt.append("Z")
            last = move; continue
        n = _PTS[v]; pts = xy[2 * k:2 * (k + n)]; k += n
        if v == 3:
            q = skia.Path.ConvertConicToQuads(skia.Point(*last), skia.Point(pts[0], pts[1]), skia.Point(pts[2], pts[3]), wts[w], 1); w += 1
            for i in range(1, len(q) - 1, 2): fmt.append(_VERB[2]); out += (q[i].x(), q[i].y(), q[i + 1].x(), q[i + 1].y())
        else:
            fmt.append(_VERB[v]); out += pts
        last = pts[-2:]
        if v == 0: move = last
    return "".join(fmt), tuple(out)


def _iter_d(path: skia.Path) -> str:
    """path_d through Skia's own iterator, a verb at a time"""
    out = []; it = skia.Path.Iter(path, False)
    while True:
        verb, pts = it.next()
        if verb == skia.Path.kDone_Verb: break
        if verb == skia.Path.kMove_Verb: out.append(f"M{_n(pts[0].x())} {_n(pts[0].y())}")
        elif verb == skia.Path.kLine_Verb: out.append(f"L{_n(pts[1].x())} {_n(pts[1].y())}")
        elif verb == skia.Path.kQuad_Verb: out.append(f"Q{_n(pts[1].x())} {_n(pts[1].y())} {_n(pts[2].x())} {_n(pts[2].y())}")
        elif verb == skia.Path.kCubic_Verb:
            out.append(f"C{_n(pts[1].x())} {_n(pts[1].y())} {_n(pts[2].x())} {_n(pts[2].y())} {_n(pts[3].x())} {_n(pts[3].y())}")
        elif verb == skia.Path.kConic_Verb:
            q = skia.Path.ConvertConicToQuads(pts[0], pts[1], pts[2], it.conicWeight(), 1)
            for i in range(1, len(q) - 1, 2): out.append(f"Q{_n(q[i].x())} {_n(q[i].y())} {_n(q[i + 1].x())} {_n(q[i + 1].y())}")
        elif verb == skia.Path.kClose_Verb: out.append("Z")
    return "".join(out)


def _copy(m: skia.Matrix) -> skia.Matrix:
    return skia.Matrix.Concat(m, skia.Matrix())


def _png(img: skia.Image) -> str:
    return "data:image/png;base64," + base64.b64encode(png_of(img)).decode()


class NotShapes(Exception):
    """what a drawing asked to be shapes alone holds more than shapes: a clip, a picture, a pattern, a blend or a blur"""


class SvgCanvas:
    """the drawing calls _Replay makes on a Skia canvas, written as SVG. ``meta`` gives, for a paint, what SVG needs
    and a paint does not tell (its pattern's image and transform, its blur). With ``shapes_only``, NotShapes is raised
    at the first thing it would write that is not a plain shape (a clip path, an image, a pattern, a blend mode or a
    filter), so a drawing that needs them can be drawn otherwise."""

    def __init__(self, width: int, height: int, scale: float = 1, meta=None, shapes_only: bool = False):
        self.w, self.h, self.scale = width, height, scale
        self.meta = meta or (lambda p: None)
        self.shapes_only = shapes_only
        self.m = skia.Matrix(); self.stack: list[tuple[skia.Matrix, int]] = []; self.opened = 0   # groups a clip opened
        self.body: list[str] = []; self.defs: list[str] = []; self.ids = itertools.count(1); self.patterns: dict = {}
        self.last_fill = None   # the fill just written, if a stroke of the same path can join it as one element
        self.styles: dict[tuple, tuple] = {}   # a paint's attributes, by the paint (kept, so its id is its own) and colour

    # ---- state ----
    def save(self): self.stack.append((_copy(self.m), self.opened)); self.opened = 0
    def restore(self):
        self.body.extend("</g>" for _ in range(self.opened))
        self.m, self.opened = self.stack.pop() if self.stack else (skia.Matrix(), 0)
    def setMatrix(self, m: skia.Matrix): self.m = _copy(m)
    def resetMatrix(self): self.m = skia.Matrix()
    def translate(self, x, y): self.m.preTranslate(x, y)
    def scale(self, sx, sy): self.m.preScale(sx, sy)

    def clipPath(self, path: skia.Path, op=None, aa=True):
        if self.shapes_only: raise NotShapes("a clip")
        cid = f"c{next(self.ids)}"; p = skia.Path(path); p.transform(self.m)
        rule = "evenodd" if path.getFillType() == skia.PathFillType.kEvenOdd else "nonzero"
        self.defs.append(f'<clipPath id="{cid}"><path clip-rule="{rule}" d="{path_d(p)}"/></clipPath>')
        self.body.append(f'<g clip-path="url(#{cid})">'); self.opened += 1

    # ---- drawing ----
    def _transform(self) -> str:
        m = self.m
        if m.isIdentity(): return ""
        v = (m.getScaleX(), m.getSkewY(), m.getSkewX(), m.getScaleY(), m.getTranslateX(), m.getTranslateY())
        return ' transform="matrix(' + " ".join(f"{x:.6g}" for x in v) + ')"'

    def _style(self, paint: skia.Paint, fill_rule: str | None = None) -> str | None:
        """the attributes that paint a shape as ``paint`` does; None for a paint SVG cannot draw (it erases). A paint
        changes nothing but its colour once it draws (the replay recolours one paint per kind), so its attributes are
        worked out once per colour; a blur's are not kept, as each use writes a filter of its own"""
        c = paint.getColor4f(); key = (id(paint), c.fR, c.fG, c.fB, c.fA, fill_rule)
        hit = self.styles.get(key)
        if hit is not None and hit[0] is paint: return hit[1]
        st = self._attributes(paint, c, fill_rule)
        if st is None or "filter=" not in st: self.styles[key] = (paint, st)
        return st

    def _attributes(self, paint: skia.Paint, c: skia.Color4f, fill_rule: str | None) -> str | None:
        mode = paint.getBlendMode()
        if mode in (skia.BlendMode.kClear, skia.BlendMode.kDstOut, skia.BlendMode.kDstIn): return None
        a = c.fA
        info = self.meta(paint) or {}
        if self.shapes_only and (info.get("pattern") or info.get("blur") or mode in _BLEND): raise NotShapes("a pattern, a blur or a blend")
        colour = f"#{round(c.fR * 255):02x}{round(c.fG * 255):02x}{round(c.fB * 255):02x}"
        if info.get("pattern"): colour = f"url(#{self._pattern(info['pattern'])})"; a = paint.getAlphaf()
        stroke = paint.getStyle() == skia.Paint.kStroke_Style
        at = []
        if stroke:
            at += ['fill="none"', f'stroke="{colour}"', f'stroke-width="{_n(paint.getStrokeWidth()) if paint.getStrokeWidth() > 0 else "1"}"']
            if paint.getStrokeCap() != skia.Paint.kButt_Cap: at.append(f'stroke-linecap="{_CAP[paint.getStrokeCap()]}"')
            if paint.getStrokeJoin() != skia.Paint.kMiter_Join: at.append(f'stroke-linejoin="{_JOIN[paint.getStrokeJoin()]}"')
            elif paint.getStrokeMiter() != 4: at.append(f'stroke-miterlimit="{_n(paint.getStrokeMiter())}"')
            if a < 1: at.append(f'stroke-opacity="{a:.3g}"')
        else:
            at.append(f'fill="{colour}"')
            if a < 1: at.append(f'fill-opacity="{a:.3g}"')
            if fill_rule == "evenodd": at.append('fill-rule="evenodd"')
        css = []
        if mode in _BLEND: css.append(f"mix-blend-mode:{_BLEND[mode]}")
        if css: at.append(f'style="{";".join(css)}"')
        if info.get("blur"): at.append(f'filter="url(#{self._blur(info["blur"])})"')
        return " ".join(at)

    def drawPath(self, path: skia.Path, paint: skia.Paint):
        pe = paint.getPathEffect()
        if pe is not None:   # a dash: the dashed path itself (SVG's own dashes start differently)
            dst = skia.Path(); rec = skia.StrokeRec(skia.StrokeRec.InitStyle.kHairline_InitStyle)
            if pe.filterPath(dst, path, rec, None): path = dst
        st = self._style(paint, "evenodd" if path.getFillType() == skia.PathFillType.kEvenOdd else None)
        if st is None or path.isEmpty(): return
        tr, d, plain = self._transform(), path_d(path), "style=" not in st and "filter=" not in st
        last = self.last_fill; self.last_fill = None
        if st.startswith(_UNFILLED):
            # a stroke of the path just filled: one element, filled and stroked (as a drawing program makes a shape)
            if plain and last is not None and last[0] == len(self.body) - 1 and last[1:3] == (tr, d):
                self.body[-1] = f'<path{tr} {last[3]} {st[len(_UNFILLED):]} d="{d}"/>'; return
        elif plain: self.last_fill = (len(self.body), tr, d, st)
        self.body.append(f'<path{tr} {st} d="{d}"/>')

    def group(self, attrs: dict | None):
        """a group begun (its id, its name for a reader's list of objects, data attributes), or the open one ended"""
        self.last_fill = None
        if attrs is None: self.body.append("</g>"); return
        at = []
        if attrs.get("id"): at.append(f"id={quoteattr(str(attrs['id']))}")
        if attrs.get("label"): at.append(f"inkscape:label={quoteattr(str(attrs['label']))}")
        for k, v in (attrs.get("data") or {}).items(): at.append(f"data-{k}={quoteattr(str(v))}")
        self.body.append("<g" + "".join(" " + a for a in at) + ">")

    def drawRect(self, rect: skia.Rect, paint: skia.Paint):
        st = self._style(paint)
        if st is None: return
        self.body.append(f'<rect{self._transform()} {st} x="{_n(rect.left())}" y="{_n(rect.top())}" width="{_n(rect.width())}" height="{_n(rect.height())}"/>')

    def drawImageRect(self, img: skia.Image, src: skia.Rect, dst: skia.Rect, sampling=None, paint=None, constraint=None):
        full = skia.Rect.MakeWH(img.width(), img.height())
        if src != full:
            r = src.roundOut(); r.intersect(skia.IRect.MakeWH(img.width(), img.height())); sub = img.makeSubset(r)
            if sub is None: return
            img = sub
        self._image(img, dst, paint)

    def drawImage(self, img: skia.Image, x: float, y: float, sampling=None, paint=None):
        self._image(img, skia.Rect.MakeXYWH(x, y, img.width(), img.height()), paint)

    def _image(self, img, dst, paint):
        at = []
        if paint is not None and paint.getBlendMode() in (skia.BlendMode.kClear, skia.BlendMode.kDstOut): return
        if self.shapes_only: raise NotShapes("a picture")
        if paint is not None:
            if paint.getAlphaf() < 1: at.append(f'opacity="{paint.getAlphaf():.3g}"')
            if paint.getBlendMode() in _BLEND: at.append(f'style="mix-blend-mode:{_BLEND[paint.getBlendMode()]}"')
        self.body.append(f'<image{self._transform()} {" ".join(at)} preserveAspectRatio="none" x="{_n(dst.left())}" y="{_n(dst.top())}" '
                         f'width="{_n(dst.width())}" height="{_n(dst.height())}" href="{_png(img)}"/>')

    def draw_glyphs(self, font: skia.Font, glyphs, xs, ys, paint: skia.Paint):
        """text, as outlines: the glyphs of one run at their positions (the text engine's hook)"""
        path = skia.Path()
        for g, x, y in zip(glyphs, xs, ys):
            gp = font.getPath(g)
            if gp is not None: gp.offset(x, y); path.addPath(gp)
        self.drawPath(path, paint)

    # ---- defs ----
    def _pattern(self, spec) -> str:
        img, rep, m = spec
        key = (id(img), rep, tuple(m))
        if key in self.patterns: return self.patterns[key]
        pid = f"p{next(self.ids)}"; self.patterns[key] = pid
        self.defs.append(f'<pattern id="{pid}" patternUnits="userSpaceOnUse" width="{img.width()}" height="{img.height()}" '
                         f'patternTransform="matrix({" ".join(f"{v:.6g}" for v in (m[0], m[1], m[2], m[3], m[4], m[5]))})">'
                         f'<image width="{img.width()}" height="{img.height()}" href="{_png(img)}"/></pattern>')
        return pid

    def _blur(self, sigma: float) -> str:
        fid = f"b{next(self.ids)}"
        self.defs.append(f'<filter id="{fid}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{_n(sigma)}"/></filter>')
        return fid

    def svg(self) -> str:
        """the document"""
        body = self.body + ["</g>"] * (self.opened + sum(o for _, o in self.stack))
        w, h = self.w / self.scale, self.h / self.scale
        return (f'<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
                f'width="{_n(w)}" height="{_n(h)}" viewBox="0 0 {self.w} {self.h}">\n'
                + (f"<defs>\n{chr(10).join(self.defs)}\n</defs>\n" if self.defs else "") + "\n".join(body) + "\n</svg>\n")
