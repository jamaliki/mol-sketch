// Headless screenshots for development: node scripts/shot.mjs <url> <out.png> [look] [example] [js]
import { chromium } from 'playwright';
import fs from 'fs';
const [url, out, look = '', example = '', js = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()) });
await p.goto(url); await p.waitForFunction(() => window.MolSketch && window.MolSketch.renderer.structure, null, { timeout: 60000 });
if (example) { await p.evaluate(n => window.MolSketch.loadUrl('/examples/' + n), example); await p.waitForTimeout(300) }
if (look) await p.evaluate(k => window.MolSketch.applyLook(k), look);
if (js) await p.evaluate(js);
await p.evaluate(() => { window.MolSketch.setLive(false) });
const t = await p.evaluate(() => { const T = window.MolSketch; T.render(); const t0 = performance.now(); for (let i = 0; i < 5; i++) T.render(); return (performance.now() - t0) / 5 });
await p.waitForTimeout(100);
const png = await p.evaluate(() => window.MolSketch.png());
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
const stats = await p.evaluate(() => window.MolSketch.renderer.stats);
console.log(out, 'ms/frame (swiftshader)', t.toFixed(1), JSON.stringify(stats), 'errors:', errs.slice(0, 5));
await b.close();
