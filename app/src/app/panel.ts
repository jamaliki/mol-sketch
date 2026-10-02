/* The app's chrome:
   · the top bar (#topbar): Open (files, PDB, EMDB, examples), what is loaded, undo / redo, help, Export
   · the layers of the picture (#outline): the drawing style, the molecule's parts, the map, the site, labels, camera,
     each with a switch; selecting one shows its settings
   · the inspector (#controls): the settings of the selected layer, fine tuning folded away, and a search over all
   · on the drawing: a dock (view, labels, spin, snapshot), the empty state, help; the export dialog; the timeline */
import type { Style, Palette } from '../style';
import type { Camera } from '../render/camera';
import { ribbonColours } from '../palettes';
import { hand, handOf } from '../looks';

export interface Molecule {
  kind: 'scene' | 'structure' | 'map' | null; name: string; atoms: number; residues: number;
  chains: { id: string; desc: string; residues: number }[]; ligands: string[]; water: number; protein: boolean; nucleic: boolean; map: string;
}

export interface PanelHost {
  style: Style;
  looks: Record<string, { name: string; note: string; style: { palette?: Partial<Palette> } }>;
  currentLook: () => string;
  applyLook: (k: string) => void;
  molecule: () => Molecule;
  lookPreview: (k: string, w: number, h: number) => Promise<HTMLCanvasElement | null>;
  openFileDialog: () => void;
  rebuild: () => void; redraw: () => void;
  camera: Camera;
  onLive: (v: boolean) => void; onTurntable: (v: number) => void; onPitchSwing: (v: number) => void; onRest: (v: string) => void; renderNow: () => void;
  play: (v: boolean) => void; isPlaying: () => boolean; seek: (f: number) => void; step: (d: number) => void;
  /* density maps */
  loadMap: (f: File) => Promise<void>; fetchMap: (id: string) => Promise<void>; mapForEntry: () => Promise<void>; clearMap: () => void; hasMap: () => boolean; hasStructure: () => boolean;
  mapInfo: () => { name: string; level: number; sigma: number; recommended: number | null; mean: number; rms: number; size: number[]; step: number; binned: number; atomInclusion: number | null } | null;
  savePng: () => void; saveStyle: () => void; loadStyle: (f: File) => void; loadFile: (f: File) => void; loadFiles: (f: File[]) => void; saveScene: () => void; loadExample: (n: string) => void; fetchPdb: (id: string) => Promise<void>;
  /* figure labels */
  figLabels: () => { i: number; text: string; where: string; size: number }[]; setLabelText: (i: number, t: string) => void; setLabelSize: (i: number, v: number) => void;
  deleteLabel: (i: number) => void; clearLabels: () => void; setLabelMode: (v: boolean) => void; labelMode: () => boolean;
  /* active site */
  pocketSel: (dist?: number) => string; frameSite: () => void; labelSite: () => void; reset: () => void;
  setDpr: (v: number) => void;
  palettes: Record<string, Palette>;
  framePresets: Record<string, { box: { x0: number; y0: number; x1: number; y1: number }; note: string; size: [number, number] }>;
  fitFrame: (box: { x0: number; y0: number; x1: number; y1: number }, what: 'all' | 'frame') => void;
  showGuides: (box: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  renderCommand: () => string; canvasSize: () => [number, number];
  groupPalettes: Record<string, { colors: string[]; source: string; family: string }>;
  groups: () => { key: string }[]; groupColor: (k: string) => string; setGroupColor: (k: string, v: string | null) => void; hasOverride: (k: string) => boolean;
  /** undo history: call before a change, with a label; continuous edits with the same label coalesce */
  mark: (label: string, scene?: boolean) => void; settle: () => void; undo: () => void; redo: () => void; historyState: () => { undo: string; redo: string };
  /* keyframes */
  fps: number; hasScene: () => boolean; keyframes: () => { i: number; name: string; hold: number; transition: number; atoms: number; arrows: number; view: boolean; path: boolean }[];
  currentKey: () => number; loopSeconds: () => number; setKeyTiming: (i: number, holdS: number, transS: number) => void; setKeyName: (i: number, name: string) => void; goToKey: (i: number) => void;
  keyStarts: () => number[];
  duplicateKey: (i: number) => void; deleteKey: (i: number) => void; moveKey: (i: number, j: number) => void; setKeyView: (i: number, on: boolean) => void;
  setShowChanges: (v: boolean) => void; setHoverChanges: (v: boolean) => void; diffNote: () => string;
  /* authoring */
  setAuthorMode: (m: string) => void; authorMode: () => string; authorText: () => string; arrowsOf: () => { j: number; text: string; side: number; bulge: number }[]; editArrow: (j: number, what: 'flip' | 'delete' | 'bulge', v?: number) => void;
  /* checks */
  lint: () => { level: string; kf: number | null; text: string }[]; relint: () => void;
  /* views */
  suggest: (onProgress: (msg: string) => void) => Promise<{ yaw: number; pitch: number; roll: number; score: number; parts: Record<string, number>; canvas?: HTMLCanvasElement }[]>; adoptView: (v: any) => void;
  /* render */
  hasWebCodecs: () => boolean; codecSupport: (w: number, h: number) => Promise<Record<string, { codec: string; quantizer: boolean } | null>>;
  renderToFile: (o: { width: number; height: number; codec: any; quality: any; onProgress: (done: number, total: number, bytes: number, eta: number) => void }) => Promise<{ name: string; bytes: number; seconds: number; codecString: string }>;
  cancelRender: () => void; savePoster: (w: number, h: number, frame?: number, type?: 'image/jpeg' | 'image/png') => void;
  saveSvg: (w: number, h: number) => void; hasSdk: () => boolean; posterFrame: () => number; setRenderSize: (s: [number, number] | null) => void; drawnFrames: () => number;
}

/** `when`: the control is shown only while this holds (e.g. engraved settings only for the engraved cartoon) */
type Ctl = (
  | { t: 'range'; label: string; path: string; min: number; max: number; step: number; geom?: boolean }
  | { t: 'select'; label: string; path: string; options: (string | [string, string])[]; geom?: boolean }
  | { t: 'seg'; label: string; path: string; options: [string, string][]; geom?: boolean }
  | { t: 'text'; label: string; path: string; geom?: boolean; placeholder?: string }
  | { t: 'color'; label: string; path: string; geom?: boolean }
  | { t: 'check'; label: string; path: string; geom?: boolean }) & { when?: () => boolean; tip?: string };

const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
/** a text set only when it changes (setting it anew, even to the same words, has the panel laid out again) */
const setText = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t };
const set = (o: any, path: string, v: any) => { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v };
const store = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { } } };

/* icons: 16-unit line drawings */
const ICONS: Record<string, string> = {
  drawing: 'M3 13l1.5-4L11 2.5a1.4 1.4 0 0 1 2 2L6.5 11 3 13zM9.5 4l2 2',
  protein: 'M2 11c1.5-3 3-3 4 0s2.5 3 4 0 2.5-3 4 0M2 5.5c1.5-3 3-3 4 0s2.5 3 4 0 2.5-3 4 0',
  nucleic: 'M4 2c0 4 8 4 8 8s-8 4-8 4M12 2c0 4-8 4-8 8s8 4 8 4M5 5h6M5 11h6',
  ligand: 'M8 2l5 3v6l-5 3-5-3V5zM8 2v4M13 11l-3.5-2M3 11l3.5-2',
  sidechain: 'M3 13V9l3-2 3 2M9 9l3-2v-4M6 7V3',
  water: 'M8 2.5s4.5 5 4.5 8a4.5 4.5 0 0 1-9 0c0-3 4.5-8 4.5-8z',
  map: 'M3 5.5C3 3.5 5 2 8 2s5 1.5 5 3.5-1 3-1 4.5 1 1.5 1 2.5c0 1.5-2 2-5 2s-5-.5-5-2c0-1 1-1 1-2.5S3 7.5 3 5.5z',
  site: 'M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  labels: 'M2.5 3.5h8l3 4.5-3 4.5h-8zM5.5 8h.01',
  camera: 'M2 5.5h3l1.2-2h3.6l1.2 2h3v7.5H2zM8 11a2.4 2.4 0 1 0 0-4.8A2.4 2.4 0 0 0 8 11z',
  scene: 'M2.5 3h11v10h-11zM6.5 6l3.5 2-3.5 2z',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  eyeoff: 'M2 2l12 12M6.6 3.7A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.4M10.3 11.9A6.5 6.5 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.6-3.1',
  plus: 'M8 3v10M3 8h10', open: 'M2 4.5h4l1.5 1.5H14v7H2z', undo: 'M5.5 3 2.5 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H7', redo: 'M10.5 3l3 3-3 3M13.5 6H6a3.5 3.5 0 0 0 0 7h3',
  reset: 'M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5', spin: 'M13 8a5 5 0 1 1-2-4M13 2.5V5h-2.5', snap: 'M2 5.5h3l1.2-2h3.6l1.2 2h3v7.5H2zM8 11a2.4 2.4 0 1 0 0-4.8A2.4 2.4 0 0 0 8 11z',
  label: 'M2.5 3.5h8l3 4.5-3 4.5h-8zM5.5 8h.01', help: 'M6 6a2 2 0 1 1 2.8 1.8C8.3 8 8 8.4 8 9v.5M8 12h.01', close: 'M4 4l8 8M12 4l-8 8', export: 'M8 2v8M5 5l3-3 3 3M2.5 10v3.5h11V10',
  chev: 'M5 6.5l3 3 3-3',
};
const icon = (k: string) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 16 16'); e.setAttribute('class', 'i'); e.innerHTML = `<path d="${ICONS[k] || ''}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`; return e };

/** the known parts of the sticks selection, in the order they are joined */
const STICKS: [string, string][] = [['ligands', 'hetatm and not water'], ['sidechains', 'sidechain'], ['water', 'water'], ['polymer', 'polymer'], ['all', 'all']];

export function buildPanel(root: HTMLElement, H: PanelHost) {
  const refreshers: (() => void)[] = [];
  const vis: [HTMLElement, () => boolean][] = [];
  const showWhen = (e: HTMLElement, f: () => boolean) => { vis.push([e, f]); e.style.display = f() ? '' : 'none'; return e };
  const updateVis = () => { for (const [e, f] of vis) e.style.display = f() ? '' : 'none' };
  refreshers.push(updateVis);
  const el = (tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) (e as any)[k] = attrs[k]; else e.setAttribute(k, attrs[k]) } for (const c of kids) e.append(c); return e };
  const note = (text: string, cls = '') => el('div', { class: 'note ' + cls }, text);
  const row = (parent: HTMLElement, label: string, ...kids: Node[]) => { const r = el('div', { class: 'row' }, el('label', {}, label), ...kids); parent.append(r); return r };
  const S = () => H.style; const has = (sel: string) => !!(sel && sel.trim());
  const after = (geom?: boolean) => { geom ? H.rebuild() : H.redraw(); refresh() };
  /** a segmented choice: a few named options, one on */
  const segOf = (options: [string, string][], getV: () => string, setV: (v: string) => void, big = false) => {
    const s = el('div', { class: 'seg' + (big ? ' big' : '') }); const bs = options.map(([v, t]) => { const b = el('button', { onclick: () => { setV(v); refresh() } }, t) as HTMLButtonElement; b.dataset.v = v; s.append(b); return b });
    refreshers.push(() => { const v = getV(); bs.forEach(b => b.classList.toggle('on', b.dataset.v === v)) }); return s;
  };
  const control = (parent: HTMLElement, c: Ctl) => {
    const n0 = parent.children.length;
    if (c.t === 'range') {
      const inp = el('input', { type: 'range', min: c.min, max: c.max, step: c.step }) as HTMLInputElement; const val = el('span', { class: 'val' });
      const show = () => { const v = get(H.style, c.path); inp.value = String(v); val.textContent = Number(v).toFixed(c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0) };
      inp.oninput = () => { H.mark(c.label); set(H.style, c.path, +inp.value); show(); c.geom ? H.rebuild() : H.redraw(); updateVis() }; inp.onchange = () => H.settle(); refreshers.push(show); show(); row(parent, c.label, inp, val);
    } else if (c.t === 'select') {
      const s = el('select', {}, ...c.options.map(o => typeof o === 'string' ? el('option', { value: o }, o) : el('option', { value: o[0] }, o[1]))) as HTMLSelectElement;
      const show = () => { s.value = String(get(H.style, c.path)) }; s.onchange = () => { H.mark(c.label); set(H.style, c.path, s.value); after(c.geom) }; refreshers.push(show); show(); row(parent, c.label, s);
    } else if (c.t === 'seg') {
      const r = row(parent, c.label, segOf(c.options, () => String(get(H.style, c.path)), v => { H.mark(c.label); set(H.style, c.path, v); c.geom ? H.rebuild() : H.redraw() })); r.classList.add('full');
    } else if (c.t === 'text') {
      const inp = el('input', { type: 'text', placeholder: c.placeholder || '' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) ?? '' }; inp.onchange = () => { H.mark(c.label); set(H.style, c.path, inp.value); after(c.geom) }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'color') {
      const inp = el('input', { type: 'color' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) }; inp.oninput = () => { H.mark(c.label); set(H.style, c.path, inp.value); c.geom ? H.rebuild() : H.redraw() }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'check') {
      const inp = el('input', { type: 'checkbox' }) as HTMLInputElement;
      const show = () => { inp.checked = !!get(H.style, c.path) }; inp.onchange = () => { H.mark(c.label); set(H.style, c.path, inp.checked); after(c.geom) }; refreshers.push(show); show(); row(parent, c.label, inp);
    }
    const r = parent.children[n0] as HTMLElement | undefined;
    if (r) { if (c.tip) r.title = c.tip; if (c.when) showWhen(r, c.when) }
  };
  /** a selection field with one-click choices; the text stays editable for anything else */
  const selControl = (parent: HTMLElement, label: string, path: string, choices: [string, string][], tip: string, placeholder = 'nothing') => {
    const inp = el('input', { type: 'text', placeholder, spellcheck: 'false' }) as HTMLInputElement;
    const chips = el('div', { class: 'chips' });
    const apply = (v: string) => { if (v === '__site__') v = H.style.site.sel || ''; H.mark(label); set(H.style, path, v); H.rebuild(); refresh() };
    const bs = choices.map(([t, v]) => { const b = el('button', { class: 'chip', title: v ? 'selection: ' + v : 'none', onclick: () => apply(v) }, t) as HTMLButtonElement; b.dataset.v = v; chips.append(b); return b });
    inp.onchange = () => apply(inp.value);
    const show = () => { const v = (get(H.style, path) ?? '').trim(); inp.value = v; bs.forEach(b => b.classList.toggle('on', b.dataset.v === v)) }; refreshers.push(show); show();
    const r = el('div', { class: 'row sel', title: tip }, el('label', {}, label), el('div', { class: 'selbox' }, chips, inp)); parent.append(r); return r;
  };

  /* ---------- what is drawn: the representations, from the layers' switches ---------- */
  const stickParts = () => { const v = (S().reps.sticks || '').trim(); const known = new Set<string>(); if (!v) return { known, custom: false };
    for (const p of v.split(/\s+or\s+/)) { const k = STICKS.find(([, s]) => s === p.trim().replace(/^\((.*)\)$/, '$1')); if (!k) return { known, custom: true }; known.add(k[0]) } return { known, custom: false } };
  const setStickPart = (k: string, on: boolean) => { const { known, custom } = stickParts(); if (custom) { S().reps.sticks = on ? `(${S().reps.sticks}) or ${STICKS.find(s => s[0] === k)![1]}` : S().reps.sticks; return }
    if (on) known.add(k); else known.delete(k); S().reps.sticks = STICKS.filter(([n]) => known.has(n)).map(([, s]) => s).join(' or ') };
  const hiddenChains = (): string[] => { for (const r of [S().reps.cartoon, S().reps.surface]) { const m = (r || '').match(/^polymer and not chain ([\w+]+)$/); if (m) return m[1].split('+') } return [] };
  const polySel = (hidden = hiddenChains()) => 'polymer' + (hidden.length ? ` and not chain ${hidden.join('+')}` : '');
  const polyRep = () => { const c = has(S().reps.cartoon), su = has(S().reps.surface), st = stickParts().known; return c && su ? 'both' : c ? 'cartoon' : su ? 'surface' : st.has('polymer') || st.has('all') ? 'sticks' : 'hidden' };
  let lastPoly = 'cartoon';
  const setPolyRep = (v: string) => { const sel = polySel(); S().reps.cartoon = v === 'cartoon' || v === 'both' ? sel : ''; S().reps.surface = v === 'surface' || v === 'both' ? sel : ''; setStickPart('polymer', v === 'sticks'); if (v !== 'hidden') lastPoly = v };
  const setChainHidden = (id: string, hide: boolean) => { const h = new Set(hiddenChains()); if (hide) h.add(id); else h.delete(id); const sel = polySel([...h]);
    if (has(S().reps.cartoon)) S().reps.cartoon = sel; if (has(S().reps.surface)) S().reps.surface = sel };
  const cartoonOn = () => has(S().reps.cartoon), surfaceOn = () => has(S().reps.surface), sticksOn = () => has(S().reps.sticks);
  const engraved = () => cartoonOn() && S().cartoonStyle === 'engraved';
  const fillIs = (...f: string[]) => f.includes(S().fill);
  /** the group palettes, the colours chains, residues and molecules take in order: hover to preview, click to keep.
      Engraved ribbons take three of them for helix, sheet and coil. The studies fold under "More palettes" */
  const palettePicker = (parent: HTMLElement) => {
    const tiles: HTMLElement[] = []; let kept: { name: string; colors: string[] | null; ss: string[] } | null = null;
    const SS = ['helix', 'sheet', 'loop'] as const;
    const getSS = () => SS.map(k => H.style.palette[k]); const setSS = (v: string[]) => SS.forEach((k, i) => { H.style.palette[k] = v[i] });
    const applyPal = (name: string, colors: string[]) => { H.style.groupPalette = name === 'MolSketch' ? null : colors.slice(); H.style.groupPaletteName = name;
      if (H.style.cartoonStyle === 'engraved') { const base = H.looks[H.currentLook()]?.style.palette; if (name !== 'MolSketch') setSS(ribbonColours(colors, H.style.palette.paper, H.style.palette.ink)); else if (base) setSS(SS.map(k => base[k] ?? H.style.palette[k])) }
      H.rebuild() };
    const grid = (fam: string) => { const g = el('div', { class: 'paltiles' });
      for (const name of Object.keys(H.groupPalettes)) { const gp = H.groupPalettes[name]; if (gp.family !== fam) continue;
        const t = el('div', { class: 'paltile', title: name + ' — ' + gp.source }, el('div', { class: 'bands' }, ...gp.colors.map(c => { const i = el('i'); i.style.background = c; return i })), el('span', {}, name)); t.dataset.name = name;
        t.onmouseenter = () => { if (!kept) kept = { name: H.style.groupPaletteName, colors: H.style.groupPalette, ss: getSS() }; applyPal(name, gp.colors) };
        t.onmouseleave = () => { if (kept) { H.style.groupPalette = kept.colors; H.style.groupPaletteName = kept.name; setSS(kept.ss); kept = null; H.rebuild() } };
        t.onclick = () => { const k = kept; kept = null; if (k) { H.style.groupPalette = k.colors; H.style.groupPaletteName = k.name; setSS(k.ss) } H.mark('palette ' + name); applyPal(name, gp.colors); refresh() };
        g.append(t); tiles.push(t) } return g };
    parent.append(grid('drawing'), el('div', { class: 'famhead' }, el('span', { class: 'subhead', style: 'margin:0' }, 'Colour-blind safe'), el('small', {}, 'Okabe–Ito, Tol, Tableau')), grid('safe'));
    const n = Object.values(H.groupPalettes).filter(p => p.family === 'studies').length;
    const more = el('div'); more.style.display = 'none'; more.append(grid('studies'));
    const moreB = el('button', { class: 'ghost', style: 'padding:3px 4px;font-size:11px', onclick: () => { const on = more.style.display === 'none'; more.style.display = on ? '' : 'none'; moreB.textContent = on ? 'Fewer palettes' : `More palettes (${n})` } }, `More palettes (${n})`) as HTMLButtonElement;
    parent.append(moreB, more);
    refreshers.push(() => { const cur = H.style.groupPaletteName || 'MolSketch'; tiles.forEach(e => e.classList.toggle('on', e.dataset.name === cur)); if (tiles.some(t => t.dataset.name === cur && more.contains(t))) { more.style.display = ''; moreB.textContent = 'Fewer palettes' } });
  };

  /* ---------- inspector: one pane per layer, and a search over all of them ---------- */
  const search = el('input', { type: 'search', class: 'search', placeholder: 'Search settings  ( / )', spellcheck: 'false' }) as HTMLInputElement;
  const panesEl = el('div', { class: 'panes' });
  const empty = note('No setting matches. Some only appear when they apply, such as watercolour settings for the watercolour fill.'); empty.style.display = 'none';
  root.append(el('div', { class: 'phead' }, search), panesEl, empty);
  type Pane = { key: string; el: HTMLElement; title: HTMLElement; sub: HTMLElement };
  const panes: Pane[] = [];
  let current = store.get('ms.layer') || 'drawing';
  const pane = (key: string, title: string, ic: string) => { const t = el('h3', {}, title), sub = el('div', { class: 'psub' });
    const p = el('div', { class: 'pane', 'data-pane': key }, el('div', { class: 'ptitle' }, el('span', { class: 'oi' }, icon(ic)), t), sub); panesEl.append(p); const P = { key, el: p, title: t, sub }; panes.push(P); return P };
  const secs: { d: HTMLElement; title: string; keys: string }[] = [];
  /** a section of a pane: always open (open undefined), or folded away (`open: false`) */
  const sec = (P: Pane, title: string, o: { open?: boolean; keys?: string; tip?: string } = {}) => {
    let d: HTMLElement;
    if (o.open === undefined) { d = el('div', { class: 'sec' }, el('div', { class: 'sh' }, title)) }
    else { d = el('details', { class: 'sec' }, el('summary', o.tip ? { title: o.tip } : {}, title)); const k = 'ms.open.' + P.key + '.' + title; const saved = store.get(k); (d as HTMLDetailsElement).open = saved ? saved === '1' : !!o.open;
      d.addEventListener('toggle', () => { if (!search.value.trim()) store.set(k, (d as HTMLDetailsElement).open ? '1' : '0') }) }
    P.el.append(d); secs.push({ d, title, keys: (o.keys || '').toLowerCase() }); return d;
  };
  let wasOpen: boolean[] | null = null;
  const runSearch = () => {
    const q = search.value.trim().toLowerCase(); root.classList.toggle('searching', !!q);
    if (q && !wasOpen) wasOpen = secs.map(g => g.d instanceof HTMLDetailsElement ? g.d.open : true); if (!q && wasOpen) { secs.forEach((g, i) => { if (g.d instanceof HTMLDetailsElement) g.d.open = wasOpen![i] }); wasOpen = null }
    let hits = 0;
    for (const g of secs) {
      const whole = !q || g.title.toLowerCase().includes(q) || g.keys.includes(q);
      let any = false;
      for (const c of Array.from(g.d.children) as HTMLElement[]) { if (c.tagName === 'SUMMARY' || c.classList.contains('sh')) continue;
        const m = !q || whole || (c.textContent || '').toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q);
        c.classList.toggle('nomatch', !m); if (m && c.style.display !== 'none') any = true }
      g.d.classList.toggle('nomatch', !whole && !any); if (q && g.d instanceof HTMLDetailsElement) g.d.open = true; if (q && (whole || any) && g.d.style.display !== 'none') hits++;
    }
    empty.style.display = q && !hits ? '' : 'none'; layout();
  };
  search.oninput = runSearch; search.onkeydown = e => { if (e.key === 'Escape') { search.value = ''; runSearch(); search.blur() } };
  window.addEventListener('keydown', e => { const t = (e.target as HTMLElement)?.tagName; if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') { e.preventDefault(); search.focus() } });
  const layout = () => { const q = !!search.value.trim(); for (const p of panes) { const hasHit = !!p.el.querySelector('.sec:not(.nomatch)'); p.el.style.display = q ? (hasHit ? '' : 'none') : p.key === current ? '' : 'none' } const rowOn = outlineRows.some(r => r.id === currentRow && r.key === current) ? currentRow : current; outlineRows.forEach(r => r.el.classList.toggle('sel', !q && r.id === rowOn)) };
  const select = (key: string) => { if (!panes.some(p => p.key === key)) key = 'drawing'; current = key; store.set('ms.layer', key); if (search.value) { search.value = ''; runSearch() } layout(); refresh() };

  /* ---------- the layers of the picture (left) ---------- */
  const outline = document.getElementById('outline')!;
  type ORow = { key: string; id: string; el: HTMLElement };
  let outlineRows: ORow[] = []; let outlineKey = ''; let currentRow = store.get('ms.row') || current;
  const orow = (key: string, ic: string, title: string, sub: string, eye?: { on: boolean; toggle: () => void; tip: string }, cls = '', swatch?: string, id = key) => {
    const r = el('div', { class: 'orow ' + cls + (eye && !eye.on ? ' off' : ''), tabindex: '0', role: 'button' }, swatch ? el('i', { class: 'sw8', style: `background:${swatch}` }) : el('span', { class: 'oi' }, icon(ic)), el('span', { class: 'ot' }, el('b', {}, title), ...(sub ? [el('span', {}, sub)] : [])));
    if (eye) { const b = el('button', { class: 'eye', title: eye.tip, 'aria-label': eye.tip, onclick: (e: Event) => { e.stopPropagation(); eye.toggle(); refresh() } }, icon(eye.on ? 'eye' : 'eyeoff')); r.append(b) }
    const pick = () => { currentRow = id; store.set('ms.row', id); select(key) };
    r.onclick = pick; r.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } };
    outline.append(r); outlineRows.push({ key, id, el: r }); return r;
  };
  const buildOutline = () => {
    const m = H.molecule(); const st = stickParts(); const hid = hiddenChains();
    const key = JSON.stringify([m, S().reps, S().map.visible, S().show.noLabels, S().site.sel, H.hasScene(), H.figLabels().length, H.currentLook(), H.mapInfo()?.sigma?.toFixed(1), S().groupPaletteName, S().colorBy, S().cartoonColor]);
    if (key === outlineKey) return; outlineKey = key; outline.innerHTML = ''; outlineRows = [];
    outline.append(el('div', { class: 'ohead' }, 'Style'));
    orow('drawing', 'drawing', 'Drawing style', H.looks[H.currentLook()]?.name || 'custom');
    if (m.kind === 'structure' || m.kind === 'scene') {
      outline.append(el('div', { class: 'ohead' }, m.kind === 'scene' ? 'Molecules' : 'Molecule'));
      if (m.protein || m.nucleic || m.kind === 'scene') {
        const rep = polyRep(); const title = m.kind === 'scene' ? 'Molecules' : m.protein && m.nucleic ? 'Protein & nucleic acid' : m.nucleic ? 'Nucleic acid' : 'Protein';
        const repName: Record<string, string> = { cartoon: 'cartoon', surface: 'surface', both: 'cartoon and surface', sticks: 'sticks', hidden: 'hidden' };
        orow('protein', m.nucleic && !m.protein ? 'nucleic' : 'protein', title, m.kind === 'scene' ? (sticksOn() ? 'sticks' : 'hidden') : `${repName[rep]}${m.chains.length > 1 ? ` · ${m.chains.length} chains` : ''}`,
          m.kind === 'scene' ? undefined : { on: rep !== 'hidden', toggle: () => { H.mark('show protein'); setPolyRep(rep === 'hidden' ? lastPoly : 'hidden'); H.rebuild() }, tip: rep === 'hidden' ? 'show' : 'hide' });
        if (m.chains.length > 1 && m.chains.length <= 24 && m.kind === 'structure' && (cartoonOn() || surfaceOn()))
          for (const c of m.chains) orow('protein', '', `Chain ${c.id}`, c.desc ? c.desc.toLowerCase() : `${c.residues} residues`, { on: !hid.includes(c.id), toggle: () => { H.mark('chain ' + c.id); setChainHidden(c.id, !hid.includes(c.id)); H.rebuild() }, tip: hid.includes(c.id) ? 'show chain' : 'hide chain' }, 'ochild', H.groupColor(c.id), 'chain:' + c.id);
        if (m.protein && m.kind === 'structure') orow('sticks', 'sidechain', 'Side chains', st.known.has('sidechains') ? 'sticks' : 'hidden', { on: st.known.has('sidechains'), toggle: () => { H.mark('side chains'); setStickPart('sidechains', !st.known.has('sidechains')); H.rebuild() }, tip: 'side chains as sticks' }, 'ochild', undefined, 'sidechains');
      }
      if (m.ligands.length) orow('sticks', 'ligand', 'Ligands', m.ligands.slice(0, 4).join(', ') + (m.ligands.length > 4 ? ` +${m.ligands.length - 4}` : ''), { on: st.known.has('ligands') || st.known.has('all'), toggle: () => { H.mark('ligands'); setStickPart('ligands', !st.known.has('ligands')); H.rebuild() }, tip: 'ligands as sticks' }, '', undefined, 'ligands');
      if (m.water) orow('sticks', 'water', 'Water', `${m.water} molecules`, { on: st.known.has('water') || st.known.has('all'), toggle: () => { H.mark('water'); setStickPart('water', !st.known.has('water')); H.rebuild() }, tip: 'water as sticks' }, '', undefined, 'water');
    }
    outline.append(el('div', { class: 'ohead' }, 'Density'));
    const mi = H.mapInfo();
    if (mi) orow('map', 'map', mi.name, `contour ${mi.sigma.toFixed(1)} σ${mi.recommended != null && Math.abs(mi.level - mi.recommended) < 1e-6 ? ' (recommended)' : ''}`, { on: S().map.visible !== false, toggle: () => { H.mark('map'); S().map.visible = S().map.visible === false; H.redraw() }, tip: 'show or hide the map' });
    else orow('map', 'plus', 'Add a density map', 'from EMDB, or a file', undefined, 'add');
    if (m.kind === 'structure' || m.kind === 'scene') {
      outline.append(el('div', { class: 'ohead' }, 'Annotate'));
      orow('site', 'site', 'Active site', S().site.sel.trim() ? S().site.sel.trim() : 'none');
      const nl = H.figLabels().length; orow('labels', 'labels', 'Labels', nl ? `${nl} placed` : 'none placed', { on: !S().show.noLabels, toggle: () => { H.mark('labels'); S().show.noLabels = !S().show.noLabels; H.redraw() }, tip: 'show or hide every label' });
    }
    if (H.hasScene()) { outline.append(el('div', { class: 'ohead' }, 'Animation')); orow('scene', 'scene', 'Keyframes', `${H.keyframes().length} keyframes · ${H.loopSeconds().toFixed(1)} s`) }
    outline.append(el('div', { class: 'ohead' }, 'View'));
    orow('camera', 'camera', 'Camera & light', H.camera.fov < 1 ? 'flat projection' : `perspective ${H.camera.fov}°`);
    layout();
  };
  refreshers.push(buildOutline);

  /* ---------- top bar ---------- */
  const top = document.getElementById('topbar') || root;
  const fileIn = el('input', { type: 'file', id: 'fileIn', accept: '.pdb,.ent,.cif,.mmcif,.json,.map,.mrc,.ccp4,.gz', multiple: '', style: 'display:none', onchange: (e: any) => { const fl = Array.from(e.target.files as FileList); if (fl.length) H.loadFiles(fl); e.target.value = '' } }) as HTMLInputElement;
  const examples: [string, string][] = [['trypsin_active_site.json', 'Trypsin active site'], ['mechanism.json', 'Serine hydrolase mechanism'], ['calb_pnpa.json', 'CALB with pNPA'], ['1A8O.pdb', 'HIV capsid domain (1A8O)'], ['1LCD.pdb', 'Lac repressor headpiece (1LCD)'], ['test_protein.pdb', 'Small test protein'], ['test_protein_rna.cif', 'Protein with RNA'], ['6GZQ.cif', 'Ribosome (6GZQ, large)']];
  const toastErr = (m: string) => { const t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('on', 'err'); setTimeout(() => t.classList.remove('on', 'err'), 5000) };
  /** an ID field and its button: PDB (four characters) or EMDB */
  const idForm = (placeholder: string, valid: (v: string) => boolean, go: (v: string) => Promise<void>, label = 'Fetch') => {
    const inp = el('input', { type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement; const btn = el('button', { type: 'submit' }, label) as HTMLButtonElement;
    const f = el('form', {}, inp, btn) as HTMLFormElement; const upd = () => { btn.disabled = !valid(inp.value.trim()) }; inp.oninput = upd; upd();
    f.onsubmit = async e => { e.preventDefault(); if (btn.disabled) return; btn.disabled = true; inp.disabled = true; btn.textContent = '…'; closeMenus();
      try { await go(inp.value.trim()); inp.value = '' } catch (err: any) { toastErr(err.message) } finally { inp.disabled = false; btn.textContent = label; upd() } };
    return { f, inp };
  };
  const isPdb = (v: string) => /^[0-9][a-z0-9]{3}$/i.test(v), isEmdb = (v: string) => /^(emd[-_]?)?\d{4,6}$/i.test(v);
  const menus: HTMLElement[] = []; const closeMenus = () => menus.forEach(m => m.classList.remove('on'));
  document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.menuwrap')) closeMenus() });
  const openMenu = el('div', { class: 'menu', role: 'menu' }); menus.push(openMenu);
  const pdbF = idForm('PDB ID, e.g. 1A8O', isPdb, v => H.fetchPdb(v)), emdbF = idForm('EMDB ID, e.g. EMD-11638', isEmdb, async v => { await H.fetchMap(v); select('map') });
  openMenu.append(el('button', { class: 'mi', onclick: () => { closeMenus(); fileIn.click() } }, icon('open'), 'Open a file…', el('small', {}, 'PDB, mmCIF, scene, map')),
    el('div', { class: 'mhead' }, 'From the Protein Data Bank'), pdbF.f, el('div', { class: 'mhead' }, 'A cryo-EM map from EMDB'), emdbF.f,
    el('div', { class: 'msep' }), el('div', { class: 'mhead' }, 'Examples'),
    ...examples.map(([v, t]) => el('button', { class: 'mi', onclick: () => { closeMenus(); H.loadExample(v) } }, t)));
  const openBtn = el('button', { onclick: () => { const on = !openMenu.classList.contains('on'); closeMenus(); openMenu.classList.toggle('on', on); if (on) pdbF.inp.focus() } }, icon('open'), ' Open', icon('chev'));
  const undoB = el('button', { class: 'icon ghost', onclick: H.undo, 'aria-label': 'undo' }, icon('undo')) as HTMLButtonElement, redoB = el('button', { class: 'icon ghost', onclick: H.redo, 'aria-label': 'redo' }, icon('redo')) as HTMLButtonElement;
  const docName = el('b', {}, ''); const docInfo = el('span', { id: 'fileinfo' });
  top.append(el('div', { class: 'brand' }, el('i'), 'MolSketch'), el('div', { class: 'menuwrap' }, openBtn, openMenu), fileIn, el('div', { class: 'doc' }, docName, docInfo), el('div', { class: 'spacer' }),
    undoB, redoB, el('button', { class: 'icon ghost', title: 'Mouse and keyboard (?)', 'aria-label': 'help', onclick: () => toggleHelp() }, icon('help')),
    el('button', { class: 'primary', title: 'a picture at any size, SVG, video, scene and style files', onclick: () => openExport() }, icon('export'), ' Export'));
  const refreshHistory = () => { const h = H.historyState(); undoB.disabled = !h.undo; redoB.disabled = !h.redo; undoB.title = h.undo ? 'Undo ' + h.undo + ' (Ctrl-Z)' : 'Nothing to undo'; redoB.title = h.redo ? 'Redo ' + h.redo + ' (Ctrl-Shift-Z)' : 'Nothing to redo' };
  refreshers.push(refreshHistory, () => { const m = H.molecule(); docName.textContent = m.name || 'Nothing loaded'; document.title = m.name ? `${m.name} · MolSketch` : 'MolSketch' });

  /* ---------- on the drawing: the dock, the empty state, help ---------- */
  const stage = document.getElementById('stage');
  const help = el('div', { class: 'help', role: 'dialog', 'aria-label': 'mouse and keyboard' },
    el('b', {}, 'Mouse and keyboard'),
    ...([['drag', 'rotate'], ['shift-drag · right-drag', 'pan'], ['wheel', 'zoom'], ['arrow keys', 'nudge the view'], ['r', 'reset the view'], ['Ctrl-Z · Ctrl-Shift-Z', 'undo · redo'], ['/', 'search settings'], ['L', 'add a label; drag one to move it, double-click to edit, Delete to remove'], ['space · , · .', 'play · step back · step on (animations)'], ['drop files', 'open a structure, scene or map; several structures make an animation']] as [string, string][]).map(([k, v]) => el('div', { class: 'kv' }, el('kbd', {}, k), el('span', {}, v))),
    el('button', { onclick: () => toggleHelp(false) }, 'Close'));
  const toggleHelp = (v?: boolean) => { help.classList.toggle('on', v ?? !help.classList.contains('on')) };
  window.addEventListener('keydown', e => { const t = (e.target as HTMLElement)?.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return; if (e.key === '?') toggleHelp(); else if (e.key === 'Escape') { toggleHelp(false); closeMenus(); closeExport() } });
  const addBtns: HTMLButtonElement[] = [];
  const addLabelBtn = (inDock: boolean) => { const b = el('button', { class: inDock ? '' : 'primary', title: 'then click the drawing: on an atom the label follows it as the molecule turns (L)', onclick: () => H.setLabelMode(!H.labelMode()) }, icon('plus'), inDock ? ' Label' : ' Add a label') as HTMLButtonElement; b.dataset.dock = inDock ? '1' : ''; addBtns.push(b); return b };
  refreshers.push(() => addBtns.forEach(b => { b.classList.toggle('on', H.labelMode()); const t = b.lastChild as Text; t.textContent = H.labelMode() ? ' Click the drawing…' : b.dataset.dock ? ' Label' : ' Add a label' }));
  let spinning = false;
  const spinB = el('button', { title: 'turn the molecule slowly (turntable)', onclick: () => { spinning = !spinning; H.onTurntable(spinning ? 20 : 0); refresh() } }, icon('spin')) as HTMLButtonElement;
  refreshers.push(() => spinB.classList.toggle('on', spinning));
  const dock = el('div', { class: 'dock' },
    el('button', { title: 'reset the view (r)', onclick: () => { H.mark('reset view'); Object.assign(H.camera, { yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0 }); refresh(); H.redraw() } }, icon('reset')), spinB,
    el('span', { class: 'dsep' }), addLabelBtn(true), el('span', { class: 'dsep' }),
    el('button', { title: 'save what is on screen as a PNG', onclick: H.savePng }, icon('snap')));
  const emptyPdb = idForm('PDB ID, e.g. 1A8O', isPdb, v => H.fetchPdb(v)); emptyPdb.f.style.cssText = 'display:flex;gap:6px'; (emptyPdb.inp as HTMLInputElement).style.cssText = 'flex:1;text-transform:uppercase';
  const emptyEl = el('div', { class: 'empty' }, el('div', { class: 'card' }, el('h2', {}, 'Start with a molecule'), el('p', {}, 'Fetch an entry from the Protein Data Bank, open a file, or drop one here.'),
    emptyPdb.f, el('div', { class: 'btns' }, el('button', { onclick: () => fileIn.click() }, icon('open'), ' Open a file…'), el('button', { onclick: () => H.loadExample('trypsin_active_site.json') }, 'Try an example'))));
  stage?.append(help, dock, emptyEl);
  refreshers.push(() => { const k = H.molecule().kind; emptyEl.classList.toggle('on', !k); dock.style.display = k ? '' : 'none' });

  /* ======================= Drawing style ======================= */
  const PD = pane('drawing', 'Drawing style', 'drawing');
  refreshers.push(() => { PD.sub.textContent = 'How the whole picture is drawn: the look, the pen, the paper.' });
  {
    const g = sec(PD, 'Look', { keys: 'preset style watercolour ink engraved chalk pencil' });
    const grid = el('div', { class: 'gallery' }); g.append(grid);
    const btns: HTMLButtonElement[] = []; const thumbs: Record<string, HTMLElement> = {};
    for (const k in H.looks) { const L = H.looks[k]; const P = L.style.palette || {};
      const th = el('span', { class: 'th' }); th.style.background = P.paper || '#faf8f3'; thumbs[k] = th;
      const b = el('button', { onclick: () => H.applyLook(k), title: L.note }, th, el('span', { class: 'gl' }, L.name)) as HTMLButtonElement; b.dataset.key = k; grid.append(b); btns.push(b) }
    refreshers.push(() => btns.forEach(b => b.classList.toggle('on', b.dataset.key === H.currentLook())));
    // thumbnails of the loaded molecule in each look, drawn one at a time when the drawing is idle
    let thumbKey = '', queue: string[] = [], timer = 0;
    let thumbGen = 0;
    const drawNext = () => { const k = queue.shift(); if (!k) return; const gen = thumbGen;
      H.lookPreview(k, 200, 150).then(c => { if (gen !== thumbGen) return; const th = thumbs[k]; th.innerHTML = ''; if (c) th.append(c); timer = window.setTimeout(drawNext, 30) }) };
    refreshers.push(() => { const m = H.molecule(); const key = JSON.stringify([m.name, m.atoms, m.map, S().reps, current]); if (current !== 'drawing' || key === thumbKey || navigator.webdriver) return;   // not in scripted browsers (the CLI) thumbKey = key; clearTimeout(timer); thumbGen++;
      if (!m.kind || m.atoms > 30000) { for (const k in thumbs) thumbs[k].innerHTML = ''; return } queue = Object.keys(thumbs); timer = window.setTimeout(drawNext, 250) });
  }
  {
    const g = sec(PD, 'Palette', { keys: 'palette colours colors okabe tol tableau colour-blind chains residues groups' });
    g.append(note('The colours chains, residues and molecules take in order. Hover to preview, click to keep.'));
    palettePicker(g);
  }
  {
    const g = sec(PD, 'Adjust', { keys: 'fill hand shading line width pen' });
    control(g, { t: 'select', label: 'fill', path: 'fill', options: [['watercolour', 'Watercolour'], ['ink colour', 'Ink with colour'], ['ink', 'Ink'], ['pencil', 'Coloured pencil'], ['chalk', 'Chalk'], ['flat', 'Flat colour'], ['wash', 'Pale wash']] });
    const hIn = el('input', { type: 'range', min: 0, max: 1, step: 0.01 }) as HTMLInputElement; const hV = el('span', { class: 'val' });
    const showH = () => { const h = handOf(H.style); hIn.value = String(h); hV.textContent = h.toFixed(2) };
    hIn.oninput = () => { H.mark('hand'); const x = hand(+hIn.value); Object.assign(H.style.line, x.line); H.style.fillWobble = x.fillWobble; refresh(); H.redraw() }; hIn.onchange = () => H.settle();
    refreshers.push(showH); showH(); row(g, 'hand', hIn, hV).title = 'how hand-drawn the line is: 0 ruled, like an engraving, 1 a loose sketch';
    control(g, { t: 'range', label: 'line weight', path: 'line.width', min: 0.3, max: 4, step: 0.1 });
    control(g, { t: 'range', label: 'shading', path: 'shading', min: 0, max: 1, step: 0.05 });
  }
  {
    const g = sec(PD, 'Details', { open: false, keys: 'annotations hydrogens lone pairs charges arrows caption h-bonds valence' });
    for (const [k, label] of [['H', 'hydrogens'], ['hbonds', 'hydrogen bonds'], ['arrows', 'curly arrows'], ['lonePairs', 'lone pairs'], ['charges', 'charges'], ['valence', 'valence'], ['caption', 'caption'], ['stepLabel', 'step label']]) control(g, { t: 'check', label, path: 'show.' + k });
    control(g, { t: 'range', label: 'caption size', path: 'captionSize', min: 12, max: 48, step: 1, when: () => !!S().show.caption });
  }
  {
    const g = sec(PD, 'Pen', { open: false, keys: 'ink pen stroke roughness width hand wobble sketchy crisp passes pressure' });
    control(g, { t: 'range', label: 'roughness', path: 'line.rough', min: 0, max: 3, step: 0.05 });
    control(g, { t: 'range', label: 'passes', path: 'line.passes', min: 1, max: 4, step: 1 });
    control(g, { t: 'range', label: 'hierarchy', path: 'line.hierarchy', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'pressure', path: 'line.pressure', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'opacity', path: 'line.alpha', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'fill wobble', path: 'fillWobble', min: 0, max: 2, step: 0.05, when: () => !fillIs('ink', 'ink colour') });
    control(g, { t: 'range', label: 'pencil fill', path: 'pencilFill', min: 0, max: 1, step: 0.05, when: () => fillIs('pencil', 'chalk') });
    control(g, { t: 'check', label: 'construction', path: 'construction', tip: 'faint guide geometry: stick axes, circles round atoms' });
  }
  {
    const g = sec(PD, 'Hatching', { open: false, keys: 'hatch spacing angle density' }); showWhen(g, () => fillIs('ink', 'ink colour', 'pencil', 'chalk') || S().shading > 0);
    control(g, { t: 'range', label: 'spacing', path: 'hatch.spacing', min: 2, max: 14, step: 0.5 });
    control(g, { t: 'range', label: 'angle', path: 'hatch.angle', min: -90, max: 90, step: 5 });
    control(g, { t: 'range', label: 'density', path: 'hatch.density', min: 0, max: 2.5, step: 0.05 });
  }
  {
    const g = sec(PD, 'Watercolour', { open: false, keys: 'layers wobble drying ring granulation tone' }); showWhen(g, () => fillIs('watercolour'));
    control(g, { t: 'range', label: 'layers', path: 'water.layers', min: 1, max: 4, step: 1 });
    control(g, { t: 'range', label: 'wobble', path: 'water.wobble', min: 0, max: 3, step: 0.05 });
    control(g, { t: 'range', label: 'drying ring', path: 'water.ring', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'granulation', path: 'water.granulation', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'tone', path: 'water.tone', min: 0, max: 1.5, step: 0.05 });
  }
  {
    const g = sec(PD, 'Paper', { open: false, keys: 'grain wash background paper' });
    control(g, { t: 'color', label: 'paper', path: 'palette.paper' });
    control(g, { t: 'color', label: 'ink', path: 'palette.ink' });
    control(g, { t: 'range', label: 'grain', path: 'paper.grain', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'wash', path: 'paper.wash', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'wash pattern', path: 'paper.washSeed', min: 1, max: 40, step: 1 });
    control(g, { t: 'range', label: 'wash scale', path: 'paper.washScale', min: 0.3, max: 3, step: 0.05 });
    control(g, { t: 'range', label: 'wash life', path: 'paper.washLife', min: 0, max: 2, step: 0.05 });
  }

  /* ---- every colour, and the paper-and-ink presets (under Drawing style) ---- */
  let selected: { get: () => string; set: (v: string) => void; label: string } | null = null;
  const hexIn = el('input', { type: 'text', placeholder: '#rrggbb', spellcheck: 'false' }) as HTMLInputElement; const hexLabel = el('span', { class: 'note' }, 'click a swatch to pick its colour');
  hexIn.oninput = () => { if (selected && /^#[0-9a-f]{6}$/i.test(hexIn.value)) { H.mark('colour ' + selected.label); selected.set(hexIn.value.toLowerCase()); refresh(); H.redraw() } };
  const swatch = (parent: HTMLElement, label: string, getC: () => string, setC: (v: string) => void, opts: { auto?: () => boolean; clear?: () => void } = {}) => {
    const inp = el('input', { type: 'color' }) as HTMLInputElement; const i = el('i'); const d = el('div', { class: 'sw', title: label }, i, el('span', {}, label), inp);
    const show = () => { const v = getC(); i.style.background = v; inp.value = v; d.classList.toggle('auto', !!opts.auto?.()); d.classList.toggle('on', selected?.label === label); if (selected?.label === label) { hexIn.value = v; hexLabel.textContent = label + (opts.auto?.() ? ' (from the palette)' : '') } };
    d.onclick = (e) => { if (e.target === inp) return; selected = { get: getC, set: setC, label }; refresh(); inp.click() };
    d.oncontextmenu = (e) => { e.preventDefault(); if (opts.clear) { H.mark('colour ' + label); opts.clear(); refresh() } };
    inp.oninput = () => { H.mark('colour ' + label); setC(inp.value); show(); H.redraw() }; inp.onchange = () => { setC(inp.value); refresh() };
    refreshers.push(show); show(); parent.append(d); return d;
  };
  const stylePal = (key: string, geom = false) => [() => (H.style.palette as any)[key] as string, (v: string) => { (H.style.palette as any)[key] = v; if (geom) H.rebuild() }] as const;
  const swatchRow = (parent: HTMLElement, title: string, keys: string[], geom = false) => { parent.append(el('div', { class: 'subhead' }, title)); const g = el('div', { class: 'swatches' }); parent.append(g); for (const k of keys) { const [g2, s2] = stylePal(k, geom); swatch(g, k, g2, s2) } };
  {
    const g = sec(PD, 'All colours', { open: false, keys: 'swatch hex helix sheet loop nucleic surface element carbon nitrogen oxygen paper ink hatch wash arrow charge label context accent presets pymol sepia' });
    g.append(el('div', { class: 'hexrow' }, hexIn, hexLabel));
    swatchRow(g, 'ribbons and surface', ['helix', 'sheet', 'loop', 'nucleic', 'surface'], true);
    swatchRow(g, 'elements', ['C', 'N', 'O', 'H', 'S', 'P', 'X'], true);
    swatchRow(g, 'paper and marks', ['paper', 'ink', 'hatch', 'wash', 'arrow', 'charge', 'label', 'context', 'accent']);
    g.append(el('div', { class: 'subhead' }, 'paper and ink presets (replace every colour)'));
    const pstrips = el('div', { class: 'strips' }); g.append(pstrips);
    for (const name of Object.keys(H.palettes)) { const P = H.palettes[name]; const st = el('div', { class: 'strip' }, el('div', { class: 'chips' }, ...['paper', 'ink', 'C', 'N', 'O', 'helix', 'sheet', 'wash'].map(k => { const i = el('i'); i.style.background = (P as any)[k]; return i })), el('span', {}, name)); st.onclick = () => { H.mark('palette ' + name); H.style.palette = { ...P }; refresh(); H.rebuild() }; pstrips.append(st) }
  }
  {
    const g = sec(PD, 'Style file', { open: false, keys: 'save load reset style json' });
    const styleIn = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadStyle(f); e.target.value = '' } }) as HTMLInputElement;
    g.append(el('div', { class: 'btns' }, el('button', { onclick: H.saveStyle, title: 'every setting, as JSON' }, 'Save style'), el('button', { onclick: () => styleIn.click() }, 'Load style…'), styleIn, el('button', { onclick: H.reset, title: 'back to the default style (undoable)' }, 'Reset')));
    g.append(note('The style is also kept in this browser between visits.'));
  }

  /* ======================= The molecule: polymer, sticks ======================= */
  const PP = pane('protein', 'Protein', 'protein');
  refreshers.push(() => { const m = H.molecule(); PP.title.textContent = m.kind === 'scene' ? 'Molecules' : m.protein && m.nucleic ? 'Protein & nucleic acid' : m.nucleic ? 'Nucleic acid' : 'Protein'; PP.sub.textContent = m.kind === 'structure' ? `${m.residues.toLocaleString()} residues · ${m.atoms.toLocaleString()} atoms${m.chains.length > 1 ? ` · ${m.chains.length} chains` : ''}` : m.kind === 'scene' ? 'the molecules of this animation' : '' });
  {
    const g = sec(PP, 'Draw as', { keys: 'representation cartoon ribbon surface sticks hidden' });
    g.append(segOf([['cartoon', 'Cartoon'], ['surface', 'Surface'], ['both', 'Both'], ['sticks', 'Sticks'], ['hidden', 'Hidden']], polyRep, v => { H.mark('draw as ' + v); setPolyRep(v); H.rebuild() }, true));
    control(g, { t: 'seg', label: 'ribbons', path: 'cartoonStyle', options: [['sketch', 'Sketched'], ['engraved', 'Engraved']], when: cartoonOn, tip: 'sketched: hand-drawn ribbons in the fill · engraved: line-shaded ribbons after MOLSCRIPT' });
  }
  {
    const g = sec(PP, 'Colour', { keys: 'colour color scheme secondary structure chain residue rainbow palette' }); showWhen(g, () => cartoonOn() || surfaceOn());
    const scheme = () => S().cartoonColor === 'ss' ? 'ss' : S().cartoonColor === 'rainbow' ? 'rainbow' : S().colorBy === 'chain' ? 'chain' : S().colorBy === 'element' ? 'element' : 'residue';
    const setScheme = (v: string) => { H.mark('colour by ' + v); if (v === 'ss') S().cartoonColor = 'ss'; else if (v === 'rainbow') S().cartoonColor = 'rainbow'; else { S().cartoonColor = 'carbon'; S().colorBy = v as any } if (surfaceOn()) S().surfaceColor = v === 'chain' ? 'chain' : v === 'residue' ? 'residue' : S().surfaceColor; H.rebuild() };
    const r = row(g, 'colour by', segOf([['ss', 'Structure'], ['chain', 'Chain'], ['residue', 'Residue'], ['rainbow', 'Rainbow']], scheme, setScheme)); r.classList.add('full'); r.title = 'structure: helix, sheet and loop colours · chain · residue · rainbow: blue to red along each chain (engraved ribbons)'; showWhen(r, cartoonOn);
    control(g, { t: 'select', label: 'surface by', path: 'surfaceColor', options: [['subunit', 'subunit'], ['chain', 'chain'], ['entity', 'molecule'], ['residue', 'residue'], ['single', 'one colour']], geom: true, when: surfaceOn });
    g.append(el('div', { class: 'subhead' }, 'palette')); palettePicker(g);
    const ss = el('div'); g.append(ss); showWhen(ss, () => S().cartoonColor === 'ss');
    ss.append(el('div', { class: 'subhead' }, 'helix, sheet, loop')); const ssw = el('div', { class: 'swatches' }); ss.append(ssw); for (const k of ['helix', 'sheet', 'loop', 'nucleic']) { const [g2, s2] = stylePal(k, true); swatch(ssw, k, g2, s2) }
  }
  {
    const g = sec(PP, 'Colours of parts', { open: false, keys: 'residue chain molecule override group colour' });
    g.append(note('Click one to give it a colour of its own; right-click to hand it back to the palette.'));
    const gsw = el('div', { class: 'swatches' }); g.append(gsw); let gswKeys = '';
    refreshers.push(() => { const gs = H.groups(); g.style.display = gs.length ? '' : 'none'; const key = gs.map(g => g.key).join('|'); if (key === gswKeys) return; gswKeys = key; gsw.innerHTML = '';
      for (const gr of gs) swatch(gsw, gr.key, () => H.groupColor(gr.key), v => H.setGroupColor(gr.key, v), { auto: () => !H.hasOverride(gr.key), clear: () => H.setGroupColor(gr.key, null) }) });
  }
  {
    const g = sec(PP, 'Cartoon', { open: false, keys: 'ribbon helix sheet engraved molscript scale lines strand coil' }); showWhen(g, cartoonOn);
    control(g, { t: 'range', label: 'scale', path: 'cartoonScale', min: 0.4, max: 2.5, step: 0.05, geom: true });
    control(g, { t: 'range', label: 'lines per face', path: 'engrave.lines', min: 0, max: 14, step: 1, when: engraved });
    control(g, { t: 'range', label: 'line weight', path: 'engrave.width', min: 0.1, max: 2, step: 0.05, when: engraved });
    control(g, { t: 'range', label: 'strand thickness', path: 'engrave.strandThickness', min: 0, max: 1.2, step: 0.05, when: engraved });
    control(g, { t: 'range', label: 'coil width', path: 'engrave.coilWidth', min: 0.5, max: 2.5, step: 0.05, when: engraved });
  }
  {
    const g = sec(PP, 'Surface', { open: false, keys: 'probe depth edges pooling fade' }); showWhen(g, surfaceOn);
    control(g, { t: 'range', label: 'probe', path: 'probe', min: 0, max: 3, step: 0.1, geom: true });
    const wc = () => S().fill === 'watercolour';
    control(g, { t: 'range', label: 'depth edges', path: 'surfaceDepth.edges', min: 0, max: 1, step: 0.05, when: wc, tip: 'ink lines where the surface stands in front of something far behind' });
    control(g, { t: 'range', label: 'pooling', path: 'surfaceDepth.pooling', min: 0, max: 1, step: 0.05, when: wc, tip: 'pigment settling in the grooves: recesses darker' });
    control(g, { t: 'range', label: 'fade', path: 'surfaceDepth.fade', min: 0, max: 1, step: 0.05, when: wc, tip: 'far parts fade into the paper with the depth fog' });
  }
  {
    const g = sec(PP, 'Selections', { open: false, keys: 'selection advanced custom resi chain resn' });
    g.append(note('What each representation draws, as a selection: all · polymer · hetatm · protein · nucleic · resi 10-20 · resn SER+HIS · chain A, combined with and / or / not. The switches in the layers list write these for you.'));
    selControl(g, 'cartoon', 'reps.cartoon', [['none', ''], ['polymer', 'polymer'], ['protein', 'protein'], ['nucleic', 'nucleic']], 'residues drawn as ribbons');
    selControl(g, 'surface', 'reps.surface', [['none', ''], ['polymer', 'polymer'], ['everything', 'all']], 'residues drawn as a surface');
    selControl(g, 'sticks', 'reps.sticks', [['none', ''], ['ligands', 'hetatm and not water'], ['side chains', 'sidechain'], ['everything', 'all']], 'atoms drawn as sticks');
  }
  const PS = pane('sticks', 'Sticks', 'ligand');
  refreshers.push(() => { const m = H.molecule(); PS.sub.textContent = m.ligands.length ? `Ligands here: ${m.ligands.join(', ')}` : 'Atoms and bonds: ligands, side chains, water.' });
  {
    const g = sec(PS, 'Show as sticks', { keys: 'ligands side chains water sticks' });
    const toggleRow = (label: string, k: string, when?: () => boolean) => { const inp = el('input', { type: 'checkbox' }) as HTMLInputElement; inp.onchange = () => { H.mark(label); setStickPart(k, inp.checked); H.rebuild(); refresh() };
      refreshers.push(() => { const p = stickParts(); inp.checked = p.known.has(k) || p.known.has('all'); inp.disabled = p.known.has('all') }); const r = row(g, label, inp); if (when) showWhen(r, when) };
    toggleRow('ligands', 'ligands', () => H.molecule().ligands.length > 0); toggleRow('side chains', 'sidechains', () => H.molecule().protein); toggleRow('water', 'water', () => H.molecule().water > 0);
    const custom = note('The sticks follow a selection of your own (Protein › Selections).'); g.append(custom); showWhen(custom, () => stickParts().custom);
  }
  {
    const g = sec(PS, 'Appearance', { keys: 'ball stick radius engraved sketch carbons colour' }); showWhen(g, sticksOn);
    control(g, { t: 'seg', label: 'drawn as', path: 'mode', options: [['sticks', 'Sticks'], ['ballstick', 'Ball & stick']], geom: true });
    control(g, { t: 'seg', label: 'line', path: 'stickStyle', options: [['auto', 'Auto'], ['engraved', 'Engraved'], ['sketch', 'Sketched']], geom: true, tip: 'engraved: lines along each bond, like the ribbons · sketched: hand-drawn · auto: engraved when the ribbons are' });
    control(g, { t: 'select', label: 'carbons by', path: 'colorBy', options: [['residue', 'residue'], ['element', 'element (grey)'], ['chain', 'chain'], ['subunit', 'subunit'], ['entity', 'molecule']], geom: true });
    control(g, { t: 'range', label: 'thickness', path: 'stickRadius', min: 0.08, max: 0.5, step: 0.01, geom: true });
    control(g, { t: 'range', label: 'atom spheres', path: 'sphereScale', min: 0, max: 1, step: 0.05, geom: true });
    const g2 = el('div'); g.append(g2); swatchRow(g2, 'elements', ['C', 'N', 'O', 'S', 'P', 'H', 'X'], true);
  }

  /* ======================= Density map ======================= */
  const PM = pane('map', 'Density map', 'map');
  const hasMap = () => H.hasMap();
  {
    const g = sec(PM, 'Add a map', { keys: 'cryo-em emdb mrc ccp4 density map electron microscopy fetch open' }); showWhen(g, () => !hasMap());
    g.append(note('A cryo-EM density map, on its own or with the model built into it.'));
    const f = idForm('EMDB ID, e.g. EMD-11638', isEmdb, v => H.fetchMap(v)); f.f.style.cssText = 'display:flex;gap:6px;margin:8px 0'; f.inp.style.flex = '1'; g.append(f.f);
    const mapIn = el('input', { type: 'file', accept: '.map,.mrc,.ccp4,.gz', style: 'display:none', onchange: (e: any) => { const fl = e.target.files?.[0]; if (fl) H.loadMap(fl).then(refresh); e.target.value = '' } }) as HTMLInputElement;
    const entryB = el('button', { title: 'the map this PDB entry was built into (from RCSB and EMDB)', onclick: () => H.mapForEntry().then(refresh) }, 'The map of this entry');
    g.append(el('div', { class: 'btns stack' }, showWhen(entryB, () => H.hasStructure()), el('button', { onclick: () => mapIn.click() }, 'Open a map file…'), mapIn));
    g.append(note('Or drop a .map, .mrc or .ccp4 file on the drawing. Maps come from EMDB with the depositors’ recommended contour level.'));
  }
  const info = note('', 'box');
  {
    const g = sec(PM, 'Contour', { keys: 'level sigma threshold contour recommended' }); showWhen(g, hasMap);
    const bigV = el('b'), bigS = el('span'); g.append(el('div', { class: 'big' }, bigV, bigS));
    const sig = el('input', { type: 'range', min: 0.5, max: 12, step: 0.1, style: 'width:100%;margin:8px 0 4px' }) as HTMLInputElement;
    const lvIn = el('input', { type: 'text', spellcheck: 'false', style: 'width:7em' }) as HTMLInputElement;
    const recB = el('button', { title: 'the depositors’ recommended level (EMDB)', onclick: () => { H.mark('contour'); S().map.level = null; S().map.sigma = null; H.redraw(); refresh() } }, 'Recommended') as HTMLButtonElement;
    const show = () => { const m = H.mapInfo(); if (!m) return; sig.value = String(m.sigma); bigV.textContent = m.sigma.toFixed(1) + ' σ'; bigS.textContent = `level ${+m.level.toPrecision(3)}`; lvIn.value = String(+m.level.toPrecision(4));
      const isRec = m.recommended != null && S().map.level == null && S().map.sigma == null; recB.disabled = m.recommended == null || isRec; recB.textContent = isRec ? 'Recommended ✓' : 'Recommended' };
    sig.oninput = () => { H.mark('contour'); S().map.sigma = +sig.value; S().map.level = null; H.redraw(); refresh() }; sig.onchange = () => H.settle();
    lvIn.onchange = () => { const v = parseFloat(lvIn.value); if (!isFinite(v)) return; H.mark('contour'); S().map.level = v; S().map.sigma = null; H.redraw(); refresh() };
    refreshers.push(show); g.append(sig, el('div', { class: 'btns' }, el('span', { class: 'note', style: 'margin:0' }, 'level'), lvIn, recB)); show();
    g.append(info);
    refreshers.push(() => { const m = H.mapInfo(); if (!m) return; info.innerHTML = ''; info.append(el('b', {}, m.name), el('span', {}, ` · ${m.size.join('×')} at ${m.step.toFixed(2)} Å${m.binned > 1 ? ` (averaged ${m.binned}×)` : ''}`), ...(m.atomInclusion != null ? [el('br'), el('span', {}, `${(m.atomInclusion * 100).toFixed(0)}% of the model’s atoms inside the contour`)] : [])) });
  }
  {
    const g = sec(PM, 'Appearance', { keys: 'style surface mesh slice layers shading outline behind over lines' }); showWhen(g, hasMap);
    control(g, { t: 'seg', label: 'with the model', path: 'map.layer', options: [['auto', 'Behind'], ['over', 'Over'], ['lines', 'Outline']], when: () => H.hasStructure(), tip: 'behind: the model is drawn over the map and keeps its colour · over: a translucent envelope over the model · outline: only the map’s outline, over the model' });
    control(g, { t: 'seg', label: 'drawn as', path: 'map.style', options: [['surface', 'Surface'], ['mesh', 'Mesh'], ['slice', 'Slice'], ['layers', 'Layers']], tip: 'surface · mesh: chicken wire, as Coot · slice: a section through the map · layers: several contours nested' });
    control(g, { t: 'range', label: 'shading', path: 'map.shade', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'outline', path: 'map.lineWidth', min: 0.2, max: 2.5, step: 0.05 });
    control(g, { t: 'range', label: 'opacity', path: 'map.opacity', min: 0.1, max: 1, step: 0.05, when: () => H.hasStructure() && S().map.layer === 'over' });
    control(g, { t: 'range', label: 'slice depth', path: 'map.slice.offset', min: -0.5, max: 0.5, step: 0.01, when: () => S().map.style === 'slice' });
    const lvls = el('input', { type: 'text', spellcheck: 'false', placeholder: '0.7, 1, 1.5' }) as HTMLInputElement;
    lvls.onchange = () => { const v = lvls.value.split(/[\s,]+/).map(Number).filter(x => isFinite(x) && x > 0); if (v.length) { H.mark('levels'); S().map.levels = v; H.redraw() } };
    refreshers.push(() => { lvls.value = (S().map.levels || []).join(', ') }); showWhen(row(g, 'levels (× contour)', lvls), () => S().map.style === 'layers');
  }
  {
    const g = sec(PM, 'Close-up on residues', { open: false, keys: 'zone carve side chain residues close up' }); showWhen(g, () => hasMap() && H.hasStructure());
    g.append(note('Only the map around a selection, at full resolution, over its residues: they are drawn as sticks and framed, and the ribbons in front of them fade.'));
    selControl(g, 'zone', 'map.zone', [['none', ''], ['active site', '__site__']], 'only the map around these atoms', 'e.g. resi 93 and not hydro');
    control(g, { t: 'range', label: 'carve (Å)', path: 'map.carve', min: 0, max: 8, step: 0.5, tip: 'only the density this close to the model (or the zone); the caption says when it is on' });
  }
  {
    const g = sec(PM, 'Honesty marks', { open: false, keys: 'unsupported unexplained caption b-factor looseness' }); showWhen(g, hasMap);
    control(g, { t: 'check', label: 'caption', path: 'map.caption', tip: 'a line under the drawing that says how the map is shown: its level, filtering, carving' });
    control(g, { t: 'check', label: 'unsupported residues', path: 'map.unsupported', when: () => H.hasStructure(), tip: 'a small circle on residues whose atoms are mostly outside the density' });
    control(g, { t: 'check', label: 'unexplained density', path: 'map.unexplained', when: () => H.hasStructure(), tip: 'density the model does not explain (a ligand, a missing loop) in the accent colour' });
    control(g, { t: 'seg', label: 'line looseness', path: 'map.localResolution', options: [['none', 'Even'], ['bfactor', 'From B-factors']], when: () => H.hasStructure(), tip: 'lines looser where the model’s B-factors are high, as a stand-in for local resolution' });
  }
  {
    const g = sec(PM, 'Processing', { open: false, keys: 'low-pass smooth finish marks smoothing specks crop context assembly' }); showWhen(g, hasMap);
    control(g, { t: 'select', label: 'low-pass', path: 'map.smooth', options: [['auto', 'auto (whole particles)'], ['0', 'none'], ['3', '3 Å'], ['4', '4 Å'], ['5', '5 Å'], ['6', '6 Å'], ['8', '8 Å'], ['12', '12 Å']], tip: 'the map smoothed to what the picture can show (the density above the contour, then contoured to enclose the molecule’s mass)' });
    control(g, { t: 'seg', label: 'marks', path: 'map.marks', options: [['ink', 'Ink'], ['look', 'The look’s']] });
    control(g, { t: 'seg', label: 'finish', path: 'map.finish', options: [['drawn', 'Drawn'], ['smooth', 'Lit'], ['sketch', 'Raw']], tip: 'drawn: a smooth surface in the look’s marks · lit: plainly lit, as ChimeraX · raw: the grid, hand-drawn' });
    control(g, { t: 'range', label: 'smoothing', path: 'map.smoothing', min: 0, max: 10, step: 1, when: () => S().map.finish !== 'sketch' });
    control(g, { t: 'range', label: 'specks under', path: 'map.speck', min: 0, max: 20, step: 1, tip: 'islands and holes smaller than this many pixels are left out' });
    control(g, { t: 'range', label: 'crop margin', path: 'map.crop', min: 0, max: 20, step: 1, when: () => H.hasStructure(), tip: 'Å around the model’s box' });
    control(g, { t: 'seg', label: 'rest of assembly', path: 'map.context', options: [['hide', 'Hide'], ['show', 'Show faintly']], when: () => H.hasStructure() });
  }
  {
    const g = sec(PM, 'Map', { open: false, keys: 'remove map' }); showWhen(g, hasMap);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.clearMap(); refresh() } }, 'Remove the map')));
  }
  refreshers.push(() => { PM.sub.textContent = hasMap() ? (H.hasStructure() ? 'Drawn with the model built into it.' : 'Drawn on its own.') : '' });

  /* ======================= Active site ======================= */
  const PT = pane('site', 'Active site', 'site');
  PT.sub.textContent = 'Residues shown as bold sticks inside their protein.';
  {
    const g = sec(PT, 'Residues', { keys: 'site pocket catalytic residues ligand binding focus' });
    const inp = el('input', { type: 'text', placeholder: 'e.g. resi 57+102+195', spellcheck: 'false', style: 'width:100%;font:11px ui-monospace,Menlo,monospace' }) as HTMLInputElement;
    const setSite = (v: string) => { H.mark('active site'); H.style.site.sel = v; H.rebuild(); refresh() };
    inp.onchange = () => setSite(inp.value.trim());
    g.append(el('div', { class: 'chips', style: 'margin-bottom:6px' },
      el('button', { class: 'chip', title: 'every residue within 5 Å of the largest ligand, and the ligand', onclick: () => { const v = H.pocketSel(5); if (v) setSite(v) } }, 'Around the ligand'),
      el('button', { class: 'chip', onclick: () => setSite('') }, 'None')), inp);
    refreshers.push(() => { inp.value = S().site.sel || '' });
    const on = () => !!S().site.sel.trim();
    g.append(showWhen(el('div', { class: 'btns' }, el('button', { title: 'turn the molecule so the site faces you', onclick: () => H.frameSite() }, 'Turn to face it'), el('button', { title: 'a label on each residue of the site', onclick: () => H.labelSite() }, 'Label it')), on));
    control(g, { t: 'range', label: 'emphasis', path: 'site.scale', min: 1, max: 2.4, step: 0.05, geom: true, when: on, tip: 'how much thicker the site is drawn than other sticks' });
    control(g, { t: 'check', label: 'cut away', path: 'site.cutaway', when: () => on() && engraved(), tip: 'ribbon faces in front of the site fade in a window round it' });
    control(g, { t: 'range', label: 'quiet the rest', path: 'site.quiet', min: 0, max: 1, step: 0.05, when: () => on() && engraved() });
  }

  /* ======================= Labels ======================= */
  const PL = pane('labels', 'Labels', 'labels');
  PL.sub.textContent = 'Click the drawing to place one; on an atom it follows that residue.';
  {
    const g = sec(PL, 'Your labels', { keys: 'add place text annotate custom figure' });
    g.append(el('div', { class: 'btns' }, addLabelBtn(false)));
    const list = el('div', { class: 'lbllist' }); g.append(list);
    const clearRow = el('div', { class: 'btns' }, el('button', { onclick: () => H.clearLabels() }, 'Remove all')); g.append(clearRow);
    g.append(note('Drag a label to move it, double-click to edit, right-click or Delete to remove.'));
    let key = '';
    refreshers.push(() => { const ls = H.figLabels(); clearRow.style.display = ls.length ? '' : 'none'; const k = JSON.stringify(ls); if (k === key) return; key = k; list.innerHTML = '';
      for (const l of ls) { const t = el('input', { type: 'text', value: l.text, spellcheck: 'false', 'aria-label': 'label text' }) as HTMLInputElement; t.onchange = () => H.setLabelText(l.i, t.value);
        const sz = el('select', { title: 'size', 'aria-label': 'size' }, ...[['0.75', 'S'], ['1', 'M'], ['1.4', 'L'], ['2', 'XL']].map(([v, n]) => el('option', { value: v }, n))) as HTMLSelectElement;
        sz.value = String([0.75, 1, 1.4, 2].reduce((b, v) => Math.abs(v - l.size) < Math.abs(b - l.size) ? v : b, 1)); sz.onchange = () => H.setLabelSize(l.i, +sz.value);
        list.append(el('div', { class: 'lbl' }, t, sz, el('button', { title: 'delete', onclick: () => H.deleteLabel(l.i) }, '✕'), el('span', { class: 'where' }, l.where))) } });
  }
  {
    const g = sec(PL, 'Automatic labels', { keys: 'hide labels alpha beta helix strand residue atom secondary structure' });
    control(g, { t: 'check', label: 'placed labels', path: 'show.figLabels', tip: 'the labels you added' });
    control(g, { t: 'check', label: 'atom names', path: 'show.labels', tip: 'names a scene gives its atoms, such as His57' });
    control(g, { t: 'check', label: 'residues', path: 'show.resLabels', tip: 'every residue drawn as sticks, by name and number' });
    control(g, { t: 'check', label: 'α / β', path: 'engrave.labels', when: engraved, tip: 'α1, β1… on the engraved ribbons' });
  }
  {
    const g = sec(PL, 'Lettering', { keys: 'font size colour color' });
    control(g, { t: 'select', label: 'font', path: 'font', options: ['Caveat', 'Patrick Hand', 'Kalam', 'Plain sans'] });
    control(g, { t: 'range', label: 'size', path: 'labelSize', min: 10, max: 40, step: 1 });
    control(g, { t: 'color', label: 'colour', path: 'palette.label' });
  }

  /* ======================= Camera & light ======================= */
  const PC = pane('camera', 'Camera & light', 'camera');
  PC.sub.textContent = 'Drag to turn, shift-drag to pan, scroll to zoom.';
  {
    const g = sec(PC, 'Camera', { keys: 'perspective fov roll reset zoom pan' });
    const fov = el('input', { type: 'range', min: 0, max: 60, step: 1 }) as HTMLInputElement; const fovv = el('span', { class: 'val' });
    const showFov = () => { fov.value = String(H.camera.fov); fovv.textContent = H.camera.fov < 1 ? 'flat' : H.camera.fov + '°' };
    fov.oninput = () => { H.mark('perspective'); H.camera.fov = +fov.value; H.style.view.fov = +fov.value; showFov(); H.redraw() }; refreshers.push(() => { H.camera.fov = H.style.view.fov; showFov() }); showFov(); row(g, 'perspective', fov, fovv);
    const roll = el('input', { type: 'range', min: -180, max: 180, step: 1 }) as HTMLInputElement; const rollv = el('span', { class: 'val' });
    const showRoll = () => { roll.value = String(H.camera.roll); rollv.textContent = H.camera.roll + '°' };
    roll.oninput = () => { H.mark('roll'); H.camera.roll = +roll.value; showRoll(); H.redraw() }; refreshers.push(showRoll); showRoll(); row(g, 'roll', roll, rollv);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.mark('reset view'); Object.assign(H.camera, { yaw: 0, pitch: 0, roll: 0, zoom: 1, panX: 0, panY: 0 }); refresh(); H.redraw() } }, 'Reset view')));
  }
  {
    const g = sec(PC, 'Depth & light', { keys: 'fog light angle' });
    control(g, { t: 'range', label: 'depth fog', path: 'view.fog', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'fog starts', path: 'view.fogStart', min: 0, max: 1, step: 0.05, when: () => S().view.fog > 0 });
    control(g, { t: 'range', label: 'light from', path: 'view.light', min: -180, max: 180, step: 5 });
  }
  {
    const g = sec(PC, 'Suggested views', { open: false, keys: 'orientation best angle' });
    const svBtn = el('button', { title: 'score 120 orientations and draw the best twelve' }, 'Suggest views') as HTMLButtonElement; const svNote = el('span', { class: 'note' });
    g.append(el('div', { class: 'btns' }, svBtn, svNote)); const svGrid = el('div', { class: 'views' }); g.append(svGrid);
    svBtn.onclick = async () => { svBtn.disabled = true; svGrid.innerHTML = ''; try { const picks = await H.suggest(m => { svNote.textContent = m }); svGrid.innerHTML = '';
        picks.forEach((p, i) => { const t = el('div', { class: 'view', title: `yaw ${p.yaw} pitch ${p.pitch} roll ${p.roll.toFixed(0)}` }, p.canvas!, el('span', {}, `${i + 1} · score ${(p.score * 100).toFixed(0)}`)); t.onclick = () => H.adoptView(p); svGrid.append(t) });
        svNote.textContent = picks.length ? 'click one to take it' : 'load an animation first' } catch (e: any) { svNote.textContent = e.message } finally { svBtn.disabled = false } };
  }
  {
    const g = sec(PC, 'Fit to a frame', { open: false, keys: 'fit box hero guides layout' });
    const presetSel = el('select', {}, ...Object.keys(H.framePresets).map(k => el('option', { value: k }, k + ' — ' + H.framePresets[k].note)), el('option', { value: '' }, 'custom')) as HTMLSelectElement;
    const num = (v: number) => el('input', { type: 'number', min: 0, max: 100, step: 1, value: String(Math.round(v * 100)), class: 'num' }) as HTMLInputElement;
    const b0 = H.framePresets[Object.keys(H.framePresets)[0]].box; const L0 = num(b0.x0), T0 = num(b0.y0), R0 = num(b0.x1), B0 = num(b0.y1);
    const box = () => ({ x0: +L0.value / 100, y0: +T0.value / 100, x1: +R0.value / 100, y1: +B0.value / 100 });
    const guides = el('input', { type: 'checkbox' }) as HTMLInputElement; const updateGuides = () => H.showGuides(guides.checked ? box() : null);
    presetSel.onchange = () => { const p = H.framePresets[presetSel.value]; if (p) { L0.value = String(Math.round(p.box.x0 * 100)); T0.value = String(Math.round(p.box.y0 * 100)); R0.value = String(Math.round(p.box.x1 * 100)); B0.value = String(Math.round(p.box.y1 * 100)) } updateGuides() };
    for (const i of [L0, T0, R0, B0]) i.oninput = () => { presetSel.value = ''; updateGuides() }; guides.onchange = updateGuides;
    const what = el('select', {}, el('option', { value: 'all' }, 'the whole animation'), el('option', { value: 'frame' }, 'this frame only')) as HTMLSelectElement;
    row(g, 'preset', presetSel); g.append(el('div', { class: 'row' }, el('label', {}, 'box % l t r b'), el('div', { class: 'wide nums' }, L0, T0, R0, B0)));
    row(g, 'fit', what); row(g, 'show guides', guides);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.fitFrame(box(), what.value as 'all' | 'frame'); H.redraw() } }, 'Fit to frame')));
    g.append(note('Zoom and pan so the drawing fills a box of the canvas, for a layout with text beside it. Turn the view first.'));
  }
  {
    const g = sec(PC, 'Motion', { open: false, keys: 'turntable spin boil breathing pitch swing animate' });
    const liveIn = el('input', { type: 'checkbox', checked: '' }) as HTMLInputElement; liveIn.onchange = () => H.onLive(liveIn.checked); row(g, 'lines boil', liveIn).title = 'redraw the lines every so often, as hand-drawn animation boils';
    control(g, { t: 'range', label: 'boil every', path: 'boilEvery', min: 1, max: 12, step: 1 });
    control(g, { t: 'range', label: 'boil hold', path: 'boilHold', min: 1, max: 4, step: 1 });
    const tt = el('input', { type: 'range', min: 0, max: 90, step: 1, value: 0 }) as HTMLInputElement; const ttv = el('span', { class: 'val' }, '0');
    tt.oninput = () => { ttv.textContent = tt.value; spinning = +tt.value > 0; H.onTurntable(+tt.value); refresh() }; row(g, 'turntable °/s', tt, ttv);
    refreshers.push(() => { if (!spinning && tt.value !== '0') { tt.value = '0'; ttv.textContent = '0' } else if (spinning && tt.value === '0') { tt.value = '20'; ttv.textContent = '20' } });
    const ps = el('input', { type: 'range', min: 0, max: 40, step: 1, value: 0 }) as HTMLInputElement; const psv = el('span', { class: 'val' }, '0');
    ps.oninput = () => { psv.textContent = ps.value; H.onPitchSwing(+ps.value) }; row(g, 'pitch swing °', ps, psv);
  }
  {
    const g = sec(PC, 'Quality', { open: false, keys: 'engine classic sketch preview quality resolution performance detail texture' });
    const restSel = el('select', { onchange: (e: any) => H.onRest(e.target.value) }, ...[['classic', 'the finished drawing'], ['sketch', 'a quick sketch'], ['preview', 'the preview only']].map(([v, t]) => el('option', { value: v }, t))) as HTMLSelectElement; restSel.value = 'classic';
    row(g, 'at rest, show', restSel).title = 'what draws once the view stops moving';
    const dprSel = el('select', { onchange: (e: any) => H.setDpr(+e.target.value) }, ...['1', '2', '3'].map(o => el('option', { value: o }, o + '×'))) as HTMLSelectElement; dprSel.value = String(Math.min(2, Math.round(window.devicePixelRatio || 1)));
    row(g, 'resolution', dprSel);
    control(g, { t: 'seg', label: 'detail', path: 'detail', options: [['auto', 'Auto'], ['full', 'Full']], tip: 'auto: fewer passes on large structures · full: the whole treatment always' });
    control(g, { t: 'seg', label: 'texture', path: 'textureScale', options: [['screen', 'Screen'], ['object', 'Object']], tip: 'screen: hatching in pixels · object: it follows the drawing’s scale' });
    g.append(note('While you drag you see a fast preview; when the view rests the stroke engine draws the finished picture.'));
  }

  /* ======================= Keyframes (animations) ======================= */
  const PK = pane('scene', 'Keyframes', 'scene');
  PK.sub.textContent = 'The steps of the animation, their timing and camera.';
  const Kf = sec(PK, 'Keyframes', { keys: 'hold transition timing camera order' });
  const kfList = el('div', { class: 'kflist' }); Kf.append(kfList); const loopNote = note(''); Kf.append(loopNote);
  const chg = el('input', { type: 'checkbox' }) as HTMLInputElement; chg.onchange = () => H.setShowChanges(chg.checked); row(Kf, 'show changes', chg).title = 'ring what moves, leaves, arrives, breaks or forms on the way to the next keyframe';
  const chgNote = note(''); Kf.append(chgNote);
  let kfKey = '';
  const refreshKeys = () => {
    const ks = H.keyframes(); const cur = H.currentKey(); const key = JSON.stringify(ks) + '|' + cur; if (key === kfKey) return; kfKey = key; kfList.innerHTML = '';
    let dragFrom = -1;
    ks.forEach(k => {
      const name = el('input', { type: 'text', value: k.name, title: 'name' }) as HTMLInputElement; name.onchange = () => H.setKeyName(k.i, name.value);
      const hold = el('input', { type: 'number', min: 0, step: 0.1, value: k.hold.toFixed(2), title: 'hold, seconds' }) as HTMLInputElement, tr = el('input', { type: 'number', min: 0, step: 0.1, value: k.transition.toFixed(2), title: 'transition to the next keyframe, seconds' }) as HTMLInputElement;
      hold.onchange = tr.onchange = () => H.setKeyTiming(k.i, +hold.value, +tr.value);
      const cam = el('button', { class: k.view ? 'on' : '', title: k.view ? 'this keyframe has its own camera: click to clear it' : 'keep the current view as this keyframe\'s camera', onclick: () => H.setKeyView(k.i, !k.view) }, 'cam');
      const r = el('div', { class: 'kf' + (k.i === cur ? ' on' : ''), draggable: 'true' },
        el('span', { class: 'idx', title: 'drag to reorder · click to go there', onclick: () => H.goToKey(k.i) }, String(k.i + 1)), name,
        el('span', { class: 'timing' }, el('span', { class: 'lab' }, 'hold'), hold, el('span', { class: 'lab' }, 's · to next'), tr, el('span', { class: 'lab' }, 's')),
        el('span', { class: 'meta' }, `${k.atoms} atoms · ${k.arrows} arrow${k.arrows === 1 ? '' : 's'}${k.path ? ' · path' : ''}${k.view ? ' · camera' : ''}`),
        el('span', { class: 'acts' }, cam,
          el('button', { title: 'insert a copy after this keyframe', onclick: () => H.duplicateKey(k.i) }, 'dup'),
          el('button', { title: 'move up', onclick: () => H.moveKey(k.i, Math.max(0, k.i - 1)) }, '▲'), el('button', { title: 'move down', onclick: () => H.moveKey(k.i, Math.min(ks.length - 1, k.i + 1)) }, '▼'),
          el('button', { title: 'delete this keyframe', onclick: () => { if (ks.length > 1) H.deleteKey(k.i) } }, '✕')));
      r.ondragstart = e => { dragFrom = k.i; e.dataTransfer?.setData('text/plain', String(k.i)); r.classList.add('drag') }; r.ondragend = () => r.classList.remove('drag');
      r.ondragover = e => { e.preventDefault(); r.classList.add('over') }; r.ondragleave = () => r.classList.remove('over');
      r.ondrop = e => { e.preventDefault(); r.classList.remove('over'); if (dragFrom >= 0 && dragFrom !== k.i) H.moveKey(dragFrom, k.i); dragFrom = -1 };
      kfList.append(r);
    });
    const secs = H.loopSeconds(); const nv = ks.filter(k => k.view).length;
    loopNote.textContent = `Loop: ${secs.toFixed(2)} s, ${H.drawnFrames()} drawings at ${H.fps / 2} per second · ${nv ? nv + ' keyframe camera(s)' : 'one camera throughout'}`;
    buildTicks();
  };
  refreshers.push(refreshKeys);
  const Ch = sec(PK, 'Arrows & charges', { keys: 'chemistry author arrow lone pair charge curly' });
  const modes: [string, string, string][] = [['off', 'Look', 'clicks do nothing'], ['arrow', 'Arrow', 'click the tail (atom or bond), then the head'], ['lp', 'Lone pair', 'click an atom: a lone pair on / off'], ['charge', 'Charge', 'click an atom: none → + → − → none']];
  const modeBtns = el('div', { class: 'seg' }); Ch.append(el('div', { class: 'subhead', style: 'margin-top:0' }, 'clicking the drawing adds'), modeBtns); const mbs: HTMLButtonElement[] = [];
  for (const [m, label, tip] of modes) { const b = el('button', { title: tip, onclick: () => { H.setAuthorMode(m); refreshAuthor() } }, label) as HTMLButtonElement; b.dataset.mode = m; mbs.push(b); modeBtns.append(b) }
  const aText = el('div', { class: 'note', style: 'min-height:2.6em' }); Ch.append(aText);
  Ch.append(el('div', { class: 'subhead' }, 'arrows of this keyframe')); const arList = el('div', { class: 'arrows' }); Ch.append(arList);
  let arKey = '';
  const refreshAuthor = () => { const m = H.authorMode(); const dn = H.diffNote(); setText(chgNote, dn || 'Hover the timeline: orange rings move, red breaks or leaves, green forms or arrives, yellow changes order or charge.'); mbs.forEach(b => b.classList.toggle('on', b.dataset.mode === m)); setText(aText, H.authorText());
    const ars = H.arrowsOf(); const key = JSON.stringify(ars) + H.currentKey(); if (key === arKey) return; arKey = key; arList.innerHTML = '';
    if (!ars.length) arList.append(note('none'));
    for (const a of ars) { const bul = el('input', { type: 'number', min: 0, max: 1.5, step: 0.05, value: String(a.bulge), title: 'bow: fraction of the arrow\'s length' }) as HTMLInputElement; bul.onchange = () => H.editArrow(a.j, 'bulge', +bul.value);
      arList.append(el('div', { class: 'arrow' }, el('span', {}, `${a.j + 1}. ${a.text}`), bul, el('button', { title: 'bow the other way', onclick: () => H.editArrow(a.j, 'flip') }, a.side > 0 ? '⤴' : '⤵'), el('button', { title: 'delete', onclick: () => H.editArrow(a.j, 'delete') }, '✕'))) }
  };
  refreshers.push(refreshAuthor);
  const Ck = sec(PK, 'Checks', { open: false, keys: 'lint errors warnings' }); const ckList = el('div', { class: 'checks' }); Ck.append(ckList);
  const refreshChecks = () => { const items = H.lint(); ckList.innerHTML = '';
    const c = { error: 0, warn: 0, note: 0 } as any; for (const it of items) c[it.level]++; const sum = Ck.querySelector('summary') as HTMLElement; if (sum) sum.textContent = items.length ? `Checks · ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warn} warning${c.warn === 1 ? '' : 's'}` : 'Checks · all clear';
    Ck.classList.toggle('alert', c.error > 0); if (c.error > 0) (Ck as HTMLDetailsElement).open = true;
    if (!items.length) { ckList.append(note('Bonds, arrows, lone pairs, charges and the matching between keyframes all look consistent.')); return }
    for (const it of items) { const d = el('div', { class: 'check ' + it.level, title: it.kf !== null ? 'go to keyframe ' + (it.kf + 1) : '' }, el('b', {}, it.level === 'error' ? '✕' : it.level === 'warn' ? '!' : '·'), el('span', {}, (it.kf !== null ? `${it.kf + 1}: ` : '') + it.text)); if (it.kf !== null) d.onclick = () => H.goToKey(it.kf!); ckList.append(d) }
    ckList.append(el('div', { class: 'btns' }, el('button', { onclick: H.relint }, 'Check again')));
  };

  /* ---------- the timeline under the drawing (animations) ---------- */
  const tl = document.getElementById('timeline');
  const playBtn = el('button', { class: 'play', title: 'play / pause (space)', onclick: () => { H.play(!H.isPlaying()); showPlay() } }, '▶') as HTMLButtonElement;
  const showPlay = () => { setText(playBtn, H.isPlaying() ? '❚❚' : '▶'); playBtn.classList.toggle('on', H.isPlaying()) };
  const frameIn = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'time' }) as HTMLInputElement;
  frameIn.oninput = () => { H.seek(+frameIn.value); showPlay() };
  frameIn.onmouseenter = () => H.setHoverChanges(true); frameIn.onmouseleave = () => H.setHoverChanges(false);
  const ticks = el('div', { class: 'ticks' }); const track = el('div', { class: 'track' }, ticks, frameIn);
  const tName = el('span', { class: 'tname' }), tTime = el('span', { class: 'ttime' });
  tl?.append(playBtn, el('button', { class: 'icon', title: 'step back (,)', onclick: () => { H.step(-2); showPlay() } }, '‹'), el('button', { class: 'icon', title: 'step on (.)', onclick: () => { H.step(2); showPlay() } }, '›'), track, el('div', { class: 'tinfo' }, tName, tTime));
  let total = 1;
  function buildTicks() { ticks.innerHTML = ''; const st = H.keyStarts(); const ks = H.keyframes(); const cur = H.currentKey();
    st.forEach((f, i) => { const t = el('button', { class: 'tick' + (i === cur ? ' on' : ''), title: `${i + 1}. ${ks[i]?.name || ''}`, onclick: () => { H.goToKey(i); showPlay() } }, String(i + 1)); t.style.left = Math.min(100, 100 * f / Math.max(1, total - 1)) + '%'; ticks.append(t) }) }
  const transport = (f: number, tot: number, name: string) => { const grew = tot !== total; total = tot; if (grew) buildTicks(); frameIn.max = String(tot - 1); frameIn.value = String(f); setText(tName, name); setText(tTime, `${(f / H.fps).toFixed(1)} / ${(tot / H.fps).toFixed(1)} s`); showPlay(); refreshKeys(); refreshAuthor() };
  refreshers.push(() => { const on = H.hasScene(); if (tl) tl.hidden = !on; if (on) refreshChecks(); if (!on && current === 'scene') current = 'drawing' });

  /* ======================= Export (a dialog over the drawing) ======================= */
  const modal = el('div', { class: 'modal', onclick: (e: Event) => { if (e.target === modal) closeExport() } }); const dlg = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'export' }); modal.append(dlg); document.body.append(modal);
  dlg.append(el('div', { class: 'dh' }, el('h3', {}, 'Export'), el('button', { class: 'icon ghost', 'aria-label': 'close', onclick: () => closeExport() }, icon('close'))));
  const sizes: [string, [number, number] | null][] = [['Screen', null], ['1920×1080', [1920, 1080]], ['3840×2160', [3840, 2160]], ['1080×1080', [1080, 1080]], ['1080×1920', [1080, 1920]], ['1280×720', [1280, 720]]];
  let sizeSel: string = store.get('ms.exportSize') || '1920×1080'; let custom: [number, number] = [2400, 1600];
  const cw = el('input', { type: 'number', min: 64, step: 2, value: String(custom[0]), class: 'num wide4' }) as HTMLInputElement, chh = el('input', { type: 'number', min: 64, step: 2, value: String(custom[1]), class: 'num wide4' }) as HTMLInputElement;
  const outSize = (): [number, number] | null => sizeSel === 'Custom' ? [Math.max(64, Math.round(+cw.value / 2) * 2), Math.max(64, Math.round(+chh.value / 2) * 2)] : sizes.find(s => s[0] === sizeSel)?.[1] ?? null;
  const sizeChips = el('div', { class: 'sizechips' }); const chipBs: HTMLButtonElement[] = [];
  for (const [n] of [...sizes, ['Custom', null] as [string, null]]) { const b = el('button', { class: 'chip', onclick: () => { sizeSel = n; store.set('ms.exportSize', n); refreshRender(); refreshSizes() } }, n) as HTMLButtonElement; b.dataset.v = n; chipBs.push(b); sizeChips.append(b) }
  const customRow = el('div', { class: 'row' }, el('label', {}, 'width × height'), el('div', { class: 'wide nums' }, cw, '×', chh));
  const refreshSizes = () => { chipBs.forEach(b => b.classList.toggle('on', b.dataset.v === sizeSel)); customRow.style.display = sizeSel === 'Custom' ? '' : 'none' };
  {
    const g = el('div', { class: 'sec' }, el('div', { class: 'sh' }, 'Picture')); dlg.append(g);
    g.append(sizeChips, customRow);
    const pngB = el('button', { class: 'primary', title: 'this frame as a PNG at the chosen size' }, 'Save PNG'), jpgB = el('button', { title: 'the first keyframe with its arrows drawn, as a JPEG' }, 'Poster (JPEG)'), svgB = el('button', { title: 'lines, fills and letters as vectors (drawn by the molsketch server)' }, 'Save SVG');
    pngB.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], undefined, 'image/png') };
    jpgB.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], H.posterFrame(), 'image/jpeg') };
    svgB.onclick = () => { const sz = outSize() || H.canvasSize(); H.saveSvg(sz[0], sz[1]) };
    g.append(el('div', { class: 'btns' }, pngB, showWhen(el('span', {}, jpgB), () => H.hasScene()), showWhen(el('span', {}, svgB), () => H.hasSdk())));
    const svgNote = note('SVG needs the molsketch server: run molsketch serve.'); g.append(showWhen(svgNote, () => !H.hasSdk()));
    g.append(note('The frame on the drawing shows what the file will hold.'));
  }
  const codecSel = el('select', {}, ...[['auto', 'smallest the browser can make'], ['av1', 'AV1 (.av1.mp4)'], ['vp9', 'VP9 (.webm)'], ['h264', 'H.264 (.mp4, plays everywhere)']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const qualSel = el('select', {}, ...[['small', 'small'], ['medium', 'medium'], ['high', 'high']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const codecNote = note('');
  const prog = el('progress', { max: '1', value: '0', style: 'width:100%;display:none' }) as HTMLProgressElement; const progNote = note('');
  const goBtn = el('button', { class: 'primary' }, 'Render video') as HTMLButtonElement, cancelBtn = el('button', { onclick: H.cancelRender, style: 'display:none' }, 'Cancel') as HTMLButtonElement;
  let support: any = null; let sizeKey = ''; let exportOpen = false;
  const refreshRender = async () => {
    const sz = outSize(); H.setRenderSize(exportOpen ? sz : null); const [w, h] = sz || H.canvasSize();
    if (!H.hasWebCodecs()) { codecNote.textContent = 'This browser cannot encode video (WebCodecs): use Chrome or Edge, or the command line.'; goBtn.disabled = true; return }
    const key = w + 'x' + h; if (key === sizeKey) return; sizeKey = key; support = await H.codecSupport(w, h);
    const have = ['av1', 'vp9', 'h264'].filter(c => support[c]); goBtn.disabled = !have.length;
    codecNote.textContent = have.length ? `${have.map(c => c.toUpperCase()).join(', ')} at ${w}×${h}; ${H.drawnFrames()} drawings at ${H.fps / 2} per second.` : `No codec available at ${w}×${h}.`;
  };
  cw.onchange = chh.onchange = refreshRender;
  goBtn.onclick = async () => {
    const sz = outSize() || H.canvasSize(); let codec = codecSel.value; if (codec === 'auto') codec = ['av1', 'vp9', 'h264'].find(c => support?.[c]) || 'h264';
    goBtn.disabled = true; cancelBtn.style.display = ''; prog.style.display = ''; prog.value = 0; const t0 = performance.now();
    try { const r = await H.renderToFile({ width: sz[0], height: sz[1], codec, quality: qualSel.value, onProgress: (d, n, b, eta) => { prog.value = d / n; progNote.textContent = `${d} / ${n} drawings · ${(b / 1048576).toFixed(2)} MB · ${eta > 60 ? (eta / 60).toFixed(1) + ' min' : eta.toFixed(0) + ' s'} left` } });
      progNote.textContent = `${r.name}: ${(r.bytes / 1048576).toFixed(2)} MB, ${r.seconds.toFixed(1)} s in ${((performance.now() - t0) / 1000).toFixed(0)} s — downloaded` }
    catch (e: any) { progNote.textContent = e.message }
    finally { goBtn.disabled = false; cancelBtn.style.display = 'none'; prog.style.display = 'none' }
  };
  {
    const g = el('details', { class: 'sec' }, el('summary', {}, 'Video')) as HTMLDetailsElement; dlg.append(g); g.open = H.hasScene();
    g.append(note('The animation’s loop, or the turntable when the molecule is spinning, at the picture size.'));
    const r1 = el('div', { class: 'row' }, el('label', {}, 'codec'), codecSel), r2 = el('div', { class: 'row' }, el('label', {}, 'quality'), qualSel); g.append(r1, r2, codecNote, el('div', { class: 'btns' }, goBtn, cancelBtn), prog, progNote);
  }
  {
    const g = el('details', { class: 'sec' }, el('summary', {}, 'Files')) as HTMLDetailsElement; dlg.append(g);
    const styleIn = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadStyle(f); e.target.value = '' } }) as HTMLInputElement;
    g.append(el('div', { class: 'btns' }, el('button', { onclick: H.saveScene, title: 'the structure or animation with its keyframes, arrows, labels and camera' }, 'Save scene (JSON)'), el('button', { onclick: H.saveStyle }, 'Save style'), el('button', { onclick: () => styleIn.click() }, 'Load style…'), styleIn));
  }
  {
    const g = el('details', { class: 'sec' }, el('summary', {}, 'Command line')) as HTMLDetailsElement; dlg.append(g);
    const cmd = el('textarea', { readonly: '', rows: '4', class: 'cmd' }) as HTMLTextAreaElement; const showCmd = () => { cmd.value = H.renderCommand() };
    g.append(note('Renders exactly this from the terminal with the molsketch Python package. Save the scene and the style first; the command names those files.'), cmd,
      el('div', { class: 'btns' }, el('button', { onclick: (e: any) => { showCmd(); navigator.clipboard?.writeText(cmd.value); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy', 1200) } }, 'Copy')));
    g.addEventListener('toggle', showCmd);
  }
  const openExport = () => { exportOpen = true; modal.classList.add('on'); refreshSizes(); refreshRender(); updateVis() };
  const closeExport = () => { if (!exportOpen) return; exportOpen = false; modal.classList.remove('on'); H.setRenderSize(null) };

  /* ---------- selecting from outside (main: after loading a map, …) ---------- */
  const selectTab = (key: string) => { if (key === 'export') { openExport(); return } select(({ look: 'drawing', colour: 'protein', view: 'camera' } as Record<string, string>)[key] || key) };

  const refresh = () => refreshers.forEach(f => f());
  refresh(); layout();
  return { refresh, transport, refreshChecks, refreshHistory, refreshAuthor, selectTab };
}
