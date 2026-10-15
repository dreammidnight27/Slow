// Paths are relative to this file, so Slow works from any folder (like a GitHub Pages project site).
importScripts("scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

/* ---------- never let a cookie hold up a page ----------
   When a site sends a cookie, Scramjet tells the page that asked and waits for the page to
   answer before handing over the file. Two kinds of page never answer, and the file then
   never arrives:
   - Slow's own page (tab and shortcut icons come through the proxy too), which isn't a website;
   - a website that asked very early, before Scramjet started inside it (browsers fetch
     stylesheets ahead of running scripts). That left pages like Wikipedia blank.
   So Slow's own page isn't asked at all, and a website gets a moment to answer. The cookie
   is kept either way (Scramjet saves it before asking). */
const tellPage = scramjet.dispatch.bind(scramjet);
scramjet.dispatch = (client, message) => {
	const prefix = location.origin + (scramjet.config?.prefix || "/scramjet/");
	if (!client?.url?.startsWith(prefix)) return Promise.resolve();
	return Promise.race([tellPage(client, message), new Promise((resolve) => setTimeout(resolve, 1500))]);
};

/* ---------- keep websites' cookies (logins, preferences, "you passed the CAPTCHA") ----------
   Scramjet 1.1.0 keeps cookies in this worker's memory, and the browser restarts the worker
   often (even after ~30 seconds idle), so they were lost:
   - cookies sent by websites' servers were never saved, only kept in memory;
   - the ones that were saved were never loaded back (its loader ignores saved data).
   So Slow loads them itself when the worker starts, and saves them whenever they change. */

function cookieDB() {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open("$scramjet");
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
}

async function readSavedCookies() {
	const db = await cookieDB();
	if (!db.objectStoreNames.contains("cookies")) return null;
	return new Promise((resolve) => {
		const get = db.transaction("cookies").objectStore("cookies").get("cookies");
		get.onsuccess = () => resolve(get.result);
		get.onerror = () => resolve(null);
	});
}

const cookiesLoaded = readSavedCookies()
	.then((saved) => {
		const cookies = typeof saved === "string" ? JSON.parse(saved) : saved;
		// Keep anything set in the moment before loading finished.
		if (cookies) scramjet.cookieStore.cookies = { ...cookies, ...scramjet.cookieStore.cookies };
	})
	.catch(() => {});

let lastSavedCookies = null;
let cookieSaveTimer = null;

function saveCookiesSoon() {
	clearTimeout(cookieSaveTimer);
	cookieSaveTimer = setTimeout(async () => {
		const dump = scramjet.cookieStore.dump();
		if (dump === lastSavedCookies) return;
		try {
			const db = await cookieDB();
			if (!db.objectStoreNames.contains("cookies")) return;
			db.transaction("cookies", "readwrite").objectStore("cookies").put(JSON.parse(dump), "cookies");
			lastSavedCookies = dump;
		} catch {}
	}, 500);
}

/* ---------- ad blocker ----------
   Requests to ad servers get an empty answer instead of going out. (adblock.js, added to every
   page below, handles YouTube and ad boxes.) Slow's page tells this worker whether "Block ads"
   is on, and it's kept in a small cache so a restarted worker still knows. */

// Each blocks the address and everything under it (doubleclick.net also blocks ad.doubleclick.net).
const AD_HOSTS = new Set([
	"doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
	"googletagservices.com", "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "criteo.com", "criteo.net",
	"taboola.com", "outbrain.com", "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com",
	"smartadserver.com", "yieldmo.com", "sharethrough.com", "teads.tv", "media.net", "moatads.com",
	"adform.net", "bidswitch.net", "3lift.com", "triplelift.com", "indexww.com", "contextweb.com",
	"advertising.com", "adcolony.com", "popads.net", "popcash.net", "propellerads.com", "adsterra.com",
	"exoclick.com", "exosrv.com", "juicyads.com", "trafficjunky.net", "hilltopads.net", "a-ads.com",
	"mgid.com", "revcontent.com", "zedo.com", "adroll.com", "adsafeprotected.com", "doubleverify.com",
	"serving-sys.com", "flashtalking.com", "ads-twitter.com", "adeventtracker.spotify.com",
]);

function isAd(url) {
	const parts = url.hostname.split(".");
	for (let i = 0; i < parts.length - 1; i++) {
		if (AD_HOSTS.has(parts.slice(i).join("."))) return true;
	}
	const host = url.hostname;
	const path = url.pathname;
	// YouTube's ad requests come from its own address.
	if (/(^|\.)youtube\.com$/.test(host) && /^\/(pagead|api\/stats\/ads|ptracking)\b/.test(path)) return true;
	// So do Spotify's.
	if (/(^|\.)spotify\.com$/.test(host) && /^\/(ads|ad-logic)\//.test(path)) return true;
	return false;
}

/* ---------- websites in English ----------
   Sites pick a language from the "preferred language" a browser sends, and often from where
   the connection comes from. Every request asks for English; english.js (added to every page
   below) tells page scripts the browser's language is English too. */

const ENGLISH = "en-US,en;q=0.9";

scramjet.addEventListener("request", (event) => {
	event.requestHeaders["accept-language"] = ENGLISH;
	// Google goes by location more than anything else, unless the address says otherwise.
	const { hostname, searchParams } = event.url;
	const google = /(^|\.)google\.[a-z.]+$/.test(hostname) || /(^|\.)youtube\.com$/.test(hostname);
	const page = event.destination === "document" || event.destination === "iframe";
	if (google && page && event.method === "GET" && !searchParams.has("hl")) {
		searchParams.set("hl", "en");
	}
});

const FLAGS_CACHE = "slow-flags";
let blockAds = true;
const flagsLoaded = caches
	.open(FLAGS_CACHE)
	.then((cache) => cache.match("adblock"))
	.then((saved) => saved?.text())
	.then((value) => {
		if (value) blockAds = value === "on";
	})
	.catch(() => {});

scramjet.addEventListener("request", (event) => {
	if (!blockAds || !isAd(event.url)) return;
	const page = event.destination === "document" || event.destination === "iframe";
	const empty = new Response(page ? "" : null, {
		status: page ? 200 : 204,
		headers: page ? { "content-type": "text/html" } : {},
	});
	empty.rawHeaders = page ? { "content-type": "text/html" } : {};
	event.response = Promise.resolve(empty);
});

async function handleRequest(event) {
	await scramjet.loadConfig();
	await cookiesLoaded;
	await flagsLoaded;
	if (scramjet.route(event)) {
		if (event.request.method === "HEAD") return headRequest(event);
		const response = await scramjet.fetch(event);
		// Scramjet's "couldn't load" page skips the hook below that adds isolation headers, so the
		// browser blocked it: a blank tab, which Slow also couldn't read to reconnect and retry.
		return ["document", "iframe"].includes(event.request.destination) ? isolated(response) : response;
	}
	if (isCover(event.request)) return coverRequest(event.request);
	const response = await fetch(fresh(event.request));
	const { mode, destination } = event.request;
	const needsHeaders = mode === "navigate" || destination === "worker" || destination === "sharedworker";
	return needsHeaders ? isolated(response) : response;
}

// Game pictures in the games page are kept for good once downloaded (the page preloads them all).
// Some hosts tell browsers not to keep them, so Slow keeps them itself.
const COVER_CACHE = "slow-covers"; // the same name is used in index.js
const COVER_HOSTS = [
	"https://raw.githubusercontent.com/gn-math/covers/",
	"https://selenite.cc/resources/semag/",
	"https://3kh0.github.io/projects/",
];

function isCover(request) {
	return request.method === "GET" && COVER_HOSTS.some((host) => request.url.startsWith(host));
}

async function coverRequest(request) {
	const cache = await caches.open(COVER_CACHE);
	const saved = await cache.match(request.url);
	if (saved) return saved;
	const response = await fetch(request);
	if (response.ok) cache.put(request.url, response.clone()).catch(() => {});
	return response;
}

// Slow's own files are always checked with the server (a tiny request when nothing changed),
// so an update shows up right away instead of after the host's cache time (10 minutes on GitHub Pages).
function fresh(request) {
	const ownFile = request.method === "GET" && request.url.startsWith(self.registration.scope);
	if (!ownFile) return request;
	if (request.mode === "navigate") {
		return new Request(request.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" });
	}
	return new Request(request, { cache: "no-cache" });
}

// Adds the headers that make Slow's own pages and workers "cross-origin isolated", for hosts that
// can't send them (like GitHub Pages). Workers need them too: Scramjet's helper worker for games'
// file loading only works when isolated. Slow's own server already sends them, so they're left alone there.
function isolated(response) {
	if (response.type === "opaqueredirect" || response.status === 0) return response;
	if (response.headers.has("Cross-Origin-Embedder-Policy")) return response;
	const headers = new Headers(response.headers);
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Cross-Origin-Embedder-Policy", "require-corp");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

// HEAD requests ("how big is this file?") fail inside Scramjet with a 500, which breaks
// game loaders that check file sizes first (FNAF and other big games do this).
// Ask for the file normally, then send back only the status and headers, and stop the download.
async function headRequest(event) {
	const response = await scramjet.fetch({
		request: new Request(event.request, { method: "GET" }),
		clientId: event.clientId,
	});
	response.body?.cancel().catch(() => {});
	return new Response(null, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

// Scramjet adds its own scripts inside the page's <head>. Some pages (like gn-math games)
// put scripts *before* their <head>, so those would run before Scramjet is ready and break.
// This moves Scramjet's scripts up so they run first.
const SCRAMJET_SCRIPTS =
	/(?:<script src="[^"]*"><\/script>){2}<script src="data:application\/javascript;base64,[^"]*"><\/script>/;

// Slow's per-tab volume control, added right after Scramjet's scripts so it's in place
// before the page's own scripts make any sound. (A full address, so a page's <base> can't move it.)
const TAB_VOLUME_SCRIPT = `<script src="${new URL("tab-volume.js", self.location.href).href}"></script>`;
// ...and the ad blocker's page part, for the same reason (it must be in place before the page's scripts).
const ADBLOCK_SCRIPT = `<script src="${new URL("adblock.js", self.location.href).href}"></script>`;
// ...and English for page scripts (see "websites in English" above).
const ENGLISH_SCRIPT = `<script src="${new URL("english.js", self.location.href).href}"></script>`;

// UGS games are single web pages kept on jsDelivr, which sends them labelled as plain text,
// so they'd show as code. Scramjet only adapts pages labelled as web pages (before any later
// hook could relabel them), so Slow fetches these itself and labels them as web pages first.
const UGS_FILES = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/";

// Many UGS Flash games tell the Flash player to load "$1" (a leftover placeholder) instead of the
// game, and rely on a backup <embed> of the game, which doesn't survive Scramjet. So the player
// is pointed at the game itself, and the backup is removed.
function fixUgsFlash(html) {
	if (!html.includes('player.load("$1")')) return html;
	const swf = html.match(/<embed[^>]*\ssrc="([^"]+\.swf)"/i)?.[1];
	if (!swf) return html;
	return html
		.replace('player.load("$1")', `player.load(${JSON.stringify(swf)})`)
		.replace(/<param name="movie"[^>]*>\s*/i, "")
		.replace(/<embed[^>]*\.swf"[^>]*>/i, "");
}

scramjet.addEventListener("request", (event) => {
	if (!event.url.href.startsWith(UGS_FILES)) return;
	if (event.destination !== "document" && event.destination !== "iframe") return;
	event.response = (async () => {
		const res = await scramjet.client.fetch(event.url, {
			method: "GET",
			headers: event.requestHeaders,
			credentials: "omit",
			redirect: "manual",
		});
		const rawHeaders = Object.fromEntries(
			// (the size changes if the page is fixed below, so that's left out too)
			Object.entries(res.rawHeaders || {}).filter(
				([name]) => !["content-type", "content-length"].includes(name.toLowerCase()),
			),
		);
		rawHeaders["content-type"] = "text/html; charset=utf-8";
		const headers = new Headers();
		for (const [name, value] of Object.entries(rawHeaders)) {
			if (typeof value === "string") headers.set(name, value);
		}
		const page = new Response(fixUgsFlash(await res.text()), { status: res.status, statusText: res.statusText, headers });
		page.rawHeaders = rawHeaders;
		return page;
	})();
});

// Any response can set cookies (pages, images, scripts...), so check after each one.
// Saving only happens when something actually changed.
scramjet.addEventListener("handleResponse", saveCookiesSoon);

// Slow's page is "cross-origin isolated", so pages shown inside it, and workers they start, must
// say they agree to that, or the browser blocks them (reCAPTCHA's worker was, breaking its check).
// Scramjet only adds this when the worker itself is isolated, which isn't the case on hosts
// like GitHub Pages, so it's added here every time.
const ISOLATED_KINDS = ["document", "iframe", "worker", "sharedworker"];

scramjet.addEventListener("handleResponse", (event) => {
	if (!ISOLATED_KINDS.includes(event.destination)) return;
	event.responseHeaders["Cross-Origin-Embedder-Policy"] = "require-corp";
	event.responseHeaders["Cross-Origin-Opener-Policy"] = "same-origin";
	if (event.destination !== "document" && event.destination !== "iframe") return;

	if (typeof event.responseBody !== "string") return;

	const html = event.responseBody;
	const injected = html.match(SCRAMJET_SCRIPTS);
	if (!injected) return;

	const ours = injected[0] + TAB_VOLUME_SCRIPT + ADBLOCK_SCRIPT + ENGLISH_SCRIPT;
	const firstScript = html.search(/<script[\s>]/i);

	if (firstScript === -1 || firstScript >= injected.index) {
		// Scramjet's scripts already come first; just add ours after them.
		event.responseBody =
			html.slice(0, injected.index) + ours + html.slice(injected.index + injected[0].length);
		return;
	}

	event.responseBody =
		html.slice(0, firstScript) +
		ours +
		html.slice(firstScript, injected.index) +
		html.slice(injected.index + injected[0].length);
});

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});

// A new version of this worker takes over right away instead of waiting for every tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The page saves Scramjet's settings each time it loads; this makes the worker read them again
// (it otherwise keeps the first settings it loaded until the browser restarts it).
self.addEventListener("message", (event) => {
	if (event.data === "reload-config") scramjet.config = null;
	if (event.data?.type === "adblock") {
		blockAds = event.data.on !== false;
		caches
			.open(FLAGS_CACHE)
			.then((cache) => cache.put("adblock", new Response(blockAds ? "on" : "off")))
			.catch(() => {});
	}
});
