// ==UserScript==
// @include   main
// @loadOrder 99999999999998
// @ignorecache
// ==/UserScript==

// zen-dismissed-downloads-pile.uc.js
// Dismissed downloads pile with messy-to-grid transition
(function () {
  "use strict";

  // Wait for browser window to be ready
  if (location.href !== "chrome://browser/content/browser.xhtml") return;

  // Configuration
  const CONFIG = {
    maxPileSize: 20, // Maximum pods to keep in pile
    pileDisplayCount: 20, // Pods visible in messy pile
    gridAnimationDelay: 50, // ms between pod animations
    hoverDebounceMs: 150, // Hover debounce delay
    pileRotationRange: 8, // degrees ±
    pileOffsetRange: 8, // pixels ±
    gridPadding: 12, // pixels between grid items
    minPodSize: 45, // minimum pod size in grid
    minSidePadding: 5, // minimum padding from sidebar edges
    animationDuration: 400, // pod transition duration
    containerAnimationDuration: 100, // container height/padding transition duration
    maxRetryAttempts: 10, // Maximum initialization retry attempts
    retryDelay: 500, // Delay between retry attempts
  };

  // Firefox preferences
  const PREFS = {
    alwaysShowPile: 'zen.stuff-pile.always-show', // Boolean: show pile always (hide with Alt key)
  };

  // Centralized state management
  class PileState {
    constructor() {
      this.downloadButton = null;
      this.pileContainer = null;
      this.dynamicSizer = null;
      this.isGridMode = false;
      this.hoverTimeout = null;
      this.dismissedPods = new Map(); // podKey -> podData
      this.podElements = new Map(); // podKey -> DOM element
      this.pilePositions = new Map(); // podKey -> {x, y, rotation, zIndex}
      this.gridPositions = new Map(); // podKey -> {x, y, row, col}
      this.isInitialized = false;
      this.isTransitioning = false;
      this.isAltPressed = false;
      this.currentZenSidebarWidthForPile = '';
      this.retryCount = 0;
      this.eventListeners = new Map(); // Track event listeners for cleanup
      this.prefObserver = null;
      // --- add pendingPileClose flag ---
      this.pendingPileClose = false;
      // --- add gridScrollIndex for grid windowing ---
      this.gridScrollIndex = 0;
      // --- add visibleGridOrder for carousel ---
      this.visibleGridOrder = [];
      // --- add carouselStartIndex for >6 pods ---
      this.carouselStartIndex = 0;
      // --- add isGridAnimating flag ---
      this.isGridAnimating = false;
    }

    // Safe getters with validation
    getPodData(key) {
      return this.dismissedPods.get(key) || null;
    }

    getPodElement(key) {
      return this.podElements.get(key) || null;
    }

    getPilePosition(key) {
      return this.pilePositions.get(key) || null;
    }

    getGridPosition(key) {
      return this.gridPositions.get(key) || null;
    }

    // Safe setters with validation
    setPodData(key, data) {
      if (key && data) {
        this.dismissedPods.set(key, data);
      }
    }

    setPodElement(key, element) {
      if (key && element) {
        this.podElements.set(key, element);
      }
    }

    // Cleanup methods
    removePod(key) {
      this.dismissedPods.delete(key);
      this.podElements.delete(key);
      this.pilePositions.delete(key);
      this.gridPositions.delete(key);
    }

    clearAll() {
      this.dismissedPods.clear();
      this.podElements.clear();
      this.pilePositions.clear();
      this.gridPositions.clear();
    }
  }

  // Global state instance
  const state = new PileState();

  // Error handling utilities
  class ErrorHandler {
    static handleError(error, context, fallback = null) {
      console.error(`[Dismissed Pile] Error in ${context}:`, error);
      return fallback;
    }

    static async withRetry(operation, maxAttempts = 3, delay = 1000) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await operation();
        } catch (error) {
          if (attempt === maxAttempts) {
            throw error;
          }
          console.warn(`[Dismissed Pile] Attempt ${attempt} failed, retrying in ${delay}ms:`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    static validateFilePath(path) {
      if (!path || typeof path !== 'string') {
        throw new Error('Invalid file path: path must be a non-empty string');
      }
      
      // Basic path validation - prevent directory traversal
      if (path.includes('..') || path.includes('//')) {
        throw new Error('Invalid file path: contains forbidden characters');
      }
      
      return path;
    }

    static validatePodData(podData) {
      if (!podData || typeof podData !== 'object') {
        throw new Error('Invalid pod data: must be an object');
      }
      
      if (!podData.key || typeof podData.key !== 'string') {
        throw new Error('Invalid pod data: missing or invalid key');
      }
      
      if (!podData.filename || typeof podData.filename !== 'string') {
        throw new Error('Invalid pod data: missing or invalid filename');
      }
      
      return podData;
    }
  }

  // File system utilities with proper error handling
  class FileSystem {
    static async createFileInstance(path) {
      try {
        const validatedPath = ErrorHandler.validateFilePath(path);
        const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
        file.initWithPath(validatedPath);
        return file;
      } catch (error) {
        throw new Error(`Failed to create file instance: ${error.message}`);
      }
    }

    static async fileExists(path) {
      try {
        const file = await this.createFileInstance(path);
        return file.exists();
      } catch (error) {
        console.warn(`[FileSystem] Error checking file existence: ${error.message}`);
        return false;
      }
    }

    static async getParentDirectory(path) {
      try {
        const file = await this.createFileInstance(path);
        return file.parent;
      } catch (error) {
        throw new Error(`Failed to get parent directory: ${error.message}`);
      }
    }

    // Auto-increment filename if duplicate exists
    static async getAvailableFilename(parentDir, baseName, ext) {
      let candidate = baseName + ext;
      let counter = 1;
      let file = parentDir.clone();
      file.append(candidate);
      while (file.exists()) {
        candidate = `${baseName} (${counter})${ext}`;
        file = parentDir.clone();
        file.append(candidate);
        counter++;
      }
      return candidate;
    }

    static async renameFile(oldPath, newFilename) {
      try {
        const oldFile = await this.createFileInstance(oldPath);
        if (!oldFile.exists()) {
          throw new Error('Source file does not exist');
        }

        const parentDir = oldFile.parent;
        // Split newFilename into base and extension
        const dotIdx = newFilename.lastIndexOf('.');
        let baseName = newFilename;
        let ext = '';
        if (dotIdx > 0) {
          baseName = newFilename.substring(0, dotIdx);
          ext = newFilename.substring(dotIdx);
        }
        // Find available filename
        const availableName = await this.getAvailableFilename(parentDir, baseName, ext);
        const newFile = parentDir.clone();
        newFile.append(availableName);
        oldFile.moveTo(parentDir, availableName);
        return newFile.path;
      } catch (error) {
        throw new Error(`Failed to rename file: ${error.message}`);
      }
    }

    static async deleteFile(path) {
      try {
        const file = await this.createFileInstance(path);
        if (file.exists()) {
          file.remove(false); // false = don't move to trash
          return true;
        }
        return false;
      } catch (error) {
        throw new Error(`Failed to delete file: ${error.message}`);
      }
    }
  }

  // Event management with cleanup
  class EventManager {
    static addEventListener(element, event, handler, options = {}) {
      if (!element || !handler) {
        console.warn('[EventManager] Invalid element or handler for event listener');
        return;
      }

      element.addEventListener(event, handler, options);
      
      // Track for cleanup
      const key = `${element.id || 'unknown'}-${event}`;
      if (!state.eventListeners.has(key)) {
        state.eventListeners.set(key, []);
      }
      state.eventListeners.get(key).push({ element, event, handler, options });
    }

    static removeEventListener(element, event, handler) {
      if (!element || !handler) return;
      
      element.removeEventListener(event, handler);
      
      // Remove from tracking
      const key = `${element.id || 'unknown'}-${event}`;
      const listeners = state.eventListeners.get(key);
      if (listeners) {
        const index = listeners.findIndex(l => l.handler === handler);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }
    }

    static cleanupAll() {
      for (const [key, listeners] of state.eventListeners) {
        for (const { element, event, handler } of listeners) {
          try {
            element.removeEventListener(event, handler);
          } catch (error) {
            console.warn(`[EventManager] Error removing event listener: ${error.message}`);
          }
        }
      }
      state.eventListeners.clear();
    }
  }

  // Debug logging with conditional output
  function debugLog(message, data = null) {
    // Only log in development mode or when explicitly enabled
    if (typeof window.zenDebugMode !== 'undefined' && window.zenDebugMode) {
    try {
      console.log(`[Dismissed Pile] ${message}`, data || '');
    } catch (e) {
      console.log(`[Dismissed Pile] ${message}`);
      }
    }
  }

  // Initialize the pile system with proper error handling
  async function init() {
    debugLog("Initializing dismissed downloads pile system");
    
    try {
      // Check retry limit
      if (state.retryCount >= CONFIG.maxRetryAttempts) {
        console.error('[Dismissed Pile] Max retry attempts reached, initialization failed');
        return;
      }
    
    // Wait for the main download script to be available
    if (!window.zenTidyDownloads) {
        state.retryCount++;
        debugLog(`Main download script not ready, retry ${state.retryCount}/${CONFIG.maxRetryAttempts}`);
        setTimeout(init, CONFIG.retryDelay);
      return;
    }

      await ErrorHandler.withRetry(async () => {
      await findDownloadButton();
        await createPileContainer();
      setupEventListeners();
      loadExistingDismissedPods();
      });
      
      state.isInitialized = true;
      state.retryCount = 0; // Reset retry count on success
      debugLog("Dismissed downloads pile system initialized successfully");
    } catch (error) {
      ErrorHandler.handleError(error, 'initialization');
      state.retryCount++;
      setTimeout(init, CONFIG.retryDelay);
    }
  }

  // Find the Firefox downloads button with better error handling
  async function findDownloadButton() {
    const selectors = [
      '#downloads-button',
      '[data-l10n-id="downloads-button"]',
      '#downloads-indicator',
      '.toolbarbutton-1[command="Tools:Downloads"]'
    ];

    for (const selector of selectors) {
      try {
        state.downloadButton = document.querySelector(selector);
        if (state.downloadButton) {
        debugLog(`Found download button using selector: ${selector}`);
        return;
        }
      } catch (error) {
        console.warn(`[DownloadButton] Error with selector ${selector}:`, error);
      }
    }

    // Fallback: look for any element with downloads-related attributes
    try {
    const fallbackElements = document.querySelectorAll('[id*="download"], [class*="download"]');
    for (const element of fallbackElements) {
      if (element.getAttribute('command')?.includes('Downloads') || 
          element.textContent?.toLowerCase().includes('download')) {
          state.downloadButton = element;
        debugLog("Found download button using fallback method", element);
        return;
      }
      }
    } catch (error) {
      console.warn('[DownloadButton] Error in fallback search:', error);
    }

    throw new Error("Download button not found after all attempts");
  }

  // Create the pile container
  async function createPileContainer() {
    if (!state.downloadButton) throw new Error("Download button not available");

    // Check for existing elements
    let existingSizer = document.getElementById("zen-dismissed-pile-dynamic-sizer");
    if (existingSizer) {
      debugLog("Found existing dynamic sizer, removing it first");
      existingSizer.remove();
    }

    // Create the dynamic sizer element
    state.dynamicSizer = document.createElement("div");
    state.dynamicSizer.id = "zen-dismissed-pile-dynamic-sizer";
    state.dynamicSizer.style.cssText = `
      position: fixed;
      overflow: hidden;
      height: 0px;
      bottom: 30px;
      left: 0px;
      background: transparent;
      mask: linear-gradient(to top, transparent 0%, black 5%, black 80%, transparent 100%);
      -webkit-mask: linear-gradient(to top, transparent 0%, black 5%, black 85%, transparent 100%);
      box-sizing: border-box;
      transition: height ${CONFIG.containerAnimationDuration}ms ease, padding-bottom ${CONFIG.containerAnimationDuration}ms ease, padding-left ${CONFIG.containerAnimationDuration}ms ease, background 0.2s ease;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      padding-bottom: 0px;
      padding-left: 0px;
      z-index: 4;
    `;

    state.pileContainer = document.createElement("div");
    state.pileContainer.id = "zen-dismissed-pile-container";
    state.pileContainer.className = "zen-dismissed-pile";
    
    state.pileContainer.style.cssText = `
      position: relative;
      z-index: 1;
    `;

    // Create floating downloads button
    const downloadsButton = document.createElement("button");
    downloadsButton.id = "zen-pile-downloads-button";
    downloadsButton.innerHTML = "Full list";
    downloadsButton.title = "Open Firefox Downloads";
    downloadsButton.style.cssText = `
      width: 50px;
      height: 20px;
      border: none;
      border-radius: 4px;
      background: var(--zen-primary-color);
      color: light-dark(rgb(255,255,255), rgb(0,0,0));
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease, opacity 0.2s ease;
      opacity: 0;
    `;

    // Add hover effect
    downloadsButton.addEventListener('mouseenter', () => {
      downloadsButton.style.background = 'color-mix(in srgb, var(--zen-primary-color) 80%, transparent)';
    });
    downloadsButton.addEventListener('mouseleave', () => {
      downloadsButton.style.background = 'var(--zen-primary-color)';
    });

    // Add click handler to open downloads
    downloadsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        // Try to open the downloads panel
        if (window.DownloadsPanel) {
          window.DownloadsPanel.showDownloadsHistory();
        } else if (window.PlacesCommandHook) {
          window.PlacesCommandHook.showPlacesOrganizer('Downloads');
        } else {
          // Fallback: open downloads page
          window.openTrustedLinkIn('about:downloads', 'tab');
        }
        debugLog("Opened Firefox downloads");
      } catch (error) {
        debugLog("Error opening downloads:", error);
      }
    });

    // Create clear all downloads button
    const clearAllButton = document.createElement("button");
    clearAllButton.id = "zen-pile-clear-all-button";
    clearAllButton.innerHTML = "Clear all";
    clearAllButton.title = "Clear all Firefox Downloads";
    clearAllButton.style.cssText = `
      width: 50px;
      height: 20px;
      border: none;
      border-radius: 4px;
      background: light-dark(rgba(220, 53, 69, 1), rgb(223, 90, 104));
      color: white;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease, opacity 0.2s ease;
      opacity: 0;
    `;

    // Add hover effect for clear button
    clearAllButton.addEventListener('mouseenter', () => {
      clearAllButton.style.background = 'light-dark(rgb(223, 90, 104), rgba(220, 53, 69, 1))';
    });
    clearAllButton.addEventListener('mouseleave', () => {
      clearAllButton.style.background = 'light-dark(rgba(220, 53, 69, 1), rgb(223, 90, 104))';
    });

    // Add click handler to clear all downloads
    clearAllButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        // Confirm with user before clearing
        if (confirm("Clear all downloads from Firefox history? This action cannot be undone.")) {
          await clearAllDownloads();
          debugLog("Cleared all Firefox downloads");
        }
      } catch (error) {
        debugLog("Error clearing downloads:", error);
      }
    });

    // Create button container for centering
    const buttonContainer = document.createElement("div");
    buttonContainer.id = "zen-pile-button-container";
    buttonContainer.style.cssText = `
      position: absolute;
      top: 5px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 5px;
      z-index: 10;
      margin-top: 30px;
      pointer-events: none;
    `;

    // Enable pointer events for buttons but not container
    downloadsButton.style.pointerEvents = 'auto';
    clearAllButton.style.pointerEvents = 'auto';

    // Add buttons to container
    buttonContainer.appendChild(downloadsButton);
    buttonContainer.appendChild(clearAllButton);

    // Append button container to dynamicSizer
    state.dynamicSizer.appendChild(buttonContainer);

    // Append pileContainer to dynamicSizer
    state.dynamicSizer.appendChild(state.pileContainer);

    // Setup hover events for background/buttons
    setupPileBackgroundHoverEvents();

    // Always append to document.body for maximum z-index control
    document.body.appendChild(state.dynamicSizer);
    debugLog("Created pile container and dynamic sizer, appended to document.body");
  }

  // Setup event listeners
  function setupEventListeners() {
    // Listen for pod dismissals from main script
    window.zenTidyDownloads.onPodDismissed((podData) => {
      debugLog("Received pod dismissal:", podData);
      addPodToPile(podData);
    });

    // Download button hover events
    if (state.downloadButton) {
      state.downloadButton.addEventListener('mouseenter', handleDownloadButtonHover);
      state.downloadButton.addEventListener('mouseleave', handleDownloadButtonLeave);
    }

    // Also listen for hover on the main download cards container area
    const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
    if (mainDownloadContainer) {
      mainDownloadContainer.addEventListener('mouseenter', handleDownloadButtonHover);
      mainDownloadContainer.addEventListener('mouseleave', handleDownloadButtonLeave);
      debugLog("Added hover listeners to main download cards container");
    }

    // Dynamic sizer hover events (keep container open when cursor is inside)
    if (state.dynamicSizer) {
      state.dynamicSizer.addEventListener('mouseenter', handleDynamicSizerHover);
      state.dynamicSizer.addEventListener('mouseleave', handleDynamicSizerLeave);
      debugLog("Added hover listeners to dynamic sizer");
    }

    // Pile container hover events
    state.pileContainer.addEventListener('mouseenter', handlePileHover);
    state.pileContainer.addEventListener('mouseleave', handlePileLeave);

    // Alt key listeners for always-show mode
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Preference change listener
    setupPreferenceListener();

    // Window resize handler
    window.addEventListener('resize', debounce(recalculateLayout, 250));

    // Listen for actual download removals from Firefox list (via main script)
    if (window.zenTidyDownloads && typeof window.zenTidyDownloads.onActualDownloadRemoved === 'function') {
      window.zenTidyDownloads.onActualDownloadRemoved((removedKey) => {
        debugLog(`[PileSync] Received actual download removal notification for key: ${removedKey}`);
        if (state.dismissedPods.has(removedKey)) {
          removePodFromPile(removedKey);
          debugLog(`[PileSync] Removed pod ${removedKey} from pile as it was cleared from Firefox list.`);
        }
      });
      debugLog("[PileSync] Registered listener for actual download removals.");
    } else {
      debugLog("[PileSync] Could not register listener for actual download removals - API not found on main script.");
    }

    // Context menu click-outside handler
    document.addEventListener('click', (e) => {
      if (window.zenPileContextMenu && 
          !window.zenPileContextMenu.contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    debugLog("Event listeners setup complete");
  }

  // Load any existing dismissed pods from main script
  function loadExistingDismissedPods() {
    const existingPods = window.zenTidyDownloads.dismissedPods.getAll();
    existingPods.forEach((podData, key) => {
      addPodToPile(podData, false); // Don't animate existing pods
    });
    debugLog(`Loaded ${existingPods.size} existing dismissed pods`);
    
    // If always-show mode is enabled and we have pods, show the pile
    if (getAlwaysShowPile() && existingPods.size > 0) {
      setTimeout(() => {
        if (shouldPileBeVisible()) {
          showPile();
          debugLog("[AlwaysShow] Showing pile on startup - always-show mode enabled");
        }
      }, 100); // Small delay to ensure DOM is ready
    }
  }

  // Add a pod to the pile
  function addPodToPile(podData, animate = true) {
    if (!podData || !podData.key) {
      debugLog("Invalid pod data for pile addition");
      return;
    }

    // Limit pile size
    if (state.dismissedPods.size >= CONFIG.maxPileSize) {
      const oldestKey = Array.from(state.dismissedPods.keys())[0];
      removePodFromPile(oldestKey);
    }

    // Store pod data
    state.dismissedPods.set(podData.key, podData);

    // Create DOM element
    const podElement = createPodElement(podData);
    state.podElements.set(podData.key, podElement);
    state.pileContainer.appendChild(podElement);

    // Generate pile position
    generatePilePosition(podData.key);

    // Generate grid position
    generateGridPosition(podData.key);

    // Apply initial pile position
    applyPilePosition(podData.key, animate);

    // Update pile visibility
    updatePileVisibility();

    // Update downloads button visibility
    updateDownloadsButtonVisibility();

    // In always-show mode, show the pile immediately when a pod is added
    if (getAlwaysShowPile() && shouldPileBeVisible()) {
      showPile();
    }

    debugLog(`Added pod to pile: ${podData.filename}`);
  }

  // Create a DOM element for a dismissed pod
  function createPodElement(podData) {
    const pod = document.createElement("div");
    pod.className = "dismissed-pod";
    pod.dataset.podKey = podData.key;
    pod.title = `${podData.filename}\nClick: Open file\nMiddle-click: Show in file explorer\nRight-click: Context menu`;
    
    pod.style.cssText = `
      position: absolute;
      width: 45px;
      height: 45px;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform ${CONFIG.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1);
      will-change: transform;
    `;

    // Create preview content
    const preview = document.createElement("div");
    preview.className = "dismissed-pod-preview";
    preview.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2a2a2a;
      color: white;
      font-size: 20px;
    `;

    // Set preview content
    if (podData.previewData) {
      if (podData.previewData.type === 'image' && podData.previewData.src) {
        const img = document.createElement("img");
        img.src = podData.previewData.src;
        img.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
        `;
        img.onerror = () => {
          preview.innerHTML = getFileIcon(podData.contentType);
        };
        preview.appendChild(img);
      } else if (podData.previewData.html) {
        preview.innerHTML = podData.previewData.html;
      } else {
        preview.innerHTML = getFileIcon(podData.contentType);
      }
    } else {
      preview.innerHTML = getFileIcon(podData.contentType);
    }

    pod.appendChild(preview);

    // Add click handler for opening in file explorer
    pod.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      debugLog(`Attempting to open file: ${podData.key}`);
      openPodFile(podData);
    });

    // Add middle-click handler for showing in file explorer
    pod.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        e.stopPropagation();
        debugLog(`Attempting to show file in explorer: ${podData.key}`);
        showPodFileInExplorer(podData);
      }
    });

    // Add right-click handler - use native menupopup
    pod.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ensurePodContextMenu();
      podContextMenuPodData = podData;
      // Open at mouse position
      if (typeof podContextMenu.openPopupAtScreen === 'function') {
        podContextMenu.openPopupAtScreen(e.screenX, e.screenY, true);
      } else {
        // fallback: open at pod
        podContextMenu.openPopup(pod, 'after_start', 0, 0, true, false, e);
      }
    });

    // Add drag-and-drop support for dragging to web pages
    pod.setAttribute('draggable', 'true');
    pod.addEventListener('dragstart', async (e) => {
      // Only allow drag if we have a file path
      if (!podData.targetPath) return;
      // Ensure image (if present) is loaded before allowing drag
      const img = pod.querySelector('img');
      if (img && !img.complete) {
        // Optionally, prevent drag or use a fallback icon
        e.preventDefault();
        debugLog('[DragDrop] Image not loaded, preventing drag for:', podData.filename);
        return;
      }
      // Try to get the file instance
      try {
        const file = await FileSystem.createFileInstance(podData.targetPath);
        if (!file.exists()) return;
        // Set the native file flavor for Firefox
        if (e.dataTransfer && typeof e.dataTransfer.mozSetDataAt === 'function') {
          e.dataTransfer.mozSetDataAt('application/x-moz-file', file, 0);
        }
        // Set URI flavors for web pages
        const fileUrl = file && file.path ?
          (file.path.startsWith('\\') ? 'file:' + file.path.replace(/\\/g, '/') : 'file:///' + file.path.replace(/\\/g, '/'))
          : '';
        if (fileUrl) {
          e.dataTransfer.setData('text/uri-list', fileUrl);
          e.dataTransfer.setData('text/plain', fileUrl);
        }
        // Optionally, set a download URL for HTML5 drop targets
        if (podData.sourceUrl) {
          e.dataTransfer.setData('DownloadURL', `${podData.contentType || 'application/octet-stream'}:${podData.filename}:${podData.sourceUrl}`);
        }
        // Force reflow to ensure the pod is painted
        pod.offsetWidth;
        e.dataTransfer.setDragImage(pod, 22, 22);
      } catch (err) {
        debugLog('[DragDrop] Error during dragstart:', err);
      }
    });

    return pod;
  }

  // Get file icon based on content type
  function getFileIcon(contentType) {
    if (!contentType) return "📄";
    
    if (contentType.includes("image/")) return "🖼️";
    if (contentType.includes("video/")) return "🎬";
    if (contentType.includes("audio/")) return "🎵";
    if (contentType.includes("text/")) return "📝";
    if (contentType.includes("application/pdf")) return "📕";
    if (contentType.includes("application/zip") || contentType.includes("application/x-rar")) return "🗜️";
    if (contentType.includes("application/")) return "📦";
    
    return "📄";
  }

  // Generate random pile position for a pod
  function generatePilePosition(podKey) {
    const angle = (Math.random() - 0.5) * CONFIG.pileRotationRange * 2;
    const offsetX = (Math.random() - 0.5) * CONFIG.pileOffsetRange * 2;
    const offsetY = (Math.random() - 0.5) * CONFIG.pileOffsetRange * 2;
    
    // Newer pods should have higher z-index to appear on top
    // Get the order of this pod in the dismissedPods map (newer = higher index)
    const pods = Array.from(state.dismissedPods.keys());
    const podIndex = pods.indexOf(podKey);
    const zIndex = podIndex + 1; // Start from 1, newer pods get higher z-index

    state.pilePositions.set(podKey, {
      x: offsetX,
      y: offsetY,
      rotation: angle,
      zIndex: zIndex
    });
    
    debugLog(`Generated pile position for ${podKey}:`, {
      index: podIndex,
      zIndex,
      angle,
      offsetX,
      offsetY
    });
  }

  // Generate grid position for a pod
  function generateGridPosition(podKey) {
    const pods = Array.from(state.dismissedPods.keys());
    const index = pods.indexOf(podKey);
    if (index === -1) return;

    // Calculate available width for grid
    const sidebarWidth = parseFloat(state.currentZenSidebarWidthForPile) || 300;
    const availableWidth = sidebarWidth - (CONFIG.minSidePadding * 2);
    
    // Calculate how many pods can fit in a row
    const podAndSpacingWidth = CONFIG.minPodSize + CONFIG.gridPadding;
    const maxCols = Math.floor((availableWidth + CONFIG.gridPadding) / podAndSpacingWidth);
    const cols = Math.max(1, maxCols); // Ensure at least 1 column
    
    const maxRows = 2; // Keep maximum 2 rows
    const col = index % cols;
    const logicalRow = Math.floor(index / cols);
    const visualRow = logicalRow % maxRows;
    
    // Calculate total grid width
    const gridWidth = (cols * CONFIG.minPodSize) + ((cols - 1) * CONFIG.gridPadding);
    
    // Center the grid by calculating left offset
    const leftOffset = (sidebarWidth - gridWidth) / 2;
    
    let x, y;
    if (index === 0) {
      x = leftOffset;
      y = 0;
    } else {
      x = leftOffset + (col * (CONFIG.minPodSize + CONFIG.gridPadding));
      y = visualRow * -(CONFIG.minPodSize + CONFIG.gridPadding);
    }

    state.gridPositions.set(podKey, { x, y, row: logicalRow, col });
    
    debugLog(`Dynamic Grid position for ${podKey}:`, {
      index,
      sidebarWidth,
      availableWidth,
      maxCols,
      cols,
      leftOffset,
      col,
      logicalRow,
      visualRow,
      x,
      y
    });
  }

  // Apply pile position to a pod
  function applyPilePosition(podKey, animate = true) {
    const podElement = state.podElements.get(podKey);
    const position = state.pilePositions.get(podKey);
    if (!podElement || !position) return;

    const transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${position.rotation}deg)`;
    
    if (!animate) {
      podElement.style.transition = 'none';
    }
    
    podElement.style.transform = transform;
    podElement.style.zIndex = position.zIndex;
    
    if (!animate) {
      // Re-enable transitions after position is set
      requestAnimationFrame(() => {
        podElement.style.transition = `transform ${CONFIG.animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      });
    }
  }

  // Apply grid position to a pod
  function applyGridPosition(podKey, delay = 0) {
    const podElement = state.podElements.get(podKey);
    const position = state.gridPositions.get(podKey);
    if (!podElement || !position) return;

    setTimeout(() => {
      const transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(0deg)`;
      podElement.style.transform = transform;
      // z-index is now set before animation starts in transitionToGrid()
    }, delay);
  }

  // Remove a pod from the pile
  function removePodFromPile(podKey) {
    const podElement = state.podElements.get(podKey);
    if (podElement) {
      podElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      podElement.style.opacity = '0';
      podElement.style.transform += ' scale(0.8)';
      
      setTimeout(() => {
        if (podElement.parentNode) {
          podElement.parentNode.removeChild(podElement);
        }
      }, 300);
    }

    state.dismissedPods.delete(podKey);
    state.podElements.delete(podKey);
    state.pilePositions.delete(podKey);
    state.gridPositions.delete(podKey);

    // Recalculate grid positions for remaining pods
    state.dismissedPods.forEach((_, key) => generateGridPosition(key));
    
    // updatePileVisibility will handle sizer height if needed
    updatePileVisibility(); // This will now call showPile/hidePile which adjust sizer

    // Update downloads button visibility
    updateDownloadsButtonVisibility();
  }

  // Update pile visibility based on pod count
  function updatePileVisibility() {
    if (state.dismissedPods.size === 0) {
      // If pile becomes empty, hide it (will set sizer height to 0)
      if (state.dynamicSizer.style.height !== '0px') { // only if not already hidden
          hidePile(); 
      }
    } else {
      // If pile has items, ensure it's "shown" (height will be set)
      // showPile() will be called on hover, this just ensures initial state if pods loaded
      // updatePilePosition(); // This function will be revised/removed
      
      // If pile is currently visible, recalculate height dynamically
      if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
        updatePileHeight();
      }
      
      // Show only the top few pods in pile mode
      let visibleCount = 0;
      const sortedPods = Array.from(state.dismissedPods.keys()).reverse(); // Newest first
      
      sortedPods.forEach(podKey => {
        const podElement = state.podElements.get(podKey);
        if (!podElement) return;
        
        if (visibleCount < CONFIG.pileDisplayCount) {
          podElement.style.display = 'block';
          visibleCount++;
        } else if (!state.isGridMode) {
          podElement.style.display = 'none';
        } else {
          podElement.style.display = 'block'; // Show all in grid mode
        }
      });
      // If it's not already visible (e.g. initial load with pods), and it's supposed to be hovered to show,
      // this function shouldn't force it open. showPile handles that.
      // However, if it *is* already open (sizer height > 0) and a pod is added/removed,
      // we might need to re-evaluate the sizer height if it's dynamic.
      // For now, showPile/hidePile will manage sizer height.
    }
  }

  // Update pile height dynamically based on current pod count
  function updatePileHeight() {
    if (!state.dynamicSizer || state.dismissedPods.size === 0) return;
    
    const cols = 3;
    const podSize = CONFIG.minPodSize;
    const spacing = CONFIG.gridPadding;
    
    // Calculate dynamic height based on number of rows needed
    const totalPods = state.dismissedPods.size;
    const maxPodsToShow = 6; // Show last 6 pods in grid
    const podsToShow = Math.min(totalPods, maxPodsToShow);
    const rowsNeeded = Math.ceil(podsToShow / cols); // How many rows we actually need
    const maxRows = 2; // Maximum rows we support
    const actualRows = Math.min(rowsNeeded, maxRows);
    
    // Calculate height: base height + (rows * pod size) + spacing between rows + extra padding
    const baseHeight = 80; // Base padding
    const rowHeight = podSize + spacing;
    const gridHeight = baseHeight + (actualRows * rowHeight);
    
    debugLog("Updating pile height dynamically", {
      totalPods,
      podsToShow,
      rowsNeeded,
      actualRows,
      oldHeight: state.dynamicSizer.style.height,
      newHeight: `${gridHeight}px`
    });
    
    state.dynamicSizer.style.height = `${gridHeight}px`;
  }

  // Update pile position relative to download button
  function updatePilePosition() {
    // This function is largely obsolete as the pile is now in-flow within dynamicSizer.
    // Width will be handled by updatePileContainerWidth.
    // Height will be handled by showPile/hidePile.
    debugLog("updatePilePosition called, but largely obsolete now.");
    // If dynamicSizer exists and we need to ensure its width is up-to-date:
    if (typeof updatePileContainerWidth === 'function') {
        // updatePileContainerWidth(); // Call this if needed, but it's called on showPile
    }
  }

  // Download button hover handler
  function handleDownloadButtonHover() {
    debugLog("[DownloadHover] handleDownloadButtonHover called", {
      dismissedPodsSize: state.dismissedPods.size,
      shouldDisableHover: shouldDisableHover(),
      alwaysShowMode: getAlwaysShowPile()
    });
    
    if (state.dismissedPods.size === 0) return;
    
    // In always-show mode, don't handle hover events
    if (getAlwaysShowPile()) {
      debugLog("[DownloadHover] Always-show mode enabled - ignoring hover");
      return;
    }
    
    // Check if main download script has active pods and disable hover if so
    if (shouldDisableHover()) {
      debugLog("[HoverDisabled] Pile hover disabled - main download script has active pods");
      return;
    }

    clearTimeout(state.hoverTimeout);
    state.hoverTimeout = setTimeout(() => {
      debugLog("[DownloadHover] Timeout triggered - calling showPile()");
      showPile();
    }, CONFIG.hoverDebounceMs);
  }

  // Download button leave handler
  function handleDownloadButtonLeave() {
    debugLog("[DownloadHover] handleDownloadButtonLeave called");
    
    // In always-show mode, don't handle hover events
    if (getAlwaysShowPile()) {
      debugLog("[DownloadHover] Always-show mode enabled - ignoring leave");
      return;
    }
    
    if (shouldDisableHover()) {
      return; // Don't process leave events if hover is disabled
    }
    
    clearTimeout(state.hoverTimeout);
    state.hoverTimeout = setTimeout(() => {
      const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
      const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
      
      debugLog("[DownloadHover] Leave timeout - checking hover states", {
        isHoveringDownloadArea,
        pileContainerHover: state.pileContainer.matches(':hover'),
        dynamicSizerHover: state.dynamicSizer.matches(':hover')
      });
      
      // Only hide if cursor is not over download area AND not over pile components
      if (!isHoveringDownloadArea && !state.pileContainer.matches(':hover') && !state.dynamicSizer.matches(':hover')) {
        debugLog("[DownloadHover] Calling hidePile()");
        hidePile();
      }
    }, CONFIG.hoverDebounceMs);
  }

  // Dynamic sizer hover handler  
  function handleDynamicSizerHover() {
    debugLog("[SizerHover] handleDynamicSizerHover called");
    if (getAlwaysShowPile()) return;
    clearTimeout(state.hoverTimeout);
    if (state.dismissedPods.size > 0) {
      showPile(); // Ensure pile stays open when hovering the sizer
      if (state.isGridMode) {
        showPileBackground();
      }
    }
  }

  // Dynamic sizer leave handler
  function handleDynamicSizerLeave() {
    debugLog("[SizerHover] handleDynamicSizerLeave called");
    
    clearTimeout(state.hoverTimeout);
    
    // Don't do anything if context menu is visible
    if (isContextMenuVisible()) {
      debugLog("[SizerHover] Context menu visible - deferring pile close");
      state.pendingPileClose = true;
      return;
    }
    
    // Always handle grid-to-pile transition when leaving the container
    // regardless of always-show mode
    if (state.isGridMode) {
      setTimeout(() => {
        // Double-check we're not hovering over pile or sizer and context menu isn't visible
        if (!state.pileContainer.matches(':hover') && !state.dynamicSizer.matches(':hover') && !isContextMenuVisible()) {
          debugLog("[SizerHover] Transitioning back to pile mode from grid");
          transitionToPile();
        }
      }, CONFIG.hoverDebounceMs);
    }
    
    // In always-show mode, don't handle pile visibility, just transitions
    if (getAlwaysShowPile()) {
      debugLog("[SizerHover] Always-show mode - only handling grid transition");
      return;
    }
    
    // Normal mode: handle pile hiding
    state.hoverTimeout = setTimeout(() => {
      const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
      const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
      
      debugLog("[SizerHover] Leave timeout - checking hover states", {
        isHoveringDownloadArea,
        pileContainerHover: state.pileContainer.matches(':hover'),
        contextMenuVisible: isContextMenuVisible()
      });
      
      // Only hide if not hovering download area AND not hovering pile container AND context menu not visible
      if (!isHoveringDownloadArea && !state.pileContainer.matches(':hover')) {
        if (isContextMenuVisible()) {
          debugLog("[SizerHover] Context menu visible at timeout - deferring pile close");
          state.pendingPileClose = true;
        } else {
          debugLog("[SizerHover] Calling hidePile()");
          hidePile();
        }
      }
    }, CONFIG.hoverDebounceMs);
  }

  // Pile hover handler
  function handlePileHover() {
    debugLog("[PileHover] handlePileHover called", {
      isGridMode: state.isGridMode,
      alwaysShowMode: getAlwaysShowPile()
    });
    
    clearTimeout(state.hoverTimeout);
    
    // In pile mode, show background immediately when hovering pile (works in both modes)
    if (!state.isGridMode) {
      debugLog("[PileHover] In pile mode - showing background immediately");
      showPileBackground();
    }
    
    if (!state.isGridMode) {
      debugLog("[PileHover] Not in grid mode - transitioning to grid");
      transitionToGrid();
    }
  }

  // Pile leave handler
  function handlePileLeave() {
    debugLog("[PileHover] handlePileLeave called", {
      alwaysShowMode: getAlwaysShowPile(),
      isGridMode: state.isGridMode,
      contextMenuVisible: isContextMenuVisible()
    });
    
    clearTimeout(state.hoverTimeout);
    
    // Don't do anything if context menu is visible
    if (isContextMenuVisible()) {
      debugLog("[PileHover] Context menu visible - deferring pile close");
      state.pendingPileClose = true;
      return;
    }
    
    // Always handle grid-to-pile transition when leaving the pile
    if (state.isGridMode) {
      setTimeout(() => {
        // Only transition back if we're not hovering over the sizer and context menu isn't visible
        if (!state.dynamicSizer.matches(':hover') && !isContextMenuVisible()) {
          debugLog("[PileHover] Transitioning back to pile mode from grid");
          transitionToPile();
        }
      }, CONFIG.hoverDebounceMs);
    }
    
    // In always-show mode, don't hide the pile itself, transitions are handled above
    if (getAlwaysShowPile()) {
      debugLog("[PileHover] Always-show mode - only handling grid transition");
      return;
    }
    
    // Normal mode: handle pile hiding
    state.hoverTimeout = setTimeout(() => {
      const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
      const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
      
      debugLog("[PileHover] Leave timeout - checking hover states", {
        isHoveringDownloadArea,
        dynamicSizerHover: state.dynamicSizer.matches(':hover'),
        contextMenuVisible: isContextMenuVisible()
      });
      
      // Only hide if not hovering download area AND not hovering dynamic sizer AND context menu not visible
      if (!isHoveringDownloadArea && !state.dynamicSizer.matches(':hover')) {
        if (isContextMenuVisible()) {
          debugLog("[PileHover] Context menu visible at timeout - deferring pile close");
          state.pendingPileClose = true;
        } else {
          debugLog("[PileHover] Calling hidePile()");
          hidePile();
        }
      }
    }, CONFIG.hoverDebounceMs);
  }

  // Show the pile
  function showPile() {
    debugLog("[ShowPile] showPile called", {
      dismissedPodsSize: state.dismissedPods.size,
      currentHeight: state.dynamicSizer?.style.height,
      isGridMode: state.isGridMode,
      alwaysShowMode: getAlwaysShowPile()
    });
    
    if (state.dismissedPods.size === 0 || !state.dynamicSizer) return;
    
    // Ensure width is set before calculating positions
    if (typeof updatePileContainerWidth === 'function') {
        updatePileContainerWidth();
    }

    // Calculate exact position based on sidebar location
    const navigatorToolbox = document.getElementById('navigator-toolbox');
    if (navigatorToolbox) {
      const rect = navigatorToolbox.getBoundingClientRect();
      const isRightSide = document.documentElement.getAttribute('zen-right-side') === 'true';
      
      if (isRightSide) {
        // Position on the right side
        const containerWidth = parseFloat(state.currentZenSidebarWidthForPile) || 300;
        state.dynamicSizer.style.left = `${rect.right - containerWidth}px`;
      } else {
        // Position on the left side
        state.dynamicSizer.style.left = `${rect.left}px`;
      }
      
      debugLog("Positioned pile based on sidebar location", {
        sidebarRect: rect,
        isRightSide,
        finalLeft: state.dynamicSizer.style.left
      });
    }

    // Calculate smart left padding so the GRID will be centered when it forms
    const containerWidth = parseFloat(state.currentZenSidebarWidthForPile) || 300;
    const cols = 3;
    const podSize = CONFIG.minPodSize;
    const spacing = CONFIG.gridPadding;
    
    // Calculate total grid dimensions
    const gridWidth = (cols * podSize) + ((cols - 1) * spacing);
    
    // Calculate where the grid should be positioned to be centered
    const gridCenterX = containerWidth / 2;
    const gridLeftEdge = gridCenterX - (gridWidth / 2);
    
    // The first pod (index 0) will be at the bottom-left of the grid
    // So position the pile so the first pod ends up at the grid's left edge
    // Divide by 4 to correct for excessive padding
    
    // Set pointer-events based on mode and state
    updatePointerEvents();
    
    state.dynamicSizer.style.paddingBottom = '60px';
    state.dynamicSizer.style.paddingLeft = `5px`;
    
    // Calculate dynamic height based on number of rows needed
    const totalPods = state.dismissedPods.size;
    const maxPodsToShow = 6; // Show last 6 pods in grid
    const podsToShow = Math.min(totalPods, maxPodsToShow);
    const rowsNeeded = Math.ceil(podsToShow / cols); // How many rows we actually need
    const maxRows = 2; // Maximum rows we support
    const actualRows = Math.min(rowsNeeded, maxRows);
    
    // Calculate height: base height + (rows * pod size) + spacing between rows + extra padding
    const baseHeight = 80; // Base padding
    const rowHeight = podSize + spacing;
    const gridHeight = baseHeight + (actualRows * rowHeight);
    
    debugLog("Dynamic height calculation", {
      totalPods,
      podsToShow,
      rowsNeeded,
      actualRows,
      podSize,
      spacing,
      calculatedHeight: gridHeight
    });
    
    state.dynamicSizer.style.height = `${gridHeight}px`; 
    
    // Ensure hover events are properly set up for the current mode
    // This is important after the pile was hidden and is being shown again
    setTimeout(() => {
      setupPileBackgroundHoverEvents();
      debugLog("[ShowPile] Hover events re-setup after pile shown");
    }, 50); // Small delay to ensure DOM is updated
    
    debugLog("Showing pile positioned for centered grid", {
      containerWidth,
      gridWidth,
      gridCenterX,
      gridLeftEdge,
      dynamicHeight: gridHeight,
      note: "First pod will be at grid's left edge, height adjusts to content"
    });
  }

  // Hide the pile
  function hidePile() {
    debugLog("[HidePile] hidePile called", {
      currentHeight: state.dynamicSizer?.style.height,
      isGridMode: state.isGridMode
    });
    
    if (!state.dynamicSizer) return;

    state.dynamicSizer.style.pointerEvents = 'none';
    state.dynamicSizer.style.height = '0px';
    state.dynamicSizer.style.paddingBottom = '0px'; // Remove padding when hiding
    state.dynamicSizer.style.paddingLeft = '0px'; // Remove left padding when hiding
    
    // Hide background and buttons when hiding pile
    hidePileBackground();
    
    if (state.isGridMode) {
      transitionToPile(); // Transition back to pile state if in grid
    }
    
    debugLog("Hiding dismissed downloads pile by collapsing sizer");
  }

  // Transition from pile to grid
  function transitionToGrid() {
    if (state.isGridMode) return;
    
    state.isGridMode = true;
    debugLog("Transitioning to grid mode");
    
    // --- Initialize visibleGridOrder as a carousel ---
    const allPods = Array.from(state.dismissedPods.keys()).reverse(); // Most recent first
    state.carouselStartIndex = 0;
    if (allPods.length <= 6) {
      state.visibleGridOrder = allPods.slice();
    } else {
      state.visibleGridOrder = [];
      for (let i = 0; i < 6; i++) {
        state.visibleGridOrder.push(allPods[(state.carouselStartIndex + i) % allPods.length]);
      }
    }
    state.gridScrollIndex = 0;
    state.isGridAnimating = false;
    
    // Show buttons immediately when transitioning to grid mode
    const buttonContainer = document.getElementById("zen-pile-button-container");
    const downloadsButton = document.getElementById("zen-pile-downloads-button");
    const clearAllButton = document.getElementById("zen-pile-clear-all-button");
    if (downloadsButton) downloadsButton.style.opacity = '1';
    if (clearAllButton) clearAllButton.style.opacity = '1';
    if (buttonContainer) buttonContainer.style.pointerEvents = 'auto';
    if (downloadsButton) downloadsButton.style.pointerEvents = 'auto';
    if (clearAllButton) clearAllButton.style.pointerEvents = 'auto';
    
    // Update hover events for grid mode
    setupPileBackgroundHoverEvents();
    
    // Update pointer events for grid mode
    updatePointerEvents();

    // --- Mouse wheel event for scrolling grid ---
    if (state.pileContainer._zenGridScrollHandler) {
      state.pileContainer.removeEventListener('wheel', state.pileContainer._zenGridScrollHandler);
      delete state.pileContainer._zenGridScrollHandler;
    }
    if (allPods.length >= 6) {
      state.pileContainer._zenGridScrollHandler = function(e) {
        if (!state.isGridMode) return;
        if (state.isGridAnimating) return;
        e.preventDefault();
        const allPods = Array.from(state.dismissedPods.keys()).reverse(); // Most recent first
        if (allPods.length < 6) return;
        let delta = e.deltaY || e.detail || e.wheelDelta;
        state.isGridAnimating = true;
        setTimeout(() => { state.isGridAnimating = false; }, 400);
        if (allPods.length === 6) {
          // Simple rotation for exactly 6
          if (delta < 0) {
            state.visibleGridOrder.push(state.visibleGridOrder.shift());
            renderGridWindow('forward');
          } else if (delta > 0) {
            state.visibleGridOrder.unshift(state.visibleGridOrder.pop());
            renderGridWindow('backward');
          }
        } else {
          // Carousel window for more than 6
          if (delta < 0) {
            state.carouselStartIndex = (state.carouselStartIndex + 1) % allPods.length;
          } else if (delta > 0) {
            state.carouselStartIndex = (state.carouselStartIndex - 1 + allPods.length) % allPods.length;
          }
          // Update visibleGridOrder to next 6 pods
          state.visibleGridOrder = [];
          for (let i = 0; i < 6; i++) {
            state.visibleGridOrder.push(allPods[(state.carouselStartIndex + i) % allPods.length]);
          }
          renderGridWindow(delta < 0 ? 'forward' : 'backward');
        }
      };
      state.pileContainer.addEventListener('wheel', state.pileContainer._zenGridScrollHandler, { passive: false });
    }

    renderGridWindow();
  }

  // --- Helper to render the current grid window ---
  function renderGridWindow(scrollDir = null) {
    const allPods = Array.from(state.dismissedPods.keys()).reverse(); // Most recent first
    const total = allPods.length;
    if (total === 0) return;
    // Use visibleGridOrder for carousel
    if (!state.visibleGridOrder || state.visibleGridOrder.length !== Math.min(6, total)) {
      if (total <= 6) {
        state.visibleGridOrder = allPods.slice();
      } else {
        state.visibleGridOrder = [];
        for (let i = 0; i < 6; i++) {
          state.visibleGridOrder.push(allPods[(state.carouselStartIndex + i) % total]);
        }
      }
    }
    const gridPods = state.visibleGridOrder;
    debugLog(`[GridScroll] Carousel order:`, gridPods);

    // Track which pods are entering/leaving for animation
    if (!state._lastGridPods) state._lastGridPods = [];
    const lastSet = new Set(state._lastGridPods);
    const currentSet = new Set(gridPods);
    const entering = gridPods.filter(k => !lastSet.has(k));
    const leaving = state._lastGridPods ? state._lastGridPods.filter(k => !currentSet.has(k)) : [];

    // Calculate new grid positions
    const newPositions = new Map();
    gridPods.forEach((podKey, index) => {
      const cols = 3;
      const maxRows = 2;
      const col = index % cols;
      const logicalRow = Math.floor(index / cols);
      const visualRow = logicalRow % maxRows;
      const podSize = CONFIG.minPodSize;
      const spacing = CONFIG.gridPadding;
      let x, y;
      if (index === 0) {
        x = 0;
        y = 0;
      } else {
        x = col * (podSize + spacing);
        y = -visualRow * (podSize + spacing);
      }
      newPositions.set(podKey, { x, y });
      state.gridPositions.set(podKey, { x, y, row: logicalRow, col });
    });

    // Animate pods to new positions
    gridPods.forEach((podKey, idx) => {
      const podElement = state.podElements.get(podKey);
      if (!podElement) return;
      podElement.style.display = 'block';
      podElement.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.2,1)';
      let prev = state._prevGridPositions.get(podKey);
      let next = newPositions.get(podKey);
      if (entering.includes(podKey)) {
        // Animate from top left
        podElement.style.transform = `translate3d(0px, 0px, 0) rotate(0deg)`;
        // Force reflow
        void podElement.offsetWidth;
        podElement.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) rotate(0deg)`;
      } else if (prev) {
        // Animate from previous position
        podElement.style.transform = `translate3d(${prev.x}px, ${prev.y}px, 0) rotate(0deg)`;
        // Force reflow
        void podElement.offsetWidth;
        podElement.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) rotate(0deg)`;
      } else {
        // No previous, just set
        podElement.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) rotate(0deg)`;
      }
    });

    // Hide all non-visible pods in grid mode
    state.dismissedPods.forEach((_, podKey) => {
      if (!gridPods.includes(podKey)) {
        const podElement = state.podElements.get(podKey);
        if (podElement) podElement.style.display = 'none';
      }
    });

    // Animate out leaving pods
    leaving.forEach((podKey) => {
      const podElement = state.podElements.get(podKey);
      if (!podElement) return;
      podElement.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.4s cubic-bezier(0.4,0,0.2,1)';
      // Move out to the right or left depending on scrollDir
      let prev = state._prevGridPositions.get(podKey);
      let outX = (scrollDir === 'forward') ? 60 : -60;
      if (prev) {
        podElement.style.transform = `translate3d(${prev.x}px, ${prev.y}px, 0) rotate(0deg)`;
        // Force reflow
        void podElement.offsetWidth;
        podElement.style.transform = `translate3d(${prev.x + outX}px, ${prev.y}px, 0) rotate(0deg)`;
      } else {
        podElement.style.transform = `translate3d(${outX}px, 0px, 0) rotate(0deg)`;
      }
      podElement.style.opacity = '0';
      setTimeout(() => {
        podElement.style.display = 'none';
        podElement.style.opacity = '1';
      }, 400);
    });

    // Save new positions for next diff
    state._prevGridPositions = newPositions;
    // Save for next diff
    state._lastGridPods = gridPods;
  }

  // Transition from grid to pile
  function transitionToPile() {
    if (!state.isGridMode) return;
    state.isGridMode = false;
    debugLog("Transitioning to pile mode");
    
    // Hide buttons when transitioning to pile mode
    const buttonContainer = document.getElementById("zen-pile-button-container");
    const downloadsButton = document.getElementById("zen-pile-downloads-button");
    const clearAllButton = document.getElementById("zen-pile-clear-all-button");
    if (downloadsButton) downloadsButton.style.opacity = '0';
    if (clearAllButton) clearAllButton.style.opacity = '0';
    if (buttonContainer) buttonContainer.style.pointerEvents = 'none';
    if (downloadsButton) downloadsButton.style.pointerEvents = 'none';
    if (clearAllButton) clearAllButton.style.pointerEvents = 'none';
    
    // Remove wheel event
    if (state.pileContainer._zenGridScrollHandler) {
      state.pileContainer.removeEventListener('wheel', state.pileContainer._zenGridScrollHandler);
      delete state.pileContainer._zenGridScrollHandler;
    }
    // Update hover events for pile mode
    setupPileBackgroundHoverEvents();
    
    // Update pointer events for pile mode
    updatePointerEvents();

    // No need to change justify-content - positioning handled by padding

    // Animate pods back to pile positions
    state.dismissedPods.forEach((_, podKey) => {
      applyPilePosition(podKey, true);
    });

    // Hide excess pods after animation
    setTimeout(() => {
      updatePileVisibility();
    }, CONFIG.animationDuration);
  }

  // Recalculate layout on window resize
  function recalculateLayout() {
    if (state.dismissedPods.size === 0) return;

    // Regenerate grid positions
    state.dismissedPods.forEach((_, podKey) => {
      generateGridPosition(podKey);
    });

    // Recalculate fixed position if pile is currently shown
    if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
      const navigatorToolbox = document.getElementById('navigator-toolbox');
      if (navigatorToolbox) {
        const rect = navigatorToolbox.getBoundingClientRect();
        const isRightSide = document.documentElement.getAttribute('zen-right-side') === 'true';
        
        if (isRightSide) {
          const containerWidth = parseFloat(state.currentZenSidebarWidthForPile) || 300;
          state.dynamicSizer.style.left = `${rect.right - containerWidth}px`;
        } else {
          state.dynamicSizer.style.left = `${rect.left}px`;
        }
        
        debugLog("Recalculated pile position on resize", {
          newLeft: state.dynamicSizer.style.left
        });
      }
    }

    // Apply current mode positions
    if (state.isGridMode) {
      state.dismissedPods.forEach((_, podKey) => {
        applyGridPosition(podKey, 0);
      });
    }
  }

  // Utility: Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // --- Pile Container Width Synchronization Logic ---
  function updatePileContainerWidth() {
    if (!state.dynamicSizer) {
      debugLog('[PileWidthSync] dynamicSizer not found. Cannot set width.');
      return;
    }

    const navigatorToolbox = document.getElementById('navigator-toolbox');
    let newWidth = '';

    if (navigatorToolbox) {
      const value = getComputedStyle(navigatorToolbox).getPropertyValue('--zen-sidebar-width').trim();
      if (value && value !== "0px" && value !== "") {
        newWidth = value;
        debugLog('[PileWidthSync] Using --zen-sidebar-width from #navigator-toolbox:', newWidth);
      }
    }

    if (!newWidth) {
      const sidebarBox = document.getElementById('sidebar-box');
      if (sidebarBox && sidebarBox.clientWidth > 0) {
        newWidth = `${sidebarBox.clientWidth}px`;
        debugLog('[PileWidthSync] Using #sidebar-box.clientWidth as fallback:', newWidth);
      } else {
        newWidth = '300px'; // Last resort default
        debugLog('[PileWidthSync] Using default width (300px) as final fallback.');
      }
    }

    // Update the global variable and set the width (not max-width since we're fixed positioned)
    state.currentZenSidebarWidthForPile = newWidth;
    
    // Subtract 5px to prevent protruding beyond sidebar
    const numericWidth = parseFloat(newWidth);
    const adjustedWidth = `${numericWidth + 5}px`;
    state.dynamicSizer.style.width = adjustedWidth;
    debugLog('[PileWidthSync] Set dynamicSizer width to:', adjustedWidth, '(original:', newWidth, ')');
  }

  function initPileSidebarWidthSync() {
    // This function is now unused - width is only read on-demand in showPile()
    debugLog('[PileWidthSync] initPileSidebarWidthSync called but automatic sync is disabled to prevent feedback loops.');
  }
  // --- End Pile Container Width Synchronization Logic ---

  // Helper function to capture pod data for dismissal
  function capturePodDataForDismissal(downloadKey) {
    const cardData = activeDownloadCards.get(downloadKey);
    if (!cardData || !cardData.download) {
      debugLog(`[Dismiss] No card data found for capturing: ${downloadKey}`);
      return null;
    }
    
    const download = cardData.download;
    const podElement = cardData.podElement;
    
    // Capture essential data for pile reconstruction
    const dismissedData = {
      key: downloadKey,
      filename: download.aiName || cardData.originalFilename || getSafeFilename(download),
      originalFilename: cardData.originalFilename,
      fileSize: download.currentBytes || download.totalBytes || 0,
      contentType: download.contentType,
      targetPath: download.target?.path,
      sourceUrl: download.source?.url,
      startTime: download.startTime,
      endTime: download.endTime,
      dismissTime: Date.now(),
      wasRenamed: !!download.aiName,
      // Capture preview data
      previewData: null,
      dominantColor: podElement?.dataset?.dominantColor || null
    };
    
    // Try to capture preview image data
    if (podElement) {
      const previewContainer = podElement.querySelector('.card-preview-container');
      if (previewContainer) {
        const img = previewContainer.querySelector('img');
        if (img && img.src) {
          dismissedData.previewData = {
            type: 'image',
            src: img.src
          };
        } else {
          // Capture icon/text preview
          dismissedData.previewData = {
            type: 'icon',
            html: previewContainer.innerHTML
          };
        }
      }
    }
    
    debugLog(`[Dismiss] Captured pod data for pile:`, dismissedData);
    return dismissedData;
  }

  // Update downloads button visibility - now handled by hover events
  function updateDownloadsButtonVisibility() {
    // Buttons are now controlled by hover events in showPileBackground/hidePileBackground
    // This function is kept for compatibility but doesn't change visibility
    debugLog(`[DownloadsButton] Button visibility managed by hover - ${state.dismissedPods.size} dismissed pods`);
  }

  // Function to remove a specific download from Firefox downloads list
  async function removeDownloadFromFirefoxList(podData) {
    try {
      debugLog(`[DeleteDownload] Attempting to remove download from Firefox list: ${podData.filename}`);
      
      // Get the downloads list
      const list = await window.Downloads.getList(window.Downloads.ALL);
      const downloads = await list.getAll();
      
      // Find the download that matches our pod data
      let targetDownload = null;
      
      for (const download of downloads) {
        // Try to match by target path (most reliable)
        if (podData.targetPath && download.target?.path === podData.targetPath) {
          targetDownload = download;
          debugLog(`[DeleteDownload] Found download by target path: ${download.target.path}`);
          break;
        }
        
        // Fallback: try to match by source URL and filename
        if (podData.sourceUrl && download.source?.url === podData.sourceUrl) {
          // Additional check for filename if available
          const downloadFilename = download.target?.path ? 
            download.target.path.split(/[/\\]/).pop() : null;
          
          if (!downloadFilename || downloadFilename === podData.filename || 
              downloadFilename === podData.originalFilename) {
            targetDownload = download;
            debugLog(`[DeleteDownload] Found download by source URL: ${download.source.url}`);
            break;
          }
        }
      }
      
      if (targetDownload) {
        // Remove the download from Firefox's list
        await list.remove(targetDownload);
        debugLog(`[DeleteDownload] Successfully removed download from Firefox list: ${podData.filename}`);
        return true;
      } else {
        debugLog(`[DeleteDownload] Download not found in Firefox list: ${podData.filename}`);
        return false;
      }
      
    } catch (error) {
      debugLog(`[DeleteDownload] Error removing download from Firefox list:`, error);
      throw error;
    }
  }

  // Function to clear all downloads from Firefox
  async function clearAllDownloads() {
    try {
      debugLog("[ClearAll] Starting to clear all downloads from Firefox");
      
      // Get the downloads list
      const list = await window.Downloads.getList(window.Downloads.ALL);
      const downloads = await list.getAll();
      
      debugLog(`[ClearAll] Found ${downloads.length} downloads to clear`);
      
      // Remove all downloads from the list
      for (const download of downloads) {
        try {
          await list.remove(download);
          debugLog(`[ClearAll] Removed download: ${download.target?.path || download.source?.url}`);
        } catch (error) {
          debugLog(`[ClearAll] Error removing individual download:`, error);
        }
      }
      
      // Clear the dismissed pile as well since all downloads are gone
      state.dismissedPods.clear();
      updatePileVisibility();
      updateDownloadsButtonVisibility();
      
      debugLog("[ClearAll] Successfully cleared all downloads and pile");
      
    } catch (error) {
      debugLog("[ClearAll] Error clearing downloads:", error);
      throw error;
    }
  }

  // Check if main download script has active pods to disable hover
  function shouldDisableHover() {
    try {
      // Check for visible download pods within the dedicated container
      const podsRowContainer = document.getElementById('userchrome-pods-row-container');
      if (podsRowContainer) {
        // Check if there are any child elements that are download pods
        const activePods = podsRowContainer.querySelectorAll('.download-pod');
        if (activePods.length > 0) {
          debugLog(`[HoverCheck] Found ${activePods.length} active pods in #userchrome-pods-row-container - disabling pile hover`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      debugLog(`[HoverCheck] Error checking main script state:`, error);
      return false;
    }
  }

  // Show pile background and buttons on hover
  function showPileBackground() {
    if (!state.dynamicSizer) {
      return;
    }
    state.dynamicSizer.style.background = 'color-mix(in srgb, var(--zen-primary-color) 10%, transparent)';
    const buttonContainer = document.getElementById("zen-pile-button-container");
    const downloadsButton = document.getElementById("zen-pile-downloads-button");
    const clearAllButton = document.getElementById("zen-pile-clear-all-button");
    if (state.isGridMode) {
      if (downloadsButton) downloadsButton.style.opacity = '1';
      if (clearAllButton) clearAllButton.style.opacity = '1';
      if (buttonContainer) buttonContainer.style.pointerEvents = 'auto';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'auto';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'auto';
    } else {
      if (downloadsButton) downloadsButton.style.opacity = '0';
      if (clearAllButton) clearAllButton.style.opacity = '0';
      if (buttonContainer) buttonContainer.style.pointerEvents = 'none';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'none';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'none';
    }
  }

  // Hide pile background and buttons when not hovering
  function hidePileBackground() {
    if (!state.dynamicSizer) {
      return;
    }
    if (state.isTransitioning) {
      return;
    }
    state.dynamicSizer.style.background = 'transparent';
    const buttonContainer = document.getElementById("zen-pile-button-container");
    const downloadsButton = document.getElementById("zen-pile-downloads-button");
    const clearAllButton = document.getElementById("zen-pile-clear-all-button");
    
    // In grid mode, keep buttons visible even when not hovering
    if (state.isGridMode) {
      if (downloadsButton) downloadsButton.style.opacity = '1';
      if (clearAllButton) clearAllButton.style.opacity = '1';
      if (buttonContainer) buttonContainer.style.pointerEvents = 'auto';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'auto';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'auto';
    } else {
      // In pile mode, hide buttons when not hovering
      if (downloadsButton) downloadsButton.style.opacity = '0';
      if (clearAllButton) clearAllButton.style.opacity = '0';
      if (buttonContainer) buttonContainer.style.pointerEvents = 'none';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'none';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'none';
    }
  }

  // Setup hover events for background/buttons based on current mode
  function setupPileBackgroundHoverEvents() {
    if (!state.dynamicSizer || !state.pileContainer) {
      // debugLog("[PileHover] setupPileBackgroundHoverEvents: Missing elements", {
      //   dynamicSizer: !!state.dynamicSizer,
      //   pileContainer: !!state.pileContainer
      // });
      return;
    }
    
    // debugLog("[PileHover] setupPileBackgroundHoverEvents called", {
    //   isGridMode: state.isGridMode,
    //   containerHoverEventsAttached: state.containerHoverEventsAttached,
    //   pileHoverEventsAttached: state.pileHoverEventsAttached
    // });
    
    // Set transition flag to prevent hiding during event switching
    state.isTransitioning = true;
    
    // Remove existing hover events first
    if (state.containerHoverEventsAttached) {
      state.dynamicSizer.removeEventListener('mouseenter', showPileBackground); // REMOVE THIS
      state.dynamicSizer.removeEventListener('mouseleave', hidePileBackground); // REMOVE THIS
      state.containerHoverEventsAttached = false;
      // debugLog("[PileHover] Removed container hover events");
    }
    
    if (state.pileHoverEventsAttached) {
      state.pileContainer.removeEventListener('mouseenter', showPileBackground); // REMOVE THIS
      state.pileContainer.removeEventListener('mouseleave', hidePileBackground); // REMOVE THIS
      state.pileHoverEventsAttached = false;
      // debugLog("[PileHover] Removed pile hover events");
    }
    
    // Add appropriate hover events based on mode
    if (state.isGridMode) {
      // In grid mode: hover over entire container should trigger show/hide pile
      // The actual showing/hiding of background/buttons is handled by showPile/hidePile
      state.dynamicSizer.addEventListener('mouseenter', handleDynamicSizerHover); // Changed to handleDynamicSizerHover
      state.dynamicSizer.addEventListener('mouseleave', handleDynamicSizerLeave); // Changed to handleDynamicSizerLeave
      state.containerHoverEventsAttached = true;
      // debugLog("[PileHover] Grid mode: Added hover events to container");
    } else {
      // In pile mode: only hover over actual pile should trigger show/hide pile
      // The actual showing/hiding of background/buttons is handled by showPile/hidePile
      state.pileContainer.addEventListener('mouseenter', handlePileHover); // Changed to handlePileHover
      state.pileContainer.addEventListener('mouseleave', handlePileLeave); // Changed to handlePileLeave
      state.pileHoverEventsAttached = true;
      // debugLog("[PileHover] Pile mode: Added hover events to pile only");
    }
    
    // Clear transition flag after a brief delay to allow events to settle
    setTimeout(() => {
      state.isTransitioning = false;
      // debugLog("[PileHover] Transition flag cleared - hover events stable");
    }, 100);
  }

  // Alt key handlers for always-show mode
  function handleKeyDown(event) {
    if (event.key === 'Alt' && !state.isAltPressed) {
      state.isAltPressed = true;
      debugLog("[AlwaysShow] Alt key pressed");
      
      if (getAlwaysShowPile() && state.dismissedPods.size > 0) {
        // Hide pile when Alt is pressed in always-show mode
        hidePile();
      }
    }
  }

  function handleKeyUp(event) {
    if (event.key === 'Alt' && state.isAltPressed) {
      state.isAltPressed = false;
      debugLog("[AlwaysShow] Alt key released");
      
      if (getAlwaysShowPile() && state.dismissedPods.size > 0) {
        // Show pile again when Alt is released in always-show mode
        showPile();
      }
    }
  }

  // Check if pile should be visible based on always-show mode and Alt key state
  function shouldPileBeVisible() {
    if (state.dismissedPods.size === 0) return false;
    
    if (getAlwaysShowPile()) {
      // In always-show mode: visible unless Alt is pressed
      return !state.isAltPressed;
    } else {
      // Normal hover mode: only visible when hovering
      return false; // This will be overridden by hover handlers
    }
  }

  // Get preference values with defaults
  function getAlwaysShowPile() {
    try {
      return Services.prefs.getBoolPref(PREFS.alwaysShowPile, false);
    } catch (e) {
      debugLog("Error reading always-show-pile preference, using default (false):", e);
      return false;
    }
  }

  // Setup preference change listener
  function setupPreferenceListener() {
    try {
      const prefObserver = {
        observe: function(subject, topic, data) {
          if (topic === 'nsPref:changed' && data === PREFS.alwaysShowPile) {
            const newValue = getAlwaysShowPile();
            debugLog(`[Preferences] Always-show-pile preference changed to: ${newValue}`);
            handleAlwaysShowPileChange(newValue);
          }
        }
      };

      Services.prefs.addObserver(PREFS.alwaysShowPile, prefObserver, false);
      debugLog("[Preferences] Added observer for always-show-pile preference");

      // Store observer for cleanup
      state.prefObserver = prefObserver;
    } catch (e) {
      debugLog("[Preferences] Error setting up preference observer:", e);
    }
  }

  // Handle preference change
  function handleAlwaysShowPileChange(newValue) {
    debugLog(`[Preferences] Handling always-show-pile change to: ${newValue}`);
    
    if (state.dismissedPods.size === 0) {
      debugLog("[Preferences] No dismissed pods, nothing to do");
      return;
    }

    if (newValue) {
      // Switched to always-show mode
      if (shouldPileBeVisible()) {
        showPile();
        debugLog("[Preferences] Switched to always-show mode - showing pile");
      }
    } else {
      // Switched to hover mode
      if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
        // If pile is currently visible, hide it (it will show again on hover)
        hidePile();
        debugLog("[Preferences] Switched to hover mode - hiding pile");
      }
    }
  }

  // Update pointer-events based on current state and mode
  function updatePointerEvents() {
    if (!state.dynamicSizer || !state.pileContainer) return;
    const alwaysShow = getAlwaysShowPile();
    const isPileVisible = state.dynamicSizer.style.height !== '0px';
    const buttonContainer = document.getElementById("zen-pile-button-container");
    const downloadsButton = document.getElementById("zen-pile-downloads-button");
    const clearAllButton = document.getElementById("zen-pile-clear-all-button");
    if (state.isGridMode && isPileVisible) {
      if (buttonContainer) buttonContainer.style.pointerEvents = 'auto';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'auto';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'auto';
    } else {
      if (buttonContainer) buttonContainer.style.pointerEvents = 'none';
      if (downloadsButton) downloadsButton.style.pointerEvents = 'none';
      if (clearAllButton) clearAllButton.style.pointerEvents = 'none';
    }
    if (alwaysShow && !state.isGridMode) {
      state.dynamicSizer.style.pointerEvents = 'none';
      state.pileContainer.style.pointerEvents = 'auto';
    } else {
      state.dynamicSizer.style.pointerEvents = 'auto';
      state.pileContainer.style.pointerEvents = 'auto';
    }
  }

  // --- Native XUL menupopup for pod context menu ---
  const podContextMenuFragment = window.MozXULElement.parseXULToFragment(`
    <menupopup id="zen-pile-pod-context-menu">
      <menuitem id="zenPilePodOpen" label="Open"/>
      <menuitem id="zenPilePodRename" label="Rename"/>
      <menuitem id="zenPilePodRemove" label="Remove from Stuff"/>
      <menuitem id="zenPilePodCopy" label="Copy to Clipboard"/>
    </menupopup>
  `);
  let podContextMenu = null;
  let podContextMenuPodData = null;

  function ensurePodContextMenu() {
    if (!podContextMenu) {
      const frag = podContextMenuFragment.cloneNode(true);
      podContextMenu = frag.firstElementChild;
      document.getElementById("mainPopupSet")?.appendChild(podContextMenu) || document.body.appendChild(podContextMenu);
      // Open
      podContextMenu.querySelector("#zenPilePodOpen").addEventListener("command", () => {
        if (podContextMenuPodData) openPodFile(podContextMenuPodData);
      });
      // Rename
      podContextMenu.querySelector("#zenPilePodRename").addEventListener("command", () => {
        if (podContextMenuPodData) showRenameDialog(podContextMenuPodData);
      });
      // Remove from Stuff
      podContextMenu.querySelector("#zenPilePodRemove").addEventListener("command", async () => {
        if (podContextMenuPodData) {
          try {
            window.zenTidyDownloads.permanentDelete(podContextMenuPodData.key);
            removePodFromPile(podContextMenuPodData.key);
            // --- Update carousel/grid after removal ---
            const allPods = Array.from(state.dismissedPods.keys()).reverse(); // Most recent first
            if (allPods.length < 6) {
              state.carouselStartIndex = 0;
              state.visibleGridOrder = allPods.slice();
            } else {
              // If carouselStartIndex is out of bounds, reset
              if (state.carouselStartIndex >= allPods.length) {
                state.carouselStartIndex = 0;
              }
              state.visibleGridOrder = [];
              for (let i = 0; i < 6; i++) {
                state.visibleGridOrder.push(allPods[(state.carouselStartIndex + i) % allPods.length]);
              }
            }
            renderGridWindow();
            // Immediately hide all non-visible pods after removal
            state.dismissedPods.forEach((_, podKey) => {
              if (!state.visibleGridOrder.includes(podKey)) {
                const podElement = state.podElements.get(podKey);
                if (podElement) podElement.style.display = 'none';
              }
            });
          } catch (err) {
            showUserNotification(`Error removing pod: ${err.message}`);
          }
        }
      });

      // Add the popuphidden event listener here, after podContextMenu is created
      podContextMenu.addEventListener("popuphidden", () => {
        setTimeout(() => {
          const isHoveringPile = state.pileContainer?.matches(':hover');
          const isHoveringSizer = state.dynamicSizer?.matches(':hover');
          const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
          const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
          if (!isHoveringPile && !isHoveringSizer && !isHoveringDownloadArea) {
            if (state.isGridMode) {
              transitionToPile();
            }
            if (!getAlwaysShowPile()) {
              // --- handle pending pile close ---
              if (state.pendingPileClose) {
                debugLog('[ContextMenu] popuphidden: pendingPileClose was set, closing pile now');
                hidePile();
                state.pendingPileClose = false;
              } else {
                hidePile();
              }
            }
          } else {
            // If still hovering, just clear the flag
            state.pendingPileClose = false;
          }
        }, 100);
      });

      // Copy to Clipboard
      podContextMenu.querySelector("#zenPilePodCopy").addEventListener("command", async () => {
        if (podContextMenuPodData) {
          try {
            await copyPodFileToClipboard(podContextMenuPodData);
          } catch (err) {
            showUserNotification(`Error copying file to clipboard: ${err.message}`);
          }
        }
      });
    }
  }

  // Cleanup function to prevent memory leaks
  function cleanup() {
    debugLog("Cleaning up dismissed downloads pile system");
    
    try {
      // Clear all timeouts
      if (state.hoverTimeout) {
        clearTimeout(state.hoverTimeout);
        state.hoverTimeout = null;
      }
      
      // Remove all event listeners
      EventManager.cleanupAll();
      
      // Remove preference observer
      if (state.prefObserver) {
        try {
          Services.prefs.removeObserver(PREFS.alwaysShowPile, state.prefObserver);
        } catch (error) {
          console.warn('[Cleanup] Error removing preference observer:', error);
        }
        state.prefObserver = null;
      }
      
      // Remove DOM elements
      if (state.dynamicSizer && state.dynamicSizer.parentNode) {
        state.dynamicSizer.parentNode.removeChild(state.dynamicSizer);
      }
      
      // Clear all state
      state.clearAll();
      state.isInitialized = false;
      
      // Remove global references
      if (window.zenPileContextMenu) {
        window.zenPileContextMenu = null;
      }
      
      debugLog("Cleanup completed successfully");
    } catch (error) {
      ErrorHandler.handleError(error, 'cleanup');
    }
  }

  // Enhanced file operations with proper error handling
  async function openPodFile(podData) {
    debugLog(`Attempting to open file: ${podData.key}`);
    
    try {
      ErrorHandler.validatePodData(podData);
      
      if (!podData.targetPath) {
        throw new Error('No file path available');
      }
      
      const fileExists = await FileSystem.fileExists(podData.targetPath);
      if (fileExists) {
        const file = await FileSystem.createFileInstance(podData.targetPath);
        file.launch();
        debugLog(`Successfully opened file: ${podData.filename}`);
      } else {
        // File doesn't exist, try to open the containing folder
        const parentDir = await FileSystem.getParentDirectory(podData.targetPath);
        if (parentDir && parentDir.exists()) {
          parentDir.launch();
          debugLog(`File not found, opened containing folder: ${podData.filename}`);
        } else {
          throw new Error('File and folder not found');
        }
      }
    } catch (error) {
      ErrorHandler.handleError(error, 'openPodFile');
      debugLog(`Error opening file: ${podData.filename}`, error);
    }
  }

  // Enhanced file explorer function
  async function showPodFileInExplorer(podData) {
    debugLog(`Attempting to show file in file explorer: ${podData.key}`);
    
    try {
      ErrorHandler.validatePodData(podData);
      
      if (!podData.targetPath) {
        throw new Error('No file path available');
      }
      
      const fileExists = await FileSystem.fileExists(podData.targetPath);
      if (fileExists) {
        const file = await FileSystem.createFileInstance(podData.targetPath);
        
          try {
            // Try to reveal the file in the file manager
            file.reveal();
            debugLog(`Successfully showed file in explorer: ${podData.filename}`);
          } catch (revealError) {
            // If reveal() doesn't work, fall back to opening the containing folder
            debugLog(`Reveal failed, trying to open containing folder: ${revealError}`);
          const parentDir = await FileSystem.getParentDirectory(podData.targetPath);
            if (parentDir && parentDir.exists()) {
              parentDir.launch();
              debugLog(`Opened containing folder: ${podData.filename}`);
            } else {
            throw new Error('Containing folder not found');
            }
          }
        } else {
          // File doesn't exist, try to open the containing folder
        const parentDir = await FileSystem.getParentDirectory(podData.targetPath);
          if (parentDir && parentDir.exists()) {
            parentDir.launch();
            debugLog(`File not found, opened containing folder: ${podData.filename}`);
          } else {
          throw new Error('File and folder not found');
          }
        }
      } catch (error) {
      ErrorHandler.handleError(error, 'showPodFileInExplorer');
        debugLog(`Error showing file in explorer: ${podData.filename}`, error);
      }
  }

  // Initialize when DOM is ready
  if (document.readyState === "complete") {
    init();
    } else {
    window.addEventListener("load", init, { once: true });
  }

  // Cleanup on page unload
  window.addEventListener("beforeunload", cleanup, { once: true });

  debugLog("Dismissed downloads pile script loaded");

  // --- Global rename dialog for pods ---
  function showRenameDialog(podData) {
    debugLog(`[Rename] Showing rename dialog for: ${podData.filename}`);
    // Remove any existing rename dialog
    const existingDialog = document.getElementById('zen-pile-rename-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }
    // Create dialog overlay
    const overlay = document.createElement('div');
    overlay.id = 'zen-pile-rename-dialog';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
      backdrop-filter: blur(2px);
    `;
    // Create dialog box
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: var(--zen-primary-color);
      border: 1px solid var(--panel-border-color);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      padding: 20px;
      width: 400px;
      max-width: 90vw;
      color: inherit;
    `;
    // Create title
    const title = document.createElement('h3');
    title.textContent = 'Rename File';
    title.style.cssText = `
      margin: 0 0 15px 0;
      font-size: 16px;
      font-weight: 600;
    `;
    // Create current filename display
    const currentName = document.createElement('div');
    currentName.textContent = `Current: ${podData.filename}`;
    currentName.style.cssText = `
      margin-bottom: 10px;
      font-size: 13px;
      color: var(--text-color-deemphasized);
      word-break: break-all;
    `;
    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.value = podData.filename;
    input.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--panel-border-color);
      border-radius: 4px;
      background: var(--toolbar-field-background-color);
      color: var(--toolbar-field-color);
      font-size: 14px;
      margin-bottom: 15px;
      box-sizing: border-box;
    `;
    // Select filename without extension
    const lastDotIndex = podData.filename.lastIndexOf('.');
    if (lastDotIndex > 0) {
      setTimeout(() => {
        input.setSelectionRange(0, lastDotIndex);
        input.focus();
      }, 100);
    } else {
      setTimeout(() => {
        input.select();
        input.focus();
      }, 100);
    }
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    `;
    // Create cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--panel-border-color);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 13px;
    `;
    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.backgroundColor = 'transparent';
    });
    // Create rename button
    const renameButton = document.createElement('button');
    renameButton.textContent = 'Rename';
    renameButton.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--zen-primary-color);
      border-radius: 4px;
      background: var(--zen-primary-color);
      color: white;
      cursor: pointer;
      font-size: 13px;
    `;
    renameButton.addEventListener('mouseenter', () => {
      renameButton.style.opacity = '0.8';
    });
    renameButton.addEventListener('mouseleave', () => {
      renameButton.style.opacity = '1';
    });
    // Handle cancel
    const closeDialog = () => {
      overlay.remove();
    };
    cancelButton.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });
    // Handle rename
    const handleRename = async () => {
      const newName = input.value.trim();
      if (!newName) {
        alert('Please enter a valid filename.');
        input.focus();
        return;
      }
      if (newName === podData.filename) {
        closeDialog();
        return;
      }
      try {
        debugLog(`[Rename] Attempting to rename ${podData.filename} to ${newName}`);
        await renamePodFile(podData, newName);
        closeDialog();
      } catch (error) {
        debugLog(`[Rename] Error renaming file:`, error);
        alert(`Error renaming file: ${error.message}`);
      }
    };
    renameButton.addEventListener('click', handleRename);
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    });
    // Assemble dialog
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(renameButton);
    dialog.appendChild(title);
    dialog.appendChild(currentName);
    dialog.appendChild(input);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    debugLog(`[Rename] Rename dialog created for: ${podData.filename}`);
  }

  // --- Global pod file rename logic ---
  async function renamePodFile(podData, newFilename) {
    try {
      ErrorHandler.validatePodData(podData);
      if (!newFilename || typeof newFilename !== 'string') {
        throw new Error('Invalid new filename');
      }
      if (!podData.targetPath) {
        throw new Error('No file path available for renaming');
      }
      // Use the FileSystem utility for safe file operations (auto-increment)
      const newPath = await FileSystem.renameFile(podData.targetPath, newFilename);
      // Update pod data
      const oldFilename = podData.filename;
      // Extract the actual new filename from the path
      const newName = newPath.split(/[/\\]/).pop();
      podData.filename = newName;
      podData.targetPath = newPath;
      // Update the pod in our local storage
      state.setPodData(podData.key, podData);
      // Update the pod element
      const podElement = state.getPodElement(podData.key);
      if (podElement) {
        podElement.title = `${newName}\nClick: Open file\nMiddle-click: Show in file explorer\nRight-click: Context menu`;
        // Force UI refresh if needed (e.g., update label/icon)
        if (podElement.querySelector('.dismissed-pod-preview')) {
          // Optionally update preview/icon if needed
          // podElement.querySelector('.dismissed-pod-preview').textContent = getFileIcon(podData.contentType);
        }
      }
      // Try to update the main script's dismissed pods if the API exists
      if (window.zenTidyDownloads && window.zenTidyDownloads.dismissedPods) {
        try {
          const mainScriptPod = window.zenTidyDownloads.dismissedPods.get(podData.key);
          if (mainScriptPod) {
            mainScriptPod.filename = newName;
            mainScriptPod.targetPath = newPath;
            window.zenTidyDownloads.dismissedPods.set(podData.key, mainScriptPod);
            debugLog(`[Rename] Updated main script pod data`);
          }
        } catch (error) {
          debugLog(`[Rename] Could not update main script pod data:`, error);
        }
      }
      // Try to update Firefox downloads list
      try {
        const list = await window.Downloads.getList(window.Downloads.ALL);
        const downloads = await list.getAll();
        // Find the download that matches our pod
        const targetDownload = downloads.find(download => 
          download.target?.path === podData.targetPath.replace(newName, oldFilename) ||
          (download.source?.url === podData.sourceUrl && 
           download.target?.path?.endsWith(oldFilename))
        );
        if (targetDownload && targetDownload.target) {
          targetDownload.target.path = newPath;
          debugLog(`[Rename] Updated Firefox download record`);
        }
      } catch (error) {
        debugLog(`[Rename] Could not update Firefox download record:`, error);
      }
      debugLog(`[Rename] Successfully renamed file: ${oldFilename} -> ${newName}`);
    } catch (error) {
      showUserNotification(`Error renaming file: ${error.message}`);
      throw error;
    }
  }

  // --- Helper for user notifications ---
  function showUserNotification(message, type = 'error') {
    // Simple alert for now; could be replaced with a custom toast/notification
    alert(message);
  }

  // --- Enhanced filename validation ---
  function isValidFilename(name) {
    // Windows forbidden chars: \\ / : * ? " < > |
    // Also disallow empty or all-whitespace
    return (
      typeof name === 'string' &&
      name.trim().length > 0 &&
      !/[\\/:*?"<>|]/.test(name)
    );
  }

  // --- Clipboard file copy logic ---
  async function copyPodFileToClipboard(podData) {
    debugLog(`[Clipboard] Attempting to copy file to clipboard: ${podData.filename}`);
    try {
      ErrorHandler.validatePodData(podData);
      if (!podData.targetPath) {
        throw new Error('No file path available');
      }
      const fileExists = await FileSystem.fileExists(podData.targetPath);
      if (!fileExists) {
        throw new Error('File does not exist');
      }
      // Get nsIFile instance
      const file = await FileSystem.createFileInstance(podData.targetPath);
      // Prepare transferable
      const transferable = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
      transferable.init(null);
      // Add file flavor
      transferable.addDataFlavor("application/x-moz-file");
      transferable.setTransferData("application/x-moz-file", file);
      // Get clipboard
      const clipboard = Components.classes["@mozilla.org/widget/clipboard;1"].getService(Components.interfaces.nsIClipboard);
      clipboard.setData(transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard);
      debugLog(`[Clipboard] File copied to clipboard: ${podData.filename}`);
    } catch (error) {
      ErrorHandler.handleError(error, 'copyPodFileToClipboard');
      throw error;
    }
  }

  // Utility to check if the pod context menu is visible
  function isContextMenuVisible() {
    const menu = document.getElementById('zen-pile-pod-context-menu');
    return menu && typeof menu.state === 'string' && menu.state === 'open';
  }

  /* Add CSS for flyout/flyin animations */
  const zenFlyAnimStyle = document.createElement('style');
  zenFlyAnimStyle.textContent = `
  .zen-flyin-right {
    animation: zen-flyin-right 0.4s cubic-bezier(0.4,0,0.2,1) both;
  }
  .zen-flyin-left {
    animation: zen-flyin-left 0.4s cubic-bezier(0.4,0,0.2,1) both;
  }
  .zen-flyout-right {
    animation: zen-flyout-right 0.4s cubic-bezier(0.4,0,0.2,1) both;
  }
  .zen-flyout-left {
    animation: zen-flyout-left 0.4s cubic-bezier(0.4,0,0.2,1) both;
  }
  @keyframes zen-flyin-right {
    from { transform: translateX(60px); }
    to   { transform: none; }
  }
  @keyframes zen-flyin-left {
    from { transform: translateX(-60px); }
    to   { transform: none; }
  }
  @keyframes zen-flyout-right {
    from { transform: none; }
    to   { transform: translateX(60px); }
  }
  @keyframes zen-flyout-left {
    from { transform: none; }
    to   { transform: translateX(-60px); }
  }
  `;
  document.head.appendChild(zenFlyAnimStyle);

  // Store previous grid positions for each pod
  if (!state._prevGridPositions) state._prevGridPositions = new Map();
})();
