"""MolSketch: hand-drawn molecular figures from Python.

    import molsketch as ms

    fig = ms.fetch("5P21").look("engraved-colour").view(yaw=60, pitch=20)
    fig.site(ligand=True).label("Switch I", at="Tyr32", offset=(110, -60))
    fig.save("ras.png")

The drawing is the MolSketch app's own engine, run here without a browser, so a figure made in Python and the same
figure in the app are the same picture.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import urllib.request
from typing import Iterable

from ._engine import CoreError
from ._figure import Figure, looks, palettes, default_style
from ._image import Image
from ._maps import DensityMap, read_map

__all__ = ["load", "fetch", "scene", "load_map", "fetch_map", "read_map", "Figure", "Image", "DensityMap", "looks", "palettes", "default_style", "CoreError"]
__version__ = "0.1.0"


def load(source, *, name: str | None = None, format: str | None = None) -> Figure:
    """Make a figure from a structure or a scene. ``source`` can be:

    - a path to a ``.pdb`` or ``.cif`` file, or to a scene ``.json`` saved from the app;
    - a list of paths: a stack, drawn as one keyframe per file and animated between them;
    - the text of a PDB or mmCIF file (``format="pdb"`` or ``"cif"`` if it cannot be told from the text);
    - a scene as a dict;
    - a structure object from Biopython, gemmi or MDAnalysis.

    ``name`` is the figure's name (it defaults to the file name)."""
    if isinstance(source, dict): return Figure({"scene": source}, source.get("name") or name or "scene")
    if isinstance(source, (list, tuple)):
        files = [pathlib.Path(p) for p in source]
        return Figure({"stack": [{"text": p.read_text(), "name": p.name} for p in files]}, name or "stack")
    if isinstance(source, (str, os.PathLike)):
        s = str(source)
        if "\n" not in s and (os.path.exists(s) or re.search(r"\.(pdb|ent|cif|mmcif|json)$", s, re.I)):
            p = pathlib.Path(s)
            if not p.exists(): raise FileNotFoundError(f"no such file: {p}")
            if p.suffix.lower() == ".json": return Figure({"scene": json.loads(p.read_text())}, name or p.stem)
            return Figure({"text": p.read_text(), "name": p.name}, name or p.stem)
        if "\n" in s:
            ext = {"cif": ".cif", "mmcif": ".cif", "pdb": ".pdb", None: ".cif" if "_atom_site" in s[:20000] else ".pdb"}[format]
            return Figure({"text": s, "name": (name or "structure") + ext}, name or "structure")
        raise FileNotFoundError(f"no such file: {s} (for a PDB entry, use molsketch.fetch({s!r}))")
    text, ext = _from_object(source)
    return Figure({"text": text, "name": (name or "structure") + ext}, name or "structure")


def fetch(pdb_id: str, *, map: bool = False, **kw) -> Figure:
    """Make a figure of a PDB entry, such as ``"2PTN"``. The file is downloaded from RCSB once and kept in
    ``~/.cache/molsketch`` (or the folder in the ``MOLSKETCH_CACHE`` environment variable). With ``map=True``, the
    cryo-EM map the model was built into comes too (from EMDB; see ``Figure.map``). Takes the same keywords as
    ``load``."""
    if map: return fetch(pdb_id, **kw).map("auto")
    pid = pdb_id.strip().upper()
    if not re.fullmatch(r"[0-9][A-Z0-9]{3}", pid): raise ValueError(f"{pdb_id!r} is not a PDB ID: four characters, starting with a digit, e.g. 1A8O")
    cache = pathlib.Path(os.environ.get("MOLSKETCH_CACHE", pathlib.Path.home() / ".cache" / "molsketch")); cache.mkdir(parents=True, exist_ok=True)
    f = cache / f"{pid}.cif"
    if not f.exists():
        url = f"https://files.rcsb.org/download/{pid}.cif"
        try:
            data = _download(url)
        except FileNotFoundError:
            raise ValueError(f"{pid} is not in the PDB") from None
        f.write_bytes(data)
    return load(f, name=kw.pop("name", pid), **kw)


def load_map(source, *, name: str | None = None, level: float | None = None, max_voxels: int = 320) -> Figure:
    """Make a figure of a density map on its own: a path to an MRC / CCP4 file (``.mrc``, ``.map``, ``.ccp4``, or any
    of them ``.gz``), or a ``DensityMap``. ``level`` is the contour level to recommend (the figure starts from it; see
    ``Figure.map`` for the rest). Maps larger than ``max_voxels`` a side are averaged down on reading."""
    from ._engine import engine
    from ._maps import DensityMap as _DM
    m = source if isinstance(source, _DM) else read_map(source, name=name, level=level, max_voxels=max_voxels)
    if level is not None: m.level = level
    fig = Figure({"map": engine().put_map(m)}, name or m.name); fig._map_obj = m
    return fig


def fetch_map(emdb_id: str, *, max_voxels: int = 320) -> Figure:
    """Make a figure of an EMDB entry's map on its own, such as ``"EMD-11638"``: downloaded once (kept in
    ``~/.cache/molsketch/emdb``), with the depositors' recommended contour level."""
    from ._maps import fetch_map as _fm
    return load_map(_fm(emdb_id, max_voxels=max_voxels))


def scene(path_or_dict) -> Figure:
    """Make a figure from a scene (a keyframed animation, such as a reaction mechanism): a path to a scene JSON saved
    from the app, or the scene as a dict. The same as ``load`` for these inputs."""
    return load(path_or_dict if isinstance(path_or_dict, dict) else pathlib.Path(path_or_dict))


def _download(url: str) -> bytes:
    try:
        try:
            import certifi, ssl   # certifi's certificates when available (python.org builds on the Mac have none)
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = None
        with urllib.request.urlopen(url, context=ctx, timeout=60) as r: return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404: raise FileNotFoundError(url) from None
        raise
    except (urllib.error.URLError, OSError):
        r = subprocess.run(["curl", "-sL", "-w", "\n%{http_code}", url], capture_output=True)   # the system's certificates
        body, _, code = r.stdout.rpartition(b"\n")
        if code.strip() == b"404": raise FileNotFoundError(url) from None
        if r.returncode or code.strip() != b"200": raise ConnectionError(f"could not download {url}") from None
        return body


def _from_object(obj):
    """PDB or mmCIF text from Biopython, gemmi or MDAnalysis objects"""
    mod = type(obj).__module__.split(".")[0]
    if mod == "gemmi":
        doc = obj.make_mmcif_document(); return doc.as_string(), ".cif"
    if mod == "Bio":
        import io
        from Bio.PDB import PDBIO
        io_ = PDBIO(); io_.set_structure(obj); buf = io.StringIO(); io_.save(buf); return buf.getvalue(), ".pdb"
    if mod == "MDAnalysis":
        import io, tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdb", mode="w+", delete=False) as t: pass
        (obj.atoms if hasattr(obj, "atoms") else obj).write(t.name); text = pathlib.Path(t.name).read_text(); os.unlink(t.name); return text, ".pdb"
    raise TypeError(f"cannot draw a {type(obj).__name__}: give a path, PDB/mmCIF text, a scene dict, or a Biopython / gemmi / MDAnalysis structure")
