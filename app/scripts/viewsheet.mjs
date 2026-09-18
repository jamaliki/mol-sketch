// A contact sheet of the suggested views for a scene, plus the score of a reference view.
//   node scripts/viewsheet.mjs SCENE_URL OUT.png [yaw pitch roll]     (dev server on :5173)
import { chromium } from 'playwright'; import fs from 'fs';
const [scene = '/examples/calb_pnpa.json', out = '/tmp/views.png', ry, rp, rr] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1260, height: 720 } });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => window.TriadSketch.setLive(false)); await p.evaluate(u => window.TriadSketch.loadUrl(u), scene); await p.waitForFunction(() => window.TriadSketch.scene); await p.waitForTimeout(300);
const r = await p.evaluate(async ref => {
  const T = window.TriadSketch; const picks = await T.suggest(() => { });
  const m = await import('/src/app/views.ts'); const E = T.classicEngine(); const R = T.renderer; let refScore = null;
  if (ref) { E.cfg = (await import('/src/classic/adapter.ts')).cfgFromStyle(T.style, T.camera, true); refScore = m.scoreView(E, T.scene, R.w / 2, R.h / 2, m.holdFrames(E), ...ref) }
  const c = document.createElement('canvas'); const w = picks[0].canvas.width, h = picks[0].canvas.height; const cols = 4, rows = Math.ceil(picks.length / cols); c.width = w * cols; c.height = (h + 22) * rows; const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height);
  picks.forEach((v, i) => { const cx = (i % cols) * w, cy = Math.floor(i / cols) * (h + 22); x.drawImage(v.canvas, cx, cy); x.fillStyle = '#eee'; x.font = '16px sans-serif'; x.fillText(`${i + 1}  ${v.yaw}/${v.pitch}/${v.roll.toFixed(0)}  ${(v.score * 100).toFixed(0)}  r${v.parts.rings.toFixed(2)} c${v.parts.clear.toFixed(2)} s${v.parts.spread.toFixed(2)} a${v.parts.aspect.toFixed(2)} e${v.parts.exit.toFixed(2)}`, cx + 4, cy + h + 16) });
  return { png: c.toDataURL('image/png'), picks: picks.map(v => [v.yaw, v.pitch, +v.roll.toFixed(0), +(v.score * 100).toFixed(0)]), refScore };
}, ry !== undefined ? [+ry, +rp, +rr] : null);
fs.writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64')); console.log(JSON.stringify(r.picks), 'reference:', JSON.stringify(r.refScore));
await b.close();
