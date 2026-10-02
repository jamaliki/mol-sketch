/* The app's drawing worker: the headless core (the Python package's drawing code) drawing onto OffscreenCanvases, so
   the app's finished frames of a large figure are drawn off the main thread and the app never freezes while they are.
   It speaks the SDK's language (put an input, put a map, render a spec to a bitmap: src/app/localdraw.ts), as
   `molsketch serve` does, and draws with the page's own fonts, loaded here from the same stylesheet. */
import * as core from './core';
import { installAAClips, setAAClips } from './aaclip';

const g = self as any;
installAAClips();   // clips as a page's canvas draws them (antialiased), not as an OffscreenCanvas does
g.document = { createElement(tag: string) { if (tag !== 'canvas') throw new Error('the drawing worker makes only canvases'); return new OffscreenCanvas(1, 1) } };

/** the page's web fonts (its Google Fonts stylesheet), every face, loaded before anything is drawn */
async function fonts(css: string) {
  const text = await (await fetch(css)).text(); const loads: Promise<any>[] = [];
  for (const block of text.match(/@font-face\s*{[^}]*}/g) || []) {
    const get = (k: string) => (new RegExp(k + '\\s*:\\s*([^;]+);').exec(block) || [])[1]?.trim();
    const family = get('font-family')?.replace(/['"]/g, ''), src = /url\(([^)]+)\)/.exec(block)?.[1]; if (!family || !src) continue;
    const face = new FontFace(family, `url(${src})`, { weight: get('font-weight') || 'normal', style: get('font-style') || 'normal', unicodeRange: get('unicode-range') || 'U+0-10FFFF' });
    g.fonts.add(face); loads.push(face.load().catch(() => null));
  }
  await Promise.all(loads);
}

let refs = 0;
g.onmessage = async (e: MessageEvent) => {
  const { id, kind, args } = e.data;
  try {
    let result: any = null, transfer: any[] = [];
    if (kind === 'fonts') { if (args[0]) await fonts(args[0]).catch(() => null) }   // offline: the page has no web fonts either, and both draw with the fallbacks
    else if (kind === 'put') result = core.put(`in${++refs}`, args[0]);
    else if (kind === 'drop') core.drop(args[0]);
    else if (kind === 'putMap') result = core.putMap(`map${++refs}`, args[0], args[1]);
    else if (kind === 'render') { setAAClips(!args[1]?.quick); const { canvas, ms } = core.drawOn(args[0], (w, h) => new OffscreenCanvas(w, h)); result = { bitmap: canvas.transferToImageBitmap(), ms }; transfer = [result.bitmap] }
    else if (kind === 'call') result = (core as any)[args[0]](...args[1]);
    g.postMessage({ id, result }, transfer);
  } catch (err: any) { g.postMessage({ id, error: String(err?.message || err) }) }
};
