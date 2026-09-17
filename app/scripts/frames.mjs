// stills of a scene at given frames: node scripts/frames.mjs scene.json look outdir "[28,118]" [W H zoom]
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path'; import http from 'http';
const dist=path.resolve('dist'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(dist,p);if(!fs.existsSync(f)){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const [scenePath,look,out,framesJson,W='1000',H='750',zoom='1',setsJson='{}']=process.argv.slice(2);
const p=await b.newPage({viewport:{width:+W+300,height:+H}}); await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(()=>window.TriadSketch);await p.waitForFunction(()=>window.TriadSketch.renderer.structure,null,{timeout:30000}).catch(()=>{}); // let the start-up example land first, or it would replace ours
const scene=fs.readFileSync(scenePath,'utf8');
await p.evaluate(async([t,k,W,H,zoom,sets])=>{const T=window.TriadSketch;T.setLive(false);T.setSketch(false);await T.loadText(t,'scene.json');T.applyLook(k);const st=JSON.parse(JSON.stringify(T.style));st.show.caption=false;st.show.stepLabel=false;st.show.labels=false;for(const [kk,v] of Object.entries(sets)){let o=st;const ks=kk.split('.');for(let j=0;j<ks.length-1;j++)o=o[ks[j]];o[ks[ks.length-1]]=v}T.style=st;T.setSize(+W,+H);if(zoom!=='keep')T.camera.zoom=+zoom},[scene,look,W,H,zoom,JSON.parse(setsJson)]);
fs.mkdirSync(out,{recursive:true});
for(const f of JSON.parse(framesJson)){const png=await p.evaluate(f=>{const T=window.TriadSketch;T.seek(f);T.classic(f);return T.png()},f);fs.writeFileSync(path.join(out,`f_${String(f).padStart(4,'0')}.png`),Buffer.from(png.split(',')[1],'base64'))}
await b.close(); server.close();
