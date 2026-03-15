const api = browser;

const extractButton = document.getElementById("extractButton");
const statusText = document.getElementById("statusText");

extractButton.addEventListener("click", handleExtractClick);

async function handleExtractClick() {
  setBusyState(true, "Scanning the page and preparing the gallery...");

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) {
      throw new Error("No active tab was found.");
    }

    if (isRestrictedUrl(tab.url)) {
      throw new Error("This page is protected by Firefox and cannot be scanned.");
    }

    const response = await api.runtime.sendMessage({
      type: "EXTRACT_IMAGES_FROM_TAB",
      tabId: tab.id,
      tabTitle: tab.title || "",
      tabUrl: tab.url
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Image extraction failed.");
    }

    const count = Number(response.count || 0);
    const message = count
      ? `Found ${count} image${count === 1 ? "" : "s"}. Gallery opened in a new tab.`
      : "No qualifying images were found, but the gallery is open so you can review the result.";

    setBusyState(false, message);
    window.setTimeout(() => window.close(), 900);
  } catch (error) {
    setBusyState(false, error.message || "Could not extract images from this tab.");
  }
}

function setBusyState(isBusy, message) {
  extractButton.disabled = isBusy;
  extractButton.classList.toggle("is-loading", isBusy);
  statusText.textContent = message;
}

function isRestrictedUrl(url) {
  return /^(about:|moz-extension:|chrome:|view-source:)/i.test(url);
}
