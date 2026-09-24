"""A large assembly: the 70S ribosome (PDB 6GZQ, about 144 000 atoms) as a surface and as a cartoon, coloured by
subunit, with the large subunit given a colour of its own.

Run: python examples/ribosome.py   (writes docs/img/ribosome_surface.jpg and docs/img/ribosome_cartoon.jpg)
"""
import pathlib

import molsketch as ms

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"

ribo = ms.fetch("6GZQ").view(yaw=30)                        # a large download the first time
surface = ribo.copy().look("assembly-surface").color("subunit:L", "#e6a45a")
surface.save(OUT / "ribosome_surface.jpg", size=(1000, 1000))
cartoon = ribo.copy().look("assembly-cartoon")
cartoon.save(OUT / "ribosome_cartoon.jpg", size=(1000, 1000))
print(OUT / "ribosome_surface.jpg", OUT / "ribosome_cartoon.jpg")
