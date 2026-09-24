"""Regenerate the images in docs/img and the style files in looks/, all with the molsketch Python package.

    python tools/make_images.py            everything (the ribosome images take a few minutes)
    python tools/make_images.py ras looks  only some groups: looks, ras, palettes, protein, ribosome, turntable, styles

Run it from the repository root with the package installed (pip install ./python). Structures come from the PDB and
are cached; ffmpeg is needed for the turntable. docs/img/app.png is a screenshot of the app and is not made here.
"""
from __future__ import annotations

import json
import pathlib
import sys

import molsketch as ms
from molsketch._engine import engine

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "img"
MECH = ROOT / "examples" / "mechanism.json"
PROTEIN = ROOT / "examples" / "test_protein.pdb"
IMG.mkdir(parents=True, exist_ok=True)


def say(path):
    print(" ", path.relative_to(ROOT))


def looks():
    """the serine hydrolase mechanism at frame 28 (the end of the first hold, arrows drawn) in each look"""
    for name, look, extra in (("mechanism_watercolour", "watercolour", {}), ("ink_colour", "ink-colour", {}), ("ink", "ink", {}),
                              ("pencil", "watercolour", {"fill": "pencil", "construction": True}),
                              ("dark_paper", "dark-paper", {}), ("chalkboard", "chalkboard", {})):
        say(ms.scene(MECH).look(look).set(**extra).save(IMG / f"{name}.png", (960, 720), frame=28))


def ras():
    """Ras with GppNHp and Mg²⁺ (PDB 5P21): engraved, engraved colour, and the labelled figure"""
    base = ms.fetch("5P21").show(sticks="hetatm and not water").view(yaw=60, pitch=20)
    for look in ("engraved", "engraved-colour"):
        say(base.copy().look(look).save(IMG / f"{look.replace('-', '_')}.png", (1200, 900)))
    fig = base.copy().look("engraved-colour").view(zoom=0.92).set(label_size=24)
    for text, at, off in (("P-loop", "Gly12", (140, 30)), ("Switch I", "Tyr32", (110, -60)), ("Switch II", "Gln61", (130, 70)),
                          ("GppNHp", "Gnp167:N1", (-60, -95)), ("Mg²⁺", "Mg168", (90, -10))):
        fig.label(text, at=at, offset=off)
    say(fig.save(IMG / "labels.png", (1200, 900)))


def palettes():
    """the ribbon colours engraved colour picks from three group palettes (PDB 7SXY)"""
    for name, file in (("Coastal Harvest", "palette_coastal_harvest"), ("Okabe–Ito", "palette_okabe_ito"), ("Tol muted", "palette_tol_muted")):
        fig = ms.fetch("7SXY").look("engraved-colour").show(sticks=None).view(zoom=1.15).palette(name)
        say(fig.save(IMG / f"{file}.png", (900, 675)))


def protein():
    """a small protein as a watercolour cartoon, and as a surface coloured by residue"""
    base = ms.load(PROTEIN).look("watercolour").view(yaw=30, pitch=20)
    say(base.copy().save(IMG / "protein_cartoon_watercolour.png", (960, 720)))
    say(base.copy().show(cartoon=None, surface="polymer", sticks="hetatm").set(surface_color="residue")
        .save(IMG / "protein_surface_watercolour.png", (960, 720)))


def ribosome():
    """the 70S ribosome (PDB 6GZQ) as a surface and as a cartoon, coloured by subunit"""
    say(ms.fetch("6GZQ").look("assembly-surface").save(IMG / "ribosome_surface_by_subunit.png", (900, 900)))
    say(ms.fetch("6GZQ").look("assembly-cartoon").save(IMG / "ribosome_cartoon_by_subunit.png", (900, 900)))


def turntable():
    """one turn of the ribosome surface with a 12° nod, as MP4 and GIF (needs ffmpeg)"""
    fig = ms.fetch("6GZQ").look("assembly-surface")
    say(fig.turntable(IMG / "ribosome_turntable.mp4", n=36, size=(720, 720), swing=12, fps=12))
    say(fig.turntable(IMG / "ribosome_turntable.gif", n=36, size=(480, 480), swing=12, fps=12))


def styles():
    """looks/*.json: each look as a complete style file, what the app's Export › Save style writes (and its
    Load style, Figure.apply_style and molsketch render --style read)"""
    out = ROOT / "looks"; out.mkdir(exist_ok=True)
    fig = ms.load(PROTEIN)
    for look in ms.looks():
        style = engine().call("info", {**fig.look(look)._spec()})["style"]
        p = out / f"{look}.json"; p.write_text(json.dumps(style, indent=1, ensure_ascii=False) + "\n"); say(p)


GROUPS = {"looks": looks, "ras": ras, "palettes": palettes, "protein": protein, "ribosome": ribosome, "turntable": turntable, "styles": styles}

if __name__ == "__main__":
    for g in sys.argv[1:] or GROUPS:
        if g not in GROUPS: sys.exit(f"unknown group {g!r}; the groups are {', '.join(GROUPS)}")
        print(g); GROUPS[g]()
