// ==UserScript==
// @ignorecache
// ==/UserScript==

document.addEventListener('DOMContentLoaded', () => {
    const containerDiv = document.querySelector('zen-appcontent-navbar-wrapper');
    const targetDiv = document.querySelector('browser');

    if (containerDiv && targetDiv) {
        // Get the width of the container div
        const containerWidth = containerDiv.offsetWidth + 'px';

        // Set the CSS custom property on the target div
        targetDiv.style.setProperty('--container-width', containerWidth);
    }
});
