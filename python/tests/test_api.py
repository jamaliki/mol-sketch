"""The Python API: loading, chaining, labels, the site, output formats, errors. Fast, no browser needed.

    cd python && .venv/bin/python -m pytest tests/test_api.py -q
"""
from __future__ import annotations

import json
import pathlib

import numpy as np
import pytest

import molsketch as ms

EX = pathlib.Path(__file__).resolve().parent.parent.parent / "app" / "public" / "examples"
SMALL = (320, 240)


def test_load_structure_and_draw(tmp_path):
    fig = ms.load(EX / "1A8O.pdb")
    assert "atoms" in repr(fig)
    img = fig.render(SMALL)
    assert img.size == SMALL and img.to_numpy().shape == (240, 320, 4)
    assert img.to_numpy()[..., :3].std() > 5            # something was drawn
    for ext in ("png", "jpg", "webp"):
        p = fig.save(tmp_path / f"fig.{ext}", SMALL); assert p.stat().st_size > 1000


def test_scale_doubles_pixels():
    assert ms.load(EX / "1A8O.pdb").render(SMALL, scale=2).size == (640, 480)


def test_text_and_objects_load_like_files():
    text = (EX / "1A8O.pdb").read_text()
    a = ms.load(text, name="1A8O").render(SMALL).to_numpy(); b = ms.load(EX / "1A8O.pdb").render(SMALL).to_numpy()
    assert np.array_equal(a, b)


def test_chaining_returns_the_figure():
    fig = ms.load(EX / "1A8O.pdb")
    assert fig.look("engraved").view(yaw=30).show(sticks=None).set(line={"width": 2}).palette("Okabe–Ito") is fig
    st = fig.style
    assert st["cartoon_style"] == "engraved" and st["line"]["width"] == 2 and st["reps"]["sticks"] == "" and st["group_palette_name"] == "Okabe–Ito"
    assert fig.camera["yaw"] == 30


def test_changes_survive_a_later_look():
    fig = ms.load(EX / "1A8O.pdb").set(label_size=31).look("chalkboard")
    assert fig.style["label_size"] == 31 and fig.style["fill"] == "chalk"


def test_same_figure_same_pixels():
    f = lambda: ms.load(EX / "1A8O.pdb").look("watercolour").view(yaw=40, pitch=10)
    assert np.array_equal(f().render(SMALL).to_numpy(), f().render(SMALL).to_numpy())


def test_own_colours_win_over_the_look():
    """a chain given a colour is drawn in it in every look, though the look colours its cartoon by secondary structure:
    exactly as if helix, sheet and loop were all that colour; a residue's colour shows too, named with or without its chain"""
    own = "#d55e00"
    for look in ("engraved-colour", "dark-paper", "watercolour", "ink-colour", "chalkboard"):
        f = lambda: ms.load(EX / "1A8O.pdb").look(look).show(sticks=None)
        chain = f().color("A", own).render(SMALL).to_numpy()
        assert np.array_equal(chain, f().set(palette={"helix": own, "sheet": own, "loop": own}).render(SMALL).to_numpy()), look
    plain = ms.load(EX / "1A8O.pdb").look("engraved-colour")
    residue = plain.copy().color("MSE151.A", own).render(SMALL).to_numpy()
    assert not np.array_equal(residue, plain.render(SMALL).to_numpy())
    assert np.array_equal(residue, plain.copy().color("MSE151", own).render(SMALL).to_numpy())


def test_labels_follow_atoms_and_scene_roundtrip(tmp_path):
    fig = ms.load(EX / "trypsin_active_site.json")
    n = len(fig.scene()["labels"])
    fig.label("oxyanion hole", at="Gly193", offset=(60, -30)).label("a note", xy=(0.1, 0.9))
    doc = fig.scene(); assert len(doc["labels"]) == n + 2
    assert doc["labels"][-2]["at"].startswith("GLY193") and doc["labels"][-1]["x"] == 0.1
    p = fig.save(tmp_path / "fig.json"); back = ms.load(p)
    assert np.array_equal(back.render(SMALL).to_numpy(), fig.render(SMALL).to_numpy())


def test_site_frame_and_label():
    fig = ms.load(EX / "1A8O.pdb").look("engraved-colour").site("resi 152+172+193")
    before = dict(fig.camera); fig.frame_site(SMALL).label_site(SMALL)
    assert fig.camera != before and len(fig.scene()["labels"]) >= 3


def test_hiding_labels():
    fig = ms.load(EX / "trypsin_active_site.json")
    on = fig.render(SMALL).to_numpy(); off = fig.copy().labels(False).render(SMALL).to_numpy()
    assert not np.array_equal(on, off)


def test_scene_frames():
    fig = ms.load(EX / "mechanism.json")
    drawn = fig.frames("drawn"); keys = fig.frames("keyframes")
    assert drawn[:3] == [0, 2, 4] and len(keys) == len(fig.scene()["keyframes"])
    assert not np.array_equal(fig.render(SMALL, frame=keys[0]).to_numpy(), fig.render(SMALL, frame=keys[-1]).to_numpy())


def test_save_frames(tmp_path):
    files = ms.load(EX / "mechanism.json").save_frames(tmp_path, "0-3", SMALL)
    assert [f.name for f in files] == ["frame_0000.png", "frame_0001.png", "frame_0002.png", "frame_0003.png"]


def test_stack_of_structures(tmp_path):
    fig = ms.load([EX / "1A8O.pdb", EX / "1A8O.pdb"])
    assert "keyframe" in repr(fig) and fig.frames("keyframes")


def test_catalogues():
    assert "engraved-colour" in ms.looks() and "Coastal Harvest" in ms.palettes()
    assert "line" in ms.default_style()


def test_friendly_errors():
    with pytest.raises(ValueError, match="unknown look"): ms.load(EX / "1A8O.pdb").look("pastel")
    with pytest.raises(ValueError, match="unknown palette"): ms.load(EX / "1A8O.pdb").palette("Nope")
    with pytest.raises(ValueError, match="not a PDB ID"): ms.fetch("hello")
    with pytest.raises(FileNotFoundError): ms.load("missing.pdb")
    with pytest.raises(ms.CoreError, match="no residue"): ms.load(EX / "1A8O.pdb").label("x", at="Trp999")
    with pytest.raises(TypeError): ms.load(object())
    with pytest.raises(ms.CoreError, match="needs a structure"): ms.load(EX / "mechanism.json").site(ligand=True)


def test_notebook_display():
    assert ms.load(EX / "1A8O.pdb")._repr_png_()[:8] == b"\x89PNG\r\n\x1a\n"


def test_public_api_is_documented():
    """every public function, method and property has a docstring (docs/api.md is written from them)"""
    import inspect
    missing = []
    for name in ms.__all__:
        obj = getattr(ms, name)
        if not inspect.getdoc(obj): missing.append(name)
        if inspect.isclass(obj):
            for k, v in vars(obj).items():
                if not k.startswith("_") and (callable(v) or isinstance(v, property)) and not inspect.getdoc(v): missing.append(f"{name}.{k}")
    assert not missing, missing


def test_names_are_snake_case_and_the_apps_are_accepted():
    """Python names are snake_case in and out; the app's camelCase names (style files) still work"""
    fig = ms.load(EX / "1A8O.pdb").set(surface_depth={"pooling": 0.4}, **{"view.fog_start": 0.2}).set(stickRadius=0.3)
    st = fig.style
    assert st["surface_depth"]["pooling"] == 0.4 and st["view"]["fog_start"] == 0.2 and st["stick_radius"] == 0.3
    assert "C" in st["palette"] and "H" in st["show"]                      # element symbols keep their capitals
    assert set(fig.camera) == {"yaw", "pitch", "roll", "zoom", "pan_x", "pan_y", "fov"}
    assert "surface_depth" in ms.default_style() and "surfaceDepth" not in ms.default_style()
    assert ms.load(EX / "1A8O.pdb").apply_style({"labelSize": 27}).style["label_size"] == 27


def test_svg_is_vector_and_valid(tmp_path):
    """SVG output: a valid document of vector elements, the same size as the PNG, text as outlines"""
    import xml.etree.ElementTree as ET
    fig = ms.load(EX / "1A8O.pdb").look("engraved-colour").label("A label", xy=(0.5, 0.1))
    p = fig.save(tmp_path / "fig.svg", (640, 480))
    root = ET.fromstring(p.read_text())
    ns = "{http://www.w3.org/2000/svg}"
    assert root.tag == ns + "svg" and root.get("width") == "640" and root.get("height") == "480"
    assert len(root.findall(f".//{ns}path")) > 100 and not root.findall(f".//{ns}text")   # letters are outlines
    assert "mix-blend-mode" in ms.load(EX / "1A8O.pdb").look("watercolour").svg((320, 240))   # watercolour multiplies


def test_fit_puts_the_drawing_in_the_box():
    """fit(): zoom and pan so the drawing fills the box (its longer side), centred in it"""
    from molsketch._engine import engine
    fig = ms.load(EX / "1A8O.pdb").view(yaw=30).fit((0.55, 0.1, 0.95, 0.6), (1600, 900))
    b = engine().call("fitFrame", fig._spec(size=(1600, 900)), {"x0": 0.55, "y0": 0.1, "x1": 0.95, "y1": 0.6}, "all")["box"]
    assert abs((b["x0"] + b["x1"]) / 2 - 0.75) < 0.01 and abs((b["y0"] + b["y1"]) / 2 - 0.35) < 0.01   # centred
    assert b["x0"] > 0.54 and b["x1"] < 0.96 and b["y0"] > 0.09 and b["y1"] < 0.61                     # inside
    assert abs((b["x1"] - b["x0"]) - 0.37) < 0.02 or abs((b["y1"] - b["y0"]) - 0.47) < 0.02            # filling it


# ---------------------------------------------------------------------------------------------- density maps
def _write_mrc(path, vol_zyx, origin, step, axes=(1, 2, 3)):
    """an MRC2014 file of a (z, y, x) volume; axes = (mapc, mapr, maps), the model axis of each file axis"""
    import struct
    order = [2 - (a - 1) for a in axes[::-1]]   # the file's (section, row, column) as (z, y, x) axes
    data = np.ascontiguousarray(np.transpose(vol_zyx, order), dtype=np.float32)
    ns, nr, nc = data.shape; n = {axes[0]: nc, axes[1]: nr, axes[2]: ns}
    head = bytearray(1024)
    struct.pack_into("<3ii3i3i3f3f3i", head, 0, nc, nr, ns, 2, 0, 0, 0, n[1], n[2], n[3], n[1] * step, n[2] * step, n[3] * step, 90, 90, 90, *axes)
    struct.pack_into("<3f", head, 49 * 4, *origin); head[208:212] = b"MAP "
    path.write_bytes(bytes(head) + data.tobytes())


def _model_map(tmp_path, axes=(1, 2, 3)):
    """a map of 1A8O made from its own atoms (a Gaussian on each), written with the given axis order"""
    xyz = np.array([[float(l[30:38]), float(l[38:46]), float(l[46:54])] for l in (EX / "1A8O.pdb").read_text().splitlines() if l.startswith("ATOM")])
    step = 1.0; origin = xyz.min(0) - 6; shape = np.ceil((xyz.max(0) + 6 - origin) / step).astype(int)
    z, y, x = np.indices(shape[::-1]).astype(np.float32)
    vol = np.zeros(shape[::-1], np.float32)
    for p in xyz:
        q = (p - origin) / step; i0 = np.maximum(0, (q - 3).astype(int)); i1 = np.minimum(shape, (q + 4).astype(int))
        sl = (slice(i0[2], i1[2]), slice(i0[1], i1[1]), slice(i0[0], i1[0]))
        vol[sl] += np.exp(-((x[sl] - q[0]) ** 2 + (y[sl] - q[1]) ** 2 + (z[sl] - q[2]) ** 2) / 2)
    p = tmp_path / f"model_{''.join(map(str, axes))}.mrc"; _write_mrc(p, vol, tuple(origin), step, axes); return p, xyz, origin


@pytest.mark.parametrize("axes", [(1, 2, 3), (3, 2, 1), (2, 3, 1)])
def test_read_map_puts_density_on_the_atoms(tmp_path, axes):
    """whatever the file's axis order, the grid read back is (z, y, x) in the model's frame, origin included"""
    p, xyz, origin = _model_map(tmp_path, axes)
    m = ms.read_map(p)
    assert np.allclose(m.origin, origin, atol=1e-3) and m.step == (1.0, 1.0, 1.0)
    idx = np.round((xyz - np.array(m.origin)) / 1.0).astype(int)
    at_atoms = m.data[idx[:, 2], idx[:, 1], idx[:, 0]].mean()
    assert at_atoms > 5 * m.data.mean()


def test_read_map_bins_large_maps(tmp_path):
    p, xyz, _ = _model_map(tmp_path)
    full, small = ms.read_map(p), ms.read_map(p, max_voxels=20)
    assert small.binned > 1 and max(small.shape) <= 20 and small.step[0] == full.step[0] * small.binned
    assert abs(small.data.mean() - full.data[: small.shape[2] * small.binned, : small.shape[1] * small.binned, : small.shape[0] * small.binned].mean()) < 1e-4


def test_map_with_its_model_and_on_its_own(tmp_path):
    p, _, _ = _model_map(tmp_path)
    fig = ms.load(EX / "1A8O.pdb").map(p, level=0.5)
    info = fig.map_info
    assert info["level"] == 0.5 and info["recommended"] is None and info["size"][0] > 10
    assert fig.render(SMALL).to_numpy()[..., :3].std() > 5
    for style in ("layers", "mesh", "slice"):
        assert fig.copy().map(style=style).render(SMALL).to_numpy()[..., :3].std() > 5, style
    alone = ms.load_map(p, level=0.5)
    assert "map" in repr(alone) and alone.render(SMALL).to_numpy()[..., :3].std() > 5
    assert alone.copy().map(smooth=4).render(SMALL).to_numpy()[..., :3].std() > 5   # low-passed: the "auto" keeps its map
    assert ms.load(EX / "1A8O.pdb").map(p).map(None).map_info is None


def test_modified_residues_stay_in_the_chain():
    """a selenomethionine (HETATM MSE) bonded into the chain is part of the polymer: drawn in the cartoon, not as a
    ligand; a HETATM not bonded to the chain stays a ligand"""
    lines = []
    for i, (resn, rec) in enumerate((("ALA", "ATOM  "), ("MSE", "HETATM"), ("ALA", "ATOM  ")), start=1):
        for nm, x, el in (("N", 3.8 * (i - 1) - 0.65, "N"), ("CA", 3.8 * (i - 1), "C"), ("C", 3.8 * (i - 1) + 1.56, "C")):
            lines.append(f"{rec}{len(lines) + 1:5d}  {nm:<3} {resn} A{i:4d}    {x:8.3f}{0.0:8.3f}{0.0:8.3f}  1.00 10.00          {el:>2}")
    lines.append(f"HETATM{len(lines) + 1:5d}  C1  LIG A 100    {30.0:8.3f}{0.0:8.3f}{0.0:8.3f}  1.00 10.00           C")
    fig = ms.load("\n".join(lines) + "\nEND\n", format="pdb")
    from molsketch._engine import engine
    atoms = engine().call("sceneJson", fig._spec())["keyframes"][0]["atoms"]
    het = {a["resn"]: a["het"] for a in atoms.values()}
    assert het["MSE"] is False and het["ALA"] is False and het["LIG"] is True
