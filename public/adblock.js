/*
 * Slow's ad blocker, the part that runs inside websites.
 *
 * Slow's service worker adds this to every page (right after tab-volume.js), and also stops
 * requests to ad servers before they leave (see sw.js). This file handles what can't be
 * blocked that way:
 *  - YouTube sends its video ads in the same data as the video itself, so the ad parts are
 *    removed from that data before the player reads it. Any ad that still starts is skipped.
 *  - Leftover ad boxes are hidden.
 * Slow's "Block ads" setting (Settings > Privacy) turns all of this off.
 */
(() => {
	if (window.__slowAdblock) return;
	window.__slowAdblock = true;

	// The setting lives on Slow's own page; pages and the frames inside them look up to it.
	function enabled() {
		let w = window;
		for (let i = 0; i < 12; i++) {
			try {
				if (typeof w.__slowBlockAds === "boolean") return w.__slowBlockAds;
				if (w.parent === w) break;
				w = w.parent;
			} catch {
				break;
			}
		}
		return true;
	}
	if (!enabled()) return;

	// The real address of this page (this script isn't adapted by the proxy, so location is Slow's).
	let host = "";
	try {
		const real = decodeURIComponent(location.pathname.split("/scramjet/")[1] || "");
		host = new URL(real).hostname;
	} catch {}
	const on = (domain) => host === domain || host.endsWith("." + domain);

	function addStyle(css) {
		const style = document.createElement("style");
		style.textContent = css;
		(document.head || document.documentElement).append(style);
	}

	/* ---------- every site: empty ad boxes ---------- */

	addStyle(`
		ins.adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"], iframe[src*="doubleclick.net"],
		iframe[src*="googlesyndication.com"], iframe[src*="amazon-adsystem.com"] { display: none !important; }
	`);

	/* ---------- YouTube ---------- */

	if (on("youtube.com") || on("youtube-nocookie.com")) {
		const AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];
		const prune = (data) => {
			if (!data || typeof data !== "object") return data;
			for (const target of [data, data.playerResponse, data.response]) {
				if (!target || typeof target !== "object") continue;
				for (const key of AD_KEYS) if (key in target) delete target[key];
			}
			return data;
		};

		// Data YouTube fetches while you browse (it reads it as text, then parses it).
		const parse = JSON.parse;
		JSON.parse = function () {
			return prune(parse.apply(this, arguments));
		};
		const json = Response.prototype.json;
		Response.prototype.json = function () {
			return json.apply(this, arguments).then(prune);
		};

		// The first video's data comes inside the page itself.
		let initial;
		try {
			Object.defineProperty(window, "ytInitialPlayerResponse", {
				configurable: true,
				get: () => initial,
				set: (value) => (initial = prune(value)),
			});
		} catch {}

		addStyle(`
			ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer, #masthead-ad,
			ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer,
			ytd-player-legacy-desktop-watch-ads-renderer, ytd-companion-slot-renderer, #player-ads,
			ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-search-pyv-renderer,
			ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
			.ytp-ad-overlay-container, .ytp-ad-message-container { display: none !important; }
		`);

		// If an ad still starts playing, jump to its end and press "Skip".
		setInterval(() => {
			const player = document.querySelector(".html5-video-player.ad-showing");
			if (!player) return;
			const video = player.querySelector("video");
			if (video && isFinite(video.duration) && video.duration > 0) {
				video.muted = true;
				video.currentTime = video.duration;
			}
			document.querySelector(".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button")?.click();
		}, 300);
	}

	/* ---------- Spotify ---------- */

	if (on("spotify.com")) {
		addStyle(`
			[data-testid="leavebehind-advertisement"], [data-testid="home-ad-card"],
			[data-testid="ad-slot-container"], [aria-label="Advertisement"] { display: none !important; }
		`);
	}
})();
