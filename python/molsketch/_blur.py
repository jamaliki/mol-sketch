"""The canvas filter blur() as Chrome's Skia computes it on the CPU: the three-box approximation of a Gaussian
(SkBlurEngine's ThreeBoxApproxPass), in 8-bit premultiplied integers, a horizontal pass then a vertical one, each
divided with Skia's fixed-point divider. (skia-python's own Blur takes a true Gaussian for small sigmas, which differs
from Chrome by a few levels.) Pixels outside the image count as transparent, as the filter spec says."""
from __future__ import annotations

import math

import numpy as np


def box_window(sigma: float) -> int:
    """SkBlurEngine::BoxBlurWindow"""
    return max(1, math.floor(sigma * 3 * math.sqrt(2 * math.pi) / 4 + 0.5))


def _kernel(window: int) -> tuple[np.ndarray, int]:
    """the three stacked boxes as one integer kernel, and its divisor (window³, or window³ + window² for even windows,
    whose third box is one wider)"""
    box = np.ones(window, np.int64)
    k = np.convolve(np.convolve(box, box), box if window & 1 else np.ones(window + 1, np.int64))
    return k, (window ** 3 if window & 1 else window ** 3 + window ** 2)


def _pass(a: np.ndarray, axis: int, window: int) -> np.ndarray:
    k, divisor = _kernel(window)
    factor = round((1 << 32) / divisor); half = (divisor + 1) >> 1           # skvx::ScaledDividerU32
    r = len(k) // 2; n = a.shape[axis]
    shape = list(a.shape); shape[axis] = n + 2 * r
    p = np.zeros(shape, np.int32)                                              # transparent beyond the edge
    inner = [slice(None)] * a.ndim; inner[axis] = slice(r, r + n); p[tuple(inner)] = a
    def tap(i): at = [slice(None)] * a.ndim; at[axis] = slice(i, i + n); return p[tuple(at)]
    # Σ kᵢ · pixel, exact integers (at most 255 · divisor); the kernel is symmetric: its mirrored taps are summed first
    s = tap(r) * int(k[r]) if k[r] != 1 else tap(r).copy()
    for i in range(r):
        t = tap(i) + tap(len(k) - 1 - i)
        if k[i] != 1: t *= int(k[i])
        s += t
    lut = (((np.arange(255 * divisor + 1, dtype=np.int64) + half) * factor) >> 32).astype(np.uint8)   # the divider, for every sum
    return lut[s]


def blur(rgba_premul: np.ndarray, sigma_x: float, sigma_y: float | None = None) -> np.ndarray:
    """blur an H × W × 4 premultiplied uint8 image"""
    sigma_y = sigma_x if sigma_y is None else sigma_y
    out = rgba_premul
    if box_window(sigma_x) > 1 or sigma_x > 0.03: out = _pass(out, 1, box_window(sigma_x))
    if box_window(sigma_y) > 1 or sigma_y > 0.03: out = _pass(out, 0, box_window(sigma_y))
    return out
