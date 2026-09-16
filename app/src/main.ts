/* App entry: renderer + orbit controls + panel. Also exposes window.TriadSketch for scripts and the CLI. */
import { Renderer } from './render/renderer';
import { parseStructure } from './model/parse';
import { DEFAULT_STYLE, PALETTES, cloneStyle, mergeStyle, type Style } from './style';
import { LOOKS } from './looks';
import { buildPanel } from './app/panel';
import { OrbitControls } from './app/controls';
import { drawSketch } from './ink/sketch';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const skCanvas = document.getElementById('sk') as HTMLCanvasElement; const skCtx = skCanvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;

let style: Style = cloneStyle(DEFAULT_STYLE);
try { const s = localStorage.getItem('triad-sketch-style'); if (s) style = mergeStyle(DEFAULT_STYLE, JSON.parse(s)) } catch { }

const R = new Renderer(canvas);
let dpr = Math.min(2, window.devicePixelRatio || 1);
let live = true; let turntable = 0; let pitchSwing = 0; let dirty = true; let lastLive = 0; let currentLook = 'watercolour';
let sketchOn = true;            // draw the full sketch when the view rests
let lastChange = 0; let sketchShown = false; let boil = 0; let sketchStats = { readMs: 0, regionMs: 0, drawMs: 0, regions: 0 };
function invalidate() { dirty = true; lastChange = performance.now(); if (sketchShown) { sketchShown = false; skCanvas.classList.remove('on') } }
function runSketch() { skCanvas.width = R.w; skCanvas.height = R.h; sketchStats = drawSketch(skCtx, R, style, boil); sketchShown = true; skCanvas.classList.add('on') }

function fit() { const w = Math.max(64, Math.floor(stage.clientWidth * dpr)), h = Math.max(64, Math.floor(stage.clientHeight * dpr)); R.resize(w, h); invalidate() }
window.addEventListener('resize', fit);

function save() { try { localStorage.setItem('triad-sketch-style', JSON.stringify(style)) } catch { } }
function rebuild() { R.rebuild(style); invalidate(); save(); status() }
function redraw() { invalidate(); save() }

const controls = new OrbitControls(canvas, R.camera, () => { invalidate() });

function status(msg?: string) {
  const s = R.structure; const st = R.stats;
  const el = document.getElementById('status'); if (!el) return;
  el.textContent = (msg ? msg + '\n' : '') + (s ? `${s.name || 'structure'}: ${s.count.toLocaleString()} atoms, ${s.residues.length.toLocaleString()} residues, ${s.chains.length} chains · ${st.instances.toLocaleString()} instances, ${st.triangles.toLocaleString()} triangles, built in ${st.buildMs.toFixed(0)} ms` : 'no structure');
}

async function loadText(text: string, name: string) {
  const t0 = performance.now();
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
stage.addEventListener('drop', async e => { e.preventDefault(); stage.classList.remove('drag'); const f = e.dataTransfer?.files[0]; if (f) { try { await loadText(await f.text(), f.name) } catch (err: any) { status('could not read ' + f.name + ': ' + err.message) } } });

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
  onSketch: v => { sketchOn = v; invalidate() },
  savePng: () => { const a = document.createElement('a'); a.href = snapshot(); a.download = `${R.structure?.name || 'triad-sketch'}.png`; a.click() },
  saveStyle: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(style, null, 1)); a.download = 'triad-sketch-style.json'; a.click() },
  loadStyle: async (f: File) => { style = mergeStyle(DEFAULT_STYLE, JSON.parse(await f.text())); panel.refresh(); rebuild() },
  loadFile: async (f: File) => { await loadText(await f.text(), f.name) },
  loadExample: (name: string) => loadUrl('examples/' + name).catch(e => status(e.message)),
  reset: () => { style = cloneStyle(DEFAULT_STYLE); panel.refresh(); rebuild() },
  setDpr: (v: number) => { dpr = v; fit() },
  palettes: PALETTES,
});

/** PNG of what is on screen: the sketch when it is shown, else the GPU frame */
function snapshot() { if (sketchShown) return skCanvas.toDataURL('image/png'); R.render(style); return R.toDataURL() }

/* render loop: the GPU preview draws whenever something changed; once the view has rested, the sketch pass draws the real thing on the overlay.
   With breathing on, the sketch is redrawn with a new boil seed every so often. */
let lastT = performance.now(); let lastSketchAt = 0;
function loop(t: number) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (turntable) { R.camera.yaw = (R.camera.yaw + turntable * dt) % 360; if (pitchSwing) R.camera.pitch = pitchSwing * Math.sin(R.camera.yaw * Math.PI / 180); invalidate() }
  if (!sketchOn && live && t - lastLive > 1000 / 10) { lastLive = t; dirty = true }
  if (dirty) { dirty = false; R.render(style); hud.textContent = `preview ${R.stats.frameMs.toFixed(1)} ms · ${R.w}×${R.h} · yaw ${R.camera.yaw.toFixed(0)}° pitch ${R.camera.pitch.toFixed(0)}°` }
  else if (sketchOn && R.structure && !turntable) {
    const rested = t - lastChange > 220; const period = Math.max(900, (sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs) * 3);
    if ((!sketchShown && rested) || (live && sketchShown && t - lastSketchAt > period)) {
      if (sketchShown) boil++; lastSketchAt = t; runSketch();
      hud.textContent = `sketch ${(sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs).toFixed(0)} ms (read ${sketchStats.readMs.toFixed(0)}, regions ${sketchStats.regionMs.toFixed(0)}, draw ${sketchStats.drawMs.toFixed(0)}) · ${sketchStats.regions} regions · ${R.w}×${R.h}`;
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
  sketch: (b?: number) => { R.render(style); if (b !== undefined) boil = b; runSketch(); return sketchStats }, setSketch: (v: boolean) => { sketchOn = v; invalidate() },
};
