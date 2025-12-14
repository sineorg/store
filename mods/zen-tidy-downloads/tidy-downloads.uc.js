// ==UserScript==
// @include   main
// @loadOrder    99999999999999
// @ignorecache
// ==/UserScript==

// userChrome.js / download_preview_mistral_pixtral_rename.uc.js - FINAL FIXED VERSION
// AI-powered download preview and renaming with Mistral vision API support
(function () {
  "use strict";

  // Use Components for Firefox compatibility
  const { classes: Cc, interfaces: Ci } = Components;

  // Wait for browser window to be ready
  if (location.href !== "chrome://browser/content/browser.xhtml") return;

  // === POPUP WINDOW EXCLUSION CHECKS ===
  // Method 1: Check window type attribute
  if (document.documentElement.getAttribute('windowtype') !== 'navigator:browser') {
    console.log('Zen Tidy Downloads: Skipping - not a main browser window (windowtype check)');
    return;
  }

  // Method 2: Check if this is a popup by examining window features
  try {
    // Check if window has minimal UI (characteristic of popups)
    if (window.toolbar && !window.toolbar.visible) {
      console.log('Zen Tidy Downloads: Skipping - appears to be a popup (toolbar check)');
      return;
    }
    
    // Check window opener (popups usually have an opener)
    if (window.opener) {
      console.log('Zen Tidy Downloads: Skipping - window has opener (popup check)');
      return;
    }
  } catch (e) {
    // If we can't check these properties, continue but log it
    console.log('Zen Tidy Downloads: Could not check window properties:', e);
  }

  // Method 3: Check for essential browser UI elements that should exist in main window
  // Wait a bit for DOM to be ready, then check for main browser elements
  setTimeout(() => {
    const mainBrowserElements = [
      '#navigator-toolbox',  // Main toolbar container
      '#browser',            // Browser element
      '#sidebar-box'         // Sidebar container
    ];
    
    const missingElements = mainBrowserElements.filter(selector => !document.querySelector(selector));
    
    if (missingElements.length > 0) {
      console.log('Zen Tidy Downloads: Skipping - missing main browser elements:', missingElements);
      return;
    }
    
    // Method 4: Check window size (popups are usually smaller)
    if (window.outerWidth < 400 || window.outerHeight < 300) {
      console.log('Zen Tidy Downloads: Skipping - window too small (likely popup)');
      return;
    }
    
    // Method 5: Check for dialog-specific attributes
    if (document.documentElement.hasAttribute('dlgtype')) {
      console.log('Zen Tidy Downloads: Skipping - dialog window detected');
      return;
    }
    
    // If all checks pass, continue with initialization
    console.log('Zen Tidy Downloads: All popup exclusion checks passed, proceeding with initialization');
    
    // === MAIN SCRIPT INITIALIZATION CONTINUES HERE ===
    // The rest of the script now runs within this setTimeout
    initializeMainScript();
  }, 100); // Small delay to ensure DOM elements are loaded

  // === MAIN SCRIPT FUNCTIONS ===
  function initializeMainScript() {
    // --- Configuration via Firefox Preferences ---
    // Available preferences (set in about:config):
    // extensions.downloads.mistral_api_key - Your Mistral API key (required for AI renaming)
    // extensions.downloads.enable_debug - Enable debug logging (default: false)
    // extensions.downloads.debug_ai_only - Only log AI-related messages (default: true)
    // extensions.downloads.enable_ai_renaming - Enable AI-powered file renaming (default: true)
    // extensions.downloads.disable_autohide - Disable automatic hiding of completed downloads (default: false)
    // extensions.downloads.autohide_delay_ms - Delay before auto-hiding completed downloads (default: 20000)
    // extensions.downloads.interaction_grace_period_ms - Grace period after user interaction (default: 5000)
    // extensions.downloads.max_filename_length - Maximum length for AI-generated filenames (default: 70)
    // extensions.downloads.skip_css_check - Skip CSS availability check (default: false) - USE ONLY FOR DEBUGGING
    // extensions.downloads.max_file_size_for_ai - Maximum file size for AI processing in bytes (default: 52428800 = 50MB)
    // extensions.downloads.mistral_api_url - Mistral API endpoint (default: "https://api.mistral.ai/v1/chat/completions")
    // extensions.downloads.mistral_model - Mistral model to use (default: "pixtral-large-latest")
    // extensions.downloads.stable_focus_mode - Prevent focus switching during multiple downloads (default: true)
    // extensions.downloads.progress_update_throttle_ms - Throttle delay for in-progress download updates (default: 500)
    // extensions.downloads.show_old_downloads_hours - How many hours back to show old completed downloads on startup (default: 2)

    // Legacy constants for compatibility
    const MISTRAL_API_KEY_PREF = "extensions.downloads.mistral_api_key";
    const DISABLE_AUTOHIDE_PREF = "extensions.downloads.disable_autohide";
    const IMAGE_LOAD_ERROR_ICON = "🚫";
    const TEMP_LOADER_ICON = "⏳";
    const RENAMED_SUCCESS_ICON = "✓";
    const IMAGE_EXTENSIONS = new Set([
      ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif",
      ".ico", ".tif", ".tiff", ".jfif"
    ]);


    // Platform-agnostic path separator detection
    const PATH_SEPARATOR = navigator.platform.includes("Win") ? "\\" : "/";

    // Global state variables
    let downloadCardsContainer;
    const activeDownloadCards = new Map();
    let renamedFiles = new Set();
    let aiRenamingPossible = false;
    let cardUpdateThrottle = new Map(); // Prevent rapid updates
    let currentZenSidebarWidth = '';
    let podsRowContainerElement = null; // Renamed back from podsStackContainerElement
    let masterTooltipDOMElement = null;
    let focusedDownloadKey = null;
    let orderedPodKeys = []; // Newest will be at the end
    let lastRotationDirection = null; // Track rotation direction: 'forward', 'backward', or null
    const dismissedDownloads = new Set(); // Track downloads that have been manually dismissed or auto-hidden
    
    // AI Process Management
    const activeAIProcesses = new Map(); // downloadKey -> { abortController, processState, startTime }
    
    // AI Rename Queue System - proper FIFO queueing for multiple downloads
    const aiRenameQueue = []; // Array of { downloadKey, download, originalFilename, queuedAt }
    let isProcessingAIQueue = false; // Flag to prevent concurrent queue processing
    let currentlyProcessingKey = null; // Track which download is currently being processed
    
    // SECURITY: Rate limiting for API calls
    const RateLimiter = (function() {
      'use strict';
      
      const MAX_REQUESTS_PER_MINUTE = 10; // Conservative limit
      const MAX_REQUESTS_PER_HOUR = 100;
      const REQUEST_HISTORY = [];
      
      /**
       * Check if a new request can be made based on rate limits
       * @returns {Object} { allowed: boolean, waitTime?: number, reason?: string }
       */
      function canMakeRequest() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const oneHourAgo = now - 3600000;
        
        // Clean old requests
        while (REQUEST_HISTORY.length > 0 && REQUEST_HISTORY[0] < oneHourAgo) {
          REQUEST_HISTORY.shift();
        }
        
        // Check per-minute limit
        const recentRequests = REQUEST_HISTORY.filter(time => time > oneMinuteAgo);
        if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
          const oldestRecent = Math.min(...recentRequests);
          const waitTime = Math.ceil((oldestRecent + 60000 - now) / 1000);
          return {
            allowed: false,
            waitTime,
            reason: `Rate limit exceeded: ${recentRequests.length} requests in the last minute (max: ${MAX_REQUESTS_PER_MINUTE})`
          };
        }
        
        // Check per-hour limit
        if (REQUEST_HISTORY.length >= MAX_REQUESTS_PER_HOUR) {
          const oldestRequest = REQUEST_HISTORY[0];
          const waitTime = Math.ceil((oldestRequest + 3600000 - now) / 1000);
          return {
            allowed: false,
            waitTime,
            reason: `Rate limit exceeded: ${REQUEST_HISTORY.length} requests in the last hour (max: ${MAX_REQUESTS_PER_HOUR})`
          };
        }
        
        return { allowed: true };
      }
      
      /**
       * Record a new API request
       */
      function recordRequest() {
        REQUEST_HISTORY.push(Date.now());
      }
      
      /**
       * Get current rate limit statistics
       * @returns {Object} Statistics about current rate limit usage
       */
      function getStats() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const oneHourAgo = now - 3600000;
        
        return {
          lastMinute: REQUEST_HISTORY.filter(time => time > oneMinuteAgo).length,
          lastHour: REQUEST_HISTORY.filter(time => time > oneHourAgo).length,
          total: REQUEST_HISTORY.length,
          limits: {
            perMinute: MAX_REQUESTS_PER_MINUTE,
            perHour: MAX_REQUESTS_PER_HOUR
          }
        };
      }
      
      return {
        canMakeRequest,
        recordRequest,
        getStats
      };
    })();
    
    // CSS availability flag
    let cssStylesAvailable = false;

    // Event listeners for external scripts
    const actualDownloadRemovedEventListeners = new Set();

    // --- Dismissed Pods Management System ---
    const dismissedPodsData = new Map(); // Store dismissed pod data for pile feature
    const dismissEventListeners = new Set(); // Callbacks for pod dismiss events
    
    // Global API for dismissed pods pile feature
    window.zenTidyDownloads = {
      // Event system
      onPodDismissed: (callback) => {
        if (typeof callback === 'function') {
          dismissEventListeners.add(callback);
          debugLog('[API] Registered pod dismiss listener');
        }
      },
      
      offPodDismissed: (callback) => {
        dismissEventListeners.delete(callback);
        debugLog('[API] Unregistered pod dismiss listener');
      },
      
      // Dismissed pods access
      dismissedPods: {
        getAll: () => new Map(dismissedPodsData), // Return copy to prevent external modification
        get: (key) => dismissedPodsData.get(key),
        count: () => dismissedPodsData.size,
        clear: () => {
          dismissedPodsData.clear();
          debugLog('[API] Cleared all dismissed pods data');
        }
      },
      
      // Active downloads access (for pile script to check if hover should be disabled)
      get activeDownloadCards() {
        return activeDownloadCards;
      },

      // Event for when a download is actually removed from Firefox's list
      onActualDownloadRemoved: (callback) => {
        if (typeof callback === 'function') {
          actualDownloadRemovedEventListeners.add(callback);
          debugLog('[API] Registered actual download removed listener');
        }
      },

      offActualDownloadRemoved: (callback) => {
        actualDownloadRemovedEventListeners.delete(callback);
        debugLog('[API] Unregistered actual download removed listener');
      },
      
      // Pod restoration
      restorePod: async (podKey) => {
        debugLog(`[API] Restore pod requested: ${podKey}`);
        const dismissedData = dismissedPodsData.get(podKey);
        if (!dismissedData) {
          debugLog(`[API] Cannot restore pod - no dismissed data found: ${podKey}`);
          return false;
        }
        
        try {
          // Remove from dismissed sets
          dismissedDownloads.delete(podKey);
          dismissedPodsData.delete(podKey);
          
          // If the download still exists in Firefox, recreate the pod
          const list = await window.Downloads.getList(window.Downloads.ALL);
          const downloads = await list.getAll();
          const download = downloads.find(dl => getDownloadKey(dl) === podKey);
          
          if (download) {
            debugLog(`[API] Found download for restoration: ${podKey}`);
            // Recreate the pod by calling our existing function
            throttledCreateOrUpdateCard(download, true);
            
            // Fire restore event
            fireCustomEvent('pod-restored-from-pile', { podKey, download });
            return true;
          } else {
            debugLog(`[API] Download no longer exists in Firefox for restoration: ${podKey}`);
            return false;
          }
        } catch (error) {
          debugLog(`[API] Error restoring pod ${podKey}:`, error);
          return false;
        }
      },
      
      // Permanent deletion
      permanentDelete: (podKey) => {
        debugLog(`[API] Permanent delete requested: ${podKey}`);
        const wasPresent = dismissedPodsData.delete(podKey);
        dismissedDownloads.add(podKey); // Ensure it stays dismissed
        
        if (wasPresent) {
          fireCustomEvent('pod-permanently-deleted', { podKey });
        }
        
        return wasPresent;
      },
      
      /**
       * Add external file to Zen Stuff with comprehensive validation
       * @param {Object} podData - Pod data object with file information
       * @returns {boolean} True if file was added successfully
       * @throws {Error} If validation fails or file doesn't exist
       */
      addExternalFile: async (podData) => {
        debugLog(`[API] Add external file requested: ${podData?.filename}`);
        
        try {
          // Validate the pod data structure
          if (!podData || typeof podData !== 'object') {
            throw new Error('Invalid pod data: must be an object');
          }
          
          const requiredFields = ['key', 'filename', 'targetPath'];
          const missingFields = requiredFields.filter(field => !podData[field]);
          if (missingFields.length > 0) {
            throw new Error(`Invalid pod data: missing required fields: ${missingFields.join(', ')}`);
          }
          
          // SECURITY: Validate field types
          if (typeof podData.key !== 'string' || podData.key.length === 0) {
            throw new Error('Invalid pod data: key must be a non-empty string');
          }
          if (typeof podData.filename !== 'string' || podData.filename.length === 0) {
            throw new Error('Invalid pod data: filename must be a non-empty string');
          }
          if (typeof podData.targetPath !== 'string' || podData.targetPath.length === 0) {
            throw new Error('Invalid pod data: targetPath must be a non-empty string');
          }
          
          // SECURITY: Comprehensive path validation (strict mode for external files)
          const pathValidation = SecurityUtils.validateFilePath(podData.targetPath, { strict: true });
          if (!pathValidation.valid) {
            throw new Error(`Invalid file path: ${pathValidation.error} (code: ${pathValidation.code})`);
          }
          
          // SECURITY: Restrict to common download directories (optional but recommended)
          // Allow user to configure allowed directories if needed
          const allowedDirs = [
            'Downloads', 'Desktop', 'Documents', 'Pictures', 'Videos', 'Music'
          ];
          const pathLower = podData.targetPath.toLowerCase();
          const isInAllowedDir = allowedDirs.some(dir => pathLower.includes(dir.toLowerCase()));
          if (!isInAllowedDir) {
            debugLog(`[API] Warning: File path is outside common directories: ${podData.targetPath}`);
            // Don't block, but log for security monitoring
          }
          
          // Verify the file exists
          const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
          file.initWithPath(podData.targetPath);
          
          if (!file.exists()) {
            throw new Error('File does not exist at the specified path');
          }
          
          // SECURITY: Validate file is actually a file (not a directory)
          if (file.isDirectory()) {
            throw new Error('Path points to a directory, not a file');
          }
          
          // Update file size if not provided
          if (!podData.fileSize || podData.fileSize <= 0) {
            podData.fileSize = file.fileSize;
          }
          
          // SECURITY: Validate file size is reasonable (prevent DoS)
          const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
          if (podData.fileSize > MAX_FILE_SIZE) {
            throw new Error(`File size exceeds maximum allowed: ${podData.fileSize} bytes`);
          }
          
          // Store the pod data
          dismissedPodsData.set(podData.key, podData);
          
          // Fire dismiss event to notify the pile system
          dismissEventListeners.forEach(callback => {
            try {
              callback(podData);
            } catch (error) {
              debugLog(`[API] Error in dismiss event listener:`, error);
            }
          });
          
          // Fire custom event
          fireCustomEvent('external-file-added-to-stuff', { podData });
          
          debugLog(`[API] Successfully added external file: ${podData.filename}`);
          return true;
          
        } catch (error) {
          const errorInfo = {
            error: error.message || error.toString(),
            name: error.name || 'Error',
            filename: podData?.filename,
            path: podData?.targetPath
          };
          debugLog(`[API] Error adding external file:`, errorInfo);
          throw error;
        }
      }
    };
    
    // Helper function to fire custom events
    function fireCustomEvent(eventName, detail) {
      try {
        const event = new CustomEvent(eventName, { 
          detail, 
          bubbles: true, 
          cancelable: true 
        });
        document.dispatchEvent(event);
        debugLog(`[Events] Fired custom event: ${eventName}`, detail);
      } catch (error) {
        debugLog(`[Events] Error firing custom event ${eventName}:`, error);
      }
    }
    
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
            // SECURITY FIX: Don't store raw HTML, just mark as icon type
            // The icon will be regenerated safely from contentType when restored
            dismissedData.previewData = {
              type: 'icon'
              // No html field - will use contentType to regenerate icon safely
            };
          }
        }
      }
      
      debugLog(`[Dismiss] Captured pod data for pile:`, dismissedData);
      return dismissedData;
    }

    // Function to check if required CSS styles are loaded
    function checkCSSAvailability() {
      try {
        console.log('[CSS Debug] Starting CSS availability check...');
        
        // First, let's check if any stylesheets are loaded
        const stylesheets = Array.from(document.styleSheets);
        console.log('[CSS Debug] Found stylesheets:', stylesheets.length);
        
        // Try to find our CSS by looking for specific rules
        let foundTidyDownloadsCSS = false;
        for (let sheet of stylesheets) {
          try {
            if (sheet.href && sheet.href.includes('zen-tidy-downloads')) {
              console.log('[CSS Debug] Found zen-tidy-downloads stylesheet:', sheet.href);
              foundTidyDownloadsCSS = true;
              break;
            }
            // Check rules if accessible
            if (sheet.cssRules) {
              for (let rule of sheet.cssRules) {
                if (rule.selectorText && 
                    (rule.selectorText.includes('#userchrome-download-cards-container') ||
                     rule.selectorText.includes('.details-tooltip'))) {
                  console.log('[CSS Debug] Found tidy downloads CSS rule:', rule.selectorText);
                  foundTidyDownloadsCSS = true;
                  break;
                }
              }
            }
          } catch (e) {
            // Some stylesheets might not be accessible due to CORS
            console.log('[CSS Debug] Could not access stylesheet rules (normal for external CSS)');
          }
          if (foundTidyDownloadsCSS) break;
        }
        
        // Create test elements for different classes that should be styled by our CSS
        const testTooltip = document.createElement('div');
        testTooltip.className = 'details-tooltip master-tooltip';
        testTooltip.style.position = 'absolute';
        testTooltip.style.left = '-9999px';
        testTooltip.style.top = '-9999px';
        testTooltip.style.visibility = 'hidden';
        document.body.appendChild(testTooltip);
        
        const testContainer = document.createElement('div');
        testContainer.id = 'userchrome-download-cards-container';
        testContainer.style.left = '-9999px';
        testContainer.style.top = '-9999px';
        testContainer.style.visibility = 'hidden';
        document.body.appendChild(testContainer);
        
        // Force a reflow to ensure styles are computed
        testTooltip.offsetHeight;
        testContainer.offsetHeight;
        
        // Check if the CSS is applied by testing specific properties
        const tooltipStyle = window.getComputedStyle(testTooltip);
        const containerStyle = window.getComputedStyle(testContainer);
        
        console.log('[CSS Debug] Tooltip computed styles:', {
          position: tooltipStyle.position,
          backgroundColor: tooltipStyle.backgroundColor,
          borderRadius: tooltipStyle.borderRadius,
          zIndex: tooltipStyle.zIndex,
          backdropFilter: tooltipStyle.backdropFilter,
          webkitBackdropFilter: tooltipStyle.webkitBackdropFilter,
          display: tooltipStyle.display
        });
        
        console.log('[CSS Debug] Container computed styles:', {
          position: containerStyle.position,
          zIndex: containerStyle.zIndex,
          pointerEvents: containerStyle.pointerEvents,
          display: containerStyle.display,
          flexDirection: containerStyle.flexDirection
        });
        
        // Test for specific CSS properties that should be set by our stylesheet
        // Updated to match the actual CSS properties in zen-tidy-downloads/chrome.css
        // We need ALL the conditions to be more strict since we were getting false positives
        const tooltipHasStyling = tooltipStyle.position === 'relative' && 
                                 tooltipStyle.backgroundColor.includes('rgba(0, 0, 0, 0.9)') &&
                                 tooltipStyle.borderRadius === '10px' &&
                                 tooltipStyle.zIndex === '51';
        
        const containerHasStyling = containerStyle.position === 'absolute' &&
                                   (containerStyle.zIndex === '4' || containerStyle.zIndex === '50') &&
                                   containerStyle.pointerEvents === 'none' &&
                                   containerStyle.display === 'flex' && 
                                   containerStyle.flexDirection === 'column';
        
        // Clean up test elements
        document.body.removeChild(testTooltip);
        document.body.removeChild(testContainer);
        
        const hasExpectedStyling = tooltipHasStyling || containerHasStyling;
        
        console.log('[CSS Debug] Styling detection results:', {
          tooltipHasStyling,
          containerHasStyling,
          hasExpectedStyling,
          foundTidyDownloadsCSS
        });
        
        // If we found the CSS file but styling isn't detected, it might be a timing issue
        // Let's be more lenient if we found the CSS file
        if (foundTidyDownloadsCSS || hasExpectedStyling) {
          console.log('[CSS Check] ✅ CSS detected successfully!');
          debugLog('[CSS Check] Required CSS styles detected and loaded successfully', {
            foundCSSFile: foundTidyDownloadsCSS,
            tooltipStyling: tooltipHasStyling,
            containerStyling: containerHasStyling,
            tooltipPosition: tooltipStyle.position,
            tooltipBgColor: tooltipStyle.backgroundColor,
            containerPosition: containerStyle.position
          });
          return true;
        } else {
          console.warn('Download Preview Script: Required CSS file not found or not loaded properly.');
          console.warn('Expected styling properties were not detected on test elements.');
          console.warn('The script will be disabled to prevent unstyled UI elements.');
          console.warn('Please ensure the CSS file is in the correct location and properly linked.');
          console.warn('CSS file should be at: C:\\Users\\One\\AppData\\Roaming\\zen\\Profiles\\bxthesda\\chrome\\zen-themes\\zen-tidy-downloads\\chrome.css');
          debugLog('[CSS Check] CSS detection failed', {
            foundCSSFile: foundTidyDownloadsCSS,
            tooltipPosition: tooltipStyle.position,
            tooltipBgColor: tooltipStyle.backgroundColor,
            tooltipBorderRadius: tooltipStyle.borderRadius,
            tooltipZIndex: tooltipStyle.zIndex,
            containerPosition: containerStyle.position,
            containerZIndex: containerStyle.zIndex,
            containerPointerEvents: containerStyle.pointerEvents,
            containerDisplay: containerStyle.display
          });
          return false;
        }
      } catch (error) {
        console.error('Download Preview Script: Error checking CSS availability:', error);
        console.warn('The script will be disabled as a safety measure.');
        return false;
      }
    }

    // SECURITY: Helper function to redact sensitive data from logs
    // Uses efficient regex patterns and avoids deep recursion issues
    function redactSensitiveData(data) {
      if (typeof data === 'string') {
        // Redact API keys and tokens (single pass with combined regex)
        return data
          .replace(/Bearer\s+[A-Za-z0-9_-]+/gi, 'Bearer [REDACTED]')
          .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9_-]+/gi, 'Authorization: Bearer [REDACTED]')
          .replace(/(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*[A-Za-z0-9_-]+/gi, '$1=[REDACTED]');
      }
      
      if (typeof data !== 'object' || data === null) {
        return data;
      }
      
      // Handle arrays
      if (Array.isArray(data)) {
        return data.map(item => redactSensitiveData(item));
      }
      
      // Handle objects with depth limit to prevent stack overflow
      const SENSITIVE_KEY_PATTERN = /(api|key|authorization|token|secret|password|credential)/i;
      const redacted = {};
      
      for (const key in data) {
        if (!data.hasOwnProperty(key)) continue;
        
        const value = data[key];
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          redacted[key] = '[REDACTED]';
        } else if (typeof value === 'string') {
          redacted[key] = redactSensitiveData(value);
        } else if (typeof value === 'object' && value !== null) {
          redacted[key] = redactSensitiveData(value);
        } else {
          redacted[key] = value;
        }
      }
      
      return redacted;
    }

    // Add debug logging function with Firefox preferences support
    function debugLog(message, data = null, category = 'general') {
      try {
        const debugEnabled = getPref("extensions.downloads.enable_debug", false);
        const debugAiOnly = getPref("extensions.downloads.debug_ai_only", true);
        
        if (!debugEnabled) return;
        if (debugAiOnly && category !== 'aiRename' && category !== 'general') return;
        
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] Download Preview [${category.toUpperCase()}]:`;
        
        // SECURITY: Redact sensitive data before logging
        const safeData = data ? redactSensitiveData(data) : null;
        const safeMessage = typeof message === 'string' ? redactSensitiveData(message) : message;
        
        if (safeData) {
          console.log(`${prefix} ${safeMessage}`, safeData);
        } else {
          console.log(`${prefix} ${safeMessage}`);
        }
      } catch (e) {
        // Fallback if preferences fail - still redact sensitive data
        const safeData = data ? redactSensitiveData(data) : null;
        const safeMessage = typeof message === 'string' ? redactSensitiveData(message) : message;
        console.log(`[Download Preview] ${safeMessage}`, safeData || '');
      }
    }

    // Improved key generation for downloads
    function getDownloadKey(download) {
      // Use target path as primary key since id is often undefined
      if (download?.target?.path) {
        return download.target.path;
      }
      if (download?.id) {
        return download.id;
      }
      // For failed downloads, generate a more stable key based on URL and start time
      const url = download?.source?.url || download?.url || "unknown";
      const startTime = download?.startTime || Date.now();
      const key = `temp_${url}_${startTime}`;
      
      debugLog(`[KeyGen] Generated temporary key for download without path/id`, { 
        key, 
        hasPath: !!download?.target?.path, 
        hasId: !!download?.id, 
        url, 
        error: !!download?.error,
        startTime 
      });
      
      return key;
    }

    // Get safe filename from download object
    function getSafeFilename(download) {
      // Try multiple sources for filename
      if (download.filename) return download.filename;
      if (download.target?.path) {
        return download.target.path.split(/[\\/]/).pop();
      }
      if (download.source?.url) {
        const url = download.source.url;
        const match = url.match(/\/([^\/\?]+)$/);
        if (match) return match[1];
      }
      return "Untitled";
    }

    // Robust initialization with CSS timing fix
    async function init() {
      console.log("=== DOWNLOAD PREVIEW SCRIPT STARTING ===");
      
      // Check if CSS check should be skipped (for debugging)
      const skipCSSCheck = getPref("extensions.downloads.skip_css_check", false);
      
      if (skipCSSCheck) {
        console.log("⚠️ CSS check skipped via preference - script will run without CSS validation");
        cssStylesAvailable = true;
      } else {
        // Wait for CSS to be fully loaded with retries
        cssStylesAvailable = await waitForCSSWithRetries();
        if (!cssStylesAvailable) {
          console.log("=== DOWNLOAD PREVIEW SCRIPT DISABLED (CSS NOT FOUND) ===");
          console.log("💡 To bypass this check temporarily, set extensions.downloads.skip_css_check = true in about:config");
          return; // Exit early if CSS is not available
        }
      }
      
      debugLog("Starting initialization");
      if (!window.Downloads?.getList) {
        console.error("Download Preview Mistral AI: Downloads API not available");
        aiRenamingPossible = false;
        return;
      }
      try {
        window.Downloads.getList(window.Downloads.ALL)
          .then(async (list) => {
            if (list) {
              debugLog("Downloads API verified");
              aiRenamingPossible = true; // Local AI is assumed to be available
              debugLog("AI renaming enabled - using Local AI");
              await initDownloadManager();
              initSidebarWidthSync(); // <-- ADDED: Call to initialize sidebar width syncing
              debugLog("Initialization complete");
            }
          })
          .catch((e) => {
            console.error("Downloads API verification failed:", e);
            aiRenamingPossible = false;
          });
      } catch (e) {
        console.error("Download Preview Mistral AI: Init failed", e);
        aiRenamingPossible = false;
      }
    }

    // Wait for ZenThemesImporter to finish loading themes
    async function waitForZenThemes(maxWaitMs = 5000) {
      console.log('[CSS Timing] Waiting for ZenThemesImporter to load themes...');
      
      const startTime = Date.now();
      
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          // Check if ZenThemesImporter has loaded by looking for a console message or DOM changes
          const stylesheets = Array.from(document.styleSheets);
          const hasZenThemeCSS = stylesheets.some(sheet => 
            sheet.href && sheet.href.includes('zen-tidy-downloads')
          );
          
          if (hasZenThemeCSS) {
            console.log('[CSS Timing] ✅ ZenThemesImporter has loaded Tidy Downloads theme');
            clearInterval(checkInterval);
            resolve(true);
            return;
          }
          
          // Timeout check
          if (Date.now() - startTime > maxWaitMs) {
            console.log('[CSS Timing] ⏰ Timeout waiting for ZenThemesImporter');
            clearInterval(checkInterval);
            resolve(false);
          }
        }, 100);
      });
    }

    // Wait for CSS to be properly loaded with retries
    async function waitForCSSWithRetries(maxRetries = 10, delayMs = 300) {
      console.log('[CSS Timing] Waiting for CSS to be fully loaded...');
      
      // First, wait for ZenThemesImporter to finish
      await waitForZenThemes();
      
      // Then wait a bit more for styles to be applied
      await new Promise(resolve => setTimeout(resolve, 500));
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[CSS Timing] Attempt ${attempt}/${maxRetries}`);
        
        const cssAvailable = checkCSSAvailability();
        if (cssAvailable) {
          console.log(`[CSS Timing] ✅ CSS detected on attempt ${attempt}`);
          return true;
        }
        
        if (attempt < maxRetries) {
          console.log(`[CSS Timing] CSS not ready, waiting ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          // Increase delay slightly for each retry
          delayMs += 100;
        }
      }
      
      console.log('[CSS Timing] ❌ CSS detection failed after all retries');
      return false;
    }



    // Wait for window load
    if (document.readyState === "complete") {
      init();
    } else {
      window.addEventListener("load", init, { once: true });
    }

    // Download manager UI and listeners
    async function initDownloadManager() {
      // Safety check - don't initialize if CSS is not available
      if (!cssStylesAvailable) {
        debugLog("Skipping download manager initialization - CSS not available");
        return;
      }
      
      // Add a delay to ensure CSS is fully applied before creating UI elements
      await new Promise(resolve => setTimeout(resolve, 300));
      debugLog("Creating download manager UI elements...");
      
      try {
        // Create container if it doesn't exist
        downloadCardsContainer = document.getElementById("userchrome-download-cards-container");
        if (!downloadCardsContainer) {
          downloadCardsContainer = document.createElement("div");
          downloadCardsContainer.id = "userchrome-download-cards-container";
          // Basic styles are now in CSS file, only dynamic overrides here if needed
          
          // IMPORTANT: Start completely hidden to prevent flashing
          downloadCardsContainer.style.display = "none";
          downloadCardsContainer.style.opacity = "0";
          downloadCardsContainer.style.visibility = "hidden";
          
          // Insert after media controls toolbar (same approach as zen-stuff pile)
          const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
          const zenMainAppWrapper = document.getElementById('zen-main-app-wrapper');
          
          let parentContainer = null;
          if (mediaControlsToolbar && mediaControlsToolbar.parentNode) {
            // Primary: insert after media controls toolbar (as sibling) - same as zen-stuff
            parentContainer = mediaControlsToolbar.parentNode;
            parentContainer.insertBefore(downloadCardsContainer, mediaControlsToolbar.nextSibling);
            debugLog("Inserted download cards container after zen-media-controls-toolbar");
          } else if (zenMainAppWrapper) {
            // Fallback: insert into zen-main-app-wrapper
            parentContainer = zenMainAppWrapper;
            zenMainAppWrapper.appendChild(downloadCardsContainer);
            debugLog("Inserted download cards container into zen-main-app-wrapper (fallback)");
          } else {
            // Final fallback: append to document.body
            parentContainer = document.body;
            document.body.appendChild(downloadCardsContainer);
            debugLog("Inserted download cards container into document.body (final fallback)");
          }
          
          // Ensure parent container has position: relative for absolute positioning
          if (parentContainer && parentContainer !== document.body) {
            const parentStyle = window.getComputedStyle(parentContainer);
            if (parentStyle.position === 'static') {
              parentContainer.style.position = 'relative';
              debugLog("Set parent container position to relative for absolute positioning");
            }
          }
          
          // Apply inline styles matching zen-stuff positioning (bottom: 35px, z-index: 4)
          downloadCardsContainer.style.cssText = `
            position: absolute;
            left: 5px;
            right: 5px;
            bottom: 35px;
            z-index: 4;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            pointer-events: none;
            box-sizing: border-box;
          `;
          
          // Set up compact mode observer
          setupCompactModeObserver();

          // Create the single master tooltip element (relative position for toolbar integration)
          masterTooltipDOMElement = document.createElement("div");
          masterTooltipDOMElement.className = "details-tooltip master-tooltip";
          // Ensure tooltip uses relative positioning (not fixed) for proper toolbar integration
          masterTooltipDOMElement.style.position = 'relative';
          // Most styles are now in CSS file, only dynamic styles remain inline

          masterTooltipDOMElement.innerHTML = `
            <div class="card-status">Tooltip Status</div>
            <div class="card-title">Tooltip Title</div>
            <div class="card-original-filename">Original Filename</div>
            <div class="card-progress">Tooltip Progress</div>
            <div class="card-filesize">File Size</div>
            <div class="tooltip-buttons-container">
              <span class="card-undo-button" title="Undo Rename" tabindex="0" role="button">
                ↩
              </span>
              <span class="card-close-button" title="Close" tabindex="0" role="button">✕</span>
            </div>
            <div class="tooltip-tail"></div>
          `;
          downloadCardsContainer.appendChild(masterTooltipDOMElement);

          // Create the container for HORIZONTAL pods row
          podsRowContainerElement = document.createElement("div"); 
          podsRowContainerElement.id = "userchrome-pods-row-container"; 
          // Basic styles are now in CSS file, only dynamic height will be set by layout manager
          downloadCardsContainer.appendChild(podsRowContainerElement);

          // Add mouse wheel scroll listener to the pods container for changing focus
          podsRowContainerElement.addEventListener('wheel', handlePodScrollFocus, { passive: false });
          
          // Add close handler for the master tooltip's close button AFTER creating podsRowContainerElement
          const masterCloseBtn = masterTooltipDOMElement.querySelector(".card-close-button");
          if (masterCloseBtn) {
            const masterCloseHandler = (e) => {
              e.preventDefault();
              e.stopPropagation();
              debugLog(`[MasterClose] Master close button clicked. FocusedDownloadKey: ${focusedDownloadKey}`);
              
              if (focusedDownloadKey) {
                const keyToRemove = focusedDownloadKey; // Capture the key
                const cardData = activeDownloadCards.get(keyToRemove);

                // Start tooltip hide animation immediately
                if (masterTooltipDOMElement) {
                  masterTooltipDOMElement.style.opacity = "0";
                  masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
                  masterTooltipDOMElement.style.pointerEvents = "none"; // Disable interactions when hidden
                  debugLog(`[MasterClose] Tooltip hide animation initiated for ${keyToRemove}`);
                }

                // Delay pod removal to allow tooltip to animate out
                setTimeout(async () => {
                  debugLog(`[MasterClose] Delayed action: proceeding to handle/remove card for ${keyToRemove}`);
                  if (cardData && cardData.download) {
                    try {
                      const download = cardData.download;
                      
                      // Check if download is in progress
                      if (!download.succeeded && !download.error && !download.canceled) {
                        // First click: Cancel the download but keep in UI
                        debugLog(`[MasterClose] First click: Cancelling in-progress download ${keyToRemove}`);
                        
                        // Cancel any active AI process first
                        await cancelAIProcessForDownload(keyToRemove);
                        
                        download.cancel();
                        
                        // Mark as user-canceled for UI state
                        cardData.userCanceled = true;
                        
                        // Update UI to show canceled state with resume option
                        updateUIForFocusedDownload(keyToRemove, true);
                        
                        // Don't remove from UI yet - let user see canceled state
                        return;
                      }
                      
                      // Check if this is a user-canceled download that can be resumed
                      if (download.canceled && cardData.userCanceled && !cardData.permanentlyDeleted) {
                        // Second click on canceled download: Permanently delete
                        debugLog(`[MasterClose] Second click: Permanently deleting canceled download ${keyToRemove}`);
                        await eraseDownloadFromHistory(download);
                        cardData.permanentlyDeleted = true;
                        debugLog(`[MasterClose] Successfully erased download from history: ${keyToRemove}`);
                        removeCard(keyToRemove, true);
                        return;
                      }
                      
                      // For completed downloads: just remove from UI, keep in browser history
                      if (download.succeeded) {
                        debugLog(`[MasterClose] Removing completed download from UI only (keeping in browser history): ${keyToRemove}`);
                        
                        // Cancel any active AI process before removal
                        await cancelAIProcessForDownload(keyToRemove);
                        
                        removeCard(keyToRemove, true);
                        return;
                      }
                      
                      // For errored downloads or already permanently deleted: delete from history
                      if (download.error || cardData.permanentlyDeleted) {
                        debugLog(`[MasterClose] Deleting errored download from history: ${keyToRemove}`);
                        await eraseDownloadFromHistory(download);
                        debugLog(`[MasterClose] Successfully erased download from history: ${keyToRemove}`);
                        removeCard(keyToRemove, true);
                        return;
                      }
                      
                    } catch (error) {
                      debugLog(`[MasterClose] Error handling download ${keyToRemove}:`, error);
                      // On error, still remove from UI
                      removeCard(keyToRemove, true);
                    }
                  } else {
                    debugLog(`[MasterClose] No cardData found for ${keyToRemove} during delayed action. Cannot remove.`);
                  }
                }, 300); // Corresponds to tooltip animation duration
              }
            };
            masterCloseBtn.addEventListener("click", masterCloseHandler);
            masterCloseBtn.addEventListener("keydown", (e) => {
              if ((e.key === "Enter" || e.key === " ") && focusedDownloadKey) {
                e.preventDefault();
                masterCloseHandler(e);
              }
            });
          }

          // Add undo/resume handler for the master tooltip's undo button
          const masterUndoBtn = masterTooltipDOMElement.querySelector(".card-undo-button");
          if (masterUndoBtn) {
              const masterUndoHandler = async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  debugLog(`[MasterUndo] Master undo/resume button clicked. FocusedDownloadKey: ${focusedDownloadKey}`);
                  
                  if (focusedDownloadKey) {
                      const cardData = activeDownloadCards.get(focusedDownloadKey);
                      const download = cardData?.download;
                      
                      // Check if this is a user-canceled download (resume mode)
                      if (download?.canceled && cardData?.userCanceled && !cardData?.permanentlyDeleted) {
                          debugLog(`[MasterUndo] Resuming canceled download: ${focusedDownloadKey}`);
                          try {
                              // Resume the download
                              download.start();
                              
                              // Clear the user-canceled flag
                              cardData.userCanceled = false;
                              
                              // Update UI to show downloading state
                              updateUIForFocusedDownload(focusedDownloadKey, true);
                              
                          } catch (resumeError) {
                              debugLog(`[MasterUndo] Error resuming download ${focusedDownloadKey}:`, resumeError);
                              
                              // If resume fails, try to restart the download
                              try {
                                  const sourceUrl = download.source?.url;
                                  if (sourceUrl) {
                                      debugLog(`[MasterUndo] Resume failed, attempting to restart download from: ${sourceUrl}`);
                                      
                                      // Remove the failed download first
                                      await eraseDownloadFromHistory(download);
                                      removeCard(focusedDownloadKey, true);
                                      
                                      // Start a new download
                                      const newDownload = await window.Downloads.createDownload({
                                          source: sourceUrl,
                                          target: download.target.path
                                      });
                                      newDownload.start();
                                      
                                  } else {
                                      debugLog(`[MasterUndo] Cannot restart - no source URL available`);
                                  }
                              } catch (restartError) {
                                  debugLog(`[MasterUndo] Error restarting download:`, restartError);
                              }
                          }
                      } else {
                          // Regular undo rename functionality
                          await undoRename(focusedDownloadKey);
                          // UI update is handled within undoRename via updateUIForFocusedDownload
                      }
                  }
              };
              masterUndoBtn.addEventListener("click", masterUndoHandler);
              masterUndoBtn.addEventListener("keydown", async (e) => {
                  if ((e.key === "Enter" || e.key === " ") && focusedDownloadKey) {
                      e.preventDefault();
                      await masterUndoHandler(e); // Make sure to await if handler is async
                  }
              });
          }

        }

        // Attach listeners
        let downloadListener = {
          onDownloadAdded: (dl) => throttledCreateOrUpdateCard(dl),
          onDownloadChanged: (dl) => throttledCreateOrUpdateCard(dl),
          onDownloadRemoved: async (dl) => {
            const key = getDownloadKey(dl);
            await cancelAIProcessForDownload(key); // Cancel any AI process first
            await removeCard(key, false);
            
            // Notify listeners that a download was actually removed from Firefox's list
            actualDownloadRemovedEventListeners.forEach(callback => {
              try {
                callback(key);
              } catch (error) {
                debugLog('[API Event] Error in actualDownloadRemoved callback:', error);
              }
            });
            fireCustomEvent('actual-download-removed', { podKey: key });
            debugLog(`[API Event] Fired actual-download-removed for key: ${key}`);
          },
        };

        window.Downloads.getList(window.Downloads.ALL)
          .then((list) => {
            list.addView(downloadListener);
            list.getAll().then((all) => {
              // Filter out old completed downloads to prevent them from reappearing
              const recentDownloads = all.filter(dl => {
                const key = getDownloadKey(dl);
                
                // Skip dismissed downloads only if they're completed AND not currently in our active cards
                // This prevents old completed downloads from reappearing, but allows active downloads to be processed
                // even if they were previously dismissed
                if (dismissedDownloads.has(key) && !activeDownloadCards.has(key)) {
                  // Only skip if the download is in a completed state (succeeded, error, or canceled)
                  const isCompleted = dl.succeeded || dl.error || dl.canceled;
                  if (isCompleted) {
                    debugLog(`[CreatePod] Skipping dismissed completed download: ${key} (succeeded: ${dl.succeeded}, error: ${!!dl.error}, canceled: ${dl.canceled})`);
                    return null;
                  } else {
                    // This is an active download that was previously dismissed - allow it to show
                    debugLog(`[CreatePod] Allowing dismissed but active download to show: ${key} (still downloading)`);
                  }
                }
                
                // Only show recent downloads or currently active ones
                if (dl.succeeded || dl.error || dl.canceled) {
                  const downloadTime = new Date(dl.startTime || 0);
                  const hoursSinceDownload = (Date.now() - downloadTime.getTime()) / (1000 * 60 * 60);
                  
                  // Only show completed downloads from the configured time window
                  const showOldDownloadsHours = getPref("extensions.downloads.show_old_downloads_hours", 2);
                  if (hoursSinceDownload > showOldDownloadsHours) {
                    debugLog(`[Init] Skipping old completed download: ${key} (${hoursSinceDownload.toFixed(1)}h old)`);
                    dismissedDownloads.add(key); // Mark as dismissed to prevent future reappearance
                    return false;
                  }
                }
                
                return true;
              });
              
              debugLog(`[Init] Processing ${recentDownloads.length} recent downloads out of ${all.length} total`);
              recentDownloads.forEach((dl) => {
                throttledCreateOrUpdateCard(dl, true);
              });
            });
          })
          .catch((e) => console.error("DL Preview Mistral AI: List error:", e));
      } catch (e) {
        console.error("DL Preview Mistral AI: Init error", e);
      }
    }

    // Throttled update to prevent rapid calls
    function throttledCreateOrUpdateCard(download, isNewCardOnInit = false) {
      // Safety check - don't process downloads if CSS is not available
      if (!cssStylesAvailable) {
        return;
      }
      
      const key = getDownloadKey(download);
      const now = Date.now();
      const lastUpdate = cardUpdateThrottle.get(key) || 0;
      
      // More aggressive throttling for in-progress downloads to reduce UI churn
      const progressThrottleMs = getPref("extensions.downloads.progress_update_throttle_ms", 500);
      const throttleDelay = (!download.succeeded && !download.error && !download.canceled) ? progressThrottleMs : 100;
      if (now - lastUpdate < throttleDelay && !isNewCardOnInit) {
        debugLog(`[Throttle] Skipping throttled update for download: ${key} (delay: ${throttleDelay}ms)`);
        return;
      }
      
      cardUpdateThrottle.set(key, now);
      debugLog(`[Throttle] Calling createOrUpdatePodElement for key: ${key}, isNewOnInit: ${isNewCardOnInit}, error: ${!!download.error}, succeeded: ${!!download.succeeded}, canceled: ${!!download.canceled}`);
      const podElement = createOrUpdatePodElement(download, isNewCardOnInit);
      if (podElement) {
        debugLog(`[Throttle] Pod element created/updated for ${key}.`);
        // Only trigger UI update if this is the focused download or if it's a significant state change
        if (key === focusedDownloadKey || download.succeeded || download.error || download.canceled || isNewCardOnInit) {
          updateUIForFocusedDownload(focusedDownloadKey || key, true);
        }
      } else {
        debugLog(`[Throttle] No pod element returned for ${key}. Download state:`, { 
          succeeded: download.succeeded, 
          error: !!download.error, 
          canceled: download.canceled,
          hasKey: !!key 
        });
      }
    }

    // Function to create or update a download POD element
    function createOrUpdatePodElement(download, isNewCardOnInit = false) {
      // Safety check - don't create UI elements if CSS is not available
      if (!cssStylesAvailable) {
        return null;
      }
      
      const key = getDownloadKey(download);
      if (!key) {
        debugLog("Skipping download object without usable key", download);
        return null;
      }

      // Skip dismissed downloads only if they're not currently in our active cards
      // This prevents old downloads from reappearing, but allows current downloads to be processed
      if (dismissedDownloads.has(key) && !activeDownloadCards.has(key)) {
        debugLog(`[CreatePod] Skipping dismissed download that's not currently active: ${key}`);
        return null;
      }

          // Smart Replace: Handle new download replacing canceled one
      // First check for exact key match
      let existingCardData = activeDownloadCards.get(key);
      let existingKey = key;
      
      // If no exact match, check for similar files (same base name with different numbering)
      if (!existingCardData && download.target?.path) {
        const newPath = download.target.path;
        const newBaseName = newPath.replace(/\(\d+\)(\.[^.]+)?$/, '$1'); // Remove (1), (2), etc.
        
        debugLog(`[SmartReplace] Checking for similar downloads. New path: ${newPath}, base: ${newBaseName}`);
        
        for (const [cardKey, cardData] of activeDownloadCards) {
          if (cardData.download?.target?.path) {
            const existingPath = cardData.download.target.path;
            const existingBaseName = existingPath.replace(/\(\d+\)(\.[^.]+)?$/, '$1');
            
            debugLog(`[SmartReplace] Comparing with existing: ${existingPath}, base: ${existingBaseName}, canceled: ${cardData.download.canceled}, userCanceled: ${cardData.userCanceled}`);
            
            // Check if base names match (same file, different numbering)
            if (newBaseName === existingBaseName && cardKey !== key) {
              const isExistingCanceled = cardData.download.canceled && cardData.userCanceled;
              if (isExistingCanceled) {
                existingCardData = cardData;
                existingKey = cardKey;
                debugLog(`[SmartReplace] Found similar canceled download: ${existingKey} -> ${key}`);
                break;
              }
            }
          }
        }
      }
      
      if (existingCardData && existingCardData.download) {
        const existingDownload = existingCardData.download;
        const isExistingCanceled = existingDownload.canceled && existingCardData.userCanceled;
        const isNewDownloadFresh = !download.canceled && !download.succeeded && !download.error;
        
              if (isExistingCanceled && isNewDownloadFresh) {
        debugLog(`[SmartReplace] Replacing canceled download with new attempt: ${existingKey} -> ${key}`);
        
        // If we're replacing a different key, we need to handle the transition
        const isDifferentKey = existingKey !== key;
        
        if (isDifferentKey) {
          // Remove the old card from activeDownloadCards and orderedPodKeys
          activeDownloadCards.delete(existingKey);
          const oldIndex = orderedPodKeys.indexOf(existingKey);
          if (oldIndex !== -1) {
            orderedPodKeys.splice(oldIndex, 1);
          }
          
          // Update focus if the old key was focused
          if (focusedDownloadKey === existingKey) {
            focusedDownloadKey = key;
          }
          
          // Transfer the card data to the new key
          activeDownloadCards.set(key, existingCardData);
          orderedPodKeys.push(key);
        }
        
        // Show brief replacement status if this is the focused download
        if (key === focusedDownloadKey && masterTooltipDOMElement) {
          const statusEl = masterTooltipDOMElement.querySelector(".card-status");
          if (statusEl) {
            statusEl.textContent = "Replacing canceled download...";
            statusEl.style.color = "#54a0ff";
            
            // Clear the replacement message after a brief moment
            setTimeout(() => {
              if (statusEl.textContent === "Replacing canceled download...") {
                // Let the normal UI update handle setting the correct status
                updateUIForFocusedDownload(key, true);
              }
            }, 1500);
          }
        }
        
        // Cancel any active AI process for the old download
        cancelAIProcessForDownload(existingKey).catch(e => 
          debugLog(`[SmartReplace] Error canceling AI for replaced download: ${e}`)
        );
        
        // Clear user-canceled flag and update download object
        existingCardData.userCanceled = false;
        existingCardData.permanentlyDeleted = false;
        existingCardData.complete = false; // Reset completion status
        existingCardData.download = download; // Replace with new download object
        
        // Reset original filename to the new download's filename
        existingCardData.originalFilename = getSafeFilename(download);
        existingCardData.trueOriginalPathBeforeAIRename = null;
        existingCardData.trueOriginalSimpleNameBeforeAIRename = null;
        
        // Clear any autohide timeout since this is a fresh start
        if (existingCardData.autohideTimeoutId) {
          clearTimeout(existingCardData.autohideTimeoutId);
          existingCardData.autohideTimeoutId = null;
        }
        
        // Update pod styling to reflect new state
        if (existingCardData.podElement) {
          existingCardData.podElement.classList.remove("canceled", "error", "completed", "renamed-by-ai", "renaming-initiated", "renaming-active");
          // Reset any AI-related state
        }
        
        // Remove from renamedFiles set if it was there from a previous attempt
        if (download.target?.path) {
          renamedFiles.delete(download.target.path);
        }
        if (existingDownload.target?.path) {
          renamedFiles.delete(existingDownload.target.path);
        }
        
        debugLog(`[SmartReplace] Successfully replaced canceled download with new attempt: ${existingKey} -> ${key}`);
        
        // Trigger immediate UI update to show the replacement status
        setTimeout(() => {
          updateUIForFocusedDownload(key, true);
        }, 100);
        
        // Return early since we've handled the replacement
        return existingCardData.podElement;
      }
    }

    debugLog("[PodFUNC] createOrUpdatePodElement called", { 
      key, 
      state: download.state, 
      currentBytes: download.currentBytes,
      succeeded: download.succeeded,
      error: !!download.error,
      errorMessage: download.error?.message,
      canceled: download.canceled,
      hasTargetPath: !!download?.target?.path,
      hasId: !!download?.id,
      isNewCardOnInit
    });

    let cardData = activeDownloadCards.get(key);
    const safeFilename = getSafeFilename(download);
    // const displayName = download.aiName || safeFilename; // Display name will be handled by master tooltip

    let podElement;
    let isNewPod = false;

    if (!cardData) {
      isNewPod = true;
      podElement = document.createElement("div");
      podElement.className = "download-pod"; 
      podElement.id = `download-pod-${key.replace(/[^a-zA-Z0-9_]/g, '-')}`;
      podElement.dataset.downloadKey = key;

      // Basic styles are now in CSS file, only dynamic positioning/animation styles remain inline

      podElement.innerHTML = `
        <div class="card-preview-container">
          <!-- Preview content (image, text snippet, or icon) will go here -->
          </div>
        `;

      // Add event listeners to the pod itself (e.g., for hover to focus, click to open)
      // Commenting out the mouseenter listener to disable hover-to-focus
      /*
      podElement.addEventListener('mouseenter', () => {
        const keyFromPodHover = podElement.dataset.downloadKey; // Get key from dataset
        debugLog(`[PodHover] Mouseenter on pod. Key: ${keyFromPodHover}, Current Focused: ${focusedDownloadKey}`);
        
        const previewContainer = podElement.querySelector('.card-preview-container');
        if (previewContainer && previewContainer.style.pointerEvents === 'none') {
            debugLog(`[PodHover] Pointer events none on preview for ${keyFromPodHover}, not changing focus.`);
            return; 
        }
        
        if (focusedDownloadKey !== keyFromPodHover) {
            debugLog(`[PodHover] Focus will change from ${focusedDownloadKey} to ${keyFromPodHover}. Calling updateUIForFocusedDownload.`);
            updateUIForFocusedDownload(keyFromPodHover, false); // isNewOrSignificantUpdate is false for hover
        } else {
            debugLog(`[PodHover] Pod ${keyFromPodHover} is already focused. No UI update call needed from hover.`);
        }
      });
      */

      const previewContainer = podElement.querySelector(".card-preview-container");
      if (previewContainer) {
        setGenericIcon(previewContainer, download.contentType || "application/octet-stream");
        previewContainer.title = "Click to open file";
        
        previewContainer.addEventListener("click", (e) => {
          e.stopPropagation(); 
          const currentCardData = activeDownloadCards.get(podElement.dataset.downloadKey);
          if (currentCardData && currentCardData.download) {
            openDownloadedFile(currentCardData.download);
            } else {
            debugLog("openDownloadedFile: Card data not found for pod, attempting with initial download object", { key: podElement.dataset.downloadKey });
            openDownloadedFile(download); 
            }
          });
        }

        cardData = {
        podElement, // Renamed from cardElement
          download,
          complete: false,
          key: key,
          originalFilename: safeFilename, // This is the filename as of pod creation/update
          trueOriginalPathBeforeAIRename: null, // Will store the full path before AI rename
          trueOriginalSimpleNameBeforeAIRename: null, // Will store just the simple filename before AI rename
        lastInteractionTime: Date.now(),
        isVisible: false, // Will be set by layout manager
        isWaitingForZenAnimation: false, // Default, will be set true if new and Zen sync is active
        domAppended: false, // New flag: has this pod been added to podsRowContainerElement?
        intendedTargetTransform: null, // For stable animation triggering
        intendedTargetOpacity: null,   // For stable animation triggering
        isBeingRemoved: false          // To prevent layout conflicts during removal
        };
        activeDownloadCards.set(key, cardData);

      // Add to ordered list (newest at the end)
      if (!orderedPodKeys.includes(key)) {
        orderedPodKeys.push(key);
        
        // Show the container when we add the first pod (respects compact mode)
        if (orderedPodKeys.length === 1) {
          updateDownloadCardsVisibility();
          if (downloadCardsContainer && downloadCardsContainer.style.display !== 'none') {
            hideMediaControlsToolbar(); // Hide media controls when showing download pods
          }
        }
        
        // Focus behavior based on stable_focus_mode preference
        const stableFocusMode = getPref("extensions.downloads.stable_focus_mode", true);
        const currentFocusedData = focusedDownloadKey ? activeDownloadCards.get(focusedDownloadKey) : null;
        const currentFocusedDownload = currentFocusedData?.download;
        
        if (!focusedDownloadKey) {
          // Always focus if no current focus
          focusedDownloadKey = key;
          debugLog(`[PodFUNC] New pod created, setting as focused (no current focus): ${key}. Total pods: ${orderedPodKeys.length}`);
        } else if (!stableFocusMode) {
          // In non-stable mode, always switch to newest
          focusedDownloadKey = key;
          debugLog(`[PodFUNC] New pod created, setting as focused (non-stable mode): ${key}. Total pods: ${orderedPodKeys.length}`);
        } else if (download.succeeded) {
          // Completed downloads always take focus
          focusedDownloadKey = key;
          debugLog(`[PodFUNC] New pod created, setting as focused (completed download): ${key}. Total pods: ${orderedPodKeys.length}`);
        } else if (currentFocusedDownload && (currentFocusedDownload.succeeded || currentFocusedDownload.error || currentFocusedDownload.canceled)) {
          // If current focus is on a finished download, switch to the new active one
          focusedDownloadKey = key;
          debugLog(`[PodFUNC] New pod created, setting as focused (current focus was finished): ${key}. Previous: ${focusedDownloadKey}`);
        } else {
          // In stable mode, keep current focus for in-progress downloads when current is also in-progress
          debugLog(`[PodFUNC] New pod created but keeping current focus on: ${focusedDownloadKey}. New pod: ${key} (stable focus mode - both in progress)`);
        }
      } else {
        debugLog(`[PodFUNC] Pod ${key} already exists in orderedPodKeys. Current focus: ${focusedDownloadKey}`);
      }

      // If it's a truly new pod, set up Zen animation observation.
      // The actual appending to DOM and animation will be handled by managePodVisibilityAndAnimations
      // after Zen animation observer confirms or times out.
      if (isNewPod) { 
        // Check if the pod element for this key is already in the DOM (e.g. from a previous session / script reload)
        // This check helps avoid re-observing for an already existing element.
        let existingDOMPod = null;
        if (podsRowContainerElement) { // Renamed back
            existingDOMPod = podsRowContainerElement.querySelector(`#${podElement.id}`); // Renamed back
        }

        if (!existingDOMPod) {
            debugLog(`[PodFUNC] New pod ${key}, setting up Zen animation observer.`);
            cardData.isWaitingForZenAnimation = true;
            initZenAnimationObserver(key, podElement); // Pass podElement for eventual append
    } else {
            debugLog(`[PodFUNC] Pod ${key} DOM element already exists, skipping Zen observer setup. Will be laid out.`);
            cardData.domAppended = true; // It's already in the DOM
            // Ensure it starts invisible if it was an orphan, layout manager will reveal
            podElement.style.opacity = '0'; 
            cardData.isVisible = false;
        }
      } // else, it's an update to an existing pod, no need for Zen animation sync.

      // Append to the horizontal row container
      // The actual animation trigger will be handled by updateUIForFocusedDownload or Zen sync
      if (podsRowContainerElement && !podElement.parentNode) {
        podsRowContainerElement.appendChild(podElement);
        cardData.domAppended = true; // Mark as appended to DOM
      }

    } else {
      // Update existing pod data
      podElement = cardData.podElement;
      cardData.download = download; 
      cardData.lastInteractionTime = Date.now(); // Update interaction time on any change event
      if (safeFilename !== cardData.originalFilename && !download.aiName) {
         cardData.originalFilename = safeFilename; // Update if original name changes (e.g. server sent a different name later)
      }
      
      // Update completion status for existing pods
      if (download.succeeded && !cardData.complete) {
        cardData.complete = true;
        cardData.userCanceled = false; // Clear user-canceled flag on successful completion
        podElement.classList.add("completed"); // For potential styling
        debugLog(`[PodFUNC] Existing pod marked as complete: ${key}`);
        
        // Add to AI rename queue for existing completed pods
        const aiRenamingEnabled = getPref("extensions.downloads.enable_ai_renaming", true);
        debugLog(`[PodFUNC] Checking AI rename eligibility for ${key}:`, {
          aiRenamingEnabled,
          aiRenamingPossible,
          hasPath: !!download.target?.path,
          path: download.target?.path,
          alreadyRenamed: renamedFiles.has(download.target?.path)
        });
        
        if (aiRenamingEnabled && aiRenamingPossible && download.target?.path && 
            !renamedFiles.has(download.target.path)) {
          // Small delay to ensure download is fully settled before queuing
          // Use cardData.download to ensure we have the latest download object
          setTimeout(() => {
            const currentCardData = activeDownloadCards.get(key);
            if (currentCardData && currentCardData.download) {
              debugLog(`[PodFUNC] Adding ${key} to AI rename queue after delay`);
              addToAIRenameQueue(key, currentCardData.download, currentCardData.originalFilename);
            } else {
              debugLog(`[PodFUNC] Cannot add ${key} to queue - cardData missing after delay`);
            }
          }, 1000);
        } else {
          debugLog(`[PodFUNC] Not adding ${key} to AI rename queue - conditions not met`);
        }
        
        // Schedule autohide after configured delay for completed downloads
        scheduleCardRemoval(key);
      }
    }

    // Update pod preview content based on download state (icon, image, text snippet)
    const previewElement = podElement.querySelector(".card-preview-container");
    if (previewElement) {
        if (download.succeeded) {
            // Always try to set preview for completed downloads (in case it failed before)
            debugLog(`[Preview] Setting completed file preview for: ${key}`);
            setCompletedFilePreview(previewElement, download)
                .catch(e => debugLog("Error setting completed file preview (async) for pod", {error: e, download}));
        } else if (download.error || download.canceled) {
            // Potentially set a different icon for error/cancel state on the pod itself
            setGenericIcon(previewElement, "application/octet-stream"); // Default or error specific icon
        } else {
            // In-progress, could have a spinner or animated icon on the pod
            // For now, generic icon remains until completion, set at creation.
        }
    }
    
    // Mark as complete internally
    if (download.succeeded && !cardData.complete) {
      cardData.complete = true;
      cardData.userCanceled = false; // Clear user-canceled flag on successful completion
      podElement.classList.add("completed"); // For potential styling
      debugLog(`[PodFUNC] Download marked as complete: ${key}`);
      
      // Add to AI rename queue for ALL completed downloads (not just focused)
      // This ensures proper FIFO processing regardless of focus state
      const aiRenamingEnabled = getPref("extensions.downloads.enable_ai_renaming", true);
      debugLog(`[PodFUNC] Checking AI rename eligibility for ${key} (new pod):`, {
        aiRenamingEnabled,
        aiRenamingPossible,
        hasPath: !!download.target?.path,
        path: download.target?.path,
        alreadyRenamed: renamedFiles.has(download.target?.path)
      });
      
      if (aiRenamingEnabled && aiRenamingPossible && download.target?.path && 
          !renamedFiles.has(download.target.path)) {
        // Small delay to ensure download is fully settled before queuing
        // Use cardData.download to ensure we have the latest download object
        setTimeout(() => {
          const currentCardData = activeDownloadCards.get(key);
          if (currentCardData && currentCardData.download) {
            debugLog(`[PodFUNC] Adding ${key} to AI rename queue after delay (new pod)`);
            addToAIRenameQueue(key, currentCardData.download, currentCardData.originalFilename);
          } else {
            debugLog(`[PodFUNC] Cannot add ${key} to queue - cardData missing after delay (new pod)`);
          }
        }, 1000);
      } else {
        debugLog(`[PodFUNC] Not adding ${key} to AI rename queue - conditions not met (new pod)`);
      }
      
      // Schedule autohide after configured delay for completed downloads
      scheduleCardRemoval(key);
    }
    if (download.error) {
      podElement.classList.add("error");
      // Schedule autohide for error downloads
      scheduleCardRemoval(key);
    }
    if (download.canceled) {
      podElement.classList.add("canceled");
      // Schedule autohide for canceled downloads (unless user-canceled for resume)
      if (!cardData.userCanceled) {
        scheduleCardRemoval(key);
      }
    }

    return podElement;
  }

  // This will be a new, complex function. For now, a placeholder.
  function updateUIForFocusedDownload(keyToFocus, isNewOrSignificantUpdate = false) {
    // Safety check - don't update UI if CSS is not available
    if (!cssStylesAvailable) {
      return;
    }
    
    debugLog(`[UIUPDATE_TOP] updateUIForFocusedDownload called. keyToFocus: ${keyToFocus}, isNewOrSignificantUpdate: ${isNewOrSignificantUpdate}, current focusedDownloadKey: ${focusedDownloadKey}`);
    
    const oldFocusedKey = focusedDownloadKey;
    focusedDownloadKey = keyToFocus; 
    debugLog(`[UIUPDATE_FOCUS_SET] focusedDownloadKey is NOW: ${focusedDownloadKey}`);

    const cardDataToFocus = focusedDownloadKey ? activeDownloadCards.get(focusedDownloadKey) : null;

    if (!masterTooltipDOMElement) {
        debugLog("[UIUPDATE_ERROR] Master tooltip DOM element not found. Cannot update UI.");
        return; // Critical error, cannot proceed
    }

    if (!cardDataToFocus || !cardDataToFocus.podElement) {
      debugLog(`[UIUPDATE_NO_CARD_DATA] No card data or podElement for key ${focusedDownloadKey}. Hiding master tooltip. CardData:`, cardDataToFocus);
      masterTooltipDOMElement.style.opacity = "0";
      masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
      masterTooltipDOMElement.style.pointerEvents = "none";
      // Show media controls if no pods are visible
      if (orderedPodKeys.length === 0) {
        showMediaControlsToolbar();
      }
    } else {
      // cardDataToFocus and podElement are valid, proceed with UI updates for tooltip and AI.
      masterTooltipDOMElement.style.display = "flex"; 

      if (oldFocusedKey !== focusedDownloadKey || isNewOrSignificantUpdate) {
          debugLog(`[UIUPDATE_TOOLTIP_RESET] Focus changed or significant update. Resetting tooltip for animation for ${focusedDownloadKey}. Old focus: ${oldFocusedKey}`);
          masterTooltipDOMElement.style.opacity = "0"; 
          masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
          masterTooltipDOMElement.style.pointerEvents = "none";
      }

      const download = cardDataToFocus.download; 
      const podElement = cardDataToFocus.podElement; 

      if (!download) {
        debugLog(`[UIUPDATE_ERROR] cardDataToFocus for key ${focusedDownloadKey} is valid, but its .download property is undefined. Cannot update tooltip content or AI.`);
        // Keep tooltip hidden or show a generic error if it was supposed to be visible
        if (masterTooltipDOMElement.style.opacity !== '0') {
             masterTooltipDOMElement.style.opacity = "0";
             masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
             masterTooltipDOMElement.style.pointerEvents = "none";
        }
      } else {
        // Both cardDataToFocus, podElement, AND download object are valid. Proceed with detailed updates.

        // 0. Ensure completion status is up to date
        if (download.succeeded && !cardDataToFocus.complete) {
          cardDataToFocus.complete = true;
          cardDataToFocus.userCanceled = false;
          podElement.classList.add("completed");
          debugLog(`[UIUPDATE] Download marked as complete during UI update: ${focusedDownloadKey}`);
          
          // Add to AI rename queue when completion is detected in UI update
          const aiRenamingEnabled = getPref("extensions.downloads.enable_ai_renaming", true);
          debugLog(`[UIUPDATE] Checking AI rename eligibility for ${focusedDownloadKey}:`, {
            aiRenamingEnabled,
            aiRenamingPossible,
            hasPath: !!download.target?.path,
            path: download.target?.path,
            alreadyRenamed: renamedFiles.has(download.target?.path)
          });
          
          if (aiRenamingEnabled && aiRenamingPossible && download.target?.path && 
              !renamedFiles.has(download.target.path)) {
            // Small delay to ensure download is fully settled before queuing
            setTimeout(() => {
              const currentCardData = activeDownloadCards.get(focusedDownloadKey);
              if (currentCardData && currentCardData.download) {
                debugLog(`[UIUPDATE] Adding ${focusedDownloadKey} to AI rename queue after delay`);
                addToAIRenameQueue(focusedDownloadKey, currentCardData.download, currentCardData.originalFilename);
              } else {
                debugLog(`[UIUPDATE] Cannot add ${focusedDownloadKey} to queue - cardData missing after delay`);
              }
            }, 1000);
          } else {
            debugLog(`[UIUPDATE] Not adding ${focusedDownloadKey} to AI rename queue - conditions not met`);
          }
          
          scheduleCardRemoval(focusedDownloadKey);
          
          // Set image preview for completed downloads
          const previewElement = podElement.querySelector(".card-preview-container");
          if (previewElement) {
            debugLog(`[UIUPDATE] Setting completed file preview for: ${focusedDownloadKey}`);
            setCompletedFilePreview(previewElement, download)
              .catch(e => debugLog("Error setting completed file preview during UI update", {error: e, download}));
          }
        }

        // 1. Update masterTooltipDOMElement content
        const titleEl = masterTooltipDOMElement.querySelector(".card-title");
        const statusEl = masterTooltipDOMElement.querySelector(".card-status");
        const progressEl = masterTooltipDOMElement.querySelector(".card-progress");
        const originalFilenameEl = masterTooltipDOMElement.querySelector(".card-original-filename");
        const undoBtnEl = masterTooltipDOMElement.querySelector(".card-undo-button"); // Get the undo button

        const displayName = download.aiName || cardDataToFocus.originalFilename || "File";
        
        if (titleEl) {
          titleEl.textContent = displayName;
          titleEl.title = displayName;
        }

        if (statusEl && originalFilenameEl && progressEl && undoBtnEl) { // Include undoBtnEl in the check
            if (download.aiName && download.succeeded) {
                // AI Renamed State
                let finalSize = download.currentBytes;
                if (!(typeof finalSize === 'number' && finalSize > 0)) finalSize = download.totalBytes;
                const fileSizeText = formatBytes(finalSize || 0);
                
                // Always show file size in bottom right corner for renamed files
                const fileSizeEl = masterTooltipDOMElement.querySelector(".card-filesize");
                statusEl.textContent = "Download renamed to:";
                if (fileSizeEl) {
                    fileSizeEl.textContent = fileSizeText;
                    fileSizeEl.style.display = "block";
                }
                statusEl.style.color = "#a0a0a0"; 

                originalFilenameEl.textContent = cardDataToFocus.originalFilename; 
                originalFilenameEl.title = cardDataToFocus.originalFilename;
                originalFilenameEl.style.display = "block";

                progressEl.style.display = "none"; 
                undoBtnEl.style.display = "inline-flex"; // Show undo button
            } else if (download.canceled && cardDataToFocus.userCanceled && !cardDataToFocus.permanentlyDeleted) {
                // User-canceled state with resume option
                statusEl.textContent = "Download canceled";
                statusEl.style.color = "#ff9f43";
                
                originalFilenameEl.style.display = "none";
                progressEl.style.display = "block";
                
                // Hide the bottom-right file size element in canceled state
                const fileSizeEl = masterTooltipDOMElement.querySelector(".card-filesize");
                if (fileSizeEl) fileSizeEl.style.display = "none";
                
                // Use undo button as resume button
                undoBtnEl.style.display = "inline-flex";
                undoBtnEl.title = "Resume download";
                
                // Update the SVG to a play/resume icon
                const svgIcon = undoBtnEl.querySelector("svg");
                if (svgIcon) {
                    const pathIcon = svgIcon.querySelector("path");
                    if (pathIcon) {
                        // Play/Resume icon path (even larger, scaled for 52x52 viewBox)
                        pathIcon.setAttribute("d", "M12 6v40l32-20z");
                    }
                }
            } else {
                // Default states (downloading, completed normally, error, canceled)
                originalFilenameEl.style.display = "none"; 
                progressEl.style.display = "block";    
                undoBtnEl.style.display = "none"; // Hide undo button
                
                // Hide the bottom-right file size element in non-renamed states
                const fileSizeEl = masterTooltipDOMElement.querySelector(".card-filesize");
                if (fileSizeEl) fileSizeEl.style.display = "none";
                
                // Reset undo button to original undo icon and title
                undoBtnEl.title = "Undo Rename";
                const svgIcon = undoBtnEl.querySelector("svg");
                if (svgIcon) {
                    const pathIcon = svgIcon.querySelector("path");
                    if (pathIcon) {
                        // Original undo icon path
                        pathIcon.setAttribute("d", "M30.3,12.6c10.4,0,18.9,8.4,18.9,18.9s-8.5,18.9-18.9,18.9h-8.2c-0.8,0-1.3-0.6-1.3-1.4v-3.2c0-0.8,0.6-1.5,1.4-1.5h8.1c7.1,0,12.8-5.7,12.8-12.8s-5.7-12.8-12.8-12.8H16.4c0,0-0.8,0-1.1,0.1c-0.8,0.4-0.6,1,0.1,1.7l4.9,4.9c0.6,0.6,0.5,1.5-0.1,2.1L18,29.7c-0.6,0.6-1.3,0.6-1.9,0.1l-13-13c-0.5-0.5-0.5-1.3,0-1.8L16,2.1c0.6-0.6,1.6-0.6,2.1,0l2.1,2.1c0.6,0.6,0.6,1.6,0,2.1l-4.9,4.9c-0.6,0.6-0.6,1.3,0.4,1.3c0.3,0,0.7,0,0.7,0L30.3,12.6z");
                    }
                }

      if (download.error) {
                    statusEl.textContent = `Error: ${download.error.message || "Download failed"}`;
                    statusEl.style.color = "#ff6b6b";
      } else if (download.canceled) {
                    statusEl.textContent = "Download canceled";
                    statusEl.style.color = "#ff9f43";
      } else if (download.succeeded) {
                    statusEl.textContent = "Download completed";
                    statusEl.style.color = "#1dd1a1";
                } else if (typeof download.currentBytes === 'number' && download.totalBytes > 0 && download.hasProgress) {
                    const percent = Math.round((download.currentBytes / download.totalBytes) * 100);
                    statusEl.textContent = `Downloading... ${percent}%`;
                    statusEl.style.color = "#54a0ff";
                } else if (!download.succeeded && !download.error && !download.canceled) {
                    statusEl.textContent = "Downloading...";
                    statusEl.style.color = "#54a0ff";
                } else {
                    statusEl.textContent = "Starting download...";
                    statusEl.style.color = "#b5b5b5";
                }
            }
        }

        if (progressEl) { // This block handles the content of progressEl when it's visible
            if (progressEl.style.display !== 'none') { // Only update if visible
                if (download.succeeded) {
                    let finalSize = download.currentBytes;
                    if (!(typeof finalSize === 'number' && finalSize > 0)) finalSize = download.totalBytes;
                    progressEl.textContent = `${formatBytes(finalSize || 0)}`;
                } else if (download.canceled && cardDataToFocus.userCanceled && !cardDataToFocus.permanentlyDeleted) {
                    // Show progress for user-canceled downloads with resume option
                    if (typeof download.currentBytes === 'number' && download.totalBytes > 0) {
                        const percent = Math.round((download.currentBytes / download.totalBytes) * 100);
                        progressEl.textContent = `${formatBytes(download.currentBytes)} / ${formatBytes(download.totalBytes)} (${percent}%)`;
                    } else {
                        progressEl.textContent = "Download was canceled";
                    }
                } else if (typeof download.currentBytes === 'number' && download.totalBytes > 0) {
                    progressEl.textContent = `${formatBytes(download.currentBytes)} / ${formatBytes(download.totalBytes)}`;
                } else if (!download.succeeded && !download.error && !download.canceled) {
                    progressEl.textContent = "Processing...";
                } else {
                    progressEl.textContent = "Calculating size...";
                }
            }
        }
        
        // Use 100% width - container already has padding
        masterTooltipDOMElement.style.width = '100%';

        // 5. Handle AI Renaming UI status - queue addition is handled in createOrUpdatePodElement
        //    Here we just update the UI to reflect queue status
        const isInQueue = aiRenameQueue.some(item => item.downloadKey === keyToFocus);
        const isCurrentlyProcessing = currentlyProcessingKey === keyToFocus;
        
        debugLog(`[AI Rename Status] ${keyToFocus}: inQueue=${isInQueue}, processing=${isCurrentlyProcessing}, succeeded=${download.succeeded}, hasAiName=${!!download.aiName}`);
        
        // Update UI to show queue status
        if (isInQueue || isCurrentlyProcessing) {
          updateQueueStatusInUI(keyToFocus);
        }
      } // End of a valid 'download' object check
    } // End of valid 'cardDataToFocus' and 'podElement' check

    // 4. Call managePodVisibilityAndAnimations (always call to ensure layout is correct)
    // Use a small delay to ensure DOM updates are processed
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            managePodVisibilityAndAnimations();
        });
    });

    // 6. Update which pod appears "focused" visually (this iterates all cards, safe to be here)
    activeDownloadCards.forEach(cd => {
        if (cd.podElement) {
            if (cd.key === focusedDownloadKey) {
                cd.podElement.classList.add('focused-pod');
                
                // Use dominant color if available, otherwise default blue
                const dominantColor = cd.podElement.dataset.dominantColor;
                if (dominantColor) {
                    updatePodGlowColor(cd.podElement, dominantColor);
                } else {
                    cd.podElement.style.boxShadow = '0 0 15px rgba(84, 160, 255, 0.7), 0 3px 10px rgba(0,0,0,0.3)';
                }
            } else {
                cd.podElement.classList.remove('focused-pod');
                cd.podElement.style.boxShadow = '0 3px 10px rgba(0,0,0,0.3)';
            }
        }
    });
          }

  // Placeholder for the layout manager function
  function managePodVisibilityAndAnimations() {
    if (!masterTooltipDOMElement || !podsRowContainerElement) return;
    debugLog("[LayoutManager] managePodVisibilityAndAnimations Natural Stacking Style called.");
    debugLog(`[LayoutManager] Current state: orderedPodKeys=${orderedPodKeys.length}, focusedDownloadKey=${focusedDownloadKey}, activeDownloadCards=${activeDownloadCards.size}`);

    const tooltipWidth = masterTooltipDOMElement.offsetWidth;
    const podNominalWidth = 56; 
    const podOverlapAmount = 40; 
    const baseZIndex = 10;
    const maxVisiblePodsInPile = Math.floor((tooltipWidth - podNominalWidth) / (podNominalWidth - podOverlapAmount)) + 1; 

    if (orderedPodKeys.length === 0) {
        // Hide the entire container when no pods exist
        if (downloadCardsContainer) {
            downloadCardsContainer.style.display = "none";
            downloadCardsContainer.style.opacity = "0";
            downloadCardsContainer.style.visibility = "hidden";
        }
        
        if (masterTooltipDOMElement.style.opacity !== "0") {
            debugLog("[LayoutManager] No pods, ensuring master tooltip is hidden.");
            masterTooltipDOMElement.style.opacity = "0";
            masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
            masterTooltipDOMElement.style.pointerEvents = "none";
            setTimeout(() => { 
                if (masterTooltipDOMElement.style.opacity === "0") masterTooltipDOMElement.style.display = "none";
            }, 300);
        }
        showMediaControlsToolbar(); // Show media controls when no pods exist
        debugLog(`[LayoutManager] Exiting: No OrderedPodKeys.`);
        podsRowContainerElement.style.gap = '0px'; // Reset gap just in case
        return;
    }

    // Show the container when we have pods (respects compact mode via updateDownloadCardsVisibility)
    updateDownloadCardsVisibility();
    if (downloadCardsContainer && downloadCardsContainer.style.display !== 'none') {
        hideMediaControlsToolbar(); // Hide media controls when showing download pods
    }

    if (tooltipWidth === 0 && orderedPodKeys.length > 0) {
        debugLog("[LayoutManager] Master tooltip width is 0. Cannot manage pod layout yet.");
        // Set a minimum height for the container to prevent layout collapse
        if (podsRowContainerElement.style.height === '0px') {
            podsRowContainerElement.style.height = '56px';
        }
        return; 
    }
    
    // Ensure focusedDownloadKey is valid and in orderedPodKeys, default to newest if not.
    if (!focusedDownloadKey || !orderedPodKeys.includes(focusedDownloadKey)) {
        if (orderedPodKeys.length > 0) {
            const newFocusKey = orderedPodKeys[orderedPodKeys.length -1]; // Default to newest
            if (focusedDownloadKey !== newFocusKey) {
                focusedDownloadKey = newFocusKey;
                debugLog(`[LayoutManager] Focused key was invalid or missing, defaulted to newest: ${focusedDownloadKey}`);
            }
        }
    }

    // Ensure all pods in orderedPodKeys are in the DOM and have initial styles for animation/layout.
    orderedPodKeys.forEach(key => {
        const cardData = activeDownloadCards.get(key);
        if (cardData && cardData.podElement && !cardData.isWaitingForZenAnimation) {
            if (!cardData.domAppended && podsRowContainerElement) {
                podsRowContainerElement.appendChild(cardData.podElement);
                cardData.domAppended = true;
                debugLog(`[LayoutManager] Ensured pod ${key} is in DOM for Jukebox layout.`);
            }
            // Ensure consistent styling for all pods (in case they were created before layout manager)
            if (cardData.podElement.style.position !== 'absolute') {
                cardData.podElement.style.position = 'absolute';
                cardData.podElement.style.width = `${podNominalWidth}px`;
                cardData.podElement.style.marginRight = '0px';
                cardData.podElement.style.boxSizing = 'border-box';
                if (!cardData.podElement.style.transition) {
                    cardData.podElement.style.transition = 
                        'opacity 0.4s ease-out, transform 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55), ' + 
                        'z-index 0.3s ease-out';
                }
                debugLog(`[LayoutManager] Updated pod ${key} styling for absolute positioning.`);
            }
        }
    });

    let visiblePodsLayoutData = []; // Stores {key, x, zIndex, isFocused}
    const focusedIndexInOrdered = orderedPodKeys.indexOf(focusedDownloadKey);

    if (focusedIndexInOrdered === -1 && orderedPodKeys.length > 0) {
        // This should not happen if the check above worked, but as a failsafe:
        debugLog(`[LayoutManager_ERROR] Focused key ${focusedDownloadKey} not in ordered keys after all! Defaulting again.`);
        focusedDownloadKey = orderedPodKeys[orderedPodKeys.length - 1];
        // updateUIForFocusedDownload(focusedDownloadKey, false); // This could cause a loop, be careful
        // return; // Might be better to just proceed with the default for this frame
    }
    
    if (!focusedDownloadKey) { // If still no focused key (e.g. orderedPodKeys became empty)
      debugLog("[LayoutManager] No focused key available, cannot proceed with jukebox layout.");
      // Potentially hide all pods if this state is reached unexpectedly.
      orderedPodKeys.forEach(key => {
        const cd = activeDownloadCards.get(key);
        if (cd && cd.podElement && cd.isVisible) {
          cd.podElement.style.opacity = '0';
          cd.podElement.style.transform = 'scale(0.8) translateX(-30px)';
          cd.isVisible = false;
        }
      });
      return;
    }

    // 1. Position the focused pod
    let currentX = 0;
    visiblePodsLayoutData.push({
        key: focusedDownloadKey,
        x: currentX,
        zIndex: baseZIndex + orderedPodKeys.length + 1, // Highest Z
        isFocused: true
    });
    currentX += podNominalWidth - podOverlapAmount; // Next pod starts offset by (width - overlap)

    // 2. Position the pile pods to the right in reverse chronological order (natural stacking)
    // Create pile from newest to oldest, excluding the focused pod
    const pileKeys = orderedPodKeys.slice().reverse().filter(key => key !== focusedDownloadKey);
    let pileCount = 0;
    
    for (let i = 0; i < pileKeys.length && pileCount < maxVisiblePodsInPile - 1; i++) {
        const podKeyInPile = pileKeys[i];

        if (currentX + podNominalWidth <= tooltipWidth + podOverlapAmount) { // Allow last one to partially show
            visiblePodsLayoutData.push({
                key: podKeyInPile,
                x: currentX,
                zIndex: baseZIndex + pileKeys.length - i, // Decreasing Z (newest in pile has highest Z)
                isFocused: false
            });
            currentX += (podNominalWidth - podOverlapAmount);
            pileCount++;
      } else {
            break; // No more space
        }
    }

    debugLog(`[LayoutManager_NaturalStack] Calculated layout for ${visiblePodsLayoutData.length} pods. Focused: ${focusedDownloadKey}`, visiblePodsLayoutData);

    // 3. Apply styles and animations
    orderedPodKeys.forEach(key => {
        const cardData = activeDownloadCards.get(key);
        if (!cardData || !cardData.podElement || !cardData.domAppended || cardData.isWaitingForZenAnimation || cardData.isBeingRemoved) {
            debugLog(`[LayoutManager_Jukebox_Skip] Skipping pod ${key}. Conditions: cardData=${!!cardData}, podElement=${!!cardData?.podElement}, domAppended=${cardData?.domAppended}, waitingZen=${cardData?.isWaitingForZenAnimation}, beingRemoved=${cardData?.isBeingRemoved}`);
            return; // Skip pods that are not ready, waiting for Zen, or being removed
        }

        // Additional safety check: ensure pod is actually in the DOM
        if (!cardData.podElement.parentNode) {
            debugLog(`[LayoutManager_Jukebox_Skip] Pod ${key} not in DOM, skipping layout.`);
            return;
        }

        const podElement = cardData.podElement;
        const layoutData = visiblePodsLayoutData.find(p => p.key === key);

        if (layoutData) {
            // This pod should be visible
            podElement.style.display = 'flex';
            podElement.style.zIndex = `${layoutData.zIndex}`;
            const targetTransform = `translateX(${layoutData.x}px) scale(1) translateY(0)`;
            const targetOpacity = layoutData.isFocused ? '1' : '0.75';

            // Only animate if intended state changes or if it's becoming visible
            if (!cardData.isVisible || cardData.intendedTargetTransform !== targetTransform || cardData.intendedTargetOpacity !== targetOpacity) {
                debugLog(`[LayoutManager_Jukebox_Anim_Setup] Pod ${key}: Setting up IN/MOVE animation to X=${layoutData.x}, Opacity=${targetOpacity}. Prev IntendedTransform: ${cardData.intendedTargetTransform}, Prev Opacity: ${cardData.intendedTargetOpacity}, IsVisible: ${cardData.isVisible}`);
                
                // Apply directional entrance animation for newly focused pods during rotation
                if (layoutData.isFocused && !cardData.isVisible && lastRotationDirection) {
                    let entranceTransform;
                    if (lastRotationDirection === 'forward') {
                        // Forward rotation: new focused pod slides in from the right
                        entranceTransform = `translateX(${layoutData.x + 80}px) scale(0.8) translateY(0)`;
                    } else if (lastRotationDirection === 'backward') {
                        // Backward rotation: new focused pod slides in from the right (same as forward - reverse animation)
                        entranceTransform = `translateX(${layoutData.x + 80}px) scale(0.8) translateY(0)`;
      } else {
                        entranceTransform = targetTransform;
                    }
                    
                    // Set initial position for entrance animation
                    podElement.style.transform = entranceTransform;
                    podElement.style.opacity = '0';
                    
                    debugLog(`[LayoutManager_DirectionalAnim] Pod ${key}: Starting ${lastRotationDirection} entrance from ${entranceTransform}`);
                    
                    // Animate to final position
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            podElement.style.opacity = targetOpacity;
                            podElement.style.transform = targetTransform;
                            debugLog(`[LayoutManager_DirectionalAnim] Pod ${key}: Animating to final position ${targetTransform}`);
                        });
                    });
                } else {
                    // Normal animation for non-focused pods or non-rotation scenarios
                    requestAnimationFrame(() => {
                        podElement.style.opacity = targetOpacity;
                        podElement.style.transform = targetTransform;
                        debugLog(`[LayoutManager_Jukebox_Anim_Execute] Pod ${key}: Executing IN/MOVE to X=${layoutData.x}, Opacity=${targetOpacity}`);
                    });
                }
            }
            cardData.intendedTargetTransform = targetTransform;
            cardData.intendedTargetOpacity = targetOpacity;
            cardData.isVisible = true;

            // Tooltip animation for focused pod
            if (layoutData.isFocused && masterTooltipDOMElement && masterTooltipDOMElement.style.opacity === '0') {
                 // Pod is focused and tooltip is currently hidden, animate tooltip IN.
                 // This relies on updateUIForFocusedDownload having set the initial opacity/transform if focus changed.
                 debugLog(`[LayoutManager_Jukebox_Tooltip] Focused pod ${key} is visible/animating, and tooltip is hidden. Animating tooltip IN.`);
                 setTimeout(() => { 
                    masterTooltipDOMElement.style.opacity = "1";
                    masterTooltipDOMElement.style.transform = "scaleY(1) translateY(0)";
                    masterTooltipDOMElement.style.pointerEvents = "auto"; // Enable interactions when visible
                    hideMediaControlsToolbar(); // Hide media controls when tooltip is shown
                }, 100); 
            }
        } else {
            // This pod should be hidden or moved to pile
            if (cardData.isVisible || podElement.style.opacity !== '0') {
                debugLog(`[LayoutManager_Jukebox_Anim_OUT] Pod ${key}`);
                
                // Apply directional exit animation for previously focused pod during rotation
                let targetTransformOut;
                if (cardData.key === focusedDownloadKey && lastRotationDirection) {
                    // This shouldn't happen as focused pod should be visible, but safety check
                    targetTransformOut = 'scale(0.8) translateX(-30px)';
                } else if (lastRotationDirection === 'forward') {
                    // Forward rotation: previously focused pod slides left to join pile
                    targetTransformOut = 'scale(0.8) translateX(-60px)';
                } else if (lastRotationDirection === 'backward') {
                    // Backward rotation: previously focused pod slides left to join pile (same as forward - reverse animation)
                    targetTransformOut = 'scale(0.8) translateX(-60px)';
                } else {
                    // Default exit animation
                    targetTransformOut = 'scale(0.8) translateX(-30px)';
                }
                
                if (cardData.intendedTargetTransform !== targetTransformOut || cardData.intendedTargetOpacity !== '0') {
                    podElement.style.opacity = '0';
                    podElement.style.transform = targetTransformOut;
                    debugLog(`[LayoutManager_DirectionalExit] Pod ${key}: Exiting with ${lastRotationDirection || 'default'} animation: ${targetTransformOut}`);
                }
                cardData.intendedTargetTransform = targetTransformOut;
                cardData.intendedTargetOpacity = '0';
            }
            cardData.isVisible = false;
        }
    });
    
    // Set container height dynamically based on whether any pods are visible
    // This is important as pods are position:absolute now.
    if (visiblePodsLayoutData.length > 0) {
        podsRowContainerElement.style.height = `${podNominalWidth}px`; // Set to pod height
      } else {
        podsRowContainerElement.style.height = '0px';
    }

    debugLog(`[LayoutManager_NaturalStack] Finished. Visible pods: ${visiblePodsLayoutData.map(p=>p.key).join(", ")}`);
    
    // Reset rotation direction after animations are set up
    if (lastRotationDirection) {
        setTimeout(() => {
            lastRotationDirection = null;
            debugLog(`[LayoutManager] Reset rotation direction after animation`);
        }, 100); // Small delay to ensure animations start before reset
    }
  }

  // --- Mouse Wheel Scroll Handler for Stack Rotation ---
  function handlePodScrollFocus(event) {
    if (!orderedPodKeys || orderedPodKeys.length <= 1) return; // Need at least 2 pods to rotate

    event.preventDefault(); // Prevent page scroll
    event.stopPropagation();

    if (!focusedDownloadKey || !orderedPodKeys.includes(focusedDownloadKey)) {
      debugLog("[StackRotation] No valid focused key, cannot rotate stack");
      return;
    }

    // Get current stack arrangement: focused pod + pile in reverse chronological order
    const currentFocused = focusedDownloadKey;
    const pileKeys = orderedPodKeys.slice().reverse().filter(key => key !== currentFocused);
    
    let newFocusedKey;

    if (event.deltaY > 0) {
      // Scroll DOWN: Current focused goes to END of pile, FIRST in pile becomes focused
      // Current: Pod D (focused) + [Pod C, Pod B, Pod A] (pile)
      // Result:  Pod C (focused) + [Pod B, Pod A, Pod D] (pile)
      
      if (pileKeys.length > 0) {
        newFocusedKey = pileKeys[0]; // First in pile becomes focused
        debugLog(`[StackRotation] Scroll DOWN: ${currentFocused} → end of pile, ${newFocusedKey} → focused`);
      }
      
    } else if (event.deltaY < 0) {
      // Scroll UP: Current focused goes to FRONT of pile, LAST in pile becomes focused  
      // Current: Pod D (focused) + [Pod C, Pod B, Pod A] (pile)
      // Result:  Pod A (focused) + [Pod D, Pod C, Pod B] (pile)
      
      if (pileKeys.length > 0) {
        newFocusedKey = pileKeys[pileKeys.length - 1]; // Last in pile becomes focused
        debugLog(`[StackRotation] Scroll UP: ${currentFocused} → front of pile, ${newFocusedKey} → focused`);
      }
    }

    // Apply the rotation by updating the orderedPodKeys array and focus
    if (newFocusedKey && newFocusedKey !== currentFocused) {
      // Remove the new focused key from its current position in orderedPodKeys
      const newFocusedIndex = orderedPodKeys.indexOf(newFocusedKey);
      if (newFocusedIndex > -1) {
        orderedPodKeys.splice(newFocusedIndex, 1);
      }
      
      // Remove the current focused key from its position
      const currentFocusedIndex = orderedPodKeys.indexOf(currentFocused);
      if (currentFocusedIndex > -1) {
        orderedPodKeys.splice(currentFocusedIndex, 1);
      }

      if (event.deltaY > 0) {
        // Scroll DOWN: new focused goes to end (newest position), current focused goes to beginning (oldest position)
        orderedPodKeys.unshift(currentFocused); // Add current focused to beginning (oldest)
        orderedPodKeys.push(newFocusedKey);     // Add new focused to end (newest)
      } else {
        // Scroll UP: new focused goes to end (newest position), current focused goes to second-to-last
        orderedPodKeys.push(newFocusedKey);     // Add new focused to end (newest)
        orderedPodKeys.splice(-1, 0, currentFocused); // Insert current focused before the last element
      }

      // Track rotation direction for animation purposes
      if (event.deltaY > 0) {
        lastRotationDirection = 'forward';
      } else {
        lastRotationDirection = 'backward';
      }

      // Update focus and refresh UI
      focusedDownloadKey = newFocusedKey;
      debugLog(`[StackRotation] Stack rotated ${lastRotationDirection}. New order:`, orderedPodKeys);
      debugLog(`[StackRotation] New focused: ${focusedDownloadKey}`);
      
      // Update UI with the new focus
      updateUIForFocusedDownload(newFocusedKey, false);
    }
  }



  // Improved card removal function
  async function removeCard(downloadKey, force = false) {
    try {
      const cardData = activeDownloadCards.get(downloadKey);
      if (!cardData) {
        debugLog(`removeCard: No card data found for key: ${downloadKey}`);
        return false;
      }

      const podElement = cardData.podElement;
      if (!podElement) {
        debugLog(`removeCard: No pod element found for key: ${downloadKey}`);
        return false;
      }

      if (!force && cardData.lastInteractionTime && 
          Date.now() - cardData.lastInteractionTime < getPref("extensions.downloads.interaction_grace_period_ms", 5000)) {
        debugLog(`removeCard: Skipping removal due to recent interaction: ${downloadKey}`, null, 'autohide');
        return false;
      }

      // === CAPTURE POD DATA FOR DISMISSAL PILE ===
      const dismissedData = capturePodDataForDismissal(downloadKey);
      if (dismissedData) {
        // Store the dismissed pod data
        dismissedPodsData.set(downloadKey, dismissedData);
        
        // Fire dismiss event for pile system
        dismissEventListeners.forEach(callback => {
          try {
            callback(dismissedData);
          } catch (error) {
            debugLog(`[Dismiss] Error in dismiss event callback:`, error);
          }
        });
        
        // Fire custom DOM event
        fireCustomEvent('pod-dismissed', { 
          podKey: downloadKey, 
          podData: dismissedData,
          wasManual: force 
        });
        
        debugLog(`[Dismiss] Pod dismissed and captured for pile: ${downloadKey}`);
      }

      cardData.isBeingRemoved = true; // Mark for exclusion from layout management
      debugLog(`[RemoveCard] Marked card ${downloadKey} as isBeingRemoved.`);

      // Cancel any active AI process before removal
      await cancelAIProcessForDownload(downloadKey);

      // Clear any pending autohide timeout
      if (cardData.autohideTimeoutId) {
        clearTimeout(cardData.autohideTimeoutId);
        cardData.autohideTimeoutId = null;
        debugLog(`[RemoveCard] Cleared pending autohide timeout for ${downloadKey}`);
      }



      // --- New Exit Animation for Pod: Slide Left & Fade --- 
      podElement.style.transition = "opacity 0.3s ease-out, transform 0.3s ease-in-out";
      podElement.style.opacity = "0";
      podElement.style.transform = "translateX(-60px) scale(0.8)"; // Slide left and slightly shrink
      // podElement.style.width = "0px"; // Optional: remove if translateX is enough
      debugLog(`[RemoveCard] Initiated slide-out animation for pod ${downloadKey}`);

      setTimeout(() => {
        // Get download info before deleting cardData
        const cardData = activeDownloadCards.get(downloadKey);
        const download = cardData?.download;
        
        if (podElement.parentNode) {
          podElement.parentNode.removeChild(podElement);
        }
        activeDownloadCards.delete(downloadKey);
        cardUpdateThrottle.delete(downloadKey);
        
        const removedPodIndex = orderedPodKeys.indexOf(downloadKey);
        if (removedPodIndex > -1) {
          orderedPodKeys.splice(removedPodIndex, 1);
        }

        // Only mark as dismissed if this was a manual removal or auto-hide of old downloads
        // Don't dismiss downloads that just completed (they might need to reappear for AI processing)
        if (force || !download || !download.succeeded || 
            (download.succeeded && Date.now() - (download.endTime || download.startTime || 0) > 60000)) {
          // Mark as dismissed only if:
          // - Manual removal (force=true)
          // - No download object
          // - Not a successful download
          // - Successful download that's more than 1 minute old
          dismissedDownloads.add(downloadKey);
          debugLog(`Pod removed for download: ${downloadKey}, marked as dismissed. Remaining ordered keys:`, orderedPodKeys);
        } else {
          debugLog(`Pod removed for download: ${downloadKey}, NOT marked as dismissed (recent completion). Remaining ordered keys:`, orderedPodKeys);
        }

        if (focusedDownloadKey === downloadKey) {
          focusedDownloadKey = null; // Clear focus first
          if (orderedPodKeys.length > 0) {
            // Try to focus an adjacent pod to the one removed.
            // orderedPodKeys is [oldest, ..., newest]
            // If removedPodIndex was valid, try to focus what's now at removedPodIndex (which was to its right)
            // or removedPodIndex - 1 (to its left).
            let newFocusKey = null;
            if (removedPodIndex < orderedPodKeys.length) { // Try focusing the pod that took its place (originally to the right)
                newFocusKey = orderedPodKeys[removedPodIndex];
            } else if (removedPodIndex > 0 && orderedPodKeys.length > 0) { // Try focusing the pod to the left
                newFocusKey = orderedPodKeys[removedPodIndex - 1];
            } else if (orderedPodKeys.length > 0) { // Fallback to newest if extremes were removed
                 newFocusKey = orderedPodKeys[orderedPodKeys.length - 1];
            }
            focusedDownloadKey = newFocusKey;
            debugLog(`[RemoveCard] Old focus ${downloadKey} removed. New focus attempt: ${focusedDownloadKey}`);
          }
        }
        

        
        // Update UI based on new focus (or lack thereof)
        // This will also hide the master tooltip if no pods are left or re-evaluate layout
        updateUIForFocusedDownload(focusedDownloadKey, false); 
        
        // Additional check: if no cards remain, ensure container is hidden
        if (orderedPodKeys.length === 0 && downloadCardsContainer) {
          downloadCardsContainer.style.display = "none";
          downloadCardsContainer.style.opacity = "0";
          downloadCardsContainer.style.visibility = "hidden";
          showMediaControlsToolbar(); // Show media controls when all pods are dismissed
        }

      }, 300); // Corresponds to pod animation duration

      return true;
    } catch (e) {
      console.error("Error removing card:", e);
      return false;
    }
  }

  function scheduleCardRemoval(downloadKey) {
    try {
      const disableAutohide = getPref(DISABLE_AUTOHIDE_PREF, false);
      if (disableAutohide) return;

      const cardData = activeDownloadCards.get(downloadKey);
      if (!cardData) {
        debugLog(`scheduleCardRemoval: No card data found for key: ${downloadKey}`);
        return;
      }

      // Clear any existing timeout
      if (cardData.autohideTimeoutId) {
        clearTimeout(cardData.autohideTimeoutId);
        debugLog(`scheduleCardRemoval: Cleared existing timeout for key: ${downloadKey}`);
      }

      // Schedule new timeout and store the ID
      cardData.autohideTimeoutId = setTimeout(() => {
        debugLog(`scheduleCardRemoval: Timeout fired for key: ${downloadKey}`);
        performAutohideSequence(downloadKey);
      }, getPref("extensions.downloads.autohide_delay_ms", 20000));
      
      debugLog(`scheduleCardRemoval: Scheduled removal for key: ${downloadKey} in ${getPref("extensions.downloads.autohide_delay_ms", 20000)}ms`, null, 'autohide');
    } catch (e) {
      console.error("Error scheduling card removal:", e);
    }
  }

  // Perform the two-stage autohide sequence: tooltip first, then pod
  async function performAutohideSequence(downloadKey) {
    try {
      const cardData = activeDownloadCards.get(downloadKey);
      if (!cardData) {
        debugLog(`performAutohideSequence: No card data found for key: ${downloadKey}`);
        return;
      }

      debugLog(`[AutohideSequence] Starting autohide sequence for ${downloadKey}`);

      // Stage 1: Hide tooltip if this item is focused
      if (focusedDownloadKey === downloadKey && masterTooltipDOMElement) {
        debugLog(`[AutohideSequence] Stage 1: Hiding tooltip for focused item ${downloadKey}`);
        masterTooltipDOMElement.style.opacity = "0";
        masterTooltipDOMElement.style.transform = "scaleY(0.8) translateY(10px)";
        masterTooltipDOMElement.style.pointerEvents = "none";
        
        // Stage 2: Remove the pod after tooltip animation completes
        setTimeout(async () => {
          debugLog(`[AutohideSequence] Stage 2: Removing pod for ${downloadKey}`);
          await removeCard(downloadKey, false);
        }, 300); // Match tooltip animation duration
      } else {
        // If not focused, just remove the pod directly
        debugLog(`[AutohideSequence] Item ${downloadKey} not focused, removing pod directly`);
        await removeCard(downloadKey, false);
      }
    } catch (e) {
      console.error("Error in autohide sequence:", e);
      // Fallback to direct removal
      await removeCard(downloadKey, false);
    }
  }

  // ============================================================================
  // SECURITY UTILITIES
  // ============================================================================
  
  /**
   * Security utilities for path validation and sanitization
   * Uses Result pattern for better error handling without exceptions
   */
  const SecurityUtils = (function() {
    'use strict';
    
    // Constants
    const WINDOWS_RESERVED_NAMES = Object.freeze([
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ]);
    
    const WINDOWS_INVALID_CHARS = /[<>:"|?*\x00-\x1F]/;
    const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
    const MAX_PATH_LENGTH = 32767;
    const MAX_FILENAME_LENGTH = 200;
    
    // Cache platform detection
    const isWindowsPlatform = navigator.platform.includes('Win');
    
    /**
     * Result object for validation operations
     * @typedef {Object} ValidationResult
     * @property {boolean} valid - Whether the validation passed
     * @property {string|null} error - Error message if validation failed
     * @property {string} code - Error code for programmatic handling
     */
    
    /**
     * Parse and normalize a path once for multiple validations
     * @param {string} path - Path to parse
     * @returns {Object} Parsed path components
     */
    function parsePath(path) {
      const normalized = path.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);
      const filename = parts[parts.length - 1] || path;
      const isWindows = isWindowsPlatform || path.includes('\\');
      
      return { normalized, parts, filename, isWindows };
    }
    
    /**
     * Validate file path for security issues
     * @param {string} path - Path to validate
     * @param {Object} options - Validation options
     * @param {boolean} options.strict - If false, returns warnings instead of errors
     * @returns {ValidationResult} Validation result
     */
    function validateFilePath(path, options = {}) {
      const { strict = true } = options;
      
      // Type check
      if (!path || typeof path !== 'string') {
        return { valid: false, error: 'Path must be a non-empty string', code: 'INVALID_TYPE' };
      }
      
      // Length check (fastest, fail early)
      if (path.length > MAX_PATH_LENGTH) {
        return { valid: false, error: 'Path exceeds maximum length', code: 'PATH_TOO_LONG' };
      }
      
      // Null byte check
      if (path.includes('\0') || path.includes('\x00')) {
        return { valid: false, error: 'Path contains null bytes', code: 'NULL_BYTES' };
      }
      
      // Parse path once
      const { normalized, parts, filename, isWindows } = parsePath(path);
      
      // Directory traversal check
      if (parts.some(part => part === '..' || part.startsWith('../'))) {
        return { valid: false, error: 'Path contains directory traversal patterns', code: 'TRAVERSAL' };
      }
      if (normalized.startsWith('../') || normalized.endsWith('/..')) {
        return { valid: false, error: 'Path contains directory traversal patterns', code: 'TRAVERSAL' };
      }
      
      // Double slashes check (except UNC paths)
      if (path.includes('//') && !path.match(/^\\\\/)) {
        return { valid: false, error: 'Path contains invalid path separators', code: 'INVALID_SEPARATORS' };
      }
      
      // Control characters check
      if (CONTROL_CHARS.test(path.replace(/[\n\t]/g, ''))) {
        return { valid: false, error: 'Path contains control characters', code: 'CONTROL_CHARS' };
      }
      
      // Windows-specific validations
      if (isWindows) {
        // Reserved names check
        for (const part of parts) {
          const nameBase = part.toUpperCase().split('.')[0];
          if (WINDOWS_RESERVED_NAMES.includes(nameBase)) {
            return { valid: false, error: `Path contains Windows reserved name: ${nameBase}`, code: 'RESERVED_NAME' };
          }
        }
        
        // Invalid characters in filename only (not full path - drive letters have colons)
        if (WINDOWS_INVALID_CHARS.test(filename)) {
          return { valid: false, error: 'Filename contains invalid characters for Windows', code: 'INVALID_CHARS' };
        }
      }
      
      return { valid: true, error: null, code: 'VALID' };
    }
    
    /**
     * Normalize Unicode string to NFC form for consistent filename handling
     * @param {string} str - String to normalize
     * @returns {string} Normalized string
     */
    function normalizeUnicode(str) {
      try {
        // Use String.prototype.normalize if available (ES6+)
        if (typeof str.normalize === 'function') {
          return str.normalize('NFC'); // Normalization Form Canonical Composition
        }
        // Fallback for older environments
        return str;
      } catch (e) {
        // If normalization fails, return original
        return str;
      }
    }
    
    /**
     * Sanitize a filename by removing dangerous characters and normalizing Unicode
     * @param {string} filename - Filename to sanitize
     * @returns {string} Sanitized filename
     * @throws {Error} If filename becomes empty after sanitization
     */
    function sanitizeFilename(filename) {
      if (!filename || typeof filename !== 'string') {
        throw new Error('Filename must be a non-empty string');
      }
      
      // SECURITY: Normalize Unicode to prevent homograph attacks and ensure consistency
      let sanitized = normalizeUnicode(filename);
      
      // Remove control characters (including null bytes)
      sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
      
      // Remove Windows invalid characters if on Windows
      if (isWindowsPlatform) {
        sanitized = sanitized.replace(/[<>:"|?*]/g, '');
      }
      
      // Remove leading/trailing spaces and dots (Windows doesn't allow these)
      sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');
      
      // Remove consecutive dots (except for file extensions)
      sanitized = sanitized.replace(/\.{2,}/g, '.');
      
      // Handle Windows reserved names
      if (isWindowsPlatform && sanitized) {
        const nameBase = sanitized.split('.')[0].toUpperCase();
        if (WINDOWS_RESERVED_NAMES.includes(nameBase)) {
          sanitized = `FILE_${sanitized}`;
        }
      }
      
      // SECURITY: Remove potentially dangerous Unicode characters
      // Remove zero-width characters that could be used for obfuscation
      sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Zero-width space, joiner, non-joiner, BOM
      
      // Remove RTL/LTR marks that could cause display issues
      sanitized = sanitized.replace(/[\u200E-\u200F\u202A-\u202E]/g, '');
      
      // Validate result
      if (!sanitized || sanitized.trim().length === 0) {
        throw new Error('Filename is empty after sanitization');
      }
      
      // Enforce length limit (preserve extension)
      if (sanitized.length > MAX_FILENAME_LENGTH) {
        const lastDot = sanitized.lastIndexOf('.');
        if (lastDot > 0) {
          const ext = sanitized.substring(lastDot);
          const name = sanitized.substring(0, lastDot);
          sanitized = name.substring(0, MAX_FILENAME_LENGTH - ext.length) + ext;
        } else {
          sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
        }
      }
      
      return sanitized;
    }
    
    return {
      validateFilePath,
      sanitizeFilename,
      WINDOWS_RESERVED_NAMES,
      MAX_PATH_LENGTH,
      MAX_FILENAME_LENGTH
    };
  })();
  
  // Backward compatibility wrapper (throws instead of returning result)
  function validateFilePath(path) {
    const result = SecurityUtils.validateFilePath(path);
    if (!result.valid) {
      throw new Error(result.error);
    }
    return path;
  }

  // Use SecurityUtils for sanitization
  const sanitizeFilename = SecurityUtils.sanitizeFilename;

  // Helper function to get preferences
  function getPref(prefName, defaultValue) {
    try {
      const prefService = Cc["@mozilla.org/preferences-service;1"]
        .getService(Ci.nsIPrefService);
      const branch = prefService.getBranch("");

      if (typeof defaultValue === "boolean") {
        return branch.getBoolPref(prefName, defaultValue);
      } else if (typeof defaultValue === "string") {
        return branch.getStringPref(prefName, defaultValue);
      } else if (typeof defaultValue === "number") {
        return branch.getIntPref(prefName, defaultValue);
      }
      return defaultValue;
    } catch (e) {
      console.error("Error getting preference:", e);
      return defaultValue;
    }
  }



  // Set generic icon for file type
  function setGenericIcon(previewElement, contentType) {
    if (!previewElement) return;
    try {
      let icon = "📄";
      if (typeof contentType === "string") {
        if (contentType.includes("image/")) icon = "🖼️";
        else if (contentType.includes("video/")) icon = "🎬";
        else if (contentType.includes("audio/")) icon = "🎵";
        else if (contentType.includes("text/")) icon = "📝";
        else if (contentType.includes("application/pdf")) icon = "📕";
        else if (contentType.includes("application/zip") || contentType.includes("application/x-rar")) icon = "🗜️";
        else if (contentType.includes("application/")) icon = "📦";
      }
      previewElement.innerHTML = `<span style="font-size: 24px;">${icon}</span>`;
    } catch (e) {
      debugLog("Error setting generic icon:", e);
      previewElement.innerHTML = `<span style="font-size: 24px;">📄</span>`;
    }
  }

  // Extract dominant color from an image element
  function extractDominantColor(imgElement) {
    try {
      // Create a canvas to analyze the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas size (smaller for performance)
      canvas.width = 50;
      canvas.height = 50;
      
      // Draw the image onto the canvas
      ctx.drawImage(imgElement, 0, 0, 50, 50);
      
      // Get image data
      const imageData = ctx.getImageData(0, 0, 50, 50);
      const data = imageData.data;
      
      // Color frequency map
      const colorMap = {};
      
      // Sample every 4th pixel for performance
      for (let i = 0; i < data.length; i += 16) { // RGBA = 4 bytes, so i += 16 samples every 4th pixel
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Skip transparent or very dark/light pixels
        if (a < 128 || (r + g + b) < 50 || (r + g + b) > 650) continue;
        
        // Group similar colors (reduce precision)
        const rGroup = Math.floor(r / 32) * 32;
        const gGroup = Math.floor(g / 32) * 32;
        const bGroup = Math.floor(b / 32) * 32;
        
        const colorKey = `${rGroup},${gGroup},${bGroup}`;
        colorMap[colorKey] = (colorMap[colorKey] || 0) + 1;
      }
      
      // Find the most frequent color
      let dominantColor = null;
      let maxCount = 0;
      
      for (const [color, count] of Object.entries(colorMap)) {
        if (count > maxCount) {
          maxCount = count;
          dominantColor = color;
        }
      }
      
      if (dominantColor) {
        const [r, g, b] = dominantColor.split(',').map(Number);
        
        // Enhance saturation and brightness for glow effect
        const enhancedColor = enhanceColorForGlow(r, g, b);
        
        debugLog("[ColorExtraction] Extracted dominant color", { 
          original: `rgb(${r}, ${g}, ${b})`, 
          enhanced: enhancedColor,
          frequency: maxCount 
        });
        
        return enhancedColor;
      }
      
      return null;
    } catch (e) {
      debugLog("[ColorExtraction] Error extracting color:", e);
      return null;
    }
  }

  // Enhance color for better glow visibility
  function enhanceColorForGlow(r, g, b) {
    // Convert to HSL for easier manipulation
    const [h, s, l] = rgbToHsl(r, g, b);
    
    // Increase saturation and adjust lightness for better glow
    const newS = Math.min(1, s + 0.3); // Increase saturation
    const newL = Math.max(0.4, Math.min(0.7, l + 0.2)); // Ensure good visibility
    
    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, newS, newL);
    
    return `rgb(${Math.round(newR)}, ${Math.round(newG)}, ${Math.round(newB)})`;
  }

  // RGB to HSL conversion
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return [h, s, l];
  }

  // HSL to RGB conversion
  function hslToRgb(h, s, l) {
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return [r * 255, g * 255, b * 255];
  }

  // Set preview for completed file - simplified to only show images or icons
  async function setCompletedFilePreview(previewElement, download) {
    if (!previewElement) {
      debugLog("[setCompletedFilePreview] No preview element provided");
      return;
    }

    debugLog("[setCompletedFilePreview] Called", { 
      contentType: download?.contentType, 
      targetPath: download?.target?.path,
      filename: download?.filename 
    });

    try {
      // Check for images first (by content type)
      if (download?.contentType?.startsWith("image/") && download.target?.path) {
        debugLog("[setCompletedFilePreview] Attempting image preview via contentType", { path: download.target.path, contentType: download.contentType });
        const img = document.createElement("img");
        const imgSrc = `file:///${download.target.path.replace(/\\/g, '/')}`;
        img.src = imgSrc;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "12px";
        img.style.transition = "all 0.3s ease";
        img.style.opacity = "0";
        
        img.onload = () => { 
          img.style.opacity = "1"; 
          debugLog("[setCompletedFilePreview] Image loaded successfully (by contentType)", { src: imgSrc });
          
          // Extract dominant color and store it on the pod element
          setTimeout(() => {
            const dominantColor = extractDominantColor(img);
            if (dominantColor) {
              const podElement = previewElement.closest('.download-pod');
              if (podElement) {
                podElement.dataset.dominantColor = dominantColor;
                debugLog("[ColorExtraction] Stored dominant color on pod", { color: dominantColor });
                
                // If this pod is currently focused, update its glow immediately
                const downloadKey = podElement.dataset.downloadKey;
                if (downloadKey === focusedDownloadKey) {
                  updatePodGlowColor(podElement, dominantColor);
                }
              }
            }
          }, 100); // Small delay to ensure image is fully rendered
        };
        img.onerror = () => {
          debugLog("[setCompletedFilePreview] Image failed to load (by contentType)", { src: imgSrc });
          setGenericIcon(previewElement, download.contentType);
        };
        
        previewElement.innerHTML = "";
        previewElement.appendChild(img);
      } else if (download.target?.path) { 
        // Check for images by file extension if contentType is missing
        const filePath = download.target.path.toLowerCase();
        let isImageTypeByExtension = false;
        for (const ext of IMAGE_EXTENSIONS) {
          if (filePath.endsWith(ext)) {
            isImageTypeByExtension = true;
            break;
          }
        }
        if (isImageTypeByExtension) {
          debugLog("[setCompletedFilePreview] Attempting image preview via file extension", { path: download.target.path });
          const img = document.createElement("img");
          const imgSrc = `file:///${download.target.path.replace(/\\/g, '/')}`;
          img.src = imgSrc;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          img.style.borderRadius = "12px";
          img.style.transition = "all 0.3s ease";
          img.style.opacity = "0";
          
          img.onload = () => { 
            img.style.opacity = "1"; 
            debugLog("[setCompletedFilePreview] Image loaded successfully (by extension)", { src: imgSrc });
            
            // Extract dominant color and store it on the pod element
            setTimeout(() => {
              const dominantColor = extractDominantColor(img);
              if (dominantColor) {
                const podElement = previewElement.closest('.download-pod');
                if (podElement) {
                  podElement.dataset.dominantColor = dominantColor;
                  debugLog("[ColorExtraction] Stored dominant color on pod", { color: dominantColor });
                  
                  // If this pod is currently focused, update its glow immediately
                  const downloadKey = podElement.dataset.downloadKey;
                  if (downloadKey === focusedDownloadKey) {
                    updatePodGlowColor(podElement, dominantColor);
                  }
                }
              }
            }, 100); // Small delay to ensure image is fully rendered
          };
          img.onerror = () => {
            debugLog("[setCompletedFilePreview] Image failed to load (by extension)", { src: imgSrc });
            setGenericIcon(previewElement, download.contentType);
          };
          
          previewElement.innerHTML = "";
          previewElement.appendChild(img);
        } else {
          // Not an image, use generic icon
          debugLog("[setCompletedFilePreview] Not an image, setting generic icon", { contentType: download?.contentType, path: download.target.path });
          setGenericIcon(previewElement, download?.contentType);
        }
      } else {
        debugLog("[setCompletedFilePreview] No target path for preview, setting generic icon", { download });
        setGenericIcon(previewElement, null);
      }
    } catch (e) {
      debugLog("Error setting file preview:", e);
      previewElement.innerHTML = `<span style="font-size: 24px;">🚫</span>`;
    }
  }

  // Update pod glow color based on dominant color
  function updatePodGlowColor(podElement, color) {
    if (!podElement) return;
    try {
      // Always use a subtle grey shadow, ignore color extraction
      const subtleGreyShadow = '0 2px 8px rgba(60,60,60,0.18), 0 3px 10px rgba(0,0,0,0.10)';
      podElement.style.boxShadow = subtleGreyShadow;
      debugLog('[GlowUpdate] Applied subtle grey shadow under pod', {
        podKey: podElement.dataset.downloadKey,
        shadow: subtleGreyShadow
      });
    } catch (e) {
      debugLog('[GlowUpdate] Error updating pod shadow:', e);
      // Fallback to a basic grey shadow
      podElement.style.boxShadow = '0 2px 8px rgba(60,60,60,0.18)';
    }
  }

  // Process download for AI renaming - with file size check
  async function processDownloadForAIRenaming(download, originalNameForUICard, keyOverride) {
    const key = keyOverride || getDownloadKey(download);
    const cardData = activeDownloadCards.get(key);
    
    // Create AbortController for this AI process
    const abortController = new AbortController();
    const processState = {
      phase: 'initializing',
      startTime: Date.now()
    };
    
    // Register the AI process
    activeAIProcesses.set(key, {
      abortController,
      processState,
      startTime: Date.now()
    });
    
    debugLog(`[AI Process] Started AI renaming process for ${key}`, processState);
    // Ensure we are updating the MASTER tooltip if this is the focused download
    let statusElToUpdate;
    let titleElToUpdate; // For AI name
    let originalFilenameElToUpdate; // For the struck-through original name
    let progressElToHide; // To hide progress when renamed info is shown
    let podElementToStyle; // For .renaming class etc.

    if (focusedDownloadKey === key && masterTooltipDOMElement) {
        statusElToUpdate = masterTooltipDOMElement.querySelector(".card-status");
        titleElToUpdate = masterTooltipDOMElement.querySelector(".card-title");
        originalFilenameElToUpdate = masterTooltipDOMElement.querySelector(".card-original-filename");
        progressElToHide = masterTooltipDOMElement.querySelector(".card-progress");
    } else if (cardData && cardData.podElement) {
        // Fallback: if not focused, or master tooltip somehow not found,
        // we might want to log or have a small indicator on the pod itself.
        // For now, if it's not focused, AI renaming might not show progress directly on master tooltip.
        // This logic assumes AI rename is primarily for the *focused* element's display.
        // Let's assume if it's not focused, we might not update UI aggressively, or handle it differently.
        // For now, if not focused, we'll log and potentially skip aggressive UI updates.
        debugLog(`[AI Rename] processDownloadForAIRenaming called for non-focused item ${key}. UI updates will be minimal.`);
    }
    
    if (cardData && cardData.podElement) {
        podElementToStyle = cardData.podElement;
    }


    if (!cardData) {
      debugLog("AI Rename: Card data not found for download key:", key);
      return false;
    }
    // const cardElement = cardData.podElement; // Use podElement
    // const statusEl = cardElement.querySelector(".card-status"); // This would be on the individual card if it had one
    // if (!statusEl) return false; // No individual status on pod. Master tooltip is primary.

    const previewContainerOnPod = cardData.podElement ? cardData.podElement.querySelector(".card-preview-container") : null;
    let originalPreviewTitle = "";
    if (previewContainerOnPod) {
      originalPreviewTitle = previewContainerOnPod.title;
    }

    const downloadPath = download.target.path;
    if (!downloadPath) return false;

    // Capture the true original filename before any AI processing for this attempt
    const trueOriginalFilename = cardData.originalFilename; 

    if (renamedFiles.has(downloadPath)) {
      debugLog(`Skipping rename - already processed: ${downloadPath}`);
      activeAIProcesses.delete(key); // Clean up
      return false;
    }
    
    // Check for abort signal
    if (abortController.signal.aborted) {
      debugLog(`[AI Process] Process aborted before file size check: ${key}`);
      activeAIProcesses.delete(key);
      throw new DOMException('AI process was aborted', 'AbortError');
    }

          try {
        // SECURITY: Validate path before file operations (non-strict mode for edge cases)
        const validation = SecurityUtils.validateFilePath(downloadPath, { strict: false });
        if (!validation.valid) {
          debugLog(`Path validation warning (continuing anyway): ${validation.error}`, { 
            path: downloadPath,
            code: validation.code 
          });
        }
        
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(downloadPath);
        
        if (!file.exists()) {
          debugLog(`File does not exist for AI rename: ${downloadPath}`);
          activeAIProcesses.delete(key);
          return false;
        }
        
        if (file.fileSize > getPref("extensions.downloads.max_file_size_for_ai", 52428800)) { // 50MB default
          debugLog(`Skipping AI rename - file too large: ${formatBytes(file.fileSize)}`);
          if (statusElToUpdate) statusElToUpdate.textContent = "File too large for AI analysis";
          activeAIProcesses.delete(key); // Clean up
          return false;
        }
      } catch (e) {
        // Log the actual error message for debugging
        const errorMessage = e.message || e.toString() || 'Unknown error';
        const errorName = e.name || 'Error';
        debugLog(`Error checking file size: ${errorName}: ${errorMessage}`, { 
          path: downloadPath,
          error: errorMessage 
        });
        activeAIProcesses.delete(key); // Clean up
        return false;
      }

    // Store the original path and simple name in cardData *before* attempting rename
    // This is critical for the undo functionality.
    if (cardData) {
        cardData.trueOriginalPathBeforeAIRename = downloadPath; 
        cardData.trueOriginalSimpleNameBeforeAIRename = downloadPath.split(PATH_SEPARATOR).pop();
        debugLog("[AI Rename Prep] Stored for undo:", { 
            path: cardData.trueOriginalPathBeforeAIRename, 
            name: cardData.trueOriginalSimpleNameBeforeAIRename 
        });
    }

    // Note: We no longer add to renamedFiles here - we add ONLY after successful rename
    // The queue system prevents duplicate processing

    try {
      // Update process state
      processState.phase = 'analyzing';
      
      // Check for abort signal
      if (abortController.signal.aborted) {
        debugLog(`[AI Process] Process aborted during setup: ${key}`);
        activeAIProcesses.delete(key);
        throw new DOMException('AI process was aborted', 'AbortError');
      }
      
      // cardElement.classList.add("renaming");
      if (podElementToStyle) podElementToStyle.classList.add("renaming-active");
      if (statusElToUpdate) statusElToUpdate.textContent = "Analyzing file...";
      
      if (previewContainerOnPod) {
        previewContainerOnPod.style.pointerEvents = "none";
        previewContainerOnPod.title = "Renaming in progress...";
      }

      const currentFilename = downloadPath.split(PATH_SEPARATOR).pop();
      const fileExtension = currentFilename.includes(".") 
        ? currentFilename.substring(currentFilename.lastIndexOf(".")).toLowerCase() 
        : "";

      const isImage = IMAGE_EXTENSIONS.has(fileExtension);
      debugLog(`Processing file for AI rename: ${currentFilename} (${isImage ? "Image" : "Non-image"})`);

      let suggestedName = null;

      // Check for abort signal before analysis
      if (abortController.signal.aborted) {
        debugLog(`[AI Process] Process aborted before analysis: ${key}`);
        renamedFiles.delete(downloadPath);
        activeAIProcesses.delete(key);
        throw new DOMException('AI process was aborted', 'AbortError');
      }
      
      processState.phase = 'metadata-analysis';
      if (statusElToUpdate) statusElToUpdate.textContent = "Generating better name...";
      
      const sourceURL = download.source?.url || "unknown";
      // Find tab title and context
      let tabTitle = "unknown";
      let pageHeader = "unknown";
      let pageDescription = "unknown";

      try {
        if (typeof gBrowser !== "undefined" && gBrowser.tabs) {
           let foundTab = null;

           // Strategy 1: Match by exact URL
           for (const tab of gBrowser.tabs) {
             if (tab.linkedBrowser?.currentURI?.spec === sourceURL) {
               foundTab = tab;
               break;
             }
           }

           // Strategy 2: Match by referrer if exact URL fails
           if (!foundTab && download.source?.referrer) {
               const referrerSpec = download.source.referrer; 
               for (const tab of gBrowser.tabs) {
                   // Check if referrer matches tab URL
                   if (tab.linkedBrowser?.currentURI?.spec === referrerSpec) {
                       foundTab = tab;
                       break;
                   }
               }
           }

           if (foundTab) {
               tabTitle = foundTab.label || foundTab.title || "unknown";

               // Extract context from the tab content
               try {
                   const doc = foundTab.linkedBrowser.contentDocument;
                   if (doc) {
                       // Get H1
                       const h1 = doc.querySelector('h1');
                       if (h1) {
                           const h1Text = h1.textContent.trim();
                           if (h1Text) pageHeader = h1Text;
                       }

                       // Get Meta Description
                       const metaDesc = doc.querySelector('meta[name="description"]');
                       if (metaDesc) {
                           const descContent = metaDesc.content.trim();
                           if (descContent) pageDescription = descContent;
                       }
                   }
               } catch (e) {
                   // Accessing contentDocument might fail for some privileged pages or cross-origin restrictions (though less likely in userChrome)
                   console.error("Error extracting tab context:", e);
               }
           }
        }
      } catch (e) {
         console.error("Error finding tab title:", e);
      }

      const systemPrompt = `I am downloading a file. Rewrite its filename to be helpful, concise and readable. 2-4 words.
- IMPORTANT: Return ONLY the new filename. Do not provide explanations, conversational text, or "based on the information provided".
- Keep informative names mostly the same. For non-informative names, add information from the tab title or website.
- Remove machine-generated cruft, like IDs, (1), (copy), etc.
- Clean up messy text, especially dates. Make timestamps concise, human readable, and remove seconds.
- Clean up text casing and letter spacing to make it easier to read.

Some examples, in the form "original name, tab title, domain -> new name"
- 'Arc-1.6.0-41215.dmg', 'Arc from The Browser Company', 'arc.net' -> 'Arc 1.6.0 41215.dmg'
- 'swift-chat-main.zip', 'huggingface/swift-chat: Mac app to demonstrate swift-transformers', 'github.com' -> 'swift-chat main.zip'
- 'folio_option3_6691488.PDF', 'Your Guest Stay Folio from the LINE LA 08-14-23', 'mail.google.com' -> 'Line LA Folio, Aug 14.pdf'
- 'image.png', 'Feedback: Card border radius - nateparro2t@gmail.com - Gmail', 'mail.google.com' -> 'Card border radius feedback.png'
- 'Brooklyn_Bridge_September_2022_008.jpg', 'nyc bridges - Google Images', 'images.google.com' -> 'Brooklyn Bridge Sept 2022.jpg'
- 'AdobeStock_184679416.jpg', 'ladybug - Google Images', 'images.google.com' -> 'Ladybug.jpg'
- 'CleanShot 2023-08-17 at 19.51.05@2x.png', 'dogfooding - The Browser Company - Slack', 'app.slack.com' -> 'CleanShot Aug 17 from dogfooding.png'
- 'Screenshot 2023-09-26 at 11.12.18 PM', 'DM with Nate - Twitter', 'twitter.com' -> 'Sept 26 Screenshot from Nate.png'
- 'image0.png', 'Nate - Slack', 'files.slack.com' -> 'Slack Image from Nate.png'`;
      
      let domain = "unknown";
      try {
        domain = new URL(sourceURL).hostname;
      } catch (e) {}

      // Check if this is an image search result (e.g., Google Images, DuckDuckGo Images)
      // These sites often have the image preview in a special container, or the title is just the search query.
      // We can try to extract more specific info.
      const isSearchEngine = domain.includes('google') || domain.includes('duckduckgo') || domain.includes('bing') || domain.includes('yahoo') || domain.includes('yandex');
      
      // Try to extract search query regardless of tab title if it's a search engine domain
      if (isSearchEngine) {
             // If the tab title is generic, rely heavily on the page header (which might be the search query)
             // or try to extract the search query from the URL.
             try {
                // Try referrer first, then sourceURL, AND the active tab URL if available
                const urlStrings = [
                    download.source?.referrer,
                    sourceURL,
                    (typeof gBrowser !== "undefined" && gBrowser.selectedBrowser?.currentURI?.spec) 
                ].filter(Boolean);

                debugLog("Checking URLs for search query:", urlStrings);

                for (const urlStr of urlStrings) {
                    try {
                        const urlObj = new URL(urlStr);
                        // Common search query parameters: q (Google/DDG/Bing), p (Yahoo), text (Yandex)
                        const q = urlObj.searchParams.get('q') || 
                                  urlObj.searchParams.get('p') || 
                                  urlObj.searchParams.get('text');
                        
                        if (q) {
                            pageHeader = `Search Query: ${q}`; 
                            // Add search query to tab title if it's generic, so AI definitely sees it
                            if (tabTitle.toLowerCase().includes('search') || tabTitle.toLowerCase().includes('images') || tabTitle === 'unknown') {
                                tabTitle = `${q} - Search`;
                            }
                            debugLog("Extracted search query for context", { 
                                fromUrl: urlStr, 
                                query: q,
                                newTabTitle: tabTitle
                            });
                            break; // Stop once found
                        }
                    } catch(e) {}
                }
             } catch(e) {
                debugLog("Failed to extract search query:", e);
             }
      }

      const userContent = `Original filename: '${currentFilename}'
Source domain: '${domain}'
Source tab title: '${tabTitle}'
Page Header: '${pageHeader}'
Page Description: '${pageDescription}'

Instructions:
1. First, check if the "Original filename" is already descriptive (contains real words, e.g., "viper-gaming-valorant-hd..."). If so, prioritize cleaning it up (remove random strings, IDs, dates) rather than rewriting it completely from the context.
2. ONLY if the "Original filename" is meaningless gibberish (e.g., "wp13801370.jpg", "OIP.jpg", "image.png"), rename it based on the "Source tab title" or "Page Header".
3. Return ONLY the new filename.`;

      suggestedName = await callMistralAI({
        systemPrompt: systemPrompt,
        userPrompt: userContent,
        abortSignal: abortController.signal
      });

      if (!suggestedName) {
        debugLog("No valid name suggestion received from AI");
        if (statusElToUpdate) {
            statusElToUpdate.textContent = "Could not generate a better name";
        }
        renamedFiles.delete(downloadPath);
        if (podElementToStyle) podElementToStyle.classList.remove("renaming-active");
        if (podElementToStyle) podElementToStyle.classList.remove('renaming-initiated'); // Allow retry by focus change
        activeAIProcesses.delete(key); // Clean up
        return false;
      }
      
      // Check for abort signal before file operations
      if (abortController.signal.aborted) {
        debugLog(`[AI Process] Process aborted before file rename: ${key}`);
        renamedFiles.delete(downloadPath);
        activeAIProcesses.delete(key);
        throw new DOMException('AI process was aborted', 'AbortError');
      }
      
      processState.phase = 'renaming';

      let cleanName = suggestedName
        .replace(/[^a-zA-Z0-9\-_\.\s]/g, "") // Allow spaces first
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-") // Collapse multiple dashes
        .toLowerCase();

      // Validation: Reject names that are just separators or too short
      if (/^[\-_.]+$/.test(cleanName) || cleanName.replace(/[\-_.]/g, "").length < 2) {
         debugLog("AI suggested invalid name (separators only):", cleanName);
         cleanName = ""; // Force failure in next check
      }

      if (cleanName.length > getPref("extensions.downloads.max_filename_length", 70) - fileExtension.length) {
        cleanName = cleanName.substring(0, getPref("extensions.downloads.max_filename_length", 70) - fileExtension.length);
      }
      if (fileExtension && !cleanName.toLowerCase().endsWith(fileExtension.toLowerCase())) {
        cleanName = cleanName + fileExtension;
      }

      if (cleanName.length <= 2 || cleanName.toLowerCase() === currentFilename.toLowerCase()) {
        debugLog("Skipping AI rename - name too short or same as original");
        if (statusElToUpdate) statusElToUpdate.textContent = "Original name is suitable"; // Or some other neutral message
        renamedFiles.delete(downloadPath);
        if (podElementToStyle) podElementToStyle.classList.remove("renaming-active");
        if (podElementToStyle) podElementToStyle.classList.remove('renaming-initiated');
        activeAIProcesses.delete(key); // Clean up
        return false;
      }

      debugLog(`AI suggested renaming to: ${cleanName}`);
      if (statusElToUpdate) statusElToUpdate.textContent = `Renaming to: ${cleanName}`;

      // Pass key to ensure the correct cardData (and thus podElement) is found by rename function
      const success = await renameDownloadFileAndUpdateRecord(download, cleanName, key);

      if (success) {
        const newPath = download.target.path; // This is now the new path after rename
        download.aiName = cleanName; // Set the aiName property on the download object
        
        // Mark BOTH old and new paths as renamed to prevent re-processing
        renamedFiles.add(downloadPath); // Original path
        renamedFiles.add(newPath);      // New path after rename
        debugLog(`[AI Rename] Added paths to renamedFiles: ${downloadPath} and ${newPath}`);
        
        // cardData.originalFilename = cleanName; // NO! Keep cardData.originalFilename as the name before this specific AI op.
                                            // The titleEl will pick up download.aiName.
                                            // The originalFilenameEl will use the trueOriginalFilename captured above.


        if (titleElToUpdate) { 
          titleElToUpdate.textContent = cleanName;
          titleElToUpdate.title = cleanName;
        }

        if (statusElToUpdate) {
          let finalSize = download.currentBytes;
          if (!(typeof finalSize === 'number' && finalSize > 0)) finalSize = download.totalBytes;
          const fileSizeText = formatBytes(finalSize || 0);
          
          // Always show file size in bottom right corner for renamed files
          const fileSizeEl = masterTooltipDOMElement.querySelector(".card-filesize");
          statusElToUpdate.textContent = "Download renamed to:";
          if (fileSizeEl) {
              fileSizeEl.textContent = fileSizeText;
              fileSizeEl.style.display = "block";
          }
          statusElToUpdate.style.color = "#a0a0a0";
        }

        if (originalFilenameElToUpdate) {
            originalFilenameElToUpdate.textContent = trueOriginalFilename; // Use the captured true original name
            originalFilenameElToUpdate.title = trueOriginalFilename;
            originalFilenameElToUpdate.style.textDecoration = "line-through";
            originalFilenameElToUpdate.style.display = "block";
        }

        if (progressElToHide) {
            progressElToHide.style.display = "none";
        }
        
        if (podElementToStyle) {
            podElementToStyle.classList.remove("renaming-active");
            podElementToStyle.classList.add("renamed-by-ai");
        }
        
        // IMPORTANT: If the renamed item was focused, update focusedDownloadKey to the new path
        // and ensure the subsequent UI update uses this new key.
        let keyForFinalUIUpdate = key; // Original key passed to this function
        
        // Update activeDownloadCards with the new key (path) BUT preserve original cardData object reference
        // The cardData object itself should retain the *trueOriginalFilename* if needed for other contexts,
        // or rely on the fact that renameDownloadFileAndUpdateRecord updates the key in activeDownloadCards.
        // The critical part is that `download.aiName` is set, and `trueOriginalFilename` is available for this UI update.
        // The `cardData.originalFilename` will naturally become the `cleanName` if `createOrUpdatePodElement` runs again for this item
        // due to some other event, which is fine, as `download.aiName` would be preferred by `updateUIForFocusedDownload`.

        if (focusedDownloadKey === key) { // 'key' here is the *original* key before rename
            focusedDownloadKey = newPath; // Update global focus to the NEW path
            keyForFinalUIUpdate = newPath; // Use the NEW path for the upcoming UI update
            debugLog(`[AI Rename] Focused item ${key} renamed to ${newPath}. Updated focusedDownloadKey and keyForFinalUIUpdate.`);
        }

        // The call to updateUIForFocusedDownload will now correctly use download.aiName for the title,
        // and cardData.originalFilename (which should be the one prior to this AI attempt or the one from pod creation)
        // for the strikethrough, as per its own logic.
        // The direct update of tooltip elements within this function ensures immediate feedback.
        updateUIForFocusedDownload(keyForFinalUIUpdate, true); // Force a significant update as content structure changed

        debugLog(`Successfully AI-renamed to: ${cleanName}`);
        activeAIProcesses.delete(key); // Clean up successful process
        return true;
      } else {
        renamedFiles.delete(downloadPath);
        if (statusElToUpdate) statusElToUpdate.textContent = "Rename failed";
        if (podElementToStyle) {
            podElementToStyle.classList.remove("renaming-active");
            podElementToStyle.classList.remove('renaming-initiated');
        }
        activeAIProcesses.delete(key); // Clean up failed process
        return false;
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        debugLog(`[AI Process] AI rename process was aborted for ${key}`);
        // Don't log as error, this is expected behavior
      } else {
        console.error("AI Rename process error:", e);
      }
      renamedFiles.delete(downloadPath); // Ensure it can be retried if it was an unexpected error
      if (statusElToUpdate && e.name !== 'AbortError') statusElToUpdate.textContent = "Rename error";
      if (podElementToStyle) {
        podElementToStyle.classList.remove("renaming-active");
        podElementToStyle.classList.remove('renaming-initiated');
      }
      activeAIProcesses.delete(key); // Clean up errored/aborted process
      throw e; // Re-throw to be handled by caller
    } finally {
      if (previewContainerOnPod) {
        previewContainerOnPod.style.pointerEvents = "auto";
        previewContainerOnPod.title = originalPreviewTitle; // Restore original title or new name if successful? For now, original.
      }
       if (podElementToStyle) podElementToStyle.classList.remove("renaming-active"); // General cleanup
    }
  }

  // Improved file renaming function
  async function renameDownloadFileAndUpdateRecord(download, newName, key) {
    try {
      const oldPath = download.target.path;
      if (!oldPath) throw new Error("No file path available");

      // SECURITY: Validate the existing path (non-strict mode)
      const oldPathValidation = SecurityUtils.validateFilePath(oldPath, { strict: false });
      if (!oldPathValidation.valid) {
        debugLog(`Path validation warning for old path (continuing anyway): ${oldPathValidation.error}`, { 
          path: oldPath,
          code: oldPathValidation.code 
        });
      }

      const directory = oldPath.substring(0, oldPath.lastIndexOf(PATH_SEPARATOR));
      const oldFileName = oldPath.split(PATH_SEPARATOR).pop();
      const fileExt = oldFileName.includes(".") 
        ? oldFileName.substring(oldFileName.lastIndexOf(".")) 
        : "";

      // SECURITY: Use comprehensive filename sanitization
      let cleanNewName = sanitizeFilename(newName);
      // Ensure extension is preserved and re-sanitize if needed
      if (fileExt && !cleanNewName.endsWith(fileExt)) {
        cleanNewName = sanitizeFilename(cleanNewName + fileExt);
      }

      // Handle duplicate names
      let finalName = cleanNewName;
      let counter = 1;
      while (counter < 100) {
        const testPath = directory + PATH_SEPARATOR + finalName;
        let exists = false;
        try {
          // SECURITY: Validate path (non-strict for duplicate check)
          const testValidation = SecurityUtils.validateFilePath(testPath, { strict: false });
          if (!testValidation.valid) {
            // If validation fails, treat as non-existent to avoid infinite loop
            debugLog(`Path validation warning in duplicate check (treating as non-existent): ${testValidation.error}`);
            break;
          }
          const testFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          testFile.initWithPath(testPath);
          exists = testFile.exists();
        } catch (e) {
          // File doesn't exist or can't access - proceed
          if (e.message && e.message.includes('Invalid file path')) {
            break; // Break loop on path errors
          }
        }
        if (!exists) break;
        
        const baseName = cleanNewName.includes(".") 
          ? cleanNewName.substring(0, cleanNewName.lastIndexOf(".")) 
          : cleanNewName;
        finalName = `${baseName}-${counter}${fileExt}`;
        counter++;
      }

      const newPath = directory + PATH_SEPARATOR + finalName;
      
      // SECURITY: Validate new path (non-strict mode)
      const newPathValidation = SecurityUtils.validateFilePath(newPath, { strict: false });
      if (!newPathValidation.valid) {
        debugLog(`Path validation warning for new path (continuing anyway): ${newPathValidation.error}`, { 
          path: newPath,
          code: newPathValidation.code 
        });
      }
      debugLog("Rename paths", { oldPath, newPath });

      const oldFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      oldFile.initWithPath(oldPath);

      if (!oldFile.exists()) throw new Error("Source file does not exist");

      // Perform the rename
      oldFile.moveTo(null, finalName);

      // Update download record
      download.target.path = newPath;
      
      // Update card data key mapping
      const cardData = activeDownloadCards.get(key); // key is the OLD key here
      if (cardData) {
        activeDownloadCards.delete(key);
        activeDownloadCards.set(newPath, cardData);
        cardData.key = newPath; // Update the key stored in cardData itself
        if (cardData.podElement) { // Update dataset on the pod element itself
            cardData.podElement.dataset.downloadKey = newPath;
            debugLog(`[Rename] Updated podElement.dataset.downloadKey to ${newPath}`);
        }
        // Update the key in orderedPodKeys as well
        const oldKeyIndex = orderedPodKeys.indexOf(key);
        if (oldKeyIndex > -1) {
            orderedPodKeys.splice(oldKeyIndex, 1, newPath);
            debugLog(`[Rename] Updated key in orderedPodKeys from ${key} to ${newPath}`);
        } else {
            debugLog(`[Rename] Warning: Old key ${key} not found in orderedPodKeys during rename.`);
        }
        
        // Reschedule autohide with the new key if there was an existing timeout
        if (cardData.autohideTimeoutId) {
          clearTimeout(cardData.autohideTimeoutId);
          cardData.autohideTimeoutId = null;
          debugLog(`[Rename] Cleared old autohide timeout for ${key}, rescheduling for ${newPath}`);
          scheduleCardRemoval(newPath);
        }
        
        debugLog(`Updated card key mapping from ${key} to ${newPath}`);
      }

      debugLog("File renamed successfully");
      return true;
    } catch (e) {
      // Log detailed error information for debugging
      const errorInfo = {
        name: e.name || 'Error',
        message: e.message || e.toString() || 'Unknown error',
        oldPath: download?.target?.path,
        newName: newName,
        key: key
      };
      
      console.error(`Rename failed: ${errorInfo.name}: ${errorInfo.message}`, errorInfo);
      debugLog(`Rename failed: ${errorInfo.name}: ${errorInfo.message}`, {
        oldPath: errorInfo.oldPath,
        newName: errorInfo.newName
      });
      return false;
    }
  }

  function formatBytes(b, d = 2) {
    if (b === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${parseFloat((b / Math.pow(1024, i)).toFixed(d))} ${sizes[i]}`;
  }

  // Helper functions to hide/show media controls toolbar
  function hideMediaControlsToolbar() {
    const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
    if (mediaControlsToolbar) {
      mediaControlsToolbar.style.opacity = '0';
      mediaControlsToolbar.style.pointerEvents = 'none';
      debugLog('[MediaControls] Hid media controls toolbar');
    }
  }

  function showMediaControlsToolbar() {
    const mediaControlsToolbar = document.getElementById('zen-media-controls-toolbar');
    if (mediaControlsToolbar) {
      // Check if context menu is visible
      const contextMenu = document.getElementById('zen-pile-pod-context-menu');
      const isContextMenuVisible = contextMenu && typeof contextMenu.state === 'string' && contextMenu.state === 'open';
      
      // Only show if no download pods are visible and context menu is not visible
      if (orderedPodKeys.length === 0 && !isContextMenuVisible) {
        mediaControlsToolbar.style.opacity = '1';
        mediaControlsToolbar.style.pointerEvents = 'auto';
        debugLog('[MediaControls] Showed media controls toolbar');
      }
    }
  }

  // Mistral AI function
  /**
   * Call Mistral AI API with rate limiting and security measures
   * @param {Object} params - API call parameters
   * @param {string} params.systemPrompt - System prompt for the AI
   * @param {string} params.userPrompt - User prompt for the AI
   * @param {AbortSignal} params.abortSignal - Signal to abort the request
   * @returns {Promise<string|null>} AI-generated filename or null
   */
  async function callMistralAI({ systemPrompt, userPrompt, abortSignal }) {
    if (abortSignal?.aborted) return null;

    // SECURITY: Rate limiting check
    const rateLimitCheck = RateLimiter.canMakeRequest();
    if (!rateLimitCheck.allowed) {
      debugLog(`Mistral AI rate limit exceeded: ${rateLimitCheck.reason}`, {
        waitTime: rateLimitCheck.waitTime,
        stats: RateLimiter.getStats()
      });
      console.warn(`API rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds.`);
      return null;
    }

    const apiKey = getPref(MISTRAL_API_KEY_PREF, "");
    if (!apiKey) {
      console.warn("Mistral API key not found in preferences");
      return null;
    }

    // SECURITY: Never log the API key - validate it exists but don't expose it
    if (apiKey.length < 10) {
      console.warn("Mistral API key appears to be invalid (too short)");
      return null;
    }

    try {
      // Record the request for rate limiting
      RateLimiter.recordRequest();
      
      debugLog("Sending request to Mistral AI", {
        rateLimitStats: RateLimiter.getStats()
      });
      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 50
        }),
        signal: abortSignal
      });

      if (!response.ok) {
        const errorText = await response.text();
        // SECURITY: Redact any sensitive data from error messages
        const safeErrorText = redactSensitiveData(errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${safeErrorText}`);
      }

      const data = await response.json();
      let name = data.choices[0]?.message?.content?.trim();
      
      // Basic cleanup
      if (name) {
          name = name.replace(/^["']|["']$/g, ''); // Remove quotes if present
          
          // Heuristic: If the response is very long (e.g. > 50 chars) and contains spaces,
           // it might be a sentence instead of a filename. 
           // However, some valid filenames can be long. 
           // Let's filter out known "chatty" prefixes if they exist.
           const chattyPrefixes = [
             "based on", "here is", "i have", "the filename", "new filename", "renamed file", "unknown", "file name"
           ];
           const lowerName = name.toLowerCase();
           if (chattyPrefixes.some(prefix => lowerName.startsWith(prefix))) {
              debugLog("Mistral AI returned conversational text or unknown, rejecting:", name);
              return null;
           }
      }

      debugLog("Mistral AI response:", name);
      return name || null;
    } catch (error) {
      // SECURITY: Redact sensitive data from error logs
      const safeError = error.message ? redactSensitiveData(error.message) : 'Unknown error';
      console.error("Mistral AI error:", safeError);
      return null;
    }
  }



  // --- Function to Open Downloaded File ---
  /**
   * Open a downloaded file with the default system application
   * @param {Object} download - Download object with target path
   */
  function openDownloadedFile(download) {
    if (!download || !download.target || !download.target.path) {
      debugLog("openDownloadedFile: Invalid download object or path", { download });
      return;
    }

    const filePath = download.target.path;
    
    // SECURITY: Validate path before file operations (non-strict for user-initiated actions)
    const validation = SecurityUtils.validateFilePath(filePath, { strict: false });
    if (!validation.valid) {
      debugLog("openDownloadedFile: Path validation failed", { 
        filePath, 
        error: validation.error,
        code: validation.code 
      });
      return;
    }

    debugLog("openDownloadedFile: Attempting to open file", { filePath });

    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(filePath);

      if (file.exists() && file.isReadable()) {
        file.launch(); // Opens with default system application
        debugLog("openDownloadedFile: File launched successfully", { filePath });
      } else {
        debugLog("openDownloadedFile: File does not exist or is not readable", { filePath });
      }
    } catch (ex) {
      const errorInfo = {
        filePath,
        error: ex.message || ex.toString(),
        name: ex.name || 'Error',
        stack: ex.stack
      };
      debugLog("openDownloadedFile: Error launching file", errorInfo);
      console.error("openDownloadedFile failed:", errorInfo);
    }
  }

  /**
   * Erase download from Firefox history
   * @param {Object} download - Download object to remove
   * @throws {Error} If download object is invalid or operation fails
   */
  async function eraseDownloadFromHistory(download) {
    if (!download) {
      debugLog("eraseDownloadFromHistory: Invalid download object", { download });
      throw new Error("Invalid download object");
    }

    // SECURITY: Validate path if present (non-strict mode)
    if (download.target?.path) {
      const pathValidation = SecurityUtils.validateFilePath(download.target.path, { strict: false });
      if (!pathValidation.valid) {
        debugLog("eraseDownloadFromHistory: Path validation warning", {
          path: download.target.path,
          error: pathValidation.error,
          code: pathValidation.code
        });
        // Continue anyway - path validation is advisory for this operation
      }
    }

    try {
      debugLog("eraseDownloadFromHistory: Attempting to erase download", { 
        id: download.id, 
        path: download.target?.path,
        state: download.state 
      });

      // Get the Downloads list
      const list = await window.Downloads.getList(window.Downloads.ALL);
      
      // Find the download in the list by multiple criteria
      const downloads = await list.getAll();
      const targetDownload = downloads.find(dl => {
        // Try to match by ID first (most reliable)
        if (download.id && dl.id === download.id) return true;
        
        // SECURITY: Validate paths before comparing (non-strict)
        if (download.target?.path && dl.target?.path) {
          const downloadPathValid = SecurityUtils.validateFilePath(download.target.path, { strict: false });
          const dlPathValid = SecurityUtils.validateFilePath(dl.target.path, { strict: false });
          
          // Only compare if both paths are valid
          if (downloadPathValid.valid && dlPathValid.valid && 
              dl.target.path === download.target.path) return true;
        }
            
        // Additional fallback for URL matching (in case path changed)
        if (download.source?.url && dl.source?.url && 
            dl.source.url === download.source.url && 
            download.startTime && dl.startTime &&
            Math.abs(new Date(download.startTime) - new Date(dl.startTime)) < 5000) return true;
            
        return false;
      });
      
      if (targetDownload) {
        // Remove the download from the list (this erases it from history)
        await list.remove(targetDownload);
        debugLog("eraseDownloadFromHistory: Successfully removed download from list", { 
          id: targetDownload.id,
          originalId: download.id,
          path: targetDownload.target?.path 
        });
      } else {
        debugLog("eraseDownloadFromHistory: Download not found in list", { 
          id: download.id,
          path: download.target?.path,
          availableDownloads: downloads.length 
        });
        // It might have already been removed, which is fine for our purposes
      }
      
    } catch (error) {
      debugLog("eraseDownloadFromHistory: Error erasing download", { 
        id: download.id, 
        path: download.target?.path,
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }



  // === AI RENAME QUEUE SYSTEM ===
  
  // Add a completed download to the AI rename queue
  function addToAIRenameQueue(downloadKey, download, originalFilename) {
    debugLog(`[AI Queue] addToAIRenameQueue called for ${downloadKey}`, {
      downloadKey,
      hasDownload: !!download,
      downloadPath: download?.target?.path,
      originalFilename,
      queueLength: aiRenameQueue.length,
      isProcessing: isProcessingAIQueue,
      currentlyProcessing: currentlyProcessingKey
    });
    
    // Check if already in queue or being processed
    if (aiRenameQueue.some(item => item.downloadKey === downloadKey)) {
      debugLog(`[AI Queue] Download ${downloadKey} already in queue, skipping`);
      return false;
    }
    
    if (currentlyProcessingKey === downloadKey) {
      debugLog(`[AI Queue] Download ${downloadKey} is currently being processed, skipping`);
      return false;
    }
    
    // Check if already renamed
    if (renamedFiles.has(download.target?.path)) {
      debugLog(`[AI Queue] Download ${downloadKey} already renamed (path: ${download.target?.path}), skipping`);
      return false;
    }
    
    if (!download || !download.target?.path) {
      debugLog(`[AI Queue] Download ${downloadKey} missing download object or path, skipping`);
      return false;
    }
    
    const queueItem = {
      downloadKey,
      download,
      originalFilename,
      queuedAt: Date.now()
    };
    
    aiRenameQueue.push(queueItem);
    debugLog(`[AI Queue] ✅ Successfully added ${downloadKey} to queue. Queue length: ${aiRenameQueue.length}`, {
      position: aiRenameQueue.length,
      originalFilename,
      path: download.target.path
    });
    
    // Update UI to show queue position if this is the focused download
    updateQueueStatusInUI(downloadKey);
    
    // Start processing if not already running
    if (!isProcessingAIQueue) {
      debugLog(`[AI Queue] Starting queue processor (was not running)`);
      processAIRenameQueue();
    } else {
      debugLog(`[AI Queue] Queue processor already running, will process this item when ready`);
    }
    
    return true;
  }
  
  // Remove a download from the queue (e.g., when dismissed or canceled)
  function removeFromAIRenameQueue(downloadKey) {
    const index = aiRenameQueue.findIndex(item => item.downloadKey === downloadKey);
    if (index !== -1) {
      aiRenameQueue.splice(index, 1);
      debugLog(`[AI Queue] Removed ${downloadKey} from queue. Queue length: ${aiRenameQueue.length}`);
      return true;
    }
    return false;
  }
  
  // Get a download's position in the queue (1-based, 0 means not in queue)
  function getQueuePosition(downloadKey) {
    if (currentlyProcessingKey === downloadKey) {
      return 0; // Currently processing, not "waiting"
    }
    const index = aiRenameQueue.findIndex(item => item.downloadKey === downloadKey);
    return index === -1 ? -1 : index + 1;
  }
  
  // Update queue status in the tooltip UI
  function updateQueueStatusInUI(downloadKey) {
    if (downloadKey !== focusedDownloadKey || !masterTooltipDOMElement) return;
    
    const statusEl = masterTooltipDOMElement.querySelector(".card-status");
    if (!statusEl) return;
    
    const position = getQueuePosition(downloadKey);
    const cardData = activeDownloadCards.get(downloadKey);
    
    if (position > 0) {
      // In queue, waiting
      statusEl.textContent = `Waiting for AI rename (${position} in queue)...`;
      statusEl.style.color = "#f39c12"; // Orange for waiting
    } else if (currentlyProcessingKey === downloadKey) {
      // Currently being processed - don't override the processing status
      // The processDownloadForAIRenaming function handles its own status updates
    } else if (cardData?.download?.aiName) {
      // Already renamed
      statusEl.textContent = "Download renamed to:";
      statusEl.style.color = "#a0a0a0";
    } else if (cardData?.download?.succeeded) {
      // Completed but not in queue (either not eligible or already processed)
      statusEl.textContent = "Download completed";
      statusEl.style.color = "#1dd1a1";
    }
  }
  
  // Process the AI rename queue - one at a time, FIFO order
  async function processAIRenameQueue() {
    debugLog(`[AI Queue] processAIRenameQueue called`, {
      isProcessingAIQueue,
      queueLength: aiRenameQueue.length,
      currentlyProcessing: currentlyProcessingKey
    });
    
    if (isProcessingAIQueue) {
      debugLog("[AI Queue] Queue processing already in progress, returning");
      return;
    }
    
    if (aiRenameQueue.length === 0) {
      debugLog("[AI Queue] Queue is empty, nothing to process");
      return;
    }
    
    isProcessingAIQueue = true;
    debugLog(`[AI Queue] ✅ Starting queue processing. Queue length: ${aiRenameQueue.length}`, {
      queueItems: aiRenameQueue.map(item => ({
        key: item.downloadKey,
        path: item.download?.target?.path
      }))
    });
    
    try {
      while (aiRenameQueue.length > 0) {
      const queueItem = aiRenameQueue.shift(); // Get first item (FIFO)
      const { downloadKey, download, originalFilename } = queueItem;
      
      currentlyProcessingKey = downloadKey;
      debugLog(`[AI Queue] Processing ${downloadKey}. Remaining in queue: ${aiRenameQueue.length}`);
      
      // Verify the download is still valid and eligible
      const cardData = activeDownloadCards.get(downloadKey);
      if (!cardData || !cardData.download) {
        debugLog(`[AI Queue] Skipping ${downloadKey} - card data no longer exists`);
        currentlyProcessingKey = null;
        continue;
      }
      
      // Check if already renamed (path might have changed)
      const currentPath = cardData.download.target?.path;
      if (renamedFiles.has(currentPath)) {
        debugLog(`[AI Queue] Skipping ${downloadKey} - already renamed`);
        currentlyProcessingKey = null;
        continue;
      }
      
      // Check if download still succeeded (might have been retried/canceled)
      if (!cardData.download.succeeded) {
        debugLog(`[AI Queue] Skipping ${downloadKey} - no longer in succeeded state`);
        currentlyProcessingKey = null;
        continue;
      }
      
      // Update UI to show "processing" for this download if it's focused
      if (focusedDownloadKey === downloadKey && masterTooltipDOMElement) {
        const statusEl = masterTooltipDOMElement.querySelector(".card-status");
        if (statusEl) {
          statusEl.textContent = "Analyzing for rename...";
          statusEl.style.color = "#54a0ff";
        }
      }
      
      // Update queue positions for other items in queue
      aiRenameQueue.forEach(item => updateQueueStatusInUI(item.downloadKey));
      
      try {
        // Process the AI rename
        const podElement = cardData.podElement;
        if (podElement) {
          podElement.classList.add('renaming-initiated');
        }
        
        await processDownloadForAIRenaming(cardData.download, originalFilename, downloadKey);
        debugLog(`[AI Queue] Successfully processed ${downloadKey}`);
        
      } catch (error) {
        if (error.name === 'AbortError') {
          debugLog(`[AI Queue] Processing of ${downloadKey} was aborted`);
        } else {
          debugLog(`[AI Queue] Error processing ${downloadKey}:`, error);
        }
        
        // Clean up on error
        const cardData = activeDownloadCards.get(downloadKey);
        if (cardData?.podElement) {
          cardData.podElement.classList.remove('renaming-initiated', 'renaming-active');
        }
      }
      
      currentlyProcessingKey = null;
      
      // Small delay between processing to avoid API rate limiting
      if (aiRenameQueue.length > 0) {
        debugLog(`[AI Queue] Waiting before next item. Remaining: ${aiRenameQueue.length}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    } catch (error) {
      console.error("[AI Queue] Error in queue processor:", error);
      debugLog(`[AI Queue] Queue processor error:`, error);
    } finally {
      isProcessingAIQueue = false;
      currentlyProcessingKey = null;
      debugLog("[AI Queue] Queue processing complete (flag reset)");
    }
  }

  // Setup compact mode observer to handle visibility changes
  function setupCompactModeObserver() {
    const mainWindow = document.getElementById('main-window');
    const zenMainAppWrapper = document.getElementById('zen-main-app-wrapper');
    
    if (!mainWindow && !zenMainAppWrapper) {
      debugLog("[CompactModeObserver] Target elements not found, cannot set up observer");
      return;
    }
    
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const attributeName = mutation.attributeName;
          if (attributeName === 'zen-compact-mode' || attributeName === 'zen-sidebar-expanded') {
            debugLog(`[CompactModeObserver] ${attributeName} changed, updating download cards visibility`);
            updateDownloadCardsVisibility();
          }
        }
      }
    });
    
    // Observe main-window for zen-compact-mode (if it exists)
    if (mainWindow) {
      observer.observe(mainWindow, {
        attributes: true,
        attributeFilter: ['zen-compact-mode']
      });
      debugLog("[CompactModeObserver] Observing main-window for zen-compact-mode");
    }
    
    // Also observe documentElement for zen-compact-mode and zen-sidebar-expanded
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['zen-compact-mode', 'zen-sidebar-expanded']
    });
    debugLog("[CompactModeObserver] Observing documentElement for zen-compact-mode and zen-sidebar-expanded");
    
    debugLog("[CompactModeObserver] Set up observer for compact mode changes");
    
    // Initial check with a small delay to ensure DOM is ready
    setTimeout(() => {
      updateDownloadCardsVisibility();
    }, 100);
  }
  
  // Update download cards container visibility based on compact mode
  function updateDownloadCardsVisibility() {
    if (!downloadCardsContainer) return;
    
    // Check compact mode on documentElement (same as zen-stuff)
    const isCompactMode = document.documentElement.getAttribute('zen-compact-mode') === 'true';
    const isSidebarExpanded = document.documentElement.getAttribute('zen-sidebar-expanded') === 'true';
    
    debugLog(`[CompactModeObserver] Checking visibility: isCompactMode=${isCompactMode}, isSidebarExpanded=${isSidebarExpanded}, hasPods=${orderedPodKeys.length > 0}`);
    
    if (isCompactMode && !isSidebarExpanded) {
      // In compact mode with collapsed sidebar, ALWAYS hide the download cards (like media controls)
      debugLog("[CompactModeObserver] Compact mode with collapsed sidebar - FORCING hide of download cards");
      downloadCardsContainer.style.display = 'none';
      downloadCardsContainer.style.opacity = '0';
      downloadCardsContainer.style.visibility = 'hidden';
      downloadCardsContainer.style.pointerEvents = 'none';
      // Also hide tooltip and pods explicitly
      if (masterTooltipDOMElement) {
        masterTooltipDOMElement.style.display = 'none';
        masterTooltipDOMElement.style.opacity = '0';
        masterTooltipDOMElement.style.visibility = 'hidden';
        masterTooltipDOMElement.style.pointerEvents = 'none';
      }
      if (podsRowContainerElement) {
        podsRowContainerElement.style.display = 'none';
        podsRowContainerElement.style.opacity = '0';
        podsRowContainerElement.style.visibility = 'hidden';
        podsRowContainerElement.style.pointerEvents = 'none';
      }
    } else if (orderedPodKeys.length > 0) {
      // Show if we have pods and not in collapsed compact mode
      debugLog("[CompactModeObserver] Showing download cards (not in collapsed compact mode)");
      downloadCardsContainer.style.display = 'flex';
      downloadCardsContainer.style.opacity = '1';
      downloadCardsContainer.style.visibility = 'visible';
      downloadCardsContainer.style.pointerEvents = 'auto';
      // Tooltip and pods visibility will be managed by their own logic
    } else {
      // No pods, hide container
      debugLog("[CompactModeObserver] No pods, hiding download cards");
      downloadCardsContainer.style.display = 'none';
      downloadCardsContainer.style.opacity = '0';
      downloadCardsContainer.style.visibility = 'hidden';
      downloadCardsContainer.style.pointerEvents = 'none';
    }
  }

  // Function to cancel AI process for a specific download
  async function cancelAIProcessForDownload(downloadKey) {
    // Also remove from queue if waiting
    const wasInQueue = removeFromAIRenameQueue(downloadKey);
    if (wasInQueue) {
      debugLog(`[AI Cancel] Removed ${downloadKey} from AI rename queue`);
    }
    
    const aiProcess = activeAIProcesses.get(downloadKey);
    if (!aiProcess) {
      debugLog(`[AI Cancel] No active AI process found for ${downloadKey}`);
      return wasInQueue; // Return true if we at least removed from queue
    }
    
    debugLog(`[AI Cancel] Canceling AI process for ${downloadKey}`, {
      phase: aiProcess.processState.phase,
      duration: Date.now() - aiProcess.startTime
    });
    
    try {
      // Abort the process
      aiProcess.abortController.abort();
      
      // Clean up the process tracking
      activeAIProcesses.delete(downloadKey);
      
      // Clean up UI state
      const cardData = activeDownloadCards.get(downloadKey);
      if (cardData?.podElement) {
        cardData.podElement.classList.remove("renaming-active");
        cardData.podElement.classList.remove("renaming-initiated");
      }
      
      // Update status if this is the focused download
      if (downloadKey === focusedDownloadKey && masterTooltipDOMElement) {
        const statusEl = masterTooltipDOMElement.querySelector(".card-status");
        if (statusEl && (statusEl.textContent.includes("Analyzing") || statusEl.textContent.includes("Generating"))) {
          // Restore appropriate status based on download state
          const download = cardData?.download;
          if (download?.succeeded) {
            statusEl.textContent = "Download completed";
            statusEl.style.color = "#1dd1a1";
          } else if (download?.error) {
            statusEl.textContent = `Error: ${download.error.message || "Download failed"}`;
            statusEl.style.color = "#ff6b6b";
          } else if (download?.canceled) {
            statusEl.textContent = "Download canceled";
            statusEl.style.color = "#ff9f43";
          }
        }
      }
      
      debugLog(`[AI Cancel] Successfully canceled AI process for ${downloadKey}`);
      return true;
      
    } catch (error) {
      debugLog(`[AI Cancel] Error canceling AI process for ${downloadKey}:`, error);
      // Still clean up tracking even if abort failed
      activeAIProcesses.delete(downloadKey);
      return false;
    }
  }

  // Final safety check before declaring success
  if (cssStylesAvailable) {
    console.log("=== DOWNLOAD PREVIEW SCRIPT LOADED SUCCESSFULLY ===");
  } else {
    console.log("=== DOWNLOAD PREVIEW SCRIPT LOADED BUT DISABLED (CSS MISSING) ===");
  }

// --- Sidebar Width Synchronization Logic ---
function updateCurrentZenSidebarWidth() {
  const mainWindow = document.getElementById('main-window');
  const toolbox = document.getElementById('navigator-toolbox');

  if (!toolbox) {
    debugLog('[SidebarWidthSync] #navigator-toolbox not found. Cannot read --zen-sidebar-width.');
    // currentZenSidebarWidth = ''; // Let it retain its value if toolbox temporarily disappears? Or clear?
                                 // For now, if toolbox isn't there, we can't update, so we do nothing to the existing value.
    return;
  }

  // Log compact mode for context, but don't block the read based on it.
  if (mainWindow) {
    const isCompact = mainWindow.getAttribute('zen-compact-mode') === 'true';
    debugLog(`[SidebarWidthSync] #main-window zen-compact-mode is currently: ${isCompact}. Attempting to read from #navigator-toolbox.`);
  } else {
    debugLog('[SidebarWidthSync] #main-window not found. Attempting to read from #navigator-toolbox.');
  }
  
  const value = getComputedStyle(toolbox).getPropertyValue('--zen-sidebar-width').trim();
  
  if (value && value !== "0px" && value !== "") {
    if (currentZenSidebarWidth !== value) {
      currentZenSidebarWidth = value;
      debugLog('[SidebarWidthSync] Updated currentZenSidebarWidth from #navigator-toolbox to:', value);
      applyGlobalWidthToAllTooltips(); // Apply to existing tooltips
    } else {
      debugLog('[SidebarWidthSync] --zen-sidebar-width from #navigator-toolbox is unchanged (' + value + '). No update to tooltips needed.');
    }
  } else {
    // If the value is empty, "0px", or not set, it implies the sidebar isn't in a state where this var is active.
    // Clear our global var so the tooltip uses its own default width.
    if (currentZenSidebarWidth !== '') { // Only update if it actually changes to empty
      currentZenSidebarWidth = ''; 
      debugLog(`[SidebarWidthSync] --zen-sidebar-width on #navigator-toolbox is '${value}'. Cleared currentZenSidebarWidth. Tooltip will use default width.`);
      applyGlobalWidthToAllTooltips(); // Apply default width logic to existing tooltips
    } else {
      debugLog(`[SidebarWidthSync] --zen-sidebar-width on #navigator-toolbox is '${value}' and currentZenSidebarWidth is already empty. No update needed.`);
    }
  }
}

function initSidebarWidthSync() {
  const mainWindow = document.getElementById('main-window');
  const navigatorToolbox = document.getElementById('navigator-toolbox');
  let resizeTimeoutId = null;

  if (mainWindow) {
    // Set up a MutationObserver to watch attribute changes on #main-window for zen-compact-mode
    const mutationObserver = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'zen-compact-mode'
        ) {
          debugLog('[SidebarWidthSync] zen-compact-mode attribute changed. Updating sidebar width.');
          updateCurrentZenSidebarWidth();
        }
      }
    });
    mutationObserver.observe(mainWindow, {
      attributes: true,
      attributeFilter: ['zen-compact-mode']
    });
  } else {
    debugLog('[SidebarWidthSync] initSidebarWidthSync: #main-window not found. Cannot set up MutationObserver for compact mode.');
  }

  if (navigatorToolbox) {
    // Set up a ResizeObserver to watch for size changes on #navigator-toolbox
    const resizeObserver = new ResizeObserver(entries => {
      // Debounce the resize event
      clearTimeout(resizeTimeoutId);
      resizeTimeoutId = setTimeout(() => {
        for (let entry of entries) {
          // We don't strictly need to check entry.contentRect here as getComputedStyle will get the current var value
          debugLog('[SidebarWidthSync] #navigator-toolbox resized. Updating sidebar width.');
          updateCurrentZenSidebarWidth();
        }
      }, 25); // 250ms debounce period
    });
    resizeObserver.observe(navigatorToolbox);
    debugLog('[SidebarWidthSync] ResizeObserver started on #navigator-toolbox.');
  } else {
    debugLog('[SidebarWidthSync] initSidebarWidthSync: #navigator-toolbox not found. Cannot set up ResizeObserver.');
  }

  // Run it once at init in case the attribute/size is already set at load
  debugLog('[SidebarWidthSync] Initial call to update sidebar width.');
  updateCurrentZenSidebarWidth();
}

function applyGlobalWidthToAllTooltips() {
  debugLog('[TooltipWidth] Attempting to apply global width to master tooltip.');
  if (!masterTooltipDOMElement) {
    debugLog('[TooltipWidth] Master tooltip DOM element not found.');
    return;
  }

  // Use 100% width - container handles the padding
  masterTooltipDOMElement.style.width = '100%';
  debugLog('[TooltipWidth] Applied 100% width to master tooltip');
}

// --- Zen Animation Synchronization Logic ---
function triggerCardEntrance(downloadKeyToTrigger) {
  const cardData = activeDownloadCards.get(downloadKeyToTrigger);
  if (!cardData) {
    debugLog(`[ZenSync] triggerCardEntrance: No cardData for key ${downloadKeyToTrigger}`);
    return;
  }

  // This function is now primarily a signal that Zen animation (if any) is complete.
  // It no longer appends or directly animates the pod here.
  // It marks the pod as ready for layout and calls updateUIForFocusedDownload.
  
  if (cardData.isWaitingForZenAnimation) {
    debugLog(`[ZenSync] triggerCardEntrance: Zen animation completed or fallback for ${downloadKeyToTrigger}. Pod is ready for layout.`);
    cardData.isWaitingForZenAnimation = false;
    
    // Ensure the pod is appended to DOM if it hasn't been already
    if (!cardData.domAppended && podsRowContainerElement && cardData.podElement) {
        podsRowContainerElement.appendChild(cardData.podElement);
        cardData.domAppended = true;
        debugLog(`[ZenSync] Appended pod ${downloadKeyToTrigger} to DOM after Zen animation.`);
    }
    
    // Call updateUI which will call managePodVisibilityAndAnimations
    // If this download is the new focus, it makes sense to update everything.
    // If not, we still need to re-evaluate layout for all pods.
    updateUIForFocusedDownload(focusedDownloadKey || downloadKeyToTrigger, false); 
  } else {
    debugLog(`[ZenSync] triggerCardEntrance: Called for ${downloadKeyToTrigger} but it was not waiting for Zen animation. Ignoring.`);
  }
}

function initZenAnimationObserver(downloadKey, podElementToMonitor) { // podElement is passed for context, not direct manipulation here
  debugLog("[ZenSync] Initializing observer for key:", downloadKey);
  let observer = null;
  let fallbackTimeoutId = null;

  const zenAnimationHost = document.querySelector('zen-download-animation');

  if (zenAnimationHost && zenAnimationHost.shadowRoot) {
    debugLog("[ZenSync] Found zen-download-animation host and shadowRoot.");

    observer = new MutationObserver((mutationsList, obs) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          for (const removedNode of mutation.removedNodes) {
            if (removedNode.nodeType === Node.ELEMENT_NODE && removedNode.classList.contains('zen-download-arc-animation')) {
              debugLog("[ZenSync] Detected .zen-download-arc-animation removal. Triggering pod entrance.", { key: downloadKey });
              clearTimeout(fallbackTimeoutId); // Clear the safety fallback
              triggerCardEntrance(downloadKey, podElementToMonitor);
              obs.disconnect(); // Stop observing
              observer = null; // Clean up observer reference
              return; // Exit once detected
            }
          }
        }
      }
    });

    observer.observe(zenAnimationHost.shadowRoot, { childList: true });
    debugLog("[ZenSync] Observer started on shadowRoot.");

    // Safety fallback timeout
    fallbackTimeoutId = setTimeout(() => {
      debugLog("[ZenSync] Fallback timeout reached. Triggering card entrance signal.", { key: downloadKey });
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      triggerCardEntrance(downloadKey); 
      // CardData fallbackTriggered is not strictly needed now as triggerCardEntrance is just a signal
    }, 3000); // 3-second fallback

  } else {
    debugLog("[ZenSync] zen-download-animation host or shadowRoot not found. Triggering card entrance signal immediately.", { key: downloadKey });
    triggerCardEntrance(downloadKey);
    // CardData fallbackTriggered not strictly needed
  }
}

// --- Function to Undo AI Rename ---
async function undoRename(keyOfAIRenamedFile) {
  debugLog("[UndoRename] Attempting to undo rename for key:", keyOfAIRenamedFile);
  const cardData = activeDownloadCards.get(keyOfAIRenamedFile);

  if (!cardData || !cardData.download) {
      debugLog("[UndoRename] No cardData or download object found for key:", keyOfAIRenamedFile);
      return false;
  }

  const currentAIRenamedPath = cardData.download.target.path; // Current path (after AI rename)
  const originalSimpleName = cardData.trueOriginalSimpleNameBeforeAIRename;
  const originalFullPath = cardData.trueOriginalPathBeforeAIRename; // The full path before AI rename

  if (!currentAIRenamedPath || !originalSimpleName || !originalFullPath) {
      debugLog("[UndoRename] Missing path/name information for undo:", 
          { currentAIRenamedPath, originalSimpleName, originalFullPath });
      // Maybe update status to indicate error?
      return false;
  }
  
  // Ensure originalSimpleName is what we expect if originalFullPath is the key to the past state
  // For safety, we reconstruct the target directory from the *current* path if the original was just a simple name.
  const targetDirectory = currentAIRenamedPath.substring(0, currentAIRenamedPath.lastIndexOf(PATH_SEPARATOR));
  const targetOriginalPath = targetDirectory + PATH_SEPARATOR + originalSimpleName;

  debugLog("[UndoRename] Details:", {
      currentPath: currentAIRenamedPath,
      originalSimple: originalSimpleName,
      originalFullPathStored: originalFullPath, // The key to what it *was*
      targetOriginalPathForRename: targetOriginalPath // The path we want to rename *to*
  });

  /**
   * Undo AI rename operation - restore original filename
   * Uses a modified version of rename logic
   */
  try {
      // SECURITY: Validate path before file operations (non-strict for undo operations)
      const undoPathValidation = SecurityUtils.validateFilePath(currentAIRenamedPath, { strict: false });
      if (!undoPathValidation.valid) {
        debugLog("[UndoRename] Path validation warning", {
          path: currentAIRenamedPath,
          error: undoPathValidation.error,
          code: undoPathValidation.code
        });
        // Continue anyway - user-initiated undo operation
      }
      
      const fileToUndo = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      fileToUndo.initWithPath(currentAIRenamedPath);

      if (!fileToUndo.exists()) {
          debugLog("[UndoRename] File to undo does not exist at current path:", currentAIRenamedPath);
          // Perhaps it was moved or deleted by the user? Clean up UI.
          if (masterTooltipDOMElement) {
              const undoBtn = masterTooltipDOMElement.querySelector(".card-undo-button");
              if (undoBtn) undoBtn.style.display = "none";
          }
          // Consider removing the card or updating status more drastically.
          return false;
      }

      // Perform the rename back to originalSimpleName in the current directory
      fileToUndo.moveTo(null, originalSimpleName); 
      debugLog(`[UndoRename] File moved from ${currentAIRenamedPath} to ${targetOriginalPath} (using simple name ${originalSimpleName})`);

      // Update download object and cardData
      cardData.download.target.path = targetOriginalPath;
      cardData.download.aiName = null; // Clear the AI name
      // cardData.originalFilename should revert to originalSimpleName (or be updated by next UI refresh)
      cardData.originalFilename = originalSimpleName; 

      // Update the key in activeDownloadCards map
      if (keyOfAIRenamedFile !== targetOriginalPath) {
          activeDownloadCards.delete(keyOfAIRenamedFile);
          activeDownloadCards.set(targetOriginalPath, cardData);
          cardData.key = targetOriginalPath;
          if (cardData.podElement) cardData.podElement.dataset.downloadKey = targetOriginalPath;
          
          // Update orderedPodKeys
          const oldKeyIndex = orderedPodKeys.indexOf(keyOfAIRenamedFile);
          if (oldKeyIndex > -1) {
              orderedPodKeys.splice(oldKeyIndex, 1, targetOriginalPath);
          }

          // If this was the focused key, update focusedDownloadKey
          if (focusedDownloadKey === keyOfAIRenamedFile) {
              focusedDownloadKey = targetOriginalPath;
          }
          debugLog(`[UndoRename] Updated activeDownloadCards map key from ${keyOfAIRenamedFile} to ${targetOriginalPath}`);
      }
      
      renamedFiles.delete(originalFullPath); // Allow AI re-rename if user downloads it again or wants to retry
      renamedFiles.delete(currentAIRenamedPath); // Remove the AI-renamed path from the set too

      // Update UI immediately for the focused item
      if (focusedDownloadKey === targetOriginalPath && masterTooltipDOMElement) {
          const titleEl = masterTooltipDOMElement.querySelector(".card-title");
          const statusEl = masterTooltipDOMElement.querySelector(".card-status");
          const originalFilenameEl = masterTooltipDOMElement.querySelector(".card-original-filename");
          const progressEl = masterTooltipDOMElement.querySelector(".card-progress");
          const undoBtn = masterTooltipDOMElement.querySelector(".card-undo-button");

          if (titleEl) titleEl.textContent = originalSimpleName;
          if (statusEl) {
              statusEl.textContent = "Download completed"; // Or original status if stored
              statusEl.style.color = "#1dd1a1";
          }
          if (originalFilenameEl) originalFilenameEl.style.display = "none";
          if (progressEl) progressEl.style.display = "block"; // Show progress/size again
          if (undoBtn) undoBtn.style.display = "none";
      }

      // Trigger a full UI update
      updateUIForFocusedDownload(focusedDownloadKey || targetOriginalPath, true); 

      debugLog("[UndoRename] Rename undone successfully.");
      return true;

  } catch (e) {
      debugLog("[UndoRename] Error during undo rename process:", e);
      // Update status to show error?
      if (masterTooltipDOMElement && focusedDownloadKey === keyOfAIRenamedFile) {
           const statusEl = masterTooltipDOMElement.querySelector(".card-status");
           if (statusEl) {
              statusEl.textContent = "Undo rename failed";
              statusEl.style.color = "#ff6b6b";
           }
      }
      return false;
  }
}

  } // Close initializeMainScript function

})(); //Test Comment again again x3
