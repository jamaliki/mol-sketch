// render state-0 stills of the CALB scene over a grid of camera angles, one browser session
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path'; import http from 'http';
const dist=path.resolve('dist'); const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(dist,p);if(!fs.existsSync(f)){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1000,height:700}}); await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(()=>window.MolSketch);await p.waitForFunction(()=>window.MolSketch.renderer.structure,null,{timeout:30000}).catch(()=>{}); // let the start-up example land first, or it would replace ours
const scene=fs.readFileSync(process.argv[2],'utf8'); const frame=+process.argv[3]; const out=process.argv[4]; const look=process.argv[5]||'dark-paper';
await p.evaluate(async([t,k])=>{const T=window.MolSketch;T.setLive(false);T.setSketch(false);await T.loadText(t,'calb.json');T.applyLook(k);const st=JSON.parse(JSON.stringify(T.style));st.show.caption=false;st.show.stepLabel=false;st.show.labels=false;T.style=st;T.setSize(800,500);T.camera.zoom=1.0},[scene,look]);
fs.mkdirSync(out,{recursive:true});
const views=JSON.parse(process.argv[6]||'null')||[];
for(const [yaw,pitch] of views){const png=await p.evaluate(([y,pi,f])=>{const T=window.MolSketch;T.camera.yaw=y;T.camera.pitch=pi;T.seek(f);T.classic(f);return T.png()},[yaw,pitch,frame]);fs.writeFileSync(path.join(out,`v_${yaw}_${pitch}.png`),Buffer.from(png.split(',')[1],'base64'))}
await b.close(); server.close();
