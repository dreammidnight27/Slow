/*
 * Browsing inside Slow. Slow's service worker adds this to every page (and frames inside pages).
 *  - Links and windows that would open a new browser tab open a Slow tab instead
 *    (Ctrl+click and middle-click open it in the background, like other browsers).
 *  - Pointing at a link shows where it goes, at the bottom of Slow's window.
 *  - Slow's Alt shortcuts (new tab, close tab, address bar, chat...) work while a website has focus.
 */
(() => {
	if (window.__slowBrowsing) return;
	window.__slowBrowsing = true;

	// Slow's own page: the window above this one that answers Slow's calls.
	function slow() {
		let w = window;
		for (let i = 0; i < 12; i++) {
			try {
				if (typeof w.__slowOpenTab === "function") return w;
				if (w.parent === w) break;
				w = w.parent;
			} catch {
				break;
			}
		}
		return null;
	}

	// This script isn't adapted by the proxy, so it works out real addresses itself.
	const marker = "/scramjet/";
	const at = location.pathname.indexOf(marker);
	const prefix = at === -1 ? "" : location.origin + location.pathname.slice(0, at + marker.length);
	const page = (() => {
		try {
			return at === -1 ? undefined : decodeURIComponent(location.pathname.slice(at + marker.length));
		} catch {
			return undefined;
		}
	})();

	function realUrl(href) {
		if (!href) return null;
		// (a link may give its proxied address; the real one is inside it)
		if (prefix && href.startsWith(prefix)) {
			try {
				href = decodeURIComponent(href.slice(prefix.length).split(/[?#]/)[0]);
			} catch {
				return null;
			}
		}
		let url;
		try {
			url = new URL(href, page);
		} catch {
			return null;
		}
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	}

	function linkIn(event) {
		const link = event.target?.closest?.("a[href]");
		return link && !link.hasAttribute("download") ? link : null;
	}

	/* ---------- links that open a new tab ---------- */

	window.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0 || event.defaultPrevented) return;
			const link = linkIn(event);
			if (!link) return;
			const mod = event.ctrlKey || event.metaKey;
			const target = (link.getAttribute("target") || "").toLowerCase();
			if (!mod && !event.shiftKey && target !== "_blank" && target !== "_new") return;
			const url = realUrl(link.href);
			const host = slow();
			if (!url || !host) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			host.__slowOpenTab(url, { background: mod && !event.shiftKey });
		},
		true,
	);

	// Middle-click.
	window.addEventListener(
		"auxclick",
		(event) => {
			if (event.button !== 1) return;
			const link = linkIn(event);
			const url = link && realUrl(link.href);
			const host = slow();
			if (!url || !host) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			host.__slowOpenTab(url, { background: true });
		},
		true,
	);

	/* ---------- pages opening new windows ---------- */

	const nativeOpen = window.open;
	let lastOpen = 0;
	window.open = function (url, target, features) {
		const name = String(target ?? "").toLowerCase();
		// Small pop-up windows (like "Sign in with Google") stay real pop-ups: the page talks to them.
		const popup = /width|height|popup/i.test(String(features ?? ""));
		const href = url ? realUrl(String(url)) : null;
		const host = slow();
		if (!host || !href || popup || (name && name !== "_blank" && name !== "_new")) {
			return nativeOpen.apply(this, arguments);
		}
		// A page can only open a tab right after you click or press a key, and one at a time
		// (that's what stops pop-up ads from opening tabs by themselves).
		if (!navigator.userActivation?.isActive || Date.now() - lastOpen < 1000) return null;
		lastOpen = Date.now();
		host.__slowOpenTab(href, { background: false });
		return null;
	};

	/* ---------- where a link goes ---------- */

	let pointedAt = null;
	document.addEventListener(
		"mouseover",
		(event) => {
			const link = event.target?.closest?.("a[href]") || null;
			if (link === pointedAt) return;
			pointedAt = link;
			slow()?.__slowLinkHover?.(link ? realUrl(link.href) : null);
		},
		true,
	);
	document.addEventListener(
		"mouseout",
		(event) => {
			if (event.relatedTarget) return; // still inside the page
			pointedAt = null;
			slow()?.__slowLinkHover?.(null);
		},
		true,
	);

	/* ---------- the mouse's back and forward buttons ----------
	   The browser's own back would go back in whichever of Slow's tabs changed last, so Slow
	   moves back in the tab (or app) this website is in instead. */

	function stepFromMouse(event) {
		if (event.button !== 3 && event.button !== 4) return;
		const host = slow();
		if (!host?.__slowStep) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.type !== "mouseup") return;
		// The frame right inside Slow's page holds this website (this may be a frame within it).
		let w = window;
		try {
			while (w.parent !== host) w = w.parent;
		} catch {
			return;
		}
		host.__slowStep(w, event.button === 3 ? -1 : 1);
	}
	window.addEventListener("mousedown", stepFromMouse, true);
	window.addEventListener("mouseup", stepFromMouse, true);

	/* ---------- Slow's shortcuts while a website has focus ---------- */

	window.addEventListener(
		"keydown",
		(event) => {
			if (!event.altKey || event.ctrlKey || event.metaKey) return;
			if (!/^(KeyT|KeyW|KeyL|KeyC|Digit[1-8])$/.test(event.code)) return;
			const host = slow();
			if (host?.__slowKey?.(event.code, event.shiftKey)) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		},
		true,
	);
})();
