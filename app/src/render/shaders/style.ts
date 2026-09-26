/* Screen-space stylisation. The G-buffer is turned into a drawing in three small passes:
   edges (depth / normal / id discontinuities) → blur (coverage, for the watercolour drying ring) → style (paper, fills, hatching, lines). */

export const NOISE = `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.7); a *= 0.5; } return v; }
vec2 wobble(vec2 p, float seed, float scale){ return vec2(vnoise(p*scale + vec2(seed*7.1, 3.3)), vnoise(p*scale + vec2(1.7, seed*5.3+9.1))) - 0.5; }
`;

const LINEAR_DEPTH = `
uniform float u_near, u_far, u_ortho;
float linDepth(float d){ if (u_ortho > 0.5) return u_near + d*(u_far-u_near); float z = d*2.0-1.0; return 2.0*u_near*u_far/(u_far+u_near - z*(u_far-u_near)); }
float decodeId(vec3 c){ return c.r*255.0 + c.g*255.0*256.0 + c.b*255.0*65536.0; }
`;

/* ---------- edges: R silhouette, G crease, B id boundary, A coverage ---------- */
export const EDGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_normal, u_id, u_depth; uniform vec2 u_px; uniform float u_depthEdge;
${LINEAR_DEPTH}
void main(){
  vec4 n0 = texture(u_normal, v_uv); float cov = n0.a;
  float d0 = linDepth(texture(u_depth, v_uv).r); vec3 nn0 = n0.xyz*2.0-1.0; vec4 i0 = texture(u_id, v_uv);
  float sil = 0.0, crease = 0.0, idd = 0.0;
  vec2 offs[4] = vec2[4](vec2(1,0), vec2(0,1), vec2(-1,0), vec2(0,-1));
  for (int k=0;k<4;k++){
    vec2 uv = v_uv + offs[k]*u_px;
    vec4 n1 = texture(u_normal, uv); float d1 = linDepth(texture(u_depth, uv).r); vec4 i1 = texture(u_id, uv);
    if (cov < 0.5 && n1.a < 0.5) continue;
    if (cov < 0.5 || n1.a < 0.5) { sil = 1.0; continue; }           // object against paper
    float dz = abs(d1 - d0); if (dz > u_depthEdge) sil = max(sil, min(1.0, dz/u_depthEdge - 0.5));
    float nd = 1.0 - dot(nn0, n1.xyz*2.0-1.0); crease = max(crease, smoothstep(0.25, 0.7, nd));
    if (abs(i1.a - i0.a) > 0.01 || abs(decodeId(i1.rgb) - decodeId(i0.rgb)) > 0.5) idd = 1.0;
  }
  // a depth jump beats a crease at the same pixel; an id boundary that is also a silhouette counts as silhouette
  crease *= 1.0 - sil; idd *= 1.0 - sil;
  o = vec4(sil, crease, idd, cov);
}`;

/* ---------- separable blur of the coverage channel ---------- */
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src; uniform vec2 u_dir; uniform int u_chan;
void main(){
  float s = 0.0, w = 0.0;
  for (int k=-6;k<=6;k++){ float g = exp(-float(k*k)/14.0); vec4 t = texture(u_src, v_uv + u_dir*float(k)); s += g*(u_chan==0 ? t.a : t.r); w += g; }
  o = vec4(s/w, 0.0, 0.0, 1.0);
}`;

/* ---------- the drawing ---------- */
export const STYLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_albedo, u_normal, u_id, u_depth, u_edge, u_blur;
uniform vec2 u_size;            // canvas px
uniform float u_seed;           // boil seed
uniform float u_washSeed, u_washDrift;
uniform int u_fill;             // 0 ink, 1 ink colour, 2 watercolour
uniform vec3 u_paper, u_ink, u_wash;
uniform float u_grain, u_washAmt, u_washScale;
uniform float u_lineWidth, u_rough, u_hierarchy, u_pressure, u_lineAlpha; uniform int u_passes;
uniform float u_hatchSpacing, u_hatchAngle, u_hatchDensity;
uniform int u_layers; uniform float u_wobble, u_ring, u_gran, u_tone;
uniform float u_fog, u_fogStart, u_light;
uniform float u_sceneNear, u_sceneFar;   // depth range of the bounding sphere, for fog
${LINEAR_DEPTH}
${NOISE}

vec2 lightDir(){ float a = radians(u_light); return vec2(cos(a), sin(a)); }
float shade(vec3 n){ vec3 L = normalize(vec3(lightDir()*0.8, 0.75)); return clamp(1.0 - dot(n, L), 0.0, 1.0); }  // 0 lit → 1 shadow

/* line strength at pixel p (in px) with hand-drawn wobble, width and pressure, from the edge texture */
float sketchLines(vec2 p){
  float line = 0.0;
  for (int k=0;k<4;k++){ if (k>=u_passes) break;
    float sk = u_seed*3.7 + float(k)*11.3;
    vec2 off = wobble(p, sk, 0.012) * u_rough * 4.0;         // slow wobble: the whole line drifts like a second tracing
    vec2 q = p + off;
    float press = 1.0 - u_pressure*0.6*vnoise(q*0.03 + sk);   // pen pressure along the stroke
    float w = u_lineWidth * press * (k==0 ? 1.0 : 0.8);
    float best = 0.0;
    for (int j=0;j<9;j++){
      vec2 d = vec2(float(j%3)-1.0, float(j/3)-1.0) * (w*0.5);
      vec4 e = texture(u_edge, (q + d)/u_size);
      float rep = texture(u_id, (q + d)/u_size).a * 4.0;
      float idW = rep > 2.5 ? 0.35 : 1.0;      // residue boundaries on a surface are faint contour lines
      float v = max(e.r, max(e.g * mix(1.0, 0.35, u_hierarchy) * idW, e.b * mix(0.9, 0.55, u_hierarchy) * idW));
      best = max(best, v);
    }
    float tex = 0.82 + 0.18*vnoise(q*0.9 + sk);                 // ink texture along the line
    float a = k==0 ? 1.0 : 0.55;                                  // later passes are lighter
    line = max(line, best * tex * a);
  }
  return line;
}

/* hatching for a material class: returns ink coverage 0..1 at pixel p */
float hatch(vec2 p, float s, int cls, float base, float seed){
  float ang = radians(u_hatchAngle); mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 r = R * p; float sp = u_hatchSpacing;
  float want = clamp(base + s*u_hatchDensity*0.7, 0.0, 1.6);     // s is the quantised shadow: lit faces get only the base
  if (want < 0.08) return 0.0;
  if (cls == 2) { // nitrogen: stipple
    float cs = max(2.0, sp*0.55);
    vec2 cell = floor(p/cs); float h = hash21(cell + seed); vec2 c = fract(p/cs) - 0.5 - (vec2(hash21(cell+1.7), hash21(cell+3.1))-0.5)*0.6;
    return (h < want*0.7 && length(c) < 0.3) ? 1.0 : 0.0;
  }
  float jit = (vnoise(r*0.07 + seed) - 0.5) * 1.6;              // wobbly hatch lines
  float v = fract((r.y + jit)/sp);
  float gaps = step(0.2, vnoise(r*vec2(0.02, 0.4) + seed*2.0));  // pen lifts
  float frac = 0.10 + 0.28*min(want, 1.0);                        // line thickness as a fraction of the spacing
  float l1 = v < frac ? gaps : 0.0;
  float l2 = 0.0;
  if (cls == 4 || want > 0.9) { float v2 = fract((r.x + jit)/sp); l2 = (v2 < 0.10 + 0.22*clamp(want-0.5, 0.0, 1.0)) ? gaps : 0.0; }
  return max(l1, l2);
}

void main(){
  vec2 p = v_uv * u_size;
  /* ---- paper ---- */
  float g1 = vnoise(p*0.9), g2 = vnoise(p*0.35 + 5.0);
  vec3 paper = u_paper * (1.0 - u_grain*0.10*(g1-0.5)*2.0 - u_grain*0.06*(g2-0.5)*2.0);
  vec2 wp = p / (520.0*u_washScale) + vec2(u_washSeed*13.7, u_washSeed*4.1) + u_washDrift*vec2(0.031, -0.023)*u_seed;
  float w1 = fbm(wp), w2 = fbm(wp*1.9 + 31.0);
  float pool = smoothstep(0.48, 0.80, w1) * 0.6 + smoothstep(0.55, 0.85, w2) * 0.4;
  float rim = smoothstep(0.47, 0.53, w1)*(1.0 - smoothstep(0.53, 0.66, w1)) * 0.35;   // pigment gathers where the pool dried
  float washK = u_washAmt * (pool*0.6 + rim);
  paper *= mix(vec3(1.0), u_wash, clamp(washK, 0.0, 0.45));
  vec3 col = paper;

  /* ---- the object under this pixel (with wobble for painted fills) ---- */
  vec4 e0 = texture(u_edge, v_uv);
  float cov = e0.a;
  vec4 alb = texture(u_albedo, v_uv); vec3 n = texture(u_normal, v_uv).xyz*2.0-1.0; int cls = int(alb.a*16.0 + 0.5);
  float dep = linDepth(texture(u_depth, v_uv).r);
  float fogK = 0.0;
  if (cov > 0.5 && cls != 10) { float dn = clamp((dep - u_sceneNear)/max(u_sceneFar - u_sceneNear, 1e-3), 0.0, 1.0); fogK = u_fog * smoothstep(u_fogStart, 1.0, dn); }   // a map behind the model is pushed back: not fogged
  float s = shade(n);
  float sq = smoothstep(0.35, 0.75, s);   // quantised-ish shadow

  if (u_fill == 2) {
    /* watercolour: stacked translucent layers, each a wobbled copy of the coverage; product of pow(colour, 1/L) so a full stack gives the colour */
    vec3 stack = vec3(1.0); float anyCov = 0.0; float covSum = 0.0;
    for (int k=0;k<4;k++){ if (k>=u_layers) break;
      float sk = u_seed*2.3 + float(k)*7.7;
      vec2 off = wobble(p, sk, 0.02) * u_wobble * 7.0 + wobble(p, sk+2.0, 0.11) * u_wobble * 2.0;
      vec2 uv = (p+off)/u_size;
      float c = texture(u_edge, uv).a; if (c < 0.5) continue;
      vec3 a = texture(u_albedo, uv).rgb; vec3 nn = texture(u_normal, uv).xyz*2.0-1.0;
      float sh = smoothstep(0.35, 0.75, shade(nn));
      float tone = 1.0 - u_tone*0.32*sh + u_tone*0.06*(1.0-sh);
      float dd = linDepth(texture(u_depth, uv).r); float dn = clamp((dd - u_sceneNear)/max(u_sceneFar - u_sceneNear, 1e-3), 0.0, 1.0);
      float fk = int(texture(u_albedo, uv).a*16.0 + 0.5) == 10 ? 0.0 : u_fog * smoothstep(u_fogStart, 1.0, dn);
      vec3 lc = mix(vec3(1.0), clamp(a*tone, 0.0, 1.0), 0.72);   // pigment is translucent: paper shows through
      lc = mix(lc, vec3(1.0), fk*0.85);
      float wgt = (1.0/float(u_layers)) * (0.85 + 0.3*vnoise(p*0.05 + sk));
      stack *= pow(lc, vec3(wgt)); anyCov = 1.0; covSum += 1.0;
    }
    if (anyCov > 0.5) {
      float blur = texture(u_blur, v_uv).r;
      float ring = clamp((1.0 - blur) * 1.6, 0.0, 1.0) * u_ring;          // pigment gathers at the edge as it dries
      float gran = u_gran * 0.28 * (vnoise(p*0.7 + u_seed) * 0.7 + vnoise(p*2.1) * 0.3) * (0.4 + 0.6*sq);
      vec3 fill = stack * (1.0 - ring*0.35) * (1.0 - gran);
      col = paper * fill;
    }
    float line = sketchLines(p);
    vec3 inkc = mix(u_ink, alb.rgb*0.45, 0.35);
    col = mix(col, inkc, line * u_lineAlpha * 0.8 * (1.0 - fogK*0.8));
  } else {
    /* ink / ink colour: paper, hatching by material, lines */
    if (cov > 0.5) {
      float base = 0.0; bool draw = true;
      if (cls == 1) { base = u_fill==1 ? 0.12 : 0.0; if (u_fill==0) draw = false; }
      else if (cls == 2) base = 0.35; else if (cls == 3) base = 0.35; else if (cls == 4) base = 0.6; else if (cls == 5) base = 0.4;
      else if (cls == 6) { draw = false; } else if (cls == 7) base = 0.35;
      else if (cls == 8) base = u_fill==1 ? 0.15 : 0.0;   // cartoon: shadow-side hatching only
      else if (cls == 9 || cls == 10) base = 0.0;
      if (cls == 1 && u_fill == 0) { base = 0.0; draw = true; }      // plain ink: carbon hatched only on the shadow side (base 0)
      float h = draw ? hatch(p, sq, cls, base, u_seed*0.37) : 0.0;
      vec3 hc = u_fill == 1 ? mix(alb.rgb, u_ink, 0.25) : u_ink;
      col = mix(col, hc, h * 0.85 * (1.0 - fogK));
      if (u_fill == 1 && cls >= 8) col = mix(col, alb.rgb, 0.22*(1.0-fogK));   // a faint tint on cartoons and surfaces in ink colour
    }
    float line = sketchLines(p);
    col = mix(col, u_ink, line * u_lineAlpha * (1.0 - fogK*0.85));
  }
  o = vec4(col, 1.0);
}`;
