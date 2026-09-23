"""A drawn figure: save it, show it in a notebook, or take its pixels."""
from __future__ import annotations

import os
import pathlib

import skia

_FORMATS = {".png": skia.kPNG, ".jpg": skia.kJPEG, ".jpeg": skia.kJPEG, ".webp": skia.kWEBP}


class Image:
    """A rendered figure. ``img.save("fig.png")``, ``img.to_numpy()`` (RGBA), ``img.to_pil()``; notebooks show it."""

    def __init__(self, sk: skia.Image):
        self._sk = sk

    @property
    def width(self) -> int: return self._sk.width()

    @property
    def height(self) -> int: return self._sk.height()

    @property
    def size(self) -> tuple[int, int]: return (self.width, self.height)

    def png(self) -> bytes:
        """the image as PNG bytes"""
        return bytes(self._sk.encodeToData(skia.kPNG, 100))

    def save(self, path: str | os.PathLike, quality: int = 92) -> pathlib.Path:
        """write the image; the format follows the extension (.png, .jpg, .webp)"""
        path = pathlib.Path(path); fmt = _FORMATS.get(path.suffix.lower())
        if fmt is None: raise ValueError(f"images are .png, .jpg or .webp, not {path.suffix or 'no extension'}")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = self._sk.encodeToData(fmt, 100 if fmt == skia.kPNG else quality)
        path.write_bytes(bytes(data)); return path

    def to_numpy(self):
        """height × width × 4 uint8, RGBA, straight (not premultiplied) alpha"""
        return self._sk.toarray(colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kUnpremul_AlphaType)

    def to_pil(self):
        from PIL import Image as PILImage   # optional: pip install pillow
        return PILImage.fromarray(self.to_numpy(), "RGBA")

    def __array__(self, dtype=None, copy=None):
        a = self.to_numpy(); return a.astype(dtype) if dtype is not None else a

    def _repr_png_(self): return self.png()

    def __repr__(self): return f"<molsketch.Image {self.width}×{self.height}>"
