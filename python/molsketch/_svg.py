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

import skia

# the blend modes an SVG can say (as CSS mix-blend-mode); source-over is the default
_BLEND = {skia.BlendMode.kMultiply: "multiply", skia.BlendMode.kScreen: "screen", skia.BlendMode.kOverlay: "overlay",
          skia.BlendMode.kDarken: "darken", skia.BlendMode.kLighten: "lighten", skia.BlendMode.kColorDodge: "color-dodge",
          skia.BlendMode.kColorBurn: "color-burn", skia.BlendMode.kHardLight: "hard-light", skia.BlendMode.kSoftLight: "soft-light",
          skia.BlendMode.kDifference: "difference", skia.BlendMode.kExclusion: "exclusion", skia.BlendMode.kHue: "hue",
          skia.BlendMode.kSaturation: "saturation", skia.BlendMode.kColor: "color", skia.BlendMode.kLuminosity: "luminosity",
          skia.BlendMode.kPlus: "plus-lighter"}
_CAP = {skia.Paint.kButt_Cap: "butt", skia.Paint.kRound_Cap: "round", skia.Paint.kSquare_Cap: "square"}
_JOIN = {skia.Paint.kMiter_Join: "miter", skia.Paint.kRound_Join: "round", skia.Paint.kBevel_Join: "bevel"}


def _n(v: float) -> str:
    """a number, short: 2 decimals are well under a hundredth of a pixel"""
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path_d(path: skia.Path) -> str:
    """an SVG path's d attribute (conics become quadratic curves)"""
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
    return "data:image/png;base64," + base64.b64encode(bytes(img.encodeToData(skia.kPNG, 100))).decode()


class SvgCanvas:
    """the drawing calls _Replay makes on a Skia canvas, written as SVG. ``meta`` gives, for a paint, what SVG needs
    and a paint does not tell (its pattern's image and transform, its blur)."""

    def __init__(self, width: int, height: int, scale: float = 1, meta=None):
        self.w, self.h, self.scale = width, height, scale
        self.meta = meta or (lambda p: None)
        self.m = skia.Matrix(); self.stack: list[tuple[skia.Matrix, int]] = []; self.opened = 0   # groups a clip opened
        self.body: list[str] = []; self.defs: list[str] = []; self.ids = itertools.count(1); self.patterns: dict = {}

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
        """the attributes that paint a shape as ``paint`` does; None for a paint SVG cannot draw (it erases)"""
        mode = paint.getBlendMode()
        if mode in (skia.BlendMode.kClear, skia.BlendMode.kDstOut, skia.BlendMode.kDstIn): return None
        c = paint.getColor4f(); a = c.fA
        info = self.meta(paint) or {}
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
        self.body.append(f'<path{self._transform()} {st} d="{path_d(path)}"/>')

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
        if paint is not None:
            if paint.getBlendMode() in (skia.BlendMode.kClear, skia.BlendMode.kDstOut): return
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
                f'width="{_n(w)}" height="{_n(h)}" viewBox="0 0 {self.w} {self.h}">\n'
                + (f"<defs>\n{chr(10).join(self.defs)}\n</defs>\n" if self.defs else "") + "\n".join(body) + "\n</svg>\n")
