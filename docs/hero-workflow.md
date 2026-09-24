# From computed states to a looping animation

This is the whole route from a mechanism you have coordinates for to a video on a page: what the app does, what
the scripts do, and where each decision lives. The CALB / pNPA loop in [`hero/calb`](../hero/calb) was made this way
and is the worked example throughout; `hero/render.sh calb` reproduces it.

There are two routes and they meet in the middle. The **app route** is for looking: load the scene, turn it, frame
it, try looks, then copy the render command. The **script route** is for repeating: a recipe file describes what to
draw, one tool builds the scene, one script renders and encodes. Both end at the same scene JSON and the same
`molsketch render`.

```
computed states ──mech2scene + recipe──▶ scene JSON ──app: look, frame, save──▶ scene JSON + style JSON
                                                                                       │
                                                   molsketch render (frames) ◀──────┘
                                                                │
                                                     ffmpeg: AV1 / VP9 / H.264 + poster  (hero/render.sh)
```

## 1. What the scene needs from you

A scene is keyframes: each one a set of atoms (id → element, position, charge, lone pairs), bonds with orders, and
the curly arrows that leave that state. [`scene-format.md`](scene-format.md) is the reference. Coordinates carry
positions and, through the SDF, bond orders and formal charges; everything else (which atoms to draw, arrows, lone
pairs, colours, what enters and leaves, the view) is a decision you write down once, in a recipe.

Keep the coordinates as they are. The engine has `path` for computed trajectories between states, `leave` and
`asNext` for a cycle that closes with molecules exchanged, and a camera with yaw, pitch and roll, so nothing about
the geometry has to be edited to make the picture read.

## 2. The script route: `tools/mech2scene.py`

```bash
python3 tools/mech2scene.py hero/calb/data/motif_01 hero/calb/recipe.json hero/calb/calb_hero.json
```

Input layout (a mechazyme export; anything with these files works). SDF bond lines may carry a `CFG=` stereo flag
after the two atoms; the reader takes them (an earlier version dropped those bonds, which is how the tetrahedral
intermediates lost their C–O⁻ bond — the app's *Checks* would have said so):

```
motif_01/
  state_00.sdf … state_05.sdf          V3000 SDF per state: positions, bond orders, formal charges
  atom_key.json                        per state: PDB serial → atom_map, residue, pdb name, element, charge
  chimerax/trajectory.pdb              optional: MODEL blocks, the built path between states
  chimerax/trajectory_serials.json     optional: atom_map → serial in the trajectory, frames, frames_per_segment
```

Atom maps are the stable ids across states; the recipe is written in them. When a trajectory is present the
keyframes take their positions from its keyframe rows (identical to the states except for anything the trajectory
carries as a rigid body) and the rows between two states become the keyframe's `path`, so the motion is continuous
through the keyframes and rings stay rings while atoms move.

### The recipe, key by key

`hero/calb/recipe.json` is complete and short; every key:

| key | what it is |
|---|---|
| `name` | the scene's name |
| `atoms` | atom map → drawn name, for every heavy atom to draw (and reacting hydrogens, which are heavy for this purpose: the transferring protons) |
| `groups` | group → its atom maps. A group is one residue or one molecule: it gets one colour, one `resn`, and is what `leave` and `enterAt` name. Ids are `GROUP:NAME` |
| `residues` | group → `[resn, resi]` written into the atoms, so the app's selections (`resi 105`) work |
| `het` | groups drawn as hetero (substrate, water) |
| `cut` | atom maps drawn as the pencil ball where a side chain is cut (its CA, usually) |
| `hydrogens` | `polar`: every H bonded to a drawn N or O is drawn; anything else: none beyond those in `atoms` |
| `hideCharges` | atom maps whose formal charge is not written (a nitro group's constant N⁺/O⁻) |
| `enterAt` | group → the state it first appears in; it arrives from where the trajectory has it one state earlier |
| `hbondMax` | Å; a drawn polar hydrogen within this of an N/O of another group it is not bonded to gets a hydrogen bond |
| `hold`, `transition` | frames per state and per step (24 fps timeline; drawings are every other frame) |
| `names`, `captions` | per state |
| `lonePairs` | state → atom maps that get a lone pair, drawn away from the atom's bonds; only where an arrow starts |
| `arrows` | state → arrows, `from`/`to` each `["lp", map]`, `["atom", map]` or `["bond", map, map]`; optional `side`, `bulge`, `curl` (default 0.8 Å: a floor on the bow so a π bond to its own oxygen still curls). The side is chosen to bow away from the drawing's centre in the recipe's view |
| `loop` | how the cycle closes: `site` (the atom the products leave away from), `leave` (groups that exit rather than morph into next cycle's copies), `leaveAtoms` (single ids that go with them, a proton on a leaving product), `asNext` (id → id: an atom that is next cycle's something else, the proton now on Ser that will be HG), `exitDistance`, `enterDistance` (Å), `enterTurn` (degrees; the entry line is the exit line turned in the picture plane so the substrate does not pass through the products), `transition` |
| `view` | `yaw`, `pitch`, `roll`, `fov`, `fog`, `fogStart`, and `zoom`, `panX`, `panY` if you know them; the CLI's `--fit` fills those in |
| `colors` | group → hex, the carbons of that group |

What the tool does not decide: the perspective (you), the framing (`--fit`), the look (the CLI or the app).

### Choosing the perspective

`app/scripts/views.mjs scene.json FRAME OUTDIR LOOK '[[yaw,pitch],…]'` renders one frame from a list of angles into
a folder; put them in a grid and look. Roll is a third angle in the same camera (`--roll` in the CLI, the slider in
the app); with it any orientation is reachable, which yaw and pitch alone cannot do (the CALB view is yaw 175,
pitch −20, roll 96: both rings face-on, the spectator residue behind the reacting atoms, the leaving group going
up and right). Set the three in the recipe's `view` and rebuild, or set them in the app and save the scene.

### Framing for a page

```bash
molsketch render scene.json --size 1920x1080 --fit 57,13,92,58 -o scene.json
molsketch render scene.json --size 1080x1920 --fit 11,15,89,45 -o mobile.json
```

`--fit L,T,R,B` (percent of the frame, x right, y down) sets zoom and pan so the drawing fills that box as far as
its aspect allows, centred; `--fit-what frame` measures the current frame instead of every keyframe. Writing the
result to a `.json` stores the fitted camera in the scene (or in a copy), so the file is self-contained from then on.
In Python: `fig.fit((0.57, 0.13, 0.92, 0.58), (1920, 1080)).save("scene.json")`.
The two boxes above are the site's hero: right of the headline and under the nav at 16:9, and the upper third of a
9:16 frame for phones; [`hero/README.md`](../hero/README.md) has the measurements behind them.

### Rendering and encoding

```bash
molsketch render scene.json --look dark-paper --frames drawn --size 1920x1080 -o frames \
  --set show.labels=false --set show.caption=false --set show.step_label=false --set annot=1.5 --set boil_hold=2
```

The same, from the app: *Render* in the panel encodes the loop with WebCodecs and downloads one file (AV1 › VP9 ›
H.264, whichever the browser has), with a poster; the command line is for the full set and for batches.

`hero/render.sh NAME` is that line plus the three encodes (AV1, VP9, H.264) and the poster, per named variant;
add a variant by adding a `case` line. `--look` names a look from `looks/`, `--style` a style saved from the app,
`--set` any style field. `boil_hold=2` re-jitters the strokes every second drawing while the atoms move on every one,
which roughly halves the video's bitrate. The scene's own camera wins over the look; flags win over both.

## 3. The app route

Open the app (`cd app && npm run dev`), drop the scene JSON on the canvas (or *Load example*). Then, in order:

**Look.** A *Looks* button, then anything in *Colour*, *Lines*, *Watercolour*, *Paper*. *Annotations* switches
labels, captions, arrows, charges and lone pairs. `annot` in the style scales lone-pair dots, charge circles and
arrow heads for drawings whose atoms are small on the page.

**View.** Drag to turn, the *roll* slider to turn the picture about the view axis, wheel to zoom, shift-drag to
pan. *Animation* scrubs the timeline; check every state, not just the first.

**Frame.** Pick a preset (*hero desktop*, *hero phone*, *centred*) or type a box in percent; *show guides* draws the
box on the canvas and dims the rest; *Fit to frame* sets zoom and pan for the whole animation or this frame. The
preview canvas is the frame: fractions of it are fractions of the rendered video, whatever the pixel size.

**Check.** *Checks* lists what the lint pass found on load: bonds that name missing atoms or are too long, arrows
anchored on nothing, lone-pair tails without a lone pair, ids that fade out or enter between keyframes, a loop that
closes by morphing. Hover the time slider in *Animation* to see what changes on the way to the next keyframe drawn
over the frame (moves, breaks, forms, leaves, arrives, charges).

**Chemistry.** Arrows, lone pairs and charges by clicking the drawing, when the recipe did not have them or you want
one more: *arrow* mode, click the tail then the head; *lone pair* and *charge* modes click an atom. The edits go into
the scene, and *Undo* takes them back.

**Time.** In *Animation* every keyframe has its hold and transition in seconds, *dup* (an identical copy after it, to
edit into a new state), ▲ ▼ and drag to reorder, and *cam*, which stores the current camera on the keyframe so the view
moves there during the transition before and holds through it (the *hero* loops keep one camera; a slow push-in over a
cycle is one *cam* on the first keyframe and another, zoomed, on the last).

**Perspective.** *Suggest views* in *View* scores 120 orientations (rings face-on, reacting atoms unhidden and apart,
wide, leaving groups up and right) and draws the best twelve; click one to take it, then *Fit to frame*. The CALB
view in the recipe was found the same way by hand; the button gives a dozen starting points in a second.

**Save.** *Save scene JSON* (the coordinates, the chemistry, the camera including roll and the fit, the keyframe
cameras) and *Save style*. *Copy render command* puts the CLI line that renders exactly this on the clipboard, naming
those two files.

**Render.** *Render* makes one video file here, in the browser (AV1, VP9 or H.264, whichever it can encode; the size
presets are the hero's), with a poster: enough to put on the page and look. For the site's three encodes with the
tuned ffmpeg settings, the script route from "Rendering and encoding" on.

**Look at it on the page.** `hero/mockup.html` draws a scene JSON live in the hero's slot with the engine, no render
needed: serve the repository root (`python3 -m http.server 8000`) and open
`http://localhost:8000/hero/mockup.html?scene=calb/calb_hero.json&look=dark-paper&set=show.labels=false,show.caption=false,show.stepLabel=false,annot=1.5,sphereScale=0.3`
(the `set` list is `render.sh`'s `--set` flags), or *Live scene…* on the page and pick the file. *Phone* switches to
`NAME_mobile.json` when it exists beside the scene.

## 4. What the engine adds for cycles and trajectories

`path` on a keyframe: intermediate poses (`{id: [x,y,z]}`) walked in order on the way to the next keyframe. Atoms
missing from a pose move straight. The easing (`arrowLead`, the smooth ramp) applies along the path.

`leave` on a keyframe: groups or ids that exit during the transition instead of matching same-named atoms in the
next keyframe. Their bonds fade whole (no breaking dots), and the next keyframe's same-named atoms enter fresh.
`asNext`: id → id, an atom that matches a differently named atom in the next keyframe. `exitDir` / `enterDir`: Å
vectors, the default `exitTo` / `enterFrom` for atoms without their own. Together these close a catalytic cycle
without a relabelling keyframe and without the products morphing into the substrate.

A bond present in one keyframe and not the next draws breaking (dots) when one of its atoms stays, and fades whole
when both leave. A double bond in one keyframe and single in the next fades between the two.

## 5. Checking

`app/scripts/frames.mjs scene.json LOOK OUTDIR '[28,118,208]' W H zoom '{"annot":1.5}'` renders given frames of a
scene at a size, with style overrides, in one browser session: the way to look at states and transitions before a
full render. State *k* of an N-state recipe with hold 30 and transition 60 has its arrows fully drawn at frame
`90·k + 28`. `app/scripts/mech.mjs` is the pixel-identity test of the classic engine against the reference image;
run it after touching the engine.
