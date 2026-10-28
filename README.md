# Pipette

A small color picker for Firefox desktop (140+) and Firefox for Android (142+).
Click the add-on icon, hover over a color, and release a click to copy its uppercase
HEX value. A magnified preview shows the exact pixels being sampled.

On Android, open the Firefox menu, expand **Extensions**, and tap **Pick a color**
(Pipette's icon), then touch and drag over the page to
position the sample. Lift your finger to copy. The magnifier sits away from your
finger. Firefox for iOS does not support Firefox WebExtensions.

## Hold to average

A normal click or tap samples one screenshot pixel. Hold for more than **1 second**
to expand the region by one Manhattan-distance step every **150 ms**, up to **10
steps** (221 pixels away from image edges). The first step includes the center and
its four immediate neighbors. Diagonals enter on the second step because each
diagonal costs two orthogonal moves. The preview outlines the selected region and
shows its pixel count. Moving while holding moves the entire sampling region.

On release, Pipette copies the arithmetic mean of the selected pixels' displayed
RGB channels, rounded to the nearest integer. Near an edge it averages only pixels
inside the image. Sampling uses screenshot pixels, so the region is consistent
with the magnifier on high-density and zoomed displays.

After a successful copy, the add-on icon gains a green check and the page briefly
shows the copied value. The next activation clears the check. If Firefox cannot
update the icon, a browser notification confirms the copy instead. A failed copy
keeps the picker open so you can retry.

**Cancel:** Escape, the × button, or activate the add-on again.
**Keyboard:** Alt+Shift+Y activates; arrow keys move one screenshot pixel; hold and
release Space to sample with the same averaging behavior.

## Development

Requires Node.js 22+ and pnpm. No server or runtime dependencies are used.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm test:browser
pnpm start
```

`pnpm start` builds the extension and launches a temporary Firefox profile.
Alternatively, run `pnpm build`, open `about:debugging#/runtime/this-firefox`, click
**Load Temporary Add-on**, and select `dist/manifest.json`.

The browser tests use an isolated desktop Firefox profile and Selenium Manager to
find or download geckodriver. Set `FIREFOX_BINARY` if Firefox is not in its standard
location. They test real extension activation, capture, release, clipboard writes,
feedback, cancellation, and touch pointer input. Touch tests on desktop exercise
the interaction. A separate Android suite runs against Firefox on an emulator or
a connected device, including the native extension menu and real clipboard writes.

For Android, install Android platform tools (`adb`), enable USB debugging on the
device and **Remote debugging via USB** in Firefox, and connect the device:

```sh
adb devices
pnpm start:android --android-device DEVICE_ID --firefox-apk org.mozilla.firefox
```

See Mozilla's [Android development guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).
To run the automated Android suite, install Firefox on an Android emulator or a
dedicated test device, put `adb` on your path, and run:

```sh
ANDROID_SERIAL=emulator-5554 pnpm test:android
```

Set `GECKODRIVER` to a driver executable if automatic discovery is unavailable,
and `ANDROID_PACKAGE` to test another Firefox channel. The suite launches an
isolated Firefox profile through geckodriver and forwards a local test server over
ADB. Its native-menu checks expect Firefox's English interface. The emulator
checks were run on Android 11 with Firefox 159; desktop checks used Firefox 159 on
macOS. Physical-device ergonomics and other Android versions still warrant a
manual check before store distribution.

The native pinch-zoom regression additionally requires a rooted test emulator.
Set `ANDROID_TOUCH_DEVICE` to its multitouch input device (locate it with
`adb shell getevent -lp`). This injects real touch events because WebDriver's DOM
touch synthesis does not enter Android's native pinch recognizer. That optional
test is skipped when the variable is absent.

## Package

```sh
pnpm package
```

The unsigned archive is written to `artifacts/`. Firefox requires Mozilla signing
for normal installation and distribution. Upload the archive to
[Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/) for signing
and choose desktop and Android compatibility. Temporary development loading does
not require signing.

## Scope and privacy

Pipette captures the currently visible tab once when activated and freezes that
view during selection. This keeps animations and video aligned with the sampled
pixels. Scroll, resize, zoom, navigation, or switching away cancels the selection;
activate again to capture the new view. Firefox-protected pages, including
`about:` pages, its PDF viewer, and some Mozilla sites, do not allow the injected
picker. Firefox's screenshot privacy protections may also affect captured colors.

Permissions are limited to temporary access to the active tab, injecting the
picker, writing the clipboard, and displaying fallback/error notifications.
Screenshots exist only in memory during selection. No browsing data, colors, or
screenshots are stored or transmitted. There are no analytics or network calls.

## Source layout

- `src/background.js`: toolbar activation, tab capture, clipboard, and icon feedback.
- `src/sampling.js`: hold timing, pixel selection, coordinate mapping, and averaging.
- `src/content/`: pointer lifecycle, isolated UI, magnifier, and viewport checks.
- `extension/`: manifest and SVG icons.
- `scripts/build.js`: bundles source and copies extension assets into `dist/`.
- `tests/`: sampler tests and Firefox integration tests.
