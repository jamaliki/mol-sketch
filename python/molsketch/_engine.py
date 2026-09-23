"""The engine host: MolSketch's drawing core (the same code the app runs) in an embedded V8, its recorded canvases
replayed in Skia. One Engine per process is plenty; it keeps parsed structures, the paper and text shaping cached."""
from __future__ import annotations

import itertools
import json
import pathlib
import threading

import numpy as np
import skia
from py_mini_racer import MiniRacer

from ._raster import Raster
from ._text import TextEngine

CORE = pathlib.Path(__file__).resolve().parent / "_core.js"
# the engine measures text synchronously; V8 cannot call back into Python, so the host keeps a table of measured
# strings in V8, renders, and if the engine asked for any it had not seen, measures those and renders again
PRELUDE = r"""
globalThis.__M = new Map(); globalThis.__miss = [];
// Chrome shapes text a word at a time (no kerning or alternates across a space), so a string's width is exactly the sum of
// its words' and its spaces': the table holds words, and any string the engine measures is summed from them
globalThis.__measure = (font, text) => { let w = 0, miss = false; const m = /([\d.]+)px/.exec(font); const guess = (m ? +m[1] : 10) * 0.5;
  for (const word of text.split(/( )/)) { if (!word) continue; const v = __M.get(font + '\u0001' + word);
    if (v === undefined) { __miss.push([font, word]); miss = true; w += word.length * guess } else w += v }
  return w };
globalThis.__call = (name, args) => JSON.stringify(MolSketchCore[name](...JSON.parse(args)) ?? null);
// a render's recording stays here and the host pulls it in slices: a large structure records millions of ops, more
// than one JSON string can hold
globalThis.__last = null;
globalThis.__render = (spec) => { __miss = []; const r = MolSketchCore.render(JSON.parse(spec), __measure); __last = r;
  return JSON.stringify({ canvas: r.canvas, width: r.width, height: r.height, ms: r.ms, miss: __miss,
    sizes: Object.fromEntries(Object.entries(r.canvases).map(([id, c]) => [id, [c.start, c.ops.length]])) }) };
globalThis.__slice = (id, from, n) => JSON.stringify(__last.canvases[id].ops.slice(from, from + n));
globalThis.__points = () => __last.streams.points.buffer; globalThis.__verbs = () => __last.streams.verbs.buffer;
globalThis.__done = () => { __last = null; return 0 };
globalThis.__learn = (rows) => { for (const [f, t, w] of JSON.parse(rows)) __M.set(f + '\u0001' + t, w); return __M.size };
"""


class CoreError(RuntimeError):
    """an error from the drawing core (a bad selection, an unknown look, …), with its message as the core gave it"""


class Engine:
    _lock = threading.Lock()
    _ids = itertools.count(1)

    def __init__(self):
        self.v8 = MiniRacer()
        self.v8.eval(CORE.read_text())
        self.v8.eval(PRELUDE)
        self.text = TextEngine()
        self.raster = Raster(self.text)

    def call(self, name: str, *args):
        with self._lock:
            try:
                return json.loads(self.v8.call("__call", name, json.dumps(args)))
            except Exception as e:  # mini-racer wraps JS errors; give the core's message, not V8's frame dump
                raise CoreError(_js_message(e)) from None

    def _pull(self, cid, n):
        ops = []
        for i in range(0, n, SLICE): ops.extend(json.loads(self.v8.call("__slice", cid, i, SLICE)))
        return ops

    def put(self, value) -> str:
        ref = f"in{next(self._ids)}"
        self.call("put", ref, value)
        return ref

    def render(self, spec: dict) -> skia.Image:
        with self._lock:
            for attempt in range(4):
                try:
                    r = json.loads(self.v8.call("__render", json.dumps(spec)))
                    r["canvases"] = {cid: {"start": start, "ops": self._pull(cid, n)} for cid, (start, n) in r["sizes"].items()}
                    pts = np.frombuffer(bytes(self.v8.eval("__points()")), np.float32); vbs = np.frombuffer(bytes(self.v8.eval("__verbs()")), np.uint8)   # binary, not JSON (eval: call would encode it)
                    self.v8.call("__done")
                except Exception as e:
                    raise CoreError(_js_message(e)) from None
                self.raster.add(r["canvases"], pts, vbs)
                if not r["miss"] or attempt == 3: break
                self.raster.forget(r["canvas"])   # a frame drawn with guessed text widths: measure them and draw it again
                rows = [(f, t, self.text.measure(f, t)) for f, t in {(f, t) for f, t in r["miss"]}]
                self.v8.call("__learn", json.dumps(rows))
                self.misses = r["miss"]
            img = self.raster.image(r["canvas"])
            self.raster.forget(r["canvas"]); self.raster.compact()
            return img


SLICE = 250_000


def _js_message(e: Exception) -> str:
    s = str(e)
    for line in s.splitlines():
        line = line.strip()
        if line.startswith(("Error:", "RangeError:", "TypeError:", "SyntaxError:")): return line.split(":", 1)[1].strip()
    return s.splitlines()[0] if s else repr(e)


_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None: _engine = Engine()
    return _engine
