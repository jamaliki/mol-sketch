// Screenshots of the new sections with the CALB scene: (1) Animation + Checks with the change overlay, (2) Chemistry + Render
import { chromium } from 'playwright';
const [out = '/tmp/ui'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => window.TriadSketch.loadUrl('examples/calb_pnpa.json')); await p.waitForFunction(() => window.TriadSketch.scene); await p.waitForTimeout(300);
await p.evaluate(() => { window.TriadSketch.applyLook('dark-paper'); window.TriadSketch.seek(26) }); await p.waitForTimeout(2500);
const open = async (names) => { await p.evaluate(ns => { document.querySelectorAll('details').forEach(x => { x.open = ns.some(n => x.querySelector('summary')?.textContent.startsWith(n)) }) }, names); await p.waitForTimeout(300) };
await open(['Checks', 'Animation']);
await p.evaluate(() => { const T = window.TriadSketch; document.querySelector('#panel').scrollTop = 0 });
await p.hover('input[type=range][max]'); await p.waitForTimeout(400);
await p.screenshot({ path: out + '_1.png' });
await open(['Chemistry', 'Render', 'View']);
await p.evaluate(() => { window.TriadSketch.setAuthorMode('arrow'); document.querySelector('#panel').scrollTop = 0 }); await p.waitForTimeout(600);
await p.click('button:has-text("Suggest views")'); await p.waitForTimeout(6000);
await p.screenshot({ path: out + '_2.png' });
await b.close();
