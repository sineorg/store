/* ==== Tab groups ==== */
/* https://github.com/Anoms12/Advanced-Tab-Groups */
/* ====== V2.7.0 ====== */

// --- Monkey-patch gBrowser.addTabGroup for nested group support ---
(function patchAddTabGroupForNesting() {
  if (!window.gBrowser || window.gBrowser._zenPatchedAddTabGroup) return;
  const origAddTabGroup = gBrowser.addTabGroup.bind(gBrowser);
  gBrowser.addTabGroup = function(tabs, options = {}) {
    console.log('[ZenGroups] addTabGroup called with tabs:', tabs);
    const groups = Array.from(new Set(tabs.map(tab => tab.group).filter(Boolean)));
    console.log('[ZenGroups] Detected groups for tabs:', groups);
    if (groups.length === 1 && groups[0]) {
      console.log('[ZenGroups] All tabs share the same group, using createNestedGroup');
      if (window.zenGroupsInstance && typeof window.zenGroupsInstance.createNestedGroup === 'function') {
        return window.zenGroupsInstance.createNestedGroup(tabs, groups[0], options);
      }
    }
    return origAddTabGroup(tabs, options);
  };
  gBrowser._zenPatchedAddTabGroup = true;
})();

class ZenGroups {
  #initialized = false;
  #animationState = null;
  #mouseTimer = null;
  #activeGroup = null;
  #iconsPrefName = "mod.zen-groups.icon.emoji";
  // --- Nested group hierarchy: Map<groupId, parentGroupId> ---
  groupHierarchy = new Map();
  tabsListPopup = window.MozXULElement.parseXULToFragment(`
        <panel id="tab-group-tabs-popup" type="arrow" orient="vertical">
        <hbox class="tabs-list-header">
          <image class="tabs-list-icon" src="chrome://global/skin/icons/search-glass.svg"/>
          <html:input id="zen-group-tabs-list-search" placeholder="Search tabs" type="search"/>
        </hbox>
          <scrollbox class="tabs-list-scrollbox" flex="1">
            <vbox id="zen-group-tabs-list" class="panel-list"></vbox>
          </scrollbox>
        </panel>
  `);
  menuPopup = window.MozXULElement.parseXULToFragment(`
    <menupopup id="tab-group-actions-popup">
      <menuitem id="zenGroupsChangeIcon" label="Change Icon" tooltiptext="Change Icon" command="cmd_zenGroupsChangeIcon"/>
      <menuitem id="zenGroupsPinGroup" label="Pin Group" tooltiptext="Pin all tabs in this group"/>
      <menuitem id="zenGroupsUnpinGroup" label="Unpin Group" tooltiptext="Unpin all tabs in this group"/>
      <menuitem id="zenGroupsRenameGroup" label="Rename" tooltiptext="Rename Group" command="cmd_zenGroupsRenameGroup"/>
      <menuitem id="zenGroupsUngroupGroup" label="Ungroup" tooltiptext="Ungroup Group" command="cmd_zenGroupsUngroupGroup"/>
      <menuitem id="zenGroupsDeleteGroup" label="Delete" tooltiptext="Delete Group" command="cmd_zenGroupsDeleteGroup"/>
    </menupopup>
  `);
  folderSVG = new DOMParser().parseFromString(
    `
    <svg width="40px" height="40px" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="-67.409 -14.145 29.279 28.92">
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" x1="-53.05" y1="-3.8" x2="-53.05" y2="8.998" id="gradient-1">
          <stop offset="0" style="stop-color: rgb(255, 255, 255);"/>
          <stop offset="1" style="stop-color: rgb(0% 0% 0%)"/>
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" x1="-40.286" y1="-3.091" x2="-40.286" y2="13.31" id="gradient-0" gradientTransform="matrix(1, 0, 0, 1, -12.717999, -4.409)">
          <stop offset="0" style="stop-color: rgb(255, 255, 255);"/>
          <stop offset="1" style="stop-color: rgb(0% 0% 0%)"/>
        </linearGradient>
      </defs>
    <!--Back Folder (path)-->
      <path d="M -61.3 -5.25 C -61.3 -6.492 -60.293 -7.5 -59.05 -7.5 L -55.102 -7.5 C -54.591 -7.5 -54.096 -7.326 -53.697 -7.007 L -52.84 -6.321 C -52.175 -5.79 -51.349 -5.5 -50.498 -5.5 L -47.05 -5.5 C -45.807 -5.5 -44.8 -4.492 -44.8 -3.25 L -44.731 4.42 L -44.708 6.651 C -44.708 7.894 -45.715 8.901 -46.958 8.901 L -58.958 8.901 C -60.201 8.901 -61.208 7.894 -61.208 6.651 L -61.3 4.752 L -61.3 -5.25 Z" style="stroke-width: 0.5px; transform-box: fill-box; transform-origin: 50% 50%; fill: var(--zen-workspace-color-bg); stroke: var(--zen-workspace-color-stroke);">
        <animateTransform begin="0s" type="skewX" additive="sum" attributeName="transform" values="0;17" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="translate" additive="sum" attributeName="transform" values="0 0;-1 -1.2" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="scale" additive="sum" attributeName="transform" values="1 1;0.95 0.95" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
      </path>
      <path d="M -61.3 -5.25 C -61.3 -6.492 -60.293 -7.5 -59.05 -7.5 L -55.102 -7.5 C -54.591 -7.5 -54.096 -7.326 -53.697 -7.007 L -52.84 -6.321 C -52.175 -5.79 -51.349 -5.5 -50.498 -5.5 L -47.05 -5.5 C -45.807 -5.5 -44.8 -4.492 -44.8 -3.25 L -44.731 4.42 L -44.708 6.651 C -44.708 7.894 -45.715 8.901 -46.958 8.901 L -58.958 8.901 C -60.201 8.901 -61.208 7.894 -61.208 6.651 L -61.3 4.752 L -61.3 -5.25 Z" style="stroke-width: 0.5px; fill-opacity: 0.15; fill: url(&quot;#gradient-0&quot;); transform-origin: -53.004px 0.701px;">
        <animateTransform begin="0s" type="skewX" additive="sum" attributeName="transform" values="0;17" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="translate" additive="sum" attributeName="transform" values="0 0;-1 -1.2" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="scale" additive="sum" attributeName="transform" values="1 1;0.95 0.95" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
      </path>
    <!--Front Folder (rect)-->
      <rect x="-61.301" y="-3.768" width="16.5" height="12.798" rx="2.25" style="stroke-width: 0.5px; transform-box: fill-box; transform-origin: 50% 50%; fill: var(--zen-workspace-color-fg); stroke: var(--zen-workspace-color-stroke);" id="object-0">
        <animateTransform begin="0s" type="skewX" additive="sum" attributeName="transform" values="0;-17" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="translate" additive="sum" attributeName="transform" values="0 0;3 -0.5" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="scale" additive="sum" attributeName="transform" values="1 1;0.9 0.9" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
      </rect>
    <!--Emoji (text)-->
      <text x="-53.051" y="2.631" fill="black" font-size="8" text-anchor="middle" dominant-baseline="middle">
        <animateTransform begin="0s" type="skewX" additive="sum" attributeName="transform" values="0;-17" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="translate" additive="sum" attributeName="transform" values="0 0;-1 0" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="scale" additive="sum" attributeName="transform" values="1 1;0.9 0.9" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        </text>
      <rect x="-61.3" y="-3.8" width="16.5" height="12.798" style="stroke-width: 0.5px; fill-opacity: 0.15; transform-origin: -53.05px 2.599px; fill: url(&quot;#gradient-1&quot;);" id="rect-1" rx="2.25">
        <animateTransform begin="0s" type="skewX" additive="sum" attributeName="transform" values="0;-17" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="translate" additive="sum" attributeName="transform" values="0 0;3 -0.5" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
        <animateTransform begin="0s" type="scale" additive="sum" attributeName="transform" values="1 1;0.9 0.9" dur="0.3s" fill="freeze" keyTimes="0; 1" calcMode="spline" keySplines="0.42 0 0.58 1"/>
      </rect>
    </svg>
    `,
    "image/svg+xml",
  ).documentElement;

  constructor() {
    this.#patchUnload();
    this.#patchGroup();
  }

  #patchUnload() {
    const origUnload = gBrowser.explicitUnloadTabs?.bind(gBrowser);
    if (!origUnload) return;
    gBrowser.explicitUnloadTabs = (tabs) => {
      origUnload(tabs);
      for (const tab of tabs) {
        const group = tab.group;
        if (
          !group ||
          group.hasAttribute("split-view-group") ||
          group.hasAttribute("header")
        ) continue;
        this._hideTab(tab);
        this._watchTabState(tab, () => {
          if (!this._hasSelectedTabs(group) && group.hasAttribute("has-active")) {
            group.removeAttribute("has-active");
            group.removeAttribute("was-collapsed");
            group.collapsed = true;
          }
        });
      }
    };
  }

  #patchGroup() {
    customElements.whenDefined("tab-group").then(() => {
      const ctor = customElements.get("tab-group");
      if (!ctor) return;
      ctor.markup = `
        <hbox class="tab-group-label-container" pack="center">
          <html:div class="tab-group-icon"/>
          <label class="tab-group-label" role="button"/>
          <toolbarbutton class="toolbarbutton-1 tab-group-tabs-button" tooltiptext="Group tabs button"/>
          <toolbarbutton class="toolbarbutton-1 tab-group-action-button" tooltiptext="Group action button"/>
        </hbox>
      `;
    });
  }

  _watchTabState(tab, callback, attributeList = ["pending"]) {
    if (!tab || !callback) return;
    const observer = new MutationObserver(() => {
      observer.disconnect();
      callback(tab);
    });
    observer.observe(tab, {
      attributes: true,
      attributeFilter: attributeList,
    });
  }

  init() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.handlers = new WeakMap();
    this.#initHandlers();

    // --- Context menu integration: 'New Folder' always creates a new folder with an invisible tab ---
    if (!document.getElementById('zen-context-menu-new-folder')) {
      const contextMenuItems = window.MozXULElement.parseXULToFragment(`
        <menuitem id="zen-context-menu-new-folder" label="New Folder"/>
      `);
      const sep = document.getElementById('toolbarNavigatorItemsMenuSeparator') || document.getElementById('tabContextMenu').lastChild;
      sep?.before(contextMenuItems);
    }
    document.getElementById('zen-context-menu-new-folder')?.addEventListener('command', () => {
      this.createFolderWithInvisibleTab();
    });

    // --- Setup initial groups ---
    const groups = this._groups();
    console.log("Setting up initial groups:", groups.length);
    for (const group of groups) {
      this.#setupGroup(group);
    }
  }

  #initHandlers() {
    window.addEventListener("TabAttrModified", this.#onTabGroupAttributeChanged.bind(this));
    window.addEventListener("TabGroupCreate", this.#onTabGroupCreate.bind(this));
    window.addEventListener("TabUngrouped", this.#onTabUngrouped.bind(this));
    window.addEventListener("TabGroupRemoved", this.#onTabGroupRemoved.bind(this));
    window.addEventListener("TabGrouped", this.#onTabGrouped.bind(this));
    window.addEventListener("TabPinned", this.#onTabPinned?.bind(this));
    window.addEventListener("TabUnpinned", this.#onTabUnpinned?.bind(this));
    window.addEventListener("TabGroupExpand", this.#onTabGroupExpand.bind(this));
    window.addEventListener("TabGroupCollapse", this.#onTabGroupCollapse.bind(this));
    gBrowser.tabContainer.addEventListener("TabSelect", this.#handleGlobalTabSelect.bind(this));
  }

  #onTabGroupAttributeChanged(event) {
    const group = event.target;
    if (!group.tagName || group.tagName !== "tabgroup") return;

    const attrName = event.detail.changed[0];
    console.log("Attribute changed:", {
      group: group.id,
      attribute: attrName,
      hasHeader: group.hasAttribute("header"),
      hasSplitView: group.hasAttribute("split-view-group")
    });

    if (attrName === "header" || attrName === "split-view-group") {
      if (group.hasAttribute("header") || group.hasAttribute("split-view-group")) {
        console.log("Removing customizations for filtered group:", group.id);
        this._resetGroupState(group);
        this.#removeGroupIcon(group);
        const handlers = this.handlers.get(group);
        if (handlers) {
          group.removeEventListener("mouseenter", handlers.handleMouseEnter);
          group.removeEventListener("mouseleave", handlers.handleMouseLeave);
          const labelContainer = group.querySelector(".tab-group-label-container");
          if (labelContainer) {
            labelContainer.removeEventListener("click", handlers.handleClick);
          }
          this.handlers.delete(group);
        }
            } else {
        console.log("Re-applying customizations for unfiltered group:", group.id);
        this.#setupGroup(group);
      }
    }
  }

  _groups() {
    const groups = gBrowser.getAllTabGroups();
    console.log("All groups:", groups.length);
    
    const filteredGroups = groups.filter(group => {
      const hasHeader = group.hasAttribute("header");
      const hasSplitView = group.hasAttribute("split-view-group");
      console.log(`Group ${group.id}:`, {
        hasHeader,
        hasSplitView
      });
      return !hasSplitView && !hasHeader;
    });
    
    console.log("Filtered groups:", filteredGroups.length);
    return filteredGroups;
  }

  _resetTabsStyle(group) {
    for (const tab of group.tabs) {
      tab.style.removeProperty("display");
      tab.style.removeProperty("transform");
    }
  }

  _hideTab(tab) {
    tab.style.setProperty("display", "none", "important");
  }

  _hasSelectedTabs(group) {
    return group.tabs.some((tab) => 
      tab.matches("[selected], [visuallyselected], [multiselected]")
    );
  }
  _updateTabVisibility(group) {
    const isHoverOpened = group.hasAttribute("has-focus");

    this._resetTabsStyle(group);

    for (const tab of group.tabs) {
      let shouldBeHidden = false;
      tab.style.setProperty("display", "flex", "important");

      if (isHoverOpened) {
        shouldBeHidden = !tab.matches("[selected], [visuallyselected], [multiselected]");
      }

      if (shouldBeHidden) {
        this._hideTab(tab);
      }
    }
  }

  _resetGroupState(group) {
    const wasCollapsed = group.hasAttribute("was-collapsed");

    group.removeAttribute("was-collapsed");
    group.removeAttribute("has-focus");

    if (wasCollapsed) {
      group.collapsed = true;
    }

    if (group.collapsed) {
      this._resetTabsStyle(group);
    } else {
      this._updateTabVisibility(group);
    }
  }

  _renameGroup() {
    const label = this.#activeGroup.querySelector('.tab-group-label');
    const originalText = label.textContent;
    const input = document.createElement('input');
    input.id = 'tab-group-rename-input';
    input.value = originalText;
    const labelEditing = (saveChanges) => {
      if (saveChanges) {
        const newValue = input.value.trim();
        if (newValue.length > 0 && newValue !== originalText) {
          this.#activeGroup.label = newValue;
        } else {
          label.textContent = originalText;
        }
      } else {
        label.textContent = originalText;
      }
      input.remove();
    };
    input.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'Enter':
          labelEditing(true);
          break;
        case 'Escape':
          labelEditing(false);
          break;
      }
    });
    input.addEventListener('blur', () => {
      labelEditing(false);
    });
    label.textContent = '';
    label.appendChild(input);
    input.focus();
    input.select();
  }

  #setupGroup(group) {
    console.log("Attempting to setup group:", group.id);
    
    if (this.handlers.has(group)) {
      console.log("Group already has handlers:", group.id);
      return;
    }

    if (group.hasAttribute("header") || group.hasAttribute("split-view-group")) {
      console.log("Group has header or split-view-group attribute - skipping setup:", group.id);
      this.#setupGroupObserver(group);
      return;
    }

    this.#setupGroupObserver(group);
    this.#applyGroupCustomizations(group);
  }

  #setupGroupObserver(group) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && 
            (mutation.attributeName === "header" || 
             mutation.attributeName === "split-view-group")) {
          console.log(`Group ${group.id} attribute changed:`, {
            attributeName: mutation.attributeName,
            hasHeader: group.hasAttribute("header"),
            hasSplitView: group.hasAttribute("split-view-group")
          });

          if (group.hasAttribute("header") || group.hasAttribute("split-view-group")) {
            console.log("Removing customizations due to attribute addition");
            this._resetGroupState(group);
            this.#removeGroupIcon(group);
            this.#removeGroupHandlers(group);
          } else {
            console.log("Re-applying customizations due to attribute removal");
            this.#applyGroupCustomizations(group);
          }
        }
      });
    });

    observer.observe(group, {
      attributes: true,
      attributeFilter: ["header", "split-view-group"]
    });
  }

  #applyGroupCustomizations(group) {
    if (group.hasAttribute("header") || group.hasAttribute("split-view-group")) {
      return;
    }
    console.log("Applying customizations to group:", group.id);
    this.#setupFolderIcon(group);
    this.#createGroupButton(group);

    const groupHandlers = {
      handleMouseEnter: this.#handleMouseEnter.bind(this),
      handleMouseLeave: this.#handleMouseLeave.bind(this),
      handleClick: this.#handleClick.bind(this),
    };
    this.handlers.set(group, groupHandlers);

    group.addEventListener("mouseenter", groupHandlers.handleMouseEnter);
    group.addEventListener("mouseleave", groupHandlers.handleMouseLeave);

    const labelContainer = group.querySelector(".tab-group-label-container");
    if (labelContainer) {
      labelContainer.addEventListener("click", groupHandlers.handleClick);
    }
  }

  #removeGroupHandlers(group) {
    const handlers = this.handlers.get(group);
    if (handlers) {
      group.removeEventListener("mouseenter", handlers.handleMouseEnter);
      group.removeEventListener("mouseleave", handlers.handleMouseLeave);
      const labelContainer = group.querySelector(".tab-group-label-container");
      if (labelContainer) {
        labelContainer.removeEventListener("click", handlers.handleClick);
      }
      this.handlers.delete(group);
    }
  }

  #onTabGroupCreate(event) {
    const group = event.target;
    console.log("New group created:", {
      id: group.id,
      hasHeader: group.hasAttribute("header"),
      hasSplitView: group.hasAttribute("split-view-group")
    });

    if (group.hasAttribute("header") || group.hasAttribute("split-view-group")) {
      console.log("Skipping setup for filtered group:", group.id);
      return;
    }

    this.#setupGroup(group);
  }

  #onTabUngrouped(event) {
    const tab = event.detail;
    const group = event.target;
    if (!tab) return;
    tab.style?.removeProperty('visibility');
    tab.style?.removeProperty('z-index');
    tab.style?.removeProperty('margin-top');
    const resetBtn = tab.querySelector?.('.tab-reset-button');
    if (resetBtn) {
      resetBtn.style.removeProperty('display');
    }
    if (group && typeof this.#updateGroupActiveState === 'function') {
      this.#updateGroupActiveState(group);
    }
  }

  #onTabGrouped(event) {
    // TODO: WRITE ME PLZ
  }

  #onTabGroupRemoved(event) {
    const group = event.target;
    this._resetGroupState(group);
    this.#removeGroupIcon(group);
  }
  async #onTabGroupExpand(event) {
    const group = event.target;
    const animations = [];

    animations.push(...this.#handleGroupAnimation(group, this.#animationState));

    await Promise.all(animations);
    this.#animationState = null;
  }
  async #onTabGroupCollapse(event) {
    const group = event.target;
    const animations = [];
    animations.push(...this.#handleGroupAnimation(group, this.#animationState));

    await Promise.all(animations);
    this.#animationState = null;
  }

  #handleMouseEnter(event) {
    const group = event.target;

    if (group.collapsed && this._hasSelectedTabs(group)) {
      this.#mouseTimer = setTimeout(() => {
        group.setAttribute("has-focus", "");
        group.setAttribute("was-collapsed", "");
        this._updateTabVisibility(group);
        group.collapsed = false;
      }, 300);
    }
  }

  #handleMouseLeave(event) {
    const group = event.target;

    clearTimeout(this.#mouseTimer);
    if (this._hasSelectedTabs(group)) {
    this._updateTabVisibility(group);
      } else {
      this._resetGroupState(group);
    }
  }

  #handleClick(event) {
    if (event.button !== 0) return;
    const group = event.currentTarget.parentElement;
    event.stopImmediatePropagation();
    event.preventDefault();

    if (this._hasSelectedTabs(group)) {
      group.toggleAttribute("has-focus");
      group.toggleAttribute("was-collapsed");
      this._updateTabVisibility(group);
      if (
        !group.hasAttribute("was-collapsed") &&
        !group.hasAttribute("has-focus")
      ) {
        this.#animationState = "open";
      } else {
        this.#animationState = "close";
      }
      group.collapsed = false;
      return;
    }

    this._resetGroupState(group);
  }

  #handleGlobalTabSelect(event) {
    const selectedTab = event.target;

    for (const group of this._groups()) {
      if (!group.tabs.includes(selectedTab)) {
        this._resetGroupState(group);
      }
    }
  }

  #setupFolderIcon(group) {
    const labelContainer = group.querySelector(".tab-group-label-container");
    let iconContainer = labelContainer.querySelector(".tab-group-icon");
    if (!iconContainer) {
      const frag = window.MozXULElement.parseXULToFragment('<div class="tab-group-icon"/>' );
      iconContainer = frag.firstElementChild;
      labelContainer.insertBefore(iconContainer, labelContainer.firstChild);
    }
    if (!iconContainer.querySelector("svg")) {
      const svgElem = this.folderSVG.cloneNode(true);
      iconContainer.appendChild(svgElem);
      svgElem
        .querySelectorAll("animate, animateTransform, animateMotion")
        .forEach((anim) => {
          const vals = anim.getAttribute("values");
          if (vals) {
            anim.dataset.origValues = vals;
          }
        });
      const savedIcon = this.#loadGroupIcon(group);
      if (savedIcon) {
        this.#setGroupIconText(group, savedIcon);
      }
      iconContainer.addEventListener("dblclick", (event) => {
        event.stopImmediatePropagation();
        event.preventDefault();
        this.#handleChangeGroupIcon(event, group);
      });
      this.#handleGroupAnimation(group, this.#animationState, false);
    }
  }

  #createGroupButton(group) {
    const labelContainer = group.querySelector(".tab-group-label-container");
    let actionButton = labelContainer.querySelector(".tab-group-action-button");
    if (!actionButton) {
      const frag = window.MozXULElement.parseXULToFragment('<toolbarbutton class="toolbarbutton-1 tab-group-action-button" tooltiptext="Group action button"/>' );
      actionButton = frag.firstElementChild;
      labelContainer.appendChild(actionButton);
    }
    actionButton.addEventListener("click", this.activeGroupPopup.bind(this));
    this.#createGroupButtonPopup(group);
    let tabsButton = labelContainer.querySelector(".tab-group-tabs-button");
    if (!tabsButton) {
      const frag = window.MozXULElement.parseXULToFragment('<toolbarbutton class="toolbarbutton-1 tab-group-tabs-button" tooltiptext="Group tabs button"/>' );
      tabsButton = frag.firstElementChild;
      labelContainer.appendChild(tabsButton);
    }
    tabsButton.addEventListener("click", this.activeGroupTabsPopup.bind(this));
  }

  activeGroupPopup(event) {
    event.stopPropagation();
    const group = event.currentTarget.closest('tab-group');
    this.#activeGroup = group;
    const popup = group._zenGroupActionsPopup || group.querySelector('.tab-group-actions-popup');
    if (!popup) return;
    const target = event.target;
    target.setAttribute("open", "true");
    const handlePopupHidden = (event) => {
      if (event.target !== popup) return;
      target.removeAttribute("open");
      popup.removeEventListener("popuphidden", handlePopupHidden);
    };
    popup.addEventListener("popuphidden", handlePopupHidden);
    try {
      popup.openPopup(event.target, "after_start");
    } catch (e) {
      console.error("Failed to open popup:", e);
    }
  }

  #createGroupButtonPopup(group) {
    // Check if a popup already exists for this group
    let popup = group.querySelector('.tab-group-actions-popup');
    if (!popup) {
      // Clone the menuPopup and append it to the group (scoped to group)
      const frag = this.menuPopup.cloneNode(true);
      popup = frag.firstElementChild;
      popup.classList.add('tab-group-actions-popup');
      group.appendChild(popup);
      console.log('[TabFolders] Created group actions popup for group', group.id);

      // Use popup.querySelector to get the menu items
      const commandButtons = {
        zenGroupsChangeIcon: popup.querySelector("#zenGroupsChangeIcon"),
        zenGroupsPinGroup: popup.querySelector("#zenGroupsPinGroup"),
        zenGroupsUnpinGroup: popup.querySelector("#zenGroupsUnpinGroup"),
        zenGroupsRenameGroup: popup.querySelector("#zenGroupsRenameGroup"),
        zenGroupsUngroupGroup: popup.querySelector("#zenGroupsUngroupGroup"),
        zenGroupsDeleteGroup: popup.querySelector("#zenGroupsDeleteGroup"),
      };

      commandButtons.zenGroupsChangeIcon.addEventListener("click", (event) => {
        const iconElem = group.querySelector('.tab-group-icon');
        this.#handleChangeGroupIcon(event, group, iconElem);
      });
      commandButtons.zenGroupsRenameGroup.addEventListener(
        "click",
        this._renameGroup.bind(this),
      );
      commandButtons.zenGroupsUngroupGroup.addEventListener("click", (event) => {
        console.log("Ungrouping group:", group.id);
        group.ungroupTabs({
          isUserTriggered: true,
        });
      });
      commandButtons.zenGroupsDeleteGroup.addEventListener("click", (event) => {
        console.log("Deleting group:", group.id);
        gBrowser.removeTabGroup(group);
      });
      // Pin Group logic
      commandButtons.zenGroupsPinGroup.addEventListener("click", () => {
        const prevSelectedTab = gBrowser.selectedTab;
        let tabs = Array.from(group.tabs).filter(tab => {
          // Only check for basic validity here; do not reference tabContainer
          const valid = tab && tab.parentNode != null && tab.linkedBrowser && tab.ownerGlobal === window && !tab.hidden && !tab.hasAttribute('data-zen-folder-placeholder');
          if (!valid) {
            console.warn('[TabFolders] Skipping invalid tab for pin:', tab, {
              parentNode: tab?.parentNode,
              linkedBrowser: tab?.linkedBrowser,
              ownerGlobal: tab?.ownerGlobal,
              hidden: tab?.hidden,
              placeholder: tab?.hasAttribute('data-zen-folder-placeholder')
            });
          }
          return valid;
        });
        console.log('[TabFolders] Tabs to pin in group', group.id, tabs);
        if (tabs.length === 0) {
          console.warn('[TabFolders] No valid tabs to pin in group', group.id);
          return;
        }
        // --- Fix: Deselect group tab before pinning to avoid confusion ---
        const allTabs = Array.from(gBrowser.tabs);
        const nonGroupTab = allTabs.find(tab => !tabs.includes(tab) && !tab.hidden && !tab.closing);
        let tempTab = null;
        if (nonGroupTab) {
          gBrowser.selectedTab = nonGroupTab;
        } else {
          // Create a temp tab if all tabs are in the group
          tempTab = gBrowser.addTrustedTab('about:blank', { inBackground: false });
          gBrowser.selectedTab = tempTab;
        }
        // --- End fix ---
        // --- Refactor: Pin all tabs first, then group, like zenViewSpillter.mjs ---
        for (const tab of tabs) {
          if (!tab.pinned) {
            try {
              gBrowser.pinTab(tab);
            } catch (e) {
              console.warn('[TabFolders] Failed to pin tab before grouping:', tab, e);
            }
          }
        }
        setTimeout(() => {
          if (tempTab) {
            gBrowser.removeTab(tempTab);
          }
          const tabContainer = gBrowser.tabContainer.arrowScrollbox || gBrowser.tabContainer;
          // Move tabs out of tab-group if still present
          for (const tab of tabs) {
            const parent = tab?.parentNode;
            if (parent && parent.tagName && parent.tagName.toLowerCase() === 'tab-group') {
              // Try to move to workspace tab section or fallback to tabContainer
              let targetSection = parent.parentNode;
              if (targetSection && targetSection.classList && targetSection.classList.contains('zen-workspace-tabs-section')) {
                targetSection.insertBefore(tab, targetSection.lastChild);
              } else {
                tabContainer.insertBefore(tab, tabContainer.lastChild);
              }
              console.log('[TabFolders] Moved tab out of tab-group for regrouping:', tab);
            }
          }
          let regroupTabs = tabs.filter(tab => {
            const parent = tab?.parentNode;
            const isValidParent = parent === tabContainer || (parent && parent.classList && parent.classList.contains('zen-workspace-tabs-section'));
            const valid = tab && isValidParent && tab.linkedBrowser && tab.ownerGlobal === window && !tab.hidden && !tab.hasAttribute('data-zen-folder-placeholder') && !tab.closing && tab.isConnected;
            if (!valid) {
              console.warn('[TabFolders] Skipping invalid tab for regrouping:', tab, {
                parentNode: tab?.parentNode,
                linkedBrowser: tab?.linkedBrowser,
                ownerGlobal: tab?.ownerGlobal,
                hidden: tab?.hidden,
                placeholder: tab?.hasAttribute('data-zen-folder-placeholder'),
                closing: tab?.closing,
                isConnected: tab?.isConnected
              });
            }
            return valid;
          });
          for (const tab of regroupTabs) {
            if (tab.parentNode !== tabContainer) {
              try {
                tabContainer.insertBefore(tab, tabContainer.lastChild);
                console.log('[TabFolders] Ensured tab is in tabContainer before grouping:', tab);
              } catch (e) {
                console.error('[TabFolders] Failed to insert tab into tabContainer:', tab, e);
              }
            }
          }
          regroupTabs = regroupTabs.filter(tab => tab.parentNode === tabContainer && !tab.closing && tab.isConnected && tab.linkedBrowser);
          if (regroupTabs.length === 0) {
            console.error('[TabFolders] No valid tabs to regroup (pin) in group', group.id, regroupTabs);
            popup.hidePopup();
            return;
          }
          // --- Use split view style group creation ---
          let newGroup = null;
          try {
            if (gBrowser.addTabGroup) {
              newGroup = gBrowser.addTabGroup(regroupTabs, {
                label: group.label || '',
                showCreateUI: false,
                insertBefore: regroupTabs[0],
                forSplitView: false // Not a split view, but matches the style
              });
              console.log('[TabFolders] Created new pinned group (split view style)', newGroup, 'with tabs', regroupTabs);
            } else {
              console.error('[TabFolders] gBrowser.addTabGroup is not available. Cannot create pinned group.');
              return;
            }
          } catch (e) {
            console.error('[TabFolders] Error creating new pinned group:', e);
            return;
          }
          if (group.tabs.length === 0) {
            try {
              gBrowser.removeTabGroup(group);
            } catch (e) {
              console.error('[TabFolders] Error removing old group:', e);
            }
          }
          this.#setupGroup(newGroup);
          // Move the group to the pinned tabs container, like split view
          const pinnedContainer = gBrowser.verticalPinnedTabsContainer;
          if (pinnedContainer && newGroup.parentNode !== pinnedContainer) {
            pinnedContainer.insertBefore(newGroup, pinnedContainer.lastChild);
            console.log('[TabFolders] Moved new group to pinned tabs container:', newGroup);
          }
          // Invalidate tab cache and select first tab to ensure interactivity
          gBrowser.tabContainer._invalidateCachedTabs();
          // Only select a tab in the new group if the user was already on a tab in that group
          if (newGroup.tabs && newGroup.tabs.length > 0) {
            if (Array.from(newGroup.tabs).includes(prevSelectedTab)) {
              gBrowser.selectedTab = prevSelectedTab;
            }
          }
          const allPinned = newGroup.tabs.length > 0 && newGroup.tabs.every(tab => tab.pinned);
          commandButtons.zenGroupsPinGroup.hidden = allPinned;
          commandButtons.zenGroupsUnpinGroup.hidden = !allPinned;
          popup.hidePopup();
          setTimeout(() => {
            popup.openPopup(newGroup.querySelector('.tab-group-action-button'), "after_start");
          }, 150);
        }, 0);
      });
      // Unpin Group logic
      commandButtons.zenGroupsUnpinGroup.addEventListener("click", () => {
        const prevSelectedTab = gBrowser.selectedTab;
        let tabs = Array.from(group.tabs).filter(tab => {
          const valid = tab && tab.parentNode != null && tab.linkedBrowser && tab.ownerGlobal === window && !tab.hidden && !tab.hasAttribute('data-zen-folder-placeholder');
          if (!valid) {
            console.warn('[TabFolders] Skipping invalid tab for unpin:', tab, {
              parentNode: tab?.parentNode,
              linkedBrowser: tab?.linkedBrowser,
              ownerGlobal: tab?.ownerGlobal,
              hidden: tab?.hidden,
              placeholder: tab?.hasAttribute('data-zen-folder-placeholder')
            });
          }
          return valid;
        });
        console.log('[TabFolders] Tabs to unpin in group', group.id, tabs);
        if (tabs.length === 0) {
          console.warn('[TabFolders] No valid tabs to unpin in group', group.id);
          return;
        }
        // --- Fix: Deselect group tab before unpinning to avoid confusion ---
        const allTabs = Array.from(gBrowser.tabs);
        const nonGroupTab = allTabs.find(tab => !tabs.includes(tab) && !tab.hidden && !tab.closing);
        let tempTab = null;
        if (nonGroupTab) {
          gBrowser.selectedTab = nonGroupTab;
        } else {
          tempTab = gBrowser.addTrustedTab('about:blank', { inBackground: false });
          gBrowser.selectedTab = tempTab;
        }
        // --- End fix ---
        // Unpin all tabs
        for (const tab of tabs) {
          if (tab.pinned) {
            try {
              gBrowser.unpinTab(tab);
            } catch (e) {
              console.warn('[TabFolders] Failed to unpin tab before regrouping:', tab, e);
            }
          }
        }
        setTimeout(() => {
          if (tempTab) {
            gBrowser.removeTab(tempTab);
          }
          const tabContainer = gBrowser.tabContainer.arrowScrollbox || gBrowser.tabContainer;
          // Move tabs out of tab-group if still present
          for (const tab of tabs) {
            const parent = tab?.parentNode;
            if (parent && parent.tagName && parent.tagName.toLowerCase() === 'tab-group') {
              let targetSection = parent.parentNode;
              if (targetSection && targetSection.classList && targetSection.classList.contains('zen-workspace-tabs-section')) {
                targetSection.insertBefore(tab, targetSection.lastChild);
              } else {
                tabContainer.insertBefore(tab, tabContainer.lastChild);
              }
              console.log('[TabFolders] Moved tab out of tab-group for regrouping:', tab);
            }
          }
          let regroupTabs = tabs.filter(tab => {
            const parent = tab?.parentNode;
            const isValidParent = parent === tabContainer || (parent && parent.classList && parent.classList.contains('zen-workspace-tabs-section'));
            const valid = tab && isValidParent && tab.linkedBrowser && tab.ownerGlobal === window && !tab.hidden && !tab.hasAttribute('data-zen-folder-placeholder') && !tab.closing && tab.isConnected;
            if (!valid) {
              console.warn('[TabFolders] Skipping invalid tab for regrouping:', tab, {
                parentNode: tab?.parentNode,
                linkedBrowser: tab?.linkedBrowser,
                ownerGlobal: tab?.ownerGlobal,
                hidden: tab?.hidden,
                placeholder: tab?.hasAttribute('data-zen-folder-placeholder'),
                closing: tab?.closing,
                isConnected: tab?.isConnected
              });
            }
            return valid;
          });
          for (const tab of regroupTabs) {
            if (tab.parentNode !== tabContainer) {
              try {
                tabContainer.insertBefore(tab, tabContainer.lastChild);
                console.log('[TabFolders] Ensured tab is in tabContainer before grouping:', tab);
              } catch (e) {
                console.error('[TabFolders] Failed to insert tab into tabContainer:', tab, e);
              }
            }
          }
          regroupTabs = regroupTabs.filter(tab => tab.parentNode === tabContainer && !tab.closing && tab.isConnected && tab.linkedBrowser);
          if (regroupTabs.length === 0) {
            console.error('[TabFolders] No valid tabs to regroup (unpin) in group', group.id, regroupTabs);
            popup.hidePopup();
            return;
          }
          // --- Use split view style group creation for unpinned group ---
          let newGroup = null;
          try {
            if (gBrowser.addTabGroup) {
              newGroup = gBrowser.addTabGroup(regroupTabs, {
                label: group.label || '',
                showCreateUI: false,
                insertBefore: regroupTabs[0],
                forSplitView: false
              });
              console.log('[TabFolders] Created new unpinned group (split view style)', newGroup, 'with tabs', regroupTabs);
            } else {
              console.error('[TabFolders] gBrowser.addTabGroup is not available. Cannot create unpinned group.');
              return;
            }
          } catch (e) {
            console.error('[TabFolders] Error creating new unpinned group:', e);
            return;
          }
          if (group.tabs.length === 0) {
            try {
              gBrowser.removeTabGroup(group);
            } catch (e) {
              console.error('[TabFolders] Error removing old group:', e);
            }
          }
          this.#setupGroup(newGroup);
          // Move the group to the current workspace's normal tabs section
          const currentWorkspaceId = gZenWorkspaces.activeWorkspace;
          const workspaceContainer = gZenWorkspaces.workspaceElement(currentWorkspaceId);
          const normalTabsSection = workspaceContainer?.tabsContainer;
          // Set workspace ID on each tab
          for (const tab of newGroup.tabs) {
            tab.setAttribute('zen-workspace-id', currentWorkspaceId);
          }
          if (normalTabsSection && newGroup.parentNode !== normalTabsSection) {
            normalTabsSection.insertBefore(newGroup, normalTabsSection.lastChild);
            console.log('[TabFolders] Moved new group to workspace normal tabs section:', newGroup);
          } else if (newGroup.parentNode !== gBrowser.tabContainer) {
            gBrowser.tabContainer.insertBefore(newGroup, gBrowser.tabContainer.lastChild);
            console.log('[TabFolders] Fallback: moved new group to global tab container:', newGroup);
          }
          // Invalidate tab cache and select first tab to ensure interactivity
          gBrowser.tabContainer._invalidateCachedTabs();
          // Only select a tab in the new group if the user was already on a tab in that group
          if (newGroup.tabs && newGroup.tabs.length > 0) {
            if (Array.from(newGroup.tabs).includes(prevSelectedTab)) {
              gBrowser.selectedTab = prevSelectedTab;
            }
          }
          const allPinned = newGroup.tabs.length > 0 && newGroup.tabs.every(tab => tab.pinned);
          commandButtons.zenGroupsPinGroup.hidden = allPinned;
          commandButtons.zenGroupsUnpinGroup.hidden = !allPinned;
          popup.hidePopup();
          setTimeout(() => {
            popup.openPopup(newGroup.querySelector('.tab-group-action-button'), "after_start");
          }, 150);
        }, 0);
      });
      // Show only the relevant menu item depending on group state
      popup.addEventListener('popupshowing', () => {
        const tabs = group.tabs;
        const allPinned = tabs.length > 0 && tabs.every(tab => tab.pinned);
        commandButtons.zenGroupsPinGroup.hidden = allPinned;
        commandButtons.zenGroupsUnpinGroup.hidden = !allPinned;
        console.log('[TabFolders] Pin/Unpin menu visibility updated for group', group.id, 'allPinned:', allPinned);
      }); 
    } else {
      console.log('[TabFolders] Group actions popup already exists for group', group.id);
    }
    // Store a reference for later use
    group._zenGroupActionsPopup = popup;
  }

  #setGroupIconText(group, text) {
    const svgText = group.querySelector(".tab-group-icon svg text");
    if (!svgText) return;

    let textNode = null;
    for (const node of svgText.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        textNode = node;
        break;
      }
    }

    if (textNode) {
      textNode.nodeValue = text;
    } else {
      const newTextNode = document.createTextNode(text);
      svgText.insertBefore(newTextNode, svgText.firstChild);
    }
  }

  #handleChangeGroupIcon(event, group, iconElem) {
    if (!group) {
      return;
    }
    if (!iconElem) {
      iconElem = group.querySelector('.tab-group-icon');
    }
    gZenEmojiPicker
      .open(iconElem)
      .then(async (emoji) => {
        console.log("Selected emoji:", emoji);
        this.#setGroupIconText(group, emoji);
        await this.#saveGroupIcon(group, emoji);
      })
      .catch((error) => {
        return;
      });
  }

  #handleGroupAnimation(group, state, playAnimation = true) {
    const svgElement = group.querySelector("svg");
    if (!svgElement) return [];

    const isCollapsed = group.collapsed;

    svgElement.unpauseAnimations();

    if (!playAnimation) {
      svgElement.pauseAnimations();

      switch (state) {
        case "open":
          svgElement.setCurrentTime(0.3);
          break;
        case "close":
          svgElement.setCurrentTime(0);
          break;
        default:
          svgElement.setCurrentTime(isCollapsed ? 0 : 0.3);
          break;
      }
      return [];
    }

    const animations = svgElement.querySelectorAll(
      "animate, animateTransform, animateMotion",
    );

    animations.forEach((anim) => {
      const origValues = anim.dataset.origValues;
      const [fromVal, toVal] = origValues.split(";");

      let newValues;

      switch (state) {
        case "open":
          newValues = `${fromVal};${toVal}`;
          break;
        case "close":
          newValues = `${toVal};${fromVal}`;
          break;
        default:
          newValues = isCollapsed
            ? `${toVal};${fromVal}`
            : `${fromVal};${toVal}`;
          break;
      }

      anim.setAttribute("values", newValues);
      anim.beginElement();
    });
    return [];
  }

  #getAllIconsObject() {
    try {
      const jsonString = Services.prefs.getStringPref(this.#iconsPrefName);
      return jsonString ? JSON.parse(jsonString) : {};
    } catch (e) {
      return {};
    }
  }

  async #saveGroupIcon(group, emoji) {
    try {
      const allIcons = this.#getAllIconsObject();
      allIcons[group.id] = emoji;
      const newJsonString = JSON.stringify(allIcons);
      Services.prefs.setStringPref(this.#iconsPrefName, newJsonString);
    } catch (e) {
      console.error("Failed to save group icons JSON:", e);
    }
  }

  #removeGroupIcon(group) {
    console.log("Removing group icon for:", group.id);
    const iconContainer = group.querySelector(".tab-group-icon");
    if (iconContainer) {
      iconContainer.remove();
    }
    
    const button = group.querySelector(".tab-group-button");
    if (button) {
      button.remove();
    }

    try {
      const allIcons = this.#getAllIconsObject();
      delete allIcons[group.id];
      const newJsonString = JSON.stringify(allIcons);
      Services.prefs.setStringPref(this.#iconsPrefName, newJsonString);
    } catch (e) {
      console.error("Failed to remove group icon from prefs:", e);
    }
  }

  #loadGroupIcon(group) {
    const allIcons = this.#getAllIconsObject();
    return allIcons[group.id] || "";
  }

  #formatRelativeTime(timestamp) {
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);
    if (seconds < 60) {
      return "Just now";
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  #populateTabsList(group, popup) {
    const tabsList = popup.querySelector("#zen-group-tabs-list");
    tabsList.replaceChildren();
    for (const tab of group.tabs) {
      if (tab.hidden) continue;
      const item = document.createElement("div");
      item.className = "tabs-list-item";
      const background = document.createElement("div");
      background.className = "tabs-list-item-background";
      const content = document.createElement("div");
      content.className = "tabs-list-item-content";
      const icon = document.createElement("img");
      icon.className = "tabs-list-item-icon";
      let iconURL =
        gBrowser.getIcon(tab) ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3C/svg%3E";
      if (iconURL) {
        icon.src = iconURL;
      }
      icon.className = "tabs-list-item-icon";
      if (iconURL) {
        icon.src = iconURL;
      }
      const labelsContainer = document.createElement("div");
      labelsContainer.className = "tabs-list-item-labels";
      const mainLabel = document.createElement("div");
      mainLabel.className = "tabs-list-item-label";
      mainLabel.textContent = tab.label;
      const secondaryLabel = document.createElement("div");
      secondaryLabel.className = "tab-list-item-secondary-label";
      secondaryLabel.textContent = this.#formatRelativeTime(tab.lastAccessed);
      labelsContainer.append(mainLabel, secondaryLabel);
      content.append(icon, labelsContainer);
      item.append(background, content);
      if (tab.selected) {
        item.setAttribute("selected", "true");
      }
      // Get tab URL for search functionality
      const tabUrl = tab.linkedBrowser?.currentURI?.spec || '';
      console.log("Tab URL for item:", tabUrl);
      item.setAttribute("data-label", `${tab.label.toLowerCase()} ${tabUrl.toLowerCase()}`);
      item.addEventListener("click", () => {
        gBrowser.selectedTab = tab;
        popup.hidePopup();
      });
      tabsList.appendChild(item);
    }
  }

  #createGroupTabsPopup() {
    if (document.getElementById("tab-group-tabs-popup")) return;
    const frag = this.tabsListPopup.cloneNode(true);
    document.querySelector("#mainPopupSet").appendChild(frag.firstElementChild);
  }

  activeGroupTabsPopup(event) {
    event.stopPropagation();
    this.#activeGroup = event.currentTarget.closest("tab-group");
    let popup = document.getElementById("tab-group-tabs-popup");
    if (!popup) {
      this.#createGroupTabsPopup();
      popup = document.getElementById("tab-group-tabs-popup");
    }
    this.#populateTabsList(this.#activeGroup, popup);
    const search = popup.querySelector("#zen-group-tabs-list-search");
    search.placeholder = `Search ${this.#activeGroup.name || ''}...`;
    const tabsList = popup.querySelector("#zen-group-tabs-list");
    search.addEventListener("input", () => {
      const query = search.value.toLowerCase();
      for (const item of tabsList.children) {
        item.hidden = !item.getAttribute("data-label").includes(query);
      }
    });
    const target = event.currentTarget;
    target.setAttribute("open", "true");
    const handlePopupHidden = (e) => {
      if (e.target !== popup) return;
      search.value = "";
      target.removeAttribute("open");
      popup.removeEventListener("popuphidden", handlePopupHidden);
    };
    popup.addEventListener("popuphidden", handlePopupHidden);
    popup.openPopup(target, "after_start");
  }

  _hasActiveTabs(group) {
    return group.tabs.some(tab => !tab.hasAttribute('pending'));
  }

  _updateTabs(group) {
    const hasActive = group.hasAttribute('has-active');
    this._resetTabsStyle(group);
    for (const tab of group.tabs) {
      const resetButton = tab.querySelector('.tab-reset-button');
      let shouldBeHidden = false;
      if (hasActive) {
        shouldBeHidden = tab.hasAttribute('pending');
      }
      if (shouldBeHidden) {
        tab.style.setProperty('visibility', 'collapse');
      } else if (hasActive) {
        resetButton.style.display = 'block';
      }
    }
  }

  #updateGroupActiveState(group) {
    if (!group || !group.isConnected) {
      if (group?._zenTabObserver) {
        group._zenTabObserver.disconnect();
      }
      return;
    }
    const hasActiveTabs = this._hasActiveTabs(group);
    const currentlyHasActiveAttr = group.hasAttribute('has-active');
    if (!hasActiveTabs && currentlyHasActiveAttr) {
      if (!group.tabs.some(t => t.selected)) {
        group.collapsed = true;
      }
      group.removeAttribute('has-active');
    }
  }

  // Always create a new folder with an invisible tab, using Firefox's tab group API
  createFolderWithInvisibleTab() {
    try {
      // 1. Create a new tab (about:blank, hidden)
      let newTab;
      if (gBrowser.addTrustedTab) {
        newTab = gBrowser.addTrustedTab('about:blank', { skipAnimation: true, inBackground: true });
        console.log('[TabFolders] Created new trusted tab for folder', newTab);
      } else {
        newTab = document.createElement('tab');
        console.warn('[TabFolders] Fallback: created plain tab element');
      }
      newTab.setAttribute('data-zen-folder-placeholder', 'true');
      // Ensure the tab has a unique id
      if (!newTab.id) {
        newTab.id = 'zen-folder-placeholder-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        console.log('[TabFolders] Assigned id to placeholder tab:', newTab.id);
      }
      newTab.style.display = 'none';
      newTab.setAttribute('hidden', 'true');
      // 2. Use gBrowser.addTabGroup to create a new group with this tab
      if (gBrowser.addTabGroup) {
        const groupOptions = {
          label: 'Folder',
          color: 'blue',
          insertBefore: newTab // Place group at the new tab's position
        };
        const groupElement = gBrowser.addTabGroup([newTab], groupOptions);
        console.log('[TabFolders] Created new tab group', groupElement, 'with tab', newTab);
      } else {
        console.error('[TabFolders] gBrowser.addTabGroup is not available. Cannot create folder.');
      }
    } catch (e) {
      console.error('[TabFolders] Error creating folder with invisible tab:', e);
    }
  }

  #onTabPinned(event) {
    // Placeholder: implement pinning logic if needed
    // const tab = event.target;
    // const group = tab.group;
    // if (group) { group.pinned = true; }
  }

  #onTabUnpinned(event) {
    // Placeholder: implement unpinning logic if needed
    // const tab = event.target;
    // const group = tab.group;
    // if (group) { group.pinned = false; }
  }

  /**
   * Create a new group as a child of another group (logical nesting only)
   * @param {Array<Tab>} tabs - Tabs for the new group
   * @param {Element} parentGroup - The parent group element
   * @param {Object} options - Options for gBrowser.addTabGroup
   * @returns {Element} The new group element
   */
  createNestedGroup(tabs, parentGroup, options = {}) {
    // Create the group using the browser's logic
    const group = gBrowser.addTabGroup(tabs, options);
    if (group && parentGroup) {
      this.groupHierarchy.set(group.id, parentGroup.id);
      group.setAttribute('zen-parent-group-id', parentGroup.id);
      group.setAttribute('zen-nested-group', 'true');
      // Defensive: only remove if parentNode exists
      if (group.parentNode && group.parentNode !== parentGroup) {
        group.parentNode.removeChild(group);
      }
      // Use the patched appendChild (which targets .tab-group-container)
      if (typeof parentGroup.appendChild === 'function') {
        parentGroup.appendChild(group);
      } else {
        // fallback: append to .tab-group-container directly
        const container = parentGroup.querySelector('.tab-group-container');
        if (container) container.appendChild(group);
      }
      // Log for debugging
      console.log('[ZenGroups] Nested group', group, 'inside parent', parentGroup);
      console.log('[ZenGroups] Parent .tab-group-container children:', parentGroup.querySelector('.tab-group-container')?.children);
    }
    return group;
  }

  /**
   * Move an existing group under another group (logical nesting only)
   * @param {Element} childGroup - The group to nest
   * @param {Element} parentGroup - The parent group
   */
  nestGroup(childGroup, parentGroup) {
    if (childGroup && parentGroup) {
      this.groupHierarchy.set(childGroup.id, parentGroup.id);
      childGroup.setAttribute('zen-parent-group-id', parentGroup.id);
    }
  }

  /**
   * Get the parent group element of a group
   * @param {string|Element} groupOrId - Group element or group id
   * @returns {Element|null}
   */
  getParentGroup(groupOrId) {
    const groupId = typeof groupOrId === 'string' ? groupOrId : groupOrId?.id;
    const parentId = this.groupHierarchy.get(groupId);
    return parentId ? document.getElementById(parentId) : null;
  }

  /**
   * Get all direct child group elements of a parent group
   * @param {string|Element} parentGroupOrId - Parent group element or id
   * @returns {Element[]} Array of child group elements
   */
  getChildGroups(parentGroupOrId) {
    const parentId = typeof parentGroupOrId === 'string' ? parentGroupOrId : parentGroupOrId?.id;
    return Array.from(this.groupHierarchy.entries())
      .filter(([childId, pid]) => pid === parentId)
      .map(([childId]) => document.getElementById(childId))
      .filter(Boolean);
  }

  /**
   * Get all ancestor group elements (from closest parent up to root)
   * @param {string|Element} groupOrId - Group element or id
   * @returns {Element[]} Array of ancestor group elements (closest first)
   */
  getAncestorGroups(groupOrId) {
    const ancestors = [];
    let current = this.getParentGroup(groupOrId);
    while (current) {
      ancestors.push(current);
      current = this.getParentGroup(current);
    }
    return ancestors;
  }

  /**
   * Get all descendant group elements (recursive)
   * @param {string|Element} groupOrId - Group element or id
   * @returns {Element[]} Array of all descendant group elements
   */
  getDescendantGroups(groupOrId) {
    const descendants = [];
    const children = this.getChildGroups(groupOrId);
    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getDescendantGroups(child));
    }
    return descendants;
  }

  /**
   * Remove a group from the hierarchy (optionally recursively remove descendants)
   * @param {string|Element} groupOrId - Group element or id
   * @param {boolean} recursive - If true, remove all descendants too
   */
  removeGroupFromHierarchy(groupOrId, recursive = false) {
    const groupId = typeof groupOrId === 'string' ? groupOrId : groupOrId?.id;
    if (recursive) {
      for (const desc of this.getDescendantGroups(groupId)) {
        this.groupHierarchy.delete(desc.id);
        desc.removeAttribute('zen-parent-group-id');
      }
    }
    this.groupHierarchy.delete(groupId);
    const group = typeof groupOrId === 'string' ? document.getElementById(groupOrId) : groupOrId;
    group?.removeAttribute('zen-parent-group-id');
  }

  /**
   * Get all root groups (groups with no parent)
   * @returns {Element[]} Array of root group elements
   */
  getRootGroups() {
    const allGroups = gBrowser.getAllTabGroups();
    return allGroups.filter(g => !this.groupHierarchy.has(g.id));
  }
}

// Inject CSS for hiding hidden tabs in tab groups
(function addTabFoldersCSS() {
  if (!document.getElementById('tab-folders-hidden-tab-css')) {
    const style = document.createElement('style');
    style.id = 'tab-folders-hidden-tab-css';
    style.textContent = `
      tab-group tab[hidden] {
        display: none !important;
      }
      tab[data-zen-folder-placeholder] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }
})();

(function () {
  if (!globalThis.zenGroupsInstance) {
    window.addEventListener(
      "load",
      () => {
        globalThis.zenGroupsInstance = new ZenGroups();
        globalThis.zenGroupsInstance.init();
      },
      { once: true },
    );
  }
})();

document.addEventListener('command', e => {
  console.log('[ZenGroups] Command event:', e.target, e);
}, true);
document.addEventListener('click', e => {
  if (e.target.closest('toolbarbutton')) {
    console.log('[ZenGroups] Toolbarbutton clicked:', e.target);
  }
}, true);

// Intercept the 'New Group' context menu item to implement nested group logic
(function interceptNewGroupMenu() {
  function handler(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    // Get selected tabs
    const tabs = gBrowser.selectedTabs || [gBrowser.selectedTab];
    // Find unique parent groups
    const groups = Array.from(new Set(tabs.map(tab => tab.group).filter(Boolean)));
    console.log('[ZenGroups] Intercepted New Group menu command! Selected tabs:', tabs, 'Groups:', groups);
    if (groups.length === 1 && groups[0]) {
      // All tabs share the same group, create a nested group
      if (window.zenGroupsInstance && typeof window.zenGroupsInstance.createNestedGroup === 'function') {
        window.zenGroupsInstance.createNestedGroup(tabs, groups[0], { label: 'Nested Group' });
        return;
      }
    }
    // Fallback: call the original behavior (simulate default command)
    // Remove this handler and re-dispatch the event to allow default
    const menu = document.getElementById('context_moveTabToGroupNewGroup');
    if (menu) {
      menu.removeEventListener('command', handler, true);
      menu.dispatchEvent(new Event('command', { bubbles: true, cancelable: true }));
      menu.addEventListener('command', handler, true);
    }
  }
  function attachHandler() {
    const menu = document.getElementById('context_moveTabToGroupNewGroup');
    if (menu && !menu._zenIntercepted) {
      menu.addEventListener('command', handler, true);
      menu._zenIntercepted = true;
      console.log('[ZenGroups] Attached nested group handler to New Group menu item');
    }
  }
  // Try immediately, and also observe for dynamic menu creation
  attachHandler();
  const obs = new MutationObserver(attachHandler);
  obs.observe(document, { childList: true, subtree: true });
})();
