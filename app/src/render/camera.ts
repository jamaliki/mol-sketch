/* Orbit camera. PyMOL-style: the molecule sits at the origin of the model frame; yaw/pitch rotate it,
   the eye sits on +z at a distance that fits the bounding sphere, divided by zoom. */

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export function mat4Perspective(fovyDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyDeg * Math.PI / 360); const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far); return m;
}
export function mat4Ortho(hw: number, hh: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16); m[0] = 1 / hw; m[5] = 1 / hh; m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near); m[15] = 1; return m;
}
export function mat4RotX(a: number): Mat4 { const m = mat4Identity(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
export function mat4RotY(a: number): Mat4 { const m = mat4Identity(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m }
export function mat4Translate(x: number, y: number, z: number): Mat4 { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m }

export class Camera {
  yaw = 0; pitch = 0; zoom = 1; panX = 0; panY = 0;
  fov = 20;              // degrees; below 1 → orthographic
  radius = 30;           // bounding sphere of the scene (model frame is centred)
  aspect = 1;
  /** rotation applied before yaw/pitch (PCA orientation of the loaded structure) */
  base: Mat4 = mat4Identity();

  get distance() { const f = Math.max(this.fov, 1) * Math.PI / 360; const fit = Math.max(this.radius / Math.sin(f), this.radius / Math.sin(f) / Math.min(1, this.aspect)); return fit / this.zoom }
  get near() { return Math.max(0.5, this.distance - this.radius * 1.5) }
  get far() { return this.distance + this.radius * 1.5 }

  /** model → view */
  view(): Mat4 {
    const rot = mat4Mul(mat4RotX(this.pitch * Math.PI / 180), mat4Mul(mat4RotY(this.yaw * Math.PI / 180), this.base));
    const d = this.distance; const h = this.frameHalfHeight();
    return mat4Mul(mat4Translate(this.panX * h * this.aspect * 2, this.panY * h * 2, -d), rot);
  }
  /** half height of the view frustum at the focal distance, model units */
  frameHalfHeight() { return this.fov < 1 ? this.radius / this.zoom : Math.tan(this.fov * Math.PI / 360) * this.distance }
  proj(): Mat4 {
    if (this.fov < 1) { const h = this.frameHalfHeight(); return mat4Ortho(h * this.aspect, h, this.near, this.far) }
    return mat4Perspective(this.fov, this.aspect, this.near, this.far);
  }
}
