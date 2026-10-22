"""What the package keeps on disk between runs: every cache within its bound, the least recently used going first, an
entry in use kept, one that has gone fetched or made again, 0 turning a cache off, and several processes at once.
Fast, no network needed (the downloads are faked).

    cd python && .venv/bin/python -m pytest tests/test_cache.py -q
"""
from __future__ import annotations

import gzip
import json
import os
import pathlib
import re
import subprocess
import sys
import time

import numpy as np
import pytest
import skia

import molsketch as ms
from molsketch import _cache
from molsketch import _maps as M
from molsketch._models import ModelCache
from molsketch._textures import TextureCache

EX = pathlib.Path(__file__).resolve().parent.parent.parent / "app" / "public" / "examples"
SMALL = (320, 240)


def _age(*files, by: float = 0):
    """files used in the order given, ``by`` seconds or more ago (the first the longest ago)"""
    t = time.time() - by - 100
    for i, f in enumerate(files): os.utime(f, (t + i, t + i))


def _sizes(folder: pathlib.Path, pattern="*") -> dict[str, int]:
    return {f.name: f.stat().st_size for f in folder.glob(pattern) if f.is_file()}


# ------------------------------------------------------------------------------------------------- the bounds
@pytest.mark.parametrize("kind, env, default", [("downloads", "MOLSKETCH_DOWNLOAD_CACHE_MB", 500), ("maps", "MOLSKETCH_MAP_CACHE_MB", 1000),
                                                ("textures", "MOLSKETCH_TEXTURE_CACHE_MB", 300), ("models", "MOLSKETCH_MODEL_CACHE_MB", 300)])
def test_each_cache_has_its_bound_from_its_variable(tmp_path, monkeypatch, kind, env, default):
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path))
    for value, mb in ((None, default), ("", default), ("12.5", 12.5), ("0", 0), ("-3", 0), ("lots", default), ("nan", default)):
        if value is None: monkeypatch.delenv(env, raising=False)
        else: monkeypatch.setenv(env, value)
        s = _cache.shelf(kind)
        assert s.limit == int(mb * 1e6) and s.on == (mb > 0), (value, s.limit)
    assert _cache.shelf(kind).dir == (tmp_path / {"downloads": "", "maps": "emdb", "textures": "textures", "models": "models"}[kind])


def test_a_cache_past_its_bound_lets_the_least_recently_used_go(tmp_path):
    """newest first until the bound: the rest go, oldest first; an entry just used stays; a file that is not the cache's,
    and a file being written, are left alone; a half-written file from a stopped process goes after an hour"""
    s = _cache.Shelf(tmp_path, 1000, lambda n: n if n.endswith(".msm") else None)
    files = [tmp_path / f"{i}.msm" for i in range(6)]
    for f in files: f.write_bytes(bytes(300))
    _age(*files)
    (tmp_path / "notes.txt").write_bytes(bytes(5000))
    (tmp_path / ".fresh.part").write_bytes(bytes(10)); (tmp_path / ".stale.part").write_bytes(bytes(10)); _age(tmp_path / ".stale.part", by=_cache.STALE)
    gone = s.prune(keep=files[0])   # 0 is the oldest, but in use
    assert sorted(_sizes(tmp_path)) == sorted(["0.msm", "4.msm", "5.msm", "notes.txt", ".fresh.part"])
    assert {f.name for f in gone} == {"1.msm", "2.msm", "3.msm", ".stale.part"}
    _age(files[0], files[5], files[4])
    s.put(tmp_path / "6.msm", bytes(300))
    assert sorted(_sizes(tmp_path, "*.msm")) == ["4.msm", "5.msm", "6.msm"]
    _age(files[4], tmp_path / "6.msm"); s.used(files[5])   # 4 is now the least recently used
    s.put(tmp_path / "7.msm", bytes(300))
    assert sorted(_sizes(tmp_path, "*.msm")) == ["5.msm", "6.msm", "7.msm"]


def test_an_entry_larger_than_the_bound_is_kept_alone(tmp_path):
    s = _cache.Shelf(tmp_path, 1000, lambda n: n if n.endswith(".msm") else None)
    for i in range(3): s.put(tmp_path / f"{i}.msm", bytes(200))
    assert len(_sizes(tmp_path, "*.msm")) == 3
    s.put(tmp_path / "big.msm", bytes(5000))
    assert _sizes(tmp_path, "*.msm") == {"big.msm": 5000}
    s.put(tmp_path / "small.msm", bytes(200))
    assert _sizes(tmp_path, "*.msm") == {"small.msm": 200}


def test_a_cache_over_its_bound_comes_down_the_first_time_a_process_uses_it(tmp_path, monkeypatch):
    """a lowered bound, or a cache filled before there were bounds: pruned at the first use, without waiting for a write"""
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path)); monkeypatch.setenv("MOLSKETCH_MODEL_CACHE_MB", "0.001")
    (tmp_path / "models").mkdir()
    files = [tmp_path / "models" / f"{i}.msm" for i in range(5)]
    for f in files: f.write_bytes(bytes(400))
    _age(*files)
    assert ModelCache("x").load("nothing") is None
    assert sorted(_sizes(tmp_path / "models")) == ["3.msm", "4.msm"]


def test_a_file_let_go_by_another_process_while_pruning_is_passed_over(tmp_path, monkeypatch):
    s = _cache.Shelf(tmp_path, 500, lambda n: n if n.endswith(".msm") else None)
    files = [tmp_path / f"{i}.msm" for i in range(5)]
    for f in files: f.write_bytes(bytes(200))
    _age(*files)
    scandir = os.scandir

    def racing(d):   # the listing made, then two of its files let go by someone else before they are looked at
        it = scandir(d); files[1].unlink(); files[4].unlink(); return it
    monkeypatch.setattr(os, "scandir", racing)
    gone = s.prune(); monkeypatch.undo()
    assert sorted(_sizes(tmp_path)) == ["2.msm", "3.msm"] and [f.name for f in gone] == ["0.msm"]


def test_off_keeps_nothing(tmp_path):
    s = _cache.Shelf(tmp_path / "c", 0, lambda n: n)
    assert s.put(tmp_path / "c" / "a", b"x") is None and not (tmp_path / "c").exists()


# ----------------------------------------------------------------------------------- structures from the PDB
@pytest.fixture
def downloads(tmp_path, monkeypatch):
    """the PDB faked: every entry is test_protein_rna.cif; the URLs asked for, in order"""
    asked = []
    text = (EX / "test_protein_rna.cif").read_bytes()

    def download(url):
        asked.append(url)
        if url.startswith("https://files.rcsb.org/download/"): return text
        raise FileNotFoundError(url)
    monkeypatch.setattr(ms, "_download", download)
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path))
    return asked


def test_fetched_structures_stay_within_their_bound(tmp_path, monkeypatch, downloads):
    """room for two entries: a third lets the least recently fetched go, an entry fetched again is not downloaded and is
    the last to go, and one that has gone is downloaded again. The figure is the same whichever way its file came"""
    size = (EX / "test_protein_rna.cif").stat().st_size
    monkeypatch.setenv("MOLSKETCH_DOWNLOAD_CACHE_MB", str(2.5 * size / 1e6))
    (tmp_path / "1ABC.txt").write_text("not the cache's")
    first = ms.fetch("1abc"); ms.fetch("2ABC")
    _age(tmp_path / "1ABC.cif", tmp_path / "2ABC.cif")
    again = ms.fetch("1ABC")   # from the cache, and now the most recently used
    assert len(downloads) == 2 and again._input == first._input == {"text": (EX / "test_protein_rna.cif").read_text(), "name": "1ABC.cif"}
    ms.fetch("3ABC")
    assert sorted(_sizes(tmp_path, "*.cif")) == ["1ABC.cif", "3ABC.cif"] and (tmp_path / "1ABC.txt").exists()
    (tmp_path / "3ABC.cif").unlink()   # (another process's cache let it go)
    assert ms.fetch("3ABC", name="three").name == "three" and downloads[-1].endswith("/3ABC.cif") and len(downloads) == 4
    assert not list(tmp_path.glob("*.part")) and not list(tmp_path.glob(".*.part"))


def test_fetched_structures_are_not_kept_with_the_cache_off(tmp_path, monkeypatch, downloads):
    monkeypatch.setenv("MOLSKETCH_DOWNLOAD_CACHE_MB", "0")
    ms.fetch("1ABC"); ms.fetch("1ABC")
    assert len(downloads) == 2 and not list(tmp_path.iterdir())
    with pytest.raises(TypeError): ms.fetch("1ABC", colour="red")


# ------------------------------------------------------------------------------------------------- textures
def _surface(seed: int, w=64, h=48) -> skia.Surface:
    s = skia.Surface(w, h); s.getCanvas().drawColor(skia.Color(seed * 40 % 256, 90, 200))
    px = np.random.default_rng(seed).integers(0, 255, (h, w, 4), dtype=np.uint8); px[..., 3] = 255
    s.getCanvas().drawImage(skia.Image.fromarray(px), 0, 0)
    return s


def test_textures_stay_within_their_bound(tmp_path):
    """the least recently used textures go (and the engine is no longer told of them); a texture drawn from survives;
    one whose file went is not given back"""
    one = len(_texture_bytes(tmp_path))
    t = TextureCache("hostA", folder=tmp_path / "t", limit_mb=3.5 * one / 1e6)
    for i in range(3): t.keep(f"paper{i}", _surface(i))
    _age(*(t.files[f"paper{i}"] for i in range(3)))
    canvas = skia.Surface(64, 48)
    assert t.load("paper0", canvas.getCanvas(), 64, 48)   # used: now the last to go
    t.keep("paper3", _surface(3)); t.keep("paper4", _surface(4))
    assert sorted(t.keys()) == ["paper0", "paper3", "paper4"] and len(list((tmp_path / "t").glob("*.tex"))) == 3
    assert np.array_equal(canvas.makeImageSnapshot().toarray(), _surface(0).makeImageSnapshot().toarray())
    assert sorted(TextureCache("hostA", folder=tmp_path / "t", limit_mb=1).keys()) == ["paper0", "paper3", "paper4"]
    assert TextureCache("hostB", folder=tmp_path / "t", limit_mb=1).keys() == []   # (another version's are not even opened)
    t.files["paper3"].unlink()
    assert not t.load("paper3", canvas.getCanvas(), 64, 48) and "paper3" not in t.files
    off = TextureCache("hostA", folder=tmp_path / "off", limit_mb=0); off.keep("paper0", _surface(0))
    assert not off.on and not (tmp_path / "off").exists()


def _texture_bytes(tmp_path) -> bytes:
    t = TextureCache("hostA", folder=tmp_path / "one", limit_mb=1); t.keep("paper0", _surface(0))
    return next((tmp_path / "one").glob("*.tex")).read_bytes()


def test_an_engine_whose_textures_were_let_go_for_room_draws_the_same(tmp_path, monkeypatch):
    """room for one texture: each kept lets the last go. An engine told of a texture that another engine's keeping then
    let go draws it again, the same"""
    from molsketch._engine import Engine
    text = (EX / "1A8O.pdb").read_text()

    def draw(e, look):
        spec = {"input": {"ref": e.put({"text": text, "name": "1A8O.pdb"})}, "size": list(SMALL), "scale": 1, "frame": 0, "look": look}
        return e.render(spec).toarray()

    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path / "none")); monkeypatch.setenv("MOLSKETCH_TEXTURE_CACHE_MB", "0")
    want = {look: draw(Engine(), look) for look in ("chalkboard", "watercolour")}
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path)); monkeypatch.setenv("MOLSKETCH_TEXTURE_CACHE_MB", "0.02")
    assert np.array_equal(draw(Engine(), "watercolour"), want["watercolour"])
    kept = _sizes(tmp_path / "textures", "*.tex"); assert len(kept) == 1   # (larger than the bound: kept alone)
    lost = []; was = Engine._lost_textures
    monkeypatch.setattr(Engine, "_lost_textures", lambda self, times: (lost.append(times), was(self, times))[1])
    told = Engine(); assert told.textures.keys()
    assert np.array_equal(draw(Engine(), "chalkboard"), want["chalkboard"])   # keeps the chalk's tooth, lets the grain go
    assert not set(kept) & set(_sizes(tmp_path / "textures", "*.tex"))
    assert np.array_equal(draw(told, "watercolour"), want["watercolour"]) and lost == [0]


# --------------------------------------------------------------------------------------------------- models
def test_structures_kept_as_read_stay_within_their_bound(tmp_path):
    m = ModelCache("core1", folder=tmp_path, limit_mb=0.001)
    for k in "abc": m.keep(k, k.encode() * 300)
    assert m.load("a") is None and m.load("b") == b"b" * 300 and m.load("c") == b"c" * 300
    _age(m._path("c"), m._path("b"))   # b used last
    m.keep("d", b"d" * 300)
    assert m.load("c") is None and m.load("b") == b"b" * 300 and m.load("d") == b"d" * 300
    m._path("d").unlink()
    assert m.load("d") is None   # (the engine reads it from its text again, and keeps it)
    off = ModelCache("core1", folder=tmp_path / "off", limit_mb=0); off.keep("a", b"a")
    assert off.load("a") is None and not (tmp_path / "off").exists()


# ------------------------------------------------------------------------------------------------ EMDB maps
def _mrc(vol_zyx, origin=(10.0, -4.0, 2.5), step=1.1, axes=(1, 2, 3)) -> bytes:
    import struct
    order = [2 - (a - 1) for a in axes[::-1]]
    data = np.ascontiguousarray(np.transpose(vol_zyx, order), dtype=np.float32)
    ns, nr, nc = data.shape; n = {axes[0]: nc, axes[1]: nr, axes[2]: ns}
    head = bytearray(1024)
    struct.pack_into("<3ii3i3i3f3f3i", head, 0, nc, nr, ns, 2, 0, 0, 0, n[1], n[2], n[3], n[1] * step, n[2] * step, n[3] * step, 90, 90, 90, *axes)
    struct.pack_into("<3f", head, 49 * 4, *origin); head[208:212] = b"MAP "
    return bytes(head) + data.tobytes()


def _grid(seed: int, shape=(30, 36, 40)) -> np.ndarray:
    return np.random.default_rng(seed).normal(size=shape).astype(np.float32)


@pytest.fixture
def emdb(tmp_path, monkeypatch):
    """EMDB and RCSB faked: entry n's map is _grid(n), gzipped as EMDB serves it; the URLs asked for, in order"""
    asked = []

    def download(url):
        asked.append(url)
        if "/emdb/api/entry/" in url:
            return json.dumps({"map": {"contour_list": {"contour": [{"primary": True, "level": 0.5}]}}, "admin": {"title": url[-4:]}}).encode()
        m = re.search(r"emd_(\d+)\.map\.gz$", url)
        if m: return gzip.compress(_mrc(_grid(int(m.group(1)))), 1)
        if url.startswith("https://data.rcsb.org/rest/v1/core/entry/"): return json.dumps({"rcsb_entry_container_identifiers": {"emdb_ids": ["EMD-1001"]}}).encode()
        raise FileNotFoundError(url)
    monkeypatch.setattr(ms, "_download", download)
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path))
    return asked


def _same(a: M.DensityMap, b: M.DensityMap) -> bool:
    return np.array_equal(a.data, b.data) and a.data.dtype == b.data.dtype and a.origin == b.origin and a.step == b.step and a.binned == b.binned


@pytest.mark.parametrize("max_voxels", [320, 16])
def test_an_emdb_map_is_kept_as_read(tmp_path, emdb, max_voxels):
    """downloaded once and kept averaged down, as it is drawn: read back, the same grid, origin and voxel size to the
    bit as reading EMDB's file, with no download; a map that has gone is downloaded again"""
    (tmp_path / "plain.map").write_bytes(_mrc(_grid(1001)))
    want = M.read_map(tmp_path / "plain.map", max_voxels=max_voxels)
    first = M.fetch_map("EMD-1001", max_voxels=max_voxels)
    again = M.fetch_map("emd_1001", max_voxels=max_voxels)
    assert _same(first, want) and _same(again, want) and len(emdb) == 2 and again.level == 0.5 and again.name == "EMD-1001"
    assert first.binned == (3 if max_voxels == 16 else 1) and again.meta == first.meta
    assert sorted(_sizes(tmp_path / "emdb")) == ["EMD-1001.json", f"emd_1001.{max_voxels}.msmap"]
    (tmp_path / "emdb" / f"emd_1001.{max_voxels}.msmap").unlink()
    assert _same(M.fetch_map("EMD-1001", max_voxels=max_voxels), want) and len(emdb) == 3
    (tmp_path / "emdb" / f"emd_1001.{max_voxels}.msmap").write_bytes(M.MAGIC + b"broken")
    assert _same(M.fetch_map("EMD-1001", max_voxels=max_voxels), want) and len(emdb) == 4


def test_emdb_maps_stay_within_their_bound(tmp_path, monkeypatch, emdb):
    """room for two maps: a third lets the least recently used entry go (its record with it); a map in use survives its
    file going"""
    one = len(M.MAGIC) + 4 + 4 * 30 * 36 * 40 + 200
    monkeypatch.setenv("MOLSKETCH_MAP_CACHE_MB", str(2.5 * one / 1e6))
    M.fetch_map("EMD-1001"); M.fetch_map("EMD-1002")
    _age(*sorted((tmp_path / "emdb").glob("*1001*")), *sorted((tmp_path / "emdb").glob("*1002*")))
    a = M.fetch_map("EMD-1001")   # used: 1002 is now the least recently used
    M.fetch_map("EMD-1003")
    assert sorted(_sizes(tmp_path / "emdb")) == ["EMD-1001.json", "EMD-1003.json", "emd_1001.320.msmap", "emd_1003.320.msmap"]
    _age(*sorted((tmp_path / "emdb").glob("*1001*")))
    M.fetch_map("EMD-1004")   # 1001 goes, while ``a`` is still drawn from the grid mapped from its file
    assert "emd_1001.320.msmap" not in _sizes(tmp_path / "emdb") and len(emdb) == 8
    assert np.array_equal(a.data, _grid(1001)) and ms.load_map(a).render(SMALL).to_numpy()[..., :3].std() > 1


def test_emdb_maps_are_not_kept_with_the_cache_off(tmp_path, monkeypatch, emdb):
    monkeypatch.setenv("MOLSKETCH_MAP_CACHE_MB", "0")
    a = M.fetch_map("EMD-1001"); b = M.fetch_map("EMD-1001")
    assert _same(a, b) and len(emdb) == 4 and not (tmp_path / "emdb").exists()


def test_a_map_kept_whole_by_an_earlier_version_is_read_once_and_let_go(tmp_path, emdb):
    """the gzipped file and the copy decompressed beside it, as earlier versions kept them: read as they are (no
    download), kept as read, and both let go"""
    (tmp_path / "emdb").mkdir()
    raw = _mrc(_grid(1001)); (tmp_path / "emdb" / "emd_1001.map.gz").write_bytes(gzip.compress(raw)); (tmp_path / "emdb" / "emd_1001.map").write_bytes(raw)
    (tmp_path / "plain.map").write_bytes(raw)
    m = M.fetch_map("EMD-1001", max_voxels=16)
    assert _same(m, M.read_map(tmp_path / "plain.map", max_voxels=16)) and not any("emd_1001.map" in u for u in emdb)
    assert sorted(_sizes(tmp_path / "emdb")) == ["EMD-1001.json", "emd_1001.16.msmap"]


def test_the_map_a_pdb_entry_was_built_into_is_asked_once(tmp_path, emdb):
    assert M.map_for_pdb("3j5p") == "EMD-1001" and M.map_for_pdb("3J5P") == "EMD-1001"
    assert sum("data.rcsb.org" in u for u in emdb) == 1 and (tmp_path / "emdb" / "pdb_3J5P.json").exists()


@pytest.mark.parametrize("axes", [(1, 2, 3), (3, 2, 1), (2, 3, 1)])
@pytest.mark.parametrize("max_voxels", [320, 16, 7])
def test_a_gzipped_map_is_read_as_it_is_decompressed(tmp_path, axes, max_voxels):
    """the same grid as the file decompressed, to the bit, in any axis order; nothing is written beside it"""
    raw = _mrc(_grid(7, (23, 31, 40)), axes=axes)
    (tmp_path / "a.map").write_bytes(raw); (tmp_path / "gz").mkdir(); (tmp_path / "gz" / "a.map.gz").write_bytes(gzip.compress(raw))
    plain, packed = M.read_map(tmp_path / "a.map", max_voxels=max_voxels), M.read_map(tmp_path / "gz" / "a.map.gz", max_voxels=max_voxels)
    assert _same(plain, packed) and packed.name == plain.name == "a" and os.listdir(tmp_path / "gz") == ["a.map.gz"]
    if max_voxels == 320: assert np.array_equal(plain.data, _grid(7, (23, 31, 40)))
    (tmp_path / "short.map.gz").write_bytes(gzip.compress(raw[:len(raw) // 2]))
    with pytest.raises(ValueError, match="ends early"): M.read_map(tmp_path / "short.map.gz", max_voxels=max_voxels)


# ----------------------------------------------------------------------------------------- several processes
WORKER = r"""
import os, pathlib, random, sys
from molsketch import _cache
folder, me = pathlib.Path(sys.argv[1]), sys.argv[2]
s = _cache.Shelf(folder, 3000, lambda n: n if n.endswith(".msm") else None)
rng = random.Random(me); made = 0
for i in range(80):
    s.put(folder / f"{me}-{i}.msm", bytes([i % 256]) * rng.randint(100, 400))
    there = sorted(folder.glob("*.msm"))
    for f in rng.sample(there, min(3, len(there))):
        try:
            data = f.read_bytes(); s.used(f)
            assert data and data == bytes([data[0]]) * len(data), f   # never half a file
        except FileNotFoundError:
            made += 1   # let go by another process: made again
            s.put(f, b"x" * 100)
print(made)
"""


def test_processes_sharing_a_cache(tmp_path):
    """four processes writing, reading and pruning one cache at once: none fails or reads half a file, and at the end it
    is within its bound with nothing half-written left"""
    procs = [subprocess.Popen([sys.executable, "-c", WORKER, str(tmp_path), str(k)], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for k in range(4)]
    outs = [p.communicate(timeout=120) for p in procs]
    assert all(p.returncode == 0 for p in procs), [e.decode()[-2000:] for _, e in outs]
    assert sum(_sizes(tmp_path, "*.msm").values()) <= 3000 and not list(tmp_path.glob("*.part"))
