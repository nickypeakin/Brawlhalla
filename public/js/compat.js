// Fallbacks for older browsers (e.g. managed Chromebooks stuck on an old Chrome).
const C = typeof window !== 'undefined' && window.CanvasRenderingContext2D;
if (C && !C.prototype.roundRect) {
  C.prototype.roundRect = function (x, y, w, h, r) {
    const rr = typeof r === 'number' ? r : (r && r[0]) || 0;
    const k = Math.max(0, Math.min(rr, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + k, y);
    this.arcTo(x + w, y, x + w, y + h, k);
    this.arcTo(x + w, y + h, x, y + h, k);
    this.arcTo(x, y + h, x, y, k);
    this.arcTo(x, y, x + w, y, k);
    this.closePath();
  };
}
if (typeof structuredClone !== 'function') globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
