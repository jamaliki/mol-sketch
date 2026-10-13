"""Orbitals, measures and lone pairs in scenes, the Textbook look, and the geometry helpers that build such scenes.

    cd python && .venv/bin/python -m pytest tests/test_orbitals.py -q
"""
from __future__ import annotations

import importlib.util
import pathlib

import numpy as np
import pytest

import molsketch as ms
from molsketch import geometry as g

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SMALL = (480, 360)


def carbonyl_scene(**extra) -> dict:
    """hydroxide over formaldehyde, posed by the π* rule, with its orbitals and measures"""
    c, o = np.zeros(3), np.array([1.21, 0, 0])
    h1 = 1.1 * np.array([np.cos(np.radians(121.8)), 0, np.sin(np.radians(121.8))]); h2 = h1 * [1, 1, -1]
    nu = g.relative_pose((c, o, h1), {"O": [0, 0, 0], "H": [0.97, 0, 0]}, ("O", "H"), d=2.95, alpha_a=105, alpha_b=109.5, tau_a=90, tau_ab=-150)
    lp = g.lone_pairs(nu["O"], [nu["H"]], 3, toward=c)
    k = {"name": "precursor", "hold": 20, "transition": 30,
         "atoms": {"Nu": {"el": "O", "pos": nu["O"], "lp": lp, "charge": -1}, "HNu": {"el": "H", "pos": nu["H"]},
                   "C": {"el": "C", "pos": c.tolist()}, "O": {"el": "O", "pos": o.tolist()}, "H1": {"el": "H", "pos": h1.tolist()}, "H2": {"el": "H", "pos": h2.tolist()}},
         "bonds": [["Nu", "HNu", 1], ["C", "O", 2], ["C", "H1", 1], ["C", "H2", 1]],
         "orbitals": [{"type": "n", "atom": "Nu", "lp": 0, "label": "n(O)"}, {"type": "pi*", "bond": ["C", "O"], "toward": "Nu", "label": "π*"}],
         "measures": [{"distance": ["Nu", "C"], "window": [2.95, 0.45]}, {"angle": ["Nu", "C", "O"], "window": [105, 10]}, {"torsion": ["H1", "O", "C", "Nu"]}],
         "arrows": [{"from": {"lp": "Nu", "i": 0}, "to": {"atom": "C"}}, {"from": {"bond": ["C", "O"]}, "to": {"orbital": 1}}]}
    for key in ("orbitals", "measures", "arrows"):
        if key in extra and extra[key] is None: del k[key]
    return {"name": "carbonyl", "view": {"yaw": -24, "pitch": 14}, "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k]}


def draw(scene, look="textbook", **style):
    fig = ms.scene(scene).look(look)
    if style: fig.set(**style)
    return fig.render(SMALL, frame=18).to_numpy()[..., :3].astype(int)


# ------------------------------------------------------------------------------------------------- geometry
@pytest.mark.parametrize("ang,tor", [(105, 90), (105, -90), (60, -150), (120, 30), (180, 0)])
def test_place_builds_what_it_is_asked(ang, tor):
    a, b, c = [1, 1, 0.2], [0, 0, 0], [1.5, 0, 0]
    d = g.place(a, b, c, 2.95, ang, tor)
    assert g.distance(c, d) == pytest.approx(2.95) and g.angle(b, c, d) == pytest.approx(ang)
    if ang < 179: assert g.torsion(a, b, c, d) == pytest.approx(tor)


def test_relative_pose_reads_back_its_six_coordinates():
    fa = [np.zeros(3), np.array([1.2, 0, 0]), np.array([-0.5, 0.9, 0.1])]
    partner = {"O": [5, 5, 5], "H": [5.97, 5, 5], "X": [5.2, 5.9, 4.6]}
    want = dict(d=2.95, alpha_a=105, alpha_b=112, tau_a=88, tau_ab=-60, tau_b=35)
    p = g.relative_pose(fa, partner, ("O", "H", "X"), **want)
    got = g.internal_pose(fa, [p["O"], p["H"], p["X"]])
    for k, v in want.items(): assert got[k] == pytest.approx(v, abs=1e-6), k
    # a rigid motion: the partner's own shape is kept
    assert g.distance(p["H"], p["X"]) == pytest.approx(g.distance(partner["H"], partner["X"]))


def test_collinear_frames_leave_their_torsions_free():
    fa = [np.zeros(3), np.array([1.94, 0, 0]), None]
    p = g.relative_pose(fa, {"O": [0, 0, 0], "H": [0.97, 0, 0]}, ("O", "H"), d=3.1, alpha_a=180, alpha_b=109.5)
    got = g.internal_pose(fa, [p["O"], p["H"]])
    assert got["d"] == pytest.approx(3.1) and got["alpha_a"] == pytest.approx(180) and got["alpha_b"] == pytest.approx(109.5)
    assert got["tau_a"] is None and got["tau_ab"] is None


def test_lone_pairs_point_where_asked():
    lp = g.lone_pairs([0, 0, 0], [[0.97, 0, 0]], 3, toward=g.place(None, [1, 0, 0], [0, 0, 0], 3, 109.47, 40))
    assert len(lp) == 3 and all(np.linalg.norm(v) == pytest.approx(1) for v in lp)
    assert g.angle([0.97, 0, 0], [0, 0, 0], lp[0]) == pytest.approx(109.47, abs=0.5)
    assert g.angle(lp[0], [0, 0, 0], g.place(None, [1, 0, 0], [0, 0, 0], 3, 109.47, 40)) < 2   # the first faces the target
    assert len(g.lone_pairs([0, 0, 0], [[1, 0, 0], [-0.3, 0.95, 0], [-0.3, -0.5, 0.8]], 1)) == 1


# ---------------------------------------------------------------------------------------------- the drawing
def test_textbook_is_a_look():
    assert "textbook" in ms.looks()
    st = ms.scene(carbonyl_scene()).look("textbook").style
    assert st["orbital_style"] == "engraved" and st["lone_pair_style"] == "bold" and st["stick_style"] == "engraved"


@pytest.mark.parametrize("look", ["textbook", "watercolour", "ink-colour", "chalkboard"])
def test_orbitals_and_measures_draw_in_every_look(look):
    with_ = draw(carbonyl_scene(), look); without = draw(carbonyl_scene(orbitals=None, measures=None), look)
    assert np.abs(with_ - without).mean() > 1.0          # the lobes and the measures are on the page


def test_switching_them_off_is_leaving_them_out():
    off = draw(carbonyl_scene(), show={"orbitals": False, "measures": False})
    assert np.array_equal(off, draw(carbonyl_scene(orbitals=None, measures=None)))


def test_lone_pair_styles_differ():
    a = draw(carbonyl_scene(orbitals=None, measures=None), lone_pair_style="dots")
    b = draw(carbonyl_scene(orbitals=None, measures=None), lone_pair_style="bold")
    c = draw(carbonyl_scene(orbitals=None, measures=None), lone_pair_style="lobes")
    assert not np.array_equal(a, b) and not np.array_equal(b, c)


def test_orbitals_follow_the_atoms_through_a_transition():
    sc = carbonyl_scene(); k2 = {**sc["keyframes"][0], "name": "after", "orbitals": [], "measures": [], "arrows": []}
    sc["keyframes"].append(k2)
    fig = ms.scene(sc).look("textbook")
    mid = fig.render(SMALL, frame=20 + 12).to_numpy(); late = fig.render(SMALL, frame=20 + 29).to_numpy()
    assert not np.array_equal(mid, late)                 # fading out


def test_svg_keeps_the_lobes_as_vectors():
    svg = ms.scene(carbonyl_scene()).look("textbook").svg(SMALL, frame=18)
    plain = ms.scene(carbonyl_scene(orbitals=None, measures=None)).look("textbook").svg(SMALL, frame=18)
    assert svg.count("<path") > plain.count("<path") + 10    # the lobes, their tints and the measures are paths


# ------------------------------------------------------------------------------------------ reaction figures
def _figures():
    spec = importlib.util.spec_from_file_location("reaction_figures", ROOT / "tools" / "reaction_figures.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def test_reaction_figures_sit_inside_their_windows():
    rf = _figures()
    for name, build in rf.BUILDERS.items():
        lines = rf.check(name, build())
        assert lines and not any("OUTSIDE" in l for l in lines), (name, lines)


def test_reaction_scenes_draw():
    rf = _figures()
    for name, build in rf.BUILDERS.items():
        img = ms.scene(build()).look("textbook").render((320, 240), frame=rf.HOLD - 2).to_numpy()
        assert img[..., :3].std() > 10, name
