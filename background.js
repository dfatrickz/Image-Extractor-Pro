const api = browser;

const EXTRACTION_KEY_PREFIX = "iepExtraction:";
const EXTRACTION_INDEX_KEY = "iepExtractionIndex";
const MAX_STORED_SESSIONS = 5;
const CONTEXT_MENU_ID = "iep-extract-image";

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





