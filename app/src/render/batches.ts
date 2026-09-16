/* GPU batches: instanced spheres and cylinders, and indexed triangle meshes. Each knows how to bind and draw itself. */
import { Program, buffer } from './gl';
import { SPHERE_VS, SPHERE_FS, CYL_VS, CYL_FS, MESH_VS, MESH_FS } from './shaders/gbuffer';

export class Programs {
  sphere: Program; cyl: Program; mesh: Program;
  constructor(gl: WebGL2RenderingContext) { this.sphere = new Program(gl, SPHERE_VS, SPHERE_FS); this.cyl = new Program(gl, CYL_VS, CYL_FS); this.mesh = new Program(gl, MESH_VS, MESH_FS) }
}

/** Instance layout (floats): center 3, radius 1, color 3, id 1, cls 1 = 9 */
export const SPHERE_STRIDE = 9;
/** Instance layout: a 3, b 3, radius 1, color 3, id 1, cls 1 = 12 */
export const CYL_STRIDE = 12;
/** Vertex layout: pos 3, nrm 3, color 3, id 1, cls 1 = 11 */
export const MESH_STRIDE = 11;

export class SphereBatch {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n: number;
  constructor(gl: WebGL2RenderingContext, p: Program, data: Float32Array, public rep: number) {
    this.n = data.length / SPHERE_STRIDE; this.buf = buffer(gl, data); this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); const S = SPHERE_STRIDE * 4;
    const set = (name: string, size: number, off: number) => { const a = p.a(name); if (a < 0) return; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off * 4); gl.vertexAttribDivisor(a, 1) };
    set('a_center', 3, 0); set('a_radius', 1, 3); set('a_color', 3, 4); set('a_id', 1, 7); set('a_cls', 1, 8);
    gl.bindVertexArray(null);
  }
  draw(gl: WebGL2RenderingContext) { if (!this.n) return; gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.n); gl.bindVertexArray(null) }
  dispose(gl: WebGL2RenderingContext) { gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao) }
}

export class CylinderBatch {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n: number;
  constructor(gl: WebGL2RenderingContext, p: Program, data: Float32Array, public rep: number) {
    this.n = data.length / CYL_STRIDE; this.buf = buffer(gl, data); this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); const S = CYL_STRIDE * 4;
    const set = (name: string, size: number, off: number) => { const a = p.a(name); if (a < 0) return; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off * 4); gl.vertexAttribDivisor(a, 1) };
    set('a_a', 3, 0); set('a_b', 3, 3); set('a_radius', 1, 6); set('a_color', 3, 7); set('a_id', 1, 10); set('a_cls', 1, 11);
    gl.bindVertexArray(null);
  }
  draw(gl: WebGL2RenderingContext) { if (!this.n) return; gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.n); gl.bindVertexArray(null) }
  dispose(gl: WebGL2RenderingContext) { gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao) }
}

export class MeshBatch {
  vao: WebGLVertexArrayObject; vbuf: WebGLBuffer; ibuf: WebGLBuffer; n: number;
  constructor(gl: WebGL2RenderingContext, p: Program, verts: Float32Array, idx: Uint32Array, public rep: number) {
    this.n = idx.length; this.vbuf = buffer(gl, verts); this.ibuf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf); const S = MESH_STRIDE * 4;
    const set = (name: string, size: number, off: number) => { const a = p.a(name); if (a < 0) return; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off * 4) };
    set('a_pos', 3, 0); set('a_nrm', 3, 3); set('a_color', 3, 6); set('a_id', 1, 9); set('a_cls', 1, 10);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }
  draw(gl: WebGL2RenderingContext) { if (!this.n) return; gl.bindVertexArray(this.vao); gl.drawElements(gl.TRIANGLES, this.n, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null) }
  dispose(gl: WebGL2RenderingContext) { gl.deleteBuffer(this.vbuf); gl.deleteBuffer(this.ibuf); gl.deleteVertexArray(this.vao) }
}
