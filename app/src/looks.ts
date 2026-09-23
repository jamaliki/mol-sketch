/* Named looks: partial styles merged over DEFAULT_STYLE.
   One grammar, several media: every look draws ribbons (and, with them, sticks) the engraved way, with one pen and one
   weight hierarchy; what a look changes is its medium (paper, fill, colour) and its hand, one number from 0 (a ruled,
   engraved line) to 1 (a loose sketch) that sets roughness, passes, pen pressure and fill wobble together. */
import { PALETTES, type Style } from './style';

type Look = { name: string; note: string; style: Partial<Style> & Record<string, any> };

/** the hand: 0 is an engraver's ruled line, 1 a loose sketch */
export function hand(h: number) {
  return { line: { rough: +(1.8 * h).toFixed(2), passes: h < 0.25 ? 1 : 2, pressure: +(0.7 * h).toFixed(2) }, fillWobble: +(1.4 * h).toFixed(2) };
}
export function handOf(st: { line: { rough: number } }) { return Math.max(0, Math.min(1, st.line.rough / 1.8)) }
/** the pen every look shares, and a look's own hand and extra line settings */
const pen = (h: number, line: Record<string, number> = {}) => { const H = hand(h); return { fillWobble: H.fillWobble, line: { width: 1.6, hierarchy: 0.45, alpha: 0.9, ...H.line, ...line } as any } };
const lines = (n: number, w: number) => ({ engrave: { lines: n, width: w, strandThickness: 0.6, coilWidth: 1.25, labels: false } });

export const LOOKS: Record<string, Look> = {
  watercolour: {
    name: 'Watercolour', note: 'translucent layers on cream paper',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] }, ...pen(0.6), ...lines(8, 0.45) },
  },
  'ink-colour': {
    name: 'Ink colour', note: 'pen and ink with coloured hatching, white paper',
    style: { fill: 'ink colour', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6 } as any, ...pen(0.55), ...lines(5, 1.1) },
  },
  ink: {
    name: 'Ink', note: 'black ink only',
    style: { fill: 'ink', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6 } as any, ...pen(0.55), ...lines(8, 0.45) },
  },
  'dark-paper': {
    name: 'Dark paper', note: 'pastel chalk on navy: pigment laid down, pale ink, no wash',
    style: { fill: 'watercolour', palette: { ...PALETTES['Dark paper'] }, shading: 0.45, paper: { grain: 0.3, wash: 0 } as any, view: { fog: 0.2 } as any, ...pen(0.6), ...lines(8, 0.45) },
  },
  chalkboard: {
    name: 'Chalkboard', note: 'chalk on the same navy: broad dusty fills, soft pitted lines, no wash',
    style: { fill: 'chalk', palette: { ...PALETTES['Dark paper'], arrow: '#f2efe8', wash: '#e7e5e4' }, shading: 0.25, sphereScale: 0.3, ...pen(0.72, { width: 2.0 }), ...lines(5, 1.3), hatch: { spacing: 5, angle: -40, density: 1.4 } as any, paper: { grain: 0.8, wash: 0.12, washSeed: 3 } as any, view: { fog: 0.15 } as any, construction: false },
  },
  engraved: {
    name: 'Engraved', note: 'line-shaded ribbons, black on white, after MOLSCRIPT (Kraulis 1991)',
    style: { fill: 'ink', cartoonStyle: 'engraved', ...lines(8, 0.45), cartoonScale: 1,
      palette: { ...PALETTES['PyMOL flat'], paper: '#ffffff', ink: '#000000', hatch: '#000000', label: '#000000', charge: '#000000' },
      ...pen(0.08, { hierarchy: 0.3, alpha: 1 }), shading: 0, construction: false,
      paper: { grain: 0, wash: 0 } as any, view: { fog: 0, fov: 0 } as any },
  },
  'engraved-colour': {
    name: 'Engraved colour', note: 'the engraved ribbons with colour only in the lines: white faces, fewer, heavier coloured lines',
    style: { fill: 'ink colour', cartoonStyle: 'engraved', ...lines(5, 1.1), cartoonScale: 1,
      palette: { ...PALETTES['PyMOL flat'], paper: '#ffffff', ink: '#000000', hatch: '#000000', label: '#000000', charge: '#000000', helix: '#d6453d', sheet: '#2f6fb5', loop: '#1e1e1e' },
      ...pen(0.08, { hierarchy: 0.3, alpha: 1 }), shading: 0, construction: false,
      paper: { grain: 0, wash: 0 } as any, view: { fog: 0, fov: 0 } as any },
  },
  'assembly-surface': {
    name: 'Assembly surface', note: 'watercolour surface by subunit',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] }, surfaceColor: 'subunit', reps: { sticks: '', cartoon: '', surface: 'polymer' }, ...pen(0.6) },
  },
  'assembly-cartoon': {
    name: 'Assembly cartoon', note: 'tubes and ribbons by subunit, thin pen, heavy fog',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] }, cartoonColor: 'carbon', colorBy: 'subunit', reps: { sticks: '', cartoon: 'polymer', surface: '' }, cartoonScale: 1.6, ...pen(0.6, { width: 0.8, alpha: 0.5, hierarchy: 0.9 }), water: { tone: 0.4, ring: 0.3 } as any, view: { fog: 0.7, fogStart: 0.3 } as any },
  },
};
