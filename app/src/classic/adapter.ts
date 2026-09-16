/* Glue between the app (Structure, Style, camera) and the classic engine (scene JSON, cfg, projector). */
import { createClassic } from './engine.js';
import type { Renderer } from '../render/renderer';
import type { Structure } from '../model/structure';
import type { Style } from '../style';

export type Classic = ReturnType<typeof createClassic>;
let engine: Classic | null = null;
export function classic(): Classic { if (!engine) engine = createClassic(); return engine }

/** The old cfg object from the app's style and camera. */
export function cfgFromStyle(style: Style, cam: { yaw: number; pitch: number; zoom: number; panX: number; panY: number; fov: number }) {
  const D = classic().DEFAULT_CFG;
  const surfaceColor = style.surfaceColor === 'residue' ? 'carbon' : style.surfaceColor;
  return {
    ...D, fps: 24, stepEvery: 1, boilEvery: 1, arrowLead: 0.2, pdbFrames: 2,
    view: { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, panX: cam.panX, panY: cam.panY, fov: cam.fov, fog: style.view.fog, fogStart: style.view.fogStart, spin: 0, pitchSwing: 0 },
    style: { ...D.style, rough: style.line.rough, passes: style.line.passes, pressure: style.line.pressure, fillWobble: style.fillWobble, hatchDensity: style.hatch.density, hierarchy: style.line.hierarchy,
      wash: style.paper.wash, washSeed: style.paper.washSeed, washLife: style.paper.washLife, inkWidth: style.line.width, hatchSpacing: style.hatch.spacing, hatchAngle: style.hatch.angle,
      lightAngle: style.view.light, shading: style.shading, pencilFill: style.pencilFill, grain: style.paper.grain },
    show: { ...D.show, construction: style.construction, caption: true, stepLabel: false, resLabels: false, H: true },
    palette: { ...D.palette, ...style.palette },
    rep: { ...D.rep, mode: 'sticks', fill: style.fill, colorBy: style.colorBy, stickRadius: style.stickRadius, sideChainHelper: style.sideChainHelper, cartoonScale: style.cartoonScale, cartoonColor: style.cartoonColor, probe: style.probe, surfaceColor },
  };
}

/** A one-keyframe scene from a Structure, with the atom ids the old loader used (so seeds, and thus the drawing, match the page). */
export function sceneFromStructure(s: Structure, style: Style, overrides: Record<string, string>) {
  const atoms: Record<string, any> = {};
  for (const res of s.residues) {
    const chain = res.chain ? '.' + res.chain : '';
    for (let i = res.atomStart; i < res.atomEnd; i++) {
      const name = s.atomName[i]; const id = `${res.resn}${res.resi}${chain}:${name}`;
      const a: any = { el: s.element[i], pos: [s.x[i], s.y[i], s.z[i]], resn: res.resn, resi: res.resi, chain: res.chain, name, het: !!res.het, group: res.resn + res.resi + chain, ss: res.ss };
      if (res.nucleic) a.nucleic = true; if (res.entity) { a.entity = res.entity; a.subunit = res.subunit }
      if (i === res.trace) { a.trace = true; if (!res.het) { a.label = res.resn + res.resi; a.labelDir = [0.7, -0.7]; a.labelAuto = true; if (!res.nucleic && name === 'CA') a.sphere = true } }
      atoms[id] = a;
    }
  }
  const ids: string[] = []; for (const res of s.residues) { const chain = res.chain ? '.' + res.chain : ''; for (let i = res.atomStart; i < res.atomEnd; i++) ids.push(`${res.resn}${res.resi}${chain}:${s.atomName[i]}`) }
  const bonds: [string, string, number][] = []; for (let b = 0; b < s.bonds.length; b += 2) bonds.push([ids[s.bonds[b]], ids[s.bonds[b + 1]], 1]);
  return { name: s.name, fromPdb: true, reps: { ...style.reps }, groupColors: { ...overrides }, keyframes: [{ name: s.name, hold: 24, transition: 0, atoms, bonds, arrows: [] }] };
}

/** A projector on the app's camera, in CSS px for a W×H drawing at device pixel ratio dpr. */
export function projectorFor(R: Renderer, dpr: number) {
  const V = R.lastView!; const focus = R.focus;
  const d0 = R.project(focus[0], focus[1], focus[2]).d || 1;
  const rot = (p: number[]) => { const x = p[0] - focus[0], y = p[1] - focus[1], z = p[2] - focus[2]; return [V[0] * x + V[4] * y + V[8] * z, V[1] * x + V[5] * y + V[9] * z, V[2] * x + V[6] * y + V[10] * z] };
  return {
    centre: focus,
    make(_W: number, _H: number) {
      return {
        pxPerA: d0 / dpr, D: R.camera.fov < 1 ? Infinity : R.camera.distance,
        rot,
        proj(p: number[]) { const q = R.project(p[0], p[1], p[2]); return { x: q.x / dpr, y: q.y / dpr, z: q.vz, d: q.d / d0, fog: q.fog } },
        dir2(v: number[]) { const r = rot([v[0] + focus[0], v[1] + focus[1], v[2] + focus[2]]); return [r[0], -r[1]] },
      };
    },
  };
}

/** Draw the current structure with the classic engine onto a 2D context of the renderer's pixel size. Returns ms. */
export function renderClassic(ctx: CanvasRenderingContext2D, R: Renderer, style: Style, boil: number, dpr = 1): number {
  const t0 = performance.now(); const E = classic(); const s = R.structure; if (!s || !R.lastView) return 0;
  E.cfg = cfgFromStyle(style, R.camera);
  E.scene = sceneFromStructure(s, style, R.overrides);
  E.setProjector(projectorFor(R, dpr));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, R.w, R.h); ctx.restore();
  E.renderFrame(ctx, R.w / dpr, R.h / dpr, boil, dpr);
  return performance.now() - t0;
}
