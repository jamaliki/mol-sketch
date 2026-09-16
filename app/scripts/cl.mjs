// node scripts/cl.mjs <out.png> [look] [example] [js]  — renders with the classic engine through the app
import { chromium } from 'playwright'; import fs from 'fs';
const [out, look = '', example = '', js = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => { window.TriadSketch.setLive(false); window.TriadSketch.setSketch(false) });
if (example) { await p.evaluate(n => window.TriadSketch.loadUrl('/examples/' + n), example); await p.waitForTimeout(300) }
if (look) await p.evaluate(k => window.TriadSketch.applyLook(k), look);
if (js) await p.evaluate(js);
await p.waitForTimeout(500);
const ms = await p.evaluate(() => window.TriadSketch.classic(3));
const png = await p.evaluate(() => window.TriadSketch.png());
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(out, 'classic ms', ms.toFixed(0), 'errors:', errs.slice(0, 5));
await b.close();
