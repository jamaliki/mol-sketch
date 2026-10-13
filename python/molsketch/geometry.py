"""Geometry for building mechanism scenes: place atoms by internal coordinates, pose one group against another by the
six coordinates of a relative rigid-body pose, and measure what a scene draws.

    from molsketch import geometry as g

    o = g.place(h, br, c, 3.10, 180, 0)            # 3.10 Å from C, ∠Br–C–O = 180°: σ* backside attack
    hydroxide = g.relative_pose((c, br, h1), {"O": [0, 0, 0], "H": [0.97, 0, 0]}, ("O", "H"),
                                d=3.10, alpha_a=180, alpha_b=110, tau_a=0, tau_ab=60)

Angles are in degrees, distances in Å. ``relative_pose`` follows the frame convention of the Jamali Lab chemistry
engine: with (A1, A2, A3) the catalytic group's frame and (B1, B2, B3) its partner's,

    d = |A1 − B1|,  αA = ∠(A2, A1, B1),  αB = ∠(A1, B1, B2),
    τA = dih(A3, A2, A1, B1),  τAB = dih(A2, A1, B1, B2),  τB = dih(A1, B1, B2, B3).

A frame with a missing atom (``None``) leaves the coordinates that need it free; so does a collinear frame (αA = 180°
makes τA meaningless). A free coordinate is chosen once, the same way every time, so a scene builds identically.
"""
from __future__ import annotations

from typing import Mapping, Sequence

import numpy as np

__all__ = ["place", "distance", "angle", "torsion", "relative_pose", "internal_pose", "lone_pairs", "rotate", "superpose"]

Vec = Sequence[float]


def _v(p) -> np.ndarray:
    return np.asarray(p, dtype=float)


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n < 1e-12: raise ValueError("zero-length vector")
    return v / n


def _perp(v: np.ndarray) -> np.ndarray:
    """a fixed unit vector perpendicular to v"""
    u = _unit(v); t = np.array([0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    return _unit(np.cross(u, t))


def distance(a: Vec, b: Vec) -> float:
    """|b − a| in Å"""
    return float(np.linalg.norm(_v(b) - _v(a)))


def angle(a: Vec, b: Vec, c: Vec) -> float:
    """∠abc in degrees, at b"""
    u, w = _unit(_v(a) - _v(b)), _unit(_v(c) - _v(b))
    return float(np.degrees(np.arccos(np.clip(u @ w, -1, 1))))


def torsion(a: Vec, b: Vec, c: Vec, d: Vec) -> float:
    """the dihedral angle a–b–c–d in degrees, in (−180, 180]; positive is clockwise looking from b to c (IUPAC)"""
    a, b, c, d = map(_v, (a, b, c, d))
    b0, b1, b2 = a - b, _unit(c - b), d - c
    v = b0 - (b0 @ b1) * b1; w = b2 - (b2 @ b1) * b1
    return float(np.degrees(np.arctan2(np.cross(b1, v) @ w, v @ w)))


def place(a: Vec | None, b: Vec, c: Vec, dist: float, ang: float, tors: float) -> np.ndarray:
    """The point D with |CD| = ``dist``, ∠BCD = ``ang`` and dihedral A–B–C–D = ``tors``: one row of a Z-matrix (the
    NeRF construction). ``a`` may be None, or collinear with b and c; the torsion is then measured from a fixed
    reference perpendicular to b–c."""
    b, c = _v(b), _v(c)
    bc = _unit(c - b)
    ref = None
    if a is not None:
        r = b - _v(a); r = r - (r @ bc) * bc
        if np.linalg.norm(r) > 1e-6: ref = _unit(r)
    if ref is None: ref = _perp(bc)
    # the frame of the NeRF step: bc along b→c, n normal to the a-b-c plane, y in that plane
    n = _unit(np.cross(ref, bc))
    y = np.cross(n, bc)
    th, ph = np.radians(ang), np.radians(tors)
    local = np.array([-np.cos(th), np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph)])
    return c + dist * (local[0] * bc + local[1] * y + local[2] * n)


def superpose(mobile: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The rotation R and translation t that best put the points ``mobile`` (n×3) on ``target`` (Kabsch):
    target ≈ mobile @ R.T + t"""
    mobile, target = _v(mobile), _v(target)
    cm, ct = mobile.mean(0), target.mean(0)
    h = (mobile - cm).T @ (target - ct)
    u, _, vt = np.linalg.svd(h)
    dsign = np.sign(np.linalg.det(vt.T @ u.T)) or 1.0
    r = vt.T @ np.diag([1.0, 1.0, dsign]) @ u.T
    return r, ct - cm @ r.T


def rotate(points: Mapping[str, Vec], axis: Vec, deg: float, about: Vec = (0, 0, 0)) -> dict[str, list[float]]:
    """``points`` turned by ``deg`` about ``axis`` through ``about`` (right-handed)"""
    k = _unit(_v(axis)); o = _v(about); th = np.radians(deg)
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    r = np.eye(3) + np.sin(th) * kx + (1 - np.cos(th)) * kx @ kx
    return {i: ((r @ (_v(p) - o)) + o).tolist() for i, p in points.items()}


def relative_pose(frame_a: Sequence[Vec | None], partner: Mapping[str, Vec], frame_b: Sequence[str | None], *,
                  d: float, alpha_a: float, alpha_b: float | None = None, tau_a: float = 0.0, tau_ab: float = 0.0,
                  tau_b: float = 0.0) -> dict[str, list[float]]:
    """Pose ``partner`` (atom id → position, in any frame) against a fixed group by the six internal coordinates.

    ``frame_a`` is (A1, A2, A3) as positions, A1 the atom the partner meets; ``frame_b`` is (B1, B2, B3) as ids in
    ``partner``, B1 the partner's reacting atom. Returns the partner's atoms in the fixed group's frame. B's own shape
    is kept: |B1B2|, |B2B3| and ∠B1B2B3 come from ``partner``, so the result is a rigid motion of it, and measuring the
    returned coordinates gives back d, αA, αB, τA, τAB and τB (those the frames define)."""
    a1, a2, a3 = (None if p is None else _v(p) for p in (list(frame_a) + [None, None])[:3])
    if a2 is None: raise ValueError("frame_a needs at least A1 and A2")
    ids = (list(frame_b) + [None, None])[:3]; b1, b2, b3 = ids
    own = {i: _v(p) for i, p in partner.items()}
    if b1 not in own: raise KeyError(f"B1 {b1!r} is not in the partner")
    p1 = place(a3, a2, a1, d, alpha_a, tau_a)
    if b2 is None:   # a single atom: a translation
        return {i: (p - own[b1] + p1).tolist() for i, p in own.items()}
    if alpha_b is None: raise ValueError("alpha_b is needed when the partner's frame has B2")
    p2 = place(a2, a1, p1, distance(own[b1], own[b2]), alpha_b, tau_ab)
    if b3 is not None:
        p3 = place(a1, p1, p2, distance(own[b2], own[b3]), angle(own[b1], own[b2], own[b3]), tau_b)
        r, t = superpose(np.array([own[b1], own[b2], own[b3]]), np.array([p1, p2, p3]))
    else:   # B1–B2 only: the turn about that axis is free; keep the partner's own perpendicular on a fixed reference
        u_own = _unit(own[b2] - own[b1]); u_new = _unit(p2 - p1)
        r, t = superpose(np.array([own[b1], own[b2], own[b1] + _perp(u_own)]), np.array([p1, p2, p1 + _perp(u_new)]))
    return {i: (p @ r.T + t).tolist() for i, p in own.items()}


def internal_pose(frame_a: Sequence[Vec | None], frame_b: Sequence[Vec | None]) -> dict[str, float | None]:
    """The six coordinates of a pose read back from positions (None where a frame atom is missing or the frame is
    collinear): d, alpha_a, alpha_b, tau_a, tau_ab, tau_b"""
    a1, a2, a3 = (list(frame_a) + [None, None])[:3]; b1, b2, b3 = (list(frame_b) + [None, None])[:3]
    def safe(f, *p):
        if any(x is None for x in p): return None
        try:
            return f(*p)
        except ValueError:
            return None
    def dih(*p):
        p = [_v(x) for x in p]
        if np.linalg.norm(np.cross(p[1] - p[0], p[2] - p[1])) < 1e-6 or np.linalg.norm(np.cross(p[2] - p[1], p[3] - p[2])) < 1e-6: raise ValueError
        return torsion(*p)
    return {"d": safe(distance, a1, b1), "alpha_a": safe(angle, a2, a1, b1), "alpha_b": safe(angle, a1, b1, b2),
            "tau_a": safe(dih, a3, a2, a1, b1), "tau_ab": safe(dih, a2, a1, b1, b2), "tau_b": safe(dih, a1, b1, b2, b3)}


def lone_pairs(center: Vec, bonded: Sequence[Vec], n: int, *, toward: Vec | None = None) -> list[list[float]]:
    """``n`` lone-pair directions (unit vectors, for an atom's ``lp``) on an atom with the given bonded neighbours,
    pointing where the electron domains are: tetrahedral for four domains in all, trigonal for three. With ``toward``,
    the first one is the domain nearest that point (the pair that reacts), the set turned about the bonds so it points
    as close to it as the bonds allow."""
    c = _v(center); bs = [_unit(_v(b) - c) for b in bonded]
    domains = len(bs) + n
    if n <= 0: return []
    if not bs:   # an ion with no bonds (a halide): the first pair where asked, the rest tetrahedral to it
        first = _unit(_v(toward) - c) if toward is not None else np.array([1.0, 0, 0])
        return [first.tolist()] + _spread([first], n - 1, 4)[:n - 1]
    out = _spread(bs, n, domains)
    if toward is not None:
        t = _unit(_v(toward) - c)
        if len(bs) == 1 and domains == 4:   # turn the three pairs about the single bond so one faces the target
            axis = bs[0]; best = None
            for k in range(360):
                cand = [list(rotate({"x": p}, axis, k)["x"]) for p in out]
                s = max(np.dot(p, t) for p in cand)
                if best is None or s > best[0] + 1e-9: best = (s, cand)
            out = best[1]
        out.sort(key=lambda p: -float(np.dot(p, t)))
    return out


def _spread(bs: list[np.ndarray], n: int, domains: int) -> list[list[float]]:
    """directions for n more domains around bonds bs, in a tetrahedral (4) or trigonal (3) arrangement"""
    s = -_unit(sum(bs)) if np.linalg.norm(sum(bs)) > 1e-6 else _perp(bs[0])
    if domains == 4 and len(bs) == 3: return [s.tolist()]
    if domains == 3 and len(bs) == 2: return [s.tolist()]
    if domains == 4 and len(bs) == 2:
        nrm = _unit(np.cross(bs[0], bs[1])); th = np.radians(109.47 / 2)
        return [_unit(np.cos(th) * s + np.sin(th) * nrm).tolist(), _unit(np.cos(th) * s - np.sin(th) * nrm).tolist()][:n]
    if domains == 4 and len(bs) == 1:
        a = -bs[0]; p = _perp(a); q = np.cross(a, p); th = np.radians(180 - 109.47)
        return [_unit(np.cos(th) * a + np.sin(th) * (np.cos(k) * p + np.sin(k) * q)).tolist() for k in np.radians([0, 120, 240])][:n]
    if domains == 3 and len(bs) == 1:
        a = -bs[0]; p = _perp(a); th = np.radians(60)
        return [_unit(np.cos(th) * a + np.sin(th) * p).tolist(), _unit(np.cos(th) * a - np.sin(th) * p).tolist()][:n]
    return [s.tolist()] * n
