let themes = await fetch("https://sineorg.github.io/store/marketplace.json").then(res => res.json());

const params = new URLSearchParams(window.location.search);
const currTheme = params.get("theme");
const query = params.get("q");

const themeContainer = document.querySelector(".theme-container");

const displayTheme = async (query, theme = null) => {
/*     document.body.classList.add("theme-display");
    document.querySelector("button.action").addEventListener("click", () => {
        params.delete("theme");
        window.location.search = params.toString();
    }); */

    let isQuery = false;
    if (!theme) {
        theme = themes[Object.keys(themes).find(themeId => themeId === query)];
        isQuery = true;
    }

    if (theme) {
        const paths = new URL(theme.homepage).pathname.split("/").filter(Boolean);
        const author = theme.author ?? paths[0];
        const authorLink = `https://github.com/${paths[0]}`;
        const starsLink = `https://github.com/${paths[0]}/${paths[1]}/stargazers`;

        themeContainer.innerHTML += `
            <div class="theme ${isQuery ? "full" : ""}" data-id="${theme.id}">
                ${theme.image ? `<img src="${theme.image}"/>` : ""}
                <div class="title">
                    <h2><a href="?theme=${theme.id}">${theme.name}</a></h2>
                    <button class="action install-btn" id="${theme.id}-install">Install</button>
                </div>
                <subnote>
                    v${theme.version ?? "1.0.0"}
                    &bull; <a href="${authorLink}">@${author}</a>
                    &bull; <a href="${starsLink}">&starf; ${theme.stars}</a>
                </subnote>
                <div class="description">${theme.description}</div>
            </div>
        `;
    }
}

const displayAll = async () => {
    for (const theme of Object.values(themes)) {
        displayTheme(theme.id, theme);
    }

    // Replace this with a working search implementation that
    // happens live as the user types.
    document.querySelector("input.action").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const query = e.target.value.trim();
            if (query) {
                params.set("theme", query);
                window.location.search = params.toString();
            }
        }
    });
}

if (currTheme) {
    displayTheme(currTheme);
} else if (query) {
    displayResults(query);
} else {
    displayAll();
}
