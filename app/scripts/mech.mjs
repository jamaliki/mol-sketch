// Acceptance: mechanism.json frame 28 through the app's classic path at 960x720, watercolour look
import { chromium } from 'playwright'; import fs from 'fs';
const [out, look = 'watercolour', frame = '28'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1260, height: 720 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => { window.TriadSketch.setLive(false); window.TriadSketch.setSketch(false) });
await p.evaluate(k => window.TriadSketch.applyLook(k), look);
await p.evaluate(() => window.TriadSketch.loadUrl('/examples/mechanism.json')); await p.waitForTimeout(300);
const r = await p.evaluate(f => { const T = window.TriadSketch; T.setSize(960, 720); T.seek(f); T.render(); const ms = T.classic(); return { ms, w: T.renderer.w, h: T.renderer.h } }, +frame);
const png = await p.evaluate(() => window.TriadSketch.png());
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(out, JSON.stringify(r), 'errors:', errs.slice(0, 3));
await b.close();
