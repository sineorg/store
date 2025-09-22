// ==UserScript==
// @ignorecache
// @name          Ai tab sort and tab clearer
// @description    sorts tab and arrange them into tab groups
// ==/UserScript==

(() => {
  const CONFIG = {
    SIMILARITY_THRESHOLD: 0.45,
    GROUP_SIMILARITY_THRESHOLD: 0.75,
    MIN_TABS_FOR_SORT: 6,
    DEBOUNCE_DELAY: 250,
    ANIMATION_DURATION: 800,
    CLEAR_ANIMATION_DURATION: 600,
    MAX_INIT_CHECKS: 50,
    INIT_CHECK_INTERVAL: 100,
    CONSOLIDATION_DISTANCE_THRESHOLD: 2,
    EMBEDDING_BATCH_SIZE: 5,
  };

  // --- Globals & State ---
  let isSorting = false;
  let isClearing = false;
  let sortButtonListenerAdded = false;
  let clearButtonListenerAdded = false;
  let sortAnimationId = null;
  let eventListenersAdded = false;

  // DOM Cache for performance
  const domCache = {
    separators: null,
    commandSet: null,

    getSeparators() {
      if (!this.separators || !this.separators.length) {
        this.separators = document.querySelectorAll(
          ".pinned-tabs-container-separator"
        );
      }
      return this.separators;
    },

    getCommandSet() {
      if (!this.commandSet) {
        this.commandSet = document.querySelector("commandset#zenCommandSet");
      }
      return this.commandSet;
    },

    invalidate() {
      this.separators = null;
      this.commandSet = null;
    },
  };

  // --- Helper Functions ---

  // Optimized tab filtering function
  const getFilteredTabs = (workspaceId, options = {}) => {
    if (!workspaceId || typeof gBrowser === "undefined" || !gBrowser.tabs) {
      return [];
    }

    const {
      includeGrouped = false,
      includeSelected = true,
      includePinned = false,
      includeEmpty = false,
      includeGlance = false,
    } = options;

    return Array.from(gBrowser.tabs).filter((tab) => {
      if (!tab?.isConnected) return false;

      const isInCorrectWorkspace =
        tab.getAttribute("zen-workspace-id") === workspaceId;
      if (!isInCorrectWorkspace) return false;

      const groupParent = tab.closest("tab-group");
      const isInGroup = !!groupParent;

      return (
        (includePinned || !tab.pinned) &&
        (includeGrouped || !isInGroup) &&
        (includeSelected || !tab.selected) &&
        (includeEmpty || !tab.hasAttribute("zen-empty-tab")) &&
        (includeGlance || !tab.hasAttribute("zen-glance-tab"))
      );
    });
  };

  const getTabTitle = (tab) => {
    if (!tab?.isConnected) {
      return "Invalid Tab";
    }
    try {
      const originalTitle =
        tab.getAttribute("label") ||
        tab.querySelector(".tab-label, .tab-text")?.textContent ||
        "";

      if (
        !originalTitle ||
        originalTitle === "New Tab" ||
        originalTitle === "about:blank" ||
        originalTitle === "Loading..." ||
        originalTitle.startsWith("http:") ||
        originalTitle.startsWith("https:")
      ) {
        const browser =
          tab.linkedBrowser ||
          tab._linkedBrowser ||
          gBrowser?.getBrowserForTab?.(tab);

        if (
          browser?.currentURI?.spec &&
          !browser.currentURI.spec.startsWith("about:")
        ) {
          try {
            const currentURL = new URL(browser.currentURI.spec);
            const hostname = currentURL.hostname.replace(/^www\./, "");
            if (
              hostname &&
              hostname !== "localhost" &&
              hostname !== "127.0.0.1"
            ) {
              return hostname;
            }
            const pathSegment = currentURL.pathname.split("/")[1];
            if (pathSegment) return pathSegment;
          } catch {
            /* ignore */
          }
        }
        return "Untitled Page";
      }
      return originalTitle.trim() || "Untitled Page";
    } catch (e) {
      console.error("Error getting tab title for tab:", tab, e);
      return "Error Processing Tab";
    }
  };

  const toTitleCase = (str) => {
    if (!str || typeof str !== "string") return "";
    return str
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const levenshteinDistance = (a, b) => {
    if (!a || !b || typeof a !== "string" || typeof b !== "string") {
      return Math.max(a?.length ?? 0, b?.length ?? 0);
    }
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // Deletion
          matrix[i][j - 1] + 1, // Insertion
          matrix[i - 1][j - 1] + cost // Substitution
        );
      }
    }
    return matrix[b.length][a.length];
  };

  const findGroupElement = (topicName, workspaceId) => {
    if (!topicName || typeof topicName !== "string" || !workspaceId)
      return null;

    const sanitizedTopicName = topicName.trim();
    if (!sanitizedTopicName) return null;

    const safeSelectorTopicName = sanitizedTopicName
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    try {
      return document.querySelector(
        `tab-group[label="${safeSelectorTopicName}"][zen-workspace-id="${workspaceId}"]`
      );
    } catch (e) {
      console.error(
        `Error finding group selector for "${sanitizedTopicName}":`,
        e
      );
      return null;
    }
  };

  // --- AI Interaction ---

  // Helper function to average embeddings
  function averageEmbedding(arrays) {
    if (!Array.isArray(arrays) || arrays.length === 0) return [];
    // If already a flat array, just return it
    if (typeof arrays[0] === "number") return arrays;
    // Otherwise, average across all arrays
    const len = arrays[0].length;
    const avg = new Array(len).fill(0);
    for (const arr of arrays) {
      for (let i = 0; i < len; i++) {
        avg[i] += arr[i];
      }
    }
    for (let i = 0; i < len; i++) {
      avg[i] /= arrays.length;
    }
    return avg;
  }

  // Cosine similarity function
  function cosineSimilarity(a, b) {
    // Guard: ensure both a and b are defined, arrays, and contain numbers
    if (
      !Array.isArray(a) ||
      !Array.isArray(b) ||
      a.length !== b.length ||
      a.length === 0
    )
      return 0;
    if (typeof a[0] !== "number" || typeof b[0] !== "number") return 0;
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Improved greedy clustering with input validation
  function clusterEmbeddings(vectors, threshold = CONFIG.SIMILARITY_THRESHOLD) {
    if (
      !Array.isArray(vectors) ||
      vectors.length === 0 ||
      typeof threshold !== "number"
    ) {
      return [];
    }

    const groups = [];
    const used = new Array(vectors.length).fill(false);

    for (let i = 0; i < vectors.length; i++) {
      if (used[i]) continue;
      const group = [i];
      used[i] = true;

      for (let j = 0; j < vectors.length; j++) {
        if (
          i !== j &&
          !used[j] &&
          cosineSimilarity(vectors[i], vectors[j]) > threshold
        ) {
          group.push(j);
          used[j] = true;
        }
      }
      groups.push(group);
    }
    return groups;
  }

  // Batch storage operations for better performance
  const batchStorageOperations = (operations) => {
    if (!Array.isArray(operations) || operations.length === 0) return;

    try {
      operations.forEach(({ type, key, value }) => {
        if (type === "set" && key && value) {
          UC_API.SharedStorage.set(key, value);
        } else if (type === "get" && key) {
          return UC_API.SharedStorage.get(key);
        }
      });
    } catch (e) {
      console.error("[TabSort][Storage] Batch operation failed:", e);
    }
  };

  // SharedStorage helper functions with input validation
  const getStoredGroups = () => {
    try {
      if (!UC_API?.SharedStorage?.getKeys) return {};

      const keys = UC_API.SharedStorage.getKeys();
      const groups = {};

      keys.forEach((key) => {
        if (typeof key === "string" && key.startsWith("GroupData_")) {
          const groupData = UC_API.SharedStorage.get(key);
          if (groupData && typeof groupData === "object") {
            groups[key] = groupData;
          }
        }
      });
      return groups;
    } catch (e) {
      console.error("[TabSort][Storage] Error getting stored groups:", e);
      return {};
    }
  };

  const saveGroupData = (groupId, groupName, tabIds, averageEmbedding) => {
    if (!groupId || !groupName || !Array.isArray(tabIds)) {
      console.error("[TabSort][Storage] Invalid parameters for saveGroupData");
      return;
    }

    try {
      const groupData = {
        groupName: String(groupName),
        tabIds: [...tabIds],
        embeddings: Array.isArray(averageEmbedding)
          ? [...averageEmbedding]
          : [],
        lastUpdated: Date.now(),
      };
      UC_API.SharedStorage.set(`GroupData_${groupId}`, groupData);
    } catch (e) {
      console.error("[TabSort][Storage] Error saving group data:", e);
    }
  };

  const updateGroupTabIds = (groupId, newTabIds) => {
    if (!groupId || !Array.isArray(newTabIds)) return;

    try {
      const key = `GroupData_${groupId}`;
      const groupData = UC_API.SharedStorage.get(key);
      if (groupData && typeof groupData === "object") {
        groupData.tabIds = [
          ...new Set([...(groupData.tabIds || []), ...newTabIds]),
        ];
        groupData.lastUpdated = Date.now();
        UC_API.SharedStorage.set(key, groupData);
      }
    } catch (e) {
      console.error("[TabSort][Storage] Error updating group tab IDs:", e);
    }
  };

  // Process embeddings in batches for better performance
  const processTabsInBatches = async (
    tabs,
    batchSize = CONFIG.EMBEDDING_BATCH_SIZE
  ) => {
    if (!Array.isArray(tabs) || tabs.length === 0) return [];

    const results = [];
    for (let i = 0; i < tabs.length; i += batchSize) {
      const batch = tabs.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((tab) => generateEmbedding(getTabTitle(tab)))
      );
      results.push(...batchResults);
    }
    return results;
  };

  const generateEmbedding = async (title) => {
    if (!title || typeof title !== "string") return null;

    try {
      const { createEngine } = ChromeUtils.importESModule(
        "chrome://global/content/ml/EngineProcess.sys.mjs"
      );
      const engine = await createEngine({
        taskName: "feature-extraction",
        modelId: "Mozilla/smart-tab-embedding",
        modelHub: "huggingface",
        engineId: "embedding-engine",
      });

      const result = await engine.run({ args: [title] });
      let embedding;

      if (result?.[0]?.embedding && Array.isArray(result[0].embedding)) {
        embedding = result[0].embedding;
      } else if (result?.[0] && Array.isArray(result[0])) {
        embedding = result[0];
      } else if (Array.isArray(result)) {
        embedding = result;
      } else {
        return null;
      }

      const pooled = averageEmbedding(embedding);
      if (
        Array.isArray(pooled) &&
        pooled.length > 0 &&
        typeof pooled[0] === "number"
      ) {
        // Normalize the embedding
        const norm = Math.sqrt(pooled.reduce((sum, v) => sum + v * v, 0));
        return norm === 0 ? pooled : pooled.map((v) => v / norm);
      }
      return null;
    } catch (e) {
      console.error("[TabSort][AI] Error generating embedding:", e);
      return null;
    }
  };

  const askAIForMultipleTopics = async (tabs) => {
    if (!Array.isArray(tabs) || tabs.length === 0) return [];

    const validTabs = tabs.filter((tab) => tab?.isConnected);
    if (!validTabs.length) return [];

    // Get stored groups
    const storedGroups = getStoredGroups();
    const result = [];
    const ungroupedTabs = [];

    // Process tabs in batches for better performance
    const tabTitles = validTabs.map((tab) => getTabTitle(tab));
    const embeddings = await processTabsInBatches(validTabs);

    // First pass: try to match tabs to existing groups
    for (let i = 0; i < validTabs.length; i++) {
      const tab = validTabs[i];
      const tabEmbedding = embeddings[i];

      if (!tabEmbedding) {
        ungroupedTabs.push(tab);
        continue;
      }

      let bestMatch = null;
      let bestSimilarity = 0;

      // Compare against stored groups
      for (const [groupKey, groupData] of Object.entries(storedGroups)) {
        if (!Array.isArray(groupData?.embeddings)) continue;

        const similarity = cosineSimilarity(tabEmbedding, groupData.embeddings);
        if (
          similarity > CONFIG.GROUP_SIMILARITY_THRESHOLD &&
          similarity > bestSimilarity
        ) {
          bestMatch = { groupKey, groupData, similarity };
          bestSimilarity = similarity;
        }
      }

      if (bestMatch) {
        // Add tab to existing group
        result.push({ tab, topic: bestMatch.groupData.groupName });
        // Update stored group with new tab ID
        const tabId =
          tab.getAttribute("zen-tab-id") ||
          tab.linkedPanel ||
          Math.random().toString(36);
        updateGroupTabIds(bestMatch.groupKey.replace("GroupData_", ""), [
          tabId,
        ]);
      } else {
        ungroupedTabs.push(tab);
      }
    }

    // Second pass: cluster remaining ungrouped tabs
    if (ungroupedTabs.length > 1) {
      const ungroupedEmbeddings = await processTabsInBatches(ungroupedTabs);

      // Filter out empty embeddings
      const validEmbeddings = ungroupedEmbeddings.filter(
        (emb) => Array.isArray(emb) && emb.length > 0
      );
      const validIndices = ungroupedEmbeddings
        .map((emb, idx) => (Array.isArray(emb) && emb.length > 0 ? idx : -1))
        .filter((idx) => idx !== -1);

      if (validEmbeddings.length > 1) {
        // Cluster the ungrouped tabs
        const allGroups = clusterEmbeddings(
          validEmbeddings,
          CONFIG.SIMILARITY_THRESHOLD
        );
        const groups = allGroups.filter(
          (group) => Array.isArray(group) && group.length > 1
        );

        if (groups.length > 0) {
          // Extract keywords function
          function extractKeywords(titles) {
            const allWords = titles
              .join(" ")
              .toLowerCase()
              .replace(/[^\w\s]/g, " ")
              .split(/\s+/)
              .filter((word) => word.length > 2);

            const wordCount = {};
            allWords.forEach((word) => {
              wordCount[word] = (wordCount[word] || 0) + 1;
            });

            const stopWords = new Set([
              "the",
              "and",
              "for",
              "are",
              "but",
              "not",
              "you",
              "all",
              "can",
              "had",
              "her",
              "was",
              "one",
              "our",
              "out",
              "day",
              "get",
              "has",
              "him",
              "his",
              "how",
              "man",
              "new",
              "now",
              "old",
              "see",
              "two",
              "way",
              "who",
              "boy",
              "did",
              "its",
              "let",
              "put",
              "say",
              "she",
              "too",
              "use",
            ]);

            const keywords = Object.entries(wordCount)
              .filter(([word]) => !stopWords.has(word))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([word]) => word);

            return keywords;
          }

          // Group naming function
          async function nameGroupWithSmartTabTopic(titles) {
            const keywords = extractKeywords(titles);
            const input = `Topic from keywords: ${keywords.join(
              ", "
            )}. titles:\n${titles.join("\n")}`;

            try {
              const { createEngine } = ChromeUtils.importESModule(
                "chrome://global/content/ml/EngineProcess.sys.mjs"
              );
              let engine = await createEngine({
                taskName: "text2text-generation",
                modelId: "Mozilla/smart-tab-topic",
                modelHub: "huggingface",
                engineId: "group-namer",
              });

              const aiResult = await engine.run({
                args: [input],
                options: { max_new_tokens: 8, temperature: 0.7 },
              });

              let name = (aiResult[0]?.generated_text || "Group")
                .split("\n")
                .map((l) => l.trim())
                .find((l) => l);

              name = toTitleCase(name);
              if (!name || /none|adult content/i.test(name)) {
                name = titles[0].split("–")[0].trim().slice(0, 24);
              }

              name = name
                .replace(/^['"`]+|['"`]+$/g, "")
                .replace(/[.?!,:;]+$/, "")
                .slice(0, 24);
              return name || "Group";
            } catch (e) {
              console.error("[TabSort][AI] Error naming group:", e);
              return "Group";
            }
          }

          // Process each new group
          for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
            const group = groups[groupIdx];
            const groupTabs = group.map(
              (idx) => ungroupedTabs[validIndices[idx]]
            );
            const groupTitles = groupTabs.map((tab) => getTabTitle(tab));
            const groupName = await nameGroupWithSmartTabTopic(groupTitles);

            // Calculate average embedding for the group
            const groupEmbeddings = group.map((idx) => validEmbeddings[idx]);
            const avgEmbedding = averageEmbedding(groupEmbeddings);

            // Generate unique group ID
            const groupId = `${groupName.replace(
              /\s+/g,
              "_"
            )}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            // Get tab IDs
            const tabIds = groupTabs.map(
              (tab) =>
                tab.getAttribute("zen-tab-id") ||
                tab.linkedPanel ||
                Math.random().toString(36)
            );

            // Save group data to SharedStorage
            saveGroupData(groupId, groupName, tabIds, avgEmbedding);

            // Add to result
            groupTabs.forEach((tab) => {
              result.push({ tab, topic: groupName });
            });
          }
        }
      }
    }

    return result;
  };

  // Animation cleanup utility
  const cleanupAnimation = () => {
    if (sortAnimationId !== null) {
      cancelAnimationFrame(sortAnimationId);
      sortAnimationId = null;

      try {
        const activeSeparator = document.querySelector(
          ".pinned-tabs-container-separator:not(.has-no-sortable-tabs)"
        );
        const pathElement = activeSeparator?.querySelector("#separator-path");
        if (pathElement) {
          pathElement.setAttribute("d", "M 0 1 L 100 1");
        }
      } catch (resetError) {
        console.error("Error resetting animation:", resetError);
      }
    }
  };

  // Batch DOM operations for better performance
  const batchDOMUpdates = (operations) => {
    if (!Array.isArray(operations) || operations.length === 0) return;

    // Use document fragment for batching when possible
    const fragment = document.createDocumentFragment();

    try {
      operations.forEach((operation) => {
        if (typeof operation === "function") {
          operation(fragment);
        }
      });
    } catch (error) {
      console.error("Error in batch DOM operations:", error);
    }
  };

  // --- Main Sorting Function ---
  const sortTabsByTopic = async () => {
    if (isSorting) return;
    isSorting = true;

    let separatorsToSort = [];
    try {
      separatorsToSort = domCache.getSeparators();
      // Apply visual indicator
      if (separatorsToSort.length > 0) {
        batchDOMUpdates([
          () =>
            separatorsToSort.forEach((sep) => {
              if (sep?.isConnected) {
                sep.classList.add("separator-is-sorting");
              }
            }),
        ]);
      }

      const currentWorkspaceId = window.gZenWorkspaces?.activeWorkspace;
      if (!currentWorkspaceId) {
        console.error("Cannot get current workspace ID.");
        return; // Exit early
      }

      // --- Step 1: Get ALL Existing Group Names for Context ---
      const allExistingGroupNames = new Set();
      const groupSelector = `tab-group:has(tab[zen-workspace-id="${currentWorkspaceId}"])`;

      document.querySelectorAll(groupSelector).forEach((groupEl) => {
        const label = groupEl.getAttribute("label");
        if (label) {
          allExistingGroupNames.add(label);
        }
      });

      // --- Filter initial tabs using optimized function ---
      const initialTabsToSort = getFilteredTabs(currentWorkspaceId, {
        includeGrouped: false,
        includeSelected: true,
        includePinned: false,
        includeEmpty: false,
        includeGlance: false,
      }).filter((tab) => {
        const groupParent = tab.closest("tab-group");
        const isInGroupInCorrectWorkspace = groupParent
          ? groupParent.matches(groupSelector)
          : false;
        return !isInGroupInCorrectWorkspace;
      });

      if (initialTabsToSort.length === 0) {
        return;
      }

      // --- AI Grouping ---

      const aiTabTopics = await askAIForMultipleTopics(initialTabsToSort);
      // --- End AI Grouping ---

      // --- Create Final Groups ---
      const finalGroups = {};
      aiTabTopics.forEach(({ tab, topic }) => {
        if (!topic || topic === "Uncategorized" || !tab || !tab.isConnected) {
          return;
        }
        if (!finalGroups[topic]) {
          finalGroups[topic] = [];
        }
        finalGroups[topic].push(tab);
      });

      // Single-tab groups are already filtered out at the clustering level
      // --- End Create Final Groups ---

      // --- Consolidate Similar Category Names ---
      const originalKeys = Object.keys(finalGroups);
      const mergedKeys = new Set();
      const consolidationMap = {};

      for (let i = 0; i < originalKeys.length; i++) {
        let keyA = originalKeys[i];
        if (mergedKeys.has(keyA)) continue;
        while (consolidationMap[keyA]) {
          keyA = consolidationMap[keyA];
        }
        if (mergedKeys.has(keyA)) continue;

        for (let j = i + 1; j < originalKeys.length; j++) {
          let keyB = originalKeys[j];
          if (mergedKeys.has(keyB)) continue;
          while (consolidationMap[keyB]) {
            keyB = consolidationMap[keyB];
          }
          if (mergedKeys.has(keyB) || keyA === keyB) continue;

          const distance = levenshteinDistance(keyA, keyB);
          const threshold = CONFIG.CONSOLIDATION_DISTANCE_THRESHOLD;

          if (distance <= threshold && distance > 0) {
            let canonicalKey = keyA;
            let mergedKey = keyB;
            const keyAIsActuallyExisting = allExistingGroupNames.has(keyA);
            const keyBIsActuallyExisting = allExistingGroupNames.has(keyB);

            if (keyBIsActuallyExisting && !keyAIsActuallyExisting) {
              [canonicalKey, mergedKey] = [keyB, keyA];
            } else if (keyAIsActuallyExisting && keyBIsActuallyExisting) {
              if (keyA.length > keyB.length)
                [canonicalKey, mergedKey] = [keyB, keyA];
            } else if (!keyAIsActuallyExisting && !keyBIsActuallyExisting) {
              if (keyA.length > keyB.length)
                [canonicalKey, mergedKey] = [keyB, keyA];
            }

            if (finalGroups[mergedKey]) {
              if (!finalGroups[canonicalKey]) finalGroups[canonicalKey] = [];
              const uniqueTabsToAdd = finalGroups[mergedKey].filter(
                (tab) =>
                  tab &&
                  tab.isConnected &&
                  !finalGroups[canonicalKey].some(
                    (existingTab) => existingTab === tab
                  )
              );
              finalGroups[canonicalKey].push(...uniqueTabsToAdd);
            }
            mergedKeys.add(mergedKey);
            consolidationMap[mergedKey] = canonicalKey;
            delete finalGroups[mergedKey];
            if (mergedKey === keyA) {
              keyA = canonicalKey;
              break;
            }
          }
        }
      }

      // --- End Consolidation ---

      if (Object.keys(finalGroups).length === 0) {
        return;
      }

      // --- Get existing group ELEMENTS ---
      const existingGroupElementsMap = new Map();
      document.querySelectorAll(groupSelector).forEach((groupEl) => {
        const label = groupEl.getAttribute("label");
        if (label) {
          existingGroupElementsMap.set(label, groupEl);
        }
      });

      // --- Process each final, consolidated group ---
      for (const topic in finalGroups) {
        const tabsForThisTopic = finalGroups[topic].filter((t) => {
          const groupParent = t.closest("tab-group");
          const isInGroupInCorrectWorkspace = groupParent
            ? groupParent.matches(groupSelector)
            : false;
          return t && t.isConnected && !isInGroupInCorrectWorkspace;
        });

        if (tabsForThisTopic.length === 0) {
          continue;
        }

        const existingGroupElement = existingGroupElementsMap.get(topic);

        if (existingGroupElement && existingGroupElement.isConnected) {
          try {
            if (existingGroupElement.getAttribute("collapsed") === "true") {
              existingGroupElement.setAttribute("collapsed", "false");
              const groupLabelElement =
                existingGroupElement.querySelector(".tab-group-label");
              if (groupLabelElement) {
                groupLabelElement.setAttribute("aria-expanded", "true");
              }
            }
            for (const tab of tabsForThisTopic) {
              const groupParent = tab.closest("tab-group");
              const isInGroupInCorrectWorkspace = groupParent
                ? groupParent.matches(groupSelector)
                : false;
              if (tab && tab.isConnected && !isInGroupInCorrectWorkspace) {
                gBrowser.moveTabToGroup(tab, existingGroupElement);
              } else {
                console.warn(
                  ` -> Tab "${
                    getTabTitle(tab) || "Unknown"
                  }" skipped moving to "${topic}" (already grouped or invalid).`
                );
              }
            }
          } catch (e) {
            console.error(
              `Error moving tabs to existing group "${topic}":`,
              e,
              existingGroupElement
            );
          }
        } else {
          if (existingGroupElement && !existingGroupElement.isConnected) {
            console.warn(
              ` -> Existing group element for "${topic}" was found in map but is no longer connected to DOM. Will create a new group.`
            );
          }

          // Create group for any topic with tabs
          if (tabsForThisTopic.length > 0) {
            const firstValidTabForGroup = tabsForThisTopic[0];
            const groupOptions = {
              label: topic,
              insertBefore: firstValidTabForGroup,
            };
            try {
              const newGroup = gBrowser.addTabGroup(
                tabsForThisTopic,
                groupOptions
              );
              if (newGroup && newGroup.isConnected) {
                existingGroupElementsMap.set(topic, newGroup);

                // Try to set group color to average favicon if advanced-tab-groups is available
                try {
                  if (typeof newGroup._useFaviconColor === "function") {
                    setTimeout(() => newGroup._useFaviconColor(), 500);
                  }
                } catch (e) {
                  // Silently ignore if advanced-tab-groups is not installed
                }
              } else {
                console.warn(
                  ` -> addTabGroup didn't return a connected element for "${topic}". Attempting fallback find.`
                );
                // Use the CORRECT findGroupElement helper from clear script (needs to be added/updated)
                const newGroupElFallback = findGroupElement(
                  topic,
                  currentWorkspaceId
                );
                if (newGroupElFallback && newGroupElFallback.isConnected) {
                  existingGroupElementsMap.set(topic, newGroupElFallback);

                  // Try to set group color to average favicon if advanced-tab-groups is available
                  try {
                    if (
                      typeof newGroupElFallback._useFaviconColor === "function"
                    ) {
                      setTimeout(
                        () => newGroupElFallback._useFaviconColor(),
                        500
                      );
                    }
                  } catch (e) {
                    // Silently ignore if advanced-tab-groups is not installed
                  }
                } else {
                  console.error(
                    ` -> Failed to find the newly created group element for "${topic}" even with fallback.`
                  );
                }
              }
            } catch (e) {
              console.error(
                `Error calling gBrowser.addTabGroup for topic "${topic}":`,
                e
              );
              const groupAfterError = findGroupElement(
                topic,
                currentWorkspaceId
              );
              if (groupAfterError && groupAfterError.isConnected) {
                console.warn(
                  ` -> Group "${topic}" might exist despite error. Found via findGroupElement.`
                );
                existingGroupElementsMap.set(topic, groupAfterError);

                // Try to set group color to average favicon if advanced-tab-groups is available
                try {
                  if (typeof groupAfterError._useFaviconColor === "function") {
                    setTimeout(() => groupAfterError._useFaviconColor(), 500);
                  }
                } catch (e) {
                  // Silently ignore if advanced-tab-groups is not installed
                }
              } else {
                console.error(
                  ` -> Failed to find group "${topic}" after creation error.`
                );
              }
            }
          } else {
          }
        }
      } // End loop through final groups
    } catch (error) {
      console.error("Error during overall sorting process:", error);
    } finally {
      isSorting = false;

      // Cleanup animation
      cleanupAnimation();

      // Remove separator pulse indicator
      if (separatorsToSort.length > 0) {
        batchDOMUpdates([
          () =>
            separatorsToSort.forEach((sep) => {
              if (sep?.isConnected) {
                sep.classList.remove("separator-is-sorting");
              }
            }),
        ]);
      }

      // Remove tab loading indicators and update button visibility
      setTimeout(() => {
        batchDOMUpdates([
          () => {
            if (typeof gBrowser !== "undefined" && gBrowser.tabs) {
              Array.from(gBrowser.tabs).forEach((tab) => {
                if (tab?.isConnected) {
                  tab.classList.remove("tab-is-sorting");
                }
              });
            }
          },
        ]);
        updateButtonsVisibilityState();
      }, 500);
    }
  };

  // --- New function to clear ungrouped tabs ---
  const clearUngroupedTabs = () => {
    if (isClearing) return;
    isClearing = true;

    try {
      const currentWorkspaceId = window.gZenWorkspaces?.activeWorkspace;
      if (!currentWorkspaceId) {
        console.error("Cannot get current workspace ID.");
        return;
      }

      // Get tabs using optimized filtering
      const tabsToClose = getFilteredTabs(currentWorkspaceId, {
        includeGrouped: false,
        includeSelected: false,
        includePinned: false,
        includeEmpty: false,
        includeGlance: false,
      });

      if (tabsToClose.length === 0) return;

      // Close the tabs in reverse order to avoid index shifting issues
      const reversedTabs = [...tabsToClose].reverse();

      batchDOMUpdates([
        () => {
          reversedTabs.forEach((tab) => {
            try {
              if (
                tab?.isConnected &&
                typeof gBrowser?.removeTab === "function"
              ) {
                gBrowser.removeTab(tab);
              }
            } catch (e) {
              console.error("Error closing tab:", e);
            }
          });
        },
      ]);
    } catch (error) {
      console.error("Error during tab clearing process:", error);
    } finally {
      isClearing = false;

      // Update button visibility immediately after clearing is complete
      setTimeout(() => {
        updateButtonsVisibilityState();
      }, 50);
    }
  };

  // --- Button Initialization & Workspace Handling ---
  function ensureSortButtonExists(separator) {
    if (!separator) {
      return;
    }
    try {
      // --- Create and Insert SVG with SINGLE Path ---
      if (!separator.querySelector("svg.separator-line-svg")) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "separator-line-svg");
        svg.setAttribute("viewBox", "0 0 100 2");
        svg.setAttribute("preserveAspectRatio", "none");

        // Create ONE path
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("id", `separator-path`); // Single ID
        path.setAttribute("class", "separator-path-segment"); // Keep common class
        path.setAttribute("d", "M 0 1 L 100 1"); // Initial straight line
        path.style.fill = "none";
        path.style.opacity = "1"; // Ensure it's visible
        path.setAttribute("stroke-width", "1"); // Added: Set initial stroke width
        path.setAttribute("stroke-linecap", "round"); // Added: Make path ends round
        svg.appendChild(path);

        separator.insertBefore(svg, separator.firstChild);
      } else {
      }
      // --- End SVG ---

      // --- Create and Append Sort Button ---
      if (!separator.querySelector("#sort-button")) {
        const buttonFragment = window.MozXULElement.parseXULToFragment(`
                        <toolbarbutton
                            id="sort-button"
                            class="sort-button-with-icon"
                            command="cmd_zenSortTabs"
                            tooltiptext="Sort Tabs into Groups by Topic (AI)">
                            <hbox class="toolbarbutton-box" align="center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 28 28" class="broom-icon">
                                    <g>
                                        <path d="M19.9132 21.3765C19.8875 21.0162 19.6455 20.7069 19.3007 20.5993L7.21755 16.8291C6.87269 16.7215 6.49768 16.8384 6.27165 17.1202C5.73893 17.7845 4.72031 19.025 3.78544 19.9965C2.4425 21.392 3.01177 22.4772 4.66526 22.9931C4.82548 23.0431 5.78822 21.7398 6.20045 21.7398C6.51906 21.8392 6.8758 23.6828 7.26122 23.8031C7.87402 23.9943 8.55929 24.2081 9.27891 24.4326C9.59033 24.5298 10.2101 23.0557 10.5313 23.1559C10.7774 23.2327 10.7236 24.8834 10.9723 24.961C11.8322 25.2293 12.699 25.4997 13.5152 25.7544C13.868 25.8645 14.8344 24.3299 15.1637 24.4326C15.496 24.5363 15.191 26.2773 15.4898 26.3705C16.7587 26.7664 17.6824 27.0546 17.895 27.1209C19.5487 27.6369 20.6333 27.068 20.3226 25.1563C20.1063 23.8255 19.9737 22.2258 19.9132 21.3765Z" fill="currentColor" stroke="none"/>
                                        <path d="M16.719 1.7134C17.4929-0.767192 20.7999 0.264626 20.026 2.74523C19.2521 5.22583 18.1514 8.75696 17.9629 9.36C17.7045 10.1867 16.1569 15.1482 15.899 15.9749L19.2063 17.0068C20.8597 17.5227 20.205 19.974 18.4514 19.4268L8.52918 16.331C6.87208 15.8139 7.62682 13.3938 9.28426 13.911L12.5916 14.9429C12.8495 14.1163 14.3976 9.15491 14.6555 8.32807C14.9135 7.50122 15.9451 4.19399 16.719 1.7134Z" fill="currentColor" stroke="none"/>
                                    </g>
                                </svg>
                            </hbox>
                        </toolbarbutton>
                    `);
        const buttonNode = buttonFragment.firstChild.cloneNode(true);

        separator.appendChild(buttonNode);
      } else {
      }
      // --- End Sort Button ---

      // --- Create and Append Clear Button ---
      if (!separator.querySelector("#clear-button")) {
        const clearButtonFragment = window.MozXULElement.parseXULToFragment(`
                        <toolbarbutton
                            id="clear-button"
                            class="clear-button-with-icon"
                            command="cmd_zenClearTabs"
                            tooltiptext="Close All Ungrouped Tabs (Except Selected)">
                            <hbox class="toolbarbutton-box" align="center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" class="arrow-icon">
                                    <path d="M12 2v18m-7-6l7 8 7-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <label class="toolbarbutton-text" value="Clear" crop="right"/>
                            </hbox>
                        </toolbarbutton>
                    `);
        const clearButtonNode = clearButtonFragment.firstChild.cloneNode(true);

        separator.appendChild(clearButtonNode);
      } else {
      }
      // --- End Clear Button ---
    } catch (e) {}
  }

  function addSortButtonToAllSeparators() {
    const separators = domCache.getSeparators();
    if (separators.length > 0) {
      separators.forEach(ensureSortButtonExists);
      updateButtonsVisibilityState();
    } else {
      const periphery = document.querySelector(
        "#tabbrowser-arrowscrollbox-periphery"
      );
      if (periphery && !periphery.querySelector("#sort-button")) {
        ensureSortButtonExists(periphery);
      }
    }
    updateButtonsVisibilityState();
  }

  function setupSortCommandAndListener() {
    const zenCommands = domCache.getCommandSet();
    if (!zenCommands) return;

    // Add Sort command
    if (!zenCommands.querySelector("#cmd_zenSortTabs")) {
      try {
        const command = window.MozXULElement.parseXULToFragment(
          `<command id="cmd_zenSortTabs"/>`
        ).firstChild;
        zenCommands.appendChild(command);
      } catch (e) {}
    }

    // Add Clear command
    if (!zenCommands.querySelector("#cmd_zenClearTabs")) {
      try {
        const clearCommand = window.MozXULElement.parseXULToFragment(
          `<command id="cmd_zenClearTabs"/>`
        ).firstChild;
        zenCommands.appendChild(clearCommand);
      } catch (e) {}
    }

    // Add Sort button listener
    if (!sortButtonListenerAdded) {
      try {
        zenCommands.addEventListener("command", (event) => {
          if (event.target.id === "cmd_zenSortTabs") {
            // Add brushing animation class
            const sortButton = document.querySelector("#sort-button");
            if (sortButton) {
              sortButton.classList.add("brushing");
              // Remove class after animation completes
              setTimeout(() => {
                if (sortButton?.isConnected) {
                  sortButton.classList.remove("brushing");
                }
              }, CONFIG.ANIMATION_DURATION);
            }

            // Prevent starting animation if already running
            if (sortAnimationId !== null) return;

            // Try finding the active separator directly
            const separators = domCache.getSeparators();
            let separator = null;
            for (const sep of separators) {
              if (
                sep?.isConnected &&
                !sep.classList.contains("has-no-sortable-tabs")
              ) {
                separator = sep;
                break;
              }
            }

            if (!separator) {
              sortTabsByTopic(); // Still run sort even if animation fails
              return;
            }

            // --- Start Animation logic ---
            const pathElement = separator.querySelector("#separator-path");
            if (pathElement) {
              const maxAmplitude = 3;
              const frequency = 8;
              const segments = 50;
              const growthDuration = 500;
              let t = 0;
              let startTime = performance.now();

              function animateWaveLoop(timestamp) {
                // Check if animation should continue
                if (sortAnimationId === null) return;

                const elapsedTime = timestamp - startTime;
                const growthProgress = Math.min(
                  elapsedTime / growthDuration,
                  1
                );
                const currentAmplitude = maxAmplitude * growthProgress;

                t += 0.5;

                const points = [];
                for (let i = 0; i <= segments; i++) {
                  const x = (i / segments) * 100;
                  const y =
                    1 +
                    currentAmplitude *
                      Math.sin((x / (100 / frequency)) * 2 * Math.PI + t * 0.1);
                  points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
                }

                if (pathElement?.isConnected) {
                  const pathData = "M" + points.join(" L");
                  pathElement.setAttribute("d", pathData);
                  sortAnimationId = requestAnimationFrame(animateWaveLoop);
                } else {
                  sortAnimationId = null;
                }
              }

              sortAnimationId = requestAnimationFrame(animateWaveLoop);
            }
            // --- End Animation Logic ---

            // Call the actual sorting logic AFTER starting animation
            sortTabsByTopic();
          }
        });
        sortButtonListenerAdded = true;
      } catch (e) {}
    }

    // Add Clear button listener
    if (!clearButtonListenerAdded) {
      try {
        zenCommands.addEventListener("command", (event) => {
          if (event.target.id === "cmd_zenClearTabs") {
            // Add animation class to clear button
            const clearButton = document.querySelector("#clear-button");
            if (clearButton) {
              clearButton.classList.add("clearing");
              // Remove class after animation completes
              setTimeout(() => {
                if (clearButton?.isConnected) {
                  clearButton.classList.remove("clearing");
                }
              }, CONFIG.CLEAR_ANIMATION_DURATION);
            }

            // Call the actual clearing function
            clearUngroupedTabs();
          }
        });
        clearButtonListenerAdded = true;
      } catch (e) {}
    }
  }

  // --- gZenWorkspaces Hooks ---
  function setupgZenWorkspacesHooks() {
    if (typeof window.gZenWorkspaces === "undefined") {
      return;
    }

    const originalOnTabBrowserInserted =
      window.gZenWorkspaces.onTabBrowserInserted;
    const originalUpdateTabsContainers =
      window.gZenWorkspaces.updateTabsContainers;

    window.gZenWorkspaces.onTabBrowserInserted = function (event) {
      if (typeof originalOnTabBrowserInserted === "function") {
        try {
          originalOnTabBrowserInserted.call(window.gZenWorkspaces, event);
        } catch (e) {
          console.error(
            "SORT BTN HOOK: Error in original onTabBrowserInserted:",
            e
          );
        }
      }
      addSortButtonToAllSeparators();
      updateButtonsVisibilityState();
    };

    window.gZenWorkspaces.updateTabsContainers = function (...args) {
      if (typeof originalUpdateTabsContainers === "function") {
        try {
          originalUpdateTabsContainers.apply(window.gZenWorkspaces, args);
        } catch (e) {
          console.error(
            "SORT BTN HOOK: Error in original updateTabsContainers:",
            e
          );
        }
      }
      addSortButtonToAllSeparators();
      updateButtonsVisibilityState();
    };
  }

  // --- Optimized Helper: Count Tabs for Button Visibility ---
  const countTabsForButtonVisibility = () => {
    const currentWorkspaceId = window.gZenWorkspaces?.activeWorkspace;

    if (
      !currentWorkspaceId ||
      typeof gBrowser === "undefined" ||
      !gBrowser.tabs
    ) {
      return {
        ungroupedTotal: 0,
        ungroupedNonSelected: 0,
        hasGroupedTabs: false,
      };
    }

    let ungroupedTotal = 0;
    let ungroupedNonSelected = 0;
    let hasGroupedTabs = false;

    // Use optimized filtering
    const allTabs = getFilteredTabs(currentWorkspaceId, {
      includeGrouped: true,
      includeSelected: true,
      includePinned: false,
      includeEmpty: false,
      includeGlance: false,
    });

    for (const tab of allTabs) {
      const groupParent = tab.closest("tab-group");
      const isInGroup = !!groupParent;
      const isSelected = tab.selected;

      if (isInGroup) {
        hasGroupedTabs = true;
      } else {
        ungroupedTotal++;
        if (!isSelected) {
          ungroupedNonSelected++;
        }
      }
    }

    return {
      ungroupedTotal,
      ungroupedNonSelected,
      hasGroupedTabs,
    };
  };

  // --- Updated Helper: Update Button Visibility State ---
  const updateButtonsVisibilityState = () => {
    const { ungroupedTotal, ungroupedNonSelected, hasGroupedTabs } =
      countTabsForButtonVisibility();
    const separators = domCache.getSeparators();

    batchDOMUpdates([
      () => {
        separators.forEach((separator) => {
          if (!separator?.isConnected) return;

          // Handle Tidy button visibility
          const tidyButton = separator.querySelector("#sort-button");
          if (tidyButton) {
            const shouldShowTidyButton = hasGroupedTabs
              ? ungroupedTotal > 0
              : ungroupedTotal >= CONFIG.MIN_TABS_FOR_SORT;

            if (shouldShowTidyButton) {
              tidyButton.classList.remove("hidden-button");
            } else {
              tidyButton.classList.add("hidden-button");
            }
          }

          // Handle Clear button visibility
          const clearButton = separator.querySelector("#clear-button");
          if (clearButton) {
            if (ungroupedNonSelected > 0) {
              clearButton.classList.remove("hidden-button");
            } else {
              clearButton.classList.add("hidden-button");
            }
          }

          // Always keep the separator visible
          separator.classList.remove("has-no-sortable-tabs");
        });
      },
    ]);
  };

  // --- Add Tab Event Listeners for Visibility Updates ---
  function addTabEventListeners() {
    if (
      eventListenersAdded ||
      typeof gBrowser === "undefined" ||
      !gBrowser.tabContainer
    ) {
      return;
    }

    const updateVisibilityDebounced = debounce(
      updateButtonsVisibilityState,
      CONFIG.DEBOUNCE_DELAY
    );

    const events = [
      "TabOpen",
      "TabClose",
      "TabSelect",
      "TabPinned",
      "TabUnpinned",
      "TabGroupAdd",
      "TabGroupRemove",
      "TabGrouped",
      "TabUngrouped",
      "TabAttrModified",
    ];

    events.forEach((eventName) => {
      gBrowser.tabContainer.addEventListener(
        eventName,
        updateVisibilityDebounced
      );
    });

    // Listen to workspace changes
    if (typeof window.gZenWorkspaces !== "undefined") {
      window.addEventListener(
        "zen-workspace-switched",
        updateVisibilityDebounced
      );
    }

    eventListenersAdded = true;
  }

  // --- Debounce Utility (to prevent rapid firing) ---
  function debounce(func, wait) {
    if (typeof func !== "function" || typeof wait !== "number") {
      return () => {};
    }

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

  // --- Cleanup Function ---
  const cleanup = () => {
    try {
      // Stop any running animations
      cleanupAnimation();

      // Clear DOM cache
      domCache.invalidate();

      // Reset state
      isSorting = false;
      isClearing = false;
      eventListenersAdded = false;

      console.log("Tab sort script cleanup completed");
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  };

  // --- Initial Setup Trigger ---
  function initializeScript() {
    const tryInitialize = () => {
      try {
        const separatorExists = domCache.getSeparators().length > 0;
        const commandSetExists = !!domCache.getCommandSet();
        const gBrowserReady =
          typeof gBrowser !== "undefined" && gBrowser?.tabContainer;
        const gZenWorkspacesReady =
          typeof window.gZenWorkspaces !== "undefined";

        const ready =
          gBrowserReady &&
          commandSetExists &&
          separatorExists &&
          gZenWorkspacesReady;

        if (ready) {
          setupSortCommandAndListener();
          addSortButtonToAllSeparators();
          setupgZenWorkspacesHooks();
          updateButtonsVisibilityState();
          addTabEventListeners();
          return true;
        }
      } catch (e) {
        console.error("Error during initialization:", e);
      }
      return false;
    };

    // Try immediate initialization
    if (tryInitialize()) return;

    // Fallback to polling
    let checkCount = 0;
    const initCheckInterval = setInterval(() => {
      checkCount++;

      if (tryInitialize()) {
        clearInterval(initCheckInterval);
      } else if (checkCount > CONFIG.MAX_INIT_CHECKS) {
        clearInterval(initCheckInterval);
        console.warn(
          `Tab sort initialization timed out after ${
            CONFIG.MAX_INIT_CHECKS * CONFIG.INIT_CHECK_INTERVAL
          }ms`
        );
      }
    }, CONFIG.INIT_CHECK_INTERVAL);
  }

  // --- Start Initialization ---
  if (document.readyState === "complete") {
    initializeScript();
  } else {
    window.addEventListener("load", initializeScript, { once: true });
  }

  // --- Add Cleanup Listeners ---
  window.addEventListener("unload", cleanup, { once: true });
  window.addEventListener("beforeunload", cleanup, { once: true });
})(); // End script