/* Paper: base grain, watercolour wash pools that breathe, and the grain overlay multiplied over the drawing. Ported from the canvas page. */
import { clamp, mulberry32, luminance, rgba, mix, hexToHsl, hslToHex, type Pt, type Rng } from './util';
import { wcDeform } from './strokes';
import type { Style } from '../style';

const cache = new Map<string, HTMLCanvasElement>();
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }

export function paperBase(style: Style, W: number, H: number, dpr: number): HTMLCanvasElement {
  const key = ['base', W, H, dpr, style.palette.paper, style.paper.grain].join('|'); const hit = cache.get(key); if (hit) return hit;
  const c = canvas(W * dpr, H * dpr); const x = c.getContext('2d')!; x.scale(dpr, dpr);
  x.fillStyle = style.palette.paper; x.fillRect(0, 0, W, H);
  const rng = mulberry32(1234); const dark = luminance(style.palette.paper) > 0.5; const g = style.paper.grain;
  const n = Math.round(W * H / 38 * g);
  for (let i = 0; i < n; i++) { const a = rng(); x.fillStyle = dark ? `rgba(70,50,20,${0.02 + a * 0.07})` : `rgba(255,255,255,${0.02 + a * 0.06})`; const s = rng() < 0.85 ? 1 : 1.6; x.fillRect(rng() * W, rng() * H, s, s) }
  const nf = Math.round(220 * g); x.lineWidth = 0.6;
  for (let i = 0; i < nf; i++) { const px = rng() * W, py = rng() * H, an = rng() * Math.PI, l = 6 + rng() * 22; x.strokeStyle = dark ? `rgba(90,70,40,${0.03 + rng() * 0.05})` : `rgba(255,255,255,${0.03 + rng() * 0.05})`; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(an) * l, py + Math.sin(an) * l); x.stroke() }
  cache.set(key, c); return c;
}

/** Paper with its wash. `boil` advances the wash by washLife; the pools stay where they are and only their layers move. */
export function paper(style: Style, W: number, H: number, dpr: number, boil: number): HTMLCanvasElement {
  const life = style.paper.wash > 0 ? style.paper.washLife : 0; const wb = life > 0 ? Math.floor((boil | 0) / 2) : 0;
  const key = ['paper', W, H, dpr, style.palette.paper, style.paper.grain, style.paper.wash, style.paper.washSeed, style.palette.wash, life, wb, style.paper.washScale].join('|');
  const hit = cache.get(key); if (hit) return hit;
  const base = paperBase(style, W, H, dpr);
  const c = canvas(W * dpr, H * dpr); const x = c.getContext('2d')!; x.scale(dpr, dpr);
  x.drawImage(base, 0, 0, W, H);
  if (style.paper.wash > 0) watercolourWash(style, x, W, H, dpr, wb, life);
  // keep the cache small
  if (cache.size > 12) { const k = cache.keys().next().value; if (k !== undefined) cache.delete(k) }
  cache.set(key, c); return c;
}

/* Real washes have crisp, feathery edges and a darker pigment ring, not a blur. Each pool is a polygon whose edges are recursively displaced,
   stacked as ~26 lightly deformed, nearly transparent layers; their thin outlines pile up into the drying ring. Granulation settles inside. */
function watercolourWash(style: Style, xPaper: CanvasRenderingContext2D, W: number, H: number, dpr: number, boil: number, life: number) {
  const amt = style.paper.wash; const base = style.palette.wash; const light = luminance(style.palette.paper) > 0.5;
  const off = canvas(Math.round(W * dpr), Math.round(H * dpr)); const x = off.getContext('2d')!; x.scale(dpr, dpr);
  let rng: Rng = mulberry32(9000 + style.paper.washSeed * 131);
  const path = (pts: Pt[]) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath() };
  const [bh, bs, bl] = hexToHsl(base);
  const n = 2 + Math.floor(rng() * 3); const layers = 26; const sc0 = style.paper.washScale;
  x.save();
  for (let k = 0; k < n; k++) {
    const cx = W * (0.12 + rng() * 0.76), cy = H * (0.12 + rng() * 0.76), r = Math.min(W, H) * (0.11 + rng() * 0.16) * sc0;
    const col = hslToHex(bh + (rng() - 0.5) * 14, clamp(bs * (0.85 + rng() * 0.3), 0, 0.75), clamp(bl + (rng() - 0.5) * 0.08, 0.3, 0.85));
    const m = 8 + Math.floor(rng() * 5); const poly: Pt[] = []; for (let i = 0; i < m; i++) { const a = i / m * Math.PI * 2 + rng() * 0.3; const rad = r * (0.75 + rng() * 0.5); poly.push([cx + Math.cos(a) * rad * 1.2, cy + Math.sin(a) * rad * 0.9]) }
    const shape = wcDeform(poly, 3, 0.34, rng);
    const aFill = 0.04;
    const rngPool = rng; rng = mulberry32(9000 + style.paper.washSeed * 131 + k * 977 + (life > 0 ? boil * 17 : 0));
    for (let L = 0; L < layers; L++) { const sc = 0.8 + rng() * 0.24; const lay = wcDeform(shape.map(p => [cx + (p[0] - cx) * sc, cy + (p[1] - cy) * sc] as Pt), 2, (0.14 + rng() * 0.16) * (1 + 0.5 * life), rng); path(lay); x.fillStyle = rgba(col, aFill); x.fill() }
    for (let e = 0; e < 3; e++) { const sc = 0.97 + rng() * 0.05; const lay = wcDeform(shape.map(p => [cx + (p[0] - cx) * sc, cy + (p[1] - cy) * sc] as Pt), 1, 0.05, rng); path(lay); x.lineWidth = 0.7 + rng() * 0.5; x.strokeStyle = rgba(mix(col, style.palette.ink, 0.25), 0.14); x.stroke() }
    x.save(); path(shape); x.clip(); rng = rngPool; const g = Math.round(r * r * 0.012); for (let i = 0; i < g; i++) { const a = rng() * Math.PI * 2, t = Math.pow(rng(), 0.6); x.fillStyle = rgba(mix(col, style.palette.ink, 0.4), 0.1 + rng() * 0.18); const sz = rng() < 0.85 ? 1 : 1.6; x.fillRect(cx + Math.cos(a) * t * r * 1.2, cy + Math.sin(a) * t * r * 0.9, sz, sz) } x.restore();
  }
  x.restore();
  xPaper.save(); xPaper.globalCompositeOperation = light ? 'multiply' : 'screen'; xPaper.globalAlpha = clamp(0.55 * amt, 0, 1); try { xPaper.filter = 'blur(1.2px)' } catch { } xPaper.drawImage(off, 0, 0, W, H); xPaper.restore();
}

export function grainOverlay(W: number, H: number, dpr: number, light: boolean): HTMLCanvasElement {
  const key = ['grain', W, H, dpr, light].join('|'); const hit = cache.get(key); if (hit) return hit;
  const c = canvas(W * dpr, H * dpr); const x = c.getContext('2d')!; x.scale(dpr, dpr);
  x.fillStyle = light ? '#ffffff' : '#000000'; x.fillRect(0, 0, W, H); const rng = mulberry32(4321);
  const n = Math.round(W * H / 26);
  for (let i = 0; i < n; i++) { const a = rng(); x.fillStyle = light ? `rgba(60,45,25,${0.05 + a * 0.13})` : `rgba(255,245,225,${0.04 + a * 0.1})`; const sz = rng() < 0.8 ? 1 : 1.5; x.fillRect(rng() * W, rng() * H, sz, sz) }
  x.lineWidth = 0.7; for (let i = 0; i < 260; i++) { const px = rng() * W, py = rng() * H, an = rng() * Math.PI, l = 8 + rng() * 30; x.strokeStyle = light ? `rgba(70,55,35,${0.05 + rng() * 0.08})` : `rgba(255,245,225,${0.04 + rng() * 0.07})`; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(an) * l, py + Math.sin(an) * l); x.stroke() }
  cache.set(key, c); return c;
}
