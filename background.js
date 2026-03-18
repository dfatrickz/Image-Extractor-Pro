const api = browser;

const EXTRACTION_KEY_PREFIX = "iepExtraction:";
const EXTRACTION_INDEX_KEY = "iepExtractionIndex";
const MAX_STORED_SESSIONS = 5;
const CONTEXT_MENU_ID = "iep-extract-image";
let persistentModeEnabled = true;
let persistentModeLoaded = false;

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Save Image via Extractor Pro",
    contexts: ["all"],
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png"
    }
  });
});

void refreshPersistentModeCache();

api.action.onClicked.addListener(async (tab) => {
  await toggleFloatingUi(tab);
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !tab.url || isRestrictedUrl(tab.url)) {
    return;
  }

  try {
    await ensureContentScript(tab.id);
    await api.tabs.sendMessage(tab.id, { type: "IEP_EXECUTE_CONTEXT_DOWNLOAD" });
  } catch (error) {
    console.error("Image Extractor Pro could not execute the context download.", error);
  }
});

api.runtime.onMessage.addListener((message, sender) => {
  switch (message?.type) {
    case "IEP_OPEN_GALLERY":
      return openGalleryFromContent(sender.tab, message);
    case "IEP_GET_SESSION":
      return getExtractionSession(message.sessionId);
    case "IEP_FETCH_BINARY_PROBE":
      return fetchBinaryProbe(message.url);
    case "IEP_QUICK_DOWNLOAD":
      return quickDownloadImage(message.url);
    default:
      return undefined;
  }
});

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    void maybeInjectPersistentUi(tabId, tab?.url || "");
  }
});

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.iepSettingsManager && !changes.iepFilters)) {
    return;
  }

  void (async () => {
    const enabled = await refreshPersistentModeCache();
    if (!enabled) {
      return;
    }

    const tabs = await api.tabs.query({});
    await Promise.all(tabs.map((tab) => maybeInjectPersistentUi(tab.id, tab.url)));
  })();
});

async function toggleFloatingUi(tab) {
  if (!tab?.id || !tab.url || isRestrictedUrl(tab.url)) {
    return;
  }

  try {
    await ensureContentScript(tab.id);
    await api.tabs.sendMessage(tab.id, { type: "IEP_TOGGLE_UI" });
  } catch (firstError) {
    try {
      await ensureContentScript(tab.id);
      await api.tabs.sendMessage(tab.id, { type: "IEP_TOGGLE_UI" });
    } catch (secondError) {
      console.error("Image Extractor Pro could not toggle the page UI.", secondError);
    }
  }
}

async function ensureContentScript(tabId) {
  await api.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  await sleep(120);
}

async function openGalleryFromContent(tab, message) {
  try {
    const images = Array.isArray(message.images) ? message.images : [];
    const pageTitle = message.pageTitle || tab?.title || "Untitled Page";
    const sourceUrl = message.pageUrl || tab?.url || "";
    const selectionLabel = message.selectionLabel || "";
    const sessionId = await saveExtractionSession({
      pageTitle,
      sourceUrl,
      selectionLabel,
      downloadMode: message.downloadMode || "zip",
      subfolderName: message.subfolderName || "",
      imageOrigin: message.imageOrigin || "all",
      theme: ["system", "dark", "light"].includes(String(message.theme || "system").toLowerCase()) ? String(message.theme || "system").toLowerCase() : "system",
      rateLimitMs: Math.max(0, Number.parseInt(message.rateLimitMs || "0", 10) || 0),
      individualDownloadWarningThreshold: Math.max(0, Number.parseInt(message.individualDownloadWarningThreshold || "30", 10) || 0),
      flickrNetworkCache: Array.isArray(message.flickrNetworkCache) ? message.flickrNetworkCache : [],
      flickrApiKey: message.flickrApiKey || "",
      extractedAt: new Date().toISOString(),
      images
    });

    const galleryUrl = api.runtime.getURL(`gallery.html?session=${encodeURIComponent(sessionId)}`);
    await api.tabs.create({ url: galleryUrl });

    return {
      ok: true,
      sessionId,
      count: images.length
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Could not open the gallery."
    };
  }
}

async function fetchBinaryProbe(url) {
  if (!url) {
    return {
      ok: false,
      error: "No URL was provided."
    };
  }

  try {
    const response = await fetch(url, {
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}.`);
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "";
    const text = /svg|xml|text/i.test(contentType) ? new TextDecoder("utf-8").decode(buffer) : "";

    return {
      ok: true,
      buffer,
      contentType,
      text
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "The binary probe fetch failed."
    };
  }
}

async function quickDownloadImage(url) {
  if (!url) {
    return {
      ok: false,
      error: "No image URL was provided."
    };
  }

  try {
    const downloadId = await api.downloads.download({
      url,
      saveAs: true
    });

    return {
      ok: true,
      downloadId
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Could not start the download."
    };
  }
}

async function maybeInjectPersistentUi(tabId, url) {
  if (!tabId || !url || isRestrictedUrl(url)) {
    return;
  }

  const enabled = await getPersistentModeEnabled();
  if (!enabled) {
    return;
  }

  try {
    await ensureContentScript(tabId);
  } catch (_error) {
    // Ignore tabs that reject script execution.
  }
}

async function getPersistentModeEnabled() {
  if (persistentModeLoaded) {
    return persistentModeEnabled;
  }

  return refreshPersistentModeCache();
}

async function refreshPersistentModeCache() {
  try {
    const result = await api.storage.local.get(["iepSettingsManager", "iepFilters"]);
    persistentModeEnabled = resolvePersistentMode(result);
  } catch (_error) {
    persistentModeEnabled = true;
  }

  persistentModeLoaded = true;
  return persistentModeEnabled;
}

function resolvePersistentMode(storageState) {
  const manager = storageState?.iepSettingsManager;
  const profiles = Array.isArray(manager?.profiles) ? manager.profiles : [];
  const activeId = manager?.activeId || "default";
  const activeProfile = profiles.find((profile) => profile?.id === activeId) || profiles[0];
  const filters = activeProfile?.filters && typeof activeProfile.filters === "object"
    ? activeProfile.filters
    : (storageState?.iepFilters && typeof storageState.iepFilters === "object" ? storageState.iepFilters : {});

  return typeof filters?.persistentMode === "boolean" ? filters.persistentMode : true;
}

async function saveExtractionSession(sessionData) {
  const sessionId = createSessionId();
  const sessionKey = getSessionKey(sessionId);
  const storageState = await api.storage.local.get(EXTRACTION_INDEX_KEY);
  const existingIds = Array.isArray(storageState[EXTRACTION_INDEX_KEY])
    ? storageState[EXTRACTION_INDEX_KEY]
    : [];
  const nextIds = [sessionId, ...existingIds.filter((id) => id !== sessionId)].slice(0, MAX_STORED_SESSIONS);
  const expiredIds = existingIds.filter((id) => !nextIds.includes(id));

  await api.storage.local.set({
    [EXTRACTION_INDEX_KEY]: nextIds,
    [sessionKey]: {
      sessionId,
      ...sessionData
    }
  });

  if (expiredIds.length) {
    await api.storage.local.remove(expiredIds.map(getSessionKey));
  }

  return sessionId;
}

async function getExtractionSession(sessionId) {
  try {
    let targetSessionId = sessionId;

    if (!targetSessionId) {
      const indexState = await api.storage.local.get(EXTRACTION_INDEX_KEY);
      targetSessionId = Array.isArray(indexState[EXTRACTION_INDEX_KEY])
        ? indexState[EXTRACTION_INDEX_KEY][0]
        : null;
    }

    if (!targetSessionId) {
      throw new Error("No extraction session is available yet.");
    }

    const storageState = await api.storage.local.get(getSessionKey(targetSessionId));
    const session = storageState[getSessionKey(targetSessionId)];

    if (!session) {
      throw new Error("The extraction session could not be found.");
    }

    return {
      ok: true,
      session
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Could not load the extraction session."
    };
  }
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionKey(sessionId) {
  return `${EXTRACTION_KEY_PREFIX}${sessionId}`;
}

function isRestrictedUrl(url) {
  return /^(about:|moz-extension:|chrome:|view-source:)/i.test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// FLICKR DATA CACHE SETUP
// Watch for Flickr tabs loading or updating
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes("flickr.com") && changeInfo.status === "loading") {
    // Setup the data helper directly in the page's MAIN execution world
    api.scripting.executeScript({
      target: { tabId: tabId },
      world: "MAIN",
      func: setupFlickrHelper
    }).catch(() => {});
  }
});

// This function runs INSIDE the actual webpage's context
function setupFlickrHelper() {
  if (window.iepHelperActive) return;
  window.iepHelperActive = true;

  const relevantFlickrRequestPattern = /(flickr\.interestingness|flickr\.interestingness\.getList|flickr\.photos\.getExplore|\/explore\b|\/search\b|\/graphql\b|services\/rest\/\?method=flickr\.interestingness\.getList|services\/rest\/\?method=flickr\.photos\.getExplore)/i;
  const relevantFlickrPayloadPattern = /(live\.staticflickr\.com|farm[0-9]+\.staticflickr\.com|"url_[okhb]"|'url_[okhb]'|url_[okhb]\b)/i;

  function isRelevantFlickrPayload(requestUrl, text) {
    const safeUrl = String(requestUrl || "");
    const safeText = String(text || "");
    return relevantFlickrRequestPattern.test(safeUrl) || relevantFlickrPayloadPattern.test(safeText);
  }

  function postFlickrPayload(text) {
    if (!text) {
      return;
    }

    window.postMessage({ type: "IEP_FLICKR_DATA_CACHED", payload: text }, "*");
  }

  // 1. MODERN FETCH HELPER
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      const requestUrl = typeof args[0] === "string"
        ? args[0]
        : args[0]?.url || response.url || "";
      clone.text().then((text) => {
        if (isRelevantFlickrPayload(requestUrl, text)) {
          postFlickrPayload(text);
        }
      }).catch(() => {});
    } catch (e) {}
    return response;
  };

  // 2. LEGACY XHR HELPER (For Pagination & Group Pools)
  const originalXHROpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url) {
    this.__iepFlickrRequestUrl = url;
    this.addEventListener("load", function () {
      try {
        const text = this.responseText;
        const requestUrl = this.responseURL || this.__iepFlickrRequestUrl || "";
        if (isRelevantFlickrPayload(requestUrl, text)) {
          postFlickrPayload(text);
        }
      } catch (e) {}
    });
    return originalXHROpen.apply(this, arguments);
  };
}





