# Triad Sketch — interactive renderer

The interactive version of Triad Sketch: the same hand-drawn looks, in an app where you orbit, zoom and
change the look while watching. A WebGL2 renderer resolves the geometry and its visibility in a few
milliseconds; while you drag you see a fast per-pixel approximation of the look, and when the view rests
the original stroke engine redraws the frame with real strokes — pressure, overshoot, hatching,
watercolour layers — clipped to what the GPU found visible. Cost scales with visible contour length, not
with atoms, so the 144 000-atom ribosome settles in about a second.

```bash
cd app
npm install
npm run dev            # open http://localhost:5173
npm run build          # static bundle in dist/
npm run render -- public/examples/1A8O.pdb --look watercolour --size 1920x1440 --out out   # headless PNGs (classic engine)
```

Drag a PDB, mmCIF or scene JSON file onto the canvas, or pick an example. Drag to rotate, shift-drag or right-drag to
pan, wheel to zoom, arrow keys to nudge, `r` to reset. The *Looks* buttons apply the same looks as the
files in `../looks`; every other control edits one field of the style, which is saved in the browser and
can be exported/imported as JSON (*Save style* / *Load style*).

## How it works

Three renderers share one G-buffer. The GPU resolves what is visible; the classic engine or the sketch pass draws it.

**Classic (exact).** `src/classic/engine.js` is the canvas renderer of `triad-sketch.html`, verbatim. It is the
reference look: the same code, the same seeds, the same camera, so a frame drawn here matches the page pixel for
pixel (`scripts/mech.mjs` renders `examples/mechanism.json` at frame 28 and diffs it against
`docs/img/mechanism_watercolour.png`: mean difference 0.0). It is what *at rest: classic*, *Render now* and the
CLI's default engine use. Cost is the old cost (about a second for a protein, ten for the ribosome), which is why
the app shows the GPU preview while you drag and only settles into the classic drawing once you stop.

The app's camera is the page's camera (`src/render/camera.ts`): the drawn atoms' bounding box in the rotated
frame, an eye distance set by the field of view, the pixel scale that fits the box into the canvas minus the
caption margins, pan as fractions of the canvas. The GPU derives its matrices from it, the classic engine runs
its own copy of the same arithmetic, and both frame a view identically.

**Sketch (fast).** The hybrid described below: the GPU's id and depth images traced into regions, the same stroke
engine drawing each region clipped to what is visible. Close to the classic look, several times faster on large
structures, but not identical, because visibility comes from pixels rather than painter's order.

**Preview.** A per-pixel approximation on the GPU, for interaction only.

```
structure (typed arrays)
   │  selections → per-atom masks; colour schemes → per-atom / per-residue RGB
   ▼
geometry  sticks: sphere + cylinder impostors (instanced quads, ray-cast in the fragment shader)
          cartoon: Catmull-Rom spline through Cα / P, 8-point superellipse rings (flat for helix and
                   sheet, round for loops and nucleic acids), sheet arrowheads; each quad carries a
                   face id (+B side / −B side) and a run id (one per stretch of secondary structure)
          surface: one sphere impostor per residue (Goodsell-style blobs)
   ▼
G-buffer  albedo + material class · view-space normal · object id + representation · linear depth
   │
   ├──► classic (at rest, by default): the original canvas engine, projecting the same atoms with the
   │    app's camera and painting them back to front exactly as the page does.
   │
   ├──► preview (while you drag): three screen-space passes — edge detection, coverage blur, and a
   │    style pass with paper, hatching, translucent wobbled layers and noise-jittered lines. Fast,
   │    per pixel, and only an approximation of the look.
   │
   └──► sketch (optional at rest, `--engine sketch` in the CLI): the id and depth images are read
        back and traced into closed regions, one per visible primitive (an atom's half-sticks, a
        ribbon face of one run, a residue's patch), with every boundary segment classified as a
        silhouette (against paper or across a depth jump) or a contact (touching primitives).
        The original stroke engine — sketchPasses with pressure, overshoot and multiple passes,
        sketched circles, hatching, watercolour shapes with drying rings and granulation, pencil
        scribbles, pen textures per element — then draws each region back to front, clipped to the
        pixels the GPU says are visible. Occlusion comes from the pixels; the marks come from the pen.
        Cost scales with visible contour length, not with atoms: a six-residue close-up takes ~150 ms
        of drawing, the whole ribosome as a surface ~1 s, as a cartoon ~3 s.
```

Region tracing is a boundary walk over the label image (edges between pixels of different labels,
chained with the region on the left, simplified with Douglas–Peucker); loops keep their orientation,
so holes fall out of the nonzero fill rule for free. The sticks use the union of an atom's half-sticks
and junction sphere as one region, so the outline is the capsule outline and the seam at the bond
midpoint becomes the ink-mode tick. Cartoon regions are per run and per face: contour lines run along
the +B face, hatching across the −B face, and the crease between them is the ribbon edge.

What the GPU path cannot do is vector output: the sketch pass draws on a 2D canvas, so SVG is not
available in the app (the canvas engine at the repository root still writes it).

## Layout

```
src/model/     structure.ts (typed-array Structure, SS assignment, bonds), parse.ts (PDB, mmCIF),
               selection.ts (PyMOL-flavoured selections), color.ts (schemes)
src/render/    camera.ts, gl.ts (helpers), batches.ts (instanced draws), geometry.ts (builders),
               renderer.ts (passes), shaders/gbuffer.ts, shaders/style.ts
src/style.ts   the Style type, defaults, palettes;  src/looks.ts  the named looks
src/classic/   engine.js (the page's canvas renderer, verbatim), adapter.ts (Structure → scene, Style → cfg,
               camera → projector)
src/ink/       strokes.ts (the stroke engine, ported from the page), paper.ts, regions.ts (label image →
               polygons), sketch.ts (the sketch pass)
src/app/       panel.ts (controls generated from a schema), controls.ts (orbit)
src/main.ts    wiring, render loop, window.TriadSketch for scripts
cli/render.mjs headless renderer (Playwright + the built app)
scripts/shot.mjs  development screenshots against the dev server
```

## Style fields

`fill` watercolour | ink colour | ink | pencil | flat | wash. `shading`, `pencilFill`, `fillWobble`,
`construction`. `palette` paper, ink, hatch, wash, element colours, helix/sheet/loop/nucleic, surface. `colorBy` residue | element | chain | subunit | entity (carbons, and cartoons/surfaces when
`cartoonColor`/`surfaceColor` say `carbon`/`residue`). `reps` the three selections. `stickRadius`,
`cartoonScale`, `probe`. `line` width, rough (wobble), passes, hierarchy (silhouettes heavier than
interior lines), pressure, alpha. `hatch` spacing, angle, density. `water` layers, wobble, ring,
granulation, tone. `paper` grain, wash, washSeed, washLife, washScale. `view` fov (0 = orthographic),
fog, fogStart, light. `boilEvery` frames between re-jitters.

The CLI's `--set path=value` addresses these by dotted path, e.g. `--set reps.surface=polymer --set
line.width=2 --set palette.paper=#ffffff`.

## Scenes

A keyframed scene JSON (the format in `../docs/scene-format.md`; `examples/mechanism.json` is the serine
hydrolase mechanism) loads like a structure: drop it on the canvas or pick it from the examples. The
*Animation* section then has play/pause, a frame scrubber and step buttons (space, `,` and `.` on the
keyboard). While you drag, the GPU previews the sampled state of the current frame; at rest, and while playing
when the frame renders in under 90 ms, the classic engine draws the frame with its arrows, charges, lone pairs,
labels and captions. The *Annotations* section switches each of those on and off. Scene JSON carries its own
selections, colour overrides and camera, which replace the current ones on load.

```bash
npm run render -- public/examples/mechanism.json --look watercolour --frames drawn --out out   # every drawing
npm run render -- public/examples/mechanism.json --look ink-colour --frames keyframes --out kf  # one per step
```

## Not in the app

SVG output (the canvas engine at the repository root writes it).
