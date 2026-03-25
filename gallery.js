const api = browser;
const DOWNLOAD_ROOT_FOLDER = "Image Extractor Pro";
const ZIP_MIME_TYPE = "application/zip";
const ZIP_VERSION = 20;
const ZIP_STORE_METHOD = 0;
const ZIP_UTF8_FLAG = 0x0800;
const CRC32_TABLE = createCrc32Table();
const ZIP_TEXT_ENCODER = new TextEncoder();
const downloadObjectUrls = new Map();
const DUPLICATE_HASH_CONCURRENCY = 5;

class JSZip {
  constructor() {
    this.entries = [];
  }

  file(name, data) {
    const normalizedName = normalizeZipPath(name);

    if (!normalizedName) {
      throw new Error("ZIP entry name is empty.");
    }

    this.entries.push({ name: normalizedName, data });
    return this;
  }

  async generateAsync(options = {}) {
    if (options.type !== "blob") {
      throw new Error("This ZIP implementation only supports generateAsync({ type: \"blob\" }).");
    }

    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const dosDate = toDosDate(now);
    const dosTime = toDosTime(now);

    for (const entry of this.entries) {
      const nameBytes = ZIP_TEXT_ENCODER.encode(entry.name);
      const dataBytes = await toUint8Array(entry.data);
      const crc = crc32(dataBytes);
      const localHeader = createLocalFileHeader({
        crc,
        compressedSize: dataBytes.byteLength,
        uncompressedSize: dataBytes.byteLength,
        nameLength: nameBytes.byteLength,
        dosDate,
        dosTime
      });
      const centralHeader = createCentralDirectoryHeader({
        crc,
        compressedSize: dataBytes.byteLength,
        uncompressedSize: dataBytes.byteLength,
        nameLength: nameBytes.byteLength,
        dosDate,
        dosTime,
        localOffset
      });

      localParts.push(localHeader, nameBytes, dataBytes);
      centralParts.push(centralHeader, nameBytes);
      localOffset += localHeader.byteLength + nameBytes.byteLength + dataBytes.byteLength;
    }

    const centralDirectorySize = centralParts.reduce((total, part) => total + part.byteLength, 0);
    const endRecord = createEndOfCentralDirectoryRecord({
      entryCount: this.entries.length,
      centralDirectorySize,
      centralDirectoryOffset: localOffset
    });

    return new Blob([...localParts, ...centralParts, endRecord], {
      type: ZIP_MIME_TYPE
    });
  }
}

const pageTitleElement = document.getElementById("pageTitle");
const pageSubtitleElement = document.getElementById("pageSubtitle");
const sourceLinkElement = document.getElementById("sourceLink");
const totalCountElement = document.getElementById("totalCount");
const visibleCountElement = document.getElementById("visibleCount");
const selectedCountElement = document.getElementById("selectedCount");
const formatCountElement = document.getElementById("formatCount");
const statusBannerElement = document.getElementById("statusBanner");
const statusMessageElement = document.getElementById("statusMessage");
const duplicateStatusBannerElement = document.getElementById("duplicateStatusBanner");
const duplicateStatusMessageElement = document.getElementById("duplicateStatusMessage");
const duplicateToggleWrapElement = document.getElementById("duplicateToggleWrap");
const duplicateToggleElement = document.getElementById("duplicateToggle");
const manualDupeCheckButton = document.getElementById("btnManualDupeCheck");
const galleryLoadingOverlayElement = document.getElementById("galleryLoadingOverlay");
const loadingTextElement = document.getElementById("loadingText");
const loadingBarElement = document.getElementById("loadingBar");
const loadingPercentageElement = document.getElementById("loadingPercentage");
const emptyStateElement = document.getElementById("emptyState");
const emptyStateTitleElement = document.getElementById("emptyStateTitle");
const emptyStateMessageElement = document.getElementById("emptyStateMessage");
const galleryGridElement = document.getElementById("galleryGrid");
const galleryContentBoxElement = document.getElementById("galleryContentBox");
const galleryPaginationElement = document.getElementById("galleryPagination");
const galleryPrevPageButton = document.getElementById("galleryPrevPage");
const galleryNextPageButton = document.getElementById("galleryNextPage");
const galleryPaginationStatusElement = document.getElementById("galleryPaginationStatus");
const galleryControlsRowElement = document.querySelector(".iep-gallery-controls-row");
const selectAllButton = document.getElementById("selectAllButton");
const deselectAllButton = document.getElementById("deselectAllButton");
const downloadButton = document.getElementById("downloadButton");
const downloadButtonLabel = downloadButton.querySelector(".button-label");
const minWidthInput = document.getElementById("minWidthInput");
const minHeightInput = document.getElementById("minHeightInput");
const formatFilterSelect = document.getElementById("formatFilterSelect");
const resetFiltersButton = document.getElementById("resetFiltersButton");
const outputFormatSelect = document.getElementById("outputFormatSelect");
const qualityField = document.getElementById("qualityField");
const qualityInput = document.getElementById("qualityInput");
const qualityValue = document.getElementById("qualityValue");
const saveModeSelect = document.getElementById("saveModeSelect");
const folderNameInput = document.getElementById("folderNameInput");
const gallerySortSelect = document.getElementById("iepGallerySort");
const galleryDownloadModeSelect = document.getElementById("galleryDownloadModeSelect");
const downloadModeSummary = document.getElementById("downloadModeSummary");
const saveModeHint = document.getElementById("saveModeHint");
const resolveProgressBoxElement = document.querySelector(".iep-resolve-progress") || document.getElementById("iep-resolve-progress");
const deleteModalElement = document.getElementById("iepDeleteModal");
const hideDeleteWarningCheckbox = document.getElementById("iepHideDeleteWarning");
const cancelDeleteButton = document.getElementById("iepCancelDelete");
const confirmDeleteButton = document.getElementById("iepConfirmDelete");
const backToTopButton = document.getElementById("iep-back-to-top");
const stickyStatsElement = document.getElementById("iep-sticky-stats");
const imageCardTemplate = document.getElementById("imageCardTemplate");
const collapsibles = document.querySelectorAll(".iep-collapsible-card");
const SELECTED_INDICATOR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';
let loadingOverlayFrame = 0;
let pendingLoadingOverlayState = null;
let originalOrder = [];
window.flickrFailedItems = window.flickrFailedItems || [];
window.flickrUpgradedCount = window.flickrUpgradedCount || 0;
window.iepSettings = window.iepSettings || {};
window.iepCancelUpgrade = false;

// Synchronize the Filters and Download Options panels
let isSyncing = false;
collapsibles.forEach((card) => {
  card.addEventListener("toggle", (e) => {
    if (isSyncing) return;
    isSyncing = true;
    const isOpen = e.target.open;
    collapsibles.forEach((c) => {
      if (c !== e.target) c.open = isOpen;
    });
    isSyncing = false;
  });
});

const state = {
  sessionId: new URLSearchParams(window.location.search).get("session") || "",
  session: null,
  images: [],
  isDownloading: false,
  isAnalyzingDuplicates: false,
  showDuplicates: false,
  duplicateCount: 0,
  downloadPreferences: createDefaultDownloadPreferences(),
  gallerySettings: {
    autoUpgradeResolutions: false,
    autoCheckDuplicates: false,
    hideDeleteWarning: false,
    downloadMode: "zip",
    stickyToolbar: true,
    windowScale: "big",
    themeStyle: "standard",
    galleryPagination: "unlimited"
  },
  isResolvingFlickrQueue: false,
  resolveQueuePromise: null,
  manualUpgradeCancellable: false,
  hasDuplicateCheckRun: false,
  pendingDelete: null,
  currentPage: 1
};

const imageCacheManager = {
  cacheName: "iep-gallery-cache",
  blobUrls: new Map(),

  async get(url) {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
    if (this.blobUrls.has(url)) return this.blobUrls.get(url);
    if (api.extension.inIncognitoContext) {
      try {
        const response = await fetch(url, { credentials: "omit" }).catch(() => null);
        if (response && response.ok) {
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.blobUrls.set(url, blobUrl);
          return blobUrl;
        }
        return url;
      } catch (_error) {
        return url;
      }
    }
    if (!("caches" in window)) return url;

    try {
      const cache = await caches.open(this.cacheName);
      let response = await cache.match(url);

      if (!response) {
        response = await fetch(url, { credentials: "omit" }).catch(() => null);
        if (response && response.ok) {
          await cache.put(url, response.clone());
        } else {
          return url;
        }
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrls.set(url, blobUrl);
      return blobUrl;
    } catch (_error) {
      return url;
    }
  },

  preload(url) {
    if (!url || this.blobUrls.has(url)) return;
    this.get(url).catch(() => {});
  }
};

window.flickrNetworkCache = window.flickrNetworkCache || [];
window.flickrApiKey = window.flickrApiKey || "";

function isFlickrUrl(url) {
  return String(url || "").includes("flickr.com");
}

function shouldAutoUpgradeResolutions() {
  return Boolean(window.iepSettings?.autoUpgradeResolutions);
}

function getDisplayedFlickrCards(options = {}) {
  const onlyPending = Boolean(options.onlyPending);
  return Array.from(document.querySelectorAll(".image-card")).filter((card) => {
    if (!card || card.hidden || window.getComputedStyle(card).display === "none") {
      return false;
    }

    const clientId = card.dataset.clientId || "";
    const image = state.images.find((entry) => entry.clientId === clientId);
    const url = card.dataset.url || image?.url || "";
    if (!image || !isFlickrUrl(url)) {
      return false;
    }

    if (onlyPending && image.isUpgraded) {
      return false;
    }

    return true;
  });
}

function canShowManualUpgradeAction() {
  const currentUrl = String(state.session?.sourceUrl || "");
  return isFlickrUrl(currentUrl) && !shouldAutoUpgradeResolutions() && getDisplayedFlickrCards({ onlyPending: true }).length > 0;
}

function getResolveContainer() {
  return document.querySelector(".iep-resolve-progress") || resolveProgressBoxElement || document.getElementById("iep-resolve-progress");
}

function getResolveControl(id) {
  return getResolveContainer()?.querySelector(id) || null;
}

function renderResolveContainer(markup, display = "flex") {
  const resolveContainer = getResolveContainer();
  if (!resolveContainer) {
    return null;
  }

  resolveContainer.style.display = display;
  resolveContainer.innerHTML = markup;
  return resolveContainer;
}

function hideResolveContainer() {
  const resolveContainer = getResolveContainer();
  if (resolveContainer) {
    resolveContainer.style.display = "none";
  }
}

function buildResolveSpinnerMarkup() {
  return '<span id="iep-resolve-spinner" class="spinner" style="width: 14px; height: 14px; border: 2px solid #f59e0b; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 1s linear infinite;"></span>';
}

function buildResolveRetryMarkup() {
  return '<button id="iep-retry-resolve" style="background: #f59e0b; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Retry</button>';
}

function startRetryResolveQueue() {
  window.iepCancelUpgrade = false;
  state.manualUpgradeCancellable = true;
  renderResolveProgressState("Upgrading Resolutions: 0/0", {
    showSpinner: true,
    showCancel: true,
    color: "#f59e0b"
  });
  state.resolveQueuePromise = processFlickrQueue([], true, { cancellable: true });
  void state.resolveQueuePromise;
}

function renderResolveProgressState(text, options = {}) {
  const {
    color = "#f59e0b",
    showSpinner = false,
    showRetry = false,
    showCancel = false,
    fontWeight = 600
  } = options;

  const cancelMarkup = showCancel
    ? '<button id="btnCancelUpgrade" class="iep-btn-cancel-small" type="button">Cancel</button>'
    : "";
  const retryMarkup = showRetry ? buildResolveRetryMarkup() : "";
  const spinnerMarkup = showSpinner ? buildResolveSpinnerMarkup() : "";
  const resolveContainer = renderResolveContainer(
    `${spinnerMarkup}<span id="iep-resolve-text" style="font-size: 12px;${color ? ` color: ${color};` : ""}${fontWeight ? ` font-weight: ${fontWeight};` : ""}">${text}</span>${cancelMarkup}${retryMarkup}`
  );

  if (!resolveContainer) {
    return;
  }

  const cancelButton = resolveContainer.querySelector("#btnCancelUpgrade");
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      window.iepCancelUpgrade = true;
      renderResolveProgressState("Upgrade Cancelled", {
        color: "#ef4444",
        showSpinner: false,
        fontWeight: 600
      });
    });
  }

  const retryButton = resolveContainer.querySelector("#iep-retry-resolve");
  if (retryButton) {
    retryButton.addEventListener("click", () => {
      startRetryResolveQueue();
    });
  }
}

function updateResolveProgressText(text) {
  const textElement = getResolveControl("#iep-resolve-text");
  if (textElement) {
    textElement.textContent = text;
  }
}

function renderResolveManualAction() {
  const guideUrl = `${api.runtime.getURL("guide.html")}#auto-upgrade`;
  const resolveContainer = renderResolveContainer(
    `<button id="btnManualUpgrade" class="iep-btn-amber-small" type="button">Upgrade Resolutions</button><a href="${guideUrl}" target="_blank" rel="noreferrer noopener" class="iep-help-btn-gallery" title="Visits each image link in the background to find higher resolution photos.">&#63;</a>`
  );

  if (!resolveContainer) {
    return;
  }

  const manualButton = resolveContainer.querySelector("#btnManualUpgrade");
  if (manualButton) {
    manualButton.disabled = state.isDownloading || state.isResolvingFlickrQueue;
    manualButton.addEventListener("click", () => {
      void handleManualResolutionUpgrade();
    });
  }
}

function syncResolveProgressContainer() {
  const currentUrl = String(state.session?.sourceUrl || "");
  const isFlickr = currentUrl.includes("flickr.com");
  const resolveContainer = getResolveContainer();

  if (!resolveContainer) {
    return;
  }

  if (state.isResolvingFlickrQueue) {
    resolveContainer.style.display = "flex";
    return;
  }

  if (!isFlickr) {
    hideResolveContainer();
    return;
  }

  if (!window.iepSettings?.autoUpgradeResolutions) {
    if (!canShowManualUpgradeAction()) {
      hideResolveContainer();
      return;
    }

    renderResolveManualAction();
    return;
  }

  renderResolveProgressState("Auto-upgrading resolutions...", {
    color: "inherit",
    showSpinner: false,
    fontWeight: 400
  });
}

function queueVisibleFlickrUpgradesIfNeeded() {
  if (!shouldAutoUpgradeResolutions() || state.resolveQueuePromise || state.isResolvingFlickrQueue) {
    return;
  }

  const cards = getDisplayedFlickrCards({ onlyPending: true });
  if (!cards.length) {
    return;
  }

  state.resolveQueuePromise = processFlickrQueue(cards);
  void state.resolveQueuePromise;
}

async function resolveImageForDownload(image) {
  if (!image) {
    return image;
  }

  if (!shouldAutoUpgradeResolutions() || !isFlickrUrl(image.url)) {
    return image;
  }

  const resolvedData = await window.getTrueFlickrMax(image.url);
  return mergeResolvedImageData(image, resolvedData);
}

window.getTrueFlickrMax = async function(thumbUrl) {
  const fallback = { url: thumbUrl, width: null, height: null };
  if (!thumbUrl.includes("flickr.com")) return fallback;

  const cacheKey = "iep_flickr_cache";
  const storageLocal = (typeof chrome !== "undefined" && chrome?.storage?.local)
    ? chrome.storage.local
    : api.storage.local;
  const useCallbackStorage = typeof chrome !== "undefined" && chrome?.storage?.local && storageLocal === chrome.storage.local;

  async function readCacheStore() {
    if (!storageLocal) {
      return {};
    }
    if (useCallbackStorage) {
      return await new Promise((resolve) => storageLocal.get(cacheKey, resolve));
    }
    return await storageLocal.get([cacheKey]);
  }

  async function writeCacheStore(value) {
    if (!storageLocal || api.extension.inIncognitoContext) {
      return;
    }
    if (useCallbackStorage) {
      await new Promise((resolve) => storageLocal.set(value, resolve));
      return;
    }
    await storageLocal.set(value);
  }

  try {
    const stored = await readCacheStore();
    const urlCache = stored?.[cacheKey] || {};

    if (urlCache[thumbUrl]) {
      console.log("[IEP Debug] 🟢 Loaded from Persistent Cache!");
      const cached = urlCache[thumbUrl];
      return { ...cached, fromCache: true };
    }
  } catch (error) {
    console.warn("Cache read failed", error);
  }

  async function saveAndReturn(result) {
    try {
      const stored = await readCacheStore();
      const urlCache = stored?.[cacheKey] || {};
      const toSave = { ...result };
      delete toSave.fromCache;
      urlCache[thumbUrl] = toSave;
      await writeCacheStore({ [cacheKey]: urlCache });
    } catch (error) {
      console.warn("Cache write failed", error);
    }
    result.fromCache = false;
    return result;
  }

  const match = thumbUrl.match(/live\.staticflickr\.com\/(\d+)\/(\d+)_([a-fA-F0-9]+)/);
  if (!match) return fallback;

  const serverId = match[1];
  const photoId = match[2];
  const premiumSizes = ["o", "6k", "5k", "4k", "3k", "k", "h"];
  const allSizes = ["o", "6k", "5k", "4k", "3k", "k", "h", "b", "c", "z"];

  function getDims(text, sizeLetter) {
    const dimMatch = text.match(new RegExp(`"${sizeLetter}"\\s*:\\s*\\{[^{}]*"width"\\s*:\\s*(\\d+)[^{}]*"height"\\s*:\\s*(\\d+)`, "i"));
    if (dimMatch) return { width: Number.parseInt(dimMatch[1], 10), height: Number.parseInt(dimMatch[2], 10) };

    const flatMatch = text.match(new RegExp(`"width_${sizeLetter}"\\s*:\\s*(\\d+).*?"height_${sizeLetter}"\\s*:\\s*(\\d+)`, "i"));
    if (flatMatch) return { width: Number.parseInt(flatMatch[1], 10), height: Number.parseInt(flatMatch[2], 10) };

    if (sizeLetter === "o") {
      const originalMatch = text.match(/"originalwidth"\s*:\s*(\d+).*?"originalheight"\s*:\s*(\d+)/i)
        || text.match(/"o_width"\s*:\s*(\d+).*?"o_height"\s*:\s*(\d+)/i);
      if (originalMatch) {
        return {
          width: Number.parseInt(originalMatch[1], 10),
          height: Number.parseInt(originalMatch[2], 10)
        };
      }
    }

    return { width: null, height: null };
  }

  function scanTextForUrls(text, sizeArray) {
    const osMatch = text.match(/"originalsecret"\s*:\s*"([a-zA-Z0-9]+)"/);
    if (osMatch) {
      const ofMatch = text.match(/"originalformat"\s*:\s*"([a-zA-Z0-9]+)"/);
      const dims = getDims(text, "o");
      return {
        url: `https://live.staticflickr.com/${serverId}/${photoId}_${osMatch[1]}_o.${ofMatch ? ofMatch[1] : "jpg"}`,
        width: dims.width,
        height: dims.height
      };
    }

    for (let size of sizeArray) {
      const sizeMatch = text.match(new RegExp(photoId + `_([a-zA-Z0-9]+)_${size}\\.([a-zA-Z]+)`, "i"));
      if (sizeMatch) {
        const dims = getDims(text, size);
        return {
          url: `https://live.staticflickr.com/${serverId}/${photoId}_${sizeMatch[1]}_${size}.${sizeMatch[2]}`,
          width: dims.width,
          height: dims.height
        };
      }
    }
    return null;
  }

  const isFlickrPage = window.location.hostname.includes("flickr.com");
  const rawDom = isFlickrPage ? document.documentElement.innerHTML : "";
  const cacheData = typeof window.flickrNetworkCache !== "undefined" ? JSON.stringify(window.flickrNetworkCache) : "";
  const searchGround = cacheData + " " + rawDom;

  console.log(`[IEP Debug] Deep Scanning:`, thumbUrl);
  const fastResult = scanTextForUrls(searchGround, premiumSizes);
  if (fastResult) {
    console.log(`[IEP Debug] 🟢 FAST PATH SUCCESS!`);
    return saveAndReturn(fastResult);
  }

  // --- 2. BACKGROUND FETCH PATH ---
  console.log(`[IEP Debug] 🟡 [ID: ${photoId}] Fast Path missed. Fetching HTML...`);
  const controller = new AbortController();
  let timeoutId;
  try {
    const pageUrl = `https://www.flickr.com/photo.gne?id=${photoId}`;

    // 8-second timeout to prevent tarpitting
    timeoutId = setTimeout(() => controller.abort(), 8000);

    console.log(`[IEP Debug] ⏳ [ID: ${photoId}] Firing request...`);
    const res = await fetch(pageUrl, {
      credentials: "omit",
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (false) {
    console.warn(`[IEP Debug] 🛑 TIMEOUT: Flickr delayed the response for ${photoId}. Aborting to prevent freeze.`);
    console.error(`[IEP Debug] ❌ Background Fetch FAILED for ${photoId}:`, e);
    console.log(`[IEP Debug] 📥 [ID: ${photoId}] Headers received. Status: ${res.status}`);

    }
    if (!res.ok) {
      console.warn(`[IEP Debug] ⚠️ [ID: ${photoId}] Bad HTTP Status: ${res.status}`);
    }

    console.log(`[IEP Debug] ⏳ [ID: ${photoId}] Reading text body...`);
    const htmlText = await res.text();
    console.log(`[IEP Debug] 📖 [ID: ${photoId}] Text read complete (${htmlText.length} chars). Scanning...`);

    const fetchResult = scanTextForUrls(htmlText, allSizes);
    if (fetchResult) {
      console.log(`[IEP Debug] 🟢 [ID: ${photoId}] SUCCESS! Upgraded.`);
      console.log(`[IEP Debug] 🟢 FETCH SUCCESS!`);
      return saveAndReturn(fetchResult);
    } else {
      console.log(`[IEP Debug] ❌ [ID: ${photoId}] Scanned, but no max sizes found.`);
    }
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      console.warn(`[IEP Debug] 🛑 TIMEOUT: Flickr delayed the response for ${photoId}. Aborting to prevent freeze.`);
      console.error(`[IEP Debug] 🛑 [ID: ${photoId}] FETCH TIMED OUT (10s). Flickr is throttling or hanging the connection.`);
    } else {
      console.error(`[IEP Debug] ❌ Background Fetch FAILED for ${photoId}:`, e);
      console.error(`[IEP Debug] ❌ [ID: ${photoId}] Fetch FAILED:`, e.message);
    }
    console.error("[IEP Debug] ❌ Background Fetch FAILED:", e);
  }

  console.log(`[IEP Debug] ⚠️ ALL METHODS FAILED.`);
  console.log(`[IEP Debug] ⚠️ [ID: ${photoId}] ALL METHODS FAILED.`);
  return fallback;
};
applyTheme(state.downloadPreferences.theme);
selectAllButton.addEventListener("click", () => setVisibleSelections(true));
deselectAllButton.addEventListener("click", clearAllSelections);
downloadButton.addEventListener("click", handleDownloadSelected);
galleryGridElement.addEventListener("click", handleGridClick);
galleryGridElement.addEventListener("keydown", handleGridKeydown);
minWidthInput.addEventListener("input", () => {
  state.currentPage = 1;
  render();
});
minHeightInput.addEventListener("input", () => {
  state.currentPage = 1;
  render();
});
formatFilterSelect.addEventListener("change", () => {
  state.currentPage = 1;
  render();
});
resetFiltersButton.addEventListener("click", resetFilters);
outputFormatSelect.addEventListener("change", updateDownloadControls);
qualityInput.addEventListener("input", updateDownloadControls);
saveModeSelect.addEventListener("change", updateDownloadControls);
folderNameInput.addEventListener("input", updateDownloadControls);
duplicateToggleElement.addEventListener("change", handleDuplicateToggle);
gallerySortSelect?.addEventListener("change", () => {
  state.currentPage = 1;
  render();
});
galleryDownloadModeSelect?.addEventListener("change", () => {
  state.downloadPreferences.downloadMode = galleryDownloadModeSelect.value;
  updateDownloadControls();
});
galleryPrevPageButton?.addEventListener("click", () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  render();
});
galleryNextPageButton?.addEventListener("click", () => {
  state.currentPage += 1;
  render();
});
manualDupeCheckButton?.addEventListener("click", () => {
  void handleManualDuplicateCheck();
});
cancelDeleteButton?.addEventListener("click", hideDeleteModal);
confirmDeleteButton?.addEventListener("click", () => {
  void confirmDeleteModal();
});

api.downloads.onChanged.addListener((delta) => {
  if (!delta.id || !delta.state?.current) {
    return;
  }

  if (delta.state.current === "complete" || delta.state.current === "interrupted") {
    releaseDownloadObjectUrl(delta.id);
  }
});

window.addEventListener("beforeunload", () => {
  for (const objectUrl of downloadObjectUrls.values()) {
    URL.revokeObjectURL(objectUrl);
  }
  downloadObjectUrls.clear();
});

if (backToTopButton) {
  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      backToTopButton.style.display = "block";
    } else {
      backToTopButton.style.display = "none";
    }

    if (stickyStatsElement) {
      if (window.scrollY > 120) {
        stickyStatsElement.style.opacity = "1";
      } else {
        stickyStatsElement.style.opacity = "0";
      }
    }
  });

  backToTopButton.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

initialize();

async function initialize() {
  state.gallerySettings = await loadGallerySettings();
  window.iepSettings = { ...state.gallerySettings };
  applyGalleryTheme(state.gallerySettings.themeStyle);
  if (galleryControlsRowElement) {
    galleryControlsRowElement.classList.toggle("iep-sticky-header-wrapper", Boolean(state.gallerySettings.stickyToolbar));
  }
  state.isAnalyzingDuplicates = false;
  state.showDuplicates = false;
  state.duplicateCount = 0;
  state.hasDuplicateCheckRun = false;
  state.pendingDelete = null;
  showLoadingOverlay("Processing Images...", 0);
  setStatus("Loading extraction results...", "default");
  setControlsDisabled(true);
  updateDownloadControls();
  renderDuplicateStatus();

  try {
    const response = await api.runtime.sendMessage({
      type: "IEP_GET_SESSION",
      sessionId: state.sessionId
    });

    if (!response?.ok || !response.session) {
      throw new Error(response?.error || "No extraction results are available.");
    }

    state.session = response.session;
    if (typeof response.session.autoUpgradeResolutions === "boolean") {
      state.gallerySettings.autoUpgradeResolutions = response.session.autoUpgradeResolutions;
      window.iepSettings = {
        ...window.iepSettings,
        autoUpgradeResolutions: response.session.autoUpgradeResolutions
      };
    }
    state.downloadPreferences = normalizeDownloadPreferences(response.session);
    applyTheme(state.downloadPreferences.theme);
    window.flickrNetworkCache = Array.isArray(response.session.flickrNetworkCache) ? response.session.flickrNetworkCache : [];
    window.flickrApiKey = response.session.flickrApiKey || "";
    const initialDownloadMode = state.downloadPreferences.downloadMode || state.gallerySettings.downloadMode;
    state.downloadPreferences.downloadMode = initialDownloadMode;
    if (galleryDownloadModeSelect) {
      galleryDownloadModeSelect.value = initialDownloadMode;
    }
    state.images = Array.isArray(response.session.images)
      ? response.session.images.map((image, index) => ({
          ...image,
          thumbUrl: image.thumbUrl || image.url,
          selected: false,
          isDuplicate: false,
          duplicateReason: "",
          clientId: `${index}-${hashString(image.url || String(index))}`
        }))
      : [];
    originalOrder = [...state.images];
    state.isResolvingFlickrQueue = false;

    const preferredFolder = normalizeRelativePath(
      state.downloadPreferences.subfolderName
        || state.session.pageTitle
        || "Extracted Images"
    );

    if (!folderNameInput.value) {
      folderNameInput.value = preferredFolder || "Extracted Images";
    }

    updateDownloadControls();

    if (state.images.length) {
      if (state.gallerySettings.autoCheckDuplicates) {
        await runDuplicateCheck();
        setStatus(`Loaded ${state.images.length} images`, "success");
      } else {
        state.duplicateCount = 0;
        state.hasDuplicateCheckRun = false;
        setStatus(`Loaded ${state.images.length} images`, "success");
      }
    } else {
      state.duplicateCount = 0;
      setStatus("No qualifying images were found for this page.", "default");
    }

    render();
    queueVisibleFlickrUpgradesIfNeeded();
  } catch (error) {
    state.session = null;
    state.images = [];
    state.isAnalyzingDuplicates = false;
    state.showDuplicates = false;
    state.duplicateCount = 0;
    state.isResolvingFlickrQueue = false;
    state.resolveQueuePromise = null;
    state.downloadPreferences = createDefaultDownloadPreferences();
    applyTheme(state.downloadPreferences.theme);
    render();
    setStatus(error.message || "Could not load the extraction gallery.", "error");
  } finally {
    hideLoadingOverlay();
  }
}

function render() {
  const matchingImages = getSortedImages(getMatchingImages());
  const visibleImages = getVisibleImages(matchingImages);
  const paginationState = getPaginationState(visibleImages);
  const selectedImages = state.images.filter((image) => image.selected);
  const visibleFormats = new Set(visibleImages.map((image) => getFormatKey(image)));

  pageTitleElement.textContent = state.session?.pageTitle || "Extraction results unavailable";
  pageSubtitleElement.textContent = buildSubtitle();

  if (state.session?.sourceUrl) {
    sourceLinkElement.href = state.session.sourceUrl;
    sourceLinkElement.hidden = false;
  } else {
    sourceLinkElement.hidden = true;
  }

  totalCountElement.textContent = String(state.images.length);
  visibleCountElement.textContent = String(visibleImages.length);
  selectedCountElement.textContent = String(selectedImages.length);
  formatCountElement.textContent = String(visibleFormats.size);
  galleryGridElement.classList.toggle("show-duplicates", state.showDuplicates);
  updateDownloadButtonState(selectedImages.length);

  renderDuplicateStatus();
  renderEmptyState(matchingImages, visibleImages);
  renderGrid(paginationState.items);
  renderPagination(paginationState);
  updateStickyStats(selectedImages.length);
  syncResolveProgressContainer();
  setControlsDisabled(
    state.images.length === 0 || state.isDownloading || state.isAnalyzingDuplicates,
    visibleImages.length === 0,
    selectedImages.length === 0
  );
  queueVisibleFlickrUpgradesIfNeeded();
}

function renderDuplicateStatus() {
  const duplicateCount = state.images.filter((image) => image.isDuplicate).length;
  state.duplicateCount = duplicateCount;

  duplicateToggleElement.checked = state.showDuplicates;
  duplicateToggleElement.disabled = state.isAnalyzingDuplicates || duplicateCount === 0;
  duplicateToggleWrapElement.hidden = state.isAnalyzingDuplicates || duplicateCount === 0;
  duplicateStatusBannerElement.classList.toggle("has-duplicates", duplicateCount > 0);
  if (manualDupeCheckButton) {
    manualDupeCheckButton.disabled = state.isAnalyzingDuplicates || state.images.length === 0;
    manualDupeCheckButton.textContent = state.hasDuplicateCheckRun ? "Check Again" : "Check for duplicates";
  }

  if (!state.hasDuplicateCheckRun) {
    duplicateStatusBannerElement.dataset.tone = "default";
    duplicateStatusBannerElement.classList.remove("has-duplicates");
    duplicateStatusMessageElement.textContent = "Duplicates not checked";
    return;
  }

  if (state.isAnalyzingDuplicates && state.images.length) {
    duplicateStatusBannerElement.dataset.tone = "default";
    duplicateStatusMessageElement.textContent = "Scanning for duplicates...";
    return;
  }

  if (duplicateCount > 0) {
    duplicateStatusBannerElement.dataset.tone = "duplicate";
    duplicateStatusMessageElement.textContent = state.showDuplicates
      ? `${duplicateCount} duplicates shown`
      : `${duplicateCount} duplicates hidden`;
    return;
  }

  duplicateStatusBannerElement.dataset.tone = "default";
  duplicateStatusMessageElement.textContent = "No duplicates found";
}

function buildSubtitle() {
  if (state.session?.selectionLabel && state.session?.sourceUrl) {
    return `Selection: ${state.session.selectionLabel} | Source: ${state.session.sourceUrl}`;
  }

  if (state.session?.selectionLabel) {
    return `Selection: ${state.session.selectionLabel}`;
  }

  if (state.session?.sourceUrl) {
    return `Source: ${state.session.sourceUrl}`;
  }

  return "Review the detected images, fine-tune your selection, and batch-download the final set.";
}

function applyGalleryTheme(themeStyle) {
  if (!galleryContentBoxElement) {
    return;
  }

  galleryContentBoxElement.classList.remove("theme-minimal", "theme-standard", "theme-rich");
  galleryContentBoxElement.classList.add(`theme-${themeStyle || "standard"}`);
}

function getPaginationLimit() {
  const rawValue = String(state.gallerySettings.galleryPagination || "unlimited").toLowerCase();
  if (rawValue === "unlimited") {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function getPaginationState(images) {
  const limit = getPaginationLimit();
  if (!Number.isFinite(limit)) {
    state.currentPage = 1;
    return {
      currentPage: 1,
      totalPages: 1,
      items: images,
      totalItems: images.length,
      limit
    };
  }

  const totalPages = Math.max(1, Math.ceil(images.length / limit));
  state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
  const startIndex = (state.currentPage - 1) * limit;

  return {
    currentPage: state.currentPage,
    totalPages,
    items: images.slice(startIndex, startIndex + limit),
    totalItems: images.length,
    limit
  };
}

function renderPagination(paginationState) {
  if (!galleryPaginationElement || !galleryPrevPageButton || !galleryNextPageButton || !galleryPaginationStatusElement) {
    return;
  }

  if (!Number.isFinite(paginationState.limit) || paginationState.totalItems <= paginationState.limit) {
    galleryPaginationElement.hidden = true;
    return;
  }

  galleryPaginationElement.hidden = false;
  galleryPaginationStatusElement.textContent = `Page ${paginationState.currentPage} of ${paginationState.totalPages}`;
  galleryPrevPageButton.disabled = paginationState.currentPage <= 1;
  galleryNextPageButton.disabled = paginationState.currentPage >= paginationState.totalPages;
}

function renderEmptyState(matchingImages, visibleImages) {
  if (state.isAnalyzingDuplicates && state.images.length) {
    emptyStateElement.hidden = true;
    galleryGridElement.hidden = true;
    return;
  }

  if (!state.images.length) {
    emptyStateTitleElement.textContent = "No qualifying images found";
    emptyStateMessageElement.textContent = "Try a richer media page, or rerun extraction after the page has fully loaded and lazy-loaded content is visible.";
    emptyStateElement.hidden = false;
    galleryGridElement.hidden = true;
    return;
  }

  if (!matchingImages.length) {
    emptyStateTitleElement.textContent = "No images match the current filters";
    emptyStateMessageElement.textContent = "Lower the minimum size or switch the format filter back to All formats to show more results.";
    emptyStateElement.hidden = false;
    galleryGridElement.hidden = true;
    return;
  }

  if (!visibleImages.length) {
    const hiddenDuplicateCount = matchingImages.filter((image) => image.isDuplicate).length;

    if (!state.showDuplicates && hiddenDuplicateCount) {
      emptyStateTitleElement.textContent = "Matching images are hidden as duplicates";
      emptyStateMessageElement.textContent = `${hiddenDuplicateCount} matching image${hiddenDuplicateCount === 1 ? " is" : "s are"} currently hidden. Turn on Show duplicates to review them.`;
    } else {
      emptyStateTitleElement.textContent = "No images match the current filters";
      emptyStateMessageElement.textContent = "Lower the minimum size or switch the format filter back to All formats to show more results.";
    }

    emptyStateElement.hidden = false;
    galleryGridElement.hidden = true;
    return;
  }

  emptyStateElement.hidden = true;
  galleryGridElement.hidden = false;
}

function renderGrid(matchingImages) {
  galleryGridElement.replaceChildren();
  galleryGridElement.classList.toggle("show-duplicates", state.showDuplicates);

  if (!matchingImages.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  matchingImages.forEach((image) => {
    const card = imageCardTemplate.content.firstElementChild.cloneNode(true);
    const selectedIndicator = card.querySelector(".selected-indicator");
    const previewImage = card.querySelector("img");
    let mediaFallback = card.querySelector(".media-fallback");
    const formatPill = card.querySelector(".format-pill");
    const sourcePill = card.querySelector(".source-pill");
    const titleElement = card.querySelector(".card-title");
    const altElement = card.querySelector(".card-alt");
    let urlElement = card.querySelector(".card-url");
    const dimensionsElement = card.querySelector(".card-dimensions");
    const renderedDimensionsElement = card.querySelector(".card-rendered-dimensions");
    const openLink = card.querySelector(".card-open-link");
    const deleteButton = card.querySelector(".iep-delete-card-btn");

    card.dataset.clientId = image.clientId;
    card.dataset.url = image.url || "";
    card.dataset.width = String(getBestWidth(image));
    card.dataset.height = String(getBestHeight(image));
    card.dataset.orderIndex = String(getOriginalOrderIndex(image));
    card.classList.toggle("is-selected", image.selected);
    card.classList.toggle("is-duplicate", Boolean(image.isDuplicate));
    card.setAttribute("aria-pressed", image.selected ? "true" : "false");
    if (selectedIndicator) {
      selectedIndicator.innerHTML = SELECTED_INDICATOR_SVG;
    }

    if (mediaFallback) {
      const noPreviewContainer = document.createElement("div");
      noPreviewContainer.className = "media-fallback no-preview-container";
      noPreviewContainer.style.cssText = "display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; color: #94a3b8;";
      noPreviewContainer.innerHTML = '<span style="font-weight: 500; margin-bottom: 4px;">Preview Unavailable</span><span style="font-size: 11px; opacity: 0.7;">Blocked by website</span>';
      mediaFallback.replaceWith(noPreviewContainer);
      mediaFallback = noPreviewContainer;
    }

    if (urlElement && urlElement.tagName !== "A") {
      const urlLink = document.createElement("a");
      urlLink.className = urlElement.className;
      urlLink.target = "_blank";
      urlLink.rel = "noreferrer noopener";
      urlElement.replaceWith(urlLink);
      urlElement = urlLink;
    }

    previewImage.hidden = false;
    previewImage.style.display = "";
    previewImage.classList.add("card-image");
    previewImage.setAttribute("loading", "lazy");
    mediaFallback.style.display = "none";
    previewImage.removeAttribute("onerror");
    previewImage.alt = image.altText || "Extracted image preview";
    previewImage.addEventListener("load", () => {
      previewImage.hidden = false;
      previewImage.style.display = "";
      mediaFallback.style.display = "none";
    }, { once: true });
    previewImage.addEventListener("error", () => {
      previewImage.hidden = true;
      previewImage.style.display = "none";
      mediaFallback.style.display = "flex";
    }, { once: true });
    const thumbSrc = image.thumbUrl || image.url;

    if (typeof imageCacheManager !== "undefined" && imageCacheManager.blobUrls.has(thumbSrc)) {
      previewImage.src = imageCacheManager.blobUrls.get(thumbSrc);
    } else {
      previewImage.src = thumbSrc;

      if (typeof imageCacheManager !== "undefined") {
        imageCacheManager.get(thumbSrc).then((blobUrl) => {
          if (previewImage.src !== blobUrl && document.body.contains(previewImage)) {
            previewImage.src = blobUrl;
          }
        }).catch(() => {});
      }
    }

    formatPill.textContent = getFormatLabel(image);
    sourcePill.textContent = prettifySourceType(image.sourceType);
    titleElement.textContent = image.altText || image.filenameHint || getHostLabel(image.url);
    altElement.textContent = image.altText || "No alt text available for this asset.";
    urlElement.textContent = trimUrlForDisplay(image.url);
    urlElement.href = image.url;
    urlElement.classList.toggle("res-upgraded", Boolean(image.isUpgraded));
    dimensionsElement.textContent = image.isUpgraded && getBestWidth(image) && getBestHeight(image)
      ? `${getBestWidth(image)} × ${getBestHeight(image)}`
      : formatSourceDimensions(image);
    dimensionsElement.classList.toggle("res-upgraded", Boolean(image.isUpgraded));
    if (image.isUpgraded && getBestWidth(image) && getBestHeight(image)) {
      dimensionsElement.textContent = `Source ${getBestWidth(image)} x ${getBestHeight(image)}`;
    }
    renderedDimensionsElement.textContent = formatRenderedDimensions(image);
    renderedDimensionsElement.hidden = !renderedDimensionsElement.textContent;
    openLink.href = image.url;
    openLink.textContent = "View";
    openLink.classList.add("iep-btn-view");
    attachLightboxTrigger(openLink, image.url);
    if (deleteButton) {
      deleteButton.dataset.url = image.url || "";
      deleteButton.dataset.clientId = image.clientId;
    }

    fragment.appendChild(card);
  });

  galleryGridElement.appendChild(fragment);
}

function attachLightboxTrigger(element, imageUrl) {
  if (!element || !imageUrl) {
    return;
  }

  element.removeAttribute("onclick");
  element.dataset.lightboxUrl = imageUrl;
  element.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.openLightbox(element.dataset.lightboxUrl || imageUrl);
  };
}

function getSortedImages(images) {
  const sortMode = gallerySortSelect?.value || "default";
  if (sortMode === "default") {
    return [...images].sort((left, right) => getOriginalOrderIndex(left) - getOriginalOrderIndex(right));
  }

  const sorted = [...images].sort((left, right) => {
    const areaDifference = getImageScore(left) - getImageScore(right);
    if (areaDifference !== 0) {
      return sortMode === "desc" ? -areaDifference : areaDifference;
    }

    return getOriginalOrderIndex(left) - getOriginalOrderIndex(right);
  });

  return sorted;
}

function getOriginalOrderIndex(image) {
  const index = originalOrder.findIndex((entry) => entry.clientId === image.clientId || entry.url === image.url);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function getMatchingImages() {
  if (state.isAnalyzingDuplicates) {
    return [];
  }

  return state.images.filter((image) => matchesActiveFilters(image));
}

function getVisibleImages(images = getMatchingImages()) {
  return state.showDuplicates
    ? images
    : images.filter((image) => !image.isDuplicate);
}

function matchesActiveFilters(image) {
  const minWidth = Number.parseInt(minWidthInput.value || "0", 10) || 0;
  const minHeight = Number.parseInt(minHeightInput.value || "0", 10) || 0;
  const formatFilter = formatFilterSelect.value;
  const width = getBestWidth(image);
  const height = getBestHeight(image);
  const formatKey = getFormatKey(image);

  if (formatFilter !== "all" && formatKey !== formatFilter) {
    return false;
  }

  if (minWidth && width && width < minWidth) {
    return false;
  }

  if (minHeight && height && height < minHeight) {
    return false;
  }

  return true;
}

function handleGridClick(event) {
  const deleteButton = event.target.closest(".iep-delete-card-btn");
  const fastDownloadBtn = event.target.closest(".card-fast-download");
  if (fastDownloadBtn) {
    event.preventDefault();
    event.stopPropagation();
    const card = fastDownloadBtn.closest(".image-card");
    const url = card?.dataset.url;
    const clientId = card?.dataset.clientId;
    
    if (url) {
      // Calculate the proper filename and extension using the existing gallery helper
      let filename = undefined;
      const image = state.images.find((img) => img.clientId === clientId);
      if (image) {
        const extension = detectOriginalExtension(image) || "jpg";
        filename = getOriginalDownloadFilename(url, extension, 1);
      }

      api.downloads.download({ url, filename, saveAs: false }).catch(() => {});
      // Flash green to show success
      fastDownloadBtn.style.background = "#16a34a";
      fastDownloadBtn.style.color = "#ffffff";
      fastDownloadBtn.style.borderColor = "#16a34a";
      setTimeout(() => {
        fastDownloadBtn.style.background = "";
        fastDownloadBtn.style.color = "";
        fastDownloadBtn.style.borderColor = "";
      }, 700);
    }
    return;
  }
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();

    const card = deleteButton.closest(".image-card");
    if (!card) {
      return;
    }

    requestDeleteForCard(card);
    return;
  }

  if (event.target.closest("a, button")) {
    return;
  }

  const card = event.target.closest(".image-card");
  if (!card) {
    return;
  }

  toggleCardSelection(card.dataset.clientId);
}

function handleGridKeydown(event) {
  if (event.target.closest("button, a")) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const card = event.target.closest(".image-card");
  if (!card) {
    return;
  }

  event.preventDefault();
  toggleCardSelection(card.dataset.clientId);
}

function toggleCardSelection(clientId) {
  state.images = state.images.map((image) =>
    image.clientId === clientId
      ? {
          ...image,
          selected: !image.selected
        }
      : image
  );

  render();
}

function handleDuplicateToggle() {
  state.showDuplicates = Boolean(duplicateToggleElement.checked);
  state.currentPage = 1;
  render();
}

function setVisibleSelections(selected) {
  const visibleIds = new Set(getVisibleImages().map((image) => image.clientId));

  state.images = state.images.map((image) =>
    visibleIds.has(image.clientId)
      ? {
          ...image,
          selected
        }
      : image
  );

  render();
  setStatus(
    selected ? "All visible images are selected." : "All visible images are deselected.",
    "default"
  );
}

function clearAllSelections() {
  state.images = state.images.map((image) => ({
    ...image,
    selected: false
  }));

  render();
  setStatus("All images are deselected.", "default");
}

function resetFilters() {
  minWidthInput.value = "0";
  minHeightInput.value = "0";
  formatFilterSelect.value = "all";
  state.currentPage = 1;
  render();
  setStatus("Filters reset. All extracted images are visible again.", "default");
}

async function handleManualDuplicateCheck() {
  if (!state.images.length || state.isAnalyzingDuplicates) {
    return;
  }

  await runDuplicateCheck();
}

async function runDuplicateCheck() {
  if (!state.images.length) {
    state.duplicateCount = 0;
    state.hasDuplicateCheckRun = false;
    render();
    return;
  }

  const currentScroll = window.scrollY || document.documentElement.scrollTop;
  let duplicateResult = null;
  state.isAnalyzingDuplicates = true;
  state.showDuplicates = false;
  showLoadingOverlay("Scanning for duplicates...", 0);
  render();

  try {
    duplicateResult = await detectDuplicates(state.images, currentScroll);
    state.images = duplicateResult.images;
    state.duplicateCount = state.images.filter((image) => image.isDuplicate).length;
    state.hasDuplicateCheckRun = true;
  } finally {
    state.isAnalyzingDuplicates = false;
    hideLoadingOverlay();
    render();
    const restoredScroll = duplicateResult?.currentScroll ?? currentScroll;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, restoredScroll);
      });
    });
  }
}

function requestDeleteForCard(card) {
  const clientId = String(card?.dataset.clientId || "");
  const url = String(card?.dataset.url || "");

  if (!clientId) {
    return;
  }

  state.pendingDelete = {
    clientId,
    url
  };

  if (state.gallerySettings.hideDeleteWarning) {
    removeImageFromGallery(clientId, url);
    return;
  }

  showDeleteModal();
}

function showDeleteModal() {
  if (!deleteModalElement) {
    return;
  }

  if (hideDeleteWarningCheckbox) {
    hideDeleteWarningCheckbox.checked = false;
  }

  deleteModalElement.style.display = "flex";
}

function hideDeleteModal() {
  if (deleteModalElement) {
    deleteModalElement.style.display = "none";
  }

  if (hideDeleteWarningCheckbox) {
    hideDeleteWarningCheckbox.checked = false;
  }

  state.pendingDelete = null;
}

async function confirmDeleteModal() {
  const pendingDelete = state.pendingDelete;
  if (!pendingDelete?.clientId) {
    hideDeleteModal();
    return;
  }

  removeImageFromGallery(pendingDelete.clientId, pendingDelete.url);

  if (hideDeleteWarningCheckbox?.checked) {
    state.gallerySettings.hideDeleteWarning = true;
    await persistActiveProfileFilterPatch({
      hideDeleteWarning: true
    });
  }

  hideDeleteModal();
}

function removeImageFromGallery(clientId, url = "") {
  state.images = state.images.filter((image) => !matchesDeletionTarget(image, clientId, url));
  originalOrder = originalOrder.filter((image) => !matchesDeletionTarget(image, clientId, url));
  state.pendingDelete = null;

  if (!state.images.some((image) => image.isDuplicate)) {
    state.showDuplicates = false;
  }

  render();
  setStatus("Image removed from the gallery.", "default");
}

function matchesDeletionTarget(image, clientId, url) {
  if (clientId) {
    return image.clientId === clientId;
  }

  return Boolean(url) && image.url === url;
}

async function detectDuplicates(images, savedScrollPosition = null) {
  const currentScroll = savedScrollPosition ?? (window.scrollY || document.documentElement.scrollTop);
  const nextImages = images.map((image) => ({
    ...image,
    isDuplicate: false,
    duplicateReason: ""
  }));
  queueLoadingOverlayUpdate(0, "Scanning for duplicates...");
  await flagUrlBaseDuplicates(nextImages);
  const visualWorkTotal = Math.max(getVisualDuplicateWorkCount(nextImages), 1);
  await flagVisualDuplicates(nextImages, (processed) => {
    const boundedProcessed = Math.min(Math.max(0, processed), visualWorkTotal);
    const percent = Math.round((boundedProcessed / visualWorkTotal) * 100);
    queueLoadingOverlayUpdate(percent, "Scanning for duplicates...");
  });
  queueLoadingOverlayUpdate(100, "Scanning for duplicates...");
  return {
    images: nextImages,
    currentScroll
  };
}

async function flagUrlBaseDuplicates(images, reportProgress = () => {}) {
  const groups = new Map();

  images.forEach((image) => {
    const baseUrl = getNormalizedDuplicateUrlKey(image.url);
    if (!baseUrl) {
      return;
    }

    if (!groups.has(baseUrl)) {
      groups.set(baseUrl, []);
    }

    groups.get(baseUrl).push(image);
  });

  let processedImages = 0;

  for (const group of groups.values()) {
    if (group.length < 2) {
      processedImages += group.length;
      reportProgress(processedImages);
      continue;
    }

    const sorted = [...group].sort(compareImageQualityDesc);
    for (let index = 1; index < sorted.length; index += 1) {
      sorted[index].isDuplicate = true;
      sorted[index].duplicateReason = "url-base";
    }

    processedImages += group.length;
    reportProgress(processedImages);
    if (processedImages % 20 === 0) {
      await yieldToBrowser();
    }
  }
}

async function flagVisualDuplicates(images, reportProgress = () => {}) {
  const aspectGroups = new Map();

  images.forEach((image) => {
    if (image.isDuplicate) {
      return;
    }

    const aspectKey = getAspectRatioBucket(image);
    if (!aspectKey) {
      return;
    }

    if (!aspectGroups.has(aspectKey)) {
      aspectGroups.set(aspectKey, []);
    }

    aspectGroups.get(aspectKey).push(image);
  });

  const hashCache = new Map();
  let processedImages = 0;

  for (const group of aspectGroups.values()) {
    if (group.length < 2) {
      processedImages += group.length;
      reportProgress(processedImages);
      continue;
    }

    const representatives = [];
    const sorted = [...group].sort(compareImageQualityDesc);
    const candidates = sorted.filter((image) => !image.isDuplicate);
    const hashedCandidates = [];

    for (let startIndex = 0; startIndex < candidates.length; startIndex += DUPLICATE_HASH_CONCURRENCY) {
      const batch = candidates.slice(startIndex, startIndex + DUPLICATE_HASH_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (image) => ({
        image,
        hash: await getImageDHash(image, hashCache),
        baseUrl: getNormalizedDuplicateUrlKey(image.url)
      })));

      hashedCandidates.push(...batchResults);
      processedImages += batch.length;
      reportProgress(processedImages);
      await yieldToBrowser();
    }

    for (const { image, hash, baseUrl } of hashedCandidates) {
      if (image.isDuplicate) {
        continue;
      }

      if (!hash) {
        representatives.push({ image, hash: null, baseUrl });
      } else {
        let matchedIndex = -1;

        for (let index = 0; index < representatives.length; index += 1) {
          const representative = representatives[index];
          if (!representative.hash || representative.image.isDuplicate || representative.baseUrl === baseUrl) {
            continue;
          }

          if (getHammingDistance(hash, representative.hash) <= 2) {
            matchedIndex = index;
            break;
          }
        }

        if (matchedIndex >= 0) {
          const representative = representatives[matchedIndex];
          const imageIsBetter = compareImageQualityDesc(image, representative.image) < 0;

          if (imageIsBetter) {
            representative.image.isDuplicate = true;
            representative.image.duplicateReason = representative.image.duplicateReason || "visual-hash";
            representatives[matchedIndex] = { image, hash, baseUrl };
          } else {
            image.isDuplicate = true;
            image.duplicateReason = image.duplicateReason || "visual-hash";
          }
        } else {
          representatives.push({ image, hash, baseUrl });
        }
      }
    }
  }
}

function createPhaseProgressReporter(startPercent, endPercent, total) {
  const safeTotal = Math.max(1, total);
  return (processed) => {
    const boundedProcessed = Math.min(Math.max(0, processed), safeTotal);
    const completion = boundedProcessed / safeTotal;
    const percent = Math.round(startPercent + ((endPercent - startPercent) * completion));
    queueLoadingOverlayUpdate(percent, "Scanning for duplicates...");
  };
}

function getVisualDuplicateWorkCount(images) {
  let total = 0;

  images.forEach((image) => {
    if (image.isDuplicate) {
      return;
    }

    if (!getAspectRatioBucket(image)) {
      return;
    }

    total += 1;
  });

  return total;
}

function compareImageQualityDesc(left, right) {
  const scoreDifference = getImageScore(right) - getImageScore(left);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  const widthDifference = getBestWidth(right) - getBestWidth(left);
  if (widthDifference !== 0) {
    return widthDifference;
  }

  const heightDifference = getBestHeight(right) - getBestHeight(left);
  if (heightDifference !== 0) {
    return heightDifference;
  }

  return String(left.url || "").localeCompare(String(right.url || ""));
}

function getImageScore(image) {
  return getBestWidth(image) * getBestHeight(image);
}

function getAspectRatioBucket(image) {
  const width = getBestWidth(image);
  const height = getBestHeight(image);

  if (!width || !height) {
    return "";
  }

  return (width / height).toFixed(3);
}

function getNormalizedDuplicateUrlKey(url) {
  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url.replace(/^http:/i, "https:"));
    parsedUrl.search = "";
    parsedUrl.hash = "";
    parsedUrl.pathname = stripDuplicateExtension(parsedUrl.pathname);
    return parsedUrl.href;
  } catch (error) {
    return stripDuplicateExtension(String(url).replace(/^http:/i, "https:").split(/[?#]/, 1)[0]);
  }
}

function stripDuplicateExtension(pathname) {
  return String(pathname || "").replace(/\.(?:jpe?g|png|webp|gif)$/i, "");
}

async function getImageDHash(image, hashCache) {
  const cacheKey = image.clientId;

  if (!hashCache.has(cacheKey)) {
    const targetUrl = image.thumbUrl || image.url;
    let fetchUrl = targetUrl;

    if (typeof imageCacheManager !== "undefined") {
      fetchUrl = await imageCacheManager.get(targetUrl);
    }

    hashCache.set(cacheKey, createImageDHash(fetchUrl));
  }

  return hashCache.get(cacheKey);
}

async function createImageDHash(url) {
  if (!url) {
    return "";
  }

  let objectUrl = "";
  let bitmap = null;

  try {
    const blob = await fetchHashBlob(url);
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return "";
    }

    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      objectUrl = URL.createObjectURL(blob);
      const image = await loadImage(objectUrl);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }

    const pixelData = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const grayscaleValues = [];
    let grayscaleTotal = 0;

    for (let offset = 0; offset < pixelData.length; offset += 4) {
      const gray = getGrayscaleValue(pixelData, offset);
      grayscaleValues.push(gray);
      grayscaleTotal += gray;
    }

    if (!grayscaleValues.length) {
      return "";
    }

    const grayscaleAverage = grayscaleTotal / grayscaleValues.length;
    return grayscaleValues.map((gray) => (gray >= grayscaleAverage ? "1" : "0")).join("");
  } catch (error) {
    return "";
  } finally {
    bitmap?.close?.();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

async function fetchHashBlob(url) {
  const response = await fetch(url, {
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`Could not fetch image data for hashing (${response.status}).`);
  }

  return response.blob();
}

function getGrayscaleValue(pixelData, offset) {
  return Math.round(
    pixelData[offset] * 0.299
      + pixelData[offset + 1] * 0.587
      + pixelData[offset + 2] * 0.114
  );
}

function getHammingDistance(leftHash, rightHash) {
  if (!leftHash || !rightHash || leftHash.length !== rightHash.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    if (leftHash[index] !== rightHash[index]) {
      distance += 1;
    }
  }

  return distance;
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function handleDownloadSelected() {
  const selectedImages = state.images.filter((image) => image.selected);

  if (!selectedImages.length) {
    setStatus("Select at least one image before downloading.", "error");
    return;
  }

  if (selectedImages.length > 500) {
    alert("For safety, downloads are limited to 500 selected images per batch.");
    setStatus("Download aborted because more than 500 images were selected.", "error");
    return;
  }

  const downloadOptions = getDownloadOptions();
  if (
    downloadOptions.downloadMode === "individual"
    && downloadOptions.individualDownloadWarningThreshold > 0
    && selectedImages.length > downloadOptions.individualDownloadWarningThreshold
  ) {
    const confirmed = window.confirm(
      `You selected ${selectedImages.length} images. Continue with individual file downloads?`
    );

    if (!confirmed) {
      setStatus("Download cancelled.", "default");
      return;
    }
  }

  state.isDownloading = true;
  setControlsDisabled(true, true, true);
  downloadButton.classList.add("is-loading");

  const initialStatus = buildInitialDownloadStatus(selectedImages.length, downloadOptions);
  setStatus(initialStatus, "default");

  try {
    const response = downloadOptions.downloadMode === "zip"
      ? await downloadSelectedImagesAsZip(selectedImages, downloadOptions)
      : await downloadSelectedImagesIndividually(selectedImages, downloadOptions);

    if (downloadOptions.downloadMode === "zip") {
      if (response.failed) {
        setStatus(
          `Created ${response.archiveName} with ${response.downloaded} image${response.downloaded === 1 ? "" : "s"}; ${response.failed} file${response.failed === 1 ? "" : "s"} could not be added.`,
          "error"
        );
      } else {
        setStatus(
          `Created ${response.archiveName} with ${response.downloaded} selected image${response.downloaded === 1 ? "" : "s"}.`,
          "success"
        );
      }
    } else if (response.failed) {
      setStatus(
        `Downloaded ${response.downloaded} image${response.downloaded === 1 ? "" : "s"} with ${response.failed} failure${response.failed === 1 ? "" : "s"}.`,
        "error"
      );
    } else {
      const formatLabel = downloadOptions.outputFormat === "original"
        ? "original files"
        : `${downloadOptions.outputFormat.toUpperCase()} conversions`;
      setStatus(
        `Downloaded ${response.downloaded} selected image${response.downloaded === 1 ? "" : "s"} as ${formatLabel}.`,
        "success"
      );
    }
  } catch (error) {
    setStatus(error.message || "Could not start the downloads.", "error");
  } finally {
    state.isDownloading = false;
    downloadButton.classList.remove("is-loading");
    render();
  }
}

function buildInitialDownloadStatus(selectedCount, options) {
  if (options.downloadMode === "zip") {
    return options.saveMode === "prompt"
      ? `Creating ${options.zipFilename}. Firefox will ask where to save the ZIP archive.`
      : `Creating ${options.zipFilename} from ${selectedCount} selected image${selectedCount === 1 ? "" : "s"}...`;
  }

  return options.saveMode === "prompt"
    ? `Starting ${selectedCount} download${selectedCount === 1 ? "" : "s"}. Firefox will ask where to save each file.`
    : `Starting ${selectedCount} download${selectedCount === 1 ? "" : "s"}...`;
}

async function downloadSelectedImagesIndividually(images, options) {
  const failures = [];
  let downloaded = 0;

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];

    try {
      const resolvedImage = await resolveImageForDownload(image);
      const preparedDownload = options.outputFormat === "original"
        ? {
            url: resolvedImage.url,
            extension: detectOriginalExtension(resolvedImage),
            objectUrl: null
          }
        : await prepareConvertedDownload(resolvedImage, options.outputFormat, options.quality);
      const filename = buildDownloadFilename(
        resolvedImage,
        index + 1,
        options.folderPath,
        preparedDownload.extension,
        options.namingScheme
      );
      const downloadId = await api.downloads.download({
        url: preparedDownload.url,
        filename,
        conflictAction: "uniquify",
        saveAs: options.saveMode === "prompt"
      });

      if (preparedDownload.objectUrl) {
        trackTemporaryObjectUrl(downloadId, preparedDownload.objectUrl);
      }

      downloaded += 1;
    } catch (error) {
      failures.push({
        url: image.url,
        error: error.message || "Download failed."
      });
    }

    if (options.rateLimitMs > 0 && index < images.length - 1) {
      await sleep(options.rateLimitMs);
    }
  }

  return {
    downloaded,
    failed: failures.length,
    failures
  };
}

async function downloadSelectedImagesAsZip(images, options) {
  const zip = new JSZip();
  const failures = [];
  let downloaded = 0;

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];

    try {
      const resolvedImage = await resolveImageForDownload(image);
      const preparedFile = await prepareZipFile(resolvedImage, options.outputFormat, options.quality);
      const entryName = buildArchiveEntryName(resolvedImage, index + 1, options.folderPath, preparedFile.extension);
      zip.file(entryName, preparedFile.blob);
      downloaded += 1;
    } catch (error) {
      failures.push({
        url: image.url,
        error: error.message || "Could not add the image to the ZIP archive."
      });
    }
  }

  if (!downloaded) {
    throw new Error("No selected images could be added to the ZIP archive.");
  }

  const archiveBlob = await zip.generateAsync({ type: "blob" });
  const archiveName = ensureZipFilename(options.zipFilename);
  const archiveUrl = URL.createObjectURL(archiveBlob);
  const downloadId = await api.downloads.download({
    url: archiveUrl,
    filename: joinPathSegments(DOWNLOAD_ROOT_FOLDER, archiveName),
    conflictAction: "uniquify",
    saveAs: options.saveMode === "prompt"
  });

  trackTemporaryObjectUrl(downloadId, archiveUrl);

  return {
    downloaded,
    failed: failures.length,
    failures,
    archiveName
  };
}

async function prepareZipFile(image, outputFormat, quality) {
  const sourceBlob = await fetchImageBlob(image.url);

  if (outputFormat === "original") {
    return {
      blob: sourceBlob,
      extension: detectOriginalExtension(image)
    };
  }

  const convertedBlob = await convertBlobToFormat(sourceBlob, outputFormat, quality);
  return {
    blob: convertedBlob,
    extension: outputFormat
  };
}
async function prepareConvertedDownload(image, outputFormat, quality) {
  const blob = await fetchImageBlob(image.url);
  const convertedBlob = await convertBlobToFormat(blob, outputFormat, quality);
  const objectUrl = URL.createObjectURL(convertedBlob);

  return {
    url: objectUrl,
    extension: outputFormat,
    objectUrl
  };
}

async function fetchImageBlob(url) {
  const response = await fetch(url, {
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`Could not fetch image data (${response.status}).`);
  }

  return response.blob();
}

async function convertBlobToFormat(blob, outputFormat, quality) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      throw new Error("Could not read the image dimensions for conversion.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      alpha: !["jpg", "bmp"].includes(outputFormat)
    });

    if (!context) {
      throw new Error("Canvas conversion is not available in this browser context.");
    }

    if (["jpg", "bmp"].includes(outputFormat)) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(image, 0, 0, width, height);

    if (outputFormat === "bmp") {
      return convertCanvasToBmpBlob(canvas, context);
    }

    const mimeType = outputFormat === "jpg" ? "image/jpeg" : `image/${outputFormat}`;
    const blobQuality = outputFormat === "png" ? undefined : quality;

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (convertedBlob) => {
          if (convertedBlob) {
            resolve(convertedBlob);
            return;
          }

          reject(new Error("The selected output format could not be generated."));
        },
        mimeType,
        blobQuality
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function convertCanvasToBmpBlob(canvas, context) {
  const width = canvas.width;
  const height = canvas.height;
  const imageData = context.getImageData(0, 0, width, height).data;
  const rowStride = width * 3;
  const rowPadding = (4 - (rowStride % 4)) % 4;
  const pixelArraySize = (rowStride + rowPadding) * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4D;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);

  let offset = 54;

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      bytes[offset] = imageData[sourceOffset + 2];
      bytes[offset + 1] = imageData[sourceOffset + 1];
      bytes[offset + 2] = imageData[sourceOffset];
      offset += 3;
    }

    for (let padding = 0; padding < rowPadding; padding += 1) {
      bytes[offset] = 0;
      offset += 1;
    }
  }

  return new Blob([buffer], {
    type: "image/bmp"
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded for conversion."));
    image.src = url;
  });
}

function trackTemporaryObjectUrl(downloadId, objectUrl) {
  downloadObjectUrls.set(downloadId, objectUrl);
  window.setTimeout(() => releaseDownloadObjectUrl(downloadId), 60000);
}

function releaseDownloadObjectUrl(downloadId) {
  const objectUrl = downloadObjectUrls.get(downloadId);

  if (!objectUrl) {
    return;
  }

  URL.revokeObjectURL(objectUrl);
  downloadObjectUrls.delete(downloadId);
}

function getDownloadOptions() {
  const resolvedFolderPath = normalizeRelativePath(
    folderNameInput.value
      || state.downloadPreferences.subfolderName
      || state.session?.pageTitle
      || "Extracted Images"
  ) || "Extracted Images";
  const activeDownloadMode = galleryDownloadModeSelect?.value || state.downloadPreferences.downloadMode;

  return {
    outputFormat: outputFormatSelect.value,
    quality: Number.parseFloat(qualityInput.value || "0.92") || 0.92,
    saveMode: saveModeSelect.value,
    folderPath: resolvedFolderPath,
    downloadMode: activeDownloadMode,
    namingScheme: state.downloadPreferences.namingScheme || "original",
    rateLimitMs: state.downloadPreferences.rateLimitMs,
    individualDownloadWarningThreshold: state.downloadPreferences.individualDownloadWarningThreshold,
    zipFilename: ensureZipFilename(resolvedFolderPath)
  };
}
function buildDownloadFilename(image, order, folderPath, extension, namingScheme = "original") {
  let fileName = "";

  if (namingScheme === "sequential") {
    fileName = `image_${order}.${extension}`;
  } else {
    fileName = getOriginalDownloadFilename(image.url, extension, order);
  }

  return joinPathSegments(DOWNLOAD_ROOT_FOLDER, folderPath, fileName);
}

function getOriginalDownloadFilename(url, extension, order) {
  let filename = String(url || "").split("/").pop() || "";
  filename = filename.split("?")[0];

  if (!filename) {
    return `image_${order}.${extension}`;
  }

  const parts = filename.split(".");
  const originalExtension = parts.length > 1 ? parts.pop() : "";
  const baseName = parts.join(".") || filename;
  const resolvedExtension = sanitizeSegment(extension || originalExtension || "jpg", 12) || "jpg";
  let safeFilename = `${sanitizeSegment(baseName, 96) || `image_${order}`}.${resolvedExtension}`;

  if (safeFilename.length > 32) {
    const truncatedBase = (sanitizeSegment(baseName, 96) || `image_${order}`)
      .substring(0, Math.max(1, 32 - resolvedExtension.length - 1));
    safeFilename = `${truncatedBase}.${resolvedExtension}`;
  }

  return safeFilename;
}

function buildArchiveEntryName(image, order, folderPath, extension) {
  const baseName = sanitizeSegment(image.altText || image.filenameHint || image.sourceType || "image", 72)
    || `image-${order}`;
  const paddedOrder = String(order).padStart(3, "0");
  const fileName = `${paddedOrder}-${baseName}.${extension}`;

  return joinPathSegments(folderPath, fileName);
}

function detectOriginalExtension(image) {
  const formatKey = getFormatKey(image);

  if (["jpg", "png", "webp", "gif", "svg", "bmp", "heic", "heif"].includes(formatKey)) {
    return formatKey;
  }

  return "jpg";
}

function updateDownloadControls() {
  const outputFormat = outputFormatSelect.value;
  const qualityPercent = Math.round((Number.parseFloat(qualityInput.value || "0.92") || 0.92) * 100);
  const controlsDisabled = state.images.length === 0 || state.isDownloading;
  const downloadMode = galleryDownloadModeSelect?.value || state.downloadPreferences.downloadMode;
  state.downloadPreferences.downloadMode = downloadMode;
  // Grab the live value from the input field if it exists, otherwise fall back to state/default
  const folderName = folderNameInput && folderNameInput.value.trim() !== ""
    ? normalizeRelativePath(folderNameInput.value.trim()) || folderNameInput.value.trim()
    : (state.downloadPreferences?.subfolderName || "Image Extractor Pro");
  const promptSaveAs = saveModeSelect.value === "prompt";

  qualityValue.textContent = `${qualityPercent}%`;
  qualityField.hidden = !["jpg", "webp"].includes(outputFormat);
  qualityInput.disabled = controlsDisabled || qualityField.hidden;

  if (downloadButtonLabel) {
    downloadButtonLabel.textContent = "Download Selected";
  }

  if (downloadMode === "zip") {
    if (downloadModeSummary) {
      downloadModeSummary.textContent = "Current mode: ZIP Archive. Files will be packaged together into a single ZIP file.";
    }
    if (saveModeHint) {
      saveModeHint.textContent = promptSaveAs
        ? "You will be asked where to save the ZIP file on your computer."
        : `The ZIP file will be saved to your downloads folder as "${folderName}.zip".`;
    }
  } else {
    if (downloadModeSummary) {
      downloadModeSummary.textContent = "Current mode: Individual Files. Images will be downloaded separately.";
    }
    if (saveModeHint) {
      saveModeHint.textContent = promptSaveAs
        ? "Warning: You will be asked where to save EVERY single file individually."
        : `Files will be saved automatically to your downloads folder inside the "${folderName}" subfolder.`;
    }
  }
}

function updateDownloadButtonState(selectedCount) {
  if (!downloadButton) {
    return;
  }

  if (state.isResolvingFlickrQueue) {
    downloadButton.title = "Preparing Flickr resolutions...";
    downloadButton.style.opacity = "0.5";
    downloadButton.style.cursor = "wait";
    return;
  }

  if (selectedCount === 0) {
    downloadButton.title = "Select images first";
    downloadButton.style.opacity = "0.5";
    downloadButton.style.cursor = "not-allowed";
    return;
  }

  downloadButton.title = "";
  downloadButton.style.opacity = "1";
  downloadButton.style.cursor = "pointer";
}

function updateStickyStats(selectedCount) {
  if (!stickyStatsElement) {
    return;
  }

  const totalImages = document.querySelectorAll(".image-card").length;
  stickyStatsElement.innerHTML = `<span style="color: var(--text-primary, #f8fafc);">${selectedCount}</span> selected &nbsp;|&nbsp; ${totalImages} total`;
}

function setControlsDisabled(disabled, noVisibleImages = false, noSelectedImages = false) {
  selectAllButton.disabled = disabled || noVisibleImages;
  deselectAllButton.disabled = disabled || state.images.length === 0;
  downloadButton.disabled = disabled || noSelectedImages || state.isResolvingFlickrQueue;
  const manualUpgradeButton = getResolveControl("#btnManualUpgrade");
  const cancelUpgradeButton = getResolveControl("#btnCancelUpgrade");
  if (manualUpgradeButton) {
    manualUpgradeButton.disabled = disabled || state.isResolvingFlickrQueue || state.isDownloading;
  }
  if (cancelUpgradeButton) {
    cancelUpgradeButton.disabled = false;
  }
  if (gallerySortSelect) {
    gallerySortSelect.disabled = disabled;
  }
  if (galleryDownloadModeSelect) {
    galleryDownloadModeSelect.disabled = disabled;
  }
  minWidthInput.disabled = disabled;
  minHeightInput.disabled = disabled;
  formatFilterSelect.disabled = disabled;
  resetFiltersButton.disabled = disabled;
  outputFormatSelect.disabled = disabled;
  qualityInput.disabled = disabled || qualityField.hidden;
  saveModeSelect.disabled = disabled;
  folderNameInput.disabled = disabled;
}

function setStatus(message, tone) {
  statusMessageElement.textContent = message;
  statusBannerElement.dataset.tone = tone;
}

function refreshControlState() {
  const matchingImages = getMatchingImages();
  const visibleImages = getVisibleImages(getSortedImages(matchingImages));
  const selectedCount = state.images.filter((image) => image.selected).length;

  updateDownloadButtonState(selectedCount);
  setControlsDisabled(
    state.images.length === 0 || state.isDownloading || state.isAnalyzingDuplicates,
    visibleImages.length === 0,
    selectedCount === 0
  );
  updateStickyStats(selectedCount);
}

function mergeResolvedImageData(image, resolvedData) {
  if (!image) {
    return image;
  }

  const resolvedUrl = resolvedData?.url || image.url;
  const resolvedWidth = Number.parseInt(resolvedData?.width, 10);
  const resolvedHeight = Number.parseInt(resolvedData?.height, 10);
  const hasDimensions = resolvedWidth > 0 && resolvedHeight > 0;
  const hasUrlChange = resolvedUrl && resolvedUrl !== image.url;

  if (!hasUrlChange && !hasDimensions) {
    return image;
  }

  return {
    ...image,
    url: resolvedUrl || image.url,
    sourceWidth: hasDimensions ? resolvedWidth : image.sourceWidth,
    sourceHeight: hasDimensions ? resolvedHeight : image.sourceHeight,
    naturalWidth: hasDimensions ? resolvedWidth : image.naturalWidth,
    naturalHeight: hasDimensions ? resolvedHeight : image.naturalHeight,
    width: hasDimensions ? resolvedWidth : image.width,
    height: hasDimensions ? resolvedHeight : image.height,
    isUpgraded: image.isUpgraded || hasUrlChange || hasDimensions
  };
}

function updateResolvedImageData(clientId, resolvedData) {
  if (!clientId || !resolvedData) {
    return;
  }

  const image = state.images.find((entry) => entry.clientId === clientId);
  if (image) {
    Object.assign(image, mergeResolvedImageData(image, resolvedData));
  }

  const original = originalOrder.find((entry) => entry.clientId === clientId);
  if (original) {
    Object.assign(original, mergeResolvedImageData(original, resolvedData));
  }
}

async function processFlickrQueue(imageCards, isRetry = false, options = {}) {
  const cancellable = Boolean(options.cancellable);
  let queue = [];
  state.isResolvingFlickrQueue = true;
  state.manualUpgradeCancellable = cancellable;

  if (isRetry) {
    queue = [...window.flickrFailedItems];
    window.flickrFailedItems = [];
  } else {
    queue = Array.from(imageCards || [])
      .map((card) => ({
        card,
        clientId: card.dataset.clientId || "",
        imgEl: card.querySelector(".card-image"),
        linkEl: card.querySelector(".card-url"),
        viewBtn: card.querySelector(".card-open-link")
      }))
      .filter((item) => {
        const baseUrl = item.card?.dataset.url || item.imgEl?.currentSrc || item.imgEl?.src || "";
        return Boolean(item.card && item.imgEl && baseUrl.includes("flickr.com"));
      });
    window.flickrUpgradedCount = 0;
    window.flickrFailedItems = [];
  }

  if (!queue.length) {
    state.isResolvingFlickrQueue = false;
    state.resolveQueuePromise = null;
    state.manualUpgradeCancellable = false;
    refreshControlState();
    syncResolveProgressContainer();
    return { cancelled: false, completed: 0, total: 0 };
  }

  renderResolveProgressState(`Upgrading Resolutions: 0/${queue.length}`, {
    color: "#f59e0b",
    showSpinner: true,
    showCancel: cancellable,
    fontWeight: 600
  });

  let completed = 0;
  let wasCancelled = false;
  const batchSize = cancellable ? 1 : 2;

  for (let index = 0; index < queue.length; index += batchSize) {
    if (cancellable && window.iepCancelUpgrade) {
      wasCancelled = true;
      break;
    }

    const batch = queue.slice(index, index + batchSize);
    let neededNetwork = false;

    await Promise.all(batch.map(async (item) => {
      if (cancellable && window.iepCancelUpgrade) {
        return;
      }

      const originalSrc = item.card.dataset.url || item.imgEl.currentSrc || item.imgEl.src || "";

      try {
        const maxData = await window.getTrueFlickrMax(originalSrc);
        const nextUrl = maxData?.url || originalSrc;
        if (!maxData?.fromCache) {
          neededNetwork = true;
        }

        if (nextUrl !== originalSrc || (maxData?.width && maxData?.height)) {
          window.flickrUpgradedCount += 1;
          updateResolvedImageData(item.clientId, maxData);
          item.card.dataset.url = nextUrl;
          if (maxData?.width && maxData?.height) {
            item.card.dataset.width = String(maxData.width);
            item.card.dataset.height = String(maxData.height);
          }
          if (item.linkEl) {
            item.linkEl.href = nextUrl;
            item.linkEl.textContent = trimUrlForDisplay(nextUrl);
          }
          if (item.viewBtn) {
            item.viewBtn.href = nextUrl;
            attachLightboxTrigger(item.viewBtn, nextUrl);
          }
          if (item.imgEl) {
            imageCacheManager.get(nextUrl).then((blobUrl) => {
              if (document.body.contains(item.imgEl)) {
                item.imgEl.src = blobUrl || nextUrl;
              }
            }).catch(() => {
              if (document.body.contains(item.imgEl)) {
                item.imgEl.src = nextUrl;
              }
            });
          }

          if (maxData?.width && maxData?.height) {
            const resLabel = item.card.querySelector(".card-dimensions");
            if (resLabel) {
              resLabel.textContent = `${maxData.width} × ${maxData.height}`;
              resLabel.classList.add("res-upgraded");
              resLabel.textContent = `Source ${maxData.width} × ${maxData.height}`;
            }
          }
          if (maxData?.width && maxData?.height) {
            const finalResLabel = item.card.querySelector(".card-dimensions");
            if (finalResLabel) {
              finalResLabel.textContent = `Source ${maxData.width} × ${maxData.height}`;
            }
          }
        } else if (!(cancellable && window.iepCancelUpgrade)) {
          window.flickrFailedItems.push(item);
        }
      } catch (error) {
        console.error("[IEP Debug] Queue item failed:", error);
        if (!(cancellable && window.iepCancelUpgrade)) {
          window.flickrFailedItems.push(item);
        }
      } finally {
        completed += 1;
        if (!(cancellable && window.iepCancelUpgrade)) {
          updateResolveProgressText(`Upgrading Resolutions: ${completed}/${queue.length}`);
        }
      }
    }));

    if (cancellable && window.iepCancelUpgrade) {
      wasCancelled = true;
      break;
    }

    if (neededNetwork && index + batchSize < queue.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
  }

  state.isResolvingFlickrQueue = false;
  state.resolveQueuePromise = null;
  state.manualUpgradeCancellable = false;
  refreshControlState();
  if (wasCancelled) {
    renderResolveProgressState("Upgrade Cancelled", {
      color: "#ef4444",
      showSpinner: false,
      fontWeight: 600
    });
  } else if (window.flickrFailedItems.length > 0) {
    renderResolveProgressState(`Images upgraded ${window.flickrUpgradedCount} | Failed ${window.flickrFailedItems.length}`, {
      color: "#f59e0b",
      showSpinner: false,
      showRetry: true,
      fontWeight: 600
    });
  } else if (cancellable) {
    renderResolveProgressState("Upgrades Complete", {
      color: "#10b981",
      showSpinner: false,
      fontWeight: 600
    });
  } else {
    renderResolveProgressState(`Images upgraded ${window.flickrUpgradedCount} | Failed 0`, {
      color: "#10b981",
      showSpinner: false,
      fontWeight: 600
    });
  }

  return {
    cancelled: wasCancelled,
    completed,
    total: queue.length
  };
}

async function handleManualResolutionUpgrade() {
  if (state.resolveQueuePromise || state.isResolvingFlickrQueue) {
    return;
  }

  const cards = getDisplayedFlickrCards({ onlyPending: true });
  if (!cards.length) {
    syncResolveProgressContainer();
    return;
  }

  window.iepCancelUpgrade = false;
  state.manualUpgradeCancellable = true;
  renderResolveProgressState("Upgrading...", {
    color: "#f59e0b",
    showSpinner: true,
    showCancel: true,
    fontWeight: 600
  });
  state.resolveQueuePromise = processFlickrQueue(cards, false, { cancellable: true });

  try {
    await state.resolveQueuePromise;
  } finally {
    state.manualUpgradeCancellable = false;
  }
}

async function loadGallerySettings() {
  const defaults = {
    persistentMode: false,
    autoUpgradeResolutions: false,
    autoCheckDuplicates: false,
    hideDeleteWarning: false,
    downloadMode: "zip",
    stickyToolbar: true,
    themeStyle: "Rich",
    windowScale: "Big",
    galleryPagination: "Unlimited"
  };

  try {
    const result = await api.storage.local.get(["iepSettingsManager"]);
    const manager = result?.iepSettingsManager;
    const profiles = Array.isArray(manager?.profiles) ? manager.profiles : [];
    const activeId = manager?.activeId || "default";
    const activeProfile = profiles.find((profile) => profile?.id === activeId) || profiles[0];
    const filters = activeProfile?.filters && typeof activeProfile.filters === "object" ? activeProfile.filters : {};

    return {
      autoUpgradeResolutions: typeof filters.autoUpgradeResolutions === "boolean"
        ? filters.autoUpgradeResolutions
        : defaults.autoUpgradeResolutions,
      autoCheckDuplicates: typeof filters.autoCheckDuplicates === "boolean"
        ? filters.autoCheckDuplicates
        : defaults.autoCheckDuplicates,
      hideDeleteWarning: typeof filters.hideDeleteWarning === "boolean"
        ? filters.hideDeleteWarning
        : defaults.hideDeleteWarning,
      downloadMode: ["zip", "individual"].includes(filters.downloadMode)
        ? filters.downloadMode
        : defaults.downloadMode,
      stickyToolbar: typeof filters.stickyToolbar === "boolean"
        ? filters.stickyToolbar
        : defaults.stickyToolbar,
      windowScale: ["small", "medium", "big"].includes(String(filters.windowScale || "").toLowerCase())
        ? String(filters.windowScale).toLowerCase()
        : String(defaults.windowScale).toLowerCase(),
      themeStyle: ["minimal", "standard", "rich"].includes(String(filters.themeStyle || "").toLowerCase())
        ? String(filters.themeStyle).toLowerCase()
        : String(defaults.themeStyle).toLowerCase(),
      galleryPagination: ["50", "100", "200", "500", "unlimited"].includes(String(filters.galleryPagination || "").toLowerCase())
        ? String(filters.galleryPagination).toLowerCase()
        : String(defaults.galleryPagination).toLowerCase()
    };
  } catch (_error) {
    return {
      autoUpgradeResolutions: defaults.autoUpgradeResolutions,
      autoCheckDuplicates: defaults.autoCheckDuplicates,
      hideDeleteWarning: defaults.hideDeleteWarning,
      downloadMode: defaults.downloadMode,
      stickyToolbar: defaults.stickyToolbar,
      windowScale: String(defaults.windowScale).toLowerCase(),
      themeStyle: String(defaults.themeStyle).toLowerCase(),
      galleryPagination: String(defaults.galleryPagination).toLowerCase()
    };
  }
}

async function persistActiveProfileFilterPatch(patch) {
  try {
    const result = await api.storage.local.get(["iepSettingsManager"]);
    const manager = result?.iepSettingsManager;
    const profiles = Array.isArray(manager?.profiles) ? manager.profiles : [];
    const activeId = manager?.activeId || "default";

    if (!profiles.length) {
      return;
    }

    const nextProfiles = profiles.map((profile) => {
      if (profile?.id !== activeId) {
        return profile;
      }

      return {
        ...profile,
        filters: {
          ...(profile.filters && typeof profile.filters === "object" ? profile.filters : {}),
          ...patch
        }
      };
    });

    await api.storage.local.set({
      iepSettingsManager: {
        ...manager,
        activeId,
        profiles: nextProfiles
      }
    });
  } catch (_error) {
    // Ignore storage write failures and keep the current in-memory state.
  }
}

function showLoadingOverlay(text, percent) {
  if (!galleryLoadingOverlayElement) {
    return;
  }

  galleryLoadingOverlayElement.style.display = "flex";
  applyLoadingOverlayState(text, percent);
}

function queueLoadingOverlayUpdate(percent, text) {
  if (!galleryLoadingOverlayElement) {
    return;
  }

  pendingLoadingOverlayState = {
    percent: clampLoadingPercent(percent),
    text: text || "Processing Images..."
  };
  galleryLoadingOverlayElement.style.display = "flex";

  if (loadingOverlayFrame) {
    return;
  }

  loadingOverlayFrame = window.requestAnimationFrame(() => {
    loadingOverlayFrame = 0;
    if (!pendingLoadingOverlayState) {
      return;
    }

    applyLoadingOverlayState(pendingLoadingOverlayState.text, pendingLoadingOverlayState.percent);
    pendingLoadingOverlayState = null;
  });
}

function hideLoadingOverlay() {
  if (!galleryLoadingOverlayElement) {
    return;
  }

  if (loadingOverlayFrame) {
    window.cancelAnimationFrame(loadingOverlayFrame);
    loadingOverlayFrame = 0;
  }

  pendingLoadingOverlayState = null;
  galleryLoadingOverlayElement.style.display = "none";
}

function applyLoadingOverlayState(text, percent) {
  const safePercent = clampLoadingPercent(percent);

  if (loadingTextElement) {
    loadingTextElement.textContent = text || "Processing Images...";
  }

  if (loadingBarElement) {
    loadingBarElement.style.width = `${safePercent}%`;
  }

  if (loadingPercentageElement) {
    loadingPercentageElement.textContent = `${safePercent}%`;
  }
}

function clampLoadingPercent(percent) {
  return Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
}

function applyTheme(theme) {
  const normalizedTheme = ["system", "dark", "light"].includes(String(theme || "system").toLowerCase())
    ? String(theme || "system").toLowerCase()
    : "system";
  document.documentElement.dataset.theme = normalizedTheme;
  if (document.body) {
    document.body.dataset.theme = normalizedTheme;
  }
}

function getBestWidth(image) {
  return Math.max(Number(image.sourceWidth || 0), Number(image.naturalWidth || 0), Number(image.renderedWidth || 0));
}

function getBestHeight(image) {
  return Math.max(Number(image.sourceHeight || 0), Number(image.naturalHeight || 0), Number(image.renderedHeight || 0));
}

function formatSourceDimensions(image) {
  const width = getBestWidth(image);
  const height = getBestHeight(image);

  if (!width || !height) {
    return "Source size unavailable";
  }

  return `Source ${width} x ${height}px`;
}

function formatRenderedDimensions(image) {
  const width = Number(image.renderedWidth || 0);
  const height = Number(image.renderedHeight || 0);

  if (!width || !height) {
    return "";
  }

  return `Rendered ${width} x ${height}px`;
}

function prettifySourceType(sourceType) {
  const value = String(sourceType || "image").toLowerCase();

  if (["srcset", "picture", "source"].includes(value)) {
    return "Source";
  }

  if (["current-src", "lazy-attr", "rendered"].includes(value)) {
    return "Rendered";
  }

  if (value === "anchor") {
    return "Link";
  }

  if (value === "background") {
    return "Background";
  }

  return "Image";
}

function getFormatKey(image) {
  const format = String(image?.format || "").toLowerCase();

  if (!format) {
    return "unknown";
  }

  return format === "jpeg" ? "jpg" : format;
}

function getFormatLabel(image) {
  const formatKey = getFormatKey(image);
  return formatKey === "unknown" ? "ASSET" : formatKey.toUpperCase();
}

function getHostLabel(url) {
  if (!url) {
    return "Extracted image";
  }

  if (url.startsWith("data:image/")) {
    return "Embedded image";
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname || "Extracted image";
  } catch (error) {
    return "Extracted image";
  }
}

function trimUrlForDisplay(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("data:image/")) {
    return "data:image/... (embedded asset)";
  }

  return url.length > 110 ? `${url.slice(0, 107)}...` : url;
}

function sanitizeSegment(value, maxLength = 80) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizePathSegment(value, maxLength = 80) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeRelativePath(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment, 64))
    .filter(Boolean)
    .join("/");
}

function ensureZipFilename(value) {
  const baseName = sanitizeSegment(String(value || "images.zip").replace(/\.zip$/i, ""), 96) || "images";
  return `${baseName}.zip`;
}

function createDefaultDownloadPreferences() {
  return {
    downloadMode: "zip",
    namingScheme: "original",
    subfolderName: "",
    rateLimitMs: 0,
    individualDownloadWarningThreshold: 30,
    theme: "system"
  };
}

function normalizeDownloadPreferences(preferences) {
  const normalizedTheme = String(preferences?.theme || preferences?.downloadPreferences?.theme || "system").toLowerCase();

  return {
    downloadMode: String(preferences?.downloadMode || preferences?.downloadPreferences?.downloadMode || "zip").toLowerCase() === "zip" ? "zip" : "individual",
    namingScheme: String(preferences?.namingScheme || preferences?.downloadPreferences?.namingScheme || "original").toLowerCase() === "sequential" ? "sequential" : "original",
    subfolderName: normalizeRelativePath(preferences?.subfolderName || preferences?.downloadPreferences?.defaultSubfolderName || ""),
    rateLimitMs: Math.max(0, Number.parseInt(preferences?.rateLimitMs || preferences?.downloadPreferences?.rateLimitMs || "0", 10) || 0),
    individualDownloadWarningThreshold: Math.max(0, Number.parseInt(preferences?.individualDownloadWarningThreshold || preferences?.downloadPreferences?.individualDownloadWarningThreshold || "30", 10) || 0),
    theme: ["system", "dark", "light"].includes(normalizedTheme) ? normalizedTheme : "system"
  };
}
function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms || 0)));
}
function joinPathSegments(...segments) {
  return segments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join("/");
}

function normalizeZipPath(value) {
  return String(value || "")
    .replace(/\\+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}
async function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  if (typeof data === "string") {
    return ZIP_TEXT_ENCODER.encode(data);
  }

  throw new Error("Unsupported ZIP entry data type.");
}

function createLocalFileHeader({ crc, compressedSize, uncompressedSize, nameLength, dosDate, dosTime }) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc >>> 0, true);
  view.setUint32(18, compressedSize, true);
  view.setUint32(22, uncompressedSize, true);
  view.setUint16(26, nameLength, true);
  view.setUint16(28, 0, true);

  return bytes;
}

function createCentralDirectoryHeader({ crc, compressedSize, uncompressedSize, nameLength, dosDate, dosTime, localOffset }) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc >>> 0, true);
  view.setUint32(20, compressedSize, true);
  view.setUint32(24, uncompressedSize, true);
  view.setUint16(28, nameLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);

  return bytes;
}

function createEndOfCentralDirectoryRecord({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return bytes;
}

function toDosDate(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function toDosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xEDB88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }

    table[index] = value >>> 0;
  }

  return table;
}

function crc32(bytes) {
  let value = 0xFFFFFFFF;

  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC32_TABLE[(value ^ bytes[index]) & 0xFF] ^ (value >>> 8);
  }

  return (value ^ 0xFFFFFFFF) >>> 0;
}
function hashString(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

// --- LIGHTBOX CAROUSEL LOGIC ---
let currentLbIndex = 0;
let lbImages = [];
let lightboxInitialized = false;

function initLightbox() {
  if (lightboxInitialized) {
    return;
  }

  const overlay = document.getElementById("iep-lightbox");
  if (!overlay) {
    return;
  }

  const closeButton = document.getElementById("lb-close-btn");
  const nextButton = document.getElementById("lb-next-btn");
  const prevButton = document.getElementById("lb-prev-btn");
  const downloadButtonElement = document.getElementById("lb-download-btn");

  closeButton?.addEventListener("click", closeLightbox);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeLightbox();
    }
  });

  nextButton?.addEventListener("click", () => {
    if (!lbImages.length) {
      return;
    }

    currentLbIndex = (currentLbIndex + 1) % lbImages.length;
    renderLightboxImage();
  });

  prevButton?.addEventListener("click", () => {
    if (!lbImages.length) {
      return;
    }

    currentLbIndex = (currentLbIndex - 1 + lbImages.length) % lbImages.length;
    renderLightboxImage();
  });
  if (downloadButtonElement) {
    downloadButtonElement.onclick = null;
  }

  lightboxInitialized = true;
}

window.openLightbox = function openLightbox(startImageUrl) {
  const cards = Array.from(document.querySelectorAll(".image-card")).filter((card) => {
    if (card.hidden) {
      return false;
    }

    if (window.getComputedStyle(card).display === "none") {
      return false;
    }

    const noPreviewContainer = card.querySelector(".no-preview-container");
    if (noPreviewContainer && !noPreviewContainer.hidden && window.getComputedStyle(noPreviewContainer).display !== "none") {
      return false;
    }

    return true;
  });

  lbImages = cards.map((card) => {
    const img = card.querySelector("img");
    const link = card.querySelector("a.card-open-link, a");
    return {
      thumb: img ? (img.currentSrc || img.src) : "",
      url: card.dataset.url || (link ? link.href : (img ? (img.currentSrc || img.src) : ""))
    };
  }).filter((image) => Boolean(image.url));

  if (!lbImages.length) {
    return;
  }

  currentLbIndex = lbImages.findIndex((image) => image.url === startImageUrl);
  if (currentLbIndex === -1) {
    currentLbIndex = 0;
  }
  const overlay = document.getElementById("iep-lightbox");
  if (!overlay) {
    return;
  }

  overlay.style.display = "flex";
  renderLightboxImage();
  renderThumbnails();
  document.body.style.overflow = "hidden";
};

function closeLightbox() {
  const overlay = document.getElementById("iep-lightbox");
  if (overlay) {
    overlay.style.display = "none";
  }

  document.body.style.overflow = "";
}

function renderLightboxImage() {
  if (!lbImages.length) {
    return;
  }

  const mainImage = document.getElementById("lb-main-image");
  const downloadButtonElement = document.getElementById("lb-download-btn");
  if (!mainImage) {
    return;
  }
  const initialUrl = lbImages[currentLbIndex].url;
  const thumbUrl = lbImages[currentLbIndex].thumb;
  const activeIndex = currentLbIndex;

  // 1. Instantly show thumbnail (or cached 4K) so the user never sees a blank screen
  if (imageCacheManager.blobUrls.has(initialUrl)) {
    mainImage.src = imageCacheManager.blobUrls.get(initialUrl);
  } else {
    mainImage.src = thumbUrl;
  }
  if (downloadButtonElement) {
    downloadButtonElement.onclick = () => {
      api.downloads.download({ url: initialUrl, saveAs: true }).catch(() => {});
    };
  }

  if (!shouldAutoUpgradeResolutions() || !isFlickrUrl(initialUrl)) {
    document.querySelectorAll(".lb-thumb").forEach((thumbnail, index) => {
      thumbnail.classList.toggle("active", index === currentLbIndex);
      if (index === currentLbIndex) {
        thumbnail.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center"
        });
      }
    });
    return;
  }

  // 2. Fetch max URL, Cache it, then swap it in seamlessly
  window.getTrueFlickrMax(initialUrl).then((maxData) => {
    const maxUrl = maxData?.url || initialUrl;
    if (currentLbIndex !== activeIndex) return;

    imageCacheManager.get(maxUrl).then((blobUrl) => {
      if (currentLbIndex === activeIndex && mainImage.src !== blobUrl) {
        mainImage.src = blobUrl;
      }
    });

    if (downloadButtonElement) {
      downloadButtonElement.onclick = () => {
        api.downloads.download({ url: maxUrl, saveAs: true }).catch(() => {});
      };
    }
  }).catch(() => {
    if (downloadButtonElement) {
      downloadButtonElement.onclick = () => {
        api.downloads.download({ url: initialUrl, saveAs: true }).catch(() => {});
      };
    }
  });

  // 3. Invisibly preload the 4K versions of the NEXT and PREVIOUS images
  const nextIndex = (currentLbIndex + 1) % lbImages.length;
  const prevIndex = (currentLbIndex - 1 + lbImages.length) % lbImages.length;
  window.getTrueFlickrMax(lbImages[nextIndex]?.url).then((data) => imageCacheManager.preload(data?.url || lbImages[nextIndex]?.url));
  window.getTrueFlickrMax(lbImages[prevIndex]?.url).then((data) => imageCacheManager.preload(data?.url || lbImages[prevIndex]?.url));

  document.querySelectorAll(".lb-thumb").forEach((thumbnail, index) => {
    thumbnail.classList.toggle("active", index === currentLbIndex);
    if (index === currentLbIndex) {
      thumbnail.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    }
  });
}

function renderThumbnails() {
  const strip = document.getElementById("lb-thumbnail-strip");
  if (!strip) {
    return;
  }

  strip.replaceChildren();
  lbImages.forEach((imageData, index) => {
    const image = document.createElement("img");
    image.src = imageData.thumb || imageData.url;
    image.className = `lb-thumb${index === currentLbIndex ? " active" : ""}`;
    image.addEventListener("click", () => {
      currentLbIndex = index;
      renderLightboxImage();
    });
    strip.appendChild(image);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLightbox);
} else {
  initLightbox();
}













