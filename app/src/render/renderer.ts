/* Renderer: structure → G-buffer → drawing. One instance per canvas. */
import { Program, Target, QUAD_VS, drawQuad } from './gl';
import { Programs, SphereBatch, CylinderBatch, MeshBatch } from './batches';
import { EDGE_FS, BLUR_FS, STYLE_FS } from './shaders/style';
import { Camera, type Frame } from './camera';
import { Structure } from '../model/structure';
import { selectAtoms } from '../model/selection';
import { ColorScheme } from '../model/color';
import { pcaBasis } from './pca';
import { buildSticks, buildSurface, buildCartoon, REP_STICKS, REP_CARTOON, REP_SURFACE, type CartoonRun } from './geometry';
import { type Style, hexToRgb } from '../style';
import type { DensityMap } from '../model/map';
import { preparedMap, type EngineMap } from '../classic/mapprep';

const MAP_CLS = 10, MAP_REP = 4, MAP_ID = 0xfffff0;

export class Renderer {
  gl: WebGL2RenderingContext;
  progs: Programs; edgeP: Program; blurP: Program; styleP: Program;
  gbuf!: Target; edge!: Target; blurA!: Target; blurB!: Target;
  w = 0; h = 0;
  camera = new Camera();
  structure: Structure | null = null;
  overrides: Record<string, string> = {};
  /** figure labels the author placed: { text, at?: atom id, x?, y? (canvas fractions), dx, dy (px), size? } */
  labels: { text: string; at?: string; x?: number; y?: number; dx: number; dy: number; size?: number }[] = [];
  /** centre of the fitted box (what is drawn); the sketch pass measures its pixel scale here */
  focus: [number, number, number] = [0, 0, 0];
  frameInfo: Frame | null = null;
  batches: { spheres: SphereBatch[]; cyls: CylinderBatch[]; meshes: MeshBatch[] } = { spheres: [], cyls: [], meshes: [] };
  /** what the sketch pass needs besides the pixels: the selections and the cartoon runs */
  geom: { stickMask: Uint8Array | null; surfaceMask: Uint8Array | null; runs: CartoonRun[]; scheme: ColorScheme | null } = { stickMask: null, surfaceMask: null, runs: [], scheme: null };
  lastView: Float32Array | null = null; lastProj: Float32Array | null = null;
  fitPoints: Float32Array = new Float32Array(0);
  /** when set (scenes), the camera fits these points instead of the drawn atoms */
  fitOverride: Float32Array | null = null;
  frame = 0;
  /** a density map drawn with the structure (or on its own), and a local-resolution map for its lines */
  map: DensityMap | null = null; localRes: DensityMap | null = null;
  mapBatch: MeshBatch | null = null; private mapDrawn: EngineMap['levels'][number] | null = null; private mapCol = '';
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
    this.gbuf = new Target(gl, w, h, 4, true); this.edge = new Target(gl, w, h, 1, false, gl.LINEAR);
    this.blurA = new Target(gl, w, h, 1, false, gl.LINEAR); this.blurB = new Target(gl, w, h, 1, false, gl.LINEAR);
  }

  setStructure(s: Structure | null) {
    this.structure = s;
    if (s && !this.fitOverride) { this.focus = s.center; this.camera.base = pcaBasis(s) }
  }

  /** Rebuild all GPU geometry for the current style (call when selections, colours or radii change). */
  rebuild(style: Style) {
    const gl = this.gl; const t0 = performance.now();
    for (const b of this.batches.spheres) b.dispose(gl); for (const b of this.batches.cyls) b.dispose(gl); for (const b of this.batches.meshes) b.dispose(gl);
    this.batches = { spheres: [], cyls: [], meshes: [] };
    const s = this.structure; if (!s) { this.rebuildMap(style, null); return }
    const scheme = new ColorScheme(s, style, this.overrides);
    let inst = 0, tris = 0;
    const shown = new Uint8Array(s.count);
    this.geom = { stickMask: null, surfaceMask: null, runs: [], scheme };
    const siteSel = style.site?.sel?.trim(); const stickSel = siteSel ? (style.reps.sticks.trim() ? `(${style.reps.sticks}) or (${siteSel})` : siteSel) : style.reps.sticks;   // the site is always sticks
    if (stickSel.trim()) {
      const m = selectAtoms(s, stickSel); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildSticks(s, m, scheme, style); this.geom.stickMask = m;
      this.batches.spheres.push(new SphereBatch(gl, this.progs.sphere, g.spheres, REP_STICKS)); this.batches.cyls.push(new CylinderBatch(gl, this.progs.cyl, g.cylinders, REP_STICKS));
      inst += g.spheres.length / 9 + g.cylinders.length / 12;
    }
    if (style.reps.cartoon.trim()) {
      const m = selectAtoms(s, style.reps.cartoon); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildCartoon(s, m, scheme, style); this.geom.runs = g.runs;
      this.batches.meshes.push(new MeshBatch(gl, this.progs.mesh, g.verts, g.idx, REP_CARTOON)); tris += g.idx.length / 3;
    }
    if (style.reps.surface.trim()) {
      const m = selectAtoms(s, style.reps.surface); for (let i = 0; i < s.count; i++) shown[i] |= m[i]; const g = buildSurface(s, m, scheme, style); this.geom.surfaceMask = m;
      this.batches.spheres.push(new SphereBatch(gl, this.progs.sphere, g, REP_SURFACE)); inst += g.length / 9;
    }
    // the camera fits what is drawn (or everything, if nothing is selected)
    let n = 0; for (let i = 0; i < s.count; i++) n += shown[i];
    const pts = new Float32Array((n || s.count) * 3); let k = 0;
    for (let i = 0; i < s.count; i++) if (!n || shown[i]) { pts[k++] = s.x[i]; pts[k++] = s.y[i]; pts[k++] = s.z[i] }
    this.fitPoints = (this.fitOverride ?? pts) as Float32Array; this.camera.setFitPoints(this.fitPoints);
    this.rebuildMap(style, s);
    this.stats.atoms = s.count; this.stats.instances = inst; this.stats.triangles = tris; this.stats.buildMs = performance.now() - t0;
  }

  /** the map's isosurface as the drawing prepares it (the same surface, from the same cache), back in the structure's
      frame; with a model it is drawn behind it, as the drawing does by default; on its own the camera fits it */
  /** where a map's preparation is asked for (the app's worker); without it, only what the drawing prepared is drawn */
  mapSource: ((map: DensityMap, style: Style, s: Structure | null, base: Float32Array, lr: DensityMap | null) => EngineMap | null) | null = null;
  private rebuildMap(style: Style, s: Structure | null) {
    this.mapBatch?.dispose(this.gl); this.mapBatch = null; this.mapDrawn = null; this.camera.pushBehind = false;
    const m = this.map; if (!m || style.map.visible === false) return;
    const em = this.mapSource ? this.mapSource(m, style, s, this.camera.base, this.localRes) : preparedMap(m, style, s, this.camera.base, this.localRes); if (!em) return;
    const L = em.levels[em.primary] || em.levels[0]; if (!L || !L.tri.length) return;
    this.mapDrawn = L; this.mapCol = style.palette.surface + style.palette.paper;
    const b = this.camera.base, nv = L.pos.length / 3, verts = new Float32Array(nv * 11);
    const paper = hexToRgb(style.palette.paper), col = hexToRgb(style.palette.surface).map((c, k) => c + (paper[k] - c) * 0.75);   // paper with a tint, as the drawing lays it
    const un = (a: Float32Array, v: number, o: number) => { const x = a[v * 3], y = a[v * 3 + 1], z = a[v * 3 + 2];
      verts[o] = b[0] * x + b[1] * y + b[2] * z; verts[o + 1] = b[4] * x + b[5] * y + b[6] * z; verts[o + 2] = b[8] * x + b[9] * y + b[10] * z };
    for (let v = 0; v < nv; v++) { const o = v * 11; un(L.pos, v, o); un(L.nor, v, o + 3); verts[o + 6] = col[0]; verts[o + 7] = col[1]; verts[o + 8] = col[2]; verts[o + 9] = MAP_ID; verts[o + 10] = MAP_CLS }
    this.mapBatch = new MeshBatch(this.gl, this.progs.map, verts, L.tri, MAP_REP);
    this.camera.pushBehind = !!s && s.count > 0;
    if (!s) { // on its own: fitted to its surface (every few vertices are enough)
      const k = Math.max(1, Math.floor(nv / 20000)), pts = new Float32Array(Math.ceil(nv / k) * 3); let n = 0, cx = 0, cy = 0, cz = 0;
      for (let v = 0; v < nv; v += k) { pts[n++] = verts[v * 11]; pts[n++] = verts[v * 11 + 1]; pts[n++] = verts[v * 11 + 2]; cx += verts[v * 11]; cy += verts[v * 11 + 1]; cz += verts[v * 11 + 2] }
      const c = n / 3 || 1; this.focus = [cx / c, cy / c, cz / c];
      this.fitPoints = (this.fitOverride ?? pts.subarray(0, n)) as Float32Array; this.camera.setFitPoints(this.fitPoints);
    }
  }

  /** a map setting changed since the last rebuild (the level, say, which only redraws): take up the surface the
      drawing prepared, once it has (the preview never waits for a map to be prepared) */
  private refreshMap(style: Style) {
    if (!this.map || style.map.visible === false) { if (this.mapBatch) this.rebuildMap(style, this.structure); return }
    const em = preparedMap(this.map, style, this.structure, this.camera.base, this.localRes), L = em ? em.levels[em.primary] || em.levels[0] : null;
    if (L ? L !== this.mapDrawn || this.mapCol !== style.palette.surface + style.palette.paper : this.mapBatch && !this.map) this.rebuildMap(style, this.structure);
  }

  render(style: Style) {
    this.refreshMap(style);
    const gl = this.gl; const t0 = performance.now(); const cam = this.camera;
    const F = cam.compute(this.w, this.h); this.frameInfo = F; this.focus = [F.cx, F.cy, F.cz];
    const view = F.view, proj = F.proj; const ortho = F.ortho ? 1 : 0; this.lastView = view; this.lastProj = proj;
    // ---- G-buffer ----
    this.gbuf.bind(); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = this.progs;
    P.sphere.use().m4('u_view', view).m4('u_proj', proj).f('u_ortho', ortho).f('u_near', F.near).f('u_far', F.far);
    for (const b of this.batches.spheres) { P.sphere.f('u_rep', b.rep); b.draw(gl) }
    P.cyl.use().m4('u_view', view).m4('u_proj', proj).f('u_ortho', ortho).f('u_near', F.near).f('u_far', F.far);
    for (const b of this.batches.cyls) { P.cyl.f('u_rep', b.rep); b.draw(gl) }
    P.mesh.use().m4('u_view', view).m4('u_proj', proj).f('u_near', F.near).f('u_far', F.far);
    for (const b of this.batches.meshes) { P.mesh.f('u_rep', b.rep); b.draw(gl) }
    if (this.mapBatch) { P.map.use().m4('u_view', view).m4('u_proj', proj).f('u_near', F.near).f('u_far', F.far).f('u_rep', MAP_REP).f('u_push', F.push); this.mapBatch.draw(gl) }
    gl.disable(gl.DEPTH_TEST);
    // ---- edges ----
    this.edge.bind();
    this.edgeP.use().tex('u_normal', 0, this.gbuf.color[1]).tex('u_id', 1, this.gbuf.color[2]).tex('u_depth', 2, this.gbuf.depth!)
      .v2('u_px', 1 / this.w, 1 / this.h).f('u_near', F.near).f('u_far', F.far).f('u_ortho', ortho)
      .f('u_depthEdge', Math.max(0.35, Math.max(F.spanX, F.spanY) * 0.004));
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
      .f('u_near', F.near).f('u_far', F.far).f('u_ortho', ortho)
      .f('u_sceneNear', F.sceneNear).f('u_sceneFar', F.sceneFar);
    drawQuad(gl);
    this.frame++;
    this.stats.frameMs = performance.now() - t0;
  }

  /** Read the G-buffer back for the sketch pass: labels (rep<<24 | id), linear depth in Å, normals. Rows are top-down. */
  readback() {
    const gl = this.gl; const w = this.w, h = this.h; const n = w * h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuf.fbo);
    const idb = new Uint8Array(n * 4), auxb = new Uint8Array(n * 4), nb = new Uint8Array(n * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT2); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, idb);
    gl.readBuffer(gl.COLOR_ATTACHMENT3); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, auxb);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, nb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const label = new Uint32Array(n), depth = new Float32Array(n), normal = new Int8Array(n * 3);
    const F = this.frameInfo!; const near = F.near, far = F.far;
    for (let y = 0; y < h; y++) { const src = (h - 1 - y) * w; for (let x = 0; x < w; x++) { const i = y * w + x, j = (src + x) * 4;
      const rep = Math.round(idb[j + 3] / 255 * 4); if (rep) { label[i] = (rep << 24) | (idb[j] | (idb[j + 1] << 8) | (idb[j + 2] << 16)) }
      depth[i] = near + (auxb[j] * 255 + auxb[j + 1]) / 65535 * (far - near);
      normal[i * 3] = nb[j] - 128; normal[i * 3 + 1] = nb[j + 1] - 128; normal[i * 3 + 2] = nb[j + 2] - 128 } }
    return { w, h, label, depth, normal };
  }
  /** Project a model-space point with the matrices of the last frame: screen px (top-down), linear depth, per-Å pixel scale, fog 0..1. */
  project(x: number, y: number, z: number) {
    const V = this.lastView!, P = this.lastProj!;
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
    const cx = P[0] * vx + P[8] * vz, cy = P[5] * vy + P[9] * vz, cw = P[11] * vz + P[15], cz = P[10] * vz + P[14];
    const w = cw || 1; const sx = (cx / w * 0.5 + 0.5) * this.w, sy = (1 - (cy / w * 0.5 + 0.5)) * this.h;
    const pxPerA = P[5] / w * this.h / 2;   // pixels per model unit at this depth
    const F = this.frameInfo!; const dn = (-vz - F.sceneNear) / Math.max(1e-6, F.sceneFar - F.sceneNear);
    return { x: sx, y: sy, z: -vz, d: pxPerA, fog: Math.max(0, Math.min(1, dn)), vz, ndcz: cz / w };
  }

  /** PNG of the last frame. */
  toDataURL() { return this.canvas.toDataURL('image/png') }
}

export { pcaBasis } from './pca';
