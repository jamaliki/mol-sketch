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
    assert st["cartoonStyle"] == "engraved" and st["line"]["width"] == 2 and st["reps"]["sticks"] == "" and st["groupPaletteName"] == "Okabe–Ito"
    assert fig.camera["yaw"] == 30


def test_changes_survive_a_later_look():
    fig = ms.load(EX / "1A8O.pdb").set(labelSize=31).look("chalkboard")
    assert fig.style["labelSize"] == 31 and fig.style["fill"] == "chalk"


def test_same_figure_same_pixels():
    f = lambda: ms.load(EX / "1A8O.pdb").look("watercolour").view(yaw=40, pitch=10)
    assert np.array_equal(f().render(SMALL).to_numpy(), f().render(SMALL).to_numpy())


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
