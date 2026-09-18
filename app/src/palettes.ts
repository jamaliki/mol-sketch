/* Group palettes, in three families: drawing (the engine's own and the site's), safe (colour-blind-safe standards),
   studies (jamaliki/design-corner). the colours handed out to residues, chains and molecules in the order they appear, when nothing
   overrides them. The first is the engine's own (no blues or reds, which belong to N and O); the site palette is the
   lab website's; then the standard colour-blind-safe sets; then the studies from jamaliki/design-corner. */
export interface GroupPalette { colors: string[]; source: string; family: 'drawing' | 'safe' | 'studies' }

export const GROUP_PALETTES: Record<string, GroupPalette> = {
  'Triad': { colors: ['#f2e85a', '#7cbf72', '#5fc9c9', '#a98ad6', '#f0a050', '#d9a3c9', '#8fb8a8', '#b5c95a', '#c9a27a', '#9ad0b8'], source: 'the engine: no blues or reds, those belong to N and O', family: 'drawing' },
  'Jamali Lab': { colors: ['#f97316', '#fbbf24', '#7dd3fc', '#a8a29e', '#d6d3d1', '#86efac', '#c4b5fd', '#fda4af'], source: 'the lab website: orange, amber, sky, stone', family: 'drawing' },
  'Okabe–Ito': { colors: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'], source: 'Okabe & Ito 2008, colour-blind safe', family: 'safe' },
  'Tol bright': { colors: ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'], source: 'Paul Tol, colour-blind safe', family: 'safe' },
  'Tol muted': { colors: ['#CC6677', '#332288', '#DDCC77', '#117733', '#88CCEE', '#882255', '#44AA99', '#999933', '#AA4499', '#DDDDDD'], source: 'Paul Tol, colour-blind safe', family: 'safe' },
  'Tol light': { colors: ['#77AADD', '#EE8866', '#EEDD88', '#FFAABB', '#99DDFF', '#44BB99', '#BBCC33', '#AAAA00', '#DDDDDD'], source: 'Paul Tol, for fills', family: 'safe' },
  'Tol vibrant': { colors: ['#EE7733', '#0077BB', '#33BBEE', '#EE3377', '#CC3311', '#009988', '#BBBBBB'], source: 'Paul Tol', family: 'safe' },
  'Tableau 10': { colors: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'], source: 'Tableau', family: 'safe' },
  'Pink-Lilac-Blue': { colors: ['#FF499E', '#D264B6', '#A480CF', '#779BE7', '#49B6FF'], source: 'design-corner', family: 'studies' },
  'Cotton Candy Aurora': { colors: ['#F7AEF8', '#B388EB', '#8093F1', '#72DDF7', '#F4F4ED'], source: 'design-corner', family: 'studies' },
  'Deep Sea Harvest': { colors: ['#222E50', '#007991', '#439A86', '#BCD8C1', '#E9D985'], source: 'design-corner', family: 'studies' },
  'Cobalt Citrus': { colors: ['#909CC2', '#084887', '#F58A07', '#F9AB55', '#F7F5FB'], source: 'design-corner', family: 'studies' },
  'Golden Terracotta': { colors: ['#2274A5', '#E7EB90', '#FADF63', '#E6AF2E', '#632B30'], source: 'design-corner', family: 'studies' },
  'Tropical Rose': { colors: ['#048A81', '#21295C', '#FBC3BC', '#8A89C0', '#F87666'], source: 'design-corner', family: 'studies' },
  'Royal Violet': { colors: ['#DABFFF', '#B59DEB', '#907AD6', '#6265A7', '#4E4983'], source: 'design-corner', family: 'studies' },
  'Coastal Harvest': { colors: ['#A799B7', '#47A8BD', '#DE9151', '#D4E6B5', '#033F63'], source: 'design-corner', family: 'studies' },
  'Smoky Aubergine': { colors: ['#A799B7', '#9888A5', '#776472', '#445552', '#294D4A'], source: 'design-corner', family: 'studies' },
  'Midnight Fjord': { colors: ['#3E92CC', '#2A628F', '#18435A', '#16324F', '#13293D'], source: 'design-corner', family: 'studies' },
  'Forest Dusk': { colors: ['#083F72', '#19381F', '#D6D8EA', '#748E54', '#B75D69'], source: 'design-corner', family: 'studies' },
  'Meadow Orchid': { colors: ['#44AF69', '#DAB6FC', '#FCAB10', '#2B9EB3', '#70566D'], source: 'design-corner', family: 'studies' },
  'Sage and Clay': { colors: ['#DBD56E', '#88AB75', '#2D93AD', '#7D7C84', '#DE8F6E'], source: 'design-corner', family: 'studies' },
  'Dusty Ember': { colors: ['#DAD6D6', '#92BFB1', '#F4AC45', '#694A38', '#A61C3C'], source: 'design-corner', family: 'studies' },
  'Deep Teal Moss': { colors: ['#095256', '#087F8C', '#5AAA95', '#86A873', '#BB9F06'], source: 'design-corner', family: 'studies' },
  'Pastel Orchard': { colors: ['#A3D9FF', '#FFD2FC', '#96E6B3', '#BE6E46', '#F2E94E'], source: 'design-corner', family: 'studies' },
  'Skybound Pastels': { colors: ['#56CBF9', '#7FBEEB', '#AFBED1', '#EAC5D8', '#DBD8F0'], source: 'design-corner', family: 'studies' },
  'Candy Breeze': { colors: ['#89DAFB', '#FFD166', '#FFB5C2', '#86FEE4', '#B7B9F6'], source: 'design-corner', family: 'studies' },
  'Ocean Candy': { colors: ['#05668D', '#FFD166', '#FFB5C2', '#02C39A', '#BBBDF6'], source: 'design-corner', family: 'studies' },
  'Muted Sage': { colors: ['#E5C1BD', '#D2D0BA', '#B6BE9C', '#7B9E87', '#5E747F'], source: 'design-corner', family: 'studies' },
  'Citrus Charcoal': { colors: ['#E9D758', '#297373', '#FF8552', '#E6E6E6', '#39393A'], source: 'design-corner', family: 'studies' },
};

/** The groups a document colours: their keys in order of first appearance, with the colour each has now. */
export function paletteColor(colors: string[] | null | undefined, i: number, fallback: string[]): string {
  const c = colors && colors.length ? colors : fallback; return c[i % c.length];
}
