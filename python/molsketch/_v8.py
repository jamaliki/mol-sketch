"""A straight line to V8 from the thread that asks.

mini-racer runs every call through its asyncio loop: the call hops to the loop's thread, from there to V8, and its
answer hops back the same way, Python's lock changing hands a dozen times. While another Python thread is busy (a
studio laying out its next page, say), each change of hands waits for that thread's turn to end, 5 ms by default, and a
call that takes a tenth of a millisecond takes sixty. Here a call is handed to V8 from the calling thread and its answer
read there, as mini-racer itself does on its loop's thread (its uncancelable tasks), so the lock changes hands only to
let the answer in. The engine holds its own lock around every use, so one call at a time.

What the engine hands over while it draws (a notification that a record is in the ring) comes the same way, ahead of
the render's own answer, and is taken in by the thread waiting for it: the drawing is replayed where it was asked for,
in the order it was sent, with no other thread between.

``turns()`` shortens Python's thread turns while the engine works, so the handovers that remain wait half a millisecond
rather than five behind a busy thread."""
from __future__ import annotations

import contextlib
import sys

TURN = 0.0005   # seconds: a thread's turn while the engine works (Python's default is 0.005)
_ARRAY = 6      # mini-racer's type of a value that is an array (a notification's arguments)


@contextlib.contextmanager
def turns():
    """Python's thread turns kept short (``TURN``) for the length of the block, then as they were"""
    was = sys.getswitchinterval()
    if was <= TURN: yield; return
    sys.setswitchinterval(TURN)
    try: yield
    finally: sys.setswitchinterval(was)


class Line:
    """V8's answers read on the calling thread. ``of`` gives None for a mini-racer without what it needs (another
    version's insides), and the engine then goes through mini-racer's own calls."""

    def __init__(self, v8):
        ctx = v8._ctx
        self._ctx = ctx; self._dll = ctx._dll; self._raw = ctx._ctx
        self._answers = ctx._non_cancelable_mr_task_results_queue
        self._to_js = ctx._python_to_value_handle; self._to_py = ctx._value_handle_to_python
        self._eval_task = self._dll.mr_eval; self._call_task = self._dll.mr_call_function

    @classmethod
    def of(cls, v8) -> "Line | None":
        try: return cls(v8)
        except AttributeError: return None

    def _task(self, method, *args, notes=None):
        """a task of mini-racer's (0: its answer goes to the queue mini-racer keeps for uncancelable tasks), its answer.
        With ``notes``, the notifications that come before the answer (see ``notifier``) are each handed to it"""
        method(self._raw, *args, 0)
        stopped = None
        while True:
            # (interrupted, it still waits for the answer: left in the queue, it would be taken for the next call's)
            try: value = self._answers.get()
            except BaseException as e: stopped = stopped or e; continue
            if notes is not None and value.raw.contents.type == _ARRAY: notes(); continue   # a notification's arguments
            if stopped is not None: raise stopped
            return self._to_py(value)

    def eval(self, code: str, notes=None):
        """``code`` run, its value (a number, a string, a buffer, an object's handle); ``notes`` as in ``_task``"""
        handle = self._to_js(code)   # (held until the answer is in: V8 reads it while it runs)
        return self._task(self._eval_task, handle.raw, notes=notes)

    def notifier(self):
        """a JS function that, called, sends a notification down this line: to the ``notes`` of the task under way"""
        return self._to_py(self._ctx._wrap_raw_handle(self._dll.mr_make_js_callback(self._raw, 0)))

    def call(self, fn, *args):
        """the JS function ``fn`` called with ``args`` (numbers, strings), its value"""
        argv = self.eval("[]")
        for a in args: self._ctx.array_push(argv, a)
        from py_mini_racer import JSUndefined
        this = self._to_js(JSUndefined)
        return self._task(self._call_task, fn.raw_handle.raw, this.raw, argv.raw_handle.raw)
