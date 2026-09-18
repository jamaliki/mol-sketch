/* The right-hand panel, generated from a small schema bound to style paths. */
import type { Style, Palette } from '../style';
import type { Camera } from '../render/camera';

export interface PanelHost {
  style: Style;
  looks: Record<string, { name: string; note: string }>;
  currentLook: () => string;
  applyLook: (k: string) => void;
  rebuild: () => void; redraw: () => void;
  camera: Camera;
  onLive: (v: boolean) => void; onTurntable: (v: number) => void; onPitchSwing: (v: number) => void; onRest: (v: string) => void; renderNow: () => void;
  play: (v: boolean) => void; isPlaying: () => boolean; seek: (f: number) => void; step: (d: number) => void;
  savePng: () => void; saveStyle: () => void; loadStyle: (f: File) => void; loadFile: (f: File) => void; loadFiles: (f: File[]) => void; saveScene: () => void; loadExample: (n: string) => void; reset: () => void;
  setDpr: (v: number) => void;
  palettes: Record<string, Palette>;
  framePresets: Record<string, { box: { x0: number; y0: number; x1: number; y1: number }; note: string; size: [number, number] }>;
  fitFrame: (box: { x0: number; y0: number; x1: number; y1: number }, what: 'all' | 'frame') => void;
  showGuides: (box: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  renderCommand: () => string; canvasSize: () => [number, number];
  groupPalettes: Record<string, { colors: string[]; source: string; family: string }>;
  groups: () => { key: string }[]; groupColor: (k: string) => string; setGroupColor: (k: string, v: string | null) => void; hasOverride: (k: string) => boolean;
}

type Ctl =
  | { t: 'range'; label: string; path: string; min: number; max: number; step: number; geom?: boolean }
  | { t: 'select'; label: string; path: string; options: string[]; geom?: boolean }
  | { t: 'text'; label: string; path: string; geom?: boolean; placeholder?: string }
  | { t: 'color'; label: string; path: string; geom?: boolean }
  | { t: 'check'; label: string; path: string; geom?: boolean };

const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
const set = (o: any, path: string, v: any) => { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v };

export function buildPanel(root: HTMLElement, H: PanelHost) {
  const refreshers: (() => void)[] = [];
  const el = (tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) (e as any)[k] = attrs[k]; else e.setAttribute(k, attrs[k]) } for (const c of kids) e.append(c); return e };
  const section = (title: string, open = true) => { const d = el('details', open ? { open: '' } : {}, el('summary', {}, title)); root.append(d); return d };
  const row = (parent: HTMLElement, label: string, ...kids: Node[]) => { const r = el('div', { class: 'row' }, el('label', {}, label), ...kids); parent.append(r); return r };
  const control = (parent: HTMLElement, c: Ctl) => {
    const after = () => (c.geom ? H.rebuild() : H.redraw());
    if (c.t === 'range') {
      const inp = el('input', { type: 'range', min: c.min, max: c.max, step: c.step }) as HTMLInputElement; const val = el('span', { class: 'val' });
      const show = () => { const v = get(H.style, c.path); inp.value = String(v); val.textContent = Number(v).toFixed(c.step < 0.1 ? 2 : c.step < 1 ? 1 : 0) };
      inp.oninput = () => { set(H.style, c.path, +inp.value); show(); after() }; refreshers.push(show); show(); row(parent, c.label, inp, val);
    } else if (c.t === 'select') {
      const s = el('select', {}, ...c.options.map(o => el('option', { value: o }, o))) as HTMLSelectElement;
      const show = () => { s.value = get(H.style, c.path) }; s.onchange = () => { set(H.style, c.path, s.value); after() }; refreshers.push(show); show(); row(parent, c.label, s);
    } else if (c.t === 'text') {
      const inp = el('input', { type: 'text', placeholder: c.placeholder || '' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) ?? '' }; inp.onchange = () => { set(H.style, c.path, inp.value); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'color') {
      const inp = el('input', { type: 'color' }) as HTMLInputElement;
      const show = () => { inp.value = get(H.style, c.path) }; inp.oninput = () => { set(H.style, c.path, inp.value); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    } else if (c.t === 'check') {
      const inp = el('input', { type: 'checkbox' }) as HTMLInputElement;
      const show = () => { inp.checked = !!get(H.style, c.path) }; inp.onchange = () => { set(H.style, c.path, inp.checked); after() }; refreshers.push(show); show(); row(parent, c.label, inp);
    }
  };

  /* looks */
  const L = section('Looks'); const grid = el('div', { class: 'looks' }); L.append(grid);
  const lookBtns: HTMLButtonElement[] = [];
  for (const k in H.looks) { const b = el('button', { onclick: () => H.applyLook(k) }, el('b', {}, H.looks[k].name), el('span', {}, H.looks[k].note)) as HTMLButtonElement; b.dataset.key = k; grid.append(b); lookBtns.push(b) }
  refreshers.push(() => lookBtns.forEach(b => b.classList.toggle('on', b.dataset.key === H.currentLook())));

  /* data */
  const D = section('Data');
  const fileIn = el('input', { type: 'file', accept: '.pdb,.ent,.cif,.mmcif,.json', multiple: '', style: 'display:none', onchange: (e: any) => { const fl = Array.from(e.target.files as FileList); if (fl.length) H.loadFiles(fl); e.target.value = '' } }) as HTMLInputElement;
  const styleIn = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadStyle(f); e.target.value = '' } }) as HTMLInputElement;
  const ex = el('select', {}, ...['mechanism.json', 'calb_pnpa.json', '1A8O.pdb', '1LCD.pdb', 'test_protein.pdb', 'test_protein_rna.cif', '6GZQ.cif'].map(o => el('option', { value: o }, o))) as HTMLSelectElement;
  D.append(el('div', { class: 'btns' },
    el('button', { onclick: () => fileIn.click() }, 'Open PDB / mmCIF / scene… (several = a stack)'), fileIn,
    el('button', { onclick: () => H.loadExample(ex.value) }, 'Load example'), ex));
  D.append(el('div', { class: 'btns' },
    el('button', { onclick: H.savePng }, 'Save PNG'), el('button', { onclick: H.saveScene }, 'Save scene JSON'), el('button', { onclick: H.saveStyle }, 'Save style'), el('button', { onclick: () => styleIn.click() }, 'Load style…'), styleIn,
    el('button', { onclick: H.reset }, 'Reset')));
  const dprSel = el('select', { onchange: (e: any) => H.setDpr(+e.target.value) }, ...['1', '2', '3'].map(o => el('option', { value: o }, o + '×'))) as HTMLSelectElement; dprSel.value = String(Math.min(2, Math.round(window.devicePixelRatio || 1)));
  row(D, 'resolution', dprSel);
  const cmd = el('textarea', { readonly: '', rows: '3', style: 'width:100%;font:11px/1.35 ui-monospace,Menlo,monospace;background:#1a1917;color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:4px;resize:vertical' }) as HTMLTextAreaElement;
  const showCmd = () => { cmd.value = H.renderCommand() }; refreshers.push(showCmd);
  D.append(el('div', { class: 'btns' }, el('button', { onclick: () => { showCmd(); navigator.clipboard?.writeText(cmd.value) } }, 'Copy render command'), el('span', { style: 'color:var(--dim);font-size:11px;align-self:center' }, 'save the scene JSON and the style first; the command renders exactly this')));
  D.append(cmd);
  D.append(el('div', { id: 'status' }));

  /* transport (scenes) */
  const T = section('Animation'); T.style.display = 'none';
  const playBtn = el('button', { onclick: () => { H.play(!H.isPlaying()); playBtn.textContent = H.isPlaying() ? 'Pause' : 'Play' } }, 'Play') as HTMLButtonElement;
  const frameIn = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0 }) as HTMLInputElement; const frameV = el('span', { class: 'val' }, '0');
  frameIn.oninput = () => { H.seek(+frameIn.value); playBtn.textContent = 'Play' };
  const stepName = el('div', { style: 'color:var(--dim);font-size:11px;margin:2px 0 4px' }, '');
  T.append(el('div', { class: 'btns' }, playBtn, el('button', { onclick: () => H.step(-2) }, '◀ step'), el('button', { onclick: () => H.step(2) }, 'step ▶')));
  row(T, 'frame', frameIn, frameV); T.append(stepName);
  const transport = (f: number, total: number, name: string) => { T.style.display = ''; frameIn.max = String(total - 1); frameIn.value = String(f); frameV.textContent = String(f); stepName.textContent = name; playBtn.textContent = H.isPlaying() ? 'Pause' : 'Play' };

  /* representations */
  const Rp = section('Representations');
  control(Rp, { t: 'text', label: 'sticks', path: 'reps.sticks', geom: true, placeholder: 'hetatm and not water' });
  control(Rp, { t: 'text', label: 'cartoon', path: 'reps.cartoon', geom: true, placeholder: 'polymer' });
  control(Rp, { t: 'text', label: 'surface', path: 'reps.surface', geom: true, placeholder: 'polymer' });
  control(Rp, { t: 'select', label: 'sticks as', path: 'mode', options: ['sticks', 'ballstick'] });
  control(Rp, { t: 'range', label: 'stick radius', path: 'stickRadius', min: 0.08, max: 0.5, step: 0.01, geom: true });
  control(Rp, { t: 'range', label: 'cut spheres', path: 'sphereScale', min: 0, max: 1, step: 0.05, geom: true });
  control(Rp, { t: 'range', label: 'cartoon scale', path: 'cartoonScale', min: 0.4, max: 2.5, step: 0.05, geom: true });
  control(Rp, { t: 'range', label: 'surface probe', path: 'probe', min: 0, max: 3, step: 0.1, geom: true });
  control(Rp, { t: 'select', label: 'detail', path: 'detail', options: ['auto', 'full'] });
  control(Rp, { t: 'select', label: 'texture', path: 'textureScale', options: ['screen', 'object'] });

  /* colour */
  const C = section('Colour');
  control(C, { t: 'select', label: 'fill', path: 'fill', options: ['watercolour', 'ink colour', 'ink', 'pencil', 'chalk', 'flat', 'wash'] });
  control(C, { t: 'range', label: 'shading', path: 'shading', min: 0, max: 1, step: 0.05 });
  control(C, { t: 'range', label: 'pencil fill', path: 'pencilFill', min: 0, max: 1, step: 0.05 });
  control(C, { t: 'range', label: 'fill wobble', path: 'fillWobble', min: 0, max: 2, step: 0.05 });
  control(C, { t: 'check', label: 'construction', path: 'construction' });
  control(C, { t: 'select', label: 'carbons by', path: 'colorBy', options: ['residue', 'element', 'chain', 'subunit', 'entity'], geom: true });
  control(C, { t: 'select', label: 'cartoon by', path: 'cartoonColor', options: ['ss', 'carbon'], geom: true });
  control(C, { t: 'select', label: 'surface by', path: 'surfaceColor', options: ['subunit', 'chain', 'entity', 'residue', 'single'], geom: true });
  /* swatches: one square per colour, click to pick, the hex field edits the selected one */
  let selected: { get: () => string; set: (v: string) => void; label: string } | null = null;
  const hexIn = el('input', { type: 'text', placeholder: '#rrggbb', spellcheck: 'false' }) as HTMLInputElement; const hexLabel = el('span', { style: 'color:var(--dim);font-size:11px' }, 'click a swatch');
  hexIn.oninput = () => { if (selected && /^#[0-9a-f]{6}$/i.test(hexIn.value)) { selected.set(hexIn.value.toLowerCase()); refresh(); H.redraw() } };
  const swatch = (parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, opts: { auto?: () => boolean; clear?: () => void } = {}) => {
    const inp = el('input', { type: 'color' }) as HTMLInputElement; const i = el('i'); const d = el('div', { class: 'sw', title: label }, i, el('span', {}, label), inp);
    const show = () => { const v = get(); i.style.background = v; inp.value = v; d.classList.toggle('auto', !!opts.auto?.()); d.classList.toggle('on', selected?.label === label); if (selected?.label === label) { hexIn.value = v; hexLabel.textContent = label + (opts.auto?.() ? ' (automatic)' : '') } };
    d.onclick = (e) => { if (e.target === inp) return; selected = { get, set, label }; refresh(); inp.click() };
    d.oncontextmenu = (e) => { e.preventDefault(); if (opts.clear) { opts.clear(); refresh() } };
    inp.oninput = () => { set(inp.value); show(); H.redraw() }; inp.onchange = () => { set(inp.value); refresh() };
    refreshers.push(show); show(); parent.append(d); return d;
  };
  const stylePal = (key: string, geom = false) => [() => (H.style.palette as any)[key] as string, (v: string) => { (H.style.palette as any)[key] = v; if (geom) H.rebuild() }] as const;
  const swatchGroup = (title: string, keys: string[], geom = false) => { C.append(el('div', { class: 'subhead' }, title)); const g = el('div', { class: 'swatches' }); C.append(g); for (const k of keys) { const [get, set] = stylePal(k, geom); swatch(g, k, get, set) } };
  // paper presets as strips
  C.append(el('div', { class: 'subhead' }, 'paper and ink presets'));
  const pstrips = el('div', { class: 'strips', style: 'max-height:none' }); C.append(pstrips);
  for (const name of Object.keys(H.palettes)) { const P = H.palettes[name]; const st = el('div', { class: 'strip' }, el('div', { class: 'chips' }, ...['paper', 'ink', 'C', 'N', 'O', 'wash'].map(k => { const i = el('i'); i.style.background = (P as any)[k]; return i })), el('span', {}, name)); st.onclick = () => { H.style.palette = { ...P }; refresh(); H.rebuild() }; pstrips.append(st) }
  C.append(el('div', { class: 'hexrow' }, hexIn, hexLabel));
  swatchGroup('paper and marks', ['paper', 'ink', 'hatch', 'wash', 'arrow', 'charge', 'label', 'context', 'accent']);
  swatchGroup('elements', ['C', 'N', 'O', 'H', 'S', 'P', 'X'], true);
  swatchGroup('cartoon and surface', ['helix', 'sheet', 'loop', 'nucleic', 'surface'], true);
  // group palettes: the colours residues and molecules get in order of appearance — tiles in three families; hover previews, click keeps
  C.append(el('div', { class: 'subhead' }, 'group palette (residues, chains, molecules in order)'));
  const tiles: HTMLElement[] = []; let kept: { name: string; colors: string[] | null } | null = null;
  const applyPal = (name: string, colors: string[]) => { H.style.groupPalette = name === 'Triad' ? null : colors.slice(); H.style.groupPaletteName = name; H.rebuild() };
  const families: [string, string, string][] = [['drawing', 'for drawings', 'the engine and the lab site'], ['safe', 'colour-blind safe', 'Okabe–Ito, Paul Tol, Tableau'], ['studies', 'studies', 'jamaliki / design-corner']];
  for (const [fam, title, note] of families) {
    C.append(el('div', { class: 'famhead' }, el('span', { class: 'subhead', style: 'margin:0' }, title), el('small', {}, note)));
    const grid = el('div', { class: 'paltiles' }); C.append(grid);
    for (const name of Object.keys(H.groupPalettes)) { const gp = H.groupPalettes[name]; if (gp.family !== fam) continue;
      const t = el('div', { class: 'paltile', title: name + ' — ' + gp.source }, el('div', { class: 'bands' }, ...gp.colors.map(c => { const i = el('i'); i.style.background = c; return i })), el('span', {}, name)); t.dataset.name = name;
      t.onmouseenter = () => { if (!kept) kept = { name: H.style.groupPaletteName, colors: H.style.groupPalette }; applyPal(name, gp.colors) };
      t.onmouseleave = () => { if (kept) { H.style.groupPalette = kept.colors; H.style.groupPaletteName = kept.name; kept = null; H.rebuild() } };
      t.onclick = () => { kept = null; applyPal(name, gp.colors); refresh() };
      grid.append(t); tiles.push(t) }
  }
  refreshers.push(() => tiles.forEach(e => e.classList.toggle('on', e.dataset.name === (H.style.groupPaletteName || 'Triad'))));
  // the groups of what is loaded, each with its colour now; click to override, right-click to let the palette decide again
  C.append(el('div', { class: 'subhead' }, 'groups in this file (right-click: back to the palette)'));
  const gsw = el('div', { class: 'swatches' }); C.append(gsw);
  let gswKeys = '';
  refreshers.push(() => { const gs = H.groups(); const key = gs.map(g => g.key).join('|'); if (key === gswKeys) return; gswKeys = key; gsw.innerHTML = '';
    for (const g of gs) swatch(gsw, g.key, () => H.groupColor(g.key), v => H.setGroupColor(g.key, v), { auto: () => !H.hasOverride(g.key), clear: () => H.setGroupColor(g.key, null) }) });

  /* annotations */
  const An = section('Annotations', false);
  for (const [k, label] of [['H', 'hydrogens'], ['lonePairs', 'lone pairs'], ['charges', 'charges'], ['arrows', 'arrows'], ['labels', 'labels'], ['resLabels', 'residue labels'], ['hbonds', 'H-bonds'], ['valence', 'valence'], ['caption', 'caption'], ['stepLabel', 'step label']]) control(An, { t: 'check', label, path: 'show.' + k });
  control(An, { t: 'select', label: 'font', path: 'font', options: ['Caveat', 'Patrick Hand', 'Kalam', 'Plain sans'] });
  control(An, { t: 'range', label: 'label size', path: 'labelSize', min: 10, max: 40, step: 1 });
  control(An, { t: 'range', label: 'caption size', path: 'captionSize', min: 12, max: 48, step: 1 });

  /* lines */
  const Ln = section('Lines');
  control(Ln, { t: 'range', label: 'width', path: 'line.width', min: 0.3, max: 4, step: 0.1 });
  control(Ln, { t: 'range', label: 'roughness', path: 'line.rough', min: 0, max: 3, step: 0.05 });
  control(Ln, { t: 'range', label: 'passes', path: 'line.passes', min: 1, max: 4, step: 1 });
  control(Ln, { t: 'range', label: 'hierarchy', path: 'line.hierarchy', min: 0, max: 1, step: 0.05 });
  control(Ln, { t: 'range', label: 'pressure', path: 'line.pressure', min: 0, max: 1, step: 0.05 });
  control(Ln, { t: 'range', label: 'opacity', path: 'line.alpha', min: 0, max: 1, step: 0.05 });

  /* hatching */
  const Ht = section('Hatching', false);
  control(Ht, { t: 'range', label: 'spacing', path: 'hatch.spacing', min: 2, max: 14, step: 0.5 });
  control(Ht, { t: 'range', label: 'angle', path: 'hatch.angle', min: -90, max: 90, step: 5 });
  control(Ht, { t: 'range', label: 'density', path: 'hatch.density', min: 0, max: 2.5, step: 0.05 });

  /* watercolour */
  const W = section('Watercolour', false);
  control(W, { t: 'range', label: 'layers', path: 'water.layers', min: 1, max: 4, step: 1 });
  control(W, { t: 'range', label: 'wobble', path: 'water.wobble', min: 0, max: 3, step: 0.05 });
  control(W, { t: 'range', label: 'drying ring', path: 'water.ring', min: 0, max: 2, step: 0.05 });
  control(W, { t: 'range', label: 'granulation', path: 'water.granulation', min: 0, max: 2, step: 0.05 });
  control(W, { t: 'range', label: 'tone', path: 'water.tone', min: 0, max: 1.5, step: 0.05 });

  /* paper */
  const Pp = section('Paper', false);
  control(Pp, { t: 'range', label: 'grain', path: 'paper.grain', min: 0, max: 2, step: 0.05 });
  control(Pp, { t: 'range', label: 'wash', path: 'paper.wash', min: 0, max: 1, step: 0.05 });
  control(Pp, { t: 'range', label: 'wash seed', path: 'paper.washSeed', min: 1, max: 40, step: 1 });
  control(Pp, { t: 'range', label: 'wash life', path: 'paper.washLife', min: 0, max: 2, step: 0.05 });
  control(Pp, { t: 'range', label: 'wash scale', path: 'paper.washScale', min: 0.3, max: 3, step: 0.05 });

  /* view */
  const V = section('View');
  const fov = el('input', { type: 'range', min: 0, max: 60, step: 1 }) as HTMLInputElement; const fovv = el('span', { class: 'val' });
  const showFov = () => { fov.value = String(H.camera.fov); fovv.textContent = H.camera.fov < 1 ? 'ortho' : H.camera.fov + '°' };
  fov.oninput = () => { H.camera.fov = +fov.value; H.style.view.fov = +fov.value; showFov(); H.redraw() }; refreshers.push(() => { H.camera.fov = H.style.view.fov; showFov() }); showFov(); row(V, 'perspective', fov, fovv);
  const roll = el('input', { type: 'range', min: -180, max: 180, step: 1 }) as HTMLInputElement; const rollv = el('span', { class: 'val' });
  const showRoll = () => { roll.value = String(H.camera.roll); rollv.textContent = H.camera.roll + '°' };
  roll.oninput = () => { H.camera.roll = +roll.value; showRoll(); H.redraw() }; refreshers.push(showRoll); showRoll(); row(V, 'roll', roll, rollv);
  control(V, { t: 'range', label: 'fog', path: 'view.fog', min: 0, max: 1, step: 0.05 });
  control(V, { t: 'range', label: 'fog start', path: 'view.fogStart', min: 0, max: 1, step: 0.05 });
  control(V, { t: 'range', label: 'light angle', path: 'view.light', min: -180, max: 180, step: 5 });
  control(V, { t: 'range', label: 'boil every', path: 'boilEvery', min: 1, max: 12, step: 1 });
  control(V, { t: 'range', label: 'boil hold', path: 'boilHold', min: 1, max: 4, step: 1 });
  const restSel = el('select', { onchange: (e: any) => H.onRest(e.target.value) }, ...[['classic', 'classic (exact, slower)'], ['sketch', 'sketch (fast)'], ['preview', 'preview only']].map(([v, t]) => el('option', { value: v }, t))) as HTMLSelectElement; restSel.value = 'classic'; row(V, 'at rest', restSel);
  V.append(el('div', { class: 'btns' }, el('button', { onclick: H.renderNow }, 'Render now (classic)')));
  const liveIn = el('input', { type: 'checkbox', checked: '' }) as HTMLInputElement; liveIn.onchange = () => H.onLive(liveIn.checked); row(V, 'breathing', liveIn);
  const tt = el('input', { type: 'range', min: 0, max: 90, step: 1, value: 0 }) as HTMLInputElement; const ttv = el('span', { class: 'val' }, '0');
  tt.oninput = () => { ttv.textContent = tt.value; H.onTurntable(+tt.value) }; row(V, 'turntable °/s', tt, ttv);
  const ps = el('input', { type: 'range', min: 0, max: 40, step: 1, value: 0 }) as HTMLInputElement; const psv = el('span', { class: 'val' }, '0');
  ps.oninput = () => { psv.textContent = ps.value; H.onPitchSwing(+ps.value) }; row(V, 'pitch swing °', ps, psv);
  V.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.camera.yaw = 0; H.camera.pitch = 0; H.camera.roll = 0; H.camera.zoom = 1; H.camera.panX = 0; H.camera.panY = 0; H.redraw() } }, 'Reset view')));

  /* frame: fit what is drawn into a box of the canvas, for a hero or any layout with text beside the drawing */
  const Fr = section('Frame', false);
  const presetSel = el('select', {}, ...Object.keys(H.framePresets).map(k => el('option', { value: k }, k + ' — ' + H.framePresets[k].note)), el('option', { value: '' }, 'custom')) as HTMLSelectElement;
  const num = (v: number) => { const i = el('input', { type: 'number', min: 0, max: 100, step: 1, value: String(Math.round(v * 100)), style: 'width:40px;padding:2px 3px' }) as HTMLInputElement; return i };
  const b0 = H.framePresets[Object.keys(H.framePresets)[0]].box; const L0 = num(b0.x0), T0 = num(b0.y0), R0 = num(b0.x1), B0 = num(b0.y1);
  const box = () => ({ x0: +L0.value / 100, y0: +T0.value / 100, x1: +R0.value / 100, y1: +B0.value / 100 });
  const guides = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const updateGuides = () => H.showGuides(guides.checked ? box() : null);
  presetSel.onchange = () => { const p = H.framePresets[presetSel.value]; if (p) { L0.value = String(Math.round(p.box.x0 * 100)); T0.value = String(Math.round(p.box.y0 * 100)); R0.value = String(Math.round(p.box.x1 * 100)); B0.value = String(Math.round(p.box.y1 * 100)) } updateGuides() };
  for (const i of [L0, T0, R0, B0]) i.oninput = () => { presetSel.value = ''; updateGuides() };
  guides.onchange = updateGuides;
  const what = el('select', {}, el('option', { value: 'all' }, 'the whole animation'), el('option', { value: 'frame' }, 'this frame only')) as HTMLSelectElement;
  row(Fr, 'preset', presetSel);
  const boxRow = el('div', { class: 'row' }, el('label', {}, 'box % l t r b'), el('div', { style: 'grid-column:2/4;display:flex;gap:3px;flex-wrap:wrap' }, L0, T0, R0, B0)); Fr.append(boxRow);
  row(Fr, 'fit', what);
  row(Fr, 'show guides', guides);
  Fr.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.fitFrame(box(), what.value as 'all' | 'frame'); H.redraw() } }, 'Fit to frame')));
  Fr.append(el('div', { style: 'color:var(--dim);font-size:11px' }, 'Fit sets zoom and pan only; turn the view first. The canvas here is the preview: the frame is fractions of it, so what you fit at 16:9 renders the same at 1920×1080. Set the size the site will use in the CLI (--size) or with the resolution below the canvas.'));
  V.append(el('div', { id: 'help', style: 'color:var(--dim);font-size:11px;margin-top:4px' }, 'drag: rotate · shift-drag / right-drag: pan · wheel: zoom · arrows: nudge · r: reset · drop a file to load'));

  const refresh = () => refreshers.forEach(f => f());
  refresh();
  return { refresh, transport };
}
