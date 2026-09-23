/* Bundle entry for the headless core (python/molsketch/_core.js): the browser globals the engine touches, then the core
   as one global object the host calls. No DOM, no WebGL: it runs in a bare V8. */
import { document, DOMMatrix, flush, setStream } from './canvas';
import * as core from './core';

const g = globalThis as any;
g.document = document; g.DOMMatrix = DOMMatrix;
if (!g.performance) g.performance = { now: () => Date.now() };
if (!g.console) { const log: string[] = []; g.console = { log: (...a: any[]) => log.push(a.join(' ')), warn: (...a: any[]) => log.push(a.join(' ')), error: (...a: any[]) => log.push(a.join(' ')), _log: log } }
g.MolSketchCore = { ...core, flush, setStream, version: '0.1.0' };
