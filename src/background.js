import { loadSettings } from "./settings.js";

const activatingTabs = new Set();

async function notify(message) {
  try {
    await browser.notifications.create({
      type: "basic",
      title: "Pipette",
      message,
      iconUrl: browser.runtime.getURL("icons/pipette.svg"),
    });
  } catch (error) {
    console.warn("Pipette notification unavailable:", error);
  }
}

async function showCopied(tabId, hex) {
  try {
    await browser.action.setIcon({ tabId, path: "icons/pipette-copied.svg" });
    await browser.action.setTitle({ tabId, title: `Copied ${hex} — Pick another color` });
  } catch {
    await notify(`${hex} copied to clipboard.`);
  }
}

async function openSettings() {
  try {
    await browser.runtime.openOptionsPage();
    return { ok: true };
  } catch {
    await notify("Could not open settings. Open Pipette's preferences in the Firefox add-on manager.");
    return { ok: false };
  }
}

// Toolbar context menus are available on desktop Firefox. Event-page menus
// persist while the background sleeps, so create them only on install/update.
if (browser.menus) {
  browser.runtime.onInstalled.addListener(() => {
    browser.menus.create({ id: "settings", title: "Settings", contexts: ["action"] });
  });
  browser.menus.onClicked.addListener((info) => {
    if (info.menuItemId === "settings") return openSettings();
  });
}

browser.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || activatingTabs.has(tab.id)) return;
  activatingTabs.add(tab.id);
  try {
    await browser.action.setIcon({ tabId: tab.id, path: "icons/pipette.svg" });
    await browser.action.setTitle({ tabId: tab.id, title: "Pick a color" });
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const session = crypto.randomUUID();
    const prepared = await browser.tabs.sendMessage(tab.id, { type: "pipette:prepare", session });
    if (prepared.cancelled) return;
    const settings = await loadSettings();

    // Capture before mounting the UI, so the magnifier never samples itself.
    const { viewport } = prepared;
    const screenshot = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      // Android's default capture can include space behind its dynamic toolbar.
      // An explicit document rectangle keeps capture and pointer geometry equal.
      rect: {
        x: viewport.scrollX + viewport.left,
        y: viewport.scrollY + viewport.top,
        width: viewport.width,
        height: viewport.height,
      },
    });
    const currentTab = await browser.tabs.get(tab.id);
    if (!currentTab.active || currentTab.url !== tab.url) return;
    const result = await browser.tabs.sendMessage(tab.id, {
      type: "pipette:start", session, screenshot, viewport: prepared.viewport, settings,
    });
    if (!result?.ok) throw new Error(result?.error || "The page changed. Activate Pipette again.");
  } catch (error) {
    console.warn("Pipette could not start:", error);
    await notify("Could not open Pipette. Firefox protects some pages; try a regular website. If the page moved, try again.");
  } finally {
    activatingTabs.delete(tab.id);
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !sender.tab || sender.frameId !== 0) return;
  if (message?.type !== "pipette:copy" || !/^#[\dA-F]{6}$/.test(message.hex)) return;
  return (async () => {
    try {
      // The background is an extension secure context, including on HTTP pages.
      await navigator.clipboard.writeText(message.hex);
    } catch {
      return { ok: false, error: "Could not copy. Release on the color to try again." };
    }
    await showCopied(sender.tab.id, message.hex);
    return { ok: true };
  })();
});
