"""Large structures kept between runs as read: reading a structure's text is most of the first drawing of a large one
(a ribosome's 25 MB of mmCIF: a third of a second of a fresh engine's time), and a later run reads it back from what the
first one read in a few hundredths (app/src/model/kept.ts says how it is laid out).

Files live in MOLSKETCH_CACHE/models (~/.cache/molsketch/models), one per structure, named by a hash of its text and the
engine that read it: a header saying both, then the structure's bytes. Only texts of at least ``SMALLEST`` characters
are kept (a smaller one reads in a few milliseconds). The least recently used go past MOLSKETCH_MODEL_CACHE_MB (300 by
default); MOLSKETCH_MODEL_CACHE_MB=0 turns the cache off."""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import struct
import tempfile

MAGIC = b"MSMODEL1\n"
SMALLEST = 2 << 20   # characters


class ModelCache:
    def __init__(self, host: str, folder: pathlib.Path | None = None, limit_mb: float | None = None):
        self.host = host   # the engine that reads and writes them (a hash of its code)
        if limit_mb is None: limit_mb = float(os.environ.get("MOLSKETCH_MODEL_CACHE_MB", "300"))
        self.limit = int(limit_mb * 1e6)
        self.dir = folder or pathlib.Path(os.environ.get("MOLSKETCH_CACHE", pathlib.Path.home() / ".cache" / "molsketch")) / "models"

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
        f = self._path(key)
        try:
            with open(f, "rb") as fh:
                if fh.read(len(MAGIC)) != MAGIC: return None
                n, = struct.unpack("<I", fh.read(4)); head = json.loads(fh.read(n))
                if head["key"] != key or head["host"] != self.host: return None
                data = fh.read()
            if len(data) != head["size"]: return None
            os.utime(f)   # used: the last to go
            return data
        except (OSError, ValueError, KeyError, struct.error): return None

    def keep(self, key: str, data: bytes):
        """the structure read from text `key` (its bytes) into a file, written whole and then put in place"""
        if not self.on or len(data) > self.limit: return
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            head = json.dumps({"key": key, "host": self.host, "size": len(data)}).encode()
            fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".part")
            try:
                with os.fdopen(fd, "wb") as fh: fh.write(MAGIC + struct.pack("<I", len(head)) + head); fh.write(data)
                os.replace(tmp, self._path(key))
            except BaseException:
                pathlib.Path(tmp).unlink(missing_ok=True); raise
            self._prune()
        except OSError: pass

    def _prune(self):
        try:
            fs = sorted(self.dir.glob("*.msm"), key=lambda f: f.stat().st_mtime, reverse=True); total = 0
            for f in fs:
                total += f.stat().st_size
                if total > self.limit: f.unlink(missing_ok=True)
        except OSError: pass
