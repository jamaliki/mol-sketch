/* Maps prepared off the main thread: the app sends each map and structure once, then asks for maps prepared for a
   style; the answer is the prepared map without its sampler (a function does not cross), which the app rebuilds
   (mapasync.ts). The same prepareMap as everywhere, so the drawing does not depend on where it was prepared. */
import { prepareMap, forgetPrepared } from './mapprep';
import type { DensityMap } from '../model/map';
import type { Structure } from '../model/structure';

const maps = new Map<number, DensityMap>(), structures = new Map<number, Structure>();
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'map') maps.set(m.id, m.map);
  else if (m.type === 'structure') structures.set(m.id, m.structure);
  else if (m.type === 'drop') { maps.delete(m.id); structures.delete(m.id) }
  else if (m.type === 'prep') {
    try {
      const map = maps.get(m.map), s = m.structure != null ? structures.get(m.structure) ?? null : null, lr = m.localRes != null ? maps.get(m.localRes) ?? null : null;
      if (!map) throw new Error('the map was not sent');
      const { sample, ...em } = prepareMap(map, { map: m.opts } as any, s, m.base, lr) as any;
      // its arrays handed over, not copied (the app keeps the prepared map; this side keeps only the inputs, whose
      // arrays the grid may be)
      forgetPrepared(map); const mine = new Set([map.data.buffer, lr?.data.buffer]), give = new Set<ArrayBuffer>();
      for (const L of em.levels) for (const a of [L.pos, L.nor, L.tri, L.near, L.dist, L.hand]) if (a && !mine.has(a.buffer)) give.add(a.buffer);
      if (!mine.has(em.grid.data.buffer)) give.add(em.grid.data.buffer);
      (self as any).postMessage({ id: m.id, em }, [...give]);
    } catch (err: any) { (self as any).postMessage({ id: m.id, error: String(err?.message || err) }) }
  }
};
