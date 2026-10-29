import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Builder, By, Key, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { Pointer } from "selenium-webdriver/lib/input.js";

const serial = process.env.ANDROID_SERIAL;
const androidPackage = process.env.ANDROID_PACKAGE || "org.mozilla.firefox";
const fixture = await readFile(new URL("../fixtures/colors.html", import.meta.url), "utf8");
let driver;
let server;
let port;
let url;

function adb(...args) {
  return execFileSync(process.env.ADB || "adb", ["-s", serial, ...args], { encoding: "utf8" });
}

// Read current native UI bounds instead of relying on screen coordinates.
function nativeNodes() {
  adb("shell", "uiautomator", "dump", "/sdcard/pipette-test-window.xml");
  const xml = adb("shell", "cat", "/sdcard/pipette-test-window.xml");
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
}

async function nativeTap(predicate) {
  const node = await driver.wait(() => nativeNodes().find(predicate), 10_000);
  const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
  adb("shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}

before(async () => {
  assert.ok(serial, "Set ANDROID_SERIAL to the adb device/emulator ID.");
  process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(fixture);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  port = server.address().port;
  url = `http://127.0.0.1:${port}`;
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
  const options = new firefox.Options().enableMobile(androidPackage);
  options.set("moz:firefoxOptions", {
    ...options.get("moz:firefoxOptions"),
    androidDeviceSerial: serial,
    // Mozilla's documented workaround for the Firefox 153+ onboarding flow.
    androidIntentArguments: ["-a", "android.intent.action.VIEW", "-d", "about:blank", "--ez", "automationtest", "true"],
  });
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER).addArguments("--allow-system-access");
  driver = await new Builder().forBrowser("firefox").setFirefoxService(service).setFirefoxOptions(options).build();
  await driver.get(url);
  await driver.installWebExtension(resolve("dist"), { permanent: false });
  await nativeTap((node) => node["resource-id"]?.endsWith("/confirm_button"));
}, { timeout: 120_000 });

after(async () => {
  await driver?.quit();
  if (port) adb("reverse", "--remove", `tcp:${port}`);
  if (server) await new Promise((done) => server.close(done));
});

async function pickerRoot() {
  return (await driver.wait(until.elementLocated(By.id("pipette-picker")), 10_000)).getShadowRoot();
}

async function activate() {
  // Subsequent tests dispatch Firefox's native action to avoid repeating the
  // menu test. This grants activeTab and fires the actual onClicked listener.
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(`
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      const extension = ExtensionParent.GlobalManager.getExtension('@pipette.paulrenvoise');
      extension.apiManager.global.browserAction.for(extension).triggerClickOrPopup();
    `);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  return pickerRoot();
}

async function text(root, selector) {
  return (await root.findElement(By.css(selector))).getText();
}

async function waitForText(root, selector, expected, timeout = 10_000) {
  await driver.wait(async () => (await text(root, selector)).includes(expected), timeout);
}

async function waitForStep(root, step) {
  const progress = await root.findElement(By.css(".progress"));
  await driver.wait(async () =>
    await progress.getAttribute("aria-valuemax") === "10" &&
    await progress.getAttribute("aria-valuenow") === String(step), 12_000);
}

async function pastedValue() {
  await driver.wait(async () => (await driver.findElements(By.id("pipette-picker"))).length === 0, 5000);
  await driver.executeScript(`
    Object.assign(document.querySelector('textarea').style, {
      left: (visualViewport.offsetLeft + 8) + 'px',
      top: (visualViewport.offsetTop + visualViewport.height - 60) + 'px',
      right: 'auto', bottom: 'auto',
    });
  `);
  const field = await driver.findElement(By.css("textarea"));
  await field.click();
  await field.clear();
  await field.sendKeys(Key.chord(Key.CONTROL, "v"));
  return field.getAttribute("value");
}

test("Android menu activation, touch release, clipboard, and icon feedback", async () => {
  await nativeTap((node) => node["content-desc"] === "More options");
  await nativeTap((node) => node["resource-id"] === "mainMenu.extensions");
  await nativeTap((node) => node["text"] === "Pick a color" || node["content-desc"] === "Pick a color");
  const root = await pickerRoot();
  const finger = new Pointer("tap finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger, finger.move({ x: 100, y: 200, duration: 0 }), finger.press()).perform();
  assert.equal(await text(root, ".hex"), "#123456");
  assert.equal(await (await root.findElement(By.css(".status"))).isDisplayed(), false);
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/android-magnifier.png", await driver.takeScreenshot(), "base64");
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", "#123456 copied");
  assert.equal(await pastedValue(), "#123456");
  await driver.setContext(firefox.Context.CHROME);
  try {
    const icon = await driver.executeScript(`
      const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      const extension = ExtensionParent.GlobalManager.getExtension('@pipette.paulrenvoise');
      return extension.apiManager.global.browserAction.for(extension).getProperty(window.tab, 'icon');
    `);
    assert.match(JSON.stringify(icon), /pipette-copied/);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}, { timeout: 45_000 });

test("Android sustained touch averages exactly 221 pixels at step ten", async () => {
  await driver.get(url);
  await driver.executeScript("paint(true)");
  const root = await activate();
  const finger = new Pointer("hold finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger, finger.move({ x: 200, y: 200, duration: 0 }), finger.press()).perform();
  await waitForStep(root, 10);
  const viewport = await driver.executeScript("return {width:visualViewport.width,height:visualViewport.height}");
  const capturedWidth = Number(await (await root.findElement(By.css(".snapshot"))).getAttribute("width"));
  const capturedHeight = Number(await (await root.findElement(By.css(".snapshot"))).getAttribute("height"));
  assert.ok(Math.abs(capturedHeight - viewport.height * capturedWidth / viewport.width) <= 2,
    "Capture must exclude the collapsed-toolbar area");
  await writeFile("test-results/android-averaging.png", await driver.takeScreenshot(), "base64");
  assert.equal((await root.findElements(By.css(".progress.segmented .segment.filled"))).length, 10);
  assert.doesNotMatch(await text(root, ".panel"), /\d+ pixels|Step \d+\/\d+/);
  assert.equal(await text(root, ".hex"), "#FE0001");
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", "#FE0001 copied");
  assert.equal(await pastedValue(), "#FE0001");
});

test("Android finger drag follows the sample, and cancel preserves the clipboard", async () => {
  await driver.get(url);
  const previous = await pastedValue();
  await driver.get(url);
  let root = await activate();
  await (await root.findElement(By.css("button"))).click();
  assert.equal(await pastedValue(), previous);
  root = await activate();
  const finger = new Pointer("drag finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger,
    finger.move({ x: 100, y: 200, duration: 0 }), finger.press(),
    finger.move({ x: 250, y: 350, duration: 250 }), finger.release()).perform();
  await waitForText(root, ".status", "#123456 copied");
  assert.equal(await pastedValue(), "#123456");
});

test("Android pinch zoom keeps the sampled color under the finger", {
  skip: !process.env.ANDROID_TOUCH_DEVICE,
}, async () => {
  await driver.get(url);
  await driver.executeScript(`
    const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
    context.fillStyle = '#FF0000'; context.fillRect(0, 0, canvas.width / 2, canvas.height);
    context.fillStyle = '#0000FF'; context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
  `);
  // WebDriver's synthetic DOM touch events bypass Android's native pinch
  // recognizer. A rooted test emulator can inject through its touch device.
  const device = process.env.ANDROID_TOUCH_DEVICE;
  assert.match(device, /^\/dev\/input\/event\d+$/);
  const axes = adb("shell", "getevent", "-lp", device);
  const maxX = Number(axes.match(/ABS_MT_POSITION_X[^\n]*max (\d+)/)[1]);
  const maxY = Number(axes.match(/ABS_MT_POSITION_Y[^\n]*max (\d+)/)[1]);
  const commands = [];
  const send = (type, code, value) => commands.push(`sendevent ${device} ${type} ${code} ${value}`);
  for (let slot = 0; slot < 2; slot++) {
    send(3, 47, slot); send(3, 57, slot + 1);
    send(3, 53, Math.round(maxX * (slot ? 0.6 : 0.4)));
    send(3, 54, Math.round(maxY / 2)); send(3, 58, 100);
  }
  send(0, 0, 0);
  for (let step = 1; step <= 12; step++) {
    commands.push("sleep 0.05");
    for (let slot = 0; slot < 2; slot++) {
      send(3, 47, slot);
      send(3, 53, Math.round(maxX * (slot ? 0.6 + step / 80 : 0.4 - step / 80)));
    }
    send(0, 0, 0);
  }
  for (let slot = 0; slot < 2; slot++) { send(3, 47, slot); send(3, 57, -1); }
  send(0, 0, 0);
  adb("shell", commands.join("\n"));
  await driver.wait(async () => (await driver.executeScript("return visualViewport.scale")) > 1.1, 5000);
  const root = await activate();
  const finger = new Pointer("zoom finger", Pointer.Type.TOUCH);
  await driver.actions().insert(finger, finger.move({ x: 150, y: 250, duration: 0 }), finger.press()).perform();
  const expected = await driver.executeScript("return window.lastPointer.x < document.querySelector('canvas').width / devicePixelRatio / 2 ? '#FF0000' : '#0000FF'");
  assert.equal(await text(root, ".hex"), expected);
  await driver.actions().insert(finger, finger.release()).perform();
  await waitForText(root, ".status", `${expected} copied`);
  assert.equal(await pastedValue(), expected);
});
