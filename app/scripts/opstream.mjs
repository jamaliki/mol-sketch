// Whether a change to the engine draws the same: every op the headless core records for a set of figures (each drawn
// twice: the first drawing, and one with everything it keeps kept), hashed per figure, with the time each took.
//   node scripts/opstream.mjs [CORE.js] > a.json        (default: ../python/molsketch/_core.js)
//   node scripts/opstream.mjs OTHER_CORE.js > b.json && diff a.json b.json    (or: --compare a.json)
// Two cores that record the same hashes draw the same pictures, to the byte, in Python and in the app. The figures are
// the examples and PDB entries in the SDK's cache (~/.cache/molsketch, or MOLSKETCH_CACHE); those not there are left out,
// so compare runs made on one machine. Canvas and paint ids count on from one figure to the next: always run the whole
// set, in order.
import fs from 'fs'; import vm from 'vm'; import crypto from 'crypto'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const cmp = args.indexOf('--compare'); const against = cmp >= 0 ? JSON.parse(fs.readFileSync(args.splice(cmp, 2)[1], 'utf8')) : null;
const core = args[0] || path.join(here, '../../python/molsketch/_core.js');
vm.runInThisContext(fs.readFileSync(core, 'utf8'));
const M = globalThis.MolSketchCore;
const CACHE = process.env.MOLSKETCH_CACHE || path.join(os.homedir(), '.cache/molsketch'), EX = path.join(here, '../public/examples');
const file = (f) => fs.existsSync(f) ? { text: fs.readFileSync(f, 'utf8'), name: path.basename(f) } : null;
const inputs = { '6QZP': file(path.join(CACHE, '6QZP.cif')), '6GZQ': file(path.join(CACHE, '6GZQ.cif')), '5P21': file(path.join(CACHE, '5P21.cif')),
  '3PTB': file(path.join(CACHE, '3PTB.cif')), '5KKA': file(path.join(CACHE, '5KKA.cif')), '1A8O': file(path.join(EX, '1A8O.pdb')),
  mech: { scene: JSON.parse(fs.readFileSync(path.join(EX, 'mechanism.json'), 'utf8')) }, tryp: { scene: JSON.parse(fs.readFileSync(path.join(EX, 'trypsin_active_site.json'), 'utf8')) } };
for (const [k, v] of Object.entries(inputs)) if (v) M.put(k, v);
// text measured without a host: a width from the letters, the same every run
const measure = (font, t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997; return t.length * 5.5 + h / 997 };
const flat = { palette: { ink: '#242126', paper: '#ffffff' }, 'paper.transparent': true };
const figs = {
  'ribosome-flat-surface': ['6QZP', { size: [1200, 1200], look: 'flat', style: { ...flat, 'reps.cartoon': '', 'reps.sticks': '', 'reps.surface': 'polymer' }, groupColors: { 'subunit:L': '#3f7fc0', 'subunit:S': '#e08a2e' } }],
  '5kka-flat': ['5KKA', { size: [1200, 1200], look: 'flat', style: flat }],
  '5p21-engraved-colour': ['5P21', { size: [1200, 900], look: 'engraved-colour', style: { 'reps.sticks': 'hetatm and not water' }, camera: { yaw: 60, pitch: 20 }, labels: [{ text: 'Switch I', x: 0.3, y: 0.2, dx: 0, dy: 0 }] }],
  '5p21-watercolour': ['5P21', { size: [900, 700], look: 'watercolour' }],
  '5p21-chalk-site': ['5P21', { size: [900, 700], look: 'chalkboard', style: { 'site.sel': 'resn GNP' } }],
  '3ptb-flat-site': ['3PTB', { size: [1200, 900], look: 'flat', style: { 'site.sel': 'resi 57+102+195 or resn BEN' }, camera: { yaw: 36, zoom: 2.4 } }],
  '3ptb-ballstick': ['3PTB', { size: [1200, 900], look: 'flat', style: { mode: 'ballstick' } }],
  '6gzq-assembly-surface': ['6GZQ', { size: [900, 900], look: 'assembly-surface' }],
  '6gzq-assembly-cartoon': ['6GZQ', { size: [900, 900], look: 'assembly-cartoon' }],
  '6gzq-ink-surface': ['6GZQ', { size: [700, 700], look: 'ink', style: { 'reps.cartoon': '', 'reps.surface': 'polymer' } }],
  '1a8o-ink-colour': ['1A8O', { size: [960, 720], look: 'ink-colour' }],
  'mechanism-watercolour-28': ['mech', { size: [1200, 750], look: 'watercolour', frame: 28 }],
  'mechanism-textbook-61': ['mech', { size: [1000, 700], look: 'textbook', frame: 61 }],
  'trypsin-site': ['tryp', { size: [1200, 900], frame: 0 }],
  '5p21-default': ['5P21', { size: [960, 720] }],
};
const out = {};
for (const [name, [ref, spec]] of Object.entries(figs)) {
  if (!inputs[ref]) continue;
  const h = crypto.createHash('sha256'); let ops = 0; const t0 = performance.now(); let first = 0;
  for (let pass = 0; pass < 2; pass++) {
    const r = M.render({ input: { ref }, ...spec }, measure);
    for (const c of r.chunks) { h.update(JSON.stringify({ canvases: c.canvases, paints: c.paints, dead: c.dead })); h.update(c.runs); for (const k in c.canvases) ops += c.canvases[k].ops.length }
    h.update(JSON.stringify([r.canvas, r.width, r.height]));
    if (!pass) first = performance.now() - t0;
  }
  out[name] = { hash: h.digest('hex').slice(0, 16), ops, first_ms: Math.round(first), again_ms: Math.round(performance.now() - t0 - first) };
  const was = against?.[name];
  console.error(name.padEnd(26), String(out[name].first_ms).padStart(6), 'ms', String(out[name].again_ms).padStart(6), 'ms', out[name].hash, was ? (was.hash === out[name].hash ? 'same' : 'DIFFERENT') : '');
}
console.log(JSON.stringify(out, null, 1));
if (against && Object.keys(out).some(k => against[k] && against[k].hash !== out[k].hash)) process.exitCode = 1;
