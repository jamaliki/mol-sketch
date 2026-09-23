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
    r = len(k) // 2
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a.astype(np.int64), pad)                                       # transparent beyond the edge
    n = a.shape[axis]; s = np.zeros(a.shape, np.int64)
    for i, w in enumerate(k):                                                  # Σ kᵢ · pixel (exact integers)
        s += w * np.take(p, range(i, i + n), axis=axis)
    return (((s + half) * factor) >> 32).astype(np.uint8)


def blur(rgba_premul: np.ndarray, sigma_x: float, sigma_y: float | None = None) -> np.ndarray:
    """blur an H × W × 4 premultiplied uint8 image"""
    sigma_y = sigma_x if sigma_y is None else sigma_y
    out = rgba_premul
    if box_window(sigma_x) > 1 or sigma_x > 0.03: out = _pass(out, 1, box_window(sigma_x))
    if box_window(sigma_y) > 1 or sigma_y > 0.03: out = _pass(out, 0, box_window(sigma_y))
    return out
