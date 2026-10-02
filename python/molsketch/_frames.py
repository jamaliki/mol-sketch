"""A video's frames drawn by a few processes at once. Each has an engine of its own (V8 draws on one thread), takes every
n-th frame (frames differ in cost, and so the work evens out) and writes its PNGs where the frame list says. They are
started as `python -m molsketch._frames`, not by multiprocessing, so a script that makes a video without an
`if __name__ == "__main__":` guard is not run again in each of them. A frame comes out as it does drawn alone: the
engine draws a frame from its spec, whatever it drew before.

MOLSKETCH_WORKERS sets how many (the default: the processor's cores, at most 4; 1 draws every frame here)."""
from __future__ import annotations

import os
import pathlib
import pickle
import subprocess
import sys
import tempfile


def workers_for(frames: int, workers: int | None = None) -> int:
    """how many processes draw `frames` frames: a few frames each at least, or starting them costs more than it saves"""
    if workers is None: workers = int(os.environ.get("MOLSKETCH_WORKERS", "0") or 0) or min(4, os.cpu_count() or 1)
    return max(1, min(workers, frames // 4))


def draw(inp: dict, maps: dict, jobs: list[tuple[str, dict]], n: int):
    """draw every (path, spec) of `jobs` in `n` processes. `inp` is the figure's input and `maps` its density maps by
    the references the specs use; the specs' own input reference is replaced by each process's"""
    with tempfile.TemporaryDirectory() as d:
        job = pathlib.Path(d) / "frames.pkl"; job.write_bytes(pickle.dumps({"input": inp, "maps": maps, "jobs": jobs}))
        env = dict(os.environ); here = str(pathlib.Path(__file__).resolve().parent.parent)   # (this package, however it was found)
        env["PYTHONPATH"] = here + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        procs = [subprocess.Popen([sys.executable, "-m", "molsketch._frames", str(job), str(k), str(n)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) for k in range(n)]
        errors = [p.communicate()[1] for p in procs]
        for p, e in zip(procs, errors):
            if p.returncode:
                last = (e.decode(errors="replace").strip().splitlines() or ["(no message)"])[-1]
                raise RuntimeError(f"drawing the frames in {n} processes failed: {last} (MOLSKETCH_WORKERS=1 draws them all here)")


def _main(job: str, k: int, n: int):
    from ._engine import engine
    from ._image import Image
    J = pickle.loads(pathlib.Path(job).read_bytes()); e = engine()
    refs = {old: e.put_map(m) for old, m in J["maps"].items()}
    inp = J["input"]
    if "map" in inp: inp = {**inp, "map": refs[inp["map"]]}
    ref = e.put(inp)
    for i, (path, spec) in enumerate(J["jobs"]):
        if i % n != k: continue
        spec = {**spec, "input": {"ref": ref}}
        if spec.get("map"): spec["map"] = {key: refs.get(v, v) if key in ("ref", "localResolution") else v for key, v in spec["map"].items()}
        Image(e.render(spec)).save(path)


if __name__ == "__main__":
    _main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
