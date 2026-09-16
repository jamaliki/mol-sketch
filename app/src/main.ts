/* App entry: renderer + orbit controls + panel. Also exposes window.TriadSketch for scripts and the CLI. */
import { Renderer } from './render/renderer';
import { parseStructure } from './model/parse';
import { DEFAULT_STYLE, PALETTES, cloneStyle, mergeStyle, type Style } from './style';
import { LOOKS } from './looks';
import { buildPanel } from './app/panel';
import { OrbitControls } from './app/controls';
import { drawSketch } from './ink/sketch';
import { renderClassic, renderScene, classic, sceneFromStructure } from './classic/adapter';
import { pcaBasis } from './render/renderer';
import { sceneFitPoints, structureFromState, type SceneDoc } from './classic/scene';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const skCanvas = document.getElementById('sk') as HTMLCanvasElement; const skCtx = skCanvas.getContext('2d', { willReadFrequently: true })!;   // CPU-backed: the classic engine composites huge offscreen canvases, which GPU canvases can drop silently
const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;

let style: Style = cloneStyle(DEFAULT_STYLE);
try { const s = localStorage.getItem('triad-sketch-style'); if (s) style = mergeStyle(DEFAULT_STYLE, JSON.parse(s)) } catch { }

const R = new Renderer(canvas);
let dpr = Math.min(2, window.devicePixelRatio || 1);
let live = true; let turntable = 0; let pitchSwing = 0; let dirty = true; let lastLive = 0; let currentLook = 'watercolour';
type RestMode = 'preview' | 'sketch' | 'classic';
let restMode: RestMode = 'classic';   // what is drawn once the view rests: the fast hybrid sketch or the exact classic engine
let sketchOn = true;
let lastChange = 0; let sketchShown = false; let boil = 0; let sketchStats = { readMs: 0, regionMs: 0, drawMs: 0, regions: 0 };
function invalidate() { dirty = true; lastChange = performance.now(); if (sketchShown) { sketchShown = false; skCanvas.classList.remove('on') } }
/* scenes: a keyframed document; the GPU previews the sampled state of the current frame, the classic engine draws the frame */
let sceneDoc: SceneDoc | null = null; let frame = 0; let playing = false; let sceneFast = false;
function timeline() { return classic().TL as { total: number; segs: { kf: number; type: string; start: number; len: number }[] } }
function setFrame(f: number) {
  if (!sceneDoc) return; const total = timeline().total; frame = ((f % total) + total) % total;
  const E = classic(); E.cfg = { ...E.cfg, stepEvery: 2 }; const drawn = Math.floor(frame / 2) * 2;
  const st = E.sampleState(drawn); const struct = structureFromState(st, sceneDoc.name || 'scene');
  R.structure = struct; R.rebuild(style); invalidate(); panel.transport?.(frame, total, st.stepName);
}
function loadScene(doc: SceneDoc, name: string) {
  sceneDoc = doc; const E = classic(); E.scene = doc; frame = 0; playing = false;
  if (doc.reps) style.reps = { ...doc.reps }; R.overrides = { ...(doc.groupColors || {}) };
  if (doc.view) { const v = doc.view; R.camera.yaw = v.yaw ?? 0; R.camera.pitch = v.pitch ?? 0; R.camera.zoom = v.zoom ?? 1; R.camera.panX = v.panX ?? 0; R.camera.panY = v.panY ?? 0; if (v.fov !== undefined) { R.camera.fov = v.fov; style.view.fov = v.fov } if (v.fog !== undefined) style.view.fog = v.fog; if (v.fogStart !== undefined) style.view.fogStart = v.fogStart }
  R.camera.base = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  R.fitOverride = sceneFitPoints(doc); R.camera.capFrac = style.show.caption ? 0.13 : 0; R.camera.topFrac = style.show.stepLabel ? 0.05 : 0;
  panel.refresh(); setFrame(0); status(`scene: ${doc.keyframes.length} keyframes, ${timeline().total} frames`);
}
/** A PDB/mmCIF stack → a scene with one keyframe per file (atoms matched by residue and name across files), oriented by PCA. */
function loadStack(files: { name: string; text: string }[]) {
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const structs = files.map(f => parseStructure(f.text, f.name.replace(/\.(pdb|ent|cif|mmcif)$/i, '')));
  const base = pcaBasis(structs[0]); const one = structs.length === 1;
  const keyframes = structs.map(st => { const sc = sceneFromStructure(st, style, {}, base, new Float32Array(0)); const k = sc.keyframes[0]; return { name: st.name, hold: one ? 24 : 0, transition: one ? 0 : 2, atoms: k.atoms, bonds: k.bonds, arrows: [] } });
  const hasPoly = structs[0].residues.some(r => !r.het);
  const doc: SceneDoc = { name: files.length > 1 ? 'PDB stack' : structs[0].name, reps: { sticks: hasPoly ? 'hetatm and not water' : 'all', cartoon: hasPoly ? 'polymer' : '', surface: '' }, groupColors: {}, view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 }, keyframes };
  (doc as any).fromPdb = true;
  loadScene(doc, doc.name || 'stack');
  status(`stack: ${files.length} file(s) → ${keyframes.length} keyframes, ${timeline().total} frames`);
}
function sceneJson(): string {
  const doc: any = sceneDoc ? { ...sceneDoc } : (R.structure ? sceneFromStructure(R.structure, style, R.overrides, R.camera.base, new Float32Array(0)) : null);
  if (!doc) return '{}';
  doc.reps = { ...style.reps }; doc.groupColors = { ...R.overrides }; delete doc.fitPoints;
  doc.view = { yaw: R.camera.yaw, pitch: R.camera.pitch, zoom: R.camera.zoom, panX: R.camera.panX, panY: R.camera.panY, fov: R.camera.fov, fog: style.view.fog, fogStart: style.view.fogStart };
  return JSON.stringify(doc, null, 1);
}
function runSketch(mode: RestMode = restMode) {
  skCanvas.width = R.w; skCanvas.height = R.h;
  if (mode === 'classic' && sceneDoc) { const ms = renderScene(skCtx, R, style, sceneDoc, frame, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 }; sceneFast = ms < 90 }
  else if (mode === 'classic') { const ms = renderClassic(skCtx, R, style, boil, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 } }
  else sketchStats = drawSketch(skCtx, R, style, boil);
  sketchShown = true; skCanvas.classList.add('on');
}

function fit() { const w = Math.max(64, Math.floor(stage.clientWidth * dpr)), h = Math.max(64, Math.floor(stage.clientHeight * dpr)); R.resize(w, h); invalidate() }
window.addEventListener('resize', fit);

function save() { try { localStorage.setItem('triad-sketch-style', JSON.stringify(style)) } catch { } }
function margins() { R.camera.capFrac = sceneDoc && style.show.caption ? 0.13 : 0; R.camera.topFrac = sceneDoc && style.show.stepLabel ? 0.05 : 0 }
function rebuild() { margins(); R.rebuild(style); invalidate(); save(); status() }
function redraw() { margins(); invalidate(); save() }

const controls = new OrbitControls(canvas, R.camera, () => { invalidate() });

function status(msg?: string) {
  const s = R.structure; const st = R.stats;
  const el = document.getElementById('status'); if (!el) return;
  el.textContent = (msg ? msg + '\n' : '') + (s ? `${s.name || 'structure'}: ${s.count.toLocaleString()} atoms, ${s.residues.length.toLocaleString()} residues, ${s.chains.length} chains · ${st.instances.toLocaleString()} instances, ${st.triangles.toLocaleString()} triangles, built in ${st.buildMs.toFixed(0)} ms` : 'no structure');
}

async function loadText(text: string, name: string) {
  const t0 = performance.now();
  if (/\.json$/i.test(name) || /^\s*\{/.test(text)) { loadScene(JSON.parse(text), name.replace(/\.json$/i, '')); return }
  sceneDoc = null; R.fitOverride = null; R.camera.capFrac = 0; R.camera.topFrac = 0; R.overrides = {};
  const s = parseStructure(text, name.replace(/\.(pdb|ent|cif|mmcif)$/i, ''));
  R.setStructure(s); R.camera.yaw = 0; R.camera.pitch = 0; R.camera.zoom = 1; R.camera.panX = 0; R.camera.panY = 0;
  const hasPoly = s.residues.some(r => !r.het);
  if (!hasPoly) { style.reps = { sticks: 'all', cartoon: '', surface: '' } }
  rebuild(); status(`parsed in ${(performance.now() - t0).toFixed(0)} ms`);
}
async function loadUrl(url: string) { const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + url + ' ' + r.status); await loadText(await r.text(), url.split('/').pop() || url) }

/* drag & drop */
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drag') });
stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
stage.addEventListener('drop', async e => { e.preventDefault(); stage.classList.remove('drag'); const fl = Array.from(e.dataTransfer?.files || []); if (fl.length) { try { await loadFiles(fl) } catch (err: any) { status('could not read: ' + err.message) } } });
/** one file: structure or scene; several: a stack */
async function loadFiles(fl: File[]) {
  if (fl.length === 1) { await loadText(await fl[0].text(), fl[0].name); return }
  const texts = []; for (const f of fl) texts.push({ name: f.name, text: await f.text() });
  loadStack(texts);
}

/* panel */
function applyLook(key: string) {
  const L = LOOKS[key]; if (!L) return; currentLook = key;
  const keep = { reps: style.reps }; style = mergeStyle(DEFAULT_STYLE, L.style); if (!L.style.reps) style.reps = keep.reps;
  panel.refresh(); rebuild();
}
const panel = buildPanel(document.getElementById('controls')!, {
  get style() { return style }, set style(v) { style = v },
  looks: LOOKS, currentLook: () => currentLook, applyLook,
  rebuild, redraw, camera: R.camera,
  onLive: v => { live = v; invalidate() }, onTurntable: v => { turntable = v; invalidate() }, onPitchSwing: v => { pitchSwing = v },
  onRest: (v: string) => { restMode = v as RestMode; sketchOn = v !== 'preview'; invalidate() },
  renderNow: () => { R.render(style); runSketch('classic'); hud.textContent = `classic ${sketchStats.drawMs.toFixed(0)} ms · ${R.w}×${R.h}` },
  savePng: () => { const a = document.createElement('a'); a.href = snapshot(); a.download = `${R.structure?.name || 'triad-sketch'}.png`; a.click() },
  saveStyle: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(style, null, 1)); a.download = 'triad-sketch-style.json'; a.click() },
  loadStyle: async (f: File) => { style = mergeStyle(DEFAULT_STYLE, JSON.parse(await f.text())); panel.refresh(); rebuild() },
  loadFile: async (f: File) => { await loadText(await f.text(), f.name) }, loadFiles,
  saveScene: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(sceneJson()); a.download = (sceneDoc?.name || R.structure?.name || 'scene') + '.json'; a.click() },
  loadExample: (name: string) => loadUrl('examples/' + name).catch(e => status(e.message)),
  play: (v: boolean) => { playing = v }, isPlaying: () => playing, seek: (f: number) => { playing = false; setFrame(f) }, step: (d: number) => { playing = false; setFrame(frame + d) },
  reset: () => { style = cloneStyle(DEFAULT_STYLE); panel.refresh(); rebuild() },
  setDpr: (v: number) => { dpr = v; fit() },
  palettes: PALETTES,
});

/** PNG of what is on screen: the sketch when it is shown, else the GPU frame */
function snapshot() { if (sketchShown) return skCanvas.toDataURL('image/png'); R.render(style); return R.toDataURL() }

/* keyboard transport: space plays, , and . step a drawn frame */
window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.tagName === 'INPUT' || !sceneDoc) return; if (e.key === ' ') { e.preventDefault(); playing = !playing } else if (e.key === ',') setFrame(frame - 2); else if (e.key === '.') setFrame(frame + 2) });

/* render loop: the GPU preview draws whenever something changed; once the view has rested, the sketch pass draws the real thing on the overlay.
   With breathing on, the sketch is redrawn with a new boil seed every so often. */
let lastT = performance.now(); let lastSketchAt = 0; let playAcc = 0;
function loop(t: number) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (playing && sceneDoc) { playAcc += dt * 24; if (playAcc >= 2) { playAcc -= 2; setFrame(frame + 2); if (restMode === 'classic' && sceneFast) { dirty = false; R.render(style); runSketch('classic') } } }
  if (turntable) { R.camera.yaw = (R.camera.yaw + turntable * dt) % 360; if (pitchSwing) R.camera.pitch = pitchSwing * Math.sin(R.camera.yaw * Math.PI / 180); invalidate() }
  if (!sketchOn && live && t - lastLive > 1000 / 10) { lastLive = t; dirty = true }
  if (dirty) { dirty = false; R.render(style); hud.textContent = `preview ${R.stats.frameMs.toFixed(1)} ms · ${R.w}×${R.h} · yaw ${R.camera.yaw.toFixed(0)}° pitch ${R.camera.pitch.toFixed(0)}°` }
  else if (sketchOn && R.structure && !turntable) {
    const rested = t - lastChange > 220; const period = Math.max(900, (sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs) * 3);
    if ((!sketchShown && rested) || (live && sketchShown && t - lastSketchAt > period)) {
      if (sketchShown) boil++; lastSketchAt = t; runSketch();
      hud.textContent = restMode === 'classic' ? `classic ${sketchStats.drawMs.toFixed(0)} ms · ${R.w}×${R.h}` : `sketch ${(sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs).toFixed(0)} ms (read ${sketchStats.readMs.toFixed(0)}, regions ${sketchStats.regionMs.toFixed(0)}, draw ${sketchStats.drawMs.toFixed(0)}) · ${sketchStats.regions} regions · ${R.w}×${R.h}`;
    }
  }
  requestAnimationFrame(loop);
}
fit(); requestAnimationFrame(loop);
loadUrl('examples/test_protein.pdb').catch(e => status(e.message));

/* scripting hook (used by the CLI and tests) */
(window as any).TriadSketch = {
  get style() { return style }, set style(v: Style) { style = mergeStyle(DEFAULT_STYLE, v); panel.refresh(); rebuild() },
  applyLook, loadText, loadUrl, render: () => { R.render(style); return R.stats.frameMs }, renderer: R, camera: R.camera,
  setLive: (v: boolean) => { live = v }, setTurntable: (v: number) => { turntable = v }, png: snapshot,
  setSize: (w: number, h: number) => { R.resize(w, h) }, rebuild,
  sketch: (b?: number, mode?: RestMode) => { R.render(style); if (b !== undefined) boil = b; runSketch(mode || 'sketch'); return sketchStats },
  renderClassic, classicEngine: () => classic(), seek: setFrame, loadScene, loadStack, sceneJson, get frame() { return frame }, get scene() { return sceneDoc },
  classic: (b?: number) => { R.render(style); if (b !== undefined) boil = b; runSketch('classic'); return sketchStats.drawMs },
  setSketch: (v: boolean) => { sketchOn = v; invalidate() }, setRest: (m: RestMode) => { restMode = m; sketchOn = m !== 'preview'; invalidate() },
};
