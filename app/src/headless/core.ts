/* The headless core: a figure, described as plain JSON (a FigureSpec), in, a recorded drawing out. This is the one
   renderer: the Python SDK runs it in an embedded V8, and the app renders its final frames through the SDK. It
   settles a spec in the order the CLI (and so the app) applies things:
     input → look → style → set → the scene's own view → camera → labels / group colours → fit points
   and then draws with the classic engine exactly as the app's runSketch('classic') does. Structures are parsed once
   and cached by their text. */
import { parseStructure } from '../model/parse';
import type { Structure } from '../model/structure';
import { DEFAULT_STYLE, cloneStyle, mergeStyle, PALETTES, type Style } from '../style';
import { LOOKS } from '../looks';
import { GROUP_PALETTES, ribbonColours } from '../palettes';
import { classic, cfgFromStyle, sceneFromStructure, renderClassic, renderScene } from '../classic/adapter';
import { sceneFitPoints, type SceneDoc } from '../classic/scene';
import { selectAtoms } from '../model/selection';
import { pcaBasis } from '../render/pca';
import { Camera as ViewCamera } from '../render/camera';
import { pocketSel, frameSite, labelSite, type FigLabel, type SiteHost } from '../app/site';
import { RecCanvas, endRender, release, setMeasure } from './canvas';

export type Camera = { yaw: number; pitch: number; roll: number; zoom: number; panX: number; panY: number; fov?: number | null };
export interface FigureSpec {
  /** what to draw: a structure's text (PDB or mmCIF), a scene document, or several structures (a stack of keyframes) */
  input: { text: string; name: string } | { scene: SceneDoc; name?: string } | { stack: { text: string; name: string }[] } | { ref: string };
  /** a group palette by name (as a palette tile): the colours groups take, and with engraved ribbons, helix, sheet and coil */
  palette?: string | null;
  look?: string | null;
  /** a whole style, as the app's Save style writes (replaces the look's, keeping the reps it lacks) */
  styleFile?: any;
  /** changes to the style: nested ({palette: {helix: '#…'}}) or dotted ({'palette.helix': '#…'}), applied in order */
  style?: Record<string, any>;
  camera?: Partial<Camera>;
  labels?: FigLabel[] | null;
  groupColors?: Record<string, string> | null;
  size?: [number, number]; scale?: number;
  /** a scene's timeline frame; for a structure, the boil (which re-jitter of the lines) */
  frame?: number;
}

const FPS = 24;
/** inputs the host registered once (a structure's text can be megabytes): specs name them as {ref} */
const inputs = new Map<string, any>();
export function put(ref: string, input: any) { inputs.set(ref, input); return ref }
export function drop(ref: string) { inputs.delete(ref) }
const parsed = new Map<string, Structure>();
function structureOf(text: string, name: string): Structure {
  const key = name + '\u0000' + text.length + '\u0000' + text.slice(0, 64) + text.slice(-64);
  let s = parsed.get(key); if (!s) { s = parseStructure(text, name.replace(/\.(pdb|ent|cif|mmcif)$/i, '')); parsed.set(key, s); if (parsed.size > 8) parsed.delete(parsed.keys().next().value!) }
  return s;
}

/** everything the engine needs for one figure, settled from a spec */
interface Settled {
  style: Style; look: string; camera: Camera & { fov: number; base: Float32Array };
  structure: Structure | null; scene: SceneDoc | null; overrides: Record<string, string>; labels: FigLabel[];
  fitPoints: Float32Array; frame: number; W: number; H: number; dpr: number;
}

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function setPath(st: any, path: string, v: any) { const ks = path.split('.'); let o = st; for (let j = 0; j < ks.length - 1; j++) { o[ks[j]] = o[ks[j]] && typeof o[ks[j]] === 'object' ? o[ks[j]] : {}; o = o[ks[j]] } o[ks[ks.length - 1]] = v }
function flatten(obj: any, pre = '', out: [string, any][] = []): [string, any][] {
  for (const k of Object.keys(obj)) { const v = obj[k]; const p = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(k === 'groupPalette')) flatten(v, p, out); else out.push([p, v]) }
  return out;
}
/** the look's style, as applyLook makes it (the reps it lacks are kept) */
function withLook(style: Style, key: string): Style {
  const L = LOOKS[key]; if (!L) throw new Error(`unknown look "${key}"; the looks are ${Object.keys(LOOKS).join(', ')}`);
  const keep = style.reps; const s = mergeStyle(DEFAULT_STYLE, L.style); if (!L.style.reps) s.reps = keep; return s;
}

/** what the app's rebuild() fits the camera to: the atoms any representation draws (or all, if none) */
function fitPointsOf(s: Structure, style: Style): Float32Array {
  const shown = new Uint8Array(s.count); const siteSel = style.site?.sel?.trim();
  const stickSel = siteSel ? (style.reps.sticks.trim() ? `(${style.reps.sticks}) or (${siteSel})` : siteSel) : style.reps.sticks;
  for (const sel of [stickSel, style.reps.cartoon, style.reps.surface]) if (sel && sel.trim()) { const m = selectAtoms(s, sel); for (let i = 0; i < s.count; i++) shown[i] |= m[i] }
  let n = 0; for (let i = 0; i < s.count; i++) n += shown[i];
  const pts = new Float32Array((n || s.count) * 3); let k = 0;
  for (let i = 0; i < s.count; i++) if (!n || shown[i]) { pts[k++] = s.x[i]; pts[k++] = s.y[i]; pts[k++] = s.z[i] }
  return pts;
}

/** a stack of structures as one scene, one keyframe each, as the app's loadStack builds it */
function stackScene(files: { text: string; name: string }[], style: Style): SceneDoc {
  files = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const structs = files.map(f => structureOf(f.text, f.name)); const base = pcaBasis(structs[0]); const one = structs.length === 1;
  const keyframes = structs.map(st => { const sc = sceneFromStructure(st, style, {}, base, new Float32Array(0)); const k = sc.keyframes[0]; return { name: st.name, hold: one ? 24 : 0, transition: one ? 0 : 2, atoms: k.atoms, bonds: k.bonds, arrows: [] } });
  const hasPoly = structs[0].residues.some(r => !r.het);
  const doc: any = { name: files.length > 1 ? 'PDB stack' : structs[0].name, reps: { sticks: hasPoly ? 'hetatm and not water' : 'all', cartoon: hasPoly ? 'polymer' : '', surface: '' }, groupColors: {}, view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 }, keyframes };
  doc.fromPdb = true; return doc;
}

export function settle(spec: FigureSpec): Settled {
  let style = cloneStyle(DEFAULT_STYLE); let look = '';
  const cam: any = { yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0, base: identity() };
  let structure: Structure | null = null, scene: SceneDoc | null = null; let overrides: Record<string, string> = {}; let labels: FigLabel[] = [];
  let inp: any = spec.input; if (inp.ref !== undefined) { inp = inputs.get(inp.ref); if (!inp) throw new Error(`unknown input ${(spec.input as any).ref}`) }
  if (inp.scene || inp.stack) {   // loadScene
    const doc: any = inp.scene ? JSON.parse(JSON.stringify(inp.scene)) : stackScene(inp.stack, style); scene = doc;
    if (doc.look && LOOKS[doc.look]) { style = withLook(style, doc.look); look = doc.look }
    if (doc.site) style.site = { ...style.site, ...doc.site };
    if (doc.reps) style.reps = { ...doc.reps }; overrides = { ...(doc.groupColors || {}) }; labels = (doc.labels || []).map((l: any) => ({ ...l }));
    const dv = doc.view; if (dv) { if (dv.fov !== undefined) style.view.fov = dv.fov; if (dv.fog !== undefined) style.view.fog = dv.fog; if (dv.fogStart !== undefined) style.view.fogStart = dv.fogStart }   // as loadScene: a later look replaces them
  } else {   // loadText
    structure = structureOf(inp.text, inp.name); cam.base = pcaBasis(structure);
    if (!structure.residues.some(r => !r.het)) style.reps = { sticks: 'all', cartoon: '', surface: '' };
  }
  if (spec.look) { style = withLook(style, spec.look); look = spec.look }
  if (spec.styleFile) { const s = JSON.parse(JSON.stringify(spec.styleFile)); if (!s.reps) s.reps = style.reps; style = mergeStyle(DEFAULT_STYLE, s) }
  if (spec.style) { const st = JSON.parse(JSON.stringify(style)); for (const [p, v] of flatten(spec.style)) setPath(st, p, v); style = mergeStyle(DEFAULT_STYLE, st) }
  if (spec.palette !== undefined && spec.palette !== null) {   // as the app's palette tile: the group colours, and the engraved ribbons' three
    const gp = GROUP_PALETTES[spec.palette]; if (!gp) throw new Error(`unknown palette "${spec.palette}"; the palettes are ${Object.keys(GROUP_PALETTES).join(', ')}`);
    style.groupPalette = spec.palette === 'MolSketch' ? null : gp.colors.slice(); style.groupPaletteName = spec.palette;
    if (style.cartoonStyle === 'engraved') { if (spec.palette !== 'MolSketch') { const [h, e, l] = ribbonColours(gp.colors, style.palette.paper, style.palette.ink); style.palette.helix = h; style.palette.sheet = e; style.palette.loop = l }
      else if (look && (LOOKS[look].style as any).palette) { const P = (LOOKS[look].style as any).palette; for (const k of ['helix', 'sheet', 'loop'] as const) if (P[k]) (style.palette as any)[k] = P[k] } }
  }
  // the scene's own view wins over the look and style; its fov becomes the style's (as the CLI does after them)
  const v: any = scene && (scene as any).view;
  if (v) { cam.yaw = v.yaw ?? 0; cam.pitch = v.pitch ?? 0; cam.roll = v.roll ?? 0; cam.zoom = v.zoom ?? 1; cam.panX = v.panX ?? 0; cam.panY = v.panY ?? 0; if (v.fov !== undefined) style.view.fov = v.fov }
  cam.fov = style.view.fov;
  const c = spec.camera || {}; for (const k of ['yaw', 'pitch', 'roll', 'zoom', 'panX', 'panY', 'fov'] as const) if (c[k] !== undefined && c[k] !== null) cam[k] = c[k];
  if (spec.labels) labels = spec.labels.map(l => ({ ...l }));
  if (spec.groupColors) overrides = { ...spec.groupColors };
  const [W, H] = spec.size || [960, 720]; const dpr = spec.scale || 1;
  return { style, look, camera: cam, structure, scene, overrides, labels, fitPoints: structure ? fitPointsOf(structure, style) : new Float32Array(0), frame: spec.frame || 0, W, H, dpr };
}

/** the engine made ready for a settled figure, as the app's structScene / setFrame do */
function engineFor(f: Settled) {
  const E = classic();
  if (f.scene) {
    E.cfg = cfgFromStyle(f.style, f.camera, true); if (E.scene !== f.scene) E.scene = f.scene;
    (f.scene as any).reps = { ...f.style.reps }; (f.scene as any).groupColors = { ...f.overrides }; (f.scene as any).labels = f.labels;
  } else {
    E.cfg = cfgFromStyle(f.style, f.camera, false);
    E.scene = sceneFromStructure(f.structure!, f.style, f.overrides, f.camera.base, f.fitPoints, f.labels);
  }
  return E;
}
/** a scene's frame: the timeline wraps, and keyframe cameras move the camera (the app's setFrame / syncKeyView) */
function sceneFrame(f: Settled) {
  const E = classic(); E.cfg = cfgFromStyle(f.style, f.camera, true); if (E.scene !== f.scene) E.scene = f.scene;
  const total = (E as any).TL.total; f.frame = ((f.frame % total) + total) % total;
  E.cfg = { ...E.cfg, stepEvery: 2 }; const drawn = Math.floor(f.frame / 2) * 2;
  if (f.scene!.keyframes.some((k: any) => k.view)) { E.cfg = cfgFromStyle(f.style, f.camera, true); const v = E.viewAt(drawn); if (v) Object.assign(f.camera, { yaw: v.yaw, pitch: v.pitch, roll: v.roll, zoom: v.zoom, panX: v.panX, panY: v.panY }) }
}

/** draw a figure; returns the recorded canvases (only what is new since the last call) and the frame's canvas id */
export function render(spec: FigureSpec, measure?: (font: string, text: string) => number) {
  if (measure) setMeasure(measure);
  const f = settle(spec); const c = new RecCanvas(); c.width = Math.round(f.W * f.dpr); c.height = Math.round(f.H * f.dpr);
  const ctx = c.getContext('2d') as any; const R: any = { structure: f.structure, camera: f.camera, overrides: f.overrides, fitPoints: f.fitPoints, labels: f.labels, w: c.width, h: c.height };
  const t0 = Date.now();
  try {
    if (f.scene) { sceneFrame(f); renderScene(ctx, R, f.style, f.scene, f.frame, f.dpr) }
    else renderClassic(ctx, R, f.style, f.frame, f.dpr);
  } catch (e: any) {   // what was recorded still goes to the host, which keeps its canvases in step with these
    release(c.id); if (e && typeof e === 'object') { e.canvas = c.id; e.chunks = endRender() } else endRender();
    throw e;
  }
  release(c.id); const chunks = endRender();   // the recording, as chunks the host's stream did not already take
  return { canvas: c.id, width: c.width, height: c.height, ms: Date.now() - t0, chunks };
}

/** the settled figure, for the SDK to show: style, camera, timeline, counts */
export function info(spec: FigureSpec) {
  const f = settle(spec); const out: any = { look: f.look, style: f.style, camera: { ...f.camera, base: undefined }, labels: f.labels, groupColors: f.overrides };
  if (f.structure) { const s = f.structure; out.structure = { name: s.name, atoms: s.count, residues: s.residues.length, chains: s.chains.map(c => c.id) } }
  if (f.scene) { const E = classic(); E.cfg = cfgFromStyle(f.style, f.camera, true); if (E.scene !== f.scene) E.scene = f.scene; const TL = (E as any).TL;
    out.scene = { name: (f.scene as any).name, keyframes: f.scene.keyframes.map((k: any) => k.name), frames: TL.total, fps: FPS, segs: TL.segs } }
  return out;
}

/** the frames a spec names: all, drawn (every other: one per new drawing), keyframes (the start of each hold), N, A-B */
export function frames(spec: FigureSpec, which: string | number = 'drawn'): number[] {
  const f = settle(spec); if (!f.scene) return [0];
  const E = classic(); E.cfg = cfgFromStyle(f.style, f.camera, true); if (E.scene !== f.scene) E.scene = f.scene; const TL = (E as any).TL;
  const out: number[] = []; const w = String(which);
  if (w === 'all') for (let i = 0; i < TL.total; i++) out.push(i);
  else if (w === 'drawn') for (let i = 0; i < TL.total; i += 2) out.push(i);
  else if (w === 'keyframes') for (let k = 0; k < f.scene.keyframes.length; k++) { const s = TL.segs.find((s: any) => s.kf === k && s.type === 'hold') || TL.segs.find((s: any) => s.kf === k); if (s) out.push(s.start) }   // as goToKey: the hold, or the keyframe's first frame
  else if (/^\d+-\d+$/.test(w)) { const [a, b] = w.split('-').map(Number); for (let i = a; i <= b; i++) out.push(i) }
  else out.push(+w);
  return out;
}

/** zoom and pan so the drawing fills a box of the canvas ({x0, y0, x1, y1}, fractions, x right, y down), as the app's
    Fit to frame: `what` measures every keyframe of a scene ('all') or the atoms of this frame ('frame'). Returns the
    camera's new zoom and pan and where the drawing now sits. */
export function fitFrame(spec: FigureSpec, box: { x0: number; y0: number; x1: number; y1: number }, what: 'all' | 'frame' = 'all') {
  const f = settle(spec); if (f.scene) sceneFrame(f);
  const C = new ViewCamera(), c = f.camera;
  Object.assign(C, { yaw: c.yaw, pitch: c.pitch, roll: c.roll, zoom: c.zoom, panX: c.panX, panY: c.panY, fov: c.fov, base: c.base });
  if (f.scene) { C.capFrac = f.style.show.caption ? 0.13 : 0; C.topFrac = f.style.show.stepLabel ? 0.05 : 0 }
  const fit = f.scene ? sceneFitPoints(f.scene) : f.fitPoints; C.setFitPoints(fit);
  let pts = fit;   // as the app's framePoints: a structure's every atom, or the scene's keyframes
  if (f.structure && (what === 'frame' || !f.scene)) { const s = f.structure; pts = new Float32Array(s.count * 3); for (let i = 0; i < s.count; i++) { pts[i * 3] = s.x[i]; pts[i * 3 + 1] = s.y[i]; pts[i * 3 + 2] = s.z[i] } }
  C.fitTo(box, f.W, f.H, pts);
  return { zoom: C.zoom, panX: C.panX, panY: C.panY, box: C.screenBox(f.W, f.H, pts) };
}

/* ---- the active site, on a spec: each returns the spec's new camera / labels / site selection ---- */
function siteHostOf(f: Settled): SiteHost { return { engine: () => engineFor(f), camera: f.camera, W: f.W, H: f.H, frame: f.frame, siteSel: f.style.site.sel || '' } }
export function pocket(spec: FigureSpec, dist = 5) { const f = settle(spec); if (!f.structure) throw new Error('the pocket needs a structure, not a scene'); return pocketSel(f.structure, dist) }
export function frameTheSite(spec: FigureSpec) { const f = settle(spec); const r = frameSite(siteHostOf(f)); const { base, ...cam } = f.camera; return { ...r, camera: cam } }
export function labelTheSite(spec: FigureSpec) { const f = settle(spec); const labels = f.labels.map(l => ({ ...l })); const r = labelSite(siteHostOf(f), labels); return { ...r, labels } }

/** the scene JSON of a spec, as the app's Save scene JSON writes it */
export function sceneJson(spec: FigureSpec) {
  const f = settle(spec);
  const doc: any = f.scene ? { ...f.scene } : sceneFromStructure(f.structure!, f.style, f.overrides, f.camera.base, new Float32Array(0));
  doc.reps = { ...f.style.reps }; doc.groupColors = { ...f.overrides }; doc.labels = f.labels.map(l => ({ ...l }));
  if (f.style.site.sel.trim()) doc.site = { ...f.style.site }; else delete doc.site; if (f.look) doc.look = f.look; delete doc.fitPoints;
  const c = f.camera; doc.view = { yaw: c.yaw, pitch: c.pitch, roll: c.roll, zoom: c.zoom, panX: c.panX, panY: c.panY, fov: c.fov, fog: f.style.view.fog, fogStart: f.style.view.fogStart };
  return doc;
}

export const catalog = () => ({
  looks: Object.fromEntries(Object.entries(LOOKS).map(([k, L]) => [k, { name: L.name, note: L.note }])),
  palettes: Object.fromEntries(Object.entries(GROUP_PALETTES).map(([k, p]) => [k, { colors: p.colors, family: p.family, source: p.source }])),
  paperPresets: Object.keys(PALETTES), defaultStyle: DEFAULT_STYLE,
});
/** the ribbon colours a group palette gives the engraved ribbons (as the app's palette tiles apply them) */
export const ribbons = (name: string, paper: string, ink: string) => { const p = GROUP_PALETTES[name]; if (!p) throw new Error(`unknown palette "${name}"`); return ribbonColours(p.colors, paper, ink) };

/** an atom id from a friendly name: an exact id ("TYR32.A:CA"), a residue ("Tyr32", "TYR32.A": its CA, else its first
    atom), or a residue and atom ("Tyr32:OH"); case does not matter */
export function atomId(spec: FigureSpec, q: string): string {
  const f = settle(spec); const E = engineFor(f); const { st } = E.projectFrame(f.W, f.H, f.frame); const ids: string[] = st.atoms.map((a: any) => a.id);
  if (ids.includes(q)) return q;
  const m = /^\s*([A-Za-z]+)\s*(-?\d+)(?:\.([A-Za-z0-9]+))?(?::(\S+))?\s*$/.exec(q);
  if (!m) throw new Error(`"${q}" names no atom: use an id like TYR32.A:CA or a residue like Tyr32`);
  const [, resn, resi, chain, atom] = m; const U = (x?: string) => (x || '').toUpperCase();
  const hits = st.atoms.filter((a: any) => U(a.resn) === U(resn) && String(a.resi) === resi && (!chain || U(a.chain) === U(chain)));
  if (!hits.length) throw new Error(`no residue ${resn}${resi}${chain ? ' in chain ' + chain : ''} here`);
  const pick = atom ? hits.find((a: any) => U(a.name) === U(atom)) : hits.find((a: any) => a.name === 'CA') || hits[0];
  if (!pick) throw new Error(`${resn}${resi} has no atom ${atom}; it has ${hits.map((a: any) => a.name).join(', ')}`);
  return pick.id;
}

/** the engine's configuration for a spec, as it draws (for comparing with the app's) */
export function engineConfig(spec: FigureSpec) { const f = settle(spec); if (f.scene) sceneFrame(f); const E = engineFor(f); return { cfg: E.cfg, reps: (E.scene as any).reps, groupColors: (E.scene as any).groupColors, camera: { ...f.camera, base: Array.from(f.camera.base) } } }
