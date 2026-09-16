/* The classic engine: the canvas renderer of triad-sketch.html, verbatim apart from the hooks at the end.
   It is the reference look. Everything here is plain JavaScript; the app talks to it through createClassic(). */
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
function hexToRgb(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255]}
function rgba(h,a){const[r,g,b]=hexToRgb(h);return`rgba(${r},${g},${b},${a})`}
function mix(h1,h2,t){const a=hexToRgb(h1),b=hexToRgb(h2);const c=a.map((v,i)=>Math.round(lerp(v,b[i],t)));return'#'+c.map(v=>v.toString(16).padStart(2,'0')).join('')}
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
  style:{rough:1.1,passes:2,pressure:0.55,fillWobble:1,hatchDensity:1.4,hierarchy:0.6,wash:0.3,washSeed:1,washLife:0.6,inkWidth:1.5,ballScale:1,bondWidth:2.1,hatchSpacing:5,hatchAngle:-40,lightAngle:-125,shading:0.65,pencilFill:0.55,grain:0.6,font:'Caveat',labelSize:19,captionSize:24,contextAlpha:0.5},
  show:{H:true,lonePairs:true,charges:true,arrows:true,labels:true,hbonds:true,context:false,caption:true,stepLabel:true,colorBonds:false,resLabels:false,valence:true,construction:false},
  palette:{...PRESETS['PyMOL flat']},
  rep:{mode:'sticks',fill:'flat',colorBy:'group',stickRadius:0.2,sphereScale:0.4,sideChainHelper:true,cartoonScale:1,cartoonColor:'ss',probe:1.4,surfaceScale:1,surfaceOpacity:1,surfaceColor:'carbon'},
  pdbFrames:2
};
let cfg=JSON.parse(JSON.stringify(DEFAULT_CFG));

function migrateCfg(){const v=cfg.view;if(v.fov===undefined)v.fov=v.perspective!==undefined?Math.round(8+v.perspective*40):20;if(v.fogStart===undefined)v.fogStart=0.45;if(v.spin===undefined)v.spin=0;if(v.pitchSwing===undefined)v.pitchSwing=0;delete v.perspective;delete v.depthGain;if(cfg.style.pressure===undefined)cfg.style.pressure=0.55;if(cfg.style.fillWobble===undefined)cfg.style.fillWobble=1;if(cfg.style.hatchDensity===undefined)cfg.style.hatchDensity=1.4;if(cfg.style.hierarchy===undefined)cfg.style.hierarchy=0.6;if(cfg.style.wash===undefined)cfg.style.wash=0.3;if(cfg.style.washSeed===undefined)cfg.style.washSeed=1;if(cfg.style.washLife===undefined)cfg.style.washLife=0.6;if(!cfg.palette.nucleic)cfg.palette.nucleic='#e0a23a';if(!cfg.palette.wash||cfg.palette.wash==='#c9b48a'||cfg.palette.wash==='#c9a97a'||cfg.palette.wash==='#c7d0d8')cfg.palette.wash=cfg.palette.paper&&luminance(cfg.palette.paper)>0.9?'#7fb2c9':'#d1a35b';if(cfg.show.construction===undefined)cfg.show.construction=false}
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
function sampleState(frame){
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
  const atoms=[];const ids=new Set([...Object.keys(Ki.atoms),...(isTrans?Object.keys(Kj.atoms):[])]);
  const A={};
  for(const id of ids){
    const a=Ki.atoms[id],b=isTrans?Kj.atoms[id]:undefined;
    let o;
    if(a&&b){
      o={id,el:a.el||b.el,pos:lerp3(a.pos,b.pos,tm),alpha:lerp(a.opacity??1,b.opacity??1,tm),r:a.r??b.r,color:a.color??b.color,label:a.label??b.label,labelDir:a.labelDir??b.labelDir,labelAuto:a.labelAuto,charges:[],lps:[]};
      const ca=chargeText(a.charge),cb=chargeText(b.charge);
      if(ca&&ca===cb)o.charges.push({text:ca,alpha:1});else{if(ca)o.charges.push({text:ca,alpha:1-tm});if(cb)o.charges.push({text:cb,alpha:tm})}
      const la=a.lp||[],lb=b.lp||[];
      if(la.length===lb.length){la.forEach((d,i)=>o.lps.push({dir:lerp3(d,lb[i],tm),alpha:1}))}
      else{la.forEach(d=>o.lps.push({dir:d,alpha:1-tm}));lb.forEach(d=>o.lps.push({dir:d,alpha:tm}))}
    }else if(a){ // exiting (or holding)
      const to=a.exitTo||a.pos;
      o={id,el:a.el,pos:isTrans?lerp3(a.pos,to,tm):a.pos,alpha:(a.opacity??1)*(isTrans?1-tm:1),r:a.r,color:a.color,label:a.label,labelDir:a.labelDir,labelAuto:a.labelAuto,charges:[],lps:[]};
      const c=chargeText(a.charge);if(c)o.charges.push({text:c,alpha:1});(a.lp||[]).forEach(d=>o.lps.push({dir:d,alpha:1}));
    }else{ // entering
      const from=b.enterFrom||b.pos;
      o={id,el:b.el,pos:lerp3(from,b.pos,tm),alpha:(b.opacity??1)*tm,r:b.r,color:b.color,label:b.label,labelDir:b.labelDir,labelAuto:b.labelAuto,charges:[],lps:[]};
      const c=chargeText(b.charge);if(c)o.charges.push({text:c,alpha:1});(b.lp||[]).forEach(d=>o.lps.push({dir:d,alpha:1}));
    }
    o.el=(o.el||'C').toUpperCase();
    const src=a||b;o.resn=src.resn;o.resi=src.resi;o.chain=src.chain;o.name=src.name??id;o.het=src.het;o.group=src.group;o.ss=src.ss;o.sphere=src.sphere;o.trace=src.trace;o.nucleic=src.nucleic;o.entity=src.entity;o.subunit=src.subunit;
    atoms.push(o);A[id]=o;
  }
  // bonds
  const bonds=[];const Bi={},Bj={};
  const norm=b=>Array.isArray(b)?{a:b[0],b:b[1],order:b[2]??1}:{a:b.a,b:b.b,order:b.order??1};
  (Ki.bonds||[]).forEach(b=>{const o=norm(b);Bi[bkey(o.a,o.b)]=o});
  if(isTrans)(Kj.bonds||[]).forEach(b=>{const o=norm(b);Bj[bkey(o.a,o.b)]=o});
  const keys=new Set([...Object.keys(Bi),...Object.keys(Bj)]);
  for(const k of keys){
    const bi=Bi[k],bj=Bj[k];const src=bi||bj;if(!A[src.a]||!A[src.b])continue;
    const base=Math.min(A[src.a].alpha,A[src.b].alpha);
    if(bi&&bj){
      if(bi.order===bj.order)bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base,partial:0});
      else if(bi.order===0||bj.order===0){bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base*(1-tm),partial:0});bonds.push({a:bj.a,b:bj.b,order:bj.order,alpha:base*tm,partial:0})}
      else bonds.push({a:bi.a,b:bi.b,order:lerp(bi.order,bj.order,tm),alpha:base,partial:0});
    }else if(bi){ bonds.push({a:bi.a,b:bi.b,order:bi.order,alpha:base,partial:isTrans?(1-tm):0}) }
    else{ bonds.push({a:bj.a,b:bj.b,order:bj.order,alpha:base,partial:tm}) }
  }
  // captions
  let capA=Ki.caption||'',capAa=1,capB='',capBa=0;
  if(isTrans){capAa=1-smooth((t-0.5)/0.22);capB=Kj.caption||'';capBa=smooth((t-0.76)/0.22)}
  return {atoms,A,bonds,arrows:(Ki.arrows||[]),arrowProg,arrowAlpha,kf:seg.kf,t,isTrans,captions:[{text:capA,alpha:capAa},{text:capB,alpha:capBa}],stepIdx:seg.kf,stepName:Ki.name||('step '+(seg.kf+1))};
}

/* ============================ projection ============================ */
let FIT={cx:0,cy:0,cz:0,rx:0,ry:0,spanX:10,spanY:10,zspan:4,key:''};
function rot3(p,cy,sy,cp,sp){const x=p[0]-FIT.cx,y=p[1]-FIT.cy,z=p[2]-FIT.cz;const x1=x*cy+z*sy,z1=-x*sy+z*cy;return[x1,y*cp-z1*sp,y*sp+z1*cp]}
let VIEW_YAW=0,VIEW_PITCH=0; // effective angles for the frame being drawn (base + turntable)
function computeFit(){
  const spinning=cfg.view.spin!==0||cfg.view.pitchSwing!==0;
  const key=scene.keyframes.length+'|'+(spinning?'sphere':VIEW_YAW+'|'+VIEW_PITCH)+'|'+(scene._rev||0);
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
  const base=Math.min((W*0.9)/(FIT.spanX+2.6),(H-capH-topH-24)/(FIT.spanY+2.4))*cfg.view.zoom/Math.pow(dNear,0.7);
  const ox=W/2-FIT.rx*base+cfg.view.panX*W,oy=(H-capH+topH)/2+FIT.ry*base+cfg.view.panY*H;
  const fs=clamp(cfg.view.fogStart,0,0.95);
  return {pxPerA:base,D,
    rot(p){return rot3(p,cy,sy,cp,sp)},
    proj(p){const r=this.rot(p);
      const d=D===Infinity?1:clamp(D/(D-r[2]),0.2,4);          // true perspective: near larger, far smaller
      const t=clamp(0.5-r[2]/(FIT.zspan+1e-6),0,1);            // 0 nearest … 1 farthest
      const fog=clamp((t-fs)/(1-fs),0,1);                       // fog begins at fogStart, like PyMOL's depth cue
      return{x:ox+(r[0]-FIT.rx)*base*d+FIT.rx*base,y:oy-((r[1]-FIT.ry)*base*d+FIT.ry*base),z:r[2],d,fog}},
    dir2(v){const r=this.rot([v[0]+FIT.cx,v[1]+FIT.cy,v[2]+FIT.cz]);return[r[0],-r[1]]}
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
  const nx=-dy/L*o.side,ny=dx/L*o.side;const c=[mx+nx*o.bulge*L,my+ny*o.bulge*L];
  const n=32;const pts=[];const m=Math.max(2,Math.round(n*o.prog));
  for(let i=0;i<=m;i++){const t=(i/n);const x=(1-t)*(1-t)*p0[0]+2*(1-t)*t*c[0]+t*t*p1[0];const y=(1-t)*(1-t)*p0[1]+2*(1-t)*t*c[1]+t*t*p1[1];pts.push([x,y])}
  sketchLine(ctx,pts,{seed:o.seed,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.8,overshoot:false});
  // head
  const e=pts[pts.length-1],q=pts[pts.length-2];let tx=e[0]-q[0],ty=e[1]-q[1];const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
  const hl=9*clamp(o.prog*3,0,1),ha=0.5;
  const l1=[e[0]-hl*(tx*Math.cos(ha)-ty*Math.sin(ha)),e[1]-hl*(ty*Math.cos(ha)+tx*Math.sin(ha))];
  const l2=[e[0]-hl*(tx*Math.cos(-ha)-ty*Math.sin(-ha)),e[1]-hl*(ty*Math.cos(-ha)+tx*Math.sin(-ha))];
  sketchLine(ctx,[l1,e],{seed:o.seed+3,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,overshoot:false,passes:1});
  sketchLine(ctx,[l2,e],{seed:o.seed+5,width:o.width,color:o.color,alpha:o.alpha,ampScale:0.5,overshoot:false,passes:1});
}

/* paper */
const paperCache={key:'',canvas:null};const baseCache={key:'',canvas:null};
function paper(W,H,dpr,boil){
  const life=cfg.style.wash>0?cfg.style.washLife:0;const wb=life>0?(boil|0):0; // the wash breathes with every drawing
  const key=[W,H,dpr,cfg.palette.paper,cfg.style.grain,cfg.style.wash,cfg.style.washSeed,cfg.palette.wash,life,wb].join('|');
  if(paperCache.key===key)return paperCache.canvas;
  const bkey=[W,H,dpr,cfg.palette.paper,cfg.style.grain].join('|');
  let base=baseCache.canvas;
  if(baseCache.key!==bkey){base=paperBase(W,H,dpr);baseCache.key=bkey;baseCache.canvas=base}
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.drawImage(base,0,0,W,H);
  if(cfg.style.wash>0)watercolourWash(x,W,H,wb,life);
  paperCache.key=key;paperCache.canvas=c;return c;
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
    for(let e=0;e<3;e++){const sc=0.97+rng()*0.05;const lay=deform(shape.map(p=>[cx+(p[0]-cx)*sc,cy+(p[1]-cy)*sc]),1,0.05);path(lay);x.lineWidth=0.7+rng()*0.5;x.strokeStyle=rgba(mix(col,cfg.palette.ink,0.25),0.14);x.stroke()}
    // granulation
    x.save();path(shape);x.clip();rng=rngPool;const g=Math.round(r*r*0.012);for(let i=0;i<g;i++){const a=rng()*Math.PI*2,t=Math.pow(rng(),0.6);x.fillStyle=rgba(mix(col,cfg.palette.ink,0.4),0.1+rng()*0.18);const sz=rng()<0.85?1:1.6;x.fillRect(cx+Math.cos(a)*t*r*1.2,cy+Math.sin(a)*t*r*0.9,sz,sz)}x.restore();
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
function carbonColor(a){const P=cfg.palette,mode=cfg.rep.colorBy;
  if(a.color)return P[a.color]||a.color;
  if(mode==='element')return P.C;if(mode==='subunit')return subunitColor(a);if(mode==='entity')return entityColor(a);
  const key=mode==='chain'?('chain:'+(a.chain||'')):(a.group||((a.resn||'')+(a.resi??'')));
  if(scene.groupColors&&scene.groupColors[mode==='chain'?(a.chain||''):key])return scene.groupColors[mode==='chain'?(a.chain||''):key];
  if(mode==='group')return P.C;
  return GROUP_PALETTE[groupIndex(key)%GROUP_PALETTE.length];
}
const SUBUNIT_COLS={S:'#9cc27a',L:'#e6a45a',T:'#c96d8a',X:'#b8b4a8'};
function subunitColor(a){const k=a.subunit||'X';if(scene.groupColors&&scene.groupColors['subunit:'+k])return scene.groupColors['subunit:'+k];return SUBUNIT_COLS[k]||SUBUNIT_COLS.X}
function entityColor(a){const e=a.entity||('chain:'+(a.chain||''));if(scene.groupColors&&scene.groupColors['entity:'+e])return scene.groupColors['entity:'+e];return GROUP_PALETTE[groupIndex('entity:'+e)%GROUP_PALETTE.length]}
function chainColor(a){const c=a.chain||'';if(scene.groupColors&&scene.groupColors[c])return scene.groupColors[c];return GROUP_PALETTE[groupIndex('chain:'+c)%GROUP_PALETTE.length]}
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
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;const dens=S.hatchDensity;
  const colour=cfg.rep.fill==='ink colour'||isPencil()||isWC();const ink=fogged(colour?mix(col,P.hatch,isPencil()?0.45:isWC()?0.6:0.15):P.hatch,fog);
  const la=S.lightAngle*Math.PI/180;const light=[Math.cos(la),Math.sin(la)];const ang=S.hatchAngle*Math.PI/180;
  const hs=S.hatchSpacing*Math.max(0.7,d)/dens;const a=(0.55+0.45*fk)*(colour?0.9:0.75)*(isWC()?0.45:1);
  if(el==='N'&&r<14){ // stipple with a density gradient
    const rng=mulberry32(seed+5);const n=Math.round(r*r*3.2/(hs*hs)*dens*2);ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.fillStyle=rgba(ink,a);
    for(let i=0;i<n;i++){const t=Math.sqrt(rng()),th=rng()*Math.PI*2;const px=Math.cos(th)*t*r,py=Math.sin(th)*t*r;const lit=(px*light[0]+py*light[1])/r;if(rng()<(lit+1)/2*0.9)continue;ctx.beginPath();ctx.arc(x+px,y+py,0.8*d,0,Math.PI*2);ctx.fill()}
    ctx.restore();return}
  hatchCircle(ctx,x,y,r,ang,hs,{seed:seed+11,width:0.9*d,color:ink,alpha:a*0.8,light,thr:r*0.45});
  hatchCircle(ctx,x,y,r,ang+0.25,hs*0.8,{seed:seed+12,width:0.9*d,color:ink,alpha:a*0.8,light,thr:-r*0.1});
  hatchCircle(ctx,x,y,r,ang+1.35,hs*0.85,{seed:seed+13,width:0.85*d,color:ink,alpha:a*0.7,light,thr:-r*0.5});
}
/* Pen rendering of a stick: strokes along the axis, denser toward the shadow edge, a bare highlight strip, cross strokes in the shadow. Caller has clipped to the capsule. */
function penStick(ctx,ax,ay,mx,my,R,col,el,seed,o){
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;const dens=S.hatchDensity;
  const colour=cfg.rep.fill==='ink colour'||isPencil()||isWC();const ink=fogged(colour?mix(col,P.hatch,isPencil()?0.45:isWC()?0.6:0.15):P.hatch,fog);
  const ux=mx-ax,uy=my-ay,L=Math.hypot(ux,uy)||1,tx=ux/L,ty=uy/L,nx=-ty,ny=tx;
  const la=S.lightAngle*Math.PI/180;const litSign=(nx*Math.cos(la)+ny*Math.sin(la))>0?1:-1; // +n side faces the light?
  const rng=mulberry32(seed+21);const hs=S.hatchSpacing*Math.max(0.7,d)/dens;const a=(0.55+0.45*fk)*(colour?1.0:0.8)*(isWC()?0.45:1);
  if(el==='H'){ // hydrogens: two faint strokes only
    for(const t of[-0.45,0.2]){sketchLine(ctx,[[ax+nx*t*R-tx*R*0.6,ay+ny*t*R-ty*R*0.6],[mx+nx*t*R,my+ny*t*R]],{seed:seed+Math.round(t*10),passes:1,width:0.7*d,color:fogged(P.hatch,fog),alpha:0.35*(0.5+0.5*fk),ampScale:0.5,step:5,overshoot:false})}return}
  if(el==='N'){ // stipple gradient
    const n=Math.round((L+2*R)*2*R/(hs*hs)*1.6*dens);ctx.fillStyle=rgba(ink,a);
    for(let i=0;i<n;i++){const s=-R+rng()*(L+2*R),t=(rng()*2-1);const lit=t*litSign;if(rng()<(lit+1)/2*0.85)continue;ctx.beginPath();ctx.arc(ax+tx*s+nx*t*R,ay+ty*s+ny*t*R,0.8*d,0,Math.PI*2);ctx.fill()}return}
  const step=hs*0.6/R;
  for(let t=-1+step*0.5+(rng()-0.5)*step*0.4;t<1;t+=step){
    const lit=t*litSign;if(lit>0.42)continue;                 // bare highlight strip
    if(lit>0&&rng()<lit*0.9)continue;                          // thinning toward the light
    const tone=clamp(0.55-lit*0.5,0.3,1);
    const s0=-R*0.7+rng()*R*0.5,s1=L-rng()*R*0.4;              // strokes start inside the cap and stop short of the midpoint sometimes
    sketchLine(ctx,[[ax+tx*s0+nx*t*R,ay+ty*s0+ny*t*R],[ax+tx*s1+nx*t*R,ay+ty*s1+ny*t*R]],{seed:seed+Math.round(t*100),passes:1,width:(0.9+0.45*tone)*d*LW.inner,color:ink,alpha:Math.min(1,a*(0.35+tone)),ampScale:0.6,step:5,overshoot:false});
  }
  // cross strokes in the shadow third
  const cs=hs*0.9;for(let sx=-R*0.5+rng()*cs;sx<L;sx+=cs+(rng()-0.5)*cs*0.4){const t0=-0.98*litSign,t1=-0.35*litSign;
    sketchLine(ctx,[[ax+tx*sx+nx*t0*R,ay+ty*sx+ny*t0*R],[ax+tx*(sx+R*0.35)+nx*t1*R,ay+ty*(sx+R*0.35)+ny*t1*R]],{seed:seed+Math.round(sx*7)+500,passes:1,width:0.8*d,color:ink,alpha:a*0.65,ampScale:0.5,step:4,overshoot:false})}
  if(el==='S'||el==='P'){for(let sx=-R*0.5+rng()*cs;sx<L;sx+=cs){sketchLine(ctx,[[ax+tx*sx+nx*R*0.9,ay+ty*sx+ny*R*0.9],[ax+tx*(sx+R*0.5)-nx*R*0.9,ay+ty*(sx+R*0.5)-ny*R*0.9]],{seed:seed+Math.round(sx*5)+900,passes:1,width:0.8*d,color:ink,alpha:a*0.6,ampScale:0.4,step:4,overshoot:false})}}
}
/* fill colour for the current fill mode: flat colour, a pale wash, or bare paper (ink) */
const isInk=()=>cfg.rep.fill==='ink'||cfg.rep.fill==='ink colour'||cfg.rep.fill==='pencil'||cfg.rep.fill==='watercolour';
const isPencil=()=>cfg.rep.fill==='pencil';const isWC=()=>cfg.rep.fill==='watercolour';
let RF={W:960,H:720,dpr:1};
/* Watercolour fill of one polygon: stacked, lightly deformed transparent layers (multiply) with a drying ring and granulation.
   When `target` is a transparent offscreen, layers stack with source-over and the caller multiplies the result once. */
function wcGauss(rng){const u=1-rng(),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function wcDeform(pts,depth,variance,rng){let p=pts;for(let d=0;d<depth;d++){const out=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;const ex=b[0]-a[0],ey=b[1]-a[1];const len=Math.hypot(ex,ey)||1;const nx=-ey/len,ny=ex/len;const dn=wcGauss(rng)*variance*len,dt=wcGauss(rng)*variance*len*0.35;out.push(a,[mx+nx*dn+ex/len*dt,my+ny*dn+ey/len*dt])}p=out}return p}
function watercolourShape(ctx,pts,col,seed,o){
  o=o||{};const rng=mulberry32(seed+4242);const layers=o.layers||9;const fog=o.fog||0;
  col=fogged(col,fog);const light=luminance(cfg.palette.paper)>0.5;
  let cx=0,cy=0;for(const p of pts){cx+=p[0];cy+=p[1]}cx/=pts.length;cy/=pts.length;
  const path=q=>{ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath()};
  const shape=wcDeform(pts,1,0.06,rng);
  ctx.save();ctx.globalCompositeOperation=o.offscreen?'source-over':(light?'multiply':'screen');
  const aFill=(o.strength||0.75)/layers*1.15;
  for(let L=0;L<layers;L++){const sc=o.noScale?1:0.9+rng()*0.16;const lay=wcDeform(sc===1?shape:shape.map(p=>[cx+(p[0]-cx)*sc,cy+(p[1]-cy)*sc]),2,(0.08+rng()*0.1)*(o.noScale?1.6:1),rng);path(lay);ctx.fillStyle=rgba(col,aFill);ctx.fill()}
  if(!o.noRing)for(let e=0;e<2;e++){const lay=wcDeform(shape,1,0.03,rng);path(lay);ctx.lineWidth=0.7+rng()*0.5;ctx.strokeStyle=rgba(mix(col,cfg.palette.ink,0.25),0.16*(o.strength||0.75)/0.75);ctx.stroke()}
  if(o.granulate!==false){ctx.save();path(shape);ctx.clip();let area=0;for(let i=0;i<shape.length;i++){const a=shape[i],b=shape[(i+1)%shape.length];area+=a[0]*b[1]-b[0]*a[1]}area=Math.abs(area)/2;
    const g=Math.round(area*0.004);let xs=1e9,ys=1e9,xe=-1e9,ye=-1e9;for(const p of shape){xs=Math.min(xs,p[0]);ys=Math.min(ys,p[1]);xe=Math.max(xe,p[0]);ye=Math.max(ye,p[1])}
    for(let i=0;i<g;i++){ctx.fillStyle=rgba(mix(col,cfg.palette.ink,0.4),0.12+rng()*0.2);ctx.fillRect(xs+rng()*(xe-xs),ys+rng()*(ye-ys),1,1)}ctx.restore()}
  ctx.restore();
}
/* line hierarchy: silhouettes heavier, interior marks lighter */
const LW={get outer(){return 1+0.45*cfg.style.hierarchy},get inner(){return 1-0.45*cfg.style.hierarchy},get faint(){return 0.5-0.15*cfg.style.hierarchy}};
/* coloured-pencil scribble fill inside the current clip: back-and-forth strokes, two layers, ragged edges */
function scribbleFill(ctx,x0,y0,x1,y1,col,seed,o){
  const S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;const rng=mulberry32(seed+303);
  const c=fogged(col,fog);const cx=(x0+x1)/2,cy=(y0+y1)/2,R=Math.hypot(x1-x0,y1-y0)/2+3;
  const layers=[[S.hatchAngle*Math.PI/180+0.9,S.hatchSpacing*0.55,0.55],[S.hatchAngle*Math.PI/180-0.5,S.hatchSpacing*0.75,0.35]];
  for(const [ang,sp,al] of layers){const dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;const pts=[];let flip=1;
    for(let dd=-R;dd<R;dd+=sp*(0.8+0.4*rng())){const e0=-R*(0.9+0.2*rng()),e1=R*(0.9+0.2*rng());pts.push([cx+nx*dd+dx*e0*flip,cy+ny*dd+dy*e0*flip]);pts.push([cx+nx*dd+dx*e1*flip,cy+ny*dd+dy*e1*flip]);flip=-flip}
    if(pts.length>3)sketchLine(ctx,pts,{seed:seed+Math.round(ang*100),passes:1,width:(1.1+0.6*rng())*d,color:c,alpha:al*(0.6+0.4*fk),ampScale:0.9,step:6,overshoot:false,pressure:0.8})}
}
function fillFor(col){const m=cfg.rep.fill;if(isInk())return cfg.palette.paper;if(m==='wash')return mix(col,cfg.palette.paper,0.62);return col}
/* In ink mode, elements are told apart by pen texture: N stipple, O hatch, S cross-hatch, others light hatch. Caller has set the clip. */
function elementPattern(ctx,el,x0,y0,x1,y1,seed,o){
  if(!isInk()||el==='H')return;
  const colour=cfg.rep.fill==='ink colour';if(el==='C'&&!colour)return;
  const S=cfg.style,P=cfg.palette;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;
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
function shade(col,k){return k>=0?mix(col,'#ffffff',k):mix(col,cfg.palette.ink,-k)}

/* flat ball: solid fill, pencil shadow on the far side, sketched outline */
function drawFlatBall(ctx,x,y,r,col,o){
  const P=cfg.palette,S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;
  const la=S.lightAngle*Math.PI/180;const light=[Math.cos(la),Math.sin(la)];
  ctx.save();ctx.globalAlpha=o.alpha??1;
  if(o.outlineFirst)sketchCircle(ctx,x,y,r,{seed:o.seed+4,width:S.inkWidth*d*(0.75+0.25*fk)*0.9,color:fogged(P.ink,fog),alpha:(0.55+0.4*fk)*(o.outlineAlpha??1),passes:o.passes});
  ctx.beginPath();ctx.arc(x,y,r*(o.outlineFirst?0.97:1),0,Math.PI*2);ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=rgba(fogged(fillFor(col),fog),o.fillAlpha??1);ctx.fill()}
  if(isWC()){const q=[];for(let i=0;i<14;i++){const a=i/14*Math.PI*2;q.push([x+Math.cos(a)*r,y+Math.sin(a)*r])}watercolourShape(ctx,q,col,o.seed,{fog,layers:8,strength:o.wcStrength||0.8})}
  if(isInk()){ctx.save();ctx.beginPath();ctx.arc(x,y,r+(isPencil()?1.5:0),0,Math.PI*2);ctx.clip();if(isPencil())scribbleFill(ctx,x-r,y-r,x+r,y+r,col,o.seed,{fog,d});if(!o.noPen)penSphere(ctx,x,y,r,col,o.el,o.seed,{fog,d});ctx.restore()}
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
  const P=cfg.palette,S=cfg.style;const fog=o.fog||0,fk=1-fog*cfg.view.fog,d=o.d||1;const Rm=o.Rm??R;
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
  if(o.el&&isInk()){ctx.save();ctx.clip();if(isPencil()&&o.el!=='H'){const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);scribbleFill(ctx,Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys),col,o.seed,{fog,d})}if(!isWC()||cfg.style.shading>0)penStick(ctx,ax,ay,mx,my,R,col,o.el,o.seed,{fog,d});ctx.restore()}
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
function buildSticks(items,st,pos,atoms,bonds,proj,seedBase,lowDetail){
  const P=cfg.palette,SH=cfg.show;const R0=cfg.rep.stickRadius*proj.pxPerA;
  const inSet={};for(const a of atoms)inSet[a.id]=a;
  const nb={};for(const b of bonds){if(!inSet[b.a]||!inSet[b.b]||b.order===0)continue;nb[b.a]=(nb[b.a]||0)+1;nb[b.b]=(nb[b.b]||0)+1}
  for(const b of bonds){
    const A=inSet[b.a],B=inSet[b.b];if(!A||!B)continue;const pa=pos[b.a],pb=pos[b.b];
    const seed=seedBase+strHash(bkey(b.a,b.b));
    if(b.order===0){if(!SH.hbonds)continue;const z=(pa.z+pb.z)/2;const fog=(pa.fog+pb.fog)/2;
      items.push({z,draw:(ctx)=>{const ra=atomDrawR(A,proj)*pa.d,rb=atomDrawR(B,proj)*pb.d;const dx=pb.x-pa.x,dy=pb.y-pa.y,L=Math.hypot(dx,dy)||1;
        drawHBond(ctx,pa.x+dx/L*(ra+2),pa.y+dy/L*(ra+2),pb.x-dx/L*(rb+2),pb.y-dy/L*(rb+2),{seed,color:fogged(P.hatch,fog),alpha:0.8*b.alpha*(1-fog*cfg.view.fog*0.5),r:R0*0.5*((pa.d+pb.d)/2),gap:R0*1.5})}});continue}
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
      items.push({z:near.z-0.002,draw:(ctx)=>{const col=atomColor(atom);
        const R=R0*near.d,Rm=R0*(near.d+far.d)/2;
        drawHalfStick(ctx,near.x,near.y,mx,my,R,col,{Rm,el:atom.el,seed:seed+half*3,fog:near.fog,d:near.d,alpha:b.alpha,partial:b.partial,passes:lowDetail?1:undefined});
        if(extra>0.01&&!(b.partial>0&&b.partial<1)){ // inner valence stick(s)
          const frac=Math.min(1,extra);const off=R0*1.95*near.d*side*frac;const r2=R0*0.42*near.d*(0.5+0.5*frac);
          const sh=0.18; // shorten toward the atom so it does not poke out of the junction
          const ax=near.x+ux*L*sh*(half?-1:1),ay=near.y+uy*L*sh*(half?-1:1);
          drawHalfStick(ctx,ax-uy*off,ay+ux*off,mx-uy*off,my+ux*off,r2,col,{Rm:r2,el:atom.el,seed:seed+half*3+101,fog:near.fog,d:near.d,alpha:b.alpha*frac,partial:0,passes:1,noShadow:true,inner:true});
          if(extra>1.01){const off2=-off;drawHalfStick(ctx,ax-uy*off2,ay+ux*off2,mx-uy*off2,my+ux*off2,r2,col,{Rm:r2,seed:seed+half*3+202,fog:near.fog,d:near.d,alpha:b.alpha*(extra-1),partial:0,passes:1,noShadow:true})}
        }}});
    }
  }
  for(const a of atoms){const p=pos[a.id];const seed=seedBase+strHash(a.id);const cnt=nb[a.id]||0;const col=atomColor(a);
    if(a.sphere||cnt===0){const r=(cnt===0&&!a.sphere?R0*1.7:atomDrawR(a,proj))*p.d;
      items.push({z:p.z+0.003,draw:(ctx)=>drawFlatBall(ctx,p.x,p.y,r,col,{seed,el:a.el,fog:p.fog,d:p.d,alpha:a.alpha,passes:lowDetail?1:undefined})})}
    else if(cnt>=2){const R=R0*p.d;
      items.push({z:p.z-0.004,draw:(ctx)=>{ctx.save();ctx.globalAlpha=a.alpha;sketchCircle(ctx,p.x,p.y,R,{seed:seed+4,width:cfg.style.inkWidth*p.d*(0.75+0.25*(1-p.fog*cfg.view.fog))*LW.outer,color:fogged(P.ink,p.fog),alpha:0.55+0.4*(1-p.fog*cfg.view.fog),passes:lowDetail?1:undefined});ctx.restore()}});
      items.push({z:p.z+0.001,draw:(ctx)=>{ctx.save();ctx.globalAlpha=a.alpha;ctx.beginPath();ctx.arc(p.x,p.y,R-0.6,0,Math.PI*2);ctx.fillStyle=paperFill();ctx.fill();if(!isInk()){ctx.fillStyle=fogged(fillFor(col),p.fog);ctx.fill()}if(isWC()){const q=[];for(let i=0;i<10;i++){const an=i/10*Math.PI*2;q.push([p.x+Math.cos(an)*(R-0.8),p.y+Math.sin(an)*(R-0.8)])}watercolourShape(ctx,q,col,seed,{fog:p.fog,layers:5,strength:0.7,granulate:false})}
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
function buildSurface(items,st,pos,atoms,proj,seedBase,lowDetail){
  const P=cfg.palette;const probe=cfg.rep.probe;
  if(isWC()){ // one continuous wash over the whole surface, ring only on the silhouette; patch colour by the chosen scheme
    if(!atoms.length)return;
    const discs=atoms.map(a=>{const p=pos[a.id];return{x:p.x,y:p.y,r:((VDW[a.el]||1.7)+probe*0.55)*proj.pxPerA*p.d*cfg.rep.surfaceScale,z:p.z,fog:p.fog,alpha:a.alpha,a}});
    const zMean=discs.reduce((s,d)=>s+d.z,0)/discs.length;const fogMean=discs.reduce((s,d)=>s+d.fog,0)/discs.length;
    const groups={};for(const d of discs){const k=(d.a.chain||'')+'/'+(d.a.resi??d.a.id);(groups[k]=groups[k]||[]).push(d)}
    items.push({z:zMean,draw:(ctx)=>{
      const W=RF.W,H=RF.H,dpr=RF.dpr;const off=document.createElement('canvas');off.width=Math.round(W*dpr);off.height=Math.round(H*dpr);const x=off.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
      const mode=cfg.rep.surfaceColor;const colFor=a=>mode==='single'?P.surface:mode==='chain'?chainColor(a):mode==='subunit'?subunitColor(a):mode==='entity'?entityColor(a):mode==='carbon'?carbonColor(a):mix(atomColor(a),'#ffffff',0.2);
      // residue patches back to front: each erases what lies behind it, then is washed in a tone set by depth and a soft top-left light,
      // so recesses read darker and the form has volume; thin rings give the Goodsell texture
      const patches=[];for(const k in groups){const g=groups[k];const pts=[];let z=0,px=0,py=0;for(const d of g){for(let i=0;i<10;i++){const an=i/10*Math.PI*2;pts.push([d.x+Math.cos(an)*d.r,d.y+Math.sin(an)*d.r])}z+=d.z;px+=d.x;py+=d.y}
        const h=hull(pts);if(h.length<3)continue;patches.push({h,z:z/g.length,x:px/g.length,y:py/g.length,alpha:Math.max(...g.map(d=>d.alpha)),k,col:colFor(g[0].a)})}
      patches.sort((a,b)=>a.z-b.z);
      let zmin=1e9,zmax=-1e9,xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;for(const p of patches){zmin=Math.min(zmin,p.z);zmax=Math.max(zmax,p.z);xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y)}
      const zs=Math.max(1e-6,zmax-zmin);const la=cfg.style.lightAngle*Math.PI/180;const lx=Math.cos(la),ly=Math.sin(la);const R=Math.max(xmax-xmin,ymax-ymin)/2||1;const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
      const many=patches.length>600;
      for(const p of patches){const depth=(zmax-p.z)/zs;const lit=((p.x-cx)*lx+(p.y-cy)*ly)/R; // lit>0 faces the light
        const tone=clamp(0.3+0.6*depth-0.2*lit,0.15,1);
        x.save();x.globalAlpha=p.alpha;x.beginPath();p.h.forEach((q,i)=>i?x.lineTo(q[0],q[1]):x.moveTo(q[0],q[1]));x.closePath();x.fillStyle='#ffffff';x.globalCompositeOperation='destination-out';x.fill();x.globalCompositeOperation='source-over';
        watercolourShape(x,p.h,p.col,seedBase+strHash('su'+p.k),{fog:0,layers:many?3:5,strength:tone,offscreen:true,granulate:false,noRing:many&&depth<0.15});x.restore()}
      // silhouette: union of discs minus the same union eroded → a band along the outer edge
      const mask=document.createElement('canvas');mask.width=off.width;mask.height=off.height;const mx=mask.getContext('2d',{willReadFrequently:true});mx.scale(dpr,dpr);
      mx.fillStyle=mix(mode==='single'?col:P.surface,P.ink,0.35);for(const d of discs){mx.beginPath();mx.arc(d.x,d.y,d.r,0,Math.PI*2);mx.fill()}
      mx.globalCompositeOperation='destination-out';for(const d of discs){mx.beginPath();mx.arc(d.x,d.y,Math.max(0,d.r-2.2),0,Math.PI*2);mx.fill()}
      x.save();x.globalAlpha=0.55;x.drawImage(mask,0,0,W,H);x.restore();
      // granulation over the whole surface
      const rng=mulberry32(seedBase+7);x.save();x.beginPath();for(const d of discs){x.moveTo(d.x+d.r,d.y);x.arc(d.x,d.y,d.r,0,Math.PI*2)}x.clip();
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const d of discs){x0=Math.min(x0,d.x-d.r);y0=Math.min(y0,d.y-d.r);x1=Math.max(x1,d.x+d.r);y1=Math.max(y1,d.y+d.r)}
      const g=Math.round((x1-x0)*(y1-y0)*0.0025);for(let i=0;i<g;i++){x.fillStyle=rgba(mix(mode==='single'?col:P.surface,P.ink,0.4),0.1+rng()*0.2);x.fillRect(x0+rng()*(x1-x0),y0+rng()*(y1-y0),1,1)}x.restore();
      // paper under the surface, then the wash multiplied once, then a sketched silhouette line
      ctx.save();ctx.globalAlpha=cfg.rep.surfaceOpacity;ctx.beginPath();for(const d of discs){ctx.moveTo(d.x+d.r,d.y);ctx.arc(d.x,d.y,d.r,0,Math.PI*2)}ctx.fillStyle=paperFill();ctx.fill();
      ctx.globalCompositeOperation=luminance(P.paper)>0.5?'multiply':'screen';ctx.drawImage(off,0,0,W,H);ctx.restore();
      ctx.save();ctx.globalAlpha=cfg.rep.surfaceOpacity*0.7;ctx.globalCompositeOperation=luminance(P.paper)>0.5?'multiply':'screen';ctx.drawImage(mask,0,0,W,H);ctx.restore();
    }});
    return}
  for(const a of atoms){const p=pos[a.id];const r=((VDW[a.el]||1.7)+probe*0.55)*proj.pxPerA*p.d*cfg.rep.surfaceScale;const seed=seedBase+strHash('s'+a.id);
    const col=cfg.rep.surfaceColor==='single'?P.surface:cfg.rep.surfaceColor==='carbon'?mix(carbonColor(a),'#ffffff',0.25):mix(atomColor(a),'#ffffff',0.3);
    items.push({z:p.z+0.02,draw:(ctx)=>drawFlatBall(ctx,p.x,p.y,r,col,{seed,fog:p.fog,d:p.d,alpha:a.alpha,fillAlpha:cfg.rep.surfaceOpacity,outlineFirst:true,outlineAlpha:0.6,passes:lowDetail?1:undefined})})}
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
function buildCartoon(items,st,pos,atoms,sel,proj,seedBase,lowDetail){
  const P=cfg.palette,S=cfg.style;const K=cfg.rep.cartoonScale;const SPR=6; // samples per residue
  const traces=backboneTraces(atoms,sel);
  const ssColor=ss=>ss==='H'?P.helix:ss==='E'?P.sheet:ss==='N'?(P.nucleic||'#e0a23a'):P.loop;
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
      // one run per stretch of same secondary structure and same facing; each gets its own small canvas so overlapping turns occlude rather than stack
      let j0=0;while(j0<samp.length-1){let j1=j0;while(j1<samp.length-1&&samp[j1+1].ss===samp[j0].ss&&front[j1+1]===front[j0])j1++;
        const a0=Math.max(0,j0-1),a1=Math.min(samp.length-1,j1+2);const poly=[];for(let j=a0;j<=a1;j++)poly.push(L[j]);for(let j=a1;j>=a0;j--)poly.push(Rr[j]);
        if(poly.length>=3){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of poly){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1])}
          const m=10;x0=Math.floor(x0-m);y0=Math.floor(y0-m);const bw=Math.ceil(x1-x0+m),bh=Math.ceil(y1-y0+m);
          if(bw>0&&bh>0&&bw*bh<16e6){const cv=document.createElement('canvas');cv.width=Math.ceil(bw*RF.dpr);cv.height=Math.ceil(bh*RF.dpr);const wx=cv.getContext('2d',{willReadFrequently:true});wx.scale(RF.dpr,RF.dpr);wx.translate(-x0,-y0);
            const col=cfg.rep.cartoonColor==='ss'?ssColor(samp[j0].ss):carbonColor(samp[j0].atom);const fog=(fogs[j0]+fogs[j1])/2;
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
        let col=cfg.rep.cartoonColor==='ss'?ssColor(s.ss):carbonColor(s.atom);
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
        const ink=fogged(P.ink,fog);const hatch=fogged(cfg.rep.fill==='ink colour'?mix(baseCol,P.hatch,0.2):P.hatch,fog);
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
function renderFrame(ctx,W,H,frame,dpr){
  RF={W,H,dpr};
  VIEW_YAW=cfg.view.yaw+cfg.view.spin*frame/Math.max(1,cfg.fps);VIEW_PITCH=cfg.view.pitch+cfg.view.pitchSwing*Math.sin(frame/Math.max(1,cfg.fps)*Math.PI*2*Math.max(1e-6,Math.abs(cfg.view.spin))/360);
  const drawn=Math.floor(frame/Math.max(1,cfg.stepEvery))*Math.max(1,cfg.stepEvery);
  const st=sampleState(drawn);
  const boil=Math.floor(drawn/Math.max(1,cfg.boilEvery));
  const seedBase=boil*7919;
  computeFit();const proj=makeProjector(W,H);
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
  const stickAtoms=st.atoms.filter(a=>{if(!selS(a))return false;if(a.el==='H'&&!SH.H)return false;
    if(cfg.rep.sideChainHelper&&cartoonRes.has((a.chain||'')+'/'+a.resi)&&(a.name==='N'||a.name==='C'||a.name==='O'||a.name==='OXT'))return false;return true});
  const stickIds=new Set(stickAtoms.map(a=>a.id));
  const stickBonds=st.bonds.filter(b=>stickIds.has(b.a)&&stickIds.has(b.b));
  const surfAtoms=reps.surface&&reps.surface.trim()?st.atoms.filter(a=>selF(a)&&(SH.H||a.el!=='H')):[];
  const items=[];const lowDetail=(stickAtoms.length+surfAtoms.length)>260;
  if(cfg.rep.mode==='sticks')buildSticks(items,st,pos,stickAtoms,stickBonds,proj,seedBase,lowDetail);else buildBallStick(items,st,pos,stickAtoms,stickBonds,proj,seedBase,lowDetail);
  if(cartoonOn)buildCartoon(items,st,pos,st.atoms,selC,proj,seedBase,lowDetail);
  if(surfAtoms.length)buildSurface(items,st,pos,surfAtoms,proj,seedBase,lowDetail);
  items.sort((u,v)=>u.z-v.z);
  for(const it of items)it.draw(ctx);
  // annotations on stick atoms
  const fontFam=S.font==='Plain sans'?'"IBM Plex Sans", system-ui, sans-serif':`"${S.font}", "Caveat", cursive`;
  for(const a of stickAtoms){const p=pos[a.id];const r=atomDrawR(a,proj)*p.d;const seed=seedBase+strHash(a.id);
    if(SH.lonePairs&&a.lps.length){ctx.save();ctx.globalAlpha=a.alpha;
      a.lps.forEach((lp,i)=>{const d=proj.dir2(lp.dir);const L=Math.hypot(d[0],d[1])||1;const ux=d[0]/L,uy=d[1]/L;const cx=p.x+ux*(r+5),cy=p.y+uy*(r+5);
        ctx.fillStyle=rgba(P.ink,0.9*lp.alpha);const rng=mulberry32(seed+i*3);
        for(const s of[-2.6,2.6]){ctx.beginPath();ctx.arc(cx-uy*s+(rng()-0.5),cy+ux*s+(rng()-0.5),1.35*p.d,0,Math.PI*2);ctx.fill()}});
      ctx.restore()}
    if(SH.charges&&a.charges.length){ctx.save();ctx.globalAlpha=a.alpha;
      a.charges.forEach((c,i)=>{const cx=p.x+r*0.95+7,cy=p.y-r*0.95-6;const cr=7*p.d;
        ctx.font=`600 ${Math.round(15*p.d)}px ${fontFam}`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=rgba(P.charge,c.alpha);ctx.fillText(c.text,cx,cy+0.5);
        sketchCircle(ctx,cx,cy,cr,{seed:seed+50+i,width:1,color:P.charge,alpha:0.85*c.alpha,passes:1,wobScale:1.5})});
      ctx.restore()}
    if(SH.labels&&a.label&&(!a.labelAuto||SH.resLabels)){const d=a.labelDir||[0.7,-0.7];const L=Math.hypot(d[0],d[1])||1;
      ctx.save();ctx.globalAlpha=a.alpha*0.92;ctx.font=`${S.font==='Plain sans'?'600':'500'} ${S.labelSize}px ${fontFam}`;ctx.fillStyle=P.label;
      ctx.textAlign=d[0]>0.25?'left':d[0]<-0.25?'right':'center';ctx.textBaseline=d[1]>0.25?'top':d[1]<-0.25?'bottom':'middle';
      ctx.fillText(a.label,p.x+d[0]/L*(r+9),p.y+d[1]/L*(r+9));ctx.restore()}
  }
  if(SH.arrows&&st.arrowAlpha>0&&st.arrowProg>0){
    st.arrows.forEach((ar,i)=>{
      const to0=anchorPoint(ar.to,st,proj,null),from0=anchorPoint(ar.from,st,proj,null);if(!to0||!from0)return;
      const from=anchorPoint(ar.from,st,proj,to0),to=anchorPoint(ar.to,st,proj,from0);if(!from||!to)return;
      drawArrow(ctx,from,to,{seed:seedBase+900+i*31,width:S.inkWidth*1.15,color:P.arrow,alpha:st.arrowAlpha,bulge:ar.bulge??0.4,side:ar.side??1,prog:st.arrowProg});
    });
  }
  if(SH.caption){ctx.save();ctx.font=`500 ${S.captionSize}px ${fontFam}`;ctx.fillStyle=P.ink;ctx.textBaseline='bottom';ctx.textAlign='left';
    const margin=22,maxW=W-margin*2;
    for(const c of st.captions){if(!c.text||c.alpha<=0.01)continue;ctx.globalAlpha=c.alpha;wrapText(ctx,c.text,margin,H-margin,maxW,S.captionSize*1.15)}
    ctx.restore()}
  if(SH.stepLabel){ctx.save();ctx.font=`500 ${Math.round(S.captionSize*0.8)}px ${fontFam}`;ctx.fillStyle=rgba(P.ink,0.75);ctx.textBaseline='top';ctx.textAlign='left';
    ctx.fillText(`${st.stepIdx+1}. ${st.stepName}`,22,18);ctx.restore()}
  // paper grain over everything, so fills sit in the paper rather than on it
  if(S.grain>0){ctx.save();const light=luminance(P.paper)>0.5;ctx.globalCompositeOperation=light?'multiply':'screen';ctx.globalAlpha=clamp(0.55*S.grain,0,1);ctx.drawImage(grainOverlay(W,H,dpr,light),0,0,W,H);ctx.restore()}
  ctx.restore();
  return st;
}
const grainCache={key:'',canvas:null};
function grainOverlay(W,H,dpr,light){
  const key=[W,H,dpr,light].join('|');if(grainCache.key===key)return grainCache.canvas;
  const c=document.createElement('canvas');c.width=W*dpr;c.height=H*dpr;const x=c.getContext('2d',{willReadFrequently:true});x.scale(dpr,dpr);
  x.fillStyle=light?'#ffffff':'#000000';x.fillRect(0,0,W,H);const rng=mulberry32(4321);
  const n=Math.round(W*H/26);
  for(let i=0;i<n;i++){const a=rng();x.fillStyle=light?`rgba(60,45,25,${0.05+a*0.13})`:`rgba(255,245,225,${0.04+a*0.1})`;const sz=rng()<0.8?1:1.5;x.fillRect(rng()*W,rng()*H,sz,sz)}
  x.lineWidth=0.7;for(let i=0;i<260;i++){const px=rng()*W,py=rng()*H,an=rng()*Math.PI,l=8+rng()*30;x.strokeStyle=light?`rgba(70,55,35,${0.05+rng()*0.08})`:`rgba(255,245,225,${0.04+rng()*0.07})`;x.beginPath();x.moveTo(px,py);x.lineTo(px+Math.cos(an)*l,py+Math.sin(an)*l);x.stroke()}
  grainCache.key=key;grainCache.canvas=c;return c;
}
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
  renderFrame, sampleState, locate, buildTimeline, demoScene, compileSel,
  DEFAULT_CFG, PRESETS, GROUP_PALETTE, SUBUNIT_COLS,
  invalidatePaper(){paperCache.key='';baseCache.key='';grainCache.key=''},
};
}
