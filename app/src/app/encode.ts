/* Rendering a loop in the browser: the classic engine draws every frame onto an offscreen canvas at the output size,
   WebCodecs encodes it (AV1, VP9 or H.264, whichever the browser has), and a muxer writes the file (MP4 for AV1 and
   H.264, WebM for VP9 — the same three the site serves). Chrome, Edge and recent Safari have VideoEncoder; Firefox
   has it behind a flag in some versions. The CLI (`cli/render.mjs` + ffmpeg) remains the way to make all three at
   once with the tuned encoders; this is for seeing the real thing quickly, and for a machine without node. */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

export type CodecName = 'av1' | 'vp9' | 'h264';
export type Quality = 'small' | 'medium' | 'high';
export interface RenderJob {
  width: number; height: number; fps: number; codec: CodecName; quality: Quality; frames: number[];
  draw: (ctx: CanvasRenderingContext2D, W: number, H: number, frame: number) => void;
  onProgress?: (done: number, total: number, bytes: number) => void;
  cancelled?: () => boolean;
}
export interface RenderResult { blob: Blob; ext: string; codec: CodecName; codecString: string; bytes: number; frames: number; seconds: number }

const CODECS: Record<CodecName, string[]> = {
  av1: ['av01.0.08M.08', 'av01.0.05M.08', 'av01.0.04M.08', 'av01.0.01M.08'],
  vp9: ['vp09.00.40.08', 'vp09.00.31.08', 'vp09.00.10.08'],
  h264: ['avc1.640028', 'avc1.64002A', 'avc1.4d0028', 'avc1.42002A', 'avc1.42001f'],
};
/** Quantizer per quality, per codec (AV1 and VP9 0–63, H.264 0–51): chosen to land near the site's ffmpeg encodes
    (AV1 crf 40, VP9 crf 38, H.264 crf 24) for "medium". */
const QP: Record<Quality, Record<CodecName, number>> = {
  small: { av1: 48, vp9: 46, h264: 32 }, medium: { av1: 40, vp9: 38, h264: 26 }, high: { av1: 32, vp9: 30, h264: 21 },
};
/** Bitrate (bit/s) per quality when the encoder cannot take a quantizer: bits per pixel per second, scaled by the frame area. */
const BPP: Record<Quality, number> = { small: 0.025, medium: 0.045, high: 0.08 };

export function hasWebCodecs(): boolean { return typeof (window as any).VideoEncoder === 'function' && typeof (window as any).VideoFrame === 'function' }

/** Which codecs this browser can encode at this size, and whether a quantizer can be set. */
export async function codecSupport(width: number, height: number): Promise<Record<CodecName, { codec: string; quantizer: boolean } | null>> {
  const out: any = { av1: null, vp9: null, h264: null }; if (!hasWebCodecs()) return out;
  for (const name of Object.keys(CODECS) as CodecName[]) {
    for (const codec of CODECS[name]) {
      try {
        const q = await VideoEncoder.isConfigSupported({ codec, width, height, bitrateMode: 'quantizer' as any, latencyMode: 'quality' } as any);
        if (q.supported) { out[name] = { codec, quantizer: true }; break }
        const b = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 2_000_000, latencyMode: 'quality' });
        if (b.supported) { out[name] = { codec, quantizer: false }; break }
      } catch { }
    }
  }
  return out;
}

export async function renderVideo(job: RenderJob): Promise<RenderResult> {
  if (!hasWebCodecs()) throw new Error('this browser has no VideoEncoder (WebCodecs): use Chrome or Edge, or the CLI');
  const support = await codecSupport(job.width, job.height); const sup = support[job.codec];
  if (!sup) throw new Error(`this browser cannot encode ${job.codec.toUpperCase()} at ${job.width}×${job.height}`);
  const W = job.width, H = job.height; const fps = job.fps;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const mp4 = job.codec !== 'vp9';
  const mp4Muxer = mp4 ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: job.codec === 'av1' ? 'av1' : 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' }) : null;
  const webmMuxer = mp4 ? null : new WebmMuxer({ target: new WebmTarget(), video: { codec: 'V_VP9', width: W, height: H, frameRate: fps }, firstTimestampBehavior: 'offset' });
  let bytes = 0; let err: any = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { bytes += chunk.byteLength; if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta); else webmMuxer!.addVideoChunk(chunk, meta) },
    error: e => { err = e },
  });
  const config: any = { codec: sup.codec, width: W, height: H, latencyMode: 'quality', framerate: fps };
  if (sup.quantizer) config.bitrateMode = 'quantizer'; else { config.bitrate = Math.round(BPP[job.quality] * W * H * fps); config.bitrateMode = 'variable' }
  if (job.codec === 'h264') config.avc = { format: 'avc' };
  encoder.configure(config);
  const qp = QP[job.quality][job.codec];
  const opts = (key: boolean): any => { const o: any = { keyFrame: key }; if (sup.quantizer) { if (job.codec === 'av1') o.av1 = { quantizer: qp }; else if (job.codec === 'vp9') o.vp9 = { quantizer: qp }; else o.avc = { quantizer: qp } } return o };
  const n = job.frames.length; const us = Math.round(1e6 / fps);
  for (let i = 0; i < n; i++) {
    if (err) throw err; if (job.cancelled?.()) { encoder.close(); throw new Error('cancelled') }
    job.draw(ctx, W, H, job.frames[i]);
    const vf = new VideoFrame(canvas, { timestamp: i * us, duration: us });
    encoder.encode(vf, opts(i % (fps * 10) === 0)); vf.close();
    while (encoder.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 5));   // keep the queue short: frames are big
    job.onProgress?.(i + 1, n, bytes);
    await new Promise(r => setTimeout(r, 0));   // let the page breathe
  }
  await encoder.flush(); encoder.close(); if (err) throw err;
  let buffer: ArrayBuffer;
  if (mp4Muxer) { mp4Muxer.finalize(); buffer = (mp4Muxer.target as Mp4Target).buffer } else { webmMuxer!.finalize(); buffer = (webmMuxer!.target as WebmTarget).buffer }
  const ext = mp4 ? (job.codec === 'av1' ? 'av1.mp4' : 'mp4') : 'webm';
  return { blob: new Blob([buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }), ext, codec: job.codec, codecString: sup.codec, bytes: buffer.byteLength, frames: n, seconds: n / fps };
}

export function fmtBytes(b: number): string { return b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' kB' : (b / 1048576).toFixed(2) + ' MB' }
