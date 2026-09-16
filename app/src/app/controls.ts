/* Mouse / touch orbit: drag = rotate, shift-drag or right-drag = pan, wheel = zoom. */
import { Camera } from '../render/camera';

export class OrbitControls {
  private down: { x: number; y: number; yaw: number; pitch: number; panX: number; panY: number; pan: boolean } | null = null;
  constructor(private el: HTMLElement, private cam: Camera, private onChange: () => void) {
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); this.down = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, panX: cam.panX, panY: cam.panY, pan: e.button === 2 || e.shiftKey } });
    el.addEventListener('pointermove', e => {
      if (!this.down) return; const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y; const r = el.getBoundingClientRect();
      if (this.down.pan) { cam.panX = this.down.panX + dx / r.width; cam.panY = this.down.panY - dy / r.height }
      else { cam.yaw = this.down.yaw + dx * 0.4; cam.pitch = Math.max(-90, Math.min(90, this.down.pitch + dy * 0.4)) }
      onChange();
    });
    const up = () => { this.down = null };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.2, Math.min(20, cam.zoom * Math.exp(-e.deltaY * 0.0015))); onChange() }, { passive: false });
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') cam.yaw -= 5; else if (e.key === 'ArrowRight') cam.yaw += 5; else if (e.key === 'ArrowUp') cam.pitch -= 5; else if (e.key === 'ArrowDown') cam.pitch += 5;
      else if (e.key === 'r') { cam.yaw = 0; cam.pitch = 0; cam.zoom = 1; cam.panX = 0; cam.panY = 0 } else return;
      onChange();
    });
  }
}
