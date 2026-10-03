"""A drawn figure: save it, show it in a notebook, or take its pixels."""
from __future__ import annotations

import os
import pathlib
import struct
import zlib

import numpy as np
import skia

_FORMATS = {".png": skia.kPNG, ".jpg": skia.kJPEG, ".jpeg": skia.kJPEG, ".webp": skia.kWEBP}


def _png(rgba: np.ndarray, level: int = 4) -> bytes:
    """a PNG of straight-alpha RGBA pixels: every row with the Sub filter, deflated at `level`. The same pixels as Skia's
    encoder writes (PNG is lossless), at level 4 in a third of its time (it tries every filter on every row), and no
    larger"""
    h, w, _ = rgba.shape; x = rgba.reshape(h, w * 4)
    raw = np.empty((h, w * 4 + 1), np.uint8); raw[:, 0] = 1
    raw[:, 1:5] = x[:, :4]; np.subtract(x[:, 4:], x[:, :-4], out=raw[:, 5:])   # wraps modulo 256, as the filter wants
    chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw.tobytes(), level)) + chunk(b"IEND", b""))


def png_of(sk: skia.Image, level: int = 4) -> bytes:
    """a Skia image as PNG bytes (see _png)"""
    return _png(sk.toarray(colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kUnpremul_AlphaType), level)


class Image:
    """A drawn figure, as pixels. Get one from ``Figure.render()``.

    Save it with ``img.save("fig.png")``, take its pixels with ``img.to_numpy()`` or ``img.to_pil()``, or get PNG bytes
    with ``img.png()``. In a notebook it shows itself. ``numpy.asarray(img)`` also works."""

    def __init__(self, sk: skia.Image):
        self._sk = sk

    @property
    def width(self) -> int:
        """Width in pixels."""
        return self._sk.width()

    @property
    def height(self) -> int:
        """Height in pixels."""
        return self._sk.height()

    @property
    def size(self) -> tuple[int, int]:
        """``(width, height)`` in pixels."""
        return (self.width, self.height)

    def png(self) -> bytes:
        """The image as PNG file bytes (for a web response, a database, and so on)."""
        return _png(self.to_numpy())

    def save(self, path: str | os.PathLike, quality: int = 92) -> pathlib.Path:
        """Write the image to a file and return its path. The extension picks the format: ``.png``, ``.jpg`` or
        ``.webp``. ``quality`` (0–100) applies to JPEG and WebP; PNG is always lossless. Missing folders are created."""
        path = pathlib.Path(path); fmt = _FORMATS.get(path.suffix.lower())
        if fmt is None: raise ValueError(f"images are .png, .jpg or .webp, not {path.suffix or 'no extension'}")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = _png(self.to_numpy()) if fmt == skia.kPNG else bytes(self._sk.encodeToData(fmt, quality))
        path.write_bytes(data); return path

    def to_numpy(self):
        """The pixels as a NumPy array of shape ``(height, width, 4)``, type ``uint8``, in RGBA order. Alpha is straight
        (not premultiplied), as image libraries expect."""
        return self._sk.toarray(colorType=skia.kRGBA_8888_ColorType, alphaType=skia.kUnpremul_AlphaType)

    def to_pil(self):
        """The image as a Pillow ``Image`` in RGBA mode. Needs Pillow (``pip install pillow``)."""
        from PIL import Image as PILImage   # optional: pip install pillow
        return PILImage.fromarray(self.to_numpy(), "RGBA")

    def __array__(self, dtype=None, copy=None):
        a = self.to_numpy(); return a.astype(dtype) if dtype is not None else a

    def _repr_png_(self): return self.png()

    def __repr__(self): return f"<molsketch.Image {self.width}×{self.height}>"
