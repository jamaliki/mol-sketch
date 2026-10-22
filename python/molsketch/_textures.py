"""The engine's textures kept between runs: the paper, its grain, the chalk's tooth. Each is hundreds of thousands of
small marks, and drawing them was most of a fresh process's first figure (seconds at full size); kept as files, a
later run takes the pixels the first one drew. The engine names each by everything it depends on (and the version of
the code that draws it), so a file is only ever used for exactly the texture it holds.

Files live in MOLSKETCH_CACHE/textures (~/.cache/molsketch/textures), one per texture, named by the code that drew it
(so a process looks only at its own version's) and a hash of its key: a header naming it, then its premultiplied pixels,
deflated. The least recently used go past MOLSKETCH_TEXTURE_CACHE_MB (300 by default; _cache.py says how);
MOLSKETCH_TEXTURE_CACHE_MB=0 turns the cache off."""
from __future__ import annotations

import hashlib
import json
import pathlib
import struct
import zlib

import numpy as np
import skia

from . import _cache

MAGIC = b"MSTX1\n"
CT = skia.ColorType.kN32_ColorType   # the surfaces' own layout: pixels go back exactly as they came


class TextureCache:
    def __init__(self, host: str, folder: pathlib.Path | None = None, limit_mb: float | None = None):
        self.host = host
        self.shelf = _cache.shelf("textures", folder, limit_mb)
        self.limit = self.shelf.limit; self.dir = self.shelf.dir   # (the engine sets limit to 0 to stop using it)
        self.files: dict[str, pathlib.Path] = {}
        if self.limit <= 0: return
        try: self.dir.mkdir(parents=True, exist_ok=True)
        except OSError: self.limit = 0; return
        self.shelf.open()   # (pruned before the engine is told what there is)
        self.rescan()

    def rescan(self):
        """the textures the folder holds now, of this version"""
        self.files = {}
        for f in self.dir.glob(self.host + "-*.tex"):
            try:
                with open(f, "rb") as h:
                    if h.read(len(MAGIC)) != MAGIC: continue
                    n, = struct.unpack("<I", h.read(4)); head = json.loads(h.read(n))
                if head["host"] == self.host: self.files[head["key"]] = f
            except (OSError, ValueError, KeyError, struct.error): continue

    @property
    def on(self) -> bool: return self.limit > 0

    def keys(self) -> list[str]: return list(self.files)

    def load(self, key: str, canvas: skia.Canvas, w: int, h: int) -> bool:
        """texture `key`'s pixels onto a fresh canvas of w × h; False if it is not here (any more) or not that size"""
        f = self.files.get(key)
        if f is None: return False
        try:
            with open(f, "rb") as fh:
                if fh.read(len(MAGIC)) != MAGIC: raise ValueError
                n, = struct.unpack("<I", fh.read(4)); head = json.loads(fh.read(n))
                if head["key"] != key or head["host"] != self.host or head["w"] != w or head["h"] != h: raise ValueError
                px = np.frombuffer(zlib.decompress(fh.read()), np.uint8).reshape(h, w, 4)
            img = skia.Image.fromarray(px, colorType=CT, alphaType=skia.AlphaType.kPremul_AlphaType)
            canvas.save(); canvas.resetMatrix(); canvas.drawImage(img, 0, 0, skia.SamplingOptions(), skia.Paint(BlendMode=skia.BlendMode.kSrc)); canvas.restore()
            self.shelf.used(f)   # the last to go
            return True
        except (OSError, ValueError, KeyError, zlib.error, struct.error):
            self.files.pop(key, None); return False

    def keep(self, key: str, surface: skia.Surface):
        """texture `key`'s pixels, as drawn, into a file (written whole, then put in place)"""
        if not self.on or surface is None or key in self.files: return
        try:
            img = surface.makeImageSnapshot(); w, h = img.width(), img.height()
            px = img.toarray(colorType=CT, alphaType=skia.AlphaType.kPremul_AlphaType)
            head = json.dumps({"key": key, "host": self.host, "w": w, "h": h}).encode()
            path = self.dir / (self.host + "-" + hashlib.sha1((self.host + "\n" + key).encode()).hexdigest()[:24] + ".tex")
            gone = self.shelf.put(path, MAGIC + struct.pack("<I", len(head)) + head + zlib.compress(np.ascontiguousarray(px).tobytes(), 1))
        except OSError: return
        if gone is None: return
        self.files[key] = path
        if gone:   # the least recently used, let go to make room: the engine is told before the next render
            gone = set(gone); self.files = {k: v for k, v in self.files.items() if v not in gone}
