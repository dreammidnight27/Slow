// Paths are relative to this file, so Slow works from any folder (like a GitHub Pages project site).
importScripts("scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

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

async function handleRequest(event) {
	await scramjet.loadConfig();
	await cookiesLoaded;
	if (scramjet.route(event)) {
		if (event.request.method === "HEAD") return headRequest(event);
		return scramjet.fetch(event);
	}
	const response = await fetch(fresh(event.request));
	const { mode, destination } = event.request;
	const needsHeaders = mode === "navigate" || destination === "worker" || destination === "sharedworker";
	return needsHeaders ? isolated(response) : response;
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

// Any response can set cookies (pages, images, scripts...), so check after each one.
// Saving only happens when something actually changed.
scramjet.addEventListener("handleResponse", saveCookiesSoon);

scramjet.addEventListener("handleResponse", (event) => {
	if (event.destination !== "document" && event.destination !== "iframe") return;

	// Slow's page is "cross-origin isolated", so pages shown inside it must say they agree to that.
	// Scramjet only adds this when the worker itself is isolated, which isn't the case on hosts
	// like GitHub Pages, so it's added here every time.
	event.responseHeaders["Cross-Origin-Embedder-Policy"] = "require-corp";
	event.responseHeaders["Cross-Origin-Opener-Policy"] = "same-origin";

	if (typeof event.responseBody !== "string") return;

	const html = event.responseBody;
	const injected = html.match(SCRAMJET_SCRIPTS);
	if (!injected) return;

	const ours = injected[0] + TAB_VOLUME_SCRIPT;
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
});
