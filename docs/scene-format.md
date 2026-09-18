# Scene JSON format

A scene is what the page animates. It is what *Save scene JSON* writes and what `render.js` reads when
given a `.json` input. Loading PDB/mmCIF files builds a scene automatically; the point of editing the JSON
is to add the things coordinates do not carry: curly arrows, charges, lone pairs, labels, captions, colours,
timing, and where atoms enter from and leave to.

```jsonc
{
  "name": "Serine hydrolase mechanism",
  "view": { "yaw": 0, "pitch": 0, "roll": 0, "zoom": 1, "panX": 0, "panY": 0, "fov": 25, "fog": 0.35, "fogStart": 0.4 },
  "reps": { "sticks": "all", "cartoon": "", "surface": "" },
  "groupColors": { "SER195": "#f2e85a", "HIS57": "#7cbf72", "ASP102": "#5fc9c9", "subunit:L": "#e6a45a" },
  "keyframes": [
    {
      "name": "Michaelis complex",
      "caption": "Substrate bound. Ser195 O–H is aimed at the carbonyl carbon.",
      "hold": 30,
      "transition": 60,
      "atoms": {
        "OG": { "el": "O", "pos": [2.6, -2.5, 0.2], "lp": [[-0.3, 1, 0]],
                "resn": "SER", "resi": 195, "chain": "", "name": "OG", "group": "SER195" },
        "HG": { "el": "H", "pos": [1.6, -2.3, 0.25] },
        "CB": { "el": "C", "pos": [3.3, -3.7, 0.0], "sphere": true,
                "label": "Ser195", "labelDir": [0.4, 1] },
        "O1": { "el": "O", "pos": [2.9, 1.7, 0.5], "charge": -1 }
      },
      "bonds": [ ["OG", "HG", 1], ["OG", "CB", 1], ["HG", "NE2", 0] ],
      "arrows": [
        { "from": { "lp": "NE2", "i": 0 }, "to": { "bond": ["OG", "HG"] }, "bulge": 0.35, "side": 1 },
        { "from": { "bond": ["OG", "HG"] }, "to": { "atom": "C1" }, "bulge": 0.35, "side": -1 }
      ]
    }
  ]
}
```

## Top level

| key | meaning |
|---|---|
| `name` | shown in the SVG title |
| `view` | optional camera applied when the scene loads: `yaw`, `pitch`, `roll` (degrees; roll turns the picture about the view axis, after yaw and pitch), `zoom`, `panX`, `panY` (fractions of the canvas), `fov`, `fog`, `fogStart`. The CLI's `--fit … --write-view` fills in zoom and pan for a target box |
| `reps` | the three selections: `sticks`, `cartoon`, `surface` (empty string = off) |
| `groupColors` | colour overrides, keyed by residue (`SER195`), chain ID (`A`), `subunit:S/L/T/X`, `entity:<id>` |
| `keyframes` | the list below, in order |
| `fromPdb` | set by the PDB loader; lets *frames per PDB* rewrite `hold`/`transition` |

## Keyframe

| key | meaning |
|---|---|
| `name` | step title drawn in the corner and shown in the transport |
| `caption` | handwritten caption under the drawing; fades out before the next fades in |
| `hold` | frames the pose is held (default 24). Arrows draw during the last 40 % of the hold |
| `transition` | frames to reach the next keyframe (default 48). Atom motion starts at `arrowLead` × transition |
| `atoms` | map of atom id → atom |
| `bonds` | list of `[a, b, order]` or `{a, b, order}`; order `0` is a hydrogen bond (dotted), `2`/`3` draw valence sticks |
| `arrows` | curly arrows shown while leaving this keyframe |
| `path` | optional list of intermediate poses, each a map of atom id → `[x, y, z]`, walked in order on the way to the next keyframe (a computed trajectory instead of a straight line; atoms missing from a pose move straight) |
| `leave` | groups or ids that exit during the transition instead of matching same-named atoms in the next keyframe (products going out while an identical substrate comes in); their bonds fade whole |
| `asNext` | map id → id: an atom that matches a differently named atom in the next keyframe (the proton now on Ser that is next cycle's HG) |
| `exitDir`, `enterDir` | `[dx, dy, dz]` in Å: the default `exitTo` for atoms leaving this keyframe, and the default `enterFrom` for atoms arriving in it, when they have none of their own |
| `view` | optional camera for this keyframe: `yaw`, `pitch`, `roll`, `zoom`, `panX`, `panY` (any subset; the rest come from the scene's `view`). The camera holds it through the keyframe and moves to it smoothly during the transition before (angles the short way round, zoom geometrically). A keyframe without one keeps the camera of the nearest earlier keyframe that has one, cyclically, so a `view` on the first keyframe alone fixes the camera for the loop. The app's *cam* button writes it |

The last keyframe transitions back to the first when looping.

## Atom

| key | meaning |
|---|---|
| `el` | element symbol (`C`, `N`, `O`, `H`, `S`, `P`, …); drives colour, radius and pen texture |
| `pos` | `[x, y, z]` in Å |
| `charge` | `-1`, `1`, `2`, or a string such as `"δ−"`, `"δ+"`; drawn circled beside the atom, fades in/out |
| `lp` | list of lone-pair directions `[[dx, dy, dz], …]`; each draws as two dots; arrows can start from `{"lp": id, "i": n}` |
| `label` | text; `labelDir` `[dx, dy]` is the screen direction from the atom |
| `labelAuto` | true on labels the PDB loader wrote; they show only with *residue labels* on |
| `color` | palette key (`accent`, `C`, …) or a hex colour; overrides every scheme for this atom |
| `sphere` | draw a small sphere here (sticks mode) — cut points, Cα |
| `r` | radius in Å (ball-and-stick only) |
| `opacity` | 0–1 |
| `enterFrom` | position the atom appears from when it does not exist in the previous keyframe |
| `exitTo` | position the atom leaves to when it does not exist in the next keyframe |
| `resn`, `resi`, `chain`, `name`, `het`, `group` | residue bookkeeping used by selections and colour schemes |
| `nucleic`, `trace`, `ss`, `entity`, `subunit` | set by the loader; `ss` is `H`/`E`/`L`/`N` and can be edited to force secondary structure |

Atoms are matched between keyframes by id. An atom present in both interpolates; present only in the
earlier one it fades out (moving to `exitTo` if given); present only in the later one it fades in (from
`enterFrom` if given).

## Bonds between keyframes

A bond in both keyframes with the same order is solid. Different orders interpolate (the extra valence stick
grows in or out). A bond only in the earlier keyframe is drawn breaking (dots, fading); only in the later,
forming (dots, strengthening).

## Arrows

Each arrow has a `from` and `to` anchor, an optional `bulge` (curvature, fraction of the arrow length,
default 0.4), `side` (+1 / −1, which way it bows) and `curl` (a floor on the bow in Å, so that a short arrow — a π bond to its own oxygen — still curls; default 0).

Anchors: `{"atom": id}` (the atom's edge, facing the other end), `{"bond": [a, b]}` (the bond midpoint),
`{"lp": id, "i": n}` (the n-th lone pair's dots). Arrows draw with a growing stroke during the hold, stay
until the motion begins, then fade.

## Timing

Frame count = Σ (hold + transition). At `fps` 24 with `stepEvery` 2 the animation shows 12 drawings a
second. `render.js --list` prints the timeline; `--frames drawn` renders one file per drawing.

## Minimal hand-written example

```json
{
  "keyframes": [
    { "name": "before", "hold": 12, "transition": 24,
      "atoms": { "A": {"el":"O","pos":[0,0,0],"lp":[[0,1,0]]}, "B": {"el":"C","pos":[2.8,0,0]}, "X": {"el":"N","pos":[4.2,0,0]} },
      "bonds": [["B","X",1]],
      "arrows": [ {"from":{"lp":"A","i":0},"to":{"atom":"B"},"bulge":0.4,"side":1},
                  {"from":{"bond":["B","X"]},"to":{"atom":"X"},"bulge":0.4,"side":-1} ] },
    { "name": "after", "hold": 12, "transition": 24,
      "atoms": { "A": {"el":"O","pos":[1.3,0,0]}, "B": {"el":"C","pos":[2.8,0,0]}, "X": {"el":"N","pos":[5.5,0,0],"charge":-1,"exitTo":[8,0,0]} },
      "bonds": [["A","B",1]] }
  ]
}
```
