// Full-page screenshot of the app with the mechanism loaded and the classic frame settled
import { chromium } from 'playwright';
const [out, frame = '28'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => window.TriadSketch.loadUrl('examples/mechanism.json')); await p.waitForTimeout(300);
await p.evaluate(f => window.TriadSketch.seek(f), +frame);
await p.waitForTimeout(1500);   // the view rests → classic render fades in
await p.evaluate(() => { const d = document.querySelectorAll('details'); d.forEach(x => x.open = false); ['Looks', 'Data', 'Animation', 'Representations'].forEach(t => { for (const x of d) if (x.querySelector('summary')?.textContent === t) x.open = true }) });
await p.waitForTimeout(300);
await p.screenshot({ path: out });
await b.close();
