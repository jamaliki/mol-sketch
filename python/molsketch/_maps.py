"""Density maps: reading MRC / CCP4 files, fetching EMDB entries (with the recommended contour level), and finding the
map a PDB entry was built into.

A map is kept as a float32 grid, x fastest, with its origin and voxel size in Å, as the drawing core
(app/src/model/map.ts) holds it. Large maps are averaged down on reading (a 700³ ribosome map to at most
``max_voxels`` a side), a slab at a time from a memory-mapped file or as a gzipped one is decompressed, so they never
have to fit in memory whole.

An EMDB map is kept as read (averaged down, with its origin and voxel size to the bit) in MOLSKETCH_CACHE/emdb, with
EMDB's record of it, rather than as the file EMDB serves: a later run maps the grid straight from the file instead of
averaging the whole map down again, and a 700³ ribosome map takes 51 MB rather than 1.4 GB and its gzipped download.
The least recently used entries go past MOLSKETCH_MAP_CACHE_MB (1000 by default; _cache.py says how);
MOLSKETCH_MAP_CACHE_MB=0 turns the cache off.
"""
from __future__ import annotations

import gzip
import io
import json
import math
import os
import pathlib
import re
import struct
import zlib
from dataclasses import dataclass, field

import numpy as np

from . import _cache

_MODES = {0: np.int8, 1: np.int16, 2: np.float32, 6: np.uint16, 12: np.float16}


@dataclass
class DensityMap:
    """A density map: ``data`` is (z, y, x) float32 (x fastest in memory), ``origin`` the centre of voxel (0, 0, 0) and
    ``step`` the voxel size, both in Å. ``level`` is the recommended contour level, if known; ``binned`` how much the
    file was averaged down to fit ``max_voxels``."""
    name: str
    data: np.ndarray
    origin: tuple[float, float, float]
    step: tuple[float, float, float]
    level: float | None = None
    binned: int = 1
    source: str = ""
    meta: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int, int]:
        """(nx, ny, nz)"""
        z, y, x = self.data.shape; return (x, y, z)

    def header(self) -> dict:
        """what the drawing core needs besides the grid: size, origin, voxel size, recommended level, binning, mass, resolution"""
        nx, ny, nz = self.shape
        return {"name": self.name, "nx": nx, "ny": ny, "nz": nz, "origin": list(self.origin), "step": list(self.step), "level": self.level, "binned": self.binned,
                "mass": self.meta.get("mass"), "resolution": self.meta.get("resolution")}

    def __repr__(self):
        nx, ny, nz = self.shape
        lv = f", recommended level {self.level:g}" if self.level is not None else ""
        return f"<molsketch.DensityMap {self.name!r}: {nx}×{ny}×{nz} at {self.step[0]:.2f} Å{lv}>"


def read_map(path: str | os.PathLike, *, name: str | None = None, level: float | None = None, max_voxels: int = 320) -> DensityMap:
    """Read an MRC / CCP4 map (``.mrc``, ``.map``, ``.ccp4``, and any of them ``.gz``), averaging it down so no side is
    longer than ``max_voxels``. A gzipped file is decompressed as it is read: nothing is written beside it."""
    path = pathlib.Path(path)
    plain = path.with_suffix("") if path.suffix == ".gz" else path
    if path.suffix == ".gz":
        with gzip.open(path, "rb") as fh: data, origin, step, f = _read(fh, None, max_voxels, path)
    else:
        with open(path, "rb") as fh: data, origin, step, f = _read(fh, path, max_voxels, path)
    return DensityMap(name or re.sub(r"\.(map|mrc|ccp4)$", "", plain.name, flags=re.I), data, origin, step, level, f, str(path))


def _read(fh, mapped: pathlib.Path | None, max_voxels: int, what) -> tuple:
    """a map's grid (z, y, x), origin, voxel size and binning, from ``fh`` at its start: its voxels from a memory map of
    file ``mapped`` (read where they are needed), or else from ``fh`` itself, a slab at a time, as it reads on"""
    head = fh.read(1024)
    if len(head) < 1024: raise ValueError(f"{what} is not an MRC / CCP4 map")
    le = 0 <= struct.unpack_from("<i", head, 12)[0] <= 16
    end = "<" if le else ">"
    w = struct.unpack_from(end + "10i6f3i3f3i", head, 0)
    nc, nr, ns, mode, ncs, nrs, nss, mx, my, mz = w[:10]
    cx, cy, cz = w[10:13]
    mapc, mapr, maps = w[16:19]
    nsymbt = struct.unpack_from(end + "i", head, 23 * 4)[0]
    ox, oy, oz = struct.unpack_from(end + "3f", head, 49 * 4)
    if not (nc > 0 and nr > 0 and ns > 0) or sorted((mapc, mapr, maps)) != [1, 2, 3]: raise ValueError(f"{what} is not an MRC / CCP4 map")
    if mode not in _MODES: raise ValueError(f"MRC mode {mode} is not supported (0, 1, 2, 6 and 12 are)")
    dtype = np.dtype(_MODES[mode]).newbyteorder(end)
    # the file's axes are (section, row, column), which are the model's axes maps, mapr, mapc: put them in (z, y, x)
    order = [0, 0, 0]
    for file_ax, model_ax in ((0, maps - 1), (1, mapr - 1), (2, mapc - 1)): order[2 - model_ax] = file_ax
    nz, ny, nx = ((ns, nr, nc)[a] for a in order)
    starts = {mapc - 1: ncs, mapr - 1: nrs, maps - 1: nss}   # the first voxel's index along each model axis
    # voxel size per model axis: the cell's length along it over its sampling
    cell = (cx, cy, cz); samp = (mx or nx, my or ny, mz or nz); vstep = tuple(cell[a] / samp[a] for a in range(3))
    f = max(1, math.ceil(max(nx, ny, nz) / max_voxels))
    if mapped is not None:
        raw = np.memmap(mapped, dtype=dtype, mode="r", offset=1024 + nsymbt, shape=(ns, nr, nc))
        sections = lambda k0, k1: raw[k0:k1]
    else:
        _fill(fh, bytearray(nsymbt))   # (the extended header)
        def sections(k0, k1):
            buf = bytearray((k1 - k0) * nr * nc * dtype.itemsize); _fill(fh, buf)
            return np.frombuffer(buf, dtype).reshape(k1 - k0, nr, nc)
    # averaged over f³ blocks in the file's own order, a slab of sections at a time (read straight through), then turned
    data = np.transpose(sections(0, ns) if f == 1 else _bin(sections, (ns, nr, nc), f), order)
    origin = (ox, oy, oz) if (ox or oy or oz) else tuple(starts[a] * vstep[a] for a in range(3))
    origin = tuple(origin[a] + (f - 1) / 2 * vstep[a] for a in range(3))
    return np.ascontiguousarray(data, dtype=np.float32), origin, tuple(v * f for v in vstep), f


def _fill(fh, buf: bytearray):
    view = memoryview(buf); got = 0
    while got < len(buf):
        n = fh.readinto(view[got:])
        if not n: raise ValueError("the map file ends early")
        got += n


def _bin(sections, shape, f: int) -> np.ndarray:
    """a volume (as ``sections(k0, k1)`` gives it) averaged over f³ blocks, f sections at a time"""
    ns, nr, nc = (s // f for s in shape)
    out = np.empty((ns, nr, nc), np.float32)
    for k in range(ns):
        slab = np.asarray(sections(k * f, (k + 1) * f)[:, :nr * f, :nc * f], dtype=np.float32)
        out[k] = slab.reshape(f, nr, f, nc, f).mean(axis=(0, 2, 4))
    return out


def emdb_id(key: str) -> str:
    """'EMD-11638', 'emd_11638', '11638' → 'EMD-11638'"""
    m = re.fullmatch(r"(?:emd[-_]?)?(\d{4,6})", key.strip(), re.I)
    if not m: raise ValueError(f"{key!r} is not an EMDB ID (e.g. EMD-11638)")
    return f"EMD-{m.group(1)}"


def emdb_entry(eid: str) -> dict:
    """EMDB's record of an entry (cached): its map's contour level, size, voxel size, fitted models"""
    from . import _download
    maps = _cache.shelf("maps"); p = maps.dir / f"{eid}.json"
    if maps.on:
        try:
            entry = json.loads(p.read_bytes()); maps.used(p); return entry
        except (FileNotFoundError, ValueError): pass   # not fetched yet, or let go since
    data = _download(f"https://www.ebi.ac.uk/emdb/api/entry/{eid}")
    maps.put(p, data)
    return json.loads(data)


def recommended_level(entry: dict) -> float | None:
    cs = ((entry.get("map") or {}).get("contour_list") or {}).get("contour") or []
    prim = [c for c in cs if c.get("primary")] or cs
    return float(prim[0]["level"]) if prim and prim[0].get("level") is not None else None


def fetch_map(key: str, *, max_voxels: int = 320) -> DensityMap:
    """An EMDB entry's primary map, with its recommended contour level. Downloaded once, and kept as read (averaged
    down to ``max_voxels`` a side) in ``~/.cache/molsketch/emdb``, so a later run reads it back as it is drawn."""
    from . import _download
    eid = emdb_id(key); num = eid[4:]
    maps = _cache.shelf("maps")
    entry = emdb_entry(eid)
    kept = maps.dir / f"emd_{num}.{max_voxels:g}.msmap"
    m = _kept(kept, max_voxels) if maps.on else None
    if m is not None: maps.used(kept)
    else:
        whole = [f for f in (maps.dir / f"emd_{num}.map", maps.dir / f"emd_{num}.map.gz") if maps.on and f.is_file()]
        try: m = read_map(whole[0], max_voxels=max_voxels) if whole else None   # kept whole by an earlier version
        except (OSError, ValueError, EOFError, zlib.error): m = None   # (half written)
        if m is None:
            url = f"https://ftp.ebi.ac.uk/pub/databases/emdb/structures/{eid}/map/emd_{num}.map.gz"; data = _download(url)
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as fh: grid, origin, step, f = _read(fh, None, max_voxels, eid)
            del data
            m = DensityMap(eid, grid, origin, step, None, f, url)
        if maps.put(kept, _keeping(m, max_voxels)) is not None:
            m.source = str(kept)
            for f in whole: f.unlink(missing_ok=True)   # (as read, it is all a later run needs)
    m.name = eid; m.level = recommended_level(entry)
    m.meta = {"title": (entry.get("admin") or {}).get("title"), "resolution": _resolution(entry), "mass": _mass(entry)}
    return m


MAGIC = b"MSMAP1\n"   # a map kept as read: this, the length of a JSON header, the header, then float32 (z, y, x), little-endian


def _keeping(m: DensityMap, max_voxels):
    """what writes map ``m`` (read at ``max_voxels``) to a file: its grid as it is, its origin and voxel size to the bit"""
    head = json.dumps({"shape": list(m.data.shape), "origin": list(m.origin), "step": list(m.step), "binned": m.binned, "max_voxels": max_voxels}).encode()
    head += b" " * (-(len(MAGIC) + 4 + len(head)) % 64)   # (the grid starts on a multiple of 64 bytes)
    def write(fh):
        fh.write(MAGIC + struct.pack("<I", len(head)) + head); fh.write(np.ascontiguousarray(m.data, dtype="<f4").data)
    return write


def _kept(path: pathlib.Path, max_voxels) -> DensityMap | None:
    """the map kept in ``path`` (its grid mapped from the file, read where it is needed); None if there is none, or it
    is not whole"""
    try:
        with open(path, "rb") as fh:
            if fh.read(len(MAGIC)) != MAGIC: return None
            n, = struct.unpack("<I", fh.read(4)); head = json.loads(fh.read(n))
            at = len(MAGIC) + 4 + n; shape = tuple(int(k) for k in head["shape"])
            if head["max_voxels"] != max_voxels or len(shape) != 3 or os.fstat(fh.fileno()).st_size != at + 4 * math.prod(shape): return None
        data = np.asarray(np.memmap(path, dtype="<f4", mode="r", offset=at, shape=shape))
        return DensityMap(path.name, data, tuple(float(v) for v in head["origin"]), tuple(float(v) for v in head["step"]), None, int(head["binned"]), str(path))
    except (OSError, ValueError, KeyError, TypeError, struct.error): return None


def _mass(entry: dict) -> float | None:
    """the sample's molecular mass in Da, as deposited: the whole complex's (the first supramolecule), else the sum of its macromolecules"""
    def da(w):
        t = ((w or {}).get("theoretical") or (w or {}).get("experimental") or {})
        try: return float(t["valueOf_"]) * {"MDa": 1e6, "kDa": 1e3, "Da": 1}.get(t.get("units", "MDa"), 1e6)
        except (KeyError, TypeError, ValueError): return None
    sample = entry.get("sample") or {}
    for s in ((sample.get("supramolecule_list") or {}).get("supramolecule") or [])[:1]:
        m = da(s.get("molecular_weight"))
        if m: return m
    return None


def _resolution(entry: dict) -> float | None:
    try:
        for sd in entry["structure_determination_list"]["structure_determination"]:
            for ip in sd["image_processing"]:
                r = ip.get("final_reconstruction", {}).get("resolution", {})
                if isinstance(r, dict) and r.get("valueOf_"): return float(r["valueOf_"])
    except (KeyError, TypeError, ValueError):
        pass
    return None


def map_for_pdb(pdb_id: str) -> str:
    """the EMDB entry a PDB entry was built into (the first, if several), from RCSB (and kept with the maps)"""
    from . import _download
    pid = pdb_id.strip().upper()
    maps = _cache.shelf("maps"); p = maps.dir / f"pdb_{pid}.json"
    ids = None
    if maps.on and re.fullmatch(r"[0-9A-Z]+", pid):
        try: ids = list(json.loads(p.read_bytes())["emdb_ids"]); maps.used(p)
        except (FileNotFoundError, ValueError, KeyError, TypeError): ids = None
    if ids is None:
        d = json.loads(_download(f"https://data.rcsb.org/rest/v1/core/entry/{pid}"))
        ids = (d.get("rcsb_entry_container_identifiers") or {}).get("emdb_ids") or []
        if re.fullmatch(r"[0-9A-Z]+", pid): maps.put(p, json.dumps({"emdb_ids": ids}).encode())
    if not ids: raise ValueError(f"{pdb_id} has no EMDB map (it is not a cryo-EM structure, or none was deposited)")
    return ids[0]
