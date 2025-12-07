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
      // Removed isGridMode - always single column mode
      this.hoverTimeout = null;
      this.mediaControlsToolbarTimeout = null;
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
    
    // Check if we're in compact mode to determine positioning
    const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
    const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
    
    // Use absolute positioning when integrated into toolbar structure (like media controls)
    // This allows it to integrate properly with compact mode
    const positionType = (isCompactMode && !isSidebarExpanded) ? 'absolute' : 'absolute';
    
    state.dynamicSizer.style.cssText = `
      position: ${positionType};
      overflow: hidden;
      height: 0px;
      bottom: 35px;
      left: 0px;
      right: 0px;
      background: var(--zen-primary-color, rgba(0, 0, 0, 0.85));
      backdrop-filter: blur(1.5rem);
      -webkit-backdrop-filter: blur(1.5rem);
      box-sizing: border-box;
      transition: height ${CONFIG.containerAnimationDuration}ms ease, padding-bottom ${CONFIG.containerAnimationDuration}ms ease, padding-left ${CONFIG.containerAnimationDuration}ms ease, background 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: flex-end;
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
      width: 100%;
      box-sizing: border-box;

    `;

    // Buttons removed - no longer needed

    // Append pileContainer to dynamicSizer
    state.dynamicSizer.appendChild(state.pileContainer);

    // Setup hover events for background/buttons
    setupPileBackgroundHoverEvents();

    // Insert into browser DOM structure after media controls toolbar for better integration
    // Similar to how notifications attach after the media controls toolbar
    const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
    const zenMainAppWrapper = document.getElementById('zen-main-app-wrapper');
    
    if (mediaControlsToolbar && mediaControlsToolbar.parentNode) {
      // Insert after media controls toolbar (as sibling)
      const parent = mediaControlsToolbar.parentNode;
      parent.insertBefore(state.dynamicSizer, mediaControlsToolbar.nextSibling);
      
      // Ensure parent has position: relative for absolute positioning to work correctly
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.position === 'static') {
        parent.style.position = 'relative';
        debugLog("Set parent container to position: relative for absolute positioning");
      }
      
      debugLog("Inserted dismissed pile container after zen-media-controls-toolbar");
    } else if (zenMainAppWrapper) {
      // Fallback: insert into zen-main-app-wrapper
      zenMainAppWrapper.appendChild(state.dynamicSizer);
      debugLog("Inserted dismissed pile container into zen-main-app-wrapper (fallback)");
    } else {
      // Final fallback: append to document.body
      document.body.appendChild(state.dynamicSizer);
      debugLog("Inserted dismissed pile container into document.body (final fallback)");
    }
    
    // Set up observer for compact mode changes
    setupCompactModeObserver();
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

    // Limit to 4 most recent pods
    if (state.dismissedPods.size >= 4) {
      const oldestKey = Array.from(state.dismissedPods.keys())[0];
      removePodFromPile(oldestKey);
    }

    // Store pod data
    state.dismissedPods.set(podData.key, podData);

    // Create DOM element
    const podElement = createPodElement(podData);
    state.podElements.set(podData.key, podElement);
    state.pileContainer.appendChild(podElement);

    // Generate position for single column layout
    generateGridPosition(podData.key);

    // Apply position immediately (no messy pile mode)
    applyGridPosition(podData.key, animate ? 0 : 0);

    // Update pile visibility
    updatePileVisibility();

    // Update downloads button visibility
    updateDownloadsButtonVisibility();

    // Show the pile immediately when a pod is added
    if (shouldPileBeVisible()) {
      showPile();
      // Update text colors after showing pile
      setTimeout(() => {
        updatePodTextColors();
      }, 50);
    }

    debugLog(`Added pod to pile: ${podData.filename}`);
  }

  // Create a DOM element for a dismissed pod
  function createPodElement(podData) {
    // Create row container that spans full width
    const row = document.createElement("div");
    row.className = "dismissed-pod-row";
    row.dataset.podKey = podData.key;
    row.title = `${podData.filename}\nClick: Open file\nMiddle-click: Show in file explorer\nRight-click: Context menu`;
    
    row.style.cssText = `
      position: absolute;
      width: 100%;
      height: 60px;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 0 8px;
      box-sizing: border-box;
      cursor: pointer;
      transition: bottom 0.3s ease, opacity 0.3s ease, background-color 0.2s ease;
      will-change: bottom;
      left: 0;
      right: 0;
      border-radius: 6px;
    `;
    
    // Add hover background color
    row.addEventListener('mouseenter', () => {
      row.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    });
    
    row.addEventListener('mouseleave', () => {
      row.style.backgroundColor = 'transparent';
    });

    // Create pod thumbnail (left side)
    const pod = document.createElement("div");
    pod.className = "dismissed-pod";
    pod.style.cssText = `
      width: 45px;
      height: 45px;
      min-width: 45px;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      flex-shrink: 0;
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
    row.appendChild(pod);

    // Create text container (right side)
    const textContainer = document.createElement("div");
    textContainer.className = "dismissed-pod-text";
    textContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      justify-content: center;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      height: 100%;
    `;

    // Create filename element
    const filename = document.createElement("div");
    filename.className = "dismissed-pod-filename";
    filename.textContent = podData.filename || "Untitled";
    filename.style.cssText = `
      font-size: 13px;
      font-weight: 500;
      color: var(--zen-text-color, #e0e0e0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    `;

    // Create file size element
    const fileSize = document.createElement("div");
    fileSize.className = "dismissed-pod-filesize";
    const sizeBytes = podData.fileSize || 0;
    fileSize.textContent = formatBytes(sizeBytes);
    fileSize.style.cssText = `
      font-size: 11px;
      color: var(--zen-text-color-deemphasized, #a0a0a0);
      white-space: nowrap;
    `;

    textContainer.appendChild(filename);
    textContainer.appendChild(fileSize);
    row.appendChild(textContainer);

    // Add click handler for opening in file explorer
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      debugLog(`Attempting to open file: ${podData.key}`);
      openPodFile(podData);
    });

    // Add middle-click handler for showing in file explorer
    row.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        e.stopPropagation();
        debugLog(`Attempting to show file in explorer: ${podData.key}`);
        showPodFileInExplorer(podData);
      }
    });

    // Add right-click handler - use native menupopup
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ensurePodContextMenu();
      podContextMenuPodData = podData;
      // Open at mouse position
      if (typeof podContextMenu.openPopupAtScreen === 'function') {
        podContextMenu.openPopupAtScreen(e.screenX, e.screenY, true);
      } else {
        // fallback: open at pod
        podContextMenu.openPopup(row, 'after_start', 0, 0, true, false, e);
      }
    });

    // Add drag-and-drop support for dragging to web pages
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', async (e) => {
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

    return row;
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

  // Format bytes to human-readable size
  function formatBytes(b, d = 2) {
    if (b === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${parseFloat((b / Math.pow(1024, i)).toFixed(d))} ${sizes[i]}`;
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

  // Generate position for a pod (single column layout, bottom-up, 4 most recent)
  function generateGridPosition(podKey) {
    // Get the 4 most recent pods (newest last in the map)
    const allPods = Array.from(state.dismissedPods.keys());
    const recentPods = allPods.slice(-4); // Get last 4 pods (most recent)
    const index = recentPods.indexOf(podKey);
    
    if (index === -1) {
      // This pod is not in the 4 most recent, don't position it
      return;
    }

    // Single column layout - newest at bottom (index 0), older stack upward
    // All pods are in column 0, positioned vertically from bottom using bottom CSS property
    const x = 0; // All pods start at left edge (full width)
    const rowIndex = index; // Index in the recent 4 (0 = newest at bottom)

    state.gridPositions.set(podKey, { x, y: 0, row: rowIndex, col: 0 });
    
    debugLog(`Single column position (bottom-up) for ${podKey}:`, {
      index,
      rowIndex,
      x,
      totalRecent: recentPods.length
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

  // Apply position to a pod (simple single column, no rotation)
  function applyGridPosition(podKey, delay = 0) {
    const podElement = state.podElements.get(podKey);
    const position = state.gridPositions.get(podKey);
    if (!podElement || !position) {
      // If no position, hide the pod (it's not in the 4 most recent)
      if (podElement) {
        podElement.style.display = 'none';
      }
      return;
    }

    setTimeout(() => {
      // Use bottom positioning for bottom-up layout
      const rowHeight = 60;
      const rowSpacing = 8;
      const baseBottomOffset = 10; // Small base offset for first row
      const bottomOffset = baseBottomOffset + (position.row * (rowHeight + rowSpacing));
      podElement.style.bottom = `${bottomOffset}px`;
      podElement.style.left = '0';
      podElement.style.right = '0';
      podElement.style.top = 'auto';
      podElement.style.transform = `translate3d(0, 0, 0) rotate(0deg)`;
      podElement.style.display = 'flex'; // Ensure flex layout is maintained
      podElement.style.zIndex = '1';
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
      if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
          hidePile(); 
      }
    } else {
      // Show only the 4 most recent pods
      const allPods = Array.from(state.dismissedPods.keys());
      const recentPods = allPods.slice(-4); // Get last 4 pods (most recent)
      
      // Regenerate positions for all pods
      allPods.forEach(podKey => {
        generateGridPosition(podKey);
        applyGridPosition(podKey, 0);
      });
      
      // If pile is currently visible, recalculate height dynamically
      if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
        updatePileHeight();
      }
    }
  }

  // Update pile height dynamically based on current pod count (max 4)
  function updatePileHeight() {
    if (!state.dynamicSizer || state.dismissedPods.size === 0) return;
    
    const rowHeight = 60; // Height of each row (pod + text)
    const rowSpacing = 8; // Spacing between rows
    
    // Always show max 4 pods
    const podsToShow = Math.min(state.dismissedPods.size, 4);
    
    // Calculate height: base height + (rows * row height) + spacing between rows + base bottom offset
    const baseHeight = 20; // Reduced base padding
    const baseBottomOffset = 10; // Small base offset for first row (matches applyGridPosition)
    const totalRowHeight = (podsToShow * rowHeight) + ((podsToShow - 1) * rowSpacing);
    const gridHeight = baseHeight + totalRowHeight + baseBottomOffset;
    
    debugLog("Updating pile height dynamically", {
      totalPods: state.dismissedPods.size,
      podsToShow,
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
    
    // Only hide media controls toolbar if there are dismissed pods to show
    if (state.dismissedPods.size > 0) {
      clearTimeout(state.mediaControlsToolbarTimeout);
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        mediaControlsToolbar.style.opacity = '0';
        mediaControlsToolbar.style.pointerEvents = 'none';
        debugLog("[DownloadHover] Hid media controls toolbar");
      }
    }
    
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
    
    // Show media controls toolbar again when leaving download button area (with delay)
    clearTimeout(state.mediaControlsToolbarTimeout);
    
    // Check if pile is currently visible/animating - add animation duration to delay
    const isPileVisible = state.dynamicSizer && state.dynamicSizer.style.height !== '0px' && state.dynamicSizer.style.display !== 'none';
    const delay = isPileVisible ? CONFIG.hoverDebounceMs + CONFIG.containerAnimationDuration + 50 : CONFIG.hoverDebounceMs;
    
    state.mediaControlsToolbarTimeout = setTimeout(() => {
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        // Check if we're still hovering over the pile area
        const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
        const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
        const isHoveringPile = state.pileContainer?.matches(':hover') || state.dynamicSizer?.matches(':hover');
        
        // Check if pile is still visible/animating
        const pileStillVisible = state.dynamicSizer && 
                                state.dynamicSizer.style.height !== '0px' && 
                                state.dynamicSizer.style.display !== 'none';
        
        // Only show toolbar if not hovering over download/pile area, context menu not visible, and pile is hidden
        if (!isHoveringDownloadArea && !isHoveringPile && !isContextMenuVisible() && !pileStillVisible) {
          mediaControlsToolbar.style.opacity = '1';
          mediaControlsToolbar.style.pointerEvents = 'auto';
          debugLog("[DownloadHover] Showed media controls toolbar");
        }
      }
    }, delay);
    
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
    
    // Hide media controls toolbar when hovering over sizer (only if there are pods)
    if (state.dismissedPods.size > 0) {
      clearTimeout(state.mediaControlsToolbarTimeout);
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        mediaControlsToolbar.style.opacity = '0';
        mediaControlsToolbar.style.pointerEvents = 'none';
        debugLog("[SizerHover] Hid media controls toolbar");
      }
    }
    
    if (getAlwaysShowPile()) return;
    clearTimeout(state.hoverTimeout);
    if (state.dismissedPods.size > 0) {
      showPile(); // Ensure pile stays open when hovering the sizer
      // Always show buttons in single column mode
      {
        showPileBackground();
      }
    }
  }

  // Dynamic sizer leave handler
  function handleDynamicSizerLeave() {
    debugLog("[SizerHover] handleDynamicSizerLeave called");
    
    // Show media controls toolbar again when leaving sizer area (with delay)
    clearTimeout(state.mediaControlsToolbarTimeout);
    
    // Check if pile is currently visible/animating - add animation duration to delay
    const isPileVisible = state.dynamicSizer && state.dynamicSizer.style.height !== '0px' && state.dynamicSizer.style.display !== 'none';
    const delay = isPileVisible ? CONFIG.hoverDebounceMs + CONFIG.containerAnimationDuration + 50 : CONFIG.hoverDebounceMs;
    
    state.mediaControlsToolbarTimeout = setTimeout(() => {
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        // Check if we're still hovering over the download button or pile area
        const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
        const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
        const isHoveringPile = state.pileContainer?.matches(':hover') || state.dynamicSizer?.matches(':hover');
        
        // Check if pile is still visible/animating
        const pileStillVisible = state.dynamicSizer && 
                                state.dynamicSizer.style.height !== '0px' && 
                                state.dynamicSizer.style.display !== 'none';
        
        // Only show toolbar if not hovering over download/pile area, context menu not visible, and pile is hidden
        if (!isHoveringDownloadArea && !isHoveringPile && !isContextMenuVisible() && !pileStillVisible) {
          mediaControlsToolbar.style.opacity = '1';
          mediaControlsToolbar.style.pointerEvents = 'auto';
          debugLog("[SizerHover] Showed media controls toolbar");
        }
      }
    }, delay);
    
    clearTimeout(state.hoverTimeout);
    
    // Don't do anything if context menu is visible
    if (isContextMenuVisible()) {
      debugLog("[SizerHover] Context menu visible - deferring pile close");
      state.pendingPileClose = true;
      return;
    }
    
    // No mode transitions needed
    
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

  // Pile hover handler (simplified - no mode transitions)
  function handlePileHover() {
    debugLog("[PileHover] handlePileHover called");
    
    // Hide media controls toolbar when hovering over pile (only if there are pods)
    if (state.dismissedPods.size > 0) {
      clearTimeout(state.mediaControlsToolbarTimeout);
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        mediaControlsToolbar.style.opacity = '0';
        mediaControlsToolbar.style.pointerEvents = 'none';
        debugLog("[PileHover] Hid media controls toolbar");
      }
    }
    
    clearTimeout(state.hoverTimeout);
    showPileBackground();
  }

  // Pile leave handler (simplified)
  function handlePileLeave() {
    debugLog("[PileHover] handlePileLeave called");
    
    // Show media controls toolbar again when leaving pile area (with delay)
    clearTimeout(state.mediaControlsToolbarTimeout);
    
    // Check if pile is currently visible/animating - add animation duration to delay
    const isPileVisible = state.dynamicSizer && state.dynamicSizer.style.height !== '0px' && state.dynamicSizer.style.display !== 'none';
    const delay = isPileVisible ? CONFIG.hoverDebounceMs + CONFIG.containerAnimationDuration + 50 : CONFIG.hoverDebounceMs;
    
    state.mediaControlsToolbarTimeout = setTimeout(() => {
      const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
      if (mediaControlsToolbar) {
        // Check if we're still hovering over the download button area
        const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
        const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
        const isHoveringPile = state.pileContainer?.matches(':hover') || state.dynamicSizer?.matches(':hover');
        
        // Check if pile is still visible/animating
        const pileStillVisible = state.dynamicSizer && 
                                state.dynamicSizer.style.height !== '0px' && 
                                state.dynamicSizer.style.display !== 'none';
        
        // Only show toolbar if not hovering over download/pile area, context menu not visible, and pile is hidden
        if (!isHoveringDownloadArea && !isHoveringPile && !isContextMenuVisible() && !pileStillVisible) {
          mediaControlsToolbar.style.opacity = '1';
          mediaControlsToolbar.style.pointerEvents = 'auto';
          debugLog("[PileHover] Showed media controls toolbar");
        }
      }
    }, delay);
    
    clearTimeout(state.hoverTimeout);
    
    // Don't do anything if context menu is visible
    if (isContextMenuVisible()) {
      debugLog("[PileHover] Context menu visible - deferring pile close");
      state.pendingPileClose = true;
      return;
    }
    
    // In always-show mode, don't hide the pile
    if (getAlwaysShowPile()) {
      return;
    }
    
    // Normal mode: handle pile hiding
    state.hoverTimeout = setTimeout(() => {
      const mainDownloadContainer = document.getElementById('userchrome-download-cards-container');
      const isHoveringDownloadArea = state.downloadButton?.matches(':hover') || mainDownloadContainer?.matches(':hover');
      
      if (!isHoveringDownloadArea && !state.dynamicSizer.matches(':hover')) {
        if (isContextMenuVisible()) {
          state.pendingPileClose = true;
        } else {
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
      // Removed isGridMode
      alwaysShowMode: getAlwaysShowPile()
    });
    
    if (state.dismissedPods.size === 0 || !state.dynamicSizer) return;
    
    // Check compact mode state - hide pile if sidebar is collapsed (similar to media controls)
    const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
    const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
    
    if (isCompactMode && !isSidebarExpanded) {
      // In compact mode with collapsed sidebar, hide the pile (like media controls)
      debugLog("[ShowPile] Compact mode with collapsed sidebar - hiding pile");
      state.dynamicSizer.style.display = 'none';
      return;
    }
    
    // Show the pile
    state.dynamicSizer.style.display = 'flex';
    
    // Ensure width is set before calculating positions
    if (typeof updatePileContainerWidth === 'function') {
        updatePileContainerWidth();
    }

    // For absolute positioning, use left/right with equal margins for symmetric gaps
    const sidePadding = CONFIG.minSidePadding; // Padding from sidebar edges (5px)
    
    // Use left: 0 and right: 0 to span full width, then use margin for symmetric gaps
    state.dynamicSizer.style.left = `${sidePadding}px`;
    state.dynamicSizer.style.right = `${sidePadding}px`;
    state.dynamicSizer.style.width = 'auto'; // Let left/right determine width
    
    debugLog("Positioned pile for absolute positioning with symmetric gaps", {
      sidePadding,
      position: state.dynamicSizer.style.position,
      left: state.dynamicSizer.style.left,
      right: state.dynamicSizer.style.right
    });

    // Set pointer-events based on mode and state
    updatePointerEvents();
    
    state.dynamicSizer.style.paddingBottom = '10px';
    state.dynamicSizer.style.paddingLeft = `0px`; // No left padding for full-width rows
    
    // Calculate dynamic height for 4 most recent pods
    const totalPods = state.dismissedPods.size;
    const podsToShow = Math.min(totalPods, 4); // Always max 4 pods
    
    const rowHeight = 60; // Height of each row (pod + text)
    const rowSpacing = 8; // Spacing between rows
    
    // Calculate height: base height + (rows * row height) + spacing between rows + base bottom offset
    const baseHeight = 20; // Reduced base padding
    const baseBottomOffset = 5; // Small base offset for first row (matches applyGridPosition)
    const totalRowHeight = (podsToShow * rowHeight) + ((podsToShow - 1) * rowSpacing);
    const gridHeight = baseHeight + totalRowHeight + baseBottomOffset;
    
    debugLog("Dynamic height calculation (4 most recent)", {
      totalPods,
      podsToShow,
      calculatedHeight: gridHeight
    });
    
    state.dynamicSizer.style.height = `${gridHeight}px`;
    
    // Set background to ensure backdrop-filter is properly rendered
    showPileBackground();
    
    // Update positions for all pods (show only 4 most recent)
    state.dismissedPods.forEach((_, podKey) => {
      generateGridPosition(podKey);
      applyGridPosition(podKey, 0);
    }); 
    
    // Ensure hover events are properly set up for the current mode
    // This is important after the pile was hidden and is being shown again
    setTimeout(() => {
      setupPileBackgroundHoverEvents();
      debugLog("[ShowPile] Hover events re-setup after pile shown");
    }, 50); // Small delay to ensure DOM is updated
    
    debugLog("Showing pile with single column layout", {
      totalPods,
      podsToShow,
      dynamicHeight: gridHeight
    });
  }

  // Hide the pile
  function hidePile() {
    debugLog("[HidePile] hidePile called", {
      currentHeight: state.dynamicSizer?.style.height
    });
    
    if (!state.dynamicSizer) return;

    state.dynamicSizer.style.pointerEvents = 'none';
    state.dynamicSizer.style.height = '0px';
    state.dynamicSizer.style.paddingBottom = '0px'; // Remove padding when hiding
    state.dynamicSizer.style.paddingLeft = '0px'; // Remove left padding when hiding
    
    // Don't hide display in compact mode - let the observer handle it
    // Only hide display if not in compact mode with collapsed sidebar
    const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
    const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
    if (!(isCompactMode && !isSidebarExpanded)) {
      state.dynamicSizer.style.display = 'flex'; // Keep flex but collapsed
    }
    
    // Hide background and buttons when hiding pile
    hidePileBackground();
    
    // No mode transitions needed
    
    debugLog("Hiding dismissed downloads pile by collapsing sizer");
  }

  // No longer needed - removed transition to grid mode

  // Removed renderGridWindow - no longer needed with simplified single column layout

  // No longer needed - removed transition to pile mode

  // Recalculate layout on window resize
  function recalculateLayout() {
    if (state.dismissedPods.size === 0) return;

    // Regenerate grid positions
    state.dismissedPods.forEach((_, podKey) => {
      generateGridPosition(podKey);
    });

    // Recalculate position if pile is currently shown (using same logic as showPile)
    if (state.dynamicSizer && state.dynamicSizer.style.height !== '0px') {
      const sidePadding = CONFIG.minSidePadding; // Padding from sidebar edges (5px)
      
      // Use left and right with equal values for symmetric gaps
      state.dynamicSizer.style.left = `${sidePadding}px`;
      state.dynamicSizer.style.right = `${sidePadding}px`;
      state.dynamicSizer.style.width = 'auto'; // Let left/right determine width
      
      debugLog("Recalculated pile position on resize with symmetric gaps", {
        sidePadding
      });
    }

    // Apply positions for all pods (always single column mode now)
    state.dismissedPods.forEach((_, podKey) => {
      generateGridPosition(podKey);
      applyGridPosition(podKey, 0);
    });
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

    // Update the global variable (store raw width, we'll subtract padding when applying)
    state.currentZenSidebarWidthForPile = newWidth;
    debugLog('[PileWidthSync] Stored sidebar width:', newWidth);
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

  // Compute the blended background color that matches Zen's lightening effect
  function computeBlendedBackgroundColor() {
    // Check if we're in compact mode - use toolbar background color directly
    const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
    const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
    
    if (isCompactMode && isSidebarExpanded) {
      // In compact mode with expanded sidebar, use toolbar background color (includes light tint)
      const navigatorToolbox = document.getElementById('navigator-toolbox');
      if (navigatorToolbox) {
        const toolbarBg = window.getComputedStyle(navigatorToolbox).getPropertyValue('--zen-main-browser-background-toolbar').trim();
        if (toolbarBg) {
          // Try to get the computed color value
          const testEl = document.createElement('div');
          testEl.style.backgroundColor = toolbarBg || 'var(--zen-main-browser-background-toolbar)';
          testEl.style.position = 'absolute';
          testEl.style.visibility = 'hidden';
          document.body.appendChild(testEl);
          const computedColor = window.getComputedStyle(testEl).backgroundColor;
          document.body.removeChild(testEl);
          
          if (computedColor && computedColor !== 'transparent' && computedColor !== 'rgba(0, 0, 0, 0)') {
            debugLog('[BackgroundColor] Using toolbar background color for compact mode:', computedColor);
            return computedColor;
          }
          
          // If computed color isn't available, return the CSS variable
          return toolbarBg || 'var(--zen-main-browser-background-toolbar)';
        }
      }
    }
    
    // For non-compact mode or collapsed sidebar, use the blended color calculation
    // Get base background color
    const navigatorToolbox = document.getElementById('navigator-toolbox');
    let baseColor = null;
    if (navigatorToolbox) {
      const baseComputed = window.getComputedStyle(navigatorToolbox);
      const baseResolved = baseComputed.getPropertyValue('--zen-main-browser-background').trim();
      
      // If it's a gradient, we can't easily blend, so return the variable
      if (baseResolved.includes('gradient') || baseResolved.includes('linear') || baseResolved.includes('radial')) {
        return 'var(--zen-main-browser-background)';
      }
      
      // Try to get the actual computed color
      const testEl = document.createElement('div');
      testEl.style.backgroundColor = 'var(--zen-main-browser-background)';
      testEl.style.position = 'absolute';
      testEl.style.visibility = 'hidden';
      document.body.appendChild(testEl);
      const computedBase = window.getComputedStyle(testEl).backgroundColor;
      document.body.removeChild(testEl);
      
      if (computedBase && computedBase !== 'transparent' && computedBase !== 'rgba(0, 0, 0, 0)') {
        baseColor = computedBase;
      }
    }
    
    // Get wrapper background color
    const appWrapper = document.getElementById('zen-main-app-wrapper');
    let wrapperColor = null;
    if (appWrapper) {
      const wrapperComputed = window.getComputedStyle(appWrapper);
      wrapperColor = wrapperComputed.backgroundColor;
    }
    
    // If we don't have both colors, fallback to base
    if (!baseColor || !wrapperColor || baseColor === 'transparent' || wrapperColor === 'transparent') {
      return 'var(--zen-main-browser-background)';
    }
    
    // Parse RGB values
    function parseRGB(colorStr) {
      if (colorStr.startsWith('rgba(')) {
        const match = colorStr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
          return {
            r: parseInt(match[1]),
            g: parseInt(match[2]),
            b: parseInt(match[3]),
            a: parseFloat(match[4])
          };
        }
      } else if (colorStr.startsWith('rgb(')) {
        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          return {
            r: parseInt(match[1]),
            g: parseInt(match[2]),
            b: parseInt(match[3]),
            a: 1
          };
        }
      }
      return null;
    }
    
    const baseRGB = parseRGB(baseColor);
    const wrapperRGB = parseRGB(wrapperColor);
    
    if (!baseRGB || !wrapperRGB) {
      return 'var(--zen-main-browser-background)';
    }
    
    // Blend the colors to achieve the target: rgb(49, 32, 42)
    // Formula: blended = base * (1 - ratio) + wrapper * ratio
    // Solving for ratio to match target rgb(49, 32, 42):
    // If base is rgb(34, 17, 31) and wrapper is rgb(255, 233, 198):
    // - R: 34 + (255-34) * ratio = 49 => ratio ≈ 0.068
    // - G: 17 + (233-17) * ratio = 32 => ratio ≈ 0.069  
    // - B: 31 + (198-31) * ratio = 42 => ratio ≈ 0.066
    // Average ratio ≈ 0.067 (about 6.7%)
    const wrapperRatio = 0.067; // Adjusted to match target rgb(49, 32, 42)
    
    const blendedR = Math.round(baseRGB.r * (1 - wrapperRatio) + wrapperRGB.r * wrapperRatio);
    const blendedG = Math.round(baseRGB.g * (1 - wrapperRatio) + wrapperRGB.g * wrapperRatio);
    const blendedB = Math.round(baseRGB.b * (1 - wrapperRatio) + wrapperRGB.b * wrapperRatio);
    
    // Use the base's opacity if it has one, otherwise fully opaque
    const finalAlpha = baseRGB.a || 1;
    
    if (finalAlpha < 1) {
      return `rgba(${blendedR}, ${blendedG}, ${blendedB}, ${finalAlpha})`;
    } else {
      return `rgb(${blendedR}, ${blendedG}, ${blendedB})`;
    }
  }

  // Calculate text color based on background color (using Zen's luminance/contrast logic)
  function calculateTextColorForBackground(backgroundColor) {
    // Parse RGB from color string
    function parseRGB(colorStr) {
      if (colorStr.startsWith('rgba(')) {
        const match = colorStr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
          return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        }
      } else if (colorStr.startsWith('rgb(')) {
        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        }
      }
      return null;
    }
    
    const bgRGB = parseRGB(backgroundColor);
    if (!bgRGB) {
      // Fallback to CSS variable if we can't parse
      return 'var(--zen-text-color, #e0e0e0)';
    }
    
    // Calculate relative luminance (from Zen's luminance function)
    function luminance([r, g, b]) {
      const a = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }
    
    // Calculate contrast ratio (from Zen's contrastRatio function)
    function contrastRatio(rgb1, rgb2) {
      const lum1 = luminance(rgb1);
      const lum2 = luminance(rgb2);
      const brightest = Math.max(lum1, lum2);
      const darkest = Math.min(lum1, lum2);
      return (brightest + 0.05) / (darkest + 0.05);
    }
    
    // Test dark text (black) and light text (white)
    const darkText = [0, 0, 0];
    const lightText = [255, 255, 255];
    
    const darkContrast = contrastRatio(bgRGB, darkText);
    const lightContrast = contrastRatio(bgRGB, lightText);
    
    // Use whichever has better contrast
    // Also consider: if background is very light, use dark text; if very dark, use light text
    const bgLuminance = luminance(bgRGB);
    const useDarkText = darkContrast > lightContrast || bgLuminance > 0.5;
    
    if (useDarkText) {
      return 'rgba(0, 0, 0, 0.8)'; // Dark text with some transparency
    } else {
      return 'rgba(255, 255, 255, 0.8)'; // Light text with some transparency
    }
  }

  // Update text colors for all pod rows based on current background
  function updatePodTextColors() {
    if (!state.dynamicSizer) {
      return;
    }
    
    const blendedColor = computeBlendedBackgroundColor();
    const textColor = calculateTextColorForBackground(blendedColor);
    
    // Update all pod text elements
    const textElements = state.pileContainer.querySelectorAll('.dismissed-pod-filename, .dismissed-pod-filesize');
    textElements.forEach(el => {
      el.style.color = textColor;
    });
    
    console.log('[ShowPile] Updated text colors to:', textColor, 'for background:', blendedColor);
  }

  // Show pile background on hover
  function showPileBackground() {
    if (!state.dynamicSizer) {
      return;
    }
    
    const blendedColor = computeBlendedBackgroundColor();
    state.dynamicSizer.style.backgroundColor = blendedColor;
    state.dynamicSizer.style.backgroundImage = 'none';
    
    // Update text colors to match the new background
    updatePodTextColors();
    
    console.log('[ShowPile] Computed blended background color:', blendedColor);
  }

  // Hide pile background when not hovering
  function hidePileBackground() {
    if (!state.dynamicSizer) {
      return;
    }
    if (state.isTransitioning) {
      return;
    }
    state.dynamicSizer.style.background = 'transparent';
  }

  // Setup hover events for background/buttons (simplified - always single column mode)
  function setupPileBackgroundHoverEvents() {
    if (!state.dynamicSizer || !state.pileContainer) {
      return;
    }
    
    // Remove existing hover events first
    if (state.containerHoverEventsAttached) {
      state.dynamicSizer.removeEventListener('mouseenter', handleDynamicSizerHover);
      state.dynamicSizer.removeEventListener('mouseleave', handleDynamicSizerLeave);
      state.containerHoverEventsAttached = false;
    }
    
    if (state.pileHoverEventsAttached) {
      state.pileContainer.removeEventListener('mouseenter', handlePileHover);
      state.pileContainer.removeEventListener('mouseleave', handlePileLeave);
      state.pileHoverEventsAttached = false;
    }
    
    // Always use container hover events for single column mode
    state.dynamicSizer.addEventListener('mouseenter', handleDynamicSizerHover);
    state.dynamicSizer.addEventListener('mouseleave', handleDynamicSizerLeave);
    state.containerHoverEventsAttached = true;
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

  // Setup compact mode observer to handle visibility changes
  function setupCompactModeObserver() {
    const mainWindow = document.getElementById('main-window');
    const zenMainAppWrapper = document.getElementById('zen-main-app-wrapper');
    const targetElement = zenMainAppWrapper || document.documentElement;
    
    if (!targetElement) {
      debugLog("[CompactModeObserver] Target element not found, cannot set up observer");
      return;
    }
    
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const attributeName = mutation.attributeName;
          if (attributeName === 'zen-compact-mode' || attributeName === 'zen-sidebar-expanded') {
            debugLog(`[CompactModeObserver] ${attributeName} changed, updating pile visibility`);
            // Update pile visibility based on compact mode state
            if (state.dynamicSizer && state.dismissedPods.size > 0) {
              const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
              const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
              
              if (isCompactMode && !isSidebarExpanded) {
                // Hide pile when sidebar is collapsed in compact mode
                state.dynamicSizer.style.display = 'none';
              } else if (shouldPileBeVisible()) {
                // Show pile if it should be visible
                showPile();
              }
            }
          }
        }
      }
    });
    
    observer.observe(targetElement, {
      attributes: true,
      attributeFilter: ['zen-compact-mode', 'zen-sidebar-expanded']
    });
    
    // Also observe documentElement for zen-sidebar-expanded
    if (targetElement !== document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['zen-sidebar-expanded']
      });
    }
    
    debugLog("[CompactModeObserver] Set up observer for compact mode changes");
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

  // Update pointer-events based on current state
  function updatePointerEvents() {
    if (!state.dynamicSizer || !state.pileContainer) return;
    const alwaysShow = getAlwaysShowPile();
    if (alwaysShow) {
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
            const MAX_PODS_TO_SHOW = 10;
            if (allPods.length < MAX_PODS_TO_SHOW) {
              state.carouselStartIndex = 0;
              state.visibleGridOrder = allPods.slice();
            } else {
              // If carouselStartIndex is out of bounds, reset
              if (state.carouselStartIndex >= allPods.length) {
                state.carouselStartIndex = 0;
              }
              state.visibleGridOrder = [];
              for (let i = 0; i < MAX_PODS_TO_SHOW; i++) {
                const podIndex = state.carouselStartIndex + i;
                if (podIndex < allPods.length) {
                  state.visibleGridOrder.push(allPods[podIndex]);
                }
              }
            }
            // Update positions for all pods
            state.dismissedPods.forEach((_, podKey) => {
              generateGridPosition(podKey);
              applyGridPosition(podKey, 0);
            });
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
          const isPileVisible = state.dynamicSizer && state.dynamicSizer.style.height !== '0px';
          
          if (!isHoveringPile && !isHoveringSizer && !isHoveringDownloadArea) {
            // No mode transitions needed
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
            
            // Show media controls toolbar when context menu is dismissed and not hovering over download/pile area
            // Show it if there are no dismissed pods, or if the pile is hidden
            clearTimeout(state.mediaControlsToolbarTimeout);
            
            // Check if pile is currently visible/animating - add animation duration to delay
            const isPileVisible = state.dynamicSizer && state.dynamicSizer.style.height !== '0px' && state.dynamicSizer.style.display !== 'none';
            const delay = isPileVisible ? CONFIG.hoverDebounceMs + CONFIG.containerAnimationDuration + 50 : CONFIG.hoverDebounceMs;
            
            state.mediaControlsToolbarTimeout = setTimeout(() => {
              const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
              if (mediaControlsToolbar) {
                // Check again if we're still not hovering and pile is hidden
                const stillNotHovering = !state.pileContainer?.matches(':hover') && 
                                        !state.dynamicSizer?.matches(':hover') &&
                                        !state.downloadButton?.matches(':hover') &&
                                        !mainDownloadContainer?.matches(':hover');
                const pileStillHidden = !state.dynamicSizer || 
                                       state.dynamicSizer.style.height === '0px' || 
                                       state.dynamicSizer.style.display === 'none';
                
                if (stillNotHovering && (state.dismissedPods.size === 0 || pileStillHidden)) {
                  mediaControlsToolbar.style.opacity = '1';
                  mediaControlsToolbar.style.pointerEvents = 'auto';
                  debugLog("[ContextMenu] Showed media controls toolbar after menu dismissal");
                }
              }
            }, delay);
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
        
        // Update the displayed filename in the DOM
        const filenameElement = podElement.querySelector('.dismissed-pod-filename');
        if (filenameElement) {
          filenameElement.textContent = newName;
          debugLog(`[Rename] Updated displayed filename in DOM: ${newName}`);
        }
        
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
