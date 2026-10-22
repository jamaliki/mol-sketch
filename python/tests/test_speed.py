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

