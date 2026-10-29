import styles from "./picker.css";
import { MAX_RADIUS, selectedPixels } from "../sampling.js";

const GRID_SIZE = 25;
const CELL_SIZE = 6;
const CANVAS_SIZE = 156;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class PickerView {
  constructor(image, viewport, shape, cancel) {
    this.shape = shape;
    this.viewport = viewport;
    this.previousFocus = document.activeElement;
    this.host = document.createElement("div");
    this.host.id = "pipette-picker";
    this.host.setAttribute("popover", "manual");
    this.host.setAttribute("role", "dialog");
    this.host.setAttribute("aria-label", "Pipette color picker");
    this.host.tabIndex = -1;
    // The captured screenshot can contain cross-origin frames. Keep its pixels
    // inside a closed shadow root rather than exposing a readable page canvas.
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = styles;
    shadow.append(style);
    this.surface = element("div", "surface");
    shadow.append(this.surface);

    this.snapshot = element("canvas", "snapshot");
    this.snapshot.width = image.naturalWidth;
    this.snapshot.height = image.naturalHeight;
    Object.assign(this.snapshot.style, {
      left: `${viewport.left}px`, top: `${viewport.top}px`,
      width: `${viewport.width}px`, height: `${viewport.height}px`,
    });
    const source = this.snapshot.getContext("2d", { willReadFrequently: true });
    source.drawImage(image, 0, 0);
    this.image = source.getImageData(0, 0, this.snapshot.width, this.snapshot.height);

    this.panel = element("div", "panel");
    const heading = element("div", "heading");
    this.closeButton = element("button", "close", "×");
    this.closeButton.type = "button";
    this.closeButton.setAttribute("aria-label", "Cancel color picker");
    this.closeButton.addEventListener("click", (event) => { event.stopPropagation(); cancel(); });
    heading.append(element("strong", "", "Pipette"));
    this.closeButton.style.left = `${viewport.left + viewport.width - 52}px`;
    this.closeButton.style.top = `${viewport.top + 12}px`;
    this.magnifier = element("canvas", "magnifier");
    this.magnifier.width = CANVAS_SIZE;
    this.magnifier.height = CANVAS_SIZE;
    this.magnifier.setAttribute("aria-hidden", "true");
    const value = element("div", "value");
    this.swatch = element("span", "swatch");
    this.hex = element("span", "hex");
    value.append(this.swatch, this.hex);
    const detail = element("p", "detail", "Release to copy · Hold to average");
    this.progress = element("div", "progress");
    this.progress.setAttribute("role", "progressbar");
    this.progress.setAttribute("aria-valuemin", "0");
    this.progressFill = element("span", "progress-fill");
    this.progressSegments = Array.from({ length: MAX_RADIUS }, () => element("span", "segment"));
    this.progress.append(this.progressFill, ...this.progressSegments);
    this.panel.append(heading, this.magnifier, value, detail, this.progress);
    this.status = element("div", "status");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;
    this.surface.append(this.snapshot, this.panel, this.status, this.closeButton);
    document.documentElement.append(this.host);
    this.host.showPopover();
    this.host.focus({ preventScroll: true });
  }

  render(point, center, radius, color, progress, pointerType) {
    const context = this.magnifier.getContext("2d");
    const middle = Math.floor(GRID_SIZE / 2);
    const padding = (CANVAS_SIZE - GRID_SIZE * CELL_SIZE) / 2;
    context.fillStyle = "#30343b";
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    context.imageSmoothingEnabled = false;
    // Drawing the entire source under a clip also handles screenshot edges.
    context.save();
    context.beginPath();
    context.rect(padding, padding, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE);
    context.clip();
    context.drawImage(this.snapshot,
      padding + (middle - center.x) * CELL_SIZE,
      padding + (middle - center.y) * CELL_SIZE,
      this.image.width * CELL_SIZE, this.image.height * CELL_SIZE);
    context.strokeStyle = "#00000018";
    context.lineWidth = 1;
    for (let index = 0; index <= GRID_SIZE; index++) {
      const position = padding + index * CELL_SIZE;
      context.beginPath();
      context.moveTo(position, padding);
      context.lineTo(position, CANVAS_SIZE - padding);
      context.moveTo(padding, position);
      context.lineTo(CANVAS_SIZE - padding, position);
      context.stroke();
    }
    const selected = [...selectedPixels(center.x, center.y, radius, this.image.width, this.image.height, this.shape)];
    const keys = new Set(selected.map(({ x, y }) => `${x},${y}`));
    context.fillStyle = "#38bdf82e";
    context.strokeStyle = "#f8fafc";
    context.lineWidth = 1.5;
    context.beginPath();
    for (const { x, y } of selected) {
      const left = padding + (x - center.x + middle) * CELL_SIZE;
      const top = padding + (y - center.y + middle) * CELL_SIZE;
      if (radius) context.fillRect(left, top, CELL_SIZE, CELL_SIZE);
      if (!keys.has(`${x},${y - 1}`)) { context.moveTo(left, top); context.lineTo(left + CELL_SIZE, top); }
      if (!keys.has(`${x + 1},${y}`)) { context.moveTo(left + CELL_SIZE, top); context.lineTo(left + CELL_SIZE, top + CELL_SIZE); }
      if (!keys.has(`${x},${y + 1}`)) { context.moveTo(left + CELL_SIZE, top + CELL_SIZE); context.lineTo(left, top + CELL_SIZE); }
      if (!keys.has(`${x - 1},${y}`)) { context.moveTo(left, top + CELL_SIZE); context.lineTo(left, top); }
    }
    context.stroke();
    context.restore();
    this.hex.textContent = color.hex;
    this.swatch.style.backgroundColor = color.hex;
    this.renderProgress(radius, progress);
    this.positionPanel(point, pointerType);
  }

  renderProgress(radius, progress) {
    const segmented = progress >= 1;
    this.progress.classList.toggle("segmented", segmented);
    this.progress.setAttribute("aria-label", segmented ? "Averaging step" : "Hold to average");
    this.progress.setAttribute("aria-valuemax", String(segmented ? MAX_RADIUS : 100));
    this.progress.setAttribute("aria-valuenow", String(segmented ? radius : Math.round(progress * 100)));
    this.progressFill.style.width = `${progress * 100}%`;
    this.progressSegments.forEach((segment, index) => segment.classList.toggle("filled", index < radius));
  }

  positionPanel(point, pointerType) {
    const { left, top, width, height } = this.viewport;
    const panelWidth = this.panel.offsetWidth;
    const panelHeight = this.panel.offsetHeight;
    const gap = pointerType === "touch" ? 60 : 24;
    let x = point.x + gap;
    let y = point.y + gap;
    if (x + panelWidth > left + width - 12) x = point.x - panelWidth - gap;
    if (pointerType === "touch" || y + panelHeight > top + height - 12) y = point.y - panelHeight - gap;
    this.panel.style.left = `${Math.max(left + 8, Math.min(x, left + width - panelWidth - 8))}px`;
    this.panel.style.top = `${Math.max(top + 8, Math.min(y, top + height - panelHeight - 8))}px`;
  }

  showStatus(text, completed = false) {
    this.status.textContent = text;
    this.status.hidden = false;
    // Position relative to the visual viewport on zoomed mobile pages.
    this.status.style.left = `${this.viewport.left + this.viewport.width / 2}px`;
    this.status.style.top = `${this.viewport.top + this.viewport.height - 72}px`;
    this.status.style.bottom = "auto";
    this.panel.hidden = completed;
    this.snapshot.hidden = completed;
    this.closeButton.hidden = completed;
    if (completed) {
      this.host.setAttribute("data-completed", "");
    }
  }

  destroy() {
    this.host.remove();
    // Do not move focus away from an element the user focused after picking.
    if (document.activeElement === document.body && this.previousFocus?.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.snapshot.width = this.snapshot.height = 0;
    this.image = null;
  }
}
