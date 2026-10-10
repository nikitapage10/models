// A scrolling multi-line graph for the timeline: a few seconds of each channel, newest on the right.

export const COLORS = ["#8fd3ff", "#ffb36b", "#9fe3c9", "#ff7aa8", "#c9b6ff", "#f2e27a", "#ff9a6b", "#7ad0ff"];

export class Graph {
  constructor(seconds = 6) {
    this.seconds = seconds;
    this.samples = []; // { t, values: number[] }
    this.markers = []; // { t, label }
  }
  push(t, values) {
    this.samples.push({ t, values });
    const cutoff = t - this.seconds - 0.5;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
    while (this.markers.length && this.markers[0].t < cutoff) this.markers.shift();
  }
  mark(t, label) {
    this.markers.push({ t, label });
  }
  clear() {
    this.samples = [];
    this.markers = [];
  }
  /** Draw channels in their own bands (`bands` true) or overlaid, between `lo` and `hi`. */
  draw(ctx, w, h, dpr, { lo = 0, hi = 1, bands = false, labels = [] } = {}) {
    const now = this.samples.at(-1)?.t ?? 0;
    const x = (t) => w - ((now - t) / this.seconds) * w;
    const pad = 22 * dpr;
    ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
    // Seconds grid.
    ctx.strokeStyle = "#232833";
    ctx.fillStyle = "#5d6470";
    for (let s = Math.ceil(now - this.seconds); s <= now; s++) {
      const gx = x(s);
      ctx.beginPath();
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, h);
      ctx.stroke();
      ctx.fillText(`${s}s`, gx + 3 * dpr, h - 4 * dpr);
    }
    const n = this.samples[0]?.values.length ?? 0;
    const bandH = bands ? (h - pad) / Math.max(1, n) : h - pad;
    for (let c = 0; c < n; c++) {
      const top = bands ? pad + c * bandH : pad;
      const y = (v) => top + bandH - ((v - lo) / (hi - lo || 1)) * (bandH - 4 * dpr) - 2 * dpr;
      ctx.strokeStyle = COLORS[c % COLORS.length];
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      this.samples.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.values[c])) : ctx.moveTo(x(s.t), y(s.values[c]))));
      ctx.stroke();
      if (bands && labels[c]) {
        ctx.fillStyle = COLORS[c % COLORS.length];
        ctx.fillText(labels[c], 6 * dpr, top + 11 * dpr);
      }
    }
    // Event markers (mode changes).
    ctx.fillStyle = "#c9a25c";
    ctx.strokeStyle = "#c9a25c55";
    for (const m of this.markers) {
      const mx = x(m.t);
      ctx.beginPath();
      ctx.moveTo(mx, pad);
      ctx.lineTo(mx, h);
      ctx.stroke();
      ctx.fillText(m.label, mx + 3 * dpr, pad - 6 * dpr);
    }
  }
}
