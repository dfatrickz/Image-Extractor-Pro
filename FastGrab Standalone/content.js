(() => {
  if (window.__fastGrabStandaloneLoaded) {
    return;
  }
  window.__fastGrabStandaloneLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const URL_ATTRIBUTES = [
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-url",
    "data-image",
    "data-full-src",
    "data-full-url",
    "data-zoom-image",
    "data-large",
    "data-hires",
    "data-download",
    "data-media",
    "data-pin-media",
    "data-src-retina",
    "poster"
  ];
  const SRCSET_ATTRIBUTES = [
    "srcset",
    "data-srcset",
    "data-lazy-srcset",
    "data-bgset",
    "data-flickity-lazyload-srcset"
  ];
  const BACKGROUND_ATTRIBUTES = [
    "data-bg",
    "data-background",
    "data-background-image",
    "data-src",
    "data-original",
    "data-image",
    "data-full-src"
  ];
  const SUPPORTED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "heic", "heif"]);
  const PREFERRED_DOWNLOAD_FORMATS = new Set(["jpg", "png"]);

  let lastRightClickX = 0;
  let lastRightClickY = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;

  const flickrUrlCache = new Map();
  const state = {
    enabled: false,
    currentTarget: null,
    hoverButton: null,
    hoverFlashTimer: 0,
    settings: {
      hoverEnabled: true,
      autoUpgrade: true,
      minSize: 80
    },
    hoverFrame: 0,
    scrollFrame: 0,
    hoverRequestId: 0,
    pendingPoint: null
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function detectFormat(url, contentType = "") {
    const normalizedType = String(contentType || "").toLowerCase();
    if (normalizedType.startsWith("image/")) {
      if (normalizedType.includes("jpeg")) return "jpg";
      if (normalizedType.includes("svg")) return "svg";
      if (normalizedType.includes("heic")) return "heic";
      if (normalizedType.includes("heif")) return "heif";
      if (normalizedType.includes("bmp")) return "bmp";
      if (normalizedType.includes("webp")) return "webp";
      if (normalizedType.includes("png")) return "png";
      if (normalizedType.includes("gif")) return "gif";
    }

    if (!url) {
      return "";
    }

    if (String(url).includes("unsplash.com/")) {
      return "jpg";
    }

    if (String(url).startsWith("data:image/")) {
      const section = String(url).slice("data:image/".length).split(/[;,]/, 1)[0].toLowerCase();
      return normalizeFormat(section === "svg+xml" ? "svg" : section);
    }

    try {
      const parsedUrl = new URL(url, document.baseURI);
      const extensionMatch = parsedUrl.pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
      if (extensionMatch) {
        return normalizeFormat(extensionMatch[1]);
      }
      return normalizeFormat(parsedUrl.searchParams.get("format") || parsedUrl.searchParams.get("fm") || parsedUrl.searchParams.get("ext") || "");
    } catch (_error) {
      return "";
    }
  }

  function normalizeFormat(value) {
    const normalized = String(value || "").toLowerCase().trim();
    if (normalized === "jpeg") return "jpg";
    if (normalized === "svg+xml") return "svg";
    return normalized;
  }

  function looksLikeImageReference(url) {
    if (!url) {
      return false;
    }
    if (url.startsWith("data:image/") || url.startsWith("blob:")) {
      return true;
    }
    return SUPPORTED_FORMATS.has(detectFormat(url));
  }

  function upgradeKnownPlatforms(url) {
    if (!url) return url;

    if (url.includes("twimg.com/media/")) {
      if (url.match(/name=/i)) {
        return url.replace(/name=[^&]+/i, "name=orig");
      }
      return url.includes("?") ? `${url}&name=orig` : `${url}?name=orig`;
    }

    if (url.includes("i.ytimg.com/vi/")) {
      const ytUrl = url.replace(/\/(hqdefault|mqdefault|sddefault|default|hq720|hq1080|0|1|2|3)\.jpg/i, "/maxresdefault.jpg");
      return ytUrl.split("?")[0];
    }

    if (url.includes(".imgsrc.ru/")) {
      return url.replace(/(:\/\/)[a-z0-9]+(\.imgsrc\.ru\/)/i, "$1b$2");
    }

    if (url.includes("unsplash.com/")) {
      return url.split("?")[0];
    }

    if (url.includes("staticflickr.com/")) {
      url = url.split("?")[0];
    }

    if (url.includes("i.pinimg.com/")) {
      return url.replace(/(i\.pinimg\.com)\/(?:\d+x)\//i, "$1/originals/");
    }

    return url;
  }

  function resolveAbsoluteUrl(value) {
    if (!value) {
      return "";
    }

    const trimmed = String(value).trim();
    if (!trimmed || trimmed === "none" || trimmed === "#" || /^javascript:/i.test(trimmed)) {
      return "";
    }

    if (trimmed.startsWith("data:image/") || trimmed.startsWith("blob:")) {
      return trimmed;
    }

    try {
      const absoluteHref = trimmed.startsWith("/")
        ? new URL(trimmed, window.location.origin).href
        : new URL(trimmed, document.baseURI).href;
      return upgradeKnownPlatforms(absoluteHref.replace(/^http:/i, "https:"));
    } catch (_error) {
      return "";
    }
  }

  function parseSrcsetCandidates(srcsetValue) {
    if (!srcsetValue) {
      return [];
    }

    return String(srcsetValue)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+/).filter(Boolean);
        const lastToken = parts[parts.length - 1] || "";
        const hasDescriptor = /^(\d+w|\d+(?:\.\d+)?x)$/.test(lastToken);
        const rawUrl = hasDescriptor ? parts.slice(0, -1).join(" ") : parts.join(" ");
        const url = resolveAbsoluteUrl(rawUrl);
        let score = 1;

        if (hasDescriptor && lastToken.endsWith("w")) {
          score = Number.parseInt(lastToken, 10) || 1;
        } else if (hasDescriptor && lastToken.endsWith("x")) {
          score = Math.round((Number.parseFloat(lastToken) || 1) * 1000);
        }

        return { url, score };
      })
      .filter((entry) => entry.url);
  }

  function pickBestFromSrcset(srcsetValue) {
    const candidates = parseSrcsetCandidates(srcsetValue);
    if (!candidates.length) {
      return "";
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].url;
  }

  function getPreferredDownloadFormatScore(url) {
    const format = detectFormat(url);
    if (PREFERRED_DOWNLOAD_FORMATS.has(format)) {
      return 2;
    }
    if (format === "webp") {
      return 0;
    }
    return 1;
  }

  function pickBestDownloadCandidateFromSrcset(srcsetValue) {
    const candidates = parseSrcsetCandidates(srcsetValue);
    if (!candidates.length) {
      return "";
    }

    candidates.sort((left, right) => {
      const formatDelta = getPreferredDownloadFormatScore(right.url) - getPreferredDownloadFormatScore(left.url);
      if (formatDelta) {
        return formatDelta;
      }
      return right.score - left.score;
    });

    return candidates[0].url;
  }

  function addBestImageCandidate(target, url, sourceType, sourceRank) {
    const absoluteUrl = resolveAbsoluteUrl(url);
    if (!absoluteUrl) {
      return;
    }

    target.push({
      url: absoluteUrl,
      sourceType,
      sourceRank,
      formatScore: getPreferredDownloadFormatScore(absoluteUrl)
    });
  }

  function compareBestImageCandidates(left, right) {
    if (left.formatScore !== right.formatScore) {
      return right.formatScore - left.formatScore;
    }
    return right.sourceRank - left.sourceRank;
  }

  function addCandidate(target, url, sourceType, sourceRank) {
    const resolvedUrl = resolveAbsoluteUrl(url);
    if (resolvedUrl) {
      target.push({ url: resolvedUrl, sourceType, sourceRank });
    }
  }

  function dedupeCandidates(candidates) {
    const seen = new Map();
    for (const candidate of candidates) {
      const key = String(candidate.url || "").trim();
      if (!key) {
        continue;
      }

      const existing = seen.get(key);
      if (!existing || candidate.sourceRank > existing.sourceRank) {
        seen.set(key, candidate);
      }
    }
    return Array.from(seen.values());
  }

  function extractBackgroundUrls(element) {
    if (!(element instanceof Element)) {
      return [];
    }

    const urls = [];
    const styleValue = [
      window.getComputedStyle(element).backgroundImage,
      ...BACKGROUND_ATTRIBUTES.map((attribute) => element.getAttribute(attribute) || "")
    ].join(" ");

    const pattern = /url\((['"]?)(.*?)\1\)/gi;
    let match = pattern.exec(styleValue);

    while (match) {
      if (match[2]) {
        urls.push(resolveAbsoluteUrl(match[2]));
      }
      match = pattern.exec(styleValue);
    }

    return urls.filter(Boolean);
  }

  function isHoverVisibleTarget(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    let currentElement = element;
    while (currentElement && currentElement !== document.body && currentElement !== document.documentElement) {
      const style = window.getComputedStyle(currentElement);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      currentElement = currentElement.parentElement;
    }

    const rect = element.getBoundingClientRect();
    if (rect.right < 0 || rect.left > window.innerWidth) {
      return false;
    }

    return true;
  }

  function isStructurallyOccluded(topmost, targetImg) {
    if (!topmost || topmost === targetImg) return false;
    if (topmost.contains(targetImg) || targetImg.contains(topmost)) return false;

    // Check if they share a close container (within 4 levels).
    // Valid image overlays share a parent. Sticky headers do not.
    let ancestor = targetImg.parentElement;
    for (let i = 0; i < 4; i++) {
      if (!ancestor) break;
      if (ancestor.contains(topmost)) return false;
      ancestor = ancestor.parentElement;
    }
    return true; // Unrelated UI element detected!
  }

  function getVisualRect(img) {
    const rawRect = img.getBoundingClientRect();
    // If it's not a loaded image, just return the raw DOM rect
    if (img.tagName !== "IMG" || !img.naturalWidth || !img.naturalHeight) {
      return rawRect;
    }

    const style = window.getComputedStyle(img);
    // Only calculate if the image is using "contain" or "scale-down" inside a larger box
    if (style.objectFit === "contain" || style.objectFit === "scale-down") {
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const boxRatio = rawRect.width / rawRect.height;

      let visWidth;
      let visHeight;
      let visLeft;
      let visTop;

      if (imgRatio > boxRatio) {
        // Image is constrained by the width of the box
        visWidth = rawRect.width;
        visHeight = rawRect.width / imgRatio;
        visLeft = rawRect.left;
        visTop = rawRect.top + ((rawRect.height - visHeight) / 2);
      } else {
        // Image is constrained by the height of the box
        visHeight = rawRect.height;
        visWidth = rawRect.height * imgRatio;
        visTop = rawRect.top;
        visLeft = rawRect.left + ((rawRect.width - visWidth) / 2);
      }

      return {
        top: visTop,
        left: visLeft,
        right: visLeft + visWidth,
        bottom: visTop + visHeight,
        width: visWidth,
        height: visHeight
      };
    }

    return rawRect;
  }

  function isValidTargetImage(element) {
    if (!(element instanceof HTMLImageElement) || element.tagName !== "IMG") {
      return false;
    }

    if (!isHoverVisibleTarget(element)) {
      return false;
    }

    const imageUrl = String(element.currentSrc || element.src || "");
    if (/spaceball|transparent/i.test(imageUrl)) {
      return false;
    }

    if (Number(element.naturalWidth || 0) <= 1) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < state.settings.minSize) {
      return false;
    }

    return true;
  }

  function getImageFromPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

    const hitElements = Array.from(document.elementsFromPoint(clientX, clientY))
      .filter((element) => element instanceof Element);

    if (hitElements.some((element) => element.id === "iepSurferHoverBtn" || element.id === "iepShell")) {
      return null;
    }

    // Identify the true visual topmost element (ignoring our own button)
    const topmost = hitElements.find((el) => el.id !== "iepSurferHoverBtn");

    for (const element of hitElements) {
      if (!(element instanceof Element)) continue;

      const style = window.getComputedStyle(element);

      // 1. Ignore anything explicitly blurred (Standard or Backdrop)
      if ((style.filter && style.filter.includes("blur")) ||
          (style.backdropFilter && style.backdropFilter.includes("blur"))) {
        continue;
      }

      // 2. Ignore massive background "wallpaper" images in lightboxes
      const rect = element.getBoundingClientRect?.();
      if (rect && rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95) {
        // If the image spans 95%+ of the entire screen, it is a backdrop layer, not the subject.
        if (style.objectFit === "cover" || String(element.className || "").toLowerCase().includes("blur")) {
          continue;
        }
      }

      if (element.tagName === "IMG" && isValidTargetImage(element) && isHoverVisibleTarget(element)) {
        if (topmost && isStructurallyOccluded(topmost, element)) continue; // Blocked by UI
        return element;
      }

      if (style.backgroundImage && style.backgroundImage !== "none" && style.backgroundImage.startsWith("url(")) {
        if (rect && rect.width >= state.settings.minSize && rect.height >= state.settings.minSize && isHoverVisibleTarget(element)) {
          if (topmost && isStructurallyOccluded(topmost, element)) continue; // Blocked by UI
          return element;
        }
      }
    }

    const isInstagram = window.location.hostname.includes("instagram.com");
    for (const element of hitElements) {
      let images = Array.from(element.querySelectorAll("img"));
      if (element.parentElement) images = images.concat(Array.from(element.parentElement.querySelectorAll("img")));

      for (const image of images) {
        if (isInstagram) {
          if (hitElements.includes(image) && isValidTargetImage(image) && isHoverVisibleTarget(image)) {
            if (topmost && isStructurallyOccluded(topmost, image)) continue; // Blocked by UI
            return image;
          }
        } else {
          const rect = image.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            if (isValidTargetImage(image) && isHoverVisibleTarget(image)) {
              if (topmost && isStructurallyOccluded(topmost, image)) continue; // Blocked by UI
              return image;
            }
          }
        }
      }
    }
    return null;
  }

  async function fetchAsBase64(url) {
    try {
      // Fetch the image natively within the authenticated tab context
      const response = await fetch(url);
      if (!response.ok) return null;

      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result); // Returns data:image/...;base64,...
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_error) {
      return null;
    }
  }

  async function upgradeKnownUrls(url) {
    if (!url || !url.startsWith("http")) return url;
    try {
      const urlObj = new URL(url);

      // --- TUMBLR DUAL-FORMAT PROBER ---
      if (urlObj.hostname.endsWith("media.tumblr.com")) {
        const path = urlObj.pathname;
        let testUrls = [];

        // 1. Modern Format (e.g., /s540x810/ or /s64x64u_c1/)
        if (/\/s\d+x\d+(?:u_c\d+)?\//i.test(path)) {
          const base2048 = path.replace(/\/s\d+x\d+(?:u_c\d+)?\//i, "/s2048x3072/");
          const base1280 = path.replace(/\/s\d+x\d+(?:u_c\d+)?\//i, "/s1280x1920/");
          testUrls.push(urlObj.origin + base2048);
          testUrls.push(urlObj.origin + base1280);
        }
        // 2. Classic Format (e.g., _500.jpg, _540.png)
        else if (/_(\d+)\.(jpg|jpeg|png|gif)$/i.test(path)) {
          const match = path.match(/_(\d+)\.(jpg|jpeg|png|gif)$/i);
          if (match && parseInt(match[1], 10) < 1280) {
            testUrls.push(urlObj.origin + path.replace(/_\d+\./, "_2048."));
            testUrls.push(urlObj.origin + path.replace(/_\d+\./, "_1280."));
          }
        }

        // Execute lightweight probes to verify the maximum available resolution
        for (const testUrl of testUrls) {
          try {
            const response = await fetch(testUrl, { method: "HEAD" });
            if (response.ok) return testUrl;
          } catch (_error) {
            continue; // Silently move to the next fallback if blocked or 404
          }
        }
        return url; // Fallback to standard preview if all probes fail
      }

      // --- IMGUR ASYNC PROBER ---
      if (urlObj.hostname === "i.imgur.com" || urlObj.hostname === "imgur.com") {
        // Imgur core IDs are typically 5 or 7 characters.
        // Thumbnails append a size suffix (s, b, t, m, l, h) before the extension.
        const pathMatch = urlObj.pathname.match(/^(\/[a-zA-Z0-9]{5,7})([sbtmlh]?)\.(jpg|jpeg|png|gif|webp)$/i);

        if (pathMatch) {
          const basePath = pathMatch[1]; // The clean, core ID without the thumbnail suffix

          // Probe for highest quality, uncompressed native formats first
          const possibleExtensions = [".png", ".jpg", ".gif"];

          for (const ext of possibleExtensions) {
            const testUrl = "https://i.imgur.com" + basePath + ext;
            try {
              const response = await fetch(testUrl, { method: "HEAD" });
              if (response.ok) {
                return testUrl; // Found the raw original file!
              }
            } catch (_error) {
              continue;
            }
          }
        }
        return url; // Fallback to standard URL if all probes fail
      }

// --- PIXIV RESOURCE VERIFICATION ---
      if (urlObj.hostname === "i.pximg.net") {
        const match = urlObj.pathname.match(/(\/img\/.*?\/\d+_p\d+)/i);
        if (match) {
          const basePath = match[1];
          const possibleExtensions = [".png", ".jpg", ".gif"];

          for (const ext of possibleExtensions) {
            const testUrl = "https://i.pximg.net/img-original" + basePath + ext;
            try {
              // The background rule handles the Referer natively!
              const response = await fetch(testUrl, { method: "HEAD" });
              if (response.ok) {
                return testUrl; // Just return the clean URL
              }
            } catch (e) {
              continue;
            }
          }
        }
        return url;
      }

      // --- PINTEREST ASYNC PROBER ---
      if (urlObj.hostname === "i.pinimg.com") {
        let basePath = urlObj.pathname.replace(/\/\d+x\//i, "/originals/");
        basePath = basePath.replace(/\.[^/.]+$/, "");
        const possibleExtensions = [".jpg", ".heic", ".png", ".gif"];

        for (const ext of possibleExtensions) {
          const testUrl = urlObj.origin + basePath + ext;
          try {
            const response = await fetch(testUrl, { method: "HEAD" });
            if (response.ok) return testUrl;
          } catch (_error) { continue; }
        }
        return url;
      }

      // Reddit and unhandled domains
      return urlObj.href;
    } catch (_error) {
      return url;
    }
  }

  const getTrueImageUrl = (element) => {
    if (!(element instanceof Element)) {
      return null;
    }

    let img = null;
    if (element.tagName === "IMG") {
      img = element;
    } else {
      img = element.querySelector("img")
        || element.closest("a")?.querySelector("img")
        || element.parentElement?.querySelector("img");
    }

    if (!(img instanceof HTMLImageElement)) {
      return null;
    }

    let finalUrl = img.currentSrc || img.src;

    if (window.location.hostname.includes("google.")) {
      const parentAnchor = img.closest("a");
      if (parentAnchor?.href && parentAnchor.href.includes("imgurl=")) {
        try {
          const urlParams = new URLSearchParams(new URL(parentAnchor.href).search);
          const highResUrl = urlParams.get("imgurl");
          if (highResUrl) {
            finalUrl = decodeURIComponent(highResUrl);
          }
        } catch (_error) {
          console.warn("FastGrab: Failed to parse Google imgurl.");
        }
      }
    }

    finalUrl = resolveAbsoluteUrl(finalUrl) || finalUrl;
    return { targetImg: img, url: finalUrl };
  };

  function normalizeFlickrUrl(url) {
    let cleanUrl = String(url || "")
      .trim()
      .replace(/\\u002F/gi, "/")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003F/gi, "?")
      .replace(/\\u003D/gi, "=")
      .replace(/\\\//g, "/")
      .replace(/\\\?/g, "?")
      .replace(/&amp;/gi, "&");

    if (!cleanUrl) {
      return "";
    }

    if (cleanUrl.startsWith("//")) {
      cleanUrl = `https:${cleanUrl}`;
    } else if (!/^https?:\/\//i.test(cleanUrl) && /(live\.staticflickr\.com|farm[0-9]+\.staticflickr\.com)/i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl.replace(/^\/+/, "")}`;
    }
    cleanUrl = cleanUrl.replace(/^http:/i, "https:");

    return cleanUrl;
  }

  function getFlickrHighRes(thumbUrl) {
    if (!thumbUrl || !thumbUrl.includes("flickr.com")) {
      return thumbUrl;
    }

    const normalizedThumbUrl = normalizeFlickrUrl(thumbUrl) || thumbUrl;

    if (/_([a-f0-9]+)_[kho]\.(?:jpg|png|gif|webp)/i.test(normalizedThumbUrl)) {
      return normalizedThumbUrl;
    }

    const idMatch = normalizedThumbUrl.match(/\/(\d+)_[a-f0-9]+/i);
    if (idMatch) {
      const photoId = idMatch[1];
      const scriptContent = Array.from(document.scripts)
        .filter((script) => {
          const className = typeof script.className === "string" ? script.className : "";
          const text = String(script.textContent || "");
          return /modelExport/i.test(className) || /modelExport|Y\.API|staticflickr\.com/i.test(text);
        })
        .map((script) => script.textContent || "")
        .join(" ");
      const sizes = ["o", "k", "h"];

      for (const size of sizes) {
        const regex = new RegExp(`([^"']+(?:live\\.staticflickr\\.com|farm[0-9]+\\.staticflickr\\.com)[^"']+?${photoId}_[a-f0-9]+_${size}\\.(?:jpg|png|gif|webp)[^"']*)`, "i");
        const match = scriptContent.match(regex);
        if (match) {
          let finalUrl = match[1].replace(/\\\//g, "/");
          if (finalUrl.startsWith("//")) {
            finalUrl = `https:${finalUrl}`;
          }
          return finalUrl;
        }
      }
    }

    const urlParts = normalizedThumbUrl.match(/live\.staticflickr\.com\/(\d+)\/(\d+)_([a-zA-Z0-9]+)_/);
    if (urlParts) {
      const serverId = urlParts[1];
      const photoId = urlParts[2];
      const standardSecret = urlParts[3];
      const searchGround = document.documentElement.innerHTML;
      const secretIndex = searchGround.indexOf(`"${standardSecret}"`);

      if (secretIndex !== -1) {
        const localBlock = searchGround.substring(Math.max(0, secretIndex - 800), secretIndex + 1500);
        const osMatch = localBlock.match(/"originalsecret"\s*:\s*"([a-zA-Z0-9]+)"/);
        const ofMatch = localBlock.match(/"originalformat"\s*:\s*"([a-zA-Z0-9]+)"/);
        if (osMatch) {
          const fmt = ofMatch ? ofMatch[1] : "jpg";
          return `https://live.staticflickr.com/${serverId}/${photoId}_${osMatch[1]}_o.${fmt}`;
        }

        const upgradeMatch = localBlock.match(/"upgrade_sizes"\s*:\s*\[(.*?)\]/);
        if (upgradeMatch) {
          const sizes = upgradeMatch[1];
          if (sizes.includes('"k"')) return `https://live.staticflickr.com/${serverId}/${photoId}_${standardSecret}_k.jpg`;
          if (sizes.includes('"h"')) return `https://live.staticflickr.com/${serverId}/${photoId}_${standardSecret}_h.jpg`;
        }
      }
    }

    return normalizedThumbUrl;
  }

  window.getTrueFlickrMax = async function(thumbUrl) {
    const fallback = { url: thumbUrl, width: null, height: null };
    if (!thumbUrl || !thumbUrl.includes("flickr.com")) {
      return fallback;
    }

    if (/_([a-fA-F0-9]+)_o\.(jpg|jpeg|png|gif|webp)/i.test(thumbUrl)) {
      return { ...fallback, fromCache: true };
    }

    if (flickrUrlCache.has(thumbUrl)) {
      return { ...flickrUrlCache.get(thumbUrl), fromCache: true };
    }

    function saveAndReturn(result) {
      const toSave = { ...result };
      delete toSave.fromCache;
      flickrUrlCache.set(thumbUrl, toSave);
      return { ...toSave, fromCache: false };
    }

    const match = thumbUrl.match(/live\.staticflickr\.com\/(\d+)\/(\d+)_([a-fA-F0-9]+)/);
    if (!match) {
      return fallback;
    }

    const serverId = match[1];
    const photoId = match[2];
    const allSizes = ["o", "6k", "5k", "4k", "3k", "k", "h", "b", "c", "z"];

    function getDims(text, sizeLetter) {
      const dimMatch = text.match(new RegExp(`"${sizeLetter}"\\s*:\\s*\\{[^{}]*"width"\\s*:\\s*(\\d+)[^{}]*"height"\\s*:\\s*(\\d+)`, "i"));
      if (dimMatch) {
        return { width: Number.parseInt(dimMatch[1], 10), height: Number.parseInt(dimMatch[2], 10) };
      }

      const flatMatch = text.match(new RegExp(`"width_${sizeLetter}"\\s*:\\s*(\\d+).*?"height_${sizeLetter}"\\s*:\\s*(\\d+)`, "i"));
      if (flatMatch) {
        return { width: Number.parseInt(flatMatch[1], 10), height: Number.parseInt(flatMatch[2], 10) };
      }

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

      for (const size of sizeArray) {
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
    const searchGround = isFlickrPage ? document.documentElement.innerHTML : "";

    console.log("[IEP Debug] Deep Scanning:", thumbUrl);
    // Strict Local Fast Path: Only trust the local DOM if it contains the absolute maximum "o" size.
    // This prevents SPA carousels from tricking the scanner with stale JSON.
    const fastResult = scanTextForUrls(searchGround, ["o"]);
    if (fastResult) {
      console.log("[IEP Debug] FAST PATH SUCCESS!");
      return saveAndReturn(fastResult);
    }

    const controller = new AbortController();
    let timeoutId = 0;
    try {
      const pageUrl = `https://www.flickr.com/photo.gne?id=${photoId}`;
      timeoutId = window.setTimeout(() => controller.abort(), 8000);

      const res = await fetch(pageUrl, {
        credentials: "omit",
        signal: controller.signal
      });

      window.clearTimeout(timeoutId);
      if (!res.ok) {
        console.warn(`[IEP Debug] Bad HTTP Status for ${photoId}:`, res.status);
      }

      const htmlText = await res.text();
      const fetchResult = scanTextForUrls(htmlText, allSizes);
      if (fetchResult) {
        return saveAndReturn(fetchResult);
      }
    } catch (error) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (error?.name === "AbortError") {
        console.warn(`[IEP Debug] Flickr fetch timed out for ${photoId}.`);
      } else {
        console.error("[IEP Debug] Background Flickr fetch failed:", error);
      }
    }

    return fallback;
  };

  async function normalizeCandidateUrl(url) {
    const absoluteUrl = resolveAbsoluteUrl(url);
    if (!absoluteUrl) {
      return null;
    }

    if (absoluteUrl.startsWith("blob:")) {
      try {
        const response = await fetch(absoluteUrl);
        if (!response.ok) {
          return null;
        }
        const blob = await response.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (_error) {
        return null;
      }
    }

    return absoluteUrl;
  }

  function collectAncestorImageUrls(element) {
    const results = [];
    let current = element.closest("a, [data-pin-media], [data-full-src], [data-media], [data-original], [data-image]");
    let depth = 0;

    while (current && depth < 4) {
      if (current instanceof HTMLAnchorElement && looksLikeImageReference(current.href)) {
        results.push({ url: current.href, sourceType: "anchor", sourceRank: 84 });
      }

      for (const attribute of ["href", ...URL_ATTRIBUTES, ...BACKGROUND_ATTRIBUTES]) {
        const value = resolveAbsoluteUrl(current.getAttribute?.(attribute));
        if (value && looksLikeImageReference(value)) {
          results.push({ url: value, sourceType: "anchor", sourceRank: 72 });
        }
      }

      current = current.parentElement?.closest?.("a, [data-pin-media], [data-full-src], [data-media], [data-original], [data-image]") || null;
      depth += 1;
    }

    return results;
  }

  async function resolveQuickDownloadUrl(element) {
    if (!element) {
      return "";
    }

    const candidates = [];

    if (element instanceof HTMLPictureElement) {
      const previewImage = element.querySelector("img");
      if (previewImage instanceof HTMLImageElement) {
        return resolveQuickDownloadUrl(previewImage);
      }

      for (const source of Array.from(element.querySelectorAll("source"))) {
        const sourceUrl = await resolveQuickDownloadUrl(source);
        if (sourceUrl) {
          return sourceUrl;
        }
      }

      return "";
    }

    if (element instanceof HTMLSourceElement) {
      const sourceSrcset = pickBestFromSrcset(element.srcset || element.getAttribute("srcset"));
      if (sourceSrcset) {
        addCandidate(candidates, sourceSrcset, "source", 68);
      }

      for (const attribute of SRCSET_ATTRIBUTES) {
        const bestCandidate = pickBestFromSrcset(element.getAttribute(attribute));
        if (bestCandidate) {
          addCandidate(candidates, bestCandidate, "source", 66);
        }
      }

      for (const attribute of URL_ATTRIBUTES) {
        addCandidate(candidates, element.getAttribute(attribute), "source", 62);
      }
    } else if (element instanceof HTMLImageElement) {
      addCandidate(candidates, element.currentSrc || (element.hasAttribute("src") ? element.src : ""), "rendered", 60);

      const bestImageSrcset = pickBestFromSrcset(element.srcset || element.getAttribute("srcset"));
      if (bestImageSrcset) {
        addCandidate(candidates, bestImageSrcset, "source", 58);
      }

      for (const attribute of URL_ATTRIBUTES) {
        addCandidate(candidates, element.getAttribute(attribute), "rendered", 52);
      }

      for (const attribute of SRCSET_ATTRIBUTES) {
        const bestCandidate = pickBestFromSrcset(element.getAttribute(attribute));
        if (bestCandidate) {
          addCandidate(candidates, bestCandidate, "source", 56);
        }
      }

      const picture = element.closest("picture");
      if (picture) {
        for (const source of Array.from(picture.querySelectorAll("source"))) {
          const bestSourceSrcset = pickBestFromSrcset(source.srcset || source.getAttribute("srcset"));
          if (bestSourceSrcset) {
            addCandidate(candidates, bestSourceSrcset, "source", 66);
          }

          for (const attribute of SRCSET_ATTRIBUTES) {
            const value = pickBestFromSrcset(source.getAttribute(attribute));
            if (value) {
              addCandidate(candidates, value, "source", 64);
            }
          }
        }
      }

      for (const candidate of collectAncestorImageUrls(element)) {
        addCandidate(candidates, candidate.url, candidate.sourceType, candidate.sourceRank);
      }
    } else if (element instanceof Element) {
      for (const value of extractBackgroundUrls(element)) {
        addCandidate(candidates, value, "background", 48);
      }

      for (const attribute of [...BACKGROUND_ATTRIBUTES, ...URL_ATTRIBUTES]) {
        addCandidate(candidates, element.getAttribute(attribute), "background", 44);
      }

      for (const attribute of SRCSET_ATTRIBUTES) {
        const bestCandidate = pickBestFromSrcset(element.getAttribute(attribute));
        if (bestCandidate) {
          addCandidate(candidates, bestCandidate, "background", 42);
        }
      }
    }

    const orderedCandidates = dedupeCandidates(candidates).sort((left, right) => right.sourceRank - left.sourceRank);
    for (const candidate of orderedCandidates) {
      const normalizedUrl = await normalizeCandidateUrl(candidate.url);
      if (normalizedUrl) {
        return normalizedUrl;
      }
    }

    return "";
  }

  async function getBestImageUrl(element) {
    if (!element) {
      return "";
    }

    const candidates = [];
    const picture = element instanceof HTMLPictureElement
      ? element
      : element instanceof HTMLImageElement
        ? element.closest("picture")
        : null;

    if (picture) {
      for (const source of Array.from(picture.querySelectorAll("source"))) {
        addBestImageCandidate(candidates, pickBestDownloadCandidateFromSrcset(source.srcset || source.getAttribute("srcset")), "source", 94);
        for (const attribute of SRCSET_ATTRIBUTES) {
          addBestImageCandidate(candidates, pickBestDownloadCandidateFromSrcset(source.getAttribute(attribute)), "source", 92);
        }
        for (const attribute of URL_ATTRIBUTES) {
          addBestImageCandidate(candidates, source.getAttribute(attribute), "source", 88);
        }
      }
    }

    if (element instanceof HTMLImageElement) {
      addBestImageCandidate(candidates, pickBestDownloadCandidateFromSrcset(element.srcset || element.getAttribute("srcset")), "source", 86);
      for (const attribute of SRCSET_ATTRIBUTES) {
        addBestImageCandidate(candidates, pickBestDownloadCandidateFromSrcset(element.getAttribute(attribute)), "source", 84);
      }
      for (const attribute of URL_ATTRIBUTES) {
        addBestImageCandidate(candidates, element.getAttribute(attribute), "rendered", 78);
      }
      addBestImageCandidate(candidates, element.currentSrc || (element.hasAttribute("src") ? element.src : ""), "rendered", 72);
    } else if (element instanceof HTMLPictureElement) {
      const previewImage = element.querySelector("img");
      if (previewImage instanceof HTMLImageElement) {
        addBestImageCandidate(candidates, previewImage.currentSrc || (previewImage.hasAttribute("src") ? previewImage.src : ""), "rendered", 70);
      }
    } else if (element instanceof Element) {
      for (const value of extractBackgroundUrls(element)) {
        addBestImageCandidate(candidates, value, "rendered", 64);
      }
      for (const attribute of [...BACKGROUND_ATTRIBUTES, ...URL_ATTRIBUTES]) {
        addBestImageCandidate(candidates, element.getAttribute(attribute), "rendered", 60);
      }
      for (const attribute of SRCSET_ATTRIBUTES) {
        addBestImageCandidate(candidates, pickBestDownloadCandidateFromSrcset(element.getAttribute(attribute)), "source", 58);
      }
    }

    const orderedCandidates = candidates
      .filter((candidate) => candidate.url)
      .sort(compareBestImageCandidates)
      .filter((candidate, index, array) => array.findIndex((entry) => entry.url === candidate.url) === index);

    let finalUrl = "";
    for (const candidate of orderedCandidates) {
      const normalizedUrl = await normalizeCandidateUrl(candidate.url);
      if (normalizedUrl) {
        finalUrl = normalizedUrl;
        break;
      }
    }

    if (!finalUrl) {
      finalUrl = await resolveQuickDownloadUrl(element);
    }

    return resolveAbsoluteUrl(getFlickrHighRes(finalUrl));
  }

  function generateQuickFilename(url) {
    try {
      const format = detectFormat(url) || "jpg";
      const urlObj = new URL(url);
      let baseName = urlObj.pathname.split("/").pop() || `fastgrab_${Date.now()}`;
      if (!baseName.includes(".")) {
        baseName = `${baseName}.${format}`;
      }
      // Normalize invalid CDN extensions
      baseName = baseName.replace(/\.pnj$/i, ".png").replace(/\.gifv$/i, ".gif");
      return baseName;
    } catch (_error) {
      return `fastgrab_${Date.now()}.jpg`;
    }
  }

  async function handleFastGrab(thumbUrl) {
    let downloadUrl = resolveAbsoluteUrl(thumbUrl) || thumbUrl;

    if (state.settings.autoUpgrade && typeof window.getTrueFlickrMax === "function") {
      const maxData = await window.getTrueFlickrMax(downloadUrl);
      downloadUrl = resolveAbsoluteUrl(maxData?.url || downloadUrl) || downloadUrl;
    }

    return api.runtime.sendMessage({
      type: "IEP_QUICK_DOWNLOAD",
      url: downloadUrl,
      filename: generateQuickFilename(downloadUrl)
    });
  }

  function ensureHoverButton() {
    if (!document.getElementById("fastgrab-protected-styles")) {
      const style = document.createElement("style");
      style.id = "fastgrab-protected-styles";
      style.textContent = `
        #iepSurferHoverBtn {
          all: initial !important;
          position: fixed !important;
          z-index: 2147483647 !important;
          display: none; /* Toggled via JS */
          align-items: center !important;
          justify-content: center !important;
          width: 32px !important;
          height: 32px !important;
          min-width: 32px !important;
          min-height: 32px !important;
          box-sizing: border-box !important;
          background: #2563eb !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 50% !important;
          cursor: pointer !important;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1) !important;
          pointer-events: auto !important;
          padding: 0 !important;
          margin: 0 !important;
          transition: transform 0.15s ease, background 0.15s ease !important;
        }
        #iepSurferHoverBtn:hover {
          transform: scale(1.1) !important;
        }
        #iepSurferHoverBtn:active {
          transform: scale(0.9) !important;
        }
        #iepSurferHoverBtn.is-success {
          background: #16a34a !important;
        }
        #iepSurferHoverBtn.is-error {
          background: #ef4444 !important;
        }
      `;
      document.head.appendChild(style);
    }

    if (state.hoverButton?.isConnected) {
      return state.hoverButton;
    }

    const button = document.createElement("button");
    button.id = "iepSurferHoverBtn";
    button.type = "button";
    button.title = "Fast Grab Image";
    button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><path d="M12 4v10"></path><path d="M8 10l4 4 4-4"></path><path d="M5 20h14"></path></svg>';
    
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      const targetElement = state.currentTarget;
      if (!targetElement) return;
      
      let targetUrl = "";
      const info = getTrueImageUrl(targetElement);

      // Google Fix: Use the extracted anchor imgurl instantly if found
      if (window.location.hostname.includes("google.") && info?.url && !info.url.startsWith("data:image")) {
        targetUrl = info.url;
      } else {
        // Deep scan fallback
        if (state.settings.autoUpgrade) {
          targetUrl = await getBestImageUrl(targetElement);
        }
        if (!targetUrl) targetUrl = info?.url || "";
      }

      if (state.settings.autoUpgrade) {
        targetUrl = await upgradeKnownUrls(targetUrl);
      }

      if (targetUrl) {
        const response = await handleFastGrab(targetUrl);
        if (response?.ok !== false) {
          flashSurferHoverButton();
        }
      } else {
        button.classList.add("is-error");
        setTimeout(() => button.classList.remove("is-error"), 700);
      }
    });

    document.documentElement.appendChild(button);
    state.hoverButton = button;
    return button;
  }

  function hideSurferHoverButton() {
    if (state.hoverButton) {
      state.hoverButton.style.setProperty("display", "none", "important");
      state.currentTarget = null;
    }
  }

  function flashSurferHoverButton() {
    if (!state.hoverButton) return;
    state.hoverButton.classList.add("is-success");
    if (state.hoverFlashTimer) window.clearTimeout(state.hoverFlashTimer);
    state.hoverFlashTimer = window.setTimeout(() => {
      if (state.hoverButton) state.hoverButton.classList.remove("is-success");
      state.hoverFlashTimer = 0;
    }, 700);
  }

  function queueSurferHoverRefresh(point) {
    state.pendingPoint = point;
    if (state.hoverFrame) {
      return;
    }

    state.hoverFrame = window.requestAnimationFrame(() => {
      state.hoverFrame = 0;
      const nextPoint = state.pendingPoint;
      state.pendingPoint = null;
      void updateSurferHoverButton(nextPoint);
    });
  }

  function updateSurferHoverButton(point) {
    const button = ensureHoverButton();
    if (!state.enabled || !state.settings.hoverEnabled || !point) {
      hideSurferHoverButton();
      return;
    }

    const hitElements = document.elementsFromPoint(point.x, point.y);
    if (hitElements.some((element) => element instanceof Element && element.id === "iepSurferHoverBtn")) {
      return; 
    }

    const target = getImageFromPoint(point.x, point.y);
    const imageInfo = target ? getTrueImageUrl(target) : null;
    const targetImg = imageInfo ? imageInfo.targetImg : null;

    if (!targetImg) {
      hideSurferHoverButton();
      return;
    }

    const rect = getVisualRect(targetImg);
    if (!rect || rect.width < state.settings.minSize || rect.height < state.settings.minSize) {
      hideSurferHoverButton();
      return;
    }

    const buttonSize = 32;
    const leftPx = Math.min(Math.max(rect.right - buttonSize - 10, 8), window.innerWidth - buttonSize - 8);
    const topPx = Math.min(Math.max(rect.top + 10, 8), window.innerHeight - buttonSize - 8);

    // --- SPAWN OCCLUSION CHECK ---
    const checkX = leftPx + 16;
    const checkY = topPx + 16;

    // Briefly hide button so it doesn't block the hit test
    const wasVisible = button.style.display !== "none";
    if (wasVisible) button.style.setProperty("display", "none", "important");

    const topmostAtSpawn = document.elementFromPoint(checkX, checkY);

    if (wasVisible) button.style.setProperty("display", "flex", "important");

    if (topmostAtSpawn && topmostAtSpawn.id !== "iepSurferHoverBtn" && isStructurallyOccluded(topmostAtSpawn, targetImg)) {
        hideSurferHoverButton();
        return; // Spawn location is blocked by a sticky header or sidebar!
    }
    // --- END SPAWN OCCLUSION CHECK ---

    state.currentTarget = targetImg;
    button.style.setProperty("display", "flex", "important");
    button.style.setProperty("left", `${leftPx}px`, "important");
    button.style.setProperty("top", `${topPx}px`, "important");
  }

  function handleSurferMouseMove(event) {
    if (event.composedPath?.().some((element) => element?.id === "iepSurferHoverBtn")) {
      return;
    }

    if (!state.enabled) {
      hideSurferHoverButton();
      return;
    }

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    queueSurferHoverRefresh({ x: lastMouseX, y: lastMouseY });
  }

  function handleSurferScroll(event) {
    if (event.composedPath?.().some((element) => element?.id === "iepSurferHoverBtn")) {
      return;
    }

    if (!state.enabled) {
      hideSurferHoverButton();
      return;
    }

    state.pendingPoint = {
      x: lastMouseX,
      y: lastMouseY
    };

    if (state.scrollFrame) {
      return;
    }

    state.scrollFrame = window.requestAnimationFrame(() => {
      state.scrollFrame = 0;
      queueSurferHoverRefresh(state.pendingPoint);
    });
  }

  async function handleContextQuickDownload(fallbackUrl = "") {
    const target = getImageFromPoint(lastRightClickX, lastRightClickY);
    let baseUrl = window.iepLastRightClickedUrl || "";

    if (!baseUrl && target) {
      baseUrl = await getBestImageUrl(target);
    }

    if (!baseUrl && fallbackUrl) {
      baseUrl = resolveAbsoluteUrl(fallbackUrl) || fallbackUrl;
    }

    if (!baseUrl) {
      return {
        ok: false,
        error: "No image was found at the last right-click location."
      };
    }

    let finalUrl = baseUrl;
    if (state.settings.autoUpgrade) {
      finalUrl = await upgradeKnownUrls(finalUrl);
      if (typeof window.getTrueFlickrMax === "function") {
        const maxData = await window.getTrueFlickrMax(finalUrl);
        finalUrl = maxData?.url || finalUrl;
      }
    }

    const response = await handleFastGrab(finalUrl);
    return response?.ok === false ? response : { ok: true };
  }

  function setFastGrabEnabled(enabled) {
    state.enabled = Boolean(enabled);
    ensureHoverButton();

    if (!state.enabled) {
      hideSurferHoverButton();
    } else {
      queueSurferHoverRefresh({ x: lastMouseX, y: lastMouseY });
    }

    return state.enabled;
  }

  document.addEventListener("pointermove", handleSurferMouseMove, true);
  document.addEventListener("mousemove", handleSurferMouseMove, true);
  window.addEventListener("scroll", handleSurferScroll, true);
  window.addEventListener("resize", () => {
    if (!state.enabled) {
      hideSurferHoverButton();
      return;
    }
    queueSurferHoverRefresh({ x: lastMouseX, y: lastMouseY });
  }, true);

  document.addEventListener("contextmenu", (event) => {
    lastRightClickX = event.clientX;
    lastRightClickY = event.clientY;

    const imageInfo = getTrueImageUrl(event.target);
    if (imageInfo?.url) {
      window.iepLastRightClickedUrl = imageInfo.url;
      return;
    }

    if (event.target instanceof Element) {
      const backgroundUrl = extractBackgroundUrls(event.target)[0];
      window.iepLastRightClickedUrl = backgroundUrl || null;
      return;
    }

    window.iepLastRightClickedUrl = null;
  }, true);

  api.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "PING":
        return Promise.resolve({ ok: true });
      case "FASTGRAB_TOGGLE_ACTIVE":
        return Promise.resolve({
          ok: true,
          enabled: setFastGrabEnabled(!state.enabled)
        });
      case "FASTGRAB_SET_ACTIVE":
        return Promise.resolve({
          ok: true,
          enabled: setFastGrabEnabled(Boolean(message.enabled))
        });
      case "IEP_EXECUTE_CONTEXT_DOWNLOAD":
        return handleContextQuickDownload(message.srcUrl || "");
      default:
        return undefined;
    }
  });

  // Load dynamic settings from storage
  api.storage.local.get("fastgrab_settings").then((data) => {
    if (data.fastgrab_settings) {
      state.settings = { ...state.settings, ...data.fastgrab_settings };
    }
  });

  // Listen for live updates if the user changes settings while a tab is open
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.fastgrab_settings?.newValue) {
      state.settings = { ...state.settings, ...changes.fastgrab_settings.newValue };
      if (!state.settings.hoverEnabled) hideSurferHoverButton();
    }
  });

  ensureHoverButton();
})();
