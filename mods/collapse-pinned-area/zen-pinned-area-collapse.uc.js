// ==UserScript==
// @name         Zen Workspace Collapse
// @description  Add chevron icon to collapse/expand pinned folders and tabs in Zen Browser. Acts as top-level folder.
// @author       Bxth
// @match        chrome://browser/content/browser.xhtml
// @match        chrome://browser/content/browser.xul
// ==/UserScript==

(function() {
    'use strict';

    // State to track collapsed status per workspace ID (Session only, no persistence)
    const collapsedStates = new Map();
    
    // Helper function to get workspace ID from an element
    function getWorkspaceId(element) {
        if (!element) return null;
        // Try to find workspace ID from the element or its parents
        const workspaceElement = element.closest('zen-workspace');
        if (workspaceElement) {
            return workspaceElement.id;
        }
        // Try to get from zen-workspace-id attribute
        const workspaceId = element.getAttribute('zen-workspace-id') ||
                           element.closest('[zen-workspace-id]')?.getAttribute('zen-workspace-id');
        if (workspaceId) {
            return workspaceId;
        }
        return null;
    }
    
    // Helper function to get collapsed state for a workspace
    function isWorkspaceCollapsed(workspaceId) {
        if (!workspaceId) return false;
        // Default to false (expanded) if not set
        return collapsedStates.get(workspaceId) || false;
    }
    
    // Helper function to set collapsed state for a workspace
    function setWorkspaceCollapsed(workspaceId, collapsed) {
        if (!workspaceId) return;
        collapsedStates.set(workspaceId, collapsed);
    }

    // Function to create chevron SVG icon (HTML namespace)
    function createChevronIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '1em');
        svg.setAttribute('height', '1em');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        svg.style.display = 'none';
        svg.style.verticalAlign = 'middle';
        svg.style.cursor = 'pointer';
        svg.style.width = '1em';
        svg.style.height = '1em';
        svg.style.marginTop = '4px'; // Lower the chevron slightly
        svg.classList.add('zen-collapse-chevron');

        // Right-pointing arrow icon (from Solar by 480 Design)
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('d', 'M8.512 4.43a.75.75 0 0 1 1.057.082l6 7a.75.75 0 0 1 0 .976l-6 7a.75.75 0 0 1-1.138-.976L14.012 12L8.431 5.488a.75.75 0 0 1 .08-1.057');
        path.setAttribute('clip-rule', 'evenodd');
        svg.appendChild(path);

        return svg;
    }

    function cacheOriginalBoxMetrics(element) {
        if (!element || element.dataset.zenOriginalMarginTop !== undefined) {
            return;
        }

        const styles = window.getComputedStyle(element);
        element.dataset.zenOriginalMarginTop = styles.marginTop;
        element.dataset.zenOriginalMarginBottom = styles.marginBottom;
        element.dataset.zenOriginalPaddingTop = styles.paddingTop;
        element.dataset.zenOriginalPaddingBottom = styles.paddingBottom;
    }

    function setCollapsedBoxStyles(element, collapsed) {
        if (!element) {
            return;
        }

        if (collapsed) {
            element.style.marginTop = '0px';
            element.style.marginBottom = '0px';
            element.style.paddingTop = '0px';
            element.style.paddingBottom = '0px';
        } else {
            element.style.marginTop = element.dataset.zenOriginalMarginTop || '';
            element.style.marginBottom = element.dataset.zenOriginalMarginBottom || '';
            element.style.paddingTop = element.dataset.zenOriginalPaddingTop || '';
            element.style.paddingBottom = element.dataset.zenOriginalPaddingBottom || '';
        }
    }

    // Helper to find all nested collapsed items within an element
    function getNestedCollapsedItems(parent) {
        const nested = [];
        // Find all nested zen-folders and tabs that have collapsed styles
        const nestedElements = parent.querySelectorAll('zen-folder, [is="tabbrowser-tab"], .tabbrowser-tab');
        nestedElements.forEach(el => {
            if (el.style.maxHeight === '0px') {
                nested.push({
                    element: el,
                    maxHeight: el.style.maxHeight,
                    opacity: el.style.opacity,
                    overflow: el.style.overflow,
                    marginTop: el.style.marginTop,
                    marginBottom: el.style.marginBottom,
                    paddingTop: el.style.paddingTop,
                    paddingBottom: el.style.paddingBottom
                });
            }
        });
        return nested;
    }

    // Temporarily expand nested items to measure true height
    function expandNestedForMeasurement(nestedItems) {
        nestedItems.forEach(({ element }) => {
            element.style.maxHeight = '';
            element.style.opacity = '';
            element.style.overflow = '';
            element.style.marginTop = '';
            element.style.marginBottom = '';
            element.style.paddingTop = '';
            element.style.paddingBottom = '';
        });
    }

    // Restore nested items to collapsed state
    function restoreNestedCollapsed(nestedItems) {
        nestedItems.forEach(({ element, maxHeight, opacity, overflow, marginTop, marginBottom, paddingTop, paddingBottom }) => {
            element.style.maxHeight = maxHeight;
            element.style.opacity = opacity;
            element.style.overflow = overflow;
            element.style.marginTop = marginTop;
            element.style.marginBottom = marginBottom;
            element.style.paddingTop = paddingTop;
            element.style.paddingBottom = paddingBottom;
        });
    }

    function animatePinnedItems(items, collapse, animate) {
        items.forEach(item => {
            if (!item) {
                return;
            }

            cacheOriginalBoxMetrics(item);
            
            // Get all nested collapsed items BEFORE we start any animation
            const nestedCollapsed = getNestedCollapsedItems(item);
            
            const finalizeExpandedState = () => {
                item.style.maxHeight = '';
                item.style.opacity = '';
                item.style.overflow = '';
                item.style.marginTop = '';
                item.style.marginBottom = '';
                item.style.paddingTop = '';
                item.style.paddingBottom = '';
                // Also finalize nested items
                nestedCollapsed.forEach(({ element }) => {
                    element.style.maxHeight = '';
                    element.style.opacity = '';
                    element.style.overflow = '';
                    element.style.marginTop = '';
                    element.style.marginBottom = '';
                    element.style.paddingTop = '';
                    element.style.paddingBottom = '';
                    element.classList.remove('zen-collapse-anim-target');
                });
                // Remove the animation class to avoid conflicts
                item.classList.remove('zen-collapse-anim-target');
            };
            
            const finalizeCollapsedState = () => {
                item.style.maxHeight = '0px';
                item.style.opacity = '0';
                item.style.overflow = 'hidden';
                setCollapsedBoxStyles(item, true);
                // Also finalize nested items
                nestedCollapsed.forEach(({ element }) => {
                    cacheOriginalBoxMetrics(element);
                    element.style.maxHeight = '0px';
                    element.style.opacity = '0';
                    element.style.overflow = 'hidden';
                    setCollapsedBoxStyles(element, true);
                    element.classList.remove('zen-collapse-anim-target');
                });
                // Remove the animation class to avoid conflicts
                item.classList.remove('zen-collapse-anim-target');
            };

            if (!animate) {
                if (collapse) {
                    item.style.maxHeight = '0px';
                    item.style.opacity = '0';
                    item.style.overflow = 'hidden';
                    setCollapsedBoxStyles(item, true);
                    // Also collapse nested items
                    nestedCollapsed.forEach(({ element }) => {
                        cacheOriginalBoxMetrics(element);
                        element.style.maxHeight = '0px';
                        element.style.opacity = '0';
                        element.style.overflow = 'hidden';
                        setCollapsedBoxStyles(element, true);
                    });
                } else {
                    finalizeExpandedState();
                }
                return;
            }

            // Add animation class only when animating
            item.classList.add('zen-collapse-anim-target');
            // Also add to nested items so they animate together
            nestedCollapsed.forEach(({ element }) => {
                element.classList.add('zen-collapse-anim-target');
            });
            
            const currentHeight = item.scrollHeight;
            item.style.overflow = 'hidden';

            const onTransitionEnd = (event) => {
                if (event.propertyName !== 'max-height') {
                    return;
                }
                item.removeEventListener('transitionend', onTransitionEnd);
                if (collapse) {
                    finalizeCollapsedState();
                } else {
                    finalizeExpandedState();
                }
            };

            item.addEventListener('transitionend', onTransitionEnd);

            if (collapse) {
                item.style.maxHeight = currentHeight + 'px';
                item.style.opacity = '1';
                setCollapsedBoxStyles(item, false);

                requestAnimationFrame(() => {
                    item.style.maxHeight = '0px';
                    item.style.opacity = '0';
                    setCollapsedBoxStyles(item, true);
                    // Collapse nested items in sync
                    nestedCollapsed.forEach(({ element }) => {
                        cacheOriginalBoxMetrics(element);
                        element.style.overflow = 'hidden';
                        element.style.maxHeight = '0px';
                        element.style.opacity = '0';
                        setCollapsedBoxStyles(element, true);
                    });
                });
            } else {
                // For expanding, we need to measure the FULL height including expanded nested content
                // First, temporarily expand all nested items to get true measurement
                expandNestedForMeasurement(nestedCollapsed);
                
                // Now measure the full height with nested content expanded
                const fullTargetHeight = item.scrollHeight || currentHeight;
                
                // Restore nested items to collapsed state for the animation start
                restoreNestedCollapsed(nestedCollapsed);
                
                item.style.maxHeight = '0px';
                item.style.opacity = '0';
                setCollapsedBoxStyles(item, true);

                requestAnimationFrame(() => {
                    // Animate to the full target height
                    item.style.maxHeight = fullTargetHeight + 'px';
                    item.style.opacity = '1';
                    setCollapsedBoxStyles(item, false);
                    // Expand nested items in sync
                    nestedCollapsed.forEach(({ element }) => {
                        element.style.maxHeight = '';
                        element.style.opacity = '1';
                        element.style.overflow = '';
                        setCollapsedBoxStyles(element, false);
                    });
                });
            }
        });
    }

    // Helper to identify the chain of folders containing the active tab
    function getActiveFolderChain(activeTab, pinnedSection) {
        if (!activeTab || !pinnedSection) return [];
        
        const chain = [];
        let current = activeTab.parentElement;
        
        // Traverse up until we reach the pinned section
        while (current && current !== pinnedSection) {
            // Check if current element is a zen-folder (or contains one that wraps our path)
            // The structure is zen-folder > tab-group-container > tab
            // So we look for zen-folder elements
            if (current.localName === 'zen-folder') {
                chain.push(current);
            }
            current = current.parentElement;
        }
        
        return chain;
    }

    // Helper to identify the container (folder or direct tab) of the active tab
    function getActiveContainer(pinnedSection, activeTab = gBrowser.selectedTab) {
        if (!activeTab) return null;

        // Check if active tab is inside this pinned section
        if (!pinnedSection.contains(activeTab)) return null;

        // Find the direct child of pinnedSection that contains the active tab
        let current = activeTab;
        while (current && current.parentElement !== pinnedSection) {
            current = current.parentElement;
        }
        
        // If current is the pinnedSection itself (shouldn't happen) or null, return null
        if (!current || current === pinnedSection) return null;
        
        return current;
    }

    // Core function to update visibility and state based on collapsed status
    function updateWorkspaceState(workspaceId, animate = true) {
        if (!workspaceId) return;

        const isCollapsed = isWorkspaceCollapsed(workspaceId);
        
        const pinnedSection = document.querySelector(`.zen-workspace-tabs-section.zen-workspace-pinned-tabs-section[zen-workspace-id="${workspaceId}"]`) ||
                             document.querySelector(`zen-workspace#${workspaceId} .zen-workspace-pinned-tabs-section`);
        
        if (!pinnedSection) return;
        
        const activeTab = gBrowser.selectedTab;

        // Get direct children (folders and tabs)
        const children = Array.from(pinnedSection.children).filter(child => {
             return (child.tagName === 'zen-folder' || 
                    child.tagName === 'tab' || 
                    child.classList.contains('tabbrowser-tab') ||
                    child.getAttribute('is') === 'tabbrowser-tab') &&
                    !child.classList.contains('pinned-tabs-container-separator') &&
                    child.tagName !== 'hbox';
        });

        const activeContainer = getActiveContainer(pinnedSection, activeTab);
        const folders = pinnedSection.querySelectorAll('zen-folder');
        const separator = pinnedSection.querySelector('.pinned-tabs-container-separator');
        
        // Get the active tab (if it's in this pinned section)
        const isActiveTabInPinned = pinnedSection.contains(activeTab);
        const activeChain = isActiveTabInPinned ? getActiveFolderChain(activeTab, pinnedSection) : [];

        // Phase 1: Update Folder States and Flattening
        // ONLY modify folder.collapsed for folders in the active chain (containing active tab)
        // Other folders are just hidden via maxHeight - no need to touch their collapsed state
        if (isCollapsed) {
            folders.forEach(folder => {
                // Only modify collapsed state for folders in the active chain
                if (activeChain.includes(folder)) {
                    // Save original state if not already saved
                    if (!folder.dataset.originalStateSaved) {
                        folder.dataset.zenOriginalCollapsed = folder.collapsed;
                        folder.dataset.originalStateSaved = "true";
                    }
                    // Force collapse so only active tab is visible
                    if (!folder.collapsed) {
                        folder.collapsed = true;
                    }
                    folder.classList.add('zen-flatten-folder');
                } else {
                    folder.classList.remove('zen-flatten-folder');
                }
            });
        } else {
            // Restore folders that were modified (those in active chain stay visible, so no animation conflict)
            folders.forEach(folder => {
                folder.classList.remove('zen-flatten-folder');
                
                if (folder.dataset.originalStateSaved) {
                    const wasCollapsed = folder.dataset.zenOriginalCollapsed === 'true';
                    if (folder.collapsed !== wasCollapsed) {
                        folder.collapsed = wasCollapsed;
                    }
                    delete folder.dataset.zenOriginalCollapsed;
                    delete folder.dataset.originalStateSaved;
                }
            });
        }

        // Phase 2: Update Visibility (Hiding/Showing items)
        const itemsToHide = [];
        const itemsToShow = [];

        if (isCollapsed) {
            children.forEach(child => {
                if (child === activeContainer) {
                    // Keep active container visible
                    // Check if it's currently hidden, if so add to show list
                    if (child.style.maxHeight === '0px' || child.style.display === 'none') {
                        itemsToShow.push(child);
                    }
                } else {
                    // Hide others
                    // Check if currently visible, if so add to hide list
                    if (child.style.maxHeight !== '0px' && child.style.display !== 'none') {
                        itemsToHide.push(child);
                    }
                }
            });
        } else {
            // Show everything
            children.forEach(child => {
                 if (child.style.maxHeight === '0px' || child.style.display === 'none') {
                    itemsToShow.push(child);
                 }
            });
        }

        // Animate changes
        if (itemsToHide.length > 0) {
            animatePinnedItems(itemsToHide, true, animate);
        }
        if (itemsToShow.length > 0) {
            animatePinnedItems(itemsToShow, false, animate);
        }
        
        // Ensure separator visibility
        if (separator) {
             separator.style.display = '';
        }

        // Update Indicators (Chevron etc)
        updateIndicators(workspaceId, isCollapsed);
    }

    function updateIndicators(workspaceId, isCollapsed) {
        const workspaceIndicator = document.querySelector(`.zen-workspace-tabs-section.zen-current-workspace-indicator[zen-workspace-id="${workspaceId}"]`) ||
                                  document.querySelector(`zen-workspace#${workspaceId} .zen-current-workspace-indicator`);
        
        if (workspaceIndicator) {
            if (isCollapsed) {
                workspaceIndicator.setAttribute('data-zen-collapsed', 'true');
            } else {
                workspaceIndicator.removeAttribute('data-zen-collapsed');
            }
            
            const workspaceIconBox = workspaceIndicator.querySelector('.zen-current-workspace-indicator-icon');
            if (workspaceIconBox) {
                const chevron = workspaceIconBox.querySelector(`.zen-collapse-chevron[data-workspace-id="${workspaceId}"]`);
                const originalChildren = Array.from(workspaceIconBox.children).filter(
                    child => !child.classList.contains('zen-collapse-chevron')
                );
                
                if (chevron) {
                    chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
                    
                    if (isCollapsed) {
                        chevron.style.display = 'block';
                        chevron.style.visibility = 'visible';
                        originalChildren.forEach(child => {
                            child.style.display = 'none';
                        });
                    } else {
                         if (!workspaceIndicator.matches(':hover')) {
                            chevron.style.display = 'none';
                            originalChildren.forEach(child => {
                                child.style.display = '';
                            });
                        }
                    }
                }
            }
        }
    }

    // Function to toggle folder visibility for a specific workspace
    function toggleFolders(workspaceId) {
        if (!workspaceId) return;
        
        const wasCollapsed = isWorkspaceCollapsed(workspaceId);
        const isCollapsed = !wasCollapsed;
        setWorkspaceCollapsed(workspaceId, isCollapsed);
        
        updateWorkspaceState(workspaceId, true);
    }

    // Function to initialize the chevron icon
    function initChevron() {
        // Find all workspace indicators (not just active one)
        const workspaceIndicators = document.querySelectorAll('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        
        if (workspaceIndicators.length === 0) {
            return false;
        }

        let initialized = false;
        
        // Initialize chevron for each workspace
        workspaceIndicators.forEach(workspaceIndicator => {
            const workspaceId = getWorkspaceId(workspaceIndicator);
            if (!workspaceId) return;

            const workspaceIconBox = workspaceIndicator.querySelector('.zen-current-workspace-indicator-icon');
            if (!workspaceIconBox) return;

            if (workspaceIconBox.querySelector('.zen-collapse-chevron[data-workspace-id]')) {
                return;
            }

            console.log('[Zen Collapse] Initializing chevron for workspace:', workspaceId);
            const chevron = createChevronIcon();
            chevron.setAttribute('data-workspace-id', workspaceId);
            
            const isCollapsed = isWorkspaceCollapsed(workspaceId);
            
            workspaceIndicator.classList.add('zen-has-collapse-chevron');
            
            const handleMouseEnter = () => {
                const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                if (!currentCollapsed) {
                    chevron.style.display = 'block';
                    chevron.style.visibility = 'visible';
                     const originalChildren = Array.from(workspaceIconBox.children).filter(
                        child => !child.classList.contains('zen-collapse-chevron')
                    );
                    originalChildren.forEach(child => {
                        child.style.display = 'none';
                    });
                }
            };

            const handleMouseLeave = () => {
                const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                if (!currentCollapsed) {
                    chevron.style.display = 'none';
                     const originalChildren = Array.from(workspaceIconBox.children).filter(
                        child => !child.classList.contains('zen-collapse-chevron')
                    );
                    originalChildren.forEach(child => {
                        child.style.display = '';
                        child.style.visibility = '';
                    });
                }
            };

            workspaceIndicator.addEventListener('mouseenter', handleMouseEnter, true);
            workspaceIndicator.addEventListener('mouseleave', handleMouseLeave, true);

            workspaceIconBox.appendChild(chevron);
            
            // Initial update
            updateWorkspaceState(workspaceId, false);

            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFolders(workspaceId);
            });

            initialized = true;
        });

        blockWorkspaceIconDoubleClick();
        return initialized;
    }

    // Function to wait for elements and initialize
    function waitForElements() {
        const workspaceIndicators = document.querySelectorAll('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        const pinnedSections = document.querySelectorAll('.zen-workspace-tabs-section.zen-workspace-pinned-tabs-section');
        
        if (workspaceIndicators.length > 0 && pinnedSections.length > 0) {
            if (initChevron()) {
                return true;
            }
        }
        return false;
    }

    // Track if a drag operation is in progress
    let isDragging = false;
    
    function handleDragStart(event) {
        const target = event.target;
        if (target && (target.tagName === 'zen-folder' || target.closest('zen-folder'))) {
            isDragging = true;
            const allItems = document.querySelectorAll('.zen-collapse-anim-target');
            allItems.forEach(item => {
                item.classList.remove('zen-collapse-anim-target');
            });
        }
    }
    
    function handleDragEnd(event) {
        if (isDragging) {
            isDragging = false;
        }
    }
    
    function blockWorkspaceIconDoubleClick() {
        const indicators = document.querySelectorAll('.zen-current-workspace-indicator-icon');
        indicators.forEach(icon => {
            if (icon.dataset.zenDblClickBlocked) return;
            icon.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
            }, true);
            icon.dataset.zenDblClickBlocked = "true";
        });
    }

    // Initialize when DOM is ready
    function initialize() {
        console.log('[Zen Collapse] Initializing...');
        
        // Set up emoji picker interception
        setupEmojiPickerInterception();
        
        blockWorkspaceIconDoubleClick();
        
        document.addEventListener('dragstart', handleDragStart, true);
        document.addEventListener('dragend', handleDragEnd, true);
        document.addEventListener('drop', handleDragEnd, true);
        
        // Add TabSelect listener
        window.addEventListener('TabSelect', onTabSelect);

        if (!waitForElements()) {
            const retries = [100, 500, 1000, 2000];
            let retryIdx = 0;
            const tryInit = () => {
                if (!waitForElements() && retryIdx < retries.length) {
                    setTimeout(tryInit, retries[retryIdx++]);
                }
            };
            setTimeout(tryInit, 100);
        }
    }

    function onTabSelect(event) {
        // When tab changes, check if we need to update visibility of the current workspace
        // (e.g. if we switched to a tab in a collapsed workspace)
        const activeTab = event.target;
        const workspaceId = getWorkspaceId(activeTab);
        
        if (workspaceId && isWorkspaceCollapsed(workspaceId)) {
            // Re-run update logic to show the active tab/folder and hide others
            updateWorkspaceState(workspaceId, true);
        }
    }

    // Function to update chevron visibility when workspace changes
    function updateChevronVisibility() {
        const allChevrons = document.querySelectorAll('.zen-collapse-chevron[data-workspace-id]');
        allChevrons.forEach(chevron => {
            const workspaceId = chevron.getAttribute('data-workspace-id');
            const isCollapsed = isWorkspaceCollapsed(workspaceId);
            updateIndicators(workspaceId, isCollapsed);
        });
    }

    function showIconForPicker(workspaceIconBox, workspaceId) {
        if (!workspaceIconBox || !workspaceId) return null;
        
        const chevron = workspaceIconBox.querySelector(`.zen-collapse-chevron[data-workspace-id="${workspaceId}"]`);
        if (!chevron) return null;
        
        const isCollapsed = isWorkspaceCollapsed(workspaceId);
        if (!isCollapsed) return null;
        
        const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
        if (!workspaceIndicator) return null;
        
        const originalChildren = Array.from(workspaceIconBox.children).filter(
            child => !child.classList.contains('zen-collapse-chevron')
        );
        
        const state = {
            chevron,
            originalChildren,
            workspaceIndicator
        };
        
        workspaceIndicator.setAttribute('data-zen-icon-picker-open', 'true');
        
        chevron.style.setProperty('display', 'none', 'important');
        chevron.style.setProperty('visibility', 'hidden', 'important');
        originalChildren.forEach(child => {
            child.style.setProperty('display', '', 'important');
        });
        
        return state;
    }
    
    function restoreChevronAfterPicker(state, workspaceId) {
        if (!state || !workspaceId) return;
        
        if (state.workspaceIndicator) {
            state.workspaceIndicator.removeAttribute('data-zen-icon-picker-open');
        }
        
        const isCollapsed = isWorkspaceCollapsed(workspaceId);
        if (!isCollapsed) {
            state.chevron.style.setProperty('display', 'none', 'important');
            state.chevron.style.setProperty('visibility', 'hidden', 'important');
            state.originalChildren.forEach(child => {
                child.style.setProperty('display', '', 'important');
            });
            return;
        }
        
        state.chevron.style.removeProperty('display');
        state.chevron.style.removeProperty('visibility');
        state.originalChildren.forEach(child => {
            child.style.removeProperty('display');
        });
    }
    
    function setupEmojiPickerInterception() {
        if (typeof gZenEmojiPicker === 'undefined' || !gZenEmojiPicker) {
            setTimeout(setupEmojiPickerInterception, 100);
            return;
        }
        
        const originalOpen = gZenEmojiPicker.open.bind(gZenEmojiPicker);
        
        gZenEmojiPicker.open = function(anchor) {
            let workspaceIconBox = null;
            let workspaceId = null;
            
            if (anchor) {
                workspaceIconBox = anchor.classList.contains('zen-current-workspace-indicator-icon') 
                    ? anchor 
                    : anchor.closest('.zen-current-workspace-indicator-icon');
                
                if (workspaceIconBox) {
                    const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
                    if (workspaceIndicator) {
                        workspaceId = getWorkspaceId(workspaceIndicator);
                    }
                }
            }
            
            const pickerState = showIconForPicker(workspaceIconBox, workspaceId);
            const promise = originalOpen(anchor);
            
            promise
                .then(() => {
                    restoreChevronAfterPicker(pickerState, workspaceId);
                })
                .catch(() => {
                    restoreChevronAfterPicker(pickerState, workspaceId);
                });
            
            return promise;
        };
    }

    // Function to apply state to current workspace immediately
    function applyCurrentWorkspaceState() {
        const currentIndicator = document.querySelector('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        if (currentIndicator) {
            const workspaceId = getWorkspaceId(currentIndicator);
            if (workspaceId) {
                // Initialize/Update state
                updateWorkspaceState(workspaceId, false);
                blockWorkspaceIconDoubleClick();
            }
        }
    }

    window.addEventListener('ZenWorkspaceAttached', (event) => {
        applyCurrentWorkspaceState();
        setTimeout(() => {
            initChevron();
            blockWorkspaceIconDoubleClick();
        }, 100);
    }, true);
    
    window.addEventListener('ZenWorkspacesUIUpdate', () => {
        applyCurrentWorkspaceState();
        setTimeout(() => {
            initChevron();
            blockWorkspaceIconDoubleClick();
            updateChevronVisibility();
        }, 100);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'movingtab') {
                const target = mutation.target;
                if (target.hasAttribute('movingtab')) {
                    const allItems = document.querySelectorAll('.zen-collapse-anim-target');
                    allItems.forEach(item => {
                        item.classList.remove('zen-collapse-anim-target');
                    });
                }
            }
            
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && (
                        node.matches('zen-workspace') ||
                        node.matches('.zen-current-workspace-indicator') ||
                        node.querySelector('.zen-current-workspace-indicator')
                    )) {
                        setTimeout(() => {
                            initChevron();
                            blockWorkspaceIconDoubleClick();
                        }, 50);
                        return;
                    }
                }
            }
        }
        
        const workspaceIndicators = document.querySelectorAll('.zen-current-workspace-indicator');
        let needsInit = false;
        workspaceIndicators.forEach(workspaceIndicator => {
            const iconBox = workspaceIndicator.querySelector('.zen-current-workspace-indicator-icon');
            if (iconBox) {
                const workspaceId = getWorkspaceId(workspaceIndicator);
                const existingChevron = iconBox.querySelector(`.zen-collapse-chevron[data-workspace-id="${workspaceId}"]`);
                if (!existingChevron) {
                    needsInit = true;
                }
            }
        });
        
        if (needsInit) {
            setTimeout(() => {
                initChevron();
                blockWorkspaceIconDoubleClick();
            }, 50);
        }
    });

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['movingtab']
        });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['movingtab']
                });
            }
        });
    }

    const style = document.createElement('style');
    style.textContent = `
        /* Only apply transitions when explicitly animating, not during drag operations */
        .zen-collapse-anim-target:not([dragging]) {
            overflow: hidden !important;
            will-change: max-height, margin, padding, opacity;
            transition:
                max-height 0.1s cubic-bezier(0.2, 0.0, 0.2, 1),
                margin-top 0.1s cubic-bezier(0.2, 0.0, 0.2, 1),
                margin-bottom 0.1s cubic-bezier(0.2, 0.0, 0.2, 1),
                padding-top 0.1s cubic-bezier(0.2, 0.0, 0.2, 1),
                padding-bottom 0.1s cubic-bezier(0.2, 0.0, 0.2, 1),
                opacity 0.1s linear;
        }
        #tabbrowser-tabs[movingtab] .zen-collapse-anim-target,
        zen-folder[dragging] {
            transition: none !important;
        }
        .zen-collapse-chevron {
            transition: transform 0.2s ease, opacity 0.2s ease;
            pointer-events: auto;
            transform-origin: center;
        }
        .zen-has-collapse-chevron:hover .zen-collapse-chevron {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        .zen-has-collapse-chevron:hover .zen-current-workspace-indicator-icon > :not(.zen-collapse-chevron) {
            display: none !important;
        }
        .zen-current-workspace-indicator[data-zen-collapsed="true"] .zen-current-workspace-indicator-icon > :not(.zen-collapse-chevron) {
            display: none !important;
        }
        .zen-current-workspace-indicator[data-zen-collapsed="true"] .zen-collapse-chevron {
            display: block !important;
            visibility: visible !important;
        }
        .zen-current-workspace-indicator[data-zen-icon-picker-open="true"] .zen-collapse-chevron {
            display: none !important;
            visibility: hidden !important;
        }
        .zen-current-workspace-indicator[data-zen-icon-picker-open="true"] .zen-current-workspace-indicator-icon > :not(.zen-collapse-chevron) {
            display: block !important;
            visibility: visible !important;
        }
        .zen-current-workspace-indicator-icon {
            position: relative;
        }
        .zen-current-workspace-indicator .zen-current-workspace-indicator-icon {
            margin-bottom: 4px !important;
        }
        .zen-current-workspace-indicator .zen-current-workspace-indicator-name {
            margin-bottom: 2px !important;
        }

        /* FLATTENING STYLES */
        zen-folder.zen-flatten-folder {
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
            width: 100% !important;
        }
        
        /* Hide the header/label of the folder */
        zen-folder.zen-flatten-folder > .tab-group-label-container {
            display: none !important;
        }
        
        /* Reset indentation for the container inside the flattened folder */
        zen-folder.zen-flatten-folder > .tab-group-container {
            margin-inline-start: 0 !important;
            padding-inline-start: 0 !important;
        }
        
        /* Force indentation of items inside to 0 to look top-level */
        zen-folder.zen-flatten-folder > .tab-group-container > * {
            --zen-folder-indent: 0px !important;
            margin-inline-start: 0 !important;
        }
        
        /* Ensure the active tab inside gets 0 indentation */
        zen-folder.zen-flatten-folder .tabbrowser-tab[selected] {
            --zen-folder-indent: 0px !important;
            margin-inline-start: 0 !important;
        }
    `;
    document.head.appendChild(style);

})();
