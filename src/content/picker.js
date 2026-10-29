import { averageColor, HOLD_DELAY_MS, imagePoint, radiusForHold } from "../sampling.js";
import { PickerView } from "./view.js";
import { readViewport, sameViewport } from "./viewport.js";

export class Picker {
  constructor(image, viewport, onClose) {
    this.viewport = viewport;
    this.onClose = onClose;
    this.events = new AbortController();
    this.pointerId = null;
    this.pointerType = "mouse";
    this.point = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
    this.startedAt = null;
    this.busy = false;
    this.closed = false;
    this.completed = false;
    this.view = new PickerView(image, viewport, () => this.destroy());

    this.listen(this.view.surface, "pointerdown", (event) => this.pointerDown(event));
    this.listen(this.view.surface, "pointermove", (event) => this.pointerMove(event));
    this.listen(this.view.surface, "pointerup", (event) => this.pointerUp(event));
    this.listen(this.view.surface, "pointercancel", () => this.cancelHold());
    this.listen(this.view.surface, "lostpointercapture", () => this.cancelHold());
    // Suppress native long-press menus, text selection, drag, and page clicks.
    for (const type of ["contextmenu", "dragstart", "selectstart", "click", "auxclick", "wheel", "touchmove"]) {
      this.listen(this.view.surface, type, (event) => {
        if (event.composedPath().includes(this.view.closeButton)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { passive: false });
    }
    this.listen(window, "keydown", (event) => this.keyDown(event), { capture: true });
    this.listen(window, "keyup", (event) => {
      if (event.code === "Space" && this.pointerId === -1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.pointerUp({
          pointerId: -1, clientX: this.point.x, clientY: this.point.y,
          pointerType: "keyboard", preventDefault() {}, stopImmediatePropagation() {},
        });
      }
    }, { capture: true });
    this.listen(window, "blur", () => this.cancelHold());
    this.listen(document, "visibilitychange", () => { if (document.hidden) this.destroy(); });
    const checkViewport = () => { if (!sameViewport(viewport, readViewport())) this.destroy(); };
    this.listen(window, "resize", checkViewport);
    this.listen(window, "scroll", checkViewport);
    if (window.visualViewport) {
      this.listen(window.visualViewport, "resize", checkViewport);
      this.listen(window.visualViewport, "scroll", checkViewport);
    }
    this.render();
  }

  listen(target, type, listener, options = {}) {
    target.addEventListener(type, listener, { ...options, signal: this.events.signal });
  }

  updatePoint(event) {
    this.point = { x: event.clientX, y: event.clientY };
    this.pointerType = event.pointerType;
  }

  pointerDown(event) {
    if (event.composedPath().includes(this.view.closeButton)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.busy || this.completed) return;
    if (!event.isPrimary) { this.cancelHold(); return; }
    if (event.button !== 0 || this.pointerId !== null) return;
    this.updatePoint(event);
    this.pointerId = event.pointerId;
    this.startedAt = performance.now();
    this.view.surface.setPointerCapture(event.pointerId);
    this.animate();
  }

  pointerMove(event) {
    if (this.busy || this.completed || !event.isPrimary) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    this.updatePoint(event);
    if (this.pointerId === null) this.render();
  }

  async pointerUp(event) {
    if (event.pointerId !== this.pointerId || this.busy || this.completed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.updatePoint(event);
    // Recompute at release instead of relying on the most recent animation frame.
    const { color } = this.sample(performance.now());
    this.cancelHold(false);
    this.busy = true;
    try {
      const result = await browser.runtime.sendMessage({ type: "pipette:copy", hex: color.hex });
      if (this.closed) return;
      if (!result?.ok) throw new Error(result?.error || "Could not copy. Try picking again.");
      this.completed = true;
      this.events.abort();
      this.view.showStatus(`✓ ${color.hex} copied`, true);
      this.closeTimer = setTimeout(() => this.destroy(), 1400);
    } catch (error) {
      if (!this.closed) this.view.showStatus(error.message);
    } finally {
      this.busy = false;
    }
  }

  sample(now) {
    const elapsed = this.startedAt === null ? 0 : now - this.startedAt;
    const radius = radiusForHold(elapsed);
    const center = imagePoint(this.point, this.viewport, this.view.image);
    const color = averageColor(this.view.image, center.x, center.y, radius);
    return { radius, center, color, progress: Math.min(1, elapsed / HOLD_DELAY_MS) };
  }

  render(now = performance.now()) {
    const { radius, center, color, progress } = this.sample(now);
    this.view.render(this.point, center, radius, color, progress, this.pointerType);
  }

  animate() {
    this.render();
    this.animation = requestAnimationFrame(() => {
      if (this.pointerId !== null && !this.closed) this.animate();
    });
  }

  cancelHold(redraw = true) {
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.startedAt = null;
    cancelAnimationFrame(this.animation);
    if (pointerId !== null && this.view.surface.hasPointerCapture(pointerId)) {
      this.view.surface.releasePointerCapture(pointerId);
    }
    if (redraw && pointerId !== null && !this.closed) this.render();
  }

  keyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.destroy();
      return;
    }
    if (this.view.surface.getRootNode().activeElement === this.view.closeButton) return;
    const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (movement && !this.busy && !this.completed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.point.x += movement[0] * this.viewport.width / this.view.image.width;
      this.point.y += movement[1] * this.viewport.height / this.view.image.height;
      this.point.x = Math.max(this.viewport.left, Math.min(this.point.x, this.viewport.left + this.viewport.width - 0.001));
      this.point.y = Math.max(this.viewport.top, Math.min(this.point.y, this.viewport.top + this.viewport.height - 0.001));
      this.render();
    }
    // Space supports the same hold/release gesture for keyboard users.
    if (event.code === "Space" && !this.busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || this.pointerId !== null) return;
      this.pointerId = -1;
      this.startedAt = performance.now();
      this.animate();
    }
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.closeTimer);
    this.cancelHold();
    this.events.abort();
    this.view.destroy();
    this.onClose();
  }
}
