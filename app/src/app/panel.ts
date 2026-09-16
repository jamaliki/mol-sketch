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
  onLive: (v: boolean) => void; onTurntable: (v: number) => void; onPitchSwing: (v: number) => void; onSketch: (v: boolean) => void;
  savePng: () => void; saveStyle: () => void; loadStyle: (f: File) => void; loadFile: (f: File) => void; loadExample: (n: string) => void; reset: () => void;
  setDpr: (v: number) => void;
  palettes: Record<string, Palette>;
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
  const fileIn = el('input', { type: 'file', accept: '.pdb,.ent,.cif,.mmcif', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadFile(f); e.target.value = '' } }) as HTMLInputElement;
  const styleIn = el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: (e: any) => { const f = e.target.files[0]; if (f) H.loadStyle(f); e.target.value = '' } }) as HTMLInputElement;
  const ex = el('select', {}, ...['test_protein.pdb', 'test_protein_rna.cif', 'synthetic_assembly_12k.cif', '6GZQ.cif'].map(o => el('option', { value: o }, o))) as HTMLSelectElement;
  D.append(el('div', { class: 'btns' },
    el('button', { onclick: () => fileIn.click() }, 'Open PDB / mmCIF…'), fileIn,
    el('button', { onclick: () => H.loadExample(ex.value) }, 'Load example'), ex));
  D.append(el('div', { class: 'btns' },
    el('button', { onclick: H.savePng }, 'Save PNG'), el('button', { onclick: H.saveStyle }, 'Save style'), el('button', { onclick: () => styleIn.click() }, 'Load style…'), styleIn,
    el('button', { onclick: H.reset }, 'Reset')));
  const dprSel = el('select', { onchange: (e: any) => H.setDpr(+e.target.value) }, ...['1', '2', '3'].map(o => el('option', { value: o }, o + '×'))) as HTMLSelectElement; dprSel.value = String(Math.min(2, Math.round(window.devicePixelRatio || 1)));
  row(D, 'resolution', dprSel);
  D.append(el('div', { id: 'status' }));

  /* representations */
  const Rp = section('Representations');
  control(Rp, { t: 'text', label: 'sticks', path: 'reps.sticks', geom: true, placeholder: 'hetatm and not water' });
  control(Rp, { t: 'text', label: 'cartoon', path: 'reps.cartoon', geom: true, placeholder: 'polymer' });
  control(Rp, { t: 'text', label: 'surface', path: 'reps.surface', geom: true, placeholder: 'polymer' });
  control(Rp, { t: 'range', label: 'stick radius', path: 'stickRadius', min: 0.08, max: 0.5, step: 0.01, geom: true });
  control(Rp, { t: 'range', label: 'cartoon scale', path: 'cartoonScale', min: 0.4, max: 2.5, step: 0.05, geom: true });
  control(Rp, { t: 'range', label: 'surface probe', path: 'probe', min: 0, max: 3, step: 0.1, geom: true });

  /* colour */
  const C = section('Colour');
  control(C, { t: 'select', label: 'fill', path: 'fill', options: ['watercolour', 'ink colour', 'ink', 'pencil', 'flat', 'wash'] });
  control(C, { t: 'range', label: 'shading', path: 'shading', min: 0, max: 1, step: 0.05 });
  control(C, { t: 'range', label: 'pencil fill', path: 'pencilFill', min: 0, max: 1, step: 0.05 });
  control(C, { t: 'range', label: 'fill wobble', path: 'fillWobble', min: 0, max: 2, step: 0.05 });
  control(C, { t: 'check', label: 'construction', path: 'construction' });
  control(C, { t: 'select', label: 'carbons by', path: 'colorBy', options: ['residue', 'element', 'chain', 'subunit', 'entity'], geom: true });
  control(C, { t: 'select', label: 'cartoon by', path: 'cartoonColor', options: ['ss', 'carbon'], geom: true });
  control(C, { t: 'select', label: 'surface by', path: 'surfaceColor', options: ['subunit', 'chain', 'entity', 'residue', 'single'], geom: true });
  const pal = el('select', {}, el('option', { value: '' }, 'palette preset…'), ...Object.keys(H.palettes).map(o => el('option', { value: o }, o))) as HTMLSelectElement;
  pal.onchange = () => { if (pal.value) { H.style.palette = { ...H.palettes[pal.value] }; refresh(); H.rebuild() } pal.value = '' }; row(C, 'preset', pal);
  for (const k of ['paper', 'ink', 'hatch', 'wash']) control(C, { t: 'color', label: k, path: 'palette.' + k });
  for (const k of ['C', 'N', 'O', 'S', 'P', 'H', 'X', 'helix', 'sheet', 'loop', 'nucleic', 'surface']) control(C, { t: 'color', label: k, path: 'palette.' + k, geom: true });

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
  control(V, { t: 'range', label: 'fog', path: 'view.fog', min: 0, max: 1, step: 0.05 });
  control(V, { t: 'range', label: 'fog start', path: 'view.fogStart', min: 0, max: 1, step: 0.05 });
  control(V, { t: 'range', label: 'light angle', path: 'view.light', min: -180, max: 180, step: 5 });
  control(V, { t: 'range', label: 'boil every', path: 'boilEvery', min: 1, max: 12, step: 1 });
  const skIn = el('input', { type: 'checkbox', checked: '' }) as HTMLInputElement; skIn.onchange = () => H.onSketch(skIn.checked); row(V, 'sketch at rest', skIn);
  const liveIn = el('input', { type: 'checkbox', checked: '' }) as HTMLInputElement; liveIn.onchange = () => H.onLive(liveIn.checked); row(V, 'breathing', liveIn);
  const tt = el('input', { type: 'range', min: 0, max: 90, step: 1, value: 0 }) as HTMLInputElement; const ttv = el('span', { class: 'val' }, '0');
  tt.oninput = () => { ttv.textContent = tt.value; H.onTurntable(+tt.value) }; row(V, 'turntable °/s', tt, ttv);
  const ps = el('input', { type: 'range', min: 0, max: 40, step: 1, value: 0 }) as HTMLInputElement; const psv = el('span', { class: 'val' }, '0');
  ps.oninput = () => { psv.textContent = ps.value; H.onPitchSwing(+ps.value) }; row(V, 'pitch swing °', ps, psv);
  V.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.camera.yaw = 0; H.camera.pitch = 0; H.camera.zoom = 1; H.camera.panX = 0; H.camera.panY = 0; H.redraw() } }, 'Reset view')));
  V.append(el('div', { id: 'help', style: 'color:var(--dim);font-size:11px;margin-top:4px' }, 'drag: rotate · shift-drag / right-drag: pan · wheel: zoom · arrows: nudge · r: reset · drop a file to load'));

  const refresh = () => refreshers.forEach(f => f());
  refresh();
  return { refresh };
}
