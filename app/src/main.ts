/* App entry: renderer + orbit controls + panel. Also exposes window.TriadSketch for scripts and the CLI. */
import { Renderer } from './render/renderer';
import { parseStructure } from './model/parse';
import { DEFAULT_STYLE, PALETTES, cloneStyle, mergeStyle, type Style } from './style';
import { LOOKS } from './looks';
import { GROUP_PALETTES } from './palettes';
import { GROUP_PALETTE } from './model/color';
import { buildPanel } from './app/panel';
import { OrbitControls } from './app/controls';
import { drawSketch } from './ink/sketch';
import { renderClassic, renderScene, classic, sceneFromStructure, cfgFromStyle } from './classic/adapter';
import { pcaBasis } from './render/renderer';
import { sceneFitPoints, structureFromState, type SceneDoc } from './classic/scene';
import { History, type Snapshot } from './app/history';
import { lintScene, lintSummary, type LintItem } from './app/lint';
import { keyDiff, drawDiff, diffSummary, type KeyDiff } from './app/diff';
import { hitTest, anchorFor, anchorText, addArrow, anchorScreen, toggleLonePair, cycleCharge, type Anchor, type Hit } from './app/author';
import { suggestViews, holdFrames, type ViewSuggestion } from './app/views';
import { renderVideo, codecSupport, hasWebCodecs, fmtBytes, type CodecName, type Quality } from './app/encode';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const skCanvas = document.getElementById('sk') as HTMLCanvasElement; const skCtx = skCanvas.getContext('2d', { willReadFrequently: true })!;   // CPU-backed: the classic engine composites huge offscreen canvases, which GPU canvases can drop silently
const ovCanvas = document.getElementById('ov') as HTMLCanvasElement; const ovCtx = ovCanvas.getContext('2d')!;   // overlays: change highlights, authoring marks
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
function invalidate() { dirty = true; lastChange = performance.now(); if (sketchShown) { sketchShown = false; skCanvas.classList.remove('on') } drawOverlay() }
/* scenes: a keyframed document; the GPU previews the sampled state of the current frame, the classic engine draws the frame */
let sceneDoc: SceneDoc | null = null; let frame = 0; let playing = false; let sceneFast = false;
const FPS = 24;   // the timeline's frames per second; drawings are every second frame (12 per second)
function timeline() { return classic().TL as { total: number; segs: { kf: number; type: string; start: number; len: number }[] } }
function camOf() { return { yaw: R.camera.yaw, pitch: R.camera.pitch, roll: R.camera.roll, zoom: R.camera.zoom, panX: R.camera.panX, panY: R.camera.panY } }
/** With keyframe cameras in the scene, the app's camera follows the interpolated one as the timeline moves. */
function syncKeyView(f: number) {
  if (!sceneDoc || !sceneDoc.keyframes.some(k => k.view)) return;
  const E = classic(); E.cfg = cfgFromStyle(style, R.camera, true); const v = E.viewAt(f); if (!v) return;
  R.camera.yaw = v.yaw; R.camera.pitch = v.pitch; R.camera.roll = v.roll; R.camera.zoom = v.zoom; R.camera.panX = v.panX; R.camera.panY = v.panY;
}
function setFrame(f: number) {
  if (!sceneDoc) return; const total = timeline().total; frame = ((f % total) + total) % total;
  const E = classic(); E.cfg = { ...E.cfg, stepEvery: 2 }; const drawn = Math.floor(frame / 2) * 2;
  syncKeyView(drawn);
  const st = E.sampleState(drawn); const struct = structureFromState(st, sceneDoc.name || 'scene');
  R.structure = struct; R.rebuild(style); invalidate(); panel.transport?.(frame, total, st.stepName);
}
let lintItems: LintItem[] = [];
function relint() { lintItems = sceneDoc ? lintScene(sceneDoc) : []; panel.refreshChecks?.() }
function loadScene(doc: SceneDoc, name: string) {
  sceneDoc = doc; const E = classic(); E.scene = doc; frame = 0; playing = false; pendingTail = null;
  if (doc.reps) style.reps = { ...doc.reps }; R.overrides = { ...(doc.groupColors || {}) };
  if (doc.view) { const v = doc.view; R.camera.yaw = v.yaw ?? 0; R.camera.pitch = v.pitch ?? 0; R.camera.roll = v.roll ?? 0; R.camera.zoom = v.zoom ?? 1; R.camera.panX = v.panX ?? 0; R.camera.panY = v.panY ?? 0; if (v.fov !== undefined) { R.camera.fov = v.fov; style.view.fov = v.fov } if (v.fog !== undefined) style.view.fog = v.fog; if (v.fogStart !== undefined) style.view.fogStart = v.fogStart }
  R.camera.base = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  R.fitOverride = sceneFitPoints(doc); R.camera.capFrac = style.show.caption ? 0.13 : 0; R.camera.topFrac = style.show.stepLabel ? 0.05 : 0;
  history.clear(); relint();
  panel.refresh(); setFrame(0); status(`scene: ${doc.keyframes.length} keyframes, ${(timeline().total / FPS).toFixed(1)} s · ${lintSummary(lintItems)}`);
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
  doc.view = { yaw: R.camera.yaw, pitch: R.camera.pitch, roll: R.camera.roll, zoom: R.camera.zoom, panX: R.camera.panX, panY: R.camera.panY, fov: R.camera.fov, fog: style.view.fog, fogStart: style.view.fogStart };
  return JSON.stringify(doc, null, 1);
}
function runSketch(mode: RestMode = restMode) {
  skCanvas.width = R.w; skCanvas.height = R.h;
  if (mode === 'classic' && sceneDoc) { const ms = renderScene(skCtx, R, style, sceneDoc, frame, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 }; sceneFast = ms < 90 }
  else if (mode === 'classic') { const ms = renderClassic(skCtx, R, style, boil, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 } }
  else sketchStats = drawSketch(skCtx, R, style, boil);
  sketchShown = true; skCanvas.classList.add('on'); drawOverlay();
}

/* the canvas fills the stage, or keeps the output's aspect inside it (letterboxed), so a fit made here is the fit of the video */
let previewAspect: number | null = null;   // null: free
function fit() {
  let cw = stage.clientWidth, ch = stage.clientHeight, left = 0, top = 0;
  if (previewAspect) { if (cw / ch > previewAspect) { const w = Math.floor(ch * previewAspect); left = Math.floor((cw - w) / 2); cw = w } else { const h = Math.floor(cw / previewAspect); top = Math.floor((ch - h) / 2); ch = h } }
  for (const c of [canvas, skCanvas, ovCanvas]) { c.style.left = left + 'px'; c.style.top = top + 'px'; c.style.width = cw + 'px'; c.style.height = ch + 'px' }
  const w = Math.max(64, Math.floor(cw * dpr)), h = Math.max(64, Math.floor(ch * dpr)); R.resize(w, h); invalidate(); showGuides(guideBox);
}
window.addEventListener('resize', fit);
function setPreviewAspect(a: number | null) { previewAspect = a; fit() }

function save() { try { localStorage.setItem('triad-sketch-style', JSON.stringify(style)) } catch { } }
function margins() { R.camera.capFrac = sceneDoc && style.show.caption ? 0.13 : 0; R.camera.topFrac = sceneDoc && style.show.stepLabel ? 0.05 : 0 }
function rebuild() { margins(); R.rebuild(style); invalidate(); save(); status() }
function redraw() { margins(); invalidate(); save() }

/* undo: snapshots of style, camera, colour overrides and (for keyframe edits) the keyframes */
const history = new History(
  (withScene): Snapshot => ({ label: '', at: performance.now(), style: JSON.stringify(style), cam: [R.camera.yaw, R.camera.pitch, R.camera.roll, R.camera.zoom, R.camera.panX, R.camera.panY, R.camera.fov], overrides: JSON.stringify(R.overrides), keyframes: withScene && sceneDoc ? JSON.stringify(sceneDoc.keyframes) : null, frame }),
  (s) => {
    style = mergeStyle(DEFAULT_STYLE, JSON.parse(s.style)); const c = s.cam; R.camera.yaw = c[0]; R.camera.pitch = c[1]; R.camera.roll = c[2]; R.camera.zoom = c[3]; R.camera.panX = c[4]; R.camera.panY = c[5]; R.camera.fov = c[6]; R.overrides = JSON.parse(s.overrides);
    if (s.keyframes && sceneDoc) { sceneDoc.keyframes = JSON.parse(s.keyframes); classic().scene = sceneDoc; R.fitOverride = sceneFitPoints(sceneDoc); relint() }
    pendingTail = null; panel.refresh(); rebuild(); if (sceneDoc) setFrame(s.keyframes ? s.frame : frame);
  },
  () => panel.refreshHistory?.());
const mark = (label: string, scene = false) => history.mark(label, scene);
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); const l = e.shiftKey ? history.forward() : history.back(); status(l ? (e.shiftKey ? 'redo: ' : 'undo: ') + l : 'nothing to ' + (e.shiftKey ? 'redo' : 'undo')) }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); const l = history.forward(); status(l ? 'redo: ' + l : 'nothing to redo') }
  else if (e.key === 'Escape' && pendingTail) { pendingTail = null; drawOverlay(); status('arrow cancelled') }
});

const controls = new OrbitControls(canvas, R.camera, () => { invalidate() }, what => mark(what), () => history.settle());

function status(msg?: string) {
  const s = R.structure; const st = R.stats;
  const el = document.getElementById('status'); if (!el) return;
  el.textContent = (msg ? msg + '\n' : '') + (s ? `${s.name || 'structure'}: ${s.count.toLocaleString()} atoms, ${s.residues.length.toLocaleString()} residues, ${s.chains.length} chains · ${st.instances.toLocaleString()} instances, ${st.triangles.toLocaleString()} triangles, built in ${st.buildMs.toFixed(0)} ms` : 'no structure');
}

let loadSeq = 0;   // every load bumps it; the start-up example only lands if nothing else loaded meanwhile
async function loadText(text: string, name: string) {
  loadSeq++; const t0 = performance.now();
  if (/\.json$/i.test(name) || /^\s*\{/.test(text)) { loadScene(JSON.parse(text), name.replace(/\.json$/i, '')); return }
  sceneDoc = null; R.fitOverride = null; R.camera.capFrac = 0; R.camera.topFrac = 0; R.overrides = {}; lintItems = []; history.clear();
  const s = parseStructure(text, name.replace(/\.(pdb|ent|cif|mmcif)$/i, ''));
  R.setStructure(s); R.camera.yaw = 0; R.camera.pitch = 0; R.camera.roll = 0; R.camera.zoom = 1; R.camera.panX = 0; R.camera.panY = 0;
  const hasPoly = s.residues.some(r => !r.het);
  if (!hasPoly) { style.reps = { sticks: 'all', cartoon: '', surface: '' } }
  rebuild(); panel.refresh(); panel.refreshChecks?.(); status(`parsed in ${(performance.now() - t0).toFixed(0)} ms`);
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

/* framing: fit what is drawn into a box given as fractions of the canvas (x right, y down) */
export type FrameBox = { x0: number; y0: number; x1: number; y1: number };
export const FRAME_PRESETS: Record<string, { box: FrameBox; note: string; size: [number, number] }> = {
  'hero desktop': { box: { x0: 0.57, y0: 0.13, x1: 0.92, y1: 0.58 }, note: 'right of the headline, under the nav, 16:9', size: [1920, 1080] },
  'hero phone': { box: { x0: 0.11, y0: 0.15, x1: 0.89, y1: 0.45 }, note: 'upper third of a 9:16 frame', size: [1080, 1920] },
  'centred': { box: { x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.92 }, note: 'the whole canvas with a margin', size: [1920, 1080] },
};
function framePoints(what: 'all' | 'frame'): Float32Array {
  if (what === 'frame' || !sceneDoc) { const s = R.structure; if (!s) return new Float32Array(0); const out = new Float32Array(s.count * 3); for (let i = 0; i < s.count; i++) { out[i * 3] = s.x[i]; out[i * 3 + 1] = s.y[i]; out[i * 3 + 2] = s.z[i] } return out }
  return R.fitOverride || new Float32Array(0);
}
function fitFrame(box: FrameBox, what: 'all' | 'frame' = 'all') { R.camera.fitTo(box, R.w, R.h, framePoints(what)); invalidate() }
let guideBox: FrameBox | null = null;
function showGuides(box: FrameBox | null) {
  guideBox = box; let g = document.getElementById('guide'); if (!g) { g = document.createElement('div'); g.id = 'guide'; g.style.cssText = 'position:absolute;pointer-events:none;border:1px dashed #f97316;box-shadow:0 0 0 9999px rgba(0,0,0,.25);display:none'; stage.appendChild(g) }
  if (!box) { g.style.display = 'none'; return }
  const cl = parseFloat(canvas.style.left) || 0, ct = parseFloat(canvas.style.top) || 0, cw = parseFloat(canvas.style.width) || stage.clientWidth, ch = parseFloat(canvas.style.height) || stage.clientHeight;
  g.style.display = 'block'; g.style.left = (cl + box.x0 * cw) + 'px'; g.style.top = (ct + box.y0 * ch) + 'px'; g.style.width = (box.x1 - box.x0) * cw + 'px'; g.style.height = (box.y1 - box.y0) * ch + 'px';
}
/** The command that renders what is on screen, for the terminal: the scene and style go out as files first. */
function renderCommand(): string {
  const name = (sceneDoc?.name || R.structure?.name || 'scene').replace(/[^\w.-]+/g, '_');
  const input = sceneDoc ? name + '.json' : (R.structure?.name || 'structure') + '.pdb';
  const cam = sceneDoc ? '' : ` --yaw ${R.camera.yaw.toFixed(1)} --pitch ${R.camera.pitch.toFixed(1)} --roll ${R.camera.roll.toFixed(1)} --zoom ${R.camera.zoom.toFixed(3)} --pan ${R.camera.panX.toFixed(3)},${R.camera.panY.toFixed(3)} --fov ${R.camera.fov}`;
  const size = renderSize ? `${renderSize[0]}x${renderSize[1]}` : `${R.w}x${R.h}`;
  return `node cli/render.mjs ${input} --style ${name}-style.json${cam} --size ${size} --frames ${sceneDoc ? 'drawn' : 1} --out out_${name}`;
}
/* the groups of what is loaded (residues, molecules, chains) and their colours, for the panel's swatches */
function groups(): { key: string }[] {
  if (sceneDoc) { const seen: string[] = []; for (const k of sceneDoc.keyframes) for (const id in k.atoms) { const a = k.atoms[id]; const g = a.group || ((a.resn || '') + (a.resi ?? '')); if (!seen.includes(g)) seen.push(g) } return seen.map(key => ({ key })) }
  const s = R.structure; if (!s) return [];
  const out: { key: string }[] = [];
  if (s.chains.length > 1) for (const ch of s.chains) out.push({ key: ch.id });
  for (const r of s.residues) if (r.het && out.length < 40) out.push({ key: r.resn + r.resi + (r.chain ? '.' + r.chain : '') });
  return out;
}
function autoIndex(key: string): number {
  if (sceneDoc) return groups().findIndex(g => g.key === key);
  const s = R.structure; if (!s) return 0;
  const ci = s.chains.findIndex(c => c.id === key); if (ci >= 0) return ci;
  const r = s.residues.find(r => r.resn + r.resi + (r.chain ? '.' + r.chain : '') === key); return r ? r.index : 0;
}
function groupColor(key: string): string { if (R.overrides[key]) return R.overrides[key]; const gp = style.groupPalette && style.groupPalette.length ? style.groupPalette : GROUP_PALETTE; return gp[Math.max(0, autoIndex(key)) % gp.length] }
function setGroupColor(key: string, v: string | null) { if (v) R.overrides[key] = v; else delete R.overrides[key]; if (sceneDoc) sceneDoc.groupColors = { ...R.overrides }; rebuild() }

/* ---------- keyframes: timing in seconds, order, copies, cameras ---------- */
function currentKey(): number { return sceneDoc ? classic().locate(frame).seg.kf : 0 }
function keyframes() {
  if (!sceneDoc) return [];
  return sceneDoc.keyframes.map((k, i) => ({ i, name: k.name || 'step ' + (i + 1), hold: (k.hold ?? 24) / FPS, transition: (k.transition ?? 48) / FPS, atoms: Object.keys(k.atoms || {}).length, arrows: (k.arrows || []).length, view: !!k.view, path: !!(k.path && k.path.length) }));
}
function loopSeconds() { return sceneDoc ? timeline().total / FPS : 0 }
function sceneChanged(what: string) { const E = classic(); E.scene = sceneDoc; R.fitOverride = sceneDoc ? sceneFitPoints(sceneDoc) : null; (sceneDoc as any)._rev = ((sceneDoc as any)._rev || 0) + 1; relint(); panel.refresh(); setFrame(Math.min(frame, timeline().total - 1)); status(what) }
function setKeyTiming(i: number, holdS: number, transS: number) {
  if (!sceneDoc) return; mark('timing', true); const k = sceneDoc.keyframes[i];
  k.hold = Math.max(0, Math.round(holdS * FPS)); k.transition = Math.max(0, Math.round(transS * FPS)); sceneChanged(`keyframe ${i + 1}: hold ${(k.hold / FPS).toFixed(2)} s, transition ${(k.transition / FPS).toFixed(2)} s`);
}
function setKeyName(i: number, name: string) { if (!sceneDoc) return; mark('rename', true); sceneDoc.keyframes[i].name = name; sceneChanged('renamed keyframe ' + (i + 1)) }
function goToKey(i: number) { const seg = timeline().segs.find(s => s.kf === i && s.type === 'hold') || timeline().segs.find(s => s.kf === i); if (seg) { playing = false; setFrame(seg.start + (seg.type === 'hold' ? Math.floor(seg.len * 0.9 / 2) * 2 : 0)) } }
function duplicateKey(i: number) {
  if (!sceneDoc) return; mark('duplicate keyframe', true); const k = sceneDoc.keyframes[i]; const copy = JSON.parse(JSON.stringify(k)); copy.name = (k.name || 'step ' + (i + 1)) + ' copy';
  // the copy takes the original's way to the next keyframe (its transition and path); the original now leads to an identical state
  k.transition = 0; delete k.path; delete k.leave; delete k.asNext; delete k.exitDir;
  sceneDoc.keyframes.splice(i + 1, 0, copy); sceneChanged(`keyframe ${i + 1} duplicated as ${i + 2}; edit the copy`); goToKey(i + 1);
}
function deleteKey(i: number) { if (!sceneDoc || sceneDoc.keyframes.length < 2) return; mark('delete keyframe', true); sceneDoc.keyframes.splice(i, 1); sceneChanged(`keyframe ${i + 1} deleted`) }
function moveKey(i: number, j: number) { if (!sceneDoc || i === j) return; mark('reorder keyframes', true); const [k] = sceneDoc.keyframes.splice(i, 1); sceneDoc.keyframes.splice(j, 0, k); sceneChanged(`keyframe ${i + 1} → ${j + 1}`); goToKey(j) }
function setKeyView(i: number, on: boolean) {
  if (!sceneDoc) return; mark(on ? 'camera at keyframe' : 'clear keyframe camera', true);
  if (on) sceneDoc.keyframes[i].view = camOf(); else delete sceneDoc.keyframes[i].view;
  sceneChanged(on ? `camera set at keyframe ${i + 1}: the view moves to it during the transition before, and holds through it` : `keyframe ${i + 1} follows the previous camera again`);
}

/* ---------- changes to the next keyframe, drawn over the frame while the timeline is hovered ---------- */
let showChanges = false; let hoverChanges = false; let diffNote = '';
function projectNow() { const E = classic(); E.cfg = cfgFromStyle(style, R.camera, true); return E.projectFrame(R.w / dpr, R.h / dpr, frame) }
function drawOverlay() {
  ovCanvas.width = R.w; ovCanvas.height = R.h; ovCtx.clearRect(0, 0, R.w, R.h);
  if (!sceneDoc) return;
  const want = showChanges || hoverChanges || pendingTail || authorMode !== 'off';
  if (!(showChanges || hoverChanges)) diffNote = '';
  if (!want) { panel.refreshAuthor?.(); return }
  const { st, proj } = projectNow();
  if (showChanges || hoverChanges) { const d: KeyDiff | null = keyDiff(sceneDoc, st.kf); if (d) { drawDiff(ovCtx, d, st, proj, dpr, proj.pxPerA); diffNote = `to keyframe ${(st.kf + 1) % sceneDoc.keyframes.length + 1}: ${diffSummary(d)}` } else diffNote = '' }
  if (pendingTail) { const p = anchorScreen(pendingTail, st, proj); if (p) { ovCtx.save(); ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0); ovCtx.beginPath(); ovCtx.arc(p[0], p[1], 9, 0, Math.PI * 2); ovCtx.strokeStyle = '#f97316'; ovCtx.lineWidth = 2; ovCtx.stroke(); ovCtx.restore() } }
  if (hoverHit) { ovCtx.save(); ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0); ovCtx.beginPath(); ovCtx.arc(hoverHit.x, hoverHit.y, hoverHit.kind === 'atom' ? 8 : 6, 0, Math.PI * 2); ovCtx.strokeStyle = 'rgba(249,115,22,.7)'; ovCtx.lineWidth = 1.5; ovCtx.setLineDash([3, 3]); ovCtx.stroke(); ovCtx.restore() }
  panel.refreshAuthor?.();
}
function setShowChanges(v: boolean) { showChanges = v; drawOverlay() }
function setHoverChanges(v: boolean) { hoverChanges = v; drawOverlay() }

/* ---------- authoring: arrows, lone pairs and charges by clicking the drawing ---------- */
type AuthorMode = 'off' | 'arrow' | 'lp' | 'charge';
let authorMode: AuthorMode = 'off'; let pendingTail: Anchor | null = null; let hoverHit: Hit = null;
function setAuthorMode(m: AuthorMode) { authorMode = m; pendingTail = null; hoverHit = null; stage.classList.toggle('author', m !== 'off'); drawOverlay() }
function authorText(): string {
  if (!sceneDoc) return 'load a scene first';
  const k = currentKey() + 1;
  if (authorMode === 'off') return '';
  if (authorMode === 'lp') return `keyframe ${k}: click an atom to give it a lone pair (away from its bonds); click again to remove it`;
  if (authorMode === 'charge') return `keyframe ${k}: click an atom to cycle its charge: none → + → − → none`;
  return pendingTail ? `keyframe ${k}: tail at ${anchorText(pendingTail)} — now click the head: an atom, or the middle of a bond (Esc cancels)` : `keyframe ${k}: click the tail — an atom (its lone pair if it has one) or the middle of a bond`;
}
function toHold() { // edits apply to a keyframe's own state: in a transition, step back to the keyframe's hold
  if (!sceneDoc) return false; const { seg } = classic().locate(frame); if (seg.type !== 'trans') return true;
  const hold = timeline().segs.find(s => s.kf === seg.kf && s.type === 'hold'); if (hold) { setFrame(hold.start + Math.floor(hold.len * 0.9 / 2) * 2); status('moved to the keyframe: edits apply to a keyframe, not to a transition') } return !!hold;
}
function authorClick(x: number, y: number) {
  if (!sceneDoc || authorMode === 'off') return; if (!toHold()) return;
  const { st, proj } = projectNow(); const K = sceneDoc.keyframes[st.kf];
  const h = hitTest(st, proj, x, y, proj.pxPerA, style.stickRadius); if (!h) { status('nothing under the pointer'); return }
  if (authorMode === 'lp') { if (h.kind !== 'atom') return; mark('lone pair', true); const m = toggleLonePair(K, h.id); sceneChanged(`keyframe ${st.kf + 1}: ${m}`); return }
  if (authorMode === 'charge') { if (h.kind !== 'atom') return; mark('charge', true); const m = cycleCharge(K, h.id); sceneChanged(`keyframe ${st.kf + 1}: ${m}`); return }
  if (!pendingTail) { pendingTail = anchorFor(K, h, true); drawOverlay(); return }
  const head = anchorFor(K, h, false); mark('arrow', true);
  let cx = 0, cy = 0, n = 0; for (const a of st.atoms) { const p = proj.proj(a.pos); cx += p.x; cy += p.y; n++ } if (n) { cx /= n; cy /= n }
  addArrow(K, pendingTail, head, an => anchorScreen(an, st, proj), [cx, cy]);
  const t = anchorText(pendingTail); pendingTail = null; sceneChanged(`keyframe ${st.kf + 1}: arrow ${t} → ${anchorText(head)} (${K.arrows.length} arrow${K.arrows.length > 1 ? 's' : ''}; flip its side in the list if it bows the wrong way)`);
}
function arrowsOf(): { j: number; text: string; side: number; bulge: number }[] {
  if (!sceneDoc) return []; const K = sceneDoc.keyframes[currentKey()];
  return (K.arrows || []).map((ar: any, j: number) => ({ j, text: `${anchorText(ar.from)} → ${anchorText(ar.to)}`, side: ar.side ?? 1, bulge: ar.bulge ?? 0.4 }));
}
function editArrow(j: number, what: 'flip' | 'delete' | 'bulge', v?: number) {
  if (!sceneDoc) return; const K = sceneDoc.keyframes[currentKey()]; const ar = K.arrows?.[j]; if (!ar) return;
  mark(what + ' arrow', true);
  if (what === 'flip') ar.side = -(ar.side ?? 1); else if (what === 'bulge') ar.bulge = v; else K.arrows.splice(j, 1);
  sceneChanged(`keyframe ${currentKey() + 1}: arrow ${j + 1} ${what === 'delete' ? 'deleted' : what === 'flip' ? 'flipped' : 'bows ' + v}`);
}
{ // clicks on the drawing while authoring (a drag still turns the view)
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } });
  canvas.addEventListener('pointerup', e => { if (down && authorMode !== 'off' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const r = canvas.getBoundingClientRect(); authorClick(e.clientX - r.left, e.clientY - r.top) } down = null });
  canvas.addEventListener('pointermove', e => { if (authorMode === 'off' || !sceneDoc || controls.dragging) return; const r = canvas.getBoundingClientRect(); const { st, proj } = projectNow(); const h = hitTest(st, proj, e.clientX - r.left, e.clientY - r.top, proj.pxPerA, style.stickRadius); if ((h && !hoverHit) || (!h && hoverHit) || (h && hoverHit && (h.kind !== hoverHit.kind || (h as any).id !== (hoverHit as any).id || (h as any).a !== (hoverHit as any).a))) { hoverHit = h; drawOverlay() } });
  canvas.addEventListener('pointerleave', () => { if (hoverHit) { hoverHit = null; drawOverlay() } });
}

/* ---------- suggest views ---------- */
async function suggest(onProgress: (msg: string) => void): Promise<ViewSuggestion[]> {
  if (!sceneDoc) return [];
  const E = classic(); E.cfg = cfgFromStyle(style, R.camera, true);
  onProgress('scoring 120 orientations…'); await new Promise(r => setTimeout(r, 10));
  const frames = holdFrames(E); const picks = suggestViews(E, sceneDoc, R.w / dpr, R.h / dpr, frames, 12, previewAspect ? Math.max(0.6, Math.min(2.2, previewAspect * 0.8)) : 1.4);
  const w = 224, h = 140; const f = frames[Math.min(frames.length - 1, Math.max(0, Math.round(frames.length * (frame / Math.max(1, timeline().total)))))];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i]; onProgress(`drawing ${i + 1} / ${picks.length}…`); await new Promise(r => setTimeout(r, 0));
    const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const cam = { yaw: p.yaw, pitch: p.pitch, roll: p.roll, zoom: 1, panX: 0, panY: 0, fov: R.camera.fov };
    const cfg = cfgFromStyle(style, cam, true); cfg.show = { ...cfg.show, caption: false, stepLabel: false, labels: false, resLabels: false }; cfg.style = { ...cfg.style, grain: 0 }; cfg.rep = { ...cfg.rep, detail: 'auto' };
    // fit this frame's atoms into the thumbnail (the scene's own fit spans every keyframe, parked waters included)
    for (let it = 0; it < 2; it++) { E.cfg = { ...cfg, view: { ...cfg.view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY } }; const { st, proj } = E.projectFrame(w, h, f); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const a of st.atoms) { if (a.alpha < 0.3) continue; const q = proj.proj(a.pos); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y) }
      if (x1 > x0) { cam.zoom *= Math.min(0.82 * w / (x1 - x0 + 1), 0.82 * h / (y1 - y0 + 1)); E.cfg = { ...cfg, view: { ...cfg.view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY } }; const r2 = E.projectFrame(w, h, f); let a0 = 1e9, b0 = 1e9, a1 = -1e9, b1 = -1e9; for (const a of r2.st.atoms) { if (a.alpha < 0.3) continue; const q = r2.proj.proj(a.pos); a0 = Math.min(a0, q.x); a1 = Math.max(a1, q.x); b0 = Math.min(b0, q.y); b1 = Math.max(b1, q.y) } cam.panX += (w / 2 - (a0 + a1) / 2) / w; cam.panY += (h / 2 - (b0 + b1) / 2) / h } }
    E.cfg = { ...cfg, view: { ...cfg.view, zoom: cam.zoom, panX: cam.panX, panY: cam.panY } }; E.renderFrame(ctx, w, h, f, 2); p.canvas = c;
  }
  E.cfg = cfgFromStyle(style, R.camera, true); onProgress('');
  return picks;
}
function adoptView(v: ViewSuggestion) { mark('suggested view'); R.camera.yaw = v.yaw; R.camera.pitch = v.pitch; R.camera.roll = v.roll; if (guideBox) fitFrame(guideBox, 'all'); panel.refresh(); invalidate(); status(`view: yaw ${v.yaw}, pitch ${v.pitch}, roll ${v.roll.toFixed(0)}` + (guideBox ? ' · fitted to the frame' : '')) }

/* ---------- render from the app ---------- */
let renderSize: [number, number] | null = null;   // the output size the Render section has chosen (also the CLI command's --size and the preview's aspect)
let renderCancel = false;
function drawFrameTo(ctx: CanvasRenderingContext2D, W: number, H: number, f: number) {
  const E = classic(); const drawn = Math.floor(f / 2) * 2;
  let cam: any = { ...camOf(), fov: R.camera.fov };
  if (sceneDoc && sceneDoc.keyframes.some(k => k.view)) { E.cfg = cfgFromStyle(style, cam, true); const v = E.viewAt(drawn); if (v) cam = { ...v, fov: R.camera.fov } }
  E.cfg = cfgFromStyle(style, cam, !!sceneDoc); if (sceneDoc) { if (E.scene !== sceneDoc) E.scene = sceneDoc } else E.scene = sceneFromStructure(R.structure!, style, R.overrides, R.camera.base, R.fitPoints);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.restore();
  E.renderFrame(ctx, W, H, f, 1);
}
async function renderToFile(o: { width: number; height: number; codec: CodecName; quality: Quality; onProgress: (done: number, total: number, bytes: number, eta: number) => void }): Promise<{ name: string; bytes: number; seconds: number; codecString: string }> {
  const frames: number[] = []; if (sceneDoc) { for (let f = 0; f < timeline().total; f += 2) frames.push(f) } else for (let f = 0; f < 24; f += 2) frames.push(f);
  const name = (sceneDoc?.name || R.structure?.name || 'triad-sketch').replace(/[^\w.-]+/g, '_'); renderCancel = false; const t0 = performance.now();
  const wasLive = live; live = false; sketchOn = false;   // no on-screen sketches while the engine is busy with the file
  try {
    const res = await renderVideo({ width: o.width, height: o.height, fps: FPS / 2, codec: o.codec, quality: o.quality, frames, draw: drawFrameTo, cancelled: () => renderCancel, onProgress: (d, n, b) => { const el = (performance.now() - t0) / 1000; o.onProgress(d, n, b, d ? el / d * (n - d) : 0) } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(res.blob); a.download = `${name}.${res.ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return { name: a.download, bytes: res.bytes, seconds: res.seconds, codecString: res.codecString };
  } finally { live = wasLive; sketchOn = restMode !== 'preview'; classic().cfg = cfgFromStyle(style, R.camera, !!sceneDoc); if (sceneDoc) classic().scene = sceneDoc; invalidate() }
}
function savePoster(width: number, height: number, f = frame, type: 'image/jpeg' | 'image/png' = 'image/jpeg') {
  const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d', { willReadFrequently: true })!; drawFrameTo(ctx, width, height, f);
  const name = (sceneDoc?.name || R.structure?.name || 'triad-sketch').replace(/[^\w.-]+/g, '_');
  const a = document.createElement('a'); a.href = c.toDataURL(type, 0.86); a.download = `${name}_${sceneDoc ? 'frame' + f : 'poster'}.${type === 'image/png' ? 'png' : 'jpg'}`; a.click();
  classic().cfg = cfgFromStyle(style, R.camera, !!sceneDoc); if (sceneDoc) classic().scene = sceneDoc; invalidate();
}
/** The frame with the arrows of the first keyframe fully drawn: the natural poster. */
function posterFrame(): number { if (!sceneDoc) return 0; const h = timeline().segs.find(s => s.type === 'hold'); return h ? h.start + Math.floor(h.len * 0.9 / 2) * 2 : 0 }

/* panel */
function applyLook(key: string) {
  const L = LOOKS[key]; if (!L) return; mark('look ' + L.name); currentLook = key;
  const keep = { reps: style.reps }; style = mergeStyle(DEFAULT_STYLE, L.style); if (!L.style.reps) style.reps = keep.reps;
  panel.refresh(); rebuild();
}
const panel = buildPanel(document.getElementById('controls')!, {
  get style() { return style }, set style(v) { style = v },
  looks: LOOKS, currentLook: () => currentLook, applyLook,
  rebuild, redraw, camera: R.camera, mark, settle: () => history.settle(),
  onLive: v => { live = v; invalidate() }, onTurntable: v => { turntable = v; invalidate() }, onPitchSwing: v => { pitchSwing = v },
  onRest: (v: string) => { restMode = v as RestMode; sketchOn = v !== 'preview'; invalidate() },
  renderNow: () => { R.render(style); runSketch('classic'); hud.textContent = `classic ${sketchStats.drawMs.toFixed(0)} ms · ${R.w}×${R.h}` },
  savePng: () => { const a = document.createElement('a'); a.href = snapshot(); a.download = `${R.structure?.name || 'triad-sketch'}.png`; a.click() },
  saveStyle: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(style, null, 1)); a.download = 'triad-sketch-style.json'; a.click() },
  loadStyle: async (f: File) => { mark('load style'); style = mergeStyle(DEFAULT_STYLE, JSON.parse(await f.text())); panel.refresh(); rebuild() },
  loadFile: async (f: File) => { await loadText(await f.text(), f.name) }, loadFiles,
  saveScene: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(sceneJson()); a.download = (sceneDoc?.name || R.structure?.name || 'scene') + '.json'; a.click() },
  loadExample: (name: string) => loadUrl('examples/' + name).catch(e => status(e.message)),
  play: (v: boolean) => { playing = v }, isPlaying: () => playing, seek: (f: number) => { playing = false; setFrame(f) }, step: (d: number) => { playing = false; setFrame(frame + d) },
  reset: () => { mark('reset style'); style = cloneStyle(DEFAULT_STYLE); panel.refresh(); rebuild() },
  setDpr: (v: number) => { dpr = v; fit() },
  palettes: PALETTES,
  framePresets: FRAME_PRESETS, fitFrame: (b, w) => { mark('fit to frame'); fitFrame(b, w) }, showGuides, renderCommand, canvasSize: () => [R.w, R.h] as [number, number],
  groupPalettes: GROUP_PALETTES, groups, groupColor, setGroupColor, hasOverride: (k: string) => !!R.overrides[k],
  // history
  undo: () => { const l = history.back(); status(l ? 'undo: ' + l : 'nothing to undo') }, redo: () => { const l = history.forward(); status(l ? 'redo: ' + l : 'nothing to redo') },
  historyState: () => ({ undo: history.canUndo ? history.nextUndo : '', redo: history.canRedo ? history.nextRedo : '' }),
  // keyframes
  fps: FPS, hasScene: () => !!sceneDoc, keyframes, currentKey, loopSeconds, setKeyTiming, setKeyName, goToKey, duplicateKey, deleteKey, moveKey, setKeyView,
  setShowChanges, setHoverChanges, diffNote: () => diffNote,
  // authoring
  setAuthorMode: (m: string) => setAuthorMode(m as AuthorMode), authorMode: () => authorMode, authorText, arrowsOf, editArrow,
  // checks
  lint: () => lintItems, relint,
  // views
  suggest, adoptView,
  // render
  hasWebCodecs, codecSupport, renderToFile, cancelRender: () => { renderCancel = true }, savePoster, posterFrame, setRenderSize: (s: [number, number] | null) => { const a = s ? s[0] / s[1] : null; if (a === previewAspect && (s ? renderSize && s[0] === renderSize[0] && s[1] === renderSize[1] : !renderSize)) return; renderSize = s; setPreviewAspect(a) }, drawnFrames: () => sceneDoc ? Math.ceil(timeline().total / 2) : 12,
});

/** PNG of what is on screen: the sketch when it is shown, else the GPU frame */
function snapshot() { if (sketchShown) return skCanvas.toDataURL('image/png'); R.render(style); return R.toDataURL() }

/* keyboard transport: space plays, , and . step a drawn frame */
window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.tagName === 'INPUT' || !sceneDoc || e.ctrlKey || e.metaKey) return; if (e.key === ' ') { e.preventDefault(); playing = !playing } else if (e.key === ',') setFrame(frame - 2); else if (e.key === '.') setFrame(frame + 2) });

/* render loop: the GPU preview draws whenever something changed; once the view has rested, the sketch pass draws the real thing on the overlay.
   With breathing on, the sketch is redrawn with a new boil seed every so often. */
let lastT = performance.now(); let lastSketchAt = 0; let playAcc = 0;
function loop(t: number) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (playing && sceneDoc) { playAcc += dt * FPS; if (playAcc >= 2) { playAcc -= 2; setFrame(frame + 2); if (restMode === 'classic' && sceneFast) { dirty = false; R.render(style); runSketch('classic') } } }
  if (turntable) { R.camera.yaw = (R.camera.yaw + turntable * dt) % 360; if (pitchSwing) R.camera.pitch = pitchSwing * Math.sin(R.camera.yaw * Math.PI / 180); invalidate() }
  if (!sketchOn && live && t - lastLive > 1000 / 10) { lastLive = t; dirty = true }
  if (dirty) { dirty = false; R.render(style); hud.textContent = `preview ${R.stats.frameMs.toFixed(1)} ms · ${R.w}×${R.h} · yaw ${R.camera.yaw.toFixed(0)}° pitch ${R.camera.pitch.toFixed(0)}°${R.camera.roll ? ' roll ' + R.camera.roll.toFixed(0) + '°' : ''} · zoom ${R.camera.zoom.toFixed(2)} pan ${R.camera.panX.toFixed(2)}, ${R.camera.panY.toFixed(2)}${sceneDoc ? ` · ${(frame / FPS).toFixed(2)} s` : ''}` }
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
{ const seq = loadSeq; fetch('examples/test_protein.pdb').then(r => r.text()).then(t => { if (loadSeq === seq) loadText(t, 'test_protein.pdb') }).catch(e => status(e.message)) }

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
  fitFrame, screenBox: (what: 'all' | 'frame' = 'all') => R.camera.screenBox(R.w, R.h, framePoints(what)), framePresets: FRAME_PRESETS, renderCommand,
  history, lint: () => lintItems, suggest, adoptView, renderToFile, drawFrameTo, keyframes, setKeyView, setKeyTiming, duplicateKey, deleteKey, moveKey, setAuthorMode, authorClick, arrowsOf, editArrow, keyDiff: (i: number) => sceneDoc ? keyDiff(sceneDoc, i) : null, setPreviewAspect, projectNow,
};
