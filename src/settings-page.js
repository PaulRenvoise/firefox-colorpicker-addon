import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings.js";

const form = document.querySelector("#settings-form");
const fields = form.querySelector("fieldset");
const initialHold = document.querySelector("#initial-hold");
const growthHold = document.querySelector("#growth-hold");
const shape = document.querySelector("#shape");
const status = document.querySelector("#save-status");
const SAVE_DELAY_MS = 300;
let saveTimer = null;
let revision = 0;
let pendingSave = null;
let saving = false;

function populate(settings) {
  initialHold.value = settings.initialHoldMs;
  growthHold.value = settings.growthHoldMs;
  shape.value = settings.shape;
}

function showStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

async function drainSaves() {
  if (saving) return;
  saving = true;
  try {
    while (pendingSave) {
      const next = pendingSave;
      pendingSave = null;
      try {
        await saveSettings(next.settings);
        if (next.revision === revision) showStatus(next.message);
      } catch {
        if (next.revision === revision) showStatus("Could not save settings. Change a value to try again.", true);
      }
    }
  } finally {
    saving = false;
  }
}

function queueSave(settings, message) {
  pendingSave = { settings, message, revision };
  showStatus("Saving…");
  drainSaves();
}

function flushPendingSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const invalid = form.querySelector("input:invalid, select:invalid");
  if (invalid) {
    showStatus(invalid.validationMessage, true);
    return;
  }
  queueSave({
    initialHoldMs: initialHold.valueAsNumber,
    growthHoldMs: growthHold.valueAsNumber,
    shape: shape.value,
  }, "Settings saved.");
}

function scheduleSave() {
  if (fields.disabled) return;
  clearTimeout(saveTimer);
  revision++;
  showStatus("Saving…");
  saveTimer = setTimeout(flushPendingSave, SAVE_DELAY_MS);
}

form.addEventListener("input", scheduleSave);
form.addEventListener("change", scheduleSave);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  flushPendingSave();
});

document.querySelector("#restore-defaults").addEventListener("click", () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  revision++;
  populate(DEFAULT_SETTINGS);
  queueSave(DEFAULT_SETTINGS, "Default settings restored.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushPendingSave();
});
window.addEventListener("pagehide", flushPendingSave);

async function initialize() {
  try {
    populate(await loadSettings());
    fields.disabled = false;
  } catch {
    showStatus("Could not load settings. Reload this page to try again.", true);
  }
}

initialize();
