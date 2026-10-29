import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings.js";

const form = document.querySelector("#settings-form");
const fields = form.querySelector("fieldset");
const initialHold = document.querySelector("#initial-hold");
const growthHold = document.querySelector("#growth-hold");
const shape = document.querySelector("#shape");
const status = document.querySelector("#save-status");

function populate(settings) {
  initialHold.value = settings.initialHoldMs;
  growthHold.value = settings.growthHoldMs;
  shape.value = settings.shape;
}

function showStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

async function persist(settings, message) {
  fields.disabled = true;
  try {
    populate(await saveSettings(settings));
    showStatus(message);
  } catch {
    showStatus("Could not save settings. Please try again.", true);
  } finally {
    fields.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  persist({
    initialHoldMs: initialHold.valueAsNumber,
    growthHoldMs: growthHold.valueAsNumber,
    shape: shape.value,
  }, "Settings saved.");
});

form.addEventListener("input", () => showStatus(""));
document.querySelector("#restore-defaults").addEventListener("click", () => {
  persist(DEFAULT_SETTINGS, "Default settings restored.");
});

async function initialize() {
  try {
    populate(await loadSettings());
    fields.disabled = false;
  } catch {
    showStatus("Could not load settings. Reload this page to try again.", true);
  }
}

initialize();
