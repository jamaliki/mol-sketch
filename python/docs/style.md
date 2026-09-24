# Style fields

A figure's style is a nested set of fields: how shapes are filled, how the pen moves, the colours, the paper, what
is drawn. A [look](api.md#figlookname) sets all of them at once; `Figure.set` changes individual ones on top:

```python
fig.set(fill="ink colour")                         # a top-level field
fig.set(line={"width": 2.2, "rough": 1.6})          # nested fields, as a dict (the others keep their values)
fig.set(**{"hatch.spacing": 4, "view.fog": 0.3})   # nested fields, by dotted name
```

`ms.default_style()` returns every field with its default value, and `fig.style` shows the style a figure will be
drawn with. The same fields appear in a style file saved from the app (Export › Save style), which
`fig.apply_style(path)` uses whole. The defaults below are those of `ms.default_style()`; each look changes many of
them.

Lengths are in pixels at `scale=1` unless marked Å (ångström, the molecule's own units).

Contents: [Fill and representation](#fill-and-representation) · [Depth in a surface](#depth-in-a-watercolour-surface) · [Colour](#colour) · [What to draw](#what-to-draw) ·
[The pen](#the-pen) · [Shading and hatching](#shading-and-hatching) · [Paper](#paper) · [Engraved ribbons](#engraved-ribbons) ·
[Active site](#active-site) · [View and depth](#view-and-depth) · [Labels and lettering](#labels-and-lettering) ·
[Animation](#animation) · [Detail](#detail) · [Preview-only fields](#preview-only-fields)

---

## Fill and representation

| field | default | meaning |
|---|---|---|
| `fill` | `"watercolour"` | how shapes are filled; the outlines are always ink. See the table below |
| `mode` | `"sticks"` | how the stick atoms are drawn: `"sticks"` (PyMOL-style sticks, with small spheres where bonds meet) or `"ballstick"` (pencil ball-and-stick) |
| `stickRadius` | `0.2` | stick radius, Å |
| `sphereScale` | `0.4` | in `"sticks"` mode, the size of the balls on atoms marked as spheres (a protein's Cα atoms, and atoms a scene marks); 0 draws them as plain stick ends |
| `cartoonScale` | `1` | width of the cartoon ribbons and tubes, relative to normal |
| `cartoonStyle` | `"engraved"` | `"engraved"`: white ribbons shaded with lines along their length, after MOLSCRIPT. `"sketch"`: ribbons filled in the style of `fill` |
| `stickStyle` | `"auto"` | whether sticks follow the engraved style too: `"auto"` (when the ribbons are engraved), `"engraved"` (always) or `"sketch"` (never) |
| `sideChainHelper` | `true` | where a residue is drawn as cartoon, leave its backbone atoms out of the sticks, so only the side chain sticks out of the ribbon |
| `probe` | `1.4` | the surface is drawn as each residue's atom discs, enlarged by this probe radius (Å); larger values give a smoother, fatter surface |

The fills:

| `fill` | what it looks like |
|---|---|
| `"flat"` | solid colour, like PyMOL's flat-shaded illustrations |
| `"wash"` | a pale tint under the ink |
| `"pencil"` | coloured-pencil scribbles that stray past the line |
| `"watercolour"` | stacked translucent layers with feathered edges, a darker drying ring and granulation |
| `"ink"` | paper only: nitrogen stippled, oxygen hatched, sulphur cross-hatched, carbon plain |
| `"ink colour"` | as `ink`, but the hatching takes the element or residue colour |
| `"chalk"` | broad, dusty chalk strokes (the `chalkboard` look) |

### Depth in a surface

A surface is drawn as one patch per residue, back to front, and three cues show its depth. Each is a strength from 0
(off) to 1, and all three are on by default. Each fill shows them in its own way: watercolour pools more pigment in
the grooves, ink hatches them (cross-hatching the deepest), pencil and chalk scribble denser, flat and wash darken the
tone. With all three at 0, the other fills draw the surface the old way, as one outlined ball per atom.

| field | default | meaning |
|---|---|---|
| `surfaceDepth.edges` | `1` | a hand-drawn ink edge wherever a patch stands in front of something farther back, heavier the deeper the step (from 1.5 Å, full weight by 8 Å). Lobes and grooves read by their outlines, as in David Goodsell's paintings |
| `surfaceDepth.pooling` | `1` | the grooves hold more shadow: patches with nearer surface all around them are painted darker (the same colour, more of it) and, depending on the fill, granulated, hatched or scribbled more densely |
| `surfaceDepth.fade` | `1` | far patches fade towards the paper: paler, less painted, with lighter edges. It follows the depth fog, so `view.fog` and `view.fogStart` set how far back it starts and how strong it gets |

```python
fig.set(surfaceDepth={"edges": 1, "pooling": 0.5, "fade": 0})
fig.set(surfaceDepth={"edges": 0, "pooling": 0, "fade": 0})   # the flat wash, as before
```

## Colour

| field | default | meaning |
|---|---|---|
| `colorBy` | `"residue"` | what decides a carbon's colour: `"element"` (grey), `"residue"`, `"chain"`, `"subunit"` or `"entity"`. Other elements keep their element colours, and the automatic colours avoid blue and red so they never look like nitrogen or oxygen |
| `cartoonColor` | `"ss"` | the cartoon's colour: `"ss"` (by secondary structure: `palette.helix`, `sheet`, `loop`, `nucleic`), `"carbon"` (as the carbons, by `colorBy`) or `"rainbow"` (blue to red along each chain; engraved ribbons only) |
| `surfaceColor` | `"subunit"` | the surface's colour: `"single"` (`palette.surface`), `"residue"`, `"chain"`, `"subunit"` or `"entity"` (with every depth cue at 0, fills other than watercolour colour the surface by element) |
| `groupPalette` | `null` | the colours handed to residues, chains or molecules in order. Set it with `fig.palette(name)` rather than by hand; `null` means the built-in palette |
| `groupPaletteName` | `"MolSketch"` | the name of that palette (set by `fig.palette`) |
| `palette` | | the named colours, below |

To colour one residue, chain, subunit or entity yourself, use [`fig.color`](api.md#figcolorgroup-colour).

`palette` holds one CSS colour per role:

| key | colours |
|---|---|
| `paper` | the background paper |
| `ink` | outlines and lines |
| `hatch` | hatching and shading strokes |
| `wash` | the watercolour wash on the paper |
| `arrow` | curly arrows in a mechanism |
| `charge` | charge signs |
| `label` | label text |
| `context` | the faint pocket shape behind an active site in a scene |
| `accent` | highlights |
| `C`, `N`, `O`, `H`, `S`, `P` | the elements |
| `X` | any other element |
| `helix`, `sheet`, `loop`, `nucleic` | secondary structure, with `cartoonColor="ss"` |
| `surface` | the surface, with `surfaceColor="single"` |

```python
fig.set(palette={"paper": "#fbf7ee", "helix": "#de9151"})
```

## What to draw

`reps` holds the three selections (see [Selections](api.md#selections)). [`fig.show`](api.md#figshowsticks-cartoon-surface)
is the easier way to set them.

| field | default | meaning |
|---|---|---|
| `reps.sticks` | `"hetatm and not water"` | atoms drawn as sticks |
| `reps.cartoon` | `"polymer"` | residues drawn as cartoon |
| `reps.surface` | `""` | atoms drawn as surface (empty: none) |

`show` switches parts of the drawing on and off:

| field | default | meaning |
|---|---|---|
| `show.H` | `true` | hydrogen atoms |
| `show.valence` | `true` | double and triple bonds drawn as such |
| `show.hbonds` | `true` | hydrogen bonds, as dotted lines |
| `show.charges` | `true` | charge signs (scenes) |
| `show.lonePairs` | `true` | lone-pair dots (scenes) |
| `show.arrows` | `true` | curly arrows (scenes) |
| `show.caption` | `true` | a scene's caption |
| `show.stepLabel` | `true` | a scene's step title, top left (only with more than one keyframe) |
| `show.labels` | `true` | atom labels stored in a scene |
| `show.resLabels` | `false` | a label on every residue |
| `show.figLabels` | `true` | labels placed with `label` and `label_site` |
| `show.noLabels` | `false` | hide every label at once |
| `construction` | `false` | faint construction lines under the drawing, as in a pencil sketch |

[`fig.labels`](api.md#figlabelsshowtrue--placednone-atomsnone-residuesnone-secondarynone) sets the label switches
by name.

## The pen

`line` controls every stroke:

| field | default | meaning |
|---|---|---|
| `line.width` | `1.5` | ink width |
| `line.rough` | `1.1` | how much the pen wanders from the ideal line; 0 is ruler-straight |
| `line.passes` | `2` | how many times each line is drawn over itself; more passes look more sketched |
| `line.pressure` | `0.55` | how much the width swells and thins along a stroke, like a pen under changing pressure |
| `line.hierarchy` | `0.6` | how much heavier outlines are than inner lines; 0 makes every line the same weight |
| `fillWobble` | `1` | how far fills stray from the ink outline, as in hand colouring |

## Shading and hatching

| field | default | meaning |
|---|---|---|
| `shading` | `0.65` | how dark the shadow side of each shape is |
| `hatch.spacing` | `5` | the gap between hatching lines |
| `hatch.angle` | `-40` | the hatching direction, in degrees |
| `hatch.density` | `1.4` | how much of a shape the hatching covers |
| `pencilFill` | `0.55` | how dense the scribbles are, with `fill="pencil"` |
| `view.light` | `-125` | the direction the light comes from, in degrees around the picture (−125: top left) |

## Paper

| field | default | meaning |
|---|---|---|
| `paper.grain` | `0.6` | the paper's texture; 0 is smooth |
| `paper.wash` | `0.3` | how much watercolour wash is laid on the paper itself |
| `paper.washSeed` | `1` | which pattern of wash; change it for a different arrangement of blotches |
| `paper.washLife` | `0.6` | how much the wash changes from one drawing to the next in an animation |

## Engraved ribbons

These apply with `cartoonStyle="engraved"`:

| field | default | meaning |
|---|---|---|
| `engrave.lines` | `8` | lines drawn along each face of a ribbon |
| `engrave.width` | `0.45` | the weight of those lines |
| `engrave.strandThickness` | `0.6` | how thick strands are drawn (the dark edge seen side-on), Å |
| `engrave.coilWidth` | `1.25` | the width of coils and loops |
| `engrave.labels` | `false` | α1, β1 … on the helices and strands (also set by `fig.labels(secondary=True)`) |

## Active site

Usually set through [`fig.site`](api.md#figsiteselectionnone--ligandfalse-within50-cutawaynone-quietnone-scalenone).

| field | default | meaning |
|---|---|---|
| `site.sel` | `""` | the site's atoms, as a selection (empty: no site) |
| `site.cutaway` | `true` | open the ribbon in front of the site (engraved ribbons) |
| `site.quiet` | `0.35` | how much the rest of the protein fades, 0 to 1 |
| `site.scale` | `1.9` | how much thicker the site's sticks are |

## View and depth

The camera itself (turn, zoom, pan) is set with [`fig.view`](api.md#figviewyawnone-pitchnone-rollnone-zoomnone-pannone-fovnone).

| field | default | meaning |
|---|---|---|
| `view.fov` | `20` | field of view, in degrees; 0 is a flat, orthographic projection |
| `view.fog` | `0.5` | depth fog: how much the far side of the molecule fades into the paper, 0 to 1 |
| `view.fogStart` | `0.45` | how far back the fog starts, as a fraction of the molecule's depth |
| `view.light` | `-125` | see [Shading and hatching](#shading-and-hatching) |

## Labels and lettering

| field | default | meaning |
|---|---|---|
| `font` | `"Caveat"` | the lettering: `"Caveat"`, `"Patrick Hand"`, `"Kalam"` (handwritten) or `"Plain sans"` (IBM Plex Sans) |
| `labelSize` | `19` | label text size |
| `captionSize` | `24` | caption text size (scenes) |
| `annot` | `1` | the size of lone-pair dots, charge circles and arrow heads, relative to normal; raise it when the atoms are small on the page |

## Animation

| field | default | meaning |
|---|---|---|
| `boilHold` | `1` | how many drawn frames keep the same hand-drawn wobble before the lines are redrawn. 1 redraws every drawing, which makes the lines "boil" like hand animation; larger values keep them still for longer |

## Detail

| field | default | meaning |
|---|---|---|
| `detail` | `"auto"` | `"auto"`: with more than 260 drawn atoms, strokes get one pass and no scribbles, and with more than 600 surface patches, fewer watercolour layers and no drying ring (large structures draw faster and stay readable). `"full"`: the whole treatment always |
| `textureScale` | `"screen"` | `"screen"`: hatching, stroke widths and scribbles are sized in pixels. `"object"`: they scale with the drawing, so the texture on an atom stays the same however large it is drawn |

## Preview-only fields

These fields belong to the app's live GPU preview, the picture that follows the mouse while you drag. They do not
change what this package draws, or the app's finished figures and exports. They are kept so a style file saved from
the app round-trips unchanged.

| field | used for |
|---|---|
| `water.layers`, `water.wobble`, `water.ring`, `water.granulation`, `water.tone` | the preview's watercolour |
| `line.alpha` | the preview's line opacity |
| `paper.washScale` | the size of the preview's paper wash |
| `boilEvery` | the preview's line boil (the finished drawing uses `boilHold`) |
