/* A density map made ready for the classic engine: its isosurfaces at the figure's contour levels, turned into the
   drawing's frame, each vertex tied to the nearest atom of the model (for its colour, and to find density the model
   does not explain), the local resolution at each vertex, the chicken-wire contours for a mesh drawing, the residues
   the density does not support, and the caption that says how the map is shown. Cached: turning the figure reuses it. */
import { downsample, lowpass, levelEnclosing, cropMap, upsample, smoothSurface, isosurface, sampleMap, sliceContours, joinSegments, type DensityMap } from '../model/map';
import type { Structure } from '../model/structure';
import type { Style } from '../style';
import { pcaBasis } from '../render/pca';
import { selectAtoms } from '../model/selection';

export interface MapLevel {
  level: number;
  pos: Float32Array; nor: Float32Array; tri: Uint32Array;   // in the drawing's frame (turned by the base rotation)
  near: Int32Array;      // the nearest model atom (structure index), -1 beyond 8 Å or without a model
  dist: Float32Array;    // and its distance, Å
  hand: Float32Array | null;   // local resolution as the line's looseness, 0 (best) … 1 (worst), per vertex
}
export interface EngineMap {
  name: string; levels: MapLevel[]; primary: number;
  wire: number[][][];                 // mesh contours (polylines, drawing frame), for the mesh style
  unsupported: number[];              // trace atoms (structure index) of residues outside the density
  caption: string;
  sample: (x: number, y: number, z: number) => number;   // density at a point of the drawing's frame
  box: number[][];                    // the map's corners, drawing frame
  opts: Style['map']; hasModel: boolean; primaryLevel: number;
}

const cache = new WeakMap<DensityMap, Map<string, EngineMap>>();

/** the base rotation that puts a map's widest spread in the picture plane, when there is no model to take it from */
export function mapBasis(m: DensityMap, level: number): Float32Array {
  const iso = isosurface(downsample(m, 96), level); const n = iso.positions.length / 3;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n); let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { x[i] = iso.positions[i * 3]; y[i] = iso.positions[i * 3 + 1]; z[i] = iso.positions[i * 3 + 2]; cx += x[i]; cy += y[i]; cz += z[i] }
  return pcaBasis({ count: n, center: [cx / (n || 1), cy / (n || 1), cz / (n || 1)], x, y, z } as any);
}

/** the contour level a figure uses: the style's, else the map's recommended one, else mean + 3 σ */
export function mapLevel(m: DensityMap, style: Style) { const o = style.map; return o.level ?? (o.sigma != null ? m.mean + o.sigma * m.rms : null) ?? m.level ?? m.mean + 3 * m.rms }

export function prepareMap(whole: DensityMap, style: Style, s: Structure | null, base: Float32Array, localRes: DensityMap | null = null): EngineMap {
  const o = style.map, level = mapLevel(whole, style);
  const factors = o.style === 'layers' ? o.levels : [1];
  const key = JSON.stringify([level, o.speck, o.smooth, o.crop, o.zone, o.finish, o.smoothing, factors, o.carve, o.maxVoxels, o.localResolution, o.style === 'mesh' ? o.meshSpacing : 0, s ? s.count : 0, Array.from(base), !!localRes]);
  let per = cache.get(whole); if (!per) cache.set(whole, per = new Map());
  const hit = per.get(key); if (hit) return { ...hit, opts: o };
  // with a model: the map inside the model's box and a margin (a box, not a mask: density near the model that it does
  // not explain stays), so a model of one subunit is not lost in the map of the whole assembly
  // a zone (a selection): the map around those atoms only, cropped close so it stays at full resolution, and carving
  // measured from them; for looking at how residues sit in their density
  let zoneSel: Uint8Array | null = null;
  if (s && o.zone) { zoneSel = selectAtoms(s, o.zone); if (!zoneSel.some(v => v)) zoneSel = null }
  let m = whole;
  if (s && s.count && (o.crop > 0 || zoneSel)) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.count; i++) { if (zoneSel && !zoneSel[i]) continue; const p = [s.x[i], s.y[i], s.z[i]]; for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] } }
    const pad = zoneSel ? Math.max(o.carve, 2) + 3 : o.crop;
    m = cropMap(whole, lo.map(v => v - pad), hi.map(v => v + pad)) }
  // smoothing: the map low-passed to a resolution the picture can show (a whole particle cannot show atoms), on a grid
  // no finer than a third of it. 'auto' low-passes to a 20th of what is drawn (the model, or else the particle: the
  // density above the level), when the map is finer than that
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let k = 0, q = 0; k < m.nz; k++) for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++, q++) if (m.data[q] >= level) {
    if (i < bx0) bx0 = i; if (i > bx1) bx1 = i; if (j < by0) by0 = j; if (j > by1) by1 = j; if (k < bz0) bz0 = k; if (k > bz1) bz1 = k }
  let extent = bx1 < 0 ? m.nx * m.step[0] : Math.max((bx1 - bx0 + 1) * m.step[0], (by1 - by0 + 1) * m.step[1], (bz1 - bz0 + 1) * m.step[2]);
  if (s && s.count) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.count; i++) { if (zoneSel && !zoneSel[i]) continue; const p = [s.x[i], s.y[i], s.z[i]]; for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] } }
    extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) }
  const R = o.smooth === 'auto' ? (m.resolution ?? 2 * m.step[0]) < extent / 20 * 0.8 ? Math.round(extent / 20) : 0 : Math.max(0, +o.smooth || 0);
  // what is low-passed is the density above the contour level (the rest set to zero): a sharpened map has lost its
  // low frequencies (its protein's mean density is the solvent's), so low-passing it all would leave only noise
  const above = R > 0 ? { ...m, data: m.data.map(v => v >= level ? v : 0) } : m;
  const g0 = downsample(above, R > 0 ? Math.min(o.maxVoxels, Math.ceil(extent / (R / 3))) : o.maxVoxels), g1 = R > 0 ? lowpass(g0, R) : g0;
  // a close-up is sampled finer than its map (to about a 150th of what is drawn), so its surface is not the grid's facets
  const box = Math.max(g1.nx * g1.step[0], g1.ny * g1.step[1], g1.nz * g1.step[2]);   // at most 160 voxels a side
  const g = o.finish !== 'sketch' ? upsample(g1, Math.max(0.2, extent / 150, box / 160)) : g1;
  // the model's mass, or the sample's as deposited, as a volume (1.21 Å³ per Da, the mean protein density)
  const EL: Record<string, number> = { C: 12.01, N: 14.01, O: 16.0, S: 32.07, P: 30.97, SE: 78.97 };
  let mass = 0; if (s) for (let i = 0; i < s.count; i++) { const e = s.element[i].toUpperCase(); if (e !== 'H' && s.residues[s.residueOf[i]].resn !== 'HOH') mass += (EL[e] ?? 12) + 1.0 }   // + a hydrogen per heavy atom
  const massFrom = mass > 0 ? 'the model' : m.mass ? 'the sample' : ''; if (!mass) mass = m.mass || 0;
  // the level on the grid drawn: on a low-passed map, the one enclosing the molecule's volume (the figure's level, or
  // the recommended one, chose what was low-passed); else, averaging down lowers a high-resolution map's peaks, so
  // the level that encloses the same volume as the chosen one does on the map itself
  // with a model, only the density within 6 Å of it counts towards that volume (the rest of an assembly is not in the model)
  let zone: Uint8Array | undefined;
  if (R > 0 && massFrom === 'the model') { zone = new Uint8Array(g.data.length); const r = 6;
    for (let i = 0; i < s!.count; i++) { if (s!.element[i] === 'H') continue; const c = [s!.x[i], s!.y[i], s!.z[i]].map((v, k) => (v - g.origin[k]) / g.step[k]), n = [g.nx, g.ny, g.nz], rv = r / g.step[0];
      for (let z = Math.max(0, Math.floor(c[2] - rv)); z <= Math.min(n[2] - 1, Math.ceil(c[2] + rv)); z++) for (let y = Math.max(0, Math.floor(c[1] - rv)); y <= Math.min(n[1] - 1, Math.ceil(c[1] + rv)); y++)
        for (let x = Math.max(0, Math.floor(c[0] - rv)); x <= Math.min(n[0] - 1, Math.ceil(c[0] + rv)); x++) if ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 <= rv * rv) zone[(z * n[1] + y) * n[0] + x] = 1 } }
  const byVolume = R > 0, vLevel = !byVolume ? 0 : mass > 0 ? levelEnclosing(g, mass * 1.21, zone) : g.mean + 2 * g.rms;   // without a mass: 2 σ of the low-passed map
  let sorted: Float32Array | null = null;
  const same = (lv: number) => { if (byVolume) return vLevel * lv / level; if (g1 === m) return lv; let n = 0; for (let i = 0; i < m.data.length; i++) if (m.data[i] >= lv) n++;
    sorted ??= Float32Array.from(g1.data).sort(); return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - n / m.data.length) * sorted.length)))] };
  const turn = (x: number, y: number, z: number): [number, number, number] => [base[0] * x + base[4] * y + base[8] * z, base[1] * x + base[5] * y + base[9] * z, base[2] * x + base[6] * y + base[10] * z];
  const unturn = (x: number, y: number, z: number): [number, number, number] => [base[0] * x + base[1] * y + base[2] * z, base[4] * x + base[5] * y + base[6] * z, base[8] * x + base[9] * y + base[10] * z];
  // the model's atoms on a 4 Å grid, for nearest-atom lookups (waters left out: they are not what the density is judged by)
  const atoms: number[] = []; if (s) for (let i = 0; i < s.count; i++) { const r = s.residues[s.residueOf[i]]; if (r.resn !== 'HOH' && s.element[i] !== 'H') atoms.push(i) }
  const cell = 4, grid = new Map<string, number[]>(); const kf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const i of atoms) { const k = kf(s!.x[i], s!.y[i], s!.z[i]); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i) }
  const nearest = (x: number, y: number, z: number): [number, number] => {
    let best = -1, bd = 64; const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
      const l = grid.get(`${ci + a},${cj + b},${ck + c}`); if (!l) continue;
      for (const i of l) { const d = (s!.x[i] - x) ** 2 + (s!.y[i] - y) ** 2 + (s!.z[i] - z) ** 2; if (d < bd) { bd = d; best = i } }
    }
    return [best, Math.sqrt(bd)];
  };
  // carving's distance: to the zone's atoms when there is a zone, else to the model's
  const zoneAtoms = zoneSel ? atoms.filter(i => zoneSel![i]) : atoms;
  const carveDist = (x: number, y: number, z: number) => { if (!zoneSel) return nearest(x, y, z)[1]; let bd = Infinity; for (const i of zoneAtoms) { const d = (s!.x[i] - x) ** 2 + (s!.y[i] - y) ** 2 + (s!.z[i] - z) ** 2; if (d < bd) bd = d } return Math.sqrt(bd) };
  let dust = 0;
  const levels: MapLevel[] = factors.map(f => {
    const iso = smoothSurface(isosurface(g, same(level * f)), o.finish !== 'sketch' ? o.smoothing : 0); const nv = iso.positions.length / 3;
    const near = new Int32Array(nv).fill(-1), dist = new Float32Array(nv).fill(99);
    if (atoms.length) for (let v = 0; v < nv; v++) { const [i, d] = nearest(iso.positions[v * 3], iso.positions[v * 3 + 1], iso.positions[v * 3 + 2]); near[v] = i; dist[v] = d }
    // carving: only the density within `carve` Å of the model (off by default; the caption says when it is on)
    let tri = iso.triangles;
    // dust: on a low-passed map, the pieces under 2% of the largest are what low-passing noise leaves (the caption says so)
    if (R > 0 || o.finish !== 'sketch') { const par = new Int32Array(nv); for (let v = 0; v < nv; v++) par[v] = v; const find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x] } return x };
      for (let t = 0; t < tri.length; t += 3) { const a = find(tri[t]), b = find(tri[t + 1]), c = find(tri[t + 2]); par[b] = a; par[find(c)] = a }
      const size = new Map<number, number>(); for (let v = 0; v < nv; v++) { const r = find(v); size.set(r, (size.get(r) || 0) + 1) }
      const big = Math.max(0, ...size.values()) * 0.02, keep: number[] = [];
      for (let t = 0; t < tri.length; t += 3) if (size.get(find(tri[t]))! >= big) keep.push(tri[t], tri[t + 1], tri[t + 2]); else dust++;
      tri = new Uint32Array(keep) }
    if (o.carve > 0 && atoms.length) { const cd = zoneSel ? Float32Array.from({ length: nv }, (_, v) => carveDist(iso.positions[v * 3], iso.positions[v * 3 + 1], iso.positions[v * 3 + 2])) : dist;
      const keep: number[] = []; for (let t = 0; t < tri.length; t += 3) if (cd[tri[t]] <= o.carve || cd[tri[t + 1]] <= o.carve || cd[tri[t + 2]] <= o.carve) keep.push(tri[t], tri[t + 1], tri[t + 2]); tri = new Uint32Array(keep) }
    // local resolution as looseness: a local-resolution map's value at the vertex, or the nearest atom's B-factor,
    // spread between the 5th and 95th percentile of the figure (so the best-resolved parts are ruled, the worst loose)
    let hand: Float32Array | null = null;
    const raw = new Float32Array(nv).fill(NaN);
    if (o.localResolution === 'map' && localRes) for (let v = 0; v < nv; v++) raw[v] = sampleMap(localRes, iso.positions[v * 3], iso.positions[v * 3 + 1], iso.positions[v * 3 + 2]);
    else if (o.localResolution === 'bfactor' && s) for (let v = 0; v < nv; v++) if (near[v] >= 0) raw[v] = s.b[near[v]];
    if (o.localResolution !== 'none') {
      const ok = Array.from(raw).filter(x => isFinite(x)).sort((a, b) => a - b);
      if (ok.length) { const lo = ok[Math.floor(ok.length * 0.05)], hi = ok[Math.floor(ok.length * 0.95)], span = Math.max(hi - lo, 1e-6);
        hand = new Float32Array(nv); for (let v = 0; v < nv; v++) hand[v] = isFinite(raw[v]) ? Math.min(1, Math.max(0, (raw[v] - lo) / span)) : 1 }
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const p = turn(iso.positions[v * 3], iso.positions[v * 3 + 1], iso.positions[v * 3 + 2]); pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
      const q = turn(iso.normals[v * 3], iso.normals[v * 3 + 1], iso.normals[v * 3 + 2]); nor[v * 3] = q[0]; nor[v * 3 + 1] = q[1]; nor[v * 3 + 2] = q[2];
    }
    return { level: level * f, pos, nor, tri, near, dist, hand };
  });
  const primary = Math.max(0, factors.indexOf(1));
  // mesh: the contours of the map on every few grid planes of each axis, as Coot draws it
  const wire: number[][][] = [], gLevel = same(level);
  if (o.style === 'mesh') {
    const sp = Math.max(1, Math.round(o.meshSpacing / g.step[0]));
    for (const ax of [0, 1, 2] as const) { const n = [g.nx, g.ny, g.nz][ax]; for (let i = 0; i < n; i += sp) for (const line of joinSegments(sliceContours(g, ax, i, gLevel))) {
      let run: number[][] = [];   // carved: only the parts near the model
      for (const p of line) { const inZone = !(o.carve > 0 && atoms.length) || carveDist(p[0], p[1], p[2]) <= o.carve; if (inZone) run.push(turn(p[0], p[1], p[2])); else { if (run.length > 1) wire.push(run); run = [] } }
      if (run.length > 1) wire.push(run);
    } }
  }
  // residues the density does not support: most of their heavy atoms below half the contour level
  const unsupported: number[] = [];
  if (s) for (const r of s.residues) {
    if (r.het || r.trace < 0 || (zoneSel && !zoneSel[r.trace])) continue; let n = 0, low = 0;   // with a zone, only its residues
    for (let i = r.atomStart; i < r.atomEnd; i++) { if (s.element[i] === 'H') continue; n++; if (sampleMap(m, s.x[i], s.y[i], s.z[i]) < level * 0.5) low++ }
    if (n && low / n > 0.5) unsupported.push(r.trace);
  }
  const sigma = (level - m.mean) / (m.rms || 1);
  const caption = [m.name, R > 0 ? `the density above ${+level.toPrecision(3)}${style.map.level == null && style.map.sigma == null && m.level != null ? ' (recommended)' : ''} low-passed to ${R} Å` : '', byVolume ? mass <= 0 ? 'contoured at 2 σ' : `contoured to enclose ${(mass / 1e6 >= 0.1 ? (mass / 1e6).toFixed(2) + ' MDa' : Math.round(mass / 1e3) + ' kDa')} (${massFrom}'s mass, 1.21 Å³/Da)`
      : `contoured at ${+level.toPrecision(3)}${style.map.level == null && style.map.sigma == null && m.level != null ? ' (recommended)' : ''}, ${sigma.toFixed(1)} σ`,
    o.style === 'layers' ? `levels ×${factors.join(', ×')}` : '', o.carve > 0 && atoms.length ? `carved at ${o.carve} Å of ${zoneSel ? o.zone : 'the model'}` : zoneSel ? `around ${o.zone}` : m !== whole ? `cropped to the model's box and ${o.crop} Å` : '',
    dust ? 'specks under 2% of the largest piece hidden' : '', g0 !== m && !byVolume ? `drawn at ${g.step[0].toFixed(1)} Å per voxel${R > 0 ? '' : ', at the level enclosing the same volume'}` : '',
    o.localResolution === 'bfactor' && s ? 'line looseness from B-factors' : o.localResolution === 'map' && localRes ? 'line looseness from local resolution' : ''].filter(Boolean).join(' · ');
  const corners: number[][] = []; for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) corners.push(turn(g.origin[0] + a * (g.nx - 1) * g.step[0], g.origin[1] + b * (g.ny - 1) * g.step[1], g.origin[2] + c * (g.nz - 1) * g.step[2]));
  const out: EngineMap = { name: m.name, levels, primary, wire, unsupported, caption, sample: (x, y, z) => { const p = unturn(x, y, z); return sampleMap(g, p[0], p[1], p[2]) * level / gLevel },
    box: corners, opts: o, hasModel: atoms.length > 0, primaryLevel: level };
  per.set(key, out); if (per.size > 6) per.delete(per.keys().next().value!);
  return out;
}
