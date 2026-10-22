"""What molsketch keeps on disk between runs, and how much of it.

Each cache is a folder of MOLSKETCH_CACHE (~/.cache/molsketch) with a size bound of its own, in megabytes, from an
environment variable; 0 turns that cache off (nothing is kept: everything is fetched, read or drawn afresh):

    what                                   where        bound      set by
    structure files fetched from the PDB   *.cif         500 MB    MOLSKETCH_DOWNLOAD_CACHE_MB
    EMDB maps (as read) and their records  emdb/        1000 MB    MOLSKETCH_MAP_CACHE_MB
    paper, grain and chalk textures        textures/     300 MB    MOLSKETCH_TEXTURE_CACHE_MB
    large structures kept as read          models/       300 MB    MOLSKETCH_MODEL_CACHE_MB

An entry is one file, or for EMDB the files of one entry. A file used is touched (its modification time set to now, a
few microseconds), and a cache past its bound lets its least recently used entries go first. That is worked out when
an entry is written, and once in each process the first time it uses the cache (so a lowered bound, or a cache filled
before there were bounds, comes down without waiting for a write); never on a read. An entry larger than the whole
bound is kept alone: everything else in its cache goes, and it goes in turn when anything else is kept.

Several processes can share a cache: an entry is written whole and then put in place, a file another process has let go
meanwhile is passed over, and a reader whose entry has gone fetches, reads or draws it again."""
from __future__ import annotations

import math
import os
import pathlib
import re
import tempfile
import time
from collections.abc import Callable

STALE = 3600.0   # seconds: a half-written file (a process that stopped while writing) left this long is removed


def root() -> pathlib.Path:
    """MOLSKETCH_CACHE, else ~/.cache/molsketch"""
    return pathlib.Path(os.environ.get("MOLSKETCH_CACHE") or pathlib.Path.home() / ".cache" / "molsketch")


def limit_mb(env: str, default: float) -> float:
    """a cache's bound in MB from its environment variable: the default if unset or not a number, 0 (off) if negative"""
    try: mb = float(os.environ.get(env) or default)
    except ValueError: return default
    if math.isnan(mb): return default
    return min(max(0.0, mb), 1e9)   # (inf: as good as unbounded)


class Shelf:
    """One cache: the files in ``dir`` that ``entry`` names (it gives the entry a file belongs to, or None for a file that
    is not the cache's), at most ``limit`` bytes of them, the least recently used going first."""

    def __init__(self, dir: pathlib.Path, limit: int, entry: Callable[[str], str | None], temp: Callable[[str], bool] | None = None):
        self.dir = dir; self.limit = limit; self.entry = entry
        self.temp = temp or (lambda name: name.endswith(".part"))   # a file being written (or left half-written)
        self._pruned = False

    @property
    def on(self) -> bool: return self.limit > 0

    def open(self, keep: pathlib.Path | None = None):
        """the cache's first use in this process: pruned, once (``keep``, the entry being used, stays)"""
        if self.on and not self._pruned: self.prune(keep)

    def used(self, path: pathlib.Path):
        """``path`` was just used: touched, so it is the last of its cache to go"""
        if not self.on: return
        self.open(path)
        try: os.utime(path)
        except OSError: pass   # gone: whoever reads it next makes it again

    def put(self, path: pathlib.Path, data) -> list[pathlib.Path] | None:
        """``data`` (bytes, or a function that writes to a file) kept as ``path``: written whole beside it, then put in
        its place, so a reader sees all of it or none; then the cache is pruned, and the files it let go are returned.
        None if the cache is off or the writing failed (the caller has what it needs; it is only not kept)"""
        if not self.on: return None
        tmp = None
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".", suffix=".part")
            with os.fdopen(fd, "wb") as fh:
                if callable(data): data(fh)
                else: fh.write(data)
            os.replace(tmp, path); tmp = None
        except OSError: return None
        finally:
            if tmp is not None: pathlib.Path(tmp).unlink(missing_ok=True)
        return self.prune(keep=path)

    def prune(self, keep: pathlib.Path | None = None) -> list[pathlib.Path]:
        """the least recently used entries let go until the rest fit the bound (``keep``'s entry, the one just written
        or used, stays whatever its size); half-written files left by stopped processes too. The files let go"""
        self._pruned = True
        if not self.on: return []
        entries: dict[str, list] = {}   # entry → [last used, bytes, files]
        now = time.time(); gone = []
        try: listing = os.scandir(self.dir)
        except OSError: return []
        with listing:
            for e in listing:
                try:
                    if not e.is_file(follow_symlinks=False): continue
                    st = e.stat(follow_symlinks=False)
                except OSError: continue   # let go meanwhile, by another process
                if self.temp(e.name):
                    if now - st.st_mtime > STALE and _remove(e.path): gone.append(pathlib.Path(e.path))
                    continue
                k = self.entry(e.name)
                if k is None: continue
                en = entries.setdefault(k, [0.0, 0, []]); en[0] = max(en[0], st.st_mtime); en[1] += st.st_size; en[2].append(e.path)
        first = self.entry(keep.name) if keep is not None else None
        total = 0; over = False
        # the one just used first (else the newest), whatever its size, then the rest newest first: past the bound, the
        # rest go
        for i, k in enumerate(sorted(entries, key=lambda k: (k != first, -entries[k][0]))):
            total += entries[k][1]; over = over or total > self.limit
            if over and i: gone += [pathlib.Path(f) for f in entries[k][2] if _remove(f)]
        return gone


def _remove(f) -> bool:
    try: os.unlink(f); return True
    except FileNotFoundError: return False   # another process got there first
    except OSError: return False             # in use where that forbids it (Windows): it stays, for now


PDB_FILE = re.compile(r"[0-9][A-Z0-9]{3}\.cif")
EMDB_FILE = re.compile(r"(?:EMD-|emd_)(\d+)\b.*")


def _download_entry(name: str) -> str | None:
    return name if PDB_FILE.fullmatch(name) else None


def _map_entry(name: str) -> str | None:
    """an EMDB entry's files (its record, its maps as read) go together; a PDB entry's map lookup is its own"""
    m = EMDB_FILE.fullmatch(name)
    if m: return m.group(1)
    return name if name.startswith("pdb_") and name.endswith(".json") else None


# kind → (folder in the cache, environment variable, default bound in MB, which files are its entries, which are temporary)
KINDS = {
    "downloads": ("", "MOLSKETCH_DOWNLOAD_CACHE_MB", 500, _download_entry, None),
    "maps": ("emdb", "MOLSKETCH_MAP_CACHE_MB", 1000, _map_entry, lambda name: name.endswith(".part") or (name.startswith("tmp") and name.endswith(".map"))),
    "textures": ("textures", "MOLSKETCH_TEXTURE_CACHE_MB", 300, lambda name: name if name.endswith(".tex") else None, None),
    "models": ("models", "MOLSKETCH_MODEL_CACHE_MB", 300, lambda name: name if name.endswith(".msm") else None, None),
}
_shelves: dict[tuple, Shelf] = {}


def shelf(kind: str, folder: pathlib.Path | None = None, mb: float | None = None) -> Shelf:
    """the cache of ``kind`` (one of KINDS) as the environment sets it now: the same Shelf while it stays the same, so it
    is pruned once per process. ``folder`` and ``mb`` override the environment"""
    sub, env, default, entry, temp = KINDS[kind]
    dir = folder or (root() / sub if sub else root())
    limit = int((limit_mb(env, default) if mb is None else max(0.0, mb)) * 1e6)
    key = (kind, str(dir), limit)
    s = _shelves.get(key)
    if s is None: s = _shelves[key] = Shelf(dir, limit, entry, temp)
    return s
