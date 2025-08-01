const themeData = await fetch("https://sineorg.github.io/store/marketplace.json");
const themes = await themeData.json();

const displayTheme = (theme) => {
    document.querySelector(".warning").innerHTML = `
        You have attempted to query the theme: ${theme.name}, ${theme.description}.
        </br>
        Due to this site's construction, themes cannot be displayed and
        this query is only for demonstration of query functionality.
    `;
}

const displayAll = () => {

}

const params = new URLSearchParams(window.location.search);
const query = params.get("theme");
if (query) {
    console.log(query, themes, Object.keys(themes), Object.keys(themes).find(themeId => themeId === query), themes[Object.keys(themes).find(themeId => themeId === query)]);
    const theme = themes[Object.keys(themes).find(themeId => themeId === query)];
    if (theme) {
        displayTheme(theme);
    }
}

