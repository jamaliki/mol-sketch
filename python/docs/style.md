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

Names are snake_case, as in Python. A style file saved from the app uses the same fields with camelCase names
(`surface_depth` is `surfaceDepth` there); `apply_style` and `set` accept those too.

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
| `stick_radius` | `0.2` | stick radius, Å |
| `sphere_scale` | `0.4` | in `"sticks"` mode, the size of the balls on atoms marked as spheres (a protein's Cα atoms, and atoms a scene marks); 0 draws them as plain stick ends |
| `cartoon_scale` | `1` | width of the cartoon ribbons and tubes, relative to normal |
| `cartoon_style` | `"engraved"` | `"engraved"`: white ribbons shaded with lines along their length, after MOLSCRIPT. `"sketch"`: ribbons filled in the style of `fill` |
| `stick_style` | `"auto"` | whether sticks follow the engraved style too: `"auto"` (when the ribbons are engraved), `"engraved"` (always) or `"sketch"` (never) |
| `side_chain_helper` | `true` | where a residue is drawn as cartoon, leave its backbone atoms out of the sticks, so only the side chain sticks out of the ribbon |
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
| `surface_depth.edges` | `1` | a hand-drawn ink edge wherever a patch stands in front of something farther back, heavier the deeper the step (from 1.5 Å, full weight by 8 Å). Lobes and grooves read by their outlines, as in David Goodsell's paintings |
| `surface_depth.pooling` | `1` | the grooves hold more shadow: patches with nearer surface all around them are painted darker (the same colour, more of it) and, depending on the fill, granulated, hatched or scribbled more densely |
| `surface_depth.fade` | `1` | far patches fade towards the paper: paler, less painted, with lighter edges. It follows the depth fog, so `view.fog` and `view.fog_start` set how far back it starts and how strong it gets |

```python
fig.set(surface_depth={"edges": 1, "pooling": 0.5, "fade": 0})
fig.set(surface_depth={"edges": 0, "pooling": 0, "fade": 0})   # the flat wash, as before
```

## Colour

| field | default | meaning |
|---|---|---|
| `color_by` | `"residue"` | what decides a carbon's colour: `"element"` (grey), `"residue"`, `"chain"`, `"subunit"` or `"entity"`. Other elements keep their element colours, and the automatic colours avoid blue and red so they never look like nitrogen or oxygen |
| `cartoon_color` | `"ss"` | the cartoon's colour: `"ss"` (by secondary structure: `palette.helix`, `sheet`, `loop`, `nucleic`), `"carbon"` (as the carbons, by `color_by`) or `"rainbow"` (blue to red along each chain; engraved ribbons only) |
| `surface_color` | `"subunit"` | the surface's colour: `"single"` (`palette.surface`), `"residue"`, `"chain"`, `"subunit"` or `"entity"` (with every depth cue at 0, fills other than watercolour colour the surface by element) |
| `group_palette` | `null` | the colours handed to residues, chains or molecules in order. Set it with `fig.palette(name)` rather than by hand; `null` means the built-in palette |
| `group_palette_name` | `"MolSketch"` | the name of that palette (set by `fig.palette`) |
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
| `helix`, `sheet`, `loop`, `nucleic` | secondary structure, with `cartoon_color="ss"` |
| `surface` | the surface, with `surface_color="single"` |

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
| `show.lone_pairs` | `true` | lone-pair dots (scenes) |
| `show.arrows` | `true` | curly arrows (scenes) |
| `show.caption` | `true` | a scene's caption |
| `show.step_label` | `true` | a scene's step title, top left (only with more than one keyframe) |
| `show.labels` | `true` | atom labels stored in a scene |
| `show.res_labels` | `false` | a label on every residue |
| `show.fig_labels` | `true` | labels placed with `label` and `label_site` |
| `show.no_labels` | `false` | hide every label at once |
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
| `fill_wobble` | `1` | how far fills stray from the ink outline, as in hand colouring |

## Shading and hatching

| field | default | meaning |
|---|---|---|
| `shading` | `0.65` | how dark the shadow side of each shape is |
| `hatch.spacing` | `5` | the gap between hatching lines |
| `hatch.angle` | `-40` | the hatching direction, in degrees |
| `hatch.density` | `1.4` | how much of a shape the hatching covers |
| `pencil_fill` | `0.55` | how dense the scribbles are, with `fill="pencil"` |
| `view.light` | `-125` | the direction the light comes from, in degrees around the picture (−125: top left) |

## Paper

| field | default | meaning |
|---|---|---|
| `paper.grain` | `0.6` | the paper's texture; 0 is smooth |
| `paper.wash` | `0.3` | how much watercolour wash is laid on the paper itself |
| `paper.wash_seed` | `1` | which pattern of wash; change it for a different arrangement of blotches |
| `paper.wash_life` | `0.6` | how much the wash changes from one drawing to the next in an animation |

## Engraved ribbons

These apply with `cartoon_style="engraved"`:

| field | default | meaning |
|---|---|---|
| `engrave.lines` | `8` | lines drawn along each face of a ribbon |
| `engrave.width` | `0.45` | the weight of those lines |
| `engrave.strand_thickness` | `0.6` | how thick strands are drawn (the dark edge seen side-on), Å |
| `engrave.coil_width` | `1.25` | the width of coils and loops |
| `engrave.labels` | `false` | α1, β1 … on the helices and strands (also set by `fig.labels(secondary=True)`) |

## Active site

Usually set through [`fig.site`](api.md#figsiteselectionnone--ligandfalse-within50-cutawaynone-quietnone-scalenone).

| field | default | meaning |
|---|---|---|
| `site.sel` | `""` | the site's atoms, as a selection (empty: no site) |
| `site.cutaway` | `true` | open the ribbon in front of the site (engraved ribbons) |
| `site.quiet` | `0.35` | how much the rest of the protein fades, 0 to 1 |
| `site.scale` | `1.9` | how much thicker the site's sticks are |

## Density maps

Usually set through [`fig.map`](api.md#figmapsourceauto--levelnone-sigmanone-local_resolutionnone-max_voxels320-style)
(`fig.map(shade=0.5)` sets `map.shade`). The guide is [docs/maps.md](../../docs/maps.md).

| field | default | meaning |
|---|---|---|
| `map.style` | `"surface"` | `"surface"`, `"layers"` (nested contours), `"mesh"` (chicken wire) or `"slice"` (a stippled section) |
| `map.level` | `null` | the contour level, in the map's units (`null`: `map.sigma`, else the recommended level, else mean + 3σ) |
| `map.sigma` | `null` | the contour level in σ above the mean |
| `map.levels` | `[0.7, 1, 1.5]` | the contours of `"layers"`, as multiples of the level |
| `map.smooth` | `"auto"` | low-pass to this many Å (`0`: none). `"auto"`: to a 20th of what is drawn, at least 4 Å, for whole particles; the density above the level is smoothed and contoured to enclose the molecule's mass |
| `map.finish` | `"drawn"` | `"drawn"`: a smoothed surface in the chosen marks · `"smooth"`: plainly lit, ChimeraX-like · `"sketch"`: the raw grid, hand-drawn |
| `map.marks` | `"ink"` | `"ink"`: outline and hatching in every look · `"look"`: the look's own marks (a watercolour gradient) |
| `map.smoothing` | `4` | Taubin smoothing steps of the surface |
| `map.shade` | `0.35` | how much shading, 0 (outline only) to 1 |
| `map.line` | `null` | the outline's colour (`null`: the look's ink) |
| `map.line_width` | `0.9` | the outline's weight |
| `map.opacity` | `0.55` | how opaque the map is over a model (`map.layer="over"`) |
| `map.speck` | `8` | islands and holes smaller than this, in pixels, are left out |
| `map.crop` | `8` | with a model: the map is cropped to the model's box and this margin, Å |
| `map.zone` | `""` | a selection: the map closely around it only, at full resolution, for close-ups |
| `map.carve` | `0` | keep only the density this close to the model (or the zone), Å; `0` off |
| `map.context` | `"hide"` | with a model: the rest of an assembly beyond it `"hide"` (only the density within 5 Å of the model is kept) or `"show"` (drawn faintly) |
| `map.unsupported` | `true` | a small accent circle on residues mostly outside the density |
| `map.unexplained` | `false` | density the model does not explain in the accent colour |
| `map.local_resolution` | `"none"` | `"bfactor"` or `"map"`: lines looser where the resolution is worse |
| `map.layer` | `"auto"` | with a model: `"behind"` it (the default for surfaces: the model is drawn over the map and keeps its colour), `"over"` it as a translucent envelope (`map.opacity`), or `"lines"` (only the map's outline, over the model) |
| `map.caption` | `true` | the line under the drawing that says how the map is shown |
| `map.max_voxels` | `192` | the largest grid drawn from, per side (larger maps are averaged down) |
| `map.mesh_spacing` | `1` | Å between the mesh's planes |
| `map.slice.offset`, `map.slice.cut` | `0`, `true` | where the slice lies (−0.5 to 0.5 of the depth), and whether what is in front of it is cut away |

## View and depth

The camera itself (turn, zoom, pan) is set with [`fig.view`](api.md#figviewyawnone-pitchnone-rollnone-zoomnone-pannone-fovnone).

| field | default | meaning |
|---|---|---|
| `view.fov` | `20` | field of view, in degrees; 0 is a flat, orthographic projection |
| `view.fog` | `0.5` | depth fog: how much the far side of the molecule fades into the paper, 0 to 1 |
| `view.fog_start` | `0.45` | how far back the fog starts, as a fraction of the molecule's depth |
| `view.light` | `-125` | see [Shading and hatching](#shading-and-hatching) |

## Labels and lettering

| field | default | meaning |
|---|---|---|
| `font` | `"Caveat"` | the lettering: `"Caveat"`, `"Patrick Hand"`, `"Kalam"` (handwritten) or `"Plain sans"` (IBM Plex Sans) |
| `label_size` | `19` | label text size |
| `caption_size` | `24` | caption text size (scenes) |
| `annot` | `1` | the size of lone-pair dots, charge circles and arrow heads, relative to normal; raise it when the atoms are small on the page |

## Animation

| field | default | meaning |
|---|---|---|
| `boil_hold` | `1` | how many drawn frames keep the same hand-drawn wobble before the lines are redrawn. 1 redraws every drawing, which makes the lines "boil" like hand animation; larger values keep them still for longer |

## Detail

| field | default | meaning |
|---|---|---|
| `detail` | `"auto"` | `"auto"`: with more than 260 drawn atoms, strokes get one pass and no scribbles, and with more than 600 surface patches, fewer watercolour layers and no drying ring (large structures draw faster and stay readable). `"full"`: the whole treatment always |
| `texture_scale` | `"screen"` | `"screen"`: hatching, stroke widths and scribbles are sized in pixels. `"object"`: they scale with the drawing, so the texture on an atom stays the same however large it is drawn |

## Preview-only fields

These fields belong to the app's live GPU preview, the picture that follows the mouse while you drag. They do not
change what this package draws, or the app's finished figures and exports. They are kept so a style file saved from
the app round-trips unchanged.

| field | used for |
|---|---|
| `water.layers`, `water.wobble`, `water.ring`, `water.granulation`, `water.tone` | the preview's watercolour |
| `line.alpha` | the preview's line opacity |
| `paper.wash_scale` | the size of the preview's paper wash |
| `boil_every` | the preview's line boil (the finished drawing uses `boil_hold`) |
