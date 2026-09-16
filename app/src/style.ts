/* The look: everything the renderer reads that is not geometry. Looks in looks.ts are values of this. */

export type Fill = 'ink' | 'ink colour' | 'watercolour';
export type ColorBy = 'element' | 'residue' | 'chain' | 'subunit' | 'entity';

export interface Palette {
  paper: string; ink: string; wash: string;
  C: string; N: string; O: string; H: string; S: string; P: string; X: string;
  helix: string; sheet: string; loop: string; nucleic: string; surface: string;
}

export interface Style {
  fill: Fill;
  palette: Palette;
  colorBy: ColorBy;          // carbon / cartoon-by-carbon / surface-by-residue schemes
  cartoonColor: 'ss' | 'carbon';
  surfaceColor: 'single' | 'residue' | 'chain' | 'subunit' | 'entity';
  reps: { sticks: string; cartoon: string; surface: string };   // selections
  stickRadius: number;       // Å
  cartoonScale: number;
  probe: number;             // Å added to residue blobs
  line: { width: number; rough: number; passes: number; hierarchy: number; pressure: number; alpha: number };
  hatch: { spacing: number; angle: number; density: number };
  paper: { grain: number; wash: number; washSeed: number; washLife: number; washScale: number };
  water: { layers: number; wobble: number; ring: number; granulation: number; tone: number };
  view: { fov: number; fog: number; fogStart: number; light: number };
  boilEvery: number;
}

export const PALETTES: Record<string, Palette> = {
  'PyMOL flat': { paper: '#faf8f3', ink: '#1e1e1e', wash: '#7fb2c9', C: '#8f8f8f', N: '#3a6ee0', O: '#e04848', H: '#e8e8e8', S: '#e5cf3b', P: '#f09a3e', X: '#b48fd8', helix: '#e0524a', sheet: '#f2d94a', loop: '#6fbf6a', nucleic: '#e0a23a', surface: '#cfd8e0' },
  'Colored pencil': { paper: '#f3ecd9', ink: '#2b2a28', wash: '#d1a35b', C: '#6b6660', N: '#3f5fa8', O: '#c94b3c', H: '#f7f3ea', S: '#c9a227', P: '#d97b2a', X: '#8a7d9a', helix: '#e0524a', sheet: '#f2d94a', loop: '#6fbf6a', nucleic: '#e0a23a', surface: '#cfd8e0' },
  'Sepia wash': { paper: '#efe3c8', ink: '#4a3728', wash: '#c9a56a', C: '#8c7a62', N: '#5f6f8c', O: '#a5482e', H: '#f5ecd8', S: '#b8922e', P: '#b06a2a', X: '#8a7d9a', helix: '#a5482e', sheet: '#c9a13a', loop: '#7a8a5a', nucleic: '#b06a2a', surface: '#d8cdb0' },
};

export const DEFAULT_STYLE: Style = {
  fill: 'watercolour',
  palette: { ...PALETTES['Colored pencil'] },
  colorBy: 'residue',
  cartoonColor: 'ss',
  surfaceColor: 'subunit',
  reps: { sticks: 'hetatm and not water', cartoon: 'polymer', surface: '' },
  stickRadius: 0.22,
  cartoonScale: 1,
  probe: 1.4,
  line: { width: 1.6, rough: 1.0, passes: 2, hierarchy: 0.6, pressure: 0.5, alpha: 0.85 },
  hatch: { spacing: 5, angle: -40, density: 1.2 },
  paper: { grain: 0.4, wash: 0.3, washSeed: 1, washLife: 0.6, washScale: 1 },
  water: { layers: 3, wobble: 1, ring: 0.6, granulation: 0.5, tone: 0.6 },
  view: { fov: 20, fog: 0.5, fogStart: 0.45, light: -125 },
  boilEvery: 3,
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
