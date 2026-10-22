"""How the package reaches its engine, and what it keeps between calls and between runs: each the same drawing as
before, quicker. Fast, no browser needed.

    cd python && .venv/bin/python -m pytest tests/test_speed.py -q
"""
from __future__ import annotations

import pathlib
import threading
import time

import numpy as np
import pytest

import molsketch as ms
from molsketch._engine import CoreError, Engine, engine

EX = pathlib.Path(__file__).resolve().parent.parent.parent / "app" / "public" / "examples"
SMALL = (320, 240)


class _Busy:
    """another Python thread busy the whole time (a studio laying out its next page), as a context"""

    def __enter__(self):
        self.stop = False
        def burn():
            x = 0
            while not self.stop:
                for i in range(1000): x += i * i
        self.thread = threading.Thread(target=burn, daemon=True); self.thread.start(); return self

    def __exit__(self, *exc):
        self.stop = True; self.thread.join()


def test_a_settled_figure_is_asked_of_the_engine_once():
    """info (a figure's settled style and camera), residues and sceneJson answer from their arguments alone: asked again
    with the same, the answer kept is given, a fresh copy each time; an input let go is forgotten with its answers"""
    e = engine(); fig = ms.load(EX / "1A8O.pdb").look("flat")
    asked = []; js = e._js
    e._js = lambda *a: asked.append(a[1] if a[0] == "__call" else a[0]) or js(*a)
    try:
        first = fig._info(); again = fig._info()
        assert asked.count("info") == 1 and first == again and first is not again
        first["style"]["palette"]["helix"] = "#000000"
        assert fig._info()["style"]["palette"]["helix"] != "#000000"
        fig.set(palette={"helix": "#123456"})
        assert fig._info()["style"]["palette"]["helix"] == "#123456" and asked.count("info") == 2
        e.call("residues", fig._spec()); e.call("residues", fig._spec())
        assert asked.count("residues") == 1
        e.call("frames", fig._spec()); e.call("frames", fig._spec())
        assert asked.count("frames") == 2                     # not among the calls kept
    finally:
        del e._js
    e.call("drop", fig._ref)
    with pytest.raises(CoreError, match="unknown input"): fig._info()


def test_the_engine_answers_quickly_beside_a_busy_thread():
    """a call into the engine changes Python's lock between threads a few times; with another thread busy, each change
    waited for that thread's turn to end (5 ms), a dozen of them a call: 60 ms for what takes a tenth of one. A call
    now goes straight to V8 from the thread that asks, with short turns while the engine works"""
    e = engine(); fig = ms.load(EX / "1A8O.pdb").look("flat")
    spec = fig._spec(SMALL)
    alone = fig.render(SMALL).to_numpy()
    with _Busy():
        t = time.perf_counter()
        for _ in range(30): e.call("ribbons", "MolSketch", "#ffffff", "#000000")   # (a call not kept)
        took = time.perf_counter() - t
        busy = fig.render(SMALL).to_numpy()
        assert e.render_svg(spec) == fig.svg(SMALL)
    assert took < 0.6, f"30 calls took {took:.2f} s"           # 1.5 s and more before
    assert np.array_equal(busy, alone)


def test_an_engine_through_mini_racers_own_calls_draws_the_same(monkeypatch):
    """a mini-racer without the insides the straight line needs (another version) is reached through its own calls, its
    records drawn on its loop's thread: the same pictures and SVG"""
    import molsketch._engine as E
    text = (EX / "1A8O.pdb").read_text()

    def drawn(e):
        ref = e.put({"text": text, "name": "1A8O.pdb"})
        spec = lambda look: {"input": {"ref": ref}, "size": list(SMALL), "scale": 1, "frame": 0, "look": look}
        return ([e.render(spec(look)).toarray() for look in ("watercolour", "engraved-colour")], e.render_svg(spec("flat")),
                e.call("info", spec("ink"))["camera"])

    line = Engine(); assert line._line is not None
    monkeypatch.setattr(E.Line, "of", classmethod(lambda cls, v8: None))
    loop = Engine(); assert loop._line is None
    (a, sa, ca), (b, sb, cb) = drawn(line), drawn(loop)
    assert all(np.array_equal(x, y) for x, y in zip(a, b)) and sa == sb and ca == cb
    for e in (line, loop): e.v8.close()


def test_svg_or_image_draws_pixels_only_for_a_picture(monkeypatch):
    """svg_or_image keeps a drawing's ops and draws them as pixels only once they show more than shapes (a clip, as a
    surface's patches have): a drawing of shapes alone comes back as its SVG with no pixels drawn; one with a clip is
    drawn as pixels from its first clip on, as it arrives, and both are what svg() and render() give"""
    import molsketch._raster as R
    drawn = []; init = R._Replay.__init__
    def replay(self, raster, live, canvas, w=0, h=0):
        if not hasattr(canvas, "svg"): drawn.append((w, h))
        init(self, raster, live, canvas, w, h)
    flat = ms.load(EX / "1A8O.pdb").look("flat")
    surface = ms.load(EX / "1A8O.pdb").look("flat").show(cartoon=None, surface="polymer")
    want = flat.svg(SMALL), surface.render(SMALL).to_numpy()
    monkeypatch.setattr(R._Replay, "__init__", replay)
    assert flat.svg_or_image(SMALL) == want[0] and SMALL not in drawn
    img = surface.svg_or_image(SMALL)
    assert isinstance(img, ms.Image) and np.array_equal(img.to_numpy(), want[1]) and SMALL in drawn


def test_a_large_structure_is_read_once_across_runs(tmp_path, monkeypatch):
    """a large structure's text read by one run is kept as read (MOLSKETCH_CACHE/models), and a later run reads it back
    from there instead of from its text: the same residues, settled figure, scene and drawings (sticks, whose bonds and
    their orders are worked out from what was kept, ribbons and a surface). A file that is not the engine's, or of
    another version, is passed over and the text read"""
    import molsketch._engine as E
    monkeypatch.setenv("MOLSKETCH_CACHE", str(tmp_path)); monkeypatch.setattr(E, "SMALLEST", 0)   # (every structure: these are small)
    text = (EX / "test_protein_rna.cif").read_text()

    def answers(e):
        ref = e.put({"text": text, "name": "rna.cif"})
        spec = lambda **k: {"input": {"ref": ref}, "size": list(SMALL), "scale": 1, "frame": 0, **k}
        sticks = {"reps.sticks": "all", "reps.cartoon": ""}
        return (e.call("residues", spec()), e.call("info", spec(look="flat")), e.call("sceneJson", spec(style=sticks)),
                [e.render(spec(look=look, style=style)).toarray() for look, style in (("engraved-colour", sticks), ("flat", {}), ("ink", {"reps.surface": "polymer"}))],
                e.render_svg(spec(look="flat", style=sticks)))

    def same(a, b):
        return a[:3] == b[:3] and all(np.array_equal(x, y) for x, y in zip(a[3], b[3])) and a[4] == b[4]

    first = Engine(); read = answers(first); first.v8.close()
    kept = list((tmp_path / "models").glob("*.msm")); assert len(kept) == 1
    given = []; load = E.ModelCache.load
    monkeypatch.setattr(E.ModelCache, "load", lambda self, key: given.append(load(self, key)) or given[-1])
    again = Engine(); assert same(answers(again), read) and given[-1] is not None; again.v8.close()
    data = bytearray(kept[0].read_bytes()); i = data.index(b"KMSM") + 4; data[i] = 99   # another version of the layout
    kept[0].write_bytes(bytes(data))
    other = Engine(); assert same(answers(other), read) and given[-1] is not None; other.v8.close()
    kept[0].write_bytes(b"not a structure")
    broken = Engine(); assert same(answers(broken), read) and given[-1] is None; broken.v8.close()
    # numbers JSON would not keep as they are: a coordinate that does not read (NaN, and the centre with it), a -0
    lines = [line for line in (EX / "1A8O.pdb").read_text().splitlines() if line.startswith(("ATOM", "HETATM"))]
    lines[3] = lines[3][:30] + "   xx.xx" + lines[3][38:]; lines[5] = lines[5][:60] + "  -0.0" + lines[5][66:]
    text = "\n".join(lines) + "\nEND\n"; first = Engine(); read = answers(first); first.v8.close()
    again = Engine(); assert same(answers(again), read) and given[-1] is not None; again.v8.close()
