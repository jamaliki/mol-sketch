/* The classic engine: MolSketch's canvas renderer, and the reference look. It is the only copy: the app draws with it
   in the browser, and the Python package (python/molsketch/_core.js, built from app/src/headless) draws with it
   headless. Everything here is plain JavaScript; the app talks to it through createClassic(). */
export function createClassic(){
/* ============================ utilities ============================ */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const lerp3=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const easeOut=t=>{t=clamp(t,0,1);return 1-Math.pow(1-t,3)};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function strHash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h}
class Noise1{constructor(rng,n=48){this.v=[];for(let i=0;i<n;i++)this.v.push(rng()*2-1);this.n=n}
  at(t){const i=Math.floor(t),f=t-i,a=this.v[((i%this.n)+this.n)%this.n],b=this.v[(((i+1)%this.n)+this.n)%this.n];const u=(1-Math.cos(f*Math.PI))/2;return a*(1-u)+b*u}}
const RGBC=new Map(),MIXC=new Map();   // parsed and mixed colours: a drawing asks for the same few thousands of times
function hexToRgb(h){let v=RGBC.get(h);if(v)return v;let x=h.replace('#','');if(x.length===3)x=x.split('').map(c=>c+c).join('');const n=parseInt(x,16);v=[(n>>16)&255,(n>>8)&255,n&255];if(RGBC.size>4096)RGBC.clear();RGBC.set(h,v);return v}
function rgba(h,a){const[r,g,b]=hexToRgb(h);return`rgba(${r},${g},${b},${a})`}
function mix(h1,h2,t){let m1=MIXC.get(h1);if(!m1)MIXC.set(h1,m1=new Map());let m2=m1.get(h2);if(!m2)m1.set(h2,m2=new Map());let r=m2.get(t);if(r!==undefined)return r;   // keyed by value: no strings built to look one up
  const a=hexToRgb(h1),b=hexToRgb(h2);r='#'+hx2(Math.round(lerp(a[0],b[0],t)))+hx2(Math.round(lerp(a[1],b[1],t)))+hx2(Math.round(lerp(a[2],b[2],t)));if(m2.size>4096)m2.clear();m2.set(t,r);return r}
const HEX2=[];for(let i=0;i<256;i++)HEX2.push(i.toString(16).padStart(2,'0'));
const hx2=v=>v>=0&&v<256?HEX2[v]:v.toString(16).padStart(2,'0');   // (a mix beyond its colours, t outside 0..1, as it always was)
function luminance(h){const[r,g,b]=hexToRgb(h);return(0.2126*r+0.7152*g+0.0722*b)/255}

/* ============================ config ============================ */
const SS_COLS={helix:'#e0524a',sheet:'#f2d94a',loop:'#6fbf6a',nucleic:'#e0a23a',surface:'#cfd8e0',wash:'#d1a35b'};
const PRESETS={
  'PyMOL flat':{paper:'#faf8f3',ink:'#1e1e1e',hatch:'#2a2a2a',arrow:'#d23b2f',charge:'#1e1e1e',label:'#1e1e1e',context:'#cfcac0',accent:'#f2e85a',C:'#8f8f8f',N:'#3a6ee0',O:'#e04848',H:'#e8e8e8',S:'#e5cf3b',P:'#f09a3e',X:'#b48fd8',...SS_COLS,wash:'#7fb2c9'},
  'Colored pencil':{paper:'#f3ecd9',ink:'#2b2a28',hatch:'#3a3632',arrow:'#c2453a',charge:'#2b2a28',label:'#5b4636',context:'#c9b99a',accent:'#d98c2c',C:'#6b6660',N:'#3f5fa8',O:'#c94b3c',H:'#f7f3ea',S:'#c9a227',P:'#d97b2a',X:'#8a7d9a',wash:'#d1a35b'},
  'Ink + one color':{paper:'#f6f2e8',ink:'#1f1d1b',hatch:'#1f1d1b',arrow:'#b8322a',charge:'#1f1d1b',label:'#1f1d1b',context:'#b9b2a4',accent:'#b8322a',C:'#f6f2e8',N:'#f6f2e8',O:'#f6f2e8',H:'#f6f2e8',S:'#f6f2e8',P:'#f6f2e8',X:'#f6f2e8'},
  'Blueprint':{paper:'#1d3f6e',ink:'#e8eef7',hatch:'#e8eef7',arrow:'#ffd166',charge:'#e8eef7',label:'#cfe0f5',context:'#5a7fb3',accent:'#ffd166',C:'#7f9fc9',N:'#9cc7ff',O:'#ff9e8f',H:'#e8eef7',S:'#ffd166',P:'#ffb072',X:'#c9a7ff'},
  'Chalkboard':{paper:'#2c3a32',ink:'#f1ede4',hatch:'#f1ede4',arrow:'#ffb86b',charge:'#f1ede4',label:'#d8e3d5',context:'#4f6356',accent:'#ffb86b',C:'#c8c4b8',N:'#8fb8ff',O:'#ff8c7a',H:'#f1ede4',S:'#f2d36b',P:'#ffb072',X:'#c9a7ff'},
  'Sepia wash':{paper:'#efe3c8',ink:'#4a3728',hatch:'#5a4632',arrow:'#8a2f22',charge:'#4a3728',label:'#5a4632',context:'#d3c19c',accent:'#a5581f',C:'#8c7a62',N:'#5f6f8c',O:'#a5482e',H:'#f5ecd8',S:'#b8922e',P:'#b06a2a',X:'#8a7d9a',helix:'#a5482e',sheet:'#c9a13a',loop:'#7a8a5a',surface:'#d8cdb0'}
};
for(const k in PRESETS)for(const c in SS_COLS)if(!PRESETS[k][c])PRESETS[k][c]=SS_COLS[c];
const DEFAULT_CFG={
  fps:24, stepEvery:2, boilEvery:2, arrowLead:0.2,
  view:{yaw:-18,pitch:14,zoom:1,panX:0,panY:0,fov:20,fog:0.5,fogStart:0.45,spin:0,pitchSwing:0},
  style:{rough:1.1,passes:2,pressure:0.55,fillWobble:1,hatchDensity:1.4,hierarchy:0.6,wash:0.3,washSeed:1,washLife:0.6,inkWidth:1.5,ballScale:1,bondWidth:2.1,hatchSpacing:5,hatchAngle:-40,lightAngle:-125,shading:0.65,pencilFill:0.55,grain:0.6,font:'Caveat',labelSize:19,captionSize:24,contextAlpha:0.5,annot:1},
  show:{H:true,lonePairs:true,charges:true,arrows:true,labels:true,hbonds:true,context:false,caption:true,stepLabel:true,colorBonds:false,resLabels:false,valence:true,construction:false},
  palette:{...PRESETS['PyMOL flat']},
  rep:{detail:'auto',textureScale:'screen',mode:'sticks',fill:'flat',colorBy:'group',stickRadius:0.2,sphereScale:0.4,sideChainHelper:true,cartoonScale:1,cartoonColor:'ss',cartoonStyle:'sketch',engraveLines:8,engraveWidth:0.45,strandThickness:0.6,coilWidth:1.25,ssLabels:false,probe:1.4,surfaceScale:1,surfaceOpacity:1,surfaceColor:'carbon',surfEdges:1,surfPool:1,surfFade:1},
  pdbFrames:2
};
let cfg=JSON.parse(JSON.stringify(DEFAULT_CFG));

function migrateCfg(){const v=cfg.view;if(v.fov===undefined)v.fov=v.perspective!==undefined?Math.round(8+v.perspective*40):20;if(v.fogStart===undefined)v.fogStart=0.45;if(v.spin===undefined)v.spin=0;if(v.roll===undefined)v.roll=0;if(v.pitchSwing===undefined)v.pitchSwing=0;delete v.perspective;delete v.depthGain;if(cfg.style.pressure===undefined)cfg.style.pressure=0.55;if(cfg.style.fillWobble===undefined)cfg.style.fillWobble=1;if(cfg.style.hatchDensity===undefined)cfg.style.hatchDensity=1.4;if(cfg.style.hierarchy===undefined)cfg.style.hierarchy=0.6;if(cfg.style.wash===undefined)cfg.style.wash=0.3;if(cfg.style.washSeed===undefined)cfg.style.washSeed=1;if(cfg.style.washLife===undefined)cfg.style.washLife=0.6;if(!cfg.palette.nucleic)cfg.palette.nucleic='#e0a23a';if(!cfg.palette.wash||cfg.palette.wash==='#c9b48a'||cfg.palette.wash==='#c9a97a'||cfg.palette.wash==='#c7d0d8')cfg.palette.wash=cfg.palette.paper&&luminance(cfg.palette.paper)>0.9?'#7fb2c9':'#d1a35b';if(cfg.show.construction===undefined)cfg.show.construction=false}
migrateCfg();
function saveCfg(){}

const EL_R={H:0.25,C:0.42,N:0.42,O:0.44,S:0.52,P:0.52};
const COV_R={H:0.31,C:0.76,N:0.71,O:0.66,S:1.05,P:1.07,F:0.57,CL:1.02,BR:1.2,I:1.39,SE:1.2,ZN:1.22,MG:1.41,CA:1.76,FE:1.32,NA:1.66,K:2.03};

/* ============================ demo scene ============================ */
function demoScene(){
  // planar textbook layout (x right, y up, z toward the viewer); geometry is schematic, not crystallographic
  const his={ND1:{el:'N',pos:[-2.58,-1.89,0.3]},CE1:{el:'C',pos:[-1.46,-2.65,0.3]},NE2:{el:'N',pos:[-0.39,-1.82,0.3],lp:[[1,-0.3,0]]},CD2:{el:'C',pos:[-0.86,-0.55,0.3]},CG:{el:'C',pos:[-2.21,-0.59,0.3]},HD1:{el:'H',pos:[-3.47,-2.21,0.3]},CBH:{el:'C',pos:[-2.9,0.7,0.2],label:'His57',labelDir:[-1,0.4]}};
  const asp={OD1:{el:'O',pos:[-5.15,-2.8,0.2],lp:[[0.9,0.4,0]]},CGD:{el:'C',pos:[-6.0,-3.6,0.0]},OD2:{el:'O',pos:[-6.9,-2.9,-0.2]},CBD:{el:'C',pos:[-6.4,-5.0,-0.1],label:'Asp102',labelDir:[-0.3,1]}};
  const hole={N193:{el:'N',pos:[1.6,4.1,0.6],label:'Gly193',labelDir:[-1,0.1]},H193:{el:'H',pos:[2.1,3.25,0.55]},N195:{el:'N',pos:[4.1,4.1,0.7],label:'Ser195 N–H',labelDir:[1,0.1]},H195:{el:'H',pos:[3.7,3.25,0.6]}};
  const serDown={OG:{el:'O',pos:[2.6,-2.5,0.2],lp:[[-0.3,1,0]]},HG:{el:'H',pos:[1.6,-2.3,0.25]},CB:{el:'C',pos:[3.3,-3.7,0.0],label:'Ser195',labelDir:[0.4,1]}};
  const serUp={OG:{el:'O',pos:[3.1,-0.85,0.3]},CB:{el:'C',pos:[3.5,-2.2,0.1],label:'Ser195',labelDir:[0.4,1]}};
  const ringBonds=[['NE2','CE1',1],['CE1','ND1',2],['ND1','CG',1],['CG','CD2',2],['CD2','NE2',1],['CG','CBH',1],['ND1','HD1',1],['HD1','OD1',0],['OD1','CGD',1],['CGD','OD2',2],['CGD','CBD',1]];
  const holeBonds=[['N193','H193',1],['N195','H195',1]];
  const sub0={CA1:{el:'C',pos:[2.2,-0.2,0.5],label:'R',labelDir:[-1,-0.2]},C1:{el:'C',pos:[3.4,0.6,0.4]},O1:{el:'O',pos:[2.9,1.7,0.5]},N2:{el:'N',pos:[4.7,0.25,0.3],lp:[[0.2,-1,0]]},HN2:{el:'H',pos:[5.0,-0.7,0.2]},CA2:{el:'C',pos:[5.7,1.2,0.2],label:'R′',labelDir:[1,0.2]}};
  const K=[];
  K.push({name:'Michaelis complex',caption:'Substrate bound. Ser195 O–H is aimed at the carbonyl carbon; His57 stands ready to take the proton.',hold:30,transition:60,
    atoms:{...sub0,...serDown,...his,...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',2],['C1','N2',1],['N2','HN2',1],['N2','CA2',1],['OG','HG',1],['OG','CB',1],['HG','NE2',0],['H193','O1',0],['H195','O1',0],...ringBonds,...holeBonds],
    arrows:[{from:{lp:'NE2',i:0},to:{bond:['OG','HG']},bulge:0.35,side:1},{from:{bond:['OG','HG']},to:{atom:'C1'},bulge:0.35,side:-1},{from:{bond:['C1','O1']},to:{atom:'O1'},bulge:0.5,side:-1}]});
  K.push({name:'Tetrahedral intermediate 1',caption:'Oxyanion forms and is held by the backbone N–H of Gly193 and Ser195. His57 is now protonated.',hold:30,transition:60,
    atoms:{CA1:{el:'C',pos:[2.1,-0.3,0.5],label:'R',labelDir:[-1,-0.2]},C1:{el:'C',pos:[3.4,0.6,0.4]},O1:{el:'O',pos:[2.8,1.8,0.5],charge:-1,lp:[[-0.6,0.8,0]]},N2:{el:'N',pos:[4.8,0.15,0.3],lp:[[0.2,-1,0]]},HN2:{el:'H',pos:[5.1,-0.8,0.2]},CA2:{el:'C',pos:[5.8,1.1,0.2],label:'R′',labelDir:[1,0.2]},
      ...serUp,HG:{el:'H',pos:[0.55,-2.0,0.3]},...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],charge:1},...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',1],['C1','N2',1],['C1','OG',1],['N2','HN2',1],['N2','CA2',1],['HG','NE2',1],['OG','CB',1],['H193','O1',0],['H195','O1',0],...ringBonds,...holeBonds],
    arrows:[{from:{lp:'O1',i:0},to:{bond:['C1','O1']},bulge:0.4,side:-1},{from:{bond:['C1','N2']},to:{atom:'N2'},bulge:0.45,side:-1},{from:{lp:'N2',i:0},to:{atom:'HG'},bulge:0.3,side:-1},{from:{bond:['HG','NE2']},to:{atom:'NE2'},bulge:0.4,side:1}]});
  K.push({name:'Acyl-enzyme',caption:'The C–N bond breaks. His57 hands its proton to the leaving amine; the acyl group stays on Ser195.',hold:30,transition:60,
    atoms:{CA1:{el:'C',pos:[2.2,-0.2,0.5],label:'R',labelDir:[-1,-0.2]},C1:{el:'C',pos:[3.4,0.6,0.4]},O1:{el:'O',pos:[2.9,1.7,0.5]},...serUp,
      N2:{el:'N',pos:[5.6,-1.3,0.2],exitTo:[8.2,-3.0,0.2]},HN2:{el:'H',pos:[5.8,-2.3,0.1],exitTo:[8.4,-4.0,0.1]},HG:{el:'H',pos:[4.7,-1.9,0.2],exitTo:[7.3,-3.6,0.2]},CA2:{el:'C',pos:[6.8,-0.6,0.1],label:'R′',labelDir:[1,0.2],exitTo:[9.4,-2.3,0.1]},
      ...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],lp:[[1,-0.3,0]]},...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',2],['C1','OG',1],['OG','CB',1],['N2','HN2',1],['N2','HG',1],['N2','CA2',1],['H193','O1',0],['H195','O1',0],...ringBonds,...holeBonds],arrows:[]});
  K.push({name:'Water binds',caption:'A water molecule takes the place of the amine, hydrogen-bonded to His57.',hold:30,transition:60,
    atoms:{CA1:{el:'C',pos:[2.2,-0.2,0.5],label:'R',labelDir:[-1,-0.2]},C1:{el:'C',pos:[3.4,0.6,0.4]},O1:{el:'O',pos:[2.9,1.7,0.5]},...serUp,
      OW:{el:'O',pos:[1.5,-1.0,0.6],lp:[[0.9,0.6,0]],enterFrom:[-1.5,-5.0,0.6],label:'H₂O',labelDir:[-0.8,-0.9]},HW1:{el:'H',pos:[0.72,-1.4,0.6],enterFrom:[-2.3,-5.4,0.6]},HW2:{el:'H',pos:[1.05,-0.15,0.7],enterFrom:[-1.95,-4.15,0.7]},
      ...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],lp:[[1,-0.3,0]]},...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',2],['C1','OG',1],['OG','CB',1],['OW','HW1',1],['OW','HW2',1],['HW1','NE2',0],['H193','O1',0],['H195','O1',0],...ringBonds,...holeBonds],
    arrows:[{from:{lp:'NE2',i:0},to:{bond:['OW','HW1']},bulge:0.35,side:1},{from:{lp:'OW',i:0},to:{atom:'C1'},bulge:0.35,side:-1},{from:{bond:['C1','O1']},to:{atom:'O1'},bulge:0.5,side:-1}]});
  K.push({name:'Tetrahedral intermediate 2',caption:'Water attacks the acyl carbon. The oxyanion re-forms in the hole; His57 is protonated again.',hold:30,transition:60,
    atoms:{CA1:{el:'C',pos:[2.1,-0.3,0.5],label:'R',labelDir:[-1,-0.2]},C1:{el:'C',pos:[3.4,0.6,0.4]},O1:{el:'O',pos:[2.8,1.8,0.5],charge:-1,lp:[[-0.6,0.8,0]]},...serUp,OG:{el:'O',pos:[3.1,-0.85,0.3],lp:[[-1,-0.2,0]]},
      OW:{el:'O',pos:[2.2,-0.2,0.5]},HW1:{el:'H',pos:[0.55,-2.0,0.3]},HW2:{el:'H',pos:[1.5,-0.9,0.5]},
      ...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],charge:1},...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',1],['C1','OG',1],['C1','OW',1],['OG','CB',1],['OW','HW2',1],['HW1','NE2',1],['H193','O1',0],['H195','O1',0],...ringBonds,...holeBonds],
    arrows:[{from:{lp:'O1',i:0},to:{bond:['C1','O1']},bulge:0.4,side:-1},{from:{bond:['C1','OG']},to:{atom:'OG'},bulge:0.45,side:1},{from:{lp:'OG',i:0},to:{atom:'HW1'},bulge:0.3,side:1},{from:{bond:['HW1','NE2']},to:{atom:'NE2'},bulge:0.4,side:1}]});
  K.push({name:'Product release',caption:'Ser195 takes its proton back from His57 and lets go. The carboxylic acid leaves.',hold:30,transition:60,
    atoms:{CA1:{el:'C',pos:[3.4,1.4,0.5],label:'R',labelDir:[1,0.2],exitTo:[6.0,5.0,0.5]},C1:{el:'C',pos:[2.4,2.0,0.4],exitTo:[5.0,5.6,0.4]},O1:{el:'O',pos:[2.0,3.1,0.5],exitTo:[4.6,6.7,0.5]},OW:{el:'O',pos:[1.5,1.2,0.5],exitTo:[4.1,4.8,0.5]},HW2:{el:'H',pos:[0.7,1.6,0.5],exitTo:[3.3,5.2,0.5]},
      ...serDown,HW1:{el:'H',pos:[1.6,-2.3,0.25]},
      ...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],lp:[[1,-0.3,0]]},...asp,...hole},
    bonds:[['CA1','C1',1],['C1','O1',2],['C1','OW',1],['OW','HW2',1],['OG','HW1',1],['OG','CB',1],['HW1','NE2',0],...ringBonds,...holeBonds],arrows:[]});
  K.push({name:'Free enzyme',caption:'The triad is restored: Ser–H···His···Asp. Ready for the next substrate.',hold:36,transition:48,
    atoms:{...serDown,HW1:{el:'H',pos:[1.6,-2.3,0.25]},...his,NE2:{el:'N',pos:[-0.39,-1.82,0.3],lp:[[1,-0.3,0]]},...asp,...hole},
    bonds:[['OG','HW1',1],['OG','CB',1],['HW1','NE2',0],...ringBonds,...holeBonds],arrows:[]});
  delete K[5].atoms.HG;delete K[6].atoms.HG;
  for(const id of Object.keys(sub0)){K[0].atoms[id]={...K[0].atoms[id],enterFrom:[sub0[id].pos[0]+3.0,sub0[id].pos[1]+3.6,sub0[id].pos[2]]}}
  const RES={CA1:['SUB',1,1],C1:['SUB',1,1],O1:['SUB',1,1],N2:['SUB',1,1],HN2:['SUB',1,1],CA2:['SUB',1,1],OG:['SER',195],HG:['SER',195],CB:['SER',195],N195:['SER',195],H195:['SER',195],N193:['GLY',193],H193:['GLY',193],
    NE2:['HIS',57],CE1:['HIS',57],ND1:['HIS',57],CG:['HIS',57],CD2:['HIS',57],HD1:['HIS',57],CBH:['HIS',57],OD1:['ASP',102],CGD:['ASP',102],OD2:['ASP',102],CBD:['ASP',102],OW:['HOH',300,1],HW1:['HOH',300,1],HW2:['HOH',300,1]};
  const SPH=new Set(['CB','CBH','CBD','CA1','CA2']);
  for(const k of K)for(const id in k.atoms){const a=k.atoms[id]={...k.atoms[id]};const r=RES[id]||['UNK',0];a.resn=r[0];a.resi=r[1];a.het=!!r[2];a.name=id;a.group=r[0]+r[1];if(SPH.has(id))a.sphere=true}
  return {name:'Serine hydrolase mechanism (schematic geometry)',reps:{sticks:'all',cartoon:'',surface:''},groupColors:{SER195:'#f2e85a',HIS57:'#7cbf72',ASP102:'#5fc9c9',GLY193:'#a0a0a0',SUB1:'#8f8f8f',HOH300:'#8f8f8f'},view:{yaw:0,pitch:0,zoom:1,panX:0,panY:0,fov:25,fog:0.3,fogStart:0.4},keyframes:K};
}
/* ============================ timeline & interpolation ============================ */
let scene=demoScene();
let TL={segs:[],total:0};
function buildTimeline(){
  const segs=[];let f=0;const n=scene.keyframes.length;
  scene.keyframes.forEach((k,i)=>{
    const hold=Math.max(0,k.hold??24),tr=Math.max(0,k.transition??48);
    if(hold>0)segs.push({kf:i,type:'hold',start:f,len:hold});f+=hold;
    const last=i===n-1;
    if(tr>0&&(!last||n>1))segs.push({kf:i,type:'trans',start:f,len:tr});if(tr>0&&(!last||n>1))f+=tr;
  });
  if(!segs.length)segs.push({kf:0,type:'hold',start:0,len:1}),f=1;
  TL={segs,total:f};
}
function locate(frame){
  frame=((frame%TL.total)+TL.total)%TL.total;
  for(const s of TL.segs){if(frame<s.start+s.len)return{seg:s,t:(frame-s.start)/s.len}}
  const s=TL.segs[TL.segs.length-1];return{seg:s,t:0.999};
}
const bkey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
function chargeText(c){if(c===undefined||c===null||c===0)return null;if(typeof c==='string')return c;if(c>0)return c===1?'+':'+'+c;return c===-1?'−':'−'+(-c)}

/* Return a fully resolved drawable state for a frame. */
/* Position along a keyframe's optional `path`: intermediate poses ({id:[x,y,z]} per step) between this keyframe and the next,
   walked piecewise-linearly at the eased motion parameter. Without a path (or for an atom the path does not carry) the motion is the straight line. */
function pathPos(K,id,p0,p1,t){const P=K.path;if(!P||!P.length||t<=0||t>=1)return lerp3(p0,p1,t);
  const n=P.length+1;const s=t*n;const i=Math.floor(s);const f=s-i;
  const at=k=>k<=0?p0:k>=n?p1:(P[k-1][id]||null);
  const q0=at(i),q1=at(i+1);if(!q0||!q1)return lerp3(p0,p1,t);return lerp3(q0,q1,f)}
// a structure (one keyframe, held, without arrows or a path) is in the same state at every frame: sampled once
let SAMPLED={k:null,rev:null,st:null};   // (the app counts a scene's edits in _rev: an edited keyframe is sampled again)
function sampleState(frame){
  const K=scene.keyframes.length===1?scene.keyframes[0]:null;
  if(K&&!(K.arrows&&K.arrows.length)&&!(K.path&&K.path.length)&&locate(frame).seg.type==='hold'){if(SAMPLED.k!==K||SAMPLED.rev!==scene._rev)SAMPLED={k:K,rev:scene._rev,st:sampleStateAt(frame)};return SAMPLED.st}
  return sampleStateAt(frame)}
function sampleStateAt(frame){
  const n=scene.keyframes.length;const {seg,t}=locate(frame);
  const Ki=scene.keyframes[seg.kf];
  const nextIdx=(seg.kf+1)%n;
  const Kj=scene.keyframes[nextIdx];
  const isTrans=seg.type==='trans';
  const lead=cfg.arrowLead;
  const hasHold=(Ki.hold??24)>0;
  // motion parameter
  let tm=0;
  if(isTrans)tm=smooth((t-lead)/(1-lead));
  // arrow phase: grow during last 40% of hold (if any), else early transition; fade after motion starts
  let arrowProg=0,arrowAlpha=0;
  if(Ki.arrows&&Ki.arrows.length){
    if(!isTrans){ if(hasHold){arrowProg=easeOut((t-0.55)/0.4);arrowAlpha=arrowProg>0?1:0} }
    else { if(hasHold){arrowProg=1}else{arrowProg=easeOut(t/Math.max(lead,0.05))}
      arrowAlpha=1-smooth((t-(lead+0.12))/0.28); }
  }
  /* Which atom of this keyframe is which atom of the next. By default an id matches itself. `asNext` renames an atom for the
     match only (a proton that changed owner and must be next cycle's HG), `leave` lists groups or ids that exit instead of
     matching (products going out while an identical substrate comes in). An entering atom whose id collides with a leaving
     one is keyed with a trailing "'" for this frame. `exitDir` / `enterDir` (Å) are the keyframe-wide defaults for atoms
     without their own exitTo / enterFrom. */
  const leave=new Set(Ki.leave||[]),alias=Ki.asNext||{};
  const leaving=id=>leave.size>0&&(leave.has(id)||(alias[id]===undefined&&leave.has(Ki.atoms[id].group||id.split(':')[0])));   // an aliased atom stays even if its group leaves
  const nextOf={},prevOf={};                         // Ki id → Kj id it becomes, and back
  if(isTrans)for(const id in Ki.atoms){if(leaving(id))continue;const n=alias[id]??id;if(Kj.atoms[n]&&!(n in prevOf)){nextOf[id]=n;prevOf[n]=id}}
  const inKey=n=>prevOf[n]?prevOf[n]:(Ki.atoms[n]?n+"'":n);   // the key an entering Kj atom gets in this frame
  const atoms=[];const A={};
  const addA=(a,b,id)=>{let o;
    if(a&&b){
      o={id,el:a.el||b.el,pos:pathPos(Ki,id,a.pos,b.pos,tm),alpha:lerp(a.opacity??1,b.opacity??1,tm),r:a.r??b.r,color:a.color??b.color,label:a.label??b.label,labelDir:a.labelDir??b.labelDir,labelAuto:a.labelAuto,charges:[],lps:[]};
      const ca=chargeText(a.charge),cb=chargeText(b.charge);
      if(ca&&ca===cb)o.charges.push({text:ca,alpha:1});else{if(ca)o.charges.push({text:ca,alpha:1-tm});if(cb)o.charges.push({text:cb,alpha:tm})}
      const la=a.lp||[],lb=b.lp||[];
      if(la.length===lb.length){la.forEach((d,i)=>o.lps.push({dir:lerp3(d,lb[i],tm),alpha:1}))}
      else{la.forEach(d=>o.lps.push({dir:d,alpha:1-tm}));lb.forEach(d=>o.lps.push({dir:d,alpha:tm}))}
    }else if(a){ // exiting (or holding)
      const to=a.exitTo||(Ki.exitDir?[a.pos[0]+Ki.exitDir[0],a.pos[1]+Ki.exitDir[1],a.pos[2]+Ki.exitDir[2]]:a.pos);
      o={id,el:a.el,pos:isTrans?lerp3(a.pos,to,tm):a.pos,alpha:(a.opacity??1)*(isTrans?1-tm:1),r:a.r,color:a.color,label:a.label,labelDir:a.labelDir,labelAuto:a.labelAuto,charges:[],lps:[]};
      const c=chargeText(a.charge);if(c)o.charges.push({text:c,alpha:1});(a.lp||[]).forEach(d=>o.lps.push({dir:d,alpha:1}));
    }else{ // entering
      const from=b.enterFrom||(Kj.enterDir?[b.pos[0]+Kj.enterDir[0],b.pos[1]+Kj.enterDir[1],b.pos[2]+Kj.enterDir[2]]:b.pos);
      o={id,el:b.el,pos:lerp3(from,b.pos,tm),alpha:(b.opacity??1)*tm,r:b.r,color:b.color,label:b.label,labelDir:b.labelDir,labelAuto:b.labelAuto,charges:[],lps:[]};
      const c=chargeText(b.charge);if(c)o.charges.push({text:c,alpha:1});(b.lp||[]).forEach(d=>o.lps.push({dir:d,alpha:1}));
    }
    o.el=(o.el||'C').toUpperCase();
    const src=a||b;o.resn=src.resn;o.resi=src.resi;o.chain=src.chain;o.name=src.name??id;o.het=src.het;o.group=src.group;o.ss=src.ss;o.sphere=src.sphere;o.trace=src.trace;o.nucleic=src.nucleic;o.entity=src.entity;o.subunit=src.subunit;
    atoms.push(o);A[id]=o};
  for(const id in Ki.atoms)addA(Ki.atoms[id],isTrans&&nextOf[id]?Kj.atoms[nextOf[id]]:undefined,id);
  if(isTrans)for(const n in Kj.atoms)if(!prevOf[n])addA(undefined,Kj.atoms[n],inKey(n));
  // bonds: Ki's by its ids, Kj's translated to this frame's keys
  const bonds=[];const Bi={},Bj={};
  const norm=b=>Array.isArray(b)?{a:b[0],b:b[1],order:b[2]??1}:{a:b.a,b:b.b,order:b.order??1};
  (Ki.bonds||[]).forEach(b=>{const o=norm(b);Bi[bkey(o.a,o.b)]=o});
  if(isTrans)(Kj.bonds||[]).forEach(b=>{const o=norm(b);o.a=inKey(o.a);o.b=inKey(o.b);Bj[bkey(o.a,o.b)]=o});
  const keys=new Set([...Object.keys(Bi),...Object.keys(Bj)]);
  for(const k of keys){
    const bi=Bi[k],bj=Bj[k];const src=bi||bj;if(!A[src.a]||!A[src.b])continue;
    const base=Math.min(A[src.a].alpha,A[src.b].alpha);
    if(bi&&bj){
      if(bi.order===bj.order)bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base,partial:0});
      else if(bi.order===0||bj.order===0){bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base*(1-tm),partial:0});bonds.push({a:bj.a,b:bj.b,order:bj.order,alpha:base*tm,partial:0})}
      else bonds.push({a:bi.a,b:bi.b,order:lerp(bi.order,bj.order,tm),alpha:base,partial:0});
    }else if(bi){ // a bond only in this keyframe: breaking (dotted) if one atom stays, but a molecule leaving whole keeps its bonds and just fades
      const whole=isTrans&&!nextOf[bi.a]&&!nextOf[bi.b];bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base,partial:isTrans&&!whole?(1-tm):0}) }
    else{ const whole=!nextOf[bj.a]&&!nextOf[bj.b];bonds.push({a:bj.a,b:bj.b,order:bj.order,alpha:base,partial:whole?0:tm}) }
  }
  // captions
  let capA=Ki.caption||'',capAa=1,capB='',capBa=0;
  if(isTrans){capAa=1-smooth((t-0.5)/0.22);capB=Kj.caption||'';capBa=smooth((t-0.76)/0.22)}
  return {atoms,A,bonds,arrows:(Ki.arrows||[]),arrowProg,arrowAlpha,kf:seg.kf,t,isTrans,captions:[{text:capA,alpha:capAa},{text:capB,alpha:capBa}],stepIdx:seg.kf,stepName:Ki.name||('step '+(seg.kf+1))};
}

/* ============================ projection ============================ */
let FIT={cx:0,cy:0,cz:0,rx:0,ry:0,spanX:10,spanY:10,zspan:4,key:''};
function rot3(p,cy,sy,cp,sp){const x=p[0]-FIT.cx,y=p[1]-FIT.cy,z=p[2]-FIT.cz;const x1=x*cy+z*sy,z1=-x*sy+z*cy;const y1=y*cp-z1*sp,z2=y*sp+z1*cp;if(!VIEW_ROLL)return[x1,y1,z2];const cr=Math.cos(VIEW_ROLL*Math.PI/180),sr=Math.sin(VIEW_ROLL*Math.PI/180);return[x1*cr-y1*sr,x1*sr+y1*cr,z2]} // yaw about y, pitch about x, then roll about the view axis
/** rot3's inverse: a point of the rotated, centred frame back to the scene's */
function unrot3(r,cy,sy,cp,sp){let x1=r[0],y1=r[1];const z2=r[2];if(VIEW_ROLL){const cr=Math.cos(VIEW_ROLL*Math.PI/180),sr=Math.sin(VIEW_ROLL*Math.PI/180);const a=x1*cr+y1*sr,b=-x1*sr+y1*cr;x1=a;y1=b}
  const y=y1*cp+z2*sp,z1=-y1*sp+z2*cp;const x=x1*cy-z1*sy,z=x1*sy+z1*cy;return[x+FIT.cx,y+FIT.cy,z+FIT.cz]}
let VIEW_YAW=0,VIEW_PITCH=0,VIEW_ROLL=0,VIEW_ZOOM=1,VIEW_PANX=0,VIEW_PANY=0; // the camera of the frame being drawn: cfg.view, or the interpolated keyframe views when the scene has them
let TEX=1; // texture scale for the frame: 1 = marks in screen pixels; with rep.textureScale 'object' they follow the drawing's scale, so the hatching stays the same relative to an atom however large or small it is on the page // effective angles for the frame being drawn (base + turntable)
function computeFit(){
  const spinning=cfg.view.spin!==0||cfg.view.pitchSwing!==0;
  const key=scene.keyframes.length+'|'+(spinning?'sphere':VIEW_YAW+'|'+VIEW_PITCH+'|'+VIEW_ROLL)+'|'+(scene._rev||0);
  if(FIT.key===key)return;
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],c=0;
  const fitPts=[];if(scene.fitPoints){const f=scene.fitPoints;for(let i=0;i<f.length;i+=3)fitPts.push([f[i],f[i+1],f[i+2]])}else{for(const k of scene.keyframes)for(const id in k.atoms)fitPts.push(k.atoms[id].pos)}
  for(const p of fitPts){for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}c++}
  if(!c){FIT={cx:0,cy:0,cz:0,rx:0,ry:0,spanX:10,spanY:10,zspan:4,key};return}
  FIT.cx=(mn[0]+mx[0])/2;FIT.cy=(mn[1]+mx[1])/2;FIT.cz=(mn[2]+mx[2])/2;
  const yaw=VIEW_YAW*Math.PI/180,pitch=VIEW_PITCH*Math.PI/180;const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  if(spinning){let R=0;for(const p of fitPts){R=Math.max(R,Math.hypot(p[0]-FIT.cx,p[1]-FIT.cy,p[2]-FIT.cz))}FIT.rx=0;FIT.ry=0;FIT.spanX=2*R;FIT.spanY=2*R;FIT.zspan=2*R;FIT.key=key;return}
  let rmn=[1e9,1e9,1e9],rmx=[-1e9,-1e9,-1e9];
  for(const p of fitPts){const r=rot3(p,cy,sy,cp,sp);for(let i=0;i<3;i++){rmn[i]=Math.min(rmn[i],r[i]);rmx[i]=Math.max(rmx[i],r[i])}}
  FIT.rx=(rmn[0]+rmx[0])/2;FIT.ry=(rmn[1]+rmx[1])/2;FIT.spanX=Math.max(rmx[0]-rmn[0],1);FIT.spanY=Math.max(rmx[1]-rmn[1],1);FIT.zspan=Math.max(rmx[2]-rmn[2],1);FIT.key=key;
}
function makeProjector(W,H){
  const yaw=VIEW_YAW*Math.PI/180,pitch=VIEW_PITCH*Math.PI/180;
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const capH=cfg.show.caption?H*0.13:0,topH=cfg.show.stepLabel?H*0.05:0;
  // PyMOL-style camera: distance D set by the field of view and the scene's half extent
  const fov=cfg.view.fov*Math.PI/180;const ext=Math.max(FIT.spanX,FIT.spanY)/2+1.5;
  const D=fov>0.002?ext/Math.tan(fov/2):Infinity;
  const dNear=D===Infinity?1:D/Math.max(D-FIT.zspan/2,D*0.3);
  const base=Math.min((W*0.9)/(FIT.spanX+2.6),(H-capH-topH-24)/(FIT.spanY+2.4))*VIEW_ZOOM/Math.pow(dNear,0.7);
  const ox=W/2-FIT.rx*base+VIEW_PANX*W,oy=(H-capH+topH)/2+FIT.ry*base+VIEW_PANY*H;
  const fs=clamp(cfg.view.fogStart,0,0.95);
  return {pxPerA:base,D,
    rot(p){return rot3(p,cy,sy,cp,sp)},
    proj(p){const r=this.rot(p);
      const d=D===Infinity?1:clamp(D/(D-r[2]),0.2,4);          // true perspective: near larger, far smaller
      const t=clamp(0.5-r[2]/(FIT.zspan+1e-6),0,1);            // 0 nearest … 1 farthest
      const fog=clamp((t-fs)/(1-fs),0,1);                       // fog begins at fogStart, like PyMOL's depth cue
      return{x:ox+(r[0]-FIT.rx)*base*d+FIT.rx*base,y:oy-((r[1]-FIT.ry)*base*d+FIT.ry*base),z:r[2],d,fog}},
    dir2(v){const r=this.rot([v[0]+FIT.cx,v[1]+FIT.cy,v[2]+FIT.cz]);return[r[0],-r[1]]},
    /** the point of the scene at screen (x, y) and view depth rz (the rotated frame's z): proj's inverse */
    unproj(x,y,rz){const d=D===Infinity?1:clamp(D/(D-rz),0.2,4);return unrot3([(x-ox-FIT.rx*base)/(base*d)+FIT.rx,(oy-y-FIT.ry*base)/(base*d)+FIT.ry,rz],cy,sy,cp,sp)},
    /** where the eye is, in the rotated frame (null: orthographic, looking down −z) */
    eye(){return D===Infinity?null:[FIT.rx,FIT.ry,D]}
  };
}

/* ============================ sketch primitives ============================ */
function resample(pts,step){
  const out=[pts[0]];let acc=0;
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);let s=step-acc;
    while(s<L){const u=s/L;out.push([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]);s+=step}
    acc=(L-(s-step))%step; if(i===pts.length-1)out.push(b)}
  return out;
}
/* Build the jittered passes of a stroke: each pass is a list of [x,y,w] with pen-pressure width. */
function sketchPasses(pts,o){
  if(pts.length<2)return[];
  const S=cfg.style;const rough=o.rough??S.rough,passes=o.passes??S.passes;
  const step=o.step===0?0:(o.step||4);const P=step?resample(pts,step):pts;
  let L=0;for(let i=1;i<P.length;i++)L+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);
  const w0=o.width??1.5,w1=o.widthEnd??w0;const pressure=o.pressure??S.pressure;
  const out=[];
  for(let p=0;p<passes;p++){
    const rng=mulberry32((o.seed|0)+p*7919+11);const nz=new Noise1(rng,24),nw=new Noise1(rng,16);
    const amp=rough*(p===0?1:1.25)*(o.ampScale??1);const bow=(rng()-0.5)*rough*1.2*(o.ampScale??1);
    const over=o.overshoot===false?0:rng()*rough*2.2;const ph=rng()*10;
    const q=[];let s=0;
    for(let i=0;i<P.length;i++){
      if(i>0)s+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);
      const u=L>0?s/L:0;
      let tx,ty;if(i<P.length-1){tx=P[i+1][0]-P[i][0];ty=P[i+1][1]-P[i][1]}else{tx=P[i][0]-P[i-1][0];ty=P[i][1]-P[i-1][1]}
      const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
      const off=amp*(nz.at(s*0.07+p*3)+0.35*(rng()-0.5))+bow*Math.sin(u*Math.PI);
      let x=P[i][0]-ty*off,y=P[i][1]+tx*off;
      if(i===0){x-=tx*over;y-=ty*over}else if(i===P.length-1){x+=tx*over*0.6;y+=ty*over*0.6}
      const wBase=lerp(w0,w1,u)*(p===0?1:0.72);
      const w=wBase*(1+pressure*(0.45*nw.at(s*0.045+ph)+0.15*(rng()-0.5)))*(pressure>0?(0.72+0.28*Math.sin(Math.min(1,Math.min(u,1-u)*6)*Math.PI/2)):1);
      q.push([x,y,Math.max(0.25,w)]);
    }
    out.push({pts:q,alpha:(o.alpha??1)*(p===0?1:0.55),width:w0*(p===0?1:0.72)});
  }
  return out;
}
/* Fill a variable-width stroke as one polygon with rounded ends. */
function fillVarStroke(ctx,q,color,alpha,i0,i1){
  i0=i0??0;i1=i1??q.length-1;if(i1-i0<1)return;
  const n=i1-i0+1;const nx=new Array(n),ny=new Array(n);
  for(let k=0;k<n;k++){const i=i0+k;const a=q[Math.max(i0,i-1)],b=q[Math.min(i1,i+1)];let tx=b[0]-a[0],ty=b[1]-a[1];const l=Math.hypot(tx,ty)||1;nx[k]=-ty/l;ny[k]=tx/l}
  ctx.beginPath();
  for(let k=0;k<n;k++){const p=q[i0+k],h=p[2]/2;const x=p[0]+nx[k]*h,y=p[1]+ny[k]*h;k?ctx.lineTo(x,y):ctx.moveTo(x,y)}
  // end cap
  {const p=q[i1],h=p[2]/2;const a0=Math.atan2(ny[n-1],nx[n-1]);for(let k=1;k<5;k++){const a=a0-Math.PI*k/5;ctx.lineTo(p[0]+Math.cos(a)*h,p[1]+Math.sin(a)*h)}}
  for(let k=n-1;k>=0;k--){const p=q[i0+k],h=p[2]/2;ctx.lineTo(p[0]-nx[k]*h,p[1]-ny[k]*h)}
  {const p=q[i0],h=p[2]/2;const a0=Math.atan2(-ny[0],-nx[0]);for(let k=1;k<5;k++){const a=a0-Math.PI*k/5;ctx.lineTo(p[0]+Math.cos(a)*h,p[1]+Math.sin(a)*h)}}
  ctx.closePath();ctx.fillStyle=rgba(color,alpha);ctx.fill();
}
function sketchLine(ctx,pts,o){
  const passes=sketchPasses(pts,o);const usePoly=(o.pressure??cfg.style.pressure)>0.02||o.widthEnd!==undefined;
  for(const ps of passes){
    if(usePoly){fillVarStroke(ctx,ps.pts,o.color,ps.alpha);continue}
    ctx.beginPath();ps.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=ps.width;ctx.strokeStyle=rgba(o.color,ps.alpha);ctx.stroke();
  }
}
function circlePts(cx,cy,r,seed,wob){
  const rng=mulberry32(seed);const nz=new Noise1(rng,12);const n=Math.max(28,Math.round(r*1.2));
  const a0=rng()*Math.PI*2;const pts=[];const extra=0.35;
  for(let i=0;i<=n;i++){const a=a0+(i/n)*(Math.PI*2+extra);const rr=r*(1+wob*nz.at(i/n*6))+wob*r*0.3*(rng()-0.5);pts.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr])}
  return pts;
}
function sketchCircle(ctx,cx,cy,r,o){
  const pts=circlePts(cx,cy,r,(o.seed|0)+5,clamp(cfg.style.rough*0.035,0,0.12)*(o.wobScale??1));
  sketchLine(ctx,pts,{...o,ampScale:0.7,overshoot:false});
}
/* Hatch inside a circle, optionally only where dot(p-c, L) < thr (shadow side). */
function hatchCircle(ctx,cx,cy,r,ang,spacing,o){
  const rng=mulberry32((o.seed|0)+33);
  const dx=Math.cos(ang),dy=Math.sin(ang);const nx=-dy,ny=dx; // hatch dir, normal
  const L=o.light;const thr=o.thr;
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r*0.985,0,Math.PI*2);ctx.clip();
  const jit=spacing*0.25;
  for(let d=-r+spacing*0.5+(rng()-0.5)*jit;d<r;d+=spacing+(rng()-0.5)*jit){
    const h=Math.sqrt(Math.max(0,r*r-d*d));
    let ax=cx+nx*d-dx*h,ay=cy+ny*d-dy*h,bx=cx+nx*d+dx*h,by=cy+ny*d+dy*h;
    if(L){ // keep sub-segment where dot(p-c,L)-thr<0
      const fa=(ax-cx)*L[0]+(ay-cy)*L[1]-thr,fb=(bx-cx)*L[0]+(by-cy)*L[1]-thr;
      if(fa>=0&&fb>=0)continue;
      if(fa>0||fb>0){const u=fa/(fa-fb);if(fa>0){ax=ax+(bx-ax)*u;ay=ay+(by-ay)*u}else{bx=ax+(bx-ax)*u;by=ay+(by-ay)*u}}
    }
    if(Math.hypot(bx-ax,by-ay)<1.5)continue;
    sketchLine(ctx,[[ax,ay],[bx,by]],{seed:(o.seed|0)+Math.round(d*13),passes:1,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,step:5,overshoot:false});
  }
  ctx.restore();
}
function elColor(a){const P=cfg.palette;if(a.color){return P[a.color]||a.color}return P[a.el]||P.X}
function drawBall(ctx,x,y,r,a,seed,lowDetail){
  const P=cfg.palette,S=cfg.style;const fog=a.fog||0;const fk=1-fog*cfg.view.fog;  // fk: 1 near … small far
  const col=fogged(elColor(a),fog),ink=fogged(P.ink,fog),hatch=fogged(P.hatch,fog);
  const la=S.lightAngle*Math.PI/180;const light=[Math.cos(la),Math.sin(la)];
  const isH=a.el==='H';const d=a.d||1;
  ctx.save();ctx.globalAlpha=a.alpha;
  // base: opaque paper then tint
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=P.paper;ctx.fill();
  ctx.fillStyle=rgba(col,(isH?0.35:0.22*S.pencilFill+0.06));ctx.fill();
  const hs=S.hatchSpacing*(1+fog*0.6)*Math.max(0.7,d);const ang=S.hatchAngle*Math.PI/180;
  if(!isH&&S.pencilFill>0&&!lowDetail){
    hatchCircle(ctx,x,y,r,ang+0.5,hs*0.85,{seed:seed+1,width:1.1*d,color:col,alpha:0.55*S.pencilFill*(0.4+0.6*fk)});
  }
  if(S.shading>0){
    hatchCircle(ctx,x,y,r,ang,hs,{seed:seed+2,width:(isH?0.8:1.0)*d,color:hatch,alpha:0.5*S.shading*(0.5+0.5*fk),light,thr:-r*0.05});
    if(!isH&&!lowDetail)hatchCircle(ctx,x,y,r,ang+1.1,hs*0.75,{seed:seed+3,width:0.9*d,color:hatch,alpha:0.45*S.shading*(0.5+0.5*fk),light,thr:-r*0.55});
  }
  // outline: lighter pressure for far atoms
  sketchCircle(ctx,x,y,r,{seed:seed+4,width:S.inkWidth*(isH?0.75:1)*d*(0.75+0.25*fk),color:ink,alpha:0.55+0.4*fk,passes:lowDetail?1:undefined});
  ctx.restore();
}
function drawBondLine(ctx,ax,ay,bx,by,o){
  if(o.partial>0&&o.partial<1){
    // dashed, growing from a→b for forming (partial=progress); breaking is the same drawn with progress reversed by caller
    const L=Math.hypot(bx-ax,by-ay);const dash=6,gap=4.5;const ux=(bx-ax)/L,uy=(by-ay)/L;
    ctx.save();ctx.globalAlpha*=clamp(0.25+o.partial*0.9,0,1);
    let s=0,i=0;while(s<L){const e=Math.min(L,s+dash);sketchLine(ctx,[[ax+ux*s,ay+uy*s],[ax+ux*e,ay+uy*e]],{...o,seed:o.seed+i*17,ampScale:0.6,overshoot:false});s+=dash+gap;i++}
    ctx.restore();return;
  }
  sketchLine(ctx,[[ax,ay],[bx,by]],o);
}
function drawArrow(ctx,p0,p1,o){
  const mx=(p0[0]+p1[0])/2,my=(p0[1]+p1[1])/2;const dx=p1[0]-p0[0],dy=p1[1]-p0[1];const L=Math.hypot(dx,dy)||1;
  const nx=-dy/L*o.side,ny=dx/L*o.side;const bl=Math.max(o.bulge*L,o.curl||0);const c=[mx+nx*bl,my+ny*bl]; // `curl`: a floor on the bow in px, so a short arrow (a pi bond to its own oxygen) still curls
  const n=32;const pts=[];const m=Math.max(2,Math.round(n*o.prog));
  for(let i=0;i<=m;i++){const t=(i/n);const x=(1-t)*(1-t)*p0[0]+2*(1-t)*t*c[0]+t*t*p1[0];const y=(1-t)*(1-t)*p0[1]+2*(1-t)*t*c[1]+t*t*p1[1];pts.push([x,y])}
  sketchLine(ctx,pts,{seed:o.seed,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.8,overshoot:false});
  // head
  const e=pts[pts.length-1],q=pts[pts.length-2];let tx=e[0]-q[0],ty=e[1]-q[1];const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
  const hl=9*(o.scale||1)*clamp(o.prog*3,0,1),ha=0.5;
  const l1=[e[0]-hl*(tx*Math.cos(ha)-ty*Math.sin(ha)),e[1]-hl*(ty*Math.cos(ha)+tx*Math.sin(ha))];
  const l2=[e[0]-hl*(tx*Math.cos(-ha)-ty*Math.sin(-ha)),e[1]-hl*(ty*Math.cos(-ha)+tx*Math.sin(-ha))];
  sketchLine(ctx,[l1,e],{seed:o.seed+3,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,overshoot:false,passes:1});
  sketchLine(ctx,[l2,e],{seed:o.seed+5,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,overshoot:false,passes:1});
}

/* paper */
/* canvases made once and kept by key: the newest, the newest large one, and a few small ones besides (a look's
   thumbnail drawn between two frames of the figure must not cost the figure its paper, nor keep a second large one) */
function canvasCache(){const E=[];const SMALL=500000;const small=c=>c.width*c.height<=SMALL;
  return{get(key){for(let i=0;i<E.length;i++)if(E[i].key===key){const e=E[i];if(i){E.splice(i,1);E.unshift(e)}return e.canvas}return null},
    put(key,canvas){E.unshift({key,canvas});let big=!small(canvas),n=0;for(let i=1;i<E.length;i++){const s=small(E[i].canvas);if(s?n++<4:!big)big=big||!s;else E.splice(i--,1)}return canvas},
    clear(){E.length=0}}}
const paperCache=canvasCache(),baseCache=canvasCache();
function paper(W,H,dpr,boil){
  const life=cfg.style.wash>0?cfg.style.washLife:0;const wb=life>0?(boil|0):0; // the wash breathes with every drawing
  const key=[W,H,dpr,cfg.palette.paper,cfg.style.grain,cfg.style.wash,cfg.style.washSeed,cfg.palette.wash,life,wb,cfg.style.wash>0?shadeInk():''].join('|');   // (the wash's drying rings are shaded with the ink)
  const hit=paperCache.get(key);if(hit)return hit;
  const bkey=[W,H,dpr,cfg.palette.paper,cfg.style.grain].join('|');
  const base=baseCache.get(bkey)||baseCache.put(bkey,paperBase(W,H,dpr));
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.drawImage(base,0,0,W,H);
  if(cfg.style.wash>0)watercolourWash(x,W,H,wb,life);
  return paperCache.put(key,c);
}
function paperBase(W,H,dpr){
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.fillStyle=cfg.palette.paper;x.fillRect(0,0,W,H);
  const rng=mulberry32(1234);const dark=luminance(cfg.palette.paper)>0.5;const g=cfg.style.grain;
  const n=Math.round(W*H/38*g);
  for(let i=0;i<n;i++){const a=rng();x.fillStyle=dark?`rgba(70,50,20,${0.02+a*0.07})`:`rgba(255,255,255,${0.02+a*0.06})`;const s=rng()<0.85?1:1.6;x.fillRect(rng()*W,rng()*H,s,s)}
  const nf=Math.round(220*g);x.lineWidth=0.6;
  for(let i=0;i<nf;i++){const px=rng()*W,py=rng()*H,an=rng()*Math.PI,l=6+rng()*22;x.strokeStyle=dark?`rgba(90,70,40,${0.03+rng()*0.05})`:`rgba(255,255,255,${0.03+rng()*0.05})`;x.beginPath();x.moveTo(px,py);x.lineTo(px+Math.cos(an)*l,py+Math.sin(an)*l);x.stroke()}
  return c;
}
/* Watercolour wash. Real washes have crisp, feathery edges and a darker pigment ring, not a blur. Each pool is a polygon whose edges are
   recursively displaced (a fractal edge), then stacked as ~30 lightly deformed, nearly transparent layers: where layers agree the colour builds,
   where they disagree the edge feathers, and their thin outlines pile up into the drying ring. Granulation speckles settle inside. */
function hexToHsl(h){let[r,g,b]=hexToRgb(h).map(v=>v/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let hh=0,ss=0;const l=(mx+mn)/2;if(mx!==mn){const d=mx-mn;ss=l>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r:hh=(g-b)/d+(g<b?6:0);break;case g:hh=(b-r)/d+2;break;default:hh=(r-g)/d+4}hh/=6}return[hh*360,ss,l]}
function hslToHex(h,s,l){h=((h%360)+360)%360/360;const f=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};let r,g,b;if(s===0){r=g=b=l}else{const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;r=f(p,q,h+1/3);g=f(p,q,h);b=f(p,q,h-1/3)}return'#'+[r,g,b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}
function watercolourWash(xPaper,W,H,boil,life){boil=boil||0;life=life||0;
  const amt=cfg.style.wash;const base=cfg.palette.wash;const light=luminance(cfg.palette.paper)>0.5;
  const dpr=xPaper.getTransform().a||1;const off=watercolourWash._off||(watercolourWash._off=document.createElement('canvas'));if(off.width!==Math.round(W*dpr)||off.height!==Math.round(H*dpr)){off.width=Math.round(W*dpr);off.height=Math.round(H*dpr)}const x=off.getContext('2d',{willReadFrequently:true});x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,off.width,off.height);x.scale(dpr,dpr);
  let rng=mulberry32(9000+cfg.style.washSeed*131);const gauss=()=>{const u=1-rng(),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
  const deform=(pts,depth,variance)=>{let p=pts;for(let d=0;d<depth;d++){const out=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;const ex=b[0]-a[0],ey=b[1]-a[1];const len=Math.hypot(ex,ey)||1;const nx=-ey/len,ny=ex/len;const dn=gauss()*variance*len,dt=gauss()*variance*len*0.35;out.push(a,[mx+nx*dn+ex/len*dt,my+ny*dn+ey/len*dt])}p=out}return p};
  const path=pts=>{x.beginPath();pts.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath()};
  const [bh,bs,bl]=hexToHsl(base);
  const n=2+Math.floor(rng()*3);const layers=26;
  x.save();x.globalCompositeOperation='source-over';
  for(let k=0;k<n;k++){
    const cx=W*(0.12+rng()*0.76),cy=H*(0.12+rng()*0.76),r=Math.min(W,H)*(0.11+rng()*0.16);
    const col=hslToHex(bh+(rng()-0.5)*14,clamp(bs*(0.85+rng()*0.3),0,0.75),clamp(bl+(rng()-0.5)*0.08,0.3,0.85));
    const m=8+Math.floor(rng()*5);const poly=[];for(let i=0;i<m;i++){const a=i/m*Math.PI*2+rng()*0.3;const rad=r*(0.75+rng()*0.5);poly.push([cx+Math.cos(a)*rad*1.2,cy+Math.sin(a)*rad*0.9])}
    const shape0=deform(poly,3,0.34);
    // the pool breathes: each vertex drifts on its own slow noise track through the boil count, so the edge creeps rather than jumps
    const drift=life>0?r*0.18*life:0;const tracks=shape0.map((_,i)=>{const tr=mulberry32(9000+cfg.style.washSeed*131+k*977+i*13);return[new Noise1(tr,16),new Noise1(tr,16)]});
    const shape=drift?shape0.map((p,i)=>[p[0]+drift*tracks[i][0].at(boil*0.2+i*0.37),p[1]+drift*tracks[i][1].at(boil*0.2+i*0.53)]):shape0;
    // and its density breathes too: the pool slowly darkens and pales, as a wash does while it dries
    const dens=life>0?1+0.5*life*new Noise1(mulberry32(9000+cfg.style.washSeed*131+k*977+5),16).at(boil*0.18+k*0.71):1;
    const aFill=0.04*dens;
    // the pool itself is fixed; its layers are re-drawn each boil step so the wash breathes without wandering
    const rngPool=rng;rng=mulberry32(9000+cfg.style.washSeed*131+k*977+(life>0?boil*17:0));
    for(let L=0;L<layers;L++){const sc=0.8+rng()*0.24;const lay=deform(shape.map(p=>[cx+(p[0]-cx)*sc,cy+(p[1]-cy)*sc]),2,(0.14+rng()*0.16)*(1+0.5*life));path(lay);x.fillStyle=rgba(col,aFill);x.fill()}
    // the drying ring: a few crisp, darker outlines close to the true edge
    for(let e=0;e<3;e++){const sc=0.97+rng()*0.05;const lay=deform(shape.map(p=>[cx+(p[0]-cx)*sc,cy+(p[1]-cy)*sc]),1,0.05);path(lay);x.lineWidth=0.7+rng()*0.5;x.strokeStyle=rgba(mix(col,shadeInk(),0.25),0.14);x.stroke()}
    // granulation
    x.save();path(shape);x.clip();rng=rngPool;const g=Math.round(r*r*0.012);for(let i=0;i<g;i++){const a=rng()*Math.PI*2,t=Math.pow(rng(),0.6);x.fillStyle=rgba(mix(col,shadeInk(),0.4),0.1+rng()*0.18);const sz=rng()<0.85?1:1.6;x.fillRect(cx+Math.cos(a)*t*r*1.2,cy+Math.sin(a)*t*r*0.9,sz,sz)}x.restore();
  }
  x.restore();
  xPaper.save();xPaper.globalCompositeOperation=light?'multiply':'screen';xPaper.globalAlpha=clamp(0.55*amt,0,1);try{xPaper.filter='blur(1.2px)'}catch(e){}xPaper.drawImage(off,0,0,W,H);xPaper.restore();
}
function hull(pts){pts=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(pts.length<3)return pts;const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[];for(const p of pts){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}const up=[];for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(up.length>=2&&cross(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}up.pop();lo.pop();return lo.concat(up)}
function drawContext(ctx,proj,st,seed){
  const pts=st.atoms.filter(a=>a.alpha>0.5).map(a=>{const p=proj.proj(a.pos);return[p.x,p.y]});if(pts.length<3)return;
  let h=hull(pts);const cx=h.reduce((s,p)=>s+p[0],0)/h.length,cy=h.reduce((s,p)=>s+p[1],0)/h.length;
  const m=proj.pxPerA*1.6;
  h=h.map(p=>{const dx=p[0]-cx,dy=p[1]-cy;const L=Math.hypot(dx,dy)||1;return[p[0]+dx/L*m,p[1]+dy/L*m]});
  for(let k=0;k<3;k++){const o=[];for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length];o.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25]);o.push([a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75])}h=o}
  const rng=mulberry32(seed+77);const nz=new Noise1(rng,16);
  h=h.map((p,i)=>{const dx=p[0]-cx,dy=p[1]-cy;const L=Math.hypot(dx,dy)||1;const w=nz.at(i/h.length*16)*proj.pxPerA*0.35;return[p[0]+dx/L*w,p[1]+dy/L*w]});
  h.push(h[0]);
  const P=cfg.palette,al=cfg.style.contextAlpha;
  ctx.save();ctx.beginPath();h.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
  ctx.fillStyle=rgba(P.context,0.28*al);ctx.fill();ctx.clip();
  // light hatch across blob
  const ang=(cfg.style.hatchAngle+25)*Math.PI/180;const dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;const R=Math.max(ctx.canvas.width,ctx.canvas.height);
  for(let d=-R;d<R;d+=13+(rng()-0.5)*4){sketchLine(ctx,[[cx+nx*d-dx*R,cy+ny*d-dy*R],[cx+nx*d+dx*R,cy+ny*d+dy*R]],{seed:seed+Math.round(d),passes:1,width:0.8,color:P.context,alpha:0.5*al,ampScale:1.5,step:12,overshoot:false})}
  ctx.restore();
  sketchLine(ctx,h,{seed:seed+9,width:1.1,color:P.context,alpha:0.9*al,ampScale:1.3,step:6,overshoot:false,passes:2});
}

/* ============================ selections & colours ============================ */
const BB=new Set(['N','CA','C','O','OXT']);
const VDW={H:1.1,C:1.7,N:1.55,O:1.52,S:1.8,P:1.8,F:1.47,CL:1.75,BR:1.85,I:1.98,ZN:1.39,MG:1.73,CA:2.0,FE:1.5,NA:2.27,K:2.75};
const selCache={};
function compileSel(str){
  str=(str||'').trim();if(selCache[str])return selCache[str];
  const toks=str.match(/\(|\)|[^\s()]+/g)||[];let i=0;
  const peek=()=>toks[i],next=()=>toks[i++];
  const listArg=()=>{const t=next();return t===undefined?[]:t.split('+')};
  function factor(){const t=next();if(t===undefined)return()=>false;const tl=t.toLowerCase();
    if(tl==='('){const e=expr();if(peek()===')')next();return e}
    if(tl==='not'||tl==='!'){const f=factor();return a=>!f(a)}
    switch(tl){
      case'all':case'*':return()=>true;case'none':return()=>false;
      case'hetatm':case'het':return a=>!!a.het;case'polymer':case'poly':return a=>!a.het;
      case'backbone':case'bb':return a=>BB.has(a.name);case'sidechain':case'sc':return a=>!a.het&&!BB.has(a.name);
      case'hydro':case'h.':case'hydrogens':return a=>a.el==='H';case'nucleic':case'na':return a=>!!a.nucleic;case'subunit':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has(a.subunit||'X')}case'entity':{const S=new Set(listArg());return a=>S.has(String(a.entity))}case'protein':case'prot':return a=>!a.het&&!a.nucleic;case'water':case'solvent':return a=>a.resn==='HOH'||a.resn==='WAT';
      case'resi':case'i.':{const R=listArg().map(s=>{const m=s.match(/^(-?\d+)(?:-(-?\d+))?$/);return m?[+m[1],m[2]!==undefined?+m[2]:+m[1]]:null}).filter(Boolean);return a=>R.some(([lo,hi])=>a.resi>=lo&&a.resi<=hi)}
      case'resn':case'r.':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has((a.resn||'').toUpperCase())}
      case'name':case'n.':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has((a.name||'').toUpperCase())}
      case'chain':case'c.':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has((a.chain||'').toUpperCase())}
      case'elem':case'e.':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has(a.el)}
      case'ss':{const S=new Set(listArg().map(s=>s.toUpperCase()));return a=>S.has(a.ss||'L')}
      case'id':{const S=new Set(listArg());return a=>S.has(a.id)}
      case'group':case'g.':{const S=new Set(listArg());return a=>S.has(a.group)}
      default:return()=>false;
    }}
  function term(){let f=factor();while(peek()&&(peek().toLowerCase()==='and'||peek()==='&')){next();const g=factor(),f0=f;f=a=>f0(a)&&g(a)}return f}
  function expr(){let f=term();while(peek()&&(peek().toLowerCase()==='or'||peek()==='|')){next();const g=term(),f0=f;f=a=>f0(a)||g(a)}return f}
  const f=str?expr():()=>false;selCache[str]=f;return f;
}
const GROUP_PALETTE=['#f2e85a','#7cbf72','#5fc9c9','#a98ad6','#f0a050','#d9a3c9','#8fb8a8','#b5c95a','#c9a27a','#9ad0b8']; // no blues or reds: those belong to N and O
let groupIdx={},groupIdxKey='';
function groupIndex(key){const sk=scene.keyframes.length+'|'+(scene.name||'');if(groupIdxKey!==sk){groupIdx={};groupIdxKey=sk;let n=0;for(const k of scene.keyframes)for(const id in k.atoms){const a=k.atoms[id];const g=a.group||((a.resn||'')+(a.resi??''));if(!(g in groupIdx))groupIdx[g]=n++;const c=a.chain||'';if(!(('chain:'+c) in groupIdx))groupIdx['chain:'+c]=n++;const e='entity:'+(a.entity||('chain:'+c));if(!(e in groupIdx))groupIdx[e]=n++}}return groupIdx[key]??0}
/** a colour of the user's own for this atom (fig.color, a scene's groupColors), from the narrowest group that has one:
    its residue (SER195.A, or SER195), its chain (A), its entity (entity:1), its subunit (subunit:L). It wins over every
    scheme, so a chain given a colour is that colour whether the look colours by residue, by secondary structure or along
    the chain, in the sticks, the cartoon and the surface alike */
function ownColor(a){const G=scene.groupColors;if(!G)return null;
  return G[a.group]||G[(a.resn||'')+(a.resi??'')]||(a.chain&&G[a.chain])||(a.entity&&G['entity:'+a.entity])||G['subunit:'+(a.subunit||'X')]||null}
function carbonColor(a){const P=cfg.palette,mode=cfg.rep.colorBy;
  if(a.color)return P[a.color]||a.color;
  const own=ownColor(a);if(own)return own;
  if(mode==='element')return P.C;if(mode==='subunit')return subunitColor(a);if(mode==='entity')return entityColor(a);if(mode==='chain')return chainColor(a);
  const key=a.group||((a.resn||'')+(a.resi??''));
  if(mode==='group')return P.C;
  const GP=cfg.groupPalette&&cfg.groupPalette.length?cfg.groupPalette:GROUP_PALETTE;return GP[groupIndex(key)%GP.length];
}
const SUBUNIT_COLS={S:'#9cc27a',L:'#e6a45a',T:'#c96d8a',X:'#b8b4a8'};
function subunitColor(a){const k=a.subunit||'X';if(scene.groupColors&&scene.groupColors['subunit:'+k])return scene.groupColors['subunit:'+k];
  if(k==='X'&&!hasSubunits())return chainColor(a);   // no ribosomal subunits (a haemoglobin, a chaperonin): by chain, not one colour
  return SUBUNIT_COLS[k]||SUBUNIT_COLS.X}
const SUBUNITS_OF=new WeakMap();   // keyframe → whether any of its atoms is in a subunit
function hasSubunits(){const K=scene&&scene.keyframes&&scene.keyframes[0];if(!K)return false;let f=SUBUNITS_OF.get(K);if(f===undefined){f=false;for(const id in K.atoms){const u=K.atoms[id].subunit;if(u&&u!=='X'){f=true;break}}SUBUNITS_OF.set(K,f)}return f}
function entityColor(a){const e=a.entity||('chain:'+(a.chain||''));if(scene.groupColors&&scene.groupColors['entity:'+e])return scene.groupColors['entity:'+e];const GP=cfg.groupPalette&&cfg.groupPalette.length?cfg.groupPalette:GROUP_PALETTE;return GP[groupIndex('entity:'+e)%GP.length]}
/** a chain's colour: its own if given, else the palette's in the order the chains come (counted on their own, so
    neighbouring chains never share a colour the way they could when residues and chains were counted together) */
let chainOrd=null,chainOrdKey='';
function chainColor(a){const c=a.chain||'';if(scene.groupColors&&scene.groupColors[c])return scene.groupColors[c];const GP=cfg.groupPalette&&cfg.groupPalette.length?cfg.groupPalette:GROUP_PALETTE;
  const K0=scene.keyframes[0],n0=scene.keyframes.length,rv=scene._rev;   // the chains' order, found once per scene (its keys were rebuilt for every atom: 58 000 atoms coloured by chain took minutes)
  if(!chainOrdKey||chainOrdKey.K0!==K0||chainOrdKey.n0!==n0||chainOrdKey.rv!==rv||chainOrdKey.name!==scene.name){const k={K0,n0,rv,name:scene.name};chainOrd={};chainOrdKey=k;let n=0;for(const f of scene.keyframes)for(const id in f.atoms){const ch=f.atoms[id].chain||'';if(!(ch in chainOrd))chainOrd[ch]=n++}}
  return GP[(chainOrd[c]??0)%GP.length]}
/** the cartoon's colouring: the style's, or by chain when a map is drawn with its model by chain (the density and its chain share a colour) */
function cartoonMode(){const M=scene.map;return M&&M.hasModel&&M.opts.color==='chain'?'chain':cfg.rep.cartoonColor||'ss'}
function atomColor(a){if(a.color)return cfg.palette[a.color]||a.color;if(a.el==='C')return carbonColor(a);return cfg.palette[a.el]||cfg.palette.X}

/* ============================ frame render ============================ */
function atomDrawR(a,proj){
  if(cfg.rep.mode==='sticks'){const R=cfg.rep.stickRadius*proj.pxPerA;return a.sphere?R*(1+cfg.rep.sphereScale*4):R}
  return (a.r??EL_R[a.el]??0.45)*cfg.style.ballScale*proj.pxPerA;
}
function anchorPoint(an,st,proj,other){
  if(an.atom){const a=st.A[an.atom];if(!a)return null;const p=proj.proj(a.pos);const r=atomDrawR(a,proj)*p.d;
    if(other){const dx=other[0]-p.x,dy=other[1]-p.y,L=Math.hypot(dx,dy)||1;return[p.x+dx/L*(r+3),p.y+dy/L*(r+3)]}return[p.x,p.y]}
  if(an.bond){const a=st.A[an.bond[0]],b=st.A[an.bond[1]];if(!a||!b)return null;const p=proj.proj(a.pos),q=proj.proj(b.pos);return[(p.x+q.x)/2,(p.y+q.y)/2]}
  if(an.lp){const a=st.A[an.lp];if(!a||!a.lps.length)return null;const lp=a.lps[Math.min(an.i||0,a.lps.length-1)];const p=proj.proj(a.pos);const r=atomDrawR(a,proj)*p.d;const d=proj.dir2(lp.dir);const L=Math.hypot(d[0],d[1])||1;return[p.x+d[0]/L*(r+7),p.y+d[1]/L*(r+7)]}
  return null;
}
function fogged(col,fog){return mix(col,cfg.palette.paper,clamp(fog*cfg.view.fog*0.7,0,0.7))}
/* Pen rendering of a sphere: hatch that thins toward the light and cross-hatches in the shadow, highlight left bare. */
function penSphere(ctx,x,y,r,col,el,seed,o){
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX,dw=(o.d||1)*Math.max(TEX,0.75);const dens=S.hatchDensity; // spacing follows the texture scale fully, widths stop at 0.75 px or the hatch fades to grey
  const colour=cfg.rep.fill==='ink colour'||isPencil()||isWC();const dk=isWC()&&luminance(P.paper)<=0.5;const ink=fogged(colour?mix(col,P.hatch,isPencil()?0.45:isWC()?(dk?0.35:0.6):0.15):P.hatch,fog); // on dark paper the pigment shades gently, or it goes to mud
  const la=S.lightAngle*Math.PI/180;const light=[Math.cos(la),Math.sin(la)];const ang=S.hatchAngle*Math.PI/180;
  const hs=S.hatchSpacing*Math.max(0.7,d)/dens;const a=(0.55+0.45*fk)*(colour?0.9:0.75)*(isWC()?(dk?0.3:0.45):1);
  if(el==='N'&&r<14){ // stipple with a density gradient
    const rng=mulberry32(seed+5);const n=Math.round(r*r*3.2/(hs*hs)*dens*2);ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.fillStyle=rgba(ink,a);
    for(let i=0;i<n;i++){const t=Math.sqrt(rng()),th=rng()*Math.PI*2;const px=Math.cos(th)*t*r,py=Math.sin(th)*t*r;const lit=(px*light[0]+py*light[1])/r;if(rng()<(lit+1)/2*0.9)continue;ctx.beginPath();ctx.arc(x+px,y+py,0.8*dw,0,Math.PI*2);ctx.fill()}
    ctx.restore();return}
  hatchCircle(ctx,x,y,r,ang,hs,{seed:seed+11,width:0.9*dw,color:ink,alpha:a*0.8,light,thr:r*0.45});
  hatchCircle(ctx,x,y,r,ang+0.25,hs*0.8,{seed:seed+12,width:0.9*dw,color:ink,alpha:a*0.8,light,thr:-r*0.1});
  hatchCircle(ctx,x,y,r,ang+1.35,hs*0.85,{seed:seed+13,width:0.85*dw,color:ink,alpha:a*0.7,light,thr:-r*0.5});
}
/* Pen rendering of a stick: strokes along the axis, denser toward the shadow edge, a bare highlight strip, cross strokes in the shadow. Caller has clipped to the capsule. */
function penStick(ctx,ax,ay,mx,my,R,col,el,seed,o){
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX,dw=(o.d||1)*Math.max(TEX,0.75);const dens=S.hatchDensity; // spacing follows the texture scale fully, widths stop at 0.75 px or the hatch fades to grey
  const colour=cfg.rep.fill==='ink colour'||isPencil()||isWC();const dk=isWC()&&luminance(P.paper)<=0.5;const ink=fogged(colour?mix(col,P.hatch,isPencil()?0.45:isWC()?(dk?0.35:0.6):0.15):P.hatch,fog);
  const ux=mx-ax,uy=my-ay,L=Math.hypot(ux,uy)||1,tx=ux/L,ty=uy/L,nx=-ty,ny=tx;
  const la=S.lightAngle*Math.PI/180;const litSign=(nx*Math.cos(la)+ny*Math.sin(la))>0?1:-1; // +n side faces the light?
  const rng=mulberry32(seed+21);const hs=S.hatchSpacing*Math.max(0.7,d)/dens;const a=(0.55+0.45*fk)*(colour?1.0:0.8)*(isWC()?(dk?0.3:0.45):1);
  if(el==='H'){ // hydrogens: two faint strokes only
    for(const t of[-0.45,0.2]){sketchLine(ctx,[[ax+nx*t*R-tx*R*0.6,ay+ny*t*R-ty*R*0.6],[mx+nx*t*R,my+ny*t*R]],{seed:seed+Math.round(t*10),passes:1,width:0.7*dw,color:fogged(P.hatch,fog),alpha:0.35*(0.5+0.5*fk),ampScale:0.5,step:5,overshoot:false})}return}
  if(el==='N'){ // stipple gradient
    const n=Math.round((L+2*R)*2*R/(hs*hs)*1.6*dens);ctx.fillStyle=rgba(ink,a);
    for(let i=0;i<n;i++){const s=-R+rng()*(L+2*R),t=(rng()*2-1);const lit=t*litSign;if(rng()<(lit+1)/2*0.85)continue;ctx.beginPath();ctx.arc(ax+tx*s+nx*t*R,ay+ty*s+ny*t*R,0.8*dw,0,Math.PI*2);ctx.fill()}return}
  const step=hs*0.6/R;
  for(let t=-1+step*0.5+(rng()-0.5)*step*0.4;t<1;t+=step){
    const lit=t*litSign;if(lit>0.42)continue;                 // bare highlight strip
    if(lit>0&&rng()<lit*0.9)continue;                          // thinning toward the light
    const tone=clamp(0.55-lit*0.5,0.3,1);
    const s0=-R*0.7+rng()*R*0.5,s1=L-rng()*R*0.4;              // strokes start inside the cap and stop short of the midpoint sometimes
    sketchLine(ctx,[[ax+tx*s0+nx*t*R,ay+ty*s0+ny*t*R],[ax+tx*s1+nx*t*R,ay+ty*s1+ny*t*R]],{seed:seed+Math.round(t*100),passes:1,width:(0.9+0.45*tone)*dw*LW.inner,color:ink,alpha:Math.min(1,a*(0.35+tone)),ampScale:0.6,step:5,overshoot:false});
  }
  // cross strokes in the shadow third
  const cs=hs*0.9;for(let sx=-R*0.5+rng()*cs;sx<L;sx+=cs+(rng()-0.5)*cs*0.4){const t0=-0.98*litSign,t1=-0.35*litSign;
    sketchLine(ctx,[[ax+tx*sx+nx*t0*R,ay+ty*sx+ny*t0*R],[ax+tx*(sx+R*0.35)+nx*t1*R,ay+ty*(sx+R*0.35)+ny*t1*R]],{seed:seed+Math.round(sx*7)+500,passes:1,width:0.8*dw,color:ink,alpha:a*0.65,ampScale:0.5,step:4,overshoot:false})}
  if(el==='S'||el==='P'){for(let sx=-R*0.5+rng()*cs;sx<L;sx+=cs){sketchLine(ctx,[[ax+tx*sx+nx*R*0.9,ay+ty*sx+ny*R*0.9],[ax+tx*(sx+R*0.5)-nx*R*0.9,ay+ty*(sx+R*0.5)-ny*R*0.9]],{seed:seed+Math.round(sx*5)+900,passes:1,width:0.8*dw,color:ink,alpha:a*0.6,ampScale:0.4,step:4,overshoot:false})}}
}
/* fill colour for the current fill mode: flat colour, a pale wash, or bare paper (ink) */
const isInk=()=>cfg.rep.fill==='ink'||cfg.rep.fill==='ink colour'||cfg.rep.fill==='pencil'||cfg.rep.fill==='watercolour'||cfg.rep.fill==='chalk';
const isChalk=()=>cfg.rep.fill==='chalk';const isPencil=()=>cfg.rep.fill==='pencil'||isChalk();const isWC=()=>cfg.rep.fill==='watercolour';
let RF={W:960,H:720,dpr:1};
/* Watercolour fill of one polygon: stacked, lightly deformed transparent layers (multiply) with a drying ring and granulation.
   When `target` is a transparent offscreen, layers stack with source-over and the caller multiplies the result once. */
function wcGauss(rng){const u=1-rng(),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function wcDeform(pts,depth,variance,rng){let p=pts;for(let d=0;d<depth;d++){const out=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;const ex=b[0]-a[0],ey=b[1]-a[1];const len=Math.hypot(ex,ey)||1;const nx=-ey/len,ny=ex/len;const dn=wcGauss(rng)*variance*len,dt=wcGauss(rng)*variance*len*0.35;out.push(a,[mx+nx*dn+ex/len*dt,my+ny*dn+ey/len*dt])}p=out}return p}
/* wcDeform on a flat list (x, y, x, y …): the same points from the same random numbers in the same arithmetic, without
   an array for every point (a watercolour shape deforms thousands of points per layer) */
function wcDeformF(P,depth,variance,rng){let p=P;for(let d=0;d<depth;d++){const m=p.length>>1,out=new Float64Array(m*4);
  for(let i=0;i<m;i++){const j=i+1===m?0:i+1;const ax=p[2*i],ay=p[2*i+1],bx=p[2*j],by=p[2*j+1];const mx=(ax+bx)/2,my=(ay+by)/2;const ex=bx-ax,ey=by-ay;const len=Math.hypot(ex,ey)||1;const nx=-ey/len,ny=ex/len;const dn=wcGauss(rng)*variance*len,dt=wcGauss(rng)*variance*len*0.35;
    const o=4*i;out[o]=ax;out[o+1]=ay;out[o+2]=mx+nx*dn+ex/len*dt;out[o+3]=my+ny*dn+ey/len*dt}p=out}return p}
function watercolourShape(ctx,pts,col,seed,o){
  o=o||{};const rng=mulberry32(seed+4242);const layers=o.layers||9;const fog=o.fog||0;
  col=fogged(col,fog);const light=luminance(cfg.palette.paper)>0.5;
  let cx=0,cy=0;for(const p of pts){cx+=p[0];cy+=p[1]}cx/=pts.length;cy/=pts.length;
  const path=q=>{ctx.beginPath();ctx.moveTo(q[0],q[1]);for(let i=2;i<q.length;i+=2)ctx.lineTo(q[i],q[i+1]);ctx.closePath()};
  const P=new Float64Array(pts.length*2);for(let i=0;i<pts.length;i++){P[2*i]=pts[i][0];P[2*i+1]=pts[i][1]}
  const shape=wcDeformF(P,1,0.06,rng),sn=shape.length>>1;
  ctx.save();
  // on dark paper, screened layers alone never reach the pigment: lay the colour down first, then let the layers glow over it
  if(!light&&!o.offscreen){path(shape);ctx.fillStyle=rgba(col,0.7*(o.strength||0.75)/0.75);ctx.fill()}
  ctx.globalCompositeOperation=o.offscreen?'source-over':(light?'multiply':'screen');
  const aFill=(o.strength||0.75)/layers*1.15;const scaled=new Float64Array(shape.length);
  for(let L=0;L<layers;L++){const sc=o.noScale?1:0.9+rng()*0.16;let q=shape;if(sc!==1){for(let i=0;i<shape.length;i+=2){scaled[i]=cx+(shape[i]-cx)*sc;scaled[i+1]=cy+(shape[i+1]-cy)*sc}q=scaled}
    const lay=wcDeformF(q,2,(0.08+rng()*0.1)*(o.noScale?1.6:1),rng);path(lay);ctx.fillStyle=rgba(col,aFill);ctx.fill()}
  if(!o.noRing)for(let e=0;e<2;e++){const lay=wcDeformF(shape,1,0.03,rng);path(lay);ctx.lineWidth=0.7+rng()*0.5;ctx.strokeStyle=rgba(mix(col,shadeInk(),0.25),0.16*(o.strength||0.75)/0.75);ctx.stroke()}
  if(o.granulate!==false){ctx.save();path(shape);ctx.clip();let area=0;for(let i=0;i<sn;i++){const j=i+1===sn?0:i+1;area+=shape[2*i]*shape[2*j+1]-shape[2*j]*shape[2*i+1]}area=Math.abs(area)/2;
    const g=Math.round(area*0.004);let xs=1e9,ys=1e9,xe=-1e9,ye=-1e9;for(let i=0;i<shape.length;i+=2){xs=Math.min(xs,shape[i]);ys=Math.min(ys,shape[i+1]);xe=Math.max(xe,shape[i]);ye=Math.max(ye,shape[i+1])}
    for(let i=0;i<g;i++){ctx.fillStyle=rgba(mix(col,shadeInk(),0.4),0.12+rng()*0.2);ctx.fillRect(xs+rng()*(xe-xs),ys+rng()*(ye-ys),1,1)}ctx.restore()}
  ctx.restore();
}
/* line hierarchy: silhouettes heavier, interior marks lighter */
const LW={get outer(){return 1+0.45*cfg.style.hierarchy},get inner(){return 1-0.45*cfg.style.hierarchy},get faint(){return 0.5-0.15*cfg.style.hierarchy}};
/* coloured-pencil scribble fill inside the current clip: back-and-forth strokes, two layers, ragged edges */
function scribbleFill(ctx,x0,y0,x1,y1,col,seed,o){
  const S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX,dw=(o.d||1)*Math.max(TEX,0.75);const rng=mulberry32(seed+303);
  const ch=isChalk();const c=fogged(ch?mix(col,'#ffffff',0.18):col,fog);const cx=(x0+x1)/2,cy=(y0+y1)/2,R=Math.hypot(x1-x0,y1-y0)/2+3;
  const layers=ch?[[S.hatchAngle*Math.PI/180+0.9,S.hatchSpacing*0.45,0.9],[S.hatchAngle*Math.PI/180-0.6,S.hatchSpacing*0.55,0.55]]:[[S.hatchAngle*Math.PI/180+0.9,S.hatchSpacing*0.55,0.55],[S.hatchAngle*Math.PI/180-0.5,S.hatchSpacing*0.75,0.35]];
  for(const [ang,sp,al] of layers){const dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;const pts=[];let flip=1;
    for(let dd=-R;dd<R;dd+=sp*(0.8+0.4*rng())){const e0=-R*(0.9+0.2*rng()),e1=R*(0.9+0.2*rng());pts.push([cx+nx*dd+dx*e0*flip,cy+ny*dd+dy*e0*flip]);pts.push([cx+nx*dd+dx*e1*flip,cy+ny*dd+dy*e1*flip]);flip=-flip}
    if(pts.length>3)sketchLine(ctx,pts,{seed:seed+Math.round(ang*100),passes:1,width:(ch?(2.2+1.2*rng()):(1.1+0.6*rng()))*dw,color:c,alpha:al*(0.6+0.4*fk),ampScale:ch?0.6:0.9,step:6,overshoot:false,pressure:ch?0.95:0.8})}
}
/* what pigment darkens toward: the ink on light paper, near-black on dark paper (where the ink is pale) */
function shadeInk(){const P=cfg.palette;return luminance(P.paper)>0.5?P.ink:mix(P.paper,'#000000',0.75)}
function fillFor(col){const m=cfg.rep.fill;if(isInk())return cfg.palette.paper;if(m==='wash')return mix(col,cfg.palette.paper,0.62);return col}
/* In ink mode, elements are told apart by pen texture: N stipple, O hatch, S cross-hatch, others light hatch. Caller has set the clip. */
function elementPattern(ctx,el,x0,y0,x1,y1,seed,o){
  if(!isInk()||el==='H')return;
  const colour=cfg.rep.fill==='ink colour';if(el==='C'&&!colour)return;
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX;
  const ink=fogged(colour&&o.col?mix(o.col,P.hatch,0.15):P.hatch,fog);const hs=S.hatchSpacing*Math.max(0.7,d);
  const rng=mulberry32(seed+99);const w=x1-x0,h=y1-y0;
  if(el==='N'||el==='P'){const n=Math.round(w*h/(hs*hs*(el==='N'?0.9:0.5)));ctx.fillStyle=rgba(ink,(colour?0.95:0.8)*(0.5+0.5*fk));
    for(let i=0;i<n;i++){ctx.beginPath();ctx.arc(x0+rng()*w,y0+rng()*h,(colour?0.9:0.75)*d,0,Math.PI*2);ctx.fill()}return}
  const a0=S.hatchAngle*Math.PI/180;
  const angs=el==='O'?[a0]:el==='S'?[a0,a0+Math.PI/2]:el==='C'?[a0+0.35]:[a0+0.6];
  const cx=(x0+x1)/2,cy=(y0+y1)/2,R=Math.hypot(w,h)/2+2;
  angs.forEach((ang,ai)=>{const dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;const sp=hs*(el==='O'?0.8:el==='C'?1.5:1.1);
    for(let dd=-R;dd<R;dd+=sp+(rng()-0.5)*sp*0.3){sketchLine(ctx,[[cx+nx*dd-dx*R,cy+ny*dd-dy*R],[cx+nx*dd+dx*R,cy+ny*dd+dy*R]],{seed:seed+Math.round(dd*7)+ai*1000,passes:1,width:(colour?1.0:0.8)*d,color:ink,alpha:(colour?0.85:0.7)*(0.5+0.5*fk),ampScale:0.5,step:5,overshoot:false})}});
}
function shade(col,k){return k>=0?mix(col,'#ffffff',k):mix(col,shadeInk(),-k)}

/* flat ball: solid fill, pencil shadow on the far side, sketched outline */
function drawFlatBall(ctx,x,y,r,col,o){
  const P=cfg.palette,S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX;
  const la=S.lightAngle*Math.PI/180;const light=[Math.cos(la),Math.sin(la)];
  ctx.save();ctx.globalAlpha=o.alpha??1;
  if(o.outlineFirst)sketchCircle(ctx,x,y,r,{seed:o.seed+4,width:S.inkWidth*d*(0.75+0.25*fk)*0.9,color:fogged(P.ink,fog),alpha:(0.55+0.4*fk)*(o.outlineAlpha??1),passes:o.passes});
  ctx.beginPath();ctx.arc(x,y,r*(o.outlineFirst?0.97:1),0,Math.PI*2);ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=rgba(fogged(fillFor(col),fog),o.fillAlpha??1);ctx.fill()}
  if(isWC()){const q=[];for(let i=0;i<14;i++){const a=i/14*Math.PI*2;q.push([x+Math.cos(a)*r,y+Math.sin(a)*r])}watercolourShape(ctx,q,col,o.seed,{fog,layers:8,strength:o.wcStrength||0.8})}
  if(isInk()){ctx.save();ctx.beginPath();ctx.arc(x,y,r+(isPencil()?1.5:0),0,Math.PI*2);ctx.clip();if(isPencil())scribbleFill(ctx,x-r,y-r,x+r,y+r,col,o.seed,{fog,d});if(!o.noPen&&!isChalk())penSphere(ctx,x,y,r,col,o.el,o.seed,{fog,d});ctx.restore()}
  else if(S.shading>0&&r>3){hatchCircle(ctx,x,y,r,S.hatchAngle*Math.PI/180,S.hatchSpacing*(1+fog*0.6)*Math.max(0.7,d),{seed:o.seed+2,width:0.9*d,color:fogged(cfg.rep.fill==='ink colour'?mix(col,P.hatch,0.4):P.hatch,fog),alpha:0.45*S.shading*(0.5+0.5*fk),light,thr:-r*0.15})}
  if(!o.outlineFirst)sketchCircle(ctx,x,y,r,{seed:o.seed+4,width:S.inkWidth*d*(0.75+0.25*fk)*LW.outer,color:fogged(P.ink,fog),alpha:0.55+0.4*fk,passes:isPencil()?(o.passes??3):o.passes});
  ctx.restore();
}
/* half-stick capsule from atom centre a to bond midpoint m */
function capsulePts(ax,ay,mx,my,R,Rm){
  Rm=Rm??R;const ux=(mx-ax),uy=(my-ay),L=Math.hypot(ux,uy)||1;const tx=ux/L,ty=uy/L,nx=-ty,ny=tx;
  const pts=[[mx+nx*Rm,my+ny*Rm],[ax+nx*R,ay+ny*R]];
  const a0=Math.atan2(ny,nx);for(let k=1;k<10;k++){const an=a0+Math.PI*k/10;pts.push([ax+Math.cos(an)*R,ay+Math.sin(an)*R])}
  pts.push([ax-nx*R,ay-ny*R],[mx-nx*Rm,my-ny*Rm]);return{pts,tx,ty,nx,ny};
}
function drawHalfStick(ctx,ax,ay,mx,my,R,col,o){
  const P=cfg.palette,S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=(o.d||1)*TEX;const Rm=o.Rm??R;
  const {pts,tx,ty,nx,ny}=capsulePts(ax,ay,mx,my,R,Rm);
  ctx.save();ctx.globalAlpha=o.alpha??1;
  if(o.partial>0&&o.partial<1){ // forming / breaking: dotted outline only
    const L=Math.hypot(mx-ax,my-ay);ctx.fillStyle=rgba(fogged(P.ink,fog),0.3+0.7*o.partial);
    for(let s=2;s<L;s+=R*1.6){ctx.beginPath();ctx.arc(ax+tx*s,ay+ty*s,R*0.45,0,Math.PI*2);ctx.fill()}
    ctx.restore();return}
  // outline (open at the midpoint)
  sketchLine(ctx,pts,{seed:o.seed,width:S.inkWidth*d*(0.75+0.25*fk)*(o.inner?LW.inner:LW.outer),color:fogged(P.ink,fog),alpha:(0.55+0.4*fk)*(isPencil()?0.85:1),ampScale:0.8,overshoot:false,step:4,passes:isPencil()?(o.passes??3):o.passes});
  // fill, slightly inset
  ctx.beginPath();const ins=0.6;const q=capsulePts(ax,ay,mx,my,Math.max(0.5,R-ins),Math.max(0.5,Rm-ins)).pts;q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
  ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=fogged(fillFor(col),fog);ctx.fill()}
  if(isWC()&&o.el!=='H'){watercolourShape(ctx,q,col,o.seed,{fog,layers:7,strength:0.8})}
  if(o.el&&isInk()){ctx.save();ctx.clip();if(isPencil()&&o.el!=='H'){const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);scribbleFill(ctx,Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys),col,o.seed,{fog,d})}if((!isWC()||cfg.style.shading>0)&&!isChalk())penStick(ctx,ax,ay,mx,my,R,col,o.el,o.seed,{fog,d});ctx.restore()}
  // pencil shadow along the far side
  if(S.shading>0&&!o.noShadow&&!isInk()){const la=S.lightAngle*Math.PI/180;const lx=Math.cos(la),ly=Math.sin(la);const side=(nx*lx+ny*ly)>0?-1:1;
    ctx.save();ctx.clip();const L=Math.hypot(mx-ax,my-ay);
    for(const f of[0.5,0.78]){const off=R*f*side;sketchLine(ctx,[[ax+nx*off-tx*R*0.3,ay+ny*off-ty*R*0.3],[mx+nx*off,my+ny*off]],{seed:o.seed+7+Math.round(f*10),passes:1,width:0.9*d,color:fogged(cfg.rep.fill==='ink colour'?mix(col,P.hatch,0.4):P.hatch,fog),alpha:0.35*S.shading*(0.5+0.5*fk),ampScale:0.5,step:5,overshoot:false})}
    ctx.restore()}
  ctx.restore();
}
function drawHBond(ctx,ax,ay,bx,by,o){
  const L=Math.hypot(bx-ax,by-ay);const ux=(bx-ax)/L,uy=(by-ay)/L;const rng=mulberry32(o.seed);const r=o.r||0.9,gap=o.gap||5.5;
  ctx.save();ctx.fillStyle=rgba(o.color,o.alpha);
  for(let s=r+1;s<L-r;s+=gap){const j=(rng()-0.5)*0.8;ctx.beginPath();ctx.arc(ax+ux*s-uy*j,ay+uy*s+ux*j,r,0,Math.PI*2);ctx.fill()}
  ctx.restore();
}

/* ---- sticks representation ---- */
/* Engraved sticks (engraved cartoon with a line medium: ink, ink colour, chalk): the ribbons' grammar on a bond. Each
   half-stick is paper with lines running along it in its atom's colour (in black ink, the element shows as line
   density: C 2, N 3, O 4, S 5), long edges inked, a round cap on a terminal atom. Site sticks are larger, tinted with
   their colour, and knocked out of what lies behind by a paper halo. */
/* the engraved grammar's colours in each medium: a face's fill, its lines, its narrow sides. Ink leaves the face paper and
   puts colour (or black) in the lines; chalk does the same on the board; watercolour, pencil and wash lay a pale wash of
   the colour under darker lines; flat fills solid */
function engraveTone(col){const P=cfg.palette,mode=cfg.rep.fill;
  if(mode==='ink')return{fill:null,hatch:P.hatch,side:P.ink,coil:null,mono:true};
  if(mode==='ink colour')return{fill:null,hatch:col,side:mix(col,P.ink,0.3),coil:null,coilLine:true}; // colour only in the lines
  if(mode==='chalk')return{fill:null,hatch:col,side:mix(col,P.paper,0.25),coil:null,coilLine:true}; // chalk: the board is the face, the colour goes down as chalk lines
  if(mode==='flat')return{fill:col,hatch:mix(col,P.ink,0.6),side:mix(col,P.ink,0.72),coil:col};
  return{fill:mix(col,P.paper,0.55),hatch:mix(col,P.ink,0.5),side:mix(col,P.ink,0.68),coil:mix(col,P.paper,0.55)}}
/* sticks in the engraved grammar: always (stickStyle 'engraved'), never ('sketch'), or with engraved ribbons ('auto', the
   default), so a protein's side chains match its ribbons while a mechanism drawn only in sticks keeps its hand */
const engravedSticks=()=>{const s=cfg.rep.stickStyle||'auto';if(s==='sketch')return false;if(s==='engraved')return true;
  return cfg.rep.cartoonStyle==='engraved'&&!!(scene&&scene.reps&&(scene.reps.cartoon||'').trim())};
function drawEngravedHalfStick(ctx,x0,y0,x1,y1,R,col,o){
  const P=cfg.palette,S=cfg.style;const Rm=o.Rm??R;const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,nx=-uy,ny=ux;
  const fog=o.fog||0,fk=1-fog*cfg.view.fog;const ink=fogged(P.ink,fog);const mono=cfg.rep.fill==='ink';
  const q=[[x0+nx*R,y0+ny*R],[x1+nx*Rm,y1+ny*Rm],[x1-nx*Rm,y1-ny*Rm],[x0-nx*R,y0-ny*R]];
  const path=()=>{ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);ctx.lineTo(q[1][0],q[1][1]);ctx.lineTo(q[2][0],q[2][1]);ctx.lineTo(q[3][0],q[3][1]);
    if(o.cap)ctx.arc(x0,y0,R,Math.atan2(-ny,-nx),Math.atan2(ny,nx),true);ctx.closePath()};
  const wInk=S.inkWidth*LW.outer*(o.site?1.2:0.85)*(0.8+0.2*fk);
  ctx.save();ctx.globalAlpha=o.alpha??1;ctx.lineJoin='round';ctx.lineCap='round';
  const T=engraveTone(col);path();ctx.fillStyle=T.fill?fogged(o.site?mix(T.fill,col,0.35):T.fill,fog):o.site?fogged(mix(P.paper,col,mono?0.12:0.2),fog):paperFill();ctx.fill();
  const n=o.inner?1:mono?({C:2,N:3,O:4,S:5,P:4,H:1}[o.el]||2):(o.el==='H'?1:3);const lw=Math.max(0.5,(cfg.rep.engraveWidth??0.45)*(o.site?1.5:1.15)*(o.d||1));
  ctx.lineWidth=Math.min(lw,2*R/(n+1)*0.6);ctx.strokeStyle=fogged(T.hatch,fog);ctx.beginPath();
  for(let k=1;k<=n;k++){const f=2*k/(n+1)-1;ctx.moveTo(x0+nx*R*f*0.8,y0+ny*R*f*0.8);ctx.lineTo(x1+nx*Rm*f*0.8,y1+ny*Rm*f*0.8)}ctx.stroke();
  ctx.lineWidth=wInk;ctx.strokeStyle=ink;ctx.beginPath();ctx.moveTo(q[0][0],q[0][1]);ctx.lineTo(q[1][0],q[1][1]);ctx.moveTo(q[3][0],q[3][1]);ctx.lineTo(q[2][0],q[2][1]);
  if(o.cap){ctx.moveTo(q[3][0],q[3][1]);ctx.arc(x0,y0,R,Math.atan2(-ny,-nx),Math.atan2(ny,nx),true)}ctx.stroke();ctx.restore();
}
/* the active site (cfg.rep.siteSel): its atoms are always sticks, larger; ribbon faces in front of it fade in a window
   round it (siteCutaway) and the rest of the protein can be quieted (siteQuiet) so the site reads first */
let SITE=null;
function siteFade(cx,cy,z){if(!SITE)return 1;let a=1-0.55*SITE.quiet;
  if(SITE.cut&&z>SITE.z){const d=Math.hypot(cx-SITE.x,cy-SITE.y);a*=1-0.88*clamp((SITE.r*1.3-d)/(SITE.r*0.55),0,1)}return a}
function buildSticks(items,st,pos,atoms,bonds,proj,seedBase,lowDetail){
  const P=cfg.palette,SH=cfg.show;const R0=cfg.rep.stickRadius*proj.pxPerA;
  const inSet={};for(const a of atoms)inSet[a.id]=a;
  const nb={};for(const b of bonds){if(!inSet[b.a]||!inSet[b.b]||b.order===0)continue;nb[b.a]=(nb[b.a]||0)+1;nb[b.b]=(nb[b.b]||0)+1}
  for(const b of bonds){
    const A=inSet[b.a],B=inSet[b.b];if(!A||!B)continue;const pa=pos[b.a],pb=pos[b.b];
    const seed=seedBase+strHash(bkey(b.a,b.b));
    if(b.order===0){if(!SH.hbonds)continue;const z=(pa.z+pb.z)/2;const fog=(pa.fog+pb.fog)/2;
      items.push({z,draw:(ctx)=>{const ra=atomDrawR(A,proj)*pa.d,rb=atomDrawR(B,proj)*pb.d;const dx=pb.x-pa.x,dy=pb.y-pa.y,L=Math.hypot(dx,dy)||1;
        drawHBond(ctx,pa.x+dx/L*(ra+2),pa.y+dy/L*(ra+2),pb.x-dx/L*(rb+2),pb.y-dy/L*(rb+2),{seed,color:fogged(luminance(P.paper)>0.5?P.hatch:P.ink,fog),alpha:0.8*b.alpha*(1-fog*cfg.view.fog*0.5),r:R0*0.5*((pa.d+pb.d)/2),gap:R0*1.5})}});continue}
    const mx=(pa.x+pb.x)/2,my=(pa.y+pb.y)/2;
    const dx=pb.x-pa.x,dy=pb.y-pa.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
    // valence: the main stick stays full width; extra order is a shorter, thinner inner stick on the crowded side (ring interior / substituent side)
    const extra=SH.valence?clamp(b.order-1,0,2):0;
    let side=1;
    if(extra>0.01){let sx=0,sy=0;for(const o of bonds){if(o.order===0||o===b)continue;let other=null,base=null;if(o.a===b.a||o.a===b.b){other=o.b;base=o.a}else if(o.b===b.a||o.b===b.b){other=o.a;base=o.b}
        if(!other||!pos[other]||!inSet[other])continue;sx+=pos[other].x-pos[base].x;sy+=pos[other].y-pos[base].y}
      const cr=ux*sy-uy*sx;side=cr>=0?1:-1}
    if(isInk()&&A.el!==B.el){const zm=(pa.z+pb.z)/2;items.push({z:zm-0.0015,draw:(ctx)=>{const Rm=R0*(pa.d+pb.d)/2;const fog=(pa.fog+pb.fog)/2;
      ctx.save();ctx.globalAlpha=b.alpha;sketchLine(ctx,[[mx-uy*Rm*0.95,my+ux*Rm*0.95],[mx+uy*Rm*0.95,my-ux*Rm*0.95]],{seed:seed+55,passes:1,width:cfg.style.inkWidth*0.7*LW.inner,color:fogged(P.ink,fog),alpha:0.7,ampScale:0.4,step:4,overshoot:false});ctx.restore()}})}
    for(const [near,far,atom,half] of[[pa,pb,A,0],[pb,pa,B,1]]){
      const site=!!(A._site&&B._site),ks=site?(cfg.rep.siteScale||1.9):1;
      items.push({z:near.z-0.002,draw:(ctx)=>{const col=atomColor(atom);
        const R=R0*near.d*ks,Rm=R0*(near.d+far.d)/2*ks;
        if(engravedSticks())drawEngravedHalfStick(ctx,near.x,near.y,mx,my,R,col,{Rm,el:atom.el,fog:near.fog,d:near.d,alpha:b.alpha,site,cap:(nb[atom.id]||0)===1&&!atom.sphere});
        else drawHalfStick(ctx,near.x,near.y,mx,my,R,col,{Rm,el:atom.el,seed:seed+half*3,fog:near.fog,d:near.d,alpha:b.alpha,partial:b.partial,passes:lowDetail?1:undefined});
        if(extra>0.01&&!(b.partial>0&&b.partial<1)){ // inner valence stick(s)
          const frac=Math.min(1,extra);const off=R0*1.95*near.d*side*frac;const r2=R0*0.42*near.d*(0.5+0.5*frac);
          const sh=0.18; // shorten toward the atom so it does not poke out of the junction
          const ax=near.x+ux*L*sh*(half?-1:1),ay=near.y+uy*L*sh*(half?-1:1);
          if(engravedSticks())drawEngravedHalfStick(ctx,ax-uy*off,ay+ux*off,mx-uy*off,my+ux*off,r2*ks,col,{Rm:r2*ks,el:atom.el,fog:near.fog,d:near.d,alpha:b.alpha*frac,site,inner:true});
          else drawHalfStick(ctx,ax-uy*off,ay+ux*off,mx-uy*off,my+ux*off,r2,col,{Rm:r2,el:atom.el,seed:seed+half*3+101,fog:near.fog,d:near.d,alpha:b.alpha*frac,partial:0,passes:1,noShadow:true,inner:true});
          if(extra>1.01){const off2=-off;drawHalfStick(ctx,ax-uy*off2,ay+ux*off2,mx-uy*off2,my+ux*off2,r2,col,{Rm:r2,seed:seed+half*3+202,fog:near.fog,d:near.d,alpha:b.alpha*(extra-1),partial:0,passes:1,noShadow:true})}
        }}});
    }
  }
  if(SITE){const ks=cfg.rep.siteScale||1.9;const sb=bonds.filter(b=>b.order!==0&&inSet[b.a]&&inSet[b.b]&&inSet[b.a]._site&&inSet[b.b]._site);const sa=atoms.filter(a=>a._site);
    items.push({z:SITE.zmin-0.01,draw:(ctx)=>{ctx.save();ctx.strokeStyle=cfg.palette.paper;ctx.fillStyle=cfg.palette.paper;ctx.lineCap='round';
      for(const b of sb){const pa=pos[b.a],pb=pos[b.b];const R=R0*ks*(pa.d+pb.d)/2;ctx.globalAlpha=b.alpha;ctx.lineWidth=2*(R+Math.max(2.5,R*0.6));ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke()}
      for(const a of sa){const p=pos[a.id];const R=R0*ks*p.d;ctx.globalAlpha=a.alpha;ctx.beginPath();ctx.arc(p.x,p.y,R+Math.max(2.5,R*0.6),0,Math.PI*2);ctx.fill()}ctx.restore()}})}
  for(const a of atoms){const p=pos[a.id];const seed=seedBase+strHash(a.id);const cnt=nb[a.id]||0;const col=atomColor(a);
    if(a.sphere||cnt===0){const r=(cnt===0&&!a.sphere?R0*1.7:atomDrawR(a,proj))*p.d;
      items.push({z:p.z+0.003,draw:(ctx)=>drawFlatBall(ctx,p.x,p.y,r,col,{seed,el:a.el,fog:p.fog,d:p.d,alpha:a.alpha,passes:lowDetail?1:undefined})})}
    else if(cnt>=2){const R=R0*p.d*(a._site?(cfg.rep.siteScale||1.9):1);
      if(engravedSticks()){const site=!!a._site;items.push({z:p.z+0.001,draw:(ctx)=>{const P2=cfg.palette;ctx.save();ctx.globalAlpha=a.alpha;const fk=1-p.fog*cfg.view.fog;
        const T=engraveTone(col);ctx.beginPath();ctx.arc(p.x,p.y,R,0,Math.PI*2);ctx.fillStyle=T.fill?fogged(site?mix(T.fill,col,0.35):T.fill,p.fog):site?fogged(mix(P2.paper,col,cfg.rep.fill==='ink'?0.12:0.2),p.fog):paperFill();ctx.fill();
        ctx.lineWidth=cfg.style.inkWidth*LW.outer*(site?1.2:0.85)*(0.8+0.2*fk);ctx.strokeStyle=fogged(P2.ink,p.fog);ctx.stroke();ctx.restore()}});continue}
      items.push({z:p.z-0.004,draw:(ctx)=>{ctx.save();ctx.globalAlpha=a.alpha;sketchCircle(ctx,p.x,p.y,R,{seed:seed+4,width:cfg.style.inkWidth*p.d*(0.75+0.25*(1-p.fog*cfg.view.fog))*LW.outer,color:fogged(P.ink,p.fog),alpha:0.55+0.4*(1-p.fog*cfg.view.fog),passes:lowDetail?1:undefined});ctx.restore()}});
      items.push({z:p.z+0.001,draw:(ctx)=>{ctx.save();ctx.globalAlpha=a.alpha;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0,R-0.6),0,Math.PI*2);ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=fogged(fillFor(col),p.fog);ctx.fill()}if(isWC()){const q=[];for(let i=0;i<10;i++){const an=i/10*Math.PI*2;q.push([p.x+Math.cos(an)*(R-0.8),p.y+Math.sin(an)*(R-0.8)])}watercolourShape(ctx,q,col,seed,{fog:p.fog,layers:5,strength:0.7,granulate:false})}
      if(isInk()){ctx.save();ctx.clip();if(isPencil())scribbleFill(ctx,p.x-R,p.y-R,p.x+R,p.y+R,col,seed,{fog:p.fog,d:p.d});penSphere(ctx,p.x,p.y,R,col,a.el,seed,{fog:p.fog,d:p.d});ctx.restore()}ctx.restore()}});
    }
  }
}
/* ---- ball and stick representation (pencil balls) ---- */
function buildBallStick(items,st,pos,atoms,bonds,proj,seedBase,lowDetail){
  const P=cfg.palette,S=cfg.style,SH=cfg.show;
  const inSet={};for(const a of atoms)inSet[a.id]=a;
  for(const b of bonds){const A=inSet[b.a],B=inSet[b.b];if(!A||!B)continue;if(b.order===0&&!SH.hbonds)continue;
    const pa=pos[b.a],pb=pos[b.b];const seed=seedBase+strHash(bkey(b.a,b.b));
    for(const half of[0,1]){const near=half?pb:pa,far=half?pa:pb,nearAtom=half?B:A;
      items.push({z:lerp(near.z,far.z,0.25)-0.001,draw:(ctx)=>{
        const ra=atomDrawR(A,proj)*pa.d,rb=atomDrawR(B,proj)*pb.d;const dx=pb.x-pa.x,dy=pb.y-pa.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
        const gap=1.5;const ax=pa.x+ux*(ra+gap),ay=pa.y+uy*(ra+gap),bx=pb.x-ux*(rb+gap),by=pb.y-uy*(rb+gap);if(Math.hypot(bx-ax,by-ay)<2)return;
        const mx=(pa.x+pb.x)/2,my=(pa.y+pb.y)/2;const side=half===0?-1:1;const R=4000;
        ctx.save();ctx.beginPath();ctx.moveTo(mx-uy*R,my+ux*R);ctx.lineTo(mx+uy*R,my-ux*R);ctx.lineTo(mx+uy*R+ux*side*R,my-ux*R+uy*side*R);ctx.lineTo(mx-uy*R+ux*side*R,my+ux*R+uy*side*R);ctx.closePath();ctx.clip();
        const fog=near.fog,fk=1-fog*cfg.view.fog;
        const inkCol=SH.colorBonds?fogged(mix(atomColor(nearAtom),P.ink,0.35),fog):fogged(P.ink,fog);
        if(b.order===0){drawHBond(ctx,ax,ay,bx,by,{seed,color:fogged(P.ink,fog),alpha:0.55*b.alpha*(0.5+0.5*fk)});ctx.restore();return}
        const wk=S.bondWidth*(proj.pxPerA/48)*(0.8+0.2*fk);const w=wk*pa.d,wEnd=wk*pb.d;
        const o={seed,width:w,widthEnd:wEnd,color:inkCol,alpha:b.alpha*(0.6+0.4*fk),partial:b.partial,passes:lowDetail?1:undefined};
        const nFull=Math.max(1,Math.floor(b.order+1e-6)),frac=b.order-nFull,n=nFull+(frac>0.01?1:0);
        if(n===1)drawBondLine(ctx,ax,ay,bx,by,o);
        else{const off=(w+2.4)*0.55*(n-1)*(nFull>1?1:frac);for(let k=0;k<n;k++){const s=-off+k*(off*2/(n-1));drawBondLine(ctx,ax-uy*s,ay+ux*s,bx-uy*s,by+ux*s,{...o,seed:seed+k*101,alpha:o.alpha*(k>=nFull?frac:1)})}}
        ctx.restore()}})}
  }
  for(const a of atoms){const p=pos[a.id];const r=atomDrawR(a,proj)*p.d;const seed=seedBase+strHash(a.id);
    items.push({z:p.z,draw:(ctx)=>drawBall(ctx,p.x,p.y,r,{...a,d:p.d,fog:p.fog},seed,lowDetail)})}
}
/* ---- surface representation: outlined discs, back to front ---- */
/* a coarse depth map of a surface's discs: the nearest z in each 2 px cell (z grows towards the viewer, in Å); returns
   a lookup (-1e9 where there is no surface) */
function depthMap(discs,W,H){
  const cs=2,gw=Math.ceil(W/cs)+2,gh=Math.ceil(H/cs)+2,zb=new Float32Array(gw*gh).fill(-1e9);
  for(const d of discs){const r=d.r,r2=r*r,gx0=Math.max(0,Math.floor((d.x-r)/cs)),gx1=Math.min(gw-1,Math.ceil((d.x+r)/cs)),gy0=Math.max(0,Math.floor((d.y-r)/cs)),gy1=Math.min(gh-1,Math.ceil((d.y+r)/cs));
    for(let gy=gy0;gy<=gy1;gy++){const dy=gy*cs-d.y;for(let gx=gx0;gx<=gx1;gx++){const dx=gx*cs-d.x;if(dx*dx+dy*dy<=r2){const i=gy*gw+gx;if(d.z>zb[i])zb[i]=d.z}}}}
  return (px,py)=>{const gx=Math.round(px/cs),gy=Math.round(py/cs);return gx<0||gy<0||gx>=gw||gy>=gh?-1e9:zb[gy*gw+gx]};
}
/* how deep in a groove a patch lies, 0..1: how much nearer surface surrounds it, from 16 samples on two rings */
function grooveOf(p,zAt,occR){
  let s=0;for(let i=0;i<16;i++){const an=i*Math.PI/4+(i>7?Math.PI/8:0),rr=occR*(i>7?1:0.55);const z=zAt(p.x+Math.cos(an)*rr,p.y+Math.sin(an)*rr);if(z>-1e8)s+=clamp((z-p.z-1)/8,0,1)}
  return clamp(s/16*1.25,0,1);
}
/* an ink edge along the part of a surface patch that stands in front of something much farther back (or of nothing):
   sampled just outside each hull vertex in the depth map, drawn as hand lines, heavier for a deeper step (Goodsell's
   outlines, which make the form read without any lighting) */
function surfaceEdge(ctx,p,zAt,color,amt,seed,wk=1){
  const h=p.h,n=h.length;if(n<3)return;const gap=new Float32Array(n);
  for(let i=0;i<n;i++){const q=h[i],dx=q[0]-p.x,dy=q[1]-p.y,L=Math.hypot(dx,dy)||1;const z=zAt(q[0]+dx/L*3,q[1]+dy/L*3);gap[i]=z<-1e8?1:clamp((p.z-z-1.5)/6.5,0,1)}   // a step from 1.5 Å, full weight by 8 Å
  // runs of consecutive edge vertices, walked from a vertex that is not on an edge (or the whole loop, if all are)
  const on=i=>gap[i%n]>=0.15;let start=0;while(start<n&&on(start))start++;
  const runs=[];
  if(start===n)runs.push([...h,h[0]]);
  else{let cur=null;for(let k=1;k<=n;k++){const i=(start+k)%n;if(on(i)){if(!cur){cur=[];runs.push(cur)}cur.push(h[i])}else cur=null}}
  let r=0;for(const run of runs){if(run.length<2)continue;let g=0;for(const q of run)g+=gap[h.indexOf(q)];g/=run.length;
    sketchLine(ctx,run,{seed:seed+71+r++,passes:1,width:(0.45+1.1*g)*wk,color,alpha:clamp(0.2+0.6*g,0,1)*amt,ampScale:0.5,step:3,overshoot:false})}
}
const inHull=(h,x,y)=>{let s=0;for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length];const c=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);if(c!==0){if(s===0)s=Math.sign(c);else if(Math.sign(c)!==s)return false}}return true};
/* ---- surfaces: a model, the depth cues on it, and a painter per medium ----
   surfaceModel builds the geometry (one patch per residue: the hull of its atoms' discs); applyDepthCues works out, as
   numbers on each patch, how deep in a groove it lies, how far into the fog it is, and the depth map its edges are
   found in; each painter shows those numbers in its own medium. The cues are data, not a filter on the picture: a
   painter decides whether a groove means more pigment, denser hatching or heavier scribble. */
function surfaceColour(){
  const P=cfg.palette,mode=cfg.rep.surfaceColor;
  return a=>ownColor(a)||(mode==='single'?P.surface:mode==='chain'?chainColor(a):mode==='subunit'?subunitColor(a):mode==='entity'?entityColor(a):mode==='carbon'?carbonColor(a):mix(atomColor(a),'#ffffff',0.2));
}
/** the surface's discs (an atom's van der Waals radius plus half the probe) and its residue patches, in model order;
   a patch keeps its first atom, and each painter asks for its colour when it always has */
const DISC10C=[],DISC10S=[];for(let i=0;i<10;i++){const an=i/10*Math.PI*2;DISC10C.push(Math.cos(an));DISC10S.push(Math.sin(an))}
/* the points that can be on a set's convex hull: those not strictly inside the octagon of its extreme points (the
   hull is the same, found from far fewer points) */
function hullCandidates(pts){const ex=[pts[0],pts[0],pts[0],pts[0],pts[0],pts[0],pts[0],pts[0]];
  for(const p of pts){const x=p[0],y=p[1];if(x<ex[0][0])ex[0]=p;if(x+y<ex[1][0]+ex[1][1])ex[1]=p;if(y<ex[2][1])ex[2]=p;if(x-y>ex[3][0]-ex[3][1])ex[3]=p;if(x>ex[4][0])ex[4]=p;if(x+y>ex[5][0]+ex[5][1])ex[5]=p;if(y>ex[6][1])ex[6]=p;if(y-x>ex[7][1]-ex[7][0])ex[7]=p}
  const oct=[];for(const p of ex)if(!oct.length||oct[oct.length-1]!==p)oct.push(p);if(oct.length>1&&oct[0]===oct[oct.length-1])oct.pop();if(oct.length<3)return pts;
  let area=0;for(let i=0;i<oct.length;i++){const a=oct[i],b=oct[(i+1)%oct.length];area+=a[0]*b[1]-b[0]*a[1]}if(Math.abs(area)<1e-6)return pts;const sg=area>0?1:-1,eps=1e-6*Math.abs(area);
  const out=[];for(const p of pts){let inside=true;for(let i=0;i<oct.length&&inside;i++){const a=oct[i],b=oct[(i+1)%oct.length];if(sg*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))<=eps)inside=false}if(!inside)out.push(p)}
  return out}
function surfaceModel(atoms,pos,proj){
  const probe=cfg.rep.probe;
  const discs=atoms.map(a=>{const p=pos[a.id];return{x:p.x,y:p.y,r:((VDW[a.el]||1.7)+probe*0.55)*proj.pxPerA*p.d*cfg.rep.surfaceScale,z:p.z,d:p.d,fog:p.fog,alpha:a.alpha,a}});
  const groups={};for(const d of discs){const k=(d.a.chain||'')+'/'+(d.a.resi??d.a.id);(groups[k]=groups[k]||[]).push(d)}
  const patches=[];
  for(const k in groups){const g=groups[k];const pts=[];let z=0,px=0,py=0,dd=0;for(const d of g){for(let i=0;i<10;i++){pts.push([d.x+DISC10C[i]*d.r,d.y+DISC10S[i]*d.r])}z+=d.z;px+=d.x;py+=d.y;dd+=d.d}
    const h=hull(pts.length>40?hullCandidates(pts):pts);if(h.length<3)continue;
    patches.push({h,k,z:z/g.length,x:px/g.length,y:py/g.length,d:dd/g.length,fog:g.reduce((s,d)=>s+d.fog,0)/g.length,alpha:Math.max(...g.map(d=>d.alpha)),a:g[0].a})}
  return {discs,patches,proj};
}
/** the depth cues, from the strengths in cfg.rep (surfEdges, surfPool, surfFade: 0 off … 1): on each patch `groove`
   (0..1, how much nearer surface surrounds it) and `fade` (0..1, its strength times its depth fog), and on the model
   the strengths and the depth map `zAt` the edges are found in (null when neither edges nor pooling need it) */
function applyDepthCues(model){
  const edges=cfg.rep.surfEdges||0,pooling=cfg.rep.surfPool||0,fade=cfg.rep.surfFade||0;
  model.cues={edges,pooling,fade,any:edges>0||pooling>0||fade>0};
  model.zAt=edges>0||pooling>0?depthMap(model.discs,RF.W,RF.H):null;
  const occR=9*model.proj.pxPerA;
  for(const p of model.patches){p.groove=pooling>0?grooveOf(p,model.zAt,occR):0;p.fade=fade*p.fog}
  return model;
}
function buildSurface(items,st,pos,atoms,proj,seedBase,lowDetail){
  const cues=(cfg.rep.surfEdges||0)>0||(cfg.rep.surfPool||0)>0||(cfg.rep.surfFade||0)>0;
  if(!isWC()&&!cues)return paintAtomSurface(items,atoms,pos,proj,seedBase,lowDetail);   // no depth asked for: the old ball per atom
  if(!atoms.length)return;
  const model=applyDepthCues(surfaceModel(atoms,pos,proj));
  if(isWC())paintWatercolourSurface(items,model,seedBase);else paintPatchSurface(items,model,seedBase);
}

/* watercolour: one continuous wash over the whole surface, ring only on the silhouette. Patches back to front, each
   erasing what lies behind it, then washed in a tone set by the light, the groove and the fade; grooves take more of
   the same pigment and granulate, edges are drying-ring lines */
function paintWatercolourSurface(items,model,seedBase){
  const P=cfg.palette,{discs,patches}=model;
  const zMean=discs.reduce((s,d)=>s+d.z,0)/discs.length;
  items.push({z:zMean,draw:(ctx)=>{
    const W=RF.W,H=RF.H,dpr=RF.dpr;const off=document.createElement('canvas');off.width=Math.round(W*dpr);off.height=Math.round(H*dpr);const x=off.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
    const colFor=surfaceColour();for(const p of patches)p.col=colFor(p.a);
    patches.sort((a,b)=>a.z-b.z);
    let zmin=1e9,zmax=-1e9,xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;for(const p of patches){zmin=Math.min(zmin,p.z);zmax=Math.max(zmax,p.z);xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y)}
    const zs=Math.max(1e-6,zmax-zmin);const la=cfg.style.lightAngle*Math.PI/180;const lx=Math.cos(la),ly=Math.sin(la);const R=Math.max(xmax-xmin,ymax-ymin)/2||1;const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
    const many=cfg.rep.detail!=='full'&&patches.length>600;
    const {edges:EDG,pooling:POOL,fade:FADE,any}=model.cues,zAt=model.zAt,paperW=luminance(P.paper)>0.5?'#ffffff':'#000000';
    const hid=hiddenPatches(patches,RF.W,RF.H);let pi=-1;
    for(const p of patches){pi++;if(hid[pi])continue;const depth=(zmax-p.z)/zs;const lit=((p.x-cx)*lx+(p.y-cy)*ly)/R; // lit>0 faces the light
      let tone=clamp(0.3+0.6*depth-0.2*lit,0.15,1),col=p.col,layers=many?3:5;const occ=p.groove,fade=p.fade;
      if(any){
        // tone: the light and the grooves decide it (not raw depth, which the fade now carries)
        tone=clamp(0.42+0.18*depth*(1-FADE)-0.2*lit+0.32*POOL*occ,0.15,1)*(1-0.45*fade);
        if(POOL>0)col=mix(col,'#000000',0.22*POOL*occ);   // the same pigment, more of it: darker, not greyer
        if(fade>0)col=mix(col,paperW,0.55*fade);
        if(fade>0.5)layers=3}
      x.save();x.globalAlpha=p.alpha;x.beginPath();p.h.forEach((q,i)=>i?x.lineTo(q[0],q[1]):x.moveTo(q[0],q[1]));x.closePath();x.fillStyle='#ffffff';x.globalCompositeOperation='destination-out';x.fill();x.globalCompositeOperation='source-over';
      const seed=seedBase+strHash('su'+p.k);
      watercolourShape(x,p.h,col,seed,{fog:0,layers,strength:tone,offscreen:true,granulate:false,noRing:many&&depth<0.15});
      if(EDG>0)surfaceEdge(x,p,zAt,mix(p.col,shadeInk(),0.55),EDG*(1-0.7*fade),seed);
      if(POOL>0&&occ>0.3){ // pigment settles in the grooves: granulation inside the patch
        const rng=mulberry32(seed+31);let bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;for(const q of p.h){bx0=Math.min(bx0,q[0]);by0=Math.min(by0,q[1]);bx1=Math.max(bx1,q[0]);by1=Math.max(by1,q[1])}
        const n=Math.round((bx1-bx0)*(by1-by0)*0.012*POOL*(occ-0.3));
        const pts=[];for(let i=0;i<n;i++){const gx=bx0+rng()*(bx1-bx0),gy=by0+rng()*(by1-by0),ga=0.12+rng()*0.2;if(!inHull(p.h,gx,gy))continue;pts.push([gx,gy,ga])}grains(x,pts,mix(col,'#000000',0.4))}
      x.restore()}
    // silhouette: union of discs minus the same union eroded → a band along the outer edge
    const mask=document.createElement('canvas');mask.width=off.width;mask.height=off.height;const mx=mask.getContext('2d',{willReadFrequently:true});mx.scale(dpr,dpr);
    // (each union one path, filled once: a disc at a time was two draws per atom, 440 000 for a ribosome)
    const rim=unionDiscs(discs,0),core=unionDiscs(discs,2.2);   // (the discs each union needs: most of a large assembly's are inside others)
    mx.fillStyle=mix(P.surface,shadeInk(),0.35);mx.beginPath();for(const d of rim){mx.moveTo(d.x+d.r,d.y);mx.arc(d.x,d.y,d.r,0,Math.PI*2)}mx.fill();
    mx.globalCompositeOperation='destination-out';mx.beginPath();for(const d of core){const r=d.r-2.2;mx.moveTo(d.x+r,d.y);mx.arc(d.x,d.y,r,0,Math.PI*2)}mx.fill();
    x.save();x.globalAlpha=0.55;x.drawImage(mask,0,0,W,H);x.restore();
    // granulation over the whole surface
    const rng=mulberry32(seedBase+7);x.save();x.beginPath();for(const d of rim){x.moveTo(d.x+d.r,d.y);x.arc(d.x,d.y,d.r,0,Math.PI*2)}x.clip();
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const d of discs){x0=Math.min(x0,d.x-d.r);y0=Math.min(y0,d.y-d.r);x1=Math.max(x1,d.x+d.r);y1=Math.max(y1,d.y+d.r)}
    const g=Math.round((x1-x0)*(y1-y0)*0.0025),gp=[];for(let i=0;i<g;i++){const a=0.1+rng()*0.2;gp.push([x0+rng()*(x1-x0),y0+rng()*(y1-y0),a])}grains(x,gp,mix(P.surface,shadeInk(),0.4));x.restore();
    // paper under the surface, then the wash multiplied once, then a sketched silhouette line
    ctx.save();ctx.globalAlpha=cfg.rep.surfaceOpacity;ctx.beginPath();for(const d of rim){ctx.moveTo(d.x+d.r,d.y);ctx.arc(d.x,d.y,d.r,0,Math.PI*2)}ctx.fillStyle=paperFill();ctx.fill();
    ctx.globalCompositeOperation=luminance(P.paper)>0.5?'multiply':'screen';ctx.drawImage(off,0,0,W,H);ctx.restore();
    ctx.save();ctx.globalAlpha=cfg.rep.surfaceOpacity*0.7;ctx.globalCompositeOperation=luminance(P.paper)>0.5?'multiply':'screen';ctx.drawImage(mask,0,0,W,H);ctx.restore();
  }});
}

/* the other fills: each patch an item in the painter's list, opaque, drawn as its fill draws (flat and wash: a tone;
   pencil and chalk: scribbles; ink: hatching), darker and denser in the grooves, fading with the depth fog, and edged
   in ink where it stands in front of something farther back */
function paintPatchSurface(items,model,seedBase){
  const P=cfg.palette,S=cfg.style,{patches,zAt}=model,{edges:EDG,pooling:POOL}=model.cues;
  const colFor=surfaceColour(),ink=isInk(),chalk=isChalk(),pencil=cfg.rep.fill==='pencil';
  const la=S.lightAngle*Math.PI/180,lx=Math.cos(la),ly=Math.sin(la);
  let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;
  for(const p of patches){p.col=colFor(p.a);xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y)}
  const R=Math.max(xmax-xmin,ymax-ymin)/2||1,cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
  // each patch lays paper over its shape: those wholly under nearer patches need not be drawn
  const order=[...patches].sort((a,b)=>a.z-b.z),hid=hiddenPatches(order,RF.W,RF.H,0.04),hidden=new Set(order.filter((p,k)=>hid[k]));
  for(const p of patches){if(hidden.has(p))continue;
    const seed=seedBase+strHash('sp'+p.k),occ=p.groove*POOL,fade=p.fade,fk=1-fade;
    const lit=((p.x-cx)*lx+(p.y-cy)*ly)/R;   // >0 faces the light
    const dark=clamp(0.7*occ+S.shading*0.25*clamp(-lit,0,1),0,1);   // how much shadow the patch holds: grooves, and the side away from the light
    const shape=wcDeform(p.h,1,0.025,mulberry32(seed));   // a hand-cut outline, not a hull
    items.push({z:p.z,draw:(ctx)=>{
      ctx.save();ctx.globalAlpha=p.alpha;const tex=p.d*TEX;
      const path=()=>{ctx.beginPath();shape.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath()};
      path();ctx.fillStyle=paperFill();ctx.fill();   // opaque: what lies behind is hidden
      let col=p.col;if(occ>0)col=mix(col,'#000000',0.22*occ);if(fade>0)col=mix(col,P.paper,0.6*fade);
      if(!ink&&!pencil&&!chalk){ctx.fillStyle=fillFor(mix(col,shadeInk(),0.25*dark*(cfg.rep.fill==='wash'?0.6:1)));path();ctx.fill()}   // flat / wash: a tone
      if(pencil||chalk){ // scribbles, denser in shadow
        if(pencil){ctx.fillStyle=rgba(fillFor(col),0.35*fk);path();ctx.fill()}
        ctx.save();path();ctx.clip();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const q of shape){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1])}
        ctx.globalAlpha=p.alpha*clamp(0.55+0.6*dark,0,1)*(0.45+0.55*fk);scribbleFill(ctx,x0,y0,x1,y1,col,seed,{fog:0,d:p.d});ctx.restore()}
      if(ink||cfg.rep.fill==='flat'&&S.shading>0){ // hatching where there is shadow: one direction, crossed in the deepest grooves
        const amt=ink?dark:dark*0.6;
        const inkColour=cfg.rep.fill==='ink colour';
        if(amt>0.12||inkColour){ // ink colour: the colour lives in the lines, so every patch gets some, the grooves more
          const hc=inkColour?mix(col,P.hatch,0.12):ink?P.hatch:mix(col,P.hatch,0.5),a2=inkColour?Math.max(amt,0.3):amt;
          const sp=S.hatchSpacing*Math.max(0.7,tex)*(1.5-0.7*a2)*(1+0.6*fade),al=clamp(0.25+0.65*a2,0,1)*(0.35+0.65*fk)*(inkColour?1.1:1);
          hatchPatch(ctx,shape,S.hatchAngle*Math.PI/180,sp,{seed:seed+5,width:0.8*tex,color:hc,alpha:al});
          if(a2>0.55)hatchPatch(ctx,shape,S.hatchAngle*Math.PI/180+1.25,sp*1.2,{seed:seed+6,width:0.7*tex,color:hc,alpha:al*0.8})}}
      if(EDG>0)surfaceEdge(ctx,p,zAt,P.ink,EDG*(0.55+0.45*fk),seed,S.inkWidth/1.5*(chalk?1.4:1));
      ctx.restore()}})}
}

/* no depth asked for, in a fill other than watercolour: one outlined, shaded ball per atom */
function paintAtomSurface(items,atoms,pos,proj,seedBase,lowDetail){
  const P=cfg.palette,probe=cfg.rep.probe;
  for(const a of atoms){const p=pos[a.id];const r=((VDW[a.el]||1.7)+probe*0.55)*proj.pxPerA*p.d*cfg.rep.surfaceScale;const seed=seedBase+strHash('s'+a.id);
    const own=ownColor(a),col=own?mix(own,'#ffffff',0.25):cfg.rep.surfaceColor==='single'?P.surface:cfg.rep.surfaceColor==='carbon'?mix(carbonColor(a),'#ffffff',0.25):mix(atomColor(a),'#ffffff',0.3);
    items.push({z:p.z+0.02,draw:(ctx)=>drawFlatBall(ctx,p.x,p.y,r,col,{seed,fog:p.fog,d:p.d,alpha:a.alpha,fillAlpha:cfg.rep.surfaceOpacity,outlineFirst:true,outlineAlpha:0.6,passes:lowDetail?1:undefined})})}
}

/* parallel hand lines across a polygon, clipped to it */
function hatchPatch(ctx,poly,ang,spacing,o){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const q of poly){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1])}
  const cx=(x0+x1)/2,cy=(y0+y1)/2,R=Math.hypot(x1-x0,y1-y0)/2+2,dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx,rng=mulberry32((o.seed|0)+17);
  ctx.save();ctx.beginPath();poly.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();ctx.clip();
  for(let s=-R+spacing*rng();s<R;s+=spacing*(0.85+0.3*rng()))sketchLine(ctx,[[cx+nx*s-dx*R,cy+ny*s-dy*R],[cx+nx*s+dx*R,cy+ny*s+dy*R]],{seed:(o.seed|0)+Math.round(s*10),passes:1,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,step:5,overshoot:false});
  ctx.restore();
}

/* ---- density maps ----
   A cryo-EM map (scene.map, made ready by the app's classic/mapprep.ts: isosurfaces in the drawing's frame, each vertex
   tied to its nearest model atom, and the local resolution) drawn in the look's medium. The isosurface is rasterised
   into a depth and triangle buffer; silhouettes are found on the mesh itself (where the surface turns away from the
   eye) and kept where the buffer says they are seen; regions (one per colour, and the shadow bands) are traced from the
   buffers into hand-cut polygons; then each medium draws them: washes and shadow glazes in watercolour, hatching in ink,
   tones in flat, scribbles in pencil and chalk. The line loosens where the local resolution is worse. */
function mapRaster(L,px,py,pz,W,H){
  const zb=new Float32Array(W*H).fill(-1e9),tb=new Int32Array(W*H).fill(-1),tri=L.tri;
  for(let t=0;t<tri.length;t+=3){const a=tri[t],b=tri[t+1],c=tri[t+2];
    const ax=px[a],ay=py[a],bx=px[b],by=py[b],cx=px[c],cy=py[c];const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-9)continue;
    const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(W-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(H-1,Math.ceil(Math.max(ay,by,cy)));
    const inv=1/area;
    for(let y=y0;y<=y1;y++){const qy=y+0.5;for(let x=x0;x<=x1;x++){const qx=x+0.5;
      const w0=((bx-qx)*(cy-qy)-(by-qy)*(cx-qx))*inv,w1=((cx-qx)*(ay-qy)-(cy-qy)*(ax-qx))*inv,w2=1-w0-w1;
      if(w0<0||w1<0||w2<0)continue;const z=w0*pz[a]+w1*pz[b]+w2*pz[c],i=y*W+x;if(z>zb[i]){zb[i]=z;tb[i]=t/3}}}}
  return {zb,tb};
}
/* the outlines of a mask (1 inside) by marching squares on pixel centres: closed rings in pixel coordinates, simplified
   (their orientation is arbitrary: fill them even-odd, which also makes holes of the inner ones) */
function maskRings(mask,W,H,x0=0,y0=0,x1=W-1,y1=H-1){
  const pts=[],segA=[],segB=[],keyIx=new Map();
  const id=(x,y)=>{const k=Math.round(x*2)*65536+Math.round(y*2);let i=keyIx.get(k);if(i===undefined){i=pts.length;pts.push([x,y]);keyIx.set(k,i)}return i};
  const at=(x,y)=>x<0||y<0||x>=W||y>=H?0:mask[y*W+x];
  const E={T:(x,y)=>[x+1,y+0.5],R:(x,y)=>[x+1.5,y+1],B:(x,y)=>[x+1,y+1.5],L:(x,y)=>[x+0.5,y+1]};   // edge midpoints of the cell between four pixel centres
  const CASES={1:['LT'],2:['TR'],3:['LR'],4:['RB'],5:['LT','RB'],6:['TB'],7:['LB'],8:['BL'],9:['BT'],10:['TR','BL'],11:['BR'],12:['RL'],13:['RT'],14:['TL']};
  for(let y=y0-1;y<=y1;y++)for(let x=x0-1;x<=x1;x++){
    const idx=at(x,y)|at(x+1,y)<<1|at(x+1,y+1)<<2|at(x,y+1)<<3;if(idx===0||idx===15)continue;
    for(const pq of CASES[idx]){const p=E[pq[0]](x,y),q=E[pq[1]](x,y);segA.push(id(p[0],p[1]));segB.push(id(q[0],q[1]))}}
  const adj=new Map();for(let i=0;i<segA.length;i++)for(const k of [segA[i],segB[i]]){let l=adj.get(k);if(!l)adj.set(k,l=[]);l.push(i)}
  const used=new Uint8Array(segA.length),rings=[];
  for(let s0=0;s0<segA.length;s0++){if(used[s0])continue;used[s0]=1;const start=segA[s0];let cur=segB[s0];const ring=[pts[start]];
    for(let guard=0;guard<4e6&&cur!==start;guard++){ring.push(pts[cur]);const nx=(adj.get(cur)||[]).find(j=>!used[j]);if(nx===undefined)break;used[nx]=1;cur=segA[nx]===cur?segB[nx]:segA[nx]}
    if(ring.length>=3)rings.push(simplifyRing(ring,0.6))}
  return rings.filter(r=>r.length>=3&&Math.abs(ringArea(r))>3);
}
/* corner cutting (Chaikin): a pixel-traced ring or line made smooth */
function chaikin(r,n){let p=r;for(let k=0;k<n;k++){const q=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];q.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25],[a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75])}p=q}return p}
function chaikinOpen(r,n){let p=r;for(let k=0;k<n;k++){const q=[p[0]];for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];q.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25],[a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75])}q.push(p[p.length-1]);p=q}return p}
function ringArea(r){let a=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2}
function simplifyRing(r,eps){ // Douglas–Peucker on an open copy, closed again
  const dp=(pts)=>{if(pts.length<3)return pts;let dm=0,im=0;const a=pts[0],b=pts[pts.length-1],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    for(let i=1;i<pts.length-1;i++){const d=Math.abs((b[0]-a[0])*(a[1]-pts[i][1])-(a[0]-pts[i][0])*(b[1]-a[1]))/L;if(d>dm){dm=d;im=i}}
    if(dm<=eps)return[a,b];const l=dp(pts.slice(0,im+1)),rr=dp(pts.slice(im));return l.slice(0,-1).concat(rr)};
  const h=Math.floor(r.length/2);return dp(r.slice(0,h+1)).slice(0,-1).concat(dp(r.slice(h).concat([r[0]])).slice(0,-1));
}
function ringsPath(ctx,rings){ctx.beginPath();for(const r of rings){r.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath()}}
/* a watercolour wash over rings (holes allowed): the rings deformed and laid down in translucent layers, their edges
   piling into a drying ring (the surface's watercolourShape, for shapes with holes) */
function washRings(ctx,rings,col,seed,o){
  const rng=mulberry32(seed+909),layers=o.layers||5,light=luminance(cfg.palette.paper)>0.5;
  const def=(v,sc)=>rings.map(r=>wcDeform(r,sc>1?2:1,v,rng));
  ctx.save();ctx.globalCompositeOperation=o.offscreen?'source-over':light?'multiply':'screen';
  for(let L=0;L<layers;L++){const lay=def(0.04+rng()*0.05,2);ringsPath(ctx,lay);ctx.fillStyle=rgba(col,(o.strength||0.7)/layers*1.15);ctx.fill('evenodd')}
  if(!o.noRing){const lay=def(0.02,1);ringsPath(ctx,lay);ctx.lineWidth=0.8;ctx.strokeStyle=rgba(mix(col,shadeInk(),0.3),0.22*(o.strength||0.7));ctx.stroke()}
  ctx.restore();
}
function buildMap(items,st,pos,proj,seedBase){
  const M=scene.map,o=M.opts,P=cfg.palette,S=cfg.style,W=Math.max(1,Math.round(RF.W)),H=Math.max(1,Math.round(RF.H));M.contextHidden=false;
  const EDG=cfg.rep.surfEdges||0,POOL=cfg.rep.surfPool||0,FADE=cfg.rep.surfFade||0,ink=cfg.rep.fill==='ink'||cfg.rep.fill==='ink colour',chalk=isChalk(),wc=isWC(),pencil=cfg.rep.fill==='pencil';
  const light=luminance(P.paper)>0.5,inkCol=P.ink,eye=proj.eye();
  // colour classes: the model's colour (by the surface scheme) at each vertex's nearest atom, the accent where the
  // model explains no density (a patch of it, not a speck of noise), or the map's own colour
  const colFor=surfaceColour(),byIndex=scene.atomIds||[],atomsById={};for(const a of st.atoms)atomsById[a.id]=a;
  const classes=[],classIx=new Map();const classOf=c=>{let i=classIx.get(c);if(i===undefined){i=classes.length;classes.push(c);classIx.set(c,i)}return i};
  const mapCol=P.surface,accent=P.accent,contextCol=mix(P.surface,P.paper,0.5);
  const prep=L=>{const n=L.pos.length/3,px=new Float32Array(n),py=new Float32Array(n),pz=new Float32Array(n),fog=new Float32Array(n),rn=new Float32Array(n*3),cls=new Int32Array(n);
    for(let v=0;v<n;v++){const p=proj.proj([L.pos[v*3],L.pos[v*3+1],L.pos[v*3+2]]);px[v]=p.x;py[v]=p.y;pz[v]=p.z;fog[v]=p.fog;
      const r=proj.rot([L.nor[v*3]+FIT.cx,L.nor[v*3+1]+FIT.cy,L.nor[v*3+2]+FIT.cz]);rn[v*3]=r[0];rn[v*3+1]=r[1];rn[v*3+2]=r[2]}
    // unexplained density: connected pieces of surface far from every atom, big enough not to be noise
    const far=new Uint8Array(n);if(M.hasModel)for(let v=0;v<n;v++)far[v]=L.dist[v]>(M.farAt??3.4)?1:0;
    const comp=new Int32Array(n).fill(-1);if(M.hasModel){const par=new Int32Array(n);for(let v=0;v<n;v++)par[v]=v;const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x};
      for(let t=0;t<L.tri.length;t+=3){const a=L.tri[t],b=L.tri[t+1],c=L.tri[t+2];if(far[a]&&far[b])par[find(a)]=find(b);if(far[b]&&far[c])par[find(b)]=find(c);if(far[a]&&far[c])par[find(a)]=find(c)}
      // a piece is unexplained (the accent) when it is big enough not to be noise and small beside the model (a ligand,
      // a loop left out); a piece larger than a tenth of the explained surface is the rest of an assembly the model
      // does not cover (context, in a paler map colour)
      let explained=0;for(let v=0;v<n;v++)if(!far[v])explained++;
      const size=new Map();for(let v=0;v<n;v++)if(far[v]){const r=find(v);size.set(r,(size.get(r)||0)+1)}
      for(let v=0;v<n;v++)if(far[v]){const k=size.get(find(v));comp[v]=k<24?0:k<=0.1*explained||M.zoned?1:2}}   // zoned: all that is left is the model's
    for(let v=0;v<n;v++){let c=mapCol;if(comp[v]===1&&o.unexplained)c=accent;else if(comp[v]===2)c=contextCol;else if((o.color==='model'||o.color==='chain')&&L.near[v]>=0){const a=atomsById[byIndex[L.near[v]]];if(a)c=o.color==='chain'?chainColor(a):colFor(a)}cls[v]=classOf(c)}
    // smooth finish: the rest of an assembly beyond the model is left out (cut along the mesh, so its edge is the surface's own); the caption says so
    let tri=L.tri;if(o.finish!=='sketch'&&M.hasModel&&!M.zoned&&(o.context??'hide')==='hide'){const keep=[];let cut=0;for(let t=0;t<tri.length;t+=3){if(comp[tri[t]]===2&&comp[tri[t+1]]===2&&comp[tri[t+2]]===2){cut++;continue}keep.push(tri[t],tri[t+1],tri[t+2])}if(cut){tri=new Uint32Array(keep);M.contextHidden=true}}
    return {...L,tri,px,py,pz,fog,rn,cls}};   // projected afresh every frame: the camera moves
  const levels=M.levels.map(prep),main=levels[M.primary]||levels[0];
  const style=o.style,layer=o.layer==='auto'?(style==='slice'?'plane':M.hasModel&&(style==='surface'||style==='layers')&&!M.closeUp?'under':'over'):o.layer==='behind'?'under':o.layer;   // with a model: behind it, so the model keeps its colour; a close-up over it, so its atoms are seen in their density
  const zItem=layer==='under'?-1e9:layer==='over'||layer==='lines'?1e9:0;
  let sliceZ=null;   // a section's depth (style slice)
  // the surface's silhouette on the mesh: where n·(eye − p) changes sign, kept where the buffer sees it
  const silhouettes=(L,buf)=>{
    const n=L.pos.length/3,f=new Float32Array(n);
    for(let v=0;v<n;v++){let vx=0,vy=0,vz=1;if(eye){const r=proj.rot([L.pos[v*3],L.pos[v*3+1],L.pos[v*3+2]]);vx=eye[0]-r[0];vy=eye[1]-r[1];vz=eye[2]-r[2];const l=Math.hypot(vx,vy,vz)||1;vx/=l;vy/=l;vz/=l}
      f[v]=L.rn[v*3]*vx+L.rn[v*3+1]*vy+L.rn[v*3+2]*vz}
    const segs=[];const tri=L.tri;
    for(let t=0;t<tri.length;t+=3){const vs=[tri[t],tri[t+1],tri[t+2]];const pts=[];
      for(let e=0;e<3;e++){const a=vs[e],b=vs[(e+1)%3];if((f[a]>0)!==(f[b]>0)){const u=f[a]/(f[a]-f[b]);pts.push({x:L.px[a]+(L.px[b]-L.px[a])*u,y:L.py[a]+(L.py[b]-L.py[a])*u,z:L.pz[a]+(L.pz[b]-L.pz[a])*u,
        h:L.hand?L.hand[a]+(L.hand[b]-L.hand[a])*u:0,fog:L.fog[a]+(L.fog[b]-L.fog[a])*u,k:a<b?a+'_'+b:b+'_'+a,nx:L.rn[a*3],ny:-L.rn[a*3+1]})}}
      if(pts.length===2)segs.push(pts)}
    // chain the segments through their shared mesh edges
    const byKey=new Map();segs.forEach((s,i)=>{for(const p of s){let l=byKey.get(p.k);if(!l)byKey.set(p.k,l=[]);l.push(i)}});
    const used=new Uint8Array(segs.length),lines=[];
    for(let i=0;i<segs.length;i++){if(used[i])continue;used[i]=1;const line=[segs[i][0],segs[i][1]];
      for(const tail of [1,0]){for(;;){const end=tail?line[line.length-1]:line[0];const nx=(byKey.get(end.k)||[]).find(j=>!used[j]);if(nx===undefined)break;used[nx]=1;const s=segs[nx];const far=s[0].k===end.k?s[1]:s[0];if(tail)line.push(far);else line.unshift(far)}}
      lines.push(line)}
    // visible, and the depth step behind (heavier line for a deeper step, full weight against the paper)
    const vis=p=>{const x=Math.floor(p.x),y=Math.floor(p.y);if(x<0||y<0||x>=W||y>=H)return false;return buf.zb[y*W+x]<=p.z+2.2};
    const out=[];for(const line of lines){let run=[];for(const p of line){if(vis(p)){const L2=Math.hypot(p.nx,p.ny)||1,qx=Math.floor(p.x+p.nx/L2*3),qy=Math.floor(p.y+p.ny/L2*3);
        const zb=qx<0||qy<0||qx>=W||qy>=H?-1e9:buf.zb[qy*W+qx];p.gap=zb<-1e8?1:clamp((p.z-zb-1.5)/8,0,1);run.push(p)}else{if(run.length>1)out.push(run);run=[]}}if(run.length>1)out.push(run)}
    return out};
  const drawLines=(ctx,lines,o2)=>{let k=0;for(const line of lines){ // split by looseness (local resolution) into three hands
      let cur=[],hb=-1;const flush=()=>{if(cur.length>1){const h=(hb+0.5)/3,g=cur.reduce((s,p)=>s+(p.gap??1),0)/cur.length,fg=cur.reduce((s,p)=>s+p.fog,0)/cur.length,fk=1-FADE*fg*0.8;
          sketchLine(ctx,cur.map(p=>[p.x,p.y]),{seed:seedBase+1301+k++,passes:h>0.5?2:1,width:o2.width*(EDG>0?0.55+0.75*g*EDG+0.25*(1-EDG):1)*(0.75+0.25*fk),color:o2.color,alpha:o2.alpha*(1-0.35*h)*(0.4+0.6*fk),ampScale:0.55+1.9*h,step:3,overshoot:false})}};
      for(const p of line){const b=L0hand(p.h);if(b!==hb&&cur.length){cur.push(p);flush();cur=[p]}else cur.push(p);hb=b}flush()}};
  const L0hand=h=>main.hand?Math.min(2,Math.floor(h*3)):0;
  // per pixel: which triangle, how dark (light and grooves), how far into the fog, and its colour class
  const shadeOf=(L,buf)=>{
    const n=W*H,dark=new Float32Array(n),fogp=new Float32Array(n),cls=new Int32Array(n).fill(-1),hand=new Float32Array(n),face=new Float32Array(n);
    const la=S.lightAngle*Math.PI/180,l0=Math.cos(la)*0.75,l1=-Math.sin(la)*0.75,l2=0.66,occR=6*proj.pxPerA;
    const MSH=Math.max(S.shading,0.45);   // a map's form is its shading: at least this much, in looks that shade their ribbons with lines instead (engraved: 0)
    const OX=new Int32Array(8),OY=new Int32Array(8);for(let k=0;k<8;k++){const an=k*Math.PI/4;OX[k]=Math.round(Math.cos(an)*occR);OY[k]=Math.round(Math.sin(an)*occR)}   // the 8 probes of the grooves, in whole pixels
    for(let i=0;i<n;i++){const t=buf.tb[i];if(t<0)continue;const a=L.tri[t*3],b=L.tri[t*3+1],c=L.tri[t*3+2];
      const nx=L.rn[a*3]+L.rn[b*3]+L.rn[c*3],ny=L.rn[a*3+1]+L.rn[b*3+1]+L.rn[c*3+1],nz=L.rn[a*3+2]+L.rn[b*3+2]+L.rn[c*3+2],ln=Math.hypot(nx,ny,nz)||1;
      const lam=Math.max(0,(nx*l0+ny*l1*-1+nz*l2)/ln);face[i]=Math.abs(nz)/ln;   // the light, from the style's angle (screen y down)
      let occ=0;if(POOL>0){const x=i%W,y=(i/W)|0,z=buf.zb[i];let s=0;for(let k=0;k<8;k++){const qx=x+OX[k],qy=y+OY[k];if(qx>=0&&qy>=0&&qx<W&&qy<H){const zq=buf.zb[qy*W+qx];if(zq>-1e8){const u=(zq-z-1)/6;s+=u<0?0:u>1?1:u}}}occ=s/8}
      dark[i]=clamp(0.62*(1-lam)*MSH/0.65+0.9*POOL*occ,0,1);fogp[i]=(L.fog[a]+L.fog[b]+L.fog[c])/3;cls[i]=L.cls[a];hand[i]=L.hand?(L.hand[a]+L.hand[b]+L.hand[c])/3:0}
    softenCovered(dark,buf.tb,W,H,Math.max(1,Math.round(2.5*TEX),Math.min(Math.round(8*TEX),Math.round(1.2*proj.pxPerA))));   // over about an ångström: shadows follow the surface's form, not every bump of it   // the facets of the mesh smoothed away: shadows as broad shapes, not specks
    softenCovered(face,buf.tb,W,H,Math.max(1,Math.round(2*TEX)));
    return {dark,fogp,cls,hand,face}};
  const bbox=(test)=>{let x0=W,y0=H,x1=-1,y1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(test(y*W+x)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return x1<0?null:[x0,y0,x1,y1]};
  const speck=o.finish==='sketch'?3:(o.speck??8)**2*TEX*TEX;   // islands and holes smaller than this (px²) are specks: left out
  const regions=(test)=>{const m=new Uint8Array(W*H);for(let i=0;i<m.length;i++)m[i]=test(i)?1:0;const b=bbox(i=>m[i]);return b?maskRings(m,W,H,b[0],b[1],b[2],b[3]).filter(r=>Math.abs(ringArea(r))>=speck):[]};
  // ink hatching over the region where `dark` passes a threshold: straight hand lines, one direction, then crossed
  const hatch=(ctx,sh,covered,t,ang,sp,colorAt,alpha)=>{const dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx,R=Math.hypot(W,H)/2,cx=W/2,cy=H/2;let k=0;
    for(let s=-R;s<R;s+=sp){let run=null;const step=1.5;
      const end=()=>{if(run&&run.n>(o.finish==='sketch'?2:6)){const c=colorAt(run.c),hh=run.h/run.n,fg=run.f/run.n;sketchLine(ctx,[run.a,run.b],{seed:seedBase+7001+k++,passes:1,width:0.7*TEX,color:c,alpha:alpha*clamp(0.35+0.8*run.d/run.n,0,1)*(1-0.6*FADE*fg),ampScale:0.4+1.6*hh,step:5,overshoot:false})}run=null};
      for(let u=-R;u<R;u+=step){const x=cx+nx*s+dx*u,y=cy+ny*s+dy*u,xi=Math.floor(x),yi=Math.floor(y);
        const i=xi>=0&&yi>=0&&xi<W&&yi<H?yi*W+xi:-1,on=i>=0&&covered(i)&&sh.dark[i]>=t;
        if(on&&run&&sh.cls[i]!==run.c)end();
        if(on){if(!run)run={a:[x,y],b:[x,y],n:0,d:0,h:0,f:0,c:sh.cls[i]};run.b=[x,y];run.n++;run.d+=sh.dark[i];run.h+=sh.hand[i];run.f+=sh.fogp[i]}else end()}end()}};
  const surfaceItem=(L,buf,sh,strength,withLines)=>ctx=>{
    ctx.save();const covered=i=>buf.tb[i]>=0;const all=regions(covered);if(!all.length){ctx.restore();return}
    const opaque=layer!=='over'||!wc;
    if(opaque||ink||pencil||chalk){ringsPath(ctx,all);ctx.fillStyle=paperFill();ctx.fill('evenodd')}
    const byClass=classes.map((c,ci)=>({c,rings:regions(i=>buf.tb[i]>=0&&sh.cls[i]===ci)}));
    if(wc){for(const {c,rings} of byClass)if(rings.length)washRings(ctx,rings,c,seedBase+71+classIx.get(c),{strength:(c===contextCol?0.22:0.42)*strength,layers:4});
      // shadow glazes: a neutral wash over the shadowed parts and the grooves, then a deeper one
      const ctxIx=classIx.has(contextCol)?classIx.get(contextCol):-2,lit=i=>covered(i)&&sh.cls[i]!==ctxIx;   // the context takes no glaze: it stays quieter than the model's own density
      const g1=regions(i=>lit(i)&&sh.dark[i]>0.34),g2=regions(i=>lit(i)&&sh.dark[i]>0.6);const glaze=mix(P.paper,shadeInk(),light?0.55:0.4);
      if(g1.length)washRings(ctx,g1,glaze,seedBase+501,{strength:0.26*strength,layers:3,noRing:true});if(g2.length)washRings(ctx,g2,glaze,seedBase+502,{strength:0.24*strength,layers:3,noRing:true})}
    else if(!ink&&!pencil&&!chalk){for(const {c,rings} of byClass)if(rings.length){ringsPath(ctx,rings);ctx.fillStyle=fillFor(c);ctx.fill('evenodd')}   // flat / wash: a tone, darker in shadow
      const g1=regions(i=>covered(i)&&sh.dark[i]>0.34);if(g1.length){ringsPath(ctx,g1);ctx.fillStyle=rgba(shadeInk(),0.16*(cfg.rep.fill==='wash'?0.6:1));ctx.fill('evenodd')}}
    else if(pencil||chalk){for(const {c,rings} of byClass){if(!rings.length)continue;ctx.save();ringsPath(ctx,rings);ctx.clip('evenodd');let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const r of rings)for(const q of r){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1])}
        if(pencil){ctx.fillStyle=rgba(fillFor(c),0.3);ctx.fill('evenodd')}scribbleFill(ctx,x0,y0,x1,y1,c,seedBase+901+classIx.get(c),{fog:0,d:1});ctx.restore()}}
    if(ink||pencil||chalk||(cfg.rep.fill==='flat'&&S.shading>0)){ // hatching in the shadow and the grooves, crossed where deepest
      const inkColour=cfg.rep.fill==='ink colour',colorAt=ci=>inkColour||pencil||chalk?mix(classes[ci]||mapCol,P.hatch,0.15):P.hatch,sp=S.hatchSpacing*Math.max(0.7,TEX),ang=S.hatchAngle*Math.PI/180;
      hatch(ctx,sh,covered,inkColour?0.12:0.3,ang,sp,colorAt,inkColour?0.85:0.75);hatch(ctx,sh,covered,0.6,ang+1.25,sp*1.2,colorAt,0.6)}
    // aerial fade: a veil of paper over the far parts
    if(FADE>0){const far=regions(i=>covered(i)&&sh.fogp[i]>0.35);if(far.length){ringsPath(ctx,far);ctx.fillStyle=rgba(P.paper,0.35*FADE);ctx.fill('evenodd')}}
    if(withLines){const lines=silhouettes(L,buf);drawLines(ctx,lines,{width:S.inkWidth*0.95*(chalk?1.3:1),color:wc?mix(mapCol,shadeInk(),0.6):inkCol,alpha:0.9})
      // where one colour meets another (chains, or the unexplained density): a thinner line
      const seams=[];for(let t=0;t<L.tri.length;t+=3){const vs=[L.tri[t],L.tri[t+1],L.tri[t+2]];const m=[];for(let e=0;e<3;e++){const a=vs[e],b=vs[(e+1)%3];if(L.cls[a]!==L.cls[b])m.push({x:(L.px[a]+L.px[b])/2,y:(L.py[a]+L.py[b])/2,z:Math.max(L.pz[a],L.pz[b]),fog:L.fog[a],h:L.hand?L.hand[a]:0,gap:0.5})}
        if(m.length===2){const vis=p=>{const x=Math.floor(p.x),y=Math.floor(p.y);return x>=0&&y>=0&&x<W&&y<H&&buf.zb[y*W+x]<=p.z+1.2};if(vis(m[0])&&vis(m[1]))seams.push(m)}}
      drawLines(ctx,seams,{width:S.inkWidth*0.5,color:wc?mix(mapCol,shadeInk(),0.5):inkCol,alpha:0.55})}
    ctx.restore()};
  // the map over its model: one colour, a black outline (map.line) and slight shading (map.shade: a pale wash, a little
  // deeper towards the outline, where the eye looks through more of it), so the model reads inside its envelope
  const glassItem=(L,buf,sh)=>ctx=>{
    ctx.save();const covered=i=>buf.tb[i]>=0,k=o.shade??0.35,lineCol=o.line||inkCol,ctxIx=classIx.has(contextCol)?classIx.get(contextCol):-2;
    const own=i=>covered(i)&&sh.cls[i]!==ctxIx,other=i=>covered(i)&&sh.cls[i]===ctxIx;   // the model's density, and the rest of an assembly beyond it
    const body=regions(own),rest=ctxIx>=0?regions(other):[];if(!body.length&&!rest.length){ctx.restore();return}
    if(k>0){const rim1=regions(i=>own(i)&&sh.face[i]<0.55),rim2=regions(i=>own(i)&&sh.face[i]<0.3),deep=mix(mapCol,shadeInk(),0.3);
      if(wc){if(body.length)washRings(ctx,body,mapCol,seedBase+71,{strength:0.3*k,layers:3,noRing:true});if(rest.length)washRings(ctx,rest,mapCol,seedBase+72,{strength:0.12*k,layers:3,noRing:true});
        if(rim1.length)washRings(ctx,rim1,deep,seedBase+171,{strength:0.3*k,layers:3,noRing:true});if(rim2.length)washRings(ctx,rim2,deep,seedBase+271,{strength:0.35*k,layers:3,noRing:true})}
      else if(ink||pencil||chalk){const rimSh={...sh,dark:sh.face.map(f=>1-f)};hatch(ctx,rimSh,own,0.65,S.hatchAngle*Math.PI/180,S.hatchSpacing*Math.max(0.7,TEX)*1.4,()=>P.hatch,0.7*k)}
      else{for(const [r,a] of [[body,0.35],[rest,0.14],[rim1,0.3],[rim2,0.3]])if(r.length){ringsPath(ctx,r);ctx.fillStyle=rgba(a===0.3?deep:fillFor(mapCol),a*k);ctx.fill('evenodd')}}}
    // the outline: the edge of what the map covers, traced (unbroken), and inside it the silhouette where one fold of the
    // surface stands in front of another (a depth step behind the line)
    const W2=o.lineWidth??0.9;let n=0;const ring=(r,w,al)=>sketchLine(ctx,[...r,r[0]],{seed:seedBase+1201+n++,passes:1,width:S.inkWidth*w,color:lineCol,alpha:al,ampScale:0.6,step:3,overshoot:false});
    for(const r of body)ring(r,W2,0.9);if(rest.length)for(const r of regions(covered))ring(r,0.5,0.3);   // the model's density in full; the whole of the rest faint
    const inside=p=>{for(const [dx,dy] of [[4,0],[-4,0],[0,4],[0,-4]]){const x=Math.floor(p.x+dx),y=Math.floor(p.y+dy);if(x<0||y<0||x>=W||y>=H||buf.tb[y*W+x]<0)return false}return true};
    const folds=[];for(const ln of silhouettes(L,buf)){let run=[];for(const p of ln){if(inside(p)&&(p.gap??0)>0.25&&sh.cls[Math.floor(p.y)*W+Math.floor(p.x)]!==ctxIx)run.push(p);else{if(run.length>3)folds.push(run);run=[]}}if(run.length>3)folds.push(run)}
    drawLines(ctx,folds,{width:S.inkWidth*W2*0.7,color:lineCol,alpha:0.7});
    ctx.restore()};
  // smooth: the map as ChimeraX shows it, a lit surface with an even outline. The light is painted in fine steps into
  // a layer of its own, blurred into a gradient and laid inside the outline; the outline and the folds are drawn with
  // a steady pen (no wobble), smoothed off the pixel grid
  const smoothItem=(L,buf,sh,drawn)=>ctx=>{
    const covered=i=>buf.tb[i]>=0,ctxIx=classIx.has(contextCol)?classIx.get(contextCol):-2,accIx=classIx.has(accent)?classIx.get(accent):-2;
    const own=i=>covered(i)&&sh.cls[i]!==ctxIx,rest=ctxIx>=0?regions(i=>covered(i)&&sh.cls[i]===ctxIx):[];
    const body=regions(own).map(r=>chaikin(r,2));if(!body.length&&!rest.length)return;
    // behind the model (layer 'under'), the map is drawn as fully as on its own: the model is painted over it; 'lines': only its outline, over the model
    const lines=layer==='lines',alone=!M.hasModel||layer==='under',op=alone?1:(o.opacity??0.55),lineCol=o.line||inkCol,lw=o.lineWidth??0.9,blur=Math.max(1,1.6*TEX);
    const base=mapCol,darkC=mix(mapCol,light?'#1c2330':'#000000',light?0.62:0.7),lite=light?'#ffffff':mix(mapCol,'#ffffff',0.5);
    // the map's marks: ink (outline and hatching, in every look: the default) or the look's own (a watercolour gradient)
    const hatchy=!lines&&drawn&&((o.marks??'ink')==='ink'||ink||pencil||chalk),washy=!lines&&drawn&&wc&&!hatchy;
    if(hatchy){ // ink: paper inside the outline, hatching where the light falls away, crossed where deepest
      ctx.save();ringsPath(ctx,body);ctx.fillStyle=paperFill();ctx.globalAlpha=alone?1:0.45;ctx.fill('evenodd');ctx.restore();
      if(wc)washRings(ctx,body,mapCol,seedBase+93,{strength:alone?0.16:0.1,layers:2,noRing:true});   // on watercolour paper, a faint wash under the hatching
      if(accIx>=0){const r=regions(i=>covered(i)&&sh.cls[i]===accIx);if(r.length){if(wc)washRings(ctx,r,accent,seedBase+95,{strength:0.5,layers:3});else{ctx.save();ringsPath(ctx,r);ctx.fillStyle=rgba(accent,0.4);ctx.fill('evenodd');ctx.restore()}}}   // what the model does not explain
      const inkColour=cfg.rep.fill==='ink colour',colorAt=()=>inkColour||pencil||chalk?mix(mapCol,P.hatch,0.3):P.hatch,sp=S.hatchSpacing*Math.max(0.7,TEX),ang=S.hatchAngle*Math.PI/180;
      const kk=(o.shade??0.35)/0.35;
      if(!light){ // dark paper: dark hatching would not show. The form is drawn by its light instead: a faint glaze of the
        // map's colour, and pale hatching where the light falls, crossed where it is brightest (quieter behind a model)
        ctx.save();ringsPath(ctx,body);ctx.fillStyle=rgba(mapCol,alone&&!M.hasModel?0.3:0.18);ctx.fill('evenodd');ctx.restore();
        const lit={...sh,dark:sh.dark.map(d=>1-d)},pale=()=>mix(inkColour||pencil||chalk?mix(mapCol,P.ink,0.6):P.ink,P.paper,0.2),q=kk*(M.hasModel?0.55:1);
        if(alone){hatch(ctx,lit,own,0.72,ang,sp,pale,0.5*q);hatch(ctx,lit,own,0.9,ang+1.25,sp*1.2,pale,0.4*q)}else hatch(ctx,lit,own,0.85,ang,sp*1.3,pale,0.35*q)}
      else if(alone){hatch(ctx,sh,own,0.4,ang,sp,colorAt,0.7*kk);hatch(ctx,sh,own,0.68,ang+1.25,sp*1.2,colorAt,0.55*kk)}
      else hatch(ctx,sh,own,0.62,ang,sp*1.3,colorAt,0.5*kk)}   // over a model: only the deepest shadow, one way, so the model reads through
    const off=hatchy||lines?null:document.createElement('canvas');if(off){off.width=Math.max(1,Math.round(W*RF.dpr));off.height=Math.max(1,Math.round(H*RF.dpr));const x=off.getContext('2d');x.scale(RF.dpr,RF.dpr);
    // the base colour, spread a little past the outline so the blur does not pale the edge
    ringsPath(x,body);x.fillStyle=base;x.fill('evenodd');x.lineWidth=blur*3;x.lineJoin='round';x.strokeStyle=base;x.stroke();
    for(let k=1;k<=9;k++){const t=k/10;const r=regions(i=>own(i)&&sh.dark[i]>t*0.9);if(r.length){ringsPath(x,r);x.fillStyle=rgba(darkC,washy?0.085:0.13);x.fill('evenodd')}}
    for(const [t,a] of [[0.14,0.22],[0.07,0.25]]){const r=regions(i=>own(i)&&sh.dark[i]<t);if(r.length){ringsPath(x,r);x.fillStyle=rgba(lite,a);x.fill('evenodd')}}
    if(accIx>=0){const r=regions(i=>covered(i)&&sh.cls[i]===accIx);if(r.length){ringsPath(x,r);x.fillStyle=rgba(accent,0.55);x.fill('evenodd')}}}
    ctx.save();
    if(rest.length){const rr=rest.map(r=>chaikin(r,2));ringsPath(ctx,rr);ctx.fillStyle=rgba(base,0.25*op);ctx.fill('evenodd');ctx.lineWidth=S.inkWidth*0.45;ctx.strokeStyle=rgba(lineCol,0.25);ctx.stroke()}
    if(off){ctx.save();ringsPath(ctx,body);ctx.clip('evenodd');ctx.globalAlpha=washy?(alone?0.8:op*0.6):op;if(washy)ctx.globalCompositeOperation=light?'multiply':'screen';try{ctx.filter=`blur(${blur.toFixed(2)}px)`}catch(e){}ctx.drawImage(off,0,0,W,H);ctx.restore()}
    if(washy)washRings(ctx,body,mapCol,seedBase+91,{strength:0.18,layers:2});   // watercolour: the pigment pooling at the edge
    // the folds: where one part of the surface stands in front of another, a thinner line
    const inside=p=>{for(const [dx,dy] of [[4,0],[-4,0],[0,4],[0,-4]]){const xi=Math.floor(p.x+dx),yi=Math.floor(p.y+dy);if(xi<0||yi<0||xi>=W||yi>=H||!own(yi*W+xi))return false}return true};
    ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=lineCol;
    const folds=[];for(const ln of silhouettes(L,buf)){let run=[];const flush=()=>{if(run.length>3)folds.push(chaikinOpen(run,2));run=[]};
      for(const p of ln){if(inside(p)&&(p.gap??0)>0.2)run.push([p.x,p.y]);else flush()}flush()}
    if(drawn){let k=0;const hand=(pts,w,a)=>sketchLine(ctx,pts,{seed:seedBase+1501+k++,passes:1,width:S.inkWidth*w,color:lineCol,alpha:a,ampScale:0.35,step:4,overshoot:false});   // a steady hand, not a ruler
      for(const f of folds)hand(f,lw*0.6,0.6);for(const r of body)hand([...r,r[0]],lw,0.9)}
    else{ctx.globalAlpha=0.55*Math.max(op,0.6);ctx.lineWidth=S.inkWidth*lw*0.6;ctx.beginPath();for(const c of folds)c.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.stroke();
      ctx.globalAlpha=0.9;ctx.lineWidth=S.inkWidth*lw;ringsPath(ctx,body);ctx.stroke()}
    ctx.restore()};
  if(style==='surface'||style==='layers'){
    const list=style==='layers'?[...levels].sort((a,b)=>a.level-b.level):[main];
    list.forEach((L,li)=>{const buf=mapRaster(L,L.px,L.py,L.pz,W,H),sh=shadeOf(L,buf);const primary=L===main;
      const strength=style==='layers'?(primary?0.8:li===0?0.35:0.5):1;   // inner levels a lighter wash: the surface's marks show through them
      items.push({z:zItem+li,map:true,draw:style==='layers'&&!primary&&!(ink||pencil||chalk)?ctx=>{ // an outer or inner level: a translucent wash and a thin line
          const covered=i=>buf.tb[i]>=0,rings=regions(covered);if(!rings.length)return;ctx.save();
          if(wc)washRings(ctx,rings,mapCol,seedBase+333+li,{strength:0.45*strength,layers:3});else{ringsPath(ctx,rings);ctx.fillStyle=rgba(fillFor(mapCol),0.22*strength);ctx.fill('evenodd')}
          drawLines(ctx,silhouettes(L,buf),{width:S.inkWidth*(li===0?0.5:0.8),color:mix(mapCol,shadeInk(),0.55),alpha:li===0?0.45:0.7});ctx.restore()}
        :style==='layers'&&!primary?ctx=>{drawLines(ctx,silhouettes(L,buf),{width:S.inkWidth*(li===0?0.45:0.8),color:inkCol,alpha:li===0?0.45:0.8})}   // ink: nested contour lines
        :(style==='surface'||primary)&&(o.finish==='smooth'||o.finish==='drawn')?smoothItem(L,buf,sh,o.finish==='drawn'):style==='surface'&&layer==='over'&&(M.hasModel||o.glass)?glassItem(L,buf,sh):surfaceItem(L,buf,sh,strength,true)})})}
  else if(style==='mesh'){ // chicken wire: the map's contours on the grid planes, hidden where the surface is in front
    const buf=o.carve>0?null:mapRaster(main,main.px,main.py,main.pz,W,H);
    const lines=[];for(const w of M.wire){let run=[];for(const q of w){const p=proj.proj(q);const x=Math.floor(p.x),y=Math.floor(p.y);const vis=!buf||(x>=0&&y>=0&&x<W&&y<H&&buf.zb[y*W+x]<=p.z+1.5);if(vis)run.push({x:p.x,y:p.y,fog:p.fog,h:0,gap:1});else{if(run.length>1)lines.push(run);run=[]}}if(run.length>1)lines.push(run)}
    const col=o.color==='single'||!M.hasModel?mix(mapCol,shadeInk(),light?0.45:0.1):mix(P.N,shadeInk(),0.2);
    items.push({z:zItem,map:true,draw:ctx=>{ctx.save();if(o.finish==='smooth'){ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=o.line||mix(mapCol,shadeInk(),light?0.55:0.1);ctx.globalAlpha=0.9;ctx.lineWidth=S.inkWidth*0.6;ctx.beginPath();for(const l of lines)l.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()}else drawLines(ctx,lines,{width:S.inkWidth*(M.closeUp?0.6:0.45),color:col,alpha:0.85});ctx.restore()}})}
  else if(style==='slice'){ // a section through the map at the view's depth: stipple for density, the contour in ink
    const rz=M.box.map(c=>proj.rot(c)[2]),zc=sliceZ=(Math.min(...rz)+Math.max(...rz))/2+(o.slice?.offset||0)*(Math.max(...rz)-Math.min(...rz));
    // the plane's outline: where it cuts the box's edges
    const R=M.box.map(c=>proj.rot(c)),E=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]],cut=[];
    for(const [a,b] of E){const za=R[a][2],zb=R[b][2];if((za-zc)*(zb-zc)<0){const u=(zc-za)/(zb-za);const q=M.box[a].map((v,k)=>v+(M.box[b][k]-v)*u);const p=proj.proj(q);cut.push([p.x,p.y])}}
    const poly=hull(cut);if(poly.length<3)return;
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const q of poly){x0=Math.min(x0,q[0]);y0=Math.min(y0,q[1]);x1=Math.max(x1,q[0]);y1=Math.max(y1,q[1])}
    const st2=1.5,gw=Math.ceil((x1-x0)/st2)+1,gh=Math.ceil((y1-y0)/st2)+1,val=new Float32Array(gw*gh).fill(-1e9),lv=M.primaryLevel;
    for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){const x=x0+i*st2,y=y0+j*st2;if(!inHull(poly,x,y))continue;const q=proj.unproj(x,y,zc);val[j*gw+i]=M.sample(q[0],q[1],q[2])/lv}
    if(o.slice?.cut!==false)for(let i=items.length-1;i>=0;i--)if(!items[i].map&&items[i].z>zc+0.5)items.splice(i,1);   // what lies in front of the plane is cut away
    items.push({z:zc,map:true,draw:ctx=>{const rng=mulberry32(seedBase+4401);ctx.save();
      ctx.beginPath();poly.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.closePath();ctx.fillStyle=paperFill();ctx.fill();
      ctx.fillStyle=rgba(light?inkCol:mix(inkCol,P.paper,0.2),0.85);
      // stipple: dots as dense as the density, from a third of the contour level up to what is dense in this section (its
      // 95th percentile: against the level alone, all of a particle's inside was the same grey), laid as one path
      const vs=[];for(const v of val)if(v>=0.3)vs.push(v);vs.sort((a,b)=>a-b);const vhi=Math.max(1.2,vs.length?vs[Math.floor(vs.length*0.95)]:1.7);
      ctx.beginPath();for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){const v=val[j*gw+i];if(v<0.3)continue;const pr=Math.pow(clamp((v-0.3)/(vhi-0.3),0,1),1.4)*0.6;if(rng()>pr)continue;
        const x=x0+(i+rng())*st2,y=y0+(j+rng())*st2,r=0.5+0.35*rng();ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2)}ctx.fill();
      const mask=new Uint8Array(gw*gh);for(let k=0;k<mask.length;k++)mask[k]=val[k]>=1?1:0;
      const rings=maskRings(mask,gw,gh).map(r=>r.map(q=>[x0+q[0]*st2,y0+q[1]*st2]));
      let k=0;for(const r of rings)sketchLine(ctx,[...r,r[0]],{seed:seedBase+4501+k++,passes:1,width:S.inkWidth*0.8,color:wc?mix(mapCol,shadeInk(),0.6):inkCol,alpha:0.85,ampScale:0.6,step:3,overshoot:false});
      sketchLine(ctx,[...poly,poly[0]],{seed:seedBase+4601,passes:1,width:S.inkWidth*0.6,color:inkCol,alpha:0.6,ampScale:0.5,overshoot:false});
      ctx.restore()}})}
  // residues the density does not support: an open accent circle on their trace atom
  if(M.hasModel&&o.unsupported&&M.unsupported.length)items.push({z:2e9,map:true,draw:ctx=>{ctx.save();let k=0;
    for(const ti of M.unsupported){const a=atomsById[byIndex[ti]];if(!a||!pos[a.id])continue;const p=pos[a.id];
      if(sliceZ!==null&&Math.abs(proj.rot(a.pos)[2]-sliceZ)>3)continue; /* a section: only the residues it cuts */sketchCircle(ctx,p.x,p.y,2.6*Math.max(0.7,TEX),{seed:seedBase+8001+k++,width:0.8,color:accent,alpha:0.75,passes:1})}ctx.restore()}});
}
/* a box blur (twice, near a Gaussian) of a per-pixel field over the covered pixels only, in place */
/* grains of pigment: one-pixel dots of a colour at various strengths, laid as four strengths, each one path (a dot at a
   time was a draw each: 70 000 for a ribosome's surface) */
function grains(ctx,pts,col){if(!pts.length)return;let lo=1,hi=0;for(const p of pts){if(p[2]<lo)lo=p[2];if(p[2]>hi)hi=p[2]}const B=4,span=Math.max(1e-6,hi-lo),bins=[[],[],[],[]];
  for(const p of pts)bins[Math.min(B-1,Math.floor((p[2]-lo)/span*B))].push(p);
  bins.forEach((b,k)=>{if(!b.length)return;ctx.beginPath();for(const p of b)ctx.rect(p[0],p[1],1,1);ctx.fillStyle=rgba(col,lo+(k+0.5)/B*span);ctx.fill()})}
/* which of a surface's patches (painted far to near, each clearing its hull first) no pixel of will be left: every pixel
   of its hull, grown to take in its pigment's spill, lies inside nearer opaque patches' hulls (shrunk, so no edge
   pixel counts as covered). Most of a large assembly's patches are hidden; painting them was most of its time */
function hiddenPatches(patches,W,H,wobble=0){   // wobble: how far (a fraction of its size) a patch's drawn shape strays from its hull
  const w=Math.max(1,Math.ceil(W)),h=Math.max(1,Math.ceil(H)),cov=new Uint8Array(w*h),out=new Uint8Array(patches.length);
  // the pixel centres (x+0.5) of row y inside a convex polygon scaled by k about (cx,cy): [x0,x1], or null
  const span=(q,cx,cy,k,y)=>{const yc=y+0.5;let lo=Infinity,hi=-Infinity;for(let i=0,n=q.length;i<n;i++){const a=q[i],b=q[(i+1)%n];
      const ay=cy+(a[1]-cy)*k,by=cy+(b[1]-cy)*k;if((ay<=yc&&by>=yc)||(by<=yc&&ay>=yc)){const ax=cx+(a[0]-cx)*k,bx=cx+(b[0]-cx)*k;const x=ay===by?Math.min(ax,bx):ax+(bx-ax)*(yc-ay)/(by-ay),x2=ay===by?Math.max(ax,bx):x;if(x<lo)lo=x;if(x2>hi)hi=x2}}
    if(!(hi>=lo))return null;const x0=Math.max(0,Math.ceil(lo-0.5)),x1=Math.min(w-1,Math.floor(hi-0.5));return x1>=x0?[x0,x1]:null};
  for(let pi=patches.length-1;pi>=0;pi--){const p=patches[pi],q=p.h;if(!q||q.length<3)continue;
    let cx=0,cy=0;for(const a of q){cx+=a[0];cy+=a[1]}cx/=q.length;cy/=q.length;let r=0;for(const a of q)r=Math.max(r,Math.hypot(a[0]-cx,a[1]-cy));if(r<1)continue;
    const kOut=1+(2+(0.15+wobble)*r)/r,kIn=Math.max(0,1-(1.5+wobble*r)/r),R=r*kOut;
    const y0=Math.max(0,Math.floor(cy-R)),y1=Math.min(h-1,Math.ceil(cy+R));
    let seen=false;for(let y=y0;y<=y1&&!seen;y++){const sp=span(q,cx,cy,kOut,y);if(!sp)continue;const o=y*w;for(let x=sp[0];x<=sp[1];x++)if(!cov[o+x]){seen=true;break}}
    if(!seen){if(y1>=y0)out[pi]=1;continue}
    if((p.alpha??1)>=0.999&&kIn>0)for(let y=y0;y<=y1;y++){const sp=span(q,cx,cy,kIn,y);if(!sp)continue;cov.fill(1,y*w+sp[0],y*w+sp[1]+1)}}
  return out}
/* the discs (radius r − shrink, those of positive radius) a union of them needs: a disc whose every 2-px cell lies
   wholly inside some other disc still kept adds nothing, and is left out (one at a time, so that of two equal discs
   one stays). The union is the same; for a ribosome, a fifth of the discs */
function unionDiscs(discs,shrink){
  const cs=2;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;const ds=[];
  for(const d of discs){const r=d.r-shrink;if(r<=0)continue;ds.push(d);if(d.x-r<x0)x0=d.x-r;if(d.y-r<y0)y0=d.y-r;if(d.x+r>x1)x1=d.x+r;if(d.y+r>y1)y1=d.y+r}
  if(ds.length<64)return ds;
  const gw=Math.ceil((x1-x0)/cs)+1,gh=Math.ceil((y1-y0)/cs)+1,cnt=new Uint16Array(gw*gh);
  // the cells a disc covers wholly, counted, then each disc tested and, if it adds nothing, taken out (plain loops: a
  // callback per cell cost most of the time)
  const add=(d,k)=>{const r=d.r-shrink,r2=r*r;const i0=Math.max(0,Math.floor((d.x-r-x0)/cs)),i1=Math.min(gw-1,Math.floor((d.x+r-x0)/cs)),j0=Math.max(0,Math.floor((d.y-r-y0)/cs)),j1=Math.min(gh-1,Math.floor((d.y+r-y0)/cs));
    for(let j=j0;j<=j1;j++){const ya=y0+j*cs-d.y,yb=ya+cs,yy=Math.max(ya*ya,yb*yb);for(let i=i0;i<=i1;i++){const xa=x0+i*cs-d.x,xb=xa+cs;if(Math.max(xa*xa,xb*xb)+yy<=r2){const c=j*gw+i;if(k>0){if(cnt[c]<65535)cnt[c]++}else cnt[c]--}}}};
  const needs=d=>{const r=d.r-shrink,r2=r*r;const i0=Math.max(0,Math.floor((d.x-r-x0)/cs)),i1=Math.min(gw-1,Math.floor((d.x+r-x0)/cs)),j0=Math.max(0,Math.floor((d.y-r-y0)/cs)),j1=Math.min(gh-1,Math.floor((d.y+r-y0)/cs));
    for(let j=j0;j<=j1;j++){const ya=y0+j*cs-d.y,yb=ya+cs,yy=Math.max(ya*ya,yb*yb);for(let i=i0;i<=i1;i++){const xa=x0+i*cs-d.x,xb=xa+cs;const c=j*gw+i;
      if(Math.max(xa*xa,xb*xb)+yy<=r2){if(cnt[c]-1<=0)return true;continue}
      const nx=Math.max(xa,Math.min(0,xb)),ny=Math.max(ya,Math.min(0,yb));if(nx*nx+ny*ny>=r2)continue;   // a cell the disc does not reach
      if(cnt[c]<=0)return true}}
    return false};
  for(const d of ds)add(d,1);
  const keep=[];
  for(const d of ds){if(needs(d))keep.push(d);else add(d,-1)}
  return keep}
function softenCovered(v,tb,W,H,r){   // v is 0 where nothing is covered: only the covered box is walked (the same sums, in the same order)
  let X0=W,X1=-1,Y0=H,Y1=-1;for(let y=0;y<H;y++){const o=y*W;for(let x=0;x<W;x++)if(tb[o+x]>=0){if(x<X0)X0=x;if(x>X1)X1=x;if(y<Y0)Y0=y;Y1=y}}
  if(X1<0)return;
  const tmp=new Float32Array(v.length);
  for(let pass=0;pass<2;pass++){
    for(let y=Y0;y<=Y1;y++){let s=0,n=0;const o=y*W;for(let x=X0-r;x<=X1;x++){const a=x+r,b=x-r-1;if(a<=X1&&tb[o+a]>=0){s+=v[o+a];n++}if(b>=X0&&tb[o+b]>=0){s-=v[o+b];n--}if(x>=X0)tmp[o+x]=tb[o+x]>=0&&n?s/n:0}}
    for(let x=X0;x<=X1;x++){let s=0,n=0;for(let y=Y0-r;y<=Y1;y++){const a=y+r,b=y-r-1;if(a<=Y1&&tb[a*W+x]>=0){s+=tmp[a*W+x];n++}if(b>=Y0&&tb[b*W+x]>=0){s-=tmp[b*W+x];n--}if(y>=Y0)v[y*W+x]=tb[y*W+x]>=0&&n?s/n:0}}}
}
/* the map's caption: how it is shown (contour level, carving, sampling, what the line's looseness means) */
function drawMapCaption(ctx,W,H){
  const M=scene.map;if(!M||!M.opts.caption||!M.caption)return;const S=cfg.style,P=cfg.palette;
  ctx.save();ctx.font=`${Math.max(9,Math.round(S.labelSize*0.6))}px "IBM Plex Sans", system-ui, sans-serif`;ctx.fillStyle=rgba(P.label,0.8);ctx.textAlign='left';ctx.textBaseline='bottom';
  // wrapped at its ' · ' joints to the width, bottom up
  const parts=(M.caption+(M.contextHidden?' · the rest of the assembly (not in the model) left out':'')).split(' · '),lines=[];let cur='';for(const p of parts){const t=cur?cur+' · '+p:p;if(cur&&ctx.measureText(t).width>W-24){lines.push(cur);cur=p}else cur=t}if(cur)lines.push(cur);
  const lh=Math.max(9,Math.round(S.labelSize*0.6))*1.3;lines.reverse().forEach((l,i)=>ctx.fillText(l,12,H-10-i*lh));ctx.restore();
}

/* ---- cartoon representation ---- */
function v3(a,b,f){return[a[0]+b[0]*f,a[1]+b[1]*f,a[2]+b[2]*f]}
function sub3(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function cross3(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function norm3(a){const L=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/L,a[1]/L,a[2]/L]}
function backboneTraces(atoms,sel){
  const cas=atoms.filter(a=>(a.trace||(a.name==='CA'&&!a.het))&&!a.het&&sel(a)&&a.alpha>0.05).sort((u,v)=>(u.chain||'')<(v.chain||'')?-1:(u.chain||'')>(v.chain||'')?1:(u.resi-v.resi));
  const traces=[];let cur=null;
  for(const a of cas){if(cur&&cur.atoms.length){const prev=cur.atoms[cur.atoms.length-1];const d=Math.hypot(...sub3(a.pos,prev.pos));const lim=(a.nucleic||prev.nucleic)?9.5:4.6;if((a.chain||'')!==(prev.chain||'')||d>lim||a.resi-prev.resi>2||!!a.nucleic!==!!prev.nucleic)cur=null}
    if(!cur){cur={atoms:[]};traces.push(cur)}cur.atoms.push(a)}
  return traces.filter(t=>t.atoms.length>=2);
}
function catmull(P,i,t){const p0=P[Math.max(0,i-1)],p1=P[i],p2=P[Math.min(P.length-1,i+1)],p3=P[Math.min(P.length-1,i+2)];const t2=t*t,t3=t2*t;
  return[0,1,2].map(k=>0.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3))}
function sketchOffsets(pts,seed,passes){ // jittered copies of a polyline (no resampling), one per pass
  const out=[];let L=0;for(let i=1;i<pts.length;i++)L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  for(let p=0;p<passes;p++){const rng=mulberry32(seed+p*7919+11);const nz=new Noise1(rng,32);const amp=cfg.style.rough*(p===0?0.8:1.0);const o=[];let s=0;
    for(let i=0;i<pts.length;i++){if(i>0)s+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
      let tx,ty;if(i<pts.length-1){tx=pts[i+1][0]-pts[i][0];ty=pts[i+1][1]-pts[i][1]}else{tx=pts[i][0]-pts[i-1][0];ty=pts[i][1]-pts[i-1][1]}const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
      const off=amp*(nz.at(s*0.06+p*3)+0.3*(rng()-0.5));o.push([pts[i][0]-ty*off,pts[i][1]+tx*off])}
    out.push(o)}
  return out;
}
/* Engraved cartoon (cfg.rep.cartoonStyle==='engraved'): a port of MOLSCRIPT's schematic geometry (Kraulis 1991, v2.1
   graphics.c: coil / helix / strand) drawn as its line-shaded PostScript figures were. Secondary-structure elements share
   their end residues as in MolAuto's scripts; coils are Priestle-smoothed Hermite splines drawn as paper bands; helices
   are ribbons along the local helix axis that widen from the coil radius over their first and last residue; strands are
   smoothed boxes ending in a stepped arrowhead. Every ribbon face is paper with lines running along it at fixed fractions
   of its width; faces turned from the viewer take heavier lines (MOLSCRIPT's shading by the face normal), helix back
   faces heavier still, and the narrow sides of strands are solid ink. Faces are painted back to front with the rest. */
function buildCartoonEngraved(items,atoms,sel,proj,seedBase){
  const P=cfg.palette,S=cfg.style,R=cfg.rep;const K=R.cartoonScale;
  const SEG=6,N=Math.max(0,Math.round(R.engraveLines??8)),lw0=R.engraveWidth??0.45;
  const coilR=0.2*K*(R.coilWidth??1.25),helixW=1.2*K,strandW=1.0*K,thick=0.5*(R.strandThickness??0.6)*K;
  const wInk=S.inkWidth*LW.outer;
  const add=(a,b,f=1)=>[a[0]+b[0]*f,a[1]+b[1]*f,a[2]+b[2]*f],mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],scl=(a,f)=>[a[0]*f,a[1]*f,a[2]*f];
  const herm=(p0,p1,v0,v1,t)=>{const t2=t*t,t3=t2*t;const h1=2*t3-3*t2+1,h2=t3-2*t2+t,h3=-2*t3+3*t2,h4=t3-t2;return[0,1,2].map(k=>h1*p0[k]+h2*v0[k]+h3*p1[k]+h4*v1[k])};
  const hermT=(p0,p1,v0,v1,t)=>{const t2=t*t;const h1=6*t2-6*t,h2=3*t2-4*t+1,h3=-6*t2+6*t,h4=3*t2-2*t;return[0,1,2].map(k=>h1*p0[k]+h2*v0[k]+h3*p1[k]+h4*v1[k])};
  const priestle=(pts,steps)=>{for(let s=0;s<steps;s++){const tmp=pts.map(p=>p.slice());for(let i=1;i<pts.length-1;i++)tmp[i]=mid(mid(pts[i-1],pts[i+1]),pts[i]);for(let i=1;i<pts.length-1;i++)pts[i]=tmp[i]}};
  const nz=n=>proj.rot([n[0]+FIT.cx,n[1]+FIT.cy,n[2]+FIT.cz])[2]; // z of a direction in view space (+ toward the viewer)
  const P2=p=>{const q=proj.proj(p);return[q.x,q.y,q.z,q.d,q.fog]};
  const HA=32*Math.PI/180,HB=-11*Math.PI/180,HH=4.7;
  // colour: by secondary structure, by the carbon scheme, or a blue→red ramp along each chain (MOLSCRIPT's colourramp);
  // a colour of the user's own wins over each
  const ssCol=t=>t==='H'?P.helix:t==='E'?P.sheet:t==='N'?(P.nucleic||'#e0a23a'):P.loop;
  const hsv=(h,s,v)=>{const f=(k)=>{const q=(k+h*6)%6;return v-v*s*Math.max(0,Math.min(q,4-q,1))};return'#'+[f(5),f(3),f(1)].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('')};
  const mode=R.fill,colourMode=cartoonMode();
  const tone=engraveTone;
  const drawItem=(z,alpha,fn)=>items.push({z,draw:(ctx)=>{ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';ctx.lineJoin='round';fn(ctx);ctx.restore()}});
  const poly=(ctx,q)=>{ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath()};
  const seg=(ctx,a,b)=>{ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])};
  /* one face: q = [a0,a1,b1,b0] projected (a = one long edge, b = the other); kind hatch|side|plain; edges = [a0a1,a1b1,b1b0,b0a0] */
  const face=(q,kind,znorm,back,edges,alpha,col)=>{const T=tone(col||P.loop);
    const z=Math.max(q[0][2],q[1][2],q[2][2],q[3][2]);alpha*=siteFade((q[0][0]+q[1][0]+q[2][0]+q[3][0])/4,(q[0][1]+q[1][1]+q[2][1]+q[3][1])/4,z);const d=(q[0][3]+q[1][3]+q[2][3]+q[3][3])/4,fog=(q[0][4]+q[2][4])/2,fk=1-fog*cfg.view.fog;
    drawItem(z,alpha,ctx=>{
      const ink=fogged(P.ink,fog),hatch=fogged(T.hatch,fog),side=fogged(T.side,fog);const fl=kind==='plain'?T.coil:T.fill;let fillC=fl?fogged(fl,fog):paperFill();
      /* the face's width on screen: a ribbon turned edge-on is a few pixels wide, and its lines must not fuse into a band.
         As it narrows, lines drop out symmetrically about the middle one (those left keep their place, so they run on unbroken
         from the wider faces) and none grows heavier than leaves some paper between them; the colour the dropped lines
         carried goes into a pale tint of the face, so a ribbon keeps about the same amount of colour at every angle */
      const wS=(Math.hypot(q[3][0]-q[0][0],q[3][1]-q[0][1])+Math.hypot(q[2][0]-q[1][0],q[2][1]-q[1][1]))/2;
      let hl=null;
      if(kind==='hatch'&&N>0){
        const g=clamp(Math.abs(znorm),0,1);const lw1=lw0*(T.coilLine?(1+0.8*(1-g))*(back?1.3:1):(0.55+1.8*(1-g))*(back?1.7:1)); /* colour in the lines: an even weight, so face-on ribbons keep their colour */
        const gap=wS/(N+1),stride=Math.max(1,Math.ceil(1.5*lw1/Math.max(gap,1e-6))),m=Math.ceil((N+1)/2);const lw=Math.min(lw1,0.7*gap*stride);
        const ks=[];for(let k=1;k<=N;k++)if(!((k-m)%stride))ks.push(k);if(wS<2*lw)ks.length=0;
        const lost=clamp(Math.min(1,N*lw1/Math.max(wS,1e-6))-ks.length*lw/Math.max(wS,1e-6),0,1);
        if(lost>0.02&&!fl)fillC=fogged(mix(P.paper,T.coilLine?col:T.hatch,(T.coilLine?0.55:0.3)*lost),fog);
        hl={lw,ks}}
      poly(ctx,q);if(kind==='side'){ctx.fillStyle=side;ctx.fill();ctx.lineWidth=0.5;ctx.strokeStyle=side;ctx.stroke()}else{ctx.fillStyle=fillC;ctx.fill();ctx.lineWidth=0.6;ctx.strokeStyle=fillC;ctx.stroke()}
      const la=Math.hypot(q[1][0]-q[0][0],q[1][1]-q[0][1])+Math.hypot(q[2][0]-q[3][0],q[2][1]-q[3][1]);
      if(kind==='plain'&&T.coilLine&&la>0.05){ctx.lineWidth=lw0*1.6;ctx.strokeStyle=hatch;ctx.beginPath();ctx.moveTo((q[0][0]+q[3][0])/2,(q[0][1]+q[3][1])/2);ctx.lineTo((q[1][0]+q[2][0])/2,(q[1][1]+q[2][1])/2);ctx.stroke()}
      if(hl&&hl.ks.length&&la>0.05){ctx.lineWidth=hl.lw;ctx.strokeStyle=hatch;ctx.beginPath();
        for(const k of hl.ks){const f=k/(N+1);ctx.moveTo(lerp(q[0][0],q[3][0],f),lerp(q[0][1],q[3][1],f));ctx.lineTo(lerp(q[1][0],q[2][0],f),lerp(q[1][1],q[2][1],f))}ctx.stroke()}
      // one pen weight throughout, as MOLSCRIPT's plots (no thickening toward the viewer); where a face is edge-on its two
      // edges nearly coincide, so each is drawn a little lighter and together they read as one outline, not a doubled one;
      // with colour in the lines, that outline takes the ribbon's dark shade, so a helix seen end-on stays coloured
      const ex=wS/Math.max(wInk,1e-6),tri=ex<1?ex:ex<2?2-ex:0;const eo=kind==='hatch'&&T.coilLine?clamp(1-(ex-1)/2.5,0,1):0;
      ctx.lineWidth=wInk*(0.8+0.2*fk)*(kind==='hatch'?1-0.4*tri:1);if(kind==='plain'&&luminance(col||P.loop)>0.3)ctx.lineWidth=Math.min(ctx.lineWidth,Math.max(0.4,wS*0.28));/* a thin tube's outline leaves its colour showing */ctx.strokeStyle=eo>0.02?fogged(mix(P.ink,T.side,eo),fog):ink;ctx.beginPath();
      if(edges[0])seg(ctx,q[0],q[1]);if(edges[1])seg(ctx,q[1],q[2]);if(edges[2])seg(ctx,q[2],q[3]);if(edges[3])seg(ctx,q[3],q[0]);ctx.stroke()});
  };
  const labels=[];let nH=0,nE=0;
  const traces=backboneTraces(atoms,sel);
  // nucleic acids: a rung from the backbone to each base's Watson-Crick edge (N1 of a purine, N3 of a pyrimidine), as
  // PyMOL's ladder, so a strand reads as a nucleic acid and a duplex as paired (a tube alone was a bare rope)
  const bases={},rungDone=new Set();for(const a of atoms)if(a.nucleic&&(a.name==='N1'||a.name==='N3'||a.name==='N9')){const b=bases[a.group]??={};b[a.name]=a}
  const rungs=Object.keys(bases).length<=600;   /* a ribosome's thousands of rungs are clutter, not bases: only for a few hundred nucleotides */
  const baseEnd=g=>{const b=bases[g];return b?(b.N9?b.N1:b.N3)||null:null};
  for(const tr of traces){
    const A=tr.atoms,n=A.length;const pts=A.map(a=>a.pos.slice());
    const rc=(i,t)=>ownColor(A[i])||(colourMode==='rainbow'?(mode==='ink colour'?hsv(0.6667*(1-i/Math.max(1,n-1)),0.9,0.8):hsv(0.6667*(1-i/Math.max(1,n-1)),0.75,0.95)):colourMode==='carbon'?carbonColor(A[i]):colourMode==='chain'?chainColor(A[i]):ssCol(t));
    // elements: runs of H (≥3 residues) and E (≥2), the rest coil; neighbours share their end residue, as MolAuto writes them
    const ss=A.map(a=>a.nucleic?'L':(a.ss==='H'||a.ss==='E'?a.ss:'L'));
    const runs=[];for(let i=0;i<n;){let j=i;while(j+1<n&&ss[j+1]===ss[i])j++;runs.push({t:ss[i],s:i,e:j});i=j+1}
    for(const r of runs)if((r.t==='H'&&r.e-r.s<2)||(r.t==='E'&&r.e-r.s<1))r.t='L';
    const el=[];for(const r of runs){const last=el[el.length-1];if(last&&last.t==='L'&&r.t==='L')last.e=r.e;else el.push({...r})}
    for(let k=0;k<el.length-1;k++)el[k].e=el[k+1].s;   // each element ends on the residue where the next begins
    for(const e of el){
      const idx=[];for(let i=e.s;i<=e.e;i++)idx.push(i);if(idx.length<2)continue;
      const alpha=A[idx[0]].alpha??1;
      if(e.t==='H'&&idx.length>=3){ /* ---- helix ---- */
        const p=idx.map(i=>pts[i]),m=p.length;const ax=new Array(m),tg=new Array(m);
        for(let i=1;i<m-1;i++){const c=norm3(sub3(p[i+1],p[i-1]));const r=norm3(cross3(sub3(p[i],p[i-1]),sub3(p[i+1],p[i])));
          ax[i]=add(scl(r,Math.cos(HA)),c,Math.sin(HA));tg[i]=scl(add(scl(c,Math.cos(HB)),r,Math.sin(HB)),HH)}
        ax[0]=ax[1];ax[m-1]=ax[m-2];
        const before=e.s>0?pts[e.s-1]:p[0],after=e.e<n-1?pts[e.e+1]:p[m-1];
        tg[0]=scl(norm3(sub3(p[1],before)),HH);tg[m-1]=scl(norm3(sub3(after,p[m-2])),HH);
        const secs=[];let ri=0;const push=(pos,a,hw,dir)=>{secs.push({p1:add(pos,a,hw),p2:add(pos,a,-hw),nrm:norm3(cross3(dir,a)),r:ri})};
        for(let i=0;i<m-1;i++){for(let s=0;s<SEG;s++){const t=s/SEG;ri=idx[t<0.5?i:i+1];const pos=herm(p[i],p[i+1],tg[i],tg[i+1],t);const dir=hermT(p[i],p[i+1],tg[i],tg[i+1],t);
          let a,hw;if(i===0){a=ax[0];hw=coilR+(helixW-coilR)*0.5*(1-Math.cos(Math.PI*t))}else if(i===m-2){a=ax[m-1];hw=coilR+(helixW-coilR)*0.5*(1+Math.cos(Math.PI*t))}else{a=norm3(add(scl(ax[i],1-t),ax[i+1],t));hw=helixW}
          if(s===0&&i>0&&i<m-2)a=ax[i];if(s===0&&i===0)hw=coilR;push(pos,a,hw,dir)}}
        ri=idx[m-1];push(p[m-1],ax[m-1],coilR,sub3(after,p[m-2]));
        const q=secs.map(c=>[P2(c.p1),P2(c.p2)]);
        const zs=[];for(let j=0;j<secs.length-1;j++)zs.push(nz(norm3(add(secs[j].nrm,secs[j+1].nrm))));
        const fold=j=>j>0&&j<zs.length&&(zs[j-1]<0)!==(zs[j]<0); // the section where the ribbon turns over: its silhouette, inked
        for(let j=0;j<zs.length;j++){const zn=zs[j];
          face([q[j][0],q[j+1][0],q[j+1][1],q[j][1]],'hatch',zn,zn<0,[1,fold(j+1),1,fold(j)],alpha,rc(secs[j].r,'H'))}
        nH++;labels.push({pos:p[Math.floor(m/2)],txt:'α'+nH,alpha});
      }else if(e.t==='E'&&idx.length>=3){ /* ---- strand ---- */
        const p=idx.map(i=>pts[i].slice()),m=p.length;const nm=new Array(m);
        for(let i=1;i<m-1;i++)nm[i]=norm3(sub3(p[i],mid(p[i-1],p[i+1])));nm[0]=nm[1];nm[m-1]=nm[m-2];
        priestle(p,2);
        for(let i=0;i<m-1;i++)if(dot3(nm[i],nm[i+1])<0)nm[i+1]=scl(nm[i+1],-1);
        {const sm=nm.map(v=>v.slice());for(let i=1;i<m-1;i++)sm[i]=norm3(add(add(nm[i-1],nm[i]),nm[i+1]));for(let i=1;i<m-1;i++)nm[i]=sm[i]}
        const perp=(i,dir)=>{const side=cross3(dir,nm[i]);nm[i]=norm3(cross3(side,dir))};
        perp(0,sub3(p[1],p[0]));for(let i=1;i<m-1;i++)perp(i,sub3(p[i+1],p[i-1]));perp(m-1,sub3(p[m-1],p[m-2]));
        const secs=[];let ri=idx[0];const box=(pos,nrm,side,w,t)=>({p1:add(add(pos,side,w),nrm,t),p2:add(add(pos,side,w),nrm,-t),p3:add(add(pos,side,-w),nrm,-t),p4:add(add(pos,side,-w),nrm,t),n:nrm,s:side,r:ri});
        const segs=SEG/2+1;let dir2=norm3(sub3(p[1],p[0])),v2=scl(sub3(p[1],p[0]),0.5);
        for(let i=0;i<m-2;i++){const dir1=dir2;dir2=norm3(sub3(p[i+2],p[i]));const v1=v2;v2=scl(sub3(p[i+2],p[i]),0.5);
          for(let s=0;s<segs;s++){const t=s/segs;ri=idx[t<0.5?i:i+1];const pos=herm(p[i],p[i+1],v1,v2,t);const dir=add(scl(dir1,1-t),dir2,t);const nrm=add(scl(nm[i],1-t),nm[i+1],t);const side=norm3(cross3(nrm,dir));secs.push(box(pos,nrm,side,strandW,thick))}}
        {ri=idx[m-1];const pos=p[m-2],nrm=nm[m-2],side=norm3(cross3(nrm,dir2));secs.push(box(pos,nrm,side,strandW,thick));secs.push({...box(pos,nrm,side,1.5*strandW,thick),step:true});
          const d1=dir2,d2=norm3(sub3(p[m-1],p[m-2]));const dm=mid(d1,d2),pm=mid(p[m-2],p[m-1]),nn=norm3(mid(nm[m-2],nm[m-1])),sd=norm3(cross3(nn,dm));secs.push(box(pm,nn,sd,0.75*strandW,thick));
          secs.push(box(p[m-1],nm[m-1],sd,0,thick))}
        const q=secs.map(c=>[P2(c.p1),P2(c.p2),P2(c.p3),P2(c.p4)]);
        for(let j=0;j<secs.length-1;j++){const c0=secs[j],c1=secs[j+1];const q0=q[j],q1=q[j+1];const isStep=!!c1.step;
          const nT=norm3(add(c0.n,c1.n)),nS=norm3(add(c0.s,c1.s));const zT=nz(nT),zS=nz(nS);const fc=rc(c0.r,'E');
          // top (p1,p4 edge) and bottom (p2,p3); only the face toward the viewer, as MOLSCRIPT culls
          if(zT>=0)face([q0[0],q1[0],q1[3],q0[3]],isStep?'bare':'hatch',zT,false,[1,0,1,j===0],alpha,fc);
          else face([q0[1],q1[1],q1[2],q0[2]],isStep?'bare':'hatch',-zT,false,[1,0,1,j===0],alpha,fc);
          // sides: p1–p2 (+side) and p4–p3 (−side)
          if(zS>=0)face([q0[0],q1[0],q1[1],q0[1]],'side',zS,false,[1,0,1,j===0],alpha,fc);
          else face([q0[3],q1[3],q1[2],q0[2]],'side',-zS,false,[1,0,1,j===0],alpha,fc)}
        {const c=secs[0],q0=q[0];const nb=scl(norm3(sub3(secs[1].p1,c.p1)),-1);if(nz(nb)>=0)face([q0[0],q0[1],q0[2],q0[3]],'side',1,false,[1,1,1,1],alpha,rc(idx[0],'E'))} // butt end
        nE++;labels.push({pos:p[Math.floor((m-1)/2)],txt:'β'+nE,alpha});
      }else{ /* ---- coil: smoothed spline, drawn as a paper band of constant width with an ink outline ---- */
        const p=idx.map(i=>pts[i].slice()),m=p.length;const first=e.s>0?pts[e.s-1]:null,last=e.e<n-1?pts[e.e+1]:null;
        priestle(p,2);
        const path=[p[0]],pr_i=[idx[0]];let v2=first?scl(sub3(p[1],first),0.5):sub3(p[1],p[0]);
        for(let i=0;i<m-1;i++){const v1=v2;v2=i===m-2?(last?scl(sub3(last,p[m-2]),0.5):sub3(p[m-1],p[m-2])):scl(sub3(p[i+2],p[i]),0.5);
          for(let s=1;s<SEG;s++){path.push(herm(p[i],p[i+1],v1,v2,s/SEG));pr_i.push(idx[s/SEG<0.5?i:i+1])}path.push(p[i+1]);pr_i.push(idx[i+1])}
        const pr=path.map(P2);const L=[],Rr=[];
        // a nucleic acid's backbone is a thicker tube; and however far away, a coil keeps some colour between its two
        // outlines (a tube narrower than two pen widths would be a black line: a ribosome's RNA became a tangle of them)
        const ct=A[idx[0]].nucleic?'N':'L',cw=coilR*(ct==='N'?1.6:1),hwMin=luminance(rc(idx[0],ct))>0.3?0.9*wInk:0;   // a dark coil is meant as a line (MOLSCRIPT's)
        for(let j=0;j<pr.length;j++){const a=pr[Math.max(0,j-1)],b=pr[Math.min(pr.length-1,j+1)];let tx=b[0]-a[0],ty=b[1]-a[1];const l=Math.hypot(tx,ty)||1;const hw=Math.max(cw*proj.pxPerA*pr[j][3],hwMin);
          L.push([pr[j][0]-ty/l*hw,pr[j][1]+tx/l*hw,pr[j][2],pr[j][3],pr[j][4]]);Rr.push([pr[j][0]+ty/l*hw,pr[j][1]-tx/l*hw,pr[j][2],pr[j][3],pr[j][4]])}
        const atEnd=(j,end)=>end===0?(j===0&&!first):(j===pr.length-2&&!last);
        for(let j=0;j<pr.length-1;j++)face([L[j],L[j+1],Rr[j+1],Rr[j]],'plain',1,false,[1,atEnd(j,1),1,atEnd(j,0)],alpha,rc(pr_i[j],ct));
        if(ct==='N'&&rungs)for(let k=0;k<m;k++){const a=A[idx[k]],e=baseEnd(a.group);if(!e||rungDone.has(a.group))continue;rungDone.add(a.group);
          const q0=P2(p[k]),q1=P2(e.pos);let tx=q1[0]-q0[0],ty=q1[1]-q0[1];const l=Math.hypot(tx,ty);if(l<1)continue;tx/=l;ty/=l;
          const w0=Math.max(cw*0.8*proj.pxPerA*q0[3],hwMin*0.9),w1=Math.max(cw*0.8*proj.pxPerA*q1[3],hwMin*0.9),nx=-ty,ny=tx;
          face([[q0[0]+nx*w0,q0[1]+ny*w0,q0[2],q0[3],q0[4]],[q1[0]+nx*w1,q1[1]+ny*w1,q1[2],q1[3],q1[4]],[q1[0]-nx*w1,q1[1]-ny*w1,q1[2],q1[3],q1[4]],[q0[0]-nx*w0,q0[1]-ny*w0,q0[2],q0[3],q0[4]]],'plain',1,false,[1,1,1,0],a.alpha??alpha,rc(idx[k],ct))}
      }
    }
  }
  if(R.ssLabels&&!cfg.show.noLabels){for(const lb of labels){const p=proj.proj(lb.pos);items.push({z:p.z+2,draw:(ctx)=>{ctx.save();ctx.globalAlpha=lb.alpha;
    const fs=Math.max(9,Math.round(0.8*proj.pxPerA*p.d*K));ctx.font=`italic ${fs}px 'Times New Roman', Times, serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    if(ctx.strokeText){ctx.lineWidth=3;ctx.strokeStyle=paperFill();ctx.strokeText(lb.txt,p.x,p.y)}ctx.fillStyle=P.label;ctx.fillText(lb.txt,p.x,p.y);ctx.restore()}})}}
}
function buildCartoon(items,st,pos,atoms,sel,proj,seedBase,lowDetail){
  if(cfg.rep.cartoonStyle==='engraved')return buildCartoonEngraved(items,atoms,sel,proj,seedBase);
  const P=cfg.palette,S=cfg.style;const K=cfg.rep.cartoonScale;const SPR=6; // samples per residue
  const traces=backboneTraces(atoms,sel);
  const ssColor=ss=>ss==='H'?P.helix:ss==='E'?P.sheet:ss==='N'?(P.nucleic||'#e0a23a'):P.loop;
  const sampColor=s=>{const cm=cartoonMode();return ownColor(s.atom)||(cm==='ss'?ssColor(s.ss):cm==='chain'?chainColor(s.atom):carbonColor(s.atom))};   // a colour of the user's own wins over the scheme
  traces.forEach((tr,ti)=>{
    const A=tr.atoms,n=A.length;const ss=A.map(a=>a.ss||'L');
    // smoothed control points (sheets flattened)
    const Pc=A.map((a,i)=>{if(ss[i]==='E'&&i>0&&i<n-1)return[0,1,2].map(k=>0.25*A[i-1].pos[k]+0.5*a.pos[k]+0.25*A[i+1].pos[k]);return a.pos});
    // per-residue width direction (3D) and face normal
    const Wd=[],Fn=[];let prevS=null;
    for(let i=0;i<n;i++){const im=Math.max(0,i-1),ip=Math.min(n-1,i+1);const t=norm3(sub3(Pc[ip],Pc[im]));
      if(ss[i]==='H'){const i0=Math.max(0,i-2),i1=Math.min(n-1,i+2);const c=[0,0,0];let m=0;for(let j=i0;j<=i1;j++){c[0]+=Pc[j][0];c[1]+=Pc[j][1];c[2]+=Pc[j][2];m++}const ctr=c.map(v=>v/m);
        let rad=sub3(A[i].pos,ctr);const ax=norm3(sub3(Pc[i1],Pc[i0]));rad=norm3(sub3(rad,v3([0,0,0],ax,dot3(rad,ax))));Wd.push(ax);Fn.push(rad)}
      else if(ss[i]==='E'){let z=[0,1,2].map(k=>A[im].pos[k]-2*A[i].pos[k]+A[ip].pos[k]);z=norm3(z);if(prevS&&dot3(z,prevS)<0)z=z.map(v=>-v);if(i===0||i===n-1)z=prevS||z;prevS=z;const w=norm3(cross3(t,z));Wd.push(w);Fn.push(z)}
      else{Wd.push(null);Fn.push(null);prevS=null}}
    // smooth sheet normals
    for(let i=1;i<n-1;i++)if(ss[i]==='E'&&Wd[i-1]&&Wd[i+1]&&ss[i-1]==='E'&&ss[i+1]==='E'){Wd[i]=norm3([0,1,2].map(k=>Wd[i-1][k]+2*Wd[i][k]+Wd[i+1][k]))}
    // helices at chain ends: borrow the neighbour's frame so the ribbon does not pinch
    if(n>2){if(ss[0]==='H'&&Wd[1]){Wd[0]=Wd[1];Fn[0]=Fn[1]}if(ss[n-1]==='H'&&Wd[n-2]){Wd[n-1]=Wd[n-2];Fn[n-1]=Fn[n-2]}}
    // strands: make neighbouring strands' face normals agree, so a sheet shades as one surface
    {const runs=[];let i=0;while(i<n){if(ss[i]!=='E'){i++;continue}let j=i;while(j<n&&ss[j]==='E')j++;runs.push([i,j]);i=j}
      for(let r=1;r<runs.length;r++){let best=1e9,dotSum=0;for(let a=runs[r][0];a<runs[r][1];a++)for(let q=0;q<r;q++)for(let b=runs[q][0];b<runs[q][1];b++){const dd=Math.hypot(...sub3(Pc[a],Pc[b]));if(dd<6&&Fn[a]&&Fn[b]){dotSum+=dot3(Fn[a],Fn[b]);best=Math.min(best,dd)}}
        if(best<6&&dotSum<0)for(let a=runs[r][0];a<runs[r][1];a++){if(Fn[a])Fn[a]=Fn[a].map(v=>-v)}}}
    // widths per residue (Å, half-width)
    const wRes=ss.map(s=>s==='H'?1.05*K:s==='E'?0.85*K:s==='N'?0.85*K:0.28*K);
    // strand arrow: last residue of each E run
    const arrowStart=ss.map((s,i)=>s==='E'&&(i===n-1||ss[i+1]!=='E'));
    // sample
    const samp=[];
    for(let i=0;i<n-1;i++){for(let k=0;k<SPR;k++){const t=k/SPR;const p3=catmull(Pc,i,t);
      let w=lerp(wRes[i],wRes[i+1],t);if(arrowStart[i])w=1.7*wRes[i]*(1-t)+0.02;else if(arrowStart[i+1]&&t>0.85)w=lerp(wRes[i],1.7*wRes[i+1],(t-0.85)/0.15);
      const W=Wd[i]&&Wd[i+1]?norm3([0,1,2].map(q=>lerp(Wd[i][q],Wd[i+1][q],t))):(Wd[i]||Wd[i+1]);const F=Fn[i]&&Fn[i+1]?norm3([0,1,2].map(q=>lerp(Fn[i][q],Fn[i+1][q],t))):(Fn[i]||Fn[i+1]);
      const s2=t<0.5?ss[i]:ss[i+1];const atom=t<0.5?A[i]:A[i+1];samp.push({p3,w,W,F,ss:s2,atom})}}
    const last=n-1;samp.push({p3:Pc[last],w:arrowStart[last]?0.02:wRes[last],W:Wd[last],F:Fn[last],ss:ss[last],atom:A[last]});
    // project
    const pr=samp.map(s=>proj.proj(s.p3));
    const L=[],Rr=[],front=[],zs=[];
    for(let j=0;j<samp.length;j++){const s=samp[j],p=pr[j];let wx,wy;const hw=s.w*proj.pxPerA*p.d;
      if(s.W){const d=proj.dir2(s.W);const l=Math.hypot(d[0],d[1])||1;wx=d[0]/l*hw;wy=d[1]/l*hw;
        const fr=proj.rot([s.F[0]+FIT.cx,s.F[1]+FIT.cy,s.F[2]+FIT.cz]);front.push(fr[2]>=0)}
      else{const q=pr[Math.min(samp.length-1,j+1)],q0=pr[Math.max(0,j-1)];let tx=q.x-q0.x,ty=q.y-q0.y;const l=Math.hypot(tx,ty)||1;wx=-ty/l*hw;wy=tx/l*hw;front.push(true)}
      L.push([p.x+wx,p.y+wy]);Rr.push([p.x-wx,p.y-wy]);zs.push(p.z)}
    const passes=lowDetail?1:cfg.style.passes;const seed=seedBase+ti*977;
    const fogs=pr.map(p=>p.fog),ds=pr.map(p=>p.d);
    // ink edges: pressure strokes along the full edge, later drawn per quad (clipped) so occlusion stays right
    const wInk=S.inkWidth*LW.outer;
    const mkEdge=(pts,sd)=>{const ps=sketchPasses(pts,{step:0,seed:sd,width:wInk,passes,ampScale:0.9,overshoot:false});
      for(const q of ps)q.pts.forEach((pt,k)=>{pt[2]*=ds[k]*(0.75+0.25*(1-fogs[k]*cfg.view.fog))});return ps};
    const Lj=mkEdge(L,seed),Rj=mkEdge(Rr,seed+13);
    // fill edges wobble independently of the ink (misregistration)
    const wob=(pts,sd)=>{const amp=S.rough*2.2*S.fillWobble;if(amp<0.05)return pts;const rng=mulberry32(sd);const nz=new Noise1(rng,20);let sacc=0;
      return pts.map((p,k)=>{if(k>0)sacc+=Math.hypot(p[0]-pts[k-1][0],p[1]-pts[k-1][1]);const a=pts[Math.max(0,k-1)],b=pts[Math.min(pts.length-1,k+1)];let tx=b[0]-a[0],ty=b[1]-a[1];const l=Math.hypot(tx,ty)||1;const o=amp*nz.at(sacc*0.025);return[p[0]-ty/l*o,p[1]+tx/l*o]})};
    const Lf=wob(L,seed+31),Rf=wob(Rr,seed+47);
    let wcRuns=null; // per quad: {canvas,x0,y0} of the wash for the face-run it belongs to
    if(isWC()){
      wcRuns=new Array(samp.length).fill(null);
      // one run per stretch of same secondary structure, same facing and same colour of the user's own; each gets its own small canvas so overlapping turns occlude rather than stack
      let j0=0;while(j0<samp.length-1){let j1=j0;while(j1<samp.length-1&&samp[j1+1].ss===samp[j0].ss&&front[j1+1]===front[j0]&&ownColor(samp[j1+1].atom)===ownColor(samp[j0].atom))j1++;
        const a0=Math.max(0,j0-1),a1=Math.min(samp.length-1,j1+2);const poly=[];for(let j=a0;j<=a1;j++)poly.push(L[j]);for(let j=a1;j>=a0;j--)poly.push(Rr[j]);
        if(poly.length>=3){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of poly){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1])}
          const m=10;x0=Math.floor(x0-m);y0=Math.floor(y0-m);const bw=Math.ceil(x1-x0+m),bh=Math.ceil(y1-y0+m);
          if(bw>0&&bh>0&&bw*bh<16e6){const cv=document.createElement('canvas');cv.width=Math.ceil(bw*RF.dpr);cv.height=Math.ceil(bh*RF.dpr);const wx=cv.getContext('2d',{willReadFrequently:true});wx.scale(RF.dpr,RF.dpr);wx.translate(-x0,-y0);
            const col=sampColor(samp[j0]);const fog=(fogs[j0]+fogs[j1])/2;
            watercolourShape(wx,poly,col,seed+j0*13,{fog,layers:10,strength:0.85,offscreen:true,noScale:true});
            const run={canvas:cv,x0,y0,w:bw,h:bh};for(let j=j0;j<=j1;j++)wcRuns[j]=run}}
        j0=j1+1}
    }
    // contour lines along the ribbon (front faces), broken like pencil
    const fr=[0.18,0.38,0.62,0.82].map(f=>{const c=Lf.map((p,k)=>[lerp(p[0],Rf[k][0],f),lerp(p[1],Rf[k][1],f)]);return sketchPasses(c,{step:0,seed:seed+Math.round(f*100),width:wInk*0.55,passes:1,ampScale:1.3,overshoot:false})[0]});
    const frMid=(()=>{const c=Lf.map((p,k)=>[(p[0]+Rf[k][0])/2,(p[1]+Rf[k][1])/2]);return sketchPasses(c,{step:0,seed:seed+77,width:wInk*0.55,passes:1,ampScale:1.3,overshoot:false})[0]})();
    const skipRng=mulberry32(seed+5);const skip=samp.map(()=>[skipRng(),skipRng(),skipRng(),skipRng(),skipRng()]);
    for(let j=0;j<samp.length-1;j++){
      const z=(zs[j]+zs[j+1])/2;const s=samp[j];
      items.push({z,draw:(ctx)=>{
        const fog=(fogs[j]+fogs[j+1])/2,fk=1-fog*cfg.view.fog;const d=(ds[j]+ds[j+1])/2;
        let col=sampColor(s);
        const baseCol=col;const isFront=front[j];col=fillFor(col);if(!isFront&&!isInk())col=shade(col,-0.14);col=fogged(col,fog);
        const q=[Lf[j],Lf[j+1],Rf[j+1],Rf[j]];
        ctx.save();ctx.globalAlpha=s.atom.alpha;
        ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=col;ctx.fill();ctx.lineWidth=0.8;ctx.strokeStyle=col;ctx.stroke()}else{ctx.lineWidth=0.8;ctx.strokeStyle=paperFill();ctx.stroke()}
        if(isPencil()){ctx.save();ctx.clip();const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);scribbleFill(ctx,Math.min(...xs)-2,Math.min(...ys)-2,Math.max(...xs)+2,Math.max(...ys)+2,baseCol,seed+j*7,{fog,d});ctx.restore()}
        if(wcRuns&&wcRuns[j]){ // reveal this quad's share of its run's wash (widened across the ribbon only, so neighbours never double up)
          const run=wcRuns[j];
          const wq=[L[j],L[j+1],Rr[j+1],Rr[j]];const mx0=(L[j][0]+Rr[j][0])/2,my0=(L[j][1]+Rr[j][1])/2,mx1=(L[j+1][0]+Rr[j+1][0])/2,my1=(L[j+1][1]+Rr[j+1][1])/2;
          const wid=(p,m)=>{const dx=p[0]-m[0],dy=p[1]-m[1];const l=Math.hypot(dx,dy)||1;return[p[0]+dx/l*4,p[1]+dy/l*4]};
          // also nudge each end 0.7px along the ribbon so the paper-coloured seam stroke is covered
          const tx=mx1-mx0,ty=my1-my0;const tl=Math.hypot(tx,ty)||1;const ex0=[-tx/tl*0.7,-ty/tl*0.7],ex1=[tx/tl*0.7,ty/tl*0.7];
          const w0=wid(wq[0],[mx0,my0]),w1=wid(wq[1],[mx1,my1]),w2=wid(wq[2],[mx1,my1]),w3=wid(wq[3],[mx0,my0]);
          const we=[[w0[0]+ex0[0],w0[1]+ex0[1]],[w1[0]+ex1[0],w1[1]+ex1[1]],[w2[0]+ex1[0],w2[1]+ex1[1]],[w3[0]+ex0[0],w3[1]+ex0[1]]];
          ctx.save();ctx.beginPath();we.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.clip();
          ctx.globalCompositeOperation=luminance(P.paper)>0.5?'multiply':'screen';ctx.drawImage(run.canvas,run.x0,run.y0,run.w,run.h);
          if(!isFront){ctx.globalAlpha*=0.35;ctx.drawImage(run.canvas,run.x0,run.y0,run.w,run.h)}
          ctx.restore()}
        // clip region: this quad (ideal + fill) expanded a little, extended along the tangent to cover the jittered ink
        const ex=(a,b,f)=>[a[0]+(a[0]-b[0])*f,a[1]+(a[1]-b[1])*f];
        const qq=[ex(L[j],L[j+1],0.35),ex(L[j+1],L[j],0.35),ex(Rr[j+1],Rr[j],0.35),ex(Rr[j],Rr[j+1],0.35)];
        const cx=(qq[0][0]+qq[2][0])/2,cy=(qq[0][1]+qq[2][1])/2;
        ctx.beginPath();qq.map(p=>{const dx=p[0]-cx,dy=p[1]-cy;const l=Math.hypot(dx,dy)||1;return[p[0]+dx/l*(3+S.rough*2),p[1]+dy/l*(3+S.rough*2)]}).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.clip();
        const ink=fogged(cm==='chain'&&!isInk()?mix(baseCol,P.ink,0.6):cm==='chain'?mix(baseCol,P.ink,0.75):P.ink,fog);const hatch=fogged(cfg.rep.fill==='ink colour'?mix(baseCol,P.hatch,0.2):P.hatch,fog);   // by chain: the outline a dark shade of the chain's colour
        if(s.ss!=='L'&&s.ss!=='N'){
          if(isFront){ // contour lines along the ribbon, broken at random
            const lines=isInk()?(s.ss==='H'?[fr[0],fr[1],fr[2],fr[3]]:[fr[1],fr[2]]):(s.ss==='H'?[fr[0],fr[1]]:[frMid]);
            lines.forEach((ln,li)=>{if(skip[j][li]<0.3)return;fillVarStroke(ctx,ln.pts,hatch,(isInk()?0.6:0.32)*(0.4+0.6*fk),Math.max(0,j-1),Math.min(ln.pts.length-1,j+2))});
          }else if(S.shading>0&&skip[j][2]>0.35){ // hatch across the back face
            const f=0.5;const a=[lerp(L[j][0],L[j+1][0],f),lerp(L[j][1],L[j+1][1],f)],b=[lerp(Rr[j][0],Rr[j+1][0],f),lerp(Rr[j][1],Rr[j+1][1],f)];
            sketchLine(ctx,[a,b],{seed:seed+j*3,passes:1,width:0.8*d,color:hatch,alpha:0.4*S.shading,ampScale:0.5,step:5,overshoot:false});
          }
        }
        for(let p=0;p<passes;p++){for(const E of[Lj,Rj]){const ps=E[p];fillVarStroke(ctx,ps.pts,ink,ps.alpha*(0.55+0.4*fk),Math.max(0,j-1),Math.min(ps.pts.length-1,j+2))}}
        if(j===0||j===samp.length-2){const e=j===0?[Lf[0],Rf[0]]:[Lf[samp.length-1],Rf[samp.length-1]];sketchLine(ctx,e,{seed:seed+5+j,width:wInk*d,color:ink,alpha:0.55+0.4*fk,ampScale:0.5,step:4,passes})}
        ctx.restore()}});
    }
  });
}

/* faint construction geometry: stick axes run past their ends, guide circles round spheres and hetero atoms, centre ticks */
function drawConstruction(ctx,st,pos,proj,seedBase){
  const P=cfg.palette,S=cfg.style;const w=S.inkWidth*LW.faint;const ink=P.ink;
  ctx.save();ctx.globalAlpha=0.28;
  for(const b of st.bonds){if(b.order===0)continue;const pa=pos[b.a],pb=pos[b.b];if(!pa||!pb)continue;const dx=pb.x-pa.x,dy=pb.y-pa.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;const e=proj.pxPerA*0.5;
    sketchLine(ctx,[[pa.x-ux*e,pa.y-uy*e],[pb.x+ux*e,pb.y+uy*e]],{seed:seedBase+strHash('c'+bkey(b.a,b.b)),passes:1,width:w,color:ink,alpha:b.alpha,ampScale:0.6,step:8,overshoot:false,pressure:0.2})}
  for(const a of st.atoms){const p=pos[a.id];if(!p)continue;const r=atomDrawR(a,proj)*p.d;
    if(a.sphere||a.el==='O'||a.el==='N'){sketchCircle(ctx,p.x,p.y,r*(a.sphere?1.35:2.2),{seed:seedBase+strHash('g'+a.id),passes:1,width:w,color:ink,alpha:a.alpha*0.9,wobScale:1.6})}
    const t=3;ctx.strokeStyle=rgba(ink,a.alpha*0.7);ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(p.x-t,p.y);ctx.lineTo(p.x+t,p.y);ctx.moveTo(p.x,p.y-t);ctx.lineTo(p.x,p.y+t);ctx.stroke()}
  ctx.restore();
}
let PAPER_FILL=null;
function paperFill(){return (isInk()&&PAPER_FILL)?PAPER_FILL:cfg.palette.paper}
/* Per-keyframe cameras. A keyframe may carry `view` ({yaw,pitch,roll,zoom,panX,panY}, any subset; the rest from cfg.view): the
   camera holds it through the keyframe and moves smoothly to the next keyframe's during the transition. A keyframe without one
   keeps the camera of the nearest earlier keyframe that has one (cyclically), so setting a view on the first keyframe alone
   fixes the camera for the whole loop. viewAt(frame) is the interpolated camera, or null when no keyframe has a view; cfg.view.fixed
   makes renderFrame ignore keyframe views (the app, whose own camera is then the truth for what is on screen). */
function keyView(i){const n=scene.keyframes.length;for(let k=0;k<n;k++){const K=scene.keyframes[(i-k+n)%n];if(K.view)return K.view}return null}
function viewAt(frame){
  if(!scene.keyframes.some(k=>k.view))return null;
  const {seg,t}=locate(frame);const V=cfg.view;
  const fill=v=>({yaw:v.yaw??V.yaw,pitch:v.pitch??V.pitch,roll:v.roll??(V.roll||0),zoom:v.zoom??V.zoom,panX:v.panX??V.panX,panY:v.panY??V.panY});
  const a=fill(keyView(seg.kf)||V);if(seg.type!=='trans')return a;
  const b=fill(keyView((seg.kf+1)%scene.keyframes.length)||V);const s=smooth(t);
  const ang=(p,q)=>p+((((q-p)%360)+540)%360-180)*s;   // the short way round
  return {yaw:ang(a.yaw,b.yaw),pitch:lerp(a.pitch,b.pitch,s),roll:ang(a.roll,b.roll),zoom:Math.exp(lerp(Math.log(a.zoom),Math.log(b.zoom),s)),panX:lerp(a.panX,b.panX,s),panY:lerp(a.panY,b.panY,s)};
}
function frameView(frame){ // the camera for a frame: cfg.view (plus turntable) or the keyframe views
  const V=cfg.view;const kv=V.fixed?null:viewAt(frame);const yaw=kv?kv.yaw:V.yaw,pitch=kv?kv.pitch:V.pitch;
  VIEW_ROLL=kv?kv.roll:(V.roll||0);VIEW_ZOOM=kv?kv.zoom:V.zoom;VIEW_PANX=kv?kv.panX:V.panX;VIEW_PANY=kv?kv.panY:V.panY;
  VIEW_YAW=yaw+V.spin*frame/Math.max(1,cfg.fps);VIEW_PITCH=pitch+V.pitchSwing*Math.sin(frame/Math.max(1,cfg.fps)*Math.PI*2*Math.max(1e-6,Math.abs(V.spin))/360);
}
/* The sampled state of a frame and the projector renderFrame would use for it on a W×H canvas: for hit-testing atoms and bonds on
   screen, overlays, and view scoring. proj.proj(pos) gives {x,y} in the canvas's CSS pixels. */
function projectFrame(W,H,frame){frameView(frame);const drawn=Math.floor(frame/Math.max(1,cfg.stepEvery))*Math.max(1,cfg.stepEvery);const st=sampleState(drawn);computeFit();return {st,proj:makeProjector(W,H),drawn}}
/* Figure labels (scene.labels): text the author places while making the figure. Each is pinned to an atom ({at: id},
   so it turns with the molecule) or to the canvas ({x, y} as fractions); dx, dy (px) move the text off its anchor, and
   once it is off far enough a leader runs back to the anchor. Drawn over everything, with a paper halo. */
function labelFont(fs){const S=cfg.style;return `${S.font==='Plain sans'?'600':'500'} ${fs}px ${S.font==='Plain sans'?'"IBM Plex Sans", system-ui, sans-serif':`"${S.font}", "Caveat", cursive`}`}
function figLabelLayout(ctx,st,proj,W,H){const L=(scene&&scene.labels)||[];const out=[];if(!L.length)return out;const A={};for(const a of st.atoms)A[a.id]=a;
  L.forEach((l,i)=>{let ax,ay,alpha=1;
    if(l.at){const a=A[l.at];if(!a||a.alpha<0.05)return;const p=proj.proj(a.pos);ax=p.x;ay=p.y;alpha=a.alpha}else{ax=(l.x??0.5)*W;ay=(l.y??0.5)*H}
    const fs=Math.max(6,Math.round(cfg.style.labelSize*(l.size||1)));ctx.font=labelFont(fs);const text=String(l.text||'');
    out.push({i,ax,ay,x:ax+(l.dx||0),y:ay+(l.dy||0),w:ctx.measureText(text).width,h:fs*1.15,fs,alpha,anchored:!!l.at,text})});
  return out}
function drawFigLabels(ctx,boxes,seedBase){const P=cfg.palette,S=cfg.style;
  for(const b of boxes){ctx.save();ctx.globalAlpha=b.alpha;
    if(b.anchored){const vx=b.ax-b.x,vy=b.ay-b.y,hw=b.w/2+4,hh=b.h/2+2;const t=Math.min(hw/Math.max(Math.abs(vx),1e-6),hh/Math.max(Math.abs(vy),1e-6));const L=Math.hypot(vx,vy);
      if(t<1&&L*(1-t)>10){const ex=b.x+vx*t,ey=b.y+vy*t;const k=Math.max(0,(L-4)/L);   // stop short of the atom
        sketchLine(ctx,[[ex,ey],[b.x+vx*k,b.y+vy*k]],{seed:seedBase+7001+b.i*13,width:Math.max(0.7,S.inkWidth*0.6),color:P.label,alpha:0.85,ampScale:0.5,overshoot:false,step:4})}}
    ctx.font=labelFont(b.fs);ctx.textAlign='center';ctx.textBaseline='middle';
    if(ctx.strokeText){ctx.lineJoin='round';ctx.lineWidth=Math.max(2.5,b.fs*0.22);ctx.strokeStyle=P.paper;ctx.strokeText(b.text,b.x,b.y)}
    ctx.fillStyle=P.label;ctx.fillText(b.text,b.x,b.y);ctx.restore()}}
/** the figure labels' boxes on a canvas of W×H at this frame, for picking them in the app */
let MEASURE=null;
function figLabelBoxes(W,H,frame){const {st,proj}=projectFrame(W,H,frame);if(!MEASURE)MEASURE=document.createElement('canvas').getContext('2d');return figLabelLayout(MEASURE,st,proj,W,H)}
function renderFrame(ctx,W,H,frame,dpr){
  RF={W,H,dpr};
  TEX=1;frameView(frame);
  const drawn=Math.floor(frame/Math.max(1,cfg.stepEvery))*Math.max(1,cfg.stepEvery);
  const st=sampleState(drawn);
  // a host that measures text itself (the Python package) cannot answer at once: it hears of the words it has not
  // measured when the frame is done, and draws the frame again. Every text a frame measures is looked at here first, and
  // if the host would have to learn a word the frame stops before drawing anything (a large figure is not drawn twice)
  if(textGate){probeTexts(ctx,st);if(textGate())return st}
  const boil=Math.floor(drawn/Math.max(1,cfg.boilEvery));
  const seedBase=boil*7919;
  computeFit();const proj=makeProjector(W,H);TEX=cfg.rep.textureScale==='object'?clamp(proj.pxPerA/48,0.35,6):1;
  const P=cfg.palette,S=cfg.style,SH=cfg.show;
  ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
  const pc=paper(W,H,dpr,boil);ctx.drawImage(pc,0,0,W,H)
  try{PAPER_FILL=ctx.createPattern(pc,'no-repeat');if(PAPER_FILL&&PAPER_FILL.setTransform)PAPER_FILL.setTransform(new DOMMatrix().scale(1/dpr))}catch(e){PAPER_FILL=null}
  if(SH.context)drawContext(ctx,proj,st,seedBase);
  const pos={};for(const a of st.atoms)pos[a.id]=proj.proj(a.pos);
  if(SH.construction)drawConstruction(ctx,st,pos,proj,seedBase);
  const reps=scene.reps||{sticks:'all',cartoon:'',surface:''};
  const selS=compileSel(reps.sticks),selC=compileSel(reps.cartoon),selF=compileSel(reps.surface);
  const cartoonOn=!!(reps.cartoon&&reps.cartoon.trim());
  const cartoonRes=new Set();if(cartoonOn)for(const a of st.atoms)if(selC(a)&&a.name==='CA'&&!a.het)cartoonRes.add((a.chain||'')+'/'+a.resi);
  const selSite=compileSel(cfg.rep.siteSel||'');const siteOn=!!(cfg.rep.siteSel&&cfg.rep.siteSel.trim());
  for(const a of st.atoms)a._site=siteOn&&selSite(a);
  SITE=null;if(siteOn){let sx=0,sy=0,sz=0,n=0;for(const a of st.atoms)if(a._site&&a.el!=='H'){const p=pos[a.id];sx+=p.x;sy+=p.y;sz+=p.z;n++}
    if(n){sx/=n;sy/=n;sz/=n;let r=0;for(const a of st.atoms)if(a._site&&a.el!=='H'){const p=pos[a.id];r=Math.max(r,Math.hypot(p.x-sx,p.y-sy))}
      let zmin=Infinity;for(const a of st.atoms)if(a._site)zmin=Math.min(zmin,pos[a.id].z);
      SITE={x:sx,y:sy,z:sz,zmin,r:r+2.5*proj.pxPerA,quiet:clamp(cfg.rep.siteQuiet??0.35,0,1),cut:cfg.rep.siteCutaway!==false}}}
  const stickAtoms=st.atoms.filter(a=>{if(!selS(a)&&!a._site)return false;if(a.el==='H'&&!SH.H)return false;
    if(cfg.rep.sideChainHelper&&cartoonRes.has((a.chain||'')+'/'+a.resi)&&(a.name==='N'||a.name==='C'||a.name==='O'||a.name==='OXT'))return false;return true});
  const stickIds=new Set(stickAtoms.map(a=>a.id));
  const stickBonds=st.bonds.filter(b=>stickIds.has(b.a)&&stickIds.has(b.b));
  const surfAtoms=reps.surface&&reps.surface.trim()?st.atoms.filter(a=>selF(a)&&(SH.H||a.el!=='H')):[];
  const items=[];const lowDetail=cfg.rep.detail!=='full'&&(stickAtoms.length+surfAtoms.length)>260;   // 'full': every atom gets the whole treatment however many there are
  if(cfg.rep.mode==='sticks')buildSticks(items,st,pos,stickAtoms,stickBonds,proj,seedBase,lowDetail);else buildBallStick(items,st,pos,stickAtoms,stickBonds,proj,seedBase,lowDetail);
  if(cartoonOn)buildCartoon(items,st,pos,st.atoms,selC,proj,seedBase,lowDetail);
  if(surfAtoms.length)buildSurface(items,st,pos,surfAtoms,proj,seedBase,lowDetail);
  if(scene.map)buildMap(items,st,pos,proj,seedBase);
  items.sort((u,v)=>u.z-v.z);
  for(const it of items)it.draw(ctx);
  drawMapCaption(ctx,W,H);
  // annotations on stick atoms
  const fontFam=S.font==='Plain sans'?'"IBM Plex Sans", system-ui, sans-serif':`"${S.font}", "Caveat", cursive`;
  for(const a of stickAtoms){const p=pos[a.id];const r=atomDrawR(a,proj)*p.d;const seed=seedBase+strHash(a.id);
    if(SH.lonePairs&&a.lps.length){ctx.save();ctx.globalAlpha=a.alpha;
      const an=S.annot||1;a.lps.forEach((lp,i)=>{const d=proj.dir2(lp.dir);const L=Math.hypot(d[0],d[1])||1;const ux=d[0]/L,uy=d[1]/L;const cx=p.x+ux*(r+5*an),cy=p.y+uy*(r+5*an);
        ctx.fillStyle=rgba(P.ink,0.9*lp.alpha);const rng=mulberry32(seed+i*3);
        for(const s of[-2.6*an,2.6*an]){ctx.beginPath();ctx.arc(cx-uy*s+(rng()-0.5),cy+ux*s+(rng()-0.5),1.35*p.d*an,0,Math.PI*2);ctx.fill()}});
      ctx.restore()}
    if(SH.charges&&a.charges.length){ctx.save();ctx.globalAlpha=a.alpha;
      const an=S.annot||1;a.charges.forEach((c,i)=>{const cx=p.x+r*0.95+7*an,cy=p.y-r*0.95-6*an;const cr=7*p.d*an;
        ctx.font=`600 ${Math.round(15*p.d*an)}px ${fontFam}`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=rgba(P.charge,c.alpha);ctx.fillText(c.text,cx,cy+0.5);
        sketchCircle(ctx,cx,cy,cr,{seed:seed+50+i,width:1,color:P.charge,alpha:0.85*c.alpha,passes:1,wobScale:1.5})});
      ctx.restore()}
    if(SH.labels&&!SH.noLabels&&a.label&&(!a.labelAuto||SH.resLabels)){const d=a.labelDir||[0.7,-0.7];const L=Math.hypot(d[0],d[1])||1;
      ctx.save();ctx.globalAlpha=a.alpha*0.92;ctx.font=`${S.font==='Plain sans'?'600':'500'} ${S.labelSize}px ${fontFam}`;ctx.fillStyle=P.label;
      ctx.textAlign=d[0]>0.25?'left':d[0]<-0.25?'right':'center';ctx.textBaseline=d[1]>0.25?'top':d[1]<-0.25?'bottom':'middle';
      ctx.fillText(a.label,p.x+d[0]/L*(r+9),p.y+d[1]/L*(r+9));ctx.restore()}
  }
  if(SH.arrows&&st.arrowAlpha>0&&st.arrowProg>0){
    st.arrows.forEach((ar,i)=>{
      const to0=anchorPoint(ar.to,st,proj,null),from0=anchorPoint(ar.from,st,proj,null);if(!to0||!from0)return;
      const from=anchorPoint(ar.from,st,proj,to0),to=anchorPoint(ar.to,st,proj,from0);if(!from||!to)return;
      drawArrow(ctx,from,to,{seed:seedBase+900+i*31,width:S.inkWidth*1.15*(S.annot||1),scale:S.annot||1,color:P.arrow,alpha:st.arrowAlpha,bulge:ar.bulge??0.4,curl:(ar.curl||0)*proj.pxPerA,side:ar.side??1,prog:st.arrowProg});
    });
  }
  if(!SH.noLabels&&SH.figLabels!==false)drawFigLabels(ctx,figLabelLayout(ctx,st,proj,W,H),seedBase);
  if(SH.caption){ctx.save();ctx.font=`500 ${S.captionSize}px ${fontFam}`;ctx.fillStyle=P.ink;ctx.textBaseline='bottom';ctx.textAlign='left';
    const margin=22,maxW=W-margin*2;
    for(const c of st.captions){if(!c.text||c.alpha<=0.01)continue;ctx.globalAlpha=c.alpha;wrapText(ctx,c.text,margin,H-margin,maxW,S.captionSize*1.15)}
    ctx.restore()}
  if(SH.stepLabel&&(scene.keyframes||[]).length>1){ctx.save();ctx.font=`500 ${Math.round(S.captionSize*0.8)}px ${fontFam}`;ctx.fillStyle=rgba(P.ink,0.75);ctx.textBaseline='top';ctx.textAlign='left';
    ctx.fillText(`${st.stepIdx+1}. ${st.stepName}`,22,18);ctx.restore()}
  // paper grain over everything, so fills sit in the paper rather than on it
  if(S.grain>0){ctx.save();const light=luminance(P.paper)>0.5;ctx.globalCompositeOperation=light?'multiply':'screen';ctx.globalAlpha=clamp(0.55*S.grain,0,1);ctx.drawImage(grainOverlay(W,H,dpr,light),0,0,W,H);ctx.restore()}
  if(isChalk()){ctx.save();ctx.globalCompositeOperation='multiply';ctx.globalAlpha=0.75;ctx.drawImage(pitOverlay(W,H,dpr),0,0,W,H);ctx.restore()}
  ctx.restore();
  return st;
}
const grainCache=canvasCache();
/* the tooth of a chalkboard: dark pits that break every stroke, multiplied over the drawing */
const pitCache=canvasCache();
function pitOverlay(W,H,dpr){const key=[W,H,dpr].join('|');const hit=pitCache.get(key);if(hit)return hit;
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.fillStyle='#ffffff';x.fillRect(0,0,W,H);const rng=mulberry32(8765);const n=Math.round(W*H/9);
  for(let i=0;i<n;i++){const a=rng();x.fillStyle=`rgba(0,0,0,${0.25+a*0.55})`;const s=rng()<0.8?1:1.6;x.fillRect(rng()*W,rng()*H,s,s)}
  return pitCache.put(key,c)}
function grainOverlay(W,H,dpr,light){
  const key=[W,H,dpr,light].join('|');const hit=grainCache.get(key);if(hit)return hit;
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.fillStyle=light?'#ffffff':'#000000';x.fillRect(0,0,W,H);const rng=mulberry32(4321);
  const n=Math.round(W*H/26);
  for(let i=0;i<n;i++){const a=rng();x.fillStyle=light?`rgba(60,45,25,${0.05+a*0.13})`:`rgba(255,245,225,${0.04+a*0.1})`;const sz=rng()<0.8?1:1.5;x.fillRect(rng()*W,rng()*H,sz,sz)}
  x.lineWidth=0.7;for(let i=0;i<260;i++){const px=rng()*W,py=rng()*H,an=rng()*Math.PI,l=8+rng()*30;x.strokeStyle=light?`rgba(70,55,35,${0.05+rng()*0.08})`:`rgba(255,245,225,${0.04+rng()*0.07})`;x.beginPath();x.moveTo(px,py);x.lineTo(px+Math.cos(an)*l,py+Math.sin(an)*l);x.stroke()}
  return grainCache.put(key,c);
}
let textGate=null;   // () => true when the host has words to learn (see renderFrame)
/* the texts a frame measures (the map's caption, figure labels, the scene's captions), in their fonts, whole: the host
   measures words, so a whole text asks for every word its wrapping will */
function probeTexts(ctx,st){const S=cfg.style,SH=cfg.show;const fontFam=S.font==='Plain sans'?'"IBM Plex Sans", system-ui, sans-serif':`"${S.font}", "Caveat", cursive`;
  ctx.save();const M=scene.map;
  if(M&&M.opts.caption&&M.caption){ctx.font=`${Math.max(9,Math.round(S.labelSize*0.6))}px "IBM Plex Sans", system-ui, sans-serif`;ctx.measureText(M.caption+' · the rest of the assembly (not in the model) left out')}
  if(!SH.noLabels&&SH.figLabels!==false)for(const l of (scene.labels||[])){ctx.font=labelFont(Math.max(6,Math.round(S.labelSize*(l.size||1))));ctx.measureText(String(l.text||''))}
  if(SH.caption){ctx.font=`500 ${S.captionSize}px ${fontFam}`;for(const c of st.captions||[])if(c.text)ctx.measureText(c.text)}
  ctx.restore()}
function wrapText(ctx,text,x,yBottom,maxW,lh){
  const words=text.split(' ');const lines=[];let cur='';
  for(const w of words){const t=cur?cur+' '+w:w;if(ctx.measureText(t).width>maxW&&cur){lines.push(cur);cur=w}else cur=t}
  if(cur)lines.push(cur);
  lines.forEach((l,i)=>ctx.fillText(l,x,yBottom-(lines.length-1-i)*lh));
}
buildTimeline();
return {
  get cfg(){return cfg}, set cfg(v){cfg=v;migrateCfg()},
  get scene(){return scene}, set scene(v){scene=v;FIT.key='';buildTimeline()},
  get TL(){return TL},
  renderFrame, sampleState, locate, buildTimeline, demoScene, compileSel, projectFrame, figLabelBoxes, viewAt,
  DEFAULT_CFG, PRESETS, GROUP_PALETTE, SUBUNIT_COLS,
  invalidatePaper(){paperCache.clear();baseCache.clear();grainCache.clear()},
  setTextGate(f){textGate=f||null},
};
}
