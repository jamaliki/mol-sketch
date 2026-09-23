/* The app's line to the molsketch SDK: when the app is served by `molsketch serve` (or one is running on
   localhost:8471 while developing), its figures are drawn there, by the same engine the Python package draws with. The
   app sends a figure spec (the headless core's FigureSpec: input, full style, camera, labels, group colours, frame,
   size) and gets the picture. Without a server the app draws in the browser with the same core code. */
import type { FigureSpec } from '../headless/core';

export interface SDK {
  url: string; version: string;
  /** keep an input (a structure's text, a scene, a stack) on the server; returns its ref */
  put(input: any): Promise<string>;
  drop(ref: string): void;
  render(spec: FigureSpec): Promise<ImageBitmap>;
  call<T = any>(name: string, ...args: any[]): Promise<T>;
}

async function probe(base: string): Promise<SDK | null> {
  try {
    const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(800) }); if (!r.ok) return null;
    const h = await r.json(); if (!h.molsketch) return null;
    const post = async (path: string, body: any) => { const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error || msg } catch { } throw new Error(msg) } return res };
    return {
      url: base, version: h.molsketch,
      put: async input => (await (await post('/api/put', { input })).json()).ref,
      drop: ref => { post('/api/drop', { ref }).catch(() => { }) },
      render: async spec => createImageBitmap(await (await post('/api/render', spec)).blob()),
      call: async (name, ...args) => (await post('/api/call', { name, args })).json(),
    };
  } catch { return null }
}

/** the SDK this app can draw through: its own origin, a ?sdk=URL, or (in development) localhost:8471; null if none */
export async function connect(): Promise<SDK | null> {
  const q = new URLSearchParams(location.search).get('sdk');
  if (q === 'off') return null;
  const tries = [q, location.origin, (import.meta as any).env?.DEV ? 'http://localhost:8471' : null].filter(Boolean) as string[];
  for (const t of tries) { const s = await probe(t.replace(/\/$/, '')); if (s) return s }
  return null;
}

/** keeps the current input on the server: a structure once, a scene again whenever it changes (by its revision) */
export class InputSync {
  private ref: string | null = null; private key: any = null; private pending: Promise<string> | null = null;
  constructor(private sdk: SDK) { }
  /** the ref for this input; `key` identifies its version (the structure object, or the scene with its revision) */
  get(key: any, make: () => any): Promise<string> {
    if (key === this.key && (this.ref || this.pending)) return this.pending || Promise.resolve(this.ref!);
    const old = this.ref; this.key = key; this.ref = null;
    this.pending = this.sdk.put(make()).then(r => { if (this.key === key) { this.ref = r; this.pending = null } if (old) this.sdk.drop(old); return r });
    return this.pending;
  }
}
