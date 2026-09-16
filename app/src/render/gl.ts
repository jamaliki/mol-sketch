/* Small WebGL2 helpers: programs, buffers, framebuffers, full-screen quad. */

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); throw new Error('shader: ' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')) }
    return sh;
  };
  const p = gl.createProgram()!; gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export class Program {
  prog: WebGLProgram; private uni = new Map<string, WebGLUniformLocation | null>(); private attr = new Map<string, number>();
  constructor(public gl: WebGL2RenderingContext, vs: string, fs: string) { this.prog = compile(gl, vs, fs) }
  use() { this.gl.useProgram(this.prog); return this }
  u(name: string) { if (!this.uni.has(name)) this.uni.set(name, this.gl.getUniformLocation(this.prog, name)); return this.uni.get(name)! }
  a(name: string) { if (!this.attr.has(name)) this.attr.set(name, this.gl.getAttribLocation(this.prog, name)); return this.attr.get(name)! }
  f(name: string, v: number) { this.gl.uniform1f(this.u(name), v); return this }
  i(name: string, v: number) { this.gl.uniform1i(this.u(name), v); return this }
  v2(name: string, a: number, b: number) { this.gl.uniform2f(this.u(name), a, b); return this }
  v3(name: string, a: number, b: number, c: number) { this.gl.uniform3f(this.u(name), a, b, c); return this }
  v4(name: string, a: number, b: number, c: number, d: number) { this.gl.uniform4f(this.u(name), a, b, c, d); return this }
  m4(name: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.u(name), false, m); return this }
  tex(name: string, unit: number, t: WebGLTexture) { this.gl.activeTexture(this.gl.TEXTURE0 + unit); this.gl.bindTexture(this.gl.TEXTURE_2D, t); this.gl.uniform1i(this.u(name), unit); return this }
}

export function buffer(gl: WebGL2RenderingContext, data: ArrayBufferView, usage = gl.STATIC_DRAW): WebGLBuffer {
  const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b;
}

export function texture2D(gl: WebGL2RenderingContext, w: number, h: number, internal: number, format: number, type: number, filter: number = gl.NEAREST, data: ArrayBufferView | null = null): WebGLTexture {
  const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** A framebuffer with n RGBA8 colour attachments and an optional depth texture. */
export class Target {
  fbo: WebGLFramebuffer; color: WebGLTexture[] = []; depth: WebGLTexture | null = null;
  constructor(public gl: WebGL2RenderingContext, public w: number, public h: number, n: number, withDepth: boolean, filter?: number) {
    this.fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const bufs: number[] = [];
    for (let i = 0; i < n; i++) { const t = texture2D(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, filter ?? gl.NEAREST); this.color.push(t); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); bufs.push(gl.COLOR_ATTACHMENT0 + i) }
    if (withDepth) { this.depth = texture2D(gl, w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0) }
    gl.drawBuffers(bufs);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete: ' + st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind() { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo); this.gl.viewport(0, 0, this.w, this.h) }
  dispose() { const gl = this.gl; gl.deleteFramebuffer(this.fbo); for (const t of this.color) gl.deleteTexture(t); if (this.depth) gl.deleteTexture(this.depth) }
}

export const QUAD_VS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main(){ vec2 p = vec2(gl_VertexID==1||gl_VertexID==3||gl_VertexID==4 ? 1.0 : -1.0, gl_VertexID==2||gl_VertexID==4||gl_VertexID==5 ? 1.0 : -1.0); v_uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;

export function drawQuad(gl: WebGL2RenderingContext) { gl.drawArrays(gl.TRIANGLES, 0, 6) }
