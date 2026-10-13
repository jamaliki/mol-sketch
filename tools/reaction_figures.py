"""The base reaction rules of registry v1 (Table 1 of the chemistry-engine report) as orbital figures.

Each rule becomes a two-keyframe scene: the reactive precursor posed at the table's central values, with the orbitals
that interact (the donor's filled orbital, the acceptor's empty one), the curly arrows, and the geometry the rule
constrains drawn as measured values with their windows; then the product. The geometry is built with
``molsketch.geometry`` from the same internal coordinates the rules use, so the measured labels read back the table.

    python tools/reaction_figures.py                 # scenes → examples/reactions/, figures → docs/img/reactions/
    python tools/reaction_figures.py --look ink-colour --size 1600x1200
    python tools/reaction_figures.py --scenes-only
    python tools/reaction_figures.py --svg                # also as SVG, every line, lobe and tint a path

The windows are the registry's (rules/registry/v1/windows.toml in the chemistry engine); the report marks these rules
as provisional, so change RULES below when the registry changes.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
import molsketch as ms                     # noqa: E402
from molsketch import geometry as g        # noqa: E402

# Table 1, registry v1: distance window (Å), electrophile angle window (°), face or direction
RULES = {
    "proton_transfer": {"distance": (2.05, 0.55), "bend_max": 35},
    "sigma_star":      {"distance": (3.10, 0.45), "angle": (180, 18)},
    "pi_star":         {"distance": (2.95, 0.45), "angle": (105, 10), "torsion": (90, 25)},
    "empty_p":         {"distance": (3.00, 0.40), "angle": (90, 25), "torsion": (90, 30)},
    "elimination":     {"torsion": (180, 40)},            # 0 ± 40 with a 180° period: syn- or anti-periplanar
}

HOLD, TRANS = 40, 56
FIT_BOX = (0.1, 0.15, 0.9, 0.78)    # where the atoms go (left, top, right, bottom): the lobes and labels need the rest
FIT_OWN = {"proton_transfer": (0.08, 0.2, 0.92, 0.74)}   # small molecules: a smaller box, or they are drawn huge
SIZES = {"proton_transfer": (1200, 620), "sigma_star": (1200, 620), "elimination": (1200, 760)}   # canvases shaped to the molecule


def V(p) -> list[float]:
    return [round(float(x), 3) for x in p]


def atom(el, pos, **kw) -> dict:
    a = {"el": el, "pos": V(pos)}
    if el == "C" and "color" not in kw: a["color"] = "C"      # carbons in the look's own carbon colour, not by group
    for k, v in kw.items():
        a[k] = [V(x) for x in v] if k == "lp" else (V(v) if k in ("enterFrom", "exitTo") else v)
    return a


def pyramidalize(center, subs: dict, toward, angle=109.5, lengths=None) -> dict:
    """substituents of a trigonal centre bent away from a new bond to ``toward`` until each makes ``angle`` with it"""
    c = np.asarray(center, float); n = np.asarray(toward, float) - c; n /= np.linalg.norm(n)
    out = {}
    for k, p in subs.items():
        v = np.asarray(p, float) - c; L = (lengths or {}).get(k, np.linalg.norm(v))
        q = v - (v @ n) * n; q /= np.linalg.norm(q); th = np.radians(angle)
        out[k] = c + L * (np.cos(th) * n + np.sin(th) * q)
    return out


def hydroxide(lp_toward=None, at=(0, 0, 0), h=(0.97, 0, 0)):
    """O and H of a hydroxide, and its three lone pairs (the first aimed at ``lp_toward``)"""
    o = np.asarray(at, float); hh = np.asarray(h, float)
    return o, hh, g.lone_pairs(o, [hh], 3, toward=lp_toward)


# ---------------------------------------------------------------------------------------------------------- rules
def proton_transfer():
    """H3N: + H–OH → H4N⁺ + ⁻OH. The acceptor's lone pair sets the axis; the donor's O–H lies along it (bend ≤ 35°) with
    H···N at 2.05 Å. Orbitals: n(N) → σ*(O–H), whose large lobe is on H."""
    r = RULES["proton_transfer"]; d = r["distance"][0]
    N = np.zeros(3)
    hs = [g.place([0, 0, 1], [1, 0, 0], N, 1.012, 112.1, t) for t in (0, 120, 240)]   # NH3: lone pair along +x
    Ht = np.array([d, 0, 0]); O = np.array([d + 0.97, 0, 0])
    Hw = g.place([0, 0, 1], Ht, O, 0.97, 104.5, 60)
    lpN = g.lone_pairs(N, hs, 1)
    lpO = g.lone_pairs(O, [Ht, Hw], 2)
    k1 = {"name": "Proton transfer: precursor", "hold": HOLD, "transition": TRANS,
          "caption": "N's lone pair (n, filled) points along O–H into σ*(O–H), largest on H: the proton moves along the acceptor's axis.",
          "atoms": {"N": atom("N", N, lp=lpN), **{f"HN{i+1}": atom("H", h) for i, h in enumerate(hs)},
                    "H": atom("H", Ht), "O": atom("O", O, lp=lpO), "HW": atom("H", Hw)},
          "bonds": [["N", "HN1", 1], ["N", "HN2", 1], ["N", "HN3", 1], ["O", "H", 1], ["O", "HW", 1]],
          "orbitals": [{"type": "n", "atom": "N", "lp": 0, "size": 0.8, "label": "n(N)"},
                       {"type": "sigma*", "bond": ["H", "O"], "size": 0.7, "label": "σ*(O–H)"}],
          "measures": [{"distance": ["N", "H"], "window": list(r["distance"]), "label": "H···N {v}"},
                       {"angle": ["N", "H", "O"], "window": [180, r["bend_max"]], "radius": 0.45, "label": "{v}"}],
          "arrows": [{"from": {"lp": "N", "i": 0}, "to": {"atom": "H"}, "bulge": 0.35, "side": 1},
                     {"from": {"bond": ["O", "H"]}, "to": {"atom": "O"}, "bulge": 0.5, "side": 1, "curl": 0.5}]}
    Hn = np.array([1.03, 0, 0]); O2 = np.array([1.03 + 1.70, 0, 0]); Hw2 = Hw - O + O2
    k2 = {"name": "Ammonium and hydroxide", "hold": HOLD, "transition": TRANS,
          "caption": "The proton has moved to N: an ion pair, NH₄⁺ hydrogen-bonded to ⁻OH.",
          "atoms": {"N": atom("N", N, charge=1), **{f"HN{i+1}": atom("H", h) for i, h in enumerate(hs)},
                    "H": atom("H", Hn), "O": atom("O", O2, charge=-1, lp=g.lone_pairs(O2, [Hw2], 3, toward=Hn)), "HW": atom("H", Hw2)},
          "bonds": [["N", "HN1", 1], ["N", "HN2", 1], ["N", "HN3", 1], ["N", "H", 1], ["O", "HW", 1], ["H", "O", 0]]}
    return {"name": "Proton transfer", "view": {"yaw": -8, "pitch": 18, "roll": 0, "zoom": 0.92},
            "look": "textbook", "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k1, k2]}


def sigma_star():
    """HO⁻ + CH3–Br → HO–CH3 + Br⁻ (SN2). The nucleophile meets C on the far side of the leaving group: O···C 3.10 Å,
    ∠O···C–Br 180°. Orbitals: n(O) → σ*(C–Br), whose large lobe is behind C."""
    r = RULES["sigma_star"]
    C = np.zeros(3); Br = np.array([1.94, 0, 0])
    hs = [g.place([1.94, 1, 0], Br, C, 1.09, 107.8, t) for t in (90, 210, 330)]
    O, Hh, _ = hydroxide()
    nuc = g.relative_pose((C, Br, hs[0]), {"O": O, "H": Hh}, ("O", "H"), d=r["distance"][0], alpha_a=r["angle"][0],
                          alpha_b=109.5, tau_ab=180)
    O, Hh = np.array(nuc["O"]), np.array(nuc["H"])
    lpO = g.lone_pairs(O, [Hh], 3, toward=C)
    k1 = {"name": "σ* attack: precursor", "hold": HOLD, "transition": TRANS,
          "caption": "Hydroxide's lone pair (n, filled) meets σ*(C–Br) at its large back lobe: attack from behind, along the C–Br axis.",
          "atoms": {"O": atom("O", O, charge=-1, lp=lpO), "HO": atom("H", Hh), "C": atom("C", C),
                    **{f"H{i+1}": atom("H", h) for i, h in enumerate(hs)}, "Br": atom("Br", Br, color="#a0522d")},
          "bonds": [["O", "HO", 1], ["C", "H1", 1], ["C", "H2", 1], ["C", "H3", 1], ["C", "Br", 1]],
          "orbitals": [{"type": "n", "atom": "O", "lp": 0, "label": "n(O)"},
                       {"type": "sigma*", "bond": ["C", "Br"], "label": "σ*(C–Br)"}],
          "measures": [{"distance": ["O", "C"], "window": list(r["distance"])},
                       {"angle": ["O", "C", "Br"], "window": list(r["angle"]), "radius": 0.5}],
          "arrows": [{"from": {"lp": "O", "i": 0}, "to": {"atom": "C"}, "bulge": 0.3, "side": 1},
                     {"from": {"bond": ["C", "Br"]}, "to": {"atom": "Br"}, "bulge": 0.55, "side": 1, "curl": 0.5}]}
    # Walden inversion: C–O forms at 1.43 Å, the methyl's hydrogens flip through the plane, bromide leaves
    O2 = C + 1.43 * (O - C) / np.linalg.norm(O - C); Hh2 = Hh - O + O2
    hs2 = [C + (h - C) - 2 * ((h - C) @ np.array([1, 0, 0])) * np.array([1, 0, 0]) for h in hs]
    hs2 = [C + 1.09 * (h - C) / np.linalg.norm(h - C) for h in pyramidalize(C, dict(enumerate(hs2)), O2).values()]
    Br2 = np.array([3.6, 0, 0])
    k2 = {"name": "Methanol and bromide", "hold": HOLD, "transition": TRANS,
          "caption": "C–O formed, C–Br broken; the methyl turned inside out (Walden inversion).",
          "atoms": {"O": atom("O", O2, lp=g.lone_pairs(O2, [C, Hh2], 2)), "HO": atom("H", Hh2), "C": atom("C", C),
                    **{f"H{i+1}": atom("H", h) for i, h in enumerate(hs2)}, "Br": atom("Br", Br2, color="#a0522d", charge=-1)},
          "bonds": [["O", "HO", 1], ["C", "H1", 1], ["C", "H2", 1], ["C", "H3", 1], ["O", "C", 1]]}
    return {"name": "σ* attack (SN2)", "view": {"yaw": -14, "pitch": 16, "roll": 0, "zoom": 0.9},
            "look": "textbook", "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k1, k2]}


def pi_star():
    """HO⁻ + H2C=O → H2C(OH)O⁻. Bürgi–Dunitz approach: O···C 2.95 Å, ∠Nu···C=O 105°, and out of the carbonyl plane
    (dih(H–O=C···Nu) ±90°, one face). Orbitals: n(O) → π*(C=O), largest on C."""
    r = RULES["pi_star"]
    C = np.zeros(3); O = np.array([1.21, 0, 0])
    H1 = C + 1.10 * np.array([np.cos(np.radians(121.8)), 0, np.sin(np.radians(121.8))])
    H2 = C + 1.10 * np.array([np.cos(np.radians(121.8)), 0, -np.sin(np.radians(121.8))])
    On, Hn, _ = hydroxide()
    nuc = g.relative_pose((C, O, H1), {"O": On, "H": Hn}, ("O", "H"), d=r["distance"][0], alpha_a=r["angle"][0],
                          alpha_b=109.5, tau_a=r["torsion"][0], tau_ab=-150)
    On, Hn = np.array(nuc["O"]), np.array(nuc["H"])
    lpN = g.lone_pairs(On, [Hn], 3, toward=C)
    k1 = {"name": "π* attack: precursor", "hold": HOLD, "transition": TRANS,
          "caption": "Hydroxide's lone pair meets π*(C=O) above the plane, at 105° to C=O (Bürgi–Dunitz): the lobe is larger on C.",
          "atoms": {"Nu": atom("O", On, charge=-1, lp=lpN), "HNu": atom("H", Hn), "C": atom("C", C),
                    "O": atom("O", O, lp=g.lone_pairs(O, [C], 2)), "H1": atom("H", H1), "H2": atom("H", H2)},
          "bonds": [["Nu", "HNu", 1], ["C", "O", 2], ["C", "H1", 1], ["C", "H2", 1]],
          "orbitals": [{"type": "n", "atom": "Nu", "lp": 0, "label": "n(O)"},
                       {"type": "pi*", "bond": ["C", "O"], "toward": "Nu", "label": "π*(C=O)"}],
          "measures": [{"distance": ["Nu", "C"], "window": list(r["distance"])},
                       {"angle": ["Nu", "C", "O"], "window": list(r["angle"]), "radius": 0.5},
                       {"torsion": ["H1", "O", "C", "Nu"], "label": "τ(H–O=C···O) {v}"}],
          "arrows": [{"from": {"lp": "Nu", "i": 0}, "to": {"atom": "C"}, "bulge": 0.3, "side": -1},
                     {"from": {"bond": ["C", "O"]}, "to": {"atom": "O"}, "bulge": 0.6, "side": -1, "curl": 0.55}]}
    On2 = C + 1.43 * (On - C) / np.linalg.norm(On - C); Hn2 = Hn - On + On2
    sub = pyramidalize(C, {"O": O, "H1": H1, "H2": H2}, On2, lengths={"O": 1.36, "H1": 1.10, "H2": 1.10})
    k2 = {"name": "Tetrahedral alkoxide", "hold": HOLD, "transition": TRANS,
          "caption": "C–O formed, the π bond broken: the carbonyl oxygen now carries the charge.",
          "atoms": {"Nu": atom("O", On2, lp=g.lone_pairs(On2, [C, Hn2], 2)), "HNu": atom("H", Hn2), "C": atom("C", C),
                    "O": atom("O", sub["O"], charge=-1, lp=g.lone_pairs(sub["O"], [C], 3)), "H1": atom("H", sub["H1"]), "H2": atom("H", sub["H2"])},
          "bonds": [["Nu", "HNu", 1], ["C", "O", 1], ["C", "H1", 1], ["C", "H2", 1], ["Nu", "C", 1]]}
    return {"name": "π* attack (carbonyl addition)", "view": {"yaw": -24, "pitch": 14, "roll": 0, "zoom": 0.9},
            "look": "textbook", "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k1, k2]}


def empty_p():
    """H3N: + BF3 → H3N⁺–BF3⁻. The donor approaches along the empty p orbital, normal to the BF3 plane: N···B 3.00 Å,
    ∠N···B–F 90°, dih(F–F–B···N) ±90° (one face). Orbitals: n(N) → empty p(B)."""
    r = RULES["empty_p"]
    B = np.zeros(3)
    F = [B + 1.31 * np.array([np.cos(t), 0, np.sin(t)]) for t in np.radians([-30, 90, 210])]
    Nn = g.place(F[1], F[0], B, r["distance"][0], r["angle"][0], r["torsion"][0])
    up = (Nn - B) / np.linalg.norm(Nn - B)
    p, q = np.array([1.0, 0, 0]), np.array([0, 0, 1.0])
    hs = [Nn + 1.012 * (np.cos(np.radians(68)) * up + np.sin(np.radians(68)) * (np.cos(t) * p + np.sin(t) * q)) for t in np.radians([30, 150, 270])]
    k1 = {"name": "Empty-p attack: precursor", "hold": HOLD, "transition": TRANS,
          "caption": "N's lone pair comes down the axis of boron's empty p orbital, normal to the BF₃ plane.",
          "atoms": {"N": atom("N", Nn, lp=g.lone_pairs(Nn, hs, 1)), **{f"H{i+1}": atom("H", h) for i, h in enumerate(hs)},
                    "B": atom("B", B, color="#d9a066"), **{f"F{i+1}": atom("F", f, color="#8fbf6a") for i, f in enumerate(F)}},
          "bonds": [["N", "H1", 1], ["N", "H2", 1], ["N", "H3", 1], ["B", "F1", 1], ["B", "F2", 1], ["B", "F3", 1]],
          "orbitals": [{"type": "n", "atom": "N", "lp": 0, "label": "n(N)"},
                       {"type": "p", "atom": "B", "toward": "N", "label": "p(B), empty"}],
          "measures": [{"distance": ["N", "B"], "window": list(r["distance"])},
                       {"angle": ["N", "B", "F1"], "window": list(r["angle"]), "radius": 0.45},
                       {"torsion": ["F2", "F1", "B", "N"], "label": "τ(F–F–B···N) {v}"}],
          "arrows": [{"from": {"lp": "N", "i": 0}, "to": {"atom": "B"}, "bulge": 0.3, "side": 1}]}
    shift = Nn - (B + 1.67 * up)
    N2 = Nn - shift; hs2 = [h - shift for h in hs]
    F2 = pyramidalize(B, {i: f for i, f in enumerate(F)}, N2, angle=105, lengths={0: 1.38, 1: 1.38, 2: 1.38})
    k2 = {"name": "Lewis adduct", "hold": HOLD, "transition": TRANS,
          "caption": "The N–B bond formed; boron is now tetrahedral, its fluorines bent away.",
          "atoms": {"N": atom("N", N2, charge=1), **{f"H{i+1}": atom("H", h) for i, h in enumerate(hs2)},
                    "B": atom("B", B, color="#d9a066", charge=-1), **{f"F{i+1}": atom("F", F2[i], color="#8fbf6a") for i in range(3)}},
          "bonds": [["N", "H1", 1], ["N", "H2", 1], ["N", "H3", 1], ["B", "F1", 1], ["B", "F2", 1], ["B", "F3", 1], ["N", "B", 1]]}
    return {"name": "Empty-p attack (Lewis acid)", "view": {"yaw": -20, "pitch": 18, "roll": 0, "zoom": 0.9},
            "look": "textbook", "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k1, k2]}


def elimination():
    """HO⁻ + CH3CH2Br → H2C=CH2 + H2O + Br⁻ (E2). No distance or angle of its own: the rule constrains the torsion
    H–Cβ–Cα–Br to 0 or 180° (± 40). Drawn anti-periplanar: σ(C–H) and σ*(C–Br) lie in one plane, so as the base takes
    the proton the C–H pair flows into the C–Br antibonding orbital and becomes the π bond."""
    r = RULES["elimination"]
    Cb = np.zeros(3); Ca = np.array([1.53, 0, 0])
    Br = g.place([0, 1, 0], Cb, Ca, 1.95, 110, 180)
    Hb = g.place(Br, Ca, Cb, 1.09, 110, r["torsion"][0])
    Ha = [g.place(Hb, Cb, Ca, 1.09, 110, t) for t in (60, -60)]
    Hb2 = [g.place(Br, Ca, Cb, 1.09, 110, t) for t in (60, -60)]
    u = (Hb - Cb) / np.linalg.norm(Hb - Cb)
    O = Hb + 2.05 * u                                     # the base on the C–H axis, as the proton-transfer rule asks
    Hh = g.place(Ca, Hb, O, 0.97, 109.5, 40)
    lpO = g.lone_pairs(O, [Hh], 3, toward=Hb)
    k1 = {"name": "Concerted elimination: precursor", "hold": HOLD, "transition": TRANS,
          "caption": "Anti-periplanar: σ(C–H) and σ*(C–Br) share a plane. The base takes H; the C–H pair becomes the π bond and Br leaves.",
          "atoms": {"O": atom("O", O, charge=-1, lp=lpO), "HO": atom("H", Hh), "Hb": atom("H", Hb),
                    "Cb": atom("C", Cb), "Ca": atom("C", Ca), "Br": atom("Br", Br, color="#a0522d"),
                    "Ha1": atom("H", Ha[0]), "Ha2": atom("H", Ha[1]), "Hb2": atom("H", Hb2[0]), "Hb3": atom("H", Hb2[1])},
          "bonds": [["O", "HO", 1], ["Cb", "Hb", 1], ["Cb", "Ca", 1], ["Ca", "Br", 1], ["Ca", "Ha1", 1], ["Ca", "Ha2", 1], ["Cb", "Hb2", 1], ["Cb", "Hb3", 1]],
          "orbitals": [{"type": "n", "atom": "O", "lp": 0},
                       {"type": "sigma", "bond": ["Cb", "Hb"], "label": "σ(C–H)"},
                       {"type": "sigma*", "bond": ["Ca", "Br"], "size": 0.85, "label": "σ*(C–Br)"}],
          "measures": [{"torsion": ["Hb", "Cb", "Ca", "Br"], "label": "τ(H–C–C–Br) {v}", "window": list(r["torsion"]), "side": -1}],
          "arrows": [{"from": {"lp": "O", "i": 0}, "to": {"atom": "Hb"}, "bulge": 0.3, "side": 1},
                     {"from": {"bond": ["Cb", "Hb"]}, "to": {"bond": ["Cb", "Ca"]}, "bulge": 0.45, "side": 1},
                     {"from": {"bond": ["Ca", "Br"]}, "to": {"atom": "Br"}, "bulge": 0.5, "side": 1, "curl": 0.5}]}
    # ethylene in the plane normal to the old H/Br axis; water; bromide drifting off
    Ca2 = np.array([1.34, 0, 0]); ax = np.cross(Ca - Cb, Hb - Cb); ax /= np.linalg.norm(ax)   # the new plane's in-plane normal to C=C
    def sp2(c, sign_x, h):
        s = 1 if (h - Cb) @ ax > 0 else -1
        return c + 1.09 * np.array([sign_x * np.cos(np.radians(58.5)), 0, 0]) + 1.09 * np.sin(np.radians(58.5)) * s * ax
    Ha2 = [sp2(Ca2, 1, h) for h in Ha]; Hb22 = [sp2(Cb, -1, h) for h in Hb2]
    Hb_new = O - 0.97 * u
    Br2 = Ca + 3.4 * (Br - Ca) / np.linalg.norm(Br - Ca)
    k2 = {"name": "Alkene, water, bromide", "hold": HOLD, "transition": TRANS,
          "caption": "One step: C–H and C–Br broken, O–H and the C=C π bond formed.",
          "atoms": {"O": atom("O", O, lp=g.lone_pairs(O, [Hh, Hb_new], 2)), "HO": atom("H", Hh), "Hb": atom("H", Hb_new),
                    "Cb": atom("C", Cb), "Ca": atom("C", Ca2), "Br": atom("Br", Br2, color="#a0522d", charge=-1),
                    "Ha1": atom("H", Ha2[0]), "Ha2": atom("H", Ha2[1]), "Hb2": atom("H", Hb22[0]), "Hb3": atom("H", Hb22[1])},
          "bonds": [["O", "HO", 1], ["O", "Hb", 1], ["Cb", "Ca", 2], ["Ca", "Ha1", 1], ["Ca", "Ha2", 1], ["Cb", "Hb2", 1], ["Cb", "Hb3", 1]]}
    return {"name": "Concerted elimination (E2)", "view": {"yaw": -12, "pitch": 12, "roll": 55, "zoom": 0.9},
            "look": "textbook", "reps": {"sticks": "all", "cartoon": "", "surface": ""}, "keyframes": [k1, k2]}


BUILDERS = {"proton_transfer": proton_transfer, "sigma_star": sigma_star, "pi_star": pi_star, "empty_p": empty_p, "elimination": elimination}


def check(name: str, scene: dict) -> list[str]:
    """the precursor's measures, read from its coordinates, against the rule's windows"""
    k = scene["keyframes"][0]; pos = {i: a["pos"] for i, a in k["atoms"].items()}; out = []
    for m in k.get("measures", []):
        kind = next(x for x in ("distance", "angle", "torsion") if x in m); ids = m[kind]
        v = {"distance": g.distance, "angle": g.angle, "torsion": g.torsion}[kind](*[pos[i] for i in ids])
        w = m.get("window"); ok = ""
        if w:
            dev = abs(v - w[0]) if kind != "torsion" else min(abs(((v - w[0] + 180) % 360) - 180), abs(((v - w[0]) % 360) - 180))
            ok = "in window" if dev <= w[1] + 1e-6 else "OUTSIDE window"
        out.append(f"  {kind} {'–'.join(ids)} = {v:.2f}{' Å' if kind == 'distance' else '°'} {('(window ' + str(w[0]) + ' ± ' + str(w[1]) + ', ' + ok + ')') if w else ''}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rules", nargs="*", default=list(BUILDERS), help=f"which rules: {', '.join(BUILDERS)}")
    ap.add_argument("--look", default="textbook"); ap.add_argument("--size", default=None, help="WxH for every figure (default: a canvas shaped to each)")
    ap.add_argument("--scenes", default=str(ROOT / "examples" / "reactions")); ap.add_argument("--out", default=str(ROOT / "docs" / "img" / "reactions"))
    ap.add_argument("--scenes-only", action="store_true"); ap.add_argument("--no-fit", dest="fit", action="store_false"); ap.add_argument("--animate", action="store_true", help="also write each scene as an mp4")
    ap.add_argument("--svg", action="store_true", help="also write each figure as an SVG, to edit in Illustrator, Inkscape or Affinity")
    a = ap.parse_args(argv)
    W0, H0 = (int(x) for x in (a.size or "1200x900").split("x"))
    sd, od = pathlib.Path(a.scenes), pathlib.Path(a.out); sd.mkdir(parents=True, exist_ok=True); od.mkdir(parents=True, exist_ok=True)
    for name in a.rules:
        scene = BUILDERS[name]()
        (sd / f"{name}.json").write_text(json.dumps(scene, indent=1, ensure_ascii=False) + "\n")
        print(name); print("\n".join(check(name, scene)))
        if a.scenes_only: continue
        w, h = SIZES.get(name, (W0, H0)) if a.size is None else (W0, H0)
        fig = ms.scene(scene).look(a.look)
        if a.fit:   # zoom and pan so every keyframe fills the drawing area, leaving room for the lobes; kept in the scene
            fig.fit(FIT_OWN.get(name, FIT_BOX), (w, h)); c = fig.camera
            scene["view"].update(zoom=round(c["zoom"], 3), panX=round(c["pan_x"], 4), panY=round(c["pan_y"], 4))
            (sd / f"{name}.json").write_text(json.dumps(scene, indent=1, ensure_ascii=False) + "\n")
        fig.save(od / f"{name}.png", (w, h), frame=HOLD - 2)
        if a.svg: fig.save(od / f"{name}.svg", (w, h), frame=HOLD - 2)
        if a.animate: fig.animate(od / f"{name}.mp4", size=(w, h))
    return 0


if __name__ == "__main__":
    r = 1
    try:
        r = main()
    except BaseException:
        import traceback; traceback.print_exc()
    finally:
        sys.stdout.flush(); sys.stderr.flush(); os._exit(r)   # the embedded V8 keeps a thread that can hold up the interpreter's exit
