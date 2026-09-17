/* Named looks: partial styles merged over DEFAULT_STYLE. */
import { PALETTES, type Style } from './style';

type Look = { name: string; note: string; style: Partial<Style> & Record<string, any> };

export const LOOKS: Record<string, Look> = {
  watercolour: {
    name: 'Watercolour', note: 'translucent layers on cream paper',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] } },
  },
  'ink-colour': {
    name: 'Ink colour', note: 'pen and ink with coloured hatching, white paper',
    style: { fill: 'ink colour', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6 } as any },
  },
  ink: {
    name: 'Ink', note: 'black ink only',
    style: { fill: 'ink', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6 } as any },
  },
  'dark-paper': {
    name: 'Dark paper', note: 'pastel chalk on navy: pigment laid down, pale ink, no wash',
    style: { fill: 'watercolour', palette: { ...PALETTES['Dark paper'] }, shading: 0.45, paper: { grain: 0.3, wash: 0 } as any, view: { fog: 0.2 } as any },
  },
  chalkboard: {
    name: 'Chalkboard', note: 'chalk on the same navy: broad dusty fills, soft pitted lines, no wash',
    style: { fill: 'chalk', palette: { ...PALETTES['Dark paper'], arrow: '#f2efe8', wash: '#e7e5e4' }, shading: 0.25, sphereScale: 0.3, line: { width: 2.0, rough: 1.3, passes: 2, pressure: 0.35, alpha: 0.9 } as any, hatch: { spacing: 5, angle: -40, density: 1.4 } as any, paper: { grain: 0.8, wash: 0.12, washSeed: 3 } as any, view: { fog: 0.15 } as any, construction: false },
  },
  'assembly-surface': {
    name: 'Assembly surface', note: 'watercolour surface by subunit',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] }, surfaceColor: 'subunit', reps: { sticks: '', cartoon: '', surface: 'polymer' } },
  },
  'assembly-cartoon': {
    name: 'Assembly cartoon', note: 'tubes and ribbons by subunit, thin pen, heavy fog',
    style: { fill: 'watercolour', palette: { ...PALETTES['Colored pencil'] }, cartoonColor: 'carbon', colorBy: 'subunit', reps: { sticks: '', cartoon: 'polymer', surface: '' }, cartoonScale: 1.6, line: { width: 0.8, alpha: 0.5, hierarchy: 0.9 } as any, water: { tone: 0.4, ring: 0.3 } as any, view: { fog: 0.7, fogStart: 0.3 } as any },
  },
};
