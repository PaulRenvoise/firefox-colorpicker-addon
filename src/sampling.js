export const HOLD_DELAY_MS = 1000;
export const GROWTH_INTERVAL_MS = 500;
export const MAX_RADIUS = 10;

export function radiusForHold(elapsedMs) {
  if (elapsedMs <= HOLD_DELAY_MS) return 0;
  return Math.min(MAX_RADIUS, Math.ceil((elapsedMs - HOLD_DELAY_MS) / GROWTH_INTERVAL_MS));
}

// Each iteration includes pixels one orthogonal step farther from the center.
// A diagonal therefore costs two steps: |dx| + |dy| <= radius.
export function* selectedPixels(x, y, radius, width, height) {
  const limit = Math.max(0, Math.min(MAX_RADIUS, Math.floor(radius)));
  for (let dy = -limit; dy <= limit; dy++) {
    const py = y + dy;
    if (py < 0 || py >= height) continue;
    const span = limit - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const px = x + dx;
      if (px >= 0 && px < width) yield { x: px, y: py };
    }
  }
}

export function averageColor(image, x, y, radius) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (const pixel of selectedPixels(x, y, radius, image.width, image.height)) {
    const index = (pixel.y * image.width + pixel.x) * 4;
    red += image.data[index];
    green += image.data[index + 1];
    blue += image.data[index + 2];
    count++;
  }
  if (!count) throw new RangeError("The sample must intersect the captured image.");
  const rgb = [red, green, blue].map((channel) => Math.round(channel / count));
  return { hex: `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`, count };
}

export function imagePoint(point, viewport, image) {
  // Firefox reports fractional visual-viewport dimensions as floats. At 150%
  // zoom, an exact pixel boundary can otherwise become 299.99999 instead of 300.
  const epsilon = 0.0001;
  return {
    x: Math.max(0, Math.min(image.width - 1, Math.floor((point.x - viewport.left) * image.width / viewport.width + epsilon))),
    y: Math.max(0, Math.min(image.height - 1, Math.floor((point.y - viewport.top) * image.height / viewport.height + epsilon))),
  };
}
