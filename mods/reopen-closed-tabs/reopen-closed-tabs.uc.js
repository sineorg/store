// ==UserScript==
// @name            Reopen Closed Tabs
// @description     A popup menu to view and restore recently closed tabs. Includes a toolbar button and keyboard shortcut.
// @author          BibekBhusal
// ==/UserScript==


(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
})((function () { 'use strict';

  const Prefs = {
    DEBUG_MODE: "extensions.reopen-closed-tabs.debug-mode",
    SHORTCUT_KEY: "extensions.reopen-closed-tabs.shortcut-key",
    SHOW_OPEN_TABS: "extensions.reopen-closed-tabs.show-open-tabs",

    defaultValues: {},

    /**
     * Retrieves a preference value.
     * @param {string} key - The preference key.
     * @param {*} [defaultValue=undefined] - The default value to return if the preference is not set.
     * @returns {*} The preference value or the default value.
     */
    getPref(key, defaultValue = undefined) {
      try {
        const pref = UC_API.Prefs.get(key);
        if (!pref) return defaultValue !== undefined ? defaultValue : Prefs.defaultValues[key];
        if (!pref.exists())
          return defaultValue !== undefined ? defaultValue : Prefs.defaultValues[key];
        return pref.value;
      } catch (e) {
        console.error(`ReopenClosedTabs Prefs: Error getting pref ${key}:`, e);
        return defaultValue !== undefined ? defaultValue : Prefs.defaultValues[key];
      }
    },

    setPref(prefKey, value) {
      UC_API.Prefs.set(prefKey, value);
    },

    setInitialPrefs() {
      for (const [key, value] of Object.entries(Prefs.defaultValues)) {
        UC_API.Prefs.setIfUnset(key, value);
      }
    },

    get debugMode() {
      return this.getPref(this.DEBUG_MODE);
    },
    set debugMode(value) {
      this.setPref(this.DEBUG_MODE, value);
    },

    get shortcutKey() {
      return this.getPref(this.SHORTCUT_KEY);
    },
    set shortcutKey(value) {
      this.setPref(this.SHORTCUT_KEY, value);
    },

    get showOpenTabs() {
      return this.getPref(this.SHOW_OPEN_TABS);
    },
    set showOpenTabs(value) {
      this.setPref(this.SHOW_OPEN_TABS, value);
    },
  };

  Prefs.defaultValues = {
    [Prefs.DEBUG_MODE]: false,
    [Prefs.SHORTCUT_KEY]: "Alt+A",
    [Prefs.SHOW_OPEN_TABS]: false,
  };

  const debugLog = (...args) => {
    if (Prefs.debugMode) {
      console.log("ReopenClosedTabs :", ...args);
    }
  };

  const debugError = (...args) => {
    if (Prefs.debugMode) {
      console.error("ReopenClosedTabs :", ...args);
    }
  };

  /**
   * Parses a shortcut string (e.g., "Ctrl+Shift+K") into an object for a <key> element.
   * @param {string} str - The shortcut string.
   * @returns {{key: string|null, keycode: string|null, modifiers: string}}
   */
  function parseShortcutString(str) {
    if (!str) return {};
    const parts = str.split("+").map((p) => p.trim().toLowerCase());
    const keyPart = parts.pop();

    const modifiers = {
      accel: false,
      alt: false,
      shift: false,
      meta: false,
    };

    for (const part of parts) {
      switch (part) {
        case "ctrl":
        case "control":
          modifiers.accel = true;
          break;
        case "alt":
        case "option":
          modifiers.alt = true;
          break;
        case "shift":
          modifiers.shift = true;
          break;
        case "cmd":
        case "meta":
        case "win":
          modifiers.meta = true;
          break;
      }
    }

    // A rough mapping for special keys.
    const KEYCODE_MAP = {
      f1: "VK_F1",
      f2: "VK_F2",
      f3: "VK_F3",
      f4: "VK_F4",
      f5: "VK_F5",
      f6: "VK_F6",
      f7: "VK_F7",
      f8: "VK_F8",
      f9: "VK_F9",
      f10: "VK_F10",
      f11: "VK_F11",
      f12: "VK_F12",
      enter: "VK_RETURN",
      escape: "VK_ESCAPE",
      delete: "VK_DELETE",
      backspace: "VK_BACK",
    };

    const keycode = KEYCODE_MAP[keyPart] || null;
    const key = keycode ? null : keyPart;

    return {
      key: key,
      keycode: keycode,
      modifiers: Object.entries(modifiers)
        .filter(([, val]) => val)
        .map(([mod]) => mod)
        .join(","),
    };
  }

  const parseElement = (elementString, type = "html") => {
    if (type === "xul") {
      return window.MozXULElement.parseXULToFragment(elementString).firstChild;
    }

    let element = new DOMParser().parseFromString(elementString, "text/html");
    if (element.body.children.length) element = element.body.firstChild;
    else element = element.head.firstChild;
    return element;
  };

  const escapeXmlAttribute = (str) => {
    if (typeof str !== "string") return str;
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  function timeAgo(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const seconds = Math.round((now - then) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const weeks = Math.round(days / 7);
    const months = Math.round(days / 30.44);
    const years = Math.round(days / 365.25);

    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds} seconds ago`;
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours < 24) return `${hours} hours ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (weeks === 1) return "1 week ago";
    if (weeks < 4) return `${weeks} weeks ago`;
    if (months === 1) return "1 month ago";
    if (months < 12) return `${months} months ago`;
    if (years === 1) return "1 year ago";
    return `${years} years ago`;
  }

  const TabManager = {
    /**
     * Fetches a list of recently closed tabs.
     * @returns {Promise<Array<object>>} A promise resolving to an array of closed tab data.
     */
    async getRecentlyClosedTabs() {
      debugLog("Fetching recently closed tabs.");
      try {
        if (typeof SessionStore !== "undefined" && SessionStore.getClosedTabData) {
          const closedTabsData = SessionStore.getClosedTabData(window);
          const closedTabs = closedTabsData
            .map((tab, index) => {
              const url = tab.state.entries[0]?.url;
              return {
                url: url,
                title: tab.title || tab.state.entries[0]?.title,
                isClosed: true,
                sessionData: tab,
                sessionIndex: index,
                faviconUrl: tab.image,
                closedAt: tab.closedAt,
              };
            })
            .sort((a, b) => b.closedAt - a.closedAt);
          debugLog("Recently closed tabs fetched:", closedTabs);
          return closedTabs;
        } else {
          debugError("SessionStore.getClosedTabData not available.");
          return [];
        }
      } catch (e) {
        debugError("Error fetching recently closed tabs:", e);
        return [];
      }
    },

    /**
     * Removes a closed tab from the session store.
     * @param {object} tabData - The data of the closed tab to remove, specifically containing sessionIndex.
     */
    removeClosedTab(tabData) {
      debugLog("Removing closed tab from session store:", tabData);
      try {
        if (typeof SessionStore !== "undefined" && SessionStore.forgetClosedTab) {
          SessionStore.forgetClosedTab(window, tabData.sessionIndex);
          debugLog("Closed tab removed successfully.");
        } else {
          debugError("SessionStore.forgetClosedTab not available.");
        }
      } catch (e) {
        debugError("Error removing closed tab:", e);
      }
    },

    _getFolderBreadcrumbs(group) {
      const path = [];
      let currentGroup = group;
      while (currentGroup && currentGroup.isZenFolder) {
        path.unshift(currentGroup.label);
        currentGroup = currentGroup.group;
      }
      return path.join(" / ");
    },

    /**
     * Fetches a list of currently open tabs across all browser windows and workspaces.
     * @returns {Promise<Array<object>>} A promise resolving to an array of open tab data.
     */
    async getOpenTabs() {
      debugLog("Fetching open tabs.");
      const openTabs = [];
      try {
        const workspaceTabs = gZenWorkspaces.allStoredTabs;
        const essentialTabs = Array.from(document.querySelectorAll('tab[zen-essential="true"]'));
        const allTabs = [...new Set([...workspaceTabs, ...essentialTabs])];

        for (const tab of allTabs) {
          if (tab.hasAttribute("zen-empty-tab") || tab.closing) continue;
          const isEssential = tab.hasAttribute("zen-essential");

          const browser = tab.linkedBrowser;
          const win = tab.ownerGlobal;
          const workspaceId = tab.getAttribute("zen-workspace-id");
          const workspace = workspaceId && win.gZenWorkspaces.getWorkspaceFromId(workspaceId);
          const folder = tab.group?.isZenFolder ? this._getFolderBreadcrumbs(tab.group) : null;

          const tabInfo = {
            id: tab.id,
            url: browser.currentURI.spec,
            title: browser.contentTitle || tab.label,
            isPinned: tab.pinned,
            isEssential,
            folder: folder,
            workspace: isEssential ? undefined : workspace?.name,
            isClosed: false,
            faviconUrl: tab.image,
            tabElement: tab,
            lastAccessed: tab._lastAccessed,
          };

          openTabs.push(tabInfo);
        }
        debugLog("Open tabs fetched:", openTabs);
        return openTabs;
      } catch (e) {
        debugError("Error fetching open tabs:", e);
        return [];
      }
    },

    /**
     * Reopens a tab based on its data.
     * If the tab is already open, it switches to it. Otherwise, it opens a new tab.
     * @param {object} tabData - The data of the tab to reopen.
     */
    async reopenTab(tabData) {
      debugLog("Reopening tab:", tabData);
      try {
        // If the tab is already open, switch to it.
        if (!tabData.isClosed && tabData.tabElement) {
          const tab = tabData.tabElement;
          const win = tab.ownerGlobal;
          win.gZenWorkspaces.switchTabIfNeeded(tab);
          return;
        }

        // If it's a closed tab, manually restore it.
        if (tabData.isClosed && tabData.sessionData) {
          const tabState = tabData.sessionData.state;
          const url = tabState.entries[0]?.url;
          if (!url) {
            debugError("Cannot reopen tab: URL not found in session data.", tabData);
            return;
          }

          const newTab = gBrowser.addTab(url, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            userContextId: tabState.userContextId || 0,
            skipAnimation: true,
          });
          gBrowser.selectedTab = newTab;

          // Remove the tab from the closed tabs list after successful reopening
          this.removeClosedTab(tabData);

          const workspaceId = tabState.zenWorkspace;
          const activeWorkspaceId = gZenWorkspaces.activeWorkspace;

          // Switch workspace if necessary
          if (workspaceId && workspaceId !== activeWorkspaceId) {
            await gZenWorkspaces.changeWorkspaceWithID(workspaceId);
            gZenWorkspaces.moveTabToWorkspace(newTab, workspaceId);
          }

          // Pin if it was previously pinned
          if (tabState.pinned) gBrowser.pinTab(newTab);

          // Restore to folder state
          const groupId = tabData.sessionData.closedInTabGroupId;
          if (groupId) {
            const folder = document.getElementById(groupId);
            if (folder && typeof folder.addTabs === "function") {
              folder.addTabs([newTab]);
            }
          }
          gBrowser.selectedTab = newTab;
          return;
        }

        // Fallback for any other case.
        if (tabData.url) {
          const newTab = gBrowser.addTab(tabData.url, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
          gBrowser.selectedTab = newTab;
        } else {
          debugError("Cannot reopen tab: missing URL or session data.", tabData);
        }
      } catch (e) {
        debugError("Error reopening tab:", e);
      }
    },
  };

  const ReopenClosedTabs = {
    _boundToggleMenu: null,
    _boundHandleItemClick: null,
    _allTabsCache: [],
    _registeredHotkey: null,

    /**
     * Initializes the Reopen Closed Tabs mod.
     */
    async init() {
      debugLog("Initializing mod.");
      Prefs.setInitialPrefs();
      this._boundToggleMenu = this.toggleMenu.bind(this);
      this._boundHandleItemClick = this._handleItemClick.bind(this);
      this._registerKeyboardShortcut();
      this._registerToolbarButton();
      UC_API.Prefs.addListener(Prefs.SHORTCUT_KEY, this.onHotkeyChange.bind(this));
      debugLog("Mod initialized.");
    },

    async _registerKeyboardShortcut() {
      const shortcutString = Prefs.shortcutKey;
      if (!shortcutString) {
        debugLog("No shortcut key defined.");
        return;
      }

      const { key, modifiers } = parseShortcutString(shortcutString);
      if (!key) {
        debugError("Invalid shortcut string:", shortcutString);
        return;
      }

      try {
        const translatedModifiers = modifiers.replace(/accel/g, "ctrl").replace(",", " ");

        const hotkey = {
          id: "reopen-closed-tabs-hotkey",
          modifiers: translatedModifiers,
          key: key,
          command: this._boundToggleMenu,
        };
        this._registeredHotkey = await UC_API.Hotkeys.define(hotkey);
        if (this._registeredHotkey) {
          this._registeredHotkey.autoAttach({ suppressOriginal: true });
          debugLog(`Registered shortcut: ${shortcutString}`);
        }
      } catch (e) {
        debugError("Failed to register keyboard shortcut:", e);
      }
    },

    onHotkeyChange() {
      // TODO: Figure out how to apply changes real time (without restart)
      if (window.ucAPI && typeof window.ucAPI.showToast === "function") {
        window.ucAPI.showToast(
          ["Hotkey Changed", "A restart is required for changes to take effect."],
          1 // Restart button preset
        );
      }
    },

    _registerToolbarButton() {
      const buttonId = "reopen-closed-tabs-button";

      try {
        UC_API.Utils.createWidget({
          id: buttonId,
          label: "Reopen Closed Tabs",
          tooltip: "View and reopen recently closed tabs",
          image: "chrome://browser/skin/zen-icons/history.svg",
          type: "toolbarbutton",
          callback: this.toggleMenu.bind(this),
        });
        debugLog(`Registered toolbar button: ${buttonId}`);
      } catch (e) {
        debugError("Failed to register toolbar button:", e);
      }
    },

    async toggleMenu(event) {
      debugLog("Toggle menu called.");
      let button;
      if (event && event.target && event.target.id === "reopen-closed-tabs-button") {
        button = event.target;
      } else {
        // Called from hotkey, find the button in the current window
        button = document.getElementById("reopen-closed-tabs-button");
      }

      if (!button) {
        debugError("Reopen Closed Tabs button not found.");
        return;
      }

      const panelId = "reopen-closed-tabs-panel";

      if (!button._reopenClosedTabsPanel) {
        // Create panel if it doesn't exist for this button
        const panel = parseElement(
          `
        <panel id="${panelId}" type="arrow">
        </panel>
      `,
          "xul"
        );

        const mainPopupSet = document.getElementById("mainPopupSet");
        if (mainPopupSet) {
          mainPopupSet.appendChild(panel);
          button._reopenClosedTabsPanel = panel; // Store panel on the button
          debugLog(`Created panel: ${panelId} for button: ${button.id}`);
        } else {
          debugError("Could not find #mainPopupSet to append panel.");
          return;
        }
      }

      const panel = button._reopenClosedTabsPanel;

      if (panel.state === "open") {
        panel.hidePopup();
      } else {
        await this._populatePanel(panel); // Pass the panel to populate
        panel.openPopup(button, "after_start", 0, 0, false, false);
      }
    },

    async _populatePanel(panel) {
      debugLog("Populating panel.");
      while (panel.firstChild) {
        panel.removeChild(panel.firstChild);
      }

      const mainVbox = parseElement(`<vbox flex="1"/>`, "xul");
      panel.appendChild(mainVbox);

      // Search bar
      const searchBox = parseElement(
        `
      <div id="reopen-closed-tabs-search-container">
        <img src="chrome://global/skin/icons/search-glass.svg" class="search-icon"/>
        <input id="reopen-closed-tabs-search-input" type="search" placeholder="Search tabs..."/>
      </div>
    `,
        "html"
      );
      mainVbox.appendChild(searchBox);

      const allItemsContainer = parseElement(
        `<vbox id="reopen-closed-tabs-list-container" flex="1" />`,
        "xul"
      );
      mainVbox.appendChild(allItemsContainer);

      const closedTabs = await TabManager.getRecentlyClosedTabs();
      const showOpenTabs = Prefs.showOpenTabs;
      let openTabs = [];

      if (showOpenTabs) {
        openTabs = await TabManager.getOpenTabs();
      }

      if (closedTabs.length > 0) {
        this._renderGroup(allItemsContainer, "Recently Closed", closedTabs);
      }

      if (openTabs.length > 0) {
        this._renderGroup(allItemsContainer, "Open Tabs", openTabs);
      }

      if (closedTabs.length === 0 && openTabs.length === 0) {
        const noTabsItem = parseElement(
          `<label class="reopen-closed-tab-item-disabled" value="No tabs to display."/>`,
          "xul"
        );
        allItemsContainer.appendChild(noTabsItem);
      }

      this._allTabsCache = [...closedTabs, ...openTabs];

      const firstItem = allItemsContainer.querySelector(".reopen-closed-tab-item");
      if (firstItem) {
        firstItem.setAttribute("selected", "true");
      }

      const searchInput = panel.querySelector("#reopen-closed-tabs-search-input");
      if (searchInput) {
        searchInput.addEventListener("input", (event) => this._filterTabs(event.target.value, panel));
        searchInput.addEventListener("keydown", (event) => this._handleSearchKeydown(event, panel));
        panel.addEventListener(
          "popupshown",
          () => {
            searchInput.focus();
            const listContainer = panel.querySelector("#reopen-closed-tabs-list-container");
            if (listContainer) {
              listContainer.scrollTop = 0;
            }
          },
          { once: true }
        );
      }
    },

    _renderGroup(container, groupTitle, tabs) {
      const groupHeader = parseElement(
        `
      <hbox class="reopen-closed-tabs-group-header" align="center">
        <label value="${escapeXmlAttribute(groupTitle)}"/>
      </hbox>
    `,
        "xul"
      );
      container.appendChild(groupHeader);

      tabs.forEach((tab) => {
        this._renderTabItem(container, tab);
      });
    },

    _renderTabItem(container, tab) {
      const label = escapeXmlAttribute(tab.title || tab.url || "Untitled Tab");
      const url = escapeXmlAttribute(tab.url || "");
      const faviconSrc = escapeXmlAttribute(tab.faviconUrl || "chrome://branding/content/icon32.png");

      let iconHtml = "";
      if (tab.isEssential) {
        iconHtml = `<image class="tab-status-icon" src="chrome://browser/skin/zen-icons/essential-add.svg" />`;
      } else if (tab.isPinned) {
        iconHtml = `<image class="tab-status-icon" src="chrome://browser/skin/zen-icons/pin.svg" />`;
      }

      let contextParts = [];
      if (tab.isClosed) {
        if (tab.closedAt) {
          contextParts = ["Closed " + timeAgo(tab.closedAt)];
        }
      } else {
        if (tab.lastAccessed) contextParts.push(timeAgo(tab.lastAccessed));
        if (tab.workspace) contextParts.push(escapeXmlAttribute(tab.workspace));
        if (tab.folder) contextParts.push(escapeXmlAttribute(tab.folder));
      }
      const contextLabel = contextParts.join(" ● ");

      const tabItem = parseElement(
        `
      <hbox class="reopen-closed-tab-item" align="center" tooltiptext="${url}">
        <image class="tab-favicon" src="${faviconSrc}" />
        <vbox class="tab-item-labels" flex="1">
          <label class="tab-item-label" value="${label}"/>
          ${contextLabel ? `<label class="tab-item-context" value="${contextLabel}"/>` : ""}
        </vbox>
        <hbox class="tab-item-status-icons" align="center">
          ${iconHtml}
          ${tab.isClosed ? `<image class="close-button" src="chrome://global/skin/icons/close.svg" tooltiptext="Remove from list" />` : ""}
        </hbox>
      </hbox>
    `,
        "xul"
      );

      tabItem.tabData = tab;
      tabItem.addEventListener("click", this._boundHandleItemClick);
      const closeButton = tabItem.querySelector(".close-button");
      if (closeButton) {
        closeButton.addEventListener("click", (event) => this._handleRemoveTabClick(event, tabItem));
      }
      container.appendChild(tabItem);
    },

    _handleRemoveTabClick(event, tabItem) {
      event.stopPropagation();
      if (tabItem && tabItem.tabData && tabItem.tabData.isClosed) {
        TabManager.removeClosedTab(tabItem.tabData);
        tabItem.remove();
        this._allTabsCache = this._allTabsCache.filter((tab) => tab !== tabItem.tabData);
      } else {
        debugError("Cannot remove tab: Tab data not found or tab is not closed.", tabItem);
      }
    },

    _filterTabs(query, panel) {
      const lowerQuery = query.toLowerCase();
      const filteredTabs = this._allTabsCache.filter((tab) => {
        const title = (tab.title || "").toLowerCase();
        const url = (tab.url || "").toLowerCase();
        const workspace = (tab.workspace || "").toLowerCase();
        const folder = (tab.folder || "").toLowerCase();
        return (
          title.includes(lowerQuery) ||
          url.includes(lowerQuery) ||
          workspace.includes(lowerQuery) ||
          folder.includes(lowerQuery)
        );
      });

      const tabItemsContainer = panel.querySelector("#reopen-closed-tabs-list-container");
      if (tabItemsContainer) {
        while (tabItemsContainer.firstChild) {
          tabItemsContainer.removeChild(tabItemsContainer.firstChild);
        }
        if (filteredTabs.length === 0) {
          const noResultsItem = parseElement(
            `<label class="reopen-closed-tab-item-disabled" value="No matching tabs."/>`,
            "xul"
          );
          tabItemsContainer.appendChild(noResultsItem);
        } else {
          // Re-render groups with filtered tabs
          const closedTabs = filteredTabs.filter((t) => t.isClosed);
          const openTabs = filteredTabs.filter((t) => !t.isClosed);

          if (closedTabs.length > 0) {
            this._renderGroup(tabItemsContainer, "Recently Closed", closedTabs);
          }
          if (openTabs.length > 0) {
            this._renderGroup(tabItemsContainer, "Open Tabs", openTabs);
          }

          const firstItem = tabItemsContainer.querySelector(".reopen-closed-tab-item");
          if (firstItem) {
            firstItem.setAttribute("selected", "true");
          }
        }
      }
    },

    _handleSearchKeydown(event, panel) {
      event.stopPropagation();
      const tabItemsContainer = panel.querySelector("#reopen-closed-tabs-list-container");
      if (!tabItemsContainer) return;

      const currentSelected = tabItemsContainer.querySelector(".reopen-closed-tab-item[selected]");
      const allItems = Array.from(tabItemsContainer.querySelectorAll(".reopen-closed-tab-item"));
      let nextSelected = null;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (currentSelected) {
          const currentIndex = allItems.indexOf(currentSelected);
          nextSelected = allItems[currentIndex + 1] || allItems[0];
        } else {
          nextSelected = allItems[0];
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentSelected) {
          const currentIndex = allItems.indexOf(currentSelected);
          nextSelected = allItems[currentIndex - 1] || allItems[allItems.length - 1];
        } else {
          nextSelected = allItems[allItems.length - 1];
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (currentSelected) {
          currentSelected.click();
        }
      }

      if (currentSelected) {
        currentSelected.removeAttribute("selected");
      }
      if (nextSelected) {
        nextSelected.setAttribute("selected", "true");
        nextSelected.scrollIntoView({ block: "nearest" });

        // Adjust scroll position to prevent selected item from being hidden behind sticky group label
        const stickyHeader = tabItemsContainer.querySelector(".reopen-closed-tabs-group-header");
        if (stickyHeader) {
          const stickyHeaderHeight = stickyHeader.offsetHeight;
          const selectedItemRect = nextSelected.getBoundingClientRect();
          const containerRect = tabItemsContainer.getBoundingClientRect();
          if (selectedItemRect.top < containerRect.top + stickyHeaderHeight) {
            tabItemsContainer.scrollTop -=
              containerRect.top + stickyHeaderHeight - selectedItemRect.top;
          }
        }
      }
    },

    _handleItemClick(event) {
      let tabItem = event.target;
      while (tabItem && !tabItem.classList.contains("reopen-closed-tab-item")) {
        tabItem = tabItem.parentElement;
      }

      if (tabItem && tabItem.tabData) {
        TabManager.reopenTab(tabItem.tabData);
        const panel = tabItem.closest("panel");
        if (panel) {
          panel.hidePopup();
        } else {
          debugError("Could not find parent panel to hide.");
        }
      } else {
        debugError("Cannot reopen tab: Tab data not found on menu item.", event.target);
      }
    },
  };

  function setupCommandPaletteIntegration(retryCount = 0) {
    if (window.ZenCommandPalette) {
      debugLog("Integrating with Zen Command Palette...");
      window.ZenCommandPalette.addCommands([
        {
          key: "reopen:closed-tabs-menu",
          label: "Open Reopen closed tab menu",
          command: () => ReopenClosedTabs.toggleMenu(),
          icon: "chrome://browser/skin/zen-icons/history.svg",
          tags: ["reopen", "tabs", "closed"],
        },
      ]);

      debugLog("Zen Command Palette integration successful.");
    } else {
      debugLog("Zen Command Palette not found, retrying in 1000ms");
      if (retryCount < 10) {
        setTimeout(() => setupCommandPaletteIntegration(retryCount + 1), 1000);
      } else {
        debugError("Could not integrate with Zen Command Palette after 10 retries.");
      }
    }
  }

  UC_API.Runtime.startupFinished().then(() => {
    ReopenClosedTabs.init();
    setupCommandPaletteIntegration();
  });

}));
