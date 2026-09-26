/* Maps prepared in a worker, for the app: a prepared map is the drawing's costliest step (a second or more for a
   large map), and drawn on the main thread it froze the app at every change of level, zone or carving. The app asks
   here; what is ready (cached) comes back at once, and what is not is prepared in the worker while the preview goes on,
   and `onReady` says when to draw. The headless core prepares maps in line, as before. */
import { preparedMap, adoptPrepared, mapKey, type EngineMap } from './mapprep';
import type { DensityMap } from '../model/map';
import type { Structure } from '../model/structure';
import type { Style } from '../style';

export class MapPrep {
  private worker: Worker;
  private ids = new WeakMap<object, number>(); private next = 1;
  private waiting = new Map<number, { key: string; map: DensityMap; style: Style; s: Structure | null; base: Float32Array; lr: DensityMap | null; t0: number }>();
  private pending = new Set<string>();
  /** a map in preparation (for the status line) */
  get busy() { return this.pending.size > 0 }
  lastMs = 0;
  constructor(private onReady: (error?: string) => void) {
    this.worker = new Worker(new URL('./mapworker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.done(e.data);
  }
  private idOf(o: DensityMap | Structure, kind: 'map' | 'structure') {
    let id = this.ids.get(o); if (id) return id;
    id = this.next++; this.ids.set(o, id); this.worker.postMessage({ type: kind, id, [kind]: o }); return id;
  }
  /** the map prepared for this style, if it is ready; else null, and it is being prepared */
  get(map: DensityMap, style: Style, s: Structure | null, base: Float32Array, lr: DensityMap | null): EngineMap | null {
    const hit = preparedMap(map, style, s, base, lr); if (hit) return hit;
    const key = mapKey(map, style, s, base, lr) + '|' + this.idOf(map, 'map') + '|' + (s ? this.idOf(s, 'structure') : 0) + '|' + (lr ? this.idOf(lr, 'map') : 0);
    if (this.pending.has(key)) return null;
    const id = this.next++, st = { map: JSON.parse(JSON.stringify(style.map)) } as Style; this.pending.add(key);
    this.waiting.set(id, { key, map, style: st, s, base: Float32Array.from(base), lr, t0: performance.now() });
    this.worker.postMessage({ type: 'prep', id, map: this.ids.get(map), structure: s ? this.ids.get(s) : null, localRes: lr ? this.ids.get(lr) : null, opts: st.map, base: Float32Array.from(base) });
    return null;
  }
  private done(r: { id: number; em?: any; error?: string }) {
    const w = this.waiting.get(r.id); if (!w) return; this.waiting.delete(r.id); this.pending.delete(w.key);
    if (r.em) { adoptPrepared(w.map, w.style, w.s, w.base, w.lr, r.em); this.lastMs = performance.now() - w.t0 }
    this.onReady(r.error);
  }
}
