/* The app's chrome, generated from a small schema bound to style paths:
   · the top bar (#topbar): open, examples, undo / redo, save, export, help
   · the side panel (#controls): one tab per task — Look, Colour, View, Scene, Export — and a search over every setting
   · the timeline (#timeline) under the drawing, shown while a scene is loaded */
import type { Style, Palette } from '../style';
import type { Camera } from '../render/camera';
import { ribbonColours } from '../palettes';
import { hand, handOf } from '../looks';

export interface PanelHost {
  style: Style;
  looks: Record<string, { name: string; note: string; style: { palette?: Partial<Palette> } }>;
  currentLook: () => string;
  applyLook: (k: string) => void;
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
  | { t: 'select'; label: string; path: string; options: string[]; geom?: boolean }
  | { t: 'text'; label: string; path: string; geom?: boolean; placeholder?: string }
  | { t: 'color'; label: string; path: string; geom?: boolean }
  | { t: 'check'; label: string; path: string; geom?: boolean }) & { when?: () => boolean; tip?: string };

const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
const set = (o: any, path: string, v: any) => { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v };
const store = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { } } };

export function buildPanel(root: HTMLElement, H: PanelHost) {
  const refreshers: (() => void)[] = [];
  /* contextual visibility: rows and groups that only matter for some settings hide themselves */
  const vis: [HTMLElement, () => boolean][] = [];
  const showWhen = (e: HTMLElement, f: () => boolean) => { vis.push([e, f]); e.style.display = f() ? '' : 'none'; return e };
  const updateVis = () => { for (const [e, f] of vis) e.style.display = f() ? '' : 'none' };
  refreshers.push(updateVis);
  const el = (tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) (e as any)[k] = attrs[k]; else e.setAttribute(k, attrs[k]) } for (const c of kids) e.append(c); return e };
  const note = (text: string) => el('div', { class: 'note' }, text);
  const row = (parent: HTMLElement, label: string, ...kids: Node[]) => { const r = el('div', { class: 'row' }, el('label', {}, label), ...kids); parent.append(r); return r };
  const control = (parent: HTMLElement, c: Ctl) => {
    const n0 = parent.children.length;
    const after = () => { c.geom ? H.rebuild() : H.redraw(); updateVis() };
    if (c.t === 'range') {
      const inp = el('input', { type: 'range', min: c.min, max: c.max, step: c.step }) as HTMLInputElement; const val = el('span', { class: 'val' });
      const show = () => { const v = get(H.style, c.path); inp.value = String(v); val.textContent = Number(v).toFixed(c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0) };
      inp.oninput = () => { H.mark(c.label); set(H.style, c.path, +inp.value); show(); after() }; inp.onchange = () => H.settle(); refreshers.push(show); show(); row(parent, c.label, inp, val);
    } else if (c.t === 'select') {
      const s = el('select', {}, ...c.options.map(o => el('option', { value: o }, o))) as HTMLSelectElement;
      const show = () => { s.value = get(H.style, c.path) }; s.onchange = () => { H.mark(c.label); set(H.style, c.path, s.value); after() }; refreshers.push(show); show(); row(parent, c.label, s);
    } else if (c.t === 'text') {
      const inp = el('input', { type: 'text', placeholder: c.placeholder || '' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) ?? '' }; inp.onchange = () => { H.mark(c.label); set(H.style, c.path, inp.value); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'color') {
      const inp = el('input', { type: 'color' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) }; inp.oninput = () => { H.mark(c.label); set(H.style, c.path, inp.value); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'check') {
      const inp = el('input', { type: 'checkbox' }) as HTMLInputElement;
      const show = () => { inp.checked = !!get(H.style, c.path) }; inp.onchange = () => { H.mark(c.label); set(H.style, c.path, inp.checked); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    }
    const r = parent.children[n0] as HTMLElement | undefined;
    if (r) { if (c.tip) r.title = c.tip; if (c.when) showWhen(r, c.when) }
  };
  /** a selection field with one-click choices under it; the text stays editable for anything else */
  const selControl = (parent: HTMLElement, label: string, path: string, choices: [string, string][], tip: string) => {
    const inp = el('input', { type: 'text', placeholder: 'nothing', spellcheck: 'false' }) as HTMLInputElement;
    const chips = el('div', { class: 'chips' });
    const apply = (v: string) => { if (v === '__site__') v = H.style.site.sel || ''; H.mark(label); set(H.style, path, v); H.rebuild(); refresh() };   // __site__: the active site's selection
    const bs = choices.map(([t, v]) => { const b = el('button', { class: 'chip', title: v ? 'selection: ' + v : 'draw none', onclick: () => apply(v) }, t) as HTMLButtonElement; b.dataset.v = v; chips.append(b); return b });
    inp.onchange = () => apply(inp.value);
    const show = () => { const v = (get(H.style, path) ?? '').trim(); inp.value = v; bs.forEach(b => b.classList.toggle('on', b.dataset.v === v)) }; refreshers.push(show); show();
    const r = el('div', { class: 'row sel', title: tip }, el('label', {}, label), el('div', { class: 'selbox' }, chips, inp)); parent.append(r); return r;
  };
  const S = () => H.style; const has = (sel: string) => !!(sel && sel.trim());
  const cartoonOn = () => has(S().reps.cartoon), sticksOn = () => has(S().reps.sticks), surfaceOn = () => has(S().reps.surface);
  const engraved = () => cartoonOn() && S().cartoonStyle === 'engraved';
  const fillIs = (...f: string[]) => f.includes(S().fill);

  /* ---------- tabs, groups and search ---------- */
  const search = el('input', { type: 'search', class: 'search', placeholder: 'Find a setting…  ( / )', spellcheck: 'false' }) as HTMLInputElement;
  const tabBar = el('div', { class: 'tabs', role: 'tablist' });
  const panes = el('div', { class: 'panes' });
  const empty = el('div', { class: 'note', style: 'display:none;padding:12px 2px' }, 'No setting matches. Some only appear when they apply, such as watercolour settings for the watercolour fill.');
  root.append(el('div', { class: 'phead' }, search, tabBar), panes, empty);
  type Tab = { key: string; btn: HTMLButtonElement; pane: HTMLElement };
  const tabs: Tab[] = [];
  let active = store.get('triad.tab') || 'look';
  const tab = (key: string, label: string, tip: string) => {
    const pane = el('div', { class: 'pane', 'data-tab': key }); const btn = el('button', { class: 'tab', role: 'tab', title: tip, onclick: () => selectTab(key) }, label) as HTMLButtonElement;
    tabBar.append(btn); panes.append(pane); tabs.push({ key, btn, pane }); return pane;
  };
  const tabVisible = (t: Tab) => t.btn.style.display !== 'none';
  const selectTab = (key: string) => { const t = tabs.find(t => t.key === key && tabVisible(t)) || tabs[0]; active = t.key; store.set('triad.tab', active); if (search.value) { search.value = ''; runSearch() } layoutTabs() };
  const layoutTabs = () => { const q = search.value.trim(); for (const t of tabs) { t.btn.classList.toggle('on', !q && t.key === active); t.pane.style.display = q ? (tabVisible(t) ? '' : 'none') : t.key === active ? '' : 'none' } };
  const groups: { d: HTMLDetailsElement; title: string; keys: string }[] = [];
  /** a collapsible group in a pane; `keys`: extra words the search should find it by */
  const group = (pane: HTMLElement, title: string, o: { open?: boolean; keys?: string; tip?: string } = {}) => {
    const d = el('details', { class: 'grp' }, el('summary', o.tip ? { title: o.tip } : {}, title)) as HTMLDetailsElement;
    const k = 'triad.open.' + (pane.dataset.tab || '') + '.' + title; const saved = store.get(k); d.open = saved ? saved === '1' : o.open !== false;
    d.ontoggle = () => { if (!search.value.trim()) store.set(k, d.open ? '1' : '0') };
    pane.append(d); groups.push({ d, title, keys: (o.keys || '').toLowerCase() }); return d;
  };
  let wasOpen: boolean[] | null = null;
  const runSearch = () => {
    const q = search.value.trim().toLowerCase(); root.classList.toggle('searching', !!q);
    if (q && !wasOpen) wasOpen = groups.map(g => g.d.open); if (!q && wasOpen) { groups.forEach((g, i) => g.d.open = wasOpen![i]); wasOpen = null }
    let hits = 0;
    for (const g of groups) {
      const whole = !q || (g.title + ' ' + g.keys).toLowerCase().includes(q); let any = false;
      for (const c of Array.from(g.d.children) as HTMLElement[]) { if (c.tagName === 'SUMMARY') continue;
        const txt = c.classList.contains('row') ? (c.textContent + ' ' + (c.title || '')).toLowerCase() : ''; const m = whole || (!!txt && txt.includes(q));
        c.classList.toggle('nomatch', !m); if (m && c.style.display !== 'none') any = true }
      g.d.classList.toggle('nomatch', !whole && !any); if (q) g.d.open = true; if (q && (whole || any) && g.d.style.display !== 'none') hits++;
    }
    empty.style.display = q && !hits ? '' : 'none'; layoutTabs();
  };
  search.oninput = runSearch; search.onkeydown = e => { if (e.key === 'Escape') { search.value = ''; runSearch(); search.blur() } };
  window.addEventListener('keydown', e => { const t = (e.target as HTMLElement)?.tagName; if (e.key === '/' && t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') { e.preventDefault(); search.focus() } });

  const Look = tab('look', 'Look', 'the drawing style: looks, what is drawn, fills and lines');
  const MapT = tab('map', 'Map', 'a cryo-EM density map: on its own, or with the model built into it');
  const Col = tab('colour', 'Colour', 'palettes, colour schemes and every colour');
  const Lab = tab('labels', 'Labels', 'labels you place, and which of the automatic ones show');
  const View = tab('view', 'View', 'camera, depth, framing and motion');
  const Scn = tab('scene', 'Scene', 'keyframes, arrows and checks of a mechanism scene');
  const Exp = tab('export', 'Export', 'pictures, video, files and the render command');

  /* ---------- the Map tab: a density map, its contour, how it is drawn ---------- */
  {
    const hasMap = () => H.hasMap(), withModel = () => H.hasMap() && H.hasStructure();
    const g = group(MapT, 'Density map', { keys: 'cryo-em emdb mrc ccp4 density map electron microscopy fetch open' });
    const idIn = el('input', { type: 'text', placeholder: 'EMD-11638', spellcheck: 'false' }) as HTMLInputElement;
    const fetchIt = () => { if (idIn.value.trim()) H.fetchMap(idIn.value.trim()).then(refresh) };
    idIn.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') fetchIt() };
    row(g, 'EMDB ID', idIn, el('button', { onclick: fetchIt, title: 'download the entry’s primary map, with the depositors’ recommended contour level' }, 'Fetch'));
    const mapIn = el('input', { type: 'file', accept: '.map,.mrc,.ccp4,.gz', style: 'display:none', onchange: (e: any) => { const f = e.target.files?.[0]; if (f) H.loadMap(f).then(refresh); e.target.value = '' } }) as HTMLInputElement;
    const acts = el('div', { class: 'btns' },
      el('button', { title: 'the map this PDB entry was built into (from RCSB and EMDB)', onclick: () => H.mapForEntry().then(refresh) }, 'Map of this entry'),
      el('button', { title: 'an MRC / CCP4 map file (.map, .mrc, .ccp4, gzipped or not); you can also drop one on the drawing', onclick: () => mapIn.click() }, 'Open map file…'), mapIn);
    g.append(acts);
    const rm = el('div', { class: 'btns' }, el('button', { onclick: () => { H.clearMap(); refresh() } }, 'Remove the map')); g.append(showWhen(rm, hasMap));
    const info = note(''); g.append(info);
    const showInfo = () => { const m = H.mapInfo();
      info.textContent = !m ? 'No map. Fetch one by its EMDB ID, open a file, or drop a .map / .mrc on the drawing. With a PDB entry loaded, “Map of this entry” finds the map it was built into.'
        : `${m.name}: ${m.size.join('×')} at ${m.step.toFixed(2)} Å${m.binned > 1 ? ` (averaged ${m.binned}×)` : ''}. Contour ${+m.level.toPrecision(3)} (${m.sigma.toFixed(1)} σ)${m.recommended != null ? `; recommended ${m.recommended}` : ''}.${m.atomInclusion != null ? ` ${(m.atomInclusion * 100).toFixed(0)}% of the model’s atoms inside.` : ''}` };
    refreshers.push(showInfo); showInfo();
  }
  {
    const g = group(MapT, 'Contour', { keys: 'level sigma threshold contour recommended layers' }); showWhen(g, () => H.hasMap());
    const sig = el('input', { type: 'range', min: 0.5, max: 12, step: 0.1 }) as HTMLInputElement; const sv = el('span', { class: 'val' });
    const lvIn = el('input', { type: 'text', spellcheck: 'false', style: 'width:6em' }) as HTMLInputElement;
    const show = () => { const m = H.mapInfo(); if (!m) return; sig.value = String(m.sigma); sv.textContent = m.sigma.toFixed(1) + ' σ'; lvIn.value = String(+m.level.toPrecision(4)) };
    sig.oninput = () => { H.mark('contour'); S().map.sigma = +sig.value; S().map.level = null; H.redraw(); refresh() }; sig.onchange = () => H.settle();
    lvIn.onchange = () => { const v = parseFloat(lvIn.value); if (!isFinite(v)) return; H.mark('contour'); S().map.level = v; S().map.sigma = null; H.redraw(); refresh() };
    refreshers.push(show); show();
    row(g, 'σ above mean', sig, sv).title = 'the contour in standard deviations above the map’s mean';
    row(g, 'level', lvIn, el('button', { title: 'the depositors’ recommended level (EMDB)', onclick: () => { H.mark('contour'); S().map.level = null; S().map.sigma = null; H.redraw(); refresh() } }, 'Recommended')).title = 'the contour in the map’s own units';
    control(g, { t: 'select', label: 'style', path: 'map.style', options: ['surface', 'layers', 'mesh', 'slice'], tip: 'surface: the contour drawn as a surface · layers: several contours nested · mesh: chicken wire, as Coot · slice: a section through the map' });
    const lvls = el('input', { type: 'text', spellcheck: 'false', placeholder: '0.7, 1, 1.5' }) as HTMLInputElement;
    lvls.onchange = () => { const v = lvls.value.split(/[\s,]+/).map(Number).filter(x => isFinite(x) && x > 0); if (v.length) { H.mark('levels'); S().map.levels = v; H.redraw() } };
    refreshers.push(() => { lvls.value = (S().map.levels || []).join(', ') });
    showWhen(row(g, 'levels (× contour)', lvls), () => S().map.style === 'layers');
    control(g, { t: 'select', label: 'low-pass', path: 'map.smooth', options: ['auto', '0', '3', '4', '5', '6', '8', '12'], tip: 'Å: the map smoothed to what the picture can show (the density above the contour, then contoured to enclose the molecule’s mass) · auto: for whole particles only · 0: the map as it is' });
    control(g, { t: 'range', label: 'slice offset', path: 'map.slice.offset', min: -0.5, max: 0.5, step: 0.01, when: () => S().map.style === 'slice' });
    control(g, { t: 'check', label: 'cut in front', path: 'map.slice.cut', when: () => S().map.style === 'slice', tip: 'what lies in front of the slice is cut away' });
  }
  {
    const g = group(MapT, 'Drawing', { keys: 'marks ink hatching shading outline opacity finish smooth caption' }); showWhen(g, () => H.hasMap());
    control(g, { t: 'select', label: 'marks', path: 'map.marks', options: ['ink', 'look'], tip: 'ink: outline and hatching in every look · look: the look’s own (a watercolour gradient)' });
    control(g, { t: 'select', label: 'finish', path: 'map.finish', options: ['drawn', 'smooth', 'sketch'], tip: 'drawn: a smooth surface in the look’s marks · smooth: plainly lit, as ChimeraX · sketch: the raw grid, hand-drawn' });
    control(g, { t: 'range', label: 'shading', path: 'map.shade', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'outline', path: 'map.lineWidth', min: 0.2, max: 2.5, step: 0.05 });
    control(g, { t: 'range', label: 'opacity over model', path: 'map.opacity', min: 0.1, max: 1, step: 0.05, when: () => H.hasStructure() });
    control(g, { t: 'range', label: 'surface smoothing', path: 'map.smoothing', min: 0, max: 10, step: 1, when: () => S().map.finish !== 'sketch', tip: 'Taubin smoothing steps, as ChimeraX smooths surfaces' });
    control(g, { t: 'range', label: 'specks under (px)', path: 'map.speck', min: 0, max: 20, step: 1, tip: 'islands and holes smaller than this are left out' });
    control(g, { t: 'check', label: 'caption', path: 'map.caption', tip: 'a line under the drawing that says how the map is shown: its level, filtering, carving' });
  }
  {
    const g = group(MapT, 'With the model', { keys: 'zone carve crop context unsupported unexplained residue side chain b-factor' }); showWhen(g, () => H.hasMap() && H.hasStructure());
    selControl(g, 'zone', 'map.zone', [['none', ''], ['site', '__site__']], 'only the map around these atoms, at full resolution: for a close look at residues in their density (show them as sticks too)');
    control(g, { t: 'range', label: 'carve (Å)', path: 'map.carve', min: 0, max: 8, step: 0.5, tip: 'only the density this close to the model (or the zone); the caption says when it is on' });
    control(g, { t: 'range', label: 'crop margin (Å)', path: 'map.crop', min: 0, max: 20, step: 1, tip: 'the map is cropped to the model’s box and this margin' });
    control(g, { t: 'select', label: 'rest of assembly', path: 'map.context', options: ['hide', 'show'], tip: 'density the model does not cover (the rest of a symmetric assembly): left out, or drawn faintly' });
    control(g, { t: 'check', label: 'mark unsupported residues', path: 'map.unsupported', tip: 'a small circle on residues whose atoms are mostly outside the density' });
    control(g, { t: 'check', label: 'unexplained density', path: 'map.unexplained', tip: 'density the model does not explain (a ligand, a missing loop) in the accent colour' });
    control(g, { t: 'select', label: 'line looseness', path: 'map.localResolution', options: ['none', 'bfactor'], tip: 'bfactor: lines looser where the model’s B-factors are high, as a stand-in for local resolution' });
  }

  /* ---------- top bar: the things used every time ---------- */
  const top = document.getElementById('topbar') || root;
  const fileIn = el('input', { type: 'file', accept: '.pdb,.ent,.cif,.mmcif,.json,.map,.mrc,.ccp4,.gz', multiple: '', style: 'display:none', onchange: (e: any) => { const fl = Array.from(e.target.files as FileList); if (fl.length) H.loadFiles(fl); e.target.value = '' } }) as HTMLInputElement;
  const examples: [string, string][] = [['trypsin_active_site.json', 'Trypsin active site (engraved)'], ['mechanism.json', 'Serine hydrolase mechanism (scene)'], ['calb_pnpa.json', 'CALB with pNPA (scene)'], ['1A8O.pdb', '1A8O — HIV capsid domain'], ['1LCD.pdb', '1LCD — lac repressor headpiece'], ['test_protein.pdb', 'Test protein'], ['test_protein_rna.cif', 'Test protein with RNA'], ['6GZQ.cif', '6GZQ — ribosome (large)']];
  const ex = el('select', { class: 'examples', title: 'load an example', onchange: (e: any) => { if (e.target.value) H.loadExample(e.target.value); e.target.value = '' } }, el('option', { value: '' }, 'Examples'), ...examples.map(([v, t]) => el('option', { value: v }, t))) as HTMLSelectElement;
  const svg = (d: string) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 16 16'); e.setAttribute('width', '15'); e.setAttribute('height', '15'); e.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`; return e };
  // fetch from the PDB: type an ID, Enter or Fetch
  const pdbIn = el('input', { type: 'text', class: 'pdbid', placeholder: 'PDB ID', maxlength: '4', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'PDB ID', title: 'a four-character PDB ID, e.g. 1A8O; fetched from RCSB as mmCIF' }) as HTMLInputElement;
  const pdbBtn = el('button', { type: 'submit' }, 'Fetch') as HTMLButtonElement;
  const pdbForm = el('form', { class: 'pdbform', title: 'fetch an entry from the Protein Data Bank' }, pdbIn, pdbBtn) as HTMLFormElement;
  const showPdb = () => { pdbBtn.disabled = !/^[0-9][a-z0-9]{3}$/i.test(pdbIn.value.trim()) }; pdbIn.oninput = showPdb; showPdb();
  pdbForm.onsubmit = async e => { e.preventDefault(); if (pdbBtn.disabled) return; pdbBtn.disabled = true; pdbIn.disabled = true; pdbBtn.textContent = 'Fetching…';
    try { await H.fetchPdb(pdbIn.value); pdbIn.value = ''; pdbIn.blur() } catch (err: any) { toastErr(err.message) }
    finally { pdbIn.disabled = false; pdbBtn.textContent = 'Fetch'; showPdb() } };
  const toastErr = (m: string) => { const t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('on', 'err'); setTimeout(() => t.classList.remove('on', 'err'), 5000) };
  const undoB = el('button', { class: 'icon', onclick: H.undo, title: 'Undo (Ctrl-Z)', 'aria-label': 'undo' }, svg('M5.5 3 2.5 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H7')) as HTMLButtonElement, redoB = el('button', { class: 'icon', onclick: H.redo, title: 'Redo (Ctrl-Shift-Z)', 'aria-label': 'redo' }, svg('M10.5 3l3 3-3 3M13.5 6H6a3.5 3.5 0 0 0 0 7h3')) as HTMLButtonElement;
  const helpB = el('button', { class: 'icon', title: 'Mouse and keyboard (?)', 'aria-label': 'help', onclick: () => toggleHelp() }, '?');
  top.append(el('div', { class: 'brand' }, 'MolSketch'),
    el('button', { class: 'primary', title: 'PDB, mmCIF or a scene JSON; several structure files become an animation, one keyframe each. You can also drop files on the drawing.', onclick: () => fileIn.click() }, 'Open…'), fileIn, ex, pdbForm,
    el('div', { id: 'fileinfo', class: 'fileinfo' }), el('div', { class: 'spacer' }),
    el('div', { class: 'cluster' }, undoB, redoB), el('span', { class: 'sep' }),
    el('div', { class: 'cluster' }, el('button', { title: 'what is on screen, as a PNG', onclick: H.savePng }, 'Save PNG'),
      el('button', { title: 'poster, video, scene and style files, and the render command', onclick: () => selectTab('export') }, 'Export…'), helpB));
  const refreshHistory = () => { const h = H.historyState(); undoB.disabled = !h.undo; redoB.disabled = !h.redo; undoB.title = h.undo ? 'Undo ' + h.undo + ' (Ctrl-Z)' : 'Nothing to undo'; redoB.title = h.redo ? 'Redo ' + h.redo + ' (Ctrl-Shift-Z)' : 'Nothing to redo' };
  refreshers.push(refreshHistory);

  /* help overlay on the drawing */
  const stage = document.getElementById('stage');
  const help = el('div', { class: 'help', role: 'dialog', 'aria-label': 'mouse and keyboard' },
    el('b', {}, 'Mouse and keyboard'),
    ...([['drag', 'rotate'], ['shift-drag · right-drag', 'pan'], ['wheel', 'zoom'], ['arrow keys', 'nudge the view'], ['r', 'reset the view'], ['Ctrl-Z · Ctrl-Shift-Z', 'undo · redo'], ['/', 'find a setting'], ['L', 'add a label; drag one to move it, double-click to edit, Delete to remove'], ['space · , · .', 'play · step back · step on (scenes)'], ['drop files', 'open a structure or scene; several make an animation']] as [string, string][]).map(([k, v]) => el('div', { class: 'kv' }, el('kbd', {}, k), el('span', {}, v))),
    el('button', { onclick: () => toggleHelp(false) }, 'Close'));
  stage?.append(help);
  const toggleHelp = (v?: boolean) => { help.classList.toggle('on', v ?? !help.classList.contains('on')) };
  window.addEventListener('keydown', e => { const t = (e.target as HTMLElement)?.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return; if (e.key === '?') toggleHelp(); else if (e.key === 'Escape') toggleHelp(false) });

  /* ================= Look ================= */
  {
    const g = group(Look, 'Looks', { keys: 'preset style watercolour ink engraved chalk' });
    const grid = el('div', { class: 'looks' }); g.append(grid);
    const lookBtns: HTMLButtonElement[] = [];
    for (const k in H.looks) { const L = H.looks[k]; const P = L.style.palette || {};
      const prev = el('span', { class: 'lprev' }); prev.style.background = P.paper || '#faf8f3';
      for (const c of [P.helix, P.sheet, P.loop, P.C]) { const i = el('i'); i.style.background = c || '#888'; prev.append(i) }
      const b = el('button', { onclick: () => H.applyLook(k), title: L.note }, prev, el('span', { class: 'ltxt' }, el('b', {}, L.name), el('small', {}, L.note))) as HTMLButtonElement;
      b.dataset.key = k; grid.append(b); lookBtns.push(b) }
    refreshers.push(() => lookBtns.forEach(b => b.classList.toggle('on', b.dataset.key === H.currentLook())));
    g.append(note('A look sets everything below; change anything afterwards. Colours are in the Colour tab.'));
  }
  {
    const g = group(Look, 'What to draw', { keys: 'representation sticks cartoon ribbon surface selection' });
    selControl(g, 'sticks', 'reps.sticks', [['none', ''], ['ligands', 'hetatm and not water'], ['side chains', 'sidechain'], ['everything', 'all']], 'atoms drawn as sticks: a selection such as resn SER+HIS or chain A');
    selControl(g, 'cartoon', 'reps.cartoon', [['none', ''], ['polymer', 'polymer'], ['protein', 'protein'], ['nucleic', 'nucleic']], 'residues drawn as ribbons');
    selControl(g, 'surface', 'reps.surface', [['none', ''], ['polymer', 'polymer'], ['everything', 'all']], 'residues drawn as a surface');
    g.append(note('Selections: all · polymer · hetatm · protein · nucleic · resi 10-20 · resn SER+HIS · chain A · combined with and / or / not.'));
  }
  {
    const g = group(Look, 'Active site', { keys: 'site pocket catalytic residues ligand binding focus cutaway context' });
    const inp = el('input', { type: 'text', placeholder: 'resi 57+102+195', spellcheck: 'false' }) as HTMLInputElement;
    const setSite = (v: string) => { H.mark('active site'); H.style.site.sel = v; H.rebuild(); refresh() };
    inp.onchange = () => setSite(inp.value.trim());
    const chips = el('div', { class: 'chips' },
      el('button', { class: 'chip', title: 'no site', onclick: () => setSite('') }, 'none'),
      el('button', { class: 'chip', title: 'every residue within 5 Å of the largest ligand, and the ligand', onclick: () => { const v = H.pocketSel(5); if (v) setSite(v) } }, 'around ligand'));
    refreshers.push(() => { inp.value = S().site.sel || '' });
    const r = el('div', { class: 'row sel', title: 'the residues (and ligand) to show in their protein: always sticks, larger, never hidden' }, el('label', {}, 'site'), el('div', { class: 'selbox' }, chips, inp)); g.append(r);
    const on = () => !!S().site.sel.trim();
    const acts = el('div', { class: 'btns' }, el('button', { title: 'turn the molecule so the site faces you, with as little of the protein in front of it as possible', onclick: () => H.frameSite() }, 'Frame the site'),
      el('button', { title: 'a label on each residue of the site; drag them to tidy up', onclick: () => H.labelSite() }, 'Label the site')); g.append(showWhen(acts, on));
    control(g, { t: 'check', label: 'cutaway', path: 'site.cutaway', when: () => on() && engraved(), tip: 'ribbon faces in front of the site fade in a window round it' });
    control(g, { t: 'range', label: 'quiet the rest', path: 'site.quiet', min: 0, max: 1, step: 0.05, when: () => on() && engraved(), tip: 'how far the rest of the protein steps back' });
    control(g, { t: 'range', label: 'site sticks', path: 'site.scale', min: 1, max: 2.4, step: 0.05, geom: true, when: on, tip: 'how much thicker the site is drawn than other sticks' });
    g.append(note('The site stays in its protein: its side chains and ligand are drawn as bold sticks with a paper halo, and with the engraved cartoon the ribbons in front of it open up.'));
  }
  {
    const g = group(Look, 'Sticks', { keys: 'ball stick radius' }); showWhen(g, sticksOn);
    control(g, { t: 'select', label: 'drawn as', path: 'mode', options: ['sticks', 'ballstick'] });
    control(g, { t: 'select', label: 'style', path: 'stickStyle', options: ['auto', 'engraved', 'sketch'], geom: true, tip: 'engraved: lines along each bond, like the ribbons · sketch: hand-drawn · auto: engraved when the ribbons are, so a mechanism drawn in sticks alone keeps its hand' });
    control(g, { t: 'range', label: 'stick radius', path: 'stickRadius', min: 0.08, max: 0.5, step: 0.01, geom: true });
    control(g, { t: 'range', label: 'cut spheres', path: 'sphereScale', min: 0, max: 1, step: 0.05, geom: true });
  }
  {
    const g = group(Look, 'Cartoon', { keys: 'ribbon helix sheet engraved molscript' }); showWhen(g, cartoonOn);
    control(g, { t: 'select', label: 'style', path: 'cartoonStyle', options: ['sketch', 'engraved'], tip: 'sketch: hand-drawn ribbons in the fill mode · engraved: line-shaded ribbons after MOLSCRIPT' });
    control(g, { t: 'range', label: 'scale', path: 'cartoonScale', min: 0.4, max: 2.5, step: 0.05, geom: true });
    control(g, { t: 'range', label: 'lines per face', path: 'engrave.lines', min: 0, max: 14, step: 1, when: engraved });
    control(g, { t: 'range', label: 'line weight', path: 'engrave.width', min: 0.1, max: 2, step: 0.05, when: engraved });
    control(g, { t: 'range', label: 'strand thickness', path: 'engrave.strandThickness', min: 0, max: 1.2, step: 0.05, when: engraved });
    control(g, { t: 'range', label: 'coil width', path: 'engrave.coilWidth', min: 0.5, max: 2.5, step: 0.05, when: engraved });
  }
  {
    const g = group(Look, 'Surface', { keys: 'probe depth edges pooling fade' }); showWhen(g, surfaceOn);
    control(g, { t: 'range', label: 'probe', path: 'probe', min: 0, max: 3, step: 0.1, geom: true });
    const wc = () => S().fill === 'watercolour';
    control(g, { t: 'range', label: 'depth edges', path: 'surfaceDepth.edges', min: 0, max: 1, step: 0.05, when: wc, tip: 'ink lines where the surface stands in front of something far behind' });
    control(g, { t: 'range', label: 'pooling', path: 'surfaceDepth.pooling', min: 0, max: 1, step: 0.05, when: wc, tip: 'pigment settling in the grooves: recesses darker' });
    control(g, { t: 'range', label: 'fade', path: 'surfaceDepth.fade', min: 0, max: 1, step: 0.05, when: wc, tip: 'far parts fade into the paper with the depth fog' });
  }
  {
    const g = group(Look, 'Fill', { keys: 'watercolour ink pencil chalk flat wash shading' });
    control(g, { t: 'select', label: 'fill', path: 'fill', options: ['watercolour', 'ink colour', 'ink', 'pencil', 'chalk', 'flat', 'wash'] });
    control(g, { t: 'range', label: 'shading', path: 'shading', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'pencil fill', path: 'pencilFill', min: 0, max: 1, step: 0.05, when: () => fillIs('pencil', 'chalk') });
    control(g, { t: 'range', label: 'fill wobble', path: 'fillWobble', min: 0, max: 2, step: 0.05, when: () => !fillIs('ink', 'ink colour') });
  }
  {
    const g = group(Look, 'Marks', { open: false, keys: 'annotations hydrogens lone pairs charges arrows caption' });
    for (const [k, label] of [['arrows', 'arrows'], ['H', 'hydrogens'], ['lonePairs', 'lone pairs'], ['charges', 'charges'], ['hbonds', 'H-bonds'], ['valence', 'valence'], ['caption', 'caption'], ['stepLabel', 'step label']]) control(g, { t: 'check', label, path: 'show.' + k });
    control(g, { t: 'range', label: 'caption size', path: 'captionSize', min: 12, max: 48, step: 1 });
    g.append(note('Labels have their own tab.'));
  }
  {
    const g = group(Look, 'Lines', { open: false, keys: 'ink pen stroke roughness width hand wobble sketchy crisp' });
    // the hand: one slider for how drawn the line is, from ruled (engraved) to loose; the four it sets are below it
    const hIn = el('input', { type: 'range', min: 0, max: 1, step: 0.01 }) as HTMLInputElement; const hV = el('span', { class: 'val' });
    const showH = () => { const h = handOf(H.style); hIn.value = String(h); hV.textContent = h.toFixed(2) };
    hIn.oninput = () => { H.mark('hand'); const x = hand(+hIn.value); Object.assign(H.style.line, x.line); H.style.fillWobble = x.fillWobble; refresh(); H.redraw() }; hIn.onchange = () => H.settle();
    refreshers.push(showH); showH(); const hr = row(g, 'hand', hIn, hV); hr.title = 'how hand-drawn the line is: 0 ruled, like an engraving, 1 a loose sketch (sets roughness, passes, pressure and fill wobble)';
    control(g, { t: 'range', label: 'width', path: 'line.width', min: 0.3, max: 4, step: 0.1 });
    control(g, { t: 'range', label: 'roughness', path: 'line.rough', min: 0, max: 3, step: 0.05 });
    control(g, { t: 'range', label: 'passes', path: 'line.passes', min: 1, max: 4, step: 1 });
    control(g, { t: 'range', label: 'hierarchy', path: 'line.hierarchy', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'pressure', path: 'line.pressure', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'opacity', path: 'line.alpha', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'check', label: 'construction', path: 'construction', tip: 'faint guide geometry: stick axes, circles round atoms' });
    control(g, { t: 'select', label: 'detail', path: 'detail', options: ['auto', 'full'], tip: 'auto: fewer passes on large structures · full: the whole treatment always' });
    control(g, { t: 'select', label: 'texture', path: 'textureScale', options: ['screen', 'object'], tip: 'screen: hatching in pixels · object: it follows the drawing\'s scale' });
  }
  {
    const g = group(Look, 'Hatching', { open: false }); showWhen(g, () => fillIs('ink', 'ink colour', 'pencil', 'chalk') || S().shading > 0);
    control(g, { t: 'range', label: 'spacing', path: 'hatch.spacing', min: 2, max: 14, step: 0.5 });
    control(g, { t: 'range', label: 'angle', path: 'hatch.angle', min: -90, max: 90, step: 5 });
    control(g, { t: 'range', label: 'density', path: 'hatch.density', min: 0, max: 2.5, step: 0.05 });
  }
  {
    const g = group(Look, 'Watercolour', { open: false }); showWhen(g, () => fillIs('watercolour'));
    control(g, { t: 'range', label: 'layers', path: 'water.layers', min: 1, max: 4, step: 1 });
    control(g, { t: 'range', label: 'wobble', path: 'water.wobble', min: 0, max: 3, step: 0.05 });
    control(g, { t: 'range', label: 'drying ring', path: 'water.ring', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'granulation', path: 'water.granulation', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'tone', path: 'water.tone', min: 0, max: 1.5, step: 0.05 });
  }
  {
    const g = group(Look, 'Paper', { open: false, keys: 'grain wash background' });
    control(g, { t: 'range', label: 'grain', path: 'paper.grain', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'wash', path: 'paper.wash', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'wash seed', path: 'paper.washSeed', min: 1, max: 40, step: 1 });
    control(g, { t: 'range', label: 'wash life', path: 'paper.washLife', min: 0, max: 2, step: 0.05 });
    control(g, { t: 'range', label: 'wash scale', path: 'paper.washScale', min: 0.3, max: 3, step: 0.05 });
  }

  /* ================= Colour ================= */
  let selected: { get: () => string; set: (v: string) => void; label: string } | null = null;
  const hexIn = el('input', { type: 'text', placeholder: '#rrggbb', spellcheck: 'false' }) as HTMLInputElement; const hexLabel = el('span', { class: 'note' }, 'click a swatch to pick its colour');
  hexIn.oninput = () => { if (selected && /^#[0-9a-f]{6}$/i.test(hexIn.value)) { H.mark('colour ' + selected.label); selected.set(hexIn.value.toLowerCase()); refresh(); H.redraw() } };
  const swatch = (parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, opts: { auto?: () => boolean; clear?: () => void } = {}) => {
    const inp = el('input', { type: 'color' }) as HTMLInputElement; const i = el('i'); const d = el('div', { class: 'sw', title: label }, i, el('span', {}, label), inp);
    const show = () => { const v = get(); i.style.background = v; inp.value = v; d.classList.toggle('auto', !!opts.auto?.()); d.classList.toggle('on', selected?.label === label); if (selected?.label === label) { hexIn.value = v; hexLabel.textContent = label + (opts.auto?.() ? ' (from the palette)' : '') } };
    d.onclick = (e) => { if (e.target === inp) return; selected = { get, set, label }; refresh(); inp.click() };
    d.oncontextmenu = (e) => { e.preventDefault(); if (opts.clear) { H.mark('colour ' + label); opts.clear(); refresh() } };
    inp.oninput = () => { H.mark('colour ' + label); set(inp.value); show(); H.redraw() }; inp.onchange = () => { set(inp.value); refresh() };
    refreshers.push(show); show(); parent.append(d); return d;
  };
  const stylePal = (key: string, geom = false) => [() => (H.style.palette as any)[key] as string, (v: string) => { (H.style.palette as any)[key] = v; if (geom) H.rebuild() }] as const;
  const swatchRow = (parent: HTMLElement, title: string, keys: string[], geom = false) => { parent.append(el('div', { class: 'subhead' }, title)); const g = el('div', { class: 'swatches' }); parent.append(g); for (const k of keys) { const [get, set] = stylePal(k, geom); swatch(g, k, get, set) } };
  {
    const g = group(Col, 'Colour by', { keys: 'scheme carbons cartoon surface residue chain subunit entity rainbow' });
    control(g, { t: 'select', label: 'carbons by', path: 'colorBy', options: ['residue', 'element', 'chain', 'subunit', 'entity'], geom: true, when: () => sticksOn() || (cartoonOn() && S().cartoonColor === 'carbon') || (surfaceOn() && S().surfaceColor === 'residue') });
    control(g, { t: 'select', label: 'cartoon by', path: 'cartoonColor', options: ['ss', 'carbon', 'rainbow'], geom: true, when: cartoonOn, tip: 'ss: helix / sheet / loop colours · carbon: the carbons scheme · rainbow: blue → red along the chain (engraved)' });
    control(g, { t: 'select', label: 'surface by', path: 'surfaceColor', options: ['subunit', 'chain', 'entity', 'residue', 'single'], geom: true, when: surfaceOn });
  }
  {
    // group palettes: the colours residues and molecules get in order of appearance — hover previews, click keeps
    const g = group(Col, 'Palette', { keys: 'group palette okabe tol tableau colour-blind residues chains molecules' });
    g.append(note('The colours residues, chains and molecules take in order. Hover to preview, click to keep. Engraved ribbons take three of them for helix, sheet and coil: the first that stand out on the paper and from each other.'));
    const tiles: HTMLElement[] = []; let kept: { name: string; colors: string[] | null; ss: string[] } | null = null;
    const SS = ['helix', 'sheet', 'loop'] as const;
    const getSS = () => SS.map(k => H.style.palette[k]); const setSS = (v: string[]) => SS.forEach((k, i) => { H.style.palette[k] = v[i] });
    const applyPal = (name: string, colors: string[]) => { H.style.groupPalette = name === 'MolSketch' ? null : colors.slice(); H.style.groupPaletteName = name;
      if (H.style.cartoonStyle === 'engraved') { const base = H.looks[H.currentLook()]?.style.palette; if (name !== 'MolSketch') setSS(ribbonColours(colors, H.style.palette.paper, H.style.palette.ink)); else if (base) setSS(SS.map(k => base[k] ?? H.style.palette[k])) }
      H.rebuild() };
    const families: [string, string, string][] = [['drawing', 'For drawings', 'the engine and the lab site'], ['safe', 'Colour-blind safe', 'Okabe–Ito, Paul Tol, Tableau'], ['studies', 'Studies', 'jamaliki / design-corner']];
    for (const [fam, title, sub] of families) {
      g.append(el('div', { class: 'famhead' }, el('span', { class: 'subhead', style: 'margin:0' }, title), el('small', {}, sub)));
      const grid = el('div', { class: 'paltiles' }); g.append(grid);
      for (const name of Object.keys(H.groupPalettes)) { const gp = H.groupPalettes[name]; if (gp.family !== fam) continue;
        const t = el('div', { class: 'paltile', title: name + ' — ' + gp.source }, el('div', { class: 'bands' }, ...gp.colors.map(c => { const i = el('i'); i.style.background = c; return i })), el('span', {}, name)); t.dataset.name = name;
        t.onmouseenter = () => { if (!kept) kept = { name: H.style.groupPaletteName, colors: H.style.groupPalette, ss: getSS() }; applyPal(name, gp.colors) };
        t.onmouseleave = () => { if (kept) { H.style.groupPalette = kept.colors; H.style.groupPaletteName = kept.name; setSS(kept.ss); kept = null; H.rebuild() } };
        t.onclick = () => { const k = kept; kept = null; if (k) { H.style.groupPalette = k.colors; H.style.groupPaletteName = k.name; setSS(k.ss) } H.mark('group palette ' + name); applyPal(name, gp.colors); refresh() };
        grid.append(t); tiles.push(t) }
    }
    refreshers.push(() => tiles.forEach(e => e.classList.toggle('on', e.dataset.name === (H.style.groupPaletteName || 'MolSketch'))));
  }
  {
    // the groups of what is loaded, each with its colour now; click to override, right-click to let the palette decide again
    const g = group(Col, 'Groups in this file', { keys: 'residue chain molecule override' });
    g.append(note('Click one to give it its own colour; right-click to hand it back to the palette.'));
    const gsw = el('div', { class: 'swatches' }); g.append(gsw);
    let gswKeys = '';
    refreshers.push(() => { const gs = H.groups(); showWhenNow(g, gs.length > 0); const key = gs.map(g => g.key).join('|'); if (key === gswKeys) return; gswKeys = key; gsw.innerHTML = '';
      for (const gr of gs) swatch(gsw, gr.key, () => H.groupColor(gr.key), v => H.setGroupColor(gr.key, v), { auto: () => !H.hasOverride(gr.key), clear: () => H.setGroupColor(gr.key, null) }) });
  }
  {
    const g = group(Col, 'Colours', { keys: 'swatch hex helix sheet loop nucleic surface element carbon nitrogen oxygen paper ink hatch wash arrow charge label context accent' });
    g.append(el('div', { class: 'hexrow' }, hexIn, hexLabel));
    swatchRow(g, 'ribbons and surface', ['helix', 'sheet', 'loop', 'nucleic', 'surface'], true);
    swatchRow(g, 'elements', ['C', 'N', 'O', 'H', 'S', 'P', 'X'], true);
    swatchRow(g, 'paper and marks', ['paper', 'ink', 'hatch', 'wash', 'arrow', 'charge', 'label', 'context', 'accent']);
  }
  {
    const g = group(Col, 'Paper & ink presets', { open: false, keys: 'pymol colored pencil dark sepia' });
    g.append(note('Replaces every colour above.'));
    const pstrips = el('div', { class: 'strips' }); g.append(pstrips);
    for (const name of Object.keys(H.palettes)) { const P = H.palettes[name]; const st = el('div', { class: 'strip' }, el('div', { class: 'chips' }, ...['paper', 'ink', 'C', 'N', 'O', 'helix', 'sheet', 'wash'].map(k => { const i = el('i'); i.style.background = (P as any)[k]; return i })), el('span', {}, name)); st.onclick = () => { H.mark('palette ' + name); H.style.palette = { ...P }; refresh(); H.rebuild() }; pstrips.append(st) }
  }
  function showWhenNow(e: HTMLElement, v: boolean) { e.style.display = v ? '' : 'none' }


  /* ================= Labels ================= */
  const addBtns: HTMLButtonElement[] = [];
  const addLabelBtn = (cls = '') => { const b = el('button', { class: cls, title: 'then click the drawing: on an atom the label follows it as the molecule turns (L)', onclick: () => H.setLabelMode(!H.labelMode()) }, '+ Add label') as HTMLButtonElement; addBtns.push(b); return b };
  refreshers.push(() => addBtns.forEach(b => { b.classList.toggle('on', H.labelMode()); b.textContent = H.labelMode() ? 'Click the drawing…' : '+ Add label' }));
  {
    const g = group(Lab, 'Your labels', { keys: 'add place text annotate custom figure' });
    g.append(el('div', { class: 'btns' }, addLabelBtn('primary')));
    g.append(note('Click the drawing to place one; on an atom (or a ribbon) it follows that residue. Drag to move, double-click to edit, right-click or Delete to remove.'));
    const list = el('div', { class: 'lbllist' }); g.append(list);
    const clearB = el('button', { onclick: () => H.clearLabels() }, 'Remove all') as HTMLButtonElement; const clearRow = el('div', { class: 'btns' }, clearB); g.append(clearRow);
    let key = '';
    refreshers.push(() => { const ls = H.figLabels(); clearRow.style.display = ls.length ? '' : 'none'; const k = JSON.stringify(ls); if (k === key) return; key = k; list.innerHTML = '';
      if (!ls.length) list.append(note('None yet.'));
      for (const l of ls) { const t = el('input', { type: 'text', value: l.text, spellcheck: 'false', 'aria-label': 'label text' }) as HTMLInputElement; t.onchange = () => H.setLabelText(l.i, t.value);
        const sz = el('select', { title: 'size', 'aria-label': 'size' }, ...[['0.75', 'S'], ['1', 'M'], ['1.4', 'L'], ['2', 'XL']].map(([v, n]) => el('option', { value: v }, n))) as HTMLSelectElement;
        sz.value = String([0.75, 1, 1.4, 2].reduce((b, v) => Math.abs(v - l.size) < Math.abs(b - l.size) ? v : b, 1)); sz.onchange = () => H.setLabelSize(l.i, +sz.value);
        list.append(el('div', { class: 'lbl' }, t, sz, el('button', { title: 'delete', onclick: () => H.deleteLabel(l.i) }, '✕'), el('span', { class: 'where' }, l.where))) } });
  }
  {
    const g = group(Lab, 'Show', { keys: 'hide labels alpha beta helix strand residue atom secondary structure' });
    const allIn = el('input', { type: 'checkbox' }) as HTMLInputElement; allIn.onchange = () => { H.mark('labels'); H.style.show.noLabels = !allIn.checked; H.redraw(); refresh() };
    refreshers.push(() => { allIn.checked = !H.style.show.noLabels }); const ar = row(g, 'all labels', allIn); ar.title = 'every label at once: the switch on the drawing does the same';
    const sub = (e: HTMLElement) => showWhen(e, () => !S().show.noLabels);
    const n0 = g.children.length;
    control(g, { t: 'check', label: 'placed labels', path: 'show.figLabels', tip: 'the labels you added' });
    control(g, { t: 'check', label: 'atom labels', path: 'show.labels', tip: 'names a scene gives its atoms, such as His57' });
    control(g, { t: 'check', label: 'residue labels', path: 'show.resLabels', tip: 'every residue drawn as sticks, by name and number' });
    control(g, { t: 'check', label: 'α/β labels', path: 'engrave.labels', when: engraved, tip: 'α1, β1… on the engraved ribbons' });
    for (const r of Array.from(g.children).slice(n0) as HTMLElement[]) { const w = vis.find(v => v[0] === r); if (w) { const f = w[1]; w[1] = () => f() && !S().show.noLabels; r.style.display = w[1]() ? '' : 'none' } else sub(r) }
  }
  {
    const g = group(Lab, 'Text', { keys: 'font size colour color' });
    control(g, { t: 'select', label: 'font', path: 'font', options: ['Caveat', 'Patrick Hand', 'Kalam', 'Plain sans'] });
    control(g, { t: 'range', label: 'label size', path: 'labelSize', min: 10, max: 40, step: 1 });
    control(g, { t: 'color', label: 'colour', path: 'palette.label' });
  }
  /* on the drawing: add a label, hide every label */
  if (stage) {
    const eyeB = el('button', { title: 'show or hide every label', onclick: () => { H.mark('labels'); H.style.show.noLabels = !H.style.show.noLabels; H.redraw(); refresh() } }) as HTMLButtonElement;
    refreshers.push(() => { eyeB.textContent = H.style.show.noLabels ? 'Labels off' : 'Labels on'; eyeB.classList.toggle('off', H.style.show.noLabels) });
    stage.append(el('div', { class: 'stagetools' }, addLabelBtn(), eyeB));
  }

  /* ================= View ================= */
  {
    const g = group(View, 'Camera', { keys: 'perspective fov roll reset zoom pan' });
    const fov = el('input', { type: 'range', min: 0, max: 60, step: 1 }) as HTMLInputElement; const fovv = el('span', { class: 'val' });
    const showFov = () => { fov.value = String(H.camera.fov); fovv.textContent = H.camera.fov < 1 ? 'ortho' : H.camera.fov + '°' };
    fov.oninput = () => { H.mark('perspective'); H.camera.fov = +fov.value; H.style.view.fov = +fov.value; showFov(); H.redraw() }; refreshers.push(() => { H.camera.fov = H.style.view.fov; showFov() }); showFov(); row(g, 'perspective', fov, fovv);
    const roll = el('input', { type: 'range', min: -180, max: 180, step: 1 }) as HTMLInputElement; const rollv = el('span', { class: 'val' });
    const showRoll = () => { roll.value = String(H.camera.roll); rollv.textContent = H.camera.roll + '°' };
    roll.oninput = () => { H.mark('roll'); H.camera.roll = +roll.value; showRoll(); H.redraw() }; refreshers.push(showRoll); showRoll(); row(g, 'roll', roll, rollv);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.mark('reset view'); H.camera.yaw = 0; H.camera.pitch = 0; H.camera.roll = 0; H.camera.zoom = 1; H.camera.panX = 0; H.camera.panY = 0; refresh(); H.redraw() } }, 'Reset view'), el('span', { class: 'note' }, 'drag to rotate · shift-drag to pan · wheel to zoom')));
  }
  {
    const g = group(View, 'Depth & light', { keys: 'fog light angle' });
    control(g, { t: 'range', label: 'fog', path: 'view.fog', min: 0, max: 1, step: 0.05 });
    control(g, { t: 'range', label: 'fog start', path: 'view.fogStart', min: 0, max: 1, step: 0.05, when: () => S().view.fog > 0 });
    control(g, { t: 'range', label: 'light angle', path: 'view.light', min: -180, max: 180, step: 5 });
  }
  {
    /* suggested views: scored orientations, drawn small; click one to take it */
    const g = group(View, 'Suggested views', { open: false, keys: 'orientation best angle' });
    const svBtn = el('button', { title: 'score 120 orientations: rings face-on, the reacting atoms unhidden and apart, wide rather than tall, leaving groups going up and right; then draw the best twelve' }, 'Suggest views') as HTMLButtonElement; const svNote = el('span', { class: 'note' });
    g.append(el('div', { class: 'btns' }, svBtn, svNote)); const svGrid = el('div', { class: 'views' }); g.append(svGrid);
    svBtn.onclick = async () => { svBtn.disabled = true; svGrid.innerHTML = ''; try { const picks = await H.suggest(m => { svNote.textContent = m }); svGrid.innerHTML = '';
        picks.forEach((p, i) => { const t = el('div', { class: 'view', title: `yaw ${p.yaw} pitch ${p.pitch} roll ${p.roll.toFixed(0)} · rings ${p.parts.rings.toFixed(2)} clear ${p.parts.clear.toFixed(2)} apart ${p.parts.spread.toFixed(2)} wide ${p.parts.aspect.toFixed(2)} exit ${p.parts.exit.toFixed(2)}` }, p.canvas!, el('span', {}, `${i + 1} · ${(p.score * 100).toFixed(0)} · ${p.yaw}/${p.pitch}/${p.roll.toFixed(0)}`)); t.onclick = () => H.adoptView(p); svGrid.append(t) });
        svNote.textContent = picks.length ? 'click one; hover for its score' : 'load a scene first' } catch (e: any) { svNote.textContent = e.message } finally { svBtn.disabled = false } };
  }
  {
    /* frame: fit what is drawn into a box of the canvas, for a hero or any layout with text beside the drawing */
    const g = group(View, 'Frame', { open: false, keys: 'fit box hero guides layout' });
    const presetSel = el('select', {}, ...Object.keys(H.framePresets).map(k => el('option', { value: k }, k + ' — ' + H.framePresets[k].note)), el('option', { value: '' }, 'custom')) as HTMLSelectElement;
    const num = (v: number) => el('input', { type: 'number', min: 0, max: 100, step: 1, value: String(Math.round(v * 100)), class: 'num' }) as HTMLInputElement;
    const b0 = H.framePresets[Object.keys(H.framePresets)[0]].box; const L0 = num(b0.x0), T0 = num(b0.y0), R0 = num(b0.x1), B0 = num(b0.y1);
    const box = () => ({ x0: +L0.value / 100, y0: +T0.value / 100, x1: +R0.value / 100, y1: +B0.value / 100 });
    const guides = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const updateGuides = () => H.showGuides(guides.checked ? box() : null);
    presetSel.onchange = () => { const p = H.framePresets[presetSel.value]; if (p) { L0.value = String(Math.round(p.box.x0 * 100)); T0.value = String(Math.round(p.box.y0 * 100)); R0.value = String(Math.round(p.box.x1 * 100)); B0.value = String(Math.round(p.box.y1 * 100)) } updateGuides() };
    for (const i of [L0, T0, R0, B0]) i.oninput = () => { presetSel.value = ''; updateGuides() };
    guides.onchange = updateGuides;
    const what = el('select', {}, el('option', { value: 'all' }, 'the whole animation'), el('option', { value: 'frame' }, 'this frame only')) as HTMLSelectElement;
    row(g, 'preset', presetSel);
    g.append(el('div', { class: 'row' }, el('label', {}, 'box % l t r b'), el('div', { class: 'wide nums' }, L0, T0, R0, B0)));
    row(g, 'fit', what); row(g, 'show guides', guides);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.fitFrame(box(), what.value as 'all' | 'frame'); H.redraw() } }, 'Fit to frame')));
    g.append(note('Fit sets zoom and pan only, so turn the view first. The box is in fractions of the canvas, so a fit at 16:9 renders the same at 1920×1080.'));
  }
  {
    /* motion: boiling, turntable */
    const g = group(View, 'Motion', { open: false, keys: 'turntable spin boil breathing pitch swing animate' });
    const liveIn = el('input', { type: 'checkbox', checked: '' }) as HTMLInputElement; liveIn.onchange = () => H.onLive(liveIn.checked); const br = row(g, 'breathing', liveIn); br.title = 'redraw the lines every so often with a new seed, as hand-drawn animation boils';
    control(g, { t: 'range', label: 'boil every', path: 'boilEvery', min: 1, max: 12, step: 1 });
    control(g, { t: 'range', label: 'boil hold', path: 'boilHold', min: 1, max: 4, step: 1 });
    const tt = el('input', { type: 'range', min: 0, max: 90, step: 1, value: 0 }) as HTMLInputElement; const ttv = el('span', { class: 'val' }, '0');
    tt.oninput = () => { ttv.textContent = tt.value; H.onTurntable(+tt.value) }; row(g, 'turntable °/s', tt, ttv);
    const ps = el('input', { type: 'range', min: 0, max: 40, step: 1, value: 0 }) as HTMLInputElement; const psv = el('span', { class: 'val' }, '0');
    ps.oninput = () => { psv.textContent = ps.value; H.onPitchSwing(+ps.value) }; row(g, 'pitch swing °', ps, psv);
  }
  {
    const g = group(View, 'Engine', { open: false, keys: 'classic sketch preview quality resolution performance' });
    const restSel = el('select', { onchange: (e: any) => H.onRest(e.target.value) }, ...[['classic', 'classic (exact, slower)'], ['sketch', 'sketch (fast)'], ['preview', 'preview only']].map(([v, t]) => el('option', { value: v }, t))) as HTMLSelectElement; restSel.value = 'classic';
    const rr = row(g, 'at rest', restSel); rr.title = 'what draws once the view stops moving';
    const dprSel = el('select', { onchange: (e: any) => H.setDpr(+e.target.value) }, ...['1', '2', '3'].map(o => el('option', { value: o }, o + '×'))) as HTMLSelectElement; dprSel.value = String(Math.min(2, Math.round(window.devicePixelRatio || 1)));
    row(g, 'resolution', dprSel);
    g.append(el('div', { class: 'btns' }, el('button', { onclick: H.renderNow }, 'Render now (classic)')));
    g.append(note('While you drag you see a fast GPU preview; when the view rests the stroke engine redraws the real drawing.'));
  }

  /* ================= Scene ================= */
  /* checks: what the lint pass found on load (and after edits) */
  const Ck = group(Scn, 'Checks', { open: false, keys: 'lint errors warnings' }); const ckList = el('div', { class: 'checks' }); Ck.append(ckList);
  const refreshChecks = () => { const items = H.lint(); ckList.innerHTML = '';
    const c = { error: 0, warn: 0, note: 0 } as any; for (const it of items) c[it.level]++; (Ck.querySelector('summary') as HTMLElement).textContent = items.length ? `Checks · ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warn} warning${c.warn === 1 ? '' : 's'}, ${c.note} note${c.note === 1 ? '' : 's'}` : 'Checks · all clear';
    Ck.classList.toggle('alert', c.error > 0); if (c.error > 0) Ck.open = true;
    if (!items.length) { ckList.append(note('Bonds, arrows, lone pairs, charges and the matching between keyframes all look consistent.')); return }
    for (const it of items) { const d = el('div', { class: 'check ' + it.level, title: it.kf !== null ? 'go to keyframe ' + (it.kf + 1) : '' }, el('b', {}, it.level === 'error' ? '✕' : it.level === 'warn' ? '!' : '·'), el('span', {}, (it.kf !== null ? `${it.kf + 1}: ` : '') + it.text)); if (it.kf !== null) d.onclick = () => H.goToKey(it.kf!); ckList.append(d) }
    ckList.append(el('div', { class: 'btns' }, el('button', { onclick: H.relint }, 'Check again')));
  };
  // the keyframes: name, timing in seconds, camera, order
  const Kf = group(Scn, 'Keyframes', { keys: 'hold transition timing camera order' });
  const kfList = el('div', { class: 'kflist' }); Kf.append(kfList); const loopNote = note(''); Kf.append(loopNote);
  const chg = el('input', { type: 'checkbox' }) as HTMLInputElement; chg.onchange = () => H.setShowChanges(chg.checked); const chgRow = row(Kf, 'show changes', chg); chgRow.title = 'ring what moves, leaves, arrives, breaks or forms on the way to the next keyframe';
  const chgNote = note(''); Kf.append(chgNote);
  let kfKey = '';
  const refreshKeys = () => {
    const ks = H.keyframes(); const cur = H.currentKey(); const key = JSON.stringify(ks) + '|' + cur; if (key === kfKey) return; kfKey = key; kfList.innerHTML = '';
    let dragFrom = -1;
    ks.forEach(k => {
      const name = el('input', { type: 'text', value: k.name, title: 'name' }) as HTMLInputElement; name.onchange = () => H.setKeyName(k.i, name.value);
      const hold = el('input', { type: 'number', min: 0, step: 0.1, value: k.hold.toFixed(2), title: 'hold, seconds' }) as HTMLInputElement, tr = el('input', { type: 'number', min: 0, step: 0.1, value: k.transition.toFixed(2), title: 'transition to the next keyframe, seconds' }) as HTMLInputElement;
      hold.onchange = tr.onchange = () => H.setKeyTiming(k.i, +hold.value, +tr.value);
      const cam = el('button', { class: k.view ? 'on' : '', title: k.view ? 'this keyframe has its own camera: click to clear it' : 'keep the current view as this keyframe\'s camera; the view moves to it during the transition before, and holds through it', onclick: () => H.setKeyView(k.i, !k.view) }, 'cam');
      const r = el('div', { class: 'kf' + (k.i === cur ? ' on' : ''), draggable: 'true' },
        el('span', { class: 'idx', title: 'drag to reorder · click to go there', onclick: () => H.goToKey(k.i) }, String(k.i + 1)), name,
        el('span', { class: 'timing' }, el('span', { class: 'lab' }, 'hold'), hold, el('span', { class: 'lab' }, 's · to next'), tr, el('span', { class: 'lab' }, 's')),
        el('span', { class: 'meta' }, `${k.atoms} atoms · ${k.arrows} arrow${k.arrows === 1 ? '' : 's'}${k.path ? ' · path' : ''}${k.view ? ' · camera' : ''}`),
        el('span', { class: 'acts' }, cam,
          el('button', { title: 'insert a copy after this keyframe (the copy takes this one\'s motion to the next)', onclick: () => H.duplicateKey(k.i) }, 'dup'),
          el('button', { title: 'move up', onclick: () => H.moveKey(k.i, Math.max(0, k.i - 1)) }, '▲'), el('button', { title: 'move down', onclick: () => H.moveKey(k.i, Math.min(ks.length - 1, k.i + 1)) }, '▼'),
          el('button', { title: 'delete this keyframe', onclick: () => { if (ks.length > 1) H.deleteKey(k.i) } }, '✕')));
      r.ondragstart = e => { dragFrom = k.i; e.dataTransfer?.setData('text/plain', String(k.i)); r.classList.add('drag') }; r.ondragend = () => r.classList.remove('drag');
      r.ondragover = e => { e.preventDefault(); r.classList.add('over') }; r.ondragleave = () => r.classList.remove('over');
      r.ondrop = e => { e.preventDefault(); r.classList.remove('over'); if (dragFrom >= 0 && dragFrom !== k.i) H.moveKey(dragFrom, k.i); dragFrom = -1 };
      kfList.append(r);
    });
    const secs = H.loopSeconds(); const nv = ks.filter(k => k.view).length;
    loopNote.textContent = `Loop: ${secs.toFixed(2)} s, ${H.drawnFrames()} drawings at ${H.fps / 2} per second · ${nv ? nv + ' keyframe camera(s)' : 'one camera for the whole loop (press cam on a keyframe to change it there)'}`;
    buildTicks();
  };
  refreshers.push(refreshKeys);
  /* chemistry: arrows, lone pairs and charges by clicking the drawing */
  const Ch = group(Scn, 'Arrows & charges', { keys: 'chemistry author arrow lone pair charge curly' });
  const modes: [string, string, string][] = [['off', 'Look', 'clicks do nothing'], ['arrow', 'Arrow', 'click the tail (atom or bond), then the head'], ['lp', 'Lone pair', 'click an atom: a lone pair on / off'], ['charge', 'Charge', 'click an atom: none → + → − → none']];
  const modeBtns = el('div', { class: 'seg' }); Ch.append(el('div', { class: 'subhead' }, 'clicking the drawing adds'), modeBtns); const mbs: HTMLButtonElement[] = [];
  for (const [m, label, tip] of modes) { const b = el('button', { title: tip, onclick: () => { H.setAuthorMode(m); refreshAuthor() } }, label) as HTMLButtonElement; b.dataset.mode = m; mbs.push(b); modeBtns.append(b) }
  const aText = el('div', { class: 'note', style: 'min-height:2.6em' }); Ch.append(aText);
  Ch.append(el('div', { class: 'subhead' }, 'arrows of this keyframe')); const arList = el('div', { class: 'arrows' }); Ch.append(arList);
  Ch.append(note('Edits go into the scene: Save scene JSON (Export) keeps them. An arrow\'s tail is the atom\'s lone pair when it has one, else the atom or the bond; flip the bow if it crosses something.'));
  let arKey = '';
  const refreshAuthor = () => { const m = H.authorMode(); const dn = H.diffNote(); chgNote.textContent = dn || 'Hover the timeline: orange rings move, red breaks or leaves, green forms or arrives, yellow changes order or charge.'; mbs.forEach(b => b.classList.toggle('on', b.dataset.mode === m)); aText.textContent = H.authorText();
    const ars = H.arrowsOf(); const key = JSON.stringify(ars) + H.currentKey(); if (key === arKey) return; arKey = key; arList.innerHTML = '';
    if (!ars.length) arList.append(note('none'));
    for (const a of ars) { const bul = el('input', { type: 'number', min: 0, max: 1.5, step: 0.05, value: String(a.bulge), title: 'bow: fraction of the arrow\'s length' }) as HTMLInputElement; bul.onchange = () => H.editArrow(a.j, 'bulge', +bul.value);
      arList.append(el('div', { class: 'arrow' }, el('span', {}, `${a.j + 1}. ${a.text}`), bul, el('button', { title: 'bow the other way', onclick: () => H.editArrow(a.j, 'flip') }, a.side > 0 ? '⤴' : '⤵'), el('button', { title: 'delete', onclick: () => H.editArrow(a.j, 'delete') }, '✕'))) }
  };
  refreshers.push(refreshAuthor);
  const noScene = note('Open a scene JSON, or several structure files at once, to animate between keyframes. Try Examples → Serine hydrolase mechanism.'); Scn.prepend(noScene);

  /* ---------- timeline under the drawing (scenes) ---------- */
  const tl = document.getElementById('timeline');
  const playBtn = el('button', { class: 'play', title: 'play / pause (space)', onclick: () => { H.play(!H.isPlaying()); showPlay() } }, '▶') as HTMLButtonElement;
  const showPlay = () => { playBtn.textContent = H.isPlaying() ? '❚❚' : '▶'; playBtn.classList.toggle('on', H.isPlaying()) };
  const frameIn = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'time' }) as HTMLInputElement;
  frameIn.oninput = () => { H.seek(+frameIn.value); showPlay() };
  frameIn.onmouseenter = () => H.setHoverChanges(true); frameIn.onmouseleave = () => H.setHoverChanges(false);
  const ticks = el('div', { class: 'ticks' }); const track = el('div', { class: 'track' }, ticks, frameIn);
  const tName = el('span', { class: 'tname' }), tTime = el('span', { class: 'ttime' });
  tl?.append(playBtn, el('button', { class: 'icon', title: 'step back (,)', onclick: () => { H.step(-2); showPlay() } }, '‹'), el('button', { class: 'icon', title: 'step on (.)', onclick: () => { H.step(2); showPlay() } }, '›'), track, el('div', { class: 'tinfo' }, tName, tTime));
  let total = 1;
  function buildTicks() { ticks.innerHTML = ''; const st = H.keyStarts(); const ks = H.keyframes(); const cur = H.currentKey();
    st.forEach((f, i) => { const t = el('button', { class: 'tick' + (i === cur ? ' on' : ''), title: `${i + 1}. ${ks[i]?.name || ''}`, onclick: () => { H.goToKey(i); showPlay() } }, String(i + 1)); t.style.left = Math.min(100, 100 * f / Math.max(1, total - 1)) + '%'; ticks.append(t) }) }
  const transport = (f: number, tot: number, name: string) => { const grew = tot !== total; total = tot; if (grew) buildTicks(); frameIn.max = String(tot - 1); frameIn.value = String(f); tName.textContent = name; tTime.textContent = `${(f / H.fps).toFixed(1)} / ${(tot / H.fps).toFixed(1)} s`; showPlay(); refreshKeys(); refreshAuthor() };
  const refreshScene = () => { const on = H.hasScene(); tabs.find(t => t.key === 'scene')!.btn.style.display = on ? '' : 'none'; if (tl) tl.hidden = !on; for (const g of [Ck, Kf, Ch]) g.style.display = on ? '' : 'none'; noScene.style.display = on ? 'none' : '';
    if (!on && active === 'scene') active = 'look'; if (on) refreshChecks(); layoutTabs() };
  refreshers.push(refreshScene);

  /* ================= Export ================= */
  const sizes: [string, [number, number]][] = [['1920×1080 (16:9)', [1920, 1080]], ['1080×1920 (9:16, phones)', [1080, 1920]], ['1280×720', [1280, 720]], ['1080×1080 (square)', [1080, 1080]], ['3840×2160 (4K)', [3840, 2160]]];
  const sizeSel = el('select', {}, ...sizes.map(([l, v]) => el('option', { value: v.join('x') }, l)), el('option', { value: 'canvas' }, 'the canvas as it is'), el('option', { value: 'custom' }, 'custom…')) as HTMLSelectElement;
  const cw = el('input', { type: 'number', min: 64, step: 2, value: '1920', class: 'num wide4' }) as HTMLInputElement, chh = el('input', { type: 'number', min: 64, step: 2, value: '1080', class: 'num wide4' }) as HTMLInputElement;
  const outSize = (): [number, number] | null => sizeSel.value === 'canvas' ? null : sizeSel.value === 'custom' ? [Math.max(64, Math.round(+cw.value / 2) * 2), Math.max(64, Math.round(+chh.value / 2) * 2)] : sizeSel.value.split('x').map(Number) as [number, number];
  let customRow: HTMLElement;
  {
    const g = group(Exp, 'Picture', { keys: 'png jpeg poster image size save' });
    row(g, 'size', sizeSel); customRow = el('div', { class: 'row' }, el('label', {}, 'width × height'), el('div', { class: 'wide nums' }, cw, '×', chh)); g.append(customRow); customRow.style.display = 'none';
    const posterBtn = el('button', { title: 'the first keyframe with its arrows drawn, as a JPEG at the output size' }, 'Poster (JPEG)'), frameBtn = el('button', { class: 'primary', title: 'this frame as a PNG at the output size' }, 'Save PNG at this size');
    posterBtn.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], H.posterFrame(), 'image/jpeg') };
    frameBtn.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], undefined, 'image/png') };
    const posterWrap = el('span', {}, posterBtn); showWhen(posterWrap, () => H.hasScene());
    const svgBtn = el('button', { title: 'this frame as SVG: lines, fills and letters as vectors, paper and washes embedded (drawn by the molsketch server)' }, 'Save SVG');
    svgBtn.onclick = () => { const sz = outSize() || H.canvasSize(); H.saveSvg(sz[0], sz[1]) };
    const svgWrap = el('span', {}, svgBtn); showWhen(svgWrap, () => H.hasSdk());
    g.append(el('div', { class: 'btns' }, frameBtn, posterWrap, svgWrap));
    g.append(note('The canvas keeps the output\'s shape (letterboxed), so what you frame on screen is what the file holds. Save PNG in the top bar saves the screen as it is.'));
  }
  /* render: the loop as a video file, made here */
  const codecSel = el('select', {}, ...[['auto', 'smallest the browser can make'], ['av1', 'AV1 (.av1.mp4)'], ['vp9', 'VP9 (.webm)'], ['h264', 'H.264 (.mp4, plays everywhere)']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const qualSel = el('select', {}, ...[['small', 'small (like the site\'s encodes)'], ['medium', 'medium'], ['high', 'high']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const codecNote = note('');
  const prog = el('progress', { max: '1', value: '0', style: 'width:100%;display:none' }) as HTMLProgressElement; const progNote = note('');
  const goBtn = el('button', { class: 'primary' }, 'Render video') as HTMLButtonElement, cancelBtn = el('button', { onclick: H.cancelRender, style: 'display:none' }, 'Cancel') as HTMLButtonElement;
  let support: any = null; let sizeKey = '';
  const refreshRender = async () => {
    const sz = outSize(); customRow.style.display = sizeSel.value === 'custom' ? '' : 'none'; H.setRenderSize(sz); const [w, h] = sz || H.canvasSize();
    if (!H.hasWebCodecs()) { codecNote.textContent = 'This browser has no VideoEncoder (WebCodecs): rendering video here needs Chrome or Edge. The render command below does it from the terminal.'; goBtn.disabled = true; return }
    const key = w + 'x' + h; if (key === sizeKey) return; sizeKey = key; support = await H.codecSupport(w, h);
    const have = ['av1', 'vp9', 'h264'].filter(c => support[c]); goBtn.disabled = !have.length;
    codecNote.textContent = have.length ? `This browser encodes ${have.map(c => c.toUpperCase() + (support[c].quantizer ? '' : ' (bitrate only)')).join(', ')} at ${w}×${h}; ${H.drawnFrames()} drawings at ${H.fps / 2} per second.` : `No codec available at ${w}×${h}.`;
  };
  sizeSel.onchange = refreshRender; cw.onchange = chh.onchange = refreshRender;
  goBtn.onclick = async () => {
    const sz = outSize() || H.canvasSize(); let codec = codecSel.value; if (codec === 'auto') codec = ['av1', 'vp9', 'h264'].find(c => support?.[c]) || 'h264';
    goBtn.disabled = true; cancelBtn.style.display = ''; prog.style.display = ''; prog.value = 0; const t0 = performance.now();
    try { const r = await H.renderToFile({ width: sz[0], height: sz[1], codec, quality: qualSel.value, onProgress: (d, n, b, eta) => { prog.value = d / n; progNote.textContent = `${d} / ${n} drawings · ${(b / 1048576).toFixed(2)} MB so far, about ${(b / d * n / 1048576).toFixed(2)} MB in all · ${eta > 60 ? (eta / 60).toFixed(1) + ' min' : eta.toFixed(0) + ' s'} left` } });
      progNote.textContent = `${r.name}: ${(r.bytes / 1048576).toFixed(2)} MB, ${r.seconds.toFixed(1)} s (${r.codecString}) in ${((performance.now() - t0) / 1000).toFixed(0)} s — downloaded` }
    catch (e: any) { progNote.textContent = e.message }
    finally { goBtn.disabled = false; cancelBtn.style.display = 'none'; prog.style.display = 'none' }
  };
  {
    const g = group(Exp, 'Video', { keys: 'render loop mp4 webm av1 vp9 h264 codec quality animation turntable' });
    row(g, 'codec', codecSel); row(g, 'quality', qualSel); g.append(codecNote);
    g.append(el('div', { class: 'btns' }, goBtn, cancelBtn)); g.append(prog, progNote);
    g.append(note('Renders the scene\'s loop (or the turntable) at the picture size. The boil hold in View › Motion applies here too.'));
  }
  refreshers.push(() => { refreshRender() });
  {
    const g = group(Exp, 'Files', { keys: 'save load style scene json reset' });
    const styleIn = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadStyle(f); e.target.value = '' } }) as HTMLInputElement;
    g.append(el('div', { class: 'subhead' }, 'scene'), el('div', { class: 'btns' }, el('button', { onclick: H.saveScene, title: 'the structure or scene with its keyframes, arrows and camera' }, 'Save scene JSON')));
    g.append(el('div', { class: 'subhead' }, 'style'), el('div', { class: 'btns' }, el('button', { onclick: H.saveStyle, title: 'every setting of the Look, Colour and View tabs' }, 'Save style'), el('button', { onclick: () => styleIn.click() }, 'Load style…'), styleIn,
      el('button', { onclick: H.reset, title: 'back to the default style (undoable)' }, 'Reset style')));
    g.append(note('The style is also kept in this browser between visits.'));
  }
  {
    const g = group(Exp, 'Command line', { open: false, keys: 'cli render command terminal batch' });
    const cmd = el('textarea', { readonly: '', rows: '4', class: 'cmd' }) as HTMLTextAreaElement;
    const showCmd = () => { cmd.value = H.renderCommand() }; refreshers.push(showCmd);
    g.append(note('Renders exactly this from the terminal, with the molsketch Python package (pip install ./python). Save the scene JSON and the style first; the command names those files.'), cmd,
      el('div', { class: 'btns' }, el('button', { onclick: (e: any) => { showCmd(); navigator.clipboard?.writeText(cmd.value); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy render command', 1200) } }, 'Copy render command')));
  }

  const refresh = () => refreshers.forEach(f => f());
  refresh(); layoutTabs();
  return { refresh, transport, refreshChecks, refreshHistory, refreshAuthor, selectTab };
}
