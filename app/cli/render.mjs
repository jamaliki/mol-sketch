#!/usr/bin/env node
/* Headless batch renderer for the Triad Sketch app.

   node cli/render.mjs input.pdb|input.cif [options]
     --look NAME        watercolour | ink-colour | ink | assembly-surface | assembly-cartoon
     --style FILE       a style JSON saved from the app (applied after --look)
     --set path=value   override one style field, repeatable (reps.cartoon=polymer line.width=2 palette.paper=#fff)
     --size WxH         output pixels (default 1920x1440)
     --yaw / --pitch / --zoom / --fov   camera
     --turntable N      N frames of one full yaw turn (adds --swing D degrees of pitch nod)
     --frames N         N frames with the lines re-boiled each frame (default 1); ignored with --turntable
     --out DIR          output folder (default ./out), files frame_0000.png …
     --engine E         classic (default: the exact canvas engine) | sketch (fast hybrid) | preview (GPU only)
     --software         force SwiftShader (CPU) GL, for machines without a GPU

   Requires `npm run build` first (renders the built app from dist/). */
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import http from 'http'; import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url)); const dist = path.join(here, '..', 'dist');
const argv = process.argv.slice(2); const opt = { look: '', style: '', set: [], size: '1920x1440', yaw: 0, pitch: 0, zoom: 1, fov: NaN, turntable: 0, swing: 0, frames: 1, out: 'out', software: false, engine: 'classic' }; let input = '';
for (let i = 0; i < argv.length; i++) { const a = argv[i];
  if (a === '--look') opt.look = argv[++i]; else if (a === '--style') opt.style = argv[++i]; else if (a === '--set') opt.set.push(argv[++i]);
  else if (a === '--size') opt.size = argv[++i]; else if (a === '--yaw') opt.yaw = +argv[++i]; else if (a === '--pitch') opt.pitch = +argv[++i]; else if (a === '--zoom') opt.zoom = +argv[++i]; else if (a === '--fov') opt.fov = +argv[++i];
  else if (a === '--turntable') opt.turntable = +argv[++i]; else if (a === '--swing') opt.swing = +argv[++i]; else if (a === '--frames') opt.frames = +argv[++i]; else if (a === '--out') opt.out = argv[++i]; else if (a === '--software') opt.software = true; else if (a === '--engine') opt.engine = argv[++i];
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '')); process.exit(0) }
  else input = a }
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
const text = fs.readFileSync(input, 'utf8');
await page.evaluate(async ([t, n]) => { window.TriadSketch.setLive(false); window.TriadSketch.setSketch(false); await window.TriadSketch.loadText(t, n) }, [text, path.basename(input)]);
if (opt.look) await page.evaluate(k => window.TriadSketch.applyLook(k), opt.look);
if (opt.style) { const st = JSON.parse(fs.readFileSync(opt.style, 'utf8')); await page.evaluate(s => { window.TriadSketch.style = s }, st) }
if (opt.set.length) await page.evaluate(sets => { const T = window.TriadSketch; const st = JSON.parse(JSON.stringify(T.style));
  for (const kv of sets) { const i = kv.indexOf('='); const ks = kv.slice(0, i).split('.'); let raw = kv.slice(i + 1); let v = raw; if (raw === 'true') v = true; else if (raw === 'false') v = false; else if (raw !== '' && !isNaN(+raw)) v = +raw;
    let o = st; for (let j = 0; j < ks.length - 1; j++) { o[ks[j]] = o[ks[j]] || {}; o = o[ks[j]] } o[ks[ks.length - 1]] = v }
  T.style = st }, opt.set);
await page.evaluate(([w, h, yaw, pitch, zoom, fov]) => { const T = window.TriadSketch; T.setSize(w, h); T.camera.yaw = yaw; T.camera.pitch = pitch; T.camera.zoom = zoom; if (!isNaN(fov)) T.camera.fov = fov }, [W, H, opt.yaw, opt.pitch, opt.zoom, opt.fov]);
fs.mkdirSync(opt.out, { recursive: true });
const n = opt.turntable || opt.frames; const t0 = Date.now();
for (let f = 0; f < n; f++) {
  const png = await page.evaluate(([f, n, tt, swing, yaw0, pitch0, engine]) => { const T = window.TriadSketch; if (tt) { T.camera.yaw = yaw0 + 360 * f / n; T.camera.pitch = pitch0 + swing * Math.sin(2 * Math.PI * f / n) } if (engine === 'preview') { T.render(); return T.png() } if (engine === 'classic') T.classic(f); else T.sketch(f); return T.png() }, [f, n, opt.turntable, opt.swing, opt.yaw, opt.pitch, opt.engine]);
  fs.writeFileSync(path.join(opt.out, `frame_${String(f).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
  process.stdout.write(`\r${f + 1}/${n} frames  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
process.stdout.write('\n');
if (n > 1) console.log(`Assemble:  ffmpeg -framerate 12 -pattern_type glob -i '${opt.out}/frame_*.png' -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`);
await browser.close(); server.close();
