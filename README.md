# MolSketch

Hand-drawn molecular illustration. MolSketch takes atomic coordinates (a PDB ID, a PDB or mmCIF file, or a keyframed
mechanism with curly arrows, charges and captions) and draws them the way an illustrator would: sticks and
ball-and-stick, cartoons and surfaces, in watercolour, pen and ink, coloured pencil, chalk, or the line-shaded ribbons
of MOLSCRIPT, on paper, with lines that boil from frame to frame so an animation looks drawn rather than rendered.

![Ras with GppNHp, engraved colour, labelled](docs/img/labels.png)

| Serine hydrolase mechanism, watercolour | Ras, engraved |
|---|---|
| ![Serine hydrolase mechanism, watercolour](docs/img/mechanism_watercolour.png) | ![Ras, engraved](docs/img/engraved.png) |
| **70S ribosome surface, by subunit** | **Pen and ink with coloured hatching** |
| ![Ribosome surface by subunit](docs/img/ribosome_surface_by_subunit.png) | ![Pen and ink with coloured hatching](docs/img/ink_colour.png) |

## Contents

- [Quick start](#quick-start)
- [Python](#python)
- [The app](#the-app)
- [Looks](#looks)
- [Engraved ribbons and palettes](#engraved-ribbons-and-palettes)
- [Labels](#labels)
- [Mechanisms and animation](#mechanisms-and-animation)
- [The command line](#the-command-line)
- [Inputs and selections](#inputs-and-selections)
- [Repository layout](#repository-layout)
- [Reproducing the images](#reproducing-the-images)
- [Documentation](#documentation)

## Quick start

```bash
git clone git@github.com:jamaliki/triad-sketch.git && cd triad-sketch/app
npm install
npm run dev            # open http://localhost:5173
```

Type a PDB ID in the top bar (`5P21`, say) and press *Fetch*, pick a look, turn the molecule, and *Save PNG*. Drop a
PDB, mmCIF or scene JSON file on the drawing to open your own; drop several structure files to animate between them.

## Python

The same figures from Python, with no browser: the package runs the app's own drawing engine in an embedded V8 and
draws with Skia, so a figure made in Python matches the app to the pixel (see [python/README.md](python/README.md)).

```python
import molsketch as ms

fig = ms.fetch("2PTN").look("engraved-colour").site("resi 57+102+195").frame_site().label_site()
fig.save("trypsin.png", scale=2)
ms.load("mechanism.json").look("chalkboard").animate("loop.mp4")
```

`pip install ./python`, then `molsketch render …` from the terminal, or `molsketch serve` for the app itself with every
figure drawn by the package.

## The app

![The app: Ras in engraved colour, with the Labels tab open](docs/img/app.png)

While you drag, a WebGL2 preview follows the mouse in a few milliseconds; when the view rests, the stroke engine
redraws the exact frame with real strokes, hatching and watercolour. Cost follows the visible outline rather than the
atom count, so a 144 000-atom ribosome settles in about a second.

- **Top bar**: *Open…*, *Examples*, fetch a PDB ID from RCSB, undo / redo, *Save PNG*, *Export…*, and `?` for every
  shortcut.
- **Look**: the looks, what to draw (sticks, cartoon, surface, each with one-click choices or any selection), fill,
  marks, and fine tuning for lines, hatching, watercolour and paper.
- **Colour**: what is coloured by what, the group palettes, per-residue or per-chain overrides, every swatch.
- **Labels**: labels you place on the figure, which automatic labels show, and their font, size and colour.
- **View**: camera, fog and light, suggested views, framing into a box of the canvas, turntable and boiling.
- **Scene** (with a mechanism loaded): keyframes and their timing, curly arrows, lone pairs and charges by clicking,
  and checks. A timeline under the drawing plays, steps and jumps between keyframes.
- **Export**: a PNG or poster at any size, the loop as a video (AV1, VP9 or H.264, encoded in the browser), the scene
  and style as JSON, and the command that renders exactly what is on screen from the terminal.

*Find a setting* (`/`) searches every tab. Every change can be undone, and the style is kept in the browser between
visits. The app's own [README](app/README.md) covers how the renderers fit together.

## Looks

**One grammar, several media.** Every look draws the same way and differs only in its medium. Ribbons are the engraved ones (MOLSCRIPT's geometry,
colour carried in lines along each face), and sticks follow them: next to engraved ribbons a side chain or ligand is
drawn with the same lines along each bond, so the whole figure reads as one drawing. A mechanism drawn only in sticks
keeps its hand-drawn sticks (*sticks style: auto*; set it to *engraved* or *sketch* to choose). All looks share one
pen (width 1.6, hierarchy 0.45; chalk keeps a broader stick, Assembly cartoon a thin one for huge complexes), and
what makes a look loose or crisp is its **hand**, one number from 0 (a ruled, engraved line) to 1 (a loose sketch)
that sets roughness, passes, pen pressure and fill wobble together: Engraved 0.08, Ink 0.55, Watercolour and Dark
paper 0.6, Chalkboard 0.72. The medium supplies the rest: ink leaves the faces paper, chalk leaves them board, and
watercolour lays a pale wash of the colour under darker lines.

The *hand* slider is at the top of *Look › Lines*.

A look sets everything at once; change anything afterwards. The app's *Looks* and the settings files in
[`looks/`](looks) are the same set, documented setting by setting in [docs/looks.md](docs/looks.md).

| look | | file |
|---|---|---|
| Watercolour | translucent washes on cream paper; the default for finished work | `looks/watercolour.json` |
| Ink colour | pen and ink with coloured hatching on white | `looks/ink-colour.json` |
| Ink | the same in black ink only | `looks/ink.json` |
| Pencil | coloured-pencil scribble fills with construction lines (page only) | `looks/pencil.json` |
| Dark paper | pastel pigment on the lab website's navy, pale ink, no wash | `looks/dark-paper.json` |
| Chalkboard | chalk on the same navy: dusty fills, soft pitted lines | `looks/chalkboard.json` |
| Engraved | line-shaded ribbons, black on white, after MOLSCRIPT (Kraulis 1991) | `looks/engraved.json` |
| Engraved colour | the engraved ribbons with colour only in the lines | `looks/engraved-colour.json` |
| Assembly surface | watercolour surface coloured by subunit, for large complexes | `looks/assembly-surface.json` |
| Assembly cartoon | tubes and ribbons by subunit, thin pen, heavy fog | `looks/assembly-cartoon.json` |

| Pencil | Dark paper | Chalkboard |
|---|---|---|
| ![pencil](docs/img/pencil.png) | ![dark paper](docs/img/dark_paper.png) | ![chalkboard](docs/img/chalkboard.png) |
| **Ink** | **Watercolour cartoon** | **Assembly cartoon** (70S ribosome) |
| ![ink](docs/img/ink.png) | ![cartoon, watercolour](docs/img/protein_cartoon_watercolour.png) | ![ribosome cartoon by subunit](docs/img/ribosome_cartoon_by_subunit.png) |

## Engraved ribbons and palettes

The engraved cartoon is a port of MOLSCRIPT's schematic geometry (helices along the local helix axis, smoothed strands
with stepped arrowheads, Priestle-smoothed coils) drawn the way its PostScript figures were: every face is paper with
lines running along it. As a face turns edge-on its lines thin out rather than fuse into a band, the colour they
carried stays as a pale tint, and the edges of a helix seen end-on take the ribbon's dark shade, so a helix pointing
at the viewer stays both coloured and legible. Where a helix turns over, its silhouette is inked.

![Ras, engraved colour](docs/img/engraved_colour.png)

In engraved colour, a group palette colours the ribbons too: helix, sheet and coil take the first colours of the
palette that stand out against the paper (contrast at least 2.2) and from each other (ΔE at least 25), in the
palette's own order. Palettes whose first three already work are used as they are; pale ones skip to their stronger
colours, and a colour is deepened toward the ink only when the palette runs out. There are 29 palettes, from the
colour-blind-safe sets (Okabe–Ito, Paul Tol, Tableau) to the studies in *jamaliki/design-corner*.

| Coastal Harvest | Okabe–Ito | Tol muted |
|---|---|---|
| ![](docs/img/palette_coastal_harvest.png) | ![](docs/img/palette_okabe_ito.png) | ![](docs/img/palette_tol_muted.png) |

## Labels

Press *+ Add label* (or `L`) and click the drawing. On an atom or a ribbon the label is pinned to that residue, starts
as its name (`Gly12`), and turns with the molecule; anywhere else it stays where it is on the canvas. Type the text,
drag it off the atom (a leader runs back once it is far enough), double-click to edit, right-click or Delete to
remove. *Labels on / off* on the drawing hides every label at once, and the Labels tab chooses which kinds show: the
ones you placed, a scene's atom labels, residue labels, and α/β numbering on engraved ribbons (off by default).

Placed labels are part of the figure: they are saved in the scene JSON (`labels`, see
[docs/scene-format.md](docs/scene-format.md)) and drawn in every PNG, poster, video and CLI render.

## Mechanisms and animation

A scene is a list of keyframes, each with atoms, bonds, curly arrows, lone pairs, charges and a caption; MolSketch
interpolates between them, draws bonds forming and breaking, and times the arrows ahead of the atoms. The example
`examples/mechanism.json` is the serine hydrolase mechanism at the top of this page.

- [docs/mechanism-from-pdbs.md](docs/mechanism-from-pdbs.md): from your own coordinates to a mechanism figure: load a
  PDB stack as keyframes, cut the view down, add arrows, charges and captions by clicking, render.
- [docs/hero-workflow.md](docs/hero-workflow.md): from computed states to a looping video, as for the lab website's
  front page ([`hero/`](hero), [`tools/mech2scene.py`](tools/mech2scene.py)).
- [docs/scene-format.md](docs/scene-format.md): the scene JSON, field by field.

## The command line

The app renders headlessly with the same engine, so a file from the terminal matches what the app shows.

```bash
cd app && npm run build                       # the CLI renders the built app
curl -O https://files.rcsb.org/download/5P21.cif
node cli/render.mjs 5P21.cif --look engraved-colour --set "reps.sticks=hetatm and not water" \
                    --yaw 60 --pitch 20 --size 1600x1200 --out out
node cli/render.mjs public/examples/mechanism.json --look watercolour --frames drawn --out mech
node cli/render.mjs 6GZQ.cif --look assembly-surface --turntable 72 --size 1080x1080 --out turn
                                              # 6GZQ: the 70S ribosome, from RCSB as above
```

`--style` takes a style saved from the app, `--set path=value` changes one field (`palette.helix=#de9151`,
`line.width=2`), `--fit` frames the drawing into a box of the canvas, and `node cli/render.mjs --help` lists the rest.
In the app, *Export › Command line* copies the exact command for what is on screen.

`render.js` at the top level drives the standalone page `triad-sketch.html` the same way and is the route to **SVG**:
every line and fill as an editable vector path. It is documented, with the page's panels and every engine setting, in
[docs/reference.md](docs/reference.md).

## Inputs and selections

- **PDB and mmCIF**: coordinates, alternate location A, secondary structure from the file or assigned from Cα
  geometry, nucleic acids, and mmCIF entities (ribosome subunits S, L, T drive the *subunit* colouring). Several files
  or a multi-model file become keyframes, matched atom by atom.
- **Scene JSON**: keyframes with arrows, charges, lone pairs, captions, cameras and placed labels.

Each representation takes a selection in a PyMOL-like language:

```
all  none  polymer  hetatm  water  protein  nucleic  backbone  sidechain  hydro
resi 57+102+195   resi 190-200   resn SER+HIS   name CA+CB   chain A+B   elem C+N
ss H+E   subunit S+L   entity 1+3   and  or  not  ( … )
```

for example `hetatm and not water`, `chain A and resi 50-120`, `subunit L`.

## Repository layout

| path | what it is |
|---|---|
| [`app/`](app) | the interactive app (Vite + TypeScript, WebGL2) and its headless CLI, `app/cli/render.mjs` |
| `triad-sketch.html` | the standalone page: the drawing engine with its own panels, no server needed |
| `render.js` | renders the page headlessly to PNG or SVG |
| [`looks/`](looks) | the looks as settings files |
| [`examples/`](examples) | a mechanism scene, test structures, a synthetic 12k-atom assembly |
| [`hero/`](hero) | the lab website's animated hero, scenes and render script |
| [`tools/`](tools) | `mech2scene.py`: a scene from computed reaction states |
| [`docs/`](docs) | the guides below, and the images in this README |

## Reproducing the images

The looks gallery comes from `./make-previews.sh` (the commands, look by look, are in [docs/looks.md](docs/looks.md)).
The engraved images are Ras with GppNHp and Mg²⁺ (PDB 5P21) and 7SXY, rendered with the app's CLI from `app/` after
`npm run build`:

```bash
for look in engraved engraved-colour; do
  node cli/render.mjs 5P21.cif --look $look --set "reps.sticks=hetatm and not water" \
                      --yaw 60 --pitch 20 --size 1600x1200 --out $look
done
# palettes: the ribbon colours the app picks from Coastal Harvest
# (Okabe–Ito gives #e69f00 #56b4e9 #009e73, Tol muted #cc6677 #332288 #117733)
node cli/render.mjs 7SXY.cif --look engraved-colour --set reps.sticks= --zoom 1.15 --size 1200x900 \
     --set palette.helix=#a799b7 --set palette.sheet=#47a8bd --set palette.loop=#de9151
```

The labelled figure is the same view of 5P21 with labels placed on Gly12 (P-loop), Tyr32 (Switch I),
Gln61 (Switch II), the nucleotide and the magnesium ion, saved as a scene and rendered with `--look engraved-colour
--set labelSize=30 --zoom 1.3`.

## Documentation

- [app/README.md](app/README.md): the app, its renderers and its CLI
- [docs/looks.md](docs/looks.md): every look, setting by setting, with the command that makes its image
- [docs/scene-format.md](docs/scene-format.md): the scene JSON
- [docs/mechanism-from-pdbs.md](docs/mechanism-from-pdbs.md): a mechanism figure from your own structures
- [docs/hero-workflow.md](docs/hero-workflow.md): computed states to a looping video
- [docs/reference.md](docs/reference.md): the standalone page, `render.js`, every engine setting, performance, how
  the drawing works, and known limitations

MolSketch was called Triad Sketch until September 2026; scripts that use `window.TriadSketch` still work.

MIT licence, © 2026 Kiarash Jamali.
