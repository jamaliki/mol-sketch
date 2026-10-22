"""Large structures kept between runs as read: reading a structure's text is most of the first drawing of a large one
(a ribosome's 25 MB of mmCIF: a third of a second of a fresh engine's time), and a later run reads it back from what the
first one read in a few hundredths (app/src/model/kept.ts says how it is laid out).

Files live in MOLSKETCH_CACHE/models (~/.cache/molsketch/models), one per structure, named by a hash of its text and the
engine that read it: a header saying both, then the structure's bytes. Only texts of at least ``SMALLEST`` characters
are kept (a smaller one reads in a few milliseconds). The least recently used go past MOLSKETCH_MODEL_CACHE_MB (300 by
default; _cache.py says how); MOLSKETCH_MODEL_CACHE_MB=0 turns the cache off."""
from __future__ import annotations

import hashlib
import json
import pathlib
import struct

from . import _cache

MAGIC = b"MSMODEL1\n"
SMALLEST = 2 << 20   # characters


class ModelCache:
    def __init__(self, host: str, folder: pathlib.Path | None = None, limit_mb: float | None = None):
        self.host = host   # the engine that reads and writes them (a hash of its code)
        self.shelf = _cache.shelf("models", folder, limit_mb)
        self.limit = self.shelf.limit; self.dir = self.shelf.dir

    @property
    def on(self) -> bool: return self.limit > 0

    @staticmethod
    def key(text: str) -> str:
        """what a structure's text is kept by: a hash of the whole of it (the name it is read under is not part of it)"""
        return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()

    def _path(self, key: str) -> pathlib.Path:
        return self.dir / (hashlib.sha1((self.host + "\n" + key).encode()).hexdigest()[:24] + ".msm")

    def load(self, key: str) -> bytes | None:
        """the structure kept for text `key`, as bytes; None if there is none (or it is not this engine's)"""
        if not self.on: return None
        f = self._path(key); self.shelf.open(f)
        try:
            with open(f, "rb") as fh:
                if fh.read(len(MAGIC)) != MAGIC: return None
                n, = struct.unpack("<I", fh.read(4)); head = json.loads(fh.read(n))
                if head["key"] != key or head["host"] != self.host: return None
                data = fh.read()
            if len(data) != head["size"]: return None
            self.shelf.used(f)   # the last to go
            return data
        except (OSError, ValueError, KeyError, struct.error): return None

    def keep(self, key: str, data: bytes):
        """the structure read from text `key` (its bytes) into a file, written whole and then put in place"""
        if not self.on: return
        head = json.dumps({"key": key, "host": self.host, "size": len(data)}).encode()
        self.shelf.put(self._path(key), lambda fh: (fh.write(MAGIC + struct.pack("<I", len(head)) + head), fh.write(data)))
