// ==UserScript==
// @name         Zen Workspace Collapse
// @description  Add chevron icon to collapse/expand pinned folders and tabs in Zen Browser. No persistence.
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
    
    // Function to close all folders on startup (reset state)
    function closeAllFoldersOnStartup() {
        const folders = document.querySelectorAll('zen-folder');
        folders.forEach(folder => {
            if (folder.hasAttribute('open')) {
                folder.removeAttribute('open');
                // Try to call collapse method if available
                if (folder.collapse && typeof folder.collapse === 'function') {
                    folder.collapse();
                }
            }
        });
        console.log(`[Zen Collapse] Reset ${folders.length} folders to closed state.`);
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

    // Function to apply collapsed state to folders and tabs (without toggling)
    function applyCollapsedState(workspaceId, isCollapsed) {
        if (!workspaceId) return;
        
        // Find the pinned section for this specific workspace
        const pinnedSection = document.querySelector(`.zen-workspace-tabs-section.zen-workspace-pinned-tabs-section[zen-workspace-id="${workspaceId}"]`) ||
                             document.querySelector(`zen-workspace#${workspaceId} .zen-workspace-pinned-tabs-section`);
        
        if (!pinnedSection) {
            return;
        }

        // Get folders that belong to this workspace
        const folders = pinnedSection.querySelectorAll('zen-folder');
        
        // Get tabs that are direct children of the pinned section (not in folders)
        const directTabs = Array.from(pinnedSection.children).filter(child => {
            return (child.tagName === 'tab' || 
                   child.classList.contains('tabbrowser-tab') ||
                   child.getAttribute('is') === 'tabbrowser-tab') &&
                   child.tagName !== 'zen-folder' &&
                   !child.classList.contains('pinned-tabs-container-separator') &&
                   child.tagName !== 'hbox';
        });

        // Apply collapsed state without animation
        const targets = [...folders, ...directTabs];
        animatePinnedItems(targets, isCollapsed, false);
        
        // Also update chevron and icon visibility immediately to prevent flashing
        const workspaceIndicator = document.querySelector(`.zen-workspace-tabs-section.zen-current-workspace-indicator[zen-workspace-id="${workspaceId}"]`) ||
                                  document.querySelector(`zen-workspace#${workspaceId} .zen-current-workspace-indicator`);
        
        if (workspaceIndicator) {
            // Set data attribute immediately for CSS-based hiding
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
                    // Update chevron rotation
                    chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
                    
                    // Update visibility immediately
                    if (isCollapsed) {
                        chevron.style.display = 'block';
                        chevron.style.visibility = 'visible';
                        originalChildren.forEach(child => {
                            child.style.display = 'none';
                        });
                    } else {
                        // Only hide chevron if not hovering
                        if (workspaceIndicator && !workspaceIndicator.matches(':hover')) {
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
    function toggleFolders(workspaceId, chevron, workspaceIconBox) {
        if (!workspaceId) return;
        
        // Find the pinned section for this specific workspace
        const pinnedSection = document.querySelector(`.zen-workspace-tabs-section.zen-workspace-pinned-tabs-section[zen-workspace-id="${workspaceId}"]`) ||
                             document.querySelector(`zen-workspace#${workspaceId} .zen-workspace-pinned-tabs-section`);
        
        if (!pinnedSection) {
            console.log('[Zen Collapse] Pinned section not found for workspace:', workspaceId);
            return;
        }

        // Get folders that belong to this workspace
        const folders = pinnedSection.querySelectorAll('zen-folder');
        const separator = pinnedSection.querySelector('.pinned-tabs-container-separator');
        
        // Get tabs that are direct children of the pinned section (not in folders)
        const directTabs = Array.from(pinnedSection.children).filter(child => {
            // Include tab elements (tabbrowser-tab) but exclude folders, separator, and HTML divs
            return (child.tagName === 'tab' || 
                   child.classList.contains('tabbrowser-tab') ||
                   child.getAttribute('is') === 'tabbrowser-tab') &&
                   child.tagName !== 'zen-folder' &&
                   !child.classList.contains('pinned-tabs-container-separator') &&
                   child.tagName !== 'hbox';
        });
        
        // Toggle collapsed state for this workspace
        const wasCollapsed = isWorkspaceCollapsed(workspaceId);
        const isCollapsed = !wasCollapsed;
        setWorkspaceCollapsed(workspaceId, isCollapsed);
        
        // Update data attribute immediately for CSS-based hiding
        const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
        if (workspaceIndicator) {
            if (isCollapsed) {
                workspaceIndicator.setAttribute('data-zen-collapsed', 'true');
            } else {
                workspaceIndicator.removeAttribute('data-zen-collapsed');
            }
        }

        // Animate folders and direct tabs (but not the separator)
        const targets = [...folders, ...directTabs];
        animatePinnedItems(targets, isCollapsed, true);

        // Ensure separator remains visible
        if (separator) {
            separator.style.display = '';
            separator.style.height = '';
            separator.style.overflow = '';
        }

        // Rotate chevron based on state
        // Collapsed: pointing right (0deg), Expanded: pointing down (90deg)
        if (chevron) {
            chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
        }

        // Update icon visibility
        if (workspaceIconBox) {
            const originalChildren = Array.from(workspaceIconBox.children).filter(
                child => !child.classList.contains('zen-collapse-chevron')
            );
            
            if (isCollapsed) {
                if (chevron) chevron.style.display = 'block';
                originalChildren.forEach(child => {
                    child.style.display = 'none';
                });
            } else {
                const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
                // On expand, hide chevron and show original icon (unless hovering)
                if (chevron && workspaceIndicator && !workspaceIndicator.matches(':hover')) {
                    chevron.style.display = 'none';
                }
                if (workspaceIndicator && !workspaceIndicator.matches(':hover')) {
                    originalChildren.forEach(child => {
                        child.style.display = '';
                    });
                }
            }
        }
    }

    // Function to initialize the chevron icon
    function initChevron() {
        // Find all workspace indicators (not just active one)
        const workspaceIndicators = document.querySelectorAll('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        
        if (workspaceIndicators.length === 0) {
            console.log('[Zen Collapse] No workspace indicators found');
            return false;
        }

        let initialized = false;
        
        // Initialize chevron for each workspace
        workspaceIndicators.forEach(workspaceIndicator => {
            // Get workspace ID from the indicator
            const workspaceId = getWorkspaceId(workspaceIndicator);
            if (!workspaceId) {
                console.log('[Zen Collapse] Could not get workspace ID for indicator');
                return;
            }

            // Find the hbox that contains the icon
            const workspaceIconBox = workspaceIndicator.querySelector('.zen-current-workspace-indicator-icon');
            
            if (!workspaceIconBox) {
                console.log('[Zen Collapse] Workspace icon box not found for workspace:', workspaceId);
                return;
            }

            // Check if chevron already exists for this workspace
            if (workspaceIconBox.querySelector('.zen-collapse-chevron[data-workspace-id]')) {
                return;
            }

            console.log('[Zen Collapse] Initializing chevron for workspace:', workspaceId);
            const chevron = createChevronIcon();
            
            // Store workspace ID on the chevron
            chevron.setAttribute('data-workspace-id', workspaceId);
            
            // Get collapsed state for this workspace
            // Default is false (expanded)
            const isCollapsed = isWorkspaceCollapsed(workspaceId);
            
            // Set data attribute for CSS-based hiding
            if (isCollapsed) {
                workspaceIndicator.setAttribute('data-zen-collapsed', 'true');
            } else {
                workspaceIndicator.removeAttribute('data-zen-collapsed');
            }
            
            // Set initial rotation (expanded = pointing down = 90deg)
            chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
            
            // Store original children visibility
            const originalChildren = Array.from(workspaceIconBox.children);
            const originalVisibility = originalChildren.map(child => ({
                element: child,
                wasVisible: child.style.display !== 'none' && child.style.visibility !== 'hidden'
            }));

            // Add a class to the workspace indicator for CSS hover targeting
            workspaceIndicator.classList.add('zen-has-collapse-chevron');
            
            // Show chevron and hide original icon content on hover of the workspace indicator
            const handleMouseEnter = () => {
                console.log('[Zen Collapse] Mouse enter for workspace:', workspaceId);
                const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                if (!currentCollapsed) {
                    chevron.style.display = 'block';
                    chevron.style.visibility = 'visible';
                    originalChildren.forEach(child => {
                        if (!child.classList.contains('zen-collapse-chevron')) {
                            child.style.display = 'none';
                        }
                    });
                }
            };

            const handleMouseLeave = () => {
                console.log('[Zen Collapse] Mouse leave for workspace:', workspaceId, 'collapsed:', isWorkspaceCollapsed(workspaceId));
                // Only hide chevron if not collapsed
                const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                if (!currentCollapsed) {
                    chevron.style.display = 'none';
                    originalVisibility.forEach(({ element, wasVisible }) => {
                        if (wasVisible && !element.classList.contains('zen-collapse-chevron')) {
                            element.style.display = '';
                            element.style.visibility = '';
                        }
                    });
                }
            };

            workspaceIndicator.addEventListener('mouseenter', handleMouseEnter, true);
            workspaceIndicator.addEventListener('mouseleave', handleMouseLeave, true);

            // If collapsed, show chevron by default
            if (isCollapsed) {
                chevron.style.display = 'block';
                chevron.style.visibility = 'visible';
                originalChildren.forEach(child => {
                    if (!child.classList.contains('zen-collapse-chevron')) {
                        child.style.display = 'none';
                    }
                });
            }

            // Insert chevron into the icon box
            workspaceIconBox.appendChild(chevron);
            console.log('[Zen Collapse] Chevron inserted for workspace:', workspaceId);
            
            // Apply saved collapsed state to folders and tabs
            applyCollapsedState(workspaceId, isCollapsed);

            // Add click handler
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[Zen Collapse] Chevron clicked for workspace:', workspaceId);
                toggleFolders(workspaceId, chevron, workspaceIconBox);
            });

            initialized = true;
        });

        return initialized;
    }

    // Function to wait for elements and initialize
    function waitForElements() {
        // Find all workspace indicators
        const workspaceIndicators = document.querySelectorAll('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        const pinnedSections = document.querySelectorAll('.zen-workspace-tabs-section.zen-workspace-pinned-tabs-section');
        
        if (workspaceIndicators.length > 0 && pinnedSections.length > 0) {
            console.log('[Zen Collapse] Found', workspaceIndicators.length, 'workspace indicator(s) and', pinnedSections.length, 'pinned section(s)');
            if (initChevron()) {
                return true;
            }
        } else {
            console.log('[Zen Collapse] Waiting for elements...', {
                indicatorCount: workspaceIndicators.length,
                pinnedSectionCount: pinnedSections.length
            });
        }
        return false;
    }

    // Track if a drag operation is in progress
    let isDragging = false;
    
    // Function to disable collapse transitions during drag
    function handleDragStart(event) {
        // Check if we're dragging a folder
        const target = event.target;
        if (target && (target.tagName === 'zen-folder' || target.closest('zen-folder'))) {
            isDragging = true;
            console.log('[Zen Collapse] Drag started, disabling transitions');
            
            // Remove animation classes from all folders/tabs to prevent conflicts
            const allItems = document.querySelectorAll('.zen-collapse-anim-target');
            allItems.forEach(item => {
                item.classList.remove('zen-collapse-anim-target');
            });
        }
    }
    
    function handleDragEnd(event) {
        if (isDragging) {
            isDragging = false;
            console.log('[Zen Collapse] Drag ended, re-enabling transitions');
        }
    }
    
    // Initialize when DOM is ready
    function initialize() {
        console.log('[Zen Collapse] Initializing...');
        
        // Reset folders to closed state on startup
        closeAllFoldersOnStartup();
        
        // Set up emoji picker interception to show icon when picker is open
        setupEmojiPickerInterception();
        
        // Add drag event listeners to prevent animation conflicts
        document.addEventListener('dragstart', handleDragStart, true);
        document.addEventListener('dragend', handleDragEnd, true);
        document.addEventListener('drop', handleDragEnd, true);
        
        if (!waitForElements()) {
            // Retry with increasing delays
            const retries = [100, 500, 1000, 2000];
            let retryIdx = 0;
            const tryInit = () => {
                if (!waitForElements() && retryIdx < retries.length) {
                    setTimeout(tryInit, retries[retryIdx++]);
                } else {
                    console.log('[Zen Collapse] Initialization sequence finished');
                    closeAllFoldersOnStartup(); // Ensure folders are closed even after delayed init
                }
            };
            setTimeout(tryInit, 100);
        } else {
            closeAllFoldersOnStartup(); // Ensure folders are closed
        }
    }

    // Function to update chevron visibility when workspace changes
    function updateChevronVisibility() {
        const allChevrons = document.querySelectorAll('.zen-collapse-chevron[data-workspace-id]');
        allChevrons.forEach(chevron => {
            const workspaceId = chevron.getAttribute('data-workspace-id');
            const isCollapsed = isWorkspaceCollapsed(workspaceId);
            const workspaceIconBox = chevron.parentElement;
            const originalChildren = Array.from(workspaceIconBox.children).filter(
                child => !child.classList.contains('zen-collapse-chevron')
            );
            
            // Update rotation
            chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)';
            
            // Update visibility
            if (isCollapsed) {
                chevron.style.display = 'block';
                chevron.style.visibility = 'visible';
                originalChildren.forEach(child => {
                    child.style.display = 'none';
                });
            } else {
                const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
                if (workspaceIndicator && !workspaceIndicator.matches(':hover')) {
                    chevron.style.display = 'none';
                    originalChildren.forEach(child => {
                        child.style.display = '';
                    });
                }
            }
        });
    }

    // Function to temporarily show icon and hide chevron when icon picker is open
    function showIconForPicker(workspaceIconBox, workspaceId) {
        if (!workspaceIconBox || !workspaceId) return null;
        
        const chevron = workspaceIconBox.querySelector(`.zen-collapse-chevron[data-workspace-id="${workspaceId}"]`);
        if (!chevron) return null;
        
        const isCollapsed = isWorkspaceCollapsed(workspaceId);
        if (!isCollapsed) return null; // Only need to do this if collapsed
        
        const workspaceIndicator = workspaceIconBox.closest('.zen-current-workspace-indicator');
        if (!workspaceIndicator) return null;
        
        const originalChildren = Array.from(workspaceIconBox.children).filter(
            child => !child.classList.contains('zen-collapse-chevron')
        );
        
        // Store original state
        const state = {
            chevron,
            originalChildren,
            workspaceIndicator,
            chevronDisplay: chevron.style.display,
            chevronVisibility: chevron.style.visibility,
            childrenDisplay: originalChildren.map(child => ({
                element: child,
                display: child.style.display
            }))
        };
        
        // Add data attribute to indicate picker is open (CSS will hide chevron)
        workspaceIndicator.setAttribute('data-zen-icon-picker-open', 'true');
        
        // Show icon, hide chevron (using !important to override CSS)
        chevron.style.setProperty('display', 'none', 'important');
        chevron.style.setProperty('visibility', 'hidden', 'important');
        originalChildren.forEach(child => {
            child.style.setProperty('display', '', 'important');
        });
        
        return state;
    }
    
    // Function to restore chevron visibility after icon picker closes
    function restoreChevronAfterPicker(state, workspaceId) {
        if (!state || !workspaceId) return;
        
        // Remove data attribute indicating picker is open
        if (state.workspaceIndicator) {
            state.workspaceIndicator.removeAttribute('data-zen-icon-picker-open');
        }
        
        const isCollapsed = isWorkspaceCollapsed(workspaceId);
        if (!isCollapsed) {
            // If not collapsed anymore, restore to expanded state (chevron hidden, icon visible)
            state.chevron.style.setProperty('display', 'none', 'important');
            state.chevron.style.setProperty('visibility', 'hidden', 'important');
            state.originalChildren.forEach(child => {
                child.style.setProperty('display', '', 'important');
            });
            return;
        }
        
        // Restore to collapsed state: chevron visible, icon hidden
        // Remove inline styles to let CSS handle it
        state.chevron.style.removeProperty('display');
        state.chevron.style.removeProperty('visibility');
        state.originalChildren.forEach(child => {
            child.style.removeProperty('display');
        });
    }
    
    // Intercept gZenEmojiPicker.open() to handle icon visibility during picker
    function setupEmojiPickerInterception() {
        if (typeof gZenEmojiPicker === 'undefined' || !gZenEmojiPicker) {
            // Wait for gZenEmojiPicker to be available
            setTimeout(setupEmojiPickerInterception, 100);
            return;
        }
        
        const originalOpen = gZenEmojiPicker.open.bind(gZenEmojiPicker);
        
        gZenEmojiPicker.open = function(anchor) {
            // Find the workspace icon box from the anchor
            let workspaceIconBox = null;
            let workspaceId = null;
            
            if (anchor) {
                // The anchor might be the icon box itself or a child
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
            
            // Show icon and hide chevron if collapsed
            const pickerState = showIconForPicker(workspaceIconBox, workspaceId);
            
            // Call original open method
            const promise = originalOpen(anchor);
            
            // Restore chevron when picker closes (promise resolves or rejects)
            promise
                .then(() => {
                    restoreChevronAfterPicker(pickerState, workspaceId);
                })
                .catch(() => {
                    restoreChevronAfterPicker(pickerState, workspaceId);
                });
            
            return promise;
        };
        
        console.log('[Zen Collapse] Emoji picker interception set up');
    }

    // Function to apply state to current workspace immediately
    function applyCurrentWorkspaceState() {
        // Find the current workspace indicator synchronously
        const currentIndicator = document.querySelector('.zen-workspace-tabs-section.zen-current-workspace-indicator');
        if (currentIndicator) {
            const workspaceId = getWorkspaceId(currentIndicator);
            if (workspaceId) {
                let isCollapsed = collapsedStates.get(workspaceId) || false;
                
                const workspaceIconBox = currentIndicator.querySelector('.zen-current-workspace-indicator-icon');
                
                // Set data attribute immediately for CSS-based hiding (synchronous)
                if (isCollapsed) {
                    currentIndicator.setAttribute('data-zen-collapsed', 'true');
                } else {
                    currentIndicator.removeAttribute('data-zen-collapsed');
                }
                
                // Apply state immediately to prevent flashing (synchronous)
                applyCollapsedState(workspaceId, isCollapsed);
                
                // Create chevron synchronously if needed (no requestAnimationFrame delay)
                if (workspaceIconBox) {
                    let chevron = workspaceIconBox.querySelector(`.zen-collapse-chevron[data-workspace-id="${workspaceId}"]`);
                    
                    // If chevron doesn't exist yet, create it synchronously
                    if (!chevron) {
                        chevron = createChevronIcon();
                        chevron.setAttribute('data-workspace-id', workspaceId);
                        chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)'; // Collapsed = pointing right
                        
                        // Hide original icon children immediately if collapsed
                        const originalChildren = Array.from(workspaceIconBox.children).filter(
                            child => !child.classList.contains('zen-collapse-chevron')
                        );
                        
                        if (isCollapsed) {
                            chevron.style.display = 'block';
                            chevron.style.visibility = 'visible';
                            originalChildren.forEach(child => {
                                child.style.display = 'none';
                            });
                        }
                        
                        // Add click handler
                        chevron.addEventListener('click', (e) => {
                            e.stopPropagation();
                            toggleFolders(workspaceId, chevron, workspaceIconBox);
                        });
                        
                        // Add hover handlers
                        currentIndicator.classList.add('zen-has-collapse-chevron');
                        const handleMouseEnter = () => {
                            const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                            if (!currentCollapsed) {
                                chevron.style.display = 'block';
                                chevron.style.visibility = 'visible';
                                originalChildren.forEach(child => {
                                    if (!child.classList.contains('zen-collapse-chevron')) {
                                        child.style.display = 'none';
                                    }
                                });
                            }
                        };
                        const handleMouseLeave = () => {
                            const currentCollapsed = isWorkspaceCollapsed(workspaceId);
                            if (!currentCollapsed) {
                                chevron.style.display = 'none';
                                originalChildren.forEach(child => {
                                    if (!child.classList.contains('zen-collapse-chevron')) {
                                        child.style.display = '';
                                    }
                                });
                            }
                        };
                        currentIndicator.addEventListener('mouseenter', handleMouseEnter, true);
                        currentIndicator.addEventListener('mouseleave', handleMouseLeave, true);
                        
                        // Insert chevron synchronously
                        workspaceIconBox.appendChild(chevron);
                    }
                }
            }
        }
    }

    // Listen for workspace attached event
    window.addEventListener('ZenWorkspaceAttached', (event) => {
        console.log('[Zen Collapse] ZenWorkspaceAttached event fired');
        
        // Apply state to current workspace immediately to prevent icon flashing
        applyCurrentWorkspaceState();
        
        setTimeout(() => {
            initChevron();
            // Ensure folders are consistent
            closeAllFoldersOnStartup();
        }, 100);
    }, true);
    
    // Listen for workspace changes to update chevron visibility
    window.addEventListener('ZenWorkspacesUIUpdate', () => {
        // Apply state to current workspace immediately to prevent icon flashing
        applyCurrentWorkspaceState();
        
        setTimeout(() => {
            initChevron();
            updateChevronVisibility();
        }, 100);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Use MutationObserver to handle dynamically added content
    const observer = new MutationObserver((mutations) => {
        // Check if workspace indicator was added
        for (const mutation of mutations) {
            // Watch for movingtab attribute changes to clean up animation classes
            if (mutation.type === 'attributes' && mutation.attributeName === 'movingtab') {
                const target = mutation.target;
                if (target.hasAttribute('movingtab')) {
                    console.log('[Zen Collapse] Tab move detected, cleaning animation classes');
                    // Remove animation classes during drag to prevent conflicts
                    const allItems = document.querySelectorAll('.zen-collapse-anim-target');
                    allItems.forEach(item => {
                        item.classList.remove('zen-collapse-anim-target');
                    });
                }
            }
            
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if it's a workspace element or contains one
                    if (node.matches && (
                        node.matches('zen-workspace') ||
                        node.matches('.zen-current-workspace-indicator') ||
                        node.querySelector('.zen-current-workspace-indicator')
                    )) {
                        setTimeout(initChevron, 50);
                        return;
                    }
                }
            }
        }
        
        // Also check for existing workspace indicators that don't have chevrons yet
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
            setTimeout(initChevron, 50);
        }
    });

    // Start observing when document is ready
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

    // Also add CSS for smooth transitions
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
        /* Disable transitions during drag to avoid conflicts with Zen's drag animations */
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
        /* Immediately hide original icon when workspace is collapsed (prevents flash) */
        .zen-current-workspace-indicator[data-zen-collapsed="true"] .zen-current-workspace-indicator-icon > :not(.zen-collapse-chevron) {
            display: none !important;
        }
        /* Show chevron when collapsed */
        .zen-current-workspace-indicator[data-zen-collapsed="true"] .zen-collapse-chevron {
            display: block !important;
            visibility: visible !important;
        }
        /* Hide chevron when icon picker is open (even if collapsed) */
        .zen-current-workspace-indicator[data-zen-icon-picker-open="true"] .zen-collapse-chevron {
            display: none !important;
            visibility: hidden !important;
        }
        /* Show icon when picker is open (even if collapsed) */
        .zen-current-workspace-indicator[data-zen-icon-picker-open="true"] .zen-current-workspace-indicator-icon > :not(.zen-collapse-chevron) {
            display: block !important;
            visibility: visible !important;
        }
        .zen-current-workspace-indicator-icon {
            position: relative;
        }
        /* Workspace indicator spacing (moved from chrome.css) */
        .zen-current-workspace-indicator .zen-current-workspace-indicator-icon {
            margin-bottom: 4px !important;
        }
        .zen-current-workspace-indicator .zen-current-workspace-indicator-name {
            margin-bottom: 2px !important;
        }
    `;
    document.head.appendChild(style);

})();

