# Reference: the engine

MolSketch has one drawing engine, `app/src/classic/engine.js`. The app draws with it in the browser, and the Python
package (`python/`) draws with it headless, so the two agree to the pixel. This page covers what the engine reads,
what it draws, how, and its limits. For using it, see the [app's README](../app/README.md) and the Python package's
[README](../python/README.md), [API reference](../python/docs/api.md) and [style fields](../python/docs/style.md).

## Inputs

### PDB and mmCIF

One file gives one keyframe. Several files (or a multi-MODEL PDB, or a multi-model mmCIF) give a stack of keyframes
in filename order, and atoms are interpolated linearly between consecutive keyframes. Bonds that exist in one keyframe
and not the next are drawn forming or breaking (dotted), and bond order changes are animated. This is the way to make
a mechanism from a series of structures: write out the intermediates (and interpolated frames if you want your own
easing) as a numbered set of files ([mechanism-from-pdbs.md](mechanism-from-pdbs.md)).

What is read:

- ATOM/HETATM coordinates, element (from the element column, else the atom name), alternate location A only,
  residue name and number, chain (auth_asym_id in mmCIF).
- CONECT records if present; otherwise bonds by covalent distance (on a 2.2 Å grid, so large files load quickly).
- Secondary structure from HELIX/SHEET (PDB) or `_struct_conf` / `_struct_sheet_range` (mmCIF). Without either,
  helices and strands are assigned from Cα geometry with P-SEA-style distance and pseudo-angle rules.
- Nucleic acids, recognised from their sugar-phosphate atoms; their trace atom is P (else C4′) and they are drawn as
  tubes.
- mmCIF entities: `_entity.pdbx_description` and `_entity_poly.pdbx_strand_id` give every chain an entity id and,
  for ribosomes, a subunit (S for 30S/16S/18S/40S, L for 50S/23S/5S/28S/60S, T for tRNA/mRNA, X otherwise). These
  drive the `entity` and `subunit` colourings and selections.
- On load the structure is turned by its principal axes so its widest spread lies in the picture plane.

### Density maps

MRC / CCP4 maps (modes 0, 1, 2, 6 and 12; any axis order; gzipped or not), from a file or from EMDB with the
recommended contour level and the sample's mass. Maps larger than 320 voxels a side are averaged down on reading.
The isosurface is extracted by surface nets, sampled finer for close-ups and Taubin-smoothed; its outline, folds and
shading come from a per-pixel depth buffer of the surface. How maps are drawn, and why: [maps.md](maps.md).

### Scene JSON

A scene is a list of keyframes, each with atoms, bonds, curly arrows and a caption, plus the figure's look, labels,
site and view. The app writes one with *Save scene*, and Python with `fig.save("fig.json")`. The format is in
[scene-format.md](scene-format.md).

## Representations and selections

Three representations can be shown at once, each on its own selection:

- **Sticks**: PyMOL-style sticks (half-bonds coloured by element, small spheres at cut points) or pencil
  ball-and-stick (`mode`). Curly arrows, charges, lone pairs and labels attach to stick atoms. Next to engraved
  ribbons, sticks take the engraved line too (`stick_style`).
- **Cartoon**: helices as ribbons, strands as arrows, loops as thin tubes, nucleic backbones as thicker tubes;
  engraved (after MOLSCRIPT) or sketched in the fill (`cartoon_style`). With a cartoon shown, the backbone atoms of
  those residues are left out of the sticks (`side_chain_helper`).
- **Surface**: Goodsell-style. Each residue's van der Waals discs (enlarged by half the probe radius) become one
  patch; patches are painted back to front, with ink edges where a patch stands in front of something farther back,
  more pigment (or hatching, or scribble) in the grooves, and a fade with depth (`surface_depth`).

Selections use a small language in the manner of PyMOL:

```
all  none  polymer  hetatm  water  protein  nucleic  backbone  sidechain  hydro
resi 57+102+195   resi 190-200   resn SER+HIS   name CA+CB   chain A+B   elem C+N
ss H+E   subunit S+L   entity 1+3   group SER195   id <atom id>
and  or  not  ( … )
```

For example `hetatm and not water`, `chain A and resi 50-120`, `polymer and not hydro`, `subunit L`.

## Fills and colour

`fill` sets how shapes are filled; outlines are always ink.

| fill | look |
|---|---|
| `flat` | solid colour, PyMOL's flat-shaded illustrative look |
| `wash` | a pale tint under the ink |
| `pencil` | coloured-pencil scribble fills that stray past the line |
| `watercolour` | stacked translucent layers with fractal edges, a darker drying ring and granulation, multiplied over the paper |
| `ink` | paper only; nitrogen stippled, oxygen hatched, sulphur cross-hatched, carbon plain; a tick at each bond midpoint |
| `ink colour` | as ink, but the hatching takes the element or residue colour, and carbons get a sparse hatch in theirs |
| `chalk` | broad, dusty chalk strokes on a dark board |

Carbons are coloured by `color_by`: `element`, `residue` (an automatic palette), `chain`, `subunit` or `entity`, or a
group palette (`fig.palette`). Other elements always take their element colour, and the automatic palettes contain no
blues or reds so they never collide with N and O. The cartoon's colour is `cartoon_color` (`ss`, `carbon` or
`rainbow`), the surface's `surface_color`. Colours of your own go on a residue (`SER195`), a chain (`A`), a subunit
(`subunit:L`) or an entity (`entity:1`): `fig.color(...)` in Python, the scene's `groupColors` in a file.

Every other field is in [python/docs/style.md](../python/docs/style.md).

## Output

- **PNG, JPEG, WebP**: from the app (*Save PNG*, *Export › Picture*), `fig.save("fig.png")` or `molsketch render`.
- **SVG**: every line, fill and letter as a vector path (letters as outlines), with the paper, its grain and the
  watercolour layers embedded as PNG images at the output's resolution. Blend modes use CSS `mix-blend-mode`, which
  browsers, Inkscape and Affinity honour; Illustrator flattens them, so for Illustrator either accept flat colour or
  rasterise the watercolour first. From `fig.save("fig.svg")`, `molsketch render … -o fig.svg`, or the app's
  *Export › Picture › Save SVG* when it is served by `molsketch serve`. A protein is a few MB; a 144 000-atom ribosome
  about 30 MB.
- **Video**: `fig.animate("loop.mp4")` and `fig.turntable(...)` (MP4, WebM, GIF, through ffmpeg), or the app's
  *Export › Video*.

## Performance

Warm render times at 900 × 900 on a laptop, with the Python package:

| figure | time |
|---|---|
| a single protein, any look | 0.05 to 0.3 s |
| a mechanism scene frame, watercolour | about 0.2 s |
| a protein with its cryo-EM map (TRPV1, EMD-5778), watercolour | about 0.7 s (the first, with the map prepared, about 2 s) |
| the 70S ribosome (144 000 atoms), cartoon | about 1 s |
| the 70S ribosome, watercolour surface | about 1.2 s |
| the 70S ribosome, ink or pencil surface | 0.8 to 1.2 s |

The first render in a process also starts the engine and reads the structure (about a second for the ribosome). The
engine draws while Python rasterises what it has already recorded, so a figure takes about as long as the slower of
the two. Above 260 stick atoms (or 600 surface patches) strokes get one pass and less texture, so large structures
stay fast and legible; `detail="full"` turns that off.

## How it works

Everything is 2D canvas drawing. Per frame: interpolate the keyframes (positions, bond orders, charges, lone pairs,
arrows with their own timing), rotate and project with a PyMOL-like camera (the field of view sets the camera
distance from the scene width), then build a painter's list of items (half-sticks, junction rings and fills,
spheres, cartoon faces, surface patches), sorted by depth and drawn back to front.

Every visible line is a sketch stroke: the ideal polyline is resampled, offset by low-frequency noise plus a small
random jitter and an overall bow, given a pen-pressure width profile, and filled as a polygon; a second pass at lower
opacity draws over it. The noise seed advances every drawing (or every `boil_hold` drawings), so lines boil. Cartoon
fills wobble on their own seed so they misregister from the ink.

Watercolour is a stack of lightly deformed copies of a shape at low opacity, multiplied over the paper: where the
copies agree the pigment builds, where they disagree the edge feathers, and their outlines pile into the drying ring.
Long thin shapes are deformed without scaling; ribbon runs are painted into their own offscreen layer and revealed
quad by quad so a nearer turn covers a farther one. Pools are painted into an offscreen layer at full strength and
composited once, because canvas stores colour premultiplied by alpha and very low-alpha layers quantise to pink.

A surface is one patch per residue: the convex hull of its atoms' discs. A coarse depth map of the whole surface gives
each patch its depth steps (drawn as ink edges) and how deep in a groove it lies (how much nearer surface surrounds
it), which each fill turns into more pigment, denser hatching or scribble.

Secondary structure, when not in the file, is assigned from Cα distances d2, d3, d4 and the pseudo-angles τ and α
with P-SEA's thresholds, single gaps filled, runs shorter than four (helix) or three (strand) discarded, helices
extended by one residue at each end.

Headless, the engine draws onto a recording canvas instead of a browser's; the Python package replays the recording
with Skia, the rasteriser behind Chrome's canvas, reproducing Chrome's choices (arcs, blend precision, hairlines,
blur, text shaping), so its images match the app's ([python/README.md](../python/README.md#how-close-is-it-to-the-app)).

## Known limitations

- Occlusion is painter's order per item, not per pixel: a very long stick crossing a ball at a different depth can
  draw wrongly. Small scenes never show this; huge ones rarely do.
- The surface is a 2D union of discs, not a rolled-probe surface: a drawing convention, not geometry.
- Cartoon helices follow the Cα spline directly (PyMOL smooths them further).
- No lighting on sticks beyond the pen shading; no shadows.
- Watercolour and pencil are not real time at 24 fps on most machines; the app shows a GPU preview while you drag and
  draws the finished figure when you stop.
