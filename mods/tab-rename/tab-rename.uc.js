// ==UserScript==
// @name           Tab Rename
// @version        1.0
// @description    Allow renaming of non-pinned tabs by double-clicking
// @author         Bxth
// @include        main
// ==/UserScript==

(function () {
  if (window.UC_RENAME_TAB_INITIALIZED) return;
  window.UC_RENAME_TAB_INITIALIZED = true;

  // Set to false to disable debug logging
  const DEBUG = false;

  const UC_RENAME_TAB = {
    init: function () {
      if (!window.gZenVerticalTabsManager) {
        if (DEBUG) console.warn("UC_RENAME_TAB: gZenVerticalTabsManager not found, retrying...");
        setTimeout(() => this.init(), 200);
        return;
      }

      if (DEBUG) console.log("UC_RENAME_TAB: Applying rename tab patch");

      // --- Session Restore Logic ---
      const restoreCustomTitle = (tab) => {
        if (!window.SessionStore) {
            if (DEBUG) console.warn("UC_RENAME_TAB: SessionStore not available during restore");
            return;
        }
        try {
          // Skip if it's a pinned tab (handled by Zen native)
          if (tab.pinned || tab.hasAttribute('zen-essential')) return;

          const customTitle = SessionStore.getCustomTabValue(tab, "zen-renamed-title");
          if (DEBUG) console.log(`UC_RENAME_TAB: Checking restore for tab ${tab.dataset.zenTitle || 'unknown'} (pinned: ${tab.pinned}): "${customTitle}"`);
          
          if (customTitle) {
            gBrowser._setTabLabel(tab, customTitle);
            tab.label = customTitle; // Force label update
            tab.setAttribute('zen-has-static-label', 'true');
          } else if (tab.hasAttribute('zen-has-static-label')) {
            // Fallback: If we have the attribute but no title in SessionStore,
            // remove the attribute so the tab can update normally from the page title.
            if (DEBUG) console.warn("UC_RENAME_TAB: Tab has static label attribute but no stored title. Resetting.");
            tab.removeAttribute('zen-has-static-label');
            gBrowser.setTabTitle(tab);
          }
        } catch (e) {
          if (DEBUG) console.error("UC_RENAME_TAB: Error restoring title", e);
        }
      };

      // Listener for tabs restored individually or late
      window.addEventListener("SSTabRestored", (event) => {
          restoreCustomTitle(event.target);
      });

      // Initial check for already open tabs (important for restart persistence)
      const initRestore = async () => {
          if (window.SessionStore) {
              if (window.SessionStore.promiseInitialized) {
                  await window.SessionStore.promiseInitialized;
              }
              if (DEBUG) console.log("UC_RENAME_TAB: SessionStore initialized. Checking existing tabs...");
              Array.from(gBrowser.tabs).forEach(restoreCustomTitle);
          } else {
             if (DEBUG) console.warn("UC_RENAME_TAB: SessionStore not found in initRestore");
          }
      };
      
      // Run initRestore soon
      if (document.readyState === 'complete') {
          initRestore();
      } else {
          window.addEventListener('load', initRestore);
      }

      // --- Override renameTabKeydown for persistence ---
      if (window.gZenVerticalTabsManager.renameTabKeydown) {
        const originalRenameTabKeydown = window.gZenVerticalTabsManager.renameTabKeydown;
        window.gZenVerticalTabsManager.renameTabKeydown = async function(event) {
            if (event.key === 'Enter') {
                const tab = this._tabEdited;
                const input = document.getElementById('tab-label-input');
                const newName = input ? input.value.replace(/\s+/g, ' ').trim() : null;
                
                await originalRenameTabKeydown.call(this, event);
                
                if (tab && !tab.pinned && window.SessionStore) {
                    // Note: originalRenameTabKeydown handles the UI update and zen-has-static-label attribute
                    if (newName) {
                        if (DEBUG) console.log(`UC_RENAME_TAB: Saving title "${newName}" for tab`);
                        SessionStore.setCustomTabValue(tab, "zen-renamed-title", newName);
                    } else {
                        if (DEBUG) console.log("UC_RENAME_TAB: clearing title for tab");
                        SessionStore.deleteCustomTabValue(tab, "zen-renamed-title");
                    }
                }
            } else {
                await originalRenameTabKeydown.call(this, event);
            }
        };
      } else {
        if (DEBUG) console.error("UC_RENAME_TAB: renameTabKeydown not found on gZenVerticalTabsManager");
      }

      // Overwrite the renameTabStart function
      window.gZenVerticalTabsManager.renameTabStart = function (event) {
        const isTab = !!event.target.closest('.tabbrowser-tab');

        // Original checks (prefs and sidebar state)
        if (
          this._tabEdited ||
          ((!Services.prefs.getBoolPref('zen.tabs.rename-tabs') ||
            Services.prefs.getBoolPref('browser.tabs.closeTabByDblclick')) &&
            isTab) ||
          !this._prefsSidebarExpanded // Using 'this' assuming it's bound to the manager
        )
          return;

        this._tabEdited =
          event.target.closest('.tabbrowser-tab') ||
          event.target.closest('.zen-current-workspace-indicator-name') ||
          (event.explicit && event.target.closest('.tab-group-label'));

        // MODIFIED CONDITION:
        // Original: ((!this._tabEdited.pinned || this._tabEdited.hasAttribute('zen-essential')) && isTab)
        // New: Only block if it's an essential tab. Allow both pinned and unpinned.
        if (
          !this._tabEdited ||
          (this._tabEdited.hasAttribute('zen-essential') && isTab)
        ) {
          this._tabEdited = null;
          return;
        }

        gZenFolders.cancelPopupTimer();
        event.stopPropagation?.();
        document.documentElement.setAttribute('zen-renaming-tab', 'true');

        const label = isTab ? this._tabEdited.querySelector('.tab-label-container') : this._tabEdited;
        label.classList.add('tab-label-container-editing');

        if (isTab) {
          const container = window.MozXULElement.parseXULToFragment(`
            <vbox class="tab-label-container tab-editor-container" flex="1" align="start" pack="center"></vbox>
          `);
          label.after(container);
        }

        const input = document.createElement('input');
        input.id = 'tab-label-input';
        input.value = isTab ? this._tabEdited.label : this._tabEdited.textContent;
        input.addEventListener('keydown', this.renameTabKeydown.bind(this));

        if (isTab) {
          const containerHtml = this._tabEdited.querySelector('.tab-editor-container');
          containerHtml.appendChild(input);
        } else {
          this._tabEdited.after(input);
        }

        input.focus();
        input.select();

        input.addEventListener('blur', this._renameTabHalt);
      };
    }
  };

  if (document.readyState === 'complete') {
    UC_RENAME_TAB.init();
  } else {
    window.addEventListener('DOMContentLoaded', () => UC_RENAME_TAB.init());
  }
})();

