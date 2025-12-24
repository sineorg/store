(function () {
  "use strict";

  // wait for browser UI
  function init() {
    console.log("AutoSort.uc.js loaded");
  }

  if (gBrowserInit?.delayedStartupFinished) {
    init();
  } else {
    Services.obs.addObserver(function observer() {
      if (gBrowserInit.delayedStartupFinished) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        init();
      }
    }, "browser-delayed-startup-finished");
  }
})();
