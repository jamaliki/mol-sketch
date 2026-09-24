"""A keyframed scene (a reaction mechanism saved from the app): one frame as an image, and the loop as a GIF.

Run: python examples/mechanism.py   (writes docs/img/mechanism.png and docs/img/mechanism.gif; the GIF needs ffmpeg)
"""
import pathlib
import shutil

import molsketch as ms

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "docs" / "img"
SCENE = HERE.parent.parent / "app" / "public" / "examples" / "mechanism.json"   # in a clone of the repository

fig = ms.scene(SCENE).look("watercolour")
print(fig)                                            # keyframes and length
keys = fig.frames("keyframes")                        # the first frame of each step
fig.save(OUT / "mechanism.png", size=(1200, 900), frame=keys[2])
if shutil.which("ffmpeg"):
    # every fourth drawn frame at 3 fps: the scene at its real speed, in a GIF small enough for a web page
    fig.animate(OUT / "mechanism.gif", fig.frames("drawn")[::4], size=(400, 300), fps=3)
print(OUT / "mechanism.png")
