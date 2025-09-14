(function () {
    'use strict';

    // Configuration preferences
    const QUICK_TABS_THEME_PREF = "extensions.quicktabs.theme";
    const QUICK_TABS_TASKBAR_TRIGGER_PREF = "extensions.quicktabs.taskbar.trigger";
    const QUICK_TABS_ACCESS_KEY_PREF = "extensions.quicktabs.context_menu.access_key";
    const QUICK_TABS_MAX_CONTAINERS_PREF = "extensions.quicktabs.maxContainers";
    const QUICK_TABS_DEFAULT_WIDTH_PREF = "extensions.quicktabs.defaultWidth";
    const QUICK_TABS_DEFAULT_HEIGHT_PREF = "extensions.quicktabs.defaultHeight";
    const QUICK_TABS_TASKBAR_MIN_WIDTH_PREF = "extensions.quicktabs.taskbar.minWidth";
    const QUICK_TABS_ANIMATIONS_ENABLED_PREF = "extensions.quicktabs.animations.enabled";
    const QUICK_TABS_CLOSE_SOURCE_TAB_PREF = "extensions.quicktabs.closeSourceTab";

    // Configuration helper functions
    const getPref = (prefName, defaultValue = "") => {
        try {
            const prefService = Services.prefs;
            if (prefService.prefHasUserValue(prefName)) {
                switch (prefService.getPrefType(prefName)) {
                    case prefService.PREF_STRING:
                        return prefService.getStringPref(prefName);
                    case prefService.PREF_INT:
                        return prefService.getIntPref(prefName);
                    case prefService.PREF_BOOL:
                        return prefService.getBoolPref(prefName);
                }
            }
        } catch (e) {
            console.warn(`QuickTabs: Failed to read preference ${prefName}:`, e);
        }
        return defaultValue;
    };

    const setPref = (prefName, value) => {
        try {
            const prefService = Services.prefs;
            if (typeof value === 'boolean') {
                prefService.setBoolPref(prefName, value);
            } else if (typeof value === 'number') {
                prefService.setIntPref(prefName, value);
            } else {
                prefService.setStringPref(prefName, value);
            }
        } catch (e) {
            console.warn(`QuickTabs: Failed to set preference ${prefName}:`, e);
        }
    };

    // Load configuration
    const THEME = getPref(QUICK_TABS_THEME_PREF, "dark");
    const TASKBAR_TRIGGER = getPref(QUICK_TABS_TASKBAR_TRIGGER_PREF, "hover"); // "click" or "hover"
    const ACCESS_KEY = getPref(QUICK_TABS_ACCESS_KEY_PREF, "T");
    const MAX_CONTAINERS = getPref(QUICK_TABS_MAX_CONTAINERS_PREF, 5);
    const DEFAULT_WIDTH = getPref(QUICK_TABS_DEFAULT_WIDTH_PREF, 450);
    const DEFAULT_HEIGHT = getPref(QUICK_TABS_DEFAULT_HEIGHT_PREF, 500);
    const TASKBAR_MIN_WIDTH = getPref(QUICK_TABS_TASKBAR_MIN_WIDTH_PREF, 200);
    const ANIMATIONS_ENABLED = getPref(QUICK_TABS_ANIMATIONS_ENABLED_PREF, true);
    const CLOSE_SOURCE_TAB = getPref(QUICK_TABS_CLOSE_SOURCE_TAB_PREF, false);
    
    // Global state
    let quickTabContainers = new Map(); // id -> container info
    let nextContainerId = 1;
    let taskbarExpanded = false;
    let commandListenerAdded = false;

    // Quick Tab command state for passing parameters
    let quickTabCommandData = {
        url: '',
        title: '',
        sourceTab: null
    };

    // Utility function to get favicon
    const getFaviconUrl = (url) => {
        try {
            const hostName = new URL(url).hostname;
            return `https://s2.googleusercontent.com/s2/favicons?domain_url=https://${hostName}&sz=16`;
        } catch (e) {
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23666"/><text x="8" y="12" text-anchor="middle" fill="white" font-size="10">T</text></svg>';
        }
    };

    // Utility function to get tab title (borrowed from tidy-tabs.uc.js approach)
    const getTabTitle = (url) => {
        try {
            const parsedUrl = new URL(url);
            let hostname = parsedUrl.hostname.replace(/^www\./, '');
            
            if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
                return hostname;
            } else {
                const pathSegment = parsedUrl.pathname.split('/')[1];
                return pathSegment || 'Quick Tab';
            }
        } catch (e) {
            return 'Quick Tab';
        }
    };

    // Function to get tab data (URL, title) from tab element
    const getTabData = (tab) => {
        if (!tab || !tab.isConnected) {
            return {
                url: '',
                title: 'Quick Tab'
            };
        }
        
        try {
            // Get the browser associated with the tab
            const browser = tab.linkedBrowser || tab._linkedBrowser || gBrowser?.getBrowserForTab?.(tab);
            let url = '';
            let title = '';
            
            // Get URL
            if (browser?.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                url = browser.currentURI.spec;
            }
            
            // Get title using existing function
            title = getTabTitleFromElement(tab);
            
            return {
                url: url || '',
                title: title || 'Quick Tab'
            };
        } catch (e) {
            console.error('QuickTabs: Error getting tab data:', e);
            return {
                url: '',
                title: 'Quick Tab'
            };
        }
    };

    // Function to get proper tab title from tab element
    const getTabTitleFromElement = (tab) => {
        if (!tab || !tab.isConnected) return 'Quick Tab';
        
        try {
            // Method from tidy-tabs.uc.js - try multiple ways to get the title
            const labelFromAttribute = tab.getAttribute('label');
            const labelFromElement = tab.querySelector('.tab-label, .tab-text')?.textContent;
            const browser = tab.linkedBrowser || tab._linkedBrowser || gBrowser?.getBrowserForTab?.(tab);
            
            let title = labelFromAttribute || labelFromElement || '';
            
            // If we have a proper title that's not generic, use it
            if (title && 
                title !== 'New Tab' && 
                title !== 'about:blank' && 
                title !== 'Loading...' && 
                !title.startsWith('http:') && 
                !title.startsWith('https:')) {
                return title.trim();
            }
            
            // Fallback to URL-based title
            if (browser?.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                return getTabTitle(browser.currentURI.spec);
            }
            
            return 'Quick Tab';
        } catch (e) {
            console.error('QuickTabs: Error getting tab title:', e);
            return 'Quick Tab';
        }
    };

    // Function to truncate text with ellipsis
    const truncateText = (text, maxLength = 25) => {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    };

    // CSS injection function
    const injectCSS = () => {
        const existingStyle = document.getElementById('quicktabs-styles');
        if (existingStyle) {
            existingStyle.remove();
        }

        const themes = {
            dark: {
                containerBg: '#1e1f1f',
                containerBorder: '#404040',
                headerBg: '#2a2a2a',
                headerColor: '#e0e0e0',
                buttonBg: 'rgba(255, 255, 255, 0.1)',
                buttonHover: 'rgba(255, 255, 255, 0.2)',
                taskbarBg: '#1a1a1a',
                taskbarBorder: '#333'
            },
            light: {
                containerBg: '#ffffff',
                containerBorder: '#e0e0e0',
                headerBg: '#f0f0f0',
                headerColor: '#333',
                buttonBg: 'rgba(0, 0, 0, 0.1)',
                buttonHover: 'rgba(0, 0, 0, 0.2)',
                taskbarBg: '#f9f9f9',
                taskbarBorder: '#ddd'
            }
        };

        const currentTheme = themes[THEME] || themes.dark;

        const css = `
            /* Quick Tab Container Styles */
            .quicktab-container {
                position: fixed;
                width: ${DEFAULT_WIDTH}px;
                height: ${DEFAULT_HEIGHT}px;
                min-width: 200px;
                min-height: 150px;
                max-width: 80vw;
                max-height: 80vh;
                background-color: ${currentTheme.containerBg};
                border: 1px solid ${currentTheme.containerBorder};
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                z-index: 10000;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                opacity: 0;
                transform: scale(0.8);
            }

            .quicktab-container.visible {
                opacity: 1;
                transform: scale(1);
            }

            .quicktab-container.minimized {
                display: none;
            }

            /* Header Styles */
            .quicktab-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 12px;
                background-color: ${currentTheme.headerBg};
                border-bottom: 1px solid ${currentTheme.containerBorder};
                color: ${currentTheme.headerColor};
                cursor: grab;
                user-select: none;
                border-radius: 8px 8px 0 0;
                min-height: 36px;
            }

            .quicktab-header:active {
                cursor: grabbing;
            }

            .quicktab-favicon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }

            .quicktab-title {
                flex: 1;
                font-size: 13px;
                font-weight: 500;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                min-width: 0;
            }

            .quicktab-button {
                width: 26px;
                height: 26px;
                border: none;
                border-radius: 4px;
                background-color: ${currentTheme.buttonBg};
                color: ${currentTheme.headerColor};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                line-height: 1;
                flex-shrink: 0;
                text-align: center;
                vertical-align: middle;
                padding: 0;
            }

            .quicktab-button img {
                filter: ${THEME === 'dark' ? 'invert(1)' : 'none'};
                opacity: 0.8;
                transition: opacity 0.2s ease;
            }

            .quicktab-button:hover {
                background-color: ${currentTheme.buttonHover};
            }

            .quicktab-button:hover img {
                opacity: 1;
            }

            .quicktab-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .quicktab-button:disabled:hover {
                background-color: ${currentTheme.buttonBg};
            }

            .quicktab-button:disabled img {
                opacity: 0.3;
            }

            .quicktab-title-section {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                min-width: 0;
            }

            .quicktab-button-group {
                display: flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }

            /* Browser content area */
            .quicktab-content {
                flex: 1;
                width: 100%;
                border: none;
                background-color: white;
                overflow: hidden;
            }

            /* Resize handle */
            .quicktab-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 12px;
                height: 12px;
                background: linear-gradient(-45deg, transparent 0%, transparent 30%, ${currentTheme.containerBorder} 30%, ${currentTheme.containerBorder} 100%);
                cursor: se-resize;
                z-index: 10;
            }

            /* Taskbar Styles */
            #quicktabs-taskbar {
                position: fixed;
                bottom: 10px;
                right: 10px;
                background-color: ${currentTheme.taskbarBg};
                border: 1px solid ${currentTheme.taskbarBorder};
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                z-index: 10001;
                min-width: 110px;
                max-width: 300px;
                ${ANIMATIONS_ENABLED ? 'transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);' : ''}
                overflow: hidden;
            }

            #quicktabs-taskbar.collapsed {
                width: auto;
                min-width: 110px;
                height: 40px;
            }



            #quicktabs-taskbar.expanded {
                min-height: 40px;
                min-width: ${TASKBAR_MIN_WIDTH}px;
                width: auto;
                max-height: 300px;
            }

            .quicktabs-taskbar-toggle {
                height: 40px;
                width: auto;
                min-width: 40px;
                padding: 0 8px;
                border: none;
                background: none;
                color: ${currentTheme.headerColor};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-direction: row;
                font-size: 14px;
                flex-shrink: 0;
            }

            .quicktabs-taskbar-toggle:hover {
                background-color: ${currentTheme.buttonHover};
            }

            .quicktabs-taskbar-items {
                display: none;
                flex-direction: column;
                gap: 2px;
                padding: 8px;
                max-height: 200px;
                overflow-y: auto;
            }

            #quicktabs-taskbar.expanded .quicktabs-taskbar-items {
                display: flex;
            }

            .quicktabs-taskbar-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                border-radius: 4px;
                cursor: pointer;
                ${ANIMATIONS_ENABLED ? 'transition: transform 0.1s ease;' : ''}
                min-width: 180px;
                max-width: 250px;
                width: 100%;
                color: ${currentTheme.headerColor};
            }

            .quicktabs-taskbar-item:hover {
                background-color: ${currentTheme.buttonHover};
                ${ANIMATIONS_ENABLED ? 'transform: translateX(3px);' : ''}
            }

            .quicktabs-taskbar-item.minimized {
                opacity: 0.7;
            }

            .quicktabs-taskbar-item .favicon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }

            .quicktabs-taskbar-item .title {
                flex: 1;
                font-size: 12px;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
                min-width: 0;
                max-width: 180px;
            }

            .quicktabs-taskbar-item .close {
                width: 20px;
                height: 20px;
                border: none;
                background: none;
                color: ${currentTheme.headerColor};
                cursor: pointer;
                opacity: 0.6;
                font-size: 14px;
                flex-shrink: 0;
                padding: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .quicktabs-taskbar-item .close img {
                filter: ${THEME === 'dark' ? 'invert(1)' : 'none'};
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .quicktabs-taskbar-item .close:hover {
                opacity: 1;
                background-color: ${currentTheme.buttonHover};
                border-radius: 2px;
            }

            .quicktabs-taskbar-item .close:hover img {
                opacity: 1;
            }


        `;

        const styleElement = document.createElement('style');
        styleElement.id = 'quicktabs-styles';
        styleElement.textContent = css;
        document.head.appendChild(styleElement);
    };

    // Create browser element
    function createBrowserElement() {
        console.log('QuickTabs: Attempting to create XUL browser element...');
        try {
            const browser = document.createXULElement("browser");
            browser.setAttribute("type", "content");
            browser.setAttribute("remote", "true");
            browser.setAttribute("maychangeremoteness", "true");
            browser.setAttribute("disablehistory", "true");
            browser.setAttribute("flex", "1");
            browser.setAttribute("noautohide", "true");
            console.log('QuickTabs: XUL browser element created successfully');
            return browser;
        } catch (e) {
            console.log('QuickTabs: XUL creation failed, trying namespace method:', e.message);
            try {
                const browser = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "browser");
                browser.setAttribute("type", "content");
                browser.setAttribute("remote", "true");
                console.log('QuickTabs: Namespace browser element created successfully');
                return browser;
            } catch (e) {
                console.error('QuickTabs: Both browser creation methods failed:', e.message);
                return null;
            }
        }
    }

    // Load content in browser
    function loadContentInBrowser(browser, url) {
        console.log('QuickTabs: Loading content in browser for URL:', url);
        try {
            const uri = Services.io.newURI(url);
            const principal = Services.scriptSecurityManager.getSystemPrincipal();
            browser.loadURI(uri, {triggeringPrincipal: principal});
            console.log('QuickTabs: Content loaded successfully with principal');
            return true;
        } catch (e) {
            console.log('QuickTabs: Principal loading failed, trying simple loadURI:', e.message);
            try {
                browser.loadURI(url);
                console.log('QuickTabs: Content loaded successfully with simple loadURI');
                return true;
            } catch (e) {
                console.error('QuickTabs: Both loading methods failed:', e.message);
                return false;
            }
        }
    }

    // Create Quick Tab container
    function createQuickTabContainer(url, title = '') {
        console.log('QuickTabs: Creating container for URL:', url);
        if (quickTabContainers.size >= MAX_CONTAINERS) {
            console.warn('QuickTabs: Maximum number of containers reached (', MAX_CONTAINERS, ')');
            // Show user-friendly notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 10000;
                background: #ff6b6b; color: white; padding: 12px 20px;
                border-radius: 6px; font-size: 14px; font-weight: 500;
            `;
            notification.textContent = `Quick Tabs limit reached (${MAX_CONTAINERS})`;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
            return null;
        }

        const containerId = nextContainerId++;
        console.log('QuickTabs: Assigned container ID:', containerId);
        const container = document.createElement('div');
        container.className = 'quicktab-container';
        container.id = `quicktab-${containerId}`;

        // Create header
        const header = document.createElement('div');
        header.className = 'quicktab-header';

        const favicon = document.createElement('img');
        favicon.className = 'quicktab-favicon';
        favicon.src = getFaviconUrl(url);
        favicon.alt = '';

        const titleElement = document.createElement('div');
        titleElement.className = 'quicktab-title';
        const displayTitle = title || getTabTitle(url);
        titleElement.textContent = truncateText(displayTitle, 30);
        titleElement.title = displayTitle; // Full title on hover

        const backButton = document.createElement('button');
        backButton.className = 'quicktab-button';
        const backIcon = document.createElement('img');
        backIcon.src = 'chrome://global/skin/icons/arrow-left.svg';
        backIcon.width = 14;
        backIcon.height = 14;
        backIcon.alt = 'Back';
        backButton.appendChild(backIcon);
        backButton.title = 'Back';

        const forwardButton = document.createElement('button');
        forwardButton.className = 'quicktab-button';
        const forwardIcon = document.createElement('img');
        forwardIcon.src = 'chrome://global/skin/icons/arrow-right.svg';
        forwardIcon.width = 14;
        forwardIcon.height = 14;
        forwardIcon.alt = 'Forward';
        forwardButton.appendChild(forwardIcon);
        forwardButton.title = 'Forward';

        const openInTabButton = document.createElement('button');
        openInTabButton.className = 'quicktab-button';
        const openInTabIcon = document.createElement('img');
        openInTabIcon.src = 'chrome://global/skin/icons/open-in-new.svg';
        openInTabIcon.width = 14;
        openInTabIcon.height = 14;
        openInTabIcon.alt = 'Open in New Tab';
        openInTabButton.appendChild(openInTabIcon);
        openInTabButton.title = 'Open in New Tab';

        const minimizeButton = document.createElement('button');
        minimizeButton.className = 'quicktab-button';
        const minimizeIcon = document.createElement('img');
        minimizeIcon.src = 'chrome://global/skin/icons/minus.svg';
        minimizeIcon.width = 14;
        minimizeIcon.height = 14;
        minimizeIcon.alt = 'Minimize';
        minimizeButton.appendChild(minimizeIcon);
        minimizeButton.title = 'Minimize';

        const closeButton = document.createElement('button');
        closeButton.className = 'quicktab-button';
        const closeIcon = document.createElement('img');
        closeIcon.src = 'chrome://global/skin/icons/close.svg';
        closeIcon.width = 14;
        closeIcon.height = 14;
        closeIcon.alt = 'Close';
        closeButton.appendChild(closeIcon);
        closeButton.title = 'Close';

        // Create title section container
        const titleSection = document.createElement('div');
        titleSection.className = 'quicktab-title-section';
        titleSection.appendChild(favicon);
        titleSection.appendChild(titleElement);

        // Create button group container
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'quicktab-button-group';
        buttonGroup.appendChild(backButton);
        buttonGroup.appendChild(forwardButton);
        buttonGroup.appendChild(openInTabButton);
        buttonGroup.appendChild(minimizeButton);
        buttonGroup.appendChild(closeButton);

        header.appendChild(titleSection);
        header.appendChild(buttonGroup);

        // Create browser content
        console.log('QuickTabs: Creating browser element...');
        const browser = createBrowserElement();
        if (!browser) {
            console.error('QuickTabs: Failed to create browser element');
            return null;
        }
        console.log('QuickTabs: Browser element created successfully');

        browser.className = 'quicktab-content';

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'quicktab-resize-handle';

        // Assemble container
        container.appendChild(header);
        container.appendChild(browser);
        container.appendChild(resizeHandle);

        // Set initial position (centered)
        const centerX = (window.innerWidth - DEFAULT_WIDTH) / 2;
        const centerY = (window.innerHeight - DEFAULT_HEIGHT) / 2;
        container.style.left = `${centerX}px`;
        container.style.top = `${centerY}px`;
        console.log('QuickTabs: Positioning container at center:', {centerX, centerY});

        document.body.appendChild(container);

        // Get proper initial title
        const initialTitle = title || getTabTitle(url);
        
        // Container info object
        const containerInfo = {
            id: containerId,
            element: container,
            browser: browser,
            url: url,
            title: initialTitle,
            favicon: favicon,
            titleElement: titleElement,
            backButton: backButton,
            forwardButton: forwardButton,
            openInTabButton: openInTabButton,
            minimized: false
        };



        // Function to update title and URL from various sources
        const updateContainerTitle = () => {
            try {
                let pageTitle = null;
                let currentUrl = null;
                
                // Get current URL using multiple methods
                try {
                    if (browser.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                        currentUrl = browser.currentURI.spec;
                    } else if (browser.contentDocument?.location?.href && !browser.contentDocument.location.href.startsWith('about:')) {
                        currentUrl = browser.contentDocument.location.href;
                    } else if (browser.contentWindow?.location?.href && !browser.contentWindow.location.href.startsWith('about:')) {
                        currentUrl = browser.contentWindow.location.href;
                    } else if (browser.documentURI?.spec && !browser.documentURI.spec.startsWith('about:')) {
                        currentUrl = browser.documentURI.spec;
                    }
                } catch (urlErr) {
                    console.warn('QuickTabs: Error getting current URL:', urlErr);
                }
                
                // Always use detected URL or fall back to stored URL
                currentUrl = currentUrl || containerInfo.url;
                
                // Update container if URL changed
                if (currentUrl && currentUrl !== containerInfo.url) {
                    containerInfo.url = currentUrl;
                    favicon.src = getFaviconUrl(currentUrl);
                }
                
                // Update back/forward button states
                try {
                    let canGoBack = false;
                    let canGoForward = false;
                    
                    if (browser.webNavigation) {
                        try {
                            canGoBack = browser.webNavigation.canGoBack;
                            canGoForward = browser.webNavigation.canGoForward;
                        } catch (webNavErr) {
                            canGoBack = true;
                            canGoForward = true;
                        }
                    } else {
                        canGoBack = true;
                        canGoForward = true;
                    }
                    
                    backButton.disabled = !canGoBack;
                    forwardButton.disabled = !canGoForward;
                } catch (e) {
                    backButton.disabled = false;
                    forwardButton.disabled = false;
                }
                
                // Try multiple methods to get the page title
                try {
                    if (browser.contentDocument?.title && browser.contentDocument.title.trim() !== '') {
                        pageTitle = browser.contentDocument.title;
                    } else if (browser.contentTitle && browser.contentTitle.trim() !== '') {
                        pageTitle = browser.contentTitle;
                    } else if (browser.contentWindow?.document?.title && browser.contentWindow.document.title.trim() !== '') {
                        pageTitle = browser.contentWindow.document.title;
                    }
                } catch (titleErr) {
                    console.warn('QuickTabs: Error getting page title:', titleErr);
                }
                
                // Process and update title
                let finalTitle = null;
                if (pageTitle && pageTitle.trim() !== '' && pageTitle !== 'Loading...' && 
                    pageTitle !== 'New Tab' && !pageTitle.startsWith('http') && !pageTitle.startsWith('about:')) {
                    finalTitle = pageTitle;
                } else {
                    finalTitle = getTabTitle(currentUrl);
                }
                
                // Update UI if title changed
                if (finalTitle && finalTitle !== containerInfo.title) {
                    titleElement.textContent = truncateText(finalTitle, 30);
                    titleElement.title = finalTitle;
                    containerInfo.title = finalTitle;
                    updateTaskbar();
                }
            } catch (e) {
                console.error('QuickTabs: Error updating title:', e);
            }
        };

        quickTabContainers.set(containerId, containerInfo);

        // Event listeners
        setupContainerEvents(containerInfo);

        // Load content
        console.log('QuickTabs: Loading content in browser...');
        loadContentInBrowser(browser, url);

        // Update page title when DOM title changes
        browser.addEventListener('DOMTitleChanged', () => {
            setTimeout(updateContainerTitle, 100);
        });

        // Update title on page load
        browser.addEventListener('load', () => {
            setTimeout(updateContainerTitle, 200);
            setTimeout(updateContainerTitle, 1000);
            setTimeout(updateContainerTitle, 3000);
        });

        // Update title when page is shown (back/forward navigation)
        browser.addEventListener('pageshow', () => {
            setTimeout(updateContainerTitle, 100);
            setTimeout(updateContainerTitle, 500);
        });

        // Update title when DOM content is loaded
        browser.addEventListener('DOMContentLoaded', () => {
            setTimeout(updateContainerTitle, 100);
            setTimeout(updateContainerTitle, 500);
        });

        // Listen for location changes (URL changes)
        browser.addEventListener('locationchange', () => {
            setTimeout(updateContainerTitle, 100);
            setTimeout(updateContainerTitle, 500);
            setTimeout(updateContainerTitle, 1500);
        });

        // Additional event for when the document finishes loading
        browser.addEventListener('loadend', () => {
            setTimeout(updateContainerTitle, 200);
        });

        // Listen for progress events to catch dynamic title changes
        browser.addEventListener('progress', () => {
            setTimeout(updateContainerTitle, 100);
        });

        // Additional navigation tracking events
        browser.addEventListener('beforeunload', () => {
            setTimeout(updateContainerTitle, 50);
        });

        browser.addEventListener('unload', () => {
            setTimeout(updateContainerTitle, 50);
        });

        browser.addEventListener('pagehide', () => {
            setTimeout(updateContainerTitle, 50);
        });

        browser.addEventListener('focus', () => {
            setTimeout(updateContainerTitle, 100);
        });

        // Listen for any attribute changes on the browser element
        try {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes') {
                        setTimeout(updateContainerTitle, 100);
                    }
                });
            });

            observer.observe(browser, {
                attributes: true,
                attributeFilter: ['src', 'currentURI', 'title']
            });

            containerInfo.mutationObserver = observer;
        } catch (e) {
            console.warn('QuickTabs: Could not create mutation observer:', e);
        }

        // Continuous monitoring
        let lastKnownUrl = containerInfo.url;
        
        const monitoringInterval = setInterval(() => {
            updateContainerTitle();
            
            // Extra check for URL changes that might have been missed
            try {
                let detectedUrl = null;
                if (browser.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                    detectedUrl = browser.currentURI.spec;
                } else if (browser.contentDocument?.location?.href && !browser.contentDocument.location.href.startsWith('about:')) {
                    detectedUrl = browser.contentDocument.location.href;
                }
                
                if (detectedUrl && detectedUrl !== lastKnownUrl) {
                    lastKnownUrl = detectedUrl;
                    setTimeout(updateContainerTitle, 100);
                }
            } catch (e) {
                console.warn('QuickTabs: Error in polling check:', e);
            }
        }, 2000);
        
        containerInfo.monitoringInterval = monitoringInterval;

        // Initial button state update
        setTimeout(() => {
            try {
                let canGoBack = false;
                let canGoForward = false;
                
                // Try multiple methods to check navigation availability
                    if (browser.webNavigation) {
                        try {
                            canGoBack = browser.webNavigation.canGoBack;
                            canGoForward = browser.webNavigation.canGoForward;
                        } catch (webNavErr) {
                            canGoBack = false;
                            canGoForward = false;
                        }
                    } else if (browser.contentDocument?.defaultView?.history) {
                        try {
                            const history = browser.contentDocument.defaultView.history;
                            canGoBack = history.length > 1;
                            canGoForward = false;
                        } catch (histErr) {
                            canGoBack = false;
                            canGoForward = false;
                        }
                    } else {
                        canGoBack = false;
                        canGoForward = false;
                    }
                
                backButton.disabled = !canGoBack;
                forwardButton.disabled = !canGoForward;
            } catch (e) {
                console.warn('QuickTabs: Could not set initial navigation button states:', e);
                // Safe fallback: disable both initially
                backButton.disabled = true;
                forwardButton.disabled = true;
            }
        }, 1000);

        // Show container
        console.log('QuickTabs: Showing container...');
        container.classList.add('visible');

        console.log('QuickTabs: Container created and configured successfully');
        updateTaskbar();
        return containerInfo;
    }

    // Setup container event listeners
    function setupContainerEvents(containerInfo) {
        const { element, titleElement, browser, backButton, forwardButton, openInTabButton } = containerInfo;
        const header = element.querySelector('.quicktab-header');
        const allButtons = element.querySelectorAll('.quicktab-button');
        const minimizeButton = allButtons[3]; // Back, Forward, OpenInTab, Minimize, Close
        const closeButton = allButtons[4];
        const resizeHandle = element.querySelector('.quicktab-resize-handle');

        // Dragging functionality
        let isDragging = false;
        let dragStartX, dragStartY, elementStartX, elementStartY;

        header.addEventListener('mousedown', (e) => {
            if (e.target === backButton || e.target === forwardButton || 
                e.target === openInTabButton || e.target === minimizeButton || 
                e.target === closeButton) return;
            
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            
            const rect = element.getBoundingClientRect();
            elementStartX = rect.left;
            elementStartY = rect.top;
            
            element.style.zIndex = '10002';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;
            
            let newX = elementStartX + deltaX;
            let newY = elementStartY + deltaY;
            
            // Keep within viewport
            newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
            newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));
            
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.zIndex = '10000';
            }
        });

        // Resize functionality
        let isResizing = false;
        let resizeStartX, resizeStartY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            startWidth = element.offsetWidth;
            startHeight = element.offsetHeight;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - resizeStartX;
            const deltaY = e.clientY - resizeStartY;
            
            let newWidth = Math.max(200, startWidth + deltaX);
            let newHeight = Math.max(150, startHeight + deltaY);
            
            // Keep within viewport
            const rect = element.getBoundingClientRect();
            newWidth = Math.min(newWidth, window.innerWidth - rect.left);
            newHeight = Math.min(newHeight, window.innerHeight - rect.top);
            
            element.style.width = `${newWidth}px`;
            element.style.height = `${newHeight}px`;
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });

        // Button events
        backButton.addEventListener('click', (e) => {
            e.stopPropagation();
            let navigationSuccessful = false;
            
            // Method 1: Try webNavigation.goBack()
            if (!navigationSuccessful && browser.webNavigation) {
                try {
                    browser.webNavigation.goBack();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: webNavigation.goBack() failed:', err);
                }
            }
            
            // Method 2: Try history.back()
            if (!navigationSuccessful && browser.contentDocument?.defaultView?.history) {
                try {
                    browser.contentDocument.defaultView.history.back();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: history.back() failed:', err);
                }
            }
            
            // Method 3: Try browser.goBack()
            if (!navigationSuccessful && typeof browser.goBack === 'function') {
                try {
                    browser.goBack();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: browser.goBack() failed:', err);
                }
            }
        });

        forwardButton.addEventListener('click', (e) => {
            e.stopPropagation();
            let navigationSuccessful = false;
            
            // Method 1: Try webNavigation.goForward()
            if (!navigationSuccessful && browser.webNavigation) {
                try {
                    browser.webNavigation.goForward();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: webNavigation.goForward() failed:', err);
                }
            }
            
            // Method 2: Try history.forward()
            if (!navigationSuccessful && browser.contentDocument?.defaultView?.history) {
                try {
                    browser.contentDocument.defaultView.history.forward();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: history.forward() failed:', err);
                }
            }
            
            // Method 3: Try browser.goForward()
            if (!navigationSuccessful && typeof browser.goForward === 'function') {
                try {
                    browser.goForward();
                    navigationSuccessful = true;
                } catch (err) {
                    console.warn('QuickTabs: browser.goForward() failed:', err);
                }
            }
        });

        openInTabButton.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                // Get the actual current URL from the browser using multiple methods
                let currentUrl = containerInfo.url; // Start with stored URL as fallback
                
                // Try to get the current URL from the browser
                try {
                    if (browser.currentURI?.spec && !browser.currentURI.spec.startsWith('about:')) {
                        currentUrl = browser.currentURI.spec;
                    } else if (browser.contentDocument?.location?.href && !browser.contentDocument.location.href.startsWith('about:')) {
                        currentUrl = browser.contentDocument.location.href;
                    } else if (browser.contentWindow?.location?.href && !browser.contentWindow.location.href.startsWith('about:')) {
                        currentUrl = browser.contentWindow.location.href;
                    }
                } catch (urlErr) {
                    console.warn('QuickTabs: Could not get current URL, using stored URL:', urlErr);
                }
                
                if (currentUrl && !currentUrl.startsWith('about:')) {
                    // Create proper principal for the new tab
                    const uri = Services.io.newURI(currentUrl);
                    const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
                    
                    gBrowser.addTab(currentUrl, {
                        triggeringPrincipal: principal,
                        allowInheritPrincipal: false
                    });
                    closeContainer(containerInfo);
                } else {
                    console.warn('QuickTabs: No valid URL to open in new tab, current URL:', currentUrl);
                }
            } catch (err) {
                console.error('QuickTabs: Error opening in new tab:', err);
            }
        });

        minimizeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            minimizeContainer(containerInfo);
        });

        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            closeContainer(containerInfo);
        });

        // Focus handling
        element.addEventListener('mousedown', () => {
            bringToFront(containerInfo);
        });
    }

    // Minimize container
    function minimizeContainer(containerInfo) {
        containerInfo.element.classList.add('minimized');
        containerInfo.minimized = true;
        updateTaskbar();
    }

    // Restore container
    function restoreContainer(containerInfo) {
        containerInfo.element.classList.remove('minimized');
        containerInfo.minimized = false;
        bringToFront(containerInfo);
        updateTaskbar();
    }

    // Close container
    function closeContainer(containerInfo) {
        const container = containerInfo.element;
        container.style.opacity = '0';
        container.style.transform = 'scale(0.8)';
        
        // Clean up monitoring interval
        if (containerInfo.monitoringInterval) {
            clearInterval(containerInfo.monitoringInterval);
        }
        
        // Clean up mutation observer
        if (containerInfo.mutationObserver) {
            containerInfo.mutationObserver.disconnect();
        }
        
        setTimeout(() => {
            container.remove();
            quickTabContainers.delete(containerInfo.id);
            updateTaskbar();
        }, 300);
    }

    // Bring container to front
    function bringToFront(containerInfo) {
        const allContainers = document.querySelectorAll('.quicktab-container');
        allContainers.forEach(container => {
            container.style.zIndex = '10000';
        });
        containerInfo.element.style.zIndex = '10002';
    }

    // Create and manage taskbar
    function createTaskbar() {
        let taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) return taskbar;

        taskbar = document.createElement('div');
        taskbar.id = 'quicktabs-taskbar';
        taskbar.className = 'collapsed';

        const toggle = document.createElement('button');
        toggle.className = 'quicktabs-taskbar-toggle';
        const strokeColor = THEME === 'light' ? '#333' : 'currentColor';
        toggle.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="16" height="16" style="margin-right: 6px;">
                <rect x="10" y="10" width="80" height="80" rx="10" ry="10" fill="none" stroke="${strokeColor}" stroke-width="3"/>
                <line x1="10" y1="30" x2="90" y2="30" stroke="${strokeColor}" stroke-width="3"/>
                <circle cx="81" cy="20" r="4" fill="none" stroke="${strokeColor}" stroke-width="3"/>
                <path d="M 35 70 L 65 40 M 50 40 L 65 40 L 65 55" stroke="${strokeColor}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span style="font-size: 12px; font-weight: 600;">Quick Tabs</span>
        `;
        toggle.title = 'Quick Tabs';

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'quicktabs-taskbar-items';

        taskbar.appendChild(toggle);
        taskbar.appendChild(itemsContainer);
        document.body.appendChild(taskbar);

        // Setup taskbar events
        if (TASKBAR_TRIGGER === 'hover') {
            taskbar.addEventListener('mouseenter', () => expandTaskbar());
            taskbar.addEventListener('mouseleave', () => collapseTaskbar());
        } else {
            toggle.addEventListener('click', () => toggleTaskbar());
        }

        return taskbar;
    }

    function expandTaskbar() {
        const taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) {
            taskbar.classList.remove('collapsed');
            taskbar.classList.add('expanded');
            taskbarExpanded = true;
        }
    }

    function collapseTaskbar() {
        const taskbar = document.getElementById('quicktabs-taskbar');
        if (taskbar) {
            taskbar.classList.remove('expanded');
            taskbar.classList.add('collapsed');
            taskbarExpanded = false;
        }
    }

    function toggleTaskbar() {
        if (taskbarExpanded) {
            collapseTaskbar();
        } else {
            expandTaskbar();
        }
    }

    // Update taskbar contents
    function updateTaskbar() {
        const taskbar = createTaskbar();
        const itemsContainer = taskbar.querySelector('.quicktabs-taskbar-items');
        
        // Clear existing items
        itemsContainer.innerHTML = '';

        if (quickTabContainers.size === 0) {
            taskbar.style.display = 'none';
            return;
        }

        taskbar.style.display = 'block';

        // Add items for each container
        quickTabContainers.forEach((containerInfo) => {
            const item = document.createElement('div');
            item.className = `quicktabs-taskbar-item ${containerInfo.minimized ? 'minimized' : ''}`;

            const favicon = document.createElement('img');
            favicon.className = 'favicon';
            favicon.src = containerInfo.favicon.src;
            favicon.alt = '';

            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = truncateText(containerInfo.title, 25);
            title.title = containerInfo.title; // Full title on hover

            const closeBtn = document.createElement('button');
            closeBtn.className = 'close';
            const closeBtnIcon = document.createElement('img');
            closeBtnIcon.src = 'chrome://global/skin/icons/close.svg';
            closeBtnIcon.width = 10;
            closeBtnIcon.height = 10;
            closeBtnIcon.alt = 'Close';
            closeBtn.appendChild(closeBtnIcon);
            closeBtn.title = 'Close';

            item.appendChild(favicon);
            item.appendChild(title);
            item.appendChild(closeBtn);

            // Event listeners
            item.addEventListener('click', (e) => {
                if (e.target === closeBtn) return;
                
                if (containerInfo.minimized) {
                    restoreContainer(containerInfo);
                } else {
                    bringToFront(containerInfo);
                }
                
                if (TASKBAR_TRIGGER === 'click') {
                    collapseTaskbar();
                }
            });

            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeContainer(containerInfo);
            });

            itemsContainer.appendChild(item);
        });
    }

    // Context menu functionality
    function addContextMenuItem() {
        console.log('QuickTabs: Attempting to add context menu item...');
        const contextMenu = document.getElementById("contentAreaContextMenu");
        if (!contextMenu) {
            console.log('QuickTabs: Context menu not found, retrying in 500ms');
            setTimeout(addContextMenuItem, 500);
            return;
        }

        if (document.getElementById("quicktabs-context-menuitem")) {
            console.log('QuickTabs: Context menu item already exists');
            return;
        }

        const menuItem = document.createXULElement("menuitem");
        menuItem.id = "quicktabs-context-menuitem";
        menuItem.setAttribute("label", "Open Quick Tab");
        menuItem.setAttribute("accesskey", ACCESS_KEY);
        
        menuItem.addEventListener("command", handleContextMenuClick);
        
        // Insert into context-navigation group
        const navigationGroup = contextMenu.querySelector("#context-navigation");
        
        if (navigationGroup) {
            console.log('QuickTabs: Found navigation group, inserting menu item');
            // Insert at the end of the navigation group
            if (navigationGroup.nextSibling) {
                contextMenu.insertBefore(menuItem, navigationGroup.nextSibling);
            } else {
                contextMenu.appendChild(menuItem);
            }
        } else {
            console.log('QuickTabs: Navigation group not found, trying fallback locations');
            // Fallback: try to find other navigation-related items
            const backItem = contextMenu.querySelector("#context-back");
            const forwardItem = contextMenu.querySelector("#context-forward");
            const reloadItem = contextMenu.querySelector("#context-reload");
            
            let insertionPoint = null;
            if (reloadItem) {
                insertionPoint = reloadItem;
                console.log('QuickTabs: Using reload item as insertion point');
            } else if (forwardItem) {
                insertionPoint = forwardItem;
                console.log('QuickTabs: Using forward item as insertion point');
            } else if (backItem) {
                insertionPoint = backItem;
                console.log('QuickTabs: Using back item as insertion point');
            }
            
            if (insertionPoint) {
                if (insertionPoint.nextSibling) {
                    contextMenu.insertBefore(menuItem, insertionPoint.nextSibling);
                } else {
                    contextMenu.appendChild(menuItem);
                }
            } else {
                console.log('QuickTabs: No suitable insertion point found');
                return;
            }
        }

        contextMenu.addEventListener("popupshowing", updateContextMenuVisibility);
        console.log('QuickTabs: Context menu item added successfully');
    }

    function handleContextMenuClick() {
        console.log('QuickTabs: Context menu clicked');
        let linkUrl = "";
        let linkTitle = "";
        
        try {
            if (typeof gContextMenu !== 'undefined' && gContextMenu.linkURL) {
                linkUrl = gContextMenu.linkURL;
                console.log('QuickTabs: Found link URL:', linkUrl);
                
                // Try to get the link text as initial title
                if (gContextMenu.linkTextStr) {
                    linkTitle = gContextMenu.linkTextStr.trim();
                    console.log('QuickTabs: Found link text:', linkTitle);
                } else if (gContextMenu.target) {
                    // Try to get text content from the clicked element
                    linkTitle = gContextMenu.target.textContent?.trim() || 
                               gContextMenu.target.title?.trim() || 
                               gContextMenu.target.alt?.trim() || '';
                    console.log('QuickTabs: Found target text:', linkTitle);
                }
                
                // Clean up the title if it's too long or not useful
                if (linkTitle && linkTitle.length > 50) {
                    linkTitle = linkTitle.substring(0, 47) + '...';
                }
                if (linkTitle && (linkTitle.toLowerCase().includes('http') || linkTitle === linkUrl)) {
                    linkTitle = ''; // Don't use URLs as titles
                }
            } else {
                console.log('QuickTabs: gContextMenu or linkURL not available');
            }
        } catch (e) {
            console.error("QuickTabs: Error getting link URL:", e);
        }
        
        if (linkUrl) {
            console.log('QuickTabs: Creating Quick Tab for:', linkUrl, 'with title:', linkTitle || 'none');
            createQuickTabContainer(linkUrl, linkTitle);
        } else {
            console.log('QuickTabs: No link URL found, cannot create Quick Tab');
        }
    }

    function updateContextMenuVisibility() {
        console.log('QuickTabs: Updating context menu visibility');
        const menuItem = document.getElementById("quicktabs-context-menuitem");
        if (!menuItem) {
            console.log('QuickTabs: Menu item not found for visibility update');
            return;
        }
        
        let hasLink = false;
        
        try {
            if (typeof gContextMenu !== 'undefined') {
                hasLink = gContextMenu.onLink === true;
                console.log('QuickTabs: onLink status:', hasLink);
                if (hasLink && gContextMenu.linkURL) {
                    console.log('QuickTabs: Link URL available:', gContextMenu.linkURL);
                }
            } else {
                console.log('QuickTabs: gContextMenu not available');
            }
        } catch (e) {
            console.error('QuickTabs: Error checking link status:', e);
        }
        
        menuItem.hidden = !hasLink;
        console.log('QuickTabs: Menu item visibility set to:', !hasLink ? 'hidden' : 'visible');
    }

    // Tab context menu functionality
    function addTabContextMenuItem() {
        console.log('QuickTabs: Attempting to add tab context menu item...');
        const tabContextMenu = document.getElementById("tabContextMenu");
        if (!tabContextMenu) {
            console.log('QuickTabs: Tab context menu not found, retrying in 500ms');
            setTimeout(addTabContextMenuItem, 500);
            return;
        }

        if (document.getElementById("quicktabs-tab-context-menuitem")) {
            console.log('QuickTabs: Tab context menu item already exists');
            return;
        }

        const menuItem = document.createXULElement("menuitem");
        menuItem.id = "quicktabs-tab-context-menuitem";
        menuItem.setAttribute("label", "Open in Quick Tab");
        menuItem.setAttribute("accesskey", "Q");
        
        menuItem.addEventListener("command", handleTabContextMenuClick);
        
        // Try to find a good insertion point in the tab context menu
        const separator = tabContextMenu.querySelector("menuseparator");
        const reloadTabItem = tabContextMenu.querySelector("#context_reloadTab");
        const duplicateTabItem = tabContextMenu.querySelector("#context_duplicateTab");
        
        let insertionPoint = null;
        if (duplicateTabItem) {
            insertionPoint = duplicateTabItem;
            console.log('QuickTabs: Using duplicate tab item as insertion point');
        } else if (reloadTabItem) {
            insertionPoint = reloadTabItem;
            console.log('QuickTabs: Using reload tab item as insertion point');
        } else if (separator) {
            insertionPoint = separator;
            console.log('QuickTabs: Using separator as insertion point');
        }
        
        if (insertionPoint) {
            if (insertionPoint.nextSibling) {
                tabContextMenu.insertBefore(menuItem, insertionPoint.nextSibling);
            } else {
                tabContextMenu.appendChild(menuItem);
            }
        } else {
            // Fallback: add at the end
            tabContextMenu.appendChild(menuItem);
            console.log('QuickTabs: Added tab context menu item at the end');
        }

        tabContextMenu.addEventListener("popupshowing", updateTabContextMenuVisibility);
        console.log('QuickTabs: Tab context menu item added successfully');
    }

    function handleTabContextMenuClick() {
        console.log('QuickTabs: Tab context menu clicked');
        
        try {
            // Get the currently right-clicked tab
            let targetTab = null;
            
            // Try multiple methods to get the context tab
            if (typeof TabContextMenu !== 'undefined' && TabContextMenu.contextTab) {
                targetTab = TabContextMenu.contextTab;
                console.log('QuickTabs: Found target tab via TabContextMenu.contextTab');
            } else if (typeof gBrowser !== 'undefined' && gBrowser.selectedTab) {
                targetTab = gBrowser.selectedTab;
                console.log('QuickTabs: Using selected tab as fallback');
            }
            
            if (!targetTab) {
                console.warn('QuickTabs: No target tab found');
                return;
            }

            const tabData = getTabData(targetTab);
            
            if (!tabData.url || tabData.url === 'about:blank') {
                console.warn('QuickTabs: Tab has no valid URL');
                return;
            }

            console.log('QuickTabs: Creating Quick Tab for tab:', tabData.url, 'with title:', tabData.title);
            createQuickTabContainer(tabData.url, tabData.title);
            
            // Close the source tab if configured to do so
            if (CLOSE_SOURCE_TAB) {
                try {
                    console.log('QuickTabs: Closing source tab as configured');
                    gBrowser.removeTab(targetTab);
                } catch (closeError) {
                    console.error('QuickTabs: Error closing source tab:', closeError);
                }
            }
        } catch (e) {
            console.error('QuickTabs: Error handling tab context menu click:', e);
        }
    }

    function updateTabContextMenuVisibility() {
        console.log('QuickTabs: Updating tab context menu visibility');
        const menuItem = document.getElementById("quicktabs-tab-context-menuitem");
        if (!menuItem) {
            console.log('QuickTabs: Tab context menu item not found for visibility update');
            return;
        }
        
        let hasValidTab = false;
        
        try {
            // Check if we have a valid tab to work with
            let targetTab = null;
            
            if (typeof TabContextMenu !== 'undefined' && TabContextMenu.contextTab) {
                targetTab = TabContextMenu.contextTab;
            } else if (typeof gBrowser !== 'undefined' && gBrowser.selectedTab) {
                targetTab = gBrowser.selectedTab;
            }
            
            if (targetTab) {
                const tabData = getTabData(targetTab);
                hasValidTab = tabData.url && !tabData.url.startsWith('about:');
                console.log('QuickTabs: Tab has valid URL:', hasValidTab, 'URL:', tabData.url);
            }
        } catch (e) {
            console.error('QuickTabs: Error checking tab status:', e);
        }
        
        menuItem.hidden = !hasValidTab;
        console.log('QuickTabs: Tab context menu item visibility set to:', !hasValidTab ? 'hidden' : 'visible');
    }

    // Initialization
    function init() {
        console.log('QuickTabs: Starting initialization...');
        console.log('QuickTabs: Configuration:');
        console.log('  Theme:', THEME);
        console.log('  Taskbar Trigger:', TASKBAR_TRIGGER);
        console.log('  Access Key:', ACCESS_KEY);
        console.log('  Max Containers:', MAX_CONTAINERS);
        console.log('  Default Size:', `${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`);
        console.log('  Taskbar Min Width:', TASKBAR_MIN_WIDTH);
        console.log('  Animations Enabled:', ANIMATIONS_ENABLED);
        console.log('  Close Source Tab:', CLOSE_SOURCE_TAB);
        
        injectCSS();
        setupCommands();
        addContextMenuItem();
        addTabContextMenuItem();
        
    }

    // Command setup and handling
    function setupCommands() {
        const zenCommands = document.querySelector("commandset#zenCommandSet");
        if (!zenCommands) {
            console.log('QuickTabs: zenCommandSet not found, retrying in 500ms');
            setTimeout(setupCommands, 500);
            return;
        }

        // Add Quick Tab commands if they don't exist
        if (!zenCommands.querySelector("#cmd_zenOpenQuickTab")) {
            try {
                const commandFragment = window.MozXULElement.parseXULToFragment(`<command id="cmd_zenOpenQuickTab"/>`);
                zenCommands.appendChild(commandFragment.firstChild);
                console.log('QuickTabs: Added cmd_zenOpenQuickTab command');
            } catch (e) {
                console.error('QuickTabs: Error adding cmd_zenOpenQuickTab:', e);
            }
        }

        if (!zenCommands.querySelector("#cmd_zenOpenQuickTabFromCurrent")) {
            try {
                const commandFragment = window.MozXULElement.parseXULToFragment(`<command id="cmd_zenOpenQuickTabFromCurrent"/>`);
                zenCommands.appendChild(commandFragment.firstChild);
                console.log('QuickTabs: Added cmd_zenOpenQuickTabFromCurrent command');
            } catch (e) {
                console.error('QuickTabs: Error adding cmd_zenOpenQuickTabFromCurrent:', e);
            }
        }

        // Add command listener if not already added
        if (!commandListenerAdded) {
            try {
                zenCommands.addEventListener('command', handleQuickTabCommands);
                commandListenerAdded = true;
                console.log('QuickTabs: Command listener added successfully');
            } catch (e) {
                console.error('QuickTabs: Error adding command listener:', e);
            }
        }
    }

    function handleQuickTabCommands(event) {
        try {
            switch (event.target.id) {
                case 'cmd_zenOpenQuickTab':
                    handleOpenQuickTabCommand();
                    break;
                case 'cmd_zenOpenQuickTabFromCurrent':
                    handleOpenQuickTabFromCurrentCommand();
                    break;
            }
        } catch (e) {
            console.error('QuickTabs: Error handling command:', e);
        }
    }

    function handleOpenQuickTabCommand() {
        console.log('QuickTabs: cmd_zenOpenQuickTab triggered');
        
        const url = quickTabCommandData.url || '';
        const title = quickTabCommandData.title || '';
        
        if (!url) {
            console.warn('QuickTabs: No URL provided for Quick Tab');
            return;
        }

        // Reset command data after use
        quickTabCommandData = { url: '', title: '', sourceTab: null };
        
        createQuickTabContainer(url, title);
    }

    function handleOpenQuickTabFromCurrentCommand() {
        console.log('QuickTabs: cmd_zenOpenQuickTabFromCurrent triggered');
        
        try {
            const currentTab = gBrowser.selectedTab;
            if (!currentTab) {
                console.warn('QuickTabs: No current tab selected');
                return;
            }

            const currentTabData = getTabData(currentTab);
            
            if (!currentTabData.url || currentTabData.url === 'about:blank') {
                console.warn('QuickTabs: Current tab has no valid URL');
                return;
            }

            createQuickTabContainer(currentTabData.url, currentTabData.title);
        } catch (e) {
            console.error('QuickTabs: Error opening Quick Tab from current tab:', e);
        }
    }

    // Public API functions for other scripts to use
    window.QuickTabs = {
        // Open a Quick Tab with specified URL and optional title
        openQuickTab: function(url, title = '') {
            if (!url) {
                console.warn('QuickTabs: URL is required');
                return false;
            }
            
            console.log('QuickTabs: API call to open Quick Tab:', url);
            return createQuickTabContainer(url, title);
        },

        // Open a Quick Tab from the current selected tab
        openQuickTabFromCurrent: function() {
            console.log('QuickTabs: API call to open Quick Tab from current tab');
            
            try {
                const currentTab = gBrowser.selectedTab;
                if (!currentTab) {
                    console.warn('QuickTabs: No current tab selected');
                    return false;
                }

                const currentTabData = getTabData(currentTab);
                
                if (!currentTabData.url || currentTabData.url === 'about:blank') {
                    console.warn('QuickTabs: Current tab has no valid URL');
                    return false;
                }

                return createQuickTabContainer(currentTabData.url, currentTabData.title);
            } catch (e) {
                console.error('QuickTabs: Error in API call:', e);
                return false;
            }
        },

        // Trigger command with data (for use by other scripts)
        triggerOpenQuickTab: function(url, title = '') {
            if (!url) {
                console.warn('QuickTabs: URL is required');
                return;
            }
            
            quickTabCommandData.url = url;
            quickTabCommandData.title = title;
            
            // Trigger the command
            const command = document.querySelector('#cmd_zenOpenQuickTab');
            if (command) {
                const event = new Event('command', { bubbles: true });
                command.dispatchEvent(event);
            } else {
                console.warn('QuickTabs: cmd_zenOpenQuickTab command not found');
            }
        },

        // Trigger command for current tab
        triggerOpenQuickTabFromCurrent: function() {
            const command = document.querySelector('#cmd_zenOpenQuickTabFromCurrent');
            if (command) {
                const event = new Event('command', { bubbles: true });
                command.dispatchEvent(event);
            } else {
                console.warn('QuickTabs: cmd_zenOpenQuickTabFromCurrent command not found');
            }
        },

        // Get info about current Quick Tab containers
        getContainerInfo: function() {
            return {
                count: quickTabContainers.size,
                maxContainers: MAX_CONTAINERS,
                containers: Array.from(quickTabContainers.values()).map(info => ({
                    id: info.id,
                    url: info.url,
                    title: info.title,
                    minimized: info.minimized
                }))
            };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }
})();
