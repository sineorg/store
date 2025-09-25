
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
    DEBOUNCE_DELAY_MS: 50,
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
      
      const resultRows = resultsElement.querySelectorAll('.urlbarView-row:not([type="tip"], [type="dynamic"])');
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
// SCRIPT 4: Fetching Search Engines Color
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name           store color of search engine
// @namespace      colorofsearchengines
// @description    helps in providing color of search engine favicon
// @version        1.7b
// ==/UserScript==

(function() {
  'use strict';

  if (typeof Services === 'undefined' || !Services.search) {
    console.error('[ArclineSearchColor] Firefox Services not available. Script cannot run.');
    return;
  }
  
  if (window.ArclineSearchColor) {
    window.ArclineSearchColor.destroy();
  }

  window.ArclineSearchColor = {
    // --- The 2 CSS variables this script provides ---
    GRADIENT_START_VAR: '--arcline-search-gradient-start',
    GRADIENT_END_VAR: '--arcline-search-gradient-end',

    init() {
      console.log('[ArclineSearchColor] Initializing Script v12.0 (Auto-Darkening)...');
      this.initSearchColor();
      window.addEventListener('unload', () => this.destroy(), { once: true });
    },

    initSearchColor() {
      this.searchSwitcher = document.getElementById('urlbar-searchmode-switcher');
      if (!this.searchSwitcher) {
        requestIdleCallback(() => this.initSearchColor());
        return;
      }
      const observerCallback = () => this.updateSearchColor();
      this.searchObserver = new MutationObserver(observerCallback);
      this.searchObserver.observe(this.searchSwitcher, {
        attributes: true,
        attributeFilter: ['tooltiptext']
      });
      console.log('[ArclineSearchColor] Module is active.');
      this.updateSearchColor();
    },

    async updateSearchColor() {
      const root = document.documentElement;
      const tooltip = this.searchSwitcher?.getAttribute('tooltiptext');
      if (!tooltip) {
        this.clearCssVars(root);
        return;
      }
      
      try {
        const engines = await Services.search.getVisibleEngines();
        const currentEngine = engines.find(engine => tooltip.includes(engine.name));

        if (currentEngine?.searchForm) {
          const domain = new URL(currentEngine.searchForm).hostname;
          const iconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${domain}`;
          
          const gradient = await this.extractAutoDarkeningGradient(iconUrl);

          if (gradient) {
            root.style.setProperty(this.GRADIENT_START_VAR, `rgb(${gradient.start.r}, ${gradient.start.g}, ${gradient.start.b})`);
            root.style.setProperty(this.GRADIENT_END_VAR, `rgb(${gradient.end.r}, ${gradient.end.g}, ${gradient.end.b})`);
            console.log(`%c[ArclineSearchColor] SUCCESS: Set auto-darkened gradient for "${domain}"`, 'color: lightgreen; font-weight: bold;');
          } else {
            this.clearCssVars(root);
          }
        } else {
          this.clearCssVars(root);
        }
      } catch (err) {
        console.error('[ArclineSearchColor] FATAL ERROR during search update:', err);
        this.clearCssVars(root);
      }
    },

    clearCssVars(root) {
        root.style.removeProperty(this.GRADIENT_START_VAR);
        root.style.removeProperty(this.GRADIENT_END_VAR);
    },

    // --- NEW "AUTO-DARKENING GRADIENT" ALGORITHM ---
    async extractAutoDarkeningGradient(url) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
            this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
        }

        const size = 16;
        this.canvas.width = size;
        this.canvas.height = size;
        this.ctx.clearRect(0, 0, size, size);
        this.ctx.drawImage(img, 0, 0, size, size);

        const pixelData = this.ctx.getImageData(0, 0, size, size).data;
        const colorCounts = new Map();

        for (let i = 0; i < pixelData.length; i += 4) {
            const [r, g, b, a] = [pixelData[i], pixelData[i + 1], pixelData[i + 2], pixelData[i + 3]];
            if (a < 128) continue;
            const key = `${r >> 4},${g >> 4},${b >> 4}`;
            if (colorCounts.has(key)) {
                colorCounts.get(key).freq++;
            } else {
                colorCounts.set(key, { r, g, b, freq: 1 });
            }
        }

        if (colorCounts.size === 0) return null;

        let scoredColors = [];
        for (const color of colorCounts.values()) {
            const { r, g, b, freq } = color;
            const hsl = this.rgbToHsl(r, g, b);
            const isBoring = hsl.s < 0.05 && hsl.l > 0.95; // Only filter out pure white
            if (isBoring && colorCounts.size > 3) continue;
            scoredColors.push({ ...color, score: freq * (1 + hsl.s), hsl });
        }
        
        if (scoredColors.length === 0) return null;
        scoredColors.sort((a, b) => b.score - a.score);

        const gradientStart = scoredColors[0];
        let gradientEnd = scoredColors.find(c => {
            const hueDiff = Math.abs(c.hsl.h - gradientStart.hsl.h);
            return hueDiff > 0.15 && hueDiff < 0.85; // Find a color with a different hue
        }) || gradientStart; // Fallback to a solid color if no second hue is found

        // --- AUTO-DARKENING LOGIC ---
        const adjustIfNeeded = (color) => {
            const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
            if (luminance > 0.9) { // Is the color extremely bright (like white)?
                let hsl = color.hsl;
                hsl.l = 0.75; // Drastically reduce lightness to a pleasant gray/pastel
                hsl.s = Math.max(hsl.s, 0.1); // Ensure it's not totally desaturated
                return this.hslToRgb(hsl.h, hsl.s, hsl.l);
            }
            return color; // Return original if it's not too bright
        };

        const finalStart = adjustIfNeeded(gradientStart);
        const finalEnd = adjustIfNeeded(gradientEnd);

        return { start: finalStart, end: finalEnd };
    },
    
    // --- Color Conversion Helpers ---
    rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const M=Math.max(r,g,b),m=Math.min(r,g,b);let h,s,l=(M+m)/2;if(M==m){h=s=0}else{const d=M-m;s=l>.5?d/(2-M-m):d/(M+m);switch(M){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break}h/=6}return{h,s,l}},
    hslToRgb(h,s,l){let r,g,b;if(s==0){r=g=b=l}else{const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};const q=l<.5?l*(1+s):l+s-l*s;const p=2*l-q;r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3)}return{r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255)}},

    destroy() {
      console.log('[ArclineSearchColor] Destroying script...');
      this.searchObserver?.disconnect();
      this.clearCssVars(document.documentElement);
      delete window.ArclineSearchColor;
    }
  };

  requestIdleCallback(() => window.ArclineSearchColor.init());
})();




// ====================================================================================================
// SCRIPT 5: Zen Media Cover Art Provider
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
// SCRIPT 6: Zen Workspace Button Wave Animation
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          zen-workspace-button-wave-animation
// @namespace      zenWorkspaceButtonAnimation
// @description    helps in adding mac os dock like aniamtion to zen worspace buttons
// @version        1.7b
// ==/UserScript==
if (Services.prefs.getBoolPref("arcline.script6")) {
(function() {
  if (window.ZenBrowserCustomizableDockEffect) {
    return;
  }
  window.ZenBrowserCustomizableDockEffect = true;
  let isEffectInitialized = false;

  // --- Configuration (These are your main tuning knobs!) ---
  // ========================================================

  // --- DOM Selectors ---
  const DOCK_CONTAINER_ID = 'zen-workspaces-button';
  const BUTTON_SELECTOR = '.subviewbutton';

  // --- Inactive Icon Display Mode --- NEW ---
  // 'dot': Inactive icons are heavily dimmed/grayscaled (like dots).
  // 'visible': Inactive icons are more visible, just less prominent.
  // This can be overridden by a browser preference/setting if implemented.
  const INACTIVE_ICON_MODE_DEFAULT = 'dot'; // or 'visible'

  // --- Base Appearance (Initial state derived from CSS, with JS fallbacks) ---
  const BASE_SCALE = 1;

  // -- For 'dot' mode (current behavior) --
  const JS_FALLBACK_INITIAL_OPACITY_DOT_MODE = 0.75; // Or lower for more "dot-like"
  const JS_FALLBACK_INITIAL_GRAYSCALE_DOT_MODE = 100; // In %

  // -- For 'visible' mode (new behavior) --
  const JS_FALLBACK_INITIAL_OPACITY_VISIBLE_MODE = 0.85; // More visible
  const JS_FALLBACK_INITIAL_GRAYSCALE_VISIBLE_MODE = 50; // Less grayscale, more color

  // --- Magnification & Wave Effect ---
  const MAX_MAGNIFICATION_SCALE = 1.3;
  const NEIGHBOR_INFLUENCE_WIDTH_FACTOR = 3;
  const SCALE_FALLOFF_POWER = 5.7;

  // --- Opacity Transition ---
  const MAX_OPACITY = 1.0;
  const OPACITY_FALLOFF_POWER = 1.5;

  // --- Grayscale Transition ---
  const MAX_GRAYSCALE = 0; // Grayscale (%) for icon closest to mouse (0 = full color)
  const GRAYSCALE_FALLOFF_POWER = 1.5;

  // --- Stacking Order ---
  const BASE_Z_INDEX = 1;
  const Z_INDEX_BOOST = 10;

  // --- Performance Tuning ---
  const MOUSE_MOVE_THROTTLE_MS = 10;
  const RESIZE_DEBOUNCE_MS = 150;

  // --- Dynamic Gapping ---
  const DYNAMIC_GAP_CSS_VARIABLE = '--zen-dock-dynamic-gap';
  const JS_FALLBACK_DEFAULT_GAP = '0.1em';
  // ========================================================
  // --- End Configuration ---

  let dockContainerElement = null;
  let currentButtons = [];
  let buttonCachedProperties = [];
  let lastMouseMoveTime = 0;
  let resizeDebounceTimeout;
  let isMouseOverDock = false;
  let lastMouseXInDock = 0;

  // --- NEW: Function to get the current inactive icon mode ---
  // This is where you'd integrate reading from `about:config` or similar browser settings
  function getCurrentInactiveIconMode() {
      // Example: Placeholder for reading a browser preference
      // if (typeof browser !== 'undefined' && browser.prefs && browser.prefs.get) {
      // try {
      //   const prefValue = await browser.prefs.get('extensions.zenBrowser.dock.inactiveIconMode');
      //   if (prefValue === 'visible' || prefValue === 'dot') {
      //     return prefValue;
      //   }
      // } catch (e) { console.warn("Zen Dock: Could not read preference", e); }
      // }
      // For now, we'll use a CSS custom property or the JS default
      const modeFromCSS = getCssVariableOrDefault('--zen-dock-inactive-icon-mode', INACTIVE_ICON_MODE_DEFAULT, false);
      if (modeFromCSS === 'visible' || modeFromCSS === 'dot') {
          return modeFromCSS;
      }
      return INACTIVE_ICON_MODE_DEFAULT;
  }


  function getCssVariableOrDefault(varName, fallbackValue, isInteger = false, treatAsString = false) {
      try {
          const rootStyle = getComputedStyle(document.documentElement);
          let value = rootStyle.getPropertyValue(varName).trim();
          if (value) {
              if (treatAsString) return value; // Return as string if requested
              return isInteger ? parseInt(value, 10) : parseFloat(value);
          }
      } catch (e) { /* CSS variable might not be defined yet or invalid */ }
      return fallbackValue;
  }

  // --- MODIFIED: Function to get initial properties based on mode ---
  function getInitialButtonProperties() {
    const mode = getCurrentInactiveIconMode();
    let initialOpacity, initialGrayscale;

    if (mode === 'visible') {
        initialOpacity = getCssVariableOrDefault('--zen-dock-icon-initial-opacity-visible', JS_FALLBACK_INITIAL_OPACITY_VISIBLE_MODE);
        initialGrayscale = getCssVariableOrDefault('--zen-dock-icon-initial-grayscale-visible', JS_FALLBACK_INITIAL_GRAYSCALE_VISIBLE_MODE, true);
    } else { // Default to 'dot' mode
        initialOpacity = getCssVariableOrDefault('--zen-dock-icon-initial-opacity-dot', JS_FALLBACK_INITIAL_OPACITY_DOT_MODE);
        initialGrayscale = getCssVariableOrDefault('--zen-dock-icon-initial-grayscale-dot', JS_FALLBACK_INITIAL_GRAYSCALE_DOT_MODE, true);
    }
    return { initialOpacity, initialGrayscale };
  }


  function getDynamicGapValue(buttonCount) {
    // ... (same as before)
    let gapValue = JS_FALLBACK_DEFAULT_GAP;
    if (buttonCount <= 1) gapValue = '0em';
    else if (buttonCount === 2) gapValue = '1em';
    else if (buttonCount === 3) gapValue = '0em';
    else if (buttonCount <= 5) gapValue = '0.5em';
    else if (buttonCount <= 7) gapValue = '0.3em';
    else if (buttonCount === 8) gapValue = '0.2em';
    else if (buttonCount >= 9) gapValue = '0.1em';
    return gapValue;
  }

  function updateDockGapping() {
    // ... (same as before)
    if (!dockContainerElement) return;
    const buttonCount = currentButtons.length;
    const gapValue = getDynamicGapValue(buttonCount);
    dockContainerElement.style.setProperty(DYNAMIC_GAP_CSS_VARIABLE, gapValue);
  }

  function cacheButtonProperties() {
    // ... (same as before)
    if (!dockContainerElement) return [];
    const newButtons = Array.from(dockContainerElement.querySelectorAll(BUTTON_SELECTOR));
    const newButtonProperties = newButtons.map(btn => {
      const rect = btn.getBoundingClientRect();
      return {
        element: btn,
        center: rect.left + rect.width / 2,
        width: rect.width,
      };
    });
    let buttonsChangedStructurally = newButtons.length !== currentButtons.length;
    if (!buttonsChangedStructurally) {
        for (let i = 0; i < newButtons.length; i++) {
            if (newButtons[i] !== currentButtons[i]) {
                buttonsChangedStructurally = true;
                break;
            }
        }
    }
    currentButtons = newButtons;
    buttonCachedProperties = newButtonProperties;
    updateDockGapping();
    return buttonsChangedStructurally;
  }

  function resetAllButtonsToDefault() {
    // --- MODIFIED to use getInitialButtonProperties ---
    const { initialOpacity, initialGrayscale } = getInitialButtonProperties();
    const isActiveButton = (btn) => btn.matches('[active="true"]');

    currentButtons.forEach(btn => {
      let targetOpacity = initialOpacity;
      let targetGrayscale = initialGrayscale;

      if (isActiveButton(btn)) {
        // Active buttons should always be quite visible, regardless of inactive mode
        targetOpacity = getCssVariableOrDefault('--zen-dock-icon-active-opacity', MAX_OPACITY);
        // Potentially make active grayscale slightly less than full color if preferred
        targetGrayscale = getCssVariableOrDefault('--zen-dock-icon-active-grayscale', MAX_GRAYSCALE + 10); // e.g., 10% grayscale for active
      }
      
      btn.style.transform = `scale(${BASE_SCALE})`;
      btn.style.opacity = targetOpacity;
      btn.style.filter = `grayscale(${targetGrayscale}%)`;
      btn.style.zIndex = BASE_Z_INDEX;
    });
  }

  function updateDockEffectStyles(mouseX) {
    const now = performance.now();
    if (MOUSE_MOVE_THROTTLE_MS > 0 && (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE_MS)) {
      return;
    }
    lastMouseMoveTime = now;

    if (buttonCachedProperties.length === 0 && currentButtons.length > 0) {
      cacheButtonProperties(); 
      if (buttonCachedProperties.length === 0) return;
    } else if (currentButtons.length === 0) {
        return;
    }

    // --- MODIFIED to use getInitialButtonProperties ---
    const { initialOpacity: currentInitialOpacity, initialGrayscale: currentInitialGrayscale } = getInitialButtonProperties();
    
    // Active button properties remain separate
    const currentActiveOpacity = getCssVariableOrDefault('--zen-dock-icon-active-opacity', MAX_OPACITY);
    const currentActiveGrayscale = getCssVariableOrDefault('--zen-dock-icon-active-grayscale', MAX_GRAYSCALE + 10);

    const isActiveButton = (btn) => btn.matches('[active="true"]');

    buttonCachedProperties.forEach(props => {
      const iconElement = props.element;
      const iconCenter = props.center;
      const iconWidth = props.width;

      if (!iconElement || iconWidth === 0) return;

      const distanceToMouse = Math.abs(mouseX - iconCenter);
      const maxEffectDistance = iconWidth * NEIGHBOR_INFLUENCE_WIDTH_FACTOR;
      let effectStrength = 0;

      if (distanceToMouse < maxEffectDistance) {
        effectStrength = Math.cos((distanceToMouse / maxEffectDistance) * (Math.PI / 2));
        effectStrength = Math.pow(effectStrength, SCALE_FALLOFF_POWER);
      }

      const scale = BASE_SCALE + (MAX_MAGNIFICATION_SCALE - BASE_SCALE) * effectStrength;

      let baseOpacityForCalc = currentInitialOpacity;
      let baseGrayscaleForCalc = currentInitialGrayscale;

      // If active and mouse is far, use active base properties
      if (isActiveButton(iconElement) && effectStrength < 0.1) {
        baseOpacityForCalc = currentActiveOpacity;
        baseGrayscaleForCalc = currentActiveGrayscale;
      }

      let opacityEffectStrengthMod = effectStrength;
      if (OPACITY_FALLOFF_POWER !== SCALE_FALLOFF_POWER && distanceToMouse < maxEffectDistance) {
         let tempStrength = Math.cos((distanceToMouse / maxEffectDistance) * (Math.PI / 2));
         opacityEffectStrengthMod = Math.pow(tempStrength, OPACITY_FALLOFF_POWER);
      }
      // If icon is active, it should not become less opaque than its active base when mouse is far
      // And it should not become less opaque than initial general opacity when mouse is near
      let targetOpacity;
      if(isActiveButton(iconElement)) {
        // Active buttons transition from their `currentActiveOpacity` towards `MAX_OPACITY`
        targetOpacity = currentActiveOpacity + (MAX_OPACITY - currentActiveOpacity) * opacityEffectStrengthMod;
      } else {
        // Inactive buttons transition from `currentInitialOpacity` towards `MAX_OPACITY`
        targetOpacity = currentInitialOpacity + (MAX_OPACITY - currentInitialOpacity) * opacityEffectStrengthMod;
      }
      

      let grayscaleEffectStrengthMod = effectStrength;
      if (GRAYSCALE_FALLOFF_POWER !== SCALE_FALLOFF_POWER && distanceToMouse < maxEffectDistance) {
         let tempStrength = Math.cos((distanceToMouse / maxEffectDistance) * (Math.PI / 2));
         grayscaleEffectStrengthMod = Math.pow(tempStrength, GRAYSCALE_FALLOFF_POWER);
      }
      // Similar logic for grayscale
      let targetGrayscale;
      if(isActiveButton(iconElement)) {
        // Active buttons transition from their `currentActiveGrayscale` towards `MAX_GRAYSCALE`
        targetGrayscale = currentActiveGrayscale - (currentActiveGrayscale - MAX_GRAYSCALE) * grayscaleEffectStrengthMod;
      } else {
        // Inactive buttons transition from `currentInitialGrayscale` towards `MAX_GRAYSCALE`
        targetGrayscale = currentInitialGrayscale - (currentInitialGrayscale - MAX_GRAYSCALE) * grayscaleEffectStrengthMod;
      }
            
      const zIndex = BASE_Z_INDEX + Math.ceil(Z_INDEX_BOOST * effectStrength);

      iconElement.style.transform = `scale(${scale})`;
      
      // Determine the absolute minimum opacity (should not go below its non-hovered state)
      let minOpacityForElement = isActiveButton(iconElement) ? currentActiveOpacity : currentInitialOpacity;
      // If under mouse influence, it could even go down to the general initial opacity if that's lower than active
      if (isActiveButton(iconElement) && effectStrength > 0.1 && currentInitialOpacity < currentActiveOpacity) {
          minOpacityForElement = currentInitialOpacity;
      }

      iconElement.style.opacity = Math.min(MAX_OPACITY, Math.max(minOpacityForElement, targetOpacity));
      iconElement.style.filter = `grayscale(${Math.max(0, Math.min(100, Math.round(targetGrayscale)))}%)`;
      iconElement.style.zIndex = zIndex;
    });
  }

  function initializeDockEffect() {
    // ... (same as before)
    dockContainerElement = document.getElementById(DOCK_CONTAINER_ID);
    if (!dockContainerElement) return;

    cacheButtonProperties();
    if (currentButtons.length === 0) {
        // Observer will handle when buttons appear
    } else {
        resetAllButtonsToDefault(); // This will now use the configured mode
    }

    dockContainerElement.addEventListener('mousemove', (event) => {
      const dockRect = dockContainerElement.getBoundingClientRect();
      if (event.clientX >= dockRect.left && event.clientX <= dockRect.right &&
          event.clientY >= dockRect.top && event.clientY <= dockRect.bottom) {
        isMouseOverDock = true;
        lastMouseXInDock = event.clientX;
        updateDockEffectStyles(event.clientX);
      } else {
        if (isMouseOverDock) {
            isMouseOverDock = false;
            resetAllButtonsToDefault();
        }
      }
    });

    dockContainerElement.addEventListener('mouseleave', () => {
      isMouseOverDock = false;
      resetAllButtonsToDefault();
    });

    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounceTimeout);
      resizeDebounceTimeout = setTimeout(() => {
        cacheButtonProperties();
        if (isMouseOverDock && lastMouseXInDock !== 0 && currentButtons.length > 0) {
            updateDockEffectStyles(lastMouseXInDock);
        } else {
            resetAllButtonsToDefault();
        }
      }, RESIZE_DEBOUNCE_MS);
    });
  }

  const observer = new MutationObserver((mutationsList, obs) => {
    // ... (logic largely the same, but resetAllButtonsToDefault and updateDockEffectStyles now use mode)
    const dockNowExists = document.getElementById(DOCK_CONTAINER_ID);
    
    if (!dockNowExists) {
      if (isEffectInitialized) {
        isEffectInitialized = false;
        isMouseOverDock = false;
        currentButtons = [];
        buttonCachedProperties = [];
      }
      return;
    }
    if (dockContainerElement !== dockNowExists) dockContainerElement = dockNowExists;

    const buttonsArePresent = dockNowExists.querySelector(BUTTON_SELECTOR);

    if (buttonsArePresent) {
      if (!isEffectInitialized) {
        initializeDockEffect();
        isEffectInitialized = true;
      } else {
        const structuralChange = cacheButtonProperties();
        if (isMouseOverDock && !structuralChange && currentButtons.length > 0) {
          updateDockEffectStyles(lastMouseXInDock);
        } else {
          resetAllButtonsToDefault();
          if (isMouseOverDock && currentButtons.length > 0) {
            updateDockEffectStyles(lastMouseXInDock);
          }
        }
      }
    } else if (isEffectInitialized && currentButtons.length > 0) {
        currentButtons = [];
        buttonCachedProperties = [];
        updateDockGapping();
    }
  });
  
  function attemptInitialization() {
    // ... (same as before)
    const dock = document.getElementById(DOCK_CONTAINER_ID);
    if (dock) {
        dockContainerElement = dock;
        if (dock.querySelector(BUTTON_SELECTOR)) {
            if (!isEffectInitialized) {
                initializeDockEffect();
                isEffectInitialized = true;
            }
        } else {
            if (!isEffectInitialized) {
                updateDockGapping();
                observer.observe(document.documentElement, { childList: true, subtree: true });
            }
        }
    } else {
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // --- NEW: Listen for preference changes (if applicable) ---
  // This is a conceptual example. Actual implementation depends on your browser environment.
  // For a typical WebExtension:
  // if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
  //   browser.storage.onChanged.addListener((changes, areaName) => {
  //     if (areaName === 'local' || areaName === 'sync') { // Or wherever your preference is stored
  //       if (changes['extensions.zenBrowser.dock.inactiveIconMode']) { // Or your actual preference key
  //         console.log("Zen Dock: Inactive icon mode preference changed. Re-applying styles.");
  //         // Re-apply styles based on the new preference
  //         if (isMouseOverDock && lastMouseXInDock !== 0 && currentButtons.length > 0) {
  //           updateDockEffectStyles(lastMouseXInDock);
  //         } else {
  //           resetAllButtonsToDefault();
  //         }
  //       }
  //     }
  //   });
  // } else if (/* You have another way to detect preference changes, e.g., custom events */) {
  //   // document.addEventListener('myCustomPreferenceChangeEvent', () => { ... });
  // }


  if (document.readyState === "complete" || document.readyState === "interactive") {
    attemptInitialization();
  } else {
    document.addEventListener("DOMContentLoaded", attemptInitialization, { once: true });
  }
})();

}

// ====================================================================================================
// SCRIPT 7: Compact Mode Sidebar Width Fix
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
// SCRIPT 8: Gradient Opacity Adjuster
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
// SCRIPT 9: Zen Top Position Globalizer
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
// SCRIPT 10: Zen Mdia Player Peak height
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
// SCRIPT 11: Move the Extension button into url bar
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name         Move Unified Extension Button
// @version      1.0
// @description  Moves the unified extension button to identity-box and hides it on blank pages or when URL bar is floating.
// @author       bxthesda
// @match        chrome://browser/content/browser.xhtml
// @grant        none
// ==/UserScript==



(function() {
    'use strict';

    let attempts = 0;
    const MAX_ATTEMPTS = 20; // Try for about 10 seconds (20 * 500ms)
    let scriptObserver = null;

    function updateButtonVisibilityAndPosition() {
        // console.log("Attempting to updateButtonVisibilityAndPosition");
        let unifiedExtensionsButton = document.getElementById('unified-extensions-button');
        let pageActionButtons = document.getElementById('page-action-buttons');
        let urlbar = document.getElementById('urlbar');

        if (!unifiedExtensionsButton) {
            // console.log('unifiedExtensionsButton not found in updateButtonVisibilityAndPosition.');
            // If button doesn't exist yet, try to run doTheMove again if attempts remain.
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(doTheMove, 100); // Try to make sure it's there
            }
            return;
        }

        let isFloating = false;
        if (urlbar) {
            isFloating = urlbar.getAttribute('breakout-extend') === 'true' ||
                           urlbar.getAttribute('zen-floating-urlbar') === 'true';
        }

        let isBlankPage = false;
        let identityBox = document.getElementById('identity-box');
        if (identityBox) {
            isBlankPage = identityBox.getAttribute('pageproxystate') === 'invalid';
        } else if (typeof gBrowser !== 'undefined' && gBrowser.selectedBrowser) {
            const currentSpec = gBrowser.selectedBrowser.currentURI.spec;
            isBlankPage = ['about:blank', 'about:newtab', 'about:home'].includes(currentSpec);
        } else {
            // Default to considering it a blank page if identityBox and gBrowser are unavailable for checks.
            isBlankPage = true;
            // console.log("Could not determine page state accurately, assuming blank page to hide button.");
        }

        if (isFloating || isBlankPage) {
            // console.log(`Hiding button. Floating: ${isFloating}, BlankPage: ${isBlankPage}`);
            unifiedExtensionsButton.style.display = 'none';
        } else {
            // console.log(`Showing button. Floating: ${isFloating}, BlankPage: ${isBlankPage}`);
            unifiedExtensionsButton.style.display = ''; // Revert to default display (e.g., flex, inline-flex)
            
            // Use CSS order to ensure the button appears at the extreme right
            unifiedExtensionsButton.style.order = '9999'; // High order value to ensure it's last
            unifiedExtensionsButton.style.marginLeft = 'auto';
            unifiedExtensionsButton.style.marginRight = '-4px';
            
            if (pageActionButtons) {
                // Ensure page-action-buttons uses flexbox layout for order to work
                pageActionButtons.style.display = 'flex';
                pageActionButtons.style.alignItems = 'center';
                
                if (unifiedExtensionsButton.parentElement !== pageActionButtons) {
                    pageActionButtons.appendChild(unifiedExtensionsButton);
                    // console.log('Button moved/ensured in page-action-buttons by update logic.');
                }
            } else {
                // console.error('page-action-buttons not found when trying to show/position button. Will be retried by doTheMove.');
                // If pageActionButtons is missing when we need to show the button, trigger doTheMove's retry.
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(doTheMove, 100);
                }
            }
        }
    }

    function doTheMove() {
        try {
            // console.log('Attempting to doTheMove...');
            let unifiedExtensionsButton = document.getElementById('unified-extensions-button');
            let pageActionButtons = document.getElementById('page-action-buttons');

            if (unifiedExtensionsButton && pageActionButtons) {
                if (unifiedExtensionsButton.parentElement !== pageActionButtons) {
                    pageActionButtons.appendChild(unifiedExtensionsButton);
                    console.log('Unified Extensions Button initially moved to page-action-buttons.');
                }
                
                // Apply order styling immediately
                unifiedExtensionsButton.style.order = '9999';
                unifiedExtensionsButton.style.marginLeft = 'auto';
                unifiedExtensionsButton.style.marginRight = '-4px';
                
                // Ensure page-action-buttons uses flexbox layout for order to work
                pageActionButtons.style.display = 'flex';
                pageActionButtons.style.alignItems = 'center';
                
                attempts = MAX_ATTEMPTS; // Stop timed retries for finding these specific elements
                updateButtonVisibilityAndPosition(); // Initial visibility update
            } else {
                if (attempts < MAX_ATTEMPTS) {
                    attempts++;
                    setTimeout(doTheMove, 500);
                } else {
                    console.error('Max attempts reached by timer. Could not find unifiedExtensionsButton and/or pageActionButtons for initial move.');
                }
            }
        } catch (e) {
            console.error('Error in doTheMove:', e);
        }
    }

    scriptObserver = new MutationObserver(function(mutationsList) {
        let needsUpdate = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                    if (node.nodeType === Node.ELEMENT_NODE && (node.id === 'unified-extensions-button' || node.id === 'page-action-buttons' || node.id === 'urlbar')) {
                        needsUpdate = true;
                        break;
                    }
                }
                const btn = document.getElementById('unified-extensions-button');
                const pageActionBtns = document.getElementById('page-action-buttons');
                if (btn && pageActionBtns && btn.parentElement !== pageActionBtns) {
                    needsUpdate = true; // Button exists but is not in page-action-buttons, re-evaluate
                }
            } else if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (target.nodeType === Node.ELEMENT_NODE) {
                    if ((target.id === 'urlbar' && (mutation.attributeName === 'breakout-extend' || mutation.attributeName === 'zen-floating-urlbar')) ||
                        (target.id === 'identity-box' && mutation.attributeName === 'pageproxystate')) {
                        needsUpdate = true;
                    }
                }
            }
            if (needsUpdate) break;
        }

        if (needsUpdate) {
            // console.log("Observer triggered updateButtonVisibilityAndPosition");
            updateButtonVisibilityAndPosition();
        }
    });

    // Observe the documentElement for broader changes initially.
    // The observer callback will filter for relevant element/attribute changes.
    scriptObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
    });

    // Initial attempt to move the button after a short delay.
    setTimeout(doTheMove, 1500);

})(); 

// ====================================================================================================
// SCRIPT 12: Extension menu like arc
// ====================================================================================================
// ==UserScript==
// @ignorecache
// @name          Ext arc
// @namespace      nomal
// // @description   makeextension menu like ina rc browser
// @version        1.7b
// ==/UserScript==

console.log("URLBarModifier: Initializing...");

// Panel Manager Class - Simplified for Native Panel Only
class PanelManager {
  constructor() {
    this.unifiedPanelModified = false;
    this.extrasMenuListenersSetup = false;
  }

  getPanelBackgroundColor() {
    try {
      const panelEl = document.getElementById('unified-extensions-panel') || document.documentElement;
      const cs = getComputedStyle(panelEl);
      const bg = cs && (cs.getPropertyValue('background-color') || cs.backgroundColor);
      if (bg && bg.trim()) return bg.trim();
    } catch {}
    return 'Canvas';
  }


  customizeToolbar(event) {
    try {
      console.log("URLBarModifier: Opening toolbar customization");
      
      // Close the panel first
      const unifiedPanel = document.querySelector("#unified-extensions-view");
      this.closePanelImmediately(unifiedPanel);
      
      // Open customization immediately
      const commandEl = document.getElementById('cmd_CustomizeToolbars');
      if (commandEl && typeof commandEl.doCommand === "function") {
        commandEl.doCommand();
      } else {
        console.warn("URLBarModifier: Customize toolbars command not found");
      }
    } catch (err) {
      console.error("Error opening toolbar customization:", err);
    }
  }

  modifyUnifiedExtensionsPanel() {
    try {
      if (this.unifiedPanelModified) {
        console.log("Unified extensions panel already modified");
        return;
      }

      const unifiedPanel = document.querySelector("#unified-extensions-view");
      if (!unifiedPanel) {
        console.log("Unified extensions panel not found, will retry later");
        return;
      }

      // Load external CSS file
      try {
        const existing = document.getElementById("uev-mod-rules");
        if (existing) existing.remove();
        
        const link = document.createElementNS("http://www.w3.org/1999/xhtml", "link");
        link.id = "uev-mod-rules";
        link.rel = "stylesheet";
        link.type = "text/css";
        // Get the script's directory path
        const scriptPath = Components.stack.filename;
        const scriptDir = scriptPath.substring(0, scriptPath.lastIndexOf('/'));
        link.href = scriptDir + "/urlbarmodifier.css";
        document.documentElement.appendChild(link);
      } catch (e) {
        console.warn("Failed to inject mod.viewgrid rules", e);
      }

      console.log("Modifying unified extensions panel");

      // Helper to build section labels
      const makeSectionLabel = (id, text) => {
        try {
          const label = document.createElement("div");
          label.id = id;
          label.className = "unified-section-label";
          label.setAttribute("cui-areatype", "panel");
          label.setAttribute("skipintoolbarset", "true");
          label.textContent = text;
          label.style.cssText = `
            padding: 0 9px 0 9px;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 1em;
            font-weight: 600;
            opacity: 0.85;
          `;
          return label;
        } catch (e) {
          console.warn("Failed to create section label", id, e);
          return null;
        }
      };

      // Remove all existing separators in the view; we'll re-add only the one before security
      try {
        const existingSeps = unifiedPanel.querySelectorAll('toolbarseparator');
        existingSeps.forEach(sep => sep.remove());
      } catch (e) {
        console.debug('Could not remove existing separators', e);
      }

      // Insert an "Extensions" label where the first native separator used to be (before the body)
      try {
        const bodyContainer = unifiedPanel.querySelector('.panel-subview-body');
        if (bodyContainer && !unifiedPanel.querySelector('#ue-section-label-extensions')) {
          const extensionsLabel = makeSectionLabel('ue-section-label-extensions', 'Extensions');
          if (extensionsLabel) unifiedPanel.insertBefore(extensionsLabel, bodyContainer);
        }
      } catch (e) {
        console.debug('Failed to insert Extensions label', e);
      }

      // Create Action Buttons section using DOM methods
      const actionSection = document.createElement("div");
      actionSection.id = "urlbar-modifier-actions";
      actionSection.className = "urlbar-modifier-section";
      actionSection.setAttribute("cui-areatype", "panel");
      actionSection.setAttribute("skipintoolbarset", "true");
      actionSection.style.cssText = `
        padding: 7px 8px 5px;
        display: flex;
        gap: 8px;
        justify-content: center;
        align-items: center;
        width: 100%;
        box-sizing: border-box;
      `;
      
      // Create Share URL button
      const shareButton = document.createElement("div");
      shareButton.id = "unified-share-url-button";
      shareButton.className = "unified-extension-item";
      shareButton.setAttribute("cui-areatype", "panel");
      shareButton.setAttribute("skipintoolbarset", "true");
      shareButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        background-color: color-mix(in srgb, currentColor 6%, transparent);
        width: 40px;
        height: 20px;
      `;
      shareButton.setAttribute("title", "Share URL");
      
      // Create share icon using createXULElement
      const shareIcon = document.createXULElement("image");
      shareIcon.id = "unified-share-icon";
      shareIcon.className = "unified-extension-icon";
      shareIcon.setAttribute("cui-areatype", "panel");
      shareIcon.setAttribute("skipintoolbarset", "true");
      shareIcon.style.cssText = "width: 18px; height: 18px; -moz-context-properties: fill; fill: currentColor;";
      try {
        // Inline SVG using provided paths with context-fill
        const shareSvg = `data:image/svg+xml;utf8,`
          + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
               <path fill="context-fill" d="M19 22H5c-1.654 0-3-1.346-3-3V8h2v11c0 .552.449 1 1 1h14c.552 0 1-.448 1-1v-2h2v2C22 20.654 20.654 22 19 22zM16.707 11.707L15.293 10.293 18.586 7 15.293 3.707 16.707 2.293 21.414 7z"/>
               <path fill="context-fill" d="M8,18H6v-1c0-6.065,4.935-11,11-11h3v2h-3c-4.963,0-9,4.037-9,9V18z"/>
             </svg>`
          );
        shareIcon.setAttribute('src', shareSvg);
      } catch (e) {
        // Fallback to a known icon
        shareIcon.setAttribute('src', 'chrome://global/skin/icons/plus.svg');
      }
      
      shareButton.appendChild(shareIcon);
      
      // Create Screenshot button
      const screenshotButton = document.createElement("div");
      screenshotButton.id = "unified-screenshot-button";
      screenshotButton.className = "unified-extension-item";
      screenshotButton.setAttribute("cui-areatype", "panel");
      screenshotButton.setAttribute("skipintoolbarset", "true");
      screenshotButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        background-color: color-mix(in srgb, currentColor 6%, transparent);
        width: 40px;
        height: 20px;
      `;
      screenshotButton.setAttribute("title", "Take a screenshot");
      
      const screenshotIcon = document.createXULElement("image");
      screenshotIcon.id = "unified-screenshot-icon";
      screenshotIcon.className = "unified-extension-icon";
      screenshotIcon.setAttribute("cui-areatype", "panel");
      screenshotIcon.setAttribute("skipintoolbarset", "true");
      screenshotIcon.style.cssText = "width: 18px; height: 18px; -moz-context-properties: fill; fill: currentColor;";
      try {
        const cameraSvg = `data:image/svg+xml;utf8,`
          + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
               <path fill="context-fill" d="M20 5h-3.2l-1.2-2H8.4L7.2 5H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 13a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>
             </svg>`
          );
        screenshotIcon.setAttribute('src', cameraSvg);
      } catch (e) {
        screenshotIcon.setAttribute('src', 'chrome://global/skin/icons/plus.svg');
      }
      
      screenshotButton.appendChild(screenshotIcon);
      
      // Create Copy URL button
      const copyUrlButton = document.createElement("div");
      copyUrlButton.id = "unified-copy-url-button";
      copyUrlButton.className = "unified-extension-item";
      copyUrlButton.setAttribute("cui-areatype", "panel");
      copyUrlButton.setAttribute("skipintoolbarset", "true");
      copyUrlButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        background-color: color-mix(in srgb, currentColor 6%, transparent);
        width: 40px;
        height: 20px;
      `;
      copyUrlButton.setAttribute("title", "Copy URL to clipboard");
      
      const copyUrlIcon = document.createXULElement("image");
      copyUrlIcon.id = "unified-copy-icon";
      copyUrlIcon.className = "unified-extension-icon";
      copyUrlIcon.setAttribute("cui-areatype", "panel");
      copyUrlIcon.setAttribute("skipintoolbarset", "true");
      copyUrlIcon.style.cssText = "width: 18px; height: 18px; -moz-context-properties: fill; fill: currentColor; transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;";
      try {
        const linkSvg = `data:image/svg+xml;utf8,`
          + encodeURIComponent(
            `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
               <g id="SVGRepo_iconCarrier">
                 <path d="M14.1625 18.4876L13.4417 19.2084C11.053 21.5971 7.18019 21.5971 4.79151 19.2084C2.40283 16.8198 2.40283 12.9469 4.79151 10.5583L5.51236 9.8374" stroke="context-fill" stroke-width="2" stroke-linecap="round"></path>
                 <path d="M9.8374 14.1625L14.1625 9.8374" stroke="context-fill" stroke-width="2" stroke-linecap="round"></path>
                 <path d="M9.8374 5.51236L10.5583 4.79151C12.9469 2.40283 16.8198 2.40283 19.2084 4.79151C21.5971 7.18019 21.5971 11.053 19.2084 13.4417L18.4876 14.1625" stroke="context-fill" stroke-width="2" stroke-linecap="round"></path>
               </g>
             </svg>`
          );
        copyUrlIcon.setAttribute('src', linkSvg);
      } catch (e) {
        // Use Firefox's built-in copy icon
        copyUrlIcon.setAttribute('src', 'chrome://global/skin/icons/edit-copy.svg');
      }
      
      copyUrlButton.appendChild(copyUrlIcon);
      
      // Create Customize Toolbar button
      const customizeButton = document.createElement("div");
      customizeButton.id = "unified-customize-button";
      customizeButton.className = "unified-extension-item";
      customizeButton.setAttribute("cui-areatype", "panel");
      customizeButton.setAttribute("skipintoolbarset", "true");
      customizeButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        background-color: color-mix(in srgb, currentColor 6%, transparent);
        width: 40px;
        height: 20px;
      `;
      customizeButton.setAttribute("title", "Customize Toolbar");
      
      const customizeIcon = document.createXULElement("image");
      customizeIcon.id = "unified-customize-icon";
      customizeIcon.className = "unified-extension-icon";
      customizeIcon.setAttribute("cui-areatype", "panel");
      customizeIcon.setAttribute("skipintoolbarset", "true");
      customizeIcon.style.cssText = "width: 18px; height: 18px; -moz-context-properties: fill; fill: currentColor;";
      try {
        const customizeSvg = `data:image/svg+xml;utf8,`
          + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
               <path fill="context-fill" d="M3.845 3.845a2.883 2.883 0 0 0 0 4.077L5.432 9.51l.038-.04l4-4l.04-.038l-1.588-1.587a2.883 2.883 0 0 0-4.077 0m6.723 2.645l-.038.04l-4 4l-.04.038l9.588 9.588a2.884 2.884 0 0 0 4.078-4.078zM16.1 2.307a.483.483 0 0 1 .9 0l.43 1.095a.48.48 0 0 0 .272.274l1.091.432a.486.486 0 0 1 0 .903l-1.09.432a.5.5 0 0 0-.273.273L17 6.81a.483.483 0 0 1-.9 0l-.43-1.095a.5.5 0 0 0-.273-.273l-1.09-.432a.486.486 0 0 1 0-.903l1.09-.432a.5.5 0 0 0 .273-.274zm3.867 6.823a.483.483 0 0 1 .9 0l.156.399c.05.125.148.224.273.273l.398.158a.486.486 0 0 1 0 .902l-.398.158a.5.5 0 0 0-.273.273l-.156.4a.483.483 0 0 1-.9 0l-.157-.4a.5.5 0 0 0-.272-.273l-.398-.158a.486.486 0 0 1 0-.902l.398-.158a.5.5 0 0 0 .272-.273zM5.133 15.307a.483.483 0 0 1 .9 0l.157.4a.48.48 0 0 0 .272.273l.398.157a.486.486 0 0 1 0 .903l-.398.158a.48.48 0 0 0-.272.273l-.157.4a.483.483 0 0 1-.9 0l-.157-.4a.48.48 0 0 0-.272-.273l-.398-.158a.486.486 0 0 1 0-.903l.398-.157a.48.48 0 0 0 .272-.274z"/>
             </svg>`
          );
        customizeIcon.setAttribute('src', customizeSvg);
      } catch (e) {
        // Fallback to a known icon
        customizeIcon.setAttribute('src', 'chrome://global/skin/icons/plus.svg');
      }
      
      customizeButton.appendChild(customizeIcon);
      
      // Add all buttons to the action section
      actionSection.appendChild(shareButton);
      actionSection.appendChild(screenshotButton);
      actionSection.appendChild(copyUrlButton);
      actionSection.appendChild(customizeButton);

      // Create Picture-in-Picture Toggle section using DOM methods
      const pipSection = document.createElement("div");
      pipSection.id = "urlbar-modifier-pip";
      pipSection.className = "urlbar-modifier-section";
      pipSection.setAttribute("cui-areatype", "panel");
      pipSection.setAttribute("skipintoolbarset", "true");
      pipSection.style.cssText = `
        padding: 8px 8px;
      `;
      
      const pipToggle = document.createElement("div");
      pipToggle.id = "unified-pip-toggle";
      pipToggle.className = "unified-extension-item";
      pipToggle.setAttribute("cui-areatype", "panel");
      pipToggle.setAttribute("skipintoolbarset", "true");
      pipToggle.style.cssText = `
        display: block;
        cursor: pointer;
        background-color: transparent !important;
        width: 190px;
      `;
      
      const pipLabelContainer = document.createElement("div");
      pipLabelContainer.id = "unified-pip-container";
      pipLabelContainer.setAttribute("cui-areatype", "panel");
      pipLabelContainer.setAttribute("skipintoolbarset", "true");
      pipLabelContainer.style.cssText = "display: grid; grid-template-columns: 35px 1fr; grid-auto-rows: min-content; column-gap: 8px; row-gap: 2px; align-items: center; flex: 1; min-width: 0;";
      
      const pipLabel = document.createElement("span");
      pipLabel.className = "unified-extension-label";
      pipLabel.id = "unified-pip-label";
      pipLabel.setAttribute("cui-areatype", "panel");
      pipLabel.setAttribute("skipintoolbarset", "true");
      pipLabel.textContent = "Picture-in-Picture";
      pipLabel.style.cssText = "font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 1em; display: block; font-weight: 700;";

      // Small status text under the main label
      const pipSubLabel = document.createElement("span");
      pipSubLabel.id = "unified-pip-sublabel";
      pipSubLabel.setAttribute("cui-areatype", "panel");
      pipSubLabel.setAttribute("skipintoolbarset", "true");
      pipSubLabel.textContent = "Off";
      pipSubLabel.style.cssText = `
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 0.75em;
        opacity: 0.75;
        margin-top: 2px;
      `;

      // Vertical stack for labels
      const pipTextColumn = document.createElement("div");
      pipTextColumn.id = "unified-pip-text-column";
      pipTextColumn.setAttribute("cui-areatype", "panel");
      pipTextColumn.setAttribute("skipintoolbarset", "true");
      pipTextColumn.style.cssText = "display: flex; flex-direction: column; line-height: 1.1; grid-column: 2; grid-row: 1 / span 2; min-width: 0;";
      pipTextColumn.appendChild(pipLabel);
      pipTextColumn.appendChild(pipSubLabel);
      
      // Create toggle button (round) with masked PiP icon
      const pipButton = document.createElement("button");
      pipButton.id = "pip-button";
      pipButton.setAttribute("type", "button");
      pipButton.setAttribute("cui-areatype", "panel");
      pipButton.setAttribute("skipintoolbarset", "true");
      // Intentionally avoid unified-extension(s)-item classes to prevent native overrides
      pipButton.style.cssText = `
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 35px !important;
        height: 35px !important;
        min-width: 35px !important;
        min-height: 35px !important;
        border-radius: 50% !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
        appearance: none !important;
        -moz-appearance: none !important;
        outline: none !important;
        background-clip: padding-box !important;
        background-color: color-mix(in srgb, currentColor 20%, transparent) !important;
        transition: background-color 0.2s ease, transform 0.08s ease !important;
      `;

      // Use XUL image with context-fill so glyph takes panel background color
      const pipButtonIcon = document.createXULElement('image');
      pipButtonIcon.id = 'unified-pip-icon';
      pipButtonIcon.className = 'pip-button-glyph';
      pipButtonIcon.setAttribute('cui-areatype', 'panel');
      pipButtonIcon.setAttribute('skipintoolbarset', 'true');
      pipButtonIcon.setAttribute('src', 'chrome://global/skin/media/picture-in-picture-open.svg');
      pipButtonIcon.style.cssText = `
        width: 16px !important;
        height: 16px !important;
        -moz-context-properties: fill !important;
        fill: var(--arrowpanel-background, var(--panel-background, Canvas)) !important;
      `;
      pipButton.appendChild(pipButtonIcon);
      try {
        pipButton.style.setProperty('grid-row', '1 / span 2', 'important');
        pipButton.style.setProperty('grid-column', '1', 'important');
      } catch {}
      // Place the round button to the left and the two-line text column to the right
      pipLabelContainer.appendChild(pipButton);
      pipLabelContainer.appendChild(pipTextColumn);
      pipToggle.appendChild(pipLabelContainer);
      pipSection.appendChild(pipToggle);

      // Press feedback for the round button
      try {
        pipButton.addEventListener('mousedown', () => {
          pipButton.style.transform = 'scale(0.96)';
        });
        const resetPress = () => { pipButton.style.transform = 'scale(1)'; };
        pipButton.addEventListener('mouseup', resetPress);
        pipButton.addEventListener('mouseleave', resetPress);
        pipButton.addEventListener('blur', resetPress);
      } catch {}

      // Create separator between PiP and Security sections
      const pipSeparator = document.createXULElement("toolbarseparator");
      pipSeparator.id = "urlbar-modifier-separator";
      pipSeparator.setAttribute("cui-areatype", "panel");
      pipSeparator.setAttribute("skipintoolbarset", "true");
      pipSeparator.style.cssText = "margin-top: 0px !important;";

      // Create Security section using DOM methods
      const securitySection = document.createElement("div");
      securitySection.id = "urlbar-modifier-security";
      securitySection.className = "urlbar-modifier-section";
      securitySection.setAttribute("cui-areatype", "panel");
      securitySection.setAttribute("skipintoolbarset", "true");
      securitySection.style.cssText = `
        padding: 8px 8px;
      `;
      
      const securityStatus = document.createElement("div");
      securityStatus.id = "unified-security-status";
      securityStatus.className = "unified-security-pill";
      securityStatus.setAttribute("cui-areatype", "panel");
      securityStatus.setAttribute("skipintoolbarset", "true");
      securityStatus.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 4px 8px;
        border-radius: 5px;
        background-color: color-mix(in srgb, currentColor 8%, transparent);
      `;
      
      const securityIcon = document.createXULElement("image");
      securityIcon.id = "unified-security-icon";
      securityIcon.className = "unified-extension-icon";
      securityIcon.setAttribute("cui-areatype", "panel");
      securityIcon.setAttribute("skipintoolbarset", "true");
      securityIcon.setAttribute("src", "chrome://global/skin/icons/security.svg");
      // Theme-aware via context fill
      securityIcon.style.cssText = "width: 10px; height: 10px; -moz-context-properties: fill; fill: currentColor;";
      
      const securityText = document.createElement("span");
      securityText.id = "unified-security-text";
      securityText.setAttribute("cui-areatype", "panel");
      securityText.setAttribute("skipintoolbarset", "true");
      securityText.textContent = "Secure";
      securityText.style.cssText = "font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 0.85em; font-weight: 500;";
      
      securityStatus.appendChild(securityIcon);
      securityStatus.appendChild(securityText);
      
      // Create extras button
      const extrasButton = document.createElement("div");
      extrasButton.id = "unified-extras-button";
      extrasButton.className = "unified-extension-item";
      extrasButton.setAttribute("cui-areatype", "panel");
      extrasButton.setAttribute("skipintoolbarset", "true");
      extrasButton.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        background-color: color-mix(in srgb, currentColor 6%, transparent);
        width: 8px;
        height: 6px;
      `;
      extrasButton.setAttribute("title", "Extras Menu");
      
      // Create extras icon
      const extrasIcon = document.createElement("img");
      extrasIcon.id = "unified-extras-icon";
      extrasIcon.className = "unified-extension-icon";
      extrasIcon.setAttribute("cui-areatype", "panel");
      extrasIcon.setAttribute("skipintoolbarset", "true");
      extrasIcon.src = "chrome://browser/skin/zen-icons/menu.svg";
      extrasIcon.style.cssText = "width: 14px; height: 14px; -moz-context-properties: fill; fill: currentColor;";
      
      extrasButton.appendChild(extrasIcon);
      
      // Create container for security status and extras button
      const securityContainer = document.createElement("div");
      securityContainer.id = "unified-security-container";
      securityContainer.setAttribute("cui-areatype", "panel");
      securityContainer.setAttribute("skipintoolbarset", "true");
      securityContainer.style.cssText = "display: flex; align-items: center; gap: 8px;";
      securityContainer.appendChild(securityStatus);
      securityContainer.appendChild(extrasButton);
      
      securitySection.appendChild(securityContainer);

      // Hide extension names and menu buttons to clean up the UI
      const extensionNames = unifiedPanel.querySelectorAll('.unified-extensions-item-name');
      extensionNames.forEach(name => {
        name.style.display = 'none';
      });
      
      const extensionMenuButtons = unifiedPanel.querySelectorAll('.unified-extensions-item-menu-button.subviewbutton.subviewbutton-iconic');
      extensionMenuButtons.forEach(button => {
        button.style.display = 'none';
      });

      // Attempt to enable native grid view via preference if available
      try {
        Services.prefs.setBoolPref('mod.extension.viewgrid', true);
      } catch (e) {
        console.debug('Could not set mod.extension.viewgrid pref, proceeding without it');
      }

      // Use native layout; do not force grid styles. Optionally hide labels/menus after panel renders
      const extensionsArea = unifiedPanel.querySelector('#unified-extensions-area');
      if (extensionsArea) {
        
        setTimeout(() => {
          // Only hide text labels and menu buttons - don't modify the extension items themselves
          const extensionNames = extensionsArea.querySelectorAll('.unified-extensions-item-name');
          extensionNames.forEach(name => {
            name.style.display = 'none';
          });
          
          const extensionMenuButtons = extensionsArea.querySelectorAll('.unified-extensions-item-menu-button');
          extensionMenuButtons.forEach(button => {
            button.style.display = 'none';
          });
          
          const contentsBoxes = extensionsArea.querySelectorAll('.unified-extensions-item-contents');
          contentsBoxes.forEach(box => {
            box.style.display = 'none';
          });
          
          // Append trailing "+" tile to browse add-ons (ensure only once)
          if (!extensionsArea.querySelector('#ue-add-extension-button')) {
            try {
              const gridContainer = extensionsArea;

              const item = document.createXULElement('toolbaritem');
              item.id = 'ue-add-extension-item';
              item.className = 'toolbaritem-combined-buttons unified-extensions-item chromeclass-toolbar-additional';
              item.setAttribute('cui-areatype', 'panel');
              item.setAttribute('skipintoolbarset', 'true');
              item.setAttribute('widget-type', 'custom');
              item.setAttribute('removable', 'false');
              item.setAttribute('overflows', 'true');

              const row = document.createXULElement('box');
              row.id = 'ue-add-extension-row';
              row.className = 'unified-extensions-item-row-wrapper';
              row.setAttribute('cui-areatype', 'panel');
              row.setAttribute('skipintoolbarset', 'true');

              const plusBtn = document.createXULElement('toolbarbutton');
              plusBtn.id = 'ue-add-extension-button';
              plusBtn.className = 'unified-extensions-item-action-button panel-no-padding subviewbutton subviewbutton-iconic';
              plusBtn.setAttribute('cui-areatype', 'panel');
              plusBtn.setAttribute('skipintoolbarset', 'true');
              plusBtn.setAttribute('tooltiptext', 'Browse add-ons');
              plusBtn.setAttribute('image', 'chrome://global/skin/icons/plus.svg');
              plusBtn.setAttribute('tabindex', '0');
              plusBtn.setAttribute('role', 'button');

              const activate = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const url = 'https://addons.mozilla.org/en-US/firefox/extensions/';
                try {
                  if (typeof UC_API !== 'undefined' && UC_API?.Utils?.loadURI) {
                    UC_API.Utils.loadURI(window, { url, where: 'tab' });
                  } else if (typeof gBrowser !== 'undefined') {
                    gBrowser.loadOneTab(url, { inBackground: false });
                  } else {
                    window.open(url, '_blank', 'noopener');
                  }
                } catch (e) {
                  try { window.open(url, '_blank', 'noopener'); } catch {}
                }
              };

              plusBtn.addEventListener('click', activate);
              plusBtn.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
              });

              row.appendChild(plusBtn);
              item.appendChild(row);
              gridContainer.appendChild(item);
            } catch (e) {
              console.warn('Failed to append add-extension plus button', e);
            }
          }

          // Ensure the plus tile stays at the end of the grid when items change
          try {
            const ensurePlusAtEnd = () => {
              if (extensionsArea.__uePlusBusy) return;
              extensionsArea.__uePlusBusy = true;
              // Defer to avoid running during DOM removal
              setTimeout(() => {
                try {
                  if (!extensionsArea || !extensionsArea.isConnected) return;
                  const btn = extensionsArea.querySelector('#ue-add-extension-button');
                  if (!btn) return;
                  // Find the container tile for the button
                  let tile = btn.closest && btn.closest('toolbaritem');
                  if (!tile || tile.nodeType !== Node.ELEMENT_NODE) tile = btn;
                  if (!tile || !tile.parentNode) return;
                  // Append to end only if not already last or wrong parent
                  if (tile.parentNode !== extensionsArea || tile !== extensionsArea.lastElementChild) {
                    extensionsArea.appendChild(tile);
                  }
                } catch (e) {
                  console.warn('ensurePlusAtEnd failed', e);
                } finally {
                  extensionsArea.__uePlusBusy = false;
                }
              }, 0);
            };

            ensurePlusAtEnd();

            if (!extensionsArea.__uePlusObserver) {
              const plusObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                  if (m.type === 'childList' && (m.addedNodes && m.addedNodes.length || m.removedNodes && m.removedNodes.length)) {
                    ensurePlusAtEnd();
                    break;
                  }
                }
              });
              plusObserver.observe(extensionsArea, { childList: true });
              extensionsArea.__uePlusObserver = plusObserver;

              // Clean up observer when the panel hides/closes
              const cleanup = () => {
                try {
                  if (extensionsArea.__uePlusObserver) {
                    extensionsArea.__uePlusObserver.disconnect();
                    extensionsArea.__uePlusObserver = null;
                  }
                } catch {}
              };
              unifiedPanel.addEventListener('popuphidden', cleanup, { once: true });
            }
          } catch (e) {
            console.warn('Failed to enforce plus tile ordering', e);
          }

          console.log("Applied minimal cleanup (names/menus hidden) and appended plus tile");
        }, 150);
      }

      // Insert action buttons at the top, PiP toggle and security at the bottom
      unifiedPanel.insertBefore(actionSection, unifiedPanel.firstChild);
      
      // Find the "Manage extensions" button and replace it with our sections
      const manageButton = unifiedPanel.querySelector("#unified-extensions-manage-extensions");
      if (manageButton) {
        // Hide the manage button
        manageButton.style.display = "none";
        
        // Insert a "Settings" label and PiP/Security stack before the manage button
        const settingsLabel = makeSectionLabel('ue-section-label-settings', 'Settings');
        if (settingsLabel && !unifiedPanel.querySelector('#ue-section-label-settings')) {
          unifiedPanel.insertBefore(settingsLabel, manageButton);
        }
        // Insert PiP section before the manage button
        unifiedPanel.insertBefore(pipSection, manageButton);
        // Insert separator after PiP section
        unifiedPanel.insertBefore(pipSeparator, manageButton);
        // Insert security section after separator
        unifiedPanel.insertBefore(securitySection, manageButton);
      } else {
        // Fallback: append to the end
        const settingsLabel = makeSectionLabel('ue-section-label-settings', 'Settings');
        if (settingsLabel && !unifiedPanel.querySelector('#ue-section-label-settings')) {
          unifiedPanel.appendChild(settingsLabel);
        }
        unifiedPanel.appendChild(pipSection);
        unifiedPanel.appendChild(pipSeparator);
        unifiedPanel.appendChild(securitySection);
      }

      // Add event listeners to action buttons
      shareButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.shareCurrentUrl(event);
      });
      shareButton.addEventListener("mouseenter", () => {
        shareButton.style.backgroundColor = "color-mix(in srgb, currentColor 10%, transparent)";
      });
      shareButton.addEventListener("mouseleave", () => {
        shareButton.style.backgroundColor = "color-mix(in srgb, currentColor 6%, transparent)";
      });

      screenshotButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.takeScreenshot(event);
      });
      screenshotButton.addEventListener("mouseenter", () => {
        screenshotButton.style.backgroundColor = "color-mix(in srgb, currentColor 10%, transparent)";
      });
      screenshotButton.addEventListener("mouseleave", () => {
        screenshotButton.style.backgroundColor = "color-mix(in srgb, currentColor 6%, transparent)";
      });

      copyUrlButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.copyCurrentUrl(event);
      });
      copyUrlButton.addEventListener("mouseenter", () => {
        copyUrlButton.style.backgroundColor = "color-mix(in srgb, currentColor 10%, transparent)";
      });
      copyUrlButton.addEventListener("mouseleave", () => {
        copyUrlButton.style.backgroundColor = "color-mix(in srgb, currentColor 6%, transparent)";
      });

      customizeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.customizeToolbar(event);
      });
      customizeButton.addEventListener("mouseenter", () => {
        customizeButton.style.backgroundColor = "color-mix(in srgb, currentColor 10%, transparent)";
      });
      customizeButton.addEventListener("mouseleave", () => {
        customizeButton.style.backgroundColor = "color-mix(in srgb, currentColor 6%, transparent)";
      });

      // Add event listener for extras button
      extrasButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.showExtrasContextMenu(event);
      });
      extrasButton.addEventListener("mouseenter", () => {
        extrasButton.style.backgroundColor = "color-mix(in srgb, currentColor 10%, transparent)";
      });
      extrasButton.addEventListener("mouseleave", () => {
        extrasButton.style.backgroundColor = "color-mix(in srgb, currentColor 6%, transparent)";
      });

      // Add event listeners to PiP toggle
      pipToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        // When clicking anywhere in the row, treat as a toggle
        this.toggleAutoPiP(event);
      });
      pipButton.addEventListener("click", (event) => {
        // Ensure button also toggles without relying on parent
        event.stopPropagation();
        this.toggleAutoPiP(event);
      });

      // Initialize PiP toggle state
      this.updatePiPToggleState();

      // Update security info
      this.updateUnifiedSecurityInfo();

      this.unifiedPanelModified = true;
      console.log("Unified extensions panel successfully modified");

    } catch (err) {
      console.error("Error modifying unified extensions panel:", err);
    }
  }

  createExtrasContextMenu() {
    // Remove existing context menu if it exists
    const existingMenu = document.querySelector("#extras-context-menu");
    if (existingMenu) {
      existingMenu.remove();
    }

    const contextMenuXUL = `
      <menupopup id="extras-context-menu">
        <menuitem id="clear-cache-button" label="Clear Cache"/>
        <menuitem id="clear-cookies-button" label="Clear Cookies"/>
        <menuseparator/>
        <menuitem id="manage-extensions-button" label="Manage Extensions"/>
        <menuseparator/>
        <menuitem id="page-permissions-button" label="All Page Permissions"/>
      </menupopup>
    `;

    const mainPopupSet = document.querySelector("#mainPopupSet");
    if (mainPopupSet) {
      appendXUL(mainPopupSet, contextMenuXUL, null, true);
      console.log("Extras context menu created and added to mainPopupSet");
    }
  }

  showExtrasContextMenu(event) {
    try {
      // Create the context menu if it doesn't exist
      if (!document.getElementById("extras-context-menu")) {
        this.createExtrasContextMenu();
      }

      // Set up event listeners if not already done
      if (!this.extrasMenuListenersSetup) {
        this.setupExtrasMenuListeners();
        this.extrasMenuListenersSetup = true;
      }

      const contextMenu = document.getElementById("extras-context-menu");
      if (contextMenu) {
        // Anchor the popup to the button for better UX
        const anchor = event.currentTarget || event.target;
        contextMenu.openPopup(anchor, "after_end", 0, 0, true, false, event);
      }
    } catch (error) {
      console.error("Error showing extras context menu:", error);
    }
  }

  setupExtrasMenuListeners() {
    if (this.extrasMenuListenersSetup) return;

    const clearCacheButton = document.getElementById("clear-cache-button");
    const clearCookiesButton = document.getElementById("clear-cookies-button");
    const manageExtensionsButton = document.getElementById("manage-extensions-button");
    const pagePermissionsButton = document.getElementById("page-permissions-button");

    if (clearCacheButton) {
      clearCacheButton.addEventListener("command", (e) => {
        e.stopPropagation();
        this.clearCache();
        const extrasMenu = document.getElementById("extras-context-menu");
        extrasMenu?.hidePopup();
      });
    }

    if (clearCookiesButton) {
      clearCookiesButton.addEventListener("command", (e) => {
        e.stopPropagation();
        this.clearCookies();
        const extrasMenu = document.getElementById("extras-context-menu");
        extrasMenu?.hidePopup();
      });
    }

    if (manageExtensionsButton) {
      manageExtensionsButton.addEventListener("command", (e) => {
        e.stopPropagation();
        try {
          const principal = Services.scriptSecurityManager.getSystemPrincipal();
          const tab = gBrowser.addTab("about:addons", { triggeringPrincipal: principal });
          gBrowser.selectedTab = tab;
        } catch (err) {
          console.error("URLBarModifier: Failed to open about:addons", err);
          // Fallback
          try { window.openTrustedLinkIn("about:addons", "tab"); } catch (_) {}
        } finally {
          const extrasMenu = document.getElementById("extras-context-menu");
          extrasMenu?.hidePopup();
          // Also hide the unified extensions panel
          const unifiedPanel = document.getElementById("unified-extensions-panel");
          if (unifiedPanel && unifiedPanel.hidePopup) {
            unifiedPanel.hidePopup();
          }
        }
      });
    }

    if (pagePermissionsButton) {
      pagePermissionsButton.addEventListener("command", (e) => {
        e.stopPropagation();
        // Store panel reference before any operations
        const unifiedPanel = document.querySelector("#unified-extensions-view");
        try {
          // Try to open the permissions panel directly using Firefox's internal API
            if (window.gPermissionPanel && window.gPermissionPanel.openPopup) {
              console.log("URLBarModifier: Opening permissions panel via gPermissionPanel");
              // Set the anchor to the unified extensions button instead of the hidden native permission button
              const unifiedExtensionsButton = document.getElementById("unified-extensions-button");
              if (unifiedExtensionsButton && window.gPermissionPanel.setAnchor) {
                window.gPermissionPanel.setAnchor(unifiedExtensionsButton, "bottomleft topleft");
              }
              window.gPermissionPanel.openPopup(e);
            } else if (typeof BrowserPageInfo === 'function') {
              console.log("URLBarModifier: Opening page info dialog");
              BrowserPageInfo(gBrowser.selectedBrowser.currentURI.spec, null, null, gBrowser.selectedBrowser);
            } else if (window.gIdentityHandler && window.gIdentityHandler.handleMoreInfoClick) {
              console.log("URLBarModifier: Using gIdentityHandler.handleMoreInfoClick");
              window.gIdentityHandler.handleMoreInfoClick(e);
            } else if (typeof openPageInfo === 'function') {
              console.log("URLBarModifier: Using openPageInfo function");
              openPageInfo(gBrowser.selectedBrowser.currentURI.spec, null, null, gBrowser.selectedBrowser);
            } else {
            // Try to trigger the page info command
            const controller = top.document.commandDispatcher.getControllerForCommand("View:PageInfo");
            if (controller && controller.isCommandEnabled("View:PageInfo")) {
              console.log("URLBarModifier: Using View:PageInfo command");
              controller.doCommand("View:PageInfo");
            } else {
              // Final fallback: open about:permissions
              console.log("URLBarModifier: Using fallback about:permissions");
              const principal = Services.scriptSecurityManager.getSystemPrincipal();
              const tab = gBrowser.addTab("about:permissions", { triggeringPrincipal: principal });
              gBrowser.selectedTab = tab;
            }
          }
        } catch (err) {
          console.error("URLBarModifier: Failed to open page permissions", err);
          // Final fallback
          try {
            const principal = Services.scriptSecurityManager.getSystemPrincipal();
            const tab = gBrowser.addTab("about:permissions", { triggeringPrincipal: principal });
            gBrowser.selectedTab = tab;
          } catch (fallbackErr) {
            console.error("URLBarModifier: Fallback also failed", fallbackErr);
          }
        } finally {
          // Close the unified extensions panel using the same method as other buttons
          this.closePanelImmediately(unifiedPanel);
        }
      });
    }

    this.extrasMenuListenersSetup = true;
  }

  clearCache() {
    try {
      console.log("Clearing cache...");
      
      // Clear disk cache
      Services.cache2.clear();
      
      // Clear memory cache
      const memoryService = Cc["@mozilla.org/memory-reporter-manager;1"]
        .getService(Ci.nsIMemoryReporterManager);
      memoryService.minimizeMemoryUsage(() => {
        console.log("Memory cache cleared");
      });
      
      // Clear image cache
      const imgCache = Cc["@mozilla.org/image/cache;1"]
        .getService(Ci.imgICache);
      imgCache.clearCache(false); // false = don't clear chrome cache
      
      // Refresh current tab
      if (gBrowser && gBrowser.selectedBrowser) {
        gBrowser.selectedBrowser.reload();
      }
      
      console.log("Cache cleared successfully");
    } catch (error) {
      console.error("Error clearing cache:", error);
    }
  }

  clearCookies() {
    try {
      console.log("Clearing cookies for current site...");
      
      const currentURI = gBrowser.currentURI;
      if (!currentURI) {
        console.warn("No current URI found");
        return;
      }
      
      const host = currentURI.host;
      if (!host) {
        console.warn("No host found in current URI");
        return;
      }
      
      // Clear cookies for the current domain
      const cookieManager = Cc["@mozilla.org/cookiemanager;1"]
        .getService(Ci.nsICookieManager);
      
      // Get all cookies and remove those matching the current host
      const cookies = cookieManager.cookies;
      for (const cookie of cookies) {
        if (cookie.host === host || cookie.host === `.${host}`) {
          cookieManager.remove(cookie.host, cookie.name, cookie.path, {});
        }
      }
      
      // Clear site data (localStorage, sessionStorage, indexedDB, etc.)
      const principal = Services.scriptSecurityManager.createContentPrincipal(
        currentURI, {}
      );
      
      Services.clearData.deleteDataFromPrincipal(
        principal,
        true, // user request
        Ci.nsIClearDataService.CLEAR_ALL,
        () => {
          console.log("Site data cleared successfully");
          // Refresh current tab
          if (gBrowser && gBrowser.selectedBrowser) {
            gBrowser.selectedBrowser.reload();
          }
        }
      );
      
      console.log(`Cookies and site data cleared for: ${host}`);
    } catch (error) {
      console.error("Error clearing cookies:", error);
    }
  }

  updateUnifiedSecurityInfo() {
    try {
      const currentURI = gBrowser.currentURI;
      const securityStatus = document.getElementById("unified-security-status");
      const securityIcon = document.getElementById("unified-security-icon");
      const securityText = document.getElementById("unified-security-text");
      
      if (!currentURI || !securityStatus || !securityIcon || !securityText) {
        console.warn("Unified security elements not found or no current URI");
        return;
      }

      // Check connection security
      const scheme = currentURI.scheme;
      
      if (scheme === "https") {
        securityText.textContent = "Secure";
        securityStatus.setAttribute("title", "Secure HTTPS Connection");
        securityStatus.style.color = "currentColor";
        securityIcon.style.filter = "";
      } else if (scheme === "http") {
        securityText.textContent = "Insecure";
        securityStatus.setAttribute("title", "Insecure HTTP Connection");
        securityStatus.style.color = "#ef4444";
        securityIcon.style.filter = "hue-rotate(0deg) saturate(2) brightness(0.6) sepia(1) hue-rotate(-50deg)";
      } else {
        securityText.textContent = "Local";
        securityStatus.setAttribute("title", "Local or Special Page");
        securityStatus.style.color = "currentColor";
        securityIcon.style.filter = "";
      }

      console.log("Unified security info updated for:", currentURI.spec);
    } catch (err) {
      console.error("Error updating unified security info:", err);
    }
  }


  shareCurrentUrl(event) {
    const currentUrl = gBrowser.currentURI.spec;
    if (
      currentUrl &&
      (currentUrl.startsWith("http://") || currentUrl.startsWith("https://"))
    ) {
      const buttonRect = event.target.getBoundingClientRect();
      Services.zen.share(
        Services.io.newURI(currentUrl),
        "",
        "",
        buttonRect.left,
        window.innerHeight - buttonRect.bottom,
        buttonRect.width,
        buttonRect.height
      );
      // Close the unified extensions panel after sharing
      const unifiedPanel = document.querySelector("#unified-extensions-view");
      if (unifiedPanel && unifiedPanel.hidePopup) {
        unifiedPanel.hidePopup();
      }
    }
  }

  takeScreenshot(event) {
    try {
      console.log("URLBarModifier: takeScreenshot invoked");
      // Store panel reference before any async operations
      const unifiedPanel = document.querySelector("#unified-extensions-view");

      // Debug: Check what screenshot commands are available
      console.log("URLBarModifier: Checking available screenshot commands...");
      console.log("- BrowserCommands.screenshot:", !!window.BrowserCommands?.screenshot);
      console.log("- ScreenshotUI.openSelectedBrowser:", !!window.ScreenshotUI?.openSelectedBrowser);
      console.log("- Services.zen.screenshot:", !!Services?.zen?.screenshot);
      console.log("- goDoCommand function:", typeof goDoCommand);
      console.log("- gBrowser available:", typeof gBrowser !== 'undefined');
      console.log("- window.gBrowser available:", typeof window.gBrowser !== 'undefined');

      // Get the correct browser reference
      const browser = gBrowser?.selectedBrowser || 
                     window.gBrowser?.selectedBrowser || 
                     document.getElementById('content')?.selectedBrowser ||
                     window.content;

      // Try Firefox Screenshots API directly
      try {
        if (typeof Screenshots !== 'undefined' && Screenshots.showPanel && browser) {
          console.log("URLBarModifier: Using Screenshots.showPanel");
          Screenshots.showPanel(window, browser);
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Screenshots.showPanel failed:", e.message);
      }

      // Try the newer Screenshots.jsm API with ChromeUtils.importESModule
      try {
        const { Screenshots } = ChromeUtils.importESModule("resource:///modules/Screenshots.sys.mjs");
        if (Screenshots && Screenshots.showPanel && browser) {
          console.log("URLBarModifier: Using Screenshots.sys.mjs showPanel");
          Screenshots.showPanel(window, browser);
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Screenshots.sys.mjs failed:", e.message);
      }

      // Try the older Screenshots.jsm API
      try {
        const { Screenshots } = ChromeUtils.import("resource:///modules/Screenshots.jsm");
        if (Screenshots && Screenshots.showPanel && browser) {
          console.log("URLBarModifier: Using Screenshots.jsm showPanel");
          Screenshots.showPanel(window, browser);
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Screenshots.jsm failed:", e.message);
      }

      // Try using Services.obs to notify screenshot service with different topics and data
      const screenshotTopics = [
        { topic: "menuitem-screenshot", data: null },
        { topic: "screenshots-take-screenshot", data: browser?.outerWindowID || null }, 
        { topic: "screenshot-ui-show", data: JSON.stringify({windowId: window.windowUtils?.outerWindowID}) },
        { topic: "Screenshots:ShowPanel", data: browser?.outerWindowID || null }
      ];
      
      for (const {topic, data} of screenshotTopics) {
        try {
          console.log(`URLBarModifier: Using Services.obs with topic: ${topic}, data: ${data}`);
          Services.obs.notifyObservers(window, topic, data);
          // Close panel after successful screenshot
          this.closePanelImmediately(unifiedPanel);
          return;
        } catch (e) {
          console.log(`URLBarModifier: Services.obs ${topic} failed:`, e.message);
        }
      }

      // Try Firefox's internal screenshot command controller with context
      try {
        // Set up the context that Firefox screenshot expects
        if (typeof gBrowser !== 'undefined' && gBrowser.selectedBrowser) {
          window._tempScreenshotBrowser = gBrowser.selectedBrowser;
        }
        
        const controller = top.document.commandDispatcher.getControllerForCommand("cmd_screenshot");
        if (controller && controller.isCommandEnabled("cmd_screenshot")) {
          console.log("URLBarModifier: Using command controller for cmd_screenshot");
          controller.doCommand("cmd_screenshot");
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Command controller failed:", e.message);
      } finally {
        // Clean up temp reference
        if (window._tempScreenshotBrowser) {
          delete window._tempScreenshotBrowser;
        }
      }

      // Try alternative screenshot command IDs
      const screenshotCommands = ["cmd_screenshot", "Browser:Screenshot", "Tools:Screenshot"];
      for (const cmdId of screenshotCommands) {
        try {
          const controller = top.document.commandDispatcher.getControllerForCommand(cmdId);
          if (controller && controller.isCommandEnabled(cmdId)) {
            console.log(`URLBarModifier: Using command controller for ${cmdId}`);
            controller.doCommand(cmdId);
            return;
          }
        } catch (e) {
          console.log(`URLBarModifier: Command controller ${cmdId} failed:`, e.message);
        }
      }

      // Prefer native BrowserCommands if available
      if (window.BrowserCommands?.screenshot && browser) {
        console.log("URLBarModifier: Using BrowserCommands.screenshot");
        window.BrowserCommands.screenshot(browser);
        return;
      }

      // Try gBrowser ownerDocument commands (cmd_screenshot)
      try {
        if (typeof goDoCommand === 'function') {
          console.log("URLBarModifier: Using goDoCommand('cmd_screenshot')");
          goDoCommand('cmd_screenshot');
          return;
        }
      } catch {}

      // Try alternative Browser command id
      try {
        if (typeof goDoCommand === 'function') {
          console.log("URLBarModifier: Using goDoCommand('Browser:Screenshot')");
          goDoCommand('Browser:Screenshot');
          return;
        }
      } catch {}

      // Try invoking command elements directly if present
      try {
        const cmdEl = document.getElementById('cmd_screenshot') || document.getElementById('Browser:Screenshot');
        if (cmdEl && typeof cmdEl.doCommand === 'function') {
          console.log("URLBarModifier: Using command element doCommand for screenshot");
          cmdEl.doCommand();
          return;
        }
      } catch {}

      // Try the ScreenshotUI API used internally in some builds
      try {
        if (window.ScreenshotUI?.openSelectedBrowser && browser) {
          console.log("URLBarModifier: Using ScreenshotUI.openSelectedBrowser");
          window.ScreenshotUI.openSelectedBrowser(browser);
          return;
        }
      } catch {}

      // Zen specific: Services.zen.screenshot if provided
      try {
        if (Services?.zen?.screenshot && browser) {
          console.log("URLBarModifier: Using Services.zen.screenshot");
          Services.zen.screenshot(browser);
          return;
        }
      } catch {}

      // Try direct access to Firefox screenshot functionality via window object
      try {
        console.log("URLBarModifier: Trying window.screenshot API");
        if (typeof window.screenshot === 'function') {
          window.screenshot();
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: window.screenshot failed:", e.message);
      }

      // Try accessing screenshot through the content window
      try {
        console.log("URLBarModifier: Trying content window screenshot");
        const contentWin = browser?.contentWindow || window.content;
        if (contentWin && typeof contentWin.screenshot === 'function') {
          contentWin.screenshot();
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Content window screenshot failed:", e.message);
      }

      // Try keyboard shortcut simulation for screenshot (more comprehensive)
      try {
        console.log("URLBarModifier: Trying keyboard shortcut simulation");
        // Try multiple key event targets
        const targets = [document, window, browser?.contentDocument, browser?.contentWindow];
        
        for (const target of targets) {
          if (!target) continue;
          try {
            const keyEvent = new KeyboardEvent('keydown', {
              key: 'S',
              code: 'KeyS',
              ctrlKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true
            });
            target.dispatchEvent(keyEvent);
            
            // Also try keyup
            const keyUpEvent = new KeyboardEvent('keyup', {
              key: 'S',
              code: 'KeyS',
              ctrlKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true
            });
            target.dispatchEvent(keyUpEvent);
          } catch (e) {
            console.log(`URLBarModifier: Keyboard shortcut on ${target.constructor.name} failed:`, e.message);
          }
        }
        return;
      } catch (e) {
        console.log("URLBarModifier: Keyboard shortcut failed:", e.message);
      }

      // As a very last resort try clicking a toolbar screenshot button if present
      const screenshotCommand = document.getElementById('screenshot-button') ||
                               document.getElementById('screenshot') ||
                               document.querySelector('[command="screenshot"]');
      if (screenshotCommand) {
        console.log("URLBarModifier: Clicking existing screenshot button");
        screenshotCommand.click();
        return;
      }

      console.warn('URLBarModifier: No screenshot command available');
      
      // Close panel after screenshot attempts
      this.closePanelImmediately(unifiedPanel);
    } catch (err) {
      console.error("Error taking screenshot:", err);
    }
  }

  copyCurrentUrl(event) {
    try {
      console.log("URLBarModifier: copyCurrentUrl invoked");
      // Store panel reference before any async operations
      const unifiedPanel = document.querySelector("#unified-extensions-view");
      console.log("URLBarModifier: Panel found:", !!unifiedPanel, "hidePopup available:", !!unifiedPanel?.hidePopup);
      
      // Use Zen browser native system
      try {
        if (window.ZenCommandPalette && typeof window.ZenCommandPalette.executeCommandByKey === "function") {
          console.log("URLBarModifier: Using ZenCommandPalette.executeCommandByKey");
          window.ZenCommandPalette.executeCommandByKey("cmd_zenCopyCurrentURL");
          // Show feedback animation and close panel after delay
          this.showCopyFeedback();
          this.closePanelAfterDelay(unifiedPanel);
        } else {
          const cmd = document.getElementById("cmd_zenCopyCurrentURL");
          if (cmd && typeof cmd.doCommand === "function") {
            console.log("URLBarModifier: Using cmd.doCommand");
            cmd.doCommand();
            // Show feedback animation and close panel after delay
            this.showCopyFeedback();
            this.closePanelAfterDelay(unifiedPanel);
          } else {
            console.warn("URLBarModifier: Zen copy command not found, falling back to standard methods");
            this.fallbackCopyMethods(unifiedPanel);
          }
        }
      } catch (e) {
        console.log("URLBarModifier: Zen copy command failed:", e.message);
        this.fallbackCopyMethods(unifiedPanel);
      }

    } catch (err) {
      console.error("Error copying URL:", err);
    }
  }

  fallbackCopyMethods(unifiedPanel) {
    try {
      // Get the current URL
      const currentUrl = gBrowser?.currentURI?.spec || 
                        window.gBrowser?.currentURI?.spec ||
                        window.location.href;
      
      if (!currentUrl) {
        console.warn("URLBarModifier: No URL found to copy");
        return;
      }

      console.log("URLBarModifier: Copying URL:", currentUrl);

      // Method 1: Try modern Clipboard API
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          console.log("URLBarModifier: Using navigator.clipboard.writeText");
          navigator.clipboard.writeText(currentUrl).then(() => {
            console.log("URLBarModifier: URL copied successfully via Clipboard API");
            this.showCopyFeedback();
            this.closePanelAfterDelay(unifiedPanel);
          }).catch(e => {
            console.log("URLBarModifier: Clipboard API failed:", e.message);
            this.fallbackCopy(currentUrl, unifiedPanel);
          });
          return;
        }
      } catch (e) {
        console.log("URLBarModifier: Clipboard API not available:", e.message);
      }

      // Method 2: Try Firefox's clipboard service
      try {
        console.log("URLBarModifier: Using Firefox clipboard service");
        const clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"]
                               .getService(Ci.nsIClipboardHelper);
        clipboardHelper.copyString(currentUrl);
        console.log("URLBarModifier: URL copied successfully via Firefox clipboard service");
        this.showCopyFeedback();
        this.closePanelAfterDelay(unifiedPanel);
        return;
      } catch (e) {
        console.log("URLBarModifier: Firefox clipboard service failed:", e.message);
      }

      // Method 3: Try execCommand as fallback
      this.fallbackCopy(currentUrl, unifiedPanel);

    } catch (err) {
      console.error("Error in fallback copy methods:", err);
    }
  }

  fallbackCopy(text, unifiedPanel) {
    try {
      console.log("URLBarModifier: Using execCommand fallback");
      // Create a temporary textarea
      const textarea = document.createElement("textarea");
      textarea.id = "urlbar-modifier-clipboard";
      textarea.setAttribute("cui-areatype", "panel");
      textarea.setAttribute("skipintoolbarset", "true");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (success) {
        console.log("URLBarModifier: URL copied successfully via execCommand");
        this.showCopyFeedback();
        this.closePanelAfterDelay(unifiedPanel);
      } else {
        console.warn("URLBarModifier: execCommand copy failed");
      }
    } catch (e) {
      console.error("URLBarModifier: Fallback copy failed:", e.message);
    }
  }

  showCopyFeedback() {
    try {
      // Show a subtle, modern visual feedback by smoothly morphing the icon
      const button = document.getElementById("unified-copy-url-button");
      const icon = button?.querySelector(".unified-extension-icon");
      
      if (button && icon) {
        const originalTitle = button.getAttribute("title");
        const originalSrc = icon.getAttribute("src");
        
        // Create checkmark SVG with context-fill
        const checkmarkSvg = `data:image/svg+xml;utf8,`
          + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="context-fill" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
               <polyline points="8 17 14 23 24 9"/>
             </svg>`
          );
        
        // Step 1: Fade out with subtle scale down
        icon.style.opacity = "0";
        icon.style.transform = "scale(0.8)";
        
        setTimeout(() => {
          // Step 2: Change to checkmark and update title
          button.setAttribute("title", "URL copied!");
          icon.setAttribute("src", checkmarkSvg);
          
          // Step 3: Fade in with subtle scale up
          icon.style.opacity = "1";
          icon.style.transform = "scale(1.1)";
          
          // Step 4: Settle to normal scale
          setTimeout(() => {
            icon.style.transform = "scale(1)";
          }, 100);
          
        }, 200); // Wait for fade out to complete
        
        // Step 5: Fade back to original after 1.2 seconds
        setTimeout(() => {
          icon.style.opacity = "0";
          icon.style.transform = "scale(0.8)";
          
          setTimeout(() => {
            button.setAttribute("title", originalTitle);
            icon.setAttribute("src", originalSrc);
            icon.style.opacity = "1";
            icon.style.transform = "scale(1)";
          }, 200);
          
        }, 1200);
      }
    } catch (e) {
      console.log("URLBarModifier: Feedback display failed:", e.message);
    }
  }

  closePanelImmediately(unifiedPanel) {
    try {
      console.log("URLBarModifier: closePanelImmediately called with panel:", !!unifiedPanel);
      if (unifiedPanel) {
        // Use Escape key simulation (most reliable method)
        try {
          console.log("URLBarModifier: Simulating Escape key press");
          const escapeEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            bubbles: true,
            cancelable: true
          });
          document.dispatchEvent(escapeEvent);
          console.log("URLBarModifier: Panel closed successfully with Escape key");
        } catch (e) {
          console.log("URLBarModifier: Escape key simulation failed:", e.message);
        }
      } else {
        console.log("URLBarModifier: Panel not found");
      }
    } catch (e) {
      console.log("URLBarModifier: Panel closing failed:", e.message);
    }
  }

  closePanelAfterDelay(unifiedPanel) {
    try {
      console.log("URLBarModifier: closePanelAfterDelay called with panel:", !!unifiedPanel);
      // Close panel with a delay to allow feedback animation to complete
      setTimeout(() => {
        this.closePanelImmediately(unifiedPanel);
      }, 700); // Delay to allow animation to complete before panel closes
    } catch (e) {
      console.log("URLBarModifier: Panel closing failed:", e.message);
    }
  }

  hidePanel() {
    try {
      console.log("URLBarModifier: hidePanel called");
      const unifiedPanel = document.querySelector("#unified-extensions-view");
      if (unifiedPanel && unifiedPanel.hidePopup) {
        unifiedPanel.hidePopup();
        console.log("URLBarModifier: Panel hidden successfully");
      } else {
        console.log("URLBarModifier: Panel not found or hidePopup not available");
      }
    } catch (e) {
      console.log("URLBarModifier: Panel hiding failed:", e.message);
    }
  }

  toggleAutoPiP(event) {
    try {
      // Get current global preference value
      const currentValue = Services.prefs.getBoolPref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled", false);
      const newValue = !currentValue;
      
      // Set the new global preference value
      Services.prefs.setBoolPref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled", newValue);
      
      // Update the toggle state visually
      this.updatePiPToggleState();
      
      console.log(`Auto PiP toggled globally: ${newValue ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error("Error toggling Auto PiP:", err);
    }
  }

  updatePiPToggleState() {
    try {
      const pipButton = document.getElementById("pip-button");
      const pipLabel = document.getElementById('unified-pip-label');

      // Check if element exists, if not, the panel might not be open
      if (!pipButton) {
        console.log("PiP button not found, panel might not be open");
        return;
      }

      // Get current global preference value
      const isEnabled = Services.prefs.getBoolPref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled", false);

      // Slightly darker primary in light mode; keep primary in dark
      // Resolve primary color once; fallback to Firefox blue if missing
      let primary = '';
      try {
        primary = getComputedStyle(document.documentElement)
          .getPropertyValue('--zen-primary-color')
          .trim();
      } catch {}
      if (!primary) primary = '#0a84ff';
      // Use CSS light-dark() over a computed primary color string
      const onColor = `light-dark(color-mix(in srgb, ${primary} 75%, gray), white)`;

      if (isEnabled) {
        pipButton.style.setProperty('background-color', onColor, 'important');
        pipButton.style.opacity = '1';
        pipButton.setAttribute('aria-pressed', 'true');
        pipButton.setAttribute('title', 'Auto PiP enabled globally');
        if (pipLabel) pipLabel.style.opacity = '1';
        try {
          const sub = document.getElementById('unified-pip-sublabel');
          if (sub) sub.textContent = 'Automatic';
        } catch {}
        // Ensure cut-out effect stays panel-colored
        try {
          const icon = pipButton.querySelector('.pip-button-glyph');
          if (icon) icon.style.setProperty('fill', 'var(--arrowpanel-background, var(--panel-background, Canvas))', 'important');
        } catch {}
      } else {
        pipButton.style.setProperty('background-color', 'color-mix(in srgb, currentColor 20%, transparent)', 'important');
        pipButton.style.opacity = '0.9';
        pipButton.setAttribute('aria-pressed', 'false');
        pipButton.setAttribute('title', 'Auto PiP disabled globally');
        if (pipLabel) pipLabel.style.opacity = '0.85';
        try {
          const sub = document.getElementById('unified-pip-sublabel');
          if (sub) sub.textContent = 'Off';
        } catch {}
        // Ensure cut-out effect stays panel-colored
        try {
          const icon = pipButton.querySelector('.pip-button-glyph');
          if (icon) icon.style.setProperty('fill', 'var(--arrowpanel-background, var(--panel-background, Canvas))', 'important');
        } catch {}
      }

      console.log(`Auto PiP state updated globally: ${isEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error("Error updating PiP toggle state:", err);
    }
  }

  modifyPanelPosition() {
    try {
      // Panel positioning is now handled by external CSS file
      // Just modify the panel attributes
      const panel = document.getElementById('unified-extensions-panel');
      if (panel) {
        panel.setAttribute('position', 'bottomcenter topcenter');
        console.log('Panel position attribute modified (CSS loaded from external file)');
      }
    } catch (err) {
      console.error('Error modifying panel position:', err);
    }
  }
}

// Helper function to append XUL elements
const appendXUL = (
  parentElement,
  xulString,
  insertBefore = null,
  XUL = false
) => {
  let element;
  if (XUL) {
    element = window.MozXULElement.parseXULToFragment(xulString);
  } else {
    element = new DOMParser().parseFromString(xulString, "text/html");
    if (element.body.children.length) {
      element = element.body.firstChild;
    } else {
      element = element.head.firstChild;
    }
  }

  element = parentElement.ownerDocument.importNode(element, true);

  if (insertBefore) {
    parentElement.insertBefore(element, insertBefore);
  } else {
    parentElement.appendChild(element);
  }

  return element;
};

// Prevent duplicate execution
if (!window.urlBarModifierInitialized) {
  window.urlBarModifierInitialized = true;

  // Initialize panel manager
  const panelManager = new PanelManager();

  // Make panelManager globally accessible for other scripts
  window.panelManager = panelManager;

  // Listen for tab changes and location changes to update security info in unified panel
  if (typeof gBrowser !== "undefined") {
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      // Small delay to ensure the new tab's URI is loaded
      setTimeout(() => {
        panelManager.updateUnifiedSecurityInfo();
      }, 100);
    });

    // Listen for location changes within the same tab
    gBrowser.addTabsProgressListener({
      onLocationChange: function(browser, webProgress, request, location, flags) {
        if (browser === gBrowser.selectedBrowser) {
          setTimeout(() => {
            panelManager.updateUnifiedSecurityInfo();
          }, 100);
        }
      }
    });
  }

  // No longer need URL bar button - user can use the native unified extensions button

  // Check if panel needs modification when it's shown
  const checkPanelModification = () => {
    const unifiedPanel = document.querySelector("#unified-extensions-view");
    if (unifiedPanel && !panelManager.unifiedPanelModified) {
      console.log("URLBarModifier: Panel needs re-modification, applying changes...");
      setTimeout(() => {
        panelManager.modifyUnifiedExtensionsPanel();
        panelManager.modifyPanelPosition();
        panelManager.updateUnifiedSecurityInfo();
        panelManager.updatePiPToggleState();
      }, 50);
    }
  };

  // Automatically modify the unified extensions panel when it opens
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.id === 'unified-extensions-view') {
            // Panel was opened, modify it
            console.log("URLBarModifier: Panel reopened, re-modifying...");
            setTimeout(() => {
              panelManager.modifyUnifiedExtensionsPanel();
              panelManager.modifyPanelPosition();
              panelManager.updateUnifiedSecurityInfo();
              // Always update PiP state when panel opens
              setTimeout(() => {
                panelManager.updatePiPToggleState();
              }, 100);
            }, 50);
          }
        });
      }
      // Also check for attribute changes that might indicate panel visibility
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.id === 'unified-extensions-panel' || target.id === 'unified-extensions-view') {
          checkPanelModification();
        }
      }
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'hidden', 'class']
  });

  // Also add a periodic check as a fallback
  setInterval(() => {
    checkPanelModification();
  }, 1000);
} else {
  console.log("URLBarModifier: Already initialized, skipping");
}
