import { Picker } from "./picker.js";
import { readViewport, sameViewport } from "./viewport.js";

// Programmatic scripts persist until navigation. Reusing the listener prevents
// duplicate overlays and duplicate clipboard writes on subsequent activations.
if (!globalThis.__pipetteInstalled) {
  globalThis.__pipetteInstalled = true;
  let picker = null;
  let pendingSession = null;

  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === "pipette:prepare") {
      if (picker) {
        picker.destroy();
        return Promise.resolve({ cancelled: true });
      }
      pendingSession = message.session;
      return Promise.resolve({ viewport: readViewport() });
    }
    if (message?.type === "pipette:start") {
      return (async () => {
        if (message.session !== pendingSession) return { ok: false };
        pendingSession = null;
        try {
          const image = new Image();
          image.src = message.screenshot;
          await image.decode();
          if (!sameViewport(message.viewport, readViewport())) {
            return { ok: false, error: "The page moved. Activate Pipette again." };
          }
          picker = new Picker(image, message.viewport, () => { picker = null; });
          return { ok: true };
        } catch (error) {
          picker?.destroy();
          return { ok: false, error: error.message };
        }
      })();
    }
  });
}
