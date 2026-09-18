// Exercises the authoring tools headlessly against calb_pnpa.json: lint, keyframe diffs, arrows / lone pairs / charges by
// click, keyframe timing, duplicates, reorder, keyframe cameras, suggested views, undo, and rendering a video file with
// every codec the headless browser has.  node scripts/features.mjs OUTDIR   (dev server on :5173)
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const out = process.argv[2] || '/tmp/features'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1260, height: 720 }, acceptDownloads: true }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.TriadSketch && window.TriadSketch.renderer.structure, null, { timeout: 60000 });
await p.evaluate(() => { window.TriadSketch.setLive(false) });
await p.evaluate(() => window.TriadSketch.loadUrl('/examples/calb_pnpa.json')); await p.waitForFunction(() => window.TriadSketch.scene); await p.waitForTimeout(300);
const log = (k, v) => console.log(k.padEnd(18), typeof v === 'string' ? v : JSON.stringify(v));
// lint
log('lint', await p.evaluate(() => window.TriadSketch.lint().map(i => i.level[0] + (i.kf === null ? '' : i.kf + 1) + ': ' + i.text.slice(0, 90))));
// diff kf0 → kf1
log('diff 0→1', await p.evaluate(() => { const d = window.TriadSketch.keyDiff(0); return { moved: [...d.moved.keys()].slice(0, 6), broken: d.broken, formed: d.formed, reorder: d.reorder, gone: [...d.gone], fresh: [...d.fresh.keys()], charged: [...d.charged] } }));
// keyframes
log('keyframes', await p.evaluate(() => window.TriadSketch.keyframes().map(k => `${k.i + 1} ${k.name} h${k.hold.toFixed(2)} t${k.transition.toFixed(2)} ${k.arrows}ar${k.path ? ' path' : ''}`)));
// authoring: go to keyframe 0's hold, add a lone pair on ACE:O2 (already has? use PNP:O4), a charge, and an arrow lp(HIS224:NE2) → bond SER105:OG–HG
const auth = await p.evaluate(() => {
  const T = window.TriadSketch; T.seek(26); const { st, proj } = T.projectNow(); const P = id => { const a = st.A[id]; const q = proj.proj(a.pos); return [q.x, q.y] };
  const before = T.arrowsOf().length; const K = T.scene.keyframes[0];
  T.setAuthorMode('lp'); T.authorClick(...P('PNP:O1')); const lp = JSON.stringify(K.atoms['PNP:O1'].lp);
  T.setAuthorMode('charge'); T.authorClick(...P('PNP:O1')); const ch1 = K.atoms['PNP:O1'].charge; T.authorClick(...P('PNP:O1')); const ch2 = K.atoms['PNP:O1'].charge;
  T.setAuthorMode('arrow'); T.authorClick(...P('PNP:O1')); const a = st.A['SER105:OG'], b = st.A['SER105:HG']; const pa = proj.proj(a.pos), pb = proj.proj(b.pos); T.authorClick((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
  const after = T.arrowsOf(); T.setAuthorMode('off');
  const u1 = T.history.back(), u2 = T.history.back(); const arrowsAfterUndo = T.arrowsOf().length; const chAfterUndo = K.atoms['PNP:O1'].charge; T.history.forward(); T.history.forward();
  return { before, lp, ch1, ch2, after: after.map(x => x.text + ' side ' + x.side), undone: [u1, u2, arrowsAfterUndo, chAfterUndo], last: T.arrowsOf().length };
});
log('authoring', auth);
// timing, duplicate, reorder, camera
const kf = await p.evaluate(() => {
  const T = window.TriadSketch; const E = T.classicEngine(); const t0 = E.TL.total;
  T.setKeyTiming(0, 2, 3); const t1 = E.TL.total; T.duplicateKey(1); const n = T.scene.keyframes.length; const names = T.keyframes().map(k => k.name);
  T.moveKey(2, 0); const names2 = T.keyframes().map(k => k.name); T.history.back(); T.history.back(); const names3 = T.keyframes().map(k => k.name);
  T.camera.yaw = 10; T.camera.pitch = 5; T.setKeyView(0, true); T.camera.yaw = 100; T.camera.pitch = -20; T.setKeyView(2, true);
  const hold0 = E.TL.segs.find(s => s.kf === 0 && s.type === 'hold'), tr1 = E.TL.segs.find(s => s.kf === 1 && s.type === 'trans');
  const vs = [hold0.start, tr1.start + Math.floor(tr1.len / 2), tr1.start + tr1.len].map(f => { T.seek(f); return [T.camera.yaw.toFixed(1), T.camera.pitch.toFixed(1)] });
  T.setKeyView(0, false); T.setKeyView(2, false); T.history.back(); T.history.back(); T.history.back(); T.history.back();
  return { t0, t1, n, names, names2, names3, vs, total: E.TL.total };
});
log('keyframes ops', kf);
// suggested views
const sv = await p.evaluate(async () => { const T = window.TriadSketch; const t0 = performance.now(); const picks = await T.suggest(() => { }); return { ms: (performance.now() - t0).toFixed(0), picks: picks.slice(0, 5).map(v => `${v.yaw}/${v.pitch}/${v.roll.toFixed(0)} ${v.score.toFixed(3)} ` + Object.entries(v.parts).map(([k, x]) => k[0] + x.toFixed(2)).join(' ')), thumbs: picks.every(v => v.canvas && v.canvas.width > 0) } });
log('suggest', sv);
await p.evaluate(() => { const T = window.TriadSketch; T.adoptView({ yaw: 175, pitch: -20, roll: 96 }) });
// render with each codec at a small size
const support = await p.evaluate(async () => { const m = await import('/src/app/encode.ts'); return m.codecSupport(640, 360) });
log('codecs', support);
for (const codec of ['av1', 'vp9', 'h264']) {
  if (!support[codec]) { log('render ' + codec, 'unsupported here'); continue }
  const dl = p.waitForEvent('download', { timeout: 300000 });
  const r = await p.evaluate(async c => { const T = window.TriadSketch; const t0 = performance.now(); const r = await T.renderToFile({ width: 640, height: 360, codec: c, quality: 'small', onProgress: () => { } }); return { ...r, ms: (performance.now() - t0).toFixed(0) } }, codec);
  const d = await dl; const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); log('render ' + codec, { ...r, saved: f, size: fs.statSync(f).size });
}
console.log('errors:', errs.slice(0, 5));
await b.close();
