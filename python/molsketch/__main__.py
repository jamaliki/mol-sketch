"""The molsketch command.

    molsketch serve [--port 8471] [--no-browser]           the app, drawn by this package
    molsketch render INPUT [options] -o fig.png             one figure (or a scene's frames) from the terminal
    molsketch looks | palettes                              what there is

INPUT is a file (.pdb, .cif, a scene .json) or a PDB ID (fetched from RCSB)."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys


def _figure(src: str):
    import molsketch as ms
    if re.fullmatch(r"[0-9][A-Za-z0-9]{3}", src) and not pathlib.Path(src).exists(): return ms.fetch(src)
    return ms.load(src)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="molsketch", description="Hand-drawn molecular figures.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the app, with its figures drawn by molsketch")
    s.add_argument("--port", type=int, default=8471); s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--no-browser", action="store_true"); s.add_argument("--verbose", action="store_true")
    r = sub.add_parser("render", help="draw a figure")
    r.add_argument("input", help="a .pdb / .cif / scene .json, or a PDB ID")
    r.add_argument("-o", "--out", default="figure.png", help="an image (.png .jpg .webp), a vector drawing (.svg), a video (.mp4 .webm .gif), .json, or a directory for frames")
    r.add_argument("--look"); r.add_argument("--style", help="a style JSON saved from the app")
    r.add_argument("--set", action="append", default=[], metavar="PATH=VALUE", help="change one style field (repeatable): line.width=2")
    r.add_argument("--size", default="1920x1440"); r.add_argument("--scale", type=float, default=1)
    for k in ("yaw", "pitch", "roll", "zoom", "fov"): r.add_argument(f"--{k}", type=float)
    r.add_argument("--pan", help="X,Y as fractions of the canvas")
    r.add_argument("--fit", metavar="L,T,R,B", help="after the camera: zoom and pan so the drawing fills this box of the canvas (fractions, or percent), e.g. 57,13,92,58")
    r.add_argument("--fit-what", choices=("all", "frame"), default="all", help="what --fit measures: every keyframe of a scene (default) or this frame")
    r.add_argument("--site", help="the active site: a selection, or 'ligand'"); r.add_argument("--frame-site", action="store_true"); r.add_argument("--label-site", action="store_true")
    r.add_argument("--palette"); r.add_argument("--frame", type=int, help="a scene's frame (or a structure's boil)")
    r.add_argument("--frames", help="scenes: all | drawn | keyframes | N | A-B (with a directory or video out)")
    r.add_argument("--turntable", type=int, metavar="N", help="N frames of one turn"); r.add_argument("--fps", type=float)
    sub.add_parser("looks", help="list the looks"); sub.add_parser("palettes", help="list the group palettes")
    a = ap.parse_args(argv)

    if a.cmd == "serve":
        from ._server import serve
        return serve(a.port, a.host, not a.no_browser, a.verbose)
    import molsketch as ms
    if a.cmd == "looks":
        for k, v in ms.looks().items(): print(f"{k:18s} {v}")
        return
    if a.cmd == "palettes":
        for k, v in ms.palettes().items(): print(f"{k:22s} {' '.join(v)}")
        return

    fig = _figure(a.input)
    if a.look: fig.look(a.look)
    if a.style: fig.apply_style(a.style)
    for kv in a.set:
        k, _, v = kv.partition("="); val = {"true": True, "false": False}.get(v, v)
        if isinstance(val, str) and val and re.fullmatch(r"-?[\d.]+(e-?\d+)?", val): val = float(val) if "." in val or "e" in val else int(val)
        fig.set(**{k: val})
    if a.palette: fig.palette(a.palette)
    view = {k: getattr(a, k) for k in ("yaw", "pitch", "roll", "zoom", "fov") if getattr(a, k) is not None}
    if a.pan: view["pan"] = tuple(float(x) for x in a.pan.split(","))
    if view: fig.view(**view)
    size = tuple(int(x) for x in a.size.lower().split("x"))
    if a.fit:
        v = [float(x) for x in a.fit.split(",")]
        if len(v) != 4: sys.exit("--fit takes four numbers: left,top,right,bottom")
        if max(v) > 1: v = [x / 100 for x in v]
        fig.fit(tuple(v), size, what=a.fit_what)
    if a.site: fig.site(ligand=True) if a.site == "ligand" else fig.site(a.site)
    if a.frame_site: fig.frame_site(size)
    if a.label_site: fig.label_site(size)
    if a.frame is not None: fig.frame(a.frame)
    out = pathlib.Path(a.out)
    if a.turntable: fig.turntable(out, a.turntable, size, scale=a.scale, **({"fps": a.fps} if a.fps else {}))
    elif out.suffix.lower() in (".mp4", ".webm", ".gif"): fig.animate(out, a.frames or "drawn", size, scale=a.scale, **({"fps": a.fps} if a.fps else {}))
    elif not out.suffix: fig.save_frames(out, a.frames or "drawn", size, scale=a.scale)
    else: fig.save(out, size, scale=a.scale)
    print(out)


if __name__ == "__main__":
    sys.exit(main())
