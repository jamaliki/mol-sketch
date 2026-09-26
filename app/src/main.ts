/* App entry: renderer + orbit controls + panel. Also exposes window.MolSketch for scripts and the CLI. */
import { Renderer } from './render/renderer';
import { parseStructure } from './model/parse';
import { DEFAULT_STYLE, PALETTES, cloneStyle, mergeStyle, type Style } from './style';
import { LOOKS } from './looks';
import { GROUP_PALETTES } from './palettes';
import { GROUP_PALETTE } from './model/color';
import { buildPanel } from './app/panel';
import { OrbitControls } from './app/controls';
import { drawSketch } from './ink/sketch';
import { renderClassic, renderScene, classic, sceneFromStructure, cfgFromStyle, mapBasis, mapLevel } from './classic/adapter';
import { parseMRC, downsample, sampleMap, type DensityMap } from './model/map';
import { pcaBasis } from './render/renderer';
import { sceneFitPoints, structureFromState, type SceneDoc } from './classic/scene';
import { History, type Snapshot } from './app/history';
import { lintScene, lintSummary, type LintItem } from './app/lint';
import { keyDiff, drawDiff, diffSummary, type KeyDiff } from './app/diff';
import { hitTest, anchorFor, anchorText, addArrow, anchorScreen, toggleLonePair, cycleCharge, type Anchor, type Hit } from './app/author';
import { suggestViews, holdFrames, type ViewSuggestion } from './app/views';
import { connect, InputSync, type SDK } from './app/sdk';
import type { FigureSpec } from './headless/core';
import { pocketSel as sitePocket, frameSite as siteFrame, labelSite as siteLabel, type SiteHost } from './app/site';
import { renderVideo, codecSupport, hasWebCodecs, fmtBytes, type CodecName, type Quality } from './app/encode';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const skCanvas = document.getElementById('sk') as HTMLCanvasElement; const skCtx = skCanvas.getContext('2d', { willReadFrequently: true })!;   // CPU-backed: the classic engine composites huge offscreen canvases, which GPU canvases can drop silently
const ovCanvas = document.getElementById('ov') as HTMLCanvasElement; const ovCtx = ovCanvas.getContext('2d')!;   // overlays: change highlights, authoring marks
const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!; if (!new URLSearchParams(location.search).has('debug')) hud.style.display = 'none';   // timings: ?debug

let style: Style = cloneStyle(DEFAULT_STYLE);
try { const s = localStorage.getItem('triad-sketch-style'); if (s) style = mergeStyle(DEFAULT_STYLE, JSON.parse(s)) } catch { }

const R = new Renderer(canvas);
let dpr = Math.min(2, window.devicePixelRatio || 1);
let live = true; let turntable = 0; let pitchSwing = 0; let dirty = true; let lastLive = 0; let currentLook = 'watercolour';
type RestMode = 'preview' | 'sketch' | 'classic';
let restMode: RestMode = 'classic';   // what is drawn once the view rests: the fast hybrid sketch or the exact classic engine
let sketchOn = true;
let classicMs = Infinity;   // the last classic drawing's cost; when it is small the classic engine also draws while you drag, so what you see moving is the final look
let lastChange = 0; let sketchShown = false; let boil = 0; let sketchStats = { readMs: 0, regionMs: 0, drawMs: 0, regions: 0 };
function invalidate() { dirty = true; lastChange = performance.now(); sdkSeq++; if (sketchShown) { sketchShown = false; skCanvas.classList.remove('on') } drawOverlay() }
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
  if (doc.look && LOOKS[doc.look]) { const reps = style.reps; style = mergeStyle(DEFAULT_STYLE, LOOKS[doc.look].style); if (!LOOKS[doc.look].style.reps) style.reps = reps; currentLook = doc.look }   // a scene can name its look
  if (doc.site) style.site = { ...style.site, ...doc.site };
  if (doc.reps) style.reps = { ...doc.reps }; R.overrides = { ...(doc.groupColors || {}) }; R.labels = (doc.labels || []).map((l: any) => ({ ...l })); selLabel = -1;
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
  doc.reps = { ...style.reps }; doc.groupColors = { ...R.overrides }; doc.labels = R.labels.map(l => ({ ...l })); if (style.site.sel.trim()) doc.site = { ...style.site }; else delete doc.site; doc.look = currentLook; delete doc.fitPoints;
  doc.view = { yaw: R.camera.yaw, pitch: R.camera.pitch, roll: R.camera.roll, zoom: R.camera.zoom, panX: R.camera.panX, panY: R.camera.panY, fov: R.camera.fov, fog: style.view.fog, fogStart: style.view.fogStart };
  return JSON.stringify(doc, null, 1);
}
/* ---------- the SDK: when molsketch serve runs, it draws the exact frames (the same engine as the Python package) ---------- */
let sdk: SDK | null = null; let inputs: InputSync | null = null; let sdkSeq = 0; let sdkBusy = false; let sdkAgain = false;
const sdkReady = connect().then(s => { sdk = s; if (s) { inputs = new InputSync(s); classicMs = Infinity; status(`drawing with molsketch ${s.version} (${s.url})`); invalidate() } return s });
/** the current figure as the SDK's FigureSpec: the full style, the camera, labels, group colours, frame, size */
async function figureSpec(W: number, H: number, scale: number, f: number, cam?: any): Promise<FigureSpec> {
  let ref: string;
  const mref = await mapRefOnSdk();
  if (sceneDoc) { const json = sceneJsonForSdk(); ref = await inputs!.get(json, () => ({ scene: JSON.parse(json) })) }   // a scene: again whenever it is edited (undo included)
  else if (structureText) ref = await inputs!.get(structureText, () => structureText);
  else ref = '';
  const c = cam || camOf();
  return { input: ref ? { ref } : { map: mref! }, ...(mref && ref ? { map: { ref: mref } } : {}), styleFile: JSON.parse(JSON.stringify(style)), camera: { yaw: c.yaw, pitch: c.pitch, roll: c.roll, zoom: c.zoom, panX: c.panX, panY: c.panY, fov: R.camera.fov },
    labels: R.labels.map(l => ({ ...l })), groupColors: { ...R.overrides }, size: [W, H], scale, frame: f };
}
/** a scene as the SDK gets it: its keyframes and settings (labels, colours and camera come with each spec) */
function sceneJsonForSdk() { const d: any = { ...sceneDoc }; delete d.fitPoints; delete d._rev; return JSON.stringify(d) }
function runSketch(mode: RestMode = restMode) {
  if (mode === 'classic' && sdk && (sceneDoc || structureText || mapObj)) { runSketchSdk(); return }
  skCanvas.width = R.w; skCanvas.height = R.h;
  if (mode === 'classic' && sceneDoc) { const ms = renderScene(skCtx, R, style, sceneDoc, frame, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 }; sceneFast = ms < 90; classicMs = ms }
  else if (mode === 'classic') { const ms = renderClassic(skCtx, R, style, boil, dpr); sketchStats = { readMs: 0, regionMs: 0, drawMs: ms, regions: 0 }; classicMs = ms }
  else sketchStats = drawSketch(skCtx, R, style, boil);
  sketchShown = true; skCanvas.classList.add('on'); drawOverlay();
}

/* the canvas fills the stage, or keeps the output's aspect inside it (letterboxed), so a fit made here is the fit of the video */
let previewAspect: number | null = null;   // null: free
let fixedSize: [number, number] | null = null;   // a script (the CLI) set the canvas size: the window no longer changes it
function fit() {
  if (fixedSize) return;
  let cw = stage.clientWidth, ch = stage.clientHeight, left = 0, top = 0;
  if (previewAspect) { if (cw / ch > previewAspect) { const w = Math.floor(ch * previewAspect); left = Math.floor((cw - w) / 2); cw = w } else { const h = Math.floor(cw / previewAspect); top = Math.floor((ch - h) / 2); ch = h } }
  for (const c of [canvas, skCanvas, ovCanvas]) { c.style.left = left + 'px'; c.style.top = top + 'px'; c.style.width = cw + 'px'; c.style.height = ch + 'px' }
  const w = Math.max(64, Math.floor(cw * dpr)), h = Math.max(64, Math.floor(ch * dpr)); R.resize(w, h); invalidate(); showGuides(guideBox);
}
new ResizeObserver(() => fit()).observe(stage);   // the window, and the timeline showing or hiding
function setPreviewAspect(a: number | null) { previewAspect = a; fit() }

function save() { try { localStorage.setItem('triad-sketch-style', JSON.stringify(style)) } catch { } }
function margins() { R.camera.capFrac = sceneDoc && style.show.caption ? 0.13 : 0; R.camera.topFrac = sceneDoc && style.show.stepLabel ? 0.05 : 0 }
function rebuild() { margins(); R.rebuild(style); invalidate(); save(); status() }
function redraw() { margins(); invalidate(); save() }

/* undo: snapshots of style, camera, colour overrides and (for keyframe edits) the keyframes */
const history = new History(
  (withScene): Snapshot => ({ label: '', at: performance.now(), style: JSON.stringify(style), cam: [R.camera.yaw, R.camera.pitch, R.camera.roll, R.camera.zoom, R.camera.panX, R.camera.panY, R.camera.fov], overrides: JSON.stringify(R.overrides), labels: JSON.stringify(R.labels), keyframes: withScene && sceneDoc ? JSON.stringify(sceneDoc.keyframes) : null, frame }),
  (s) => {
    style = mergeStyle(DEFAULT_STYLE, JSON.parse(s.style)); const c = s.cam; R.camera.yaw = c[0]; R.camera.pitch = c[1]; R.camera.roll = c[2]; R.camera.zoom = c[3]; R.camera.panX = c[4]; R.camera.panY = c[5]; R.camera.fov = c[6]; R.overrides = JSON.parse(s.overrides); R.labels = JSON.parse(s.labels || '[]'); selLabel = -1; closeLabelEditor(false);
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
  const info = document.getElementById('fileinfo');
  if (info) { info.textContent = s ? `${s.count.toLocaleString()} atoms · ${s.residues.length.toLocaleString()} residues · ${s.chains.length} chain${s.chains.length === 1 ? '' : 's'}` : mapObj ? 'density map' : '';
    info.title = s ? `${st.instances.toLocaleString()} instances, ${st.triangles.toLocaleString()} triangles, built in ${st.buildMs.toFixed(0)} ms` : '' }
  if (msg) toast(msg);
}
/** a message that shows over the drawing for a few seconds */
let toastTimer = 0;
function toast(msg: string) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('on'), 4000) }

let loadSeq = 0;   // every load bumps it; the start-up example only lands if nothing else loaded meanwhile
let structureText: { text: string; name: string } | null = null;   // the loaded structure's file, for the SDK
async function loadText(text: string, name: string) {
  loadSeq++; const t0 = performance.now();
  if (/\.json$/i.test(name) || /^\s*\{/.test(text)) { loadScene(JSON.parse(text), name.replace(/\.json$/i, '')); return }
  sceneDoc = null; structureText = { text, name }; R.fitOverride = null; R.camera.capFrac = 0; R.camera.topFrac = 0; R.overrides = {}; R.labels = []; selLabel = -1; lintItems = []; history.clear();
  const s = parseStructure(text, name.replace(/\.(pdb|ent|cif|mmcif)$/i, ''));
  R.setStructure(s); R.camera.yaw = 0; R.camera.pitch = 0; R.camera.roll = 0; R.camera.zoom = 1; R.camera.panX = 0; R.camera.panY = 0;
  const hasPoly = s.residues.some(r => !r.het);
  if (!hasPoly) { style.reps = { sticks: 'all', cartoon: '', surface: '' } }
  rebuild(); panel.refresh(); panel.refreshChecks?.(); status(`parsed in ${(performance.now() - t0).toFixed(0)} ms`);
}
/** an entry from the PDB by its four-character ID, as mmCIF (every entry has one; the large ones have no .pdb) */
async function fetchPdb(id: string) {
  id = id.trim().toUpperCase(); if (!/^[0-9][A-Z0-9]{3}$/.test(id)) throw new Error(`"${id}" is not a PDB ID: four characters, starting with a digit, e.g. 1A8O`);
  status(`fetching ${id} from RCSB…`); let r: Response;
  try { r = await fetch(`https://files.rcsb.org/download/${id}.cif`) } catch { throw new Error(`could not reach RCSB for ${id}: check the connection`) }
  if (!r.ok) throw new Error(r.status === 404 ? `${id} is not in the PDB` : `RCSB answered ${r.status} for ${id}`);
  await loadText(await r.text(), id + '.cif'); status(`${id} fetched from RCSB`);
}
/* ---------- density maps: an MRC / CCP4 file, an EMDB entry, or the map a PDB entry was built into ---------- */
let mapObj: DensityMap | null = null; let mapRaw: { bytes: ArrayBuffer; name: string; level?: number; mass?: number; resolution?: number } | null = null;
let mapRef: string | null = null; let mapRefFor: any = null;
const isMapName = (n: string) => /\.(map|mrc|ccp4)(\.gz)?$/i.test(n);
async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf); if (u[0] !== 0x1f || u[1] !== 0x8b) return buf;
  return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
/** a map's file (gzipped or not) → the figure's map; `meta`: what EMDB says of it (recommended level, mass, resolution) */
async function loadMapBytes(bytes: ArrayBuffer, name: string, meta: { level?: number; mass?: number; resolution?: number } = {}) {
  status(`reading ${name}…`); const t0 = performance.now();
  let m = parseMRC(await gunzip(bytes), name.replace(/\.(map|mrc|ccp4)(\.gz)?$/i, ''));
  const big = Math.max(m.nx, m.ny, m.nz); if (big > 320) m = downsample(m, 320);   // as molsketch.read_map does
  if (meta.level != null) m.level = meta.level; if (meta.mass) m.mass = meta.mass; if (meta.resolution) m.resolution = meta.resolution;
  mark('load map'); mapObj = m; mapRaw = { bytes, name, ...meta }; mapRef = null; R.map = m;
  if (!R.structure && !sceneDoc) { R.camera.base = mapBasis(m, mapLevel(m, style)); R.camera.yaw = 0; R.camera.pitch = 0; R.camera.roll = 0; R.camera.zoom = 1; R.camera.panX = 0; R.camera.panY = 0 }
  rebuild(); panel.refresh(); status(`${m.name}: ${m.nx}×${m.ny}×${m.nz} at ${m.step[0].toFixed(2)} Å${m.binned && m.binned > 1 ? ` (averaged ${m.binned}×)` : ''}${m.level != null ? `, recommended level ${m.level}` : ''} · read in ${(performance.now() - t0).toFixed(0)} ms`);
}
/** drop the structure (a map is then drawn on its own) */
function unloadStructure(why: string) {
  sceneDoc = null; structureText = null; R.fitOverride = null; R.labels = []; selLabel = -1; R.setStructure(null); inputs = sdk ? new InputSync(sdk) : null;
  status(why ? `showing the map on its own (${why}; open that entry to see the model in it)` : 'showing the map on its own');
}
function clearMap() { mark('remove map'); mapObj = null; mapRaw = null; mapRef = null; R.map = null; rebuild(); panel.refresh(); status('map removed') }
/** an EMDB entry's primary map, with the depositors' recommended contour level and the sample's mass */
async function fetchEmdb(key: string) {
  const m = key.trim().match(/^(?:emd[-_]?)?(\d{4,6})$/i); if (!m) throw new Error(`"${key}" is not an EMDB ID, e.g. EMD-11638`);
  const id = `EMD-${m[1]}`; status(`fetching ${id} from EMDB…`);
  const e = await (await fetch(`https://www.ebi.ac.uk/emdb/api/entry/${id}`)).json().catch(() => { throw new Error(`EMDB has no entry ${id}`) });
  const cs = e?.map?.contour_list?.contour || []; const prim = cs.find((c: any) => c.primary) || cs[0];
  const sup = e?.sample?.supramolecule_list?.supramolecule?.[0]?.molecular_weight?.theoretical; const unit: Record<string, number> = { MDa: 1e6, kDa: 1e3, Da: 1 };
  const mass = sup?.valueOf_ ? +sup.valueOf_ * (unit[sup.units] ?? 1e6) : undefined;
  let resolution: number | undefined; try { for (const sd of e.structure_determination_list.structure_determination) for (const ip of sd.image_processing) { const r = ip?.final_reconstruction?.resolution; if (r?.valueOf_) { resolution = +r.valueOf_; break } } } catch { }
  // the structure stays only if it is one of the models built into this map; anything else would be drawn in the wrong place
  const fitted: string[] = (e?.crossreferences?.pdb_list?.pdb_reference || []).map((p: any) => String(p.pdb_id).toUpperCase());
  if (R.structure && !fitted.includes((R.structure.name || '').toUpperCase())) unloadStructure(fitted.length ? `${id} was built as ${fitted.join(', ')}` : '');
  const url = `https://ftp.ebi.ac.uk/pub/databases/emdb/structures/${id}/map/emd_${m[1]}.map.gz`;
  await loadMapBytes(await download(url, id), id, { level: prim?.level != null ? +prim.level : undefined, mass, resolution });
}
/** a large file, with its progress in the status line, kept in the browser's cache so it downloads once */
async function download(url: string, what: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null; try { cache = await caches.open('molsketch-maps') } catch { }
  const hit = cache && await cache.match(url).catch(() => undefined); if (hit) { status(`${what}: from the cache`); return hit.arrayBuffer() }
  const r = await fetch(url); if (!r.ok || !r.body) throw new Error(`EMDB answered ${r.status} for ${what}`);
  const total = +(r.headers.get('content-length') || 0), parts: Uint8Array[] = [], rd = r.body.getReader(); let got = 0, last = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length;
    if (performance.now() - last > 400) { last = performance.now(); status(`downloading ${what}: ${(got / 1e6).toFixed(0)}${total ? ` of ${(total / 1e6).toFixed(0)}` : ''} MB`) } }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length }
  if (cache) cache.put(url, new Response(buf.slice())).catch(() => { });
  return buf.buffer;
}
/** the map the loaded PDB entry was built into, found through RCSB */
async function mapForEntry() {
  const name = (R.structure?.name || '').toUpperCase(); if (!/^[0-9][A-Z0-9]{3}$/.test(name)) throw new Error('load a PDB entry by its ID first (Open › PDB ID), so its EMDB map can be found');
  const d = await (await fetch(`https://data.rcsb.org/rest/v1/core/entry/${name}`)).json();
  const ids = d?.rcsb_entry_container_identifiers?.emdb_ids || []; if (!ids.length) throw new Error(`${name} has no EMDB map (it is not a cryo-EM structure)`);
  await fetchEmdb(ids[0]);
}
function mapInfo() {
  const m = mapObj; if (!m) return null; const lv = mapLevel(m, style); const s = R.structure; let inc: number | null = null;
  if (s) { let n = 0, k = 0; for (let i = 0; i < s.count; i++) { if (s.element[i] === 'H' || s.residues[s.residueOf[i]].resn === 'HOH') continue; n++; if (sampleMap(m, s.x[i], s.y[i], s.z[i]) >= lv) k++ } inc = n ? k / n : null }
  return { name: m.name, level: lv, sigma: (lv - m.mean) / (m.rms || 1), recommended: m.level ?? null, mean: m.mean, rms: m.rms, size: [m.nx, m.ny, m.nz], step: m.step[0], binned: m.binned || 1, atomInclusion: inc };
}
/** the map on the SDK's server: sent once (its file's bytes), again only when another map is loaded */
async function mapRefOnSdk(): Promise<string | null> {
  if (!mapRaw || !sdk) return null; if (mapRef && mapRefFor === mapRaw) return mapRef;
  const q = new URLSearchParams({ name: mapObj?.name || mapRaw.name }); if (mapRaw.level != null) q.set('level', String(mapRaw.level)); if (mapRaw.mass) q.set('mass', String(mapRaw.mass)); if (mapRaw.resolution) q.set('resolution', String(mapRaw.resolution));
  const res = await fetch(`${sdk.url}/api/putmap?${q}`, { method: 'POST', body: mapRaw.bytes }); if (!res.ok) throw new Error('the server could not read the map: ' + ((await res.json().catch(() => ({}))).error || res.status));
  mapRef = (await res.json()).ref; mapRefFor = mapRaw; return mapRef;
}
async function loadUrl(url: string) { const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + url + ' ' + r.status); await loadText(await r.text(), url.split('/').pop() || url) }

/* drag & drop */
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drag') });
stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
stage.addEventListener('drop', async e => { e.preventDefault(); stage.classList.remove('drag'); const fl = Array.from(e.dataTransfer?.files || []); if (fl.length) { try { await loadFiles(fl) } catch (err: any) { status('could not read: ' + err.message) } } });
/** one file: structure or scene; several: a stack */
async function loadFiles(fl: File[]) {
  const mapsIn = fl.filter(f => isMapName(f.name)); fl = fl.filter(f => !isMapName(f.name));
  for (const f of mapsIn) await loadMapBytes(await f.arrayBuffer(), f.name);
  if (!fl.length) return;
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
/** the name the saved files take: scene JSON, style, render command */
function docName() { return (sceneDoc?.name || R.structure?.name || 'scene').replace(/[^\w.-]+/g, '_') }
function renderCommand(): string {
  const name = docName(); const asScene = !!sceneDoc || R.labels.length > 0;   // placed labels travel in the scene JSON
  const input = asScene ? name + '.json' : (R.structure?.name || 'structure') + '.pdb';
  const cam = sceneDoc ? '' : ` --yaw ${R.camera.yaw.toFixed(1)} --pitch ${R.camera.pitch.toFixed(1)} --roll ${R.camera.roll.toFixed(1)} --zoom ${R.camera.zoom.toFixed(3)} --pan ${R.camera.panX.toFixed(3)},${R.camera.panY.toFixed(3)} --fov ${R.camera.fov}`;
  const size = renderSize ? `${renderSize[0]}x${renderSize[1]}` : `${R.w}x${R.h}`;
  return `molsketch render ${input} --style ${name}-style.json${cam} --size ${size}${sceneDoc ? ` --frames drawn -o out_${name}` : ` -o ${name}.png`}`;
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
  drawLabelMarks();
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


/* ---------- figure labels: click to place (on an atom it follows the atom), drag to move, double-click to edit ---------- */
let labelMode = false; let selLabel = -1; let hoverLabel = -1;
let editor: { input: HTMLInputElement; i: number; isNew: boolean } | null = null;
type LBox = ReturnType<ReturnType<typeof classic>['figLabelBoxes']>[number];
/** the engine's scene for what is loaded, with the current labels (a structure's is rebuilt only when the structure changes) */
function structScene(E: ReturnType<typeof classic>) {
  if (sceneDoc) { E.scene = sceneDoc; sceneDoc.labels = R.labels; return }
  if ((E.scene as any)?._src !== R.structure) { E.scene = sceneFromStructure(R.structure!, style, R.overrides, R.camera.base, R.fitPoints, R.labels); (E.scene as any)._src = R.structure }
  (E.scene as any).labels = R.labels; E.scene.reps = { ...style.reps };
}
/** the labels' boxes as drawn now (canvas px) */
function labelBoxes(): LBox[] {
  if (!R.labels.length || !R.structure) return [];
  const E = classic(); E.cfg = cfgFromStyle(style, R.camera, !!sceneDoc);
  structScene(E);
  if (style.show.noLabels || style.show.figLabels === false) return [];
  return E.figLabelBoxes(R.w / dpr, R.h / dpr, frame);
}
function labelAt(x: number, y: number): number { const bs = labelBoxes(); for (let k = bs.length - 1; k >= 0; k--) { const b = bs[k]; if (Math.abs(x - b.x) <= b.w / 2 + 5 && Math.abs(y - b.y) <= b.h / 2 + 3) return b.i } return -1 }
function drawLabelMarks() {
  if (selLabel < 0 && hoverLabel < 0) return; const bs = labelBoxes();
  ovCtx.save(); ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const b of bs) { if (b.i !== selLabel && b.i !== hoverLabel) continue; if (editor && editor.i === b.i) continue;
    ovCtx.strokeStyle = b.i === selLabel ? '#f97316' : 'rgba(249,115,22,.6)'; ovCtx.lineWidth = 1.2; ovCtx.setLineDash(b.i === selLabel ? [] : [3, 3]);
    ovCtx.strokeRect(b.x - b.w / 2 - 5, b.y - b.h / 2 - 3, b.w + 10, b.h + 6);
    if (b.anchored) { ovCtx.setLineDash([]); ovCtx.beginPath(); ovCtx.arc(b.ax, b.ay, 3, 0, Math.PI * 2); ovCtx.fillStyle = '#f97316'; ovCtx.fill() } }
  ovCtx.restore();
}
function labelWhere(l: { at?: string }): string { if (!l.at) return 'on the canvas'; const m = /^([A-Za-z0-9]+?)(-?\d+)(?:\.(\w+))?:(.+)$/.exec(l.at); return m ? `${m[1]}${m[2]}${m[3] ? ' ' + m[3] : ''} · ${m[4]}` : l.at }
function labelsChanged(msg?: string) { if (sceneDoc) sceneDoc.labels = R.labels; invalidate(); panel.refresh(); if (msg) status(msg) }
function setLabelText(i: number, t: string) { const l = R.labels[i]; if (!l) return; if (!t.trim()) { deleteLabel(i); return } mark('label text'); l.text = t; labelsChanged() }
function setLabelSize(i: number, v: number) { const l = R.labels[i]; if (!l) return; mark('label size'); l.size = v; labelsChanged() }
function deleteLabel(i: number) { if (!R.labels[i]) return; mark('delete label'); R.labels.splice(i, 1); selLabel = -1; hoverLabel = -1; labelsChanged('label deleted · Ctrl-Z brings it back') }
function clearLabels() { if (!R.labels.length) return; mark('remove all labels'); R.labels = []; selLabel = -1; labelsChanged('all placed labels removed · Ctrl-Z brings them back') }
function setLabelMode(v: boolean) { labelMode = v; if (v && authorMode !== 'off') setAuthorMode('off'); stage.classList.toggle('labeling', v); panel.refresh(); if (v) status('click the drawing where the label goes: on an atom it follows the atom (Esc to stop)') }
/** where a click puts a new label: a drawn atom, else the residue's Cα under a ribbon, else the canvas itself */
function labelAnchor(x: number, y: number): { at?: string; x?: number; y?: number; text: string } {
  const E = classic(); E.cfg = cfgFromStyle(style, R.camera, !!sceneDoc); structScene(E);
  const { st, proj } = E.projectFrame(R.w / dpr, R.h / dpr, frame); const reps = style.reps;
  const selS = E.compileSel(reps.sticks || ''), selC = E.compileSel(reps.cartoon || '');
  let best: any = null, bd = Infinity;
  for (const a of st.atoms) { if (a.alpha < 0.3) continue; const drawn = selS(a); const ca = a.name === 'CA' && !a.het && selC(a); if (!drawn && !ca) continue;
    const p = proj.proj(a.pos); const r = drawn ? Math.max(9, style.stickRadius * 2 * proj.pxPerA * p.d) : Math.max(14, 1.8 * proj.pxPerA * p.d * style.cartoonScale);
    const d = Math.hypot(p.x - x, p.y - y); if (d < r && d - (drawn ? 4 : 0) < bd) { bd = d - (drawn ? 4 : 0); best = a } }
  if (!best) return { x: x / (R.w / dpr), y: y / (R.h / dpr), text: 'label' };
  const name = best.label && !best.labelAuto ? best.label : best.resn ? `${best.resn[0]}${best.resn.slice(1).toLowerCase()}${best.resi}` : best.label || best.el;
  return { at: best.id, text: name };
}
function placeLabel(x: number, y: number, keep: boolean) {
  const an = labelAnchor(x, y); mark('add label');
  const l: any = an.at ? { text: an.text, at: an.at, dx: 0, dy: -Math.round(style.labelSize * 1.2) } : { text: an.text, x: an.x, y: an.y, dx: 0, dy: 0 };
  R.labels.push(l); selLabel = R.labels.length - 1; if (!keep) setLabelMode(false); labelsChanged(); openLabelEditor(selLabel, true);
}
function openLabelEditor(i: number, isNew = false) {
  closeLabelEditor(true); const b = labelBoxes().find(b => b.i === i); const l = R.labels[i]; if (!l) return;
  const input = document.createElement('input'); input.className = 'lbl-edit'; input.value = l.text; input.spellcheck = false;
  const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(); const fs = Math.round(style.labelSize * (l.size || 1));
  const bx = b ? b.x : 0, by = b ? b.y : 0; input.style.left = (cr.left - sr.left + bx) + 'px'; input.style.top = (cr.top - sr.top + by) + 'px'; input.style.fontSize = fs + 'px';
  input.style.fontFamily = style.font === 'Plain sans' ? '"IBM Plex Sans", system-ui, sans-serif' : `"${style.font}", "Caveat", cursive`;
  const size = () => { input.style.width = Math.max(60, (input.value.length + 2) * fs * 0.55) + 'px' }; size(); input.oninput = size;
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') closeLabelEditor(true); else if (e.key === 'Escape') closeLabelEditor(false) };
  input.onblur = () => closeLabelEditor(true);
  editor = { input, i, isNew }; stage.append(input); input.focus(); input.select(); drawOverlay();
}
function closeLabelEditor(commit: boolean) {
  if (!editor) return; const { input, i, isNew } = editor; editor = null; input.onblur = null; input.remove();
  const l = R.labels[i]; if (!l) return;
  if (commit && input.value.trim()) { if (input.value !== l.text) { if (!isNew) mark('label text'); l.text = input.value } labelsChanged() }
  else if (isNew || !input.value.trim()) { R.labels.splice(i, 1); selLabel = -1; labelsChanged() }
  else drawOverlay();
}
{ // labels take the pointer before the orbit controls do: a drag on a label moves the label, not the molecule
  let drag: { i: number; x0: number; y0: number; l0: any; moved: boolean } | null = null; let down: { x: number; y: number } | null = null;
  const at = (e: PointerEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] };
  stage.addEventListener('pointerdown', e => {
    if (e.target !== canvas || e.button !== 0) return; const [x, y] = at(e); down = { x: e.clientX, y: e.clientY };
    const i = labelAt(x, y); if (i < 0) { if (selLabel >= 0) { selLabel = -1; drawOverlay() } return }
    e.stopPropagation(); e.preventDefault(); selLabel = i; drag = { i, x0: e.clientX, y0: e.clientY, l0: { ...R.labels[i] }, moved: false }; stage.setPointerCapture(e.pointerId); drawOverlay();
  }, true);
  stage.addEventListener('pointermove', e => {
    if (drag) { const l = R.labels[drag.i]; if (!l) return; const ddx = e.clientX - drag.x0, ddy = e.clientY - drag.y0; if (!drag.moved && Math.hypot(ddx, ddy) < 3) return;
      if (!drag.moved) { mark('move label'); drag.moved = true }
      if (l.at) { l.dx = drag.l0.dx + ddx; l.dy = drag.l0.dy + ddy } else { l.x = drag.l0.x + ddx / (R.w / dpr); l.y = drag.l0.y + ddy / (R.h / dpr) }
      labelsChanged(); return }
    if (e.target !== canvas || controls.dragging || !R.labels.length) return; const [x, y] = at(e); const h = labelAt(x, y);
    stage.classList.toggle('onlabel', h >= 0); if (h !== hoverLabel) { hoverLabel = h; drawOverlay() }
  }, true);
  stage.addEventListener('pointerup', e => {
    if (drag) { const d = drag; drag = null; stage.releasePointerCapture(e.pointerId); if (d.moved) history.settle(); e.stopPropagation(); return }
    if (labelMode && down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const [x, y] = at(e); placeLabel(x, y, e.shiftKey) }
    down = null;
  }, true);
  stage.addEventListener('dblclick', e => { const [x, y] = at(e); const i = labelAt(x, y); if (i >= 0) { e.stopPropagation(); openLabelEditor(i) } }, true);
  stage.addEventListener('contextmenu', e => { const [x, y] = at(e); const i = labelAt(x, y); if (i >= 0) { e.preventDefault(); e.stopPropagation(); deleteLabel(i) } }, true);
  window.addEventListener('keydown', e => { const t = (e.target as HTMLElement)?.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selLabel >= 0) { e.preventDefault(); deleteLabel(selLabel) }
    else if (e.key === 'Enter' && selLabel >= 0) { e.preventDefault(); openLabelEditor(selLabel) }
    else if (e.key === 'Escape' && labelMode) setLabelMode(false)
    else if (e.key === 'l' || e.key === 'L') setLabelMode(!labelMode) });
}


/* ---------- the active site: find it, turn it to the viewer, label it (src/app/site.ts) ---------- */
const siteHost = (): SiteHost => ({ engine: () => { const E = classic(); E.cfg = cfgFromStyle(style, R.camera, !!sceneDoc); structScene(E); return E }, camera: R.camera, W: R.w / dpr, H: R.h / dpr, frame, siteSel: style.site.sel || '' });
function pocketSel(dist = 5): string { if (!R.structure) return ''; const r = sitePocket(R.structure, dist); status(r.msg); return r.sel }
function frameSite() { mark('frame the site'); const r = siteFrame(siteHost()); if (r.ok) { panel.refresh(); invalidate() } status(r.msg) }
function labelSite() { mark('label the site'); const r = siteLabel(siteHost(), R.labels); labelsChanged(r.msg) }

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
/** the exact frame from the SDK onto the sketch canvas; a newer request supersedes an older one */
async function runSketchSdk() {
  if (sdkBusy) { sdkAgain = true; return }   // one request at a time; the loop asks every frame until a drawing is up
  sdkBusy = true; const seq = sdkSeq; const t0 = performance.now();
  try {
    const spec = await figureSpec(R.w / dpr, R.h / dpr, dpr, sceneDoc ? frame : boil);
    const bmp = await sdk!.render(spec); if (seq !== sdkSeq) { bmp.close(); return }
    skCanvas.width = R.w; skCanvas.height = R.h; skCtx.clearRect(0, 0, R.w, R.h); skCtx.drawImage(bmp, 0, 0); bmp.close();
    sketchStats = { readMs: 0, regionMs: 0, drawMs: performance.now() - t0, regions: 0 }; sceneFast = false;
    sketchShown = true; skCanvas.classList.add('on'); drawOverlay();
  } catch (e: any) { status('molsketch could not draw this: ' + e.message) }
  finally { sdkBusy = false; if (sdkAgain) { sdkAgain = false; if (!sketchShown) runSketchSdk() } }
}
function drawFrameTo(ctx: CanvasRenderingContext2D, W: number, H: number, f: number): void | Promise<void> {
  if (sdk && (sceneDoc || structureText || mapObj)) return (async () => {   // exports through the SDK: the same frame the Python package draws
    const bmp = await sdk!.render(await figureSpec(W, H, 1, f)); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.drawImage(bmp, 0, 0); ctx.restore(); bmp.close() })();
  const E = classic(); const drawn = Math.floor(f / 2) * 2;
  let cam: any = { ...camOf(), fov: R.camera.fov };
  if (sceneDoc && sceneDoc.keyframes.some(k => k.view)) { E.cfg = cfgFromStyle(style, cam, true); const v = E.viewAt(drawn); if (v) cam = { ...v, fov: R.camera.fov } }
  E.cfg = cfgFromStyle(style, cam, !!sceneDoc); if (sceneDoc) { if (E.scene !== sceneDoc) E.scene = sceneDoc } else E.scene = sceneFromStructure(R.structure!, style, R.overrides, R.camera.base, R.fitPoints, R.labels);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.restore();
  E.renderFrame(ctx, W, H, f, 1);
}
async function renderToFile(o: { width: number; height: number; codec: CodecName; quality: Quality; onProgress: (done: number, total: number, bytes: number, eta: number) => void }): Promise<{ name: string; bytes: number; seconds: number; codecString: string }> {
  const frames: number[] = []; if (sceneDoc) { for (let f = 0; f < timeline().total; f += 2) frames.push(f) } else for (let f = 0; f < 24; f += 2) frames.push(f);
  const name = (sceneDoc?.name || R.structure?.name || 'molsketch').replace(/[^\w.-]+/g, '_'); renderCancel = false; const t0 = performance.now();
  const wasLive = live; live = false; sketchOn = false;   // no on-screen sketches while the engine is busy with the file
  try {
    const res = await renderVideo({ width: o.width, height: o.height, fps: FPS / 2, codec: o.codec, quality: o.quality, frames, draw: drawFrameTo, cancelled: () => renderCancel, onProgress: (d, n, b) => { const el = (performance.now() - t0) / 1000; o.onProgress(d, n, b, d ? el / d * (n - d) : 0) } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(res.blob); a.download = `${name}.${res.ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return { name: a.download, bytes: res.bytes, seconds: res.seconds, codecString: res.codecString };
  } finally { live = wasLive; sketchOn = restMode !== 'preview'; classic().cfg = cfgFromStyle(style, R.camera, !!sceneDoc); if (sceneDoc) classic().scene = sceneDoc; invalidate() }
}
async function savePoster(width: number, height: number, f = frame, type: 'image/jpeg' | 'image/png' = 'image/jpeg') {
  const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d', { willReadFrequently: true })!; await drawFrameTo(ctx, width, height, f);
  const name = (sceneDoc?.name || R.structure?.name || 'molsketch').replace(/[^\w.-]+/g, '_');
  const a = document.createElement('a'); a.href = c.toDataURL(type, 0.86); a.download = `${name}_${sceneDoc ? 'frame' + f : 'poster'}.${type === 'image/png' ? 'png' : 'jpg'}`; a.click();
  classic().cfg = cfgFromStyle(style, R.camera, !!sceneDoc); if (sceneDoc) classic().scene = sceneDoc; invalidate();
}
/** This frame as SVG, drawn by the molsketch SDK (the browser has no vector route of its own). */
async function saveSvg(width: number, height: number, f = sceneDoc ? frame : boil) {
  if (!sdk) { status('SVG needs the molsketch server: run `molsketch serve`'); return }
  const svg = await sdk.svg(await figureSpec(width, height, 1, f));
  const name = (sceneDoc?.name || R.structure?.name || 'molsketch').replace(/[^\w.-]+/g, '_');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = `${name}${sceneDoc ? '_frame' + f : ''}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
/** The frame with the arrows of the first keyframe fully drawn: the natural poster. */
function posterFrame(): number { if (!sceneDoc) return 0; const h = timeline().segs.find(s => s.type === 'hold'); return h ? h.start + Math.floor(h.len * 0.9 / 2) * 2 : 0 }

/* ---------- for the panel: what is loaded, and small drawings of it in each look ---------- */
function molecule() {
  const s = R.structure;
  const kind: 'scene' | 'structure' | 'map' | null = sceneDoc ? 'scene' : s ? 'structure' : mapObj ? 'map' : null;
  const name = sceneDoc?.name || s?.name || mapObj?.name || '';
  if (!s) return { kind, name, atoms: 0, residues: 0, chains: [] as { id: string; desc: string; residues: number }[], ligands: [] as string[], water: 0, protein: false, nucleic: false, map: mapObj?.name || '' };
  const chains = s.chains.map(c => ({ id: c.id, desc: (c.entity && s.entities[c.entity]?.desc) || '', residues: c.residues.filter(ri => !s.residues[ri].het).length })).filter(c => c.residues > 0);
  const lig = new Map<string, number>(); let water = 0, protein = false, nucleic = false;
  for (const r of s.residues) { if (r.resn === 'HOH' || r.resn === 'WAT') water++; else if (r.het) lig.set(r.resn, (lig.get(r.resn) || 0) + 1); else if (r.nucleic) nucleic = true; else protein = true }
  return { kind, name, atoms: s.count, residues: s.residues.length, chains, ligands: [...lig.keys()], water, protein, nucleic, map: mapObj?.name || '' };
}
/** the loaded molecule drawn small in a look (the look gallery's thumbnails) */
function lookPreview(key: string, w: number, h: number): HTMLCanvasElement | null {
  const L = LOOKS[key]; if (!L || (!R.structure && !sceneDoc && !mapObj)) return null;
  const st = mergeStyle(DEFAULT_STYLE, L.style); if (!L.style.reps) st.reps = { ...style.reps }; st.map = { ...style.map, caption: false } as any; st.show = { ...st.show, caption: false, stepLabel: false, noLabels: true } as any;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const tmp: any = { structure: R.structure, camera: { ...R.camera, zoom: 1, panX: 0, panY: 0, capFrac: 0, topFrac: 0 }, overrides: R.overrides, fitPoints: R.fitPoints, labels: [], w, h, map: mapObj, fitOverride: R.fitOverride };
  try { if (sceneDoc) renderScene(ctx, tmp, st, sceneDoc, posterFrame(), 1); else renderClassic(ctx, tmp, st, 0, 1) } catch { return null }
  if (sceneDoc) { sceneDoc.labels = R.labels } invalidate();
  return c;
}

/* panel */
function applyLook(key: string) {
  const L = LOOKS[key]; if (!L) return; mark('look ' + L.name); currentLook = key;
  const keep = { reps: style.reps }; style = mergeStyle(DEFAULT_STYLE, L.style); if (!L.style.reps) style.reps = keep.reps;
  panel.refresh(); rebuild();
}
const panel = buildPanel(document.getElementById('controls')!, {
  get style() { return style }, set style(v) { style = v },
  looks: LOOKS, currentLook: () => currentLook, applyLook, molecule, lookPreview, openFileDialog: () => (document.getElementById('fileIn') as HTMLInputElement | null)?.click(),
  rebuild, redraw, camera: R.camera, mark, settle: () => history.settle(),
  onLive: v => { live = v; invalidate() }, onTurntable: v => { turntable = v; invalidate() }, onPitchSwing: v => { pitchSwing = v },
  onRest: (v: string) => { restMode = v as RestMode; sketchOn = v !== 'preview'; invalidate() },
  renderNow: () => { R.render(style); runSketch('classic'); hud.textContent = `classic ${sketchStats.drawMs.toFixed(0)} ms · ${R.w}×${R.h}` },
  savePng: () => { const a = document.createElement('a'); a.href = snapshot(); a.download = `${sceneDoc?.name || R.structure?.name || 'molsketch'}.png`; a.click() },
  saveStyle: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(style, null, 1)); a.download = `${docName()}-style.json`; a.click() },
  loadStyle: async (f: File) => { mark('load style'); style = mergeStyle(DEFAULT_STYLE, JSON.parse(await f.text())); panel.refresh(); rebuild() },
  loadFile: async (f: File) => { await loadText(await f.text(), f.name) }, loadFiles,
  saveScene: () => { const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(sceneJson()); a.download = docName() + '.json'; a.click() },
  loadExample: (name: string) => loadUrl('examples/' + name).catch(e => status(e.message)),
  fetchPdb,
  loadMap: async (f: File) => { try { await loadMapBytes(await f.arrayBuffer(), f.name) } catch (e: any) { status('could not read the map: ' + e.message) } },
  fetchMap: async (id: string) => { try { await fetchEmdb(id) } catch (e: any) { status(e.message) } },
  mapForEntry: async () => { try { await mapForEntry() } catch (e: any) { status(e.message) } },
  clearMap, mapInfo, hasMap: () => !!mapObj, hasStructure: () => !!R.structure,
  figLabels: () => R.labels.map((l, i) => ({ i, text: l.text, where: labelWhere(l), size: l.size || 1 })), setLabelText, setLabelSize, deleteLabel, clearLabels,
  setLabelMode: (v: boolean) => setLabelMode(v), labelMode: () => labelMode,
  pocketSel, frameSite, labelSite,
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
  fps: FPS, hasScene: () => !!sceneDoc, keyframes, currentKey, keyStarts: () => sceneDoc ? keyframes().map((_, i) => (timeline().segs.find(s => s.kf === i && s.type === 'hold') || timeline().segs.find(s => s.kf === i))?.start ?? 0) : [], loopSeconds, setKeyTiming, setKeyName, goToKey, duplicateKey, deleteKey, moveKey, setKeyView,
  setShowChanges, setHoverChanges, diffNote: () => diffNote,
  // authoring
  setAuthorMode: (m: string) => setAuthorMode(m as AuthorMode), authorMode: () => authorMode, authorText, arrowsOf, editArrow,
  // checks
  lint: () => lintItems, relint,
  // views
  suggest, adoptView,
  // render
  hasWebCodecs, codecSupport, renderToFile, cancelRender: () => { renderCancel = true }, savePoster, saveSvg, hasSdk: () => !!sdk, posterFrame, setRenderSize: (s: [number, number] | null) => { const a = s ? s[0] / s[1] : null; if (a === previewAspect && (s ? renderSize && s[0] === renderSize[0] && s[1] === renderSize[1] : !renderSize)) return; renderSize = s; setPreviewAspect(a) }, drawnFrames: () => sceneDoc ? Math.ceil(timeline().total / 2) : 12,
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
  if (dirty && restMode === 'classic' && sketchOn && (R.structure || mapObj) && !turntable && classicMs < 45) {   // live exact: cheap enough to draw the real thing every frame
    dirty = false; R.render(style); runSketch('classic'); lastSketchAt = t; hud.textContent = `classic (live) ${classicMs.toFixed(0)} ms · ${R.w}×${R.h}` }
  else if (dirty) { dirty = false; R.render(style); hud.textContent = `preview ${R.stats.frameMs.toFixed(1)} ms · ${R.w}×${R.h} · yaw ${R.camera.yaw.toFixed(0)}° pitch ${R.camera.pitch.toFixed(0)}°${R.camera.roll ? ' roll ' + R.camera.roll.toFixed(0) + '°' : ''} · zoom ${R.camera.zoom.toFixed(2)} pan ${R.camera.panX.toFixed(2)}, ${R.camera.panY.toFixed(2)}${sceneDoc ? ` · ${(frame / FPS).toFixed(2)} s` : ''}` }
  else if (sketchOn && (R.structure || mapObj) && !turntable) {
    const rested = t - lastChange > 220; const period = Math.max(900, (sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs) * 3);
    if ((!sketchShown && rested) || (live && sketchShown && t - lastSketchAt > period)) {
      if (sketchShown) boil++; lastSketchAt = t; runSketch();
      hud.textContent = restMode === 'classic' ? `classic ${sketchStats.drawMs.toFixed(0)} ms · ${R.w}×${R.h}` : `sketch ${(sketchStats.readMs + sketchStats.regionMs + sketchStats.drawMs).toFixed(0)} ms (read ${sketchStats.readMs.toFixed(0)}, regions ${sketchStats.regionMs.toFixed(0)}, draw ${sketchStats.drawMs.toFixed(0)}) · ${sketchStats.regions} regions · ${R.w}×${R.h}`;
    }
  }
  requestAnimationFrame(loop);
}
fit(); requestAnimationFrame(loop);
/* start-up: ?pdb=3J5P loads that entry, ?map=auto (its map) or ?map=EMD-5778 a map, and opens the Map tab; else the example */
{ const q = new URLSearchParams(location.search), pdb = q.get('pdb'), mp = q.get('map');
  if (pdb || mp) (async () => { try { if (pdb) await fetchPdb(pdb); if (mp) { panel.selectTab?.('map'); if (mp === 'auto') await mapForEntry(); else await fetchEmdb(mp); panel.refresh() } } catch (e: any) { status(e.message) } })();
  else { const seq = loadSeq; fetch('examples/test_protein.pdb').then(r => r.text()).then(t => { if (loadSeq === seq) loadText(t, 'test_protein.pdb') }).catch(e => status(e.message)) } }

/* scripting hook (used by the CLI and tests) */
const api = {
  get style() { return style }, set style(v: Style) { style = mergeStyle(DEFAULT_STYLE, v); panel.refresh(); rebuild() },
  applyLook, loadText, loadUrl, fetchPdb, render: () => { R.render(style); return R.stats.frameMs }, renderer: R, camera: R.camera,
  setLive: (v: boolean) => { live = v }, setTurntable: (v: number) => { turntable = v }, png: snapshot,
  setSize: (w: number, h: number) => { fixedSize = [w, h]; R.resize(w, h) }, setDpr: (v: number) => { dpr = v }, rebuild,
  sketch: (b?: number, mode?: RestMode) => { R.render(style); if (b !== undefined) boil = b; runSketch(mode || 'sketch'); return sketchStats },
  renderClassic, classicEngine: () => classic(), seek: setFrame, loadScene, fetchMap: fetchEmdb, mapForEntry, loadMapBytes, clearMap, mapInfo, loadStack, sceneJson, get frame() { return frame }, get scene() { return sceneDoc },
  classic: (b?: number) => { R.render(style); if (b !== undefined) boil = b; runSketch('classic'); return sketchStats.drawMs },
  setSketch: (v: boolean) => { sketchOn = v; invalidate() }, setRest: (m: RestMode) => { restMode = m; sketchOn = m !== 'preview'; invalidate() },
  fitFrame, screenBox: (what: 'all' | 'frame' = 'all') => R.camera.screenBox(R.w, R.h, framePoints(what)), framePresets: FRAME_PRESETS, renderCommand,
  history, lint: () => lintItems, suggest, adoptView, renderToFile, drawFrameTo, keyframes, setKeyView, setKeyTiming, duplicateKey, deleteKey, moveKey, setAuthorMode, authorClick, arrowsOf, editArrow, keyDiff: (i: number) => sceneDoc ? keyDiff(sceneDoc, i) : null, setPreviewAspect, projectNow,
};
(window as any).MolSketch = api; (window as any).TriadSketch = api;   // the old name, for scripts written before the rename

