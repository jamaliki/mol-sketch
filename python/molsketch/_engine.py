"""The engine host: MolSketch's drawing core (the same code the app runs) in an embedded V8, its recorded canvases
replayed in Skia. One Engine per process is plenty; it keeps parsed structures, the paper and text shaping cached."""
from __future__ import annotations

import asyncio
import gc
import itertools
import json
import os
import pathlib
import sys
import threading

import numpy as np

import skia
import py_mini_racer
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
// The recording reaches the host while the engine draws: each chunk is written into a ring the host reads in place
// (an ArrayBuffer it holds a view of), then a notification tells it to read. Header: int32 [0] bytes written, [1] bytes
// read (the host's); a record is int32 JSON length (characters), runs length and width (1: Latin-1 bytes, 2: UTF-16),
// the JSON, the runs, each padded to 4; -1 where a record would not fit before the end of the ring and the next
// starts at its beginning.
// V8 cannot hand over anything else mid-run: the host touching a JS value waits for the engine to finish.
globalThis.__RING = new ArrayBuffer(%RING%);
(() => {
  const D0 = 64, CAP = __RING.byteLength - D0, H = new Int32Array(__RING, 0, 16), I32 = new Int32Array(__RING), U16 = new Uint16Array(__RING), U8 = new Uint8Array(__RING);
  let written = 0;
  globalThis.__ringReset = () => { written = 0; Atomics.store(H, 0, 0); Atomics.store(H, 1, 0); return 0 };
  globalThis.__ringPut = (chunk) => {
    if (!globalThis.__note) return false;
    const js = JSON.stringify({ canvases: chunk.canvases, paints: chunk.paints, dead: chunk.dead }), runs = chunk.runs;
    let wide = 1; for (let i = 0; i < js.length; i++) if (js.charCodeAt(i) > 255) { wide = 2; break }
    const jb = (js.length * wide + 3) & ~3, rb = (runs.length + 3) & ~3, need = 12 + jb + rb;
    if (need > CAP) return false;   // too big for the ring: it waits for the end of the render
    let pos = written % CAP; const tail = CAP - pos, wrap = tail < need;
    while (CAP - (written - Atomics.load(H, 1)) < (wrap ? tail + need : need)) { }   // the host is still reading
    if (wrap) { I32[(D0 + pos) >> 2] = -1; written += tail; pos = 0 }
    const o = D0 + pos; I32[o >> 2] = js.length; I32[(o >> 2) + 1] = runs.length; I32[(o >> 2) + 2] = wide;
    if (wide === 1) for (let i = 0, u = o + 12; i < js.length; i++) U8[u + i] = js.charCodeAt(i);
    else for (let i = 0, u = (o + 12) >> 1; i < js.length; i++) U16[u + i] = js.charCodeAt(i);
    U8.set(runs, o + 12 + jb);
    written += need; Atomics.store(H, 0, written);
    __note(0);
    return true;
  };
  MolSketchCore.setStream(__ringPut);
})();
// what the ring did not take stays here for the host to pull
globalThis.__last = null;
// a density map's grid, written by the host straight into this buffer (no JSON), then registered
globalThis.__MB = null;
globalThis.__mapBuf = (n) => { __MB = new Float32Array(n); return __MB.buffer };
globalThis.__putMap = (ref, header) => { const r = MolSketchCore.putMap(ref, JSON.parse(header), __MB); __MB = null; return r };
globalThis.__abort = null;
globalThis.__render = (spec) => { __miss = []; __abort = null; let r;
  try { r = MolSketchCore.render(JSON.parse(spec), __measure) } catch (e) { __last = (e && e.chunks) || []; __abort = e && e.canvas; throw e }
  __last = r.chunks;
  return JSON.stringify({ canvas: r.canvas, width: r.width, height: r.height, ms: r.ms, miss: __miss, held: r.chunks.length }) };
globalThis.__heldJson = (k) => { const c = __last[k]; return JSON.stringify({ canvases: c.canvases, paints: c.paints, dead: c.dead }) };
globalThis.__heldRuns = (k) => __last[k].runs.buffer;
globalThis.__done = () => { __last = null; return 0 };
globalThis.__aborted = () => JSON.stringify({ canvas: __abort ?? null, held: (__last || []).length });
globalThis.__learn = (rows) => { for (const [f, t, w] of JSON.parse(rows)) __M.set(f + '\u0001' + t, w); return __M.size };
"""


class CoreError(RuntimeError):
    """An error reported by the drawing engine, such as a label pinned to an atom that does not exist. The message
    says what was wrong."""


def _init_v8():
    """V8 with its background threads (compiling and collecting garbage beside the engine: a large figure draws in
    half the time). mini-racer's default is single-threaded, which a process that forks after drawing may need:
    MOLSKETCH_V8_SINGLE_THREADED=1 keeps it."""
    flags = ("--single-threaded",) if os.environ.get("MOLSKETCH_V8_SINGLE_THREADED") else ()
    try: py_mini_racer.init_mini_racer(flags=flags, ignore_duplicate_init=True)
    except Exception: pass   # already started by someone else: theirs it is


class Engine:
    _lock = threading.Lock()
    _ids = itertools.count(1)

    def __init__(self):
        _init_v8()
        self.v8 = MiniRacer()
        self.v8.eval(CORE.read_text())
        self.v8.eval(PRELUDE.replace("%RING%", str(RING)))
        self.text = TextEngine()
        self.raster = Raster(self.text)
        # the ring the engine writes its recording into, read in place, and the notification that a record is there:
        # handled on mini-racer's event-loop thread, so the replay runs while V8 goes on drawing
        self._maps: dict[int, tuple] = {}
        self._ring = self.v8.eval("__RING"); self._i32 = self._ring.cast("i"); self._read = 0; self._err = None
        ctx = self.v8._ctx

        async def register():
            cm = ctx._register_js_notification(self._on_record); return cm, cm.__enter__()
        self._note_cm, note = asyncio.run_coroutine_threadsafe(register(), ctx.event_loop).result()
        self.v8.eval("(f) => { globalThis.__note = f }")(note)

    def _resync(self):
        """after the engine threw mid-render: take what it had recorded, so the canvases here stay in step with its own,
        and let the frame's canvas go"""
        try:
            a = json.loads(self.v8.call("__aborted"))
            for k in range(a["held"]): self.raster.feed(self.v8.call("__heldJson", k), bytes(self.v8.eval(f"__heldRuns({k})")))
            self.v8.call("__done")
            if a["canvas"] is not None: self.raster.drop(a["canvas"])
        except Exception: pass   # nothing recorded (the spec itself was refused)

    def _on_record(self, _value):
        """one record in the ring: copy it out, free its space, then draw it (on mini-racer's loop thread)"""
        if self._err is not None: return
        try:
            i32 = self._i32; pos = self._read % (RING - 64); o = 64 + pos
            n = i32[o >> 2]
            if n == -1: self._read += RING - 64 - pos; o = 64; n = i32[o >> 2]
            r = i32[(o >> 2) + 1]; wide = i32[(o >> 2) + 2]; jb = (wide * n + 3) & ~3
            raw = self._ring[o + 12:o + 12 + wide * n].tobytes()
            js = raw.decode("latin-1") if wide == 1 else raw.decode("utf-16-le", "surrogatepass")
            runs = self._ring[o + 12 + jb:o + 12 + jb + r].tobytes()
            self._read += 12 + jb + ((r + 3) & ~3); i32[1] = self._read
            self.raster.feed(js, runs)
        except BaseException as e:  # reported by the render that sent it
            self._err = e

    def call(self, name: str, *args):
        with self._lock:
            try:
                return json.loads(self.v8.call("__call", name, json.dumps(args)))
            except Exception as e:  # mini-racer wraps JS errors; give the core's message, not V8's frame dump
                raise CoreError(_js_message(e)) from None

    def put_map(self, m) -> str:
        """register a DensityMap with the core (once per map): its grid copied straight into a V8 buffer"""
        cached = self._maps.get(id(m))
        if cached and cached[0] is m: return cached[1]
        ref = f"map{next(self._ids)}"
        with self._lock:
            buf = self.v8.eval(f"__mapBuf({m.data.size})")
            np.frombuffer(buf, np.float32)[:] = m.data.ravel()   # (z, y, x) C order: x fastest, as the core reads it
            self.v8.call("__putMap", ref, json.dumps(m.header()))
        self._maps[id(m)] = (m, ref)
        return ref

    def put(self, value) -> str:
        ref = f"in{next(self._ids)}"
        self.call("put", ref, value)
        return ref

    def render_svg(self, spec: dict) -> str:
        """the figure as SVG: its canvas replayed as vector elements (what it draws off screen, embedded as images)"""
        self.raster.lazy = True
        try: return self.render(spec, svg=True)
        finally: self.raster.lazy = False

    def render(self, spec: dict, svg: bool = False):
        # a large figure is millions of small objects (ops, paths) and none of them in a cycle: Python's collector,
        # walking them again and again as they arrive, would cost more than the drawing
        # and V8 hands records over through Python's lock: switching threads every 0.5 ms rather than 5 keeps the
        # engine from waiting on the replay while it draws
        was = gc.isenabled(); gc.disable(); sw = sys.getswitchinterval(); sys.setswitchinterval(0.0005)
        try: return self._render(spec, svg)
        finally:
            sys.setswitchinterval(sw)
            if was: gc.enable()

    def _render(self, spec: dict, svg: bool = False):
        with self._lock:
            main = None
            try:
                for attempt in range(4):
                    self.v8.eval("__ringReset()"); self._read = 0; self._err = None
                    try:
                        # the records the ring takes are drawn while this runs; by the time it returns (mini-racer
                        # delivers the result after the notifications sent before it) they all have been
                        r = json.loads(self.v8.call("__render", json.dumps(spec))); main = r["canvas"]
                        held = [(self.v8.call("__heldJson", k), bytes(self.v8.eval(f"__heldRuns({k})"))) for k in range(r["held"])]
                        self.v8.call("__done")
                    except Exception as e:
                        self._resync(); raise CoreError(_js_message(e)) from None
                    if self._err is not None: raise self._err
                    for js, runs in held: self.raster.feed(js, runs)
                    if not r["miss"] or attempt == 3: break
                    self.raster.drop(main)   # a frame drawn with guessed text widths: measure them and draw it again
                    rows = [(f, t, self.text.measure(f, t)) for f, t in {(f, t) for f, t in r["miss"]}]
                    self.v8.call("__learn", json.dumps(rows))
                    self.misses = r["miss"]
                img = self.raster.vector(main, spec.get("scale", 1)) if svg else self.raster.image(main)
            finally:   # the frame's canvas and the render's paints are done with, whatever happened
                if main is not None: self.raster.drop(main)
                self.raster.end_render()
            if len(self.raster.live) > 48: self.v8.low_memory_notification()   # a full collection, so the engine's dropped canvases are reported
            return img


RING = 64 << 20   # bytes: records larger than this wait for the end of the render


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
