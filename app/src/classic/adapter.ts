/* Glue between the app (Structure, Style, camera) and the classic engine (scene JSON, cfg). The engine keeps its own
   projector; the app's camera is the same model, so both frame a view identically. */
import { createClassic } from './engine.js';
import type { Renderer } from '../render/renderer';
import type { Structure } from '../model/structure';
import type { Style } from '../style';

export type Classic = ReturnType<typeof createClassic>;
let engine: Classic | null = null;
export function classic(): Classic { if (!engine) engine = createClassic(); return engine }

/** The old cfg object from the app's style and camera. */
export function cfgFromStyle(style: Style, cam: { yaw: number; pitch: number; zoom: number; panX: number; panY: number; fov: number }, scene: boolean) {
  const D = classic().DEFAULT_CFG;
  const surfaceColor = style.surfaceColor === 'residue' ? 'carbon' : style.surfaceColor;
  return {
    ...D, fps: 24, stepEvery: scene ? 2 : 1, boilEvery: (scene ? 2 : 1) * Math.max(1, Math.round(style.boilHold ?? 1)), arrowLead: 0.2, pdbFrames: 2,
    view: { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, panX: cam.panX, panY: cam.panY, fov: cam.fov, fog: style.view.fog, fogStart: style.view.fogStart, spin: 0, pitchSwing: 0 },
    style: { ...D.style, rough: style.line.rough, passes: style.line.passes, pressure: style.line.pressure, fillWobble: style.fillWobble, hatchDensity: style.hatch.density, hierarchy: style.line.hierarchy,
      wash: style.paper.wash, washSeed: style.paper.washSeed, washLife: style.paper.washLife, inkWidth: style.line.width, hatchSpacing: style.hatch.spacing, hatchAngle: style.hatch.angle,
      lightAngle: style.view.light, shading: style.shading, pencilFill: style.pencilFill, grain: style.paper.grain, font: style.font, labelSize: style.labelSize, captionSize: style.captionSize, annot: style.annot ?? 1 },
    show: { ...D.show, ...style.show, construction: style.construction, caption: scene && style.show.caption, stepLabel: scene && style.show.stepLabel },
    palette: { ...D.palette, ...style.palette },
    rep: { ...D.rep, mode: style.mode, fill: style.fill, colorBy: style.colorBy, stickRadius: style.stickRadius, sphereScale: style.sphereScale, sideChainHelper: style.sideChainHelper, cartoonScale: style.cartoonScale, cartoonColor: style.cartoonColor, probe: style.probe, surfaceColor },
  };
}

/** A one-keyframe scene from a Structure, with the atom ids the old loader used (so seeds, and thus the drawing, match the page).
    Positions are rotated by `base` (the PCA orientation) so the engine's yaw/pitch act on the same frame as the app's camera. */
export function sceneFromStructure(s: Structure, style: Style, overrides: Record<string, string>, base: Float32Array, fitPoints: Float32Array) {
  const rot = (x: number, y: number, z: number) => [base[0] * x + base[4] * y + base[8] * z, base[1] * x + base[5] * y + base[9] * z, base[2] * x + base[6] * y + base[10] * z];
  const atoms: Record<string, any> = {}; const ids: string[] = [];
  for (const res of s.residues) {
    const chain = res.chain ? '.' + res.chain : '';
    for (let i = res.atomStart; i < res.atomEnd; i++) {
      const name = s.atomName[i]; const id = `${res.resn}${res.resi}${chain}:${name}`; ids.push(id);
      const a: any = { el: s.element[i], pos: rot(s.x[i], s.y[i], s.z[i]), resn: res.resn, resi: res.resi, chain: res.chain, name, het: !!res.het, group: res.resn + res.resi + chain, ss: res.ss };
      if (res.nucleic) a.nucleic = true; if (res.entity) { a.entity = res.entity; a.subunit = res.subunit }
      if (i === res.trace) { a.trace = true; if (!res.het) { a.label = res.resn + res.resi; a.labelDir = [0.7, -0.7]; a.labelAuto = true; if (!res.nucleic && name === 'CA') a.sphere = true } }
      atoms[id] = a;
    }
  }
  const bonds: [string, string, number][] = []; for (let b = 0; b < s.bonds.length; b += 2) bonds.push([ids[s.bonds[b]], ids[s.bonds[b + 1]], 1]);
  const fp = new Float32Array(fitPoints.length); for (let i = 0; i < fitPoints.length; i += 3) { const r = rot(fitPoints[i], fitPoints[i + 1], fitPoints[i + 2]); fp[i] = r[0]; fp[i + 1] = r[1]; fp[i + 2] = r[2] }
  return { name: s.name, fromPdb: true, reps: { ...style.reps }, groupColors: { ...overrides }, fitPoints: fp, keyframes: [{ name: s.name, hold: 24, transition: 0, atoms, bonds, arrows: [] }] };
}

/** Draw the current structure with the classic engine onto a 2D context of the renderer's pixel size. Returns ms. */
export function renderClassic(ctx: CanvasRenderingContext2D, R: Renderer, style: Style, boil: number, dpr = 1): number {
  const t0 = performance.now(); const E = classic(); const s = R.structure; if (!s) return 0;
  E.cfg = cfgFromStyle(style, R.camera, false);
  E.scene = sceneFromStructure(s, style, R.overrides, R.camera.base, R.fitPoints);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, R.w, R.h); ctx.restore();
  E.renderFrame(ctx, R.w / dpr, R.h / dpr, boil, dpr);
  return performance.now() - t0;
}

/** Draw a frame of a loaded scene document with the classic engine. */
export function renderScene(ctx: CanvasRenderingContext2D, R: Renderer, style: Style, doc: any, frame: number, dpr = 1): number {
  const t0 = performance.now(); const E = classic();
  E.cfg = cfgFromStyle(style, R.camera, true);
  doc.reps = { ...style.reps }; doc.groupColors = { ...R.overrides };   // the style is the source of truth once loaded
  if (E.scene !== doc) E.scene = doc;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, R.w, R.h); ctx.restore();
  E.renderFrame(ctx, R.w / dpr, R.h / dpr, frame, dpr);
  return performance.now() - t0;
}
