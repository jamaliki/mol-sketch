"""Bond orders of structures read from a file: the standard residues' templates, histidine's tautomers, a ligand's own
bonds (from the file when it says, else from its geometry), and a scene's orders kept as written. Fast, no browser.

    cd python && .venv/bin/python -m pytest tests/test_bonds.py -q
"""
from __future__ import annotations

import json
import math
import pathlib
import re

import numpy as np

import molsketch as ms
from molsketch._engine import engine

EX = pathlib.Path(__file__).resolve().parent.parent.parent / "app" / "public" / "examples"
SMALL = (320, 240)


def keyframe(fig) -> dict:
    return engine().call("sceneJson", fig._spec())["keyframes"][0]


def orders(fig) -> dict[frozenset, int]:
    """{frozenset of two atom ids: order} for the figure's first keyframe"""
    return {frozenset(b[:2]): (b[2] if len(b) > 2 else 1) for b in keyframe(fig)["bonds"]}


def doubles_by_residue(fig) -> dict[str, set]:
    """per residue id, its bonds of order 2 or more within it, as (name, name, order) with the names sorted"""
    out: dict[str, set] = {}
    for pair, o in orders(fig).items():
        a, b = sorted(pair); ra, na = a.split(":"); rb, nb = b.split(":")
        out.setdefault(ra, set())
        if o > 1:
            assert ra == rb, f"a multiple bond between residues: {a}–{b}"
            out[ra].add((*sorted((na, nb)), o))
    return out


def pdb(atoms, conect=()) -> str:
    """PDB text from (resn, resi, name, element, x, y, z) rows, all HETATM in chain A, and CONECT rows of serials"""
    lines = [f"HETATM{i:5d} {n:<4} {r:>3} A{q:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 10.00          {e:>2}"
             for i, (r, q, n, e, x, y, z) in enumerate(atoms, start=1)]
    lines += ["CONECT" + "".join(f"{s:5d}" for s in row) for row in conect]
    return "\n".join(lines) + "\nEND\n"


def resname(res: str) -> str:
    return re.match(r"[A-Z0-9]*?[A-Z]+(?=-?\d+(\.|$))", res).group(0)


D2 = lambda *names: {(*sorted(names), 2)}   # one double bond
BB = D2("C", "O")
AMINO = {"ALA": BB, "GLY": BB, "SER": BB, "CYS": BB, "VAL": BB, "LEU": BB, "ILE": BB, "MET": BB, "PRO": BB, "THR": BB, "LYS": BB, "MSE": BB,
         "ASP": BB | D2("CG", "OD1"), "ASN": BB | D2("CG", "OD1"), "GLU": BB | D2("CD", "OE1"), "GLN": BB | D2("CD", "OE1"),
         "ARG": BB | D2("CZ", "NH2"),
         "PHE": BB | D2("CG", "CD1") | D2("CE1", "CZ") | D2("CD2", "CE2"), "TYR": BB | D2("CG", "CD1") | D2("CE1", "CZ") | D2("CD2", "CE2"),
         "TRP": BB | D2("CG", "CD1") | D2("CD2", "CE2") | D2("CE3", "CZ3") | D2("CZ2", "CH2")}


def test_amino_acids_take_their_templates():
    """every residue of a protein read from a PDB file has its double bonds: the backbone's C=O, the side chains' C=O
    and C=N, the aromatic rings in a Kekulé form; waters and the peptide bonds stay single"""
    found = doubles_by_residue(ms.load(EX / "1A8O.pdb"))
    seen = set()
    for res, dbl in found.items():
        resn = resname(res)
        if resn == "HOH": assert not dbl; continue
        assert dbl == AMINO[resn], (res, dbl)   # (the C-terminal residue's OXT stays single)
        seen.add(resn)
    assert {"PHE", "TYR", "TRP", "ARG", "ASP", "GLU", "MSE"} <= seen


def test_nucleotides_and_a_protonated_histidine():
    """an NMR structure with hydrogens (1LCD): the DNA's bases and phosphates, and His29 with H on both ND1 and NE2"""
    found = doubles_by_residue(ms.load(EX / "1LCD.pdb"))
    P = D2("OP1", "P")
    bases = {"DA": D2("C8", "N7") | D2("C4", "C5") | D2("C6", "N1") | D2("C2", "N3"),
             "DG": D2("C8", "N7") | D2("C4", "C5") | D2("C6", "O6") | D2("C2", "N3"),
             "DC": D2("C2", "O2") | D2("C4", "N3") | D2("C5", "C6"), "DT": D2("C2", "O2") | D2("C4", "O4") | D2("C5", "C6")}
    n = 0
    for res, dbl in found.items():
        resn = resname(res)
        if resn in bases:
            assert bases[resn] <= dbl and dbl - bases[resn] <= P, (res, dbl); n += 1
    assert n >= 10
    assert found["HIS29.A"] == BB | D2("CG", "CD2") | D2("CE1", "ND1")


def _his(keep: set[str], resn="HIS") -> str:
    """His29 of 1LCD's first model, with only the hydrogens named in `keep`"""
    rows = []
    for line in (EX / "1LCD.pdb").read_text().splitlines():
        if line.startswith("ENDMDL"): break
        if line.startswith("ATOM") and line[17:20] == "HIS":
            name = line[12:16].strip()
            if line[76:78].strip() == "H" and name not in keep: continue
            rows.append(line[:17] + resn + line[20:])
    return "\n".join(rows) + "\nEND\n"


def test_histidine_follows_its_tautomer():
    """with its hydrogens, His's Kekulé form is its tautomer's: H on ND1 puts the double bonds at CG=CD2 and CE1=NE2, H on
    NE2 at CG=CD2 and ND1=CE1; with none, the usual form (as NE2's), or the one its name says (HID: ND1's)"""
    ring = lambda txt: {d for d in next(iter(doubles_by_residue(ms.load(txt, format="pdb")).values())) if d[:2] != ("C", "O")}
    on_d, on_e = D2("CG", "CD2") | D2("CE1", "NE2"), D2("CG", "CD2") | D2("CE1", "ND1")
    assert ring(_his({"H", "HD1"})) == on_d
    assert ring(_his({"H", "HE2"})) == on_e
    assert ring(_his(set())) == on_e
    assert ring(_his(set(), "HID")) == on_d


def _ring(r, q, x0, sub=()):
    """a flat six-membered carbon ring of 1.39 Å bonds centred at (x0, 0, 0), C1 on +x, and atoms beyond C1 along +x
    (name, element, distance from the last)"""
    out = [(r, q, f"C{k + 1}", "C", x0 + 1.39 * math.cos(k * math.pi / 3), 1.39 * math.sin(k * math.pi / 3), 0.0) for k in range(6)]
    x = x0 + 1.39
    for name, el, d in sub: x += d; out.append((r, q, name, el, x, 0.0, 0.0))
    return out


def _kekule(dbl, n=6):
    """the ring's double bonds alternate: three of them, each ring atom in exactly one"""
    ring = [d for d in dbl if d[0][1:].isdigit() and int(d[0][1:]) <= n and d[1][1:].isdigit() and int(d[1][1:]) <= n and d[0][0] == d[1][0] == "C"]
    atoms = [a for d in ring for a in d[:2]]
    return len(ring) == 3 and len(set(atoms)) == 6


def test_a_ligand_s_orders_from_its_geometry():
    """a ligand with nothing in the file to say: an aromatic ring alternates, a nitrile is triple, an alkyne triple, an
    amide's C=O double and its C–N single, and a puckered (saturated) ring stays single"""
    atoms = _ring("NIT", 1, 0, [("C7", "C", 1.44), ("N8", "N", 1.16)])                  # benzonitrile
    atoms += _ring("ALK", 2, 20, [("C7", "C", 1.43), ("C8", "C", 1.20)])                # phenylacetylene
    c = (40.0, 0.0)                                                                     # acetamide, planar
    atoms += [("AMD", 3, "C1", "C", c[0] - 1.52, 0, 0), ("AMD", 3, "C2", "C", *c, 0),
              ("AMD", 3, "O", "O", c[0] + 1.23 * math.cos(math.radians(60)), 1.23 * math.sin(math.radians(60)), 0),
              ("AMD", 3, "N", "N", c[0] + 1.33 * math.cos(math.radians(-60)), 1.33 * math.sin(math.radians(-60)), 0)]
    atoms += [("CHX", 4, f"C{k + 1}", "C", 60 + 1.45 * math.cos(k * math.pi / 3), 1.45 * math.sin(k * math.pi / 3), 0.25 * (-1) ** k) for k in range(6)]
    found = doubles_by_residue(ms.load(pdb(atoms), format="pdb"))
    nit, alk = found["NIT1.A"], found["ALK2.A"]
    assert _kekule(nit) and ("C7", "N8", 3) in nit and len(nit) == 4
    assert _kekule(alk) and ("C7", "C8", 3) in alk and len(alk) == 4
    assert found["AMD3.A"] == D2("C2", "O")
    assert found["CHX4.A"] == set()


def test_the_file_s_own_orders_win():
    """CONECT records listing a partner twice make a double bond whatever the geometry; mmCIF's _chem_comp_bond gives a
    component's orders, its aromatic bonds put in a Kekulé form"""
    eth = [("ETH", 1, "C1", "C", 0, 0, 0), ("ETH", 1, "C2", "C", 1.5, 0, 0), ("ETH", 1, "C3", "C", 2.2, 1.3, 0)]   # all single by geometry
    assert doubles_by_residue(ms.load(pdb(eth), format="pdb"))["ETH1.A"] == set()
    assert doubles_by_residue(ms.load(pdb(eth, [(1, 2, 2), (2, 1, 1, 3), (3, 2)]), format="pdb"))["ETH1.A"] == D2("C1", "C2")
    ring = _ring("BNZ", 1, 0)
    site = "\n".join(f"HETATM {i} C {n} . BNZ A 1 1 {x:.3f} {y:.3f} {z:.3f} 1" for i, (_, _, n, _, x, y, z) in enumerate(ring, start=1))
    cif = ("data_t\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_alt_id\n"
           "_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.auth_seq_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n"
           "_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.pdbx_PDB_model_num\n" + site + "\n#\nloop_\n_chem_comp_bond.comp_id\n"
           "_chem_comp_bond.atom_id_1\n_chem_comp_bond.atom_id_2\n_chem_comp_bond.value_order\n"
           + "\n".join(f"BNZ C{k + 1} C{(k + 1) % 6 + 1} AROM" for k in range(6)) + "\n#\n")
    assert _kekule(doubles_by_residue(ms.load(cif, format="cif"))["BNZ1.A"])


def test_a_ligand_ring_from_a_file_draws_its_double_bonds():
    """the example protein's ligand (a phenol) reads as a Kekulé ring, its C–O single; drawn, valence shows"""
    fig = ms.load(EX / "test_protein.pdb")
    lig = doubles_by_residue(fig)["LIG201.A"]
    assert _kekule(lig) and len(lig) == 3
    flat = fig.copy().look("flat").show(sticks="resn LIG", cartoon=None)
    assert not np.array_equal(flat.render(SMALL).to_numpy(), flat.copy().set(**{"show.valence": False}).render(SMALL).to_numpy())


def test_a_scene_keeps_its_orders():
    """a scene's bonds are drawn as written: a mechanism's double bonds stay, and a scene written all single (the trypsin
    site, made from 2PTN before bonds had orders) is not given any"""
    mech = ms.load(EX / "mechanism.json")
    written = [b[2] if len(b) > 2 else 1 for b in json.loads((EX / "mechanism.json").read_text())["keyframes"][0]["bonds"]]
    assert [b[2] if len(b) > 2 else 1 for b in keyframe(mech)["bonds"]] == written and 2 in written
    assert set(orders(ms.load(EX / "trypsin_active_site.json")).values()) == {1}


def test_double_bonds_draw_in_every_look():
    """the extra bond of a double bond is drawn in every look, at an active site's scale too: show.valence changes the
    picture of the catalytic triad (His57's ring, Asp102's C=O) and of the example ligand's ring"""
    site = lambda look, **st: ms.load(EX / "1LCD.pdb").look(look).site("resi 29").set(**st).render(SMALL).to_numpy()
    for look in ("engraved", "engraved-colour", "ink", "ink-colour", "watercolour", "chalkboard", "textbook", "dark-paper", "flat"):
        assert not np.array_equal(site(look), site(look, **{"show.valence": False})), look
        lig = lambda **st: ms.load(EX / "test_protein.pdb").look(look).show(sticks="resn LIG", cartoon=None).set(**st).render(SMALL).to_numpy()
        assert not np.array_equal(lig(), lig(**{"show.valence": False})), look


def test_bonds_worked_out_when_first_asked_for_are_the_same():
    """A structure read from a file works out its bonds the first time they are asked for: drawn as a surface alone
    first (which never asks), its bonds, and their orders, are those it has when they are asked for at once"""
    text = (EX / "test_protein_rna.cif").read_text()
    first = ms.load(text, name="asked.cif", format="cif")
    surface = ms.load(text + "\n", name="surface.cif", format="cif").look("flat").show(cartoon=None, sticks=None, surface="polymer")
    surface.render(SMALL)
    assert orders(surface) == orders(first) and len(orders(first)) > 300
