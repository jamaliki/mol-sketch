"""The SDK draws what the app draws: every case is rendered by the app's CLI (in Chrome) and by molsketch (without a
browser), and the two images are compared pixel by pixel.

    cd python && .venv/bin/python -m pytest tests/test_parity.py -q          # or: .venv/bin/python tests/test_parity.py

Needs node, the built app (cd app && npm run build) and Chrome (CHROMIUM=/path/to/chrome, or Playwright's). The CLI's
images are cached in tests/.refs; delete it (or pass --refresh) after changing the app."""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

import numpy as np
import skia

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))
import molsketch as ms  # noqa: E402

REFS = HERE / ".refs"
EX = ROOT / "app" / "public" / "examples"
HERO = ROOT / "hero"
CHROME = os.environ.get("CHROMIUM") or ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" if sys.platform == "darwin" else None)


def cif(pid):   # a PDB entry as a local file, through the SDK's cache
    ms.fetch(pid); return pathlib.Path(os.environ.get("MOLSKETCH_CACHE", pathlib.Path.home() / ".cache" / "molsketch")) / f"{pid}.cif"


STICKS = "hetatm and not water"
# id → (CLI input, CLI flags, size, frame or None, the same figure in the SDK)
CASES = {
    "ras-engraved-colour": (lambda: cif("5P21"), ["--look", "engraved-colour", "--set", f"reps.sticks={STICKS}", "--yaw", "60", "--pitch", "20"], (1200, 900), None,
                            lambda: ms.fetch("5P21").look("engraved-colour").show(sticks=STICKS).view(yaw=60, pitch=20)),
    "ras-engraved": (lambda: cif("5P21"), ["--look", "engraved", "--set", f"reps.sticks={STICKS}", "--yaw", "60", "--pitch", "20"], (1200, 900), None,
                     lambda: ms.fetch("5P21").look("engraved").show(sticks=STICKS).view(yaw=60, pitch=20)),
    "ras-watercolour": (lambda: cif("5P21"), ["--look", "watercolour", "--set", f"reps.sticks={STICKS}", "--yaw", "60", "--pitch", "20"], (1200, 900), None,
                        lambda: ms.fetch("5P21").look("watercolour").show(sticks=STICKS).view(yaw=60, pitch=20)),
    "ras-chalkboard": (lambda: cif("5P21"), ["--look", "chalkboard", "--set", f"reps.sticks={STICKS}", "--yaw", "60", "--pitch", "20"], (1200, 900), None,
                       lambda: ms.fetch("5P21").look("chalkboard").show(sticks=STICKS).view(yaw=60, pitch=20)),
    "ras-dark-paper-site": (lambda: cif("5P21"), ["--look", "dark-paper", "--set", "site.sel=resn GNP", "--yaw", "60", "--pitch", "20"], (1200, 900), None,
                            lambda: ms.fetch("5P21").look("dark-paper").site("resn GNP").view(yaw=60, pitch=20)),
    "ras-ink": (lambda: cif("5P21"), ["--look", "ink", "--yaw", "30", "--pitch", "-10", "--zoom", "1.3"], (1000, 1000), None,
                lambda: ms.fetch("5P21").look("ink").view(yaw=30, pitch=-10, zoom=1.3)),
    "ras-default-style": (lambda: cif("5P21"), [], (960, 720), None, lambda: ms.fetch("5P21")),
    "ras-palette-labels": (lambda: cif("5P21"), ["--look", "engraved-colour", "--set", "palette.helix=#a799b7", "--set", "palette.sheet=#47a8bd", "--set", "palette.loop=#de9151",
                                                 "--set", "groupPalette=", "--yaw", "60", "--pitch", "20", "--set", "labelSize=24"], (1200, 900), None,
                           lambda: ms.fetch("5P21").look("engraved-colour").set(palette={"helix": "#a799b7", "sheet": "#47a8bd", "loop": "#de9151"}, groupPalette="", labelSize=24).view(yaw=60, pitch=20)),
    "mechanism-watercolour-28": (lambda: EX / "mechanism.json", ["--look", "watercolour"], (1200, 750), 28, lambda: ms.load(EX / "mechanism.json").look("watercolour")),
    "mechanism-chalk-100": (lambda: EX / "mechanism.json", ["--look", "chalkboard"], (1200, 750), 100, lambda: ms.load(EX / "mechanism.json").look("chalkboard")),
    "mechanism-ink-colour-61": (lambda: EX / "mechanism.json", ["--look", "ink-colour"], (1000, 700), 61, lambda: ms.load(EX / "mechanism.json").look("ink-colour")),
    "mechanism-default-200": (lambda: EX / "mechanism.json", [], (960, 720), 200, lambda: ms.load(EX / "mechanism.json")),
    "trypsin-site": (lambda: EX / "trypsin_active_site.json", [], (1600, 1200), 0, lambda: ms.load(EX / "trypsin_active_site.json")),
    "trypsin-site-chalk": (lambda: EX / "trypsin_active_site.json", ["--look", "chalkboard", "--set", "cartoonStyle=engraved", "--set", "site.sel=resi 57+102+195"], (1200, 900), 0,
                           lambda: ms.load(EX / "trypsin_active_site.json").look("chalkboard").set(cartoonStyle="engraved").site("resi 57+102+195")),
    "hero-calb-chalk": (lambda: HERO / "calb" / "calb_hero.json", ["--look", "chalkboard", "--style", str(HERO / "looks" / "chalkboard.json"), "--set", "show.labels=false", "--set", "show.caption=false",
                                                                  "--set", "show.stepLabel=false", "--set", "annot=1.5", "--set", "sphereScale=0.3", "--set", "boilHold=2"], (960, 540), 28,
                        lambda: ms.load(HERO / "calb" / "calb_hero.json").look("chalkboard").apply_style(HERO / "looks" / "chalkboard.json").set(**{"show.labels": False, "show.caption": False, "show.stepLabel": False, "annot": 1.5, "sphereScale": 0.3, "boilHold": 2})),
    "test-protein-1a8o": (lambda: EX / "1A8O.pdb", ["--look", "ink-colour"], (960, 720), None, lambda: ms.load(EX / "1A8O.pdb").look("ink-colour")),
    "ribosome-surface": (lambda: cif("6GZQ"), ["--look", "assembly-surface"], (900, 900), None, lambda: ms.fetch("6GZQ").look("assembly-surface")),
    "ribosome-cartoon": (lambda: cif("6GZQ"), ["--look", "assembly-cartoon"], (900, 900), None, lambda: ms.fetch("6GZQ").look("assembly-cartoon")),
    # at twice the pixels, as a Retina screen and scale=2 exports draw
    "x2-trypsin-site": (lambda: EX / "trypsin_active_site.json", ["--scale", "2"], (800, 600), 0, lambda: ms.load(EX / "trypsin_active_site.json")),
    "x2-mechanism-watercolour": (lambda: EX / "mechanism.json", ["--look", "watercolour", "--scale", "2"], (800, 500), 28, lambda: ms.load(EX / "mechanism.json").look("watercolour")),
    "x2-ras-chalkboard": (lambda: cif("5P21"), ["--look", "chalkboard", "--set", f"reps.sticks={STICKS}", "--yaw", "60", "--pitch", "20", "--scale", "2"], (600, 450), None,
                          lambda: ms.fetch("5P21").look("chalkboard").show(sticks=STICKS).view(yaw=60, pitch=20)),
}
SCALE = {k: 2 for k in CASES if k.startswith("x2-")}


def cli_render(case_id: str, refresh=False) -> pathlib.Path:
    """the app's own drawing of a case, through its CLI (cached)"""
    out = REFS / f"{case_id}.png"
    if out.exists() and not refresh: return out
    src, flags, (w, h), frame, _ = CASES[case_id]
    tmp = REFS / f".{case_id}"
    subprocess.run(["rm", "-rf", str(tmp)], check=True)
    cmd = ["node", str(ROOT / "app" / "cli" / "render.mjs"), str(src()), *flags, "--size", f"{w}x{h}", "--out", str(tmp)]
    if frame is not None: cmd += ["--frames", str(frame)]
    env = dict(os.environ, **({"CHROMIUM": CHROME} if CHROME else {}))
    subprocess.run(cmd, check=True, capture_output=True, env=env, cwd=ROOT / "app")
    got = sorted(tmp.glob("frame_*.png"))[0]; REFS.mkdir(exist_ok=True); got.replace(out); subprocess.run(["rm", "-rf", str(tmp)])
    return out


def compare(case_id: str, refresh=False):
    ref = cli_render(case_id, refresh)
    _, _, size, frame, build = CASES[case_id]
    img = build().render(size, frame=frame, scale=SCALE.get(case_id, 1))
    a = skia.Image.open(str(ref)).toarray(colorType=skia.kRGBA_8888_ColorType)[..., :3].astype(int)
    b = img.to_numpy()[..., :3].astype(int)
    if a.shape != b.shape: return {"id": case_id, "error": f"size {a.shape} vs {b.shape}"}
    d = np.abs(a - b).sum(-1)
    return {"id": case_id, "identical": 100 * (d == 0).mean(), "differ": 100 * (d > 6).mean(), "mean": d.mean() / 3, "max": int(d.max())}


# pytest: no visible difference anywhere. Chrome's Skia (the app) and skia-python's are different builds, so a pixel can
# round a level apart where strokes pile up; what must hold is that under 0.05 % of pixels differ by more than 6 levels
# (of 765, summed over RGB) and the mean difference stays under 0.01 of a level. The table shows the bit-identical share.
import pytest  # noqa: E402


@pytest.mark.parametrize("case_id", list(CASES))
def test_parity(case_id):
    r = compare(case_id)
    assert "error" not in r, r
    assert r["differ"] < 0.05 and r["mean"] < 0.01, r


if __name__ == "__main__":
    refresh = "--refresh" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    print(f"{'case':28s} {'identical':>10s} {'>6 levels':>10s} {'mean':>8s} {'max':>5s}")
    for cid in (only or CASES):
        r = compare(cid, refresh)
        if "error" in r: print(f"{cid:28s} {r['error']}"); continue
        print(f"{cid:28s} {r['identical']:9.3f}% {r['differ']:9.3f}% {r['mean']:8.4f} {r['max']:5d}")
