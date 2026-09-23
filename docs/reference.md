# Reference: the page, its renderer and the engine

The drawing engine is the canvas renderer in `triad-sketch.html`; the app (`app/`) runs the same code verbatim for its
exact frames and its CLI. This page documents the standalone page, its command-line renderer `render.js` (the route to
SVG), and the engine's inputs, settings and internals, which the app shares. For the app itself see
[app/README.md](../app/README.md).

### The page

`triad-sketch.html` needs no server; open it from disk. Fonts (Caveat, Patrick Hand, Kalam, IBM Plex) and
JSZip are fetched from Google Fonts and cdnjs, so the handwriting faces need a network connection; without
one the page still works with fallback fonts.

**Transport.** Play/pause (space), step one frame (←/→), jump between keyframes (⇧←/→), a scrubber with
keyframe markers, loop and speed.

**Panels.**

- *Representation* — the three selections (sticks, cartoon, surface), stick style, fill mode, colour schemes,
  stick radius, sphere size, cartoon width, surface probe and opacity.
- *Motion* — frames per second, "step every" (draw a new pose every N frames: 2 = animating on twos),
  "boil every" (re-randomise the line jitter every N frames), arrow lead (how far ahead of the atom motion
  the curly arrows appear).
- *Line & shading* — roughness, passes, pen pressure, line hierarchy, ink and bond width, hatch spacing,
  angle and density, light direction, shading, pencil fill, fill wobble, paper grain, watercolour wash
  (amount, pattern, life), lettering font and sizes, pocket opacity.
- *Palette* — a preset menu (PyMOL flat, Colored pencil, Ink + one colour, Blueprint, Chalkboard, Sepia
  wash) and a swatch for every colour: paper, ink, shading, arrows, charges, labels, pocket, accent, each
  element, helix/sheet/loop/nucleic, surface, wash.
- *Show / hide* — hydrogens, construction lines, valence (double bonds), lone pairs, charges, arrows,
  labels, residue labels, hydrogen bonds, pocket outline, caption, step title.
- *View* — yaw, pitch, zoom, pan, field of view (0 = orthographic, 20 = PyMOL's default), depth fog and
  where it starts.
- *Export* — canvas size and resolution; PNG of the current frame, PNG sequence (zip), WebM video, SVG of the
  current frame, SVG sequence (zip).
- *Data* — load a scene JSON, load a PDB/mmCIF stack, save the scene JSON, save/load/reset settings, frames
  per PDB, and the scene JSON format.

Settings persist in the browser between visits. *Reset settings* returns to the defaults.

### The command line

`render.js` launches Chromium through Playwright, loads the page, applies your inputs and settings, and
writes frames. Output is pixel-identical to the page.

```
node render.js input [input …] [options]

  input            scene .json, or one or more .pdb / .cif files (sorted by name → one keyframe each)
  --out DIR        output folder (default ./out)
  --format png|svg (default png)
  --scale N        raster scale 1–4 (default 2): 960×720 canvas at scale 2 gives 1920×1440
  --size WxH       canvas size in CSS px (default 960x720)
  --frames SPEC    all | drawn | keyframes | N | A-B      (default all)
                   drawn = one frame per new drawing (respects "step every"), no duplicates
                   keyframes = the first frame of each keyframe's hold
  --settings F     a settings JSON saved from the page (Data › Save settings)
  --set path=val   override one setting; repeatable (see below)
  --turntable N    render N frames of one full yaw rotation (sets view.spin = 360·fps/N); add
                   --set view.pitchSwing=12 for a gentle nod. Fit uses the bounding sphere so the
                   size does not breathe as the molecule turns; raise view.zoom to fill the frame
  --list           print the timeline (keyframes, holds, transitions) and exit
```

`--set` addresses the settings object by dotted path. Anything under `rep`, `view`, `style`, `show`,
`palette`, or the top-level motion keys (`fps`, `stepEvery`, `boilEvery`, `arrowLead`) is a setting. Two
prefixes address the *scene* instead: `reps.sticks`, `reps.cartoon`, `reps.surface` (selections) and
`groupColors.<key>` (colour overrides). Values are parsed as numbers or booleans when they look like one;
quote strings with spaces: `--set reps.sticks="hetatm and not water"`. An empty value clears a selection:
`--set reps.cartoon=`.

Examples:

```bash
node render.js frames/*.pdb --set reps.cartoon=polymer --set reps.sticks="hetatm and not water" \
                            --set rep.fill="ink colour" --frames drawn
node render.js examples/mechanism.json --format svg --frames keyframes --out svg
node render.js 6GZQ.cif --set reps.cartoon=polymer --set reps.sticks= --set rep.cartoonColor=carbon \
                        --set rep.colorBy=subunit --set style.inkWidth=0.5 --set view.fog=0.7 --set view.fogStart=0.3
node render.js scene.json --settings my-look.json --frames 120-240 --out part2
node render.js 6GZQ.cif --set reps.cartoon= --set reps.surface=polymer --set rep.surfaceColor=subunit \
                        --set rep.fill=watercolour --set view.pitchSwing=12 --size 960x960 --turntable 72 --out turn
ffmpeg -framerate 12 -pattern_type glob -i 'turn/frame_*.png' -c:v libx264 -pix_fmt yuv420p turntable.mp4
```

The easiest workflow is to find the look in the page, *Save settings*, and pass that file with
`--settings`; use `--set` for the one or two things that change per render.

### Inputs

#### PDB and mmCIF

One file → one keyframe. Several files (or a multi-MODEL PDB, or a multi-model mmCIF) → a stack of keyframes
in filename order; each is held for `pdbFrames` frames (page: *frames per PDB*), and atoms are interpolated
linearly between consecutive keyframes. Bonds that exist in one keyframe and not the next are drawn forming
or breaking (dotted), and bond order changes are animated. This is the intended path for a mechanism made
from a series of structures: write out the intermediates (and interpolated frames if you want your own
easing) as a numbered set of files.

What is read:

- ATOM/HETATM coordinates, element (from the element column, else the atom name), alternate location A only,
  residue name/number, chain (auth_asym_id in mmCIF).
- CONECT records if present; otherwise bonds by covalent distance (a 2.2 Å grid, so large files load quickly).
- Secondary structure from HELIX/SHEET (PDB) or `_struct_conf`/`_struct_sheet_range` (mmCIF). Without
  either, helices and strands are assigned from Cα geometry with P-SEA-style distance and pseudo-angle rules.
- Nucleic acids are recognised from their sugar-phosphate atoms; their trace atom is P (fallback C4′) and
  they are drawn as tubes.
- mmCIF entities: `_entity.pdbx_description` and `_entity_poly.pdbx_strand_id` give every chain an entity
  id and, for ribosomes, a subunit (S for 30S/16S/18S/40S, L for 50S/23S/5S/28S/60S, T for tRNA/mRNA, X
  otherwise). These drive the `entity` and `subunit` colour schemes and selections.
- On load the stack is rotated by principal axes so its widest spread lies in the picture plane; adjust
  under *View*.

#### Scene JSON

A scene is a list of keyframes, each with atoms, bonds, curly arrows and a caption. Load a PDB stack in the
page, *Save scene JSON*, and edit that file to add arrows, charges, lone pairs and labels; then render it
with the script. The full format is in [docs/scene-format.md](scene-format.md).

### Representations and selections

Three representations can be shown at once, each on its own selection:

- **sticks** — PyMOL-style sticks (half-bonds coloured by element, small spheres at cut points) or
  pencil ball-and-stick (`rep.mode`: `sticks` | `ballstick`). Curly arrows, charges, lone pairs and
  labels attach to stick atoms.
- **cartoon** — helices as ribbons (width along the helix axis, front and back faces shaded), strands as
  arrows, loops as thin tubes, nucleic backbones as thicker tubes. With a cartoon shown, backbone atoms of
  those residues are dropped from sticks (`rep.sideChainHelper`).
- **surface** — Goodsell-style: each residue's van der Waals discs (plus half the probe radius) become one
  patch; patches are painted back to front with depth-dependent tone and a light from the top-left, and the
  outer silhouette gets a drying ring.

Selections use a small PyMOL-like language:

```
all  none  polymer  hetatm  water  protein  nucleic  backbone  sidechain  hydro
resi 57+102+195   resi 190-200   resn SER+HIS   name CA+CB   chain A+B   elem C+N
ss H+E   subunit S+L   entity 1+3   group SER195   id <atom id>
and  or  not  ( … )
```

Examples: `hetatm and not water`, `chain A and resi 50-120`, `polymer and not hydro`, `subunit L`.

### Fill modes and colour

`rep.fill` sets how shapes are filled; outlines are always ink.

| mode | look |
|---|---|
| `flat` | solid colour, PyMOL's flat-shaded illustrative look |
| `wash` | a pale tint under the ink |
| `pencil` | coloured-pencil scribble fills that stray past the line, three outline passes, construction lines suit this |
| `watercolour` | stacked translucent layers with fractal edges, a darker drying ring and granulation, multiplied over the paper |
| `ink` | paper only; nitrogen stippled, oxygen hatched, sulfur cross-hatched, carbon plain; a tick at each bond midpoint |
| `ink colour` | as ink, but the hatching takes the element or residue colour and carbons get a sparse hatch in theirs |

Carbon colour (`rep.colorBy`): `group` (the scene's `groupColors`, else element grey), `element`, `residue`
(auto palette), `chain`, `subunit`, `entity`. Heteroatoms always take their element colour; the automatic
palettes contain no blues or reds so they never collide with N and O.

Cartoon colour (`rep.cartoonColor`): `ss` (helix/sheet/loop/nucleic palette entries) or `carbon` (the
scheme above). Surface colour (`rep.surfaceColor`): `single` (palette `surface`), `chain`, `subunit`,
`entity`, `carbon`, `element`.

Overrides go in the scene's `groupColors`, keyed by residue (`SER195`), chain ID (`A`), `subunit:S`,
`subunit:L`, `subunit:T`, or `entity:<id>`; e.g. `--set groupColors.subunit:L=#e6a45a`.

### Settings reference

Defaults in parentheses. Everything is reachable from `--set` and from the page.

**Motion** — `fps` (24), `stepEvery` (2: a new pose every second frame), `boilEvery` (2: re-jitter the
lines every second frame), `arrowLead` (0.2: fraction of a transition during which the arrows draw before
the atoms move), `pdbFrames` (2: frames per file in a PDB stack).

**rep** — `mode` sticks|ballstick, `fill` (flat), `colorBy` (group), `stickRadius` Å (0.2),
`sphereScale` (0.4), `sideChainHelper` (true), `cartoonColor` ss|carbon|rainbow, `cartoonScale` (1),
`surfaceColor` (single), `probe` Å (1.4), `surfaceScale` (1), `surfaceOpacity` (1). Engraved ribbons:
`cartoonStyle` sketch|engraved (sketch), `engraveLines` (8: lines per face), `engraveWidth` (0.45: their weight),
`strandThickness` Å (0.6), `coilWidth` (1.25), `ssLabels` (false: α1, β1… on the ribbons).

**view** — `yaw`, `pitch` degrees, `zoom` (1), `panX`, `panY` (fractions of the canvas), `fov` degrees
(20; 0 = orthographic), `fog` (0.5), `fogStart` (0.45: fraction of the depth range before fog begins),
`spin` degrees per second of turntable yaw (0 = off; the page's *turntable* slider), `pitchSwing` degrees
of pitch oscillation per turn (0).

**style** — `rough` (1.1: line jitter amplitude), `passes` (2: overdrawn strokes per line), `pressure`
(0.55: pen-pressure width variation), `hierarchy` (0.6: silhouettes heavier, interior marks lighter),
`inkWidth` (1.5), `bondWidth` (2.1, ball-and-stick only), `ballScale` (1, ball-and-stick only),
`hatchSpacing` px (5), `hatchAngle` degrees (−40), `hatchDensity` (1.4), `lightAngle` degrees (−125),
`shading` (0.65), `pencilFill` (0.55), `fillWobble` (1: how far fills stray from the ink), `grain` (0.6),
`wash` (0.3: watercolour on the paper), `washSeed` (1), `washLife` (0.6: how much the wash breathes per boil),
`contextAlpha` (0.5: pocket blob), `font` Caveat|Patrick Hand|Kalam|Plain sans, `labelSize` (19),
`captionSize` (24), `annot` (1: scale of lone-pair dots, charge circles and arrow heads, for drawings whose
atoms are small on the page).

**show** — `H`, `construction`, `valence`, `colorBonds` (ball-and-stick), `lonePairs`, `charges`,
`arrows`, `labels`, `resLabels`, `hbonds`, `context`, `caption`, `stepLabel`, `figLabels` (the labels placed on
the figure, the scene's `labels`), `noLabels` (every label off at once).

**palette** — `paper`, `ink`, `hatch`, `arrow`, `charge`, `label`, `context`, `accent`, `C`, `N`, `O`,
`H`, `S`, `P`, `X` (other elements), `helix`, `sheet`, `loop`, `nucleic`, `surface`, `wash`.

### Exporting

From the page (*Export*): PNG of the current frame, PNG sequence as a zip (one file per drawn frame,
with a README giving the ffmpeg line), WebM video recorded in real time, SVG of the current frame, SVG
sequence as a zip. Downloads go through the browser's save prompt.

From the script: `--format png` or `--format svg`, then ffmpeg for video.

**SVG.** Every line and fill is a vector path (strokes are drawn as filled polygons with varying width, so
they stay editable). The paper, its grain and the watercolour layers are embedded as PNG images at `--scale`
resolution. Blend modes use `mix-blend-mode: multiply`, which browsers and Inkscape honour; Illustrator
flattens them, so for Illustrator either accept flat colour or rasterise the watercolour first. Expect
2–6 MB per frame.

### Performance

Rough per-frame times on a laptop at 960×720, scale 2:

| scene | flat / ink | watercolour |
|---|---|---|
| active site, 40 atoms | 10–20 ms | 0.3–0.4 s |
| 300-residue protein, cartoon | 0.1 s | 1–2 s |
| 70S ribosome (144k atoms), cartoon or surface | 3–5 s | 10–13 s |

Loading a 144k-atom mmCIF takes about 90 s (bond search, secondary structure, principal axes). The page
draws only when the frame changes; watercolour and "wash life" are the expensive parts, so scrub with
`flat` and switch to `watercolour` to export. Above 260 stick atoms the renderer drops to one outline pass.

### How it works

Everything is 2D canvas. Per frame: interpolate the keyframes (positions, bond orders, charges, lone pairs,
arrows with their own timing), rotate and project with a PyMOL-like camera (field of view sets the camera
distance from the scene width), then build a painter's list of items — half-sticks, junction rings and
fills, spheres, cartoon quads, surface patches — sorted by depth and drawn back to front.

Every visible line is a "sketch stroke": the ideal polyline is resampled, offset by low-frequency noise
plus a small random jitter and an overall bow, given a pen-pressure width profile, and filled as a polygon;
a second pass at lower opacity overdraws it. The noise seed advances every `boilEvery` frames, so lines
boil. Cartoon fills wobble on their own seed so they misregister from the ink.

Watercolour is a stack of lightly deformed copies of a shape at low opacity, multiplied over the paper:
where the copies agree the pigment builds, where they disagree the edge feathers, and their outlines pile
into the drying ring. Long thin shapes are deformed without scaling; ribbon runs are painted into their own
offscreen layer and revealed quad by quad so a nearer turn covers a farther one. Pools are painted into an
offscreen layer at full strength and composited once, because canvas stores colour premultiplied by alpha
and very low-alpha layers quantise to pink.

Secondary structure, when not in the file, is assigned from Cα distances d2, d3, d4 and the pseudo-angles
τ and α with P-SEA's thresholds, single gaps filled, runs shorter than four (helix) or three (strand)
discarded, helices extended by one residue at each end.

### Known limitations

- Occlusion is painter's order per item, not per pixel: a very long stick crossing a ball at a different
  depth can draw wrongly. Small scenes never show this; huge ones rarely do.
- The surface is a 2D union of discs, not a rolled-probe surface; it is a drawing convention, not geometry.
- Cartoon helices follow the Cα spline directly (PyMOL smooths them further).
- No lighting on sticks beyond the pen shading; no shadows.
- Playback of watercolour or pencil at 24 fps is not real time on most machines; export instead.
