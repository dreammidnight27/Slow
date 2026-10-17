/*
 * YouTube in Slow: videos play in YouTube's embedded player, because YouTube's full video page
 * crashes the browser tab when it runs through the proxy. Slow's service worker redirects video
 * pages that load normally; this catches videos opened from inside YouTube (it switches pages
 * without loading a new one), and is only added to YouTube's own pages.
 */
(() => {
	if (window.__slowYoutube) return;
	window.__slowYoutube = true;

	// This script isn't adapted by the proxy, so it builds proxied addresses itself.
	const marker = "/scramjet/";
	const at = location.pathname.indexOf(marker);
	if (at === -1) return;
	const prefix = location.origin + location.pathname.slice(0, at + marker.length);

	function embedFor(href) {
		// (a link may give its proxied address; the real one is inside it)
		if (href.startsWith(prefix)) href = decodeURIComponent(href.slice(prefix.length).split(/[?#]/)[0]);
		let url;
		try {
			url = new URL(href, "https://www.youtube.com/");
		} catch {
			return null;
		}
		if (!/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== "/watch") return null;
		const id = url.searchParams.get("v");
		if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
		const embed = new URL(`https://www.youtube.com/embed/${id}`);
		embed.searchParams.set("autoplay", "1");
		const list = url.searchParams.get("list");
		if (list) embed.searchParams.set("list", list);
		return embed.href;
	}

	function open(embed) {
		location.assign(prefix + encodeURIComponent(embed));
	}

	// Clicking a video (thumbnails, titles, search results...).
	window.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
			const link = event.target.closest?.("a[href]");
			const embed = link && embedFor(link.href);
			if (!embed) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			open(embed);
		},
		true,
	);

	// Anything else that moves YouTube to a video page (autoplay, keyboard, its own buttons).
	for (const name of ["pushState", "replaceState"]) {
		const original = history[name];
		history[name] = function (state, title, url) {
			const embed = url != null && embedFor(String(url));
			if (embed) {
				open(embed);
				return;
			}
			return original.apply(this, arguments);
		};
	}
})();
