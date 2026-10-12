"use strict";
const stockSW = "./sw.js";

/**
 * List of hostnames that are allowed to run serviceworkers on http://
 */
const swAllowedHostnames = ["localhost", "127.0.0.1"];

/**
 * Global util
 * Used in 404.html and index.html
 */
async function registerSW() {
	if (!navigator.serviceWorker) {
		if (
			location.protocol !== "https:" &&
			!swAllowedHostnames.includes(location.hostname)
		)
			throw new Error("Service workers cannot be registered without https.");

		throw new Error("Your browser doesn't support service workers.");
	}

	await navigator.serviceWorker.register(stockSW);

	// Make sure the worker uses the settings this page just saved.
	const registration = await navigator.serviceWorker.ready;
	registration.active?.postMessage("reload-config");
}

/*
 * Hosts like GitHub Pages can't send the headers that make Slow "cross-origin isolated"
 * (some games, like Retro Bowl, need that). The service worker adds them instead, but only
 * to pages it serves, so on the very first visit the page registers the worker and reloads
 * once. Slow's own server already sends the headers, so this does nothing there.
 */
(() => {
	const KEY = "slow.isolationReload";
	if (window.crossOriginIsolated || !navigator.serviceWorker) return;
	if (sessionStorage.getItem(KEY)) return; // only ever try once per visit

	const reload = () => {
		sessionStorage.setItem(KEY, "1");
		location.reload();
	};
	// Once the worker is running, a normal reload goes through it and picks up the headers.
	navigator.serviceWorker
		.register(stockSW)
		.then(() => navigator.serviceWorker.ready)
		.then(reload)
		.catch(() => {});
})();
