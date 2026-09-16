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
    style: { fill: 'ink colour', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6, wash: 0.2 } as any },
  },
  ink: {
    name: 'Ink', note: 'black ink only',
    style: { fill: 'ink', palette: { ...PALETTES['PyMOL flat'] }, paper: { washSeed: 6, wash: 0.2 } as any },
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
