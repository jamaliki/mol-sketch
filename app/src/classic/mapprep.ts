/* A density map made ready for the classic engine: its isosurfaces at the figure's contour levels, turned into the
   drawing's frame, each vertex tied to the nearest atom of the model (for its colour, and to find density the model
   does not explain), the local resolution at each vertex, the chicken-wire contours for a mesh drawing, the residues
   the density does not support, and the caption that says how the map is shown. Cached: turning the figure reuses it. */
import { downsample, lowpass, levelEnclosing, kthOf, cropMap, upsample, smoothSurface, isosurface, sampleMap, sliceContours, joinSegments, type DensityMap } from '../model/map';
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
  opts: Style['map']; hasModel: boolean; primaryLevel: number; zoned?: boolean;
  closeUp?: boolean;                  // a zone: residues in their density, drawn over the model by default
  grid: DensityMap; gridLevel: number;   // the grid the surfaces were drawn from, and the level on it (sample reads it)
  farAt?: number;                     // Å from every atom beyond which density is not the model's
}

const cache = new WeakMap<DensityMap, Map<string, EngineMap>>();

/** the base rotation that puts a map's widest spread in the picture plane, when there is no model to take it from */
export function mapBasis(m: DensityMap, level: number): Float32Array {
  const iso = isosurface(downsample(m, 96), level); const n = iso.positions.length / 3;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n); let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { x[i] = iso.positions[i * 3]; y[i] = iso.positions[i * 3 + 1]; z[i] = iso.positions[i * 3 + 2]; cx += x[i]; cy += y[i]; cz += z[i] }
  return pcaBasis({ count: n, center: [cx / (n || 1), cy / (n || 1), cz / (n || 1)], x, y, z } as any);
}

/** the contour level a figure uses: the style's, else the map's recommended one (if it can be drawn), else a level of
    the kind depositors recommend (defaultLevel) */
export function mapLevel(m: DensityMap, style: Style) { const o = style.map; return o.level ?? (o.sigma != null ? m.mean + o.sigma * m.rms : null) ?? (recommendedUsable(m) ? m.level! : null) ?? defaultLevel(m) }
/* without a recommended level (a map of one's own, or one set aside): the level enclosing 0.7% of the box, which is
   what EMDB's recommended levels typically enclose (0.2 to 3%, median 0.7%, over a sample of entries), kept between 2 and
   8 σ above the mean. Mean + 3 σ, the rule before, enclosed about twice as much, noise and detergent with it */
const defaults = new WeakMap<DensityMap, number>();
export function defaultLevel(m: DensityMap): number {
  let v = defaults.get(m); if (v !== undefined) return v;
  const d = m.data, step = Math.max(1, Math.floor(d.length / 2e6)), a = new Float32Array(Math.ceil(d.length / step)); let n = 0; for (let i = 0; i < d.length; i += step) a[n++] = d[i];
  const q = kthOf(a.subarray(0, n), Math.floor(n * 0.993));
  v = Math.min(m.mean + 8 * m.rms, Math.max(m.mean + 2 * m.rms, q)); defaults.set(m, v); return v;
}
/* a recommended level that encloses more than 40% of the map's box is not a surface that can be drawn (no particle fills
   its box: a tomographic average with its contrast the other way, a level meant for another program); 3 σ is used then */
const above = new WeakMap<DensityMap, number>();
export function fractionAboveRecommended(m: DensityMap) {
  if (m.level == null) return 0; let f = above.get(m);
  if (f === undefined) { const d = m.data, step = Math.max(1, Math.floor(d.length / 2e6)); let n = 0, t = 0; for (let i = 0; i < d.length; i += step) { t++; if (d[i] >= m.level) n++ } f = t ? n / t : 0; above.set(m, f) }
  return f;
}
export function recommendedUsable(m: DensityMap) { return m.level != null && fractionAboveRecommended(m) <= 0.4 }

function keyOf(whole: DensityMap, style: Style, s: Structure | null, base: Float32Array, localRes: DensityMap | null) {
  const o = style.map;
  return JSON.stringify([mapLevel(whole, style), o.speck, o.smooth, o.crop, o.zone, o.finish, o.smoothing, o.style === 'layers' ? o.levels : [1], o.carve, o.maxVoxels, o.localResolution, o.style === 'mesh' ? o.meshSpacing : 0, o.context, !!o.unexplained, s ? s.count : 0, Array.from(base), !!localRes]);
}
/** the prepared map if it is ready (cached), else null: for the preview, which does not wait for it */
export function preparedMap(whole: DensityMap, style: Style, s: Structure | null, base: Float32Array, localRes: DensityMap | null = null): EngineMap | null {
  const hit = cache.get(whole)?.get(keyOf(whole, style, s, base, localRes)); return hit ? { ...hit, opts: style.map } : null;
}

export function prepareMap(whole: DensityMap, style: Style, s: Structure | null, base: Float32Array, localRes: DensityMap | null = null): EngineMap {
  const o = style.map, level = mapLevel(whole, style);
  const factors = o.style === 'layers' ? o.levels : [1];
  const key = keyOf(whole, style, s, base, localRes);
  let per = cache.get(whole); if (!per) cache.set(whole, per = new Map());
  const hit = per.get(key); if (hit) return { ...hit, opts: o };
  // with a model: the map inside the model's box and a margin (a box, not a mask: density near the model that it does
  // not explain stays), so a model of one subunit is not lost in the map of the whole assembly
  // a zone (a selection): the map around those atoms only, cropped close so it stays at full resolution, and carving
  // measured from them; for looking at how residues sit in their density
  let zoneSel: Uint8Array | null = null;
  if (s && o.zone) { zoneSel = selectAtoms(s, o.zone); if (!zoneSel.some(v => v)) zoneSel = null }
  let m = whole; const zonePad = Math.max(o.carve, 2) + 3;
  if (s && s.count && (o.crop > 0 || zoneSel)) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.count; i++) { if (zoneSel && !zoneSel[i]) continue; const p = [s.x[i], s.y[i], s.z[i]]; for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] } }
    const pad = zoneSel ? zonePad : o.crop;
    m = cropMap(whole, lo.map(v => v - pad), hi.map(v => v + pad)) }
  // smoothing: the map low-passed to a resolution the picture can show (a whole particle cannot show atoms), on a grid
  // no finer than a third of it. 'auto' low-passes to a 20th of what is drawn (4 Å at the finest) (the model, or else the particle: the
  // density above the level), when the map is finer than that; never a zone, which is a close-up at the map's own resolution
  let extent = s && s.count ? 0 : particleExtent(m, level);
  if (s && s.count) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.count; i++) { if (zoneSel && !zoneSel[i]) continue; const p = [s.x[i], s.y[i], s.z[i]]; for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k] } }
    extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) }
  const R = o.smooth === 'auto' ? zoneSel ? 0 : (m.resolution ?? 2 * m.step[0]) < Math.max(4, extent / 20) * 0.8 ? Math.round(Math.max(4, extent / 20)) : 0 : Math.max(0, +o.smooth || 0);
  // what is low-passed is the density above the contour level (the rest set to zero): a sharpened map has lost its
  // low frequencies (its protein's mean density is the solvent's), so low-passing it all would leave only noise
  const above = R > 0 ? { ...m, data: m.data.map(v => v >= level ? v : 0) } : m;
  let g0 = downsample(above, R > 0 ? Math.min(o.maxVoxels, Math.ceil(extent / (R / 3))) : o.maxVoxels);
  // with a model, a low-passed map keeps only the density within 5 Å of it, before the low-pass (so its surface closes
  // smoothly, instead of being cut where the rest of an assembly joins it); the caption says so
  const zoned = R > 0 && !!s && s.count > 0 && o.finish !== 'sketch' && o.context !== 'show';
  const keepR = o.unexplained ? 10 : 5;   // looking for what the model does not explain: keep the density further out
  if (zoned) { const keep = stampAtoms(g0, s!, keepR); const d = new Float32Array(g0.data.length); for (let q = 0; q < d.length; q++) d[q] = keep[q] ? g0.data[q] : 0; g0 = { ...g0, data: d } }
  const g1 = R > 0 ? lowpass(g0, R) : g0;
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
  if (R > 0 && massFrom === 'the model') zone = stampAtoms(g, s!, 6);
  // a mass the map cannot hold (a sample's, deposited for more than was reconstructed: its volume more than most of the
  // smoothed density): the level enclosing it would be the edge of everything, or nothing. 2 σ then, as without a mass
  let massTooBig = false;
  if (R > 0 && mass > 0) { const n = mass * 1.21 / (g.step[0] * g.step[1] * g.step[2]); let support = 0; for (let i = 0; i < g.data.length; i++) if (g.data[i] > 0 && (!zone || zone[i])) support++; massTooBig = n > 0.6 * support }
  // without a (usable) mass: twice the volume the level encloses on the map itself (a sharpened map's level encloses about
  // half a molecule's volume: over EMDB entries with a mass, 1.2 to 3.2 times, median 2); 2 σ of the smoothed map,
  // before, took in a wide envelope round the density
  let vAtLevel = 0; if (R > 0 && !(mass > 0 && !massTooBig)) { let c = 0; for (let i = 0; i < m.data.length; i++) if (m.data[i] >= level) c++; vAtLevel = c * m.step[0] * m.step[1] * m.step[2] }
  const byVolume = R > 0, vLevel = !byVolume ? 0 : mass > 0 && !massTooBig ? levelEnclosing(g, mass * 1.21, zone) : vAtLevel > 0 ? levelEnclosing(g, 2 * vAtLevel, zone) : g.mean + 2 * g.rms;
  let sorted: Float32Array | null = null;
  const same = (lv: number) => { if (byVolume) return vLevel * lv / level; if (g1 === m) return lv; let n = 0; for (let i = 0; i < m.data.length; i++) if (m.data[i] >= lv) n++;
    sorted ??= Float32Array.from(g1.data).sort(); return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - n / m.data.length) * sorted.length)))] };
  const turn = (x: number, y: number, z: number): [number, number, number] => [base[0] * x + base[4] * y + base[8] * z, base[1] * x + base[5] * y + base[9] * z, base[2] * x + base[6] * y + base[10] * z];
  // the model's atoms on a 4 Å grid, for nearest-atom lookups (waters left out: they are not what the density is judged by)
  const atoms: number[] = []; if (s) for (let i = 0; i < s.count; i++) { const r = s.residues[s.residueOf[i]]; if (r.resn !== 'HOH' && s.element[i] !== 'H') atoms.push(i) }
  const nearest = nearestAtom(s, atoms);
  // carving's distance: to the zone's atoms when there is a zone, else to the model's
  const nearZone = zoneSel ? nearestAtom(s, atoms.filter(i => zoneSel![i])) : nearest;
  const carveDist = (x: number, y: number, z: number) => nearZone(x, y, z)[1];
  // a zone without carving keeps the density within its crop margin of the selection (a sphere around each atom, not
  // the box, whose corners would be filled with pieces of the neighbours' density)
  const carve = o.carve > 0 ? o.carve : zoneSel ? zonePad : 0;
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
      // (a close-up at full resolution breaks into a blob around each atom, and its largest piece is often a neighbour's
      // that carving then removes: there only true specks go, whatever their neighbours' size)
      const big = zoneSel ? 12 : Math.max(0, ...size.values()) * 0.02, keep: number[] = [];
      for (let t = 0; t < tri.length; t += 3) if (size.get(find(tri[t]))! >= big) keep.push(tri[t], tri[t + 1], tri[t + 2]); else dust++;
      tri = new Uint32Array(keep) }
    // the rest of an assembly, shown: cut at the crop margin from the model's atoms (the box's straight edges were a
    // box drawn on the picture), not at the box
    if (!zoneSel && carve <= 0 && atoms.length && o.context === 'show' && o.crop > 0) { const r = Math.min(o.crop, 7.99), k2: number[] = [];
      for (let t = 0; t < tri.length; t += 3) if (dist[tri[t]] < r || dist[tri[t + 1]] < r || dist[tri[t + 2]] < r) k2.push(tri[t], tri[t + 1], tri[t + 2]); tri = new Uint32Array(k2) }
    if (carve > 0 && atoms.length) { const cd = zoneSel ? Float32Array.from({ length: nv }, (_, v) => carveDist(iso.positions[v * 3], iso.positions[v * 3 + 1], iso.positions[v * 3 + 2])) : dist;
      const keep: number[] = []; for (let t = 0; t < tri.length; t += 3) if (cd[tri[t]] <= carve || cd[tri[t + 1]] <= carve || cd[tri[t + 2]] <= carve) keep.push(tri[t], tri[t + 1], tri[t + 2]); tri = new Uint32Array(keep)
      // a zone without carving: only the pieces of surface that touch its atoms (the density joined to them, explained
      // or not), not the islands of the neighbours' density that the margin happens to take in
      if (zoneSel && !(o.carve > 0)) { const par = new Int32Array(nv); for (let v = 0; v < nv; v++) par[v] = v; const find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x] } return x };
        for (let t = 0; t < tri.length; t += 3) { const a = find(tri[t]), b = find(tri[t + 1]), c = find(tri[t + 2]); par[b] = a; par[find(c)] = a }
        const touch = new Set<number>(); for (let t = 0; t < tri.length; t++) if (cd[tri[t]] <= 2.5) touch.add(find(tri[t]));
        const k2: number[] = []; for (let t = 0; t < tri.length; t += 3) if (touch.has(find(tri[t]))) k2.push(tri[t], tri[t + 1], tri[t + 2]); tri = new Uint32Array(k2) } }
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
    // the planes a mesh is drawn on: meshSpacing apart, and on a low-passed map no closer than half its resolution (a
    // whole particle's mesh at 1 Å is a grey weave, not wire)
    const sp = Math.max(1, Math.round(Math.max(o.meshSpacing, R / 2) / g.step[0]));
    for (const ax of [0, 1, 2] as const) { const n = [g.nx, g.ny, g.nz][ax]; for (let i = 0; i < n; i += sp) for (const line of joinSegments(sliceContours(g, ax, i, gLevel))) {
      let run: number[][] = [];   // carved: only the parts near the model
      for (const p of line) { const inZone = !(carve > 0 && atoms.length) || carveDist(p[0], p[1], p[2]) <= carve; if (inZone) run.push(turn(p[0], p[1], p[2])); else { if (run.length > 1) wire.push(run); run = [] } }
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
  const auto = style.map.level == null && style.map.sigma == null && !recommendedUsable(whole);
  const unusable = !auto ? '' : whole.level != null ? `the recommended level (${+whole.level!.toPrecision(3)}) encloses ${Math.round(100 * fractionAboveRecommended(whole))}% of the box: the level enclosing 0.7% instead`
    : 'no recommended level: the level enclosing 0.7% of the box';
  const caption = [m.name, unusable, R > 0 ? `the density above ${+level.toPrecision(3)}${style.map.level == null && style.map.sigma == null && recommendedUsable(whole) ? ' (recommended)' : ''} low-passed to ${R} Å` : '', byVolume ? mass <= 0 ? 'contoured to enclose twice the volume the level encloses' : massTooBig ? `contoured to enclose twice the volume the level encloses (${massFrom}'s mass, ${(mass / 1e6 >= 0.1 ? (mass / 1e6).toFixed(2) + ' MDa' : Math.round(mass / 1e3) + ' kDa')}, is more than the map holds)` : `contoured to enclose ${(mass / 1e6 >= 0.1 ? (mass / 1e6).toFixed(2) + ' MDa' : Math.round(mass / 1e3) + ' kDa')} (${massFrom}'s mass, 1.21 Å³/Da)`
      : `contoured at ${+level.toPrecision(3)}${style.map.level == null && style.map.sigma == null && recommendedUsable(whole) ? ' (recommended)' : ''}, ${sigma.toFixed(1)} σ`,
    o.style === 'layers' ? `levels ×${factors.join(', ×')}` : '', zoned ? `the density within ${keepR} Å of the model` : o.carve > 0 && atoms.length ? `carved at ${o.carve} Å of ${zoneSel ? o.zone : 'the model'}` : zoneSel ? `the density joined to ${o.zone}, within ${zonePad} Å` : m !== whole ? o.context === 'show' ? `the density within ${Math.min(o.crop, 8)} Å of the model` : `cropped to the model's box and ${o.crop} Å` : '',
    dust ? zoneSel ? 'specks hidden' : 'specks under 2% of the largest piece hidden' : '', g0 !== m && !byVolume ? `drawn at ${g.step[0].toFixed(1)} Å per voxel${R > 0 ? '' : ', at the level enclosing the same volume'}` : '',
    o.localResolution === 'bfactor' && s ? 'line looseness from B-factors' : o.localResolution === 'map' && localRes ? 'line looseness from local resolution' : ''].filter(Boolean).join(' · ');
  const corners: number[][] = []; for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) corners.push(turn(g.origin[0] + a * (g.nx - 1) * g.step[0], g.origin[1] + b * (g.ny - 1) * g.step[1], g.origin[2] + c * (g.nz - 1) * g.step[2]));
  const out: EngineMap = { name: m.name, levels, primary, wire, unsupported, caption, sample: samplerOf(g, base, level, gLevel),
    box: corners, opts: o, hasModel: atoms.length > 0, primaryLevel: level, zoned, closeUp: !!zoneSel, grid: g, gridLevel: gLevel,
    farAt: Math.max(3.4, 0.75 * R) };   // density this far from every atom is not the model's (a low-passed surface stands further off)
  keep(per, key, out);
  return out;
}

function keep(per: Map<string, EngineMap>, key: string, em: EngineMap) { per.set(key, em); if (per.size > 6) per.delete(per.keys().next().value!) }
/** density at a point of the drawing's frame, on the scale of the figure's level */
function samplerOf(g: DensityMap, base: Float32Array, level: number, gLevel: number) {
  return (x: number, y: number, z: number) => { const p = [base[0] * x + base[1] * y + base[2] * z, base[4] * x + base[5] * y + base[6] * z, base[8] * x + base[9] * y + base[10] * z]; return sampleMap(g, p[0], p[1], p[2]) * level / gLevel };
}
/** a prepared map made elsewhere (a worker: without its sampler, which does not cross) taken into the cache, as if
    prepared here */
export function adoptPrepared(whole: DensityMap, style: Style, s: Structure | null, base: Float32Array, localRes: DensityMap | null, em: Omit<EngineMap, 'sample'>): EngineMap {
  const out = { ...em, opts: style.map, sample: samplerOf(em.grid, base, em.primaryLevel, em.gridLevel) } as EngineMap;
  let per = cache.get(whole); if (!per) cache.set(whole, per = new Map());
  keep(per, keyOf(whole, style, s, base, localRes), out); return out;
}
export { keyOf as mapKey };

/** the nearest of some atoms to a point (and its distance, Å), up to 8 Å away, from a dense 4 Å grid of them */
function nearestAtom(s: Structure | null, atoms: number[]) {
  const cell = 4; let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const i of atoms) { const x = s!.x[i], y = s!.y[i], z = s!.z[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z }
  if (!atoms.length) return (_x: number, _y: number, _z: number): [number, number] => [-1, 8];
  const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1, nz = Math.floor((z1 - z0) / cell) + 1;
  const cellOf = (i: number) => (Math.floor((s!.z[i] - z0) / cell) * ny + Math.floor((s!.y[i] - y0) / cell)) * nx + Math.floor((s!.x[i] - x0) / cell);
  const start = new Int32Array(nx * ny * nz + 1); for (const i of atoms) start[cellOf(i) + 1]++;
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1), list = new Int32Array(atoms.length), ax = new Float64Array(atoms.length), ay = new Float64Array(atoms.length), az = new Float64Array(atoms.length);
  for (const i of atoms) { const k = fill[cellOf(i)]++; list[k] = i; ax[k] = s!.x[i]; ay[k] = s!.y[i]; az[k] = s!.z[i] }   // each cell's atoms, in the order given
  return (x: number, y: number, z: number): [number, number] => {
    let best = -1, bd = 64; const ci = Math.floor((x - x0) / cell), cj = Math.floor((y - y0) / cell), ck = Math.floor((z - z0) / cell);
    for (let c = Math.max(0, ck - 2); c <= Math.min(nz - 1, ck + 2); c++) for (let b = Math.max(0, cj - 2); b <= Math.min(ny - 1, cj + 2); b++) {
      const row = (c * ny + b) * nx, a0 = Math.max(0, ci - 2), a1 = Math.min(nx - 1, ci + 2); if (a0 > a1) continue;
      for (let a = a0; a <= a1; a++) for (let k = start[row + a], e = start[row + a + 1]; k < e; k++) { const d = (ax[k] - x) ** 2 + (ay[k] - y) ** 2 + (az[k] - z) ** 2; if (d < bd) { bd = d; best = list[k] } }
    }
    return [best, Math.sqrt(bd)];
  };
}

/** a close-up's density surface, back in the structure's frame (a few thousand of its vertices): with the atoms, what a
    close-up is framed on, so its density is not cut by the frame */
export function closeUpFit(em: EngineMap, base: Float32Array, atoms: Float32Array, s: Structure | null = null): Float32Array {
  const L = em.levels[em.primary] || em.levels[0]; if (!em.closeUp || !L) return atoms;
  // framed on the zone's own atoms (the rest of the model stays in the picture as context, beyond the frame)
  if (s && em.opts.zone) { const sel = selectAtoms(s, em.opts.zone), z: number[] = []; for (let i = 0; i < s.count; i++) if (sel[i]) z.push(s.x[i], s.y[i], s.z[i]); if (z.length) atoms = Float32Array.from(z) }
  const used = new Uint8Array(L.pos.length / 3); for (let t = 0; t < L.tri.length; t++) used[L.tri[t]] = 1;   // what is drawn (carving leaves vertices unused)
  const vs: number[] = []; for (let v = 0; v < used.length; v++) if (used[v]) vs.push(v);
  const k = Math.max(1, Math.floor(vs.length / 4000)), out = new Float32Array(atoms.length + Math.ceil(vs.length / k) * 3); out.set(atoms); let o = atoms.length;
  for (let q = 0; q < vs.length; q += k) { const v = vs[q], x = L.pos[v * 3], y = L.pos[v * 3 + 1], z = L.pos[v * 3 + 2];
    out[o++] = base[0] * x + base[1] * y + base[2] * z; out[o++] = base[4] * x + base[5] * y + base[6] * z; out[o++] = base[8] * x + base[9] * y + base[10] * z }
  return out.subarray(0, o);
}

/** the voxels of a grid within r Å of a structure's heavy atoms (a sphere stamped round each; the grid's first step
    as its unit, as the masks have always measured) */
function stampAtoms(g: DensityMap, s: Structure, r: number): Uint8Array {
  const out = new Uint8Array(g.data.length), nx = g.nx, ny = g.ny, nz = g.nz, rv = r / g.step[0], rv2 = rv * rv;
  for (let i = 0; i < s.count; i++) { if (s.element[i] === 'H') continue;
    const c0 = (s.x[i] - g.origin[0]) / g.step[0], c1 = (s.y[i] - g.origin[1]) / g.step[1], c2 = (s.z[i] - g.origin[2]) / g.step[2];
    const x0 = Math.max(0, Math.floor(c0 - rv)), x1 = Math.min(nx - 1, Math.ceil(c0 + rv)), y0 = Math.max(0, Math.floor(c1 - rv)), y1 = Math.min(ny - 1, Math.ceil(c1 + rv));
    for (let z = Math.max(0, Math.floor(c2 - rv)), z1 = Math.min(nz - 1, Math.ceil(c2 + rv)); z <= z1; z++) { const dz = (z - c2) ** 2; if (dz > rv2) continue;
      for (let y = y0; y <= y1; y++) { const dy = (y - c1) ** 2, row = (z * ny + y) * nx;
        for (let x = x0; x <= x1; x++) if ((x - c0) ** 2 + dy + dz <= rv2) out[row + x] = 1 } } }
  return out;
}

/** how large the particle is, Å: the span of the density above the level, counting its connected pieces (on a coarse
    grid) of at least 5% of the largest, so noise above the level in the box's corners does not make the particle the box */
function particleExtent(m: DensityMap, level: number): number {
  const b = Math.max(1, Math.ceil(Math.max(m.nx, m.ny, m.nz) / 64)), cx = Math.ceil(m.nx / b), cy = Math.ceil(m.ny / b), cz = Math.ceil(m.nz / b);
  const occ = new Uint8Array(cx * cy * cz), d = m.data;
  for (let k = 0, q = 0; k < m.nz; k++) { const kk = ((k / b) | 0) * cy; for (let j = 0; j < m.ny; j++) { const jj = (kk + ((j / b) | 0)) * cx; for (let i = 0; i < m.nx; i++, q++) if (d[q] >= level) occ[jj + ((i / b) | 0)] = 1 } }
  const lab = new Int32Array(occ.length).fill(-1), size: number[] = [], box: number[][] = [], stack: number[] = [];
  for (let s0 = 0; s0 < occ.length; s0++) { if (!occ[s0] || lab[s0] >= 0) continue; const id = size.length; let n = 0; const bb = [1e9, -1, 1e9, -1, 1e9, -1];
    lab[s0] = id; stack.push(s0);
    while (stack.length) { const v = stack.pop()!; n++; const x = v % cx, y = ((v / cx) | 0) % cy, z = (v / (cx * cy)) | 0;
      if (x < bb[0]) bb[0] = x; if (x > bb[1]) bb[1] = x; if (y < bb[2]) bb[2] = y; if (y > bb[3]) bb[3] = y; if (z < bb[4]) bb[4] = z; if (z > bb[5]) bb[5] = z;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= cx || Y >= cy || Z >= cz) continue; const w = (Z * cy + Y) * cx + X; if (occ[w] && lab[w] < 0) { lab[w] = id; stack.push(w) } } }
    size.push(n); box.push(bb) }
  if (!size.length) return m.nx * m.step[0];
  const big = Math.max(...size) * 0.05; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, z0 = 1e9, z1 = -1;
  size.forEach((n, id) => { if (n < big) return; const bb = box[id]; x0 = Math.min(x0, bb[0]); x1 = Math.max(x1, bb[1]); y0 = Math.min(y0, bb[2]); y1 = Math.max(y1, bb[3]); z0 = Math.min(z0, bb[4]); z1 = Math.max(z1, bb[5]) });
  return Math.max((x1 - x0 + 0.5) * b * m.step[0], (y1 - y0 + 0.5) * b * m.step[1], (z1 - z0 + 0.5) * b * m.step[2]);   // (a coarse cell is only partly the particle's at each end)
}
