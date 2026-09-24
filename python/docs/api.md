# molsketch API reference

This page lists everything the `molsketch` package offers, with every argument. For a first look, start with the
[README](../README.md); for what each style field does, see [style.md](style.md). Runnable examples are in
[`examples/`](../examples).

```python
import molsketch as ms
```

Contents: [Making a figure](#making-a-figure) · [The Figure](#the-figure) · [Images](#images) ·
[Lists and defaults](#lists-and-defaults) · [Selections](#selections) · [Errors](#errors) ·
[The command line](#the-command-line) · [The HTTP server](#the-http-server) · [Environment variables](#environment-variables)

---

## Making a figure

Each of these returns a [`Figure`](#the-figure). Loading does not draw anything yet.

### `ms.load(source, *, name=None, format=None)`

Make a figure from a structure or a scene. `source` can be:

| `source` | what you get |
|---|---|
| a path to a `.pdb`, `.ent` or `.cif` file | a figure of that structure |
| a path to a `.json` scene saved from the app | the scene: its keyframes, arrows, labels and look |
| a list of paths | a *stack*: one keyframe per file, animated between them in list order |
| the text of a PDB or mmCIF file | a figure of that structure; pass `format="pdb"` or `"cif"` if it can't be told from the text |
| a scene as a `dict` | the scene |
| a Biopython `Structure`, a gemmi `Structure`, or an MDAnalysis `Universe` / `AtomGroup` | a figure of that structure |

`name` names the figure; by default it is the file name without its extension.

```python
fig = ms.load("protein.cif")
fig = ms.load(["step_1.pdb", "step_2.pdb", "step_3.pdb"])   # an animation through three structures
fig = ms.load(open("model.pdb").read(), name="model")

import gemmi
fig = ms.load(gemmi.read_structure("protein.cif"))
```

### `ms.fetch(pdb_id, *, map=False, **kw)`

Make a figure of an entry in the Protein Data Bank, such as `"2PTN"`. The file is downloaded from RCSB as mmCIF the
first time and read from the cache after that (`~/.cache/molsketch`, or the folder named by `MOLSKETCH_CACHE`).
With `map=True`, the cryo-EM map the entry was built into is fetched from EMDB and drawn with it (the same as
`.map("auto")`). Other keywords are passed on to `load`. Raises `ValueError` if the ID is not a valid PDB ID or the
entry does not exist.

### `ms.fetch_map(emdb_id, *, max_voxels=320)`

Make a figure of an EMDB entry's map on its own, such as `"EMD-11638"`. The map is downloaded once (kept in
`~/.cache/molsketch/emdb`) with the depositors' recommended contour level and the sample's mass. Maps larger than
`max_voxels` a side are averaged down. How maps are drawn, and why, is in [docs/maps.md](../../docs/maps.md).

### `ms.load_map(source, *, name=None, level=None, max_voxels=320)`

Make a figure of a map on its own: a path to an MRC / CCP4 file (`.mrc`, `.map`, `.ccp4`, or any of them `.gz`), or
a `DensityMap`. `level` is the contour level to start from.

### `ms.read_map(path, *, name=None, level=None, max_voxels=320)`

Read a map file into a `DensityMap` without making a figure: `.data` (a float32 array, z, y, x), `.origin` and
`.step` (Å), `.level` (the recommended level, if known), `.binned` (how much it was averaged down), `.shape`
(nx, ny, nz). Any axis order in the file is read into the model's frame. Pass it to `fig.map` or `ms.load_map`.

### `ms.scene(path_or_dict)`

Make a figure from a scene: a path to a scene `.json` or the scene as a dict. The same as `load` for those inputs;
use whichever reads better. The scene format is described in [docs/scene-format.md](../../docs/scene-format.md).

---

## The Figure

A `Figure` holds one molecule (or scene) and every choice about how to draw it. Methods that change the figure
return the figure itself, so calls can be chained:

```python
fig = ms.fetch("5P21").look("engraved-colour").view(yaw=60, pitch=20).site(ligand=True)
```

Changes are kept in the order you make them, and a later change to the same setting replaces an earlier one. Nothing
is drawn until you call `render`, `save`, `save_frames`, `animate` or `turntable`, or show the figure in a notebook.

`fig.name` is the figure's name. `repr(fig)` summarises it, for example
`<molsketch.Figure '5P21': 1,567 atoms, 379 residues, look engraved-colour>`.

### Style

#### `fig.look(name)`

Start from a named look: a complete style covering the fill, the pen, the colours, the paper and what to draw.

| look | what it is |
|---|---|
| `watercolour` | translucent colour layers on cream paper (the default style) |
| `ink-colour` | pen and ink with coloured hatching, on white paper |
| `ink` | black ink only |
| `dark-paper` | pastel chalk on navy paper, pale ink, no wash |
| `chalkboard` | chalk on navy: broad dusty fills, soft pitted lines |
| `engraved` | line-shaded ribbons in black on white, after MOLSCRIPT |
| `engraved-colour` | the engraved ribbons with colour only in the lines |
| `assembly-surface` | a watercolour surface coloured by subunit, for large assemblies |
| `assembly-cartoon` | thin tubes and ribbons coloured by subunit, with heavy depth fog, for large assemblies |

Your other changes apply on top of the look whenever you make them, so `fig.set(...).look("ink")` and
`fig.look("ink").set(...)` give the same result. `ms.looks()` lists the looks with their descriptions.

#### `fig.set(**fields)`

Change individual style fields. Give nested fields either as dicts or as dotted names:

```python
fig.set(fill="ink colour", line={"width": 2}, palette={"helix": "#de9151"})
fig.set(**{"hatch.spacing": 4, "view.fog": 0.7})
```

A dict changes only the fields it names; the others keep their values. Field names are snake_case
(`surface_depth`, `view.fog_start`); the app's camelCase names (`surfaceDepth`) are accepted too, so names copied from
a style file work. Every field is described in [style.md](style.md); `ms.default_style()` returns them all with their
defaults.

#### `fig.apply_style(style)`

Use a complete style saved from the app (Export › Save style). `style` is a path to the JSON file or the style as a
dict. It replaces the look's settings. If the style does not say what to draw, the figure keeps what it had. Changes
made with `set`, `show` and the other methods still apply on top.

#### `fig.show(sticks=…, cartoon=…, surface=…)`

Choose which atoms are drawn in each of the three representations. Each argument is a [selection](#selections):

```python
fig.show(sticks="hetatm and not water", cartoon="polymer", surface=None)
fig.show(surface="chain A")          # the other two stay as they were
```

- A selection string draws those atoms.
- `None` or `False` turns the representation off.
- `True` means all atoms for `sticks`, and the polymer for `cartoon` and `surface`.
- An argument you leave out keeps its current value.

#### `fig.palette(name)`

Use a group palette: the list of colours that residues, chains or molecules take, in order of appearance. With
engraved ribbons, the palette also colours helices, sheets and coils. `ms.palettes()` lists the palettes (29 of
them, including `"Coastal Harvest"`, `"Okabe–Ito"` and `"Tol bright"`).

#### `fig.color(group, colour)`

Give one group a colour of your own, overriding the palette.

| `group` | means |
|---|---|
| `"SER195"` | residue SER 195 (residue name and number, as in the file) |
| `"A"` | chain A |
| `"subunit:L"`, `"subunit:S"`, `"subunit:T"` | a ribosome's large subunit, small subunit, or tRNA/mRNA |
| `"entity:1"` | mmCIF entity 1 |

`colour` is any CSS colour: `"#e6a45a"`, `"rgb(230, 164, 90)"`, `"white"` and so on. `None` removes your colour.

### Camera

#### `fig.view(yaw=None, pitch=None, roll=None, zoom=None, pan=None, fov=None)`

Turn and frame the molecule. Only the values you give change.

| argument | meaning |
|---|---|
| `yaw` | turn about the vertical axis, in degrees |
| `pitch` | turn about the horizontal axis, in degrees |
| `roll` | spin in the picture plane, in degrees |
| `zoom` | 1 fits everything that is drawn; 2 is twice as close |
| `pan` | `(x, y)`: shift the picture by these fractions of the canvas width and height |
| `fov` | field of view in degrees (20 by default); 0 gives a flat, orthographic projection |

The molecule starts turned so its widest spread faces you.

#### `fig.fit(box, size=(1920, 1440), *, what="all")`

Zoom and pan so the drawing fills a box of the canvas, keeping the turn (the app's *Fit to frame*). `box` is
`(left, top, right, bottom)` as fractions of the canvas, x to the right and y down: `fig.fit((0.57, 0.13, 0.92, 0.58))`
puts the drawing in the upper right, beside a headline. For a scene, `what="all"` (the default) fits every keyframe,
so nothing leaves the box as it animates; `"frame"` fits only this frame. Pass the `size` you will save at. Saving the
figure as `.json` afterwards stores the fitted camera in the scene.

### Density maps

How maps are drawn, and why, is in [docs/maps.md](../../docs/maps.md).

#### `fig.map(source="auto", *, level=None, sigma=None, local_resolution=None, max_voxels=320, **style)`

Draw a cryo-EM density map with the figure. `source` is `"auto"` (the map this PDB entry was built into, from
EMDB; on a figure that already has a map, that map), an EMDB ID (`"EMD-11638"`), a path to a map file, a
`DensityMap`, or another figure (its map). `None` removes the map.

`level` is the contour level in the map's units, `sigma` the same in standard deviations above the mean; the
default is the depositors' recommended level. Setting one clears the other. `local_resolution="bfactor"` makes the
lines looser where the model's B-factors are high; a local-resolution map (a path, an EMDB ID or a `DensityMap`,
values in Å) does the same from the map. Any other keyword is a map field ([style.md](style.md#density-maps)):

```python
fig = ms.fetch("3J5P", map=True)
fig.map(sigma=5, opacity=0.4)
fig.map(zone="resi 93 and not hydro", carve=2).show(sticks="resi 93 and not hydro", cartoon=None)
fig.map(style="mesh", smooth=0)
```

#### `fig.map_info`

The map this figure draws, or `None`: `name`, `level` (in use), `recommended`, `mean`, `rms` (σ), `min`, `max`,
`size`, `step`, `origin`, `binned`, `mass` and `resolution` (as deposited, if known), and with a model,
`atomInclusion` (the share of its heavy atoms inside the contour).

### Active site

#### `fig.site(selection=None, *, ligand=False, within=5.0, cutaway=None, quiet=None, scale=None)`

Mark an active site so it reads clearly inside its protein. The site's atoms are drawn as bold sticks on a
paper-coloured halo. With engraved ribbons, the ribbon in front of the site is cut away and the rest of the protein
is drawn quieter.

```python
fig.site("resi 57+102+195")          # these residues
fig.site(ligand=True)                # the largest ligand and every residue within 5 Å of it
fig.site(ligand=True, within=8)      # a wider pocket
fig.site(None)                       # no site
```

| argument | meaning |
|---|---|
| `selection` | the site's atoms, as a [selection](#selections) |
| `ligand` | pick the site automatically: the largest ligand and the residues around it (raises `ValueError` if the structure has no ligand) |
| `within` | with `ligand=True`, how far from the ligand a residue can be, in Å |
| `cutaway` | open the ribbon in front of the site (on by default) |
| `quiet` | how much the rest of the protein fades, 0 to 1 (0.35 by default) |
| `scale` | how much thicker the site's sticks are than normal sticks (1.9 by default) |

#### `fig.frame_site(size=(1920, 1440))`

Turn the molecule so the site faces you with as little protein in front of it as possible, and zoom in on it. This
is the app's *Frame the site* button. Call `site` first. Pass the same `size` you will save at, because the framing
depends on the shape of the canvas.

#### `fig.label_site(size=(1920, 1440))`

Put a label on each residue of the site, next to the tip of its side chain. This is the app's *Label the site*
button. Call `site` first. Labels you placed before are kept. Pass the same `size` you will save at.

### Labels

#### `fig.label(text, at=None, *, offset=None, xy=None, size=1.0)`

Add a label.

- **Pinned to an atom** (`at`): the label moves with the molecule when you turn it. `at` can be a residue
  (`"Tyr32"`, meaning its Cα atom), a residue and an atom (`"Tyr32:OH"`), or a full atom id (`"TYR32.A:CA"`:
  residue, chain and atom). `offset=(dx, dy)` moves the text away from the atom, in pixels (23 px up by default).
  Once the text is far enough away, a thin leader line joins it to the atom.
- **On the canvas** (`xy`): without `at`, the label sits at `xy=(x, y)`, given as fractions of the width and height.
  By default it is centred near the top.

`size` scales the text; 1 is the style's label size (the `label_size` field).

```python
fig.label("Switch I", at="Tyr32", offset=(110, -60))
fig.label("Ras · GppNHp", xy=(0.5, 0.06), size=1.4)
```

#### `fig.clear_labels()`

Remove every label placed with `label` or `label_site`. Atom labels stored in a scene are not affected.

#### `fig.labels(show=True, *, placed=None, atoms=None, residues=None, secondary=None)`

Choose which labels are drawn. The labels themselves are kept either way.

```python
fig.labels(False)                 # hide every label
fig.labels()                      # show them again
fig.labels(secondary=True)        # α1, β1 … on engraved ribbons
fig.labels(residues=True)         # a label on every residue
```

| keyword | the labels it switches |
|---|---|
| `placed` | the labels you placed with `label` and `label_site` (on by default) |
| `atoms` | atom labels stored in a scene (on by default) |
| `residues` | a label on every residue (off by default) |
| `secondary` | α1, β1 … on engraved ribbons (off by default) |

### Scenes and frames

#### `fig.frame(n)`

Choose the frame to draw. For a scene, `n` is a point on its timeline at 24 frames per second. For a single
structure, `n` picks a different version of the hand-drawn wobble, so the lines come out slightly differently: try
a few and keep the one you like.

#### `fig.frames(which="drawn")`

List a scene's frame numbers.

| `which` | frames |
|---|---|
| `"drawn"` | every frame that shows a new drawing (scenes animate on twos, so every other frame) |
| `"all"` | every frame |
| `"keyframes"` | the first frame of each keyframe's hold |
| a number, such as `90` | that one frame |
| a range, such as `"10-40"` | those frames, both ends included |

### Output

All output methods take `size=(width, height)` in pixels (1920 × 1440 by default) and `scale`. `scale` multiplies the
pixel count while keeping the layout the same: `scale=2` gives the same picture with twice the detail, for print or
high-density screens.

#### `fig.render(size=(1920, 1440), *, scale=1, frame=None)`

Draw the figure and return an [`Image`](#images). `frame` draws another frame without changing the figure's own.

#### `fig.save(path, size=(1920, 1440), *, scale=1, frame=None)`

Draw the figure and save it; returns the path. The extension decides what is written:

- `.png`, `.jpg`, `.webp`: an image.
- `.svg`: a vector drawing (see [`svg`](#figsvgsize1920-1440--scale1-framenone)).
- `.json`: the figure as a scene that the app can open, with its look, labels and site.

#### `fig.svg(size=(1920, 1440), *, scale=1, frame=None)`

Draw the figure as SVG and return the document as a string. Every line, fill and letter is a vector element that
you can edit in Inkscape, Illustrator or Affinity; letters are outlines, so the file looks the same without the fonts
installed. What a style paints as texture (the paper, watercolour washes, blurs) is raster by nature, and is embedded
as PNG images at `size` × `scale` pixels, so use `scale=2` or more for print. Blend modes are written as CSS
`mix-blend-mode`, which browsers, Inkscape and Affinity honour; Illustrator flattens them. A protein is a few MB; a
144 000-atom ribosome about 30 MB.

#### `fig.save_frames(directory, frames="drawn", size=(1920, 1440), *, scale=1)`

Save frames as numbered PNG files (`frame_0000.png`, `frame_0001.png` …) in `directory`, and return their paths.
`frames` is anything [`frames()`](#figframeswhichdrawn) accepts, or a list of frame numbers.

#### `fig.animate(path, frames="drawn", size=(1920, 1440), *, fps=12, scale=1, crf=18)`

Make a video of a scene: `.mp4`, `.webm` or `.gif`. Needs `ffmpeg` on your `PATH`. The default, every drawn frame
at 12 fps, plays the scene at its real speed. `crf` sets the video quality: lower is better and larger (18 is
visually lossless for MP4).

#### `fig.turntable(path, n=72, size=(1920, 1440), *, swing=0, fps=24, scale=1, crf=18)`

Make a turntable: the molecule turns once around the vertical axis in `n` frames. `path` is a video (`.mp4`,
`.webm`, `.gif`; needs `ffmpeg`) or, with no extension, a folder that receives PNG frames. `swing` tilts the molecule
up and down by that many degrees during the turn. The figure's own camera is left as it was.

#### `fig.scene()`

The figure as a scene document (a dict): what the app's *Save scene* writes, including the look, labels and site.
`fig.save("fig.json")` writes the same thing to a file.

### Inspecting and copying

#### `fig.style`

The complete style that will be drawn, after the look and all your changes, as a nested dict. It is read-only:
change the style with `set`.

#### `fig.camera`

The camera that will be used, as a dict with `yaw`, `pitch`, `roll`, `zoom`, `pan_x`, `pan_y` and `fov`. It reflects
`view`, `frame_site` and a scene's own view. Change it with `view`.

#### `fig.copy()`

A copy you can change without changing the original, for variations of one figure. The molecule itself is shared,
so copying is instant.

```python
base = ms.fetch("5P21").view(yaw=60)
for look in ("ink", "engraved", "watercolour"):
    base.copy().look(look).save(f"ras_{look}.png")
```

### In a notebook

A figure shows itself when it is the last value in a Jupyter cell: it is drawn at 960 × 720 with `scale=2`. For
another size, show `fig.render((w, h))` instead.

---

## Images

`fig.render()` returns a `molsketch.Image`: the drawn pixels.

| member | what it gives |
|---|---|
| `img.width`, `img.height` | the size in pixels |
| `img.size` | `(width, height)` |
| `img.save(path, quality=92)` | writes `.png`, `.jpg` or `.webp` (chosen by the extension) and returns the path; `quality` (0–100) applies to JPEG and WebP; missing folders are created |
| `img.png()` | the image as PNG file bytes, for a web response or a database |
| `img.to_numpy()` | a NumPy array of shape `(height, width, 4)`, type `uint8`, RGBA, with straight (not premultiplied) alpha |
| `img.to_pil()` | a Pillow image in RGBA mode (needs `pip install pillow`) |

`numpy.asarray(img)` works too, and an `Image` shows itself in a notebook.

---

## Lists and defaults

| function | returns |
|---|---|
| `ms.looks()` | a dict from look name to a short description |
| `ms.palettes()` | a dict from palette name to its list of colours |
| `ms.default_style()` | every style field with its default value, as a nested dict (see [style.md](style.md)) |

---

## Selections

`show`, `site` and the `reps` style fields take selections, a small language in the manner of PyMOL:

| word | selects |
|---|---|
| `all`, `none` | every atom, no atom |
| `polymer` | protein and nucleic acid chains |
| `protein`, `nucleic` | amino acids; nucleotides |
| `hetatm` | ligands, ions and water (HETATM records) |
| `water` | water molecules |
| `backbone`, `sidechain` | backbone atoms (N, CA, C, O); the rest of each residue |
| `hydro` | hydrogens |
| `resi 57+102+195`, `resi 190-200` | residue numbers, as a list or a range |
| `resn SER+HIS` | residue names |
| `name CA+CB` | atom names |
| `chain A+B` | chains |
| `elem C+N` | elements |
| `ss H+E` | secondary structure: `H` helix, `E` strand |
| `subunit S+L` | ribosome subunits (`S` small, `L` large, `T` tRNA/mRNA, `X` other) |
| `entity 1+3` | mmCIF entities |
| `group SER195` | one residue by its group name |

Combine them with `and`, `or`, `not` and parentheses: `hetatm and not water`, `chain A and resi 50-120`,
`polymer and not hydro`, `(resn HIS and chain A) or resi 195`.

---

## Errors

- `ValueError`: an argument the package can check itself, such as an unknown look or palette, a bad PDB ID, or
  `site(ligand=True)` on a structure without a ligand. The message says which values are allowed.
- `molsketch.CoreError`: something the drawing engine refused, such as an atom `label(at=…)` cannot find. The
  message is the engine's own.
- A selection that matches no atoms is not an error: nothing is drawn for it. If a representation is unexpectedly
  empty, check the selection's spelling.
- `FileNotFoundError`: a path passed to `load` does not exist.
- `RuntimeError`: `animate` or `turntable` asked for a video but `ffmpeg` is not installed. `save_frames` works
  without it.

---

## The command line

Installing the package adds a `molsketch` command.

```bash
molsketch render INPUT [options] -o OUT      # draw a figure, or a scene's frames
molsketch serve [--port 8471] [--no-browser] # run the app, drawn by this package
molsketch looks                              # list the looks
molsketch palettes                           # list the group palettes
```

`INPUT` is a `.pdb`, `.cif` or scene `.json` file, or a PDB ID (downloaded like `fetch`). `-o` decides the output:
an image (`.png` `.jpg` `.webp`), a vector drawing (`.svg`), a video (`.mp4` `.webm` `.gif`), a scene (`.json`), or a
folder of frames (a path with no extension). Options for `render`:

| option | same as |
|---|---|
| `--look NAME` | `fig.look(NAME)` |
| `--style FILE` | `fig.apply_style(FILE)` |
| `--set PATH=VALUE` (repeatable) | `fig.set(**{PATH: VALUE})`, e.g. `--set line.width=2`; numbers and `true`/`false` are converted |
| `--palette NAME` | `fig.palette(NAME)` |
| `--yaw --pitch --roll --zoom --fov` | `fig.view(...)` |
| `--pan X,Y` | `fig.view(pan=(X, Y))` |
| `--fit L,T,R,B`, `--fit-what all\|frame` | `fig.fit((L, T, R, B), what=…)`; fractions or percent |
| `--site SELECTION` or `--site ligand` | `fig.site(SELECTION)` or `fig.site(ligand=True)` |
| `--frame-site`, `--label-site` | `fig.frame_site()`, `fig.label_site()` |
| `--size WxH` (default `1920x1440`), `--scale N` | the `size` and `scale` arguments |
| `--frame N` | `fig.frame(N)` |
| `--frames SPEC` | which frames, for a video or a folder (as `frames()`) |
| `--turntable N` | `fig.turntable(OUT, N)` |
| `--fps N` | the video frame rate |

```bash
molsketch render 5P21 --look engraved-colour --yaw 60 --pitch 20 --site ligand -o ras.png
molsketch render 2PTN --look engraved --site "resi 57+102+195" --frame-site --label-site -o trypsin.png
molsketch render mechanism.json --look chalkboard -o loop.mp4
molsketch render 6GZQ --look assembly-cartoon --turntable 72 -o spin.mp4
```

---

## The HTTP server

`molsketch serve` starts a local web server (port 8471 by default, or the next free one) that serves the MolSketch
app and opens it in your browser. The app then draws its finished figures and exports through this package, so they
match your Python output exactly. The server also offers a small JSON API, which the app uses and your own tools can
use too:

| request | body | response |
|---|---|---|
| `GET /api/health` | | `{"molsketch": "0.1.0"}` |
| `POST /api/put` | `{"input": {"text": …, "name": "x.cif"}}` (or `{"scene": …}`, `{"stack": [...]}`) | `{"ref": "in3"}`: keeps the structure on the server |
| `POST /api/drop` | `{"ref": "in3"}` | `{}`: forgets it |
| `POST /api/putmap` | a map file's bytes (gzipped or not), with `?name=&level=&mass=&resolution=`; or `{"emdb": "EMD-11638"}` | `{"ref": "map2", …}` and the map's header: keeps the map on the server |
| `POST /api/render` | a figure spec (below) | the image, `image/png`; with `"format": "svg"` in the spec, the SVG (`image/svg+xml`) |
| `POST /api/call` | `{"name": …, "args": [...]}` | JSON: `info`, `frames`, `pocket`, `frameTheSite`, `labelTheSite`, `atomId`, `sceneJson`, `catalog` |

A figure spec is a JSON object, in the engine's own camelCase names (the app sends these): `input` (`{"ref": …}` or an inline input as for `/api/put`), and optionally `look`,
`style` (dotted field names to values, as `set`), `styleFile` (a whole style, as `apply_style`), `palette`,
`camera` (`yaw`, `pitch`, `roll`, `zoom`, `panX`, `panY`, `fov`), `labels`, `groupColors` (as `color`), `size`
(`[w, h]`), `scale`, `frame`, and `map` (`{"ref": …}` from `/api/putmap`). A map on its own is the input
`{"map": ref}`.

```bash
curl -s localhost:8471/api/render -H 'Content-Type: application/json' \
     -d '{"input": {"ref": "in1"}, "look": "engraved", "size": [800, 600]}' > fig.png
```

The server draws one figure at a time. It listens on 127.0.0.1 only, unless you pass `--host`.

---

## Environment variables

| variable | effect |
|---|---|
| `MOLSKETCH_CACHE` | where `fetch` keeps downloaded files (default `~/.cache/molsketch`) |
| `MOLSKETCH_V8_SINGLE_THREADED=1` | run the embedded JavaScript engine on one thread. Set it if your program forks processes after drawing (for example `multiprocessing` with the `fork` start method); it makes large figures slower |
