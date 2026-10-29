import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Builder, By, Key, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { Pointer } from "selenium-webdriver/lib/input.js";

let driver;
let server;
let url;
const modifier = process.platform === "darwin" ? Key.COMMAND : Key.CONTROL;
const fixture = await readFile(new URL("../fixtures/colors.html", import.meta.url), "utf8");

before(async () => {
  // This applies only to the isolated browser spawned by this test process.
  process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(fixture);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}`;
  const options = new firefox.Options().addArguments("-headless");
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  else if (process.platform === "darwin") options.setBinary("/Applications/Firefox.app/Contents/MacOS/firefox");
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();
  await driver.manage().window().setRect({ width: 1000, height: 800 });
  await driver.installWebExtension(resolve("dist"), { permanent: false });
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("CustomizableUI.addWidgetToArea('_pipette_paulrenvoise-browser-action', CustomizableUI.AREA_NAVBAR)");
  await driver.setContext(firefox.Context.CONTENT);
}, { timeout: 120_000 });

after(async () => {
  await driver?.quit();
  if (server) await new Promise((done) => server.close(done));
});

async function activate() {
  await clickIcon();
  const host = await driver.wait(until.elementLocated(By.id("pipette-picker")), 5000);
  return host.getShadowRoot();
}

async function clickIcon() {
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.findElement(By.id("_pipette_paulrenvoise-BAP")).click();
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

async function text(root, selector) {
  return (await root.findElement(By.css(selector))).getText();
}

async function pastedValue() {
  await waitForClosed();
  const field = await driver.findElement(By.css("textarea"));
  await field.click();
  await field.clear();
  await field.sendKeys(Key.chord(modifier, "v"));
  return field.getAttribute("value");
}

async function waitForText(root, selector, expected, timeout = 5000) {
  await driver.wait(async () => (await text(root, selector)).includes(expected), timeout);
}

async function waitForStep(root, step, timeout = 12_000) {
  const progress = await root.findElement(By.css(".progress"));
  await driver.wait(async () =>
    await progress.getAttribute("aria-valuemax") === "10" &&
    await progress.getAttribute("aria-valuenow") === String(step), timeout);
  return progress;
}

async function waitForClosed() {
  await driver.wait(async () => (await driver.findElements(By.id("pipette-picker"))).length === 0, 5000);
}

async function screenshot(name) {
  await mkdir("test-results", { recursive: true });
  await writeFile(`test-results/${name}.png`, await driver.takeScreenshot(), "base64");
}

test("activation shows the pipette magnifier; only release copies, with icon feedback", async () => {
  await driver.get(url);
  const root = await activate();
  await driver.actions().move({ x: 200, y: 200 }).perform();
  assert.equal(await text(root, ".hex"), "#123456");
  assert.match(await driver.findElement(By.id("pipette-picker")).getCssValue("cursor"), /data:image\/svg/);
  await screenshot("desktop-magnifier");
  await driver.actions().press().perform();
  assert.equal(await (await root.findElement(By.css(".status"))).isDisplayed(), false);
  await driver.actions().release().perform();
  await waitForText(root, ".status", "#123456 copied");
  assert.equal(await pastedValue(), "#123456");
  assert.equal(await driver.executeScript("return window.pageClicks"), 1); // Only the paste field click.
  await driver.setContext(firefox.Context.CHROME);
  try {
    const button = await driver.findElement(By.id("_pipette_paulrenvoise-BAP"));
    assert.match(await button.getAttribute("style"), /pipette-copied/);
    assert.match(await button.getAttribute("tooltiptext"), /Copied #123456/);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  await waitForClosed();
});

test("a long hold averages the selected rectangle and caps at ten steps", async () => {
  await driver.get(url);
  await driver.executeScript("paint(true)");
  const root = await activate();
  await driver.actions().move({ x: 200, y: 200 }).press().perform();
  const progress = await root.findElement(By.css(".progress"));
  assert.equal(await progress.getAttribute("aria-valuemax"), "100");
  await driver.wait(async () => Number(await progress.getAttribute("aria-valuenow")) > 0, 1000);
  assert.equal((await root.findElements(By.css(".segment.filled"))).length, 0);
  await screenshot("initial-hold-progress");
  await waitForStep(root, 1);
  assert.equal((await root.findElements(By.css(".progress.segmented .segment"))).length, 10);
  assert.equal((await root.findElements(By.css(".segment.filled"))).length, 1);
  assert.equal(await text(root, ".detail"), "Release to copy · Hold to average");
  await screenshot("segmented-progress-step-1");
  await waitForStep(root, 10);
  assert.equal((await root.findElements(By.css(".segment.filled"))).length, 10);
  assert.doesNotMatch(await text(root, ".panel"), /\d+ pixels|Step \d+\/\d+/);
  assert.equal(await text(root, ".hex"), "#FE0001");
  await screenshot("averaging");
  await driver.actions().release().perform();
  await waitForText(root, ".status", "#FE0001 copied");
  assert.equal(await pastedValue(), "#FE0001");
  await waitForClosed();
});

test("Escape, the close control, and a second activation cancel without copying", async () => {
  await driver.get(url);
  await activate();
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await waitForClosed();
  let root = await activate();
  await (await root.findElement(By.css("button"))).click();
  await waitForClosed();
  root = await activate();
  await clickIcon();
  await waitForClosed();
  assert.equal(await pastedValue(), "#FE0001");
});

test("touch drag on a narrow viewport picks on finger release", async () => {
  await driver.manage().window().setRect({ width: 420, height: 850 });
  await driver.get(url);
  const root = await activate();
  const finger = new Pointer("finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger,
    finger.move({ x: 180, y: 420, duration: 0 }), finger.press(),
    finger.move({ x: 200, y: 450, duration: 200 })).perform();
  assert.equal(await text(root, ".hex"), "#123456");
  await screenshot("touch-magnifier");
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", "#123456 copied");
  assert.equal(await pastedValue(), "#123456");
  await waitForClosed();
});

test("keyboard movement and Space use release-to-copy behavior", async () => {
  await driver.get(url);
  const root = await activate();
  await driver.actions().sendKeys(Key.ARROW_LEFT).keyDown(Key.SPACE).perform();
  assert.equal(await (await root.findElement(By.css(".status"))).isDisplayed(), false);
  await driver.actions().keyUp(Key.SPACE).perform();
  await waitForText(root, ".status", "#123456 copied");
  assert.equal(await pastedValue(), "#123456");
});

test("a display scale of two still selects the exact screenshot pixel", async () => {
  await driver.manage().window().setRect({ width: 1000, height: 800 });
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("Services.prefs.setCharPref('layout.css.devPixelsPerPx', '2.0')");
  await driver.setContext(firefox.Context.CONTENT);
  await driver.get(url);
  await driver.wait(async () => (await driver.executeScript("return devicePixelRatio")) === 2, 5000);
  await driver.executeScript("paint(true)");
  const root = await activate();
  // WebDriver may skip dispatching movement to its last stored coordinates.
  await driver.actions().move({ x: 100, y: 100 }).move({ x: 200, y: 200 }).perform();
  await screenshot("display-scale");
  assert.equal(await text(root, ".hex"), "#0000FF");
  await driver.actions().click().perform();
  await waitForText(root, ".status", "#0000FF copied");
  assert.equal(await pastedValue(), "#0000FF");
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("Services.prefs.clearUserPref('layout.css.devPixelsPerPx')");
  await driver.setContext(firefox.Context.CONTENT);
});

test("scrolling or resizing cancels a stale screenshot", async () => {
  await driver.get(url);
  await driver.executeScript("document.body.style.height='3000px'");
  await activate();
  await driver.executeScript("window.scrollTo(0, 100)");
  await waitForClosed();
  await activate();
  await driver.manage().window().setRect({ width: 900, height: 750 });
  await waitForClosed();
});

test("touch hold expands the region and a cancelled touch never copies", async () => {
  await driver.manage().window().setRect({ width: 500, height: 850 });
  await driver.get(url);
  await driver.executeScript("paint(true)");
  let root = await activate();
  const finger = new Pointer("hold finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger, finger.move({ x: 200, y: 200, duration: 0 }), finger.press()).perform();
  await waitForStep(root, 10);
  assert.equal((await root.findElements(By.css(".segment.filled"))).length, 10);
  assert.equal(await text(root, ".hex"), "#FE0001");
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", "#FE0001 copied");
  assert.equal(await pastedValue(), "#FE0001");
  await driver.executeScript("paint()");
  root = await activate();
  await driver.actions().insert(finger, finger.move({ x: 200, y: 200, duration: 0 }), finger.press()).perform();
  const progress = await waitForStep(root, 1);
  const surface = await root.findElement(By.css(".surface"));
  await driver.executeScript("arguments[0].dispatchEvent(new PointerEvent('pointercancel', {bubbles:true}))", surface);
  assert.equal(await progress.getAttribute("aria-valuemax"), "100");
  assert.equal(await progress.getAttribute("aria-valuenow"), "0");
  assert.equal((await root.findElements(By.css(".segment.filled"))).length, 0);
  await driver.actions().insert(finger, finger.release()).perform();
  assert.equal(await (await root.findElement(By.css(".status"))).isDisplayed(), false);
  await (await root.findElement(By.css("button"))).click();
  assert.equal(await pastedValue(), "#FE0001");
});

test("browser zoom preserves screenshot coordinates", async () => {
  await driver.manage().window().setRect({ width: 1000, height: 800 });
  await driver.get(url);
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("gBrowser.selectedBrowser.fullZoom = 1.5");
  await driver.setContext(firefox.Context.CONTENT);
  await driver.wait(async () => (await driver.executeScript("return devicePixelRatio")) === 1.5, 5000);
  await driver.executeScript("paint(true)");
  const root = await activate();
  await driver.actions().move({ x: 100, y: 100 }).move({ x: 200, y: 200 }).perform();
  await screenshot("zoom");
  assert.equal(await text(root, ".hex"), "#0000FF");
  await driver.actions().click().perform();
  await waitForText(root, ".status", "#0000FF copied");
  assert.equal(await pastedValue(), "#0000FF");
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript("gBrowser.selectedBrowser.fullZoom = 1");
  await driver.setContext(firefox.Context.CONTENT);
});

test("the capture rectangle follows a scrolled document", async () => {
  await driver.get(url);
  await driver.executeScript(`
    document.body.style.height = '3000px';
    const canvas = document.querySelector('canvas');
    canvas.style.position = 'absolute';
    canvas.height = 3000 * devicePixelRatio;
    canvas.style.height = '3000px';
    const context = canvas.getContext('2d');
    context.fillStyle = '#FF0000'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0000FF'; context.fillRect(0, 400 * devicePixelRatio, canvas.width, canvas.height);
    window.scrollTo(0, 400);
  `);
  const root = await activate();
  await driver.actions().move({ x: 100, y: 100 }).move({ x: 200, y: 200 }).click().perform();
  await waitForText(root, ".status", "#0000FF copied");
  assert.equal(await pastedValue(), "#0000FF");
});

test("settings persist, validate input, and configure all three sampling shapes", async () => {
  await driver.get(url);
  const pageHandle = await driver.getWindowHandle();
  const handles = await driver.getAllWindowHandles();
  const picker = await activate();
  await (await picker.findElement(By.css(".settings"))).click();
  await driver.wait(async () => (await driver.getAllWindowHandles()).length > handles.length, 5000);
  const settingsHandle = (await driver.getAllWindowHandles()).find((handle) => !handles.includes(handle));
  await driver.switchTo().window(settingsHandle);
  const settingsUrl = await driver.getCurrentUrl();
  assert.match(settingsUrl, /^moz-extension:.*\/options\.html$/);
  const ready = async () => driver.wait(until.elementIsEnabled(await driver.findElement(By.id("initial-hold"))), 5000);
  await ready();
  assert.equal(await driver.findElement(By.id("initial-hold")).getAttribute("value"), "1500");
  assert.equal(await driver.findElement(By.id("growth-hold")).getAttribute("value"), "750");
  assert.equal(await driver.findElement(By.id("shape")).getAttribute("value"), "rectangle");
  await screenshot("settings-defaults");
  const phoneFrame = await driver.executeScript(`
    const frame = document.createElement('iframe');
    frame.src = location.href;
    frame.style.cssText = 'position:fixed;inset:0;width:390px;height:750px;border:0;z-index:9999';
    document.body.append(frame);
    return frame;
  `);
  await driver.switchTo().frame(phoneFrame);
  await ready();
  assert.equal(await driver.executeScript("return document.documentElement.scrollWidth <= innerWidth"), true);
  assert.ok((await driver.findElement(By.id("initial-hold")).getRect()).height >= 44);
  await driver.switchTo().defaultContent();
  await writeFile("test-results/settings-mobile-layout.png", await phoneFrame.takeScreenshot(), "base64");
  await driver.executeScript("arguments[0].remove()", phoneFrame);

  const fill = async (id, value) => {
    const input = await driver.findElement(By.id(id));
    await input.clear();
    await input.sendKeys(String(value));
  };
  const save = async (initialHoldMs, growthHoldMs, shape) => {
    await fill("initial-hold", initialHoldMs);
    await fill("growth-hold", growthHoldMs);
    await driver.findElement(By.css(`#shape option[value="${shape}"]`)).click();
    await driver.findElement(By.css("button.primary")).click();
    await driver.wait(until.elementTextIs(await driver.findElement(By.id("save-status")), "Settings saved."), 5000);
  };

  await fill("growth-hold", 0);
  await driver.findElement(By.css("button.primary")).click();
  assert.equal(await driver.executeScript("return document.querySelector('#growth-hold').validity.valid"), false);
  await driver.navigate().refresh();
  await ready();
  assert.equal(await driver.findElement(By.id("growth-hold")).getAttribute("value"), "750");

  for (const [shape, expected] of [["rectangle", "#FA0005"], ["circle", "#F60009"], ["rhombus", "#F5000A"]]) {
    await save(100, 1000, shape);
    await driver.navigate().refresh();
    await ready();
    assert.equal(await driver.findElement(By.id("initial-hold")).getAttribute("value"), "100");
    assert.equal(await driver.findElement(By.id("growth-hold")).getAttribute("value"), "1000");
    assert.equal(await driver.findElement(By.id("shape")).getAttribute("value"), shape);
    await driver.switchTo().window(pageHandle);
    // Reuse the injected content script to verify settings refresh per session.
    await driver.executeScript("paint(true)");
    const root = await activate();
    await driver.actions().move({ x: 200, y: 200 }).press().perform();
    await waitForStep(root, 3, 4500);
    assert.equal(await text(root, ".hex"), expected);
    await screenshot(`shape-${shape}`);
    await driver.actions().release().perform();
    await waitForText(root, ".status", `${expected} copied`);
    assert.equal(await pastedValue(), expected);
    await driver.switchTo().window(settingsHandle);
  }

  await save(0, 50, "rectangle");
  await driver.switchTo().window(pageHandle);
  const root = await activate();
  const progress = await root.findElement(By.css(".progress"));
  assert.equal(await progress.getAttribute("aria-valuemax"), "100");
  assert.equal(await progress.getAttribute("aria-valuenow"), "0");
  await driver.actions().move({ x: 200, y: 200 }).press().perform();
  await waitForStep(root, 10, 2000);
  await driver.actions().release().perform();
  await waitForText(root, ".status", "copied");
  await waitForClosed();
  await driver.switchTo().window(settingsHandle);
  await driver.findElement(By.id("restore-defaults")).click();
  await driver.wait(until.elementTextIs(await driver.findElement(By.id("save-status")), "Default settings restored."), 5000);
  await driver.navigate().refresh();
  await ready();
  assert.equal(await driver.findElement(By.id("initial-hold")).getAttribute("value"), "1500");
  assert.equal(await driver.findElement(By.id("growth-hold")).getAttribute("value"), "750");
  assert.equal(await driver.findElement(By.id("shape")).getAttribute("value"), "rectangle");
});
