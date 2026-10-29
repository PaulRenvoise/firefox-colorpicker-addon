import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.js";

test("new installs use 1500 ms, 750 ms, and a rectangle", () => {
  assert.deepEqual(normalizeSettings(), { initialHoldMs: 1500, growthHoldMs: 750, shape: "rectangle" });
});

test("valid saved choices are preserved, including zero initial delay", () => {
  for (const shape of ["rectangle", "circle", "rhombus"]) {
    const settings = { initialHoldMs: 0, growthHoldMs: 1, shape };
    assert.deepEqual(normalizeSettings(settings), settings);
  }
  assert.deepEqual(normalizeSettings({ initialHoldMs: 60_000, growthHoldMs: 60_000, shape: "circle" }), {
    initialHoldMs: 60_000, growthHoldMs: 60_000, shape: "circle",
  });
});

test("invalid stored times and shapes fall back to defaults without losing valid fields", () => {
  for (const value of [null, "100", NaN, Infinity, -1, 1.5, 60_001]) {
    assert.equal(normalizeSettings({ initialHoldMs: value }).initialHoldMs, 1500);
    assert.equal(normalizeSettings({ growthHoldMs: value }).growthHoldMs, 750);
  }
  assert.deepEqual(normalizeSettings({ initialHoldMs: 200, growthHoldMs: 0, shape: "triangle", extra: true }), {
    initialHoldMs: 200, growthHoldMs: 750, shape: "rectangle",
  });
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("invalid"), DEFAULT_SETTINGS);
});
