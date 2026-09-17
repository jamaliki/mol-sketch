# CALB / p-nitrophenyl acetate — the real one

The serine hydrolase in `hero/` is a hand-drawn schematic. This one is *Candida antarctica* lipase B hydrolysing
p-nitrophenyl acetate, built from mechazyme's export `calb_pnpa_animation_v1`, motif_01: six computed states, the
compiled 14-arrow mechanism, and the rigid-fragment trajectory between the states. Every atom position in the
animation is one of theirs; the drawing adds nothing to the coordinates.

```bash
python3 build_scene.py data/motif_01 calb_hero.json --yaw 175 --pitch -20 --roll 96   # the scene (view C)
cd .. && ./render.sh calb            # 1920x1080 on dark paper  → out/hero_calb.{mp4,webm}, poster
          ./render.sh calb-chalk      # the same as chalk on the board
          ./render.sh calb-mobile     # 1080x1920 for phones;  calb-chalk-mobile likewise
```

`data/` holds exactly what the build reads: the six `state_0k.sdf` (positions, bond orders, formal charges),
`atom_key.json` (serial → atom map, name, element, charge, per state), the 201-frame `chimerax/trajectory.pdb` with
its `trajectory_serials.json`, and mechazyme's own README and NOTES, which are the source for everything below.

## What is drawn, and what is not

Keyframes are the six states; their positions are taken from the trajectory's keyframe rows, which reproduce the
exported states to 0.001 Å except Gln106, which the trajectory carries as a rigid body (its shape frozen at
state_00) — so the motion is continuous through every keyframe. Between keyframes the 39 intermediate rows of the
trajectory are the `path` (a new keyframe field): the engine walks them instead of a straight line, so rings stay
rings and X–H bonds keep their length while the proton flies. The trajectory is an interpolation, not a reaction
coordinate; the states are the computed points.

Bonds and bond orders are the SDF's, per state; a bond present in one state and not the next is drawn breaking, and
the double bond of the carbonyl fades to single as the oxyanion forms. Hydrogen bonds are measured, not assumed: a
drawn polar hydrogen within 2.4 Å of an N or O it is not bonded to, in another residue. That gives Ser-OH···His
NE2 in the Michaelis complex, Gln106 NE2-H···O2 in both tetrahedral intermediates (the oxyanion stabiliser the
gate accepted), water HW1···NE2 in the acyl-enzyme, His NE2-H···OG for the alkoxide, and nothing to Asp187.

Formal charges are the SDF's: O2 −1 and His +1 in states 1 and 3, Ser OG −1 and His +1 in state 4. The nitro
group's constant N⁺/O⁻ pair is not written (a display choice). The 14 curly arrows are mechanism.mech.yaml's, tail
→ head, anchored on the atoms, bonds and lone pairs they name; lone pairs are drawn only where an arrow starts, in
the direction away from the atom's bonds. Short arrows (a π bond to its own oxygen) get a `curl` floor so they still
read as arrows.

Left out, and why: Asp187 sits 15 Å from His224 in every state with no triad hydrogen bond, and Thr40 is 4.8–8.4 Å
from the oxyanion, so neither is part of the chemistry here, and both are re-posed as different rotamers between
states (mechazyme's NOTES say the same and drop them from the movie). Side chains are cut at CA (Ser and His get
the pencil ball; Gln ends in a stub because its CA sits on the phenyl in this view). Only polar hydrogens are drawn:
the two transferring protons, water's second hydrogen, Gln's NE2-H₂ and His HD1. The water is shown from the state
it enters (state 2), arriving from where the trajectory parks it in states 0–1.

## The loop

State 5 is the resting enzyme with both products still present. A seventh keyframe, the same pose with the product
atoms under retired ids and the proton now on Ser renamed to next cycle's HG, lets the cycle close honestly: acetic
acid and p-nitrophenol drift out along the site's exit line, a fresh pNPA drifts in from another direction, and Ser,
His and Gln are already regenerated. Without it the engine would morph the products back into the substrate.
Timing: each state holds 30 frames (arrows draw in the last 40 %), each step takes 60, the products leave over 48;
530 frames, 265 drawings, 22 s at 12 fps.

## The view

`--yaw 175 --pitch -20 --roll 96` is baked into the coordinates as one rigid rotation (roll is what the camera's
yaw and pitch alone cannot give), so the scene loads at yaw 0, pitch 0 and the app's orbit starts from it. It was
chosen from a scored search over orientations: His224's imidazole and the phenyl face-on, Gln106 behind the
reacting atoms rather than in front of them, the core wide rather than tall, and the phenol leaving to the upper
right, away from the headline. The arrow sides are chosen in that projection to bow away from the drawing's centre.

## Colours

Ser105 `#f97316` (the site's orange, the nucleophile), His224 `#fbbf24`, Gln106 `#8a8580` (a spectator, so it
recedes), the acetyl and water `#d6d3d1`, p-nitrophenol `#7dd3fc` — the guest molecule in the one cool colour;
oxygen `#fb923c`, nitrogen `#a5b4fc`, hydrogens, ink and arrows `#f2efe8`. The chalk variant uses the same palette
with the `chalkboard` look.
