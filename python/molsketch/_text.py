"""Canvas text as Chrome draws it: the CSS font resolved against the app's web fonts (the same files Google serves
Chrome, with the same unicode ranges and weight matching) and then the system's, per-character fallback through
CoreText as Chrome's, shaping with HarfBuzz (Chrome's shaper, with its default features: kerning, ligatures,
contextual alternates), Blink's baseline offsets, and glyphs rasterised by Skia."""
from __future__ import annotations

import json
import math
import pathlib
import re
import sys

import skia
import uharfbuzz as hb

FONTS = pathlib.Path(__file__).resolve().parent / "fonts"
GENERIC = {  # what Chrome resolves the generic families to on each platform
    "darwin": {"serif": "Times", "sans-serif": "Helvetica", "cursive": "Apple Chancery", "fantasy": "Papyrus", "monospace": "Courier", "system-ui": ".AppleSystemUIFont"},
    "linux": {"serif": "Tinos", "sans-serif": "Arimo", "cursive": "Comic Neue", "fantasy": "Impact", "monospace": "Cousine", "system-ui": "Arimo"},
    "win32": {"serif": "Times New Roman", "sans-serif": "Arial", "cursive": "Comic Sans MS", "fantasy": "Impact", "monospace": "Consolas", "system-ui": "Segoe UI"},
}.get(sys.platform, {})
FONT_RE = re.compile(r"^\s*(?:(italic|oblique|normal)\s+)?(?:(small-caps|normal)\s+)?(?:(bold|bolder|lighter|normal|\d{3})\s+)?([\d.]+)(px|pt)(?:\s*/\s*[^\s]+)?\s+(.+)$")


def _tag(t: str) -> int:
    return (ord(t[0]) << 24) | (ord(t[1]) << 16) | (ord(t[2]) << 8) | ord(t[3])


class _Face:
    """one typeface at one variation: Skia draws it, HarfBuzz shapes it"""

    def __init__(self, typeface: skia.Typeface, variations: dict | None = None, data: bytes | None = None, metrics: dict | None = None):
        if variations:
            # Skia keeps pointers into these, so they must outlive the clone: keep them on the face
            self._coords = [skia.FontArguments.VariationPosition.Coordinate(_tag(k), float(v)) for k, v in variations.items()]
            self._coordv = skia.FontArguments.VariationPosition.Coordinates(self._coords)
            self._vp = skia.FontArguments.VariationPosition(self._coordv); self._args = skia.FontArguments(); self._args.setVariationDesignPosition(self._vp)
            typeface = typeface.makeClone(self._args)
        self.tf = typeface
        face = hb.Face(data) if data is not None else hb.Face.create_for_tables(lambda _f, tag, _u: bytes(self.tf.getTableData(_tag(tag) if isinstance(tag, str) else tag)), None)
        self.upem = face.upem
        self.hb = hb.Font(face)
        if variations: self.hb.set_variations({k: float(v) for k, v in variations.items()})
        self.m = metrics or self._metrics()
        self.cmap = set(face.unicodes) if data is not None else None
        self._sk: dict = {}

    def _metrics(self):
        os2 = self.tf.getTableData(_tag("OS/2")); hhea = self.tf.getTableData(_tag("hhea"))
        i16 = lambda b, o: int.from_bytes(b[o:o + 2], "big", signed=True)
        m = {"upem": self.upem, "hheaAscender": i16(hhea, 4), "hheaDescender": i16(hhea, 6)}
        if len(os2) >= 72: m.update(typoAscender=i16(os2, 68), typoDescender=i16(os2, 70))
        return m

    def covers(self, ch: int) -> bool:
        return ch in self.cmap if self.cmap is not None else self.tf.unicharToGlyph(ch) != 0

    def em_heights(self, size: float):
        """the em box Chrome's top / middle / bottom baselines use: typo ascent:descent scaled to the font size (measured
        against Chrome: not rounded; the text's position is then snapped to the pixel, as Skia snaps baselines)"""
        a, d = self.m.get("typoAscender"), self.m.get("typoDescender")
        if a is None or a - d <= 0 or a < 0: a, d = self.m["hheaAscender"], self.m["hheaDescender"]
        d = -d; h = a + d
        if h <= 0 or a < 0 or a > h: return size, 0.0
        asc = a * size / h; return asc, size - asc

    def ascent(self, size: float):   # Chrome's FontMetrics ascent (hhea on the Mac), rounded as Blink rounds it
        return float(round(self.m["hheaAscender"] * size / self.upem))

    def descent(self, size: float):
        return float(round(-self.m["hheaDescender"] * size / self.upem))

    def widths(self, size: float, glyphs):
        """glyph advances as Chrome's HarfBuzz gets them: from Skia (CoreText on the Mac), not from the font's hmtx"""
        f = self._sk.get(size)
        if f is None: f = self._sk[size] = skia.Font(self.tf, size); f.setSubpixel(True); f.setHinting(skia.FontHinting.kNone)
        return f.getWidths(glyphs)


class TextEngine:
    def __init__(self):
        man = json.loads((FONTS / "manifest.json").read_text())
        self.web: dict[str, list] = {}
        for f in man["faces"]: self.web.setdefault(f["family"].lower(), []).append(f)
        self._files: dict[str, bytes] = {}; self._faces: dict = {}; self._fallback: dict = {}; self._runs: dict = {}
        self.fm = skia.FontMgr()
        self.edging = skia.Font.Edging.kSubpixelAntiAlias

    # ---- the CSS font → faces ----
    @staticmethod
    def parse(font: str):
        m = FONT_RE.match(font)
        if not m: return ("normal", 400, 10.0, ["sans-serif"])
        style, _v, weight, size, unit, fams = m.groups()
        w = {"bold": 700, "normal": 400, None: 400, "bolder": 700, "lighter": 100}.get(weight, None) or int(weight)
        px = float(size) * (4 / 3 if unit == "pt" else 1)
        families = [f.strip().strip("'\"") for f in re.findall(r'"[^"]*"|\'[^\']*\'|[^,]+', fams)]
        return (style or "normal", w, px, [f for f in families if f])

    @staticmethod
    def _match_weight(want: int, have: list[int]) -> int:
        """CSS Fonts 4 weight matching"""
        if want in have: return want
        up = sorted(w for w in have if w > want); down = sorted((w for w in have if w < want), reverse=True)
        if 400 <= want <= 500:
            mid = [w for w in up if w <= 500]; return (mid + down + [w for w in up if w > 500])[0]
        return (down + up)[0] if want < 400 else (up + down)[0]

    def _web_faces(self, family: str, weight: int, style: str):
        faces = self.web.get(family.lower())
        if not faces: return None
        styled = [f for f in faces if f["style"] == ("normal" if style == "normal" else "italic")] or faces
        w = self._match_weight(weight, sorted({f["weight"] for f in styled}))
        out = []
        for f in (f for f in styled if f["weight"] == w):
            key = ("web", f["file"], w)
            if key not in self._faces:
                data = self._files.setdefault(f["file"], (FONTS / f["file"]).read_bytes())
                tf = self.fm.makeFromData(skia.Data.MakeWithCopy(data))
                axes = f["metrics"].get("axes", {})
                var = {"wght": min(max(w, axes["wght"][0]), axes["wght"][2])} if "wght" in axes else None
                self._faces[key] = _Face(tf, var, data, f["metrics"])
            out.append((f["ranges"], self._faces[key]))
        return out

    def _system_face(self, family: str, weight: int, style: str):
        fam = GENERIC.get(family.lower(), family)
        key = ("sys", fam.lower(), weight, style)
        if key not in self._faces:
            slant = skia.FontStyle.kUpright_Slant if style == "normal" else skia.FontStyle.kItalic_Slant
            tf = self.fm.matchFamilyStyle(fam, skia.FontStyle(weight, skia.FontStyle.kNormal_Width, slant))
            self._faces[key] = _Face(tf) if tf is not None else None
        return self._faces[key]

    def _chain(self, font: str):
        """the font's faces in fallback order: [(ranges or None, face)]"""
        if font in self._faces: return self._faces[font]
        style, weight, size, families = self.parse(font)
        chain = []
        for fam in families:
            web = self._web_faces(fam, weight, style)
            if web: chain.extend(web)
            else:
                f = self._system_face(fam, weight, style)
                if f: chain.append((None, f))
        if not chain: chain.append((None, self._system_face("sans-serif", weight, style)))
        self._faces[font] = (chain, style, weight, size)
        return self._faces[font]

    def _face_for(self, chain, ch: int, style, weight):
        for ranges, face in chain:
            if ranges is not None and not any(a <= ch <= b for a, b in ranges): continue
            if face.covers(ch): return face
        # the system's fallback for this character, as Chrome asks CoreText: from the primary font if it is a system font,
        # from the platform's sans (Helvetica on the Mac) when it is a web font, at the requested weight (measured against Chrome)
        web = chain[0][0] is not None
        base = GENERIC.get("sans-serif", "Helvetica") if web else chain[0][1].tf.getFamilyName()
        key = (base, ch, weight, style)
        if key not in self._fallback:
            slant = skia.FontStyle.kUpright_Slant if style == "normal" else skia.FontStyle.kItalic_Slant
            tf = self.fm.matchFamilyStyleCharacter(base, skia.FontStyle(weight, skia.FontStyle.kNormal_Width, slant), ["en"], ch)
            self._fallback[key] = _Face(tf) if tf is not None else chain[0][1]
        return self._fallback[key]

    # ---- shaping ----
    def shape(self, font: str, text: str):
        """runs of (face, glyphs, xs, ys) and the total advance, in px"""
        key = (font, text)
        if key in self._runs: return self._runs[key]
        chain, style, weight, size = self._chain(font)
        primary = chain[0][1]
        segs = []
        for ch in text:
            f = self._face_for(chain, ord(ch), style, weight) if ch not in "\n\t" else primary
            if segs and segs[-1][0] is f: segs[-1][1].append(ch)
            else: segs.append((f, [ch]))
        runs = []; x = 0.0
        for face, chars in segs:
            k = size / face.upem; gl, xs, ys = [], [], []
            # Blink shapes (and caches) a word at a time, spaces on their own: no kerning or contextual alternates across a space
            for word in re.split(r"( )", "".join(chars)):
                if not word: continue
                buf = hb.Buffer(); buf.add_str(word); buf.guess_segment_properties()
                hb.shape(face.hb, buf)
                ids = [i.codepoint for i in buf.glyph_infos]; adv = face.widths(size, ids)
                for g, pos, w in zip(ids, buf.glyph_positions, adv):
                    gl.append(g); xs.append(x + pos.x_offset * k); ys.append(-pos.y_offset * k)
                    x += w + (pos.x_advance - face.hb.get_glyph_h_advance(g)) * k   # Skia's advance, HarfBuzz's kerning on top
            runs.append((face, gl, xs, ys))
        out = (runs, x, primary, size, style)
        self._runs[key] = out
        if len(self._runs) > 4096: self._runs.pop(next(iter(self._runs)))
        return out

    def measure(self, font: str, text: str) -> float:
        return self.shape(font, text)[1]

    # ---- drawing ----
    def draw(self, canvas: skia.Canvas, text: str, x: float, y: float, font: str, align: str, baseline: str, maxw, paint: skia.Paint):
        text = text.replace("\n", " ").replace("\t", " ")   # canvas text is one line
        runs, width, primary, size, style = self.shape(font, text)
        if align in ("center",): x -= width / 2
        elif align in ("right", "end"): x -= width
        asc, desc = primary.em_heights(size)
        dy = {"top": asc, "bottom": -desc, "middle": (asc - desc) / 2, "hanging": primary.ascent(size) * 0.8,
              "ideographic": -primary.descent(size), "alphabetic": 0.0}.get(baseline, 0.0)
        canvas.save()
        canvas.translate(x, y + dy)
        if maxw is not None and width > maxw > 0: canvas.scale(maxw / width, 1)
        for face, gl, xs, ys in runs:
            if not gl: continue
            f = skia.Font(face.tf, size); f.setSubpixel(True); f.setEdging(self.edging); f.setHinting(skia.FontHinting.kNone)
            if style != "normal" and not face.tf.isItalic(): f.setSkewX(-0.25)   # synthetic oblique, as Chrome's
            b = skia.TextBlobBuilder(); b.allocRunPos(f, gl, [skia.Point(a, c) for a, c in zip(xs, ys)])
            blob = b.make()
            if blob is not None: canvas.drawTextBlob(blob, 0, 0, paint)
        canvas.restore()
