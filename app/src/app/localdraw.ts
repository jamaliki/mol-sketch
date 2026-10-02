/* The app's drawing worker (src/headless/drawworker.ts) behind the SDK's interface: without `molsketch serve`, the
   finished frames of a large figure are drawn there, off the main thread, by the same headless core. No SVG: that
   takes the server. */
import type { FigureSpec } from '../headless/core';
import type { DensityMap } from '../model/map';
import type { SDK } from './sdk';

export class LocalDraw implements SDK {
  url = 'worker'; version = 'local';
  lastMs = 0;
  private w: Worker; private n = 0; private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  /** the worker's fonts are loaded (drawing waits for them) */
  ready: Promise<void>;
  constructor(fontCss: string | null) {
    this.w = new Worker(new URL('../headless/drawworker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = e => { const { id, result, error } = e.data; const p = this.waiting.get(id); if (!p) return; this.waiting.delete(id); if (error) p.fail(new Error(error)); else p.ok(result) };
    this.w.onerror = e => { for (const p of this.waiting.values()) p.fail(new Error(e.message || 'the drawing worker failed')); this.waiting.clear() };
    this.ready = this.ask('fonts', fontCss);
  }
  private ask(kind: string, ...args: any[]): Promise<any> { const id = ++this.n; return new Promise((ok, fail) => { this.waiting.set(id, { ok, fail }); this.w.postMessage({ id, kind, args }) }) }
  put(input: any): Promise<string> { return this.ask('put', input) }
  drop(ref: string) { this.ask('drop', ref).catch(() => { }) }
  /** a map (its grid copied once to the worker); returns its ref */
  putMap(m: DensityMap): Promise<string> {
    return this.ask('putMap', { name: m.name, nx: m.nx, ny: m.ny, nz: m.nz, origin: m.origin, step: m.step, level: m.level ?? null, binned: m.binned || 1, mass: m.mass ?? null, resolution: m.resolution ?? null }, m.data);
  }
  /** `quick`: a frame of a moving view (clip edges drawn as the OffscreenCanvas draws them, at its own speed) */
  async render(spec: FigureSpec, o: { quick?: boolean } = {}): Promise<ImageBitmap> { await this.ready; const r = await this.ask('render', spec, o); this.lastMs = r.ms; return r.bitmap }
  svg(): Promise<string> { return Promise.reject(new Error('SVG needs the molsketch server: run `molsketch serve`')) }
  call<T = any>(name: string, ...args: any[]): Promise<T> { return this.ask('call', name, args) }
  /** the worker stopped (one made for an export, done with) */
  close() { this.w.terminate(); for (const p of this.waiting.values()) p.fail(new Error('the drawing worker was closed')); this.waiting.clear() }
}
