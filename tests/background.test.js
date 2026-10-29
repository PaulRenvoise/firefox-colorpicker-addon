import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DEFAULT_SETTINGS } from "../src/settings.js";

const source = (await readFile(new URL("../src/background.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");

function background({ clipboardFails = false, iconFails = false, settings = DEFAULT_SETTINGS } = {}) {
  const calls = [];
  let receive;
  let activate;
  const browser = {
    runtime: {
      id: "test", getURL: (path) => path,
      onMessage: { addListener: (listener) => { receive = listener; } },
      openOptionsPage: async () => { calls.push(["options"]); },
    },
    action: {
      onClicked: { addListener: (listener) => { activate = listener; } },
      setIcon: async (details) => {
        calls.push(["icon", details.path]);
        if (iconFails && details.path.includes("copied")) throw new Error("Unavailable");
      },
      setTitle: async (details) => { calls.push(["title", details.title]); },
    },
    notifications: { create: async (details) => { calls.push(["notification", details.message]); } },
    scripting: { executeScript: async () => { calls.push(["inject"]); } },
    tabs: {
      sendMessage: async (tabId, message) => {
        calls.push([message.type, message]);
        return message.type === "pipette:prepare" ? {
          viewport: { left: 5, top: 8, width: 400, height: 600, scrollX: 10, scrollY: 200 },
        } : { ok: true };
      },
      captureVisibleTab: async (windowId, options) => { calls.push(["capture", options]); return "screenshot"; },
      get: async () => ({ active: true, url: "https://example.test" }),
    },
  };
  runInNewContext(source, {
    browser,
    loadSettings: async () => { calls.push(["settings"]); return settings; },
    crypto: { randomUUID: () => "session" },
    navigator: { clipboard: { writeText: async (hex) => {
      calls.push(["clipboard", hex]);
      if (clipboardFails) throw new Error("Denied");
    } } },
    console: { warn() {} },
  });
  const sender = { id: "test", tab: { id: 1 }, frameId: 0 };
  return {
    calls, copy: (hex = "#123456", from = sender) => receive({ type: "pipette:copy", hex }, from), activate,
    openSettings: () => receive({ type: "pipette:settings" }, sender),
  };
}

test("clipboard succeeds before showing a check on the icon", async () => {
  const app = background();
  assert.equal((await app.copy()).ok, true);
  assert.deepEqual(app.calls, [
    ["clipboard", "#123456"], ["icon", "icons/pipette-copied.svg"], ["title", "Copied #123456 — Pick another color"],
  ]);
});

test("a clipboard failure reports failure and never displays success feedback", async () => {
  const app = background({ clipboardFails: true });
  assert.equal((await app.copy()).ok, false);
  assert.deepEqual(app.calls, [["clipboard", "#123456"]]);
});

test("a notification confirms copying when icon feedback is unavailable", async () => {
  const app = background({ iconFails: true });
  assert.equal((await app.copy()).ok, true);
  assert.deepEqual(app.calls.at(-1), ["notification", "#123456 copied to clipboard."]);
});

test("ignores malformed colors and messages outside the extension's top frame", () => {
  const app = background();
  assert.equal(app.copy("invalid"), undefined);
  assert.equal(app.copy("#123456", { id: "other", tab: { id: 1 }, frameId: 0 }), undefined);
  assert.equal(app.copy("#123456", { id: "test", tab: { id: 1 }, frameId: 2 }), undefined);
  assert.equal(app.copy("#123456", { id: "test" }), undefined);
  assert.deepEqual(app.calls, []);
});

test("captures before mounting the overlay and ignores overlapping activation", async () => {
  const app = background({ settings: { initialHoldMs: 200, growthHoldMs: 100, shape: "circle" } });
  const tab = { id: 1, windowId: 1, url: "https://example.test" };
  await Promise.all([app.activate(tab), app.activate(tab)]);
  assert.deepEqual(app.calls.map(([type]) => type), [
    "icon", "title", "inject", "pipette:prepare", "settings", "capture", "pipette:start",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.find(([type]) => type === "capture")[1])), {
    format: "png", rect: { x: 15, y: 208, width: 400, height: 600 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.find(([type]) => type === "pipette:start")[1].settings)), {
    initialHoldMs: 200, growthHoldMs: 100, shape: "circle",
  });
});

test("the picker can open the extension's settings page", async () => {
  const app = background();
  assert.equal((await app.openSettings()).ok, true);
  assert.deepEqual(app.calls, [["options"]]);
});
