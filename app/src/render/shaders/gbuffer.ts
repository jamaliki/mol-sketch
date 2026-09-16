/* Shaders that write the G-buffer:
   0: albedo rgb, a = material class / 16   (1 C, 2 N, 3 O, 4 S, 5 P, 6 H, 7 other element, 8 cartoon, 9 surface)
   1: view-space normal * 0.5 + 0.5, a = 1
   2: object id (24 bit), a = representation / 4  (1 sticks, 2 cartoon, 3 surface)
   Depth: the hardware buffer; impostors write gl_FragDepth from the analytic hit. */

export const GBUF_OUT = `
layout(location=0) out vec4 o_albedo;
layout(location=1) out vec4 o_normal;
layout(location=2) out vec4 o_id;
vec3 encodeId(float id){ float i = floor(id + 0.5); return vec3(mod(i,256.0), mod(floor(i/256.0),256.0), floor(i/65536.0)) / 255.0; }
void writeG(vec3 albedo, float cls, vec3 n, float id, float rep){
  o_albedo = vec4(albedo, cls/16.0);
  o_normal = vec4(n*0.5+0.5, 1.0);
  o_id = vec4(encodeId(id), rep/4.0);
}`;

const DEPTH_FN = `
uniform mat4 u_proj;
float fragDepth(vec3 pView){ vec4 c = u_proj * vec4(pView,1.0); return (c.z/c.w)*0.5+0.5; }`;

/* ---------- spheres (atoms, junctions, residue blobs) ---------- */
export const SPHERE_VS = `#version 300 es
precision highp float;
uniform mat4 u_view, u_proj; uniform float u_ortho;
in vec3 a_center; in float a_radius; in vec3 a_color; in float a_id; in float a_cls;
out vec3 v_c; out float v_r; out vec3 v_p; out vec3 v_color; out float v_id; out float v_cls;
void main(){
  vec2 q = vec2(gl_VertexID==1||gl_VertexID==3||gl_VertexID==4 ? 1.0 : -1.0, gl_VertexID==2||gl_VertexID==4||gl_VertexID==5 ? 1.0 : -1.0);
  vec3 c = (u_view * vec4(a_center,1.0)).xyz;
  float s = a_radius * 1.25;
  vec3 p = c + vec3(q*s, a_radius);   // billboard pushed toward the eye so the quad never clips the front
  v_c = c; v_r = a_radius; v_p = p; v_color = a_color; v_id = a_id; v_cls = a_cls;
  gl_Position = u_proj * vec4(p,1.0);
}`;

export const SPHERE_FS = `#version 300 es
precision highp float;
${DEPTH_FN}
uniform float u_ortho; uniform float u_rep;
in vec3 v_c; in float v_r; in vec3 v_p; in vec3 v_color; in float v_id; in float v_cls;
${GBUF_OUT}
void main(){
  vec3 ro = u_ortho > 0.5 ? vec3(v_p.xy, 0.0) : vec3(0.0);
  vec3 rd = u_ortho > 0.5 ? vec3(0.0,0.0,-1.0) : normalize(v_p);
  vec3 oc = ro - v_c; float b = dot(oc, rd); float c = dot(oc,oc) - v_r*v_r; float h = b*b - c;
  if (h < 0.0) discard;
  float t = -b - sqrt(h);
  vec3 hit = ro + rd*t; vec3 n = (hit - v_c)/v_r;
  gl_FragDepth = fragDepth(hit);
  writeG(v_color, v_cls, n, v_id, u_rep);
}`;

/* ---------- cylinders (bond halves) ---------- */
export const CYL_VS = `#version 300 es
precision highp float;
uniform mat4 u_view, u_proj;
in vec3 a_a; in vec3 a_b; in float a_radius; in vec3 a_color; in float a_id; in float a_cls;
out vec3 v_a; out vec3 v_b; out float v_r; out vec3 v_p; out vec3 v_color; out float v_id; out float v_cls;
// 36 vertices of a unit box, built from gl_VertexID
const int FACES[36] = int[36](0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0);
void main(){
  int vi = FACES[gl_VertexID];
  // corners 0..3: bottom ring (-,-) (+,-) (+,+) (-,+); 4..7 the same on top
  int ri = vi & 3;
  vec3 corner = vec3(ri==1||ri==2 ? 1.0 : -1.0, ri>=2 ? 1.0 : -1.0, vi>=4 ? 1.0 : -1.0);
  vec3 a = (u_view*vec4(a_a,1.0)).xyz, b = (u_view*vec4(a_b,1.0)).xyz;
  vec3 u = b - a; float len = length(u); u /= max(len,1e-6);
  vec3 w = normalize(cross(u, abs(u.z) < 0.9 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0)));
  vec3 v = cross(u, w);
  float r = a_radius*1.05;
  vec3 p = (a+b)*0.5 + corner.x*r*v + corner.y*r*w + corner.z*(len*0.5 + r*0.05)*u;
  v_a = a; v_b = b; v_r = a_radius; v_p = p; v_color = a_color; v_id = a_id; v_cls = a_cls;
  gl_Position = u_proj*vec4(p,1.0);
}`;

export const CYL_FS = `#version 300 es
precision highp float;
${DEPTH_FN}
uniform float u_ortho; uniform float u_rep;
in vec3 v_a; in vec3 v_b; in float v_r; in vec3 v_p; in vec3 v_color; in float v_id; in float v_cls;
${GBUF_OUT}
void main(){
  vec3 ro = u_ortho > 0.5 ? vec3(v_p.xy, 0.0) : vec3(0.0);
  vec3 rd = u_ortho > 0.5 ? vec3(0.0,0.0,-1.0) : normalize(v_p);
  vec3 ba = v_b - v_a; float len = length(ba); vec3 u = ba/len;
  vec3 oa = ro - v_a;
  vec3 rdp = rd - u*dot(rd,u); vec3 oap = oa - u*dot(oa,u);
  float A = dot(rdp,rdp), B = 2.0*dot(rdp,oap), C = dot(oap,oap) - v_r*v_r;
  float h = B*B - 4.0*A*C; if (h < 0.0 || A < 1e-8) discard;
  float t = (-B - sqrt(h))/(2.0*A);
  vec3 hit = ro + rd*t; float s = dot(hit - v_a, u);
  if (s < 0.0 || s > len) discard;
  vec3 n = normalize(hit - (v_a + u*s));
  gl_FragDepth = fragDepth(hit);
  writeG(v_color, v_cls, n, v_id, u_rep);
}`;

/* ---------- triangle meshes (cartoon) ---------- */
export const MESH_VS = `#version 300 es
precision highp float;
uniform mat4 u_view, u_proj;
in vec3 a_pos; in vec3 a_nrm; in vec3 a_color; in float a_id; in float a_cls;
out vec3 v_n; out vec3 v_color; out float v_id; out float v_cls;
void main(){
  v_n = mat3(u_view)*a_nrm; v_color = a_color; v_id = a_id; v_cls = a_cls;
  gl_Position = u_proj*u_view*vec4(a_pos,1.0);
}`;

export const MESH_FS = `#version 300 es
precision highp float;
uniform float u_rep;
in vec3 v_n; in vec3 v_color; in float v_id; in float v_cls;
${GBUF_OUT}
void main(){
  vec3 n = normalize(v_n); if (!gl_FrontFacing) n = -n;
  writeG(v_color, v_cls, n, v_id, u_rep);
}`;
