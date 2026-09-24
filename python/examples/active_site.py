"""An enzyme's active site in the context of its protein: trypsin (PDB 2PTN), engraved.

site() marks the catalytic triad, frame_site() turns it towards you, label_site() labels its residues.
Run: python examples/active_site.py   (writes docs/img/active_site.png)
"""
import pathlib

import molsketch as ms

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"
SIZE = (1200, 900)   # frame_site and label_site work for a canvas shape: give them the size you save at

fig = ms.fetch("2PTN").look("engraved")
fig.site("resi 57+102+195")          # His57, Asp102, Ser195: the catalytic triad
fig.frame_site(SIZE)                 # the site faces you, with as little protein in front of it as possible
fig.label_site(SIZE)                 # a label at each residue's side-chain tip
fig.save(OUT / "active_site.png", size=SIZE)
print(OUT / "active_site.png")
