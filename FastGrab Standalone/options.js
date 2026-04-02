const api = typeof browser !== "undefined" ? browser : chrome;

const defaultSettings = {
  hoverEnabled: true,
  autoUpgrade: true,
  minSize: 80
};

const elements = {
  hoverEnabled: document.getElementById("optHoverEnable"),
  autoUpgrade: document.getElementById("optAutoUpgrade"),
  minSize: document.getElementById("optMinSize"),
  status: document.getElementById("saveStatus")
};

let saveTimeout;

async function loadSettings() {
  const data = await api.storage.local.get("fastgrab_settings");
  const settings = { ...defaultSettings, ...(data.fastgrab_settings || {}) };
  
  elements.hoverEnabled.checked = settings.hoverEnabled;
  elements.autoUpgrade.checked = settings.autoUpgrade;
  elements.minSize.value = settings.minSize;
}

async function saveSettings() {
  const settings = {
    hoverEnabled: elements.hoverEnabled.checked,
    autoUpgrade: elements.autoUpgrade.checked,
    minSize: parseInt(elements.minSize.value, 10) || 80
  };

  await api.storage.local.set({ fastgrab_settings: settings });
  
  // Flash success message
  elements.status.style.opacity = "1";
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    elements.status.style.opacity = "0";
  }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  
  // Auto-save on any change
  elements.hoverEnabled.addEventListener("change", saveSettings);
  elements.autoUpgrade.addEventListener("change", saveSettings);
  elements.minSize.addEventListener("change", saveSettings);
  elements.minSize.addEventListener("keyup", saveSettings); // for typed numbers
});
