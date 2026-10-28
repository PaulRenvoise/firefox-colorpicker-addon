import assert from "node:assert/strict";
import test from "node:test";
import { averageColor, imagePoint, radiusForHold, selectedPixels } from "../src/sampling.js";

test("hold stays at one pixel for a second, then grows to ten iterations", () => {
  for (const elapsed of [0, 999, 1000]) assert.equal(radiusForHold(elapsed), 0);
  assert.equal(radiusForHold(1001), 1);
  assert.equal(radiusForHold(1150), 1);
  assert.equal(radiusForHold(1151), 2);
  assert.equal(radiusForHold(2351), 10);
  assert.equal(radiusForHold(60_000), 10);
});

test("first expansion includes only the center and four orthogonal neighbors", () => {
  assert.deepEqual([...selectedPixels(2, 2, 1, 5, 5)], [
    { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
  ]);
});

test("diagonals enter at distance two; every iteration uses Manhattan distance", () => {
  for (let radius = 0; radius <= 10; radius++) {
    const selected = [...selectedPixels(10, 10, radius, 21, 21)];
    assert.equal(selected.length, 1 + 2 * radius * (radius + 1));
    const keys = new Set(selected.map(({ x, y }) => `${x},${y}`));
    assert.equal(keys.size, selected.length);
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        assert.equal(keys.has(`${x},${y}`), Math.abs(x - 10) + Math.abs(y - 10) <= radius);
      }
    }
  }
});

test("averages only selected RGB pixels, with rounding and uppercase HEX", () => {
  const image = { width: 3, height: 3, data: new Uint8ClampedArray(36) };
  for (let i = 0; i < 9; i++) image.data.set([255, 0, 0, 255], i * 4);
  image.data.set([0, 0, 255, 255], 4 * 4);
  assert.deepEqual(averageColor(image, 1, 1, 0), { hex: "#0000FF", count: 1 });
  assert.deepEqual(averageColor(image, 1, 1, 1), { hex: "#CC0033", count: 5 });
  assert.deepEqual(averageColor(image, 1, 1, 2), { hex: "#E3001C", count: 9 });
});

test("screen edges clip the region without duplicating or inventing pixels", () => {
  assert.deepEqual([...selectedPixels(0, 0, 1, 3, 3)], [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  ]);
  const image = { width: 1, height: 1, data: new Uint8ClampedArray([18, 52, 86, 255]) };
  assert.deepEqual(averageColor(image, 0, 0, 10), { hex: "#123456", count: 1 });
});

test("maps CSS coordinates to screenshot pixels at fractional and high display scales", () => {
  const viewport = { left: 20, top: 40, width: 400, height: 300 };
  assert.deepEqual(imagePoint({ x: 120, y: 140 }, viewport, { width: 800, height: 600 }), { x: 200, y: 200 });
  assert.deepEqual(imagePoint({ x: 121, y: 141 }, viewport, { width: 500, height: 375 }), { x: 126, y: 126 });
  assert.deepEqual(imagePoint({ x: -100, y: 1000 }, viewport, { width: 800, height: 600 }), { x: 0, y: 599 });
  assert.deepEqual(imagePoint({ x: 200, y: 200 }, {
    left: 0, top: 0, width: 666.6666870117188, height: 476.6666564941406,
  }, { width: 1000, height: 715 }), { x: 300, y: 300 });
});
