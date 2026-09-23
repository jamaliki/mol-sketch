"""The Figure: one molecular figure, built up by chained calls and drawn by the same engine as the app."""
from __future__ import annotations

import copy
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
from typing import Iterable, Sequence

import skia

from ._engine import engine, CoreError
from ._image import Image

Size = tuple[int, int]
DEFAULT_SIZE: Size = (1920, 1440)   # the app's CLI default


class Figure:
    """A figure of one structure, a stack of structures, or a keyframed scene.

    Every method that changes the figure returns it, so calls chain::

        ms.fetch("5P21").look("engraved-colour").view(yaw=60, pitch=20).save("ras.png")

    Nothing is drawn until you save, render or display it.
    """

    def __init__(self, _input: dict, name: str):
        self._ref = engine().put(_input)
        self._input_kind = next(iter(_input))
        self.name = name
        self._look: str | None = None
        self._style: list[tuple[str, object]] = []      # style changes, in the order made
        self._camera: dict = {}
        self._labels: list[dict] | None = None
        self._colors: dict | None = None
        self._palette: str | None = None
        self._style_file: dict | None = None
        self._frame = 0

    # ------------------------------------------------------------------ the look
    def look(self, name: str) -> "Figure":
        """Start from a named look (see ``molsketch.looks()``): watercolour, ink-colour, ink, dark-paper, chalkboard,
        engraved, engraved-colour, assembly-surface, assembly-cartoon. Changes made with other methods stay on top."""
        if name not in looks(): raise ValueError(f"unknown look {name!r}; the looks are {', '.join(looks())}")
        self._look = name; return self

    def apply_style(self, style: "str | os.PathLike | dict") -> "Figure":
        """Use a whole style saved from the app (Export › Save style): a path to its JSON, or the dict. It replaces the
        look's settings (keeping what to draw, if the style does not say); ``set`` and the other changes stay on top."""
        self._style_file = json.loads(pathlib.Path(style).read_text()) if not isinstance(style, dict) else dict(style)
        return self

    def set(self, **style) -> "Figure":
        """Change any style field, nested or dotted::

            fig.set(line={"width": 2}, palette={"helix": "#de9151"}, fill="ink colour")
            fig.set(**{"hatch.spacing": 4})

        The fields are those the app's Save style writes (``molsketch.default_style()`` lists them all)."""
        for k, v in style.items(): self._style.extend(_flatten(k, v))
        return self

    def show(self, sticks: str | None | bool = ..., cartoon: str | None | bool = ..., surface: str | None | bool = ...) -> "Figure":
        """What to draw, as selections: ``fig.show(sticks="hetatm and not water", cartoon="polymer", surface=None)``.
        None or False draws nothing; True means everything (``all``) for sticks and the polymer for the others.
        Selections: all, polymer, hetatm, protein, nucleic, water, resi 10-20, resn SER+HIS, chain A, name CA, … with
        and / or / not and parentheses."""
        for rep, v, everything in (("sticks", sticks, "all"), ("cartoon", cartoon, "polymer"), ("surface", surface, "polymer")):
            if v is ...: continue
            self._style.append((f"reps.{rep}", everything if v is True else "" if v in (None, False) else str(v)))
        return self

    def palette(self, name: str) -> "Figure":
        """A group palette (see ``molsketch.palettes()``): the colours residues, chains and molecules take in order,
        and with engraved ribbons, helix, sheet and coil too, as the app's palette tiles do."""
        if name not in palettes(): raise ValueError(f"unknown palette {name!r}; see molsketch.palettes()")
        self._palette = name; return self

    def color(self, group: str, colour: str | None) -> "Figure":
        """One group's colour: a residue (``"SER195"``), a chain (``"A"``), ``"subunit:L"`` or ``"entity:1"``.
        None gives it back to the palette."""
        colors = dict(self._colors or self._info().get("groupColors") or {})
        if colour is None: colors.pop(group, None)
        else: colors[group] = colour
        self._colors = colors; return self

    # ------------------------------------------------------------------ the camera
    def view(self, yaw: float | None = None, pitch: float | None = None, roll: float | None = None, zoom: float | None = None,
             pan: tuple[float, float] | None = None, fov: float | None = None) -> "Figure":
        """Turn and frame the molecule: yaw and pitch (degrees, about the vertical and horizontal), roll (about the view
        axis), zoom (1 fits what is drawn), pan (fractions of the canvas), fov (degrees; 0 is orthographic)."""
        for k, v in (("yaw", yaw), ("pitch", pitch), ("roll", roll), ("zoom", zoom), ("fov", fov)):
            if v is not None: self._camera[k] = float(v)
        if pan is not None: self._camera["panX"], self._camera["panY"] = float(pan[0]), float(pan[1])
        return self

    # ------------------------------------------------------------------ the active site
    def site(self, selection: str | None = None, *, ligand: bool = False, within: float = 5.0, cutaway: bool | None = None,
             quiet: float | None = None, scale: float | None = None) -> "Figure":
        """The active site, shown in its protein: bold sticks over a paper halo, and with engraved ribbons, the ribbons
        in front of it opened (cutaway) and the rest quieted.

            fig.site("resi 57+102+195")        # these residues
            fig.site(ligand=True)              # the residues within 5 Å of the largest ligand, and the ligand
            fig.site(None)                     # no site
        """
        if ligand:
            r = engine().call("pocket", self._spec(), within)
            if not r["sel"]: raise ValueError(r["msg"])
            selection = r["sel"]
        self._style.append(("site.sel", selection or ""))
        for k, v in (("cutaway", cutaway), ("quiet", quiet), ("scale", scale)):
            if v is not None: self._style.append((f"site.{k}", v))
        return self

    def frame_site(self, size: Size = DEFAULT_SIZE) -> "Figure":
        """Turn the molecule so the site faces you with as little of the protein in front of it as possible, and
        close in on it (the app's Frame the site). ``size`` is the canvas it frames for."""
        r = engine().call("frameTheSite", self._spec(size=size))
        if not r["ok"]: raise ValueError(r["msg"])
        self._camera.update({k: r["camera"][k] for k in ("yaw", "pitch", "roll", "zoom", "panX", "panY")}); return self

    def label_site(self, size: Size = DEFAULT_SIZE) -> "Figure":
        """A label on each residue of the site, at its side chain's tip (the app's Label the site)."""
        r = engine().call("labelTheSite", self._spec(size=size))
        if not r["labels"] and "no atoms" in r["msg"]: raise ValueError(r["msg"])
        self._labels = r["labels"]; return self

    # ------------------------------------------------------------------ labels
    def label(self, text: str, at: str | None = None, *, offset: tuple[float, float] | None = None, xy: tuple[float, float] | None = None,
              size: float = 1.0) -> "Figure":
        """Place a label. ``at`` pins it to an atom so it follows the molecule: a residue (``"Tyr32"``: its Cα), a
        residue and atom (``"Tyr32:OH"``) or an atom id (``"TYR32.A:CA"``). ``offset`` moves the text off the atom (px,
        a leader line joins them once it is far enough). Without ``at``, ``xy`` places it on the canvas (fractions).
        ``size`` scales the label size."""
        labels = list(self._labels if self._labels is not None else self._info().get("labels") or [])
        if at is not None:
            atom = engine().call("atomId", self._spec(), at)
            dx, dy = offset if offset is not None else (0, -23)
            labels.append({"text": text, "at": atom, "dx": dx, "dy": dy, **({"size": size} if size != 1 else {})})
        else:
            x, y = xy if xy is not None else (0.5, 0.08)
            labels.append({"text": text, "x": x, "y": y, "dx": 0, "dy": 0, **({"size": size} if size != 1 else {})})
        self._labels = labels; return self

    def clear_labels(self) -> "Figure":
        """Remove every placed label."""
        self._labels = []; return self

    def labels(self, show: bool = True, *, placed: bool | None = None, atoms: bool | None = None, residues: bool | None = None,
               secondary: bool | None = None) -> "Figure":
        """Which labels show: ``fig.labels(False)`` hides every label; the keywords switch one kind (``placed``: yours,
        ``atoms``: a scene's atom labels, ``residues``: residue labels, ``secondary``: α/β on engraved ribbons)."""
        self._style.append(("show.noLabels", not show))
        for path, v in (("show.figLabels", placed), ("show.labels", atoms), ("show.resLabels", residues), ("engrave.labels", secondary)):
            if v is not None: self._style.append((path, bool(v)))
        return self

    # ------------------------------------------------------------------ scenes
    def frame(self, n: int) -> "Figure":
        """For a scene, the timeline frame to draw (24 per second); for a structure, which re-jitter of the lines."""
        self._frame = int(n); return self

    def frames(self, which: str | int = "drawn") -> list[int]:
        """A scene's frames: ``"drawn"`` (one per new drawing, every other frame), ``"all"``, ``"keyframes"`` (the start of
        each hold), a number, or a range ``"10-40"``."""
        return engine().call("frames", self._spec(), which)

    # ------------------------------------------------------------------ output
    def render(self, size: Size = DEFAULT_SIZE, *, scale: float = 1, frame: int | None = None) -> Image:
        """Draw the figure: an Image of ``size`` × ``scale`` pixels (``scale`` 2 is a retina / print density)."""
        return Image(engine().render(self._spec(size=size, scale=scale, frame=frame)))

    def save(self, path: str | os.PathLike, size: Size = DEFAULT_SIZE, *, scale: float = 1, frame: int | None = None) -> pathlib.Path:
        """Save the figure: ``.png`` / ``.jpg`` / ``.webp`` draw it, ``.json`` writes the scene (the app opens it)."""
        path = pathlib.Path(path)
        if path.suffix.lower() == ".json":
            path.write_text(json.dumps(self.scene(), indent=1)); return path
        return self.render(size, scale=scale, frame=frame).save(path)

    def save_frames(self, directory: str | os.PathLike, frames: str | int | Iterable[int] = "drawn", size: Size = DEFAULT_SIZE, *,
                    scale: float = 1) -> list[pathlib.Path]:
        """Save a scene's frames as ``frame_0000.png`` … (as the CLI names them)."""
        d = pathlib.Path(directory); d.mkdir(parents=True, exist_ok=True)
        todo = self.frames(frames) if isinstance(frames, (str, int)) else list(frames)
        return [self.render(size, scale=scale, frame=f).save(d / f"frame_{f:04d}.png") for f in todo]

    def animate(self, path: str | os.PathLike, frames: str | int | Iterable[int] = "drawn", size: Size = DEFAULT_SIZE, *,
                fps: float = 12, scale: float = 1, crf: int = 18) -> pathlib.Path:
        """A scene's loop as a video (``.mp4``, ``.webm`` or ``.gif``), through ffmpeg. 12 fps is one per drawing."""
        return _encode(pathlib.Path(path), lambda d: self.save_frames(d, frames, size, scale=scale), fps, crf)

    def turntable(self, path: str | os.PathLike, n: int = 72, size: Size = DEFAULT_SIZE, *, swing: float = 0, fps: float = 24,
                  scale: float = 1, crf: int = 18) -> pathlib.Path:
        """One full turn about the vertical in ``n`` frames, as a video or (if ``path`` is a directory) PNG frames;
        ``swing`` nods the pitch by that many degrees."""
        import math
        yaw0 = self._camera.get("yaw", self._info()["camera"]["yaw"]); pitch0 = self._camera.get("pitch", self._info()["camera"]["pitch"])
        def frames_to(d):
            out = []; saved = dict(self._camera)
            try:
                for f in range(n):
                    self._camera.update(yaw=yaw0 + 360 * f / n, pitch=pitch0 + swing * math.sin(2 * math.pi * f / n))
                    out.append(self.render(size, scale=scale, frame=f).save(pathlib.Path(d) / f"frame_{f:04d}.png"))
            finally: self._camera = saved
            return out
        p = pathlib.Path(path)
        if not p.suffix: p.mkdir(parents=True, exist_ok=True); frames_to(p); return p
        return _encode(p, frames_to, fps, crf)

    def scene(self) -> dict:
        """The figure as a scene document (what the app's Save scene JSON writes, labels, site and look included)."""
        return engine().call("sceneJson", self._spec())

    # ------------------------------------------------------------------ inspection
    @property
    def style(self) -> dict:
        """The style as it will be drawn, after the look and every change."""
        return self._info()["style"]

    @property
    def camera(self) -> dict:
        c = self._info()["camera"]; return {k: c[k] for k in ("yaw", "pitch", "roll", "zoom", "panX", "panY", "fov")}

    def copy(self) -> "Figure":
        """An independent copy (the structure itself is shared, not re-read)."""
        f = copy.copy(self); f._style = list(self._style); f._camera = dict(self._camera)
        f._labels = copy.deepcopy(self._labels); f._colors = dict(self._colors) if self._colors else None; return f

    def __repr__(self):
        i = self._info(); what = i.get("structure") or i.get("scene") or {}
        if "atoms" in what: body = f"{what['atoms']:,} atoms, {what['residues']:,} residues"
        else: body = f"{len(what.get('keyframes', []))} keyframe{'s' if len(what.get('keyframes', [])) != 1 else ''}, {what.get('frames', 0) / 24:.1f} s"
        return f"<molsketch.Figure {self.name!r}: {body}, look {i['look'] or 'default'}>"

    def _repr_png_(self):   # Jupyter shows a figure by drawing it
        return self.render((960, 720), scale=2).png()

    # ------------------------------------------------------------------ the spec
    def _spec(self, size: Size = DEFAULT_SIZE, scale: float = 1, frame: int | None = None) -> dict:
        spec: dict = {"input": {"ref": self._ref}, "size": [int(size[0]), int(size[1])], "scale": scale, "frame": self._frame if frame is None else int(frame)}
        if self._look: spec["look"] = self._look
        if self._style_file is not None: spec["styleFile"] = self._style_file
        if self._style: spec["style"] = _unflatten(self._style)
        if self._palette: spec["palette"] = self._palette
        if self._camera: spec["camera"] = self._camera
        if self._labels is not None: spec["labels"] = self._labels
        if self._colors is not None: spec["groupColors"] = self._colors
        return spec

    def _info(self) -> dict:
        return engine().call("info", self._spec())


def _flatten(key, value):
    if isinstance(value, dict): return [p for k, v in value.items() for p in _flatten(f"{key}.{k}", v)]
    return [(key, value)]


def _unflatten(pairs) -> dict:
    """ordered dotted pairs → the core's style changes (dotted keys, applied in order; later ones win)"""
    out: dict = {}
    for k, v in pairs: out.pop(k, None); out[k] = v
    return out


def _encode(path: pathlib.Path, write_frames, fps: float, crf: int) -> pathlib.Path:
    ff = shutil.which("ffmpeg")
    if not ff: raise RuntimeError("videos need ffmpeg on the PATH (brew install ffmpeg); save_frames() writes the PNGs without it")
    with tempfile.TemporaryDirectory() as d:
        write_frames(d)
        src = ["-framerate", str(fps), "-pattern_type", "glob", "-i", f"{d}/frame_*.png"]
        ext = path.suffix.lower()
        codec = {".mp4": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf), "-movflags", "+faststart"],
                 ".webm": ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(crf + 12), "-pix_fmt", "yuv420p"],
                 ".gif": ["-vf", "split[a][b];[a]palettegen[p];[b][p]paletteuse"]}.get(ext)
        if codec is None: raise ValueError(f"videos are .mp4, .webm or .gif, not {ext}")
        subprocess.run([ff, "-y", "-loglevel", "error", *src, *codec, str(path)], check=True)
    return path


_catalog = None


def _cat():
    global _catalog
    if _catalog is None: _catalog = engine().call("catalog")
    return _catalog


def looks() -> dict[str, str]:
    """The looks, name → what it is."""
    return {k: f"{v['name']}: {v['note']}" for k, v in _cat()["looks"].items()}


def palettes() -> dict[str, list[str]]:
    """The group palettes, name → colours."""
    return {k: v["colors"] for k, v in _cat()["palettes"].items()}


def default_style() -> dict:
    """Every style field with its default: what ``Figure.set`` can change."""
    return copy.deepcopy(_cat()["defaultStyle"])
