const modId = "cfafe94c-5a29-4dae-8489-6be514185474";

const ss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
const io = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile).clone();
chromeDir.append("sine-mods");
chromeDir.append(modId);
chromeDir.append("userChrome.css");
const cssURI = io.newFileURI(chromeDir);

if (!ss.sheetRegistered(cssURI, ss.USER_SHEET)) {
  ss.loadAndRegisterSheet(cssURI, ss.USER_SHEET);
}