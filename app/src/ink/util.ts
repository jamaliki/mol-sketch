/* Small helpers shared by the stroke engine (ported from the canvas page). */
export const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export type Pt = [number, number];

export function mulberry32(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
export type Rng = () => number;
export function strHash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h }

/** 1-D value noise on a ring of random samples, cosine interpolated. */
export class Noise1 {
  v: number[] = []; n: number;
  constructor(rng: Rng, n = 48) { for (let i = 0; i < n; i++) this.v.push(rng() * 2 - 1); this.n = n }
  at(t: number) { const i = Math.floor(t), f = t - i, a = this.v[((i % this.n) + this.n) % this.n], b = this.v[(((i + 1) % this.n) + this.n) % this.n]; const u = (1 - Math.cos(f * Math.PI)) / 2; return a * (1 - u) + b * u }
}

export function hexToRgb255(h: string): [number, number, number] { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
export function rgba(h: string, a: number) { const [r, g, b] = hexToRgb255(h); return `rgba(${r},${g},${b},${a})` }
export function mix(h1: string, h2: string, t: number) { const a = hexToRgb255(h1), b = hexToRgb255(h2); const c = a.map((v, i) => Math.round(lerp(v, b[i], t))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') }
export function luminance(h: string) { const [r, g, b] = hexToRgb255(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
export function hexToHsl(h: string): [number, number, number] { let [r, g, b] = hexToRgb255(h).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, ss = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); switch (mx) { case r: hh = (g - b) / d + (g < b ? 6 : 0); break; case g: hh = (b - r) / d + 2; break; default: hh = (r - g) / d + 4 } hh /= 6 } return [hh * 360, ss, l] }
export function hslToHex(h: number, s: number, l: number) { h = ((h % 360) + 360) % 360 / 360; const f = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }; let r, g, b; if (s === 0) { r = g = b = l } else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3) } return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') }

/** Convex hull (monotone chain). */
export function hull(pts: Pt[]): Pt[] { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (pts.length < 3) return pts; const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo: Pt[] = []; for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) } const up: Pt[] = []; for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p) } up.pop(); lo.pop(); return lo.concat(up) }

export function pathOf(ctx: CanvasRenderingContext2D, pts: Pt[], close = true) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (close) ctx.closePath() }
export function polyArea(p: Pt[]) { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u[0] * v[1] - v[0] * u[1] } return a / 2 }
