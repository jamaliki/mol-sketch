# MolSketch — interactive renderer

The interactive version of MolSketch: the same hand-drawn looks, in an app where you orbit, zoom and
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
```

Headless images, videos and SVG come from the Python package, which draws with this app's engine:
`pip install ./python`, then `molsketch render public/examples/1A8O.pdb --look watercolour -o fig.png`, or
`molsketch serve` to run this app with its finished figures drawn by the package (see [../python](../python)).

Drag a PDB, mmCIF, scene JSON or density map (`.map`, `.mrc`, `.ccp4`) file onto the canvas, use *Open…* / *Examples* in the top bar, or type a PDB ID
(e.g. `1A8O`) and *Fetch* to load that entry from RCSB as mmCIF. Drag to rotate, shift-drag or
right-drag to pan, wheel to zoom, arrow keys to nudge, `r` to reset; `?` shows every shortcut.

The window has three parts around the drawing:

- **The top bar**: *Open* (a file, an entry from the PDB by its ID, a cryo-EM map from EMDB by its ID, or an
  example), the name of what is loaded, undo / redo, help (`?`) and *Export*.
- **The layers of the picture** (left): the drawing style; the molecule's parts (protein or nucleic acid and its
  chains, side chains, ligands, water), each with a switch to show or hide it; the density map (or *Add a density
  map*); the active site; labels; keyframes, for an animation; camera and light. Select one to see its settings.
- **The inspector** (right): the settings of the selected layer, the everyday ones first and the fine tuning folded
  away. *Drawing style* has the looks, drawn with your molecule in each, then the fill, the hand, the pen, hatching,
  watercolour, paper and every colour. *Protein* has how it is drawn (cartoon, surface, both, sticks) and coloured
  (by structure, chain, residue or rainbow, with the group palettes). *Density map* has the contour (in σ or the map's
  units, *Recommended*), how it sits with the model (behind, over, outline), close-ups on residues and the processing.
  The search box (`/`) finds any setting in any layer.

On the drawing, a small dock resets the view, spins the molecule, adds a label and saves what is on screen. For an
animation, the timeline under the drawing plays, steps and jumps to keyframes. *Export* opens a dialog with the
picture at any size (PNG, a JPEG poster, SVG through `molsketch serve`), the video, the scene and style files, and the
`molsketch render` command that renders exactly what is on screen; while it is open, the drawing shows the frame the
file will hold.

[../docs/hero-workflow.md](../docs/hero-workflow.md) is the route from computed states to a looping video, both in the app
and by script. Every control edits one field of the style, which is saved in the browser and can be exported / imported
as JSON.

## Drawing through the Python package

`molsketch serve` (from [../python](../python)) serves this app and draws its figures: the rested frame, Save PNG,
posters and every video frame are drawn by the Python package, from a figure spec the app sends
(`src/app/sdk.ts`: the input once, then the full style, camera, labels, group colours, frame and size). The
GPU preview still follows the mouse. The drawing core is `src/headless/core.ts`, built for the package by
`scripts/build-python.mjs`; opened without the server (or with `?sdk=off`), the app draws with that same core in the
browser. While developing, `npm run dev` finds a `molsketch serve` on localhost:8471 by itself.

## How it works

Three renderers share one G-buffer. The GPU resolves what is visible; the classic engine or the sketch pass draws it.

**Classic (exact).** `src/classic/engine.js` is MolSketch's canvas renderer and the reference look, and the only copy
of the engine: the Python package draws with the same code, the same seeds and the same camera, so a figure from
Python matches the app pixel for pixel (`python/tests/test_parity.py` compares them). It is what *at rest: classic*,
*Render now* and every export use; served by `molsketch serve`, the app has the package draw them. Drawing takes a
fraction of a second for a protein and a second or two for the ribosome, which is why the app shows the GPU preview
while you drag and only settles into the classic drawing once you stop.

The app's camera is the classic engine's camera (`src/render/camera.ts`): the drawn atoms' bounding box in the rotated
frame, an eye distance set by the field of view, the pixel scale that fits the box into the canvas minus the
caption margins, pan as fractions of the canvas. The GPU derives its matrices from it, the classic engine runs
its own copy of the same arithmetic, and both frame a view identically.

**Sketch (fast).** The hybrid described below: the GPU's id and depth images traced into regions, the same stroke
engine drawing each region clipped to what is visible. Close to the classic look, several times faster on large
structures, but not identical, because visibility comes from pixels rather than painter's order.

**Preview.** A per-pixel approximation on the GPU, for interaction only. A density map is in it too: the
isosurface the drawing prepared, pushed behind the model as the drawing puts it.

**Off the main thread.** Without `molsketch serve`, a figure whose drawing takes 100 ms or more (a large structure, a
map) is drawn by the same headless core in a worker onto an OffscreenCanvas (`src/headless/drawworker.ts`, through
`src/app/localdraw.ts`, which speaks the SDK's language), with the page's fonts: the app never freezes while a ribosome
is drawn, and the drawing is the same to the pixel. Exports go the same way. A light figure is drawn on the main
thread, live as it moves.

**Density maps** are prepared (cropped, low-passed, contoured, their surfaces smoothed and tied to the model) in a
worker (`src/classic/mapworker.ts`, through `src/classic/mapasync.ts`), which for a large map takes a second or more:
while it works, the preview goes on and the drawing waits for it, so changing the level or a close-up never freezes the
app. Exports prepare the map in line. The headless core prepares maps in line, with the same code.

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
   │    app's camera and painting them back to front.
   │
   ├──► preview (while you drag): three screen-space passes — edge detection, coverage blur, and a
   │    style pass with paper, hatching, translucent wobbled layers and noise-jittered lines. Fast,
   │    per pixel, and only an approximation of the look.
   │
   └──► sketch (optional at rest): the id and depth images are read
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
src/classic/   engine.js (the canvas renderer, the only engine), adapter.ts (Structure → scene, Style → cfg,
               camera → projector)
src/ink/       strokes.ts (the stroke engine, ported from the classic engine), paper.ts, regions.ts (label image →
               polygons), sketch.ts (the sketch pass)
src/app/       panel.ts (controls generated from a schema), controls.ts (orbit), history.ts (undo), lint.ts (checks),
               diff.ts (what changes between keyframes), author.ts (hit-testing and arrow / lone pair / charge edits),
               views.ts (the view scorer), encode.ts (WebCodecs + mp4-muxer / webm-muxer)
src/main.ts    wiring, render loop, window.MolSketch for scripts
src/headless/  the engine without a browser, for the Python package: a recording canvas, the figure spec, an exact port of Skia's arcTo
cli/render.mjs the app drawn headless in Chrome (Playwright + the built app): the reference python/tests/test_parity.py compares against
scripts/shot.mjs  development screenshots against the dev server;  scripts/mech.mjs  the pixel-identity test of the classic engine;
scripts/features.mjs  exercises lint, diffs, authoring, keyframe edits, keyframe cameras, suggested views, undo and
               in-browser encoding headlessly;  scripts/viewsheet.mjs  a contact sheet of suggested views
```

## Colours

The *Colour* section shows every colour as a swatch: click one to pick (the hex field edits the selected swatch), the
paper-and-ink presets as strips. Below them the *group palette* is the list of colours residues, chains and molecules
receive in the order they appear when nothing names their colour: the engine's own, the lab website's, Okabe–Ito and
Paul Tol's colour-blind-safe sets, Tableau, and the studies from jamaliki/design-corner (`src/palettes.ts`; a name in
the style's `groupPaletteName`, the colours in `groupPalette`), as tiles in three families; hovering a tile previews it on
the drawing, clicking keeps it. Under that, the groups of the loaded file with the
colour each has now: click to override it (that is the scene's `groupColors`), right-click to hand it back to the
palette. The same palette applies in the classic engine (`cfg.groupPalette`) and in Python (`fig.palette`).

## Style fields

`fill` watercolour | ink colour | ink | pencil | chalk | flat | wash. `annot` scales lone pairs, charges and arrow heads. `shading`, `pencilFill`, `fillWobble`,
`construction`. `palette` paper, ink, hatch, wash, element colours, helix/sheet/loop/nucleic, surface. `colorBy` residue | element | chain | subunit | entity (carbons, and cartoons/surfaces when
`cartoonColor`/`surfaceColor` say `carbon`/`residue`). `reps` the three selections. `stickRadius`,
`cartoonScale`, `probe`. `line` width, rough (wobble), passes, hierarchy (silhouettes heavier than
interior lines), pressure, alpha. `hatch` spacing, angle, density. `water` layers, wobble, ring,
granulation, tone. `paper` grain, wash, washSeed, washLife, washScale. `view` fov (0 = orthographic),
fog, fogStart, light. `boilEvery` frames between re-jitters; `boilHold` drawings per re-jitter for scenes (2 keeps the motion on every drawing and the stroke jitter on every second one, which roughly halves a video's bitrate). `groupPalette` / `groupPaletteName`: see Colours.

`molsketch render --set path=value` addresses these by dotted path, e.g. `--set reps.surface=polymer --set
line.width=2 --set palette.paper=#ffffff` (Python spells them in snake_case, `wash_seed`; both work).

## Scenes

Several structure files loaded together (the file picker takes many; drop them together; in Python,
`ms.load(["step_1.pdb", "step_2.pdb", …])`) become a stack: one keyframe per file, atoms matched by residue and name, bonds inferred per file,
2 frames per file by default. *Save scene JSON* writes it out for annotation; [../docs/mechanism-from-pdbs.md](../docs/mechanism-from-pdbs.md)
is the workflow from a stack to a figure like the mechanism example.

A keyframed scene JSON (the format in `../docs/scene-format.md`; `examples/mechanism.json` is the serine
hydrolase mechanism) loads like a structure: drop it on the canvas or pick it from the examples. The
*Animation* section then has play/pause, a frame scrubber and step buttons (space, `,` and `.` on the
keyboard). While you drag, the GPU previews the sampled state of the current frame; at rest, and while playing
when the frame renders in under 90 ms, the classic engine draws the frame with its arrows, charges, lone pairs,
labels and captions. The *Annotations* section switches each of those on and off. Scene JSON carries its own
selections, colour overrides and camera, which replace the current ones on load.

```bash
molsketch render public/examples/mechanism.json --look watercolour --frames drawn -o out   # every drawing
molsketch render public/examples/mechanism.json --look ink-colour --frames keyframes -o kf  # one per step
molsketch render scene.json --size 1920x1080 --fit 57,13,92,58 -o scene.json               # frame it for a page, store the camera
```

The camera flags: `--yaw --pitch --roll --zoom --fov --pan X,Y`, given only when they should override the scene's own
view; `--fit L,T,R,B` (percent of the frame) then sets zoom and pan so the drawing fills that box, `--fit-what frame`
measures the current frame instead of every keyframe, and writing to a `.json` stores the result in the scene. A scene's `path` (a computed trajectory between two keyframes), `leave`, `asNext`,
`exitDir` and `enterDir` (a cycle that closes with molecules exchanged) are in
[../docs/scene-format.md](../docs/scene-format.md).

## Editing a scene in the app

Everything below writes into the loaded scene document, so *Save scene JSON* keeps it and the CLI renders it. *Undo* /
*Redo* (Ctrl-Z, Ctrl-Shift-Z) cover style, camera, colours and these edits; a slider drag or a turn of the view is one
step.

**Checks.** On load (and after every edit) a lint pass lists what is probably wrong and what will happen that you might
not expect: bonds naming missing atoms, bonds too long for their elements or listed twice, carbons without a bond,
arrows anchored on atoms or lone pairs that are not there, a lone-pair tail on an atom with no lone pair, charges drawn
bare, ids that fade out or enter between keyframes (a note when the cycle closes with `leave`, a warning otherwise), a
loop that closes by morphing products back into the substrate. Click a line to go to that keyframe.

**Animation.** Time is in seconds (the timeline runs at 24 frames a second, 12 drawings). Hovering the time slider
draws what changes on the way to the next keyframe over the frame: orange rings on atoms that move (stronger the
further), red dashes on bonds that break and rings on atoms that leave, green on bonds that form and atoms that arrive,
yellow on bonds that change order and atoms whose charge changes; *show changes* keeps the overlay on. The keyframe list
has each keyframe's name, hold and transition in seconds (edit them there; the loop length is under the list), *cam*,
*dup*, ▲ ▼ and ✕, and rows drag to reorder. *dup* inserts an identical copy after a keyframe and hands it the original's
motion to the next (its transition and `path`), so the original now leads to an identical state: duplicate, then edit
the copy. *cam* stores the current camera on the keyframe (`view` in the JSON: yaw, pitch, roll, zoom, pan): the view
holds it through the keyframe and moves to it, smoothly, during the transition before; keyframes without one keep the
previous keyframe's camera, so one *cam* on keyframe 1 fixes the camera for the loop and a second on keyframe 4 makes
the view travel there between 3 and 4. Scrubbing follows the keyframe cameras; turning the view previews a candidate,
*cam* keeps it.

**Chemistry.** Four modes: *look* (clicks do nothing), *arrow*, *lone pair*, *charge*. In arrow mode click the tail —
an atom (its lone pair, when it has one) or the middle of a bond — then the head, an atom or a bond; Esc cancels. The
arrow's side is chosen so its bow points away from the middle of the drawing; the list under the modes shows the
keyframe's arrows with a bow field, a flip button and delete. Lone-pair mode toggles a lone pair on an atom, pointing
away from its bonds. Charge mode cycles none → + → − → none. Edits apply to the keyframe you are on; in a transition
the timeline steps back to that keyframe's hold first.

**Suggest views** (in *View*) scores 120 orientations of the loaded scene — rings face-on (the mean and the worst:
one ring seen edge-on is a line), the reacting atoms (arrow anchors, ends of bonds that break or form) not hidden by
other atoms and apart from each other on the page, the drawing wider than tall (the preview's aspect sets the target),
leaving groups going up and right — and draws the best twelve, distinct in direction, with the current style. Click one
to take its yaw, pitch and roll (zoom and pan stay; with guides on, the drawing is refitted to the frame). The score is
a heuristic; the thumbnails are the point.

**Render.** The loop as a video file, made in the browser: pick a size (the presets, the canvas, or custom), a codec
(AV1 › VP9 › H.264, whichever this browser encodes; *auto* takes the smallest), a quality (the *small* quantizers sit
near the site's ffmpeg encodes), and *Render the loop*. WebCodecs encodes what the classic engine draws, a muxer
writes MP4 (AV1, H.264) or WebM (VP9), and the file downloads; a progress bar shows the size so far and the estimate.
*Save poster (JPEG)* is the first keyframe with its arrows drawn, at the output size; *Save this frame (PNG)* the frame
on screen. The preview canvas keeps the chosen size's aspect (letterboxed), so a fit made in *Frame* is the fit of the
file. Chrome and Edge have VideoEncoder; Safari 17 and Firefox partly. `molsketch render` + ffmpeg (`hero/render.sh`) remains the
way to make all three encodes at once with the tuned encoders. Per-keyframe cameras render in both.

## Not in the app

SVG output without the server: *Export › Picture › Save SVG* appears when the app is served by `molsketch serve`, and
`molsketch render … -o fig.svg` or `fig.save("fig.svg")` make one from the terminal or Python.
