# Triad Sketch — interactive renderer

The GPU version of Triad Sketch: the same hand-drawn looks, but rendered in real time so you can orbit,
zoom and change the look while watching. The 144 000-atom ribosome renders in a handful of milliseconds on
a laptop GPU; the drawing style is computed per pixel, not per stroke, so cost no longer grows with the
number of atoms.

```bash
cd app
npm install
npm run dev            # open http://localhost:5173
npm run build          # static bundle in dist/
npm run render -- ../examples/test_protein.pdb --look watercolour --size 1920x1440 --out out   # headless PNGs
```

Drag a PDB or mmCIF file onto the canvas, or pick an example. Drag to rotate, shift-drag or right-drag to
pan, wheel to zoom, arrow keys to nudge, `r` to reset. The *Looks* buttons apply the same looks as the
files in `../looks`; every other control edits one field of the style, which is saved in the browser and
can be exported/imported as JSON (*Save style* / *Load style*).

## How it works

```
structure (typed arrays)
   │  selections → per-atom masks; colour schemes → per-atom / per-residue RGB
   ▼
geometry  sticks: sphere + cylinder impostors (instanced quads, ray-cast in the fragment shader)
          cartoon: Catmull-Rom spline through Cα / P, 8-point superellipse rings (flat for helix and
                   sheet, round for loops and nucleic acids), sheet arrowheads, one id per SS run
          surface: one sphere impostor per residue (Goodsell-style blobs)
   ▼
G-buffer  albedo + material class · view-space normal · object id + representation · depth
   ▼
edges     silhouettes (depth jumps), creases (normal jumps), id boundaries (atom halves, SS runs, residues)
   ▼
blur      coverage blurred a few pixels → where pigment gathers as a wash dries
   ▼
style     paper (grain, wash pools) → fills → lines, one full-screen pass:
            ink          hatching by element on the shadow side (N stipple, O hatch, S cross-hatch)
            ink colour   the same hatching in the element / residue colour
            watercolour  2–4 wobbled copies of the coverage multiplied as translucent pigment layers,
                         quantised tone, drying ring, granulation
          lines are the edge mask re-sampled through a slow noise field (the tracing drifts), dilated to a
          pressure-modulated width, drawn in 1–4 passes; every `boilEvery` frames the noise seed changes
```

Because everything after the G-buffer is a screen-space filter, the same code stylises a six-residue
mechanism close-up and a ribosome. What it cannot do is vector output: there are no strokes to write to
SVG. The original canvas engine at the repository root still does that.

## Layout

```
src/model/     structure.ts (typed-array Structure, SS assignment, bonds), parse.ts (PDB, mmCIF),
               selection.ts (PyMOL-flavoured selections), color.ts (schemes)
src/render/    camera.ts, gl.ts (helpers), batches.ts (instanced draws), geometry.ts (builders),
               renderer.ts (passes), shaders/gbuffer.ts, shaders/style.ts
src/style.ts   the Style type, defaults, palettes;  src/looks.ts  the named looks
src/app/       panel.ts (controls generated from a schema), controls.ts (orbit)
src/main.ts    wiring, render loop, window.TriadSketch for scripts
cli/render.mjs headless renderer (Playwright + the built app)
scripts/shot.mjs  development screenshots against the dev server
```

## Style fields

`fill` ink | ink colour | watercolour. `palette` paper, ink, wash, element colours, helix/sheet/loop/nucleic,
surface. `colorBy` residue | element | chain | subunit | entity (carbons, and cartoons/surfaces when
`cartoonColor`/`surfaceColor` say `carbon`/`residue`). `reps` the three selections. `stickRadius`,
`cartoonScale`, `probe`. `line` width, rough (wobble), passes, hierarchy (silhouettes heavier than
interior lines), pressure, alpha. `hatch` spacing, angle, density. `water` layers, wobble, ring,
granulation, tone. `paper` grain, wash, washSeed, washLife, washScale. `view` fov (0 = orthographic),
fog, fogStart, light. `boilEvery` frames between re-jitters.

The CLI's `--set path=value` addresses these by dotted path, e.g. `--set reps.surface=polymer --set
line.width=2 --set palette.paper=#ffffff`.

## Not yet ported from the canvas engine

Keyframed scenes (the serine hydrolase mechanism), curly arrows, charges, lone pairs, labels and captions,
ball-and-stick mode, pencil fill, construction lines, SVG output.
