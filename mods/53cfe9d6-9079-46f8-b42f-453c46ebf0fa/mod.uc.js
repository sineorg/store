
// This file combines all the provided userChrome.js scripts into a single file for easier management.
// The logic of each script has been preserved without modification as requested.
// MODIFICATION: Replaced all instances of '.vertical-pinned-tabs-container-separator' with '.pinned-tabs-container-separator'.

// ====================================================================================================
// SCRIPT 1: Dynamic URLBar Background Height
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          Dynamic URLBar Background Height
// @description   Adjusts the height of #browser::before to match .urlbarView height.
// ==/UserScript==
// (Note: The above header is for userscript managers, may not be needed for autoconfig)
if (Services.prefs.getBoolPref("browser.tabs.allow_transparent_browser")) {
(function() {
  // Only run in the main browser window
  if (window.location.href !== 'chrome://browser/content/browser.xhtml') {
      return;
  }

  console.log("DynamicUrlbarHeight script loading...");

  const BROWSER_ELEMENT_ID = 'browser';
  const URLBAR_ELEMENT_ID = 'urlbar';
  const URLBAR_VIEW_SELECTOR = '.urlbarView'; // Selector for the results container
  const HEIGHT_VARIABLE_NAME = '--urlbar-view-dynamic-height';

  let browserElement = document.getElementById(BROWSER_ELEMENT_ID);
  let urlbarElement = document.getElementById(URLBAR_ELEMENT_ID);
  let urlbarViewElement = null; // Will store the results view element when found
  let resizeObserver = null;
  let mutationObserver = null;

  // --- Function to find the Urlbar View ---
  // Needs to be robust as it might not be a direct child
  function findUrlbarViewElement() {
      if (!urlbarElement) return null;
      // First, try direct descendant of urlbar (most common)
      let view = urlbarElement.querySelector(`:scope > ${URLBAR_VIEW_SELECTOR}`);
      if (view) return view;
      // Fallback: search within the broader browser element (less specific)
      if (browserElement) {
          view = browserElement.querySelector(URLBAR_VIEW_SELECTOR);
          if (view) return view;
      }
      // Fallback: Search the whole document (least ideal)
      view = document.querySelector(URLBAR_VIEW_SELECTOR);

      // You might need to inspect the DOM in your specific FF version/theme
      // if .urlbarView isn't the right container. .urlbarView-body-outer or
      // .urlbarView-results might be needed in some cases.
      // console.log("Searching for urlbar view, found:", view);
      return view;
  }


  // --- Function to measure and update the CSS variable ---
  function updateHeightVariable() {
      if (!browserElement) return;

      // Check if urlbar is open and view element exists
      if (urlbarElement && urlbarElement.hasAttribute('open') && urlbarViewElement) {
          try {
              // getBoundingClientRect().height is often more accurate than offsetHeight
              const height = urlbarViewElement.getBoundingClientRect().height;

              if (height > 0) {
                   // console.log(`Updating ${HEIGHT_VARIABLE_NAME} to: ${height}px`);
                  browserElement.style.setProperty(HEIGHT_VARIABLE_NAME, `${height}px`);
              } else {
                  // If height is 0 (maybe transitioning out), remove the variable
                  // console.log("Urlbar view height is 0, removing variable.");
                  browserElement.style.removeProperty(HEIGHT_VARIABLE_NAME);
              }
          } catch (e) {
              console.error("DynamicUrlbarHeight Error measuring/setting height:", e);
              browserElement.style.removeProperty(HEIGHT_VARIABLE_NAME); // Reset on error
          }
      } else {
          // Urlbar is closed or view not found, remove the variable
          // console.log("Urlbar closed or view not found, removing variable.");
          browserElement.style.removeProperty(HEIGHT_VARIABLE_NAME);
      }
  }

  // --- Initialize ResizeObserver ---
  // This watches the results view itself for size changes while it's open
  function setupResizeObserver() {
      if (resizeObserver) return; // Already setup

      resizeObserver = new ResizeObserver(entries => {
          // Only update if the urlbar is still open; debounce might be needed
          // if updates are too frequent, but usually fine.
          if (urlbarElement && urlbarElement.hasAttribute('open')) {
              // console.log("ResizeObserver detected change on .urlbarView");
              window.requestAnimationFrame(updateHeightVariable); // Update smoothly
          } else {
              // Stop observing if urlbar closed unexpectedly between resize and callback
               console.log("ResizeObserver detected change, but urlbar closed. Stopping observation.");
              if (urlbarViewElement) {
                  try { resizeObserver.unobserve(urlbarViewElement); } catch(e){}
              }
          }
      });
       console.log("ResizeObserver initialized.");
  }

  // --- Initialize MutationObserver ---
  // This watches the #urlbar for the 'open' attribute
  function setupMutationObserver() {
      if (!urlbarElement || mutationObserver) return; // Need urlbar, or already setup

      mutationObserver = new MutationObserver(mutations => {
          let urlbarStateChanged = false;
          for (let mutation of mutations) {
              if (mutation.attributeName === 'open') {
                  urlbarStateChanged = true;
                  break;
              }
          }

          if (!urlbarStateChanged) return; // Only care about the 'open' attribute

          if (urlbarElement.hasAttribute('open')) {
              // --- URL Bar Opened ---
               console.log("MutationObserver: URL Bar Opened");
              // Try to find the view element *now*
              urlbarViewElement = findUrlbarViewElement();

              if (urlbarViewElement) {
                  // Update height immediately
                  updateHeightVariable();
                  // Start observing the view for resize changes
                  if (resizeObserver) {
                       try {
                          resizeObserver.observe(urlbarViewElement);
                           console.log("ResizeObserver started observing .urlbarView");
                       } catch (e) {
                           console.error("Error starting ResizeObserver:", e);
                       }
                  }
              } else {
                  console.warn("URL Bar opened, but '.urlbarView' element not found immediately.");
                  // Optionally, try again after a tiny delay
                  setTimeout(() => {
                       urlbarViewElement = findUrlbarViewElement();
                       if (urlbarViewElement && urlbarElement.hasAttribute('open')) {
                           console.log("Found .urlbarView on second attempt.");
                           updateHeightVariable();
                           if (resizeObserver) try { resizeObserver.observe(urlbarViewElement); } catch(e){}
                       } else if (urlbarElement.hasAttribute('open')) {
                            console.error("Still couldn't find .urlbarView after delay.");
                       }
                  }, 100); // 100ms delay
              }

          } else {
              // --- URL Bar Closed ---
              console.log("MutationObserver: URL Bar Closed");
              // Stop observing the (now potentially hidden) view element
              if (resizeObserver && urlbarViewElement) {
                  try {
                      resizeObserver.unobserve(urlbarViewElement);
                       console.log("ResizeObserver stopped observing .urlbarView");
                  } catch (e) {
                       // Ignore errors if element is already gone
                  }
              }
              urlbarViewElement = null; // Clear reference
              // Ensure the variable is removed
              updateHeightVariable();
          }
      });

      mutationObserver.observe(urlbarElement, { attributes: true });
      console.log("MutationObserver started observing #urlbar for 'open' attribute.");
  }


  // --- Initialization Logic ---
  function initialize() {
      browserElement = document.getElementById(BROWSER_ELEMENT_ID);
      urlbarElement = document.getElementById(URLBAR_ELEMENT_ID);

      if (!browserElement || !urlbarElement) {
          console.error("DynamicUrlbarHeight Error: #browser or #urlbar element not found. Retrying...");
          // Retry initialization after a short delay in case elements aren't ready yet
          setTimeout(initialize, 1000);
          return;
      }

      console.log("DynamicUrlbarHeight: Found #browser and #urlbar elements.");

      setupResizeObserver();
      setupMutationObserver();

      // Initial check in case the URL bar is already open when the script loads
      // (less common, but good practice)
      if (urlbarElement.hasAttribute('open')) {
           console.log("URL bar already open on script load. Performing initial check.");
          urlbarViewElement = findUrlbarViewElement();
          if (urlbarViewElement) {
              updateHeightVariable();
              if (resizeObserver) try { resizeObserver.observe(urlbarViewElement); } catch(e){}
          }
      }
  }

  // Start initialization logic
  // Use requestIdleCallback or setTimeout to ensure the DOM is more likely ready
  if (document.readyState === 'complete') {
      initialize();
  } else {
      window.addEventListener('load', initialize, { once: true });
  }

})();
}

// ====================================================================================================
// SCRIPT 2: Global URL Bar Scroller (FINAL VERSION 1.0.0) - Customizable via about:config - Arcline Theme
//  - STRINGS in about:config - NO FALLBACK VALUES
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          Arcline Global URL Bar Scroller
// @description   Makes normal URL bar results scrollable. Customizable via about:config (Strings). NO FALLBACK VALUES - Arcline Theme
// ==/UserScript==
// arcline_urlbar_global_scroll_final.js (Standalone, Polite Version) - about:config customization - Arcline Theme

(function() {
  if (location.href !== 'chrome://browser/content/browser.xhtml') {
    return;
  }

  console.log("Zen URL Bar Animated Height (CSS-Controlled Easing) script loading...");

  const CONFIG = {
    URLBAR_ID: 'urlbar',
    URLBAR_RESULTS_ID: 'urlbar-results',
    MANUAL_ROW_HEIGHT_PX: 51,    // <--- Your desired manual row height
    VISIBLE_RESULTS_LIMIT: 5,    // The number of results to show before scrolling
    SCROLLABLE_CLASS: 'zen-urlbar-scrollable-script',
    DEBOUNCE_DELAY_MS: 40,
  };

  // Pre-calculate the initial cap height for easier reference in CSS
  CONFIG.INITIAL_CAP_HEIGHT_PX = CONFIG.VISIBLE_RESULTS_LIMIT * CONFIG.MANUAL_ROW_HEIGHT_PX;

  let urlbarElement, resultsElement;
  let updateTimeout = null;
  let lastResultCount = -1;

  /**
   * The core logic for animating and managing the results panel height.
   */
  function updateViewState() {
    if (!resultsElement || !urlbarElement) return;

    clearTimeout(updateTimeout);

    updateTimeout = setTimeout(() => {


      // --- ZEN COMMAND PALETTE COMPATIBILITY CHECK ---
      // This is the crucial logic from your original script.
      const isCommandModeActive = window.ZenCommandPalette?.provider?._isInPrefixMode ?? false;
      if (isCommandModeActive) {
        // If the command palette is active, our script must do nothing and clean up its styles.
        resultsElement.classList.remove(CONFIG.SCROLLABLE_CLASS);
        resultsElement.style.removeProperty('height');
        resultsElement.style.removeProperty('max-height');
        resultsElement.style.removeProperty('overflow-y');
        return; // Exit immediately.
      }





      const isUrlbarOpen = urlbarElement.hasAttribute('open');
      const isUserTyping = urlbarElement.hasAttribute('usertyping');
      
      const computedStyle = resultsElement.ownerDocument.defaultView.getComputedStyle(resultsElement);
      const isUrlbarViewVisibleByCSS = computedStyle.getPropertyValue('display') !== 'none' &&
                                      parseFloat(computedStyle.getPropertyValue('opacity')) > 0;

      if (!isUrlbarOpen && !isUserTyping) {
          // If urlbar is completely closed and not typing, reset our state.
          resultsElement.classList.remove(CONFIG.SCROLLABLE_CLASS);
          resultsElement.style.removeProperty('height');
          resultsElement.style.removeProperty('max-height');
          resultsElement.style.removeProperty('overflow-y');
          resultsElement.scrollTop = 0;
          lastResultCount = -1;
          return;
      }
      
      if (isUrlbarOpen && !isUrlbarViewVisibleByCSS) {
          // urlbar is open but your CSS is still animating its display/opacity, or it's not yet considered visible.
          // Reinforce the initial cap if our script hasn't taken over height yet.
          if (!resultsElement.style.height) {
              resultsElement.style.height = `${CONFIG.INITIAL_CAP_HEIGHT_PX}px`;
              resultsElement.style.overflowY = 'hidden';
          }
          return;
      }

      // At this point, the URL bar view should be visible and ready for height calculation.
      resultsElement.style.removeProperty('max-height'); // Ensure we override any lingering max-height from Zen's CSS or our temp styles.
      
      const resultRows = resultsElement.querySelectorAll('.urlbarView-row:not([type="tip"])');
      const currentResultCount = resultRows.length;

      if (currentResultCount === lastResultCount && lastResultCount !== -1) {
          return;
      }
      lastResultCount = currentResultCount;

      const isScrollable = currentResultCount > CONFIG.VISIBLE_RESULTS_LIMIT;
      resultsElement.classList.toggle(CONFIG.SCROLLABLE_CLASS, isScrollable);

      let targetHeight;
      if (isScrollable) {
        targetHeight = CONFIG.VISIBLE_RESULTS_LIMIT * CONFIG.MANUAL_ROW_HEIGHT_PX;
      } else {
        targetHeight = currentResultCount * CONFIG.MANUAL_ROW_HEIGHT_PX;
      }

      // Apply the height, which will trigger the CSS transition
      resultsElement.style.height = `${targetHeight}px`;
      resultsElement.style.overflowY = isScrollable ? 'auto' : 'hidden';

      // Universal auto-scroll logic for arrow keys.
      for (const row of resultRows) {
          if (row.hasAttribute('selected')) {
              row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              break;
          }
      }

    }, CONFIG.DEBOUNCE_DELAY_MS);
  }

  /**
   * Sets up the necessary listeners.
   */
  function setupListeners() {
    const mutationObserver = new MutationObserver(() => {
      updateViewState();
    });
    mutationObserver.observe(resultsElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected'] });

    const urlbarAttributeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.attributeName === 'usertyping' || mutation.attributeName === 'open') {
                updateViewState();
            }
        }
    });
    urlbarAttributeObserver.observe(urlbarElement, { attributes: true, attributeFilter: ['usertyping', 'open'] });

    urlbarElement.addEventListener('popuphidden', () => {
        clearTimeout(updateTimeout);
        resultsElement.classList.remove(CONFIG.SCROLLABLE_CLASS);
        resultsElement.style.removeProperty('height');
        resultsElement.style.removeProperty('max-height');
        resultsElement.style.removeProperty('overflow-y');
        resultsElement.scrollTop = 0;
        lastResultCount = -1;
    });
  }

  /**
   * Waits for all necessary UI elements to exist before initializing.
   */
  function initialize() {
    urlbarElement = document.getElementById(CONFIG.URLBAR_ID);
    resultsElement = document.getElementById(CONFIG.URLBAR_RESULTS_ID);

    if (!urlbarElement || !resultsElement) {
      setTimeout(initialize, 500);
      return;
    }

    // Inject the CSS. This CSS now uses custom properties for transition.
    const styleId = 'zen-urlbar-animated-height-styles-css-controlled';
    if (!document.getElementById(styleId)) {
      const css = `
        /* Default values for custom properties if not defined in userChrome.css */
        

        #${CONFIG.URLBAR_RESULTS_ID} {
          /* Flicker-Free: Immediately cap height and hide overflow until JS takes over */
          max-height: ${CONFIG.INITIAL_CAP_HEIGHT_PX}px !important;
          overflow-y: hidden !important; 
          
        }
        #${CONFIG.URLBAR_RESULTS_ID}.${CONFIG.SCROLLABLE_CLASS} {
          overflow-y: auto !important; 
        }
      `;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
      console.log("Zen URL Bar Animated Height (CSS-Controlled Easing) styles injected.");
    }

    setupListeners();
    updateViewState(); 
    console.log("Zen URL Bar Animated Height (CSS-Controlled Easing) Initialized.");
  }

  if (document.readyState === 'complete') {
    initialize();
  } else {
    window.addEventListener('load', initialize, { once: true });
  }

})();

// ====================================================================================================
// SCRIPT 3: Tab Explode Animation
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name           Tab Explode Animation
// @version        1.0
// @author         Your Name
// @description    Adds a bubble explosion animation when a tab or tab group is closed.
// @compatibility  Firefox 100+
// ==/UserScript==
if (Services.prefs.getBoolPref("arcline.script3")) {
  // Run script

(() => {
    console.log("Tab Explode Animation: Script execution started.");

    const TAB_EXPLODE_ANIMATION_ID = 'tab-explode-animation-styles';
    const BUBBLE_COUNT = 25; // Number of bubbles
    const ANIMATION_DURATION = 600; // Milliseconds

    function injectStyles() {
        if (document.getElementById(TAB_EXPLODE_ANIMATION_ID)) {
            return;
        }

        const css = `
            .tab-explosion-container {
                position: absolute;
                top: 0; /* Will be set by JS */
                left: 0; /* Will be set by JS */
                width: 0; /* Will be set by JS */
                height: 0; /* Will be set by JS */
                pointer-events: none; /* Don't interfere with mouse events */
                z-index: 99999; /* Above other tab elements */
            }

            .bubble-particle {
                position: absolute;
                /* background-color: var(--toolbarbutton-icon-fill-attention, dodgerblue); */ /* Use a theme-aware color or a fixed one */
                background-color: light-dark( #cac2b6, #808080) !important;
                border-radius: 50%;
                opacity: 0.8;
                animation-name: bubbleExplode;
                animation-duration: ${ANIMATION_DURATION}ms;
                animation-timing-function: ease-out;
                animation-fill-mode: forwards; /* Stay at the end state (invisible) */
                will-change: transform, opacity; /* Hint for browser optimization */
            }

            @keyframes bubbleExplode {
                0% {
                    transform: scale(0.2);
                    opacity: 0.8;
                }
                100% {
                    transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(var(--s, 1));
                    opacity: 0;
                }
            }
        `;

        const styleElement = document.createElement('style');
        styleElement.id = TAB_EXPLODE_ANIMATION_ID;
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
        console.log("Tab Explode Animation: Styles injected.");
    }

    function animateElementClose(element) {
        if (!element || !element.isConnected) return;

        const elementRect = element.getBoundingClientRect(); // Viewport-relative
        const explosionContainer = document.createElement('div');
        explosionContainer.className = 'tab-explosion-container'; // Has position: absolute

        // Determine the parent for the animation.
        // #browser is a high-level container for the browser content area.
        let parentForAnimation = document.getElementById('browser');
        if (!parentForAnimation || !parentForAnimation.isConnected) {
            // Fallback to main-window or even documentElement if #browser is not suitable
            parentForAnimation = document.getElementById('main-window') || document.documentElement;
        }
        
        const parentRect = parentForAnimation.getBoundingClientRect();

        // Calculate position of explosionContainer relative to parentForAnimation,
        // such that it aligns with the element's viewport position.
        explosionContainer.style.left = `${elementRect.left - parentRect.left}px`;
        explosionContainer.style.top = `${elementRect.top - parentRect.top}px`;
        explosionContainer.style.width = `${elementRect.width}px`;
        explosionContainer.style.height = `${elementRect.height}px`;
        
        parentForAnimation.appendChild(explosionContainer);

        for (let i = 0; i < BUBBLE_COUNT; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'bubble-particle';

            let initialX, initialY;
            let edge;
            if (i < 4) { // Assign the first four bubbles to distinct edges (0, 1, 2, 3)
                edge = i;
            } else {     // For subsequent bubbles, assign to a random edge
                edge = Math.floor(Math.random() * 4);
            }

            const bubbleSizeOffset = 5; // Half of average bubble size, to keep them visually on edge

            switch (edge) {
                case 0: // Top edge
                    initialX = Math.random() * elementRect.width;
                    initialY = -bubbleSizeOffset;
                    break;
                case 1: // Right edge
                    initialX = elementRect.width + bubbleSizeOffset;
                    initialY = Math.random() * elementRect.height;
                    break;
                case 2: // Bottom edge
                    initialX = Math.random() * elementRect.width;
                    initialY = elementRect.height + bubbleSizeOffset;
                    break;
                case 3: // Left edge
                    initialX = -bubbleSizeOffset;
                    initialY = Math.random() * elementRect.height;
                    break;
            }
            
            bubble.style.left = `${initialX}px`; 
            bubble.style.top = `${initialY}px`;
            bubble.style.width = `${Math.random() * 4 + 4}px`; // Random size (4px to 8px)
            bubble.style.height = bubble.style.width;

            // Random final translation and scale for each bubble
            const angle = Math.random() * Math.PI * 2;
            let distance = Math.random() * 1 + 1; // Explosion radius, even further reduced spread
            let finalTranslateX = Math.cos(angle) * distance;
            let finalTranslateY = Math.sin(angle) * distance;
            
            // Bias explosion outwards from the edge
            const outwardBias = 10; // Reduced outward bias
            if (edge === 0) finalTranslateY -= outwardBias; // Upwards from top
            if (edge === 1) finalTranslateX += outwardBias; // Rightwards from right
            if (edge === 2) finalTranslateY += outwardBias; // Downwards from bottom
            if (edge === 3) finalTranslateX -= outwardBias; // Leftwards from left

            const finalScale = Math.random() * 0.4 + 0.7; // Scale up a bit

            bubble.style.setProperty('--tx', `${finalTranslateX}px`);
            bubble.style.setProperty('--ty', `${finalTranslateY}px`);
            bubble.style.setProperty('--s', finalScale);
            
            // Stagger animation start slightly
            bubble.style.animationDelay = `${Math.random() * 120}ms`;

            explosionContainer.appendChild(bubble);
        }

        // Make the original element content invisible immediately
        element.style.opacity = '0';
        element.style.transition = 'opacity 0.1s linear';

        // Remove the explosion container after the animation
        setTimeout(() => {
            if (explosionContainer.parentNode) {
                explosionContainer.parentNode.removeChild(explosionContainer);
            }
        }, ANIMATION_DURATION + 100); // Add slight buffer for animation delay
    }

    function onTabClose(event) {
        const tab = event.target;
        // Ensure it's a normal tab and not something else
        if (tab.localName === 'tab' && !tab.pinned && tab.isConnected) {
            // Check if the tab is part of a group
            const groupParent = tab.closest('tab-group');
            if (!groupParent) {
            console.log("Tab Explode Animation: TabClose event triggered for tab:", tab);
                animateElementClose(tab);
            }
        }
    }

    function onTabGroupRemove(event) {
        console.log("Tab Explode Animation: TabGroupRemove event received:", event);
        const group = event.target;
        if (group && group.localName === 'tab-group' && group.isConnected) {
            console.log("Tab Explode Animation: TabGroupRemove event triggered for group:", group);
            animateElementClose(group);
        }
    }

    function init() {
        console.log("Tab Explode Animation: init() function called.");
        injectStyles();
        if (typeof gBrowser !== 'undefined' && gBrowser.tabContainer) {
            console.log("Tab Explode Animation: gBrowser and gBrowser.tabContainer are available.");
            gBrowser.tabContainer.addEventListener('TabClose', onTabClose, false);
            
            // Add multiple event listeners to catch tab group removal
            gBrowser.tabContainer.addEventListener('TabGroupRemove', onTabGroupRemove, false);
            gBrowser.tabContainer.addEventListener('TabGroupClosed', onTabGroupRemove, false);
            gBrowser.tabContainer.addEventListener('TabGroupRemoved', onTabGroupRemove, false);
            
            // Also listen for the custom event that might be used
            document.addEventListener('TabGroupRemoved', onTabGroupRemove, false);
            
            console.log("Tab Explode Animation: Listeners attached to TabClose and TabGroup events.");
        } else {
            // Retry if gBrowser is not ready
            console.log("Tab Explode Animation: gBrowser not ready, scheduling retry.");
            setTimeout(init, 1000);
        }
    }

    // Wait for the browser to be fully loaded
    console.log("Tab Explode Animation: Setting up load event listener or calling init directly.");
    if (document.readyState === "complete") {
        console.log("Tab Explode Animation: Document already complete, calling init().");
        init();
    } else {
        console.log("Tab Explode Animation: Document not complete, adding load event listener for init().");
        window.addEventListener("load", init, { once: true });
    }

})(); 
}




// ====================================================================================================
// SCRIPT 4: Zen Media Cover Art Provider
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name           zen-media-coverart-enhanced-bg-wrapper-hoverfix
// @namespace      zenMediaCoverArtEnhancedBgWrapperHoverFix
// @description    Set Zen media coverart via wrapper (v1.7b - Adjusts opacity on hover for consistent brightness). Affects background ONLY.
// @version        1.7b
// ==/UserScript==

if (Services.prefs.getBoolPref("arcline.script5")) {
  
const ZenCoverArtCSSProvider = {
  lastArtworkUrl: null,
  _toolbarItem: null,
  _currentController: null,
  _boundMetadataListener: null,

  _getToolbarItem() {
    if (!this._toolbarItem) {
      this._toolbarItem = document.querySelector("#zen-media-controls-toolbar > toolbaritem");
      if (!this._toolbarItem) console.error("[ZenCoverArt] Toolbar item not found.");
    }
    return this._toolbarItem;
  },
  
  _selectLargestArtwork(artworkList) {
    if (!Array.isArray(artworkList) || artworkList.length === 0) return null;
    return artworkList.reduce((max, cur) => {
      const [mw, mh] = max.sizes?.split("x").map(Number) || [0, 0];
      const [cw, ch] = cur.sizes?.split("x").map(Number) || [0, 0];
      return cw * ch > mw * mh ? cur : max;
    });
  },

  _setCoverArtVariable(coverUrl) {
    const toolbarItem = this._getToolbarItem();
    if (!toolbarItem) return;
    this.lastArtworkUrl = coverUrl;
    toolbarItem.style.setProperty('--zen-cover-art-url', `url("${CSS.escape(coverUrl)}")`);
  },

  _removeCoverArtVariable() {
    const toolbarItem = this._getToolbarItem();
    if (toolbarItem && this.lastArtworkUrl !== null) {
      this.lastArtworkUrl = null;
      toolbarItem.style.removeProperty('--zen-cover-art-url');
    }
  },

  _update(controller) {
    const metadata = controller?.getMetadata?.();
    const bestArtwork = this._selectLargestArtwork(metadata?.artwork);
    const coverUrl = bestArtwork?.src;
    if (coverUrl) {
      if (coverUrl !== this.lastArtworkUrl) this._setCoverArtVariable(coverUrl);
    } else {
      this._removeCoverArtVariable();
    }
  },

  _attachToController(controller) {
    if (this._currentController && this._boundMetadataListener) {
      this._currentController.removeEventListener("metadatachange", this._boundMetadataListener);
    }
    this._currentController = controller;
    if (!controller) {
      this._removeCoverArtVariable();
      return;
    }
    this._boundMetadataListener = this._update.bind(this, controller);
    controller.addEventListener("metadatachange", this._boundMetadataListener);
    this._update(controller);
  },

  init() {
    const wait = () => {
      if (typeof window.gZenMediaController?.setupMediaController !== "function") {
        setTimeout(wait, 300);
        return;
      }
      const originalSetup = window.gZenMediaController.setupMediaController.bind(window.gZenMediaController);
      window.gZenMediaController.setupMediaController = (controller, browser) => {
        this._attachToController(controller);
        return originalSetup(controller, browser);
      };
      if (window.gZenMediaController._currentMediaController) {
        this._attachToController(window.gZenMediaController._currentMediaController);
      }
    };
    wait();
  }
};

ZenCoverArtCSSProvider.init();

}

// ====================================================================================================
// SCRIPT 5: Compact Mode Sidebar Width Fix
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name           CompactmodeSidebarWidthFix
// @namespace      psuedobgwidthfix
// @description    it help in adjust dynamic width of psuedo background
// @version        1.7b
// ==/UserScript==
if (Services.prefs.getBoolPref("browser.tabs.allow_transparent_browser")) {
(function () {
  const mainWindow = document.getElementById('main-window');
  const toolbox = document.getElementById('navigator-toolbox');

  function updateSidebarWidthIfCompact() {
    const isCompact = mainWindow.getAttribute('zen-compact-mode') === 'true';
    if (!isCompact) return;

    const value = getComputedStyle(toolbox).getPropertyValue('--zen-sidebar-width');
    if (value) {
      mainWindow.style.setProperty('--zen-sidebar-width', value.trim());
      console.log('[userChrome] Synced --zen-sidebar-width to #main-window:', value.trim());
    }
  }

  // Set up a MutationObserver to watch attribute changes on #main-window
  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'zen-compact-mode'
      ) {
        updateSidebarWidthIfCompact();
      }
    }
  });

  // Observe attribute changes
  observer.observe(mainWindow, {
    attributes: true,
    attributeFilter: ['zen-compact-mode']
  });

  // Optional: run it once in case the attribute is already set at load
  updateSidebarWidthIfCompact();
})();
}

// ====================================================================================================
// SCRIPT 6: Gradient Opacity Adjuster
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name           GradientOpacitydjuster
// @namespace      variableopacity
// @description    it help in adjust dynamically opacity and contrast of icons and other elements
// @version        1.7b
// ==/UserScript==

(function () {
  console.log('[UserChromeScript] custom-input-to-dual-css-vars-persistent.uc.js starting...');

  // --- Configuration ---
  const INPUT_ELEMENT_ID = 'PanelUI-zen-gradient-generator-opacity';
  const CSS_VARIABLE_DIRECT_NAME = '--zen-gradient-opacity';
  const CSS_VARIABLE_INVERTED_NAME = '--zen-gradient-opacity-inverted';
  const TARGET_ELEMENT_FOR_CSS_VAR = document.documentElement; // Apply globally to <html>
  const PREF_NAME = `userchrome.custom.${INPUT_ELEMENT_ID}.value`;

  // IMPORTANT: Define how to interpret the input's value for inversion
  // If input.value is naturally 0-1 (e.g. for opacity):
  const INPUT_VALUE_MIN = 0;
  const INPUT_VALUE_MAX = 1;
  // If input.value is 0-100 (e.g. a percentage slider):
  // const INPUT_VALUE_MIN = 0;
  // const INPUT_VALUE_MAX = 100;
  // --- End Configuration ---

  let inputElement = null;
  let Services;

  try {
    Services = globalThis.Services || ChromeUtils.import("resource://gre/modules/Services.jsm").Services;
    console.log('[UserChromeScript] Services module loaded.');
  } catch (e) {
    console.error('[UserChromeScript] CRITICAL: Failed to load Services module:', e);
    Services = null; // Ensure it's null if loading failed
  }

  function saveValueToPrefs(value) {
    if (!Services || !Services.prefs) {
      console.warn('[UserChromeScript] Services.prefs not available. Cannot save preference.');
      return;
    }
    try {
      Services.prefs.setStringPref(PREF_NAME, String(value)); // Save as string
      // console.log(`[UserChromeScript] Saved to prefs (${PREF_NAME}):`, value);
    } catch (e) {
      console.error(`[UserChromeScript] Error saving preference ${PREF_NAME}:`, e);
    }
  }

  function loadValueFromPrefs() {
    if (!Services || !Services.prefs) {
      console.warn('[UserChromeScript] Services.prefs not available. Cannot load preference.');
      return null;
    }
    if (Services.prefs.prefHasUserValue(PREF_NAME)) {
      try {
        const value = Services.prefs.getStringPref(PREF_NAME);
        // console.log(`[UserChromeScript] Loaded from prefs (${PREF_NAME}):`, value);
        return value; // Return as string, will be parsed later
      } catch (e) {
        console.error(`[UserChromeScript] Error loading preference ${PREF_NAME}:`, e);
        return null;
      }
    }
    // console.log(`[UserChromeScript] No user value found for preference ${PREF_NAME}.`);
    return null;
  }

  function applyCssVariables(directValueStr) {
    if (!TARGET_ELEMENT_FOR_CSS_VAR) {
      console.warn(`[UserChromeScript] Target element for CSS variables not found.`);
      return;
    }

    let directValueNum = parseFloat(directValueStr);

    // Validate and clamp the directValueNum based on defined min/max
    if (isNaN(directValueNum)) {
        console.warn(`[UserChromeScript] Invalid number parsed from input: '${directValueStr}'. Using default of ${INPUT_VALUE_MIN}.`);
        directValueNum = INPUT_VALUE_MIN;
    }
    directValueNum = Math.max(INPUT_VALUE_MIN, Math.min(INPUT_VALUE_MAX, directValueNum));

    // Calculate inverted value
    // Formula for inversion: inverted = MAX - (value - MIN)
    // Or simpler if MIN is 0: inverted = MAX - value
    const invertedValueNum = (INPUT_VALUE_MAX + INPUT_VALUE_MIN) - directValueNum;


    TARGET_ELEMENT_FOR_CSS_VAR.style.setProperty(CSS_VARIABLE_DIRECT_NAME, directValueNum);
    TARGET_ELEMENT_FOR_CSS_VAR.style.setProperty(CSS_VARIABLE_INVERTED_NAME, invertedValueNum);

    console.log(`[UserChromeScript] Synced CSS Vars: ${CSS_VARIABLE_DIRECT_NAME}=${directValueNum}, ${CSS_VARIABLE_INVERTED_NAME}=${invertedValueNum}`);
  }


  function handleInputChange() {
    if (!inputElement) {
      console.warn('[UserChromeScript] handleInputChange called but inputElement is null.');
      return;
    }
    const valueStr = inputElement.value; // Value from input is a string
    console.log(`[UserChromeScript] Input changed. New string value: '${valueStr}'`);
    applyCssVariables(valueStr);
    saveValueToPrefs(valueStr); // Save the original string value
  }

  function setupInputListener() {
    inputElement = document.getElementById(INPUT_ELEMENT_ID);

    if (inputElement) {
      console.log(`[UserChromeScript] Found input element #${INPUT_ELEMENT_ID}.`);

      const savedValueStr = loadValueFromPrefs();
      let initialValueStr;

      if (savedValueStr !== null) {
        inputElement.value = savedValueStr;
        initialValueStr = savedValueStr;
        console.log(`[UserChromeScript] Applied saved value '${savedValueStr}' to #${INPUT_ELEMENT_ID}.`);
      } else {
        initialValueStr = inputElement.value; // Use current value of input if no pref
        console.log(`[UserChromeScript] No saved value. Using current input value: '${initialValueStr}'.`);
      }

      applyCssVariables(initialValueStr); // Apply CSS vars based on initial/loaded value

      inputElement.removeEventListener('input', handleInputChange);
      inputElement.addEventListener('input', handleInputChange);
      console.log(`[UserChromeScript] Attached 'input' event listener to #${INPUT_ELEMENT_ID}.`);

    } else {
      console.warn(`[UserChromeScript] Element #${INPUT_ELEMENT_ID} not found during setup. Will retry if element appears.`);
      // If element not found, try to apply from prefs if available
      const savedValueStr = loadValueFromPrefs();
      if (savedValueStr !== null) {
          console.log(`[UserChromeScript] Element not found, but applying saved pref value '${savedValueStr}' to CSS vars.`);
          applyCssVariables(savedValueStr);
      }
    }
  }

  function initializeScript() {
    console.log("[UserChromeScript] initializeScript called.");
    setupInputListener();
  }

  let observer;
  function observeForElement() {
    const targetNode = document.body || document.documentElement;
    if (!targetNode) {
        console.warn("[UserChromeScript] Cannot find document.body or document.documentElement to observe.");
        setTimeout(observeForElement, 1000);
        return;
    }

    initializeScript(); // Try to init immediately

    if (!inputElement) {
        console.log(`[UserChromeScript] Input element #${INPUT_ELEMENT_ID} not found yet. Setting up MutationObserver.`);
        if (observer) observer.disconnect();

        observer = new MutationObserver((mutationsList, obs) => {
            if (document.getElementById(INPUT_ELEMENT_ID)) {
                console.log(`[UserChromeScript] Element #${INPUT_ELEMENT_ID} detected by MutationObserver.`);
                initializeScript();
                obs.disconnect();
                observer = null;
            }
        });
        observer.observe(targetNode, { childList: true, subtree: true });
        console.log(`[UserChromeScript] MutationObserver started on ${targetNode.nodeName}.`);
    }
  }

  if (document.readyState === 'loading') {
    console.log('[UserChromeScript] DOM is loading, waiting for DOMContentLoaded.');
    document.addEventListener('DOMContentLoaded', observeForElement, { once: true });
  } else {
    console.log('[UserChromeScript] DOM already loaded, running observeForElement immediately.');
    observeForElement();
  }
  console.log('[UserChromeScript] custom-input-to-dual-css-vars-persistent.uc.js finished initial execution.');
})();


// ====================================================================================================
// SCRIPT 7: Zen Top Position Globalizer
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          Zen Top Position Globalizer
// @namespace      globalizier
// // @description   Finds --zen-urlbar-top and makes it global for userChrome.css. Based on a friend's script.
// @version        1.7b
// ==/UserScript==
if (Services.prefs.getBoolPref("browser.tabs.allow_transparent_browser")) {
(function() {
    console.log('[Zen Globalizer] Script has loaded. Waiting for window to be ready...');

    function runZenTopGlobalizer() {
        console.log('[Zen Globalizer] Window is ready. Script starting...');

        const rootElement = document.documentElement;
        const urlbarElement = document.getElementById('urlbar');

        if (!urlbarElement) {
            console.error('[Zen Globalizer] FATAL ERROR: Could not find #urlbar element.');
            return;
        }

        function syncVariable() {
            const value = window.getComputedStyle(urlbarElement).getPropertyValue('--zen-urlbar-top');
            if (value) {
                rootElement.style.setProperty('--my-global-zen-top', value.trim());
            }
        }

        const observer = new MutationObserver(syncVariable);

        observer.observe(urlbarElement, {
            attributes: true,
            attributeFilter: ['style']
        });

        syncVariable();
        console.log('[Zen Globalizer] Observer is now active on #urlbar.');
    }

    // A simpler way to wait for the window to be ready
    if (document.readyState === 'complete') {
        runZenTopGlobalizer();
    } else {
        window.addEventListener('load', runZenTopGlobalizer, { once: true });
    }
})();
}

// ====================================================================================================
// SCRIPT 8: Zen Mdia Player Peak height
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          Zen Media Player Peak height
// @namespace      height
// // @description   calculate zen media playe height on hover and store it in a variable
// @version        1.7b
// ==/UserScript==


const MediaPlayerPeakHeight = {
  _mediaPlayer: null,
  _parentToolbar: null,
  _currentPeakHeight: 0,
  _isHovering: false,

  _getElements() {
    if (!this._mediaPlayer) this._mediaPlayer = document.querySelector("#zen-media-controls-toolbar > toolbaritem");
    if (!this._parentToolbar) this._parentToolbar = document.querySelector("#zen-media-controls-toolbar");
  },

  /**
   * The core measurement function.
   */
  _measureAndSetPeakHeight() {
    this._getElements();
    if (!this._mediaPlayer || !this._parentToolbar) return;

    // 1. Create a clone of the player element.
    const clone = this._mediaPlayer.cloneNode(true);

    // 2. Style the clone to be completely invisible and not affect page layout.
    clone.style.position = 'fixed';
    clone.style.visibility = 'hidden';
    clone.style.zIndex = '-1000';
    clone.style.left = '-9999px'; // Move it far off-screen to be safe
    clone.style.transition = 'none !important';

    // 3. Find the '.show-on-hover' element WITHIN the clone.
    const showOnHoverClone = clone.querySelector('.show-on-hover');
    if (showOnHoverClone) {
      // 4. Manually apply the EXACT styles from the browser's default :hover rule.
      //    This forces the clone into its fully expanded state for measurement.
      showOnHoverClone.style.transition = 'none !important';
      showOnHoverClone.style.maxHeight = '50px';
      showOnHoverClone.style.padding = '5px';
      showOnHoverClone.style.marginBottom = '0';
      showOnHoverClone.style.opacity = '0';
      showOnHoverClone.style.transform = 'translateY(0)';
    }

    // 5. Append the clone to the original parent to ensure it inherits all contextual styles.
    this._parentToolbar.appendChild(clone);

    // 6. Get the height. This is the definitive peak height.
    const peakHeight = clone.getBoundingClientRect().height;

    // 7. Destroy the clone immediately.
    this._parentToolbar.removeChild(clone);

    // 8. Update the CSS variable only if the height is valid and has actually changed.
    if (peakHeight > 0 && peakHeight !== this._currentPeakHeight) {
      this._currentPeakHeight = peakHeight;
      document.documentElement.style.setProperty('--zen-media-player-peak-height', `${peakHeight}px`);
    }
  },

  init() {
    this._getElements();
    if (!this._mediaPlayer) {
      setTimeout(() => this.init(), 500);
      return;
    }

    console.log("[MediaPlayerPeakHeight] Initializing.");

    // ---- Listener 1: Mouse Enter ----
    // This is our primary trigger to calculate the height.
    this._mediaPlayer.addEventListener("mouseenter", () => {
      // The _isHovering flag prevents this from running multiple times if the mouse jitters.
      if (!this._isHovering) {
        this._isHovering = true;
        this._measureAndSetPeakHeight();
      }
    });

    // ---- Listener 2: Mouse Leave ----
    this._mediaPlayer.addEventListener("mouseleave", () => {
      this._isHovering = false;
    });

    // ---- Listener 3: Mutation Observer ----
    // This handles the case where the song changes, which might alter the peak height.
    const observer = new MutationObserver(() => {
      // If the content changes while we are hovering, we need to re-calculate.
      // Otherwise, the next mouseenter will handle it.
      if (this._isHovering) {
        this._measureAndSetPeakHeight();
      }
    });
    observer.observe(this._mediaPlayer, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Run one initial measurement on startup to set a default value.
    this._measureAndSetPeakHeight();
  }
};

window.addEventListener("load", () => {
  MediaPlayerPeakHeight.init();
}, { once: true });


// ====================================================================================================
// SCRIPT 9: Compact mode toogle button
// ====================================================================================================
// ==UserScript==
// @name           Combine PanelUI and Compact Mode Button (Reliable Startup)
// @description    Uses a MutationObserver to reliably merge button functionality on browser start, preventing race conditions.
// @author         Zen Analyzer
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(function() {

  // This is the core function that applies all our desired changes.
  function setupCombinedButton() {
    // --- Define element IDs ---
    const panelButtonId = 'PanelUI-menu-button';
    const compactModeButtonId = 'zen-toggle-compact-mode';
    const reloadButtonId = 'stop-reload-button';
    
    const panelButton = document.getElementById(panelButtonId);
    const compactModeButton = document.getElementById(compactModeButtonId);
    const reloadButtonContainer = document.getElementById(reloadButtonId);

    // --- Hide the original "Compact Mode" button ---
    if (compactModeButton) {
      compactModeButton.style.display = 'none';
    }

    // --- Prevent the reload button from overflowing ---
    if (reloadButtonContainer) {
      reloadButtonContainer.setAttribute('overflows', 'false');
    }
    
    // --- Add the smart click logic to the PanelUI button ---
    if (panelButton) {
      // Check if listeners are already attached to prevent duplication.
      if (panelButton.getAttribute('data-custom-listeners-lr') === 'true') {
        return;
      }
      panelButton.setAttribute('data-custom-listeners-lr', 'true');

      // --- Handle Left-Click using 'mousedown' to prevent the menu from opening ---
      panelButton.addEventListener('mousedown', (event) => {
        // A standard left-click is event.button === 0
        if (event.button === 0) {
          document.getElementById('cmd_toggleCompactModeIgnoreHover')?.doCommand();
          // This is the key: prevent the default action of mousedown.
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);

      // --- Handle Right-Click ---
      panelButton.addEventListener('contextmenu', (event) => {
        // Manually show the main application panel.
        PanelUI.show();
        // Prevent the default browser right-click menu.
        event.preventDefault();
        event.stopPropagation();
      }, true);
    }
  }

  // --- The Smart Fix: A MutationObserver ---
  // This observer waits for the UI to be built instead of guessing with a timer.
  // It watches for elements to be added to the page.
  const observer = new MutationObserver((mutations, obs) => {
    // We check if the key buttons we need to modify have appeared yet.
    const panelButton = document.getElementById('PanelUI-menu-button');
    const reloadButtonContainer = document.getElementById('stop-reload-button');

    // If both buttons now exist in the document...
    if (panelButton && reloadButtonContainer) {
      // ...run our main setup function to apply all the changes.
      setupCombinedButton();
      // ...and then disconnect the observer. Its job is done, and this saves resources.
      obs.disconnect();
    }
  });

  // Start the observer, telling it to watch the entire document ('documentElement')
  // for any changes to its direct children ('childList') or any of their children ('subtree').
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

})();





