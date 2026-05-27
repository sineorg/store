const MAX_DESCRIPTION_LENGTH = 120;
const sortButton = document.getElementById("sortButton");
const sortMenu = document.getElementById("sortMenu");
const currentSort = document.getElementById("currentSort");

const browserButton = document.getElementById("browserButton");
const browserMenu = document.getElementById("browserMenu");
const currentBrowser = document.getElementById("currentBrowser");

const themeContainer = document.querySelector(".theme-container");
const searchInput = document.querySelector("input.search");
const params = new URLSearchParams(window.location.search);
const githubCache = {};
let themes = await fetch("./marketplace.json").then((res) => res.json());
let sortBy = "stars";
let filterBrowser = "all";
let filteredThemes = themes;

// Extract unique browsers for filter menu
const extractBrowsers = () => {
    const browsers = new Set();
    Object.values(themes).forEach(theme => {
        if (theme.fork && Array.isArray(theme.fork)) {
            theme.fork.forEach(f => browsers.add(f.toLowerCase()));
        }
    });
    
    Array.from(browsers).sort().forEach(browser => {
        const option = document.createElement("button");
        option.className = "browser-option";
        option.dataset.browser = browser;
        option.textContent = browser.charAt(0).toUpperCase() + browser.slice(1);
        browserMenu.appendChild(option);
    });
};

// Utilities
const getValidTimestamp = (dateString) => {
    if (!dateString) return 0;
    let normalized = dateString;
    if (typeof dateString === "string" && dateString.includes(" ")) {
        normalized = dateString.replace(" ", "T");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        normalized += "T00:00:00";
    }
    const timestamp = new Date(normalized).getTime();
    return isNaN(timestamp) ? 0 : timestamp;
};

const getGitHubLinks = (homepage, author) => {
    const links = {
        author: author || "Unknown",
        authorLink: "#",
        starsLink: "#",
        repoLink: "#",
    };
    try {
        if (homepage) {
            const paths = new URL(homepage).pathname.split("/").filter(Boolean);
            if (paths.length >= 2) {
                links.author = author || paths[0];
                links.authorLink = `https://github.com/${paths[0]}`;
                links.repoLink = `https://github.com/${paths[0]}/${paths[1]}`;
                links.starsLink = `${links.repoLink}/stargazers`;
            }
        }
    } catch (e) {}
    return links;
};

const truncateText = (text, maxLength) => {
    if (!text || text.length <= maxLength) return { text, truncated: false };
    const truncated = text.slice(0, maxLength).trim();
    return { text: truncated, truncated: true };
};

// Modal
const closeModal = () => {
    const modal = document.getElementById("themeModal");
    if (modal) {
        modal.classList.add("closing");
        modal.addEventListener(
            "animationend",
            () => {
                modal.remove();
				document.querySelector(".theme[open]").removeAttribute("open");
            },
            { once: true },
        );
    }
};

const openThemeModal = (themeId, theme) => {
    if (!theme) return;
    const { author, authorLink, starsLink, repoLink } = getGitHubLinks(
        theme.homepage,
        theme.author,
    );
    const imageHtml = `<img src="${theme.image || "assets/no-image.jpg"}" class="theme-modal-image" onerror="this.src='assets/no-image.jpg'"/>`;

    const modalHtml = `
	    <div id="themeModal">
	      <div class="theme-modal-content">
	        <button id="closeModal" class="theme-modal-close">&times;</button>
	        ${imageHtml}
	        <h2 class="theme-modal-title">${theme.name || themeId}</h2>
	        <div class="theme-modal-meta">
	          v${theme.version || "1.0.0"}
	          &bull; <a href="${authorLink}" target="_blank">@${author}</a>
	          &bull; <a href="${starsLink}" target="_blank">&starf; ${theme.stars || 0}</a>
	        </div>
	        <p class="theme-modal-description">${theme.description || ""}</p>
	        <div class="theme-modal-buttons">
	          <button class="action action-install install-btn theme-modal-install-btn">Install</button>
	          <button class="action action-uninstall install-btn theme-modal-install-btn">Uninstall</button>
	          <a href="${repoLink}" rel="noopener noreferrer" class="btn" target="_blank">View on GitHub</a>
	        </div>
	      </div>
	    </div>
	`;
    document.body.insertAdjacentHTML("beforeend", modalHtml);

	const modalButtons = document.querySelector("#themeModal .theme-modal-buttons");
	modalButtons.querySelector(".action-install").addEventListener("click", () => {
		document.querySelector(`.theme .action-install[theme-id="${themeId}"]`).click();
	});
	modalButtons.querySelector(".action-uninstall").addEventListener("click", () => {
		document.querySelector(`.theme .action-uninstall[theme-id="${themeId}"]`).click();
	});
	
    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("themeModal").addEventListener("click", (e) => {
        if (e.target.id === "themeModal") closeModal();
    });

	document.querySelector(`.theme[data-id="${themeId}"]`).setAttribute("open", true);
};

// Display
const displayTheme = (themeId, theme) => {
    if (!theme) return;
    const { author, authorLink, starsLink } = getGitHubLinks(
        theme.homepage,
        theme.author,
    );
    const imageHtml = `<img src="${theme.image || "assets/no-image.jpg"}" onerror="this.src='assets/no-image.jpg'"/>`;
    const { text: description, truncated } = truncateText(
        theme.description,
        MAX_DESCRIPTION_LENGTH,
    );

    const descriptionHtml = truncated
        ? `${description}... <a href="#" class="view-more" data-theme-id="${themeId}">view more</a>`
        : description || "";

    themeContainer.innerHTML += `
	    <div class="theme" data-id="${themeId}">
	      ${imageHtml}
	      <div class="title">
	        <a href="#" class="theme-link" data-theme-id="${themeId}"><h3>${theme.name || themeId}</h3></a>
	        <button class="install-btn action-install hidden" theme-id="${themeId}">Install</button>
	        <button class="install-btn action-uninstall hidden" theme-id="${themeId}">Uninstall</button>
	      </div>
	      <subnote>
	        v${theme.version || "1.0.0"}
	        &bull; <a href="${authorLink}" target="_blank">@${author}</a>
	        &bull; <a href="${starsLink}" target="_blank">&starf; ${theme.stars || 0}</a>
	      </subnote>
	      <div class="description">${descriptionHtml}</div>
	    </div>
    `;
};

const sortAndDisplay = async (sortType) => {
    themeContainer.innerHTML = '<div class="loading">Loading...</div>';

    let themesArray = Object.entries(filteredThemes)
        .map(([id, theme]) => ({
            id,
            ...theme,
        }))
        .filter(theme => {
            if (filterBrowser === 'all') return true;
            const forks = (theme.fork || []).map(f => f.toLowerCase());
            return forks.includes(filterBrowser);
        });

    const sortFunctions = {
        stars: (a, b) => (b.stars || 0) - (a.stars || 0),
        updated: (a, b) =>
            getValidTimestamp(b.updatedAt) - getValidTimestamp(a.updatedAt),
        added: (a, b) =>
            getValidTimestamp(b.createdAt) - getValidTimestamp(a.createdAt),
        alphabetical: (a, b) =>
            (a.name || a.id).localeCompare(b.name || b.id)
    };

    themesArray.sort(sortFunctions[sortType] || sortFunctions.stars);

    themeContainer.innerHTML = "";
    
    if (themesArray.length === 0) {
        themeContainer.innerHTML = '<div class="loading">No themes found</div>';
        return;
    }
    
    themesArray.forEach((theme) => displayTheme(theme.id, theme));
};

themeContainer.addEventListener("click", (e) => {
    // Mobile click behavior: click anywhere on card (excluding install buttons or external links)
    const isMobile = window.innerWidth <= 768;
    const themeCard = e.target.closest(".theme");
    const isInteractive = e.target.closest("button, a:not(.theme-link, .view-more)");

    if (isMobile && themeCard && !isInteractive) {
        e.preventDefault();
        const themeId = themeCard.dataset.id;
        openThemeModal(themeId, themes[themeId]);
        return;
    }

    // Desktop click behavior: only on name/link
    const themeLink = e.target.closest(".theme-link");
    const viewMore = e.target.closest(".view-more");

    if (themeLink || viewMore) {
        e.preventDefault();
        const themeId = (themeLink || viewMore).dataset.themeId;
        openThemeModal(themeId, themes[themeId]);
    }
});

// Dropdowns setup
const setupDropdown = (button, menu, optionsClass, currentSpan, onSelect) => {
    button.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close other menus
        document.querySelectorAll(".sort-menu").forEach(m => {
            if (m !== menu) m.classList.remove("active");
        });
        menu.classList.toggle("active");
    });

    menu.addEventListener("click", (e) => {
        const option = e.target.closest(`.${optionsClass}`);
        if (!option) return;
        e.stopPropagation();
        
        menu.querySelectorAll(`.${optionsClass}`).forEach((opt) => opt.classList.remove("selected"));
        option.classList.add("selected");
        currentSpan.textContent = option.textContent.trim();
        menu.classList.remove("active");
        onSelect(option);
    });
};

setupDropdown(sortButton, sortMenu, "sort-option", currentSort, (option) => {
    sortBy = option.dataset.sort;
    sortAndDisplay(sortBy);
});

setupDropdown(browserButton, browserMenu, "browser-option", currentBrowser, (option) => {
    filterBrowser = option.dataset.browser;
    sortAndDisplay(sortBy);
});

document.addEventListener("click", () => {
    document.querySelectorAll(".sort-menu").forEach(m => m.classList.remove("active"));
});

// Search
if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim().toLowerCase();
        
        if (!query) {
            filteredThemes = themes;
            sortAndDisplay(sortBy);
            return;
        }
        
        filteredThemes = {};
        Object.entries(themes).forEach(([id, theme]) => {
            const searchableText = [
                theme.name || "",
                theme.description || "",
                theme.author || "",
                ...(theme.tags || [])
            ].join(" ").toLowerCase();
            
            if (searchableText.includes(query)) {
                filteredThemes[id] = theme;
            }
        });
        
        sortAndDisplay(sortBy);
    });
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

// Start initialization
extractBrowsers();

// Initial load
sortAndDisplay(sortBy);
