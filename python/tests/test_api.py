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


def test_frames_drawn_by_other_processes_are_the_same(tmp_path):
    fig = ms.load(EX / "mechanism.json").look("chalkboard")
    here = fig.save_frames(tmp_path / "here", list(range(0, 16, 2)), SMALL, workers=1)
    there = fig.save_frames(tmp_path / "there", list(range(0, 16, 2)), SMALL, workers=2)
    assert [f.name for f in here] == [f.name for f in there]
    assert all(a.read_bytes() == b.read_bytes() for a, b in zip(here, there))


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


def test_flat_svg_is_shapes_in_the_colours_given():
    """the flat look as an SVG: shapes only (no pictures, the paper one rectangle), and every ribbon painted in a colour it
    was given or that colour's one darker shade, so another program can recolour it shape by shape"""
    import re
    given = {"helix": "#3366aa", "sheet": "#ddaa33", "loop": "#f0f0f0"}
    s = ms.load(EX / "trypsin_active_site.json").look("flat").set(palette=given).site("resi 57+102+195").svg((640, 480))
    assert "<image" not in s and s.count("<rect") == 1
    fills = set(re.findall(r'fill="(#[0-9a-f]{6})"', s))
    assert set(given.values()) <= fills
    assert len(fills) < 24                                   # a few colours, two tones each, not a gradient of mixes


def test_flat_svg_draws_each_piece_of_ribbon_as_one_curved_shape_in_groups():
    """the flat look as an SVG: each visible stretch of a ribbon one closed path of curves (not a strip of quadrilaterals),
    inked round with one line; in a group per chain, and in it one per helix, strand or loop, named with its residues,
    and one per residue's sticks"""
    import xml.etree.ElementTree as ET
    ns, ink = "{http://www.w3.org/2000/svg}", "{http://www.inkscape.org/namespaces/inkscape}"
    s = ms.load(EX / "1A8O.pdb").look("flat").svg((640, 480))
    root = ET.fromstring(s)
    paths = root.findall(f".//{ns}path")
    assert len(paths) < 120                                  # a few shapes per helix, not hundreds of slivers
    chains = [g for g in root.iter(f"{ns}g") if g.get("data-chain")]
    assert [g.get("id") for g in chains] == ["chain-A"] and chains[0].get(f"{ink}label") == "Chain A"
    elements = [g for g in chains[0] if g.get("data-ss")]
    assert {g.get("data-ss") for g in elements} == {"helix", "loop"}
    helix = next(g for g in elements if g.get("data-ss") == "helix")
    assert helix.get(f"{ink}label").startswith("Helix ") and "–" in helix.get(f"{ink}label") and "-" in helix.get("data-residues")
    ribbon = [p for g in elements for p in g.iter(f"{ns}path")]
    assert all(p in ribbon for p in paths)                   # every shape is in its element's group
    assert any("C" in p.get("d") for p in ribbon)            # curves, fitted through the edges
    assert any(p.get("fill") not in (None, "none") and p.get("stroke") for p in ribbon)   # one shape, filled and inked
    ids = [g.get("id") for g in root.iter(f"{ns}g")]
    assert len(ids) == len(set(ids))                         # a group the depth order splits is numbered again
    site = ms.load(EX / "trypsin_active_site.json").look("flat").site("resi 57+102+195").svg((640, 480))
    residues = {g.get("data-resn") + g.get("data-resi") for g in ET.fromstring(site).iter(f"{ns}g") if g.get("data-resn")}
    assert {"HIS57", "ASP102", "SER195"} <= residues
    for picture in ("<image", "<clipPath", "<pattern", "<filter", "mix-blend-mode"): assert picture not in site, picture


def test_transparent_paper_is_left_out():
    fig = ms.load(EX / "1A8O.pdb").look("flat").set(**{"paper.transparent": True})
    a = fig.render(SMALL).to_numpy()
    assert a[0, 0, 3] == 0 and a[..., 3].max() == 255        # nothing laid down where nothing is drawn
    assert "<rect" not in fig.svg(SMALL)


def test_flat_sticks_are_outlined_with_ribbons():
    """stick_outline 'auto': flat sticks are inked round when ribbons are drawn, and plain on their own"""
    ink = 'stroke="#000000"'
    mech = ms.load(EX / "mechanism.json").look("flat")
    assert ms.default_style()["stick_outline"] == "auto" and mech.style["stick_style"] == "flat"
    assert ink not in mech.svg(SMALL)
    assert ink in mech.set(stick_outline="on").svg(SMALL)
    protein = ms.load(EX / "trypsin_active_site.json").look("flat").show(cartoon=None).site("resi 57+102+195")
    assert ink not in protein.svg(SMALL)
    assert ink in protein.show(cartoon="polymer").svg(SMALL)


def test_flat_draws_protons_charges_and_valence_its_own_way():
    """the flat look: bonds to hydrogens thinner, charges as badges, double bonds as lanes -- each a part of the drawing"""
    fig = lambda **st: ms.load(EX / "mechanism.json").look("flat").set(**st).render(SMALL, frame=100).to_numpy()
    st = ms.load(EX / "mechanism.json").look("flat").style
    assert st["stick_h_scale"] == 0.55 and ms.default_style()["stick_h_scale"] == 1
    plain = fig()
    for change in ({"stick_h_scale": 1}, {"show.charges": False}, {"show.valence": False}):
        assert not np.array_equal(fig(**change), plain), change


def test_flat_ball_and_stick_is_pymols():
    """ball-and-stick with flat sticks: solid balls in the atoms' own colours (a residue's colour too), outlined beside
    ribbons, thinner rods between them -- plain shapes in an SVG, as the flat sticks are -- not the pencil balls"""
    import re
    site = lambda: ms.load(EX / "trypsin_active_site.json").look("flat").site("resi 57+102+195").color("HIS57", "#1b9e77")
    sticks, balls = site(), site().set(mode="ballstick")
    assert not np.array_equal(sticks.render(SMALL).to_numpy(), balls.render(SMALL).to_numpy())
    s = balls.svg((640, 480))
    for picture in ("<image", "<clipPath", "<pattern", "<filter", "mix-blend-mode"): assert picture not in s, picture
    fills = set(re.findall(r'fill="(#[0-9a-f]{6})"', s))
    assert {"#1b9e77", "#3a6ee0", "#e04848"} <= fills                 # His57's carbons as given, its N, Asp102's O
    assert 'stroke="#000000"' in s
    pencil = site().set(mode="ballstick", stick_style="engraved").render(SMALL).to_numpy()
    assert not np.array_equal(pencil, balls.render(SMALL).to_numpy())
    bigger = site().set(mode="ballstick", sphere_scale=0.4).render(SMALL).to_numpy()   # sphere_scale: the balls' share of the vdW radius
    assert not np.array_equal(bigger, balls.render(SMALL).to_numpy())


def test_flat_ball_and_stick_draws_double_bonds_and_hydrogens():
    """the mechanism in flat ball-and-stick: double bonds as two rods (show.valence), hydrogens' balls smaller, the scene's
    forming bonds dotted -- it draws at every frame"""
    fig = lambda **st: ms.load(EX / "mechanism.json").look("flat").set(mode="ballstick", **st)
    plain = fig().render(SMALL, frame=100).to_numpy()
    assert not np.array_equal(fig(**{"show.valence": False}).render(SMALL, frame=100).to_numpy(), plain)
    assert not np.array_equal(fig(**{"show.H": False}).render(SMALL, frame=100).to_numpy(), plain)
    for f in fig().frames("keyframes"): assert fig().render(SMALL, frame=f + 20).to_numpy()[..., :3].std() > 5


def test_flat_site_sticks_are_slimmer():
    """the flat look's sticks are 0.2 Å and its site's 1.25 times that (PyMOL's 0.25 Å); the other looks keep theirs"""
    st = ms.load(EX / "1A8O.pdb").look("flat").style
    assert st["stick_radius"] == 0.2 and st["site"]["scale"] == 1.25 and st["sphere_scale"] == 0.25
    assert ms.default_style()["site"]["scale"] == 1.9 and ms.load(EX / "1A8O.pdb").look("engraved").style["site"]["scale"] == 1.9


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


def test_system_font_text_keeps_every_glyph():
    """text in a system font (the α/β labels' serif, any character the web fonts lack) is shaped from tables HarfBuzz
    must be able to keep: a table freed under it gave missing glyphs ("α3" drawn as "α"), varying from run to run"""
    import gc
    import uharfbuzz as hb
    from molsketch._text import TextEngine
    face = TextEngine()._system_face("Times New Roman", 400, "italic")
    for _ in range(50):
        _churn = [bytes(1000) for _ in range(200)]; gc.collect()
        for s in ("α3", "β12", "a3", "α 3"):
            buf = hb.Buffer(); buf.add_str(s); buf.guess_segment_properties(); hb.shape(face.hb, buf)
            assert 0 not in [g.codepoint for g in buf.glyph_infos], s


def test_kept_textures_draw_the_same(tmp_path, monkeypatch):
    """the paper and chalk textures kept as files: a later engine takes them and draws the same pixels, and one whose
    files went after it started draws them again"""
    from molsketch._engine import Engine
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path))
    text = (EX / "1A8O.pdb").read_text()

    def draw(e, look):
        spec = {"input": {"ref": e.put({"text": text, "name": "1A8O.pdb"})}, "size": list(SMALL), "scale": 1, "frame": 0, "look": look}
        return e.render(spec).toarray()

    first = {look: draw(Engine(), look) for look in ("chalkboard", "watercolour")}
    kept = list((tmp_path / "textures").glob("*.tex")); assert kept
    for look, px in first.items(): assert np.array_equal(draw(Engine(), look), px)
    e = Engine()
    for f in kept: f.unlink()
    assert np.array_equal(draw(e, "chalkboard"), first["chalkboard"])
    (tmp_path / "textures" / "x.tex").write_bytes(b"MSTX1\n")   # a broken file is passed over
    assert np.array_equal(draw(Engine(), "watercolour"), first["watercolour"])


def _secondary(fig):
    """Each residue's secondary structure, as the engine has read it, in residue order."""
    from molsketch._engine import engine
    atoms = engine().call("sceneJson", fig._spec())["keyframes"][0]["atoms"].values()
    return [ss for _, ss in sorted({(a["resi"], a.get("ss") or "L") for a in atoms if not a.get("het")})]


def test_two_files_of_one_name_are_read_as_their_own(tmp_path):
    """Two structures with one file name, one length and the same first and last lines -- two
    design runs' run1/model.pdb and run2/model.pdb -- are each read as they are, in one
    process, not the second as the first."""
    lines = (EX / "1A8O.pdb").read_text().splitlines()
    atoms = [line for line in lines if line.startswith(("ATOM", "HETATM"))]
    resi = sorted({int(line[22:26]) for line in atoms if line.startswith("ATOM")})
    chain = atoms[0][21]
    a, b = resi[2], resi[8]
    # Two runs: the same atoms, a helix in the middle of one and a strand pair in the other's,
    # their records the same length, the files the same length, header and footer alike.
    head = "REMARK   1 DESIGN RUN OUTPUT, THE SAME HEADER FOR EVERY RUN, LONGER THAN SIXTY-FOUR"
    helix = f"HELIX    1   1 ALA {chain} {a:>4}  ALA {chain} {b:>4}  1"
    sheet = f"SHEET    1   A 2 ALA {chain}{a:>4}  ALA {chain}{a + 3:>4}  0"
    sheet = sheet.ljust(len(helix))
    one, two = tmp_path / "run1" / "model.pdb", tmp_path / "run2" / "model.pdb"
    for path, record in ((one, helix), (two, sheet)):
        path.parent.mkdir()
        path.write_text("\n".join([head, record, *atoms, "TER", "END", ""]))
    assert len(one.read_text()) == len(two.read_text())
    first, second = _secondary(ms.load(one)), _secondary(ms.load(two))
    assert "H" in first and "E" not in first
    assert "E" in second and "H" not in second
    # The same file loaded again is read once, and is the same.
    assert _secondary(ms.load(one)) == first


# Nine ideal α-helices, Cα atoms only, four in chain A (residues from 1) and five in chain a (from 501): (chain,
# residues, centre in Å, the axis's tilt from z and turn about it in degrees). One is seen nearly end on.
HELICES = (("A", 11, (13, 15, 5), 3, 262), ("a", 16, (5, -2, 10), 7, 190), ("A", 15, (-17, -3, 0), 24, 15),
           ("a", 10, (-9, -10, -7), 151, 183), ("A", 16, (13, -6, 4), 114, 98), ("a", 15, (-7, 15, 17), 146, 251),
           ("A", 15, (14, 17, -4), 75, 253), ("a", 11, (-11, 11, 4), 21, 100), ("a", 12, (-2, -16, 3), 86, 269))


def _helices() -> str:
    """HELICES as a PDB file"""
    import math
    lines, first = [], {"A": 1, "a": 501}
    for chain, n, centre, tilt, turn in HELICES:
        t, u = math.radians(tilt), math.radians(turn)
        axis = (math.sin(t) * math.cos(u), math.sin(t) * math.sin(u), math.cos(t))
        e1, e2 = (math.cos(t) * math.cos(u), math.cos(t) * math.sin(u), -math.sin(t)), (-math.sin(u), math.cos(u), 0.0)
        for i in range(n):   # 2.3 Å from the axis, 100° and 1.5 Å a residue
            a, h = math.radians(100 * i), 1.5 * (i - (n - 1) / 2)
            x, y, z = (c + 2.3 * math.cos(a) * p + 2.3 * math.sin(a) * q + h * w for c, p, q, w in zip(centre, e1, e2, axis))
            lines.append(f"ATOM  {len(lines) + 1:5d}  CA  ALA {chain}{first[chain] + i:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00           C")
        first[chain] += n + 10
    return "\n".join(lines) + "\nEND\n"


def test_flat_ribbon_cut_where_it_overlaps_itself_is_drawn():
    """A helix seen nearly end on, small, its turns overlapping each other, and other ribbons in front of one turn and
    behind another: the flat look cuts the helix's face so the order of the pieces goes round no circle, and the cut
    falls between two of its faces that overlap. They are an order of their own then; it was not looked at, a circle
    was left, and the drawing failed (as the human ribosome's did, 6QZP)."""
    import xml.etree.ElementTree as ET
    fig = ms.load(_helices(), name="helices", format="pdb").look("flat").show(cartoon="polymer", sticks=None)
    root = ET.fromstring(fig.svg((200, 200)))
    ns = "{http://www.w3.org/2000/svg}"
    assert {g.get("data-chain") for g in root.iter(f"{ns}g") if g.get("data-chain")} == {"A", "a"}
    assert sum(1 for g in root.iter(f"{ns}g") if g.get("data-ss") == "helix") >= 9
    assert fig.render((200, 200)).to_numpy()[..., :3].std() > 5


def test_chains_named_alike_but_for_case_are_two_chains():
    """Chain IDs are case-sensitive (mmCIF's auth_asym_id; a ribosome has chains LE and Le): `chain A` selects A
    alone, as PyMOL and ChimeraX do, for what is drawn and what the view is fitted to; an atom named in chain a is
    found in a; the two chains are groups of their own in an SVG"""
    import xml.etree.ElementTree as ET
    ns, ink = "{http://www.w3.org/2000/svg}", "{http://www.inkscape.org/namespaces/inkscape}"
    fig = ms.load(_helices(), name="helices", format="pdb").look("flat")
    assert fig._info()["structure"]["chains"] == ["A", "a"]
    chains = lambda s: {g.get("id"): (g.get(f"{ink}label"), g.get("data-chain")) for g in ET.fromstring(s).iter(f"{ns}g") if g.get("data-chain")}
    assert chains(fig.svg(SMALL)) == {"chain-A": ("Chain A", "A"), "chain-a": ("Chain a", "a")}
    assert chains(fig.copy().show(cartoon="chain A").svg(SMALL)) == {"chain-A": ("Chain A", "A")}
    assert chains(fig.copy().show(cartoon="chain a").svg(SMALL)) == {"chain-a": ("Chain a", "a")}
    assert chains(fig.copy().show(cartoon="chain A+a").svg(SMALL)).keys() == {"chain-A", "chain-a"}
    # the same atoms drawn, the view fitted to the same atoms: chain A is residues 1-200
    assert np.array_equal(fig.copy().show(cartoon="chain A").render(SMALL).to_numpy(), fig.copy().show(cartoon="resi 1-200").render(SMALL).to_numpy())
    assert fig.copy().label("x", at="ALA501.a")._labels[-1]["at"] == "ALA501.a:CA"
    assert fig.copy().label("x", at="ala1.A")._labels[-1]["at"] == "ALA1.A:CA"   # a residue's name in any case
    with pytest.raises(ms.CoreError, match="no residue ALA1 in chain a"): fig.copy().label("x", at="ALA1.a")
