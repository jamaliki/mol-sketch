#!/usr/bin/env node
/* Triad Sketch command-line renderer.
   Runs the same page headlessly and writes PNG or SVG frames.

   node render.js input [input …] [options]
     input            scene .json, or one or more .pdb / .cif files (sorted by name → one keyframe each)
     --out DIR        output folder (default ./out)
     --format png|svg (default png)
     --scale N        raster scale, 1–4 (default 2)
     --size WxH       canvas size in px (default 960x720)
     --frames SPEC    all (default) | drawn (one per stroke boil, no duplicates) | keyframes | N | A-B
     --settings F     settings JSON saved from the page (Data › Save settings)
     --set path=val   override any setting, repeatable. cfg paths: rep.fill=watercolour view.yaw=30 style.wash=0.4 show.labels=false
                      scene paths: reps.cartoon=polymer reps.surface="polymer" reps.sticks=hetatm groupColors.HIS57=#7cbf72
     --turntable N    render N frames of a full 360° yaw rotation (sets view.spin; use --set view.pitchSwing=15 to nod)
     --list           print the timeline and exit
*/
const path=require('path'),fs=require('fs');
const argv=process.argv.slice(2);const inputs=[];const opt={out:'out',format:'png',scale:2,size:'960x720',frames:'all',set:[]};
for(let i=0;i<argv.length;i++){const a=argv[i];
  if(a==='--out')opt.out=argv[++i];else if(a==='--format')opt.format=argv[++i];else if(a==='--scale')opt.scale=+argv[++i];else if(a==='--size')opt.size=argv[++i];
  else if(a==='--frames')opt.frames=argv[++i];else if(a==='--settings')opt.settings=argv[++i];else if(a==='--set')opt.set.push(argv[++i]);else if(a==='--list')opt.list=true;else if(a==='--turntable')opt.turntable=+argv[++i];
  else if(a==='--help'||a==='-h'){console.log(fs.readFileSync(__filename,'utf8').split('*/')[0].replace('/*',''));process.exit(0)}
  else inputs.push(a)}
if(!inputs.length){console.error('No input. Try: node render.js examples/test_protein.pdb --set rep.fill=watercolour');process.exit(1)}
(async()=>{
  let chromium;try{({chromium}=require('playwright'))}catch(e){console.error('Install playwright first:  npm install');process.exit(1)}
  const html=fs.readFileSync(path.join(__dirname,'triad-sketch.html'),'utf8');
  const wrapped='<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+'</body></html>';
  const tmp=path.join(__dirname,'.triad-sketch.tmp.html');fs.writeFileSync(tmp,wrapped);
  const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:900}});
  page.on('pageerror',e=>console.error('page error:',e.message));
  await page.goto('file://'+tmp);await page.waitForTimeout(600);
  // fonts: give Google Fonts a moment if the machine is online
  try{await page.evaluate(()=>document.fonts.ready)}catch(e){}
  // inputs
  const jsons=inputs.filter(f=>/\.json$/i.test(f)),structs=inputs.filter(f=>!/\.json$/i.test(f));
  await page.evaluate(()=>{try{localStorage.clear()}catch(e){}});
  if(jsons.length){const sc=JSON.parse(fs.readFileSync(jsons[0],'utf8'));await page.evaluate(sc=>{TriadSketch.scene=sc},sc)}
  if(structs.length){const files=structs.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(f=>({name:path.basename(f),text:fs.readFileSync(f,'utf8')}));
    await page.evaluate(files=>{TriadSketch.loadPdbTexts(files)},files)}
  if(opt.settings){const st=JSON.parse(fs.readFileSync(opt.settings,'utf8'));await page.evaluate(st=>{const c=TriadSketch.cfg;TriadSketch.cfg={...c,...st,view:{...c.view,...st.view},style:{...c.style,...st.style},show:{...c.show,...st.show},palette:{...c.palette,...st.palette},rep:{...c.rep,...(st.rep||{})}}},st)}
  const [W,H]=opt.size.split('x').map(Number);await page.evaluate(([w,h])=>TriadSketch.setCanvasSize(w,h),[W,H]);
  for(const kv of opt.set){const i=kv.indexOf('=');const k=kv.slice(0,i),raw=kv.slice(i+1);let v=raw;if(raw==='true')v=true;else if(raw==='false')v=false;else if(raw!==''&&!isNaN(+raw))v=+raw;
    await page.evaluate(([k,v])=>{const parts=k.split('.');const target=(parts[0]==='reps'||parts[0]==='groupColors'||parts[0]==='view'&&false)?TriadSketch.scene:TriadSketch.cfg;let o=target;for(let i=0;i<parts.length-1;i++){o[parts[i]]=o[parts[i]]||{};o=o[parts[i]]}o[parts[parts.length-1]]=v;TriadSketch.buildPanel();TriadSketch.rebuild();TriadSketch.redraw()},[k,v])}
  if(opt.turntable){await page.evaluate(n=>{const c=TriadSketch.cfg;c.view.spin=360*c.fps/n;TriadSketch.redraw()},opt.turntable);if(opt.frames==='all')opt.frames='0-'+(opt.turntable-1)}
  const info=await page.evaluate(()=>({total:TriadSketch.TL.total,step:Math.max(1,TriadSketch.cfg.stepEvery),segs:TriadSketch.TL.segs.map(s=>({kf:s.kf,type:s.type,start:s.start,len:s.len,name:TriadSketch.scene.keyframes[s.kf].name}))}));
  if(opt.list){console.log(JSON.stringify(info,null,1));await browser.close();fs.unlinkSync(tmp);return}
  let frames=[];const spec=opt.frames;
  if(spec==='all')for(let f=0;f<info.total;f++)frames.push(f);
  else if(spec==='drawn')for(let f=0;f<info.total;f+=info.step)frames.push(f);
  else if(spec==='keyframes'){const seen=new Set();for(const s of info.segs)if(s.type==='hold'&&!seen.has(s.kf)){seen.add(s.kf);frames.push(s.start)}}
  else if(/^\d+-\d+$/.test(spec)){const [a,b]=spec.split('-').map(Number);for(let f=a;f<=b;f++)frames.push(f)}
  else frames=[+spec];
  fs.mkdirSync(opt.out,{recursive:true});
  const t0=Date.now();let n=0;
  for(const f of frames){
    if(opt.format==='svg'){const svg=await page.evaluate(([f,s])=>TriadSketch.renderSVG(f,s),[f,opt.scale]);fs.writeFileSync(path.join(opt.out,`frame_${String(f).padStart(4,'0')}.svg`),svg)}
    else{const data=await page.evaluate(([f,s])=>{const c=document.createElement('canvas');c.width=TriadSketch.CW()*s;c.height=TriadSketch.CH()*s;const x=c.getContext('2d');TriadSketch.renderFrame(x,TriadSketch.CW(),TriadSketch.CH(),f,s);return c.toDataURL('image/png')},[f,opt.scale]);
      fs.writeFileSync(path.join(opt.out,`frame_${String(f).padStart(4,'0')}.png`),Buffer.from(data.split(',')[1],'base64'))}
    n++;if(n%10===0||n===frames.length)process.stdout.write(`\r${n}/${frames.length} frames  ${((Date.now()-t0)/1000).toFixed(1)}s`)}
  process.stdout.write('\n');
  const fps=await page.evaluate(()=>TriadSketch.cfg.fps);
  if(opt.format==='png')console.log(`Assemble:  ffmpeg -framerate ${fps} -pattern_type glob -i '${opt.out}/frame_*.png' -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`);
  await browser.close();fs.unlinkSync(tmp);
})();
