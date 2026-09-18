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
  /** undo history: call before a change, with a label; continuous edits with the same label coalesce */
  mark: (label: string, scene?: boolean) => void; settle: () => void; undo: () => void; redo: () => void; historyState: () => { undo: string; redo: string };
  /* keyframes */
  fps: number; hasScene: () => boolean; keyframes: () => { i: number; name: string; hold: number; transition: number; atoms: number; arrows: number; view: boolean; path: boolean }[];
  currentKey: () => number; loopSeconds: () => number; setKeyTiming: (i: number, holdS: number, transS: number) => void; setKeyName: (i: number, name: string) => void; goToKey: (i: number) => void;
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
  cancelRender: () => void; savePoster: (w: number, h: number, frame?: number, type?: 'image/jpeg' | 'image/png') => void; posterFrame: () => number; setRenderSize: (s: [number, number] | null) => void; drawnFrames: () => number;
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
  };

  /* undo / redo */
  const hb = el('div', { class: 'btns', style: 'margin:0 0 6px' }); root.append(hb);
  const undoB = el('button', { onclick: H.undo, title: 'Ctrl-Z' }, 'Undo') as HTMLButtonElement, redoB = el('button', { onclick: H.redo, title: 'Ctrl-Shift-Z' }, 'Redo') as HTMLButtonElement; const hnote = el('span', { style: 'color:var(--dim);font-size:11px;align-self:center' });
  hb.append(undoB, redoB, hnote);
  const refreshHistory = () => { const h = H.historyState(); undoB.disabled = !h.undo; redoB.disabled = !h.redo; undoB.title = h.undo ? 'undo ' + h.undo + ' (Ctrl-Z)' : 'nothing to undo'; redoB.title = h.redo ? 'redo ' + h.redo : 'nothing to redo'; hnote.textContent = h.undo ? '← ' + h.undo : '' };
  refreshers.push(refreshHistory);

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

  /* checks: what the lint pass found on load (and after edits) */
  const Ck = section('Checks', false); Ck.style.display = 'none'; const ckList = el('div', { class: 'checks' }); Ck.append(ckList);
  const refreshChecks = () => { const items = H.lint(); Ck.style.display = H.hasScene() ? '' : 'none'; ckList.innerHTML = '';
    const c = { error: 0, warn: 0, note: 0 } as any; for (const it of items) c[it.level]++; (Ck.querySelector('summary') as HTMLElement).textContent = items.length ? `Checks — ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warn} warning${c.warn === 1 ? '' : 's'}, ${c.note} note${c.note === 1 ? '' : 's'}` : 'Checks — nothing to report';
    if (!items.length) { ckList.append(el('div', { style: 'color:var(--dim);font-size:11px' }, 'bonds, arrows, lone pairs, charges and the matching between keyframes all look consistent')); return }
    for (const it of items) { const d = el('div', { class: 'check ' + it.level, title: it.kf !== null ? 'go to keyframe ' + (it.kf + 1) : '' }, el('b', {}, it.level === 'error' ? '✕' : it.level === 'warn' ? '!' : '·'), el('span', {}, (it.kf !== null ? `${it.kf + 1}: ` : '') + it.text)); if (it.kf !== null) d.onclick = () => H.goToKey(it.kf!); ckList.append(d) }
    ckList.append(el('div', { class: 'btns' }, el('button', { onclick: H.relint }, 'Check again')));
  };

  /* transport (scenes) */
  const T = section('Animation'); T.style.display = 'none';
  const playBtn = el('button', { onclick: () => { H.play(!H.isPlaying()); playBtn.textContent = H.isPlaying() ? 'Pause' : 'Play' } }, 'Play') as HTMLButtonElement;
  const frameIn = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 0 }) as HTMLInputElement; const frameV = el('span', { class: 'val' }, '0 s');
  frameIn.oninput = () => { H.seek(+frameIn.value); playBtn.textContent = 'Play' };
  frameIn.onmouseenter = () => H.setHoverChanges(true); frameIn.onmouseleave = () => H.setHoverChanges(false);
  const stepName = el('div', { style: 'color:var(--dim);font-size:11px;margin:2px 0 4px' }, '');
  T.append(el('div', { class: 'btns' }, playBtn, el('button', { onclick: () => H.step(-2) }, '◀ step'), el('button', { onclick: () => H.step(2) }, 'step ▶')));
  row(T, 'time', frameIn, frameV); T.append(stepName);
  const chg = el('input', { type: 'checkbox' }) as HTMLInputElement; chg.onchange = () => H.setShowChanges(chg.checked); row(T, 'show changes', chg);
  const chgNote = el('div', { style: 'color:var(--dim);font-size:11px;margin:0 0 4px' }, 'hover the time slider: what moves, leaves, arrives, breaks or forms on the way to the next keyframe'); T.append(chgNote);
  // the keyframes: name, timing in seconds, camera, order
  T.append(el('div', { class: 'subhead' }, 'keyframes'));
  const kfList = el('div', { class: 'kflist' }); T.append(kfList); const loopNote = el('div', { style: 'color:var(--dim);font-size:11px;margin:4px 0' }); T.append(loopNote);
  let kfKey = '';
  const refreshKeys = () => {
    const ks = H.keyframes(); const cur = H.currentKey(); const key = JSON.stringify(ks) + '|' + cur; if (key === kfKey) return; kfKey = key; kfList.innerHTML = '';
    let dragFrom = -1;
    ks.forEach(k => {
      const name = el('input', { type: 'text', value: k.name, title: 'name', style: 'width:100%;font:inherit' }) as HTMLInputElement; name.onchange = () => H.setKeyName(k.i, name.value);
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
    const secs = H.loopSeconds(); loopNote.textContent = `loop: ${secs.toFixed(2)} s, ${H.drawnFrames()} drawings at ${H.fps / 2} per second · ${ks.filter(k => k.view).length ? ks.filter(k => k.view).length + ' keyframe camera(s)' : 'one camera for the whole loop (cam on a keyframe to change it)'}`;
  };
  refreshers.push(refreshKeys);
  const transport = (f: number, total: number, name: string) => { T.style.display = ''; frameIn.max = String(total - 1); frameIn.value = String(f); frameV.textContent = (f / H.fps).toFixed(2) + ' s'; stepName.textContent = `${name} · ${(f / H.fps).toFixed(2)} of ${(total / H.fps).toFixed(2)} s`; playBtn.textContent = H.isPlaying() ? 'Pause' : 'Play'; refreshKeys(); refreshAuthor() };

  /* chemistry: arrows, lone pairs and charges by clicking the drawing */
  const Ch = section('Chemistry', false); Ch.style.display = 'none';
  const modes: [string, string, string][] = [['off', 'look', 'clicks do nothing'], ['arrow', 'arrow', 'click the tail (atom or bond), then the head'], ['lp', 'lone pair', 'click an atom: a lone pair on / off'], ['charge', 'charge', 'click an atom: none → + → − → none']];
  const modeBtns = el('div', { class: 'btns' }); Ch.append(modeBtns); const mbs: HTMLButtonElement[] = [];
  for (const [m, label, tip] of modes) { const b = el('button', { title: tip, onclick: () => { H.setAuthorMode(m); refreshAuthor() } }, label) as HTMLButtonElement; b.dataset.mode = m; mbs.push(b); modeBtns.append(b) }
  const aText = el('div', { style: 'color:var(--dim);font-size:11px;min-height:2.6em' }); Ch.append(aText);
  Ch.append(el('div', { class: 'subhead' }, 'arrows of this keyframe')); const arList = el('div', { class: 'arrows' }); Ch.append(arList);
  Ch.append(el('div', { style: 'color:var(--dim);font-size:11px;margin-top:4px' }, 'Edits go into the scene: Save scene JSON keeps them. An arrow\'s tail is the atom\'s lone pair when it has one (give it one first, in lone-pair mode), else the atom or the bond; the bow is set to point away from the middle of the drawing, flip it if it crosses something.'));
  let arKey = '';
  const refreshAuthor = () => { Ch.style.display = H.hasScene() ? '' : 'none'; const m = H.authorMode(); const dn = H.diffNote(); chgNote.textContent = dn || 'hover the time slider: what moves, leaves, arrives, breaks or forms on the way to the next keyframe (orange rings move, red breaks or leaves, green forms or arrives, yellow changes order or charge)'; mbs.forEach(b => b.classList.toggle('on', b.dataset.mode === m)); aText.textContent = H.authorText();
    const ars = H.arrowsOf(); const key = JSON.stringify(ars) + H.currentKey(); if (key === arKey) return; arKey = key; arList.innerHTML = '';
    if (!ars.length) arList.append(el('div', { style: 'color:var(--dim);font-size:11px' }, 'none'));
    for (const a of ars) { const bul = el('input', { type: 'number', min: 0, max: 1.5, step: 0.05, value: String(a.bulge), title: 'bow: fraction of the arrow\'s length' }) as HTMLInputElement; bul.onchange = () => H.editArrow(a.j, 'bulge', +bul.value);
      arList.append(el('div', { class: 'arrow' }, el('span', {}, `${a.j + 1}. ${a.text}`), bul, el('button', { title: 'bow the other way', onclick: () => H.editArrow(a.j, 'flip') }, a.side > 0 ? '⤴' : '⤵'), el('button', { title: 'delete', onclick: () => H.editArrow(a.j, 'delete') }, '✕'))) }
  };
  refreshers.push(refreshAuthor);

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
  hexIn.oninput = () => { if (selected && /^#[0-9a-f]{6}$/i.test(hexIn.value)) { H.mark('colour ' + selected.label); selected.set(hexIn.value.toLowerCase()); refresh(); H.redraw() } };
  const swatch = (parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, opts: { auto?: () => boolean; clear?: () => void } = {}) => {
    const inp = el('input', { type: 'color' }) as HTMLInputElement; const i = el('i'); const d = el('div', { class: 'sw', title: label }, i, el('span', {}, label), inp);
    const show = () => { const v = get(); i.style.background = v; inp.value = v; d.classList.toggle('auto', !!opts.auto?.()); d.classList.toggle('on', selected?.label === label); if (selected?.label === label) { hexIn.value = v; hexLabel.textContent = label + (opts.auto?.() ? ' (automatic)' : '') } };
    d.onclick = (e) => { if (e.target === inp) return; selected = { get, set, label }; refresh(); inp.click() };
    d.oncontextmenu = (e) => { e.preventDefault(); if (opts.clear) { opts.clear(); refresh() } };
    inp.oninput = () => { H.mark('colour ' + label); set(inp.value); show(); H.redraw() }; inp.onchange = () => { set(inp.value); refresh() };
    refreshers.push(show); show(); parent.append(d); return d;
  };
  const stylePal = (key: string, geom = false) => [() => (H.style.palette as any)[key] as string, (v: string) => { (H.style.palette as any)[key] = v; if (geom) H.rebuild() }] as const;
  const swatchGroup = (title: string, keys: string[], geom = false) => { C.append(el('div', { class: 'subhead' }, title)); const g = el('div', { class: 'swatches' }); C.append(g); for (const k of keys) { const [get, set] = stylePal(k, geom); swatch(g, k, get, set) } };
  // paper presets as strips
  C.append(el('div', { class: 'subhead' }, 'paper and ink presets'));
  const pstrips = el('div', { class: 'strips', style: 'max-height:none' }); C.append(pstrips);
  for (const name of Object.keys(H.palettes)) { const P = H.palettes[name]; const st = el('div', { class: 'strip' }, el('div', { class: 'chips' }, ...['paper', 'ink', 'C', 'N', 'O', 'wash'].map(k => { const i = el('i'); i.style.background = (P as any)[k]; return i })), el('span', {}, name)); st.onclick = () => { H.mark('palette ' + name); H.style.palette = { ...P }; refresh(); H.rebuild() }; pstrips.append(st) }
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
      t.onclick = () => { const k = kept; kept = null; if (k) { H.style.groupPalette = k.colors; H.style.groupPaletteName = k.name } H.mark('group palette ' + name); applyPal(name, gp.colors); refresh() };
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
  fov.oninput = () => { H.mark('perspective'); H.camera.fov = +fov.value; H.style.view.fov = +fov.value; showFov(); H.redraw() }; refreshers.push(() => { H.camera.fov = H.style.view.fov; showFov() }); showFov(); row(V, 'perspective', fov, fovv);
  const roll = el('input', { type: 'range', min: -180, max: 180, step: 1 }) as HTMLInputElement; const rollv = el('span', { class: 'val' });
  const showRoll = () => { roll.value = String(H.camera.roll); rollv.textContent = H.camera.roll + '°' };
  roll.oninput = () => { H.mark('roll'); H.camera.roll = +roll.value; showRoll(); H.redraw() }; refreshers.push(showRoll); showRoll(); row(V, 'roll', roll, rollv);
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
  V.append(el('div', { class: 'btns' }, el('button', { onclick: () => { H.mark('reset view'); H.camera.yaw = 0; H.camera.pitch = 0; H.camera.roll = 0; H.camera.zoom = 1; H.camera.panX = 0; H.camera.panY = 0; H.redraw() } }, 'Reset view')));
  /* suggested views: scored orientations, drawn small; click one to take it */
  const sv = el('div', { class: 'btns' }); const svBtn = el('button', { title: 'score 120 orientations: rings face-on, the reacting atoms unhidden and apart, wide rather than tall, leaving groups going up and right; then draw the best twelve' }, 'Suggest views') as HTMLButtonElement; const svNote = el('span', { style: 'color:var(--dim);font-size:11px;align-self:center' }); sv.append(svBtn, svNote); V.append(sv);
  const svGrid = el('div', { class: 'views' }); V.append(svGrid);
  svBtn.onclick = async () => { svBtn.disabled = true; svGrid.innerHTML = ''; try { const picks = await H.suggest(m => { svNote.textContent = m }); svGrid.innerHTML = '';
      picks.forEach((p, i) => { const t = el('div', { class: 'view', title: `yaw ${p.yaw} pitch ${p.pitch} roll ${p.roll.toFixed(0)} · rings ${p.parts.rings.toFixed(2)} clear ${p.parts.clear.toFixed(2)} apart ${p.parts.spread.toFixed(2)} wide ${p.parts.aspect.toFixed(2)} exit ${p.parts.exit.toFixed(2)}` }, p.canvas!, el('span', {}, `${i + 1} · ${(p.score * 100).toFixed(0)} · ${p.yaw}/${p.pitch}/${p.roll.toFixed(0)}`)); t.onclick = () => H.adoptView(p); svGrid.append(t) });
      svNote.textContent = picks.length ? 'click one; the score is out of 100, hover for its parts' : 'load a scene first' } catch (e: any) { svNote.textContent = e.message } finally { svBtn.disabled = false } };

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
  /* render: the loop as a video file, made here */
  const Rn = section('Render', false);
  const sizes: [string, [number, number]][] = [['1920×1080 (16:9)', [1920, 1080]], ['1080×1920 (9:16, phones)', [1080, 1920]], ['1280×720', [1280, 720]], ['1080×1080 (square)', [1080, 1080]], ['3840×2160 (4K)', [3840, 2160]]];
  const sizeSel = el('select', {}, ...sizes.map(([l, v]) => el('option', { value: v.join('x') }, l)), el('option', { value: 'canvas' }, 'the preview canvas as it is'), el('option', { value: 'custom' }, 'custom…')) as HTMLSelectElement;
  const cw = el('input', { type: 'number', min: 64, step: 2, value: '1920', style: 'width:60px' }) as HTMLInputElement, chh = el('input', { type: 'number', min: 64, step: 2, value: '1080', style: 'width:60px' }) as HTMLInputElement;
  const customRow = el('div', { class: 'row' }, el('label', {}, 'width × height'), el('div', { style: 'grid-column:2/4;display:flex;gap:4px;align-items:center' }, cw, '×', chh)); customRow.style.display = 'none';
  const outSize = (): [number, number] | null => sizeSel.value === 'canvas' ? null : sizeSel.value === 'custom' ? [Math.max(64, Math.round(+cw.value / 2) * 2), Math.max(64, Math.round(+chh.value / 2) * 2)] : sizeSel.value.split('x').map(Number) as [number, number];
  const codecSel = el('select', {}, ...[['auto', 'smallest the browser can make (AV1 › VP9 › H.264)'], ['av1', 'AV1 (.av1.mp4)'], ['vp9', 'VP9 (.webm)'], ['h264', 'H.264 (.mp4, plays everywhere)']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const qualSel = el('select', {}, ...[['small', 'small (like the site\'s encodes)'], ['medium', 'medium'], ['high', 'high']].map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  const codecNote = el('div', { style: 'color:var(--dim);font-size:11px' });
  const prog = el('progress', { max: '1', value: '0', style: 'width:100%;display:none;accent-color:var(--acc)' }) as HTMLProgressElement; const progNote = el('div', { style: 'color:var(--dim);font-size:11px;min-height:1.3em' });
  const goBtn = el('button', {}, 'Render the loop') as HTMLButtonElement, cancelBtn = el('button', { onclick: H.cancelRender, style: 'display:none' }, 'Cancel') as HTMLButtonElement;
  const posterBtn = el('button', { title: 'the first keyframe with its arrows drawn, as a JPEG at the output size' }, 'Save poster (JPEG)'), frameBtn = el('button', { title: 'this frame as a PNG at the output size' }, 'Save this frame (PNG)');
  let support: any = null; let sizeKey = '';
  const refreshRender = async () => {
    const sz = outSize(); customRow.style.display = sizeSel.value === 'custom' ? '' : 'none'; H.setRenderSize(sz); const [w, h] = sz || H.canvasSize();
    if (!H.hasWebCodecs()) { codecNote.textContent = 'this browser has no VideoEncoder (WebCodecs): rendering here needs Chrome or Edge. Copy render command (Data) gives the CLI line instead.'; goBtn.disabled = true; return }
    const key = w + 'x' + h; if (key === sizeKey) return; sizeKey = key; support = await H.codecSupport(w, h);
    const have = ['av1', 'vp9', 'h264'].filter(c => support[c]); goBtn.disabled = !have.length;
    codecNote.textContent = have.length ? `this browser encodes ${have.map(c => c.toUpperCase() + (support[c].quantizer ? '' : ' (bitrate only)')).join(', ')} at ${w}×${h}; ${H.drawnFrames()} drawings at ${H.fps / 2} per second` : `no codec available at ${w}×${h}`;
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
  posterBtn.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], H.posterFrame(), 'image/jpeg') };
  frameBtn.onclick = () => { const sz = outSize() || H.canvasSize(); H.savePoster(sz[0], sz[1], undefined, 'image/png') };
  row(Rn, 'size', sizeSel); Rn.append(customRow); row(Rn, 'codec', codecSel); row(Rn, 'quality', qualSel); Rn.append(codecNote);
  Rn.append(el('div', { class: 'btns' }, goBtn, cancelBtn, posterBtn, frameBtn)); Rn.append(prog, progNote);
  Rn.append(el('div', { style: 'color:var(--dim);font-size:11px;margin-top:4px' }, 'The preview keeps the output\'s aspect (letterboxed), so what you frame here is the frame of the file. One file per run; the site\'s three encodes (AV1, VP9, H.264) come from the CLI: Copy render command in Data, then hero/render.sh. The boil hold in View applies here too.'));
  refreshers.push(() => { refreshRender() });
  V.append(el('div', { id: 'help', style: 'color:var(--dim);font-size:11px;margin-top:4px' }, 'drag: rotate · shift-drag / right-drag: pan · wheel: zoom · arrows: nudge · r: reset · drop a file to load'));

  const refresh = () => refreshers.forEach(f => f());
  refresh();
  return { refresh, transport, refreshChecks, refreshHistory, refreshAuthor };
}
