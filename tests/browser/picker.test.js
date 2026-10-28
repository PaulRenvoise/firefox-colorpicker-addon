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

async function waitForText(root, selector, expected) {
  await driver.wait(async () => (await text(root, selector)).includes(expected), 5000);
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

test("a long hold averages the selected diamond and caps at ten steps", async () => {
  await driver.get(url);
  await driver.executeScript("paint(true)");
  const root = await activate();
  await driver.actions().move({ x: 200, y: 200 }).press().perform();
  await waitForText(root, ".detail", "Step 10/10");
  assert.equal(await text(root, ".detail"), "221 pixels · Step 10/10");
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
  await waitForText(root, ".detail", "Step 10/10");
  assert.equal(await text(root, ".hex"), "#FE0001");
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", "#FE0001 copied");
  assert.equal(await pastedValue(), "#FE0001");
  await driver.executeScript("paint()");
  root = await activate();
  await driver.actions().insert(finger, finger.move({ x: 200, y: 200, duration: 0 }), finger.press()).perform();
  const surface = await root.findElement(By.css(".surface"));
  await driver.executeScript("arguments[0].dispatchEvent(new PointerEvent('pointercancel', {bubbles:true}))", surface);
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
