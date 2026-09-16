/* The camera is the page's camera (computeFit + makeProjector in triad-sketch.html), expressed as matrices so the
   GPU and the classic engine frame a view identically:
   - the fit points (what is drawn) are rotated by base·Ry(yaw)·Rx(pitch) about their bounding-box centre;
   - the rotated bounding box gives rx, ry (its centre on screen), spanX, spanY, zspan;
   - the eye sits D = ext / tan(fov/2) in front of the centre plane (ext = half the larger span + 1.5 Å), or at infinity;
   - base (px per Å on the centre plane) fits the spans into 90 % of the width / the height minus caption margins,
     times zoom, divided by dNear^0.7 so a strong perspective does not overflow;
   - pan moves the drawing by fractions of the canvas. */

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export function mat4RotX(a: number): Mat4 { const m = mat4Identity(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m }
export function mat4RotY(a: number): Mat4 { const m = mat4Identity(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m }
export function mat4Translate(x: number, y: number, z: number): Mat4 { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m }

export interface Frame {
  view: Mat4; proj: Mat4; near: number; far: number; ortho: boolean;
  D: number; base: number; rx: number; ry: number; spanX: number; spanY: number; zspan: number;
  cx: number; cy: number; cz: number;           // fit centre, model units
  sceneNear: number; sceneFar: number;          // depth range of the fit box (for fog)
}

export class Camera {
  yaw = 0; pitch = 0; zoom = 1; panX = 0; panY = 0;
  fov = 20;                       // degrees; < 0.1 → orthographic
  /** rotation applied before yaw/pitch (PCA orientation of a loaded structure) */
  base: Mat4 = mat4Identity();
  /** fractions of the height reserved for a caption at the bottom and a step label at the top (page: 0.13 / 0.05) */
  capFrac = 0; topFrac = 0;
  private pts: Float32Array = new Float32Array(0);
  private fitKey = ''; private fitVersion = 0; private fit = { cx: 0, cy: 0, cz: 0, rx: 0, ry: 0, spanX: 10, spanY: 10, zspan: 4 };

  /** The points the view is fitted to (xyz triples, model units). */
  setFitPoints(p: Float32Array) { this.pts = p as Float32Array; this.fitVersion++; this.fitKey = '' }
  get rotation(): Mat4 { return mat4Mul(mat4RotX(this.pitch * Math.PI / 180), mat4Mul(mat4RotY(this.yaw * Math.PI / 180), this.base)) }

  private computeFit() {
    const key = this.yaw + '|' + this.pitch + '|' + this.fitVersion;
    if (key === this.fitKey) return; this.fitKey = key;
    const p = this.pts; const n = p.length / 3;
    if (!n) { this.fit = { cx: 0, cy: 0, cz: 0, rx: 0, ry: 0, spanX: 10, spanY: 10, zspan: 4 }; return }
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = p[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v }
    const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
    const R = this.rotation;
    let rmn = [Infinity, Infinity, Infinity], rmx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) { const x = p[i * 3] - cx, y = p[i * 3 + 1] - cy, z = p[i * 3 + 2] - cz;
      const r0 = R[0] * x + R[4] * y + R[8] * z, r1 = R[1] * x + R[5] * y + R[9] * z, r2 = R[2] * x + R[6] * y + R[10] * z;
      if (r0 < rmn[0]) rmn[0] = r0; if (r0 > rmx[0]) rmx[0] = r0; if (r1 < rmn[1]) rmn[1] = r1; if (r1 > rmx[1]) rmx[1] = r1; if (r2 < rmn[2]) rmn[2] = r2; if (r2 > rmx[2]) rmx[2] = r2 }
    this.fit = { cx, cy, cz, rx: (rmn[0] + rmx[0]) / 2, ry: (rmn[1] + rmx[1]) / 2, spanX: Math.max(rmx[0] - rmn[0], 1), spanY: Math.max(rmx[1] - rmn[1], 1), zspan: Math.max(rmx[2] - rmn[2], 1) };
  }

  /** Matrices for a W×H canvas (any pixel unit: the framing is the same in CSS or device pixels). */
  compute(W: number, H: number): Frame {
    this.computeFit(); const F = this.fit;
    const capH = this.capFrac * H, topH = this.topFrac * H;
    const fov = this.fov * Math.PI / 180; const ext = Math.max(F.spanX, F.spanY) / 2 + 1.5;
    const ortho = fov <= 0.002; const D = ortho ? Infinity : ext / Math.tan(fov / 2);
    const dNear = ortho ? 1 : D / Math.max(D - F.zspan / 2, D * 0.3);
    const base = Math.min((W * 0.9) / (F.spanX + 2.6), (H - capH - topH - 24) / (F.spanY + 2.4)) * this.zoom / Math.pow(dNear, 0.7);
    // screen centre of the fit box, as NDC offsets
    const offX = 2 * this.panX; const offY = (capH - topH) / H - 2 * this.panY;
    const Dv = ortho ? F.zspan + 10 : D;   // eye distance used for the view matrix (any value works for ortho)
    const view = mat4Mul(mat4Translate(-F.rx, -F.ry, -Dv), mat4Mul(this.rotation, mat4Translate(-F.cx, -F.cy, -F.cz)));
    const margin = F.zspan * 0.25 + 6;
    const near = Math.max(0.05, Dv - F.zspan / 2 - margin), far = Dv + F.zspan / 2 + margin;
    const proj = new Float32Array(16);
    if (ortho) { proj[0] = 2 * base / W; proj[5] = 2 * base / H; proj[10] = -2 / (far - near); proj[14] = -(far + near) / (far - near); proj[15] = 1; proj[12] = offX; proj[13] = offY }
    else { proj[0] = 2 * base * D / W; proj[5] = 2 * base * D / H; proj[8] = -offX; proj[9] = -offY; proj[10] = (far + near) / (near - far); proj[11] = -1; proj[14] = 2 * far * near / (near - far) }
    return { view, proj, near, far, ortho, D: Dv, base, rx: F.rx, ry: F.ry, spanX: F.spanX, spanY: F.spanY, zspan: F.zspan, cx: F.cx, cy: F.cy, cz: F.cz, sceneNear: Dv - F.zspan / 2, sceneFar: Dv + F.zspan / 2 };
  }
}
