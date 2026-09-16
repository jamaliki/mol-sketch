/* Renderer: structure → G-buffer → drawing. One instance per canvas. */
import { Program, Target, QUAD_VS, drawQuad } from './gl';
import { Programs, SphereBatch, CylinderBatch, MeshBatch } from './batches';
import { EDGE_FS, BLUR_FS, STYLE_FS } from './shaders/style';
import { Camera } from './camera';
import { Structure } from '../model/structure';
import { selectAtoms } from '../model/selection';
import { ColorScheme } from '../model/color';
import { buildSticks, buildSurface, buildCartoon, REP_STICKS, REP_CARTOON, REP_SURFACE } from './geometry';
import { type Style, hexToRgb } from '../style';

export class Renderer {
  gl: WebGL2RenderingContext;
  progs: Programs; edgeP: Program; blurP: Program; styleP: Program;
  gbuf!: Target; edge!: Target; blurA!: Target; blurB!: Target;
  w = 0; h = 0;
  camera = new Camera();
  structure: Structure | null = null;
  overrides: Record<string, string> = {};
  /** centre and radius of what is drawn (union of the selections); the camera orbits this */
  focus: [number, number, number] = [0, 0, 0];
  batches: { spheres: SphereBatch[]; cyls: CylinderBatch[]; meshes: MeshBatch[] } = { spheres: [], cyls: [], meshes: [] };
  frame = 0;
  stats = { atoms: 0, instances: 0, triangles: 0, buildMs: 0, frameMs: 0 };

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.progs = new Programs(gl);
    this.edgeP = new Program(gl, QUAD_VS, EDGE_FS); this.blurP = new Program(gl, QUAD_VS, BLUR_FS); this.styleP = new Program(gl, QUAD_VS, STYLE_FS);
    this.resize(canvas.width, canvas.height);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return; this.w = w; this.h = h; const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    this.gbuf?.dispose(); this.edge?.dispose(); this.blurA?.dispose(); this.blurB?.dispose();
    this.gbuf = new Target(gl, w, h, 3, true); this.edge = new Target(gl, w, h, 1, false, gl.LINEAR);
    this.blurA = new Target(gl, w, h, 1, false, gl.LINEAR); this.blurB = new Target(gl, w, h, 1, false, gl.LINEAR);
    this.camera.aspect = w / h;
  }

  setStructure(s: Structure | null) {
    this.structure = s;
    if (s) { this.focus = s.center; this.camera.radius = s.radius; this.camera.base = pcaBasis(s) }
  }

  /** Rebuild all GPU geometry for the current style (call when selections, colours or radii change). */
  rebuild(style: Style) {
    const gl = this.gl; const t0 = performance.now();
    for (const b of this.batches.spheres) b.dispose(gl); for (const b of this.batches.cyls) b.dispose(gl); for (const b of this.batches.meshes) b.dispose(gl);
    this.batches = { spheres: [], cyls: [], meshes: [] };
    const s = this.structure; if (!s) return;
    const scheme = new ColorScheme(s, style, this.overrides);
    let inst = 0, tris = 0;
    const shown = new Uint8Array(s.count);
    if (style.reps.sticks.trim()) {
      const m = selectAtoms(s, style.reps.sticks); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildSticks(s, m, scheme, style);
      this.batches.spheres.push(new SphereBatch(gl, this.progs.sphere, g.spheres, REP_STICKS)); this.batches.cyls.push(new CylinderBatch(gl, this.progs.cyl, g.cylinders, REP_STICKS));
      inst += g.spheres.length / 9 + g.cylinders.length / 12;
    }
    if (style.reps.cartoon.trim()) {
      const m = selectAtoms(s, style.reps.cartoon); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildCartoon(s, m, scheme, style);
      this.batches.meshes.push(new MeshBatch(gl, this.progs.mesh, g.verts, g.idx, REP_CARTOON)); tris += g.idx.length / 3;
    }
    if (style.reps.surface.trim()) {
      const m = selectAtoms(s, style.reps.surface); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildSurface(s, m, scheme, style);
      this.batches.spheres.push(new SphereBatch(gl, this.progs.sphere, g, REP_SURFACE)); inst += g.length / 9;
    }
    // fit the camera to what is drawn
    let n = 0, cx = 0, cy = 0, cz = 0; for (let i = 0; i < s.count; i++) if (shown[i]) { n++; cx += s.x[i]; cy += s.y[i]; cz += s.z[i] }
    if (n) { cx /= n; cy /= n; cz /= n; let r2 = 0; for (let i = 0; i < s.count; i++) if (shown[i]) { const d = (s.x[i] - cx) ** 2 + (s.y[i] - cy) ** 2 + (s.z[i] - cz) ** 2; if (d > r2) r2 = d }
      this.focus = [cx, cy, cz]; this.camera.radius = Math.sqrt(r2) * 0.72 + 1.5 }
    this.stats.atoms = s.count; this.stats.instances = inst; this.stats.triangles = tris; this.stats.buildMs = performance.now() - t0;
  }

  /** Model → view matrices are recentred on the structure. */
  private centred(view: Float32Array): Float32Array {
    const s = this.structure; if (!s) return view;
    const T = new Float32Array(16); T[0] = T[5] = T[10] = T[15] = 1; T[12] = -this.focus[0]; T[13] = -this.focus[1]; T[14] = -this.focus[2];
    // view * T
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = view[r] * T[c * 4] + view[4 + r] * T[c * 4 + 1] + view[8 + r] * T[c * 4 + 2] + view[12 + r] * T[c * 4 + 3];
    return o;
  }

  render(style: Style) {
    const gl = this.gl; const t0 = performance.now(); const cam = this.camera;
    const view = this.centred(cam.view()), proj = cam.proj(); const ortho = cam.fov < 1 ? 1 : 0;
    // ---- G-buffer ----
    this.gbuf.bind(); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = this.progs;
    P.sphere.use().m4('u_view', view).m4('u_proj', proj).f('u_ortho', ortho);
    for (const b of this.batches.spheres) { P.sphere.f('u_rep', b.rep); b.draw(gl) }
    P.cyl.use().m4('u_view', view).m4('u_proj', proj).f('u_ortho', ortho);
    for (const b of this.batches.cyls) { P.cyl.f('u_rep', b.rep); b.draw(gl) }
    P.mesh.use().m4('u_view', view).m4('u_proj', proj);
    for (const b of this.batches.meshes) { P.mesh.f('u_rep', b.rep); b.draw(gl) }
    gl.disable(gl.DEPTH_TEST);
    // ---- edges ----
    this.edge.bind();
    this.edgeP.use().tex('u_normal', 0, this.gbuf.color[1]).tex('u_id', 1, this.gbuf.color[2]).tex('u_depth', 2, this.gbuf.depth!)
      .v2('u_px', 1 / this.w, 1 / this.h).f('u_near', cam.near).f('u_far', cam.far).f('u_ortho', ortho)
      .f('u_depthEdge', Math.max(0.35, cam.radius * 0.006));
    drawQuad(gl);
    // ---- blur of coverage (drying ring) ----
    const br = Math.max(1, Math.round(1.2 * style.water.ring + 0.5));
    this.blurA.bind(); this.blurP.use().tex('u_src', 0, this.edge.color[0]).v2('u_dir', br / this.w, 0).i('u_chan', 0); drawQuad(gl);
    this.blurB.bind(); this.blurP.use().tex('u_src', 0, this.blurA.color[0]).v2('u_dir', 0, br / this.h).i('u_chan', 1); drawQuad(gl);
    // ---- style → screen ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    const pal = style.palette; const [pr, pg, pb] = hexToRgb(pal.paper), [ir, ig, ib] = hexToRgb(pal.ink), [wr, wg, wb] = hexToRgb(pal.wash);
    const seed = Math.floor(this.frame / Math.max(1, style.boilEvery));
    const sp = this.styleP.use();
    sp.tex('u_albedo', 0, this.gbuf.color[0]).tex('u_normal', 1, this.gbuf.color[1]).tex('u_id', 2, this.gbuf.color[2]).tex('u_depth', 3, this.gbuf.depth!).tex('u_edge', 4, this.edge.color[0]).tex('u_blur', 5, this.blurB.color[0]);
    sp.v2('u_size', this.w, this.h).f('u_seed', seed).f('u_washSeed', style.paper.washSeed).f('u_washDrift', style.paper.washLife)
      .i('u_fill', style.fill === 'ink' ? 0 : style.fill === 'ink colour' ? 1 : 2)
      .v3('u_paper', pr, pg, pb).v3('u_ink', ir, ig, ib).v3('u_wash', wr, wg, wb)
      .f('u_grain', style.paper.grain).f('u_washAmt', style.paper.wash).f('u_washScale', style.paper.washScale)
      .f('u_lineWidth', style.line.width * this.w / 960).f('u_rough', style.line.rough).f('u_hierarchy', style.line.hierarchy).f('u_pressure', style.line.pressure).f('u_lineAlpha', style.line.alpha).i('u_passes', style.line.passes)
      .f('u_hatchSpacing', style.hatch.spacing * this.w / 960).f('u_hatchAngle', style.hatch.angle).f('u_hatchDensity', style.hatch.density)
      .i('u_layers', style.water.layers).f('u_wobble', style.water.wobble * this.w / 960).f('u_ring', style.water.ring).f('u_gran', style.water.granulation).f('u_tone', style.water.tone)
      .f('u_fog', style.view.fog).f('u_fogStart', style.view.fogStart).f('u_light', style.view.light)
      .f('u_near', cam.near).f('u_far', cam.far).f('u_ortho', ortho)
      .f('u_sceneNear', cam.distance - cam.radius).f('u_sceneFar', cam.distance + cam.radius);
    drawQuad(gl);
    this.frame++;
    this.stats.frameMs = performance.now() - t0;
  }

  /** PNG of the last frame. */
  toDataURL() { return this.canvas.toDataURL('image/png') }
}

/** Rotation that puts the structure's principal axes on screen x, y (largest spread in-plane), right-handed. */
export function pcaBasis(s: Structure): Float32Array {
  const n = s.count; const c = s.center; const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += step) { const d = [s.x[i] - c[0], s.y[i] - c[1], s.z[i] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += d[a] * d[b] }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; const A = M.map(r => r.slice());
  for (let it = 0; it < 60; it++) {
    let p = 0, q = 1, mx = Math.abs(A[0][1]); if (Math.abs(A[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(A[0][2]) } if (Math.abs(A[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(A[1][2]) }
    if (mx < 1e-9) break; const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]); const cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq }
    for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq }
  }
  const ev = [0, 1, 2].map(i => ({ l: A[i][i], v: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.l - a.l);
  const e1 = ev[0].v, e2 = ev[1].v; const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  // rows e1,e2,e3 → column-major mat4 (rotation R with R*d = (e1·d, e2·d, e3·d))
  const m = new Float32Array(16); m[15] = 1;
  m[0] = e1[0]; m[4] = e1[1]; m[8] = e1[2]; m[1] = e2[0]; m[5] = e2[1]; m[9] = e2[2]; m[2] = e3[0]; m[6] = e3[1]; m[10] = e3[2];
  return m;
}
