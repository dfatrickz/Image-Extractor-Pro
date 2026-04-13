// --- NETWORK ROUTING CONFIGURATION ---
async function configureResourceHeaders() {
  if (!browser.declarativeNetRequest) return;

  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [3],
      addRules: [
        {
          id: 3,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: "Referer",
                operation: "set",
                value: "https://www.pixiv.net/"
              }
            ]
          },
          condition: {
            urlFilter: "||i.pximg.net*",
            resourceTypes: ["image", "xmlhttprequest"]
          }
        }
      ]
    });
  } catch (error) {
    console.warn("FastGrab: Failed to configure resource headers.", error);
  }
}

// Initialize routing configuration
configureResourceHeaders();


// --- BLOB DOWNLOAD INTERCEPTOR ---
async function processSecureDownload(targetUrl, targetFilename) {
  // If it's a Pixiv URL, we must pull it into Firefox's local memory first
  if (targetUrl.includes("i.pximg.net")) {
    try {
      // 1. Fetch the image. Our DNR rule automatically attaches the Pixiv Referer here!
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error("Fetch failed");

      // 2. Convert to raw data
      const blob = await response.blob();

      // 3. Create the internal Firefox memory link (blob:moz-extension://...)
      const blobUrl = URL.createObjectURL(blob);

      // 4. Send the local memory link to the download manager
      await browser.downloads.download({
        url: blobUrl,
        filename: targetFilename || undefined,
        saveAs: true
      });

      // 5. Clean up the memory link after 10 seconds to prevent RAM leaks
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      return;
    } catch (err) {
      console.warn("FastGrab: Blob interception failed, falling back.", err);
    }
  }

  // Standard download for Reddit, Pinterest, and everything else
  await browser.downloads.download({
    url: targetUrl,
    filename: targetFilename || undefined,
    saveAs: true
  });
}

const api = typeof browser !== "undefined" ? browser : chrome;

const CONTEXT_MENU_ID = "fastgrab-save-image";
const activeTabs = new Set();

async function ensureContentScript(tabId) {
  try {
    await api.tabs.sendMessage(tabId, { type: "PING" });
  } catch (_error) {
    await api.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function isSupportedPage(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

async function syncActionState(tabId, enabled) {
  if (!api.action?.setBadgeText) {
    return;
  }

  await api.action.setBadgeBackgroundColor({
    tabId,
    color: enabled ? "#10b981" : "#64748b"
  });
  await api.action.setBadgeText({
    tabId,
    text: enabled ? "ON" : ""
  });
  await api.action.setTitle({
    tabId,
    title: enabled ? "FastGrab is active on this page" : "Toggle FastGrab on this page"
  });
}

async function createContextMenu() {
  try {
    await api.contextMenus.remove(CONTEXT_MENU_ID);
  } catch (_error) {
    // Ignore missing menu items during startup/reload.
  }

  api.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Save Image via FastGrab",
    contexts: ["all"],
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png"
    }
  });
}

api.runtime.onInstalled.addListener(() => {
  void createContextMenu();
});

api.runtime.onStartup?.addListener(() => {
  void createContextMenu();
});

api.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isSupportedPage(tab.url)) {
    return;
  }

  await ensureContentScript(tab.id);

  try {
    const response = await api.tabs.sendMessage(tab.id, { type: "FASTGRAB_TOGGLE_ACTIVE" });
    const enabled = Boolean(response?.enabled);
    if (enabled) {
      activeTabs.add(tab.id);
    } else {
      activeTabs.delete(tab.id);
    }
    await syncActionState(tab.id, enabled);
  } catch (error) {
    activeTabs.delete(tab.id);
    await syncActionState(tab.id, false);
    console.warn("FastGrab could not toggle on this tab.", error);
  }
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !isSupportedPage(tab.url)) {
    return;
  }

  let extractionFailed = false;
  let isUserCancel = false;

  try {
    await ensureContentScript(tab.id);

    const response = await api.tabs.sendMessage(tab.id, {
      type: "IEP_EXECUTE_CONTEXT_DOWNLOAD",
      srcUrl: info.srcUrl || ""
    });

    if (response?.ok === false) {
      const errMsg = (response.error || "").toLowerCase();
      if (errMsg.includes("cancel") || errMsg.includes("user")) {
        isUserCancel = true;
      } else {
        extractionFailed = true;
      }
    }
  } catch (_error) {
    // Message failed (e.g. content script didn't inject or page crashed)
    extractionFailed = true;
  }

  // Fallback ONLY if the script genuinely failed, and the user didn't cancel
  if (extractionFailed && !isUserCancel && info.srcUrl) {
    try {
      await processSecureDownload(info.srcUrl);
    } catch (fallbackError) {
      const errMsg = (fallbackError?.message || "").toLowerCase();
      if (!errMsg.includes("cancel") && !errMsg.includes("user")) {
        console.warn("FastGrab fallback download failed.", fallbackError);
      }
    }
  }
});

api.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "IEP_QUICK_DOWNLOAD":
      return processSecureDownload(message.url, message.filename)
        .then(() => ({ ok: true }))
        .catch((error) => ({
          ok: false,
          error: error?.message || "Download failed."
        }));
    default:
      return undefined;
  }
});

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !activeTabs.has(tabId) || !isSupportedPage(tab?.url)) {
    return;
  }

  void ensureContentScript(tabId)
    .then(() => api.tabs.sendMessage(tabId, {
      type: "FASTGRAB_SET_ACTIVE",
      enabled: true
    }))
    .then(() => syncActionState(tabId, true))
    .catch(async () => {
      activeTabs.delete(tabId);
      await syncActionState(tabId, false);
    });
});

api.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});
