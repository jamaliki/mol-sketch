"""Every look on the same protein, side by side, as one contact sheet.

Shows how to render to pixels (Image.to_numpy) and assemble them yourself.
Run: python examples/looks.py   (writes docs/img/looks.jpg; needs Pillow for the JPEG)
"""
import pathlib

import numpy as np
from PIL import Image as PILImage

import molsketch as ms

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "img"

base = ms.fetch("5P21").view(yaw=60, pitch=20)
names = [n for n in ms.looks() if not n.startswith("assembly")]   # the assembly looks are for very large structures
tiles = []
for name in names:
    img = base.copy().look(name).render((480, 360))    # copy(): each variation leaves `base` as it was
    tiles.append(img.to_numpy()[..., :3])               # RGB pixels, height × width × 3

cols = 4
rows = [np.hstack(tiles[i:i + cols] + [np.full_like(tiles[0], 255)] * (cols - len(tiles[i:i + cols]))) for i in range(0, len(tiles), cols)]
PILImage.fromarray(np.vstack(rows)).save(OUT / "looks.jpg", quality=88)
print(OUT / "looks.jpg", "·", ", ".join(names))
