/** The classic engine (engine.js). Untyped beyond what the app touches. */
export interface ClassicView { yaw: number; pitch: number; roll: number; zoom: number; panX: number; panY: number }
export interface Projector { pxPerA: number; D: number; rot(p: number[]): number[]; proj(p: number[]): { x: number; y: number; z: number; d: number; fog: number }; dir2(v: number[]): number[] }
export interface SampledAtom { id: string; el: string; pos: number[]; alpha: number; charges: { text: string; alpha: number }[]; lps: { dir: number[]; alpha: number }[]; group?: string; resn?: string; resi?: number; name?: string; het?: boolean; sphere?: boolean; [k: string]: any }
export interface SampledState { atoms: SampledAtom[]; A: Record<string, SampledAtom>; bonds: { a: string; b: string; order: number; alpha: number; partial: number }[]; arrows: any[]; kf: number; t: number; isTrans: boolean; stepName: string; stepIdx: number }
export interface Classic {
  cfg: any; scene: any; TL: { total: number; segs: { kf: number; type: string; start: number; len: number }[] };
  renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, frame: number, dpr: number): SampledState;
  sampleState(frame: number): SampledState;
  locate(frame: number): { seg: { kf: number; type: string; start: number; len: number }; t: number };
  projectFrame(W: number, H: number, frame: number): { st: SampledState; proj: Projector; drawn: number };
  viewAt(frame: number): ClassicView | null;
  buildTimeline(): void; demoScene(): any; compileSel(s: string): (a: any) => boolean;
  DEFAULT_CFG: any; PRESETS: any; GROUP_PALETTE: string[]; SUBUNIT_COLS: string[];
  invalidatePaper(): void;
}
export function createClassic(): Classic;
