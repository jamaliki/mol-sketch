/* Undo / redo: a stack of snapshots taken *before* each change. A snapshot holds the style, the camera and the colour
   overrides, and, when the change touches the scene (keyframe edits: arrows, lone pairs, charges, timing, order, cameras),
   the scene's keyframes too. Continuous edits (a slider being dragged, a view being turned) coalesce: a new snapshot with
   the same label within `coalesceMs` of the last one is skipped, so one Ctrl-Z undoes the whole drag. */
export interface Snapshot { label: string; at: number; style: string; cam: number[]; overrides: string; labels?: string; keyframes: string | null; frame: number }

export class History {
  private undo: Snapshot[] = []; private redo: Snapshot[] = [];
  limit = 60; coalesceMs = 900;
  private last: { label: string; at: number } | null = null;
  constructor(private capture: (withScene: boolean) => Snapshot, private restore: (s: Snapshot) => void, private onChange: () => void = () => { }) { }
  /** Call before a change. `scene` when the change edits keyframes. */
  mark(label: string, scene = false) {
    const now = performance.now();
    if (this.last && this.last.label === label && now - this.last.at < this.coalesceMs && !scene) { this.last.at = now; return }
    this.undo.push(this.capture(scene)); this.undo[this.undo.length - 1].label = label; if (this.undo.length > this.limit) this.undo.shift();
    this.redo = []; this.last = { label, at: now }; this.onChange();
  }
  /** Ends a coalescing run explicitly (pointer up), so the next change of the same kind is its own step. */
  settle() { this.last = null }
  back(): string | null {
    const s = this.undo.pop(); if (!s) return null;
    const cur = this.capture(!!s.keyframes); cur.label = s.label; this.redo.push(cur);
    this.restore(s); this.last = null; this.onChange(); return s.label;
  }
  forward(): string | null {
    const s = this.redo.pop(); if (!s) return null;
    const cur = this.capture(!!s.keyframes); cur.label = s.label; this.undo.push(cur);
    this.restore(s); this.last = null; this.onChange(); return s.label;
  }
  get canUndo() { return this.undo.length > 0 } get canRedo() { return this.redo.length > 0 }
  get nextUndo() { return this.undo.length ? this.undo[this.undo.length - 1].label : '' }
  get nextRedo() { return this.redo.length ? this.redo[this.redo.length - 1].label : '' }
  clear() { this.undo = []; this.redo = []; this.last = null; this.onChange() }
}
