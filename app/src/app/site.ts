/* The active site, without the app: find the pocket round a ligand, turn the molecule so the site faces the viewer,
   label its residues. Shared by the app (main.ts) and the headless core (headless.ts), so both give the same figure. */
import type { Structure } from '../model/structure';
import type { Classic } from '../classic/adapter';

type Cam = { yaw: number; pitch: number; roll: number; zoom: number; panX: number; panY: number };
export type FigLabel = { text: string; at?: string; x?: number; y?: number; dx: number; dy: number; size?: number };
/** what the site functions need from their host: the engine made ready for the current view, and the canvas */
export interface SiteHost {
  /** set the engine's cfg and scene for the camera as it is now, and return it */
  engine(): Classic;
  camera: Cam; W: number; H: number; frame: number; siteSel: string;
}

const WATER = new Set(['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'TIP3', 'SOL']);
/** the residues within `dist` Å of the largest ligand, and the ligand itself, as a selection ('' and a reason if none) */
export function pocketSel(s: Structure, dist = 5): { sel: string; msg: string } {
  let lig = null as null | (typeof s.residues)[number]; for (const r of s.residues) if (r.het && !WATER.has(r.resn) && (!lig || r.atomEnd - r.atomStart > lig.atomEnd - lig.atomStart)) lig = r;
  if (!lig || lig.atomEnd - lig.atomStart < 2) return { sel: '', msg: 'no ligand here to find a pocket around: type the site residues instead (resi 57+102+195)' };
  const L: number[] = []; for (let i = lig.atomStart; i < lig.atomEnd; i++) if (s.element[i] !== 'H') L.push(i);
  const d2 = dist * dist; const byChain = new Map<string, number[]>();
  for (const r of s.residues) { if (r.het) continue; let hit = false;
    for (let i = r.atomStart; i < r.atomEnd && !hit; i++) for (const j of L) { const dx = s.x[i] - s.x[j], dy = s.y[i] - s.y[j], dz = s.z[i] - s.z[j]; if (dx * dx + dy * dy + dz * dz < d2) { hit = true; break } }
    if (hit) { if (!byChain.has(r.chain)) byChain.set(r.chain, []); byChain.get(r.chain)!.push(r.resi) } }
  const parts = [...byChain].map(([c, rs]) => byChain.size > 1 && c ? `(chain ${c} and resi ${rs.join('+')})` : `resi ${rs.join('+')}`);
  parts.push(`(resn ${lig.resn} and resi ${lig.resi}${lig.chain && byChain.size > 1 ? ' and chain ' + lig.chain : ''})`);
  return { sel: parts.join(' or '), msg: `the pocket: ${[...byChain.values()].reduce((n, r) => n + r.length, 0)} residues within ${dist} Å of ${lig.resn}${lig.resi}` };
}

/** the site's atoms and the protein's trace, in the engine's frame (before yaw and pitch) */
function siteAtoms(h: SiteHost) {
  const E = h.engine(); const { st } = E.projectFrame(h.W, h.H, h.frame); const sel = E.compileSel(h.siteSel || '');
  return { E, site: st.atoms.filter((a: any) => h.siteSel.trim() && sel(a) && a.el !== 'H'), trace: st.atoms.filter((a: any) => a.name === 'CA' || a.trace) };
}

/** turn the molecule so the site faces the viewer with as little of the protein in front of it as possible, then close
    in: the site about a third of the frame, in the middle. Changes h.camera; returns a message, or null if no site. */
export function frameSite(h: SiteHost): { ok: boolean; msg: string } {
  if (!h.siteSel.trim()) return { ok: false, msg: 'choose the site first' };
  const { site, trace } = siteAtoms(h); if (!site.length) return { ok: false, msg: 'the site selection matches no atoms' };
  const c = [0, 0, 0]; for (const a of trace) for (let k = 0; k < 3; k++) c[k] += a.pos[k] / trace.length;
  const sc = [0, 0, 0]; for (const a of site) for (let k = 0; k < 3; k++) sc[k] += a.pos[k] / site.length;
  let rs = 0; for (const a of site) rs = Math.max(rs, Math.hypot(a.pos[0] - sc[0], a.pos[1] - sc[1], a.pos[2] - sc[2]));
  const step = Math.max(1, Math.floor(trace.length / 800)); const pts = trace.filter((_: any, i: number) => i % step === 0).map((a: any) => [a.pos[0] - c[0], a.pos[1] - c[1], a.pos[2] - c[2]]);
  const v = [sc[0] - c[0], sc[1] - c[1], sc[2] - c[2]];
  const rot = (p: number[], yaw: number, pitch: number) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);   // Ry then Rx, as the camera
    const x = cy * p[0] + sy * p[2], z1 = -sy * p[0] + cy * p[2]; return [x, cp * p[1] - sp * z1, sp * p[1] + cp * z1] };
  let best = { yaw: h.camera.yaw, pitch: h.camera.pitch, score: Infinity };
  for (let yd = -180; yd < 180; yd += 6) for (let pd = -72; pd <= 72; pd += 6) {
    const yaw = yd * Math.PI / 180, pitch = pd * Math.PI / 180; const s2 = rot(v, yaw, pitch); let occ = 0;
    for (const p of pts) { const q = rot(p, yaw, pitch); if (q[2] > s2[2] + 1.5 && Math.hypot(q[0] - s2[0], q[1] - s2[1]) < rs + 4) occ++ }
    const score = occ - 0.08 * s2[2] + 0.002 * Math.abs(pd);   // unhidden first, then the site toward the viewer, then level
    if (score < best.score) best = { yaw: yd, pitch: pd, score } }
  const cam = h.camera; cam.yaw = best.yaw; cam.pitch = best.pitch; cam.roll = 0; cam.panX = 0; cam.panY = 0; cam.zoom = 1;
  const W = h.W, H = h.H; const box = () => { const { proj } = h.engine().projectFrame(W, H, h.frame);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const a of site) { const p = proj.proj(a.pos); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) } return { x0, x1, y0, y1 } };
  let bx = box(); const span = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0, 1); cam.zoom = Math.max(1, Math.min(3.2, 0.33 * Math.min(W, H) / span));
  for (let it = 0; it < 3; it++) { bx = box(); const ex = ((bx.x0 + bx.x1) / 2 - W / 2) / W, ey = ((bx.y0 + bx.y1) / 2 - H / 2) / H; if (Math.abs(ex) + Math.abs(ey) < 0.003) break; cam.panX -= ex; cam.panY -= ey }
  return { ok: true, msg: `site turned to the viewer (yaw ${best.yaw}°, pitch ${best.pitch}°) and framed: zoom out to see more of the protein` };
}

/** labels for the site's residues, at each side chain's tip, pushed out from the site's middle; a big site (a pocket) gets
    the ligand and the seven residues nearest it. Adds to `labels` (skipping atoms already labelled); returns how many. */
export function labelSite(h: SiteHost, labels: FigLabel[]): { added: number; msg: string } {
  if (!h.siteSel.trim()) return { added: 0, msg: 'choose the site first' };
  const { E, site } = siteAtoms(h); if (!site.length) return { added: 0, msg: 'the site selection matches no atoms' };
  const { proj } = E.projectFrame(h.W, h.H, h.frame);
  const groups = new Map<string, any[]>(); for (const a of site) { const k = `${a.resn}|${a.resi}|${a.chain || ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(a) }
  let cx = 0, cy = 0; const P = site.map((a: any) => proj.proj(a.pos)); for (const p of P) { cx += p.x / P.length; cy += p.y / P.length }
  const lig = site.filter((a: any) => a.het); const ref = lig.length ? lig : site;
  const near = (g: any[]) => Math.min(...g.map(a => Math.min(...ref.map((b: any) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])))));
  const all = [...groups.values()]; const MAX = 8;
  const pick = all.length <= MAX ? all : [...all.filter(g => g[0].het), ...all.filter(g => !g[0].het).sort((x, y) => near(x) - near(y)).slice(0, MAX - 1)];
  let n = 0;
  for (const g of pick) {
    const ca = g.find(a => a.name === 'CA') || g[0]; const tip = g.reduce((b, a) => Math.hypot(a.pos[0] - ca.pos[0], a.pos[1] - ca.pos[1], a.pos[2] - ca.pos[2]) > Math.hypot(b.pos[0] - ca.pos[0], b.pos[1] - ca.pos[1], b.pos[2] - ca.pos[2]) ? a : b, ca);
    if (labels.some(l => l.at === tip.id)) continue;
    const p = proj.proj(tip.pos); let dx = p.x - cx, dy = p.y - cy; const L = Math.hypot(dx, dy); if (L < 1) { dx = 0; dy = -1 } else { dx /= L; dy /= L }
    const text = ca.het ? ca.resn : `${ca.resn[0]}${ca.resn.slice(1).toLowerCase()}${ca.resi}`;
    labels.push({ text, at: tip.id, dx: Math.round(dx * 48), dy: Math.round(dy * 40) }); n++ }
  return { added: n, msg: n ? `${n} label${n > 1 ? 's' : ''} on the site${pick.length < all.length ? ` (the ${pick.length} residues nearest the ligand of ${all.length})` : ''}: drag any of them to tidy up` : 'the site is already labelled' };
}
