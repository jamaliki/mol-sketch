"""Changing the style yourself: start from a look, then set individual fields.

Run: python examples/custom_style.py   (writes docs/img/custom_style.png)
"""
import pathlib

import molsketch as ms

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"

fig = ms.fetch("5P21").look("ink-colour").view(yaw=60, pitch=20)
fig.show(sticks="hetatm and not water", cartoon="polymer")   # the nucleotide as sticks, the protein as cartoon
fig.palette("Coastal Harvest")                                # the colours residues and chains take
fig.set(line={"width": 2.2, "rough": 1.6})                    # a heavier, shakier pen
fig.set(**{"hatch.spacing": 4, "view.fog": 0.3})              # denser hatching, less depth fog
fig.set(palette={"paper": "#fbf7ee"})                         # a slightly warmer paper
fig.labels(secondary=True)                                    # α1, β1 … on the ribbons
print(fig.style["line"])                                      # the style as it will be drawn
fig.save(OUT / "custom_style.png", size=(1200, 900))
print(OUT / "custom_style.png")
