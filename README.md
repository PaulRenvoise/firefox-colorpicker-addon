# Pipette

A small color picker for Firefox desktop (140+) and Firefox for Android (142+).
Click the add-on icon, hover over a color, and release a click to copy its uppercase
HEX value. A magnified preview shows the exact pixels being sampled.

On Android, open the Firefox menu, expand **Extensions**, and tap **Pick a color**
(Pipette's icon), then touch and drag over the page to
position the sample. Lift your finger to copy. The magnifier sits away from your
finger. Firefox for iOS does not support Firefox WebExtensions.

## Hold to average

A normal click or tap samples one screenshot pixel. Hold for more than **1.5 seconds**
to expand the region by one step every **750 ms**, up to **10 steps**. These are the
default timings and can be changed in settings. The default **square** grows
equally on all four sides, reaching 441 pixels at step ten away from image edges.
**Circle** includes pixels within the current radius (317 at step ten), while
**rhombus** uses orthogonal distance, with diagonals costing two moves (221 at step
ten). The preview outlines exactly the pixels included in the average.
The progress bar fills during the initial hold, then switches to ten segments,
filling one per averaging step. Moving while holding moves the entire sampling
region.

On release, Pipette copies the arithmetic mean of the selected pixels' displayed
RGB channels, rounded to the nearest integer. Near an edge it averages only pixels
inside the image. Sampling uses screenshot pixels, so the region is consistent
with the magnifier on high-density and zoomed displays.

After a successful copy, the add-on icon gains a green check and the page briefly
shows the copied value. The next activation clears the check. If Firefox cannot
update the icon, a browser notification confirms the copy instead. A failed copy
keeps the picker open so you can retry.

**Cancel:** Escape or activate the add-on again.
**Keyboard:** Alt+Shift+Y activates; arrow keys move one screenshot pixel; hold and
release Space to sample with the same averaging behavior.

## Settings

**Right-click Pipette's toolbar icon and choose Settings**, right-click while the
picker is active, or open Pipette's preferences in Firefox's add-on manager. On
touchscreens, use the add-on settings; holding your finger continues to average
colors. The settings page opens in its own tab:

- **Initial hold time:** milliseconds before growth begins; default **1500 ms**.
  Accepts whole numbers from 0 to 60000. Zero starts averaging immediately on press.
- **Growth hold time:** milliseconds between steps; default **750 ms**.
  Accepts whole numbers from 1 to 60000.
- **Pipette shape:** **square** (default), **circle**, or **rhombus**.

Valid changes save automatically after a **300 ms** pause in editing and apply to
the next picker session, including on already-open tabs. **Restore defaults**
resets all three choices immediately. Preferences are saved locally in the Firefox
profile and persist across browser restarts.

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
picker, writing the clipboard, storing preferences, and displaying fallback/error
notifications.
Screenshots exist only in memory during selection. No browsing data, colors, or
screenshots are stored or transmitted. Only the three preferences are saved
locally. There are no analytics or network calls.

## Source layout

- `src/background.js`: toolbar activation, tab capture, clipboard, and icon feedback.
- `src/sampling.js`: hold timing, pixel selection, coordinate mapping, and averaging.
- `src/settings.js`: shared defaults, validation, and local preference storage.
- `src/settings-page.js`: settings form loading, saving, and restoring defaults.
- `src/content/`: pointer lifecycle, isolated UI, magnifier, and viewport checks.
- `extension/`: manifest, SVG icons, and settings page markup and styles.
- `scripts/build.js`: bundles source and copies extension assets into `dist/`.
- `tests/`: sampler tests and Firefox integration tests.
