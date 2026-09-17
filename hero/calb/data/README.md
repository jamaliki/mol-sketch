# CALB / p-nitrophenyl acetate — ordered catalytic cycle for animation

Regenerated from `benchmarks/ester_hydrolysis/examples/calb_de_novo_passes_v1`.
Every `.pdb` and `.sdf` here is **byte-identical** to the SHA-256 recorded in that
directory's `manifest.json` (24/24 verified). Coordinates come from the
full-precision arrays in each motif's `result.json`, written through the same
code path as `scripts/mcsa_benchmark.py::export`.

Case: `benchmarks/ester_hydrolysis/cases/calb_pnpa_v1` (literature case, not an
M-CSA import). Mechanism: `mechanism.mech.yaml`, 5 elementary steps, 6 states,
14 curly arrows, 8 compiler-recognized electronic events.

## Play order

| # | file | state |
|---|---|---|
| 1 | `state_00.pdb` / `.sdf` | Michaelis complex — pNPA bound, Ser-OH intact, His neutral (ND1-H) |
| 2 | `state_01.pdb` / `.sdf` | First tetrahedral intermediate — oxyanion on O2, His imidazolium |
| 3 | `state_02.pdb` / `.sdf` | Acyl-enzyme + p-nitrophenol; water has entered |
| 4 | `state_03.pdb` / `.sdf` | Second tetrahedral intermediate from water attack, His imidazolium |
| 5 | `state_04.pdb` / `.sdf` | Acetic acid formed, Ser alkoxide released, His still protonated |
| 6 | `state_05.pdb` / `.sdf` | Resting state restored — neutral Ser-OH, neutral His, products present |

Use the **SDF** for anything that draws bonds or charges: PDB carries neither
bond orders nor formal charges, and every arrow in this mechanism is a change in
one or the other. `atom_key.json` maps each PDB serial to its atom map, residue,
atom name, element and formal charge, per state — use it to highlight the atoms
an arrow touches.

**Trap: substrate PDB atom names are not atom maps.** RDKit had no names for the
substrate, so it fell back to element+index. In `state_00.pdb`, `C2` is atom map 1
(the carbonyl carbon) and `O3` is atom map 2 (the oxyanion) — off by one from what
the name suggests. Protein atoms are named correctly (`OG`, `NE2`, ...); hydrogens
are also fallbacks. Always resolve through `atom_key.json`, which carries both
`pdb_atom_name` and the chemical `atom_name` for every serial.

## Two motifs

`motif_01` and `motif_02` are two independent de novo constellations for the same
mechanism (seeds 108 and 166). **motif_01 is the better animation subject.**
Re-validated against today's compiled graph (`fundamental_geometry_v2`, which
postdates the run, so this is not like-for-like): motif_01 gives 0 clashes,
0 chirality violations, and still passes oxyanion stabilization and contact
occupancy; motif_02 gives 1 clash and fails both charge stabilization and
occupancy. Both fail the motion and reacting-bond gates described below.

## Provenance, honestly

These were recorded as full passes in run `mixed_ester_20min_v1` and
independently revalidated at the time. They are **not** current-engine passes:

- The protein-motion budget tightened from 0.5 Å to 0.3 Å in `54277c94`
  (2026-09-13), after this run. Measured protein heavy-atom displacement here is
  **0.454 Å** — over today's limit. This is a coordinate-only measurement and does
  not depend on the rule set.
- Today's reacting-bond window also flags bond lengths that were not gated then
  (e.g. C1–O4 at 1.537 Å against a 1.418 Å ideal, 0.04 Å window in state_01).
- See `benchmarks/mcsa/analyses/calb_gate_census_v1/` — CALB currently produces no
  passing design under the shipped gates.

Nothing about the electron bookkeeping changed: valence, charge and stereochemistry
were checked at export time and the arrows below are the compiled mechanism.

## What is actually in the structure (measured, not assumed)

Do not draw the textbook picture without checking it against these numbers.

- **Asp187 is not hydrogen-bonded to His224.** ND1(His)···OD2(Asp) is 15–16 Å in
  every state. Asp187 is declared a `spectator` in the DSL with no arrows, so the
  compiler placed no constraint on it and the search left it loose. Do not draw a
  triad H-bond.
- **Thr40 does not form the oxyanion hole.** O2···OG1(Thr40) is 4.8–8.4 Å.
- **Gln106 NE2-H is the oxyanion stabilizer**, and the only one: it is the witness
  the charge gate accepted in both tetrahedral intermediates (residual 0.86, 0.85).
- The His imidazolium is stabilized through its **ND1-H**, donating to a cap
  acceptor — not to Asp.
- In state_04 the Ser alkoxide is stabilized by **His NE2-H**, the proton it takes
  back in step 5.

Key distances (Å, motif_01):

| state | Ser OG→C1 | C1–O4 | NE2···H21 | O4–H21 | Wat O→C1 | NE2···HW1 | OG···HW1 | O2···NE2 Gln106 |
|---|---|---|---|---|---|---|---|---|
| 0 | 2.95 | 1.40 | 2.02 | 3.66 | – | – | – | 3.67 |
| 1 | 1.40 | 1.54 | 1.14 | 2.16 | – | – | – | 3.16 |
| 2 | 1.35 | 2.44 | 5.39 | 0.97 | 3.23 | 1.85 | 2.76 | 4.86 |
| 3 | 1.42 | 3.85 | 7.31 | 0.97 | 1.40 | 1.01 | 2.25 | 3.13 |
| 4 | 3.08 | 4.34 | 7.33 | 0.97 | 1.34 | 1.02 | 2.10 | 3.71 |
| 5 | 3.83 | 6.32 | 8.27 | 0.97 | 1.35 | 3.76 | 0.97 | 2.69 |

Formal charges, nonzero (the nitro group and Asp187 carry a constant −1/+1 and are omitted):

| state | oxyanion O2 | His NE2 | Ser OG |
|---|---|---|---|
| 0 | – | – | – |
| 1 | −1 | +1 | – |
| 2 | – | – | – |
| 3 | −1 | +1 | – |
| 4 | – | +1 | −1 |
| 5 | – | – | – |

## Atom map key

Substrate (pNPA): 1 carbonyl C, 2 carbonyl/oxyanion O, 3 acetyl CH3, 4 ester O
(becomes the phenol O), 5–10 aryl ring, 11–13 nitro. Water: 60 O, 61/62 H.
Ser105: 20 OG, 21 HG, 22 CB, 23 CA. His224: 40 CG, 41 ND1, 42 CE1, 43 NE2,
44 CD2, 45 HD1, 46 CA, 47 CB. Asp187: 50 OD2, 51 CG, 52 OD1, 53 CB, 54 CA.
Thr40: 70 CA, 71 CB, 72 OG1, 73 CG2. Gln106: 80 CA, 81 CB, 82 CG, 83 CD,
84 OE1, 85 NE2.

## The arrow mechanism

Source of truth: `benchmarks/ester_hydrolysis/cases/calb_pnpa_v1/mechanism.mech.yaml`.
Arrows are written tail → head; `lp` is a lone pair.

### Step 1 (state_00 → state_01) — Ser attacks, His takes the Ser proton
Three arrows, concerted:
1. `lp(NE2 His224, 43)` → **new bond NE2–H21**. His takes the serine hydroxyl proton.
2. `bond(OG–HG, 20–21)` → **new bond OG–C1**. The O–H bonding pair becomes the
   nucleophilic pair attacking the ester carbonyl carbon.
3. `bond(C1=O2)` π → **lone pair on O2**. The carbonyl collapses to the oxyanion.

Result: first tetrahedral intermediate; O2 is −1, His224 is imidazolium (+1).
Gln106 NE2-H catches the oxyanion.

### Step 2 (state_01 → state_02) — collapse, protonate and release p-nitrophenol
Four arrows:
1. `lp(O2)` → **re-form C1=O2** π.
2. `bond(C1–O4)` → **lone pair on O4**. The C–OAr bond breaks; aryloxide leaves.
3. `lp(O4)` → **new bond O4–H21**. The departing phenolate takes the proton His
   is holding, so free p-nitrophenolate is never a separate microstate here.
4. `bond(NE2–H21)` → **lone pair on NE2**. His returns to neutral.

Result: acetyl–Ser acyl-enzyme + neutral p-nitrophenol. His is reset.

### Step 3 (state_02 → state_03) — water attacks the acyl-enzyme
Water enters at this state (`entering: WAT`). Three arrows, mirroring step 1:
1. `lp(NE2 His224, 43)` → **new bond NE2–HW1(61)**. His deprotonates the water.
2. `bond(OW–HW1, 60–61)` → **new bond OW–C1**. Hydroxide-like oxygen attacks.
3. `bond(C1=O2)` π → **lone pair on O2**. Second oxyanion.

Result: second tetrahedral intermediate; His imidazolium again; Gln106 again the
stabilizing donor.

### Step 4 (state_03 → state_04) — collapse, Ser leaves
Two arrows:
1. `lp(O2)` → **re-form C1=O2** π.
2. `bond(C1–OG, 1–20)` → **lone pair on OG**. The serine alkoxide is expelled.

Result: acetic acid + Ser105 alkoxide (−1) + His imidazolium (+1). The alkoxide
is held by the His NE2-H it is about to take.

### Step 5 (state_04 → state_05) — His reprotonates Ser
Two arrows:
1. `lp(OG, 20)` → **new bond OG–HW1(61)**. Serine takes the proton back.
2. `bond(NE2–HW1)` → **lone pair on NE2**. His returns to neutral.

Result: resting state. All five residue fragments are chemically regenerated;
the products are neutral acetic acid and neutral p-nitrophenol.

### The 8 compiled electronic events

The compiler collapses those 14 arrows into 8 typed events (`graph['events']`):

| step | kind | center | bond made | bond broken |
|---|---|---|---|---|
| 1 | proton_transfer | H21 | 21–43 | 20–21 |
| 1 | pi_star_attack | C1 | 1–20 | 1=2 → 1–2 |
| 2 | bond_order_transfer | C1 | 1–2 → 1=2 | 1–4 |
| 2 | proton_transfer | H21 | 4–21 | 21–43 |
| 3 | proton_transfer | HW1 | 61–43 | 60–61 |
| 3 | pi_star_attack | C1 | 1–60 | 1=2 → 1–2 |
| 4 | bond_order_transfer | C1 | 1–2 → 1=2 | 1–20 |
| 5 | proton_transfer | HW1 | 61–20 | 61–43 |

Steps 1 and 3 are the same two-event motif (proton transfer + π* attack); steps 2
and 4 are the same collapse. The cycle is a clean ping-pong: two identical halves,
acylation and deacylation, joined by the leaving-group release.

## Regenerating

`rebuild.py` in this directory regenerates everything here and re-checks all 24
hashes against `manifest.json`. Run it from the repo root with `.venv/bin/python`.
Every input it reads is committed; this directory is not (`exports/` is ignored).
