/*
 * Websites in English: Slow's service worker adds this to every page (and frames inside
 * pages) before the page's own scripts run, so scripts that check the browser's language
 * see English. Requests already ask for English (see sw.js).
 */
(() => {
	if (window.__slowEnglish) return;
	window.__slowEnglish = true;

	const proto = Object.getPrototypeOf(navigator);
	try {
		Object.defineProperty(proto, "language", { configurable: true, get: () => "en-US" });
		Object.defineProperty(proto, "languages", { configurable: true, get: () => Object.freeze(["en-US", "en"]) });
	} catch {}
})();
