/* The look: everything the renderer reads that is not geometry. Looks in looks.ts are values of this. */

export type Fill = 'flat' | 'wash' | 'pencil' | 'watercolour' | 'ink' | 'ink colour' | 'chalk';
export type ColorBy = 'element' | 'residue' | 'chain' | 'subunit' | 'entity';

export interface Palette {
  paper: string; ink: string; hatch: string; wash: string; arrow: string; charge: string; label: string; context: string; accent: string;
  C: string; N: string; O: string; H: string; S: string; P: string; X: string;
  helix: string; sheet: string; loop: string; nucleic: string; surface: string;
}

export interface Style {
  fill: Fill;
  mode: 'sticks' | 'ballstick';
  sphereScale: number;       // cut-point spheres in sticks mode
  show: { H: boolean; lonePairs: boolean; charges: boolean; arrows: boolean; labels: boolean; resLabels: boolean; hbonds: boolean; caption: boolean; stepLabel: boolean; valence: boolean };
  font: 'Caveat' | 'Patrick Hand' | 'Kalam' | 'Plain sans'; labelSize: number; captionSize: number; annot: number;
  palette: Palette;
  colorBy: ColorBy;          // carbon / cartoon-by-carbon / surface-by-residue schemes
  cartoonColor: 'ss' | 'carbon' | 'rainbow';   // rainbow: blue → red along each chain (engraved cartoon; elsewhere as ss)
  /** sketch: the hand-drawn ribbons of the fill mode; engraved: line-shaded ribbons in the manner of MOLSCRIPT (Kraulis 1991),
      white faces with lines running along the ribbon, inked strand sides, paper-white coils. Classic engine only. */
  cartoonStyle: 'sketch' | 'engraved';
  engrave: { lines: number; width: number; strandThickness: number; coilWidth: number; labels: boolean };
  surfaceColor: 'single' | 'residue' | 'chain' | 'subunit' | 'entity';
  reps: { sticks: string; cartoon: string; surface: string };   // selections
  stickRadius: number;       // Å
  cartoonScale: number;
  probe: number;             // Å added to residue blobs
  line: { width: number; rough: number; passes: number; hierarchy: number; pressure: number; alpha: number };
  shading: number;           // pencil shadow / hatch on the dark side
  pencilFill: number;        // scribble density in pencil mode
  fillWobble: number;        // how far fills stray from the ink
  construction: boolean;     // faint guide geometry
  sideChainHelper: boolean;  // hide backbone atoms of residues drawn as cartoon
  hatch: { spacing: number; angle: number; density: number };
  paper: { grain: number; wash: number; washSeed: number; washLife: number; washScale: number };
  water: { layers: number; wobble: number; ring: number; granulation: number; tone: number };
  view: { fov: number; fog: number; fogStart: number; light: number };
  boilEvery: number; boilHold: number;
  /** auto: past 260 drawn atoms strokes get one pass and no scribble, past 600 surface patches fewer layers and no ring; full: the whole treatment always */
  detail: 'auto' | 'full';
  /** screen: hatching, stroke widths and scribbles in pixels (the default); object: they follow the drawing's scale, so the texture on an atom is the same however large it is drawn */
  textureScale: 'screen' | 'object';
  /** the colours handed to residues / chains / molecules in order of appearance; null = the engine's own */
  groupPalette: string[] | null; groupPaletteName: string;
}

export const PALETTES: Record<string, Palette> = {
  'PyMOL flat': { paper: '#faf8f3', ink: '#1e1e1e', hatch: '#2a2a2a', wash: '#7fb2c9', arrow: '#d23b2f', charge: '#1e1e1e', label: '#1e1e1e', context: '#cfcac0', accent: '#f2e85a', C: '#8f8f8f', N: '#3a6ee0', O: '#e04848', H: '#e8e8e8', S: '#e5cf3b', P: '#f09a3e', X: '#b48fd8', helix: '#e0524a', sheet: '#f2d94a', loop: '#6fbf6a', nucleic: '#e0a23a', surface: '#cfd8e0' },
  'Colored pencil': { paper: '#f3ecd9', ink: '#2b2a28', hatch: '#3a3632', wash: '#d1a35b', arrow: '#c2453a', charge: '#2b2a28', label: '#5b4636', context: '#c9b99a', accent: '#d98c2c', C: '#6b6660', N: '#3f5fa8', O: '#c94b3c', H: '#f7f3ea', S: '#c9a227', P: '#d97b2a', X: '#8a7d9a', helix: '#e0524a', sheet: '#f2d94a', loop: '#6fbf6a', nucleic: '#e0a23a', surface: '#cfd8e0' },
  'Dark paper': { paper: '#0f172a', ink: '#f2efe8', hatch: '#05070d', wash: '#f97316', arrow: '#fb923c', charge: '#f2efe8', label: '#f2efe8', context: '#1e293b', accent: '#f97316', C: '#e7e5e4', N: '#a5b4fc', O: '#fb923c', H: '#f2efe8', S: '#fde047', P: '#fdba74', X: '#c4b5fd', helix: '#fb923c', sheet: '#fde047', loop: '#86efac', nucleic: '#fdba74', surface: '#475569' },
  'Sepia wash': { paper: '#efe3c8', ink: '#4a3728', hatch: '#5a4632', wash: '#c9a56a', arrow: '#8a2f22', charge: '#4a3728', label: '#5a4632', context: '#d3c19c', accent: '#a5581f', C: '#8c7a62', N: '#5f6f8c', O: '#a5482e', H: '#f5ecd8', S: '#b8922e', P: '#b06a2a', X: '#8a7d9a', helix: '#a5482e', sheet: '#c9a13a', loop: '#7a8a5a', nucleic: '#b06a2a', surface: '#d8cdb0' },
};

export const DEFAULT_STYLE: Style = {
  fill: 'watercolour',
  mode: 'sticks', sphereScale: 0.4,
  show: { H: true, lonePairs: true, charges: true, arrows: true, labels: true, resLabels: false, hbonds: true, caption: true, stepLabel: true, valence: true },
  font: 'Caveat', labelSize: 19, captionSize: 24, annot: 1,
  palette: { ...PALETTES['Colored pencil'] },
  colorBy: 'residue',
  cartoonColor: 'ss',
  cartoonStyle: 'sketch',
  engrave: { lines: 8, width: 0.45, strandThickness: 0.6, coilWidth: 1.25, labels: false },
  surfaceColor: 'subunit',
  reps: { sticks: 'hetatm and not water', cartoon: 'polymer', surface: '' },
  stickRadius: 0.2,
  cartoonScale: 1,
  probe: 1.4,
  line: { width: 1.5, rough: 1.1, passes: 2, hierarchy: 0.6, pressure: 0.55, alpha: 0.85 },
  shading: 0.65, pencilFill: 0.55, fillWobble: 1, construction: false, sideChainHelper: true,
  hatch: { spacing: 5, angle: -40, density: 1.4 },
  paper: { grain: 0.6, wash: 0.3, washSeed: 1, washLife: 0.6, washScale: 1 },
  water: { layers: 3, wobble: 1, ring: 0.6, granulation: 0.5, tone: 0.6 },
  view: { fov: 20, fog: 0.5, fogStart: 0.45, light: -125 },
  boilEvery: 3, boilHold: 1, detail: 'auto', textureScale: 'screen', groupPalette: null, groupPaletteName: 'Triad',
};

export function cloneStyle(s: Style): Style { return JSON.parse(JSON.stringify(s)) }

/** Deep-merge a partial style (a look, or a saved settings file) over a base. */
export function mergeStyle(base: Style, part: any): Style {
  const out: any = cloneStyle(base);
  for (const k in part) {
    if (part[k] && typeof part[k] === 'object' && !Array.isArray(part[k])) out[k] = { ...out[k], ...part[k] };
    else out[k] = part[k];
  }
  return out;
}

export function hexToRgb(h: string): [number, number, number] {
  h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
