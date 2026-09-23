// node scripts/sk.mjs <out.png> [look] [example] [js]  — renders the sketch pass and reports its timings
import { chromium } from 'playwright'; import fs from 'fs';
const [out, look = '', example = '', js = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.MolSketch && window.MolSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => { window.MolSketch.setLive(false); window.MolSketch.setSketch(false) });
if (example) { await p.evaluate(n => window.MolSketch.loadUrl('/examples/' + n), example); await p.waitForTimeout(300) }
if (look) await p.evaluate(k => window.MolSketch.applyLook(k), look);
if (js) await p.evaluate(js);
const st = await p.evaluate(() => { const T = window.MolSketch; return T.sketch(3) });
const png = await p.evaluate(() => window.MolSketch.png());
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(out, JSON.stringify(st), 'errors:', errs.slice(0, 5));
await b.close();
