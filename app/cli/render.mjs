#!/usr/bin/env node
/* Headless batch renderer for the Triad Sketch app.

   node cli/render.mjs input.pdb|input.cif|scene.json [more.pdb …] [options]
                      several structure files (sorted by name) become a stack: one keyframe each
     --look NAME        watercolour | ink-colour | ink | assembly-surface | assembly-cartoon
     --style FILE       a style JSON saved from the app (applied after --look)
     --set path=value   override one style field, repeatable (reps.cartoon=polymer line.width=2 palette.paper=#fff)
     --size WxH         output pixels (default 1920x1440)
     --yaw / --pitch / --zoom / --fov   camera
     --turntable N      N frames of one full yaw turn (adds --swing D degrees of pitch nod)
     --frames SPEC      structures: N frames with the lines re-boiled each frame (default 1)
                        scenes: all | drawn (one per new drawing) | keyframes | N | A-B   (default drawn)
     --out DIR          output folder (default ./out), files frame_0000.png …
     --engine E         classic (default: the exact canvas engine) | sketch (fast hybrid) | preview (GPU only)
     --software         force SwiftShader (CPU) GL, for machines without a GPU

   Requires `npm run build` first (renders the built app from dist/). */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url)); const dist = path.join(here, '..', 'dist');
const argv = process.argv.slice(2); const inputs = []; const opt = { look: '', style: '', set: [], size: '1920x1440', yaw: NaN, pitch: NaN, zoom: NaN, fov: NaN, turntable: 0, swing: 0, frames: '', out: 'out', software: false, engine: 'classic' };
for (let i = 0; i < argv.length; i++) { const a = argv[i];
  if (a === '--look') opt.look = argv[++i]; else if (a === '--style') opt.style = argv[++i]; else if (a === '--set') opt.set.push(argv[++i]);
  else if (a === '--size') opt.size = argv[++i]; else if (a === '--yaw') opt.yaw = +argv[++i]; else if (a === '--pitch') opt.pitch = +argv[++i]; else if (a === '--zoom') opt.zoom = +argv[++i]; else if (a === '--fov') opt.fov = +argv[++i];
  else if (a === '--turntable') opt.turntable = +argv[++i]; else if (a === '--swing') opt.swing = +argv[++i]; else if (a === '--frames') opt.frames = argv[++i]; else if (a === '--out') opt.out = argv[++i]; else if (a === '--software') opt.software = true; else if (a === '--engine') opt.engine = argv[++i];
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '')); process.exit(0) }
  else inputs.push(a) }
const input = inputs[0];
if (!input) { console.error('usage: node cli/render.mjs input.pdb --look watercolour [--size 1920x1440] [--turntable 72]'); process.exit(1) }
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/ not found: run  npm run build  first'); process.exit(1) }

// static server for dist/
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdb': 'text/plain', '.cif': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p); if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res) });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;

const args = ['--ignore-gpu-blocklist']; if (opt.software) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ args, executablePath: process.env.CHROMIUM || undefined });
const [W, H] = opt.size.split('x').map(Number);
const page = await browser.newPage({ viewport: { width: Math.min(W, 4096) + 300, height: Math.min(H, 4096) } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.TriadSketch, null, { timeout: 60000 });
await page.waitForFunction(() => window.TriadSketch.renderer.structure, null, { timeout: 30000 }).catch(() => {});   // the start-up example must land before ours, or it replaces it
if (inputs.length > 1) { const files = inputs.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') })); await page.evaluate(files => { window.TriadSketch.setLive(false); window.TriadSketch.setSketch(false); window.TriadSketch.loadStack(files) }, files) }
else { const text = fs.readFileSync(input, 'utf8'); await page.evaluate(async ([t, n]) => { window.TriadSketch.setLive(false); window.TriadSketch.setSketch(false); await window.TriadSketch.loadText(t, n) }, [text, path.basename(input)]) }
if (opt.look) await page.evaluate(k => window.TriadSketch.applyLook(k), opt.look);
if (opt.style) { const st = JSON.parse(fs.readFileSync(opt.style, 'utf8')); await page.evaluate(s => { window.TriadSketch.style = s }, st) }
if (opt.set.length) await page.evaluate(sets => { const T = window.TriadSketch; const st = JSON.parse(JSON.stringify(T.style));
  for (const kv of sets) { const i = kv.indexOf('='); const ks = kv.slice(0, i).split('.'); let raw = kv.slice(i + 1); let v = raw; if (raw === 'true') v = true; else if (raw === 'false') v = false; else if (raw !== '' && !isNaN(+raw)) v = +raw;
    let o = st; for (let j = 0; j < ks.length - 1; j++) { o[ks[j]] = o[ks[j]] || {}; o = o[ks[j]] } o[ks[ks.length - 1]] = v }
  T.style = st }, opt.set);
await page.evaluate(([w, h, yaw, pitch, zoom, fov]) => { const T = window.TriadSketch; T.setSize(w, h); if (!isNaN(yaw)) T.camera.yaw = yaw; if (!isNaN(pitch)) T.camera.pitch = pitch; if (!isNaN(zoom)) T.camera.zoom = zoom; if (!isNaN(fov)) T.camera.fov = fov }, [W, H, opt.yaw, opt.pitch, opt.zoom, opt.fov]);
fs.mkdirSync(opt.out, { recursive: true });
const isScene = await page.evaluate(() => !!window.TriadSketch.scene);
// which frames
let frames = [];
if (opt.turntable) { for (let f = 0; f < opt.turntable; f++) frames.push(f) }
else if (isScene) {
  const tl = await page.evaluate(() => { const T = window.TriadSketch.classicEngine().TL; return { total: T.total, segs: T.segs } });
  const spec = opt.frames || 'drawn';
  if (spec === 'all') for (let f = 0; f < tl.total; f++) frames.push(f);
  else if (spec === 'drawn') for (let f = 0; f < tl.total; f += 2) frames.push(f);
  else if (spec === 'keyframes') { const seen = new Set(); for (const s of tl.segs) if (s.type === 'hold' && !seen.has(s.kf)) { seen.add(s.kf); frames.push(s.start) } }
  else if (/^\d+-\d+$/.test(spec)) { const [a, b] = spec.split('-').map(Number); for (let f = a; f <= b; f++) frames.push(f) }
  else frames = [+spec];
} else { const n = +(opt.frames || 1); for (let f = 0; f < n; f++) frames.push(f) }
const t0 = Date.now(); let k = 0;
for (const f of frames) {
  const png = await page.evaluate(([f, n, tt, swing, yaw0, pitch0, engine, isScene]) => { const T = window.TriadSketch;
    if (tt) { T.camera.yaw = (isNaN(yaw0) ? 0 : yaw0) + 360 * f / n; T.camera.pitch = (isNaN(pitch0) ? 0 : pitch0) + swing * Math.sin(2 * Math.PI * f / n) }
    if (isScene) T.seek(f);
    if (engine === 'preview') { T.render(); return T.png() } if (engine === 'classic') T.classic(f); else T.sketch(f); return T.png() }, [f, opt.turntable, opt.turntable, opt.swing, opt.yaw, opt.pitch, opt.engine, isScene]);
  fs.writeFileSync(path.join(opt.out, `frame_${String(f).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
  process.stdout.write(`\r${++k}/${frames.length} frames  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
process.stdout.write('\n');
if (frames.length > 1) console.log(`Assemble:  ffmpeg -framerate 12 -pattern_type glob -i '${opt.out}/frame_*.png' -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`);
await browser.close(); server.close();
