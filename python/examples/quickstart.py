"""Quick start: the Ras protein (PDB 5P21) in engraved colour, with its GTP pocket marked and one label.

Run: python examples/quickstart.py   (writes docs/img/quickstart.png)
"""
import pathlib

import molsketch as ms

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"

fig = ms.fetch("5P21")                      # downloaded once, then read from the cache
fig.look("engraved-colour")                 # line-shaded ribbons, colour in the lines
fig.view(yaw=60, pitch=20)                  # turn it: degrees about the vertical, then the horizontal
fig.site(ligand=True)                       # the nucleotide and the residues within 5 Å, drawn bold
fig.label("Switch I", at="Tyr32", offset=(110, -60))   # pinned to Tyr32, the text 110 px right and 60 px up
fig.save(OUT / "quickstart.png", size=(1200, 900))
print(OUT / "quickstart.png")
