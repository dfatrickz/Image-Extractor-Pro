(() => {
  if (window.__imageExtractorProContentController) {
    return;
  }

  const api = browser;
  const UI_HOST_ID = "image-extractor-pro-host";
  const BLOCKED_KEYWORDS = [
    "logo",
    "icon",
    "sprite",
    "spinner",
    "banner",
    "advert",
    "ads",
    "tracking",
    "pixel",
    "placeholder",
    "favicon",
    "emoji",
    "cookie"
  ];
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
    "data-src-retina"
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
  const FORMAT_GROUPS = [
    { key: "jpg", label: "JPG", matches: ["jpg", "jpeg"], advanced: false },
    { key: "png", label: "PNG", matches: ["png"], advanced: false },
    { key: "webp", label: "WebP", matches: ["webp"], advanced: false },
    { key: "gif", label: "GIF", matches: ["gif"], advanced: false },
    { key: "svg", label: "SVG", matches: ["svg"], advanced: false },
    { key: "bmp", label: "BMP", matches: ["bmp"], advanced: true },
    { key: "heic", label: "HEIC / HEIF", matches: ["heic", "heif"], advanced: true }
  ];
  const SUPPORTED_FORMATS = new Set(FORMAT_GROUPS.flatMap((group) => group.matches));
  const PREFERRED_DOWNLOAD_FORMATS = new Set(["jpg", "png"]);
  const SMART_SCOPE_SELECTORS = [
    ".gallery",
    ".image-gallery",
    ".image-grid",
    ".grid",
    ".masonry",
    ".tiles",
    ".thumbnails",
    "[role='list']",
    "ul",
    "ol"
  ];
  const DEEP_SCAN_SELECTOR = [
    "img",
    "picture source",
    "[style*='background-image']",
    "[data-src]",
    "[data-original]",
    "[data-bg]",
    "[data-background]",
    "[data-full-src]",
    "[data-pin-media]",
    "[data-image]",
    "[data-media]"
  ].join(", ");
  const PREVIEW_SCAN_CONCURRENCY = 5;
  const IMAGE_PROBE_TIMEOUT = 4500;
  let lastRightClickX = 0;
  let lastRightClickY = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;

  class FloatingExtractorController {
    constructor() {
      this.host = null;
      this.shadowRoot = null;
      this.elements = {};
      this.sourceProbeCache = new Map();
      this.dragState = null;
      this.ignoreFabClick = false;
      this.cursorBeforeSelection = "";
      this.previewRefreshTimer = 0;
      this.surferHoverFrame = 0;
      this.surferScrollFrame = 0;
      this.surferHoverRequestId = 0;
      this.hoverFlashTimer = 0;
      this.mountPromise = null;
      this.pendingSurferPoint = null;
      this.state = {
        minimized: false,
        busy: false,
        selectionMode: false,
        settingsMode: false,
        showFab: true,
        hoveredTarget: null,
        selectedContainer: null,
        selectedContainerLabel: "",
        scannedImages: [],
        previewImages: [],
        progressVisible: false,
        progressPercent: 0,
        progressText: "Initializing scan...",
        statusMessage: "Run a page extract or select an area, then review the match count before opening the gallery.",
        statusTone: "default",
        filters: {
          minWidth: 150,
          minHeight: 150,
          formats: this.createDefaultFormatState(),
          disableSiteControls: true,
          hoverDownloadEnabled: true,
          imageOrigin: "all",
          downloadMode: "zip",
          subfolderName: "",
          disablePageScrolling: false,
          rateLimitMs: 0,
          individualDownloadWarningThreshold: 30,
          theme: "system",
          ignoredSelectors: "",
          preferLinkedOriginals: true
        },
        fabPosition: {
          x: Math.max(window.innerWidth - 88, 16),
          y: 96
        },
        panelPosition: null
      };
      this.boundResize = this.handleResize.bind(this);
      this.boundPointerMove = this.handleSelectionPointerMove.bind(this);
      this.boundSelectionClick = this.handleSelectionClick.bind(this);
      this.boundSelectionKeydown = this.handleSelectionKeydown.bind(this);
      this.boundSelectionScroll = this.handleSelectionScroll.bind(this);
      this.boundFabPointerMove = this.handleFabPointerMove.bind(this);
      this.boundFabPointerUp = this.handleFabPointerUp.bind(this);
      this.boundPanelPointerMove = this.handlePanelPointerMove.bind(this);
      this.boundPanelPointerUp = this.handlePanelPointerUp.bind(this);
      this.boundSurferMouseMove = this.handleSurferMouseMove.bind(this);
      this.boundSurferScroll = this.handleSurferScroll.bind(this);
      document.head?.querySelector?.("#iep-anti-overlay-css")?.remove();
      this.storageReady = this.loadPersistedFilters();
    }

    createDefaultFormatState() {
      return FORMAT_GROUPS.reduce((accumulator, group) => {
        accumulator[group.key] = true;
        return accumulator;
      }, {});
    }

    async loadPersistedFilters() {
      try {
        const result = await api.storage.local.get(["iepFilters"]);
        if (!result?.iepFilters || typeof result.iepFilters !== "object") {
          return;
        }

        const storedFilters = result.iepFilters;
        this.state.filters = {
          ...this.state.filters,
          ...storedFilters,
          formats: {
            ...this.createDefaultFormatState(),
            ...(storedFilters.formats && typeof storedFilters.formats === "object" ? storedFilters.formats : {})
          }
        };

        if (typeof storedFilters.showFab === "boolean") {
          this.state.showFab = storedFilters.showFab;
        }
      } catch (error) {
        // Ignore storage failures and fall back to defaults.
      }
    }

    persistFilters() {
      const persistedFilters = {
        ...this.state.filters,
        showFab: this.state.showFab
      };

      void api.storage.local.set({
        iepFilters: persistedFilters
      });
    }

    toggle() {
      if (!this.host) {
        void this.openPanel();
        return;
      }

      if (this.state.minimized) {
        void this.openPanel();
        return;
      }

      this.minimizePanel();
    }

    async mountUi() {
      if (this.host?.isConnected) {
        return;
      }

      if (this.mountPromise) {
        await this.mountPromise;
        return;
      }

      this.mountPromise = (async () => {
        await this.storageReady;
        if (this.host?.isConnected) {
          return;
        }

        document.getElementById(UI_HOST_ID)?.remove();

        this.host = document.createElement("div");
        this.host.id = UI_HOST_ID;
        this.host.style.all = "initial";
        this.host.style.position = "fixed";
        this.host.style.inset = "0";
        this.host.style.zIndex = "2147483647";
        this.host.style.pointerEvents = "none";

        this.shadowRoot = this.host.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = this.getTemplate();
        document.documentElement.appendChild(this.host);

        this.cacheElements();
        this.renderFormatOptions();
        this.attachUiEvents();
        document.addEventListener("mousemove", this.boundSurferMouseMove, true);
        document.addEventListener("scroll", this.boundSurferScroll, true);
        window.addEventListener("resize", this.boundResize, { passive: true });
        this.syncFloatingPosition();
        this.render();
      })();

      try {
        await this.mountPromise;
      } finally {
        this.mountPromise = null;
      }
    }

    cacheElements() {
      this.elements = {
        shell: this.shadowRoot.getElementById("iepShell"),
        fab: this.shadowRoot.getElementById("iepFab"),
        fabGrip: this.shadowRoot.getElementById("iepFabGrip"),
        panel: this.shadowRoot.getElementById("iepPanel"),
        panelHeader: this.shadowRoot.querySelector(".iep-panel-header"),
        settingsButton: this.shadowRoot.getElementById("iepSettingsButton"),
        minimizeButton: this.shadowRoot.getElementById("iepMinimizeButton"),
        closeButton: this.shadowRoot.getElementById("iepCloseButton"),
        settingsModal: this.shadowRoot.getElementById("iepSettingsModal"),
        settingsBackdrop: this.shadowRoot.getElementById("iepSettingsBackdrop"),
        settingsDoneButton: this.shadowRoot.getElementById("iepSettingsDoneButton"),
        downloadModeRadios: Array.from(this.shadowRoot.querySelectorAll("input[name='iepDownloadMode']")),
        subfolderNameInput: this.shadowRoot.getElementById("iepSubfolderName"),
        imageOriginSelect: this.shadowRoot.getElementById("iepImageOrigin"),
        themeSelect: this.shadowRoot.getElementById("iepTheme"),
        disablePageScrollingToggle: this.shadowRoot.getElementById("iepDisablePageScrolling"),
        disableSiteControlsToggle: this.shadowRoot.getElementById("iepDisableSiteControls"),
        hoverDownloadToggle: this.shadowRoot.getElementById("iepHoverDownloadEnabled"),
        showFabToggle: this.shadowRoot.getElementById("iepShowFab"),
        rateLimitInput: this.shadowRoot.getElementById("iepRateLimitMs"),
        individualWarningThresholdInput: this.shadowRoot.getElementById("iepIndividualWarningThreshold"),
        extractAllButton: this.shadowRoot.getElementById("iepExtractAllButton"),
        selectAreaButton: this.shadowRoot.getElementById("iepSelectAreaButton"),
        previewContainer: this.shadowRoot.getElementById("iepPreviewContainer"),
        minWidthInput: this.shadowRoot.getElementById("iepMinWidth"),
        minHeightInput: this.shadowRoot.getElementById("iepMinHeight"),
        formatOptions: this.shadowRoot.getElementById("iepFormatOptions"),
        advancedFormatOptions: this.shadowRoot.getElementById("iepAdvancedFormatOptions"),
        ignoredSelectorsInput: this.shadowRoot.getElementById("iepIgnoredSelectors"),
        preferLinkedOriginalsCheckbox: this.shadowRoot.getElementById("iepPreferLinkedOriginals"),
        cancelButton: this.shadowRoot.getElementById("iepCancelButton"),
        reviewButton: this.shadowRoot.getElementById("iepReviewButton"),
        statusBanner: this.shadowRoot.getElementById("iepStatus"),
        statusMessage: this.shadowRoot.getElementById("iepStatusMessage"),
        scanProgressWrapper: this.shadowRoot.getElementById("iepScanProgressWrapper"),
        scanProgressBar: this.shadowRoot.getElementById("iepScanProgressBar"),
        scanStatusText: this.shadowRoot.getElementById("iepScanStatusText"),
        scanPercentText: this.shadowRoot.getElementById("iepScanPercentText"),
        selectionLabel: this.shadowRoot.getElementById("iepSelectionLabel"),
        previewCount: this.shadowRoot.getElementById("iepPreviewCount"),
        previewMeta: this.shadowRoot.getElementById("iepPreviewMeta"),
        surferHoverButton: this.shadowRoot.getElementById("iepSurferHoverBtn"),
        outline: this.shadowRoot.getElementById("iepSelectionOutline")
      };
    }
    attachUiEvents() {
      this.elements.fab.addEventListener("click", (event) => {
        if (this.ignoreFabClick) {
          this.ignoreFabClick = false;
          event.preventDefault();
          return;
        }

        void this.openPanel();
      });

      this.elements.fabGrip.addEventListener("pointerdown", (event) => {
        this.startFabDrag(event);
      });

      this.elements.panelHeader.addEventListener("pointerdown", (event) => {
        this.startPanelDrag(event);
      });

      this.elements.settingsButton.addEventListener("click", () => {
        this.toggleSettingsModal();
      });

      this.elements.settingsBackdrop.addEventListener("click", () => {
        this.closeSettingsModal();
      });

      this.elements.settingsDoneButton.addEventListener("click", () => {
        this.closeSettingsModal();
      });

      this.elements.minimizeButton.addEventListener("click", () => {
        this.minimizePanel();
      });

      this.elements.closeButton.addEventListener("click", () => {
        this.closeUi();
      });

      this.elements.surferHoverButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const url = this.elements.surferHoverButton.dataset.url || "";
        if (!url) {
          return;
        }

        await api.runtime.sendMessage({
          type: "IEP_QUICK_DOWNLOAD",
          url
        });

        this.flashSurferHoverButton();
      });

      this.elements.downloadModeRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
          this.updateFiltersFromInputs();
        });
      });

      this.elements.subfolderNameInput.addEventListener("input", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.imageOriginSelect.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.themeSelect.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.disablePageScrollingToggle.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.disableSiteControlsToggle.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.hoverDownloadToggle.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.showFabToggle.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.rateLimitInput.addEventListener("input", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.individualWarningThresholdInput.addEventListener("input", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.extractAllButton.addEventListener("click", async () => {
        if (!this.state.busy) {
          await this.scanWholePage();
        }
      });

      this.elements.selectAreaButton.addEventListener("click", () => {
        if (!this.state.busy) {
          this.startSelectionMode();
        }
      });

      this.elements.cancelButton.addEventListener("click", () => {
        if (this.state.selectionMode) {
          this.stopSelectionMode();
          this.setStatus("Selection mode cancelled.", "default");
          return;
        }

        this.clearSelectionPreview();
      });

      this.elements.reviewButton.addEventListener("click", async () => {
        await this.openGallery();
      });

      this.elements.minWidthInput.addEventListener("input", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.minHeightInput.addEventListener("input", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.formatOptions.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.advancedFormatOptions.addEventListener("change", () => {
        this.updateFiltersFromInputs();
      });

      this.elements.ignoredSelectorsInput.addEventListener("change", () => {
        this.updateFiltersFromInputs({ rescan: true });
      });

      this.elements.preferLinkedOriginalsCheckbox.addEventListener("change", () => {
        this.updateFiltersFromInputs({ rescan: true });
      });
    }
    toggleSettingsModal(forceValue) {
      const nextValue = typeof forceValue === "boolean" ? forceValue : !this.state.settingsMode;
      this.state.settingsMode = nextValue;
      this.render();
    }

    closeSettingsModal() {
      this.toggleSettingsModal(false);
    }
    async openPanel() {
      await this.mountUi();
      this.state.minimized = false;
      this.render();
    }

    minimizePanel() {
      this.stopSelectionMode();
      this.state.minimized = true;
      this.closeSettingsModal();
      this.render();
    }
    closeUi() {
      this.stopSelectionMode();
      document.removeEventListener("mousemove", this.boundSurferMouseMove, true);
      document.removeEventListener("scroll", this.boundSurferScroll, true);
      window.removeEventListener("resize", this.boundResize, { passive: true });
      window.removeEventListener("pointermove", this.boundFabPointerMove, true);
      window.removeEventListener("pointerup", this.boundFabPointerUp, true);
      window.removeEventListener("pointermove", this.boundPanelPointerMove, true);
      window.removeEventListener("pointerup", this.boundPanelPointerUp, true);
      if (this.surferHoverFrame) {
        window.cancelAnimationFrame(this.surferHoverFrame);
        this.surferHoverFrame = 0;
      }
      if (this.surferScrollFrame) {
        window.cancelAnimationFrame(this.surferScrollFrame);
        this.surferScrollFrame = 0;
      }
      if (this.hoverFlashTimer) {
        window.clearTimeout(this.hoverFlashTimer);
        this.hoverFlashTimer = 0;
      }
      this.pendingSurferPoint = null;
      this.dragState = null;
      this.clearPreviewRefreshTimer();
      this.host?.remove();
      this.host = null;
      this.shadowRoot = null;
      this.elements = {};
    }
    renderFormatOptions() {
      renderFormatGroup(this.elements.formatOptions, FORMAT_GROUPS.filter((group) => !group.advanced), this.state.filters.formats);
      renderFormatGroup(this.elements.advancedFormatOptions, FORMAT_GROUPS.filter((group) => group.advanced), this.state.filters.formats);
    }

    render() {
      if (!this.host || !this.shadowRoot) {
        return;
      }

      const hasScope = Boolean(this.state.selectedContainerLabel);
      const hasPreview = this.state.previewImages.length > 0;
      const totalScanned = this.state.scannedImages.length;
      const previewExpanded = this.state.selectionMode
        || hasScope
        || totalScanned > 0
        || hasPreview
        || this.state.statusMessage !== "Run a page extract or select an area, then review the match count before opening the gallery.";

      this.elements.panel.hidden = this.state.minimized;
      this.elements.fab.hidden = !this.state.minimized || !this.state.showFab;
      this.elements.settingsModal.hidden = !this.state.settingsMode;
      this.elements.shell.dataset.theme = this.state.filters.theme || "system";
      this.elements.settingsButton.setAttribute("aria-pressed", this.state.settingsMode ? "true" : "false");
      this.elements.settingsButton.classList.toggle("iep-icon-active", this.state.settingsMode);
      this.elements.panelHeader.classList.toggle("is-dragging", this.dragState?.kind === "panel");
      this.elements.minWidthInput.value = String(this.state.filters.minWidth);
      this.elements.minHeightInput.value = String(this.state.filters.minHeight);
      this.elements.subfolderNameInput.value = this.state.filters.subfolderName;
      this.elements.imageOriginSelect.value = this.state.filters.imageOrigin;
      this.elements.themeSelect.value = this.state.filters.theme;
      this.elements.disablePageScrollingToggle.checked = Boolean(this.state.filters.disablePageScrolling);
      this.elements.disableSiteControlsToggle.checked = Boolean(this.state.filters.disableSiteControls);
      this.elements.hoverDownloadToggle.checked = Boolean(this.state.filters.hoverDownloadEnabled);
      this.elements.showFabToggle.checked = Boolean(this.state.showFab);
      this.elements.rateLimitInput.value = String(this.state.filters.rateLimitMs);
      this.elements.individualWarningThresholdInput.value = String(this.state.filters.individualDownloadWarningThreshold);
      this.elements.ignoredSelectorsInput.value = this.state.filters.ignoredSelectors || "";
      this.elements.preferLinkedOriginalsCheckbox.checked = Boolean(this.state.filters.preferLinkedOriginals);
      this.elements.statusBanner.dataset.tone = this.state.statusTone;
      this.elements.statusMessage.textContent = this.state.statusMessage;
      this.applyScanProgressUi();
      this.elements.selectionLabel.textContent = this.getScopeLabelText();
      this.elements.previewCount.textContent = this.getPreviewCountText();
      this.elements.previewMeta.textContent = hasScope
        ? `${totalScanned} candidate${totalScanned === 1 ? "" : "s"} detected before the current filters were applied.`
        : "Use one of the extract actions above to preview the result count first.";
      this.elements.previewContainer.classList.toggle("expanded", previewExpanded);

      for (const radio of this.elements.downloadModeRadios) {
        radio.checked = radio.value === this.state.filters.downloadMode;
        radio.disabled = this.state.busy;
      }

      this.elements.subfolderNameInput.disabled = this.state.busy;
      this.elements.imageOriginSelect.disabled = this.state.busy;
      this.elements.themeSelect.disabled = this.state.busy;
      this.elements.disablePageScrollingToggle.disabled = this.state.busy;
      this.elements.disableSiteControlsToggle.disabled = this.state.busy;
      this.elements.hoverDownloadToggle.disabled = this.state.busy;
      this.elements.showFabToggle.disabled = this.state.busy;
      this.elements.rateLimitInput.disabled = this.state.busy;
      this.elements.individualWarningThresholdInput.disabled = this.state.busy;
      this.elements.settingsDoneButton.disabled = this.state.busy;
      this.elements.extractAllButton.disabled = this.state.busy || this.state.selectionMode;
      this.elements.selectAreaButton.disabled = this.state.busy || this.state.selectionMode;
      this.elements.selectAreaButton.textContent = this.state.selectionMode ? "Selecting Area..." : "Select Area to Extract";
      this.elements.cancelButton.hidden = !(this.state.selectionMode || hasScope || totalScanned);
      this.elements.cancelButton.textContent = this.state.selectionMode ? "Cancel Selection" : "Clear Preview";
      this.elements.cancelButton.disabled = this.state.busy && !this.state.selectionMode;
      this.elements.reviewButton.hidden = !hasPreview;
      this.elements.reviewButton.disabled = this.state.busy || !hasPreview;
      this.elements.minWidthInput.disabled = this.state.busy;
      this.elements.minHeightInput.disabled = this.state.busy;
      this.elements.ignoredSelectorsInput.disabled = this.state.busy;
      this.elements.preferLinkedOriginalsCheckbox.disabled = this.state.busy;

      for (const container of [this.elements.formatOptions, this.elements.advancedFormatOptions]) {
        Array.from(container.querySelectorAll("input[type='checkbox']")).forEach((checkbox) => {
          checkbox.checked = Boolean(this.state.filters.formats[checkbox.value]);
          checkbox.disabled = this.state.busy;
        });
      }

      this.elements.panel.dataset.busy = this.state.busy ? "true" : "false";
      this.elements.panel.dataset.selection = this.state.selectionMode ? "true" : "false";
      this.syncFloatingPosition();
      this.updateSelectionOutline();
      if (!this.state.filters.hoverDownloadEnabled) {
        this.hideSurferHoverButton();
      }
    }
    getScopeLabelText() {
      if (this.state.selectionMode) {
        return "Selection mode is active. Hover the page and click a container to extract from it.";
      }

      if (this.state.selectedContainerLabel) {
        return `Scope: ${this.state.selectedContainerLabel}`;
      }

      return "No extraction scope selected yet.";
    }

    getPreviewCountText() {
      if (this.state.busy) {
        return "Scanning the current scope...";
      }

      return `Found ${this.state.previewImages.length} image${this.state.previewImages.length === 1 ? "" : "s"} matching your filters.`;
    }

    setStatus(message, tone = "default") {
      this.state.statusMessage = message;
      this.state.statusTone = tone;
      this.render();
    }

    showScanProgress(statusText = "Initializing scan...", percent = 0) {
      this.state.progressVisible = true;
      this.state.progressText = statusText;
      this.state.progressPercent = clamp(Math.round(Number(percent) || 0), 0, 100);
      this.applyScanProgressUi();
    }

    updateScanProgress(percent, statusText = this.state.progressText) {
      this.state.progressVisible = true;
      this.state.progressText = statusText;
      this.state.progressPercent = clamp(Math.round(Number(percent) || 0), 0, 100);
      this.applyScanProgressUi();
    }

    hideScanProgress() {
      this.state.progressVisible = false;
      this.state.progressPercent = 0;
      this.state.progressText = "Initializing scan...";
      this.applyScanProgressUi();
    }

    applyScanProgressUi() {
      if (!this.elements.scanProgressWrapper || !this.elements.scanProgressBar || !this.elements.scanStatusText || !this.elements.scanPercentText) {
        return;
      }

      this.elements.scanProgressWrapper.style.display = this.state.progressVisible ? "block" : "none";
      this.elements.scanProgressBar.style.width = `${this.state.progressPercent}%`;
      this.elements.scanStatusText.textContent = this.state.progressText || "Initializing scan...";
      this.elements.scanPercentText.textContent = `${this.state.progressPercent}%`;
    }

    updateFiltersFromInputs(options = {}) {
      this.state.filters.minWidth = Math.max(0, Number.parseInt(this.elements.minWidthInput.value || "0", 10) || 0);
      this.state.filters.minHeight = Math.max(0, Number.parseInt(this.elements.minHeightInput.value || "0", 10) || 0);
      this.state.filters.subfolderName = String(this.elements.subfolderNameInput.value || "").trim();
      this.state.filters.imageOrigin = this.elements.imageOriginSelect.value || "all";
      this.state.filters.theme = this.elements.themeSelect.value || "system";
      this.state.filters.downloadMode = this.elements.downloadModeRadios.find((radio) => radio.checked)?.value || "zip";
      this.state.filters.disablePageScrolling = Boolean(this.elements.disablePageScrollingToggle.checked);
      this.state.filters.disableSiteControls = Boolean(this.elements.disableSiteControlsToggle.checked);
      this.state.filters.hoverDownloadEnabled = Boolean(this.elements.hoverDownloadToggle.checked);
      this.state.showFab = Boolean(this.elements.showFabToggle.checked);
      this.state.filters.rateLimitMs = Math.max(0, Number.parseInt(this.elements.rateLimitInput.value || "0", 10) || 0);
      this.state.filters.individualDownloadWarningThreshold = Math.max(0, Number.parseInt(this.elements.individualWarningThresholdInput.value || "30", 10) || 0);
      this.state.filters.ignoredSelectors = String(this.elements.ignoredSelectorsInput.value || "").trim();
      this.state.filters.preferLinkedOriginals = Boolean(this.elements.preferLinkedOriginalsCheckbox.checked);
      this.state.filters.formats = readFormatStateFromUi(this.shadowRoot, this.createDefaultFormatState());
      this.persistFilters();

      if (options.rescan && this.state.selectedContainer && this.state.selectedContainer.isConnected) {
        void this.scanSelectedContainer();
        return;
      }

      if (this.state.scannedImages.length) {
        this.schedulePreviewRefresh();
      } else {
        this.render();
      }
    }
    schedulePreviewRefresh() {
      this.clearPreviewRefreshTimer();
      this.previewRefreshTimer = window.setTimeout(() => {
        this.refreshPreviewFromScannedImages();
      }, 120);
    }

    clearPreviewRefreshTimer() {
      if (this.previewRefreshTimer) {
        window.clearTimeout(this.previewRefreshTimer);
        this.previewRefreshTimer = 0;
      }
    }

    refreshPreviewFromScannedImages() {
      this.state.previewImages = applyExtractionFilters(this.state.scannedImages, this.state.filters)
        .map((image) => ({
          ...image,
          selected: false
        }));

      if (this.state.selectedContainerLabel) {
        this.setStatus(
          this.state.previewImages.length
            ? `Found ${this.state.previewImages.length} images matching your filters.`
            : "No images matched the current filters for this scope.",
          this.state.previewImages.length ? "success" : "default"
        );
      } else {
        this.render();
      }
    }

    clearSelectionPreview() {
      this.stopSelectionMode();
      this.state.selectedContainer = null;
      this.state.selectedContainerLabel = "";
      this.state.hoveredTarget = null;
      this.state.scannedImages = [];
      this.state.previewImages = [];
      this.setStatus("Preview cleared.", "default");
    }

    startSelectionMode() {
      this.mountUi();
      this.clearPreviewRefreshTimer();
      this.closeSettingsModal();
      this.state.selectionMode = true;
      this.state.hoveredTarget = null;
      this.cursorBeforeSelection = document.documentElement.style.cursor;
      document.documentElement.style.cursor = "crosshair";
      document.addEventListener("mousemove", this.boundPointerMove, true);
      document.addEventListener("click", this.boundSelectionClick, true);
      document.addEventListener("keydown", this.boundSelectionKeydown, true);
      window.addEventListener("scroll", this.boundSelectionScroll, true);
      this.setStatus("Selection mode is active. Hover the page and click a container to extract from it.", "info");
    }
    stopSelectionMode() {
      if (!this.state.selectionMode) {
        this.state.hoveredTarget = null;
        this.updateSelectionOutline();
        return;
      }

      this.state.selectionMode = false;
      this.state.hoveredTarget = null;
      document.documentElement.style.cursor = this.cursorBeforeSelection || "";
      document.removeEventListener("mousemove", this.boundPointerMove, true);
      document.removeEventListener("click", this.boundSelectionClick, true);
      document.removeEventListener("keydown", this.boundSelectionKeydown, true);
      window.removeEventListener("scroll", this.boundSelectionScroll, true);
      this.updateSelectionOutline();
      this.render();
    }

    handleSelectionPointerMove(event) {
      if (!this.state.selectionMode) {
        return;
      }

      if (this.isInsideExtensionUi(event.target)) {
        this.state.hoveredTarget = null;
        this.updateSelectionOutline();
        return;
      }

      this.state.hoveredTarget = this.resolveSelectableTarget(event.target);
      this.updateSelectionOutline();
    }

    handleSelectionScroll() {
      if (this.state.selectionMode) {
        this.updateSelectionOutline();
      }
    }

    handleSelectionKeydown(event) {
      if (this.state.selectionMode && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.stopSelectionMode();
        this.setStatus("Selection mode cancelled.", "default");
      }
    }

    async handleSelectionClick(event) {
      if (!this.state.selectionMode || this.isInsideExtensionUi(event.target)) {
        return;
      }

      const target = this.resolveSelectableTarget(event.target);
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }

      this.state.selectedContainer = target;
      this.state.selectedContainerLabel = describeSelectionTarget(target);
      this.stopSelectionMode();
      await this.scanSelectedContainer();
    }

    resolveSelectableTarget(rawTarget) {
      const target = rawTarget instanceof Element ? rawTarget : null;
      if (!target || this.isInsideExtensionUi(target)) {
        return null;
      }

      let candidate = target;
      if (candidate.tagName === "DIV") {
        const className = typeof candidate.className === "string" ? candidate.className : "";
        if (className.includes("photo-notes-scrappy-view") || className.includes("interaction-view")) {
          const hiddenImg = candidate.parentElement?.querySelector?.("img.main-photo, img");
          if (hiddenImg) {
            candidate = hiddenImg;
          }
        }
      }

      while (candidate && ["HTML", "BODY"].includes(candidate.tagName)) {
        candidate = candidate.firstElementChild;
      }

      while (candidate && candidate !== document.documentElement) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width >= 24 && rect.height >= 24) {
          return getSmartSelectionContainer(candidate);
        }
        candidate = candidate.parentElement;
      }

      return null;
    }

    isInsideExtensionUi(node) {
      if (!node || !this.host) {
        return false;
      }

      if (node === this.host) {
        return true;
      }

      if (node instanceof Node && this.host.contains(node)) {
        return true;
      }

      return node.getRootNode?.() === this.shadowRoot;
    }

    updateSelectionOutline() {
      if (!this.elements.outline) {
        return;
      }

      if (!this.state.selectionMode || !this.state.hoveredTarget || !this.state.hoveredTarget.isConnected) {
        this.elements.outline.hidden = true;
        return;
      }

      const rect = this.state.hoveredTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        this.elements.outline.hidden = true;
        return;
      }

      this.elements.outline.hidden = false;
      this.elements.outline.style.left = `${Math.max(rect.left, 0)}px`;
      this.elements.outline.style.top = `${Math.max(rect.top, 0)}px`;
      this.elements.outline.style.width = `${Math.max(rect.width, 0)}px`;
      this.elements.outline.style.height = `${Math.max(rect.height, 0)}px`;
    }

    async scanWholePage() {
      this.state.selectedContainer = document.body;
      this.state.selectedContainerLabel = "Entire page";
      await this.scanSelectedContainer();
    }

    async scanSelectedContainer() {
      if (!this.state.selectedContainer || !this.state.selectedContainer.isConnected) {
        this.setStatus("The selected scope is no longer available on the page.", "error");
        return;
      }

      this.clearPreviewRefreshTimer();
      this.state.busy = true;
      this.state.progressVisible = true;
      this.state.progressPercent = 0;
      this.state.progressText = "Parsing DOM...";
      this.state.scannedImages = [];
      this.state.previewImages = [];
      this.showScanProgress("Parsing DOM...", 0);
      this.setStatus(`Scanning ${this.state.selectedContainerLabel}...`, "default");
      this.render();

      try {
        const extractedImages = await extractImagesFromScope(
          this.state.selectedContainer,
          this.sourceProbeCache,
          this.state.filters,
          (message, tone = "info") => {
            this.setStatus(message, tone);
          },
          (percent, statusText) => {
            this.updateScanProgress(percent, statusText);
          }
        );
        this.state.scannedImages = extractedImages.map((image, index) => ({
          ...image,
          clientId: `${Date.now()}-${index}-${hashString(image.url || String(index))}`,
          selected: false
        }));
        this.refreshPreviewFromScannedImages();
      } catch (error) {
        this.state.scannedImages = [];
        this.state.previewImages = [];
        this.setStatus(error.message || "The selected scope could not be scanned.", "error");
      } finally {
        this.state.busy = false;
        this.state.progressVisible = false;
        this.hideScanProgress();
        this.render();
      }
    }

    getResolvedSubfolderName() {
      return sanitizeDownloadFolderName(this.state.filters.subfolderName, sanitizeDownloadFolderName(document.title, "Extracted Images"));
    }

    async openGallery() {
      if (!this.state.previewImages.length) {
        this.setStatus("No images match the current filters yet.", "error");
        return;
      }

      this.state.busy = true;
      this.setStatus(`Opening the gallery with ${this.state.previewImages.length} images...`, "default");
      this.render();

      try {
        const response = await api.runtime.sendMessage({
          type: "IEP_OPEN_GALLERY",
          pageTitle: document.title,
          pageUrl: location.href,
          selectionLabel: this.state.selectedContainerLabel,
          downloadMode: this.state.filters.downloadMode,
          subfolderName: this.getResolvedSubfolderName(),
          imageOrigin: this.state.filters.imageOrigin,
          theme: this.state.filters.theme,
          rateLimitMs: this.state.filters.rateLimitMs,
          individualDownloadWarningThreshold: this.state.filters.individualDownloadWarningThreshold,
          images: this.state.previewImages.map((image) => ({
            ...image,
            selected: false
          }))
        });

        if (!response?.ok) {
          throw new Error(response?.error || "The gallery could not be opened.");
        }

        this.setStatus(`Sent ${response.count} images to the review gallery.`, "success");
      } catch (error) {
        this.setStatus(error.message || "The gallery could not be opened.", "error");
      } finally {
        this.state.busy = false;
        this.render();
      }
    }
    startPanelDrag(event) {
      if (event.button !== 0 || this.state.minimized) {
        return;
      }

      const interactiveTarget = event.target instanceof Element
        ? event.target.closest("button, input, select, textarea, a, label")
        : null;
      if (interactiveTarget) {
        return;
      }

      event.preventDefault();
      const currentLeft = Number.parseFloat(this.elements.panel.style.left || "0") || 0;
      const currentTop = Number.parseFloat(this.elements.panel.style.top || "0") || 0;
      this.dragState = {
        kind: "panel",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: currentLeft,
        originY: currentTop
      };

      this.elements.panelHeader.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", this.boundPanelPointerMove, true);
      window.addEventListener("pointerup", this.boundPanelPointerUp, true);
      this.render();
    }

    handlePanelPointerMove(event) {
      if (!this.dragState || this.dragState.kind !== "panel" || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.dragState.startX;
      const deltaY = event.clientY - this.dragState.startY;
      this.state.panelPosition = {
        x: this.dragState.originX + deltaX,
        y: this.dragState.originY + deltaY
      };
      this.syncFloatingPosition();
    }

    handlePanelPointerUp(event) {
      if (!this.dragState || this.dragState.kind !== "panel" || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      this.elements.panelHeader.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", this.boundPanelPointerMove, true);
      window.removeEventListener("pointerup", this.boundPanelPointerUp, true);
      this.dragState = null;
      this.syncFloatingPosition();
      this.render();
    }

    handleSurferMouseMove(event) {
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      this.queueSurferHoverRefresh({
        x: lastMouseX,
        y: lastMouseY
      });
    }

    handleSurferScroll() {
      if (!this.state.filters.hoverDownloadEnabled) {
        this.hideSurferHoverButton();
        return;
      }

      this.pendingSurferPoint = {
        x: lastMouseX,
        y: lastMouseY
      };

      if (this.surferScrollFrame) {
        return;
      }

      this.surferScrollFrame = window.requestAnimationFrame(() => {
        this.surferScrollFrame = 0;
        this.queueSurferHoverRefresh(this.pendingSurferPoint);
      });
    }

    queueSurferHoverRefresh(point) {
      this.pendingSurferPoint = point;
      if (this.surferHoverFrame) {
        return;
      }

      this.surferHoverFrame = window.requestAnimationFrame(() => {
        this.surferHoverFrame = 0;
        const nextPoint = this.pendingSurferPoint;
        this.pendingSurferPoint = null;
        void this.updateSurferHoverButton(nextPoint);
      });
    }

    async updateSurferHoverButton(point) {
      if (!this.elements.surferHoverButton) {
        return;
      }

      if (!this.state.filters.hoverDownloadEnabled || this.state.selectionMode || !point) {
        this.hideSurferHoverButton();
        return;
      }

      const hitElements = document.elementsFromPoint(point.x, point.y);
      if (hitElements.some((element) => element instanceof Element && (
        element.id === UI_HOST_ID
          || element.id === "iepShell"
          || element.closest?.(".iep-shell")
          || element.closest?.("#iepSettingsModal")
          || element.closest?.(".iep-panel")
      ))) {
        this.hideSurferHoverButton();
        return;
      }

      const target = getImageFromPoint(point.x, point.y);
      const requestId = ++this.surferHoverRequestId;
      if (!target) {
        this.hideSurferHoverButton();
        return;
      }

      const url = await getBestImageUrl(target);
      if (requestId !== this.surferHoverRequestId) {
        return;
      }

      if (!this.state.filters.hoverDownloadEnabled || !url) {
        this.hideSurferHoverButton();
        return;
      }

      const rectTarget = target instanceof HTMLPictureElement
        ? target.querySelector("img") || target
        : target;
      const rect = rectTarget.getBoundingClientRect?.();

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        this.hideSurferHoverButton();
        return;
      }

      if (rect.width < 150 || rect.height < 150) {
        this.hideSurferHoverButton();
        return;
      }

      const buttonSize = 32;
      this.elements.surferHoverButton.hidden = false;
      this.elements.surferHoverButton.dataset.url = url;
      this.elements.surferHoverButton.style.left = `${clamp(rect.right - buttonSize - 10, 8, window.innerWidth - buttonSize - 8)}px`;
      this.elements.surferHoverButton.style.top = `${clamp(rect.top + 10, 8, window.innerHeight - buttonSize - 8)}px`;
    }

    hideSurferHoverButton() {
      if (!this.elements.surferHoverButton) {
        return;
      }

      this.elements.surferHoverButton.hidden = true;
      this.elements.surferHoverButton.dataset.url = "";
      this.elements.surferHoverButton.classList.remove("is-success");
    }

    flashSurferHoverButton() {
      if (!this.elements.surferHoverButton) {
        return;
      }

      this.elements.surferHoverButton.classList.add("is-success");
      if (this.hoverFlashTimer) {
        window.clearTimeout(this.hoverFlashTimer);
      }

      this.hoverFlashTimer = window.setTimeout(() => {
        this.elements.surferHoverButton?.classList.remove("is-success");
        this.hoverFlashTimer = 0;
      }, 700);
    }

    startFabDrag(event) {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      this.dragState = {
        kind: "fab",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: this.state.fabPosition.x,
        originY: this.state.fabPosition.y,
        moved: false
      };

      this.elements.fabGrip.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", this.boundFabPointerMove, true);
      window.addEventListener("pointerup", this.boundFabPointerUp, true);
    }

    handleFabPointerMove(event) {
      if (!this.dragState || this.dragState.kind !== "fab" || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.dragState.startX;
      const deltaY = event.clientY - this.dragState.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        this.dragState.moved = true;
      }

      this.state.fabPosition.x = this.dragState.originX + deltaX;
      this.state.fabPosition.y = this.dragState.originY + deltaY;
      this.syncFloatingPosition();
    }

    handleFabPointerUp(event) {
      if (!this.dragState || this.dragState.kind !== "fab" || event.pointerId !== this.dragState.pointerId) {
        return;
      }

      this.elements.fabGrip.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", this.boundFabPointerMove, true);
      window.removeEventListener("pointerup", this.boundFabPointerUp, true);
      this.ignoreFabClick = this.dragState.moved;
      this.dragState = null;
      this.syncFloatingPosition();
    }

    handleResize() {
      this.syncFloatingPosition();
      this.updateSelectionOutline();
    }

    syncFloatingPosition() {
      if (!this.elements.fab || !this.elements.panel) {
        return;
      }

      const fabWidth = 56;
      const fabHeight = 56;
      const panelWidth = 392;
      const panelHeight = Math.max(this.elements.panel.offsetHeight || 620, 420);
      const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

      const clampedFabX = clamp(this.state.fabPosition.x, 12, Math.max(12, viewportWidth - fabWidth - 12));
      const clampedFabY = clamp(this.state.fabPosition.y, 12, Math.max(12, viewportHeight - fabHeight - 12));
      this.state.fabPosition.x = clampedFabX;
      this.state.fabPosition.y = clampedFabY;

      this.elements.fab.style.left = `${clampedFabX}px`;
      this.elements.fab.style.top = `${clampedFabY}px`;

      const fallbackPanelLeft = clamp(clampedFabX - (panelWidth - fabWidth), 12, Math.max(12, viewportWidth - panelWidth - 12));
      const fallbackPanelTop = clamp(clampedFabY - 16, 12, Math.max(12, viewportHeight - panelHeight - 12));
      const nextPanelX = clamp(this.state.panelPosition?.x ?? fallbackPanelLeft, 12, Math.max(12, viewportWidth - panelWidth - 12));
      const nextPanelY = clamp(this.state.panelPosition?.y ?? fallbackPanelTop, 12, Math.max(12, viewportHeight - panelHeight - 12));
      this.state.panelPosition = {
        x: nextPanelX,
        y: nextPanelY
      };

      this.elements.panel.style.left = `${nextPanelX}px`;
      this.elements.panel.style.top = `${nextPanelY}px`;
    }

    getTemplate() {
      return `
        <style>
          :host {
            color-scheme: light;
            --iep-bg-primary: #f5f9ff;
            --iep-bg-secondary: #edf4ff;
            --iep-surface: rgba(255, 255, 255, 0.96);
            --iep-surface-soft: #f8fafc;
            --iep-surface-strong: #ffffff;
            --iep-text-main: #0f172a;
            --iep-text-muted: #475569;
            --iep-text-soft: #64748b;
            --iep-border: rgba(148, 163, 184, 0.18);
            --iep-border-strong: rgba(148, 163, 184, 0.3);
            --iep-accent: #2563eb;
            --iep-accent-strong: #1d4ed8;
            --iep-accent-soft: rgba(37, 99, 235, 0.12);
            --iep-header-bg: linear-gradient(180deg, #eef4ff, #ffffff);
            --iep-icon-bg: rgba(255, 255, 255, 0.88);
            --iep-icon-active-bg: #eff6ff;
            --iep-button-secondary: #e2e8f0;
            --iep-success-bg: #ecfdf5;
            --iep-success-border: rgba(16, 185, 129, 0.24);
            --iep-success-text: #065f46;
            --iep-error-bg: #fef2f2;
            --iep-error-border: rgba(239, 68, 68, 0.22);
            --iep-error-text: #991b1b;
            --iep-info-bg: #eff6ff;
            --iep-info-border: rgba(37, 99, 235, 0.22);
            --iep-info-text: #1d4ed8;
            --iep-shadow: 0 28px 60px rgba(15, 23, 42, 0.22);
            --iep-shadow-soft: 0 10px 24px rgba(15, 23, 42, 0.08);
            --iep-backdrop: rgba(15, 23, 42, 0.58);
            --iep-fab-gradient: linear-gradient(135deg, #0f172a, #1d4ed8);
            --iep-selection-overlay: rgba(37, 99, 235, 0.05);
          }

          @media (prefers-color-scheme: dark) {
            :host {
              color-scheme: dark;
              --iep-bg-primary: #0f172a;
              --iep-bg-secondary: #15233a;
              --iep-surface: rgba(15, 23, 42, 0.96);
              --iep-surface-soft: #172235;
              --iep-surface-strong: #111b2d;
              --iep-text-main: #e2e8f0;
              --iep-text-muted: #cbd5e1;
              --iep-text-soft: #94a3b8;
              --iep-border: rgba(148, 163, 184, 0.16);
              --iep-border-strong: rgba(148, 163, 184, 0.26);
              --iep-accent: #60a5fa;
              --iep-accent-strong: #3b82f6;
              --iep-accent-soft: rgba(96, 165, 250, 0.18);
              --iep-header-bg: linear-gradient(180deg, #172554, #111b2d);
              --iep-icon-bg: rgba(15, 23, 42, 0.88);
              --iep-icon-active-bg: rgba(37, 99, 235, 0.2);
              --iep-button-secondary: #1e293b;
              --iep-success-bg: rgba(6, 95, 70, 0.34);
              --iep-success-border: rgba(16, 185, 129, 0.26);
              --iep-success-text: #bbf7d0;
              --iep-error-bg: rgba(127, 29, 29, 0.36);
              --iep-error-border: rgba(248, 113, 113, 0.24);
              --iep-error-text: #fecaca;
              --iep-info-bg: rgba(30, 64, 175, 0.34);
              --iep-info-border: rgba(96, 165, 250, 0.24);
              --iep-info-text: #bfdbfe;
              --iep-shadow: 0 28px 60px rgba(2, 6, 23, 0.55);
              --iep-shadow-soft: 0 10px 24px rgba(2, 6, 23, 0.3);
              --iep-backdrop: rgba(2, 6, 23, 0.72);
              --iep-fab-gradient: linear-gradient(135deg, #1e293b, #2563eb);
              --iep-selection-overlay: rgba(96, 165, 250, 0.08);
            }
          }

          .iep-shell[data-theme="light"] { color-scheme: light; --iep-bg-primary: #f5f9ff; --iep-bg-secondary: #edf4ff; --iep-surface: rgba(255, 255, 255, 0.96); --iep-surface-soft: #f8fafc; --iep-surface-strong: #ffffff; --iep-text-main: #0f172a; --iep-text-muted: #475569; --iep-text-soft: #64748b; --iep-border: rgba(148, 163, 184, 0.18); --iep-border-strong: rgba(148, 163, 184, 0.3); --iep-accent: #2563eb; --iep-accent-strong: #1d4ed8; --iep-accent-soft: rgba(37, 99, 235, 0.12); --iep-header-bg: linear-gradient(180deg, #eef4ff, #ffffff); --iep-icon-bg: rgba(255, 255, 255, 0.88); --iep-icon-active-bg: #eff6ff; --iep-button-secondary: #e2e8f0; --iep-success-bg: #ecfdf5; --iep-success-border: rgba(16, 185, 129, 0.24); --iep-success-text: #065f46; --iep-error-bg: #fef2f2; --iep-error-border: rgba(239, 68, 68, 0.22); --iep-error-text: #991b1b; --iep-info-bg: #eff6ff; --iep-info-border: rgba(37, 99, 235, 0.22); --iep-info-text: #1d4ed8; --iep-shadow: 0 28px 60px rgba(15, 23, 42, 0.22); --iep-shadow-soft: 0 10px 24px rgba(15, 23, 42, 0.08); --iep-backdrop: rgba(15, 23, 42, 0.58); --iep-fab-gradient: linear-gradient(135deg, #0f172a, #1d4ed8); --iep-selection-overlay: rgba(37, 99, 235, 0.05); }
          .iep-shell[data-theme="dark"] { color-scheme: dark; --iep-bg-primary: #0f172a; --iep-bg-secondary: #15233a; --iep-surface: rgba(15, 23, 42, 0.96); --iep-surface-soft: #172235; --iep-surface-strong: #111b2d; --iep-text-main: #e2e8f0; --iep-text-muted: #cbd5e1; --iep-text-soft: #94a3b8; --iep-border: rgba(148, 163, 184, 0.16); --iep-border-strong: rgba(148, 163, 184, 0.26); --iep-accent: #60a5fa; --iep-accent-strong: #3b82f6; --iep-accent-soft: rgba(96, 165, 250, 0.18); --iep-header-bg: linear-gradient(180deg, #172554, #111b2d); --iep-icon-bg: rgba(15, 23, 42, 0.88); --iep-icon-active-bg: rgba(37, 99, 235, 0.2); --iep-button-secondary: #1e293b; --iep-success-bg: rgba(6, 95, 70, 0.34); --iep-success-border: rgba(16, 185, 129, 0.26); --iep-success-text: #bbf7d0; --iep-error-bg: rgba(127, 29, 29, 0.36); --iep-error-border: rgba(248, 113, 113, 0.24); --iep-error-text: #fecaca; --iep-info-bg: rgba(30, 64, 175, 0.34); --iep-info-border: rgba(96, 165, 250, 0.24); --iep-info-text: #bfdbfe; --iep-shadow: 0 28px 60px rgba(2, 6, 23, 0.55); --iep-shadow-soft: 0 10px 24px rgba(2, 6, 23, 0.3); --iep-backdrop: rgba(2, 6, 23, 0.72); --iep-fab-gradient: linear-gradient(135deg, #1e293b, #2563eb); --iep-selection-overlay: rgba(96, 165, 250, 0.08); }
          .iep-shell { position: fixed; inset: 0; pointer-events: none; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
          .iep-fab, .iep-panel, .iep-settings-modal { box-sizing: border-box; pointer-events: auto; }
          .iep-fab { position: fixed; width: 56px; height: 56px; border: none; border-radius: 18px; background: var(--iep-fab-gradient); color: #f8fafc; box-shadow: 0 20px 42px rgba(15, 23, 42, 0.28); display: grid; place-items: center; cursor: pointer; padding: 0; overflow: hidden; }
          .iep-fab::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at top left, rgba(255, 255, 255, 0.28), transparent 48%); pointer-events: none; }
          .iep-fab-grip { position: absolute; inset: 0; cursor: grab; }
          .iep-fab-icon, .iep-fab-icon::before, .iep-fab-icon::after { pointer-events: none; }
          .iep-fab-icon { position: relative; width: 22px; height: 22px; border: 2px solid rgba(248, 250, 252, 0.94); border-radius: 7px; }
          .iep-fab-icon::before, .iep-fab-icon::after { content: ""; position: absolute; background: rgba(248, 250, 252, 0.94); }
          .iep-fab-icon::before { width: 8px; height: 8px; border-radius: 999px; top: 4px; right: 4px; }
          .iep-fab-icon::after { left: 3px; right: 3px; bottom: 4px; height: 7px; clip-path: polygon(0 100%, 28% 35%, 48% 68%, 68% 18%, 100% 100%); }
          .iep-panel { position: fixed; width: 392px; max-height: min(620px, calc(100vh - 24px)); display: flex; flex-direction: column; border-radius: 24px; background: linear-gradient(180deg, var(--iep-surface-strong), var(--iep-bg-primary)); color: var(--iep-text-main); border: 1px solid var(--iep-border-strong); box-shadow: var(--iep-shadow); overflow: hidden; }
          .iep-panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 18px 18px 14px; background: var(--iep-header-bg); border-bottom: 1px solid var(--iep-border); cursor: grab; user-select: none; }
          .iep-panel-header.is-dragging { cursor: grabbing; }
          .iep-header-controls { display: grid; justify-items: end; gap: 8px; flex-shrink: 0; }
          .iep-kicker { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--iep-accent); font-weight: 700; }
          .iep-title { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 700; }
          .iep-subtitle { margin: 6px 0 0; color: var(--iep-text-muted); font-size: 13px; line-height: 1.5; }
          .iep-window-actions { display: flex; gap: 8px; }
          .iep-icon-button { width: 32px; height: 32px; border-radius: 10px; border: 1px solid var(--iep-border); background: var(--iep-icon-bg); color: var(--iep-text-soft); cursor: pointer; font-size: 15px; line-height: 1; }
          .iep-icon-active { color: var(--iep-accent); border-color: var(--iep-accent); background: var(--iep-icon-active-bg); }
          .iep-body { display: grid; gap: 14px; padding: 18px; overflow: auto; }
          .iep-card, .iep-details { background: var(--iep-surface); border: 1px solid var(--iep-border); border-radius: 18px; box-shadow: var(--iep-shadow-soft); }
          .iep-card { padding: 14px; display: grid; gap: 14px; }
          .iep-card h2, .iep-details summary { margin: 0; font-size: 14px; font-weight: 700; }
          .iep-card p { margin: 0; color: var(--iep-text-muted); font-size: 13px; line-height: 1.5; }
          .iep-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
          .iep-preview-container { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.3s ease; }
          .iep-preview-container.expanded { grid-template-rows: 1fr; }
          .iep-preview-inner { overflow: hidden; }
          .iep-preview-stack { display: grid; gap: 12px; padding-top: 14px; }
          .iep-button { border: none; border-radius: 14px; padding: 12px 14px; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease; }
          .iep-button:not(:disabled):hover { transform: translateY(-1px); }
          .iep-button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
          .iep-button-primary { background: linear-gradient(135deg, var(--iep-accent), var(--iep-accent-strong)); color: #eff6ff; box-shadow: 0 14px 28px rgba(37, 99, 235, 0.24); }
          .iep-button-secondary { background: var(--iep-button-secondary); color: var(--iep-text-main); }
          .iep-filter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
          .iep-field, .iep-inline-group, .iep-settings-panel, .iep-settings-stack { display: grid; gap: 8px; }
          .iep-field-full { grid-column: 1 / -1; }
          .iep-field span, .iep-field-label { font-size: 12px; font-weight: 600; color: var(--iep-text-muted); }
          .iep-field input, .iep-select { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid var(--iep-border-strong); background: var(--iep-surface-strong); color: var(--iep-text-main); padding: 10px 12px; font-size: 13px; outline: none; }
          .iep-field input:focus, .iep-select:focus { border-color: var(--iep-accent); box-shadow: 0 0 0 4px var(--iep-accent-soft); }
          .iep-format-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
          .iep-format-grid-compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .iep-format-option, .iep-radio-option { display: flex; align-items: center; gap: 10px; border-radius: 14px; border: 1px solid var(--iep-border); background: var(--iep-surface-soft); padding: 10px 12px; cursor: pointer; color: var(--iep-text-main); font-size: 13px; font-weight: 600; }
          .iep-format-option input, .iep-radio-option input, .iep-toggle-row input { width: 16px; height: 16px; margin: 0; accent-color: var(--iep-accent); }
          .iep-details { overflow: hidden; }
          .iep-details summary { list-style: none; cursor: pointer; padding: 14px; }
          .iep-details summary::-webkit-details-marker { display: none; }
          .iep-details summary::after { content: "+"; float: right; color: var(--iep-accent); font-size: 16px; }
          .iep-details[open] summary::after { content: "-"; }
          .iep-details-body { display: grid; gap: 12px; padding: 0 14px 14px; border-top: 1px solid var(--iep-border); }
          .iep-toggle-row { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: var(--iep-text-muted); }
          .iep-selection-label { font-weight: 600; color: var(--iep-text-main); word-break: break-word; }
          .iep-preview-count { font-size: 15px; font-weight: 700; color: var(--iep-text-main); }
          .iep-preview-meta { color: var(--iep-text-soft); font-size: 12px; }
          .iep-actions { display: flex; flex-wrap: wrap; gap: 10px; }
          .iep-status { border-radius: 16px; border: 1px solid var(--iep-border); background: var(--iep-surface-soft); padding: 12px 14px; }
          .iep-status[data-tone="success"] { background: var(--iep-success-bg); border-color: var(--iep-success-border); color: var(--iep-success-text); }
          .iep-status[data-tone="error"] { background: var(--iep-error-bg); border-color: var(--iep-error-border); color: var(--iep-error-text); }
          .iep-status[data-tone="info"] { background: var(--iep-info-bg); border-color: var(--iep-info-border); color: var(--iep-info-text); }
          .iep-status p { margin: 0; font-size: 13px; line-height: 1.5; }
          .iep-settings-modal { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; }
          .iep-settings-backdrop { position: absolute; inset: 0; background: var(--iep-backdrop); }
          .iep-settings-dialog { position: relative; width: min(1000px, calc(100vw - 48px)); max-height: min(600px, calc(100vh - 48px)); display: grid; gap: 16px; padding: 20px; border-radius: 22px; background: var(--iep-surface-strong); border: 1px solid var(--iep-border); box-shadow: 0 32px 80px rgba(15, 23, 42, 0.32); overflow: auto; }
          .iep-modal-header { display: grid; gap: 4px; }
          .iep-modal-header h2 { margin: 0; font-size: 18px; }
          .iep-modal-header p { margin: 0; color: var(--iep-text-soft); font-size: 13px; }
          .iep-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
          .iep-settings-panel { background: var(--iep-surface); border: 1px solid var(--iep-border); border-radius: 18px; padding: 14px; box-shadow: var(--iep-shadow-soft); }
          .iep-settings-panel h3 { margin: 0; font-size: 14px; }
          .iep-settings-panel p { margin: 0; color: var(--iep-text-soft); font-size: 11px; line-height: 1.4; }
          .iep-settings-dialog .iep-field span, .iep-settings-dialog .iep-field-label, .iep-settings-dialog .iep-toggle-row, .iep-settings-dialog .iep-radio-option, .iep-settings-dialog .iep-button { font-size: 11px; }
          .iep-settings-dialog .iep-field input, .iep-settings-dialog .iep-select { min-height: 38px; padding: 8px 10px; font-size: 12px; border-radius: 10px; }
          .iep-settings-dialog .iep-button { padding: 10px 12px; border-radius: 12px; }
          .iep-radio-group { display: grid; gap: 8px; }
          .iep-surfer-hover-btn { position: fixed; z-index: 2147483647; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: #2563eb; color: #ffffff; border: none; border-radius: 50%; cursor: pointer; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); pointer-events: auto; }
          .iep-surfer-hover-btn svg { pointer-events: none; }
          .iep-surfer-hover-btn.is-success { background: #16a34a; }
          .iep-selection-outline { position: fixed; border: 2px solid var(--iep-accent); background: var(--iep-accent-soft); box-shadow: 0 0 0 9999px var(--iep-selection-overlay); border-radius: 8px; pointer-events: none; }
          @media (max-width: 860px) { .iep-settings-grid { grid-template-columns: minmax(0, 1fr); } }
          [hidden] { display: none !important; }
        </style>
        <div id="iepShell" class="iep-shell" data-theme="system">
          <button id="iepFab" class="iep-fab" type="button" aria-label="Open Image Extractor Pro" hidden><span id="iepFabGrip" class="iep-fab-grip" aria-hidden="true"></span><span class="iep-fab-icon" aria-hidden="true"></span></button>
          <section id="iepPanel" class="iep-panel" role="dialog" aria-modal="false" aria-label="Image Extractor Pro panel">
            <header class="iep-panel-header"><div><p class="iep-kicker">Image Extractor Pro</p><h1 class="iep-title">Scoped Image Extraction</h1><p class="iep-subtitle">Review images before opening the full gallery.</p></div><div class="iep-header-controls"><div class="iep-window-actions"><button id="iepSettingsButton" class="iep-icon-button" type="button" aria-label="Open settings" aria-pressed="false">&#9881;</button><button id="iepMinimizeButton" class="iep-icon-button" type="button" aria-label="Minimize panel">_</button><button id="iepCloseButton" class="iep-icon-button" type="button" aria-label="Close panel">x</button></div></div></header>
            <div class="iep-body">
              <section class="iep-card"><div class="iep-action-grid"><button id="iepExtractAllButton" class="iep-button iep-button-primary" type="button">Extract All from Page</button><button id="iepSelectAreaButton" class="iep-button iep-button-secondary" type="button">Select Area to Extract</button></div><div id="iepPreviewContainer" class="iep-preview-container"><div class="iep-preview-inner"><div class="iep-preview-stack"><div id="iepScanProgressWrapper" style="display: none; padding: 12px; background: var(--iep-bg-secondary, #1e293b); border-radius: 6px; margin-bottom: 10px;"><div style="width: 100%; height: 8px; background: #334155; border-radius: 4px; overflow: hidden;"><div id="iepScanProgressBar" style="width: 0%; height: 100%; background: #3b82f6; transition: width 0.1s ease-out;"></div></div><div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: #94a3b8;"><span id="iepScanStatusText">Initializing scan...</span><span id="iepScanPercentText">0%</span></div></div><p id="iepSelectionLabel" class="iep-selection-label">No extraction scope selected yet.</p><p id="iepPreviewCount" class="iep-preview-count">Found 0 images matching your filters.</p><p id="iepPreviewMeta" class="iep-preview-meta">Use one of the extract actions above to preview the result count first.</p><section id="iepStatus" class="iep-status" data-tone="default" aria-live="polite"><p id="iepStatusMessage">Run a page extract or select an area, then review the match count before opening the gallery.</p></section><div class="iep-actions"><button id="iepCancelButton" class="iep-button iep-button-secondary" type="button" hidden>Clear Preview</button><button id="iepReviewButton" class="iep-button iep-button-primary" type="button" hidden>Review &amp; Download</button></div></div></div></div></section>
              <section class="iep-card"><h2>Filters</h2><p>Image search filters for size &amp; formats</p><div class="iep-filter-grid"><label class="iep-field"><span>Minimum Width (px)</span><input id="iepMinWidth" type="number" min="0" step="10" value="150"></label><label class="iep-field"><span>Minimum Height (px)</span><input id="iepMinHeight" type="number" min="0" step="10" value="150"></label></div><div id="iepFormatOptions" class="iep-format-grid" aria-label="Format filters"></div><div class="iep-inline-group"><span class="iep-field-label">Extra supported formats</span><div id="iepAdvancedFormatOptions" class="iep-format-grid iep-format-grid-compact" aria-label="Advanced format filters"></div></div></section>
              <details class="iep-details"><summary>Advanced Settings</summary><div class="iep-details-body"><label class="iep-field iep-field-full"><span>Ignore selectors or class fragments</span><input id="iepIgnoredSelectors" type="text" placeholder=".avatar, .logo, sponsor-card"></label><label class="iep-toggle-row"><input id="iepPreferLinkedOriginals" type="checkbox" checked><span>Prefer linked original image URLs when available</span></label></div></details>
            </div>
          </section>
          <button id="iepSurferHoverBtn" class="iep-surfer-hover-btn" type="button" aria-label="Download hovered image" hidden><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"></path><path d="M8 10l4 4 4-4"></path><path d="M5 20h14"></path></svg></button>
          <div id="iepSelectionOutline" class="iep-selection-outline" hidden></div>
          <div id="iepSettingsModal" class="iep-settings-modal" hidden><div id="iepSettingsBackdrop" class="iep-settings-backdrop"></div><section class="iep-settings-dialog" role="dialog" aria-modal="true" aria-label="Image Extractor Pro settings"><div class="iep-modal-header"><h2>Settings</h2><p>Configure download behavior and limits</p></div><div class="iep-settings-grid"><section class="iep-settings-panel"><h3>Download Preferences</h3><p>Choose how the gallery should package and label the selected images.</p><div class="iep-settings-stack"><div class="iep-inline-group"><span class="iep-field-label">Download Mode</span><div class="iep-radio-group"><label class="iep-radio-option"><input type="radio" name="iepDownloadMode" value="individual"><span>Individual Files</span></label><label class="iep-radio-option"><input type="radio" name="iepDownloadMode" value="zip" checked><span>ZIP Archive</span></label></div></div><label class="iep-field"><span>Subfolder Name</span><input id="iepSubfolderName" type="text" placeholder="enter folder name (optional)"></label><label class="iep-field"><span>Theme</span><select id="iepTheme" class="iep-select"><option value="system">System (Default)</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label class="iep-field"><span>Image Origin</span><select id="iepImageOrigin" class="iep-select"><option value="all">All</option><option value="rendered">Rendered</option><option value="source">Source</option></select></label></div></section><section class="iep-settings-panel"><h3>Safety &amp; Behavior</h3><p>Controls for UI visibility and guarded download behavior in the gallery.</p><div class="iep-settings-stack"><label class="iep-toggle-row"><input id="iepDisablePageScrolling" type="checkbox"><span>Disable Page Scrolling (Lazy Load Bypass)</span></label><label class="iep-toggle-row"><input id="iepDisableSiteControls" type="checkbox" checked><span>Disable website-specific image controls</span></label><label class="iep-toggle-row"><input id="iepHoverDownloadEnabled" type="checkbox" checked><span>Enable Quick Hover Download</span></label><label class="iep-toggle-row"><input id="iepShowFab" type="checkbox" checked><span>Show Floating Icon on Pages</span></label><label class="iep-field"><span>Rate Limit / Delay per image (ms)</span><input id="iepRateLimitMs" type="number" min="0" step="50" value="0"></label><label class="iep-field"><span>Individual Download Warning Threshold</span><input id="iepIndividualWarningThreshold" type="number" min="0" step="1" value="30"></label></div></section></div><div class="iep-actions"><button id="iepSettingsDoneButton" class="iep-button iep-button-primary" type="button">Done</button></div></section></div>
        </div>
      `;
    }
  }

  async function extractImagesFromScope(root, sourceProbeCache, filters, onProgress, onScanProgress) {
    const snapshot = captureScrollSnapshot(root);

    try {
      onProgress?.("Scrolling and waking up lazy-loaded images...", "info");
      if (filters?.disablePageScrolling) {
        hydrateLazyMedia(root);
        await waitForScopedImages(root, 650);
      } else {
        await warmUpLazyContent(root);
      }
      onProgress?.("Parsing DOM for image sources...", "info");
      onScanProgress?.(0, "Parsing DOM...");
      const images = await collectScopeImages(root, filters);
      onProgress?.("Fetching metadata and filtering...", "info");
      onScanProgress?.(0, "Filtering and enriching images...");
      await enrichImagesWithSourceMetadata(images, sourceProbeCache, onScanProgress);
      return dedupeImages(images).sort((left, right) => getImageArea(right) - getImageArea(left));
    } finally {
      restoreScrollSnapshot(snapshot);
    }
  }

  function captureScrollSnapshot(root) {
    return {
      pageX: window.scrollX,
      pageY: window.scrollY,
      root: root instanceof HTMLElement ? root : null,
      rootScrollTop: root instanceof HTMLElement ? root.scrollTop : 0,
      rootScrollLeft: root instanceof HTMLElement ? root.scrollLeft : 0
    };
  }

  function restoreScrollSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    window.scrollTo(snapshot.pageX, snapshot.pageY);
    if (snapshot.root && snapshot.root.isConnected) {
      snapshot.root.scrollTop = snapshot.rootScrollTop;
      snapshot.root.scrollLeft = snapshot.rootScrollLeft;
    }
  }

  async function warmUpLazyContent(root) {
    hydrateLazyMedia(root);
    await waitForScopedImages(root, 650);

    const rect = root.getBoundingClientRect();
    const startY = Math.max(window.scrollY + rect.top - 80, 0);
    const endY = Math.max(window.scrollY + rect.bottom - window.innerHeight + 80, startY);
    const stepSize = Math.max(Math.round(window.innerHeight * 0.82), 320);

    for (const point of buildScrollStops(startY, endY, stepSize)) {
      window.scrollTo(0, point);
      hydrateLazyMedia(root);
      await sleep(180);
      await waitForScopedImages(root, 500);
    }

    if (root instanceof HTMLElement && isScrollable(root)) {
      const originalScrollTop = root.scrollTop;
      for (const point of buildScrollStops(0, Math.max(root.scrollHeight - root.clientHeight, 0), Math.max(Math.round(root.clientHeight * 0.9), 240))) {
        root.scrollTop = point;
        hydrateLazyMedia(root);
        await sleep(160);
        await waitForScopedImages(root, 420);
      }
      root.scrollTop = originalScrollTop;
    }

    await waitForScopedImages(root, 900);
  }

  function hydrateLazyMedia(root) {
    const mediaNodes = getDeepScanNodes(root, "");
    for (const node of mediaNodes) {
      if (node instanceof HTMLImageElement) {
        for (const attribute of URL_ATTRIBUTES) {
          const value = node.getAttribute(attribute);
          if (!value) {
            continue;
          }
          const currentSrc = node.currentSrc || (node.hasAttribute("src") ? node.src : "");
          if (!currentSrc || looksLikePlaceholder(currentSrc)) {
            node.src = resolveAbsoluteUrl(value) || value;
          }
        }

        for (const attribute of SRCSET_ATTRIBUTES) {
          const value = node.getAttribute(attribute);
          if (value && !node.srcset) {
            node.srcset = value;
          }
        }

        node.loading = "eager";
        node.decoding = "async";
      }

      if (node.tagName === "SOURCE") {
        for (const attribute of SRCSET_ATTRIBUTES) {
          const value = node.getAttribute(attribute);
          if (value && !node.getAttribute("srcset")) {
            node.setAttribute("srcset", value);
          }
        }
      }
    }
  }

  async function waitForScopedImages(root, timeoutMs) {
    const pendingImages = getScopedElements(root, "img").filter((image) => !image.complete);
    if (!pendingImages.length) {
      return;
    }

    await Promise.race([
      Promise.all(
        pendingImages.map(
          (image) =>
            new Promise((resolve) => {
              const finish = () => {
                image.removeEventListener("load", finish);
                image.removeEventListener("error", finish);
                resolve();
              };
              image.addEventListener("load", finish, { once: true });
              image.addEventListener("error", finish, { once: true });
            })
        )
      ),
      sleep(timeoutMs)
    ]);
  }

  async function collectScopeImages(root, filters) {
    const imageMap = new Map();
    const ignoredRules = parseIgnoredRules(filters.ignoredSelectors);
    const imageNodes = [];
    const backgroundNodes = [];

    if (root instanceof Element && root.matches("img, picture")) {
      imageNodes.push(root);
    }
    imageNodes.push(...Array.from(root.querySelectorAll("img, picture")));

    if (root instanceof Element && root.matches("[style*='background-image'], [data-src], [data-original], [data-bg], [data-background], [data-full-src], [data-pin-media], [data-image], [data-media]")) {
      backgroundNodes.push(root);
    }
    backgroundNodes.push(...Array.from(root.querySelectorAll("[style*='background-image'], [data-src], [data-original], [data-bg], [data-background], [data-full-src], [data-pin-media], [data-image], [data-media]")));

    for (const node of imageNodes) {
      if (!(node instanceof Element) || shouldIgnoreElement(node, ignoredRules)) {
        continue;
      }

      if (node instanceof HTMLImageElement) {
        await collectFromImageNode(node, imageMap, filters, ignoredRules);
        continue;
      }

      if (node instanceof HTMLPictureElement) {
        await collectFromPictureNode(node, imageMap, filters, ignoredRules);
      }
    }

    for (const node of backgroundNodes) {
      if (!(node instanceof Element) || shouldIgnoreElement(node, ignoredRules) || node instanceof HTMLImageElement || node instanceof HTMLPictureElement) {
        continue;
      }
      await collectFromElementNode(node, imageMap, filters, ignoredRules);
    }

    return dedupeImages(Array.from(imageMap.values()));
  }

  async function collectFromPictureNode(picture, imageMap, filters, ignoredRules) {
    const previewImage = picture.querySelector("img");
    if (previewImage) {
      await collectFromImageNode(previewImage, imageMap, filters, ignoredRules);
    }

    for (const source of Array.from(picture.querySelectorAll("source"))) {
      await collectFromSourceNode(source, imageMap, filters, ignoredRules);
    }
  }
  async function collectFromImageNode(image, imageMap, filters, ignoredRules) {
    const metrics = measureElement(image);
    const altText = getTextValue(image.alt, image.getAttribute("aria-label"), image.getAttribute("title"));
    const context = getElementContext(image, altText);
    const candidates = [];

    const highResUrl = await getBestImageUrl(image);
    if (highResUrl) {
      addCandidate(candidates, highResUrl, "source", 96);
    }

    const propertySrc = image.currentSrc || (image.hasAttribute("src") ? image.src : "");
    addCandidate(candidates, propertySrc, "rendered", 60);

    const bestImageSrcset = pickBestFromSrcset(image.srcset || image.getAttribute("srcset"));
    if (bestImageSrcset) {
      addCandidate(candidates, bestImageSrcset, "source", 58);
    }

    for (const attribute of URL_ATTRIBUTES) {
      addCandidate(candidates, resolveAbsoluteUrl(image.getAttribute(attribute)), "rendered", 52);
    }

    for (const attribute of SRCSET_ATTRIBUTES) {
      const bestCandidate = pickBestFromSrcset(image.getAttribute(attribute));
      if (bestCandidate) {
        addCandidate(candidates, bestCandidate, "source", 56);
      }
    }

    const picture = image.closest("picture");
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

    if (filters.preferLinkedOriginals) {
      for (const candidate of collectAncestorImageUrls(image)) {
        addCandidate(candidates, candidate.url, candidate.sourceType, candidate.sourceRank);
      }
    }

    await registerCandidates(imageMap, dedupeCandidates(candidates), {
      baseElement: image,
      altText,
      context,
      metrics,
      sourceTypeFallback: "rendered",
      ignoredRules,
      filenameHint: buildFilenameHint(altText, image)
    });
  }

  async function collectFromSourceNode(source, imageMap, filters, ignoredRules) {
    const picture = source.closest("picture");
    const previewImage = picture?.querySelector("img") || source.parentElement;
    const metrics = measureElement(previewImage || source);
    const altText = getTextValue(previewImage?.getAttribute?.("alt"), previewImage?.getAttribute?.("aria-label"), previewImage?.getAttribute?.("title"));
    const context = getElementContext(previewImage || source, altText);
    const candidates = [];

    const sourceSrcset = pickBestFromSrcset(source.srcset || source.getAttribute("srcset"));
    if (sourceSrcset) {
      addCandidate(candidates, sourceSrcset, "source", 68);
    }

    for (const attribute of SRCSET_ATTRIBUTES) {
      const bestCandidate = pickBestFromSrcset(source.getAttribute(attribute));
      if (bestCandidate) {
        addCandidate(candidates, bestCandidate, "source", 66);
      }
    }

    for (const attribute of URL_ATTRIBUTES) {
      addCandidate(candidates, resolveAbsoluteUrl(source.getAttribute(attribute)), "source", 62);
    }

    if (filters.preferLinkedOriginals && previewImage instanceof Element) {
      for (const candidate of collectAncestorImageUrls(previewImage)) {
        addCandidate(candidates, candidate.url, candidate.sourceType, candidate.sourceRank);
      }
    }

    await registerCandidates(imageMap, dedupeCandidates(candidates), {
      baseElement: previewImage || source,
      altText,
      context,
      metrics,
      sourceTypeFallback: "source",
      ignoredRules,
      filenameHint: buildFilenameHint(altText, previewImage || source)
    });
  }

  async function collectFromElementNode(element, imageMap, filters, ignoredRules) {
    const metrics = measureElement(element);
    const context = getElementContext(element, "");
    const candidates = [];

    for (const value of extractBackgroundUrls(element)) {
      addCandidate(candidates, value, "background", 48);
    }

    for (const attribute of [...BACKGROUND_ATTRIBUTES, ...URL_ATTRIBUTES]) {
      addCandidate(candidates, resolveAbsoluteUrl(element.getAttribute(attribute)), "background", 44);
    }

    for (const attribute of SRCSET_ATTRIBUTES) {
      const bestCandidate = pickBestFromSrcset(element.getAttribute(attribute));
      if (bestCandidate) {
        addCandidate(candidates, bestCandidate, "background", 42);
      }
    }

    await registerCandidates(imageMap, dedupeCandidates(candidates), {
      baseElement: element,
      altText: "",
      context,
      metrics,
      sourceTypeFallback: "background",
      ignoredRules,
      filenameHint: buildFilenameHint("", element)
    });
  }

async function registerCandidates(imageMap, candidates, context) {
    for (const candidate of candidates) {
      const normalizedUrl = await normalizeCandidateUrl(candidate.url);
      if (!normalizedUrl) {
        continue;
      }

      const finalUrl = resolveAbsoluteUrl(applyFlickrExploit(normalizedUrl));
      if (!finalUrl) {
        continue;
      }

      // REMOVED: The hidden hasBlockedKeyword check that was destroying valid images
      // We should rely on the user's UI filters and size limits, not a hardcoded array.

      registerCandidate(imageMap, {
        url: finalUrl,
        altText: context.altText,
        renderedWidth: context.metrics.renderedWidth,
        renderedHeight: context.metrics.renderedHeight,
        naturalWidth: context.metrics.naturalWidth,
        naturalHeight: context.metrics.naturalHeight,
        sourceWidth: 0,
        sourceHeight: 0,
        sourceType: candidate.sourceType || context.sourceTypeFallback,
        sourceRank: candidate.sourceRank,
        format: detectFormat(finalUrl),
        filenameHint: context.filenameHint
      });
    }
  }

  function getDeepScanNodes(root, ignoredSelectors) {
    const ignoredRules = parseIgnoredRules(ignoredSelectors);
    const nodes = [];

    if (root instanceof Element && root.matches(DEEP_SCAN_SELECTOR) && !shouldIgnoreElement(root, ignoredRules)) {
      nodes.push(root);
    }

    for (const node of Array.from(root.querySelectorAll(DEEP_SCAN_SELECTOR))) {
      if (!shouldIgnoreElement(node, ignoredRules)) {
        nodes.push(node);
      }
    }

    return nodes;
  }

  function getScopedElements(root, selector) {
    const elements = [];
    if (root instanceof Element && root.matches(selector)) {
      elements.push(root);
    }
    elements.push(...Array.from(root.querySelectorAll(selector)));
    return elements;
  }

  function measureElement(element) {
    const target = element instanceof Element ? element : null;
    const rect = target?.getBoundingClientRect?.() || { width: 0, height: 0 };
    const widthAttribute = Number.parseInt(target?.getAttribute?.("width") || "0", 10) || 0;
    const heightAttribute = Number.parseInt(target?.getAttribute?.("height") || "0", 10) || 0;
    return {
      renderedWidth: Math.round(Math.max(rect.width || 0, target?.clientWidth || 0, 0)),
      renderedHeight: Math.round(Math.max(rect.height || 0, target?.clientHeight || 0, 0)),
      naturalWidth: Number(target?.naturalWidth || 0) || widthAttribute,
      naturalHeight: Number(target?.naturalHeight || 0) || heightAttribute
    };
  }
  function extractBackgroundUrls(element) {
    const urls = [];
    const computedStyle = window.getComputedStyle(element);
    const styleValue = `${computedStyle.backgroundImage || ""} ${element.getAttribute("style") || ""}`;
    const pattern = /url\((['"]?)(.*?)\1\)/gi;
    let match = pattern.exec(styleValue);

    while (match) {
      if (match[2]) {
        urls.push(resolveAbsoluteUrl(match[2]));
      }
      match = pattern.exec(styleValue);
    }

    return urls;
  }

  function isValidTargetImage(element) {
    if (!(element instanceof HTMLImageElement) || element.tagName !== "IMG") {
      return false;
    }

    const imageUrl = String(element.currentSrc || element.src || "");
    if (/spaceball|transparent|data:image\/gif/i.test(imageUrl)) {
      return false;
    }

    if (Number(element.naturalWidth || 0) <= 1) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 150) {
      return false;
    }

    return true;
  }

  function getImageFromPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    const elements = document.elementsFromPoint(clientX, clientY)
      .filter((element) => element instanceof Element)
      .filter((element) => !(
        element.id === UI_HOST_ID
        || element.id === "iepShell"
        || element.classList?.contains("iep-shell")
        || element.closest?.(`#${UI_HOST_ID}`)
        || element.closest?.("#iepShell")
        || element.closest?.(".iep-shell")
      ));

    for (const element of elements) {
      if (isValidTargetImage(element)) {
        return element;
      }

      if (element instanceof HTMLPictureElement) {
        const previewImage = element.querySelector("img");
        if (isValidTargetImage(previewImage)) {
          return previewImage;
        }
      }

      const backgroundUrls = extractBackgroundUrls(element);
      if (backgroundUrls.some((url) => url && !/spaceball|transparent|data:image\/gif/i.test(url))) {
        return element;
      }
    }

    const disableSiteControls = Boolean(window.__imageExtractorProContentController?.state?.filters?.disableSiteControls);
    if (!disableSiteControls) {
      return null;
    }

    for (const element of elements.slice(0, 4)) {
      if (!(element instanceof Element)) {
        continue;
      }

      const relatedImages = new Set([
        ...Array.from(element.parentElement?.querySelectorAll?.("img") || []),
        ...Array.from(element.querySelectorAll?.("img") || [])
      ]);

      for (const image of relatedImages) {
        if (!isValidTargetImage(image)) {
          continue;
        }

        const rect = image.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return image;
        }
      }
    }

    return null;
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

  function applyFlickrExploit(url) {
    if (!url || !url.includes("flickr.com")) {
      return url;
    }

    const idMatch = url.match(/\/(\d+)_[a-f0-9]+/i);
    if (idMatch) {
      const photoId = idMatch[1];
      const scriptContent = Array.from(document.scripts).map((script) => script.textContent || "").join(" ");
      const sizes = ["o", "k", "h", "b"];

      for (const size of sizes) {
        const regex = new RegExp(`"url":"([^"]+?${photoId}_[a-f0-9]+_${size}\\.(?:jpg|png|gif)[^"]*)"`, "i");
        const match = scriptContent.match(regex);
        if (match) {
          return match[1].replace(/\\\//g, "/");
        }
      }
    }

    return url.replace(/_([a-f0-9]{10})(?:_[a-z])?\.([a-zA-Z]+)$/i, "_$1_b.$2");
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

    return resolveAbsoluteUrl(applyFlickrExploit(finalUrl));
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
        addCandidate(candidates, resolveAbsoluteUrl(element.getAttribute(attribute)), "source", 62);
      }
    } else if (element instanceof HTMLImageElement) {
      const propertySrc = element.currentSrc || (element.hasAttribute("src") ? element.src : "");
      addCandidate(candidates, propertySrc, "rendered", 60);

      const bestImageSrcset = pickBestFromSrcset(element.srcset || element.getAttribute("srcset"));
      if (bestImageSrcset) {
        addCandidate(candidates, bestImageSrcset, "source", 58);
      }

      for (const attribute of URL_ATTRIBUTES) {
        addCandidate(candidates, resolveAbsoluteUrl(element.getAttribute(attribute)), "rendered", 52);
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
        addCandidate(candidates, resolveAbsoluteUrl(element.getAttribute(attribute)), "background", 44);
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
      } catch (error) {
        return null;
      }
    }

    return absoluteUrl;
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
      if (trimmed.startsWith("/")) {
        return new URL(trimmed, window.location.origin).href;
      }
      return new URL(trimmed, document.baseURI).href;
    } catch (error) {
      return "";
    }
  }
  function pickBestFromSrcset(srcsetValue) {
    const candidates = parseSrcsetCandidates(srcsetValue);
    if (!candidates.length) {
      return "";
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].url;
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
  function registerCandidate(imageMap, candidate) {
    const existing = imageMap.get(candidate.url);
    if (!existing) {
      imageMap.set(candidate.url, candidate);
      return;
    }

    existing.altText = pickLongerText(existing.altText, candidate.altText);
    existing.renderedWidth = Math.max(existing.renderedWidth, candidate.renderedWidth);
    existing.renderedHeight = Math.max(existing.renderedHeight, candidate.renderedHeight);
    existing.naturalWidth = Math.max(existing.naturalWidth, candidate.naturalWidth);
    existing.naturalHeight = Math.max(existing.naturalHeight, candidate.naturalHeight);
    existing.sourceWidth = Math.max(existing.sourceWidth, candidate.sourceWidth);
    existing.sourceHeight = Math.max(existing.sourceHeight, candidate.sourceHeight);
    existing.filenameHint = pickLongerText(existing.filenameHint, candidate.filenameHint);

    if (candidate.sourceRank > existing.sourceRank) {
      existing.sourceType = candidate.sourceType;
      existing.sourceRank = candidate.sourceRank;
    }

    if (!existing.format && candidate.format) {
      existing.format = candidate.format;
    }
  }

  function addCandidate(target, url, sourceType, sourceRank) {
    if (url) {
      target.push({ url, sourceType, sourceRank });
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

  function dedupeImages(images) {
    const seen = new Set();
    const unique = [];
    for (const image of images) {
      if (!image?.url || seen.has(image.url)) {
        continue;
      }
      seen.add(image.url);
      unique.push(image);
    }
    return unique;
  }

  async function enrichImagesWithSourceMetadata(images, sourceProbeCache, onProgress) {
    const total = images.length;
    let processed = 0;

    if (!total) {
      onProgress?.(100, "Filtering and enriching images...");
      return;
    }

    onProgress?.(0, "Filtering and enriching images...");
    await runWithConcurrency(images, PREVIEW_SCAN_CONCURRENCY, async (image) => {
      const metadata = await probeSourceMetadata(image.url, image.format, sourceProbeCache);
      if (metadata.format && !image.format) {
        image.format = metadata.format;
      }
      if (metadata.width) {
        image.sourceWidth = Math.max(image.sourceWidth || 0, metadata.width);
        image.naturalWidth = Math.max(image.naturalWidth || 0, metadata.width);
      }
      if (metadata.height) {
        image.sourceHeight = Math.max(image.sourceHeight || 0, metadata.height);
        image.naturalHeight = Math.max(image.naturalHeight || 0, metadata.height);
      }

      processed += 1;
      const percent = Math.round((processed / total) * 100);
      onProgress?.(percent, "Filtering and enriching images...");
    });
  }

  async function runWithConcurrency(items, limit, task) {
    if (!items.length) {
      return;
    }

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await task(items[index], index);
      }
    }));
  }

  function applyExtractionFilters(images, filters) {
    const enabledGroups = FORMAT_GROUPS.filter((group) => filters.formats[group.key]);
    if (!enabledGroups.length) {
      return [];
    }

    return images.filter((image) => {
      const format = normalizeFormat(image.format);
      const width = getImageWidth(image);
      const height = getImageHeight(image);
      if (!enabledGroups.some((group) => group.matches.includes(format))) {
        return false;
      }
      if (filters.imageOrigin === "rendered" && image.sourceType === "source") {
        return false;
      }
      if (filters.imageOrigin === "source" && image.sourceType === "rendered") {
        return false;
      }
      if (filters.minWidth && width && width < filters.minWidth) {
        return false;
      }
      if (filters.minHeight && height && height < filters.minHeight) {
        return false;
      }
      return true;
    });
  }

  async function probeSourceMetadata(url, format, sourceProbeCache) {
    if (!url) {
      return { width: 0, height: 0, format: normalizeFormat(format) };
    }
    if (sourceProbeCache.has(url)) {
      return sourceProbeCache.get(url);
    }

    const promise = (async () => {
      const initialFormat = normalizeFormat(format) || detectFormat(url);
      const imageProbe = ["heic", "heif"].includes(initialFormat)
        ? { width: 0, height: 0 }
        : await probeWithImage(url, IMAGE_PROBE_TIMEOUT);

      if (imageProbe.width && imageProbe.height) {
        return { width: imageProbe.width, height: imageProbe.height, format: initialFormat };
      }

      const binary = await fetchBinaryProbe(url);
      if (!binary?.buffer) {
        return { width: imageProbe.width, height: imageProbe.height, format: initialFormat };
      }

      const detectedFormat = normalizeFormat(initialFormat || detectFormat(url, binary.contentType));
      let width = 0;
      let height = 0;
      if (detectedFormat === "bmp") {
        ({ width, height } = parseBmpDimensions(binary.buffer));
      } else if (["heic", "heif"].includes(detectedFormat)) {
        ({ width, height } = parseHeicDimensions(binary.buffer));
      } else if (detectedFormat === "svg" || /image\/svg\+xml/i.test(binary.contentType || "")) {
        ({ width, height } = parseSvgDimensions(binary.text || decodeArrayBuffer(binary.buffer)));
      }

      return { width: width || imageProbe.width || 0, height: height || imageProbe.height || 0, format: detectedFormat };
    })();

    sourceProbeCache.set(url, promise);
    return promise;
  }

  async function probeWithImage(url, timeoutMs) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const timer = window.setTimeout(() => finish(0, 0), timeoutMs);

      function finish(width, height) {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve({ width: Number(image.naturalWidth || width || 0), height: Number(image.naturalHeight || height || 0) });
      }

      image.onload = () => finish(0, 0);
      image.onerror = () => finish(0, 0);
      image.decoding = "async";
      image.src = url;
      if (image.complete && image.naturalWidth) {
        finish(image.naturalWidth, image.naturalHeight);
      }
    });
  }

  async function fetchBinaryProbe(url) {
    if (url.startsWith("data:")) {
      return decodeDataUrl(url);
    }

    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "";
        return { buffer, contentType, text: /svg|xml|text/i.test(contentType) ? decodeArrayBuffer(buffer) : "" };
      }
    } catch (error) {
      // Fall through to the background fetch path.
    }

    try {
      const response = await api.runtime.sendMessage({ type: "IEP_FETCH_BINARY_PROBE", url });
      if (response?.ok && response.buffer) {
        return { buffer: response.buffer, contentType: response.contentType || "", text: response.text || "" };
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function decodeDataUrl(dataUrl) {
    const match = String(dataUrl).match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
    if (!match) {
      return null;
    }

    const contentType = match[1] || "";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    let bytes;

    if (isBase64) {
      const decoded = atob(payload);
      bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
      }
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }

    return { buffer: bytes.buffer, contentType, text: /svg|xml|text/i.test(contentType) ? decodeArrayBuffer(bytes.buffer) : "" };
  }

  function parseBmpDimensions(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 26 || view.getUint16(0, false) !== 0x424d) {
      return { width: 0, height: 0 };
    }
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  }

  function parseHeicDimensions(buffer) {
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index <= bytes.length - 20; index += 1) {
      if (bytes[index + 4] === 0x69 && bytes[index + 5] === 0x73 && bytes[index + 6] === 0x70 && bytes[index + 7] === 0x65) {
        const view = new DataView(buffer, index, Math.min(20, buffer.byteLength - index));
        if (view.byteLength >= 20) {
          return { width: view.getUint32(12, false), height: view.getUint32(16, false) };
        }
      }
    }
    return { width: 0, height: 0 };
  }

  function parseSvgDimensions(text) {
    if (!text) {
      return { width: 0, height: 0 };
    }

    try {
      const documentNode = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = documentNode.querySelector("svg");
      if (!svg) {
        return { width: 0, height: 0 };
      }
      const width = parseSvgLength(svg.getAttribute("width"));
      const height = parseSvgLength(svg.getAttribute("height"));
      if (width && height) {
        return { width, height };
      }
      const parts = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number).filter((value) => Number.isFinite(value));
      return parts.length === 4 ? { width: Math.round(parts[2]), height: Math.round(parts[3]) } : { width: 0, height: 0 };
    } catch (error) {
      return { width: 0, height: 0 };
    }
  }

  function parseSvgLength(value) {
    const match = String(value || "").trim().match(/^([0-9]+(?:\.[0-9]+)?)/);
    return match ? Math.round(Number.parseFloat(match[1]) || 0) : 0;
  }

  function sanitizeDownloadFolderName(value, fallback = "Extracted Images") {
    const sanitized = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);

    return sanitized || fallback;
  }
  function renderFormatGroup(container, groups, state) {
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const label = document.createElement("label");
      label.className = "iep-format-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = group.key;
      checkbox.checked = Boolean(state[group.key]);
      const text = document.createElement("span");
      text.textContent = group.label;
      label.appendChild(checkbox);
      label.appendChild(text);
      fragment.appendChild(label);
    }
    container.replaceChildren(fragment);
  }

  function readFormatStateFromUi(rootNode, fallbackState) {
    const nextState = { ...fallbackState };
    for (const checkbox of Array.from(rootNode.querySelectorAll("#iepFormatOptions input[type='checkbox'], #iepAdvancedFormatOptions input[type='checkbox']"))) {
      nextState[checkbox.value] = checkbox.checked;
    }
    return nextState;
  }

  function parseIgnoredRules(text) {
    return String(text || "")
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function shouldIgnoreElement(element, rules) {
    if (!rules.length) {
      return false;
    }

    const identity = `${element.id || ""} ${typeof element.className === "string" ? element.className : ""}`.toLowerCase();
    return rules.some((rule) => {
      const lowerRule = rule.toLowerCase();
      if (/^[.#\[]/.test(rule)) {
        try {
          return element.matches(rule) || Boolean(element.closest(rule));
        } catch (error) {
          return identity.includes(lowerRule);
        }
      }
      return identity.includes(lowerRule);
    });
  }

  function getSmartSelectionContainer(element) {
    const imageLike = element.matches("img, picture, source") || Boolean(element.closest("picture"));
    if (!imageLike) {
      return element;
    }

    let current = element;
    while (current && current !== document.body) {
      if (SMART_SCOPE_SELECTORS.some((selector) => current.matches(selector)) && countDeepMediaNodes(current) > 1) {
        return current;
      }
      current = current.parentElement;
    }

    return element.closest("figure, li, article, .card, picture") || element;
  }

  function countDeepMediaNodes(root) {
    let count = root.matches?.("img, picture, source, [style*='background-image']") ? 1 : 0;
    count += root.querySelectorAll?.("img, picture source, [style*='background-image']").length || 0;
    return count;
  }

  function applyKeywordBlocklist(value) {
    return BLOCKED_KEYWORDS.some((keyword) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(keyword)}(?:[^a-z0-9]|$)`, "i").test(String(value || "").toLowerCase()));
  }

  function hasBlockedKeyword(value) {
    return applyKeywordBlocklist(value);
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

    if (url.startsWith("data:image/")) {
      const section = url.slice("data:image/".length).split(/[;,]/, 1)[0].toLowerCase();
      return normalizeFormat(section === "svg+xml" ? "svg" : section);
    }

    try {
      const parsedUrl = new URL(url, document.baseURI);
      const extensionMatch = parsedUrl.pathname.toLowerCase().match(/\.([a-z0-9]+)$/i);
      if (extensionMatch) {
        return normalizeFormat(extensionMatch[1]);
      }
      return normalizeFormat(parsedUrl.searchParams.get("format") || parsedUrl.searchParams.get("fm") || parsedUrl.searchParams.get("ext") || "");
    } catch (error) {
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

  function getElementContext(element, altText) {
    return [altText, element.id, typeof element.className === "string" ? element.className : "", element.getAttribute?.("aria-label") || "", element.getAttribute?.("title") || ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function buildFilenameHint(altText, element) {
    return sanitizeText(altText) || sanitizeText(element.getAttribute?.("aria-label") || "") || sanitizeText(element.getAttribute?.("title") || "") || sanitizeText(element.id || "");
  }

  function getTextValue(...values) {
    for (const value of values) {
      const normalized = sanitizeText(value);
      if (normalized) {
        return normalized;
      }
    }
    return "";
  }

  function sanitizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function pickLongerText(left, right) {
    return String(right || "").length > String(left || "").length ? right : left;
  }

  function getImageWidth(image) {
    return Math.max(Number(image.sourceWidth || 0), Number(image.naturalWidth || 0), Number(image.renderedWidth || 0));
  }

  function getImageHeight(image) {
    return Math.max(Number(image.sourceHeight || 0), Number(image.naturalHeight || 0), Number(image.renderedHeight || 0));
  }

  function getImageArea(image) {
    return getImageWidth(image) * getImageHeight(image);
  }

  function buildScrollStops(start, end, step) {
    const points = [];
    const safeStep = Math.max(step, 120);
    let current = start;
    while (current < end) {
      points.push(current);
      current += safeStep;
    }
    points.push(end);
    return Array.from(new Set(points.map((value) => Math.max(0, Math.round(value)))));
  }

  function isScrollable(element) {
    const style = window.getComputedStyle(element);
    return element.scrollHeight > element.clientHeight + 8 && /(auto|scroll|overlay)/.test(style.overflowY);
  }

  function looksLikePlaceholder(url) {
    return /^data:image\/(gif|png);base64/i.test(String(url || "")) && String(url || "").length < 120;
  }

  function decodeArrayBuffer(buffer) {
    try { return new TextDecoder("utf-8").decode(buffer); } catch (error) { return ""; }
  }

  function describeSelectionTarget(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const classes = typeof element.className === "string"
      ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join("")
      : "";
    return `${tag}${id}${classes}`;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  document.addEventListener("contextmenu", (event) => {
    lastRightClickX = event.clientX;
    lastRightClickY = event.clientY;
  }, true);

  const controller = new FloatingExtractorController();
  window.__imageExtractorProContentController = controller;

  ["mousedown", "pointerdown", "mouseup", "pointerup"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const isRightClick = event.button === 2 && controller.state.filters.disableSiteControls;
      const isDrawingBox = event.button === 0 && controller.state.selectionMode;
      if (isRightClick || isDrawingBox) {
        event.stopPropagation();
      }
    }, { capture: true });
  });

  api.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "IEP_TOGGLE_UI":
        controller.toggle();
        return Promise.resolve({ ok: true });
      case "IEP_EXECUTE_CONTEXT_DOWNLOAD":
        return handleContextQuickDownload();
      default:
        return undefined;
    }
  });

  async function handleContextQuickDownload() {
    const target = getImageFromPoint(lastRightClickX, lastRightClickY);
    const url = await getBestImageUrl(target);

    if (!url) {
      return {
        ok: false,
        error: "No image was found at the last right-click location."
      };
    }

    return api.runtime.sendMessage({
      type: "IEP_QUICK_DOWNLOAD",
      url
    });
  }
})();

























