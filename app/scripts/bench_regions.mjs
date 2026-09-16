import { extractRegions } from '../dist-node/regions.js';
const W = 1280, H = 860; const label = new Uint32Array(W * H), depth = new Float32Array(W * H);
// ~20k random seeds inside a disc; nearest-seed labels via a grid
const N = 20000; const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N);
let rs = 1; const rnd = () => (rs = (rs * 48271) % 2147483647) / 2147483647;
for (let i = 0; i < N; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 400; sx[i] = 640 + Math.cos(a) * r; sy[i] = 430 + Math.sin(a) * r; sz[i] = rnd() * 100 }
const cell = 12; const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell); const grid = Array.from({ length: gw * gh }, () => []);
for (let i = 0; i < N; i++) grid[Math.floor(sy[i] / cell) * gw + Math.floor(sx[i] / cell)].push(i);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if ((x - 640) ** 2 + (y - 430) ** 2 > 400 * 400) continue; let best = -1, bd = 1e9; const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const g = grid[(gy + dy) * gw + gx + dx]; if (!g) continue; for (const i of g) { const d = (sx[i] - x) ** 2 + (sy[i] - y) ** 2; if (d < bd) { bd = d; best = i } } }
  if (best >= 0) { label[y * W + x] = (3 << 24) | (best + 1); depth[y * W + x] = sz[best] } }
for (let k = 0; k < 3; k++) { const t0 = performance.now(); const R = extractRegions(W, H, label, depth, 0.5, 0.75); const t1 = performance.now(); let pts = 0; for (const r of R.values()) for (const L of r.loops) pts += L.pts.length; console.log('regions', R.size, 'ms', (t1 - t0).toFixed(0), 'loop points', pts) }
