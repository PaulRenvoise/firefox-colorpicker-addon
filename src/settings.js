export const DEFAULT_SETTINGS = Object.freeze({
  initialHoldMs: 1500,
  growthHoldMs: 750,
  shape: "square",
});

export const SHAPES = Object.freeze(["square", "circle", "rhombus"]);
export const MAX_HOLD_MS = 60_000;

function validTime(value, minimum) {
  return Number.isInteger(value) && value >= minimum && value <= MAX_HOLD_MS;
}

export function normalizeSettings(value) {
  const shape = value?.shape === "rectangle" ? "square" : value?.shape;
  return {
    initialHoldMs: validTime(value?.initialHoldMs, 0) ? value.initialHoldMs : DEFAULT_SETTINGS.initialHoldMs,
    growthHoldMs: validTime(value?.growthHoldMs, 1) ? value.growthHoldMs : DEFAULT_SETTINGS.growthHoldMs,
    shape: SHAPES.includes(shape) ? shape : DEFAULT_SETTINGS.shape,
  };
}

export async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return normalizeSettings(settings);
}

export async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await browser.storage.local.set({ settings });
  return settings;
}
