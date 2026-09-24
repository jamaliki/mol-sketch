"""Density maps: reading MRC / CCP4 files, fetching EMDB entries (with the recommended contour level), and finding the
map a PDB entry was built into.

A map is kept as a float32 grid, x fastest, with its origin and voxel size in Å, as the drawing core
(app/src/model/map.ts) holds it. Large maps are averaged down on reading (a 700³ ribosome map to at most
``max_voxels`` a side), a slab at a time from a memory-mapped file, so they never have to fit in memory whole.
"""
from __future__ import annotations

import gzip
import json
import math
import os
import pathlib
import re
import shutil
import struct
import tempfile
from dataclasses import dataclass, field

import numpy as np

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
    longer than ``max_voxels``."""
    path = pathlib.Path(path)
    tmp = None
    if path.suffix == ".gz":   # a memory map needs the plain file: decompress it next to the cache, once
        plain = path.with_suffix("")
        if not plain.exists() or plain.stat().st_mtime < path.stat().st_mtime:
            fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".map"); os.close(fd)
            with gzip.open(path, "rb") as src, open(tmp, "wb") as dst: shutil.copyfileobj(src, dst, 1 << 22)
            os.replace(tmp, plain)
        path = plain
    with open(path, "rb") as f: head = f.read(1024)
    le = 0 <= struct.unpack_from("<i", head, 12)[0] <= 16
    end = "<" if le else ">"
    w = struct.unpack_from(end + "10i6f3i3f3i", head, 0)
    nc, nr, ns, mode, ncs, nrs, nss, mx, my, mz = w[:10]
    cx, cy, cz = w[10:13]
    mapc, mapr, maps = w[16:19]
    nsymbt = struct.unpack_from(end + "i", head, 23 * 4)[0]
    ox, oy, oz = struct.unpack_from(end + "3f", head, 49 * 4)
    if not (nc > 0 and nr > 0 and ns > 0) or sorted((mapc, mapr, maps)) != [1, 2, 3]: raise ValueError(f"{path} is not an MRC / CCP4 map")
    if mode not in _MODES: raise ValueError(f"MRC mode {mode} is not supported (0, 1, 2, 6 and 12 are)")
    raw = np.memmap(path, dtype=np.dtype(_MODES[mode]).newbyteorder(end), mode="r", offset=1024 + nsymbt, shape=(ns, nr, nc))
    # the file's axes are (section, row, column), which are the model's axes maps, mapr, mapc: put them in (z, y, x)
    order = [0, 0, 0]
    for file_ax, model_ax in ((0, maps - 1), (1, mapr - 1), (2, mapc - 1)): order[2 - model_ax] = file_ax
    vol = np.transpose(raw, order)
    starts = {mapc - 1: ncs, mapr - 1: nrs, maps - 1: nss}   # the first voxel's index along each model axis
    nx, ny, nz = vol.shape[2], vol.shape[1], vol.shape[0]
    # voxel size per model axis: the cell's length along it over its sampling
    cell = (cx, cy, cz); samp = (mx or nx, my or ny, mz or nz); vstep = tuple(cell[a] / samp[a] for a in range(3))
    f = max(1, math.ceil(max(nx, ny, nz) / max_voxels))
    data = _bin(vol, f)
    origin = (ox, oy, oz) if (ox or oy or oz) else tuple(starts[a] * vstep[a] for a in range(3))
    origin = tuple(origin[a] + (f - 1) / 2 * vstep[a] for a in range(3))
    return DensityMap(name or re.sub(r"\.(map|mrc|ccp4)$", "", path.name, flags=re.I), data, origin, tuple(v * f for v in vstep), level, f, str(path))


def _bin(vol, f: int) -> np.ndarray:
    """a volume (z, y, x) averaged over f³ blocks, a slab of z at a time"""
    if f == 1: return np.ascontiguousarray(vol, dtype=np.float32)
    nz, ny, nx = (s // f for s in vol.shape)
    out = np.empty((nz, ny, nx), np.float32)
    for k in range(nz):
        slab = np.asarray(vol[k * f:(k + 1) * f, :ny * f, :nx * f], dtype=np.float32)
        out[k] = slab.reshape(f, ny, f, nx, f).mean(axis=(0, 2, 4))
    return out


def cache_dir() -> pathlib.Path:
    d = pathlib.Path(os.environ.get("MOLSKETCH_CACHE", pathlib.Path.home() / ".cache" / "molsketch")) / "emdb"
    d.mkdir(parents=True, exist_ok=True); return d


def emdb_id(key: str) -> str:
    """'EMD-11638', 'emd_11638', '11638' → 'EMD-11638'"""
    m = re.fullmatch(r"(?:emd[-_]?)?(\d{4,6})", key.strip(), re.I)
    if not m: raise ValueError(f"{key!r} is not an EMDB ID (e.g. EMD-11638)")
    return f"EMD-{m.group(1)}"


def emdb_entry(eid: str) -> dict:
    """EMDB's record of an entry (cached): its map's contour level, size, voxel size, fitted models"""
    from . import _download
    p = cache_dir() / f"{eid}.json"
    if not p.exists(): p.write_bytes(_download(f"https://www.ebi.ac.uk/emdb/api/entry/{eid}"))
    return json.loads(p.read_text())


def recommended_level(entry: dict) -> float | None:
    cs = ((entry.get("map") or {}).get("contour_list") or {}).get("contour") or []
    prim = [c for c in cs if c.get("primary")] or cs
    return float(prim[0]["level"]) if prim and prim[0].get("level") is not None else None


def fetch_map(key: str, *, max_voxels: int = 320) -> DensityMap:
    """An EMDB entry's primary map, downloaded once (``~/.cache/molsketch/emdb``), with its recommended contour level."""
    from . import _download
    eid = emdb_id(key); num = eid[4:]
    entry = emdb_entry(eid)
    gz = cache_dir() / f"emd_{num}.map.gz"
    if not gz.exists():
        tmp = gz.with_suffix(".part"); tmp.write_bytes(_download(f"https://ftp.ebi.ac.uk/pub/databases/emdb/structures/{eid}/map/emd_{num}.map.gz")); tmp.replace(gz)
    m = read_map(gz, name=eid, level=recommended_level(entry), max_voxels=max_voxels)
    m.meta = {"title": (entry.get("admin") or {}).get("title"), "resolution": _resolution(entry), "mass": _mass(entry)}
    return m


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
    """the EMDB entry a PDB entry was built into (the first, if several), from RCSB"""
    from . import _download
    d = json.loads(_download(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id.strip().upper()}"))
    ids = (d.get("rcsb_entry_container_identifiers") or {}).get("emdb_ids") or []
    if not ids: raise ValueError(f"{pdb_id} has no EMDB map (it is not a cryo-EM structure, or none was deposited)")
    return ids[0]
