#!/usr/bin/env node
/* Headless batch renderer for the MolSketch app.

   node cli/render.mjs input.pdb|input.cif|scene.json [more.pdb …] [options]
                      several structure files (sorted by name) become a stack: one keyframe each
     --look NAME        watercolour | ink-colour | ink | dark-paper | chalkboard | engraved | engraved-colour |
                        assembly-surface | assembly-cartoon
     --style FILE       a style JSON saved from the app (applied after --look)
     --set path=value   override one style field, repeatable (reps.cartoon=polymer line.width=2 palette.paper=#fff)
     --size WxH         the canvas, in CSS pixels (default 1920x1440)
     --scale N          pixel density: 2 draws the same figure at twice the pixels, as a Retina screen does (default 1)
     --yaw / --pitch / --roll / --zoom / --fov   camera;  --pan X,Y  pan as fractions of the canvas
     --fit L,T,R,B      after the camera: set zoom and pan so the drawing fills that box (percent or fractions of
                        the frame, x right, y down) — e.g. --fit 57,13,92,58 is the site's hero, --fit 11,15,89,45 a phone
     --fit-what all|frame   what --fit measures: every keyframe of the animation (default) or the current frame
     --write-view [FILE]    write the camera the render used (after --fit) into the scene JSON (or FILE) and stop
     --turntable N      N frames of one full yaw turn (adds --swing D degrees of pitch nod)
     --frames SPEC      structures: N frames with the lines re-boiled each frame (default 1)
                        scenes: all | drawn (one per new drawing) | keyframes | N | A-B   (default drawn)
     --out DIR          output folder (default ./out), files frame_0000.png …
     --engine E         classic (default: the exact canvas engine) | sketch (fast hybrid) | preview (GPU only)
     --software         force SwiftShader (CPU) GL, for machines without a GPU
     --workers N        pages drawing frames at once, each taking every N-th (default: half the cores, at most 4)

   Requires `npm run build` first (renders the built app from dist/). */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url)); const dist = path.join(here, '..', 'dist');
const argv = process.argv.slice(2); const inputs = []; const opt = { look: '', style: '', set: [], size: '1920x1440', yaw: NaN, pitch: NaN, roll: NaN, zoom: NaN, fov: NaN, pan: '', fit: '', fitWhat: 'all', writeView: undefined, turntable: 0, swing: 0, frames: '', out: 'out', software: false, engine: 'classic' };
for (let i = 0; i < argv.length; i++) { const a = argv[i];
  if (a === '--look') opt.look = argv[++i]; else if (a === '--style') opt.style = argv[++i]; else if (a === '--set') opt.set.push(argv[++i]);
  else if (a === '--size') opt.size = argv[++i]; else if (a === '--scale') opt.scale = +argv[++i]; else if (a === '--yaw') opt.yaw = +argv[++i]; else if (a === '--pitch') opt.pitch = +argv[++i]; else if (a === '--zoom') opt.zoom = +argv[++i]; else if (a === '--fov') opt.fov = +argv[++i]; else if (a === '--roll') opt.roll = +argv[++i]; else if (a === '--pan') opt.pan = argv[++i]; else if (a === '--fit') opt.fit = argv[++i]; else if (a === '--fit-what') opt.fitWhat = argv[++i]; else if (a === '--write-view') opt.writeView = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  else if (a === '--turntable') opt.turntable = +argv[++i]; else if (a === '--swing') opt.swing = +argv[++i]; else if (a === '--frames') opt.frames = argv[++i]; else if (a === '--out') opt.out = argv[++i]; else if (a === '--software') opt.software = true; else if (a === '--engine') opt.engine = argv[++i]; else if (a === '--workers') opt.workers = +argv[++i];
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '')); process.exit(0) }
  else inputs.push(a) }
const input = inputs[0];
if (!input) { console.error('usage: node cli/render.mjs input.pdb --look watercolour [--size 1920x1440] [--turntable 72]'); process.exit(1) }
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ not found: run  npm run build  first'); process.exit(1) }

// static server for dist/
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdb': 'text/plain', '.cif': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res) });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;

const args = ['--ignore-gpu-blocklist']; if (opt.software) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
// Playwright's own Chromium, else an installed Chrome or Edge (CHROMIUM=/path/to/chrome picks one)
async function launch() {
  if (process.env.CHROMIUM) return chromium.launch({ args, executablePath: process.env.CHROMIUM });
  for (const channel of [undefined, 'chrome', 'msedge']) { try { return await chromium.launch({ args, channel }) } catch { } }
  console.error('no browser to draw with: run  npx playwright install chromium  (or set CHROMIUM=/path/to/chrome)'); process.exit(1);
}
const browser = await launch();
const [W, H] = opt.size.split('x').map(Number); const SCALE = opt.scale > 0 ? opt.scale : 1;
/** a page with the figure set up as the options say (several draw a video's frames, each taking every n-th) */
async function setUp(first = true) {
  const page = await (await browser.newContext({ viewport: { width: Math.min(W, 4096) + 300, height: Math.min(H, 4096) }, deviceScaleFactor: SCALE })).newPage();   // (a context of its own: a renderer process of its own, so pages draw at once)
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.MolSketch, null, { timeout: 60000 });
  // a canvas does not wait for web fonts: load every face the drawing can use before the first frame, or labels fall back
  await page.evaluate(async () => { const faces = ['500 20px Caveat', '600 20px Caveat', '400 20px "Patrick Hand"', '400 20px Kalam', '700 20px Kalam', '400 20px "IBM Plex Sans"', '500 20px "IBM Plex Sans"', '600 20px "IBM Plex Sans"'];
    await Promise.all(faces.map(f => document.fonts.load(f, 'AaBb0123²⁺'))); await document.fonts.ready });
  await page.waitForFunction(() => window.MolSketch.renderer.structure, null, { timeout: 30000 }).catch(() => {});   // the start-up example must land before ours, or it replaces it
  if (inputs.length > 1) { const files = inputs.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') })); await page.evaluate(files => { window.MolSketch.setLive(false); window.MolSketch.setSketch(false); window.MolSketch.loadStack(files) }, files) }
  else { const text = fs.readFileSync(input, 'utf8'); await page.evaluate(async ([t, n]) => { window.MolSketch.setLive(false); window.MolSketch.setSketch(false); await window.MolSketch.loadText(t, n) }, [text, path.basename(input)]) }
  if (opt.look) await page.evaluate(k => window.MolSketch.applyLook(k), opt.look);
  if (opt.style) { const st = JSON.parse(fs.readFileSync(opt.style, 'utf8')); await page.evaluate(s => { const T = window.MolSketch; if (!s.reps) s.reps = T.style.reps; T.style = s }, st) }   // a style without reps keeps the scene's, as a look does
  if (opt.set.length) await page.evaluate(sets => { const T = window.MolSketch; const st = JSON.parse(JSON.stringify(T.style));
    for (const kv of sets) { const i = kv.indexOf('='); const ks = kv.slice(0, i).split('.'); let raw = kv.slice(i + 1); let v = raw; if (raw === 'true') v = true; else if (raw === 'false') v = false; else if (raw !== '' && !isNaN(+raw)) v = +raw;
      let o = st; for (let j = 0; j < ks.length - 1; j++) { o[ks[j]] = o[ks[j]] || {}; o = o[ks[j]] } o[ks[ks.length - 1]] = v }
    T.style = st }, opt.set);
  // a look or style applied after the scene resets the camera's field of view to the style's; the scene's own view wins, then the flags
  await page.evaluate(() => { const T = window.MolSketch; const v = T.scene && T.scene.view; if (v) { T.camera.yaw = v.yaw ?? 0; T.camera.pitch = v.pitch ?? 0; T.camera.roll = v.roll ?? 0; T.camera.zoom = v.zoom ?? 1; T.camera.panX = v.panX ?? 0; T.camera.panY = v.panY ?? 0; if (v.fov !== undefined) { T.camera.fov = v.fov; const st = JSON.parse(JSON.stringify(T.style)); st.view.fov = v.fov; T.style = st } } });
  await page.evaluate(([w, h, yaw, pitch, roll, zoom, fov, pan, s]) => { const T = window.MolSketch; if (s !== 1) T.setDpr(s); T.setSize(Math.round(w * s), Math.round(h * s)); if (!isNaN(yaw)) T.camera.yaw = yaw; if (!isNaN(pitch)) T.camera.pitch = pitch; if (!isNaN(roll)) T.camera.roll = roll; if (!isNaN(zoom)) T.camera.zoom = zoom; if (!isNaN(fov)) T.camera.fov = fov; if (pan) { const [x, y] = pan.split(',').map(Number); T.camera.panX = x; T.camera.panY = y } }, [W, H, opt.yaw, opt.pitch, opt.roll, opt.zoom, opt.fov, opt.pan, SCALE]);
  if (opt.fit) { const v = opt.fit.split(',').map(Number); const f = v.map(x => (Math.max(...v) > 1 ? x / 100 : x)); const box = { x0: f[0], y0: f[1], x1: f[2], y1: f[3] };
    const got = await page.evaluate(([box, what]) => { const T = window.MolSketch; T.fitFrame(box, what); const b = T.screenBox(what); return { zoom: T.camera.zoom, panX: T.camera.panX, panY: T.camera.panY, box: b } }, [box, opt.fitWhat]);
    if (first) console.log(`fit: zoom ${got.zoom.toFixed(3)} pan ${got.panX.toFixed(3)},${got.panY.toFixed(3)} → drawing at ${(got.box.x0 * 100).toFixed(1)}–${(got.box.x1 * 100).toFixed(1)} % × ${(got.box.y0 * 100).toFixed(1)}–${(got.box.y1 * 100).toFixed(1)} %`) }
  return page;
}
const page = await setUp();
if (opt.writeView !== undefined) { const view = await page.evaluate(() => { const c = window.MolSketch.camera; const st = window.MolSketch.style; return { yaw: c.yaw, pitch: c.pitch, roll: c.roll, zoom: c.zoom, panX: c.panX, panY: c.panY, fov: c.fov, fog: st.view.fog, fogStart: st.view.fogStart } });
  const target = opt.writeView === true ? input : opt.writeView; if (!/\.json$/i.test(target)) { console.error('--write-view needs a scene JSON'); process.exit(1) }
  const doc = JSON.parse(fs.readFileSync(target === input ? input : input, 'utf8')); doc.view = { ...(doc.view || {}), ...view }; fs.writeFileSync(target, JSON.stringify(doc)); console.log('view written to', target, JSON.stringify(view)); await browser.close(); server.close(); process.exit(0) }
fs.mkdirSync(opt.out, { recursive: true });
const isScene = await page.evaluate(() => !!window.MolSketch.scene);
// which frames
let frames = [];
if (opt.turntable) { for (let f = 0; f < opt.turntable; f++) frames.push(f) }
else if (isScene) {
  const tl = await page.evaluate(() => { const T = window.MolSketch.classicEngine().TL; return { total: T.total, segs: T.segs } });
  const spec = opt.frames || 'drawn';
  if (spec === 'all') for (let f = 0; f < tl.total; f++) frames.push(f);
  else if (spec === 'drawn') for (let f = 0; f < tl.total; f += 2) frames.push(f);
  else if (spec === 'keyframes') { const seen = new Set(); for (const s of tl.segs) if (s.type === 'hold' && !seen.has(s.kf)) { seen.add(s.kf); frames.push(s.start) } }
  else if (/^\d+-\d+$/.test(spec)) { const [a, b] = spec.split('-').map(Number); for (let f = a; f <= b; f++) frames.push(f) }
  else frames = [+spec];
} else { const n = +(opt.frames || 1); for (let f = 0; f < n; f++) frames.push(f) }
const t0 = Date.now(); let k = 0;
const os = await import('os');
const nPages = Math.max(1, Math.min(opt.workers > 0 ? opt.workers : Math.min(4, Math.floor(os.cpus().length / 2) || 1), Math.floor(frames.length / 4) || 1));
const pages = [page]; for (let i = 1; i < nPages; i++) pages.push(await setUp(false));
async function drawFrames(page, mine) { await page.evaluate(() => window.MolSketch.hold?.(true)); for (const f of mine) {
  const png = await page.evaluate(([f, n, tt, swing, yaw0, pitch0, engine, isScene]) => { const T = window.MolSketch;
    if (tt) { T.camera.yaw = (isNaN(yaw0) ? 0 : yaw0) + 360 * f / n; T.camera.pitch = (isNaN(pitch0) ? 0 : pitch0) + swing * Math.sin(2 * Math.PI * f / n) }
    if (isScene) T.seek(f);
    if (engine === 'preview') { T.render(); return T.png() } if (engine === 'classic') T.classic(f); else T.sketch(f); return T.png() }, [f, opt.turntable, opt.turntable, opt.swing, opt.yaw, opt.pitch, opt.engine, isScene]);
  fs.writeFileSync(path.join(opt.out, `frame_${String(f).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
  process.stdout.write(`\r${++k}/${frames.length} frames  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} }
await Promise.all(pages.map((pg, i) => drawFrames(pg, frames.filter((_, j) => j % pages.length === i))));
process.stdout.write('\n');
if (frames.length > 1) console.log(`Assemble:  ffmpeg -framerate 12 -pattern_type glob -i '${opt.out}/frame_*.png' -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`);
await browser.close(); server.close();
