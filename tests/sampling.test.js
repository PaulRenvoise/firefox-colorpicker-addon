import assert from "node:assert/strict";
import test from "node:test";
import { averageColor, imagePoint, radiusForHold, selectedPixels } from "../src/sampling.js";

test("hold waits 1.5 seconds, then adds a step every 750 ms up to ten iterations", () => {
  for (const elapsed of [0, 1499, 1500]) assert.equal(radiusForHold(elapsed), 0);
  assert.equal(radiusForHold(1501), 1);
  assert.equal(radiusForHold(2250), 1);
  assert.equal(radiusForHold(2251), 2);
  assert.equal(radiusForHold(8250), 9);
  assert.equal(radiusForHold(8251), 10);
  assert.equal(radiusForHold(60_000), 10);
});

test("first expansion includes only the center and four orthogonal neighbors", () => {
  assert.deepEqual([...selectedPixels(2, 2, 1, 5, 5, "rhombus")], [
    { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
  ]);
});

test("rectangle, circle, and rhombus select exactly their geometric regions", () => {
  const contains = {
    rectangle: (x, y, radius) => Math.max(Math.abs(x), Math.abs(y)) <= radius,
    circle: (x, y, radius) => x * x + y * y <= radius * radius,
    rhombus: (x, y, radius) => Math.abs(x) + Math.abs(y) <= radius,
  };
  for (const [shape, inside] of Object.entries(contains)) {
    for (let radius = 0; radius <= 10; radius++) {
      const selected = [...selectedPixels(10, 10, radius, 21, 21, shape)];
      const keys = new Set(selected.map(({ x, y }) => `${x},${y}`));
      assert.equal(keys.size, selected.length);
      for (let y = 0; y < 21; y++) {
        for (let x = 0; x < 21; x++) {
          assert.equal(keys.has(`${x},${y}`), inside(x - 10, y - 10, radius), `${shape} radius ${radius}: ${x},${y}`);
        }
      }
    }
  }
  assert.equal([...selectedPixels(10, 10, 10, 21, 21)].length, 441);
  assert.equal([...selectedPixels(10, 10, 10, 21, 21, "circle")].length, 317);
  assert.equal([...selectedPixels(10, 10, 10, 21, 21, "rhombus")].length, 221);
});

test("custom hold times control each step and zero delay still caps at ten", () => {
  const settings = { initialHoldMs: 200, growthHoldMs: 100 };
  assert.equal(radiusForHold(200, settings), 0);
  assert.equal(radiusForHold(201, settings), 1);
  assert.equal(radiusForHold(300, settings), 1);
  assert.equal(radiusForHold(301, settings), 2);
  assert.equal(radiusForHold(1101, settings), 10);
  assert.equal(radiusForHold(0, { initialHoldMs: 0, growthHoldMs: 1 }), 0);
  assert.equal(radiusForHold(100, { initialHoldMs: 0, growthHoldMs: 1 }), 10);
});

test("averages only selected RGB pixels, with rounding and uppercase HEX", () => {
  const image = { width: 3, height: 3, data: new Uint8ClampedArray(36) };
  for (let i = 0; i < 9; i++) image.data.set([255, 0, 0, 255], i * 4);
  image.data.set([0, 0, 255, 255], 4 * 4);
  assert.deepEqual(averageColor(image, 1, 1, 0), { hex: "#0000FF", count: 1 });
  assert.deepEqual(averageColor(image, 1, 1, 1), { hex: "#E3001C", count: 9 });
  assert.deepEqual(averageColor(image, 1, 1, 1, "circle"), { hex: "#CC0033", count: 5 });
  assert.deepEqual(averageColor(image, 1, 1, 1, "rhombus"), { hex: "#CC0033", count: 5 });
  assert.deepEqual(averageColor(image, 1, 1, 2), { hex: "#E3001C", count: 9 });
});

test("screen edges clip the region without duplicating or inventing pixels", () => {
  assert.deepEqual([...selectedPixels(0, 0, 1, 3, 3)], [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
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
