# A mechanism figure from a stack of PDB files

The mechanism example was authored by hand as a scene. With real coordinates the route is: load the PDB stack as
keyframes, cut the view down to the atoms that matter, save the scene JSON, add the chemistry that coordinates
do not carry (arrows, charges, lone pairs, labels, captions), and render.

## 1. Prepare the files

One file per state, named so they sort in order (`step_01.pdb`, `step_02.pdb`, …). Atoms are matched between
files by residue name, residue number, chain and atom name, so keep those identical across the stack; an atom
present in one file and absent in the next fades out (or in), and a bond present in one file and not the next is
drawn breaking (dotted). Bonds are inferred from distance in every file, so bond formation and cleavage come from
the coordinates. If your stack already contains the interpolated frames, each file gets 2 frames by default; if
it has only the end states, raise `transition` in the JSON (step 3) to 40–60 so the engine interpolates.

## 2. Load and frame

In the app: *Open… (several = a stack)* and select all the files, or drop them together on the canvas. In the
CLI: `node cli/render.mjs step_*.pdb …`. The stack is oriented by its principal axes and the first frame
appears.

Then reduce the view to the mechanism. In *Representations*, set `cartoon` to nothing and `sticks` to the
catalytic atoms, for example

```
sticks:   (sidechain and resi 57+102+195) or resn SUB or resn HOH
```

Rotate until the triad reads (the example uses a flat, textbook-like view; real geometry rarely does, so pick the
angle where the attacking atom, the carbonyl and the histidine are all visible and not overlapping), set the
perspective and fog in *View* (the example uses fov 25, fog 0.3, fog start 0.4), and scrub the *Animation*
slider to check every state. *Save scene JSON* writes the stack, with the current selections, colours and camera,
as a scene file.

## 3. Add the chemistry

Open the JSON. Every keyframe has an `atoms` map keyed by id (`SER195.A:OG`) and a `bonds` list. Add, per
keyframe, what the figure needs; the full reference is [scene-format.md](scene-format.md).

```jsonc
"SER195.A:OG": { "el": "O", "pos": [..], "lp": [[-0.3, 1, 0]] },        // lone pair: a direction in Å
"SER195.A:CB": { "el": "C", "pos": [..], "sphere": true,                 // a cut point: big pencil ball
                 "label": "Ser195", "labelDir": [0.4, 1] },              // label and its screen direction
"SUB1.A:O1":   { "el": "O", "pos": [..], "charge": -1 },                 // circled charge (or "δ−")
```

```jsonc
"arrows": [
  { "from": { "lp": "HIS57.A:NE2", "i": 0 }, "to": { "bond": ["SER195.A:OG", "SER195.A:HG"] }, "bulge": 0.35, "side": 1 },
  { "from": { "bond": ["SER195.A:OG", "SER195.A:HG"] }, "to": { "atom": "SUB1.A:C1" }, "bulge": 0.35, "side": -1 }
],
"caption": "Ser195 attacks the carbonyl carbon; His57 takes the proton.",
"hold": 30, "transition": 60
```

Arrows belong to the keyframe they leave from and draw during the last 40 % of its hold. `hold` is how long the
state is shown, `transition` how many frames it takes to reach the next. Hydrogen bonds are bonds of order `0`.
Residue colours go in `groupColors` at the top level, keyed by residue and chain (`"SER195.A": "#f2e85a"`), or leave `colorBy: residue` to
the automatic palette. Delete atoms you do not want from the keyframes, or keep them and narrow the `sticks`
selection; the selection language is the same as in the app.

Load the JSON back (drop it on the canvas) and iterate: the classic engine draws it at rest, exactly as the CLI
will.

## 4. Render

```bash
cd app && npm run build
# one figure, the end of the first hold, at print size
node cli/render.mjs mechanism.json --look watercolour --frames 28 --size 2400x1800 --out fig
# the animation: one PNG per drawing, then a video
node cli/render.mjs mechanism.json --look watercolour --frames drawn --out frames
ffmpeg -framerate 12 -pattern_type glob -i 'frames/frame_*.png' -c:v libx264 -pix_fmt yuv420p -crf 16 mechanism.mp4
```

`--look ink-colour` or `--set fill=pencil --set construction=true` for the other looks; `--style my.json` for
a style saved from the app.
