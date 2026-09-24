"""The Figure: one molecular figure, built up by chained calls and drawn by the same engine as the app."""
from __future__ import annotations

import copy
import json
import os
import pathlib
import re
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
    """One molecular figure: a structure, a stack of structures, or a keyframed scene, plus how to draw it.

    Make one with ``molsketch.load``, ``molsketch.fetch`` or ``molsketch.scene``. Every method that changes the figure
    returns the figure, so calls chain::

        ms.fetch("5P21").look("engraved-colour").view(yaw=60, pitch=20).save("ras.png")

    Nothing is drawn until you call ``render``, ``save`` or one of the video methods, or show the figure in a notebook.
    Changes are recorded in order, and a later change to the same setting wins.
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
        """Start from a named look: a complete style (fill, lines, colours, paper, what to draw). The looks are
        watercolour, ink-colour, ink, dark-paper, chalkboard, engraved, engraved-colour, assembly-surface and
        assembly-cartoon; ``molsketch.looks()`` describes each. Your other changes (``set``, ``show``, ``palette`` …)
        apply on top, whenever you make them."""
        if name not in looks(): raise ValueError(f"unknown look {name!r}; the looks are {', '.join(looks())}")
        self._look = name; return self

    def apply_style(self, style: "str | os.PathLike | dict") -> "Figure":
        """Use a complete style saved from the app (Export › Save style), given as a path to the JSON file or as a dict
        (with the app's camelCase names or snake_case ones).
        It replaces the look's settings. If the style does not say what to draw, the figure keeps what it had. Your
        ``set``, ``show`` and other changes still apply on top."""
        self._style_file = _to_engine(json.loads(pathlib.Path(style).read_text()) if not isinstance(style, dict) else style)
        return self

    def set(self, **style) -> "Figure":
        """Change style fields. Give nested fields as dicts or as dotted names::

            fig.set(fill="ink colour", line={"width": 2}, palette={"helix": "#de9151"})
            fig.set(surface_depth={"pooling": 0.5}, **{"hatch.spacing": 4, "view.fog_start": 0.3})

        A dict changes only the fields it names; the rest keep their values. Names are snake_case, as
        ``molsketch.default_style()`` lists them (the app's camelCase names work too). docs/style.md explains every
        field."""
        for k, v in style.items(): self._style.extend((_engine_path(p), x) for p, x in _flatten(k, v))
        return self

    def show(self, sticks: str | None | bool = ..., cartoon: str | None | bool = ..., surface: str | None | bool = ...) -> "Figure":
        """Choose which atoms are drawn as sticks, as cartoon and as surface, each with a selection::

            fig.show(sticks="hetatm and not water", cartoon="polymer", surface=None)

        ``None`` or ``False`` turns that representation off. ``True`` means all atoms for sticks and the polymer for
        cartoon and surface. Leave an argument out to keep what it was. Selections are words like ``all``,
        ``polymer``, ``protein``, ``nucleic``, ``hetatm``, ``water``, ``resi 10-20``, ``resn SER+HIS``, ``chain A`` and
        ``name CA``, combined with ``and``, ``or``, ``not`` and parentheses (the full list is in docs/api.md)."""
        for rep, v, everything in (("sticks", sticks, "all"), ("cartoon", cartoon, "polymer"), ("surface", surface, "polymer")):
            if v is ...: continue
            self._style.append((f"reps.{rep}", everything if v is True else "" if v in (None, False) else str(v)))
        return self

    def palette(self, name: str) -> "Figure":
        """Use a group palette: the list of colours that residues, chains or molecules take, in order of appearance.
        With engraved ribbons it also colours helix, sheet and coil. ``molsketch.palettes()`` lists the palettes."""
        if name not in palettes(): raise ValueError(f"unknown palette {name!r}; see molsketch.palettes()")
        self._palette = name; return self

    def color(self, group: str, colour: str | None) -> "Figure":
        """Give one group a colour of your own. The group is a residue (``"SER195"``), a chain (``"A"``), a ribosome
        subunit (``"subunit:L"``, ``"subunit:S"``, ``"subunit:T"``) or an mmCIF entity (``"entity:1"``). The colour is
        any CSS colour (``"#e6a45a"``, ``"rgb(230, 164, 90)"``). ``None`` removes your colour again."""
        colors = dict(self._colors or self._info().get("groupColors") or {})
        if colour is None: colors.pop(group, None)
        else: colors[group] = colour
        self._colors = colors; return self

    # ------------------------------------------------------------------ the camera
    def view(self, yaw: float | None = None, pitch: float | None = None, roll: float | None = None, zoom: float | None = None,
             pan: tuple[float, float] | None = None, fov: float | None = None) -> "Figure":
        """Turn and frame the molecule. Only the values you give change.

        ``yaw`` turns it about the vertical axis and ``pitch`` about the horizontal one, ``roll`` spins it in the
        picture plane (all in degrees). ``zoom`` 1 fits what is drawn; 2 is twice as close. ``pan`` shifts the picture
        by ``(x, y)`` as fractions of the canvas. ``fov`` is the field of view in degrees; 0 gives a flat
        (orthographic) projection."""
        for k, v in (("yaw", yaw), ("pitch", pitch), ("roll", roll), ("zoom", zoom), ("fov", fov)):
            if v is not None: self._camera[k] = float(v)
        if pan is not None: self._camera["panX"], self._camera["panY"] = float(pan[0]), float(pan[1])
        return self

    # ------------------------------------------------------------------ the active site
    def site(self, selection: str | None = None, *, ligand: bool = False, within: float = 5.0, cutaway: bool | None = None,
             quiet: float | None = None, scale: float | None = None) -> "Figure":
        """Mark an active site, so it reads clearly inside its protein. The site's atoms are drawn as bold sticks on a
        paper-coloured halo. With engraved ribbons, the ribbon in front of the site is cut away and the rest of the
        protein is drawn quieter::

            fig.site("resi 57+102+195")        # these residues
            fig.site(ligand=True)              # the largest ligand and every residue within 5 Å of it
            fig.site(ligand=True, within=8)    # a wider pocket
            fig.site(None)                     # no site

        ``cutaway`` (default on) opens the ribbon in front of the site. ``quiet`` (0–1, default 0.35) is how much the
        rest of the protein fades. ``scale`` (default 1.9) is how much thicker the site's sticks are. Follow with
        ``frame_site()`` to turn the site towards you and ``label_site()`` to label its residues."""
        if ligand:
            r = engine().call("pocket", self._spec(), within)
            if not r["sel"]: raise ValueError(r["msg"])
            selection = r["sel"]
        self._style.append(("site.sel", selection or ""))
        for k, v in (("cutaway", cutaway), ("quiet", quiet), ("scale", scale)):
            if v is not None: self._style.append((f"site.{k}", v))
        return self

    def frame_site(self, size: Size = DEFAULT_SIZE) -> "Figure":
        """Turn the molecule so the site faces you with as little protein in front of it as possible, and zoom in on it
        (the app's Frame the site button). Call ``site`` first. Pass the same ``size`` you will save at, since the
        framing depends on the canvas shape."""
        r = engine().call("frameTheSite", self._spec(size=size))
        if not r["ok"]: raise ValueError(r["msg"])
        self._camera.update({k: r["camera"][k] for k in ("yaw", "pitch", "roll", "zoom", "panX", "panY")}); return self

    def label_site(self, size: Size = DEFAULT_SIZE) -> "Figure":
        """Put a label on each residue of the site, next to the tip of its side chain (the app's Label the site
        button). Call ``site`` first. Labels you placed before are kept. Pass the same ``size`` you will save at, so
        the labels land where they are meant to."""
        r = engine().call("labelTheSite", self._spec(size=size))
        if not r["labels"] and "no atoms" in r["msg"]: raise ValueError(r["msg"])
        self._labels = r["labels"]; return self

    # ------------------------------------------------------------------ labels
    def label(self, text: str, at: str | None = None, *, offset: tuple[float, float] | None = None, xy: tuple[float, float] | None = None,
              size: float = 1.0) -> "Figure":
        """Add a label.

        With ``at``, the label is pinned to an atom and moves with the molecule when you turn it. ``at`` can be a
        residue (``"Tyr32"``, which means its Cα atom), a residue and an atom (``"Tyr32:OH"``), or a full atom id
        (``"TYR32.A:CA"``, residue, chain and atom). ``offset=(dx, dy)`` moves the text away from the atom, in pixels
        (default 23 px up); once the text is far enough away, a leader line joins it to the atom.

        Without ``at``, the label sits on the canvas at ``xy=(x, y)``, given as fractions of the width and height
        (default: centred, near the top). ``size`` scales the text (1 is the style's label size)."""
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
        """Remove every label placed with ``label`` or ``label_site`` (a scene's own atom labels stay)."""
        self._labels = []; return self

    def labels(self, show: bool = True, *, placed: bool | None = None, atoms: bool | None = None, residues: bool | None = None,
               secondary: bool | None = None) -> "Figure":
        """Choose which labels are drawn. ``fig.labels(False)`` hides all of them; ``fig.labels()`` shows them again.
        The keywords turn one kind on or off: ``placed`` (the labels you placed), ``atoms`` (atom labels stored in a
        scene), ``residues`` (a label on every residue) and ``secondary`` (α1, β1 … on engraved ribbons, off by
        default). The labels are kept either way; this only decides whether they are drawn."""
        self._style.append(("show.noLabels", not show))
        for path, v in (("show.figLabels", placed), ("show.labels", atoms), ("show.resLabels", residues), ("engrave.labels", secondary)):
            if v is not None: self._style.append((path, bool(v)))
        return self

    # ------------------------------------------------------------------ scenes
    def frame(self, n: int) -> "Figure":
        """Choose the frame to draw. For a scene this is a point on its timeline, at 24 frames per second. For a single
        structure it picks a different version of the hand-drawn wobble, so the lines are redrawn slightly
        differently (useful for picking the drawing you like best)."""
        self._frame = int(n); return self

    def frames(self, which: str | int = "drawn") -> list[int]:
        """List frame numbers of a scene. ``which`` is ``"drawn"`` (every frame that shows a new drawing; scenes
        animate on twos, so every other frame), ``"all"``, ``"keyframes"`` (the first frame of each keyframe's hold),
        a single frame number, or a range such as ``"10-40"`` (both ends included)."""
        return engine().call("frames", self._spec(), which)

    # ------------------------------------------------------------------ output
    def render(self, size: Size = DEFAULT_SIZE, *, scale: float = 1, frame: int | None = None) -> Image:
        """Draw the figure and return it as an ``Image``. ``size`` is ``(width, height)`` in pixels (default 1920 × 1440).
        ``scale`` multiplies the pixel count while keeping the layout: ``scale=2`` gives the same picture with twice
        the detail, for print or high-density screens. ``frame`` picks a frame without changing the figure's own."""
        return Image(engine().render(self._spec(size=size, scale=scale, frame=frame)))

    def svg(self, size: Size = DEFAULT_SIZE, *, scale: float = 1, frame: int | None = None) -> str:
        """Draw the figure as SVG and return the document. Every line, fill and letter is a vector element (letters as
        outlines, so no fonts are needed); what the style paints as texture (the paper, watercolour washes, blurs) is
        embedded as images at ``size`` × ``scale`` pixels. Blend modes use CSS ``mix-blend-mode``, which browsers,
        Inkscape and Affinity honour; Illustrator flattens them."""
        return engine().render_svg(self._spec(size=size, scale=scale, frame=frame))

    def save(self, path: str | os.PathLike, size: Size = DEFAULT_SIZE, *, scale: float = 1, frame: int | None = None) -> pathlib.Path:
        """Draw the figure and save it, returning the path. ``.png``, ``.jpg`` and ``.webp`` save an image (``size``,
        ``scale`` and ``frame`` as in ``render``); ``.svg`` saves a vector drawing (see ``svg``). ``.json`` saves the
        figure as a scene that the app can open, with its look, labels and site."""
        path = pathlib.Path(path)
        if path.suffix.lower() == ".json":
            path.write_text(json.dumps(self.scene(), indent=1)); return path
        if path.suffix.lower() == ".svg":
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(self.svg(size, scale=scale, frame=frame)); return path
        return self.render(size, scale=scale, frame=frame).save(path)

    def save_frames(self, directory: str | os.PathLike, frames: str | int | Iterable[int] = "drawn", size: Size = DEFAULT_SIZE, *,
                    scale: float = 1) -> list[pathlib.Path]:
        """Save frames as numbered PNG files (``frame_0000.png``, ``frame_0001.png`` …) in ``directory`` and return their
        paths. ``frames`` is anything ``frames()`` accepts, or a list of frame numbers."""
        d = pathlib.Path(directory); d.mkdir(parents=True, exist_ok=True)
        todo = self.frames(frames) if isinstance(frames, (str, int)) else list(frames)
        return [self.render(size, scale=scale, frame=f).save(d / f"frame_{f:04d}.png") for f in todo]

    def animate(self, path: str | os.PathLike, frames: str | int | Iterable[int] = "drawn", size: Size = DEFAULT_SIZE, *,
                fps: float = 12, scale: float = 1, crf: int = 18) -> pathlib.Path:
        """Make a video of a scene: ``.mp4``, ``.webm`` or ``.gif``. Needs ``ffmpeg`` installed. ``frames`` is as in
        ``save_frames``. The default, every drawn frame at 12 fps, plays the scene at its real speed. ``crf`` sets
        the video quality (lower is better and larger)."""
        return _encode(pathlib.Path(path), lambda d: self.save_frames(d, frames, size, scale=scale), fps, crf)

    def turntable(self, path: str | os.PathLike, n: int = 72, size: Size = DEFAULT_SIZE, *, swing: float = 0, fps: float = 24,
                  scale: float = 1, crf: int = 18) -> pathlib.Path:
        """Make a turntable: the molecule turns once around the vertical axis in ``n`` frames. ``path`` is a video
        (``.mp4``, ``.webm``, ``.gif``; needs ``ffmpeg``) or, with no extension, a folder of PNG frames. ``swing`` tilts
        the molecule up and down by that many degrees during the turn. ``fps`` is the video's frame rate."""
        import math
        yaw0 = self._camera.get("yaw", self._info()["camera"]["yaw"]); pitch0 = self._camera.get("pitch", self._info()["camera"]["pitch"])
        def _write(d):
            out = []; saved = dict(self._camera)
            try:
                for f in range(n):
                    self._camera.update(yaw=yaw0 + 360 * f / n, pitch=pitch0 + swing * math.sin(2 * math.pi * f / n))
                    out.append(self.render(size, scale=scale, frame=f).save(pathlib.Path(d) / f"frame_{f:04d}.png"))
            finally: self._camera = saved
            return out
        p = pathlib.Path(path)
        if not p.suffix: p.mkdir(parents=True, exist_ok=True); _write(p); return p
        return _encode(p, _write, fps, crf)

    def scene(self) -> dict:
        """The figure as a scene document (a dict): what the app's Save scene writes, with the look, labels and site.
        ``fig.save("fig.json")`` writes the same to a file."""
        return engine().call("sceneJson", self._spec())

    # ------------------------------------------------------------------ inspection
    @property
    def style(self) -> dict:
        """The complete style that will be drawn, after the look and all your changes (a dict with snake_case names;
        read-only, change it with ``set``)."""
        return _to_python(self._info()["style"])

    @property
    def camera(self) -> dict:
        """The camera that will be used: ``yaw``, ``pitch``, ``roll``, ``zoom``, ``pan_x``, ``pan_y`` and ``fov``, after
        ``view``, ``frame_site`` and the scene's own view (a dict; change it with ``view``)."""
        c = self._info()["camera"]; return {_snake(k): c[k] for k in ("yaw", "pitch", "roll", "zoom", "panX", "panY", "fov")}

    def copy(self) -> "Figure":
        """A copy you can change without changing this figure (for variations of one figure). The molecule itself is
        shared, so copying is instant."""
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


# Python names are snake_case (surface_depth, fog_start); the engine's, and the app's style files, are camelCase
# (surfaceDepth, fogStart). Names are converted at this boundary, both ways, and the engine's own are accepted too.
# Element symbols (palette.C, show.H) start with a capital and are left alone.
def _snake(k: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: "_" + m.group(1).lower(), k) if k[:1].islower() else k


def _camel(k: str) -> str:
    head, *rest = k.split("_")
    return head + "".join(w[:1].upper() + w[1:] for w in rest) if rest else k


def _engine_path(path: str) -> str:
    return ".".join(_camel(p) for p in path.split("."))


def _to_engine(d):
    return {_camel(k): _to_engine(v) for k, v in d.items()} if isinstance(d, dict) else d


def _to_python(d):
    return {_snake(k): _to_python(v) for k, v in d.items()} if isinstance(d, dict) else d


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
    """The looks, as a dict from name (what ``Figure.look`` takes) to a short description."""
    return {k: f"{v['name']}: {v['note']}" for k, v in _cat()["looks"].items()}


def palettes() -> dict[str, list[str]]:
    """The group palettes, as a dict from name (what ``Figure.palette`` takes) to its list of colours."""
    return {k: v["colors"] for k, v in _cat()["palettes"].items()}


def default_style() -> dict:
    """Every style field with its default value, as a nested dict with snake_case names. These are the fields
    ``Figure.set`` changes; docs/style.md explains each one."""
    return _to_python(copy.deepcopy(_cat()["defaultStyle"]))
