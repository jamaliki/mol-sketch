/* Mouse / touch orbit: drag = rotate, shift-drag or right-drag = pan, wheel = zoom. `onStart` fires before the first
   change of a gesture (for the undo history), `onEnd` when it ends. */
import { Camera } from '../render/camera';

export class OrbitControls {
  private down: { x: number; y: number; yaw: number; pitch: number; panX: number; panY: number; pan: boolean; moved: boolean } | null = null;
  /** true while a gesture that moves the camera is in progress */
  get dragging() { return !!this.down && this.down.moved }
  constructor(private el: HTMLElement, private cam: Camera, private onChange: () => void, private onStart: (what: string) => void = () => { }, private onEnd: () => void = () => { }) {
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); this.down = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, panX: cam.panX, panY: cam.panY, pan: e.button === 2 || e.shiftKey, moved: false } });
    el.addEventListener('pointermove', e => {
      if (!this.down) return; const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y; const r = el.getBoundingClientRect();
      if (!this.down.moved) { if (Math.hypot(dx, dy) < 3) return; this.down.moved = true; onStart(this.down.pan ? 'pan' : 'turn') }
      if (this.down.pan) { cam.panX = this.down.panX + dx / r.width; cam.panY = this.down.panY - dy / r.height }
      else { cam.yaw = this.down.yaw + dx * 0.4; cam.pitch = Math.max(-90, Math.min(90, this.down.pitch + dy * 0.4)) }
      onChange();
    });
    const up = () => { if (this.down?.moved) onEnd(); this.down = null };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { e.preventDefault(); onStart('zoom'); cam.zoom = Math.max(0.2, Math.min(20, cam.zoom * Math.exp(-e.deltaY * 0.0015))); onChange() }, { passive: false });
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowLeft') { onStart('turn'); cam.yaw -= 5 } else if (e.key === 'ArrowRight') { onStart('turn'); cam.yaw += 5 } else if (e.key === 'ArrowUp') { onStart('turn'); cam.pitch -= 5 } else if (e.key === 'ArrowDown') { onStart('turn'); cam.pitch += 5 }
      else if (e.key === 'r') { onStart('reset view'); cam.yaw = 0; cam.pitch = 0; cam.roll = 0; cam.zoom = 1; cam.panX = 0; cam.panY = 0 } else return;
      onChange();
    });
  }
}
