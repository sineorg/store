const MAX_DESCRIPTION_LENGTH = 120;
const sortButton = document.getElementById("sortButton");
const sortMenu = document.getElementById("sortMenu");
const currentSort = document.getElementById("currentSort");
const themeContainer = document.querySelector(".theme-container");
const searchInput = document.querySelector("input.search");
const params = new URLSearchParams(window.location.search);
const githubCache = {};
let themes = await fetch(
    "https://sineorg.github.io/store/marketplace.json",
).then((res) => res.json());
let sortBy = "stars";

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

const getGitHubRepoData = async (homepage) => {
    if (!homepage || !homepage.includes("github.com")) return null;
    try {
        const paths = new URL(homepage).pathname.split("/").filter(Boolean);
        if (paths.length < 2) return null;
        const repoKey = `${paths[0]}/${paths[1]}`;
        if (githubCache[repoKey]) return githubCache[repoKey];

        const response = await fetch(`https://api.github.com/repos/${repoKey}`);

        if (response.status === 403) {
            console.warn(`Rate limit exceeded for ${repoKey}`);
            return null;
        }

        if (!response.ok) return null;

        const data = await response.json();
        const result = {
            createdAt: data.created_at,
            updatedAt: data.updated_at || data.pushed_at,
            stars: data.stargazers_count,
        };
        githubCache[repoKey] = result;
        return result;
    } catch (e) {
        console.warn("GitHub API error:", e);
        return null;
    }
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
          <button class="action install-btn theme-modal-install-btn" id="${themeId}-install">Install</button>
          <a href="${repoLink}" rel="noopener noreferrer" class="btn" target="_blank">View on GitHub</a>
        </div>
      </div>
    </div>
  `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
    document.getElementById("closeModal").addEventListener("click", closeModal);
    document.getElementById("themeModal").addEventListener("click", (e) => {
        if (e.target.id === "themeModal") closeModal();
    });
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
        <button class="install-btn" id="${themeId}-install">Install</button>
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

const enrichThemesWithGitHub = async (themesArray) => {
    const promises = themesArray.map(async (theme) => {
        if (!theme.updatedAt || !theme.createdAt || theme.stars === undefined) {
            const githubData = await getGitHubRepoData(theme.homepage);
            if (githubData) {
                return {
                    ...theme,
                    createdAt: theme.createdAt || githubData.createdAt,
                    updatedAt: theme.updatedAt || githubData.updatedAt,
                    stars:
                        theme.stars !== undefined
                            ? theme.stars
                            : githubData.stars,
                };
            }
        }
        return theme;
    });
    return await Promise.all(promises);
};

const sortAndDisplay = async (sortType) => {
    themeContainer.innerHTML = '<div class="loading">Loading...</div>';

    let themesArray = Object.entries(themes).map(([id, theme]) => ({
        id,
        ...theme,
    }));
    themesArray = await enrichThemesWithGitHub(themesArray);

    const sortFunctions = {
        stars: (a, b) => (b.stars || 0) - (a.stars || 0),
        updated: (a, b) =>
            getValidTimestamp(b.updatedAt) - getValidTimestamp(a.updatedAt),
        added: (a, b) =>
            getValidTimestamp(b.createdAt) - getValidTimestamp(a.createdAt),
    };

    themesArray.sort(sortFunctions[sortType] || sortFunctions.stars);

    themeContainer.innerHTML = "";
    themesArray.forEach((theme) => displayTheme(theme.id, theme));
};

themeContainer.addEventListener("click", (e) => {
    const themeLink = e.target.closest(".theme-link");
    const viewMore = e.target.closest(".view-more");

    if (themeLink || viewMore) {
        e.preventDefault();
        const themeId = (themeLink || viewMore).dataset.themeId;
        openThemeModal(themeId, themes[themeId]);
    }
});

// Sort menu
sortButton.addEventListener("click", (e) => {
    e.stopPropagation();
    sortMenu.classList.toggle("active");
});

document.addEventListener("click", () => sortMenu.classList.remove("active"));

document.querySelectorAll(".sort-option").forEach((option) => {
    option.addEventListener("click", (e) => {
        e.stopPropagation();
        document
            .querySelectorAll(".sort-option")
            .forEach((opt) => opt.classList.remove("selected"));
        option.classList.add("selected");
        currentSort.textContent = option.textContent;
        sortMenu.classList.remove("active");
        sortBy = option.dataset.sort;
        sortAndDisplay(sortBy);
    });
});

// Search
if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const query = e.target.value.trim();
            if (query) {
                params.set("theme", query);
                window.location.search = params.toString();
            }
        }
    });
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

// Initial load
sortAndDisplay(sortBy);
