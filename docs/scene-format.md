# Scene JSON format

A scene is what MolSketch animates. It is what the app's *Save scene* and Python's `fig.save("fig.json")` write, and
what the app, `molsketch.scene(...)` and `molsketch render scene.json` read. Loading PDB/mmCIF files builds a scene automatically; the point of editing the JSON
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
| `view` | optional camera applied when the scene loads: `yaw`, `pitch`, `roll` (degrees; roll turns the picture about the view axis, after yaw and pitch), `zoom`, `panX`, `panY` (fractions of the canvas), `fov`, `fog`, `fogStart`. `molsketch render scene.json --fit … -o scene.json` fills in zoom and pan for a target box |
| `reps` | the three selections: `sticks`, `cartoon`, `surface` (empty string = off) |
| `groupColors` | colour overrides, keyed by residue (`SER195`), chain ID (`A`), `subunit:S/L/T/X`, `entity:<id>` |
| `labels` | labels placed on the figure: `{ "text", "at": atom id, "dx", "dy" }` follows that atom (the text sits `dx`, `dy` px off it, with a leader once it is far enough), or `{ "text", "x", "y" }` stays at that fraction of the canvas; optional `"size"` scales the label size |
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
| `orbitals` | orbitals drawn as lobes (below); they fade out over the first half of the motion to the next keyframe and the next keyframe's fade in over the second |
| `measures` | distances, angles and torsions measured from the atoms and drawn with their values (below); they fade as orbitals do |
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
`{"lp": id, "i": n}` (the n-th lone pair's dots, wherever they are drawn: beside the atom, or inside an orbital that
took that pair), `{"orbital": k}` (the middle of the k-th orbital's main lobe, counting from 0; `"lobe": j` picks
another of its lobes). Arrows draw with a growing stroke during the hold, stay
until the motion begins, then fade.

## Orbitals

Each entry of a keyframe's `orbitals` draws one orbital as lobes about its atoms. The lobes are solids, projected with
the camera and sorted in depth with the sticks, so a lobe pointing at the viewer reads as a round blob and one behind an
atom is hidden by it; their geometry is recomputed from the atoms in every frame, so they ride along through a
transition. One phase is shaded and the other left blank. The colour says whether the orbital holds electrons:
`palette.filled` (a lone pair, a σ or π bond) or `palette.empty` (σ*, π*, an empty p), and a filled orbital shows its
pair of electrons as two bold dots in its main lobe.

```jsonc
"orbitals": [
  { "type": "n", "atom": "O", "lp": 0, "label": "n(O)" },              // the lone pair O's lp[0] points along
  { "type": "sigma*", "bond": ["C", "Br"], "label": "σ*(C–Br)" },      // the large lobe behind C
  { "type": "pi*", "bond": ["C", "O"], "toward": "Nu" },               // its shaded C lobe faces the nucleophile
  { "type": "p", "atom": "B", "toward": "N", "label": "p(B), empty" }
]
```

| `type` | what it draws |
|---|---|
| `n` (also `lp`) | a lone pair: one lobe on `atom`, along `dir` (Å), along the atom's lone pair `lp` (its index), toward the atom `toward`, or else away from the atom's bonds. Tying it to `lp` moves that pair's dots into the lobe, and arrows from `{"lp": atom, "i": n}` then start there |
| `p` | two lobes of opposite phase along `axis`, the normal of the plane through `plane` (three atom ids), or the normal of the plane the atom makes with its neighbours; `toward` turns it so the shaded lobe faces that atom. Empty by default; `"electrons": 2` for a carbanion |
| `pi`, `pi*` | p lobes on both atoms of `bond`, in phase (π) or out of phase (π*); the axis as for `p`, from the first atom's plane. In π* the first atom carries the larger coefficient (list the C of a C=O first) |
| `sigma` | the bonding orbital of `bond`: one lobe enclosing the bond, its electrons either side of the stick |
| `sigma*` | the antibonding orbital of `bond`: a large lobe behind the first atom (where a nucleophile attacks), small lobes of opposite phase facing each other across the node, and a lobe behind the second atom |
| `lobe` | one lobe on `atom` along `dir`, `length` and `width` in Å |

Every orbital also takes `size` (scales its lobes; 1 is a 1.1–1.35 Å main lobe), `phase` (−1 swaps which lobes are
shaded), `electrons` (overrides the type's: 0 draws it as empty), `dots: false` (no electrons drawn), `color` (a hex
colour or palette key, instead of filled/empty), `opacity`, `label` (placed beside its main lobe, clear of atoms, bonds
and other labels), and `id` (an orbital with the same id in the next keyframe stays instead of fading out and in).

How lobes are drawn follows the look: in the engraved looks they are inked solids with a ruled tint in the orbital's
colour (filled and empty orbitals ruled at right angles to each other) and the other phase white, and what lies behind
a lobe is knocked back; in the other looks the shaded phase is a wash, scribble or hatching in the look's medium. The
style's `orbitalStyle` (`auto`, `engraved`, `sketch`) chooses, and `show.orbitals` hides them all.

## Measures

A measure draws a piece of geometry with the value read from the drawn atoms, so the number is the picture's own:

```jsonc
"measures": [
  { "distance": ["Nu", "C"], "window": [2.95, 0.45] },               // dashed line, "2.95 Å", the window as a band
  { "angle": ["Nu", "C", "O"], "window": [105, 10], "radius": 0.5 }, // arc at C, "105°", the window as a wedge
  { "torsion": ["H1", "O", "C", "Nu"], "label": "τ(H–O=C···O) {v}" }
]
```

| key | meaning |
|---|---|
| `distance`, `angle`, `torsion` | 2, 3 or 4 atom ids; an angle is at its middle atom, a torsion is the dihedral of the four (IUPAC sign) |
| `window` | `[target, tolerance]`: the positions the value may take, drawn behind everything as a band along the distance (from its first atom) or a wedge at the angle's vertex (measured from the second arm toward the first), stippled in a line medium and washed otherwise |
| `label` | the text: `{v}` is the measured value with its unit, `{target}`, `{tol}` and `{window}` (`105 ± 10°`) come from `window`; default `{v}` (`τ {v}` for a torsion) |
| `radius` | an angle's arc, in Å (default 0.5) |
| `reach` | how far a window's wedge reaches, in Å (default the smaller of 1.6 and half the first arm) |
| `side` | `1` / `-1`: which side of a distance or torsion its label goes, or above / below a straight angle's axis |
| `id`, `opacity` | as for orbitals |

A distance between two bonded atoms draws no line, only its value. `show.measures` hides them all.

## Lone pairs

An atom's `lp` directions draw as two dots each. The style's `lonePairStyle` sets how: `dots` (small, beside the atom),
`bold` (larger dots set off from the atom, spread so that pairs, bonds and the charge do not collide; the Textbook
look's), or `lobes` (each pair as a small lobe holding its electrons). A pair an `n` orbital took (its `lp`) is drawn in
that orbital's lobe instead.

`python/molsketch/geometry.py` builds atoms from internal coordinates and lone-pair directions for them; see
[the reaction figures](reaction-figures.md).

## Timing

Frame count = Σ (hold + transition). At `fps` 24 with `stepEvery` 2 the animation shows 12 drawings a
second. In Python, `fig.frames("keyframes")` lists where each keyframe's hold starts and `fig.frames("drawn")` every
frame with a new drawing; `molsketch render scene.json --frames drawn -o frames` renders one file per drawing.

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
