"use strict";

/* ============================================================
   SETTINGS - easy things to change
   ============================================================ */

// Where typed searches can go. %s is replaced by what you typed.
const SEARCH_ENGINES = {
	// "udm=14" is Google's plain "Web" results. Its full results page has scripts (like the
	// AI Overview's) that the proxy can't adapt yet, which leaves gaps and overlapping text.
	google: { name: "Google", url: "https://www.google.com/search?q=%s&udm=14" },
	duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
	bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
	brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
	startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
};

const MAX_TABS = 8;

/* ============================================================
   USER SETTINGS (changed from the settings panel, saved in this browser)
   ============================================================ */

const SETTINGS_KEY = "slow.settings";

const DEFAULT_SETTINGS = {
	searchEngine: "google",
	showShortcuts: true,
	history: true,
	suggestions: true,
	searchSuggestions: true,
	warnOnLeave: false,
	// Follows the system's "reduce motion" setting until changed here.
	reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
	stars: true,
	restoreTabs: true,
	dedupeTabs: true,
	// Tabs left in the background for a long time (and not making sound) let go of their memory.
	sleepTabs: true,
	// Minutes between break reminders; 0 turns them off.
	breakMinutes: 0,
	// Darken bright websites, except the sites listed in darkSkip.
	darkPages: true,
	darkSkip: [],
	// Which hover sound to play ("off" for none).
	hoverSound: "click",
	// "off", "stardust", "comet" or "glow"
	cursorTrail: "off",
	// "theme", "custom" (uses trailColor) or "rainbow"
	trailColorMode: "theme",
	trailColor: "#ff7ad9",
	soundVolume: 0.6,
	// Empty means the wisp server built into this app.
	wispUrl: "",
};

const settings = (() => {
	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
		// Older versions had an on/off "sounds" switch; keep it off for people who turned it off.
		if (saved.sounds === false && saved.hoverSound === undefined) saved.hoverSound = "off";
		delete saved.sounds;
		return { ...DEFAULT_SETTINGS, ...saved };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
})();

function saveSettings() {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// storage blocked (private mode); settings still apply until the page closes
	}
}

function searchTemplate() {
	return (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).url;
}

function calm() {
	return settings.reduceMotion;
}

// The folder Slow is served from: "/" on its own server, "/repo-name/" on GitHub Pages.
// Every file Slow loads is found relative to this, so it works in either place.
const BASE = new URL(".", location.href).pathname;

// The wisp server set in config.js (needed when Slow is hosted somewhere that can't run one,
// like GitHub Pages), otherwise the one built into Slow's own server.
function defaultWispUrl() {
	if (window.SLOW_CONFIG?.wisp) return window.SLOW_CONFIG.wisp;
	return (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + BASE + "wisp/";
}

/* ============================================================
   SOUND
   Hover sound effects: a short sound when the pointer moves onto an option, in the
   style picked in Settings. They're made on the fly
   with the Web Audio API (nothing to download), and browsers only allow it after
   your first click or key press.
   ============================================================ */

const sfx = (() => {
	let ctx = null;
	let out = null; // master volume
	let noise = null; // a moment of white noise, filtered into clicks and air

	function audio() {
		if (!ctx) {
			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return null;
			ctx = new AudioCtx();
			out = ctx.createGain();
			out.connect(ctx.destination);

			const length = Math.floor(ctx.sampleRate * 0.2);
			noise = ctx.createBuffer(1, length, ctx.sampleRate);
			const data = noise.getChannelData(0);
			for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
		}
		if (ctx.state === "suspended") ctx.resume();
		out.gain.value = settings.soundVolume;
		return ctx;
	}

	function envelope(gain, attack, dur) {
		const t = ctx.currentTime;
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(gain, t + attack);
		env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		env.connect(out);
		return env;
	}

	// Filtered noise: short and bright for clicks, longer and airy for whooshes.
	function hiss({ freq, q = 2, type = "bandpass", gain, attack = 0.001, dur }) {
		const src = ctx.createBufferSource();
		src.buffer = noise;
		const filter = ctx.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = freq;
		filter.Q.value = q;
		src.connect(filter).connect(envelope(gain, attack, dur));
		src.start(ctx.currentTime, Math.random() * 0.1, dur + 0.02);
	}

	// A sine tone that can glide, with an optional bell-like overtone.
	function tone({ freq, to = freq, gain, attack = 0.002, dur, overtone = 0 }) {
		const t = ctx.currentTime;
		const env = envelope(gain, attack, dur);
		for (const [ratio, level] of [[1, 1], [2.76, overtone]]) {
			if (!level) continue;
			const osc = ctx.createOscillator();
			const mix = ctx.createGain();
			osc.type = "sine";
			osc.frequency.setValueAtTime(freq * ratio, t);
			osc.frequency.exponentialRampToValueAtTime(to * ratio, t + dur * 0.6);
			mix.gain.value = level;
			osc.connect(mix).connect(env);
			osc.start(t);
			osc.stop(t + dur + 0.02);
		}
	}

	const wobble = (n) => n * (1 + (Math.random() * 2 - 1) * 0.04);

	// Each style takes a pitch multiplier, so tabs, buttons and cards sound a little different.
	const STYLES = {
		click: (p) => hiss({ freq: wobble(6500 * p), q: 3, gain: 0.025, dur: 0.012 }),
		tick: (p) => {
			tone({ freq: wobble(1900 * p), to: 1500 * p, gain: 0.03, dur: 0.03 });
			hiss({ freq: 5000 * p, gain: 0.012, dur: 0.008 });
		},
		pop: (p) => tone({ freq: wobble(380 * p), to: 900 * p, gain: 0.05, attack: 0.004, dur: 0.06 }),
		glass: (p) => tone({ freq: wobble(2350 * p), gain: 0.018, attack: 0.002, dur: 0.22, overtone: 0.35 }),
		thock: (p) => {
			tone({ freq: wobble(190 * p), to: 140 * p, gain: 0.07, attack: 0.002, dur: 0.05 });
			hiss({ freq: 1400 * p, type: "lowpass", q: 0.7, gain: 0.035, dur: 0.02 });
		},
		bubble: (p) => tone({ freq: wobble(700 * p), to: 1300 * p, gain: 0.035, attack: 0.006, dur: 0.08 }),
		whisper: (p) => hiss({ freq: wobble(7000 * p), q: 0.8, type: "highpass", gain: 0.02, attack: 0.01, dur: 0.07 }),
		blip: (p) => tone({ freq: wobble(1250 * p), to: 1000 * p, gain: 0.03, attack: 0.003, dur: 0.045 }),
	};

	return {
		STYLES: Object.keys(STYLES),
		hover(pitch = 1, style = settings.hoverSound) {
			if (!STYLES[style]) return; // "off" or unknown
			// Stay silent until the person has interacted with the page (browsers block it anyway).
			if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
			try {
				if (audio()) STYLES[style](pitch);
			} catch {
				// never let a sound problem break anything
			}
		},
	};
})();

/* ============================================================
   SCRAMJET SETUP (same wiring as the original demo)
   ============================================================ */

const { ScramjetController } = $scramjetLoadController();

// Full addresses for Scramjet's files: pages that set a <base> address (many games do)
// would otherwise look for them on another site.
const scramFile = (name) => new URL(BASE + "scram/" + name, location.origin).href;

const scramjet = new ScramjetController({
	prefix: BASE + "scramjet/",
	files: {
		wasm: scramFile("scramjet.wasm.wasm"),
		all: scramFile("scramjet.all.js"),
		sync: scramFile("scramjet.sync.js"),
	},
	flags: {
		// Source maps are only a debugging aid, and they break big single-file pages
		// (like gn-math games) with "$scramjet$pushsourcemap is not defined".
		sourcemaps: false,
		// Lets pages load files with synchronous requests. GameMaker games (like Retro Bowl)
		// read their data files this way; without it they start up with missing data and stay black.
		syncxhr: true,
	},
});

// Saves Scramjet's settings; the service worker is told to re-read them once this is done.
const scramjetInit = Promise.resolve(scramjet.init());

// A full address (not "/baremux/worker.js"): pages that set a <base> address would otherwise
// resolve the short path against another site and lose their connection.
const connection = new BareMux.BareMuxConnection(new URL(BASE + "baremux/worker.js", location.origin).href);
const TRANSPORT = BASE + "libcurl/index.mjs";
let transportUrl = TRANSPORT; // changes when Slow reconnects with a fresh copy (see reconnect())

// Registers the service worker and connects to the wisp server.
// It runs the first time you load a page, and again after the wisp server is changed in settings.
let readyPromise = null;
let connectedWisp = null;
function ensureReady() {
	if (!readyPromise) {
		readyPromise = (async () => {
			await scramjetInit;
			await registerSW();

			const wispUrl = settings.wispUrl || defaultWispUrl();
			if (
				connectedWisp !== wispUrl ||
				(await connection.getTransport()) !== transportUrl
			) {
				await connection.setTransport(transportUrl, [
					{ websocket: wispUrl },
				]);
				connectedWisp = wispUrl;
			}
		})().catch((err) => {
			readyPromise = null; // allow a retry
			throw err;
		});
	}
	return readyPromise;
}

/* ---------- reconnect when the connection wears out ----------
   After many sites, libcurl (what Slow uses to reach the wisp server) can get stuck failing
   every secure site with an SSL error, until the page is reloaded. Reconnecting with the same
   copy keeps the stuck state, so Slow loads a fresh copy of it instead, then loads the page again
   (once, so a site that's really broken isn't retried forever). */

const WORN_CONNECTION = /error code (35|60)\b|SSL connect error|SSL peer certificate/;
let reconnecting = null;

// Slow's own way to fetch through the proxy (search suggestions use it too).
let proxyClient = null;
function proxyFetch(url) {
	proxyClient ||= new BareMux.BareClient(new URL(BASE + "baremux/worker.js", location.origin).href);
	return proxyClient.fetch(url);
}

// Checks the connection with a tiny, always-there address.
async function connectionWorks() {
	try {
		const res = await Promise.race([
			proxyFetch("https://www.gstatic.com/generate_204"),
			new Promise((resolve) => setTimeout(resolve, 6000)),
		]);
		return res?.status === 204;
	} catch {
		return false;
	}
}

function reconnect() {
	if (!reconnecting) {
		const wispUrl = settings.wispUrl || defaultWispUrl();
		transportUrl = `${TRANSPORT}?fresh=${Date.now()}`;
		reconnecting = connection
			.setTransport(transportUrl, [{ websocket: wispUrl }])
			.then(() => (connectedWisp = wispUrl))
			// Tabs that failed at the same moment share this one reconnect.
			.finally(() => setTimeout(() => (reconnecting = null), 3000));
	}
	return reconnecting;
}

async function recoverConnection(tab) {
	let message = "";
	try {
		const doc = tab.frame.frame.contentDocument;
		if (doc?.title !== "Scramjet") return; // Scramjet's own error page
		const details = doc.querySelector("textarea, pre");
		message = details?.value || details?.textContent || "";
	} catch {
		return;
	}
	if (!WORN_CONNECTION.test(message)) return;
	if (performance.now() - (tab.reconnectedAt || -Infinity) < 20000) return;
	tab.reconnectedAt = performance.now();
	// The same error also means "that site doesn't exist or won't answer". Only reconnect if
	// the connection itself has stopped working; otherwise the site is the problem.
	if (await connectionWorks()) return;
	try {
		await reconnect();
	} catch {
		return;
	}
	if (tab.frame && tab.url) {
		startLoading(tab);
		tab.frame.go(tab.url);
	}
}

// A page whose files stopped arriving (still "loading" long after it started, usually blank).
// The first time, just load it again; if it gets stuck again, use a fresh connection too.
async function recoverStall(tab) {
	if (!tab.frame || !tab.loading || !tab.url) return;
	try {
		const doc = tab.frame.frame.contentDocument;
		if (doc && doc.readyState !== "loading") return;
	} catch {
		return;
	}
	if (tab.stallUrl !== tab.url) {
		tab.stallUrl = tab.url;
		tab.stalls = 0;
	}
	tab.stalls++;
	if (tab.stalls > 2) return; // it really is broken; leave it be
	if (tab.stalls === 2) {
		try {
			await reconnect();
		} catch {}
	}
	if (tab.frame && tab.url) {
		startLoading(tab);
		tab.frame.go(tab.url);
	}
}

/* ============================================================
   PAGE ELEMENTS
   ============================================================ */

const tabStrip = document.getElementById("tab-strip");
const newTabBtn = document.getElementById("new-tab");
const backBtn = document.getElementById("btn-back");
const forwardBtn = document.getElementById("btn-forward");
const reloadBtn = document.getElementById("btn-reload");
const addressForm = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const homeForm = document.getElementById("home-form");
const homeSearch = document.getElementById("home-search");
const home = document.getElementById("home");
const viewport = document.getElementById("viewport");
const toast = document.getElementById("toast");
const loadbar = document.getElementById("loadbar");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");

/* ============================================================
   TABS
   Each tab is an object: { id, title, url, frame }
   "frame" is the Scramjet frame, created the first time the tab loads a page.
   ============================================================ */

const tabs = [];
let activeId = null;
let nextId = 1;

function activeTab() {
	return tabs.find((t) => t.id === activeId);
}

function hostOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function newTab() {
	if (tabs.length >= MAX_TABS) {
		showError(`You can have up to ${MAX_TABS} tabs open. Close one to open another.`);
		return null;
	}
	const tab = {
		id: nextId++,
		title: "New tab",
		url: "",
		frame: null,
		el: null,
		titleEl: null,
		loading: false,
		loadStart: 0,
		loadTimer: null,
		// Set on tabs restored from last time; the page loads when the tab is first opened.
		pendingUrl: null,
		volume: 1, // 0 to 1, set from the tab's right-click menu
		muted: false,
		soundEl: null,
		icon: null,
	};
	tabs.push(tab);
	activate(tab.id);
	return tab;
}

function activate(id) {
	// The tab you were on was last seen now (used to rest tabs you leave for a long time).
	const left = activeTab();
	if (left) left.seenAt = Date.now();
	activeId = id;
	const tab = activeTab();
	tab.seenAt = Date.now();

	// A restored tab wakes up (loads its page) the first time you open it.
	if (tab.pendingUrl) {
		const url = tab.pendingUrl;
		tab.pendingUrl = null;
		navigate(tab, url, { here: true });
	}

	renderTabs();
	updateView();
	if (!tab.frame && !tab.url) homeSearch.focus();
}

function closeTab(id) {
	const index = tabs.findIndex((t) => t.id === id);
	if (index === -1) return;

	const [tab] = tabs.splice(index, 1);
	clearTimeout(tab.loadTimer);
	clearTimeout(tab.stallTimer);

	// Remember it so it can be brought back with Undo or "Reopen closed tab".
	const closedUrl = tab.url || tab.pendingUrl;
	if (closedUrl) {
		closedTabs.push({ url: closedUrl, index });
		if (closedTabs.length > 20) closedTabs.shift();
		notify(`Closed ${hostOf(closedUrl)}`, [{ label: "Undo", run: reopenClosedTab }], 6000);
	}

	// Fade the closed page out (if you were looking at it) and shrink its tab.
	if (tab.frame) {
		const frameEl = tab.frame.frame;
		if (id === activeId) {
			frameEl.classList.add("leaving");
			setTimeout(() => frameEl.remove(), 200);
		} else {
			frameEl.remove();
		}
	}
	if (tab.el) {
		const tabEl = tab.el;
		tabEl.classList.add("closing");
		setTimeout(() => tabEl.remove(), 220);
	}

	if (tabs.length === 0) {
		newTab();
		return;
	}
	if (id === activeId) {
		activate(tabs[Math.max(0, index - 1)].id);
	} else {
		renderTabs();
	}
}

// Creates a tab's element the first time it is drawn (so it can animate in),
// then just updates it on later calls.
function renderTabs() {
	for (const tab of tabs) {
		if (!tab.el) {
			const el = document.createElement("div");
			el.className = "tab";
			el.setAttribute("role", "tab");
			el.tabIndex = 0;

			// The site's icon (a spinner while loading, a globe if the site has none).
			const icon = document.createElement("span");
			icon.className = "tab-icon";
			icon.setAttribute("aria-hidden", "true");
			const img = document.createElement("img");
			img.alt = "";
			img.decoding = "async";
			img.addEventListener("error", () => icon.classList.add("none"));
			img.addEventListener("load", () => icon.classList.remove("none"));
			icon.append(img);

			const sound = document.createElement("span");
			sound.className = "tab-sound";
			sound.setAttribute("aria-hidden", "true");

			const title = document.createElement("span");
			title.className = "tab-title";

			const close = document.createElement("button");
			close.className = "tab-close";
			close.type = "button";
			close.setAttribute("aria-label", "Close tab");
			close.textContent = "\u00d7";
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				closeTab(tab.id);
			});

			el.addEventListener("click", () => activate(tab.id));
			el.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					activate(tab.id);
				}
			});

			el.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				openTabMenu(tab, event.clientX, event.clientY);
			});

			el.append(icon, sound, title, close);
			tabStrip.append(el);
			tab.el = el;
			tab.titleEl = title;
			tab.soundEl = sound;
			tab.iconEl = icon;
		}

		// New tab page: Slow's own moon. A site: its icon (kept while it loads, if it had one).
		const site = tab.frame || tab.pendingUrl;
		const src = site ? tab.icon || "" : BASE + "favicon.svg";
		const img = tab.iconEl.firstChild;
		if (img.getAttribute("src") !== src) {
			tab.iconEl.classList.toggle("none", !src);
			if (src) img.src = src;
			else img.removeAttribute("src");
		}
		tab.iconEl.classList.toggle("spin", tab.loading);

		tab.el.classList.toggle("active", tab.id === activeId);
		tab.el.classList.toggle("loading", tab.loading);
		tab.el.classList.toggle("sleeping", Boolean(tab.pendingUrl));
		tab.el.setAttribute("aria-selected", String(tab.id === activeId));
		tab.titleEl.textContent = tab.title;
		tab.el.title = tab.url || tab.pendingUrl || "";

		// A speaker on tabs that are muted or turned down.
		const quiet = tab.muted || tab.volume < 1;
		tab.soundEl.hidden = !quiet;
		tab.soundEl.textContent = tab.muted || tab.volume === 0 ? "🔇" : "🔉";
		tab.el.classList.toggle("muted", tab.muted);
	}

	saveSession();
}

// Replays an element's fade-in animation.
function playEnter(el) {
	el.classList.remove("enter");
	void el.offsetWidth; // forces the browser to restart the animation
	el.classList.add("enter");
}

// Top loading bar: "running" starts it, "done" finishes and fades it out.
function setLoadbar(state) {
	loadbar.className = "";
	if (state === "running") {
		loadbar.style.transition = "none";
		loadbar.style.transform = "scaleX(0)";
		void loadbar.offsetWidth;
		loadbar.style.transition = "";
		loadbar.style.transform = "";
		loadbar.className = "running";
	} else if (state === "done") {
		loadbar.className = "done";
	}
}

let lastShown = null;
let barKey = null;

// Shows the active tab's page (or the new tab page) and hides the rest.
function updateView() {
	const current = activeTab();
	for (const tab of tabs) {
		if (tab.frame) {
			tab.frame.frame.classList.toggle("hidden", tab.id !== activeId);
		}
	}

	const showingFrame = Boolean(current && current.frame);
	home.classList.toggle("hidden", showingFrame);

	// The first-load reveal stays as it is until you first leave the new tab page. Switching
	// it to the quicker comeback fade then, while the page is hidden, means nothing visibly
	// changes. (Switching while it's on screen made the title flicker and the logo twitch.)
	if (showingFrame) home.classList.remove("intro");
	else window.__slowStarfield?.(); // the sky is visible again

	const target = showingFrame ? current.frame.frame : home;
	if (target !== lastShown) {
		playEnter(target);
		lastShown = target;
	}

	const key = current && current.loading ? current.id : null;
	if (key !== barKey) {
		setLoadbar(key !== null ? "running" : "done");
		barKey = key;
	}

	renderPageError(showingFrame && current.error != null && !current.loading ? current : null);

	// Never overwrite what you're in the middle of typing.
	if (document.activeElement !== address) address.value = current ? current.url : "";
	document.title = showingFrame ? `${current.title} | Slow` : "Slow";
}

/* ---------- "couldn't load" page ---------- */

const pageError = document.getElementById("page-error");
const pageErrorText = document.getElementById("page-error-text");
const pageErrorCode = document.getElementById("page-error-code");

// What went wrong, in plain words (from the proxy's technical message).
function explainLoadError(message) {
	if (/error code 6\b|resolve host/i.test(message)) {
		return "That address doesn't seem to exist. Check it for typos.";
	}
	if (/error code 28\b|timed out/i.test(message)) {
		return "The site took too long to answer. It may be busy or down right now.";
	}
	if (/error code (7|35|56|60)\b|SSL|connect/i.test(message)) {
		return "The site didn't answer. It may be down, the address may be mistyped, or the proxy server may not be allowed to reach it.";
	}
	return "Something went wrong while loading the page.";
}

// Shows the page for `tab` (or hides it for null).
function renderPageError(tab) {
	pageError.classList.toggle("hidden", !tab);
	if (!tab) return;
	document.getElementById("page-error-title").textContent = `Couldn't reach ${hostOf(tab.url)}`;
	pageErrorText.textContent = explainLoadError(tab.error);
	pageErrorCode.textContent = tab.error.split("\n\nStack:")[0].trim();
}

document.getElementById("page-error-retry").addEventListener("click", () => {
	const tab = activeTab();
	if (!tab?.frame || !tab.url) return;
	tab.error = null;
	tab.stalls = 0;
	startLoading(tab);
	tab.frame.go(tab.url);
	renderTabs();
	updateView();
});

document.getElementById("page-error-search").addEventListener("click", () => {
	const tab = activeTab();
	if (!tab?.url) return;
	navigate(tab, searchTemplate().replace("%s", encodeURIComponent(hostOf(tab.url))), { here: true });
});

/* ============================================================
   NAVIGATION
   ============================================================ */

function startLoading(tab) {
	tab.loading = true;
	tab.loadStart = performance.now();
	clearTimeout(tab.loadTimer);
	clearTimeout(tab.stallTimer);
	// A page whose files stop arriving stays blank. If it's still stuck after a while, retry it.
	tab.stallTimer = setTimeout(() => recoverStall(tab), 12000);
	// Safety net: never show the loading bar for more than 20 seconds.
	tab.loadTimer = setTimeout(() => finishLoading(tab), 20000);
}

function finishLoading(tab) {
	clearTimeout(tab.loadTimer);
	clearTimeout(tab.stallTimer);
	if (!tab.loading) return;
	tab.loading = false;
	renderTabs();
	updateView();
}

// options.here: load in this tab even if the site is already open in another one.
async function navigate(tab, input, options = {}) {
	const text = input.trim();
	if (!text || !tab) return;

	const url = search(text, searchTemplate());

	// Already open somewhere else? Go to that tab instead of making a copy.
	const twin = settings.dedupeTabs && !options.here && findTabWithUrl(url, tab);
	if (twin) {
		activate(twin.id);
		notify(`${hostOf(url)} was already open, so you are back on that tab.`, [
			{ label: "Open here anyway", run: () => { activate(tab.id); navigate(tab, url, { here: true }); } },
		]);
		return;
	}

	try {
		await ensureReady();
	} catch (err) {
		showError(
			"Slow could not start the proxy. Make sure the server is running and you opened this page at http://localhost.",
			err.toString(),
		);
		return;
	}

	if (!tab.frame) {
		tab.frame = scramjet.createFrame();
		tab.frame.frame.className = settings.darkPages ? "sj-frame dark-start" : "sj-frame";
		viewport.appendChild(tab.frame.frame);

		// When the page finishes loading, stop the loading bar. (Ignores very
		// early events that fire when the empty frame is first created.)
		tab.frame.frame.addEventListener("load", () => {
			if (performance.now() - tab.loadStart > 250) finishLoading(tab);
			applyPageDarkMode(tab);
			applyPageLayout(tab);
			recoverConnection(tab);
		});
	}

	tab.url = url;
	tab.title = hostOf(url);
	tab.error = null;
	recordVisit(url, tab.title);
	startLoading(tab);
	tab.frame.go(url);

	renderTabs();
	updateView();
	hideError();
}

function goHome(tab) {
	if (!tab) return;
	if (tab.frame) {
		tab.frame.frame.remove();
		tab.frame = null;
	}
	tab.loading = false;
	clearTimeout(tab.loadTimer);
	clearTimeout(tab.stallTimer);
	tab.url = "";
	tab.title = "New tab";
	tab.icon = null;
	tab.error = null;
	renderTabs();
	updateView();
	homeSearch.value = "";
	homeSearch.focus();
}

// Back / forward / reload. Uses the Scramjet frame's own methods if it has
// them, and falls back to the iframe's history otherwise.
function frameAction(name) {
	const tab = activeTab();
	if (!tab || !tab.frame) return;
	try {
		if (typeof tab.frame[name] === "function") {
			tab.frame[name]();
			return;
		}
	} catch {}
	try {
		const win = tab.frame.frame.contentWindow;
		if (name === "back") win.history.back();
		else if (name === "forward") win.history.forward();
		else if (name === "reload") win.location.reload();
	} catch {}
}

/* ============================================================
   ERRORS
   ============================================================ */

let toastTimer = null;
function showError(message, code = "") {
	error.textContent = message;
	errorCode.textContent = code;
	toast.classList.remove("hidden", "leaving");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(hideError, 9000);
}

function hideError() {
	if (toast.classList.contains("hidden") || toast.classList.contains("leaving")) return;
	toast.classList.add("leaving");
	setTimeout(() => {
		toast.classList.add("hidden");
		toast.classList.remove("leaving");
	}, 200);
}

toast.addEventListener("click", hideError);

/* ============================================================
   EVENTS
   ============================================================ */

newTabBtn.addEventListener("click", newTab);
backBtn.addEventListener("click", () => frameAction("back"));
forwardBtn.addEventListener("click", () => frameAction("forward"));
reloadBtn.addEventListener("click", () => {
	reloadBtn.classList.add("spin");
	reloadBtn.addEventListener("animationend", () => reloadBtn.classList.remove("spin"), { once: true });

	const tab = activeTab();
	if (tab && tab.frame) {
		startLoading(tab);
		renderTabs();
		updateView();
	}
	frameAction("reload");
});

addressForm.addEventListener("submit", (event) => {
	event.preventDefault();
	hideSuggest();
	address.blur();
	navigate(activeTab(), address.value);
});

homeForm.addEventListener("submit", (event) => {
	event.preventDefault();
	hideSuggest();
	homeSearch.blur();
	navigate(activeTab(), homeSearch.value);
	homeSearch.value = "";
});

/* ---------- keep each tab's address, name and icon up to date ----------
   Clicking links inside a page changes its address, and pages set their own titles and icons. */

// The page's own icon (shown through the proxy), or the site's /favicon.ico if it names none.
function pageIcon(doc, pageUrl) {
	const links = [...doc.querySelectorAll('link[rel~="icon" i], link[rel="apple-touch-icon" i]')];
	const link = links.find((l) => /(^|\s)icon(\s|$)/i.test(l.rel)) || links[0];
	try {
		const href = link?.href; // the page's own address for it (Scramjet shows the original)
		if (href?.startsWith("data:")) return href;
		return scramjet.encodeUrl(new URL(href || "/favicon.ico", pageUrl).href);
	} catch {
		return null;
	}
}

// History shows each page's real name once it's known (it starts as just the site's address).
function nameVisit(url, title) {
	const item = recent.find((v) => v.url === url);
	if (item && item.title !== title) {
		item.title = title;
		writeList(RECENT_KEY, recent);
	}
}

setInterval(() => {
	let changed = false;
	for (const tab of tabs) {
		if (!tab.frame || !tab.url) continue;

		// (Not while a page is loading: until the new page arrives, the frame still reports the old one.)
		let current = null;
		try {
			const raw = tab.loading ? null : tab.frame.url;
			current = raw ? String(raw) : null;
		} catch {}
		if (current && /^https?:\/\//.test(current) && !current.startsWith(location.origin) && current !== tab.url) {
			tab.url = current;
			tab.title = hostOf(current);
			recordVisit(current, tab.title);
			changed = true;
		}

		let doc;
		try {
			doc = tab.frame.frame.contentDocument;
		} catch {}
		if (!doc?.documentElement) continue;

		let title = (doc.title || "").trim();
		const details = title === "Scramjet" ? doc.querySelector("textarea, pre") : null;
		const failed = Boolean(details);
		if (failed) title = `Couldn't load ${hostOf(tab.url)}`;
		// Slow shows its own "couldn't load" page over Scramjet's technical one.
		const error = failed ? details.value || details.textContent || "" : null;
		if (error !== (tab.error ?? null)) {
			tab.error = error;
			changed = true;
		}
		if (title.length > 60) title = title.slice(0, 57) + "…";
		if (title && title !== tab.title) {
			tab.title = title;
			if (!failed) nameVisit(tab.url, title);
			changed = true;
		}

		const icon = failed ? null : pageIcon(doc, tab.url);
		if (icon !== tab.icon && doc.readyState !== "loading") {
			tab.icon = icon;
			changed = true;
		}
	}
	if (changed) {
		renderTabs();
		updateView();
	}
}, 700);


/* ============================================================
   SHORTCUTS, RECENT SITES, ADDRESS SUGGESTIONS
   Saved in this browser's local storage. Nothing is sent anywhere.
   ============================================================ */

const RECENT_KEY = "slow.recent";
const SHORTCUT_KEY = "slow.shortcuts";
const RECENT_MAX = 15;
const SHORTCUT_SLOTS = 8;

const shortcutsEl = document.getElementById("shortcuts");
const suggestEl = document.getElementById("suggest");

function readList(key) {
	try {
		const value = JSON.parse(localStorage.getItem(key));
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

function writeList(key, list) {
	try {
		localStorage.setItem(key, JSON.stringify(list));
	} catch {
		// Storage is full or blocked. Slow still works, it just won't remember this.
	}
}

let recent = readList(RECENT_KEY);
// (Older versions saved shortcuts as http:// addresses; https is faster through the proxy.)
let shortcuts = readList(SHORTCUT_KEY).map((s) => ({ ...s, url: String(s.url).replace(/^http:\/\//, "https://") }));

/* ---------- recent sites ---------- */

function recordVisit(url, title) {
	if (!settings.history) return;

	recent = [{ url, title }, ...recent.filter((item) => item.url !== url)].slice(
		0,
		RECENT_MAX,
	);
	writeList(RECENT_KEY, recent);
}

/* ---------- shortcuts ---------- */

function saveShortcuts() {
	writeList(SHORTCUT_KEY, shortcuts);
	renderShortcuts();
}

// A site's icon, fetched through the proxy: its large app icon if it has one, else its favicon.
// If neither loads, the shortcut keeps showing its first letter.
function showSiteIcon(letterEl, url) {
	let origin;
	try {
		origin = new URL(url).origin;
	} catch {
		return;
	}
	const sources = ["/apple-touch-icon.png", "/favicon.ico"].map((path) => scramjet.encodeUrl(origin + path));
	const img = document.createElement("img");
	img.alt = "";
	img.decoding = "async";
	img.addEventListener("load", () => {
		letterEl.classList.add("has-icon");
		letterEl.append(img);
	});
	img.addEventListener("error", () => {
		const next = sources.shift();
		if (next) img.src = next;
	});
	ensureReady()
		.then(() => (img.src = sources.shift()))
		.catch(() => {});
}

function renderShortcuts() {
	shortcutsEl.textContent = "";

	// Saved shortcuts, then a single "Add" button while there's room for more.
	const count = Math.min(shortcuts.length + 1, SHORTCUT_SLOTS);

	for (let i = 0; i < count; i++) {
		const item = shortcuts[i];
		const wrap = document.createElement("div");
		wrap.className = "shortcut-wrap";
		wrap.style.setProperty("--i", String(i));

		const btn = document.createElement("button");
		btn.type = "button";

		const letter = document.createElement("span");
		letter.className = "shortcut-letter";

		const name = document.createElement("span");
		name.className = "shortcut-name";

		if (item) {
			btn.className = "shortcut";
			btn.title = item.url;
			btn.setAttribute("aria-label", "Open " + item.title);
			letter.textContent = (item.title || "?").charAt(0).toUpperCase();
			name.textContent = item.title;
			btn.append(letter, name);
			btn.addEventListener("click", () => navigate(activeTab(), item.url));
			btn.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				removeShortcut(i);
			});
			showSiteIcon(letter, item.url);

			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "shortcut-remove";
			remove.setAttribute("aria-label", `Remove ${item.title}`);
			remove.title = "Remove";
			remove.textContent = "×";
			remove.addEventListener("click", () => removeShortcut(i));
			wrap.append(btn, remove);
		} else {
			btn.className = "shortcut add";
			btn.setAttribute("aria-label", "Add shortcut");
			letter.textContent = "+";
			name.textContent = "Add";
			btn.append(letter, name);
			btn.addEventListener("click", addShortcut);
			wrap.append(btn);
		}

		shortcutsEl.append(wrap);
	}
}

const shortcutDialog = document.getElementById("shortcut-dialog");
const shortcutForm = document.getElementById("shortcut-form");
const shortcutUrl = document.getElementById("shortcut-url");
const shortcutName = document.getElementById("shortcut-name");
const shortcutNote = document.getElementById("shortcut-note");

function addShortcut() {
	if (shortcuts.length >= SHORTCUT_SLOTS) {
		notify(`You can have up to ${SHORTCUT_SLOTS} shortcuts. Remove one to add another.`);
		return;
	}
	shortcutForm.reset();
	shortcutNote.textContent = "";
	shortcutDialog.showModal();
	raiseTrail();
	shortcutUrl.focus();
}

shortcutForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const typed = shortcutUrl.value.trim();
	const url = typed && search(typed, searchTemplate());
	// Only real addresses (something with a dot, that isn't turned into a search).
	if (!typed || !typed.includes(".") || /\s/.test(typed) || url === searchTemplate().replace("%s", encodeURIComponent(typed))) {
		shortcutNote.textContent = "Type a web address, like example.com.";
		shortcutUrl.focus();
		return;
	}
	shortcuts.push({ url, title: shortcutName.value.trim() || hostOf(url) });
	saveShortcuts();
	shortcutDialog.close();
});

document.getElementById("shortcut-cancel").addEventListener("click", () => shortcutDialog.close());
shortcutDialog.addEventListener("click", (event) => {
	if (event.target === shortcutDialog) shortcutDialog.close();
});
shortcutUrl.addEventListener("input", () => (shortcutNote.textContent = ""));

function removeShortcut(index) {
	const [removed] = shortcuts.splice(index, 1);
	if (!removed) return;
	saveShortcuts();
	notify(
		`Removed ${removed.title}`,
		[
			{
				label: "Undo",
				run: () => {
					shortcuts.splice(Math.min(index, shortcuts.length), 0, removed);
					saveShortcuts();
				},
			},
		],
		6000,
	);
}

/* ---------- suggestions (address bar and the new tab page's search) ----------
   As you type: what Enter will do, open tabs and history that match, then your search
   engine's suggestions. Up/Down picks one (previewing it in the box), Enter goes,
   Escape puts back what you typed, then closes. */

// Each engine's suggestion feed. They all answer [query, [suggestion, ...]].
const SUGGEST_FEEDS = {
	google: "https://suggestqueries.google.com/complete/search?client=firefox&q=",
	duckduckgo: "https://duckduckgo.com/ac/?type=list&q=",
	bing: "https://api.bing.com/osjson.aspx?query=",
	brave: "https://search.brave.com/api/suggest?q=",
	startpage: "https://duckduckgo.com/ac/?type=list&q=", // Startpage has no public feed
};

// Asked through Slow's own connection, like your browsing (and other sites' rules about
// what a page may fetch don't get in the way).
const suggestCache = new Map();

async function webSuggestions(query) {
	const feed = SUGGEST_FEEDS[settings.searchEngine] || SUGGEST_FEEDS.google;
	const key = feed + query.toLowerCase();
	if (suggestCache.has(key)) return suggestCache.get(key);
	await ensureReady();
	let data;
	for (let attempt = 0; attempt < 2 && !data; attempt++) {
		try {
			const res = await proxyFetch(feed + encodeURIComponent(query));
			data = await res.json();
		} catch {
			// The connection may still be starting; one more try.
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	const list = (Array.isArray(data?.[1]) ? data[1] : []).filter((s) => typeof s === "string");
	suggestCache.set(key, list);
	if (suggestCache.size > 200) suggestCache.delete(suggestCache.keys().next().value);
	return list;
}

const SUGGEST_ICONS = {
	search: '<circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />',
	go: '<path d="M5 12h14M13 6l6 6-6 6" />',
	history: '<circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" />',
	tab: '<rect x="3.5" y="6" width="17" height="13" rx="2" /><path d="M3.5 10h17" />',
};

// Shows `text` with the part matching `query` set apart, safely (no HTML from outside).
function markMatch(el, text, query, { completion = false } = {}) {
	const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
	if (at === -1) {
		el.textContent = text;
		return;
	}
	const strong = document.createElement("b");
	if (completion && at === 0) {
		// Like most browsers: what you typed stays plain, the rest of the suggestion is bold.
		strong.textContent = text.slice(query.length);
		el.append(text.slice(0, query.length), strong);
	} else {
		strong.textContent = text.slice(at, at + query.length);
		el.append(text.slice(0, at), strong, text.slice(at + query.length));
	}
}

function attachSuggest(input, box, { showRecentWhenEmpty }) {
	let items = [];
	let selected = -1;
	let typed = ""; // what you actually typed (the box can show a previewed suggestion instead)
	let request = 0;

	function close() {
		box.classList.add("hidden");
		box.textContent = "";
		items = [];
		selected = -1;
		input.setAttribute("aria-expanded", "false");
	}

	function go(target) {
		close();
		input.blur();
		navigate(activeTab(), target);
		if (input === homeSearch) homeSearch.value = "";
	}

	function baseItems(query) {
		const list = [];
		const q = query.toLowerCase();
		if (query) {
			const target = search(query, searchTemplate());
			const isSearch = target === searchTemplate().replace("%s", encodeURIComponent(query));
			const engine = (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name;
			list.push(
				isSearch
					? { icon: "search", text: query, detail: `${engine} search`, fill: query, run: () => go(query), completion: true }
					: { icon: "go", text: hostOf(target), detail: target, fill: query, run: () => go(query) },
			);
		}
		if (!settings.suggestions) return list;

		const current = activeTab();
		// (a tab restored from last time keeps its address in pendingUrl until it's opened)
		const tabUrl = (t) => t.url || t.pendingUrl || "";
		const openTabs = query
			? tabs.filter(
					(t) =>
						t !== current &&
						tabUrl(t) &&
						(tabUrl(t).toLowerCase().includes(q) || (t.title || "").toLowerCase().includes(q)),
				)
			: [];
		for (const t of openTabs.slice(0, 2)) {
			list.push({
				icon: "tab",
				text: t.title || hostOf(tabUrl(t)),
				detail: "Switch to this tab",
				fill: tabUrl(t),
				run: () => {
					close();
					input.blur();
					activate(t.id);
				},
			});
		}

		if (query || showRecentWhenEmpty) {
			const visits = recent
				.filter((v) => !query || v.url.toLowerCase().includes(q) || (v.title || "").toLowerCase().includes(q))
				.filter((v) => !openTabs.some((t) => tabUrl(t) === v.url))
				.slice(0, query ? 3 : 6);
			for (const v of visits) {
				list.push({ icon: "history", text: v.title || hostOf(v.url), detail: v.url, fill: v.url, run: () => go(v.url) });
			}
		}
		return list;
	}

	function draw() {
		box.textContent = "";
		if (!items.length) {
			close();
			return;
		}
		items.forEach((item, i) => {
			const row = document.createElement("div");
			row.className = "suggest-item";
			row.setAttribute("role", "option");
			row.setAttribute("aria-selected", String(i === selected));

			const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			icon.setAttribute("viewBox", "0 0 24 24");
			icon.setAttribute("class", "ico suggest-icon");
			icon.setAttribute("aria-hidden", "true");
			icon.innerHTML = SUGGEST_ICONS[item.icon];

			const text = document.createElement("span");
			text.className = "item-title";
			markMatch(text, item.text, typed.trim(), { completion: item.completion });

			row.append(icon, text);
			if (item.detail) {
				const detail = document.createElement("span");
				detail.className = "item-url";
				detail.textContent = item.detail;
				row.append(detail);
			}
			// mousedown (not click) so the box keeps focus until something happens
			row.addEventListener("mousedown", (event) => {
				event.preventDefault();
				item.run();
			});
			row.addEventListener("mousemove", () => {
				if (selected !== i) {
					selected = i;
					for (const [j, el] of [...box.children].entries()) el.setAttribute("aria-selected", String(j === i));
				}
			});
			box.append(row);
		});
		box.classList.remove("hidden");
		input.setAttribute("aria-expanded", "true");
	}

	async function update() {
		typed = input.value;
		selected = -1;
		const query = typed.trim();
		const id = ++request;
		items = baseItems(query);
		draw();

		// The search engine's ideas join in a moment later (skipped for addresses).
		if (!query || !settings.searchSuggestions || /^[a-z]+:\/\//i.test(query)) return;
		await new Promise((r) => setTimeout(r, 120)); // wait for a pause in typing
		if (id !== request) return;
		let ideas = [];
		try {
			ideas = await webSuggestions(query);
		} catch {}
		if (id !== request || document.activeElement !== input) return;
		const shown = new Set(items.map((i) => i.text.toLowerCase()));
		for (const idea of ideas) {
			if (shown.has(idea.toLowerCase())) continue;
			shown.add(idea.toLowerCase());
			items.push({ icon: "search", text: idea, fill: idea, run: () => go(idea), completion: true });
			if (items.length >= 9) break;
		}
		draw();
	}

	function move(step) {
		if (!items.length) return;
		selected += step;
		if (selected < -1) selected = items.length - 1;
		if (selected >= items.length) selected = -1;
		// Previews the choice in the box; back at the top shows what you typed.
		input.value = selected === -1 ? typed : items[selected].fill;
		for (const [j, el] of [...box.children].entries()) el.setAttribute("aria-selected", String(j === selected));
	}

	input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-expanded", "false");
	input.addEventListener("input", update);
	input.addEventListener("focus", () => {
		// Clicking into the address bar selects it all, ready to type over.
		if (input === address) input.select();
		if (showRecentWhenEmpty || input.value.trim()) update();
	});
	input.addEventListener("blur", close);
	input.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (!items.length) return;
			event.preventDefault();
			move(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter" && selected >= 0) {
			event.preventDefault();
			items[selected].run();
		} else if (event.key === "Escape") {
			if (selected >= 0) {
				move(-1 - selected); // back to what you typed
			} else if (items.length) {
				close();
			} else {
				input.blur();
			}
		}
	});

	return { close };
}

const addressSuggest = attachSuggest(address, suggestEl, { showRecentWhenEmpty: true });
const homeSuggest = attachSuggest(homeSearch, document.getElementById("home-suggest"), { showRecentWhenEmpty: false });
function hideSuggest() {
	addressSuggest.close();
	homeSuggest.close();
}

renderShortcuts();

/* ============================================================
   THEMES
   ============================================================ */

const THEMES = [
	{ id: "nebula", name: "Nebula", colors: ["#07050f", "#b98cff", "#6b3fd6"] },
	{ id: "aurora", name: "Aurora", colors: ["#06141a", "#6dffb1", "#3ec9a0"] },
	{ id: "ember", name: "Ember", colors: ["#1a0a0a", "#ff8a5c", "#ffd166"] },
	{ id: "bubblegum", name: "Bubblegum", colors: ["#1b0a24", "#ff7ad9", "#ff5fbf"] },
	{ id: "solar", name: "Solar", colors: ["#140e04", "#ffd27a", "#ff9d4d"] },
	{ id: "midnight", name: "Midnight", colors: ["#08080c", "#cfd6ff", "#8a8fb3"] },
];

const THEME_KEY = "slow.theme";
const CUSTOM_COLORS_KEY = "slow.customColors";

const themeGrid = document.getElementById("theme-grid");
const surpriseBtn = document.getElementById("btn-surprise");
const themeFlash = document.getElementById("theme-flash");
const customAccentInput = document.getElementById("custom-accent");
const customBgInput = document.getElementById("custom-bg");

// Read by the starfield so stars and shooting stars match the theme.
let starColor = "#f3eeff";
let accentRGB = "185, 140, 255";

function cssVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex) {
	const n = parseInt(hex.replace("#", ""), 16);
	return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/* ---------- custom colors ---------- */

let customColors = (() => {
	try {
		const saved = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY));
		if (/^#[0-9a-f]{6}$/i.test(saved?.accent) && /^#[0-9a-f]{6}$/i.test(saved?.bg)) return saved;
	} catch {}
	return { accent: "#5ec8ff", bg: "#050b16" };
})();

function hexToHsl(hex) {
	const [r, g, b] = hexToRgb(hex).split(", ").map((n) => Number(n) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
	return [h * 360, s, l];
}

const hsl = (h, s, l, a = 1) =>
	`hsl(${((h % 360) + 360) % 360} ${Math.round(Math.min(1, s) * 100)}% ${Math.round(Math.min(1, l) * 100)}% / ${a})`;

// Every color the themes use, made to match the chosen accent and background.
function customThemeVars({ accent, bg }) {
	const [ah, as, al] = hexToHsl(accent);
	const [bh, bs, bl] = hexToHsl(bg);
	const dark = Math.min(bl, 0.12); // backgrounds stay dark so text stays readable
	const sat = Math.max(as, 0.35);
	return {
		"--void": hsl(bh, bs, dark),
		"--nebula": hsl(ah, sat * 0.6, 0.26),
		"--aurora": accent,
		"--ember": hsl(ah + 35, sat, Math.max(al, 0.65)),
		"--starlight": hsl(ah, 0.6, 0.95),
		"--bg-1": hsl(ah, sat * 0.6, 0.2),
		"--bg-2": hsl(bh, bs, Math.min(dark + 0.04, 0.16)),
		"--nebula-1": hsl(ah, sat, 0.55, 0.26),
		"--nebula-2": hsl(ah + 30, sat, 0.5, 0.18),
		"--planet-a": hsl(ah, 0.9, 0.88),
		"--planet-b": hsl(ah, sat, 0.6),
		"--planet-c": hsl(ah, sat * 0.6, 0.2),
		"--moon-dark": hsl(ah, sat * 0.6, 0.16),
		"--moon-mid": hsl(ah, sat * 0.65, 0.36),
		"--moon-base": hsl(ah, sat, 0.6),
		"--moon-light": hsl(ah, sat, 0.78),
		"--moon-rim": hsl(ah, 0.8, 0.94),
	};
}

function setCustomColors(colors) {
	customColors = colors;
	try {
		localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
	} catch {}
}

/* ---------- applying a theme ---------- */

const CUSTOM_THEME = { id: "custom", name: "Custom" };

function applyTheme(id, { animate = true } = {}) {
	const root = document.documentElement;
	const theme = id === "custom" ? CUSTOM_THEME : THEMES.find((t) => t.id === id) || THEMES[0];

	root.dataset.theme = theme.id;
	// Built-in themes come from the stylesheet; the custom one is set right on the page.
	for (const name of Object.keys(customThemeVars(customColors))) root.style.removeProperty(name);
	if (theme.id === "custom") {
		for (const [name, value] of Object.entries(customThemeVars(customColors))) {
			root.style.setProperty(name, value);
		}
	}

	starColor = cssVar("--starlight") || "#eef0ff";
	const accent = theme.id === "custom" ? customColors.accent : cssVar("--aurora") || "#b98cff";
	accentRGB = hexToRgb(accent);

	if (animate) {
		themeFlash.classList.remove("go");
		void themeFlash.offsetWidth;
		themeFlash.classList.add("go");
	}

	try {
		localStorage.setItem(THEME_KEY, theme.id);
	} catch {}

	for (const btn of themeGrid.children) {
		btn.setAttribute("aria-pressed", String(btn.dataset.theme === theme.id));
	}
	updateCustomSwatch();
}

function swatchBackground(dark, light, mid) {
	return `radial-gradient(circle at 35% 30%, ${light}, ${mid} 55%, ${dark})`;
}

function updateCustomSwatch() {
	const swatch = themeGrid.querySelector('[data-theme="custom"] .swatch');
	if (swatch) swatch.style.background = swatchBackground(customColors.bg, customColors.accent, customColors.accent + "99");
}

function renderThemeGrid() {
	themeGrid.textContent = "";
	for (const theme of [...THEMES, CUSTOM_THEME]) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "theme-option";
		btn.dataset.theme = theme.id;
		btn.setAttribute("aria-label", theme.name + " theme");

		const swatch = document.createElement("span");
		swatch.className = "swatch";
		if (theme.colors) swatch.style.background = swatchBackground(...theme.colors);

		const name = document.createElement("span");
		name.className = "theme-name";
		name.textContent = theme.name;

		btn.append(swatch, name);
		btn.addEventListener("click", () => applyTheme(theme.id));
		themeGrid.append(btn);
	}
	updateCustomSwatch();
}

// Changing a color picker switches to the custom theme and updates it as you drag.
function onCustomColorInput() {
	setCustomColors({ accent: customAccentInput.value, bg: customBgInput.value });
	applyTheme("custom", { animate: false });
}
customAccentInput.addEventListener("input", onCustomColorInput);
customBgInput.addEventListener("input", onCustomColorInput);

function fillCustomColorInputs() {
	customAccentInput.value = customColors.accent;
	customBgInput.value = customColors.bg;
}
fillCustomColorInputs();

// "Surprise me": the colors shuffle through a few themes, slow down,
// land on a random one, and a shooting star streaks across.
let surprising = false;

function surprise() {
	if (surprising) return;
	surprising = true;
	surpriseBtn.disabled = true;

	const current = document.documentElement.dataset.theme;
	const options = THEMES.map((t) => t.id).filter((id) => id !== current);
	const landing = options[Math.floor(Math.random() * options.length)];

	const pick = () => options[Math.floor(Math.random() * options.length)];
	const steps = 8;
	let step = 0;

	const tick = () => {
		step++;
		if (step < steps) {
			applyTheme(pick(), { animate: false });
			setTimeout(tick, 70 + step * step * 9);
		} else {
			applyTheme(landing);
			if (window.__slowStar) window.__slowStar();
			setTimeout(() => {
				surprising = false;
				surpriseBtn.disabled = false;
			}, 900);
		}
	};
	tick();
}

surpriseBtn.addEventListener("click", surprise);

// Load the saved theme (or the default) before the first visible frame.
renderThemeGrid();
applyTheme(
	(() => {
		try {
			return localStorage.getItem(THEME_KEY) || "nebula";
		} catch {
			return "nebula";
		}
	})(),
	{ animate: false },
);


/* ============================================================
   STARFIELD
   Stars drift very slowly and twinkle. A shooting star passes by
   every 20-40 seconds. Respects "reduce motion" settings.
   ============================================================ */

(function starfield() {
	const canvas = document.getElementById("stars");
	const ctx = canvas.getContext("2d");
	let running = false;

	let w = 0;
	let h = 0;
	let stars = [];
	let shoot = null;
	let px = 0;
	let py = 0;
	let tx = 0;
	let ty = 0;
	let nextShoot = performance.now() + 8000;

	// Sends a shooting star across right away ("Surprise me" uses this).
	window.__slowStar = () => {
		if (!calm() && settings.stars) shoot = { x: w * 0.75, y: h * 0.12, born: performance.now() };
	};

	function resize() {
		w = canvas.width = window.innerWidth;
		h = canvas.height = window.innerHeight;
		const count = Math.round((w * h) / 9000);
		stars = Array.from({ length: count }, () => ({
			x: Math.random() * w,
			y: Math.random() * h,
			r: Math.random() * 1.3 + 0.2,
			depth: Math.random() * 0.6 + 0.2,
			phase: Math.random() * Math.PI * 2,
		}));
	}

	// Nothing to see while a website or the games page covers the sky, so it rests until you're back.
	function covered() {
		return home.classList.contains("hidden") || !gamesMenu.classList.contains("hidden");
	}

	function draw(t) {
		if (covered()) {
			running = false;
			return;
		}
		const still = calm();
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = starColor;

		// Ease the whole field toward the pointer for a gentle parallax.
		px += (tx - px) * 0.04;
		py += (ty - py) * 0.04;

		for (const s of stars) {
			if (!still) {
				s.x -= s.depth * 0.05;
				if (s.x < 0) s.x = w;
			}
			ctx.globalAlpha = still ? 0.8 : 0.45 + 0.45 * Math.sin((t / 1800) * s.depth + s.phase);
			ctx.beginPath();
			ctx.arc(s.x - px * 30 * s.depth, s.y - py * 30 * s.depth, s.r, 0, Math.PI * 2);
			ctx.fill();
		}

		if (!still) {
			if (!shoot && t > nextShoot) {
				shoot = { x: w * (0.4 + Math.random() * 0.5), y: h * Math.random() * 0.4, born: t };
			}
			if (shoot) {
				const k = (t - shoot.born) / 1600;
				if (k > 1) {
					shoot = null;
					nextShoot = t + 20000 + Math.random() * 20000;
				} else {
					const x = shoot.x - k * 260;
					const y = shoot.y + k * 130;
					const grad = ctx.createLinearGradient(x, y, x + 90, y - 45);
					grad.addColorStop(0, `rgba(${accentRGB}, ${1 - k})`);
					grad.addColorStop(1, `rgba(${accentRGB}, 0)`);
					ctx.globalAlpha = 1;
					ctx.strokeStyle = grad;
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.moveTo(x, y);
					ctx.lineTo(x + 90, y - 45);
					ctx.stroke();
				}
			}
		}

		ctx.globalAlpha = 1;
		// Keep animating unless motion is reduced or the stars are off; then one still frame is enough.
		if (!still && settings.stars) requestAnimationFrame(draw);
		else running = false;
	}

	window.addEventListener("pointermove", (event) => {
		if (calm()) return;
		tx = event.clientX / w - 0.5;
		ty = event.clientY / h - 0.5;
	});

	// Called at start, whenever the motion or stars settings change, and when the sky comes back into view.
	function refresh() {
		canvas.hidden = !settings.stars;
		if (!settings.stars) {
			ctx.clearRect(0, 0, w, h);
			return;
		}
		if (calm()) {
			tx = ty = px = py = 0;
			shoot = null;
		}
		if (!running) {
			running = true;
			requestAnimationFrame(draw);
		}
	}
	window.__slowStarfield = refresh;

	resize();
	window.addEventListener("resize", () => {
		resize();
		refresh();
	});
	refresh();
})();

/* ============================================================
   CURSOR TRAILS (Settings > Appearance)
   Drawn on one see-through layer over everything, in the theme's colors.
   Works over websites too, since they load through Slow's own address.
   Only draws while something is moving; "Reduce motion" turns it off.
   ============================================================ */

const trailCanvas = document.createElement("canvas");
trailCanvas.className = "cursor-trail";
trailCanvas.setAttribute("aria-hidden", "true");
document.body.append(trailCanvas);
const trailCtx = trailCanvas.getContext("2d");

// Panels like Settings open in the browser's "top layer", above everything else. The trail
// lives there too, and is lifted back on top whenever one of them opens.
trailCanvas.popover = "manual";
function raiseTrail() {
	try {
		if (trailCanvas.matches(":popover-open")) trailCanvas.hidePopover();
		trailCanvas.showPopover();
	} catch {}
}
raiseTrail();

let trailW = 0;
let trailH = 0;
let trailLoop = 0;
let lastPoint = null;
const dust = []; // stardust: { x, y, vx, vy, born, life, size }
const comet = []; // comet: recent points { x, y, at }
const glow = { x: 0, y: 0, tx: 0, ty: 0, alpha: 0, seen: 0 };

function sizeTrail() {
	const ratio = window.devicePixelRatio || 1;
	trailW = window.innerWidth;
	trailH = window.innerHeight;
	trailCanvas.width = trailW * ratio;
	trailCanvas.height = trailH * ratio;
	trailCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
sizeTrail();
window.addEventListener("resize", sizeTrail);

function trailOn() {
	return settings.cursorTrail && settings.cursorTrail !== "off" && !calm();
}

// Called for every mouse move, on Slow itself or inside a website (already in screen coordinates).
function trailMove(x, y) {
	if (!trailOn()) return;
	const now = performance.now();
	const style = settings.cursorTrail;

	if (style === "stardust") {
		// a couple of sparks for every bit of distance travelled
		const dist = lastPoint ? Math.hypot(x - lastPoint.x, y - lastPoint.y) : 0;
		const count = Math.min(4, 1 + Math.floor(dist / 12));
		for (let i = 0; i < count; i++) {
			dust.push({
				x: x + (Math.random() - 0.5) * 6,
				y: y + (Math.random() - 0.5) * 6,
				vx: (Math.random() - 0.5) * 0.6,
				vy: (Math.random() - 0.5) * 0.6 + 0.15,
				born: now,
				life: 500 + Math.random() * 500,
				size: 0.8 + Math.random() * 1.8,
			});
		}
		if (dust.length > 300) dust.splice(0, dust.length - 300);
	} else if (style === "comet") {
		comet.push({ x, y, at: now });
	} else if (style === "glow") {
		glow.tx = x;
		glow.ty = y;
		if (!glow.alpha) {
			glow.x = x;
			glow.y = y;
		}
		glow.seen = now;
	}

	lastPoint = { x, y };
	if (!trailLoop) trailLoop = requestAnimationFrame(drawTrail);
}

// The trail's colors, from Settings: the theme's, your own, or a cycling rainbow.
// shade: 0 = the main color, 1 = a lighter one (stardust mixes the two so it sparkles).
// spot: a number that differs along the trail, so a rainbow spreads out instead of being one color.
function trailColor(alpha, { shade = 0, spot = 0, now = performance.now() } = {}) {
	const mode = settings.trailColorMode;
	if (mode === "rainbow") {
		const hue = (now / 12 + spot * 14) % 360;
		return `hsla(${hue}, 95%, ${shade ? 82 : 66}%, ${alpha})`;
	}
	let rgb;
	if (mode === "custom" && /^#[0-9a-f]{6}$/i.test(settings.trailColor)) {
		rgb = hexToRgb(settings.trailColor).split(", ").map(Number);
	} else {
		rgb = accentRGB.split(",").map(Number);
		if (shade) return starColor;
	}
	// a lighter version of the color: halfway to white
	if (shade) rgb = rgb.map((c) => Math.round(c + (255 - c) * 0.55));
	return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function drawTrail(now) {
	trailCtx.clearRect(0, 0, trailW, trailH);
	let busy = false;

	// stardust
	for (let i = dust.length - 1; i >= 0; i--) {
		const p = dust[i];
		const k = (now - p.born) / p.life;
		if (k >= 1) {
			dust.splice(i, 1);
			continue;
		}
		p.x += p.vx;
		p.y += p.vy;
		trailCtx.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(now / 60 + i));
		trailCtx.fillStyle = trailColor(1, { shade: i % 3 ? 1 : 0, spot: i, now });
		trailCtx.beginPath();
		trailCtx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
		trailCtx.fill();
		busy = true;
	}

	// comet: a tapering tail through the last fraction of a second of movement
	while (comet.length && now - comet[0].at > 260) comet.shift();
	if (comet.length > 1) {
		trailCtx.lineCap = "round";
		for (let i = 1; i < comet.length; i++) {
			const k = i / comet.length; // 0 at the tail, 1 at the cursor
			trailCtx.globalAlpha = k * 0.85;
			trailCtx.strokeStyle = trailColor(1, { spot: comet.length - i, now });
			trailCtx.lineWidth = 1 + k * 5;
			trailCtx.beginPath();
			trailCtx.moveTo(comet[i - 1].x, comet[i - 1].y);
			trailCtx.lineTo(comet[i].x, comet[i].y);
			trailCtx.stroke();
		}
		const head = comet[comet.length - 1];
		trailCtx.globalAlpha = 0.9;
		trailCtx.fillStyle = trailColor(1, { shade: 1, now });
		trailCtx.beginPath();
		trailCtx.arc(head.x, head.y, 3, 0, Math.PI * 2);
		trailCtx.fill();
		busy = true;
	}

	// glow: a soft light easing after the cursor, fading once it stops
	if (settings.cursorTrail === "glow" || glow.alpha > 0.01) {
		glow.x += (glow.tx - glow.x) * 0.18;
		glow.y += (glow.ty - glow.y) * 0.18;
		const target = settings.cursorTrail === "glow" && now - glow.seen < 900 ? 1 : 0;
		glow.alpha += (target - glow.alpha) * 0.08;
		if (glow.alpha > 0.01) {
			const light = trailCtx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, 46);
			light.addColorStop(0, trailColor(0.35 * glow.alpha, { now }));
			light.addColorStop(1, trailColor(0, { now }));
			trailCtx.globalAlpha = 1;
			trailCtx.fillStyle = light;
			trailCtx.fillRect(glow.x - 46, glow.y - 46, 92, 92);
			busy = true;
		} else {
			glow.alpha = 0;
		}
	}

	trailCtx.globalAlpha = 1;
	trailLoop = busy ? requestAnimationFrame(drawTrail) : 0;
}

// Mouse moves on Slow itself...
window.addEventListener("pointermove", (event) => {
	if (event.pointerType !== "touch") trailMove(event.clientX, event.clientY);
});

// ...and inside websites: listen in each page, shifted by where its frame sits.
setInterval(() => {
	for (const tab of tabs) {
		if (!tab.frame) continue;
		let win;
		try {
			win = tab.frame.frame.contentWindow;
			if (!win || win.__slowTrail) continue;
			win.__slowTrail = true;
		} catch {
			continue;
		}
		const frameEl = tab.frame.frame;
		win.addEventListener("pointermove", (event) => {
			if (event.pointerType === "touch") return;
			const rect = frameEl.getBoundingClientRect();
			trailMove(rect.left + event.clientX, rect.top + event.clientY);
		});
	}
}, 500);

// Clear anything left on screen when the trail is switched off or changed.
function resetTrail() {
	dust.length = 0;
	comet.length = 0;
	glow.alpha = 0;
	lastPoint = null;
	trailCtx.clearRect(0, 0, trailW, trailH);
}

/* ============================================================
   SETTINGS PANEL
   ============================================================ */

const settingsBtn = document.getElementById("btn-settings");
const settingsDialog = document.getElementById("settings");
const settingsForm = document.getElementById("settings-form");
const engineSelect = document.getElementById("set-engine");
const wispInput = document.getElementById("set-wisp");
const wispNote = document.getElementById("wisp-note");

for (const [id, engine] of Object.entries(SEARCH_ENGINES)) {
	engineSelect.add(new Option(engine.name, id));
}

// Puts every setting into effect. Safe to call any time.
function applySettings() {
	document.documentElement.dataset.motion = settings.reduceMotion ? "reduced" : "full";
	window.__slowStarfield?.();
	resetTrail();

	shortcutsEl.closest(".quick-group").classList.toggle("hidden", !settings.showShortcuts);
	if (!settings.suggestions) hideSuggest();
	refreshDarkMode();
}

// Shows the saved values in the panel's controls.
function fillSettingsForm() {
	for (const input of settingsForm.querySelectorAll("input[type=checkbox][name]")) {
		input.checked = Boolean(settings[input.name]);
	}
	for (const picker of settingsForm.querySelectorAll("input[type=color][name]")) {
		picker.value = settings[picker.name];
	}
	for (const range of settingsForm.querySelectorAll("input[type=range][name]")) {
		range.value = String(settings[range.name]);
	}
	for (const select of settingsForm.querySelectorAll("select[name]")) {
		select.value = String(settings[select.name]);
	}
	wispInput.value = settings.wispUrl;
	wispInput.placeholder = defaultWispUrl();
	wispNote.textContent = "";
}

function openSettings() {
	fillSettingsForm();
	settingsDialog.showModal();
	raiseTrail();
}

settingsBtn.addEventListener("click", openSettings);

// Clicking the dimmed backdrop (outside the panel) closes it.
settingsDialog.addEventListener("click", (event) => {
	if (event.target === settingsDialog) settingsDialog.close();
});

// Switches and the search engine apply as soon as they change.
document.getElementById("set-trail-color").addEventListener("input", (event) => {
	settings.trailColor = event.target.value;
	settings.trailColorMode = "custom";
	document.getElementById("set-trail-mode").value = "custom";
});

settingsForm.addEventListener("change", (event) => {
	const input = event.target;
	if (input.type === "checkbox" && input.name) {
		settings[input.name] = input.checked;

		// Turning history off also forgets what was already saved.
		if (input.name === "history" && !input.checked) {
			recent = [];
			writeList(RECENT_KEY, recent);
		}
	} else if (input.type === "color" && input.name) {
		// Picking a trail color switches the trail to that color.
		settings[input.name] = input.value;
		if (input.name === "trailColor") settings.trailColorMode = "custom";
		fillSettingsForm();
	} else if (input.type === "range" && input.name) {
		settings[input.name] = Number(input.value);
		sfx.hover(); // a sample at the new volume
	} else if (input.tagName === "SELECT" && input.name) {
		settings[input.name] = input.dataset.type === "number" ? Number(input.value) : input.value;
		if (input.name === "hoverSound") sfx.hover(); // let you hear the one you picked
	} else {
		return;
	}
	saveSettings();
	applySettings();
});

// The wisp server has its own Save button, so a half-typed address is never used.
document.getElementById("save-wisp").addEventListener("click", () => {
	const value = wispInput.value.trim();
	if (value && !/^wss?:\/\/[^\s/]+/i.test(value)) {
		wispNote.textContent = "That doesn't look right. It should start with wss:// or ws://";
		return;
	}
	settings.wispUrl = value;
	saveSettings();
	// Reconnect through the new server the next time a page loads.
	readyPromise = null;
	wispNote.textContent = value
		? "Saved. New pages will load through this server."
		: "Saved. Using this app's built-in server.";
});

// Briefly swaps a button's label to confirm it worked.
function confirmOnButton(btn, text) {
	const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
	btn.textContent = text;
	clearTimeout(btn.resetTimer);
	btn.resetTimer = setTimeout(() => (btn.textContent = label), 1500);
}

wispInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		document.getElementById("save-wisp").click();
	}
});

document.getElementById("clear-history").addEventListener("click", (event) => {
	recent = [];
	writeList(RECENT_KEY, recent);
	confirmOnButton(event.currentTarget, "Cleared");
});

document.getElementById("clear-shortcuts").addEventListener("click", (event) => {
	if (shortcuts.length === 0) return;
	if (!window.confirm("Remove all of your shortcuts?")) return;
	shortcuts = [];
	saveShortcuts();
	confirmOnButton(event.currentTarget, "Removed");
});

document.getElementById("reset-settings").addEventListener("click", () => {
	if (!window.confirm("Put every setting back to how it started?")) return;
	Object.assign(settings, DEFAULT_SETTINGS);
	saveSettings();
	readyPromise = null;
	applySettings();
	fillSettingsForm();
});

// Asks before closing or reloading the page while sites are open, so tabs aren't lost by accident.
window.addEventListener("beforeunload", (event) => {
	if (settings.warnOnLeave && tabs.some((tab) => tab.frame)) {
		event.preventDefault();
		event.returnValue = "";
	}
});

applySettings();

/* ============================================================
   NOTICES
   Small friendly messages at the bottom, with optional buttons.
   ============================================================ */

const notice = document.getElementById("notice");
const noticeText = document.getElementById("notice-text");
const noticeActions = document.getElementById("notice-actions");
let noticeTimer = null;

// actions: [{ label, run }]. timeout 0 keeps it up until a button is pressed.
function notify(message, actions = [], timeout = 7000) {
	noticeText.textContent = message;
	noticeActions.textContent = "";
	for (const action of actions) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "notice-btn";
		btn.textContent = action.label;
		btn.addEventListener("click", () => {
			hideNotice();
			action.run?.();
		});
		noticeActions.append(btn);
	}

	notice.classList.remove("hidden", "leaving");
	playEnter(notice);
	clearTimeout(noticeTimer);
	// A thin bar along the bottom counts down until it closes by itself.
	notice.classList.remove("timed");
	if (timeout) {
		notice.style.setProperty("--life", `${timeout}ms`);
		void notice.offsetWidth;
		notice.classList.add("timed");
		noticeTimer = setTimeout(hideNotice, timeout);
	}
}

// When a new version of Slow's service worker takes over while Slow is open, offer a reload.
// (Not on the very first visit, when there was no worker before.)
if (navigator.serviceWorker) {
	const hadWorker = Boolean(navigator.serviceWorker.controller);
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (hadWorker) notify("Slow was updated.", [{ label: "Reload", run: () => location.reload() }], 0);
	});
}

function hideNotice() {
	clearTimeout(noticeTimer);
	if (notice.classList.contains("hidden")) return;
	notice.classList.add("leaving");
	setTimeout(() => notice.classList.add("hidden"), 200);
}

/* ============================================================
   REOPEN CLOSED TABS
   ============================================================ */

const closedTabs = [];

function reopenClosedTab() {
	const last = closedTabs.pop();
	if (!last) {
		notify("There are no closed tabs to bring back.");
		return;
	}
	const tab = newTab();
	if (!tab) return;

	// Put it back where it was.
	tabs.splice(tabs.indexOf(tab), 1);
	const index = Math.min(last.index, tabs.length);
	tabs.splice(index, 0, tab);
	tabStrip.insertBefore(tab.el, tabs[index + 1]?.el ?? null);

	navigate(tab, last.url, { here: true });
}

/* ============================================================
   DUPLICATE TABS
   ============================================================ */

// Treats https://www.example.com/page/ and https://example.com/page as the same.
function urlKey(url) {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search;
	} catch {
		return url;
	}
}

function findTabWithUrl(url, except) {
	const key = urlKey(url);
	return tabs.find(
		(t) => t !== except && (t.url || t.pendingUrl) && urlKey(t.url || t.pendingUrl) === key,
	);
}

/* ============================================================
   RESTORE TABS FROM LAST TIME
   Restored tabs "sleep" (nothing loads) until you open them.
   ============================================================ */

const SESSION_KEY = "slow.session";

function saveSession() {
	try {
		if (!settings.restoreTabs) {
			localStorage.removeItem(SESSION_KEY);
			return;
		}
		const urls = tabs.map((t) => t.url || t.pendingUrl || "");
		// Each tab's volume and mute, so they come back too.
		const sound = tabs.map((t) => ({ volume: t.volume, muted: t.muted }));
		// ...and their names and icons, so they look right before they load again.
		const titles = tabs.map((t) => (t.url || t.pendingUrl ? t.title : ""));
		const icons = tabs.map((t) => (t.icon && t.icon.length < 2000 ? t.icon : "")); // (skips big embedded pictures)
		localStorage.setItem(
			SESSION_KEY,
			JSON.stringify({ urls, sound, titles, icons, active: tabs.findIndex((t) => t.id === activeId) }),
		);
	} catch {}
}

function restoreSession() {
	if (!settings.restoreTabs) return false;

	let saved;
	try {
		saved = JSON.parse(localStorage.getItem(SESSION_KEY));
	} catch {}
	const urls = (saved?.urls || []).filter((u) => typeof u === "string").slice(0, MAX_TABS);
	if (!urls.some(Boolean)) return false;

	urls.forEach((url, i) => {
		const sound = saved.sound?.[i] || {};
		tabs.push({
			id: nextId++,
			title: url ? (typeof saved.titles?.[i] === "string" && saved.titles[i]) || hostOf(url) : "New tab",
			url: "",
			frame: null,
			el: null,
			titleEl: null,
			loading: false,
			loadStart: 0,
			loadTimer: null,
			pendingUrl: url || null,
			volume: typeof sound.volume === "number" ? Math.min(1, Math.max(0, sound.volume)) : 1,
			muted: sound.muted === true,
			soundEl: null,
			icon: (url && typeof saved.icons?.[i] === "string" && saved.icons[i]) || null,
		});
	});
	const active = tabs[saved.active] || tabs[0];
	activate(active.id);
	return true;
}

/* ============================================================
   RESTING TABS
   A tab you haven't looked at for a while lets go of its page (and the memory and
   processing it uses) unless it's playing sound. It stays in the tab bar, faded, and
   loads again the moment you open it, just like tabs restored from last time.
   ============================================================ */

const SLEEP_AFTER = 30 * 60_000;

function sleepTab(tab) {
	if (!tab.frame || !tab.url) return;
	tab.frame.frame.remove();
	tab.frame = null;
	tab.pendingUrl = tab.url;
	tab.url = "";
	tab.loading = false;
	clearTimeout(tab.loadTimer);
	clearTimeout(tab.stallTimer);
	renderTabs();
}

function tabIsBusy(tab) {
	if (tab.loading) return true;
	try {
		return Boolean(tab.frame.frame.contentWindow.__slowPlaying?.());
	} catch {
		return false;
	}
}

setInterval(() => {
	if (!settings.sleepTabs) return;
	const now = Date.now();
	for (const tab of tabs) {
		if (tab.id === activeId || !tab.frame) continue;
		if (now - (tab.seenAt || now) < SLEEP_AFTER) continue;
		if (tabIsBusy(tab)) {
			tab.seenAt = now; // check again later
			continue;
		}
		sleepTab(tab);
	}
}, 60_000);

/* ============================================================
   BREAK REMINDERS
   Counts time the page is on screen. Being away for 5+ minutes counts as a break.
   ============================================================ */

let activeSince = Date.now();
let hiddenAt = 0;

document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		hiddenAt = Date.now();
	} else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) {
		activeSince = Date.now();
	}
});

function breakLength(minutes) {
	if (minutes >= 60 && minutes % 60 === 0) {
		const hours = minutes / 60;
		return `${hours} hour${hours > 1 ? "s" : ""}`;
	}
	return `${minutes} minutes`;
}

setInterval(() => {
	const minutes = settings.breakMinutes;
	if (!minutes || document.hidden) return;
	if (Date.now() - activeSince < minutes * 60_000) return;

	activeSince = Date.now();
	notify(
		`You've been browsing for ${breakLength(minutes)}. Take your time: look at something far away, stretch, or grab some water.`,
		[
			{
				label: "Remind me in 10 min",
				run: () => (activeSince = Date.now() - Math.max(0, minutes - 10) * 60_000),
			},
			{ label: "Thanks", run: () => (activeSince = Date.now()) },
		],
		0,
	);
}, 30_000);

/* ============================================================
   COMMAND PALETTE (Ctrl+K)
   ============================================================ */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
for (const el of document.querySelectorAll("[data-mod]")) el.textContent = MOD;

const palette = document.getElementById("palette");
const paletteInput = document.getElementById("palette-input");
const paletteList = document.getElementById("palette-list");
let paletteItems = [];
let paletteIndex = 0;

const KIND_ICON = {
	go: "→",
	tab: "▭",
	shortcut: "★",
	history: "↺",
	action: "›",
};

function paletteActions() {
	const actions = [
		{ label: "New tab", hint: "Alt+T", run: newTab },
		{ label: "Close this tab", hint: "Alt+W", run: () => closeTab(activeId) },
		closedTabs.length && {
			label: "Reopen closed tab",
			detail: hostOf(closedTabs.at(-1).url),
			hint: "Alt+Shift+T",
			run: reopenClosedTab,
		},
		{ label: "Go to the new tab page", run: () => goHome(activeTab()) },
		settings.darkPages &&
			activeTab()?.url && {
				label: darkSkipped(activeTab().url)
					? `Turn dark mode back on for ${hostOf(activeTab().url)}`
					: `Turn off dark mode for ${hostOf(activeTab().url)}`,
				run: () => toggleDarkForSite(hostOf(activeTab().url)),
			},
		{
			label: settings.darkPages ? "Turn off dark mode for all websites" : "Turn on dark mode for websites",
			run: () => {
				settings.darkPages = !settings.darkPages;
				saveSettings();
				applySettings();
			},
		},
		{ label: "Settings", run: openSettings },
		{ label: "Surprise me with a theme", run: surprise },
		...[...THEMES, CUSTOM_THEME].map((t) => ({ label: `Theme: ${t.name}`, run: () => applyTheme(t.id) })),
		{
			label: settings.reduceMotion ? "Turn animations back on" : "Reduce motion",
			run: () => {
				settings.reduceMotion = !settings.reduceMotion;
				saveSettings();
				applySettings();
			},
		},
		{
			label: settings.breakMinutes
				? "Turn off break reminders"
				: "Turn on break reminders (every 45 min)",
			run: () => {
				settings.breakMinutes = settings.breakMinutes ? 0 : 45;
				activeSince = Date.now();
				saveSettings();
				notify(
					settings.breakMinutes
						? "Break reminders are on. You can change how often in Settings."
						: "Break reminders are off.",
				);
			},
		},
		recent.length && {
			label: "Clear history",
			run: () => {
				recent = [];
				writeList(RECENT_KEY, recent);
				notify("History cleared.");
			},
		},
	];
	return actions.filter(Boolean).map((a) => ({ kind: "action", ...a }));
}

function buildPaletteItems(query) {
	const q = query.trim();
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	const matches = (item) => {
		const text = `${item.label} ${item.detail || ""}`.toLowerCase();
		return words.every((w) => text.includes(w));
	};

	const openTabs = tabs.map((t) => ({
		kind: "tab",
		label: t.title,
		detail: t.url || t.pendingUrl || "New tab page",
		hint: t.id === activeId ? "Current tab" : "Switch to tab",
		img: t.frame || t.pendingUrl ? t.icon : BASE + "favicon.svg",
		run: () => activate(t.id),
	}));
	const saved = shortcuts.map((s) => ({
		kind: "shortcut",
		label: s.title,
		detail: s.url,
		hint: "Shortcut",
		run: () => navigate(activeTab(), s.url),
	}));
	const history = recent.map((r) => ({
		kind: "history",
		label: r.title,
		detail: r.url,
		hint: "History",
		run: () => navigate(activeTab(), r.url),
	}));

	if (!words.length) {
		return [...openTabs, ...paletteActions(), ...history.slice(0, 5)];
	}

	// Typed something: offer to go there or search for it, plus everything that matches.
	const target = search(q, searchTemplate());
	const isSearch = target === searchTemplate().replace("%s", encodeURIComponent(q));
	const engine = (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name;
	const go = {
		kind: "go",
		label: isSearch ? `Search ${engine} for “${q}”` : `Go to ${hostOf(target)}`,
		detail: isSearch ? "" : target,
		hint: "Enter",
		run: () => navigate(activeTab(), q),
	};

	// Things whose name starts with what you typed go above the web search.
	const iconGames = [...GAMES, ...MULTIPLAYER.filter((m) => !GAMES.some((g) => g.url === m.url))];
	const games = iconGames.map((g) => ({
		kind: "game",
		icon: g.icon,
		label: `Play ${g.name}`,
		detail: g.tag,
		hint: "Game",
		run: () => openGame(g),
	}));
	// Games from the collections join in once their lists have loaded (they start loading when the palette opens).
	for (const g of loadedSourceGames()) {
		games.push({ kind: "game", icon: "🎮", label: `Play ${g.name}`, detail: g.from, hint: "Game", run: () => openGame(g) });
	}
	const all = [...openTabs, ...paletteActions(), ...saved, ...games, ...history].filter(matches);
	const strong = all.filter((item) => item.label.toLowerCase().startsWith(words[0]));
	const rest = all.filter((item) => !strong.includes(item));
	return [...strong, go, ...rest].slice(0, 40);
}

function renderPalette() {
	paletteItems = buildPaletteItems(paletteInput.value);
	paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
	paletteList.textContent = "";

	paletteItems.forEach((item, i) => {
		const li = document.createElement("li");
		li.id = `palette-item-${i}`;
		li.className = "palette-item";
		li.setAttribute("role", "option");

		const icon = document.createElement("span");
		icon.className = `palette-icon ${item.kind}`;
		icon.textContent = item.icon || KIND_ICON[item.kind];
		icon.setAttribute("aria-hidden", "true");
		// Tabs show their site's icon (keeping the plain symbol if it doesn't load).
		if (item.img) {
			const img = new Image();
			img.alt = "";
			img.addEventListener("load", () => icon.replaceChildren(img), { once: true });
			img.src = item.img;
		}

		const text = document.createElement("span");
		text.className = "palette-text";
		const label = document.createElement("span");
		label.className = "palette-label";
		label.textContent = item.label;
		text.append(label);
		if (item.detail) {
			const detail = document.createElement("span");
			detail.className = "palette-detail";
			detail.textContent = item.detail;
			text.append(detail);
		}

		li.append(icon, text);
		if (item.hint) {
			const hint = document.createElement("span");
			hint.className = "palette-hint";
			hint.textContent = item.hint;
			li.append(hint);
		}

		li.addEventListener("pointermove", () => {
			if (paletteIndex !== i) {
				paletteIndex = i;
				updatePaletteSelection();
			}
		});
		li.addEventListener("click", () => runPaletteItem(i));
		paletteList.append(li);
	});

	if (!paletteItems.length) {
		const empty = document.createElement("li");
		empty.className = "palette-empty";
		empty.textContent = "Nothing matches that.";
		paletteList.append(empty);
	}
	updatePaletteSelection();
}

function updatePaletteSelection() {
	for (const li of paletteList.querySelectorAll(".palette-item")) {
		const selected = li.id === `palette-item-${paletteIndex}`;
		li.setAttribute("aria-selected", String(selected));
		if (selected) li.scrollIntoView({ block: "nearest" });
	}
	paletteInput.setAttribute(
		"aria-activedescendant",
		paletteItems.length ? `palette-item-${paletteIndex}` : "",
	);
}

function runPaletteItem(i) {
	const item = paletteItems[i];
	if (!item) return;
	palette.close();
	item.run();
}

function openPalette() {
	if (palette.open) {
		palette.close();
		return;
	}
	setGamesMenu(false);
	if (settingsDialog.open) settingsDialog.close();
	for (const source of GAME_SOURCES) {
		loadSource(source).then((list) => {
			if (list && palette.open && paletteInput.value.trim()) renderPalette();
		});
	}
	paletteInput.value = "";
	paletteIndex = 0;
	renderPalette();
	palette.showModal();
	raiseTrail();
	paletteInput.focus();
}

paletteInput.addEventListener("input", () => {
	paletteIndex = 0;
	renderPalette();
});

paletteInput.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		const count = Math.max(1, paletteItems.length);
		paletteIndex = (paletteIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
		updatePaletteSelection();
	} else if (event.key === "Enter") {
		event.preventDefault();
		runPaletteItem(paletteIndex);
	}
});

palette.addEventListener("click", (event) => {
	if (event.target === palette) palette.close();
});

document.getElementById("btn-palette").addEventListener("click", openPalette);

/* ============================================================
   KEYBOARD SHORTCUTS
   They work while focus is on Slow itself (not inside a website).
   ============================================================ */

document.addEventListener("keydown", (event) => {
	const mod = isMac ? event.metaKey : event.ctrlKey;

	if (mod && !event.altKey && !event.shiftKey && event.code === "KeyK") {
		event.preventDefault();
		openPalette();
		return;
	}

	if (!event.altKey || event.ctrlKey || event.metaKey) return;

	if (event.code === "KeyT" && event.shiftKey) {
		event.preventDefault();
		reopenClosedTab();
	} else if (event.code === "KeyT") {
		event.preventDefault();
		newTab();
	} else if (event.code === "KeyW") {
		event.preventDefault();
		closeTab(activeId);
	} else if (/^Digit[1-8]$/.test(event.code)) {
		const tab = tabs[Number(event.code.slice(5)) - 1];
		if (tab) {
			event.preventDefault();
			activate(tab.id);
		}
	}
});

/* ============================================================
   DARK MODE FOR WEBSITES
   Pages load through Slow's own address, so Slow can add a stylesheet to them.
   Bright pages get their colors flipped (softened a little, with hues kept),
   and pictures and videos are flipped back so they look normal.
   Pages that are already dark are left alone.
   ============================================================ */

const DARK_STYLE_ID = "slow-dark-mode";
const DARK_CSS = `
html {
	filter: invert(1) hue-rotate(180deg) contrast(0.88) !important;
	background-color: #fff !important;
}
img, video, canvas, iframe, embed, object, [style*="background-image"] {
	filter: invert(1) hue-rotate(180deg) !important;
}
`;

// Reads a CSS color like "rgb(12, 34, 56)" or "rgba(0, 0, 0, 0)" as [r, g, b, alpha].
function parseColor(value) {
	const parts = (value.match(/[\d.]+/g) || []).map(Number);
	if (parts.length < 3) return null;
	return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function brightness([r, g, b]) {
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// True when the page already has a dark background (or light text, which means the same thing).
// Our filter doesn't change these computed colors, so this keeps working after it's applied.
function pageLooksDark(doc) {
	const win = doc.defaultView;
	for (const el of [doc.documentElement, doc.body]) {
		if (!el) continue;
		const bg = parseColor(win.getComputedStyle(el).backgroundColor);
		if (bg && bg[3] > 0.5) return brightness(bg) < 0.4;
	}
	const text = doc.body && parseColor(win.getComputedStyle(doc.body).color);
	return Boolean(text && brightness(text) > 0.6);
}

function darkSkipped(url) {
	return settings.darkSkip.includes(hostOf(url));
}

// Games and apps that are mostly one big drawing area (or a frame or video): flipping their
// colors costs work on every frame and makes them look wrong, so they're left as they are.
function pageIsApp(doc) {
	const win = doc.defaultView;
	const half = (win.innerWidth * win.innerHeight) / 2;
	for (const el of doc.querySelectorAll("canvas, iframe, embed, object, video")) {
		const { width, height } = el.getBoundingClientRect();
		if (width * height > half) return true;
	}
	return false;
}

function applyPageDarkMode(tab) {
	if (!tab?.frame) return;
	const frameEl = tab.frame.frame;

	let doc;
	try {
		doc = frameEl.contentDocument;
	} catch {
		return;
	}
	if (!doc?.documentElement) return;

	const existing = doc.getElementById(DARK_STYLE_ID);
	const wanted =
		settings.darkPages && !darkSkipped(tab.url) && doc.body && !pageLooksDark(doc) && !pageIsApp(doc);

	if (wanted && !existing) {
		const style = doc.createElement("style");
		style.id = DARK_STYLE_ID;
		style.textContent = DARK_CSS;
		(doc.head || doc.documentElement).append(style);
	} else if (!wanted && existing) {
		existing.remove();
	}

	// A dark backdrop behind the page while it loads, so there's no white flash.
	frameEl.classList.toggle("dark-start", settings.darkPages && !darkSkipped(tab.url));
}

// Pages keep changing as they load (and sites switch pages without reloading), so check often.
setInterval(() => {
	if (document.hidden) return; // nobody is looking
	const tab = activeTab();
	if (tab?.frame) {
		applyPageDarkMode(tab);
		applyPageLayout(tab);
	}
}, 400);

function refreshDarkMode() {
	for (const tab of tabs) applyPageDarkMode(tab);
}

function toggleDarkForSite(host) {
	const skip = settings.darkSkip;
	const index = skip.indexOf(host);
	if (index === -1) skip.push(host);
	else skip.splice(index, 1);
	saveSettings();
	refreshDarkMode();
	notify(index === -1 ? `Dark mode is off for ${host}.` : `Dark mode is back on for ${host}.`);
}

/* ============================================================
   WEBSITES UNDER THE GLASS BAR
   Pages that scroll fill the whole window and start just below the bar, so their
   content slides under the glass as you scroll. Menus a site pins to the top of the
   window are moved down below the bar so they stay visible and clickable.
   Pages that don't scroll (games, full-screen apps) stay below the bar instead,
   so nothing of theirs gets covered.
   ============================================================ */

const chromeEl = document.querySelector(".chrome");
let barHeight = 0;

new ResizeObserver(() => {
	barHeight = Math.round(chromeEl.getBoundingClientRect().height);
	document.documentElement.style.setProperty("--bar-h", `${barHeight}px`);
	for (const tab of tabs) applyPageLayout(tab);
}).observe(chromeEl);

const INSET_STYLE_ID = "slow-under-bar";
// How deep into the page to look for pinned menus. Site headers sit near the top of the page's structure.
const PINNED_SELECTOR = ":scope > *, :scope > * > *, :scope > * > * > *, :scope > * > * > * > *";

// True for normal scrolling pages; false for games and apps that fill the window without scrolling.
function pageScrolls(doc) {
	const win = doc.defaultView;
	const root = doc.scrollingElement || doc.documentElement;
	const htmlY = win.getComputedStyle(doc.documentElement).overflowY;
	const bodyY = doc.body ? win.getComputedStyle(doc.body).overflowY : "visible";
	if (htmlY === "hidden" || htmlY === "clip" || bodyY === "hidden" || bodyY === "clip") return false;

	// Leave out the space Slow itself adds at the top, so it doesn't make a page look scrollable.
	const ownSpace = doc.getElementById(INSET_STYLE_ID) ? barHeight : 0;
	return root.scrollHeight - ownSpace > win.innerHeight + 40;
}

// Pinned things sitting under the bar right now, however deep in the page they are
// (some sites pin a menu inside other pinned wrappers). Found by looking at points along the bar.
function pinnedUnderBar(doc) {
	const win = doc.defaultView;
	const found = new Set();
	const y = Math.round(barHeight / 2);
	for (let i = 0; i < 8; i++) {
		const x = Math.round((win.innerWidth * (i + 0.5)) / 8);
		for (const hit of doc.elementsFromPoint(x, y)) {
			for (let el = hit; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
				const position = win.getComputedStyle(el).position;
				if (position === "fixed" || position === "sticky") {
					found.add(el);
					break;
				}
			}
		}
	}
	return found;
}

// Moves a site's own top-pinned menus (fixed or sticky) down by the height of Slow's bar.
function nudgePinned(doc) {
	const win = doc.defaultView;
	const candidates = new Set([...doc.body.querySelectorAll(PINNED_SELECTOR), ...pinnedUnderBar(doc)]);
	for (const el of candidates) {
		const style = win.getComputedStyle(el);
		const position = style.position;
		if (position !== "fixed" && position !== "sticky") continue;

		const top = parseFloat(style.top);
		const done = el.dataset.slowTop;
		// Already moved, and the site hasn't changed it since.
		if (done !== undefined && Math.abs(top - Number(done)) < 0.5) continue;

		if (position === "sticky") {
			if (Number.isNaN(top)) continue;
		} else {
			// Only pinned things that start up where the bar is (not footers or side buttons).
			const rect = el.getBoundingClientRect();
			if (rect.top >= barHeight || rect.bottom <= 0 || rect.height === 0) continue;
		}

		const base = Number.isNaN(top) ? el.getBoundingClientRect().top : top;
		const moved = base + barHeight;
		// Remember the site's own value the first time, so it can be put back exactly.
		if (done === undefined) {
			el.dataset.slowTopWas = el.style.getPropertyValue("top");
			el.dataset.slowTopPriority = el.style.getPropertyPriority("top");
		}
		el.style.setProperty("top", `${moved}px`, "important");
		el.dataset.slowTop = String(moved);
	}
}

// Puts back any menus moved by nudgePinned.
function unnudgePinned(doc) {
	for (const el of doc.querySelectorAll("[data-slow-top]")) {
		if (el.dataset.slowTopWas) el.style.setProperty("top", el.dataset.slowTopWas, el.dataset.slowTopPriority);
		else el.style.removeProperty("top");
		delete el.dataset.slowTop;
		delete el.dataset.slowTopWas;
		delete el.dataset.slowTopPriority;
	}
}

function applyPageLayout(tab) {
	if (!tab?.frame || !barHeight) return;
	const frameEl = tab.frame.frame;

	let doc;
	try {
		doc = frameEl.contentDocument;
	} catch {
		return;
	}
	if (!doc?.documentElement || !doc.body) return;

	// Once a page has gone under the bar it stays there while it's open, so pop-ups that
	// briefly stop scrolling don't make it jump. A newly loaded page is judged fresh.
	const under = frameEl.slowUnderDoc === doc || pageScrolls(doc);
	frameEl.slowUnderDoc = under ? doc : null;
	frameEl.classList.toggle("under", under);

	let style = doc.getElementById(INSET_STYLE_ID);
	if (!under) {
		style?.remove();
		unnudgePinned(doc);
		return;
	}
	const css = `html { padding-top: ${barHeight}px !important; scroll-padding-top: ${barHeight}px !important; }`;
	if (!style) {
		style = doc.createElement("style");
		style.id = INSET_STYLE_ID;
		(doc.head || doc.documentElement).append(style);
	}
	if (style.textContent !== css) style.textContent = css;

	nudgePinned(doc);
}

/* ============================================================
   TAB VOLUME AND THE TAB RIGHT-CLICK MENU
   tab-volume.js (added to every page by the service worker) scales the page's sound
   by window.__slowTabVolume, which Slow keeps set on each tab's page here.
   ============================================================ */

function tabLevel(tab) {
	return tab.muted ? 0 : tab.volume;
}

// Pages lose the value when they navigate, so this runs often, for every tab (background tabs too).
function pushTabVolume(tab) {
	if (!tab.frame) return;
	try {
		const win = tab.frame.frame.contentWindow;
		const level = tabLevel(tab);
		if (win.__slowTabVolume !== level) {
			win.__slowTabVolume = level;
			win.__slowApplyVolume?.();
		}
	} catch {}
}

setInterval(() => {
	for (const tab of tabs) pushTabVolume(tab);
}, 250);

function setTabVolume(tab, { volume = tab.volume, muted = tab.muted } = {}) {
	tab.volume = Math.min(1, Math.max(0, volume));
	tab.muted = muted;
	pushTabVolume(tab);
	renderTabs();
}

const tabMenu = document.getElementById("tab-menu");
const tabMenuMute = document.getElementById("tab-menu-mute");
const tabMenuVolume = document.getElementById("tab-menu-volume");
const tabMenuVolumeText = document.getElementById("tab-menu-volume-text");
let menuTab = null;

function refreshTabMenu() {
	if (!menuTab) return;
	tabMenuMute.textContent = menuTab.muted ? "Unmute tab" : "Mute tab";
	tabMenuMute.dataset.icon = menuTab.muted ? "\u{1F50A}" : "\u{1F507}";
	tabMenuVolume.value = String(Math.round(menuTab.volume * 100));
	tabMenuVolume.disabled = menuTab.muted;
	tabMenuVolumeText.textContent = menuTab.muted ? "Muted" : `${Math.round(menuTab.volume * 100)}%`;
	tabMenuVolume.style.setProperty("--fill", `${menuTab.volume * 100}%`);
	tabMenu.querySelector("[data-action=close-others]").disabled = tabs.length < 2;
	tabMenu.querySelector("[data-action=duplicate]").disabled =
		tabs.length >= MAX_TABS || !(menuTab.url || menuTab.pendingUrl);
	tabMenu.querySelector("[data-action=reload]").disabled = !menuTab.frame;
}

function openTabMenu(tab, x, y) {
	menuTab = tab;
	setGamesMenu(false);
	refreshTabMenu();
	tabMenu.classList.remove("hidden");

	// Keep it on screen.
	const { width, height } = tabMenu.getBoundingClientRect();
	tabMenu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
	tabMenu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
	tabMenuMute.focus();
}

function closeTabMenu() {
	if (tabMenu.classList.contains("hidden")) return;
	tabMenu.classList.add("hidden");
	menuTab = null;
}

tabMenuMute.addEventListener("click", () => {
	setTabVolume(menuTab, { muted: !menuTab.muted });
	refreshTabMenu();
});

tabMenuVolume.addEventListener("input", () => {
	setTabVolume(menuTab, { volume: Number(tabMenuVolume.value) / 100 });
	refreshTabMenu();
});

tabMenu.addEventListener("click", (event) => {
	const action = event.target.closest("[data-action]")?.dataset.action;
	if (!action || !menuTab) return;
	const tab = menuTab;
	closeTabMenu();

	if (action === "reload") {
		activate(tab.id);
		reloadBtn.click();
	} else if (action === "duplicate") {
		const copy = newTab();
		if (copy) {
			setTabVolume(copy, { volume: tab.volume, muted: tab.muted });
			navigate(copy, tab.url || tab.pendingUrl, { here: true });
		}
	} else if (action === "close-others") {
		for (const other of tabs.filter((t) => t !== tab)) closeTab(other.id);
		activate(tab.id);
	} else if (action === "close") {
		closeTab(tab.id);
	}
});

// Close on a click elsewhere, Escape, resizing, or switching away from the window.
document.addEventListener("pointerdown", (event) => {
	if (!event.composedPath().includes(tabMenu)) closeTabMenu();
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closeTabMenu();
});
window.addEventListener("resize", closeTabMenu);
window.addEventListener("blur", closeTabMenu);

// The keyboard's menu key (or Shift+F10) on a focused tab opens the menu too.
tabStrip.addEventListener("keydown", (event) => {
	if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
	const tab = tabs.find((t) => t.el === event.target);
	if (!tab) return;
	event.preventDefault();
	const rect = tab.el.getBoundingClientRect();
	openTabMenu(tab, rect.left + 12, rect.bottom + 4);
});

/* ============================================================
   GAMES
   Two lists: a few popular browser games, and the gn-math library
   (hundreds of games, loaded live from gn-math's own list).
   Every game opens in a tab like any other site.
   ============================================================ */

const GAMES = [
	{ name: "Slither.io", url: "https://slither.io", icon: "\u{1F40D}", tag: "Multiplayer", hue: 140 },
	{ name: "Krunker", url: "https://krunker.io", icon: "\u{1F3AF}", tag: "Shooter", hue: 30 },
	{ name: "Shell Shockers", url: "https://shellshock.io", icon: "\u{1F95A}", tag: "Shooter", hue: 45 },
	{ name: "Agar.io", url: "https://agar.io", icon: "\u{1F9A0}", tag: "Multiplayer", hue: 190 },
	{ name: "Diep.io", url: "https://diep.io", icon: "\u{1F53A}", tag: "Multiplayer", hue: 210 },
	{ name: "Paper.io 2", url: "https://paper-io.com", icon: "\u{1F7E5}", tag: "Multiplayer", hue: 0 },
	{ name: "Smash Karts", url: "https://smashkarts.io", icon: "\u{1F3CE}️", tag: "Racing", hue: 15 },
	{ name: "Bloxd.io", url: "https://bloxd.io", icon: "\u{1F9CA}", tag: "Building", hue: 200 },
	{ name: "Minecraft Classic", url: "https://classic.minecraft.net", icon: "⛏️", tag: "Building", hue: 100 },
	{ name: "skribbl.io", url: "https://skribbl.io", icon: "✏️", tag: "Party", hue: 260 },
	{ name: "TETR.IO", url: "https://tetr.io", icon: "\u{1F9F1}", tag: "Puzzle", hue: 280 },
	{ name: "2048", url: "https://play2048.co", icon: "\u{1F522}", tag: "Puzzle", hue: 35 },
	{ name: "Wordle", url: "https://www.nytimes.com/games/wordle", icon: "\u{1F7E9}", tag: "Word", hue: 120 },
	{ name: "Little Alchemy 2", url: "https://littlealchemy2.com", icon: "\u{1F9EA}", tag: "Puzzle", hue: 300 },
	{ name: "Cookie Clicker", url: "https://orteil.dashnet.org/cookieclicker", icon: "\u{1F36A}", tag: "Idle", hue: 25 },
	{ name: "Lichess", url: "https://lichess.org", icon: "♟️", tag: "Board", hue: 220 },
	{ name: "Chrome Dino", url: "https://chromedino.com", icon: "\u{1F996}", tag: "Arcade", hue: 90 },
	{ name: "Moomoo.io", url: "https://moomoo.io", icon: "\u{1F404}", tag: "Survival", hue: 60 },
	{ name: "Poki", url: "https://poki.com", icon: "🎮", tag: "Game site", hue: 200 },
	{ name: "CrazyGames", url: "https://www.crazygames.com", icon: "🕹️", tag: "Game site", hue: 270 },
	{ name: "Coolmath Games", url: "https://www.coolmathgames.com", icon: "➗", tag: "Game site", hue: 15 },
	{ name: "Miniclip", url: "https://www.miniclip.com", icon: "🎱", tag: "Game site", hue: 50 },
	{ name: "Run 3", url: "https://www.coolmathgames.com/0-run-3", icon: "🌌", tag: "Arcade", hue: 240 },
	{ name: "OvO", url: "https://www.coolmathgames.com/0-ovo", icon: "🤸", tag: "Platformer", hue: 0 },
	{ name: "Slow Roads", url: "https://slowroads.io", icon: "🛣️", tag: "Driving", hue: 35 },
	{ name: "Infinite Craft", url: "https://neal.fun/infinite-craft/", icon: "🔥", tag: "Crafting", hue: 20 },
	{ name: "Connections", url: "https://www.nytimes.com/games/connections", icon: "🟪", tag: "Word", hue: 275 },
	{ name: "Strands", url: "https://www.nytimes.com/games/strands", icon: "🔤", tag: "Word", hue: 175 },
	{ name: "Contexto", url: "https://contexto.me", icon: "🧠", tag: "Word", hue: 330 },
	{ name: "Worldle", url: "https://worldle.teuteuf.fr", icon: "🌍", tag: "Geography", hue: 150 },
	{ name: "Quick, Draw!", url: "https://quickdraw.withgoogle.com", icon: "🖍️", tag: "Drawing", hue: 55 },
	{ name: "Line Rider", url: "https://www.linerider.com", icon: "🛷", tag: "Physics", hue: 205 },
	{ name: "HexGL", url: "https://hexgl.bkcore.com/play/", icon: "🚀", tag: "Racing", hue: 190 },
	{ name: "Pac-Man", url: "https://www.google.com/logos/2010/pacman10-i.html", icon: "🟡", tag: "Arcade", hue: 50 },
	{ name: "Google Snake", url: "https://www.google.com/fbx?fbx=snake_arcade", icon: "🐍", tag: "Arcade", hue: 110 },
	{ name: "Tetris", url: "https://tetris.com/play-tetris", icon: "🟦", tag: "Puzzle", hue: 220 },
	{ name: "Sudoku", url: "https://sudoku.com", icon: "9️⃣", tag: "Puzzle", hue: 230 },
	{ name: "Solitaire", url: "https://solitaired.com", icon: "🃏", tag: "Cards", hue: 140 },
	{ name: "Chess.com", url: "https://www.chess.com/play/computer", icon: "♞", tag: "Board", hue: 95 },
	{ name: "A Dark Room", url: "https://adarkroom.doublespeakgames.com", icon: "🕯️", tag: "Adventure", hue: 30 },
	{ name: "Universal Paperclips", url: "https://www.decisionproblem.com/paperclips/index2.html", icon: "📎", tag: "Idle", hue: 210 },
	{ name: "Candy Box 2", url: "https://candybox2.github.io", icon: "🍬", tag: "Adventure", hue: 320 },
	{ name: "Bad Time Simulator", url: "https://jcw87.github.io/c2-sans-fight/", icon: "💀", tag: "Fan game", hue: 200 },
];

// Well-known online games you play against other people (the Multiplayer tab).
const MULTIPLAYER = [
	{ name: "Slither.io", url: "https://slither.io", icon: "🐍", tag: "Snake", hue: 140 },
	{ name: "Krunker", url: "https://krunker.io", icon: "🎯", tag: "Shooter", hue: 30 },
	{ name: "Shell Shockers", url: "https://shellshock.io", icon: "🥚", tag: "Shooter", hue: 45 },
	{ name: "Smash Karts", url: "https://smashkarts.io", icon: "🏎️", tag: "Racing", hue: 15 },
	{ name: "Bloxd.io", url: "https://bloxd.io", icon: "🧊", tag: "Building", hue: 200 },
	{ name: "Miniblox", url: "https://miniblox.io", icon: "⛏️", tag: "Building", hue: 110 },
	{ name: "Zombs Royale", url: "https://zombsroyale.io", icon: "🪂", tag: "Battle royale", hue: 280 },
	{ name: "Suroi", url: "https://suroi.io", icon: "🔫", tag: "Battle royale", hue: 100 },
	{ name: "Build Royale", url: "https://buildroyale.io", icon: "🏗️", tag: "Battle royale", hue: 40 },
	{ name: "Yohoho.io", url: "https://yohoho.io", icon: "🏴‍☠️", tag: "Battle royale", hue: 10 },
	{ name: "Venge.io", url: "https://venge.io", icon: "💥", tag: "Shooter", hue: 350 },
	{ name: "EV.IO", url: "https://ev.io", icon: "🚀", tag: "Shooter", hue: 240 },
	{ name: "Kour.io", url: "https://kour.io", icon: "🪖", tag: "Shooter", hue: 75 },
	{ name: "Repuls.io", url: "https://repuls.io", icon: "🛡️", tag: "Shooter", hue: 220 },
	{ name: "Voxiom.io", url: "https://voxiom.io", icon: "🟫", tag: "Shooter", hue: 20 },
	{ name: "Narrow.One", url: "https://narrow.one", icon: "🏹", tag: "Archery", hue: 50 },
	{ name: "Diep.io", url: "https://diep.io", icon: "🔺", tag: "Tanks", hue: 210 },
	{ name: "Arras.io", url: "https://arras.io", icon: "⚙️", tag: "Tanks", hue: 180 },
	{ name: "Wormate.io", url: "https://wormate.io", icon: "🪱", tag: "Snake", hue: 320 },
	{ name: "Little Big Snake", url: "https://littlebigsnake.com", icon: "🐉", tag: "Snake", hue: 130 },
	{ name: "Powerline.io", url: "https://powerline.io", icon: "⚡", tag: "Snake", hue: 55 },
	{ name: "Splix.io", url: "https://splix.io", icon: "🟦", tag: "Territory", hue: 205 },
	{ name: "Hexanaut.io", url: "https://hexanaut.io", icon: "🔷", tag: "Territory", hue: 225 },
	{ name: "Territorial.io", url: "https://territorial.io", icon: "🗺️", tag: "Strategy", hue: 160 },
	{ name: "Lordz.io", url: "https://lordz.io", icon: "👑", tag: "Strategy", hue: 45 },
	{ name: "Moomoo.io", url: "https://moomoo.io", icon: "🐄", tag: "Survival", hue: 60 },
	{ name: "Sploop.io", url: "https://sploop.io", icon: "🪓", tag: "Survival", hue: 70 },
	{ name: "Starve.io", url: "https://starve.io", icon: "❄️", tag: "Survival", hue: 195 },
	{ name: "Taming.io", url: "https://taming.io", icon: "🐺", tag: "Survival", hue: 85 },
	{ name: "Zombs.io", url: "https://zombs.io", icon: "🧟", tag: "Survival", hue: 95 },
	{ name: "Florr.io", url: "https://florr.io", icon: "🌸", tag: "Survival", hue: 310 },
	{ name: "Deeeep.io", url: "https://deeeep.io", icon: "🐟", tag: "Survival", hue: 195 },
	{ name: "Stabfish.io", url: "https://stabfish.io", icon: "🗡️", tag: "Survival", hue: 185 },
	{ name: "Bonk.io", url: "https://bonk.io", icon: "🟠", tag: "Physics", hue: 25 },
	{ name: "HaxBall", url: "https://www.haxball.com", icon: "⚽", tag: "Sports", hue: 120 },
	{ name: "skribbl.io", url: "https://skribbl.io", icon: "✏️", tag: "Drawing", hue: 260 },
	{ name: "Gartic Phone", url: "https://garticphone.com", icon: "📞", tag: "Party", hue: 330 },
	{ name: "Codenames", url: "https://codenames.game", icon: "🕵️", tag: "Party", hue: 0 },
	{ name: "TETR.IO", url: "https://tetr.io", icon: "🧱", tag: "Puzzle", hue: 280 },
	{ name: "Lichess", url: "https://lichess.org", icon: "♟️", tag: "Board", hue: 220 },
];

// Lists drawn as icon cards (not covers), by tab.
const CARD_LISTS = { popular: GAMES, multiplayer: MULTIPLAYER };

/* ---------- game collections ----------
   Each collection publishes its own list of games, loaded live when you open it.
   To add one: give it an id and name, where its list lives (backups after the first),
   and how to turn that list into { name, url, cover, tag, author }. */

const GN_MATH_HTML = "https://gn-math.github.io/html";
const GN_MATH_COVERS = "https://raw.githubusercontent.com/gn-math/covers/main";
const SELENITE_GAMES = "https://selenite.cc/resources/semag";
const KHO_SITE = "https://3kh0.github.io/";
const UGS_FILES = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/"; // the same address is used in sw.js

const GAME_SOURCES = [
	{
		id: "gnmath",
		name: "gn-math",
		lists: [
			"https://gn-math.github.io/assets/zones.json",
			"https://raw.githubusercontent.com/gn-math/assets/main/zones.json",
		],
		// Uses {HTML_URL} and {COVER_URL} placeholders for where its files live.
		toGames: (list) =>
			list
				.filter((g) => typeof g.url === "string" && g.url.startsWith("{HTML_URL}") && !String(g.name).startsWith("[!]"))
				.map((g) => ({
					name: String(g.name),
					url: g.url.replace("{HTML_URL}", GN_MATH_HTML),
					cover: String(g.cover || "").replace("{COVER_URL}", GN_MATH_COVERS),
					tag: g.author ? String(g.author) : "",
					author: g.author ? String(g.author) : "",
				})),
	},
	{
		id: "selenite",
		name: "Selenite",
		lists: ["https://selenite.cc/resources/games.json"],
		// Each game is a folder with an index.html and a picture in it.
		toGames: (list) =>
			list
				.filter((g) => typeof g.directory === "string" && g.directory)
				.map((g) => ({
					name: String(g.name),
					url: `${SELENITE_GAMES}/${g.directory}/index.html`,
					cover: g.image ? `${SELENITE_GAMES}/${g.directory}/${g.image}` : "",
					tag: (g.tags || []).filter((t) => t !== "top").join(", "),
					author: "",
				})),
	},
	{
		id: "3kh0",
		name: "3kh0",
		lists: ["https://raw.githubusercontent.com/3kh0/3kh0-lite/main/config/games.json"],
		// Links and pictures are relative to the 3kh0 site.
		toGames: (list) =>
			list
				.filter((g) => typeof g.link === "string" && g.link)
				.map((g) => ({
					name: String(g.title),
					url: KHO_SITE + g.link,
					cover: g.imgSrc ? KHO_SITE + g.imgSrc : "",
					tag: "",
					author: "",
				})),
	},
	{
		id: "ugs",
		name: "UGS",
		lists: ["https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/games.js"],
		// Ultimate Game Stash keeps its list as a script: `let files = ["cl2048", ...]`.
		// Each name (after its "cl" start) is a single-page game in UGS-Files. No pictures.
		parse: (text) => [...(text.match(/let files = \[([\s\S]*?)\];/)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
		toGames: (list) =>
			[...new Set(list)]
				.filter((file) => /^cl./i.test(file))
				.map((file) => {
					const name = file.slice(2);
					return {
						name: name.charAt(0).toUpperCase() + name.slice(1),
						url: UGS_FILES + encodeURIComponent(`${file}.html`),
						cover: "",
						tag: "",
						author: "",
					};
				}),
	},
];

const SOURCE_PAGE = 60; // how many cards to draw at a time
const sourceState = Object.fromEntries(
	GAME_SOURCES.map((s) => [s.id, { games: null, load: null, failed: false }]),
);

function gameSource(id) {
	return GAME_SOURCES.find((s) => s.id === id);
}

// Loads a collection's list once (trying its backup copies in turn).
function loadSource(source) {
	const state = sourceState[source.id];
	if (!state.load) {
		state.load = (async () => {
			for (const listUrl of source.lists) {
				try {
					const res = await fetch(listUrl, { cache: "no-cache" });
					if (!res.ok) continue;
					const list = source.parse ? source.parse(await res.text()) : await res.json();
					state.games = source.toGames(Array.isArray(list) ? list : Object.values(list));
					state.failed = false;
					showGamesTotal();
					return state.games;
				} catch {
					// try the next copy
				}
			}
			state.failed = true;
			state.load = null; // let a later open try again
			return null;
		})();
	}
	return state.load;
}

// Every game from every collection that has loaded so far (the Ctrl+K palette searches these).
function loadedSourceGames() {
	return GAME_SOURCES.flatMap((s) => (sourceState[s.id].games || []).map((g) => ({ ...g, from: s.name })));
}

/* ---------- preload every game's picture ----------
   Shortly after Slow opens, every collection's list loads and each cover is saved in Slow's own
   cache (the service worker shows them from there). Each picture downloads once, ever, so the
   games page has them all ready. Pictures that don't exist are remembered, to show the letter right away. */

const COVER_CACHE = "slow-covers"; // the same name is used in sw.js
const missingCovers = new Set();

async function preloadCovers() {
	if (!("caches" in window) || navigator.connection?.saveData) return;
	const cache = await caches.open(COVER_CACHE);
	await Promise.all(GAME_SOURCES.map(loadSource));
	const queue = [...new Set(loadedSourceGames().map((g) => g.cover).filter(Boolean))];

	// A few at a time, pausing whenever a page is loading, so websites you're using stay fast.
	const worker = async () => {
		while (queue.length) {
			while (tabs.some((t) => t.loading) || document.hidden) await new Promise((r) => setTimeout(r, 1000));
			const url = queue.shift();
			try {
				if (await cache.match(url)) continue;
				const res = await fetch(url, { mode: "cors" });
				if (res.ok) await cache.put(url, res);
				else missingCovers.add(url);
			} catch {
				missingCovers.add(url);
			}
		}
	};
	await Promise.all(Array.from({ length: 3 }, worker));
}

// Starts once Slow has settled in, so it doesn't compete with the first sites you open.
window.addEventListener("load", () => setTimeout(() => preloadCovers().catch(() => {}), 12000));

/* ---------- the menu ---------- */

const GAMES_VIEW_KEY = "slow.gamesView";
const gamesBtn = document.getElementById("btn-games");
const gamesMenu = document.getElementById("games-menu");
const gamesGrid = document.getElementById("games-grid");
const gamesFilter = document.getElementById("games-filter");
const gamesClear = document.getElementById("games-clear");
const gamesNote = document.getElementById("games-note");
const gamesViews = gamesMenu.querySelector(".games-views");

// One switch for the popular picks, then one per collection.
gamesViews.textContent = "";
for (const view of [
	{ id: "popular", name: "Popular" },
	{ id: "multiplayer", name: "Multiplayer" },
	{ id: "all", name: "All" },
	...GAME_SOURCES,
]) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.setAttribute("role", "tab");
	btn.dataset.view = view.id;
	btn.textContent = view.name;
	gamesViews.append(btn);
}
const gamesViewBtns = gamesViews.querySelectorAll("[data-view]");

let gamesView = (() => {
	try {
		const saved = localStorage.getItem(GAMES_VIEW_KEY);
		return CARD_LISTS[saved] || saved === "all" || gameSource(saved) ? saved : "popular";
	} catch {
		return "popular";
	}
})();

// Uses the current tab if it's an empty new tab, otherwise opens a new one.
function openGame(game) {
	setGamesMenu(false);
	const current = activeTab();
	const tab = current && !current.frame && !current.url && !current.pendingUrl ? current : newTab();
	if (tab) navigate(tab, game.url);
}

/* ---------- search ----------
   Spaces, capitals and punctuation don't matter ("drive mad" finds "Drivemad"), words can
   come in any order, and the closest matches come first. */

const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "");

// 0 means no match; higher is a closer match.
function matchScore(game, query) {
	const whole = squash(query);
	if (!whole) return 1;
	const name = squash(game.name);
	if (name === whole) return 6;
	if (name.startsWith(whole)) return 5;
	if (name.includes(whole)) return 4;
	const words = query.split(/\s+/).map(squash).filter(Boolean);
	if (words.every((w) => name.includes(w))) return 3;
	const tag = squash(game.tag);
	if (words.every((w) => name.includes(w) || tag.includes(w))) return 2;
	return 0;
}

// The games that match, closest first (ties keep the list's own order).
function searchGames(games, query) {
	if (!squash(query)) return games;
	return games
		.map((game, i) => ({ game, i, score: matchScore(game, query) }))
		.filter((m) => m.score)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((m) => m.game);
}

// "Nothing found", with a quick way to look everywhere else.
function noMatches(query) {
	const p = gamesMessage(`No games match “${query}” here. `);
	if (gamesView !== "all") {
		const everywhere = document.createElement("button");
		everywhere.type = "button";
		everywhere.className = "text-btn";
		everywhere.textContent = "Search all games";
		everywhere.addEventListener("click", () => setGamesView("all"));
		p.append(everywhere);
	}
}

function gamesMessage(text) {
	const p = document.createElement("p");
	p.className = "games-empty";
	p.textContent = text;
	gamesGrid.append(p);
	return p;
}

function popularCard(game, i) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "game";
	btn.title = `Play ${game.name}`;
	btn.style.setProperty("--hue", String(game.hue));
	btn.style.setProperty("--i", String(i));

	const icon = document.createElement("span");
	icon.className = "game-icon";
	icon.textContent = game.icon;
	icon.setAttribute("aria-hidden", "true");

	const name = document.createElement("span");
	name.className = "game-name";
	name.textContent = game.name;

	const tag = document.createElement("span");
	tag.className = "game-tag";
	tag.textContent = game.tag;

	btn.append(icon, name, tag);
	btn.addEventListener("click", () => openGame(game));
	return btn;
}

function coverCard(game, i) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "game cover";
	btn.title = game.author ? `Play ${game.name} (by ${game.author})` : `Play ${game.name}`;
	btn.style.setProperty("--i", String(i % SOURCE_PAGE));
	if (game.hue !== undefined) btn.style.setProperty("--hue", String(game.hue));

	const letterCover = () => {
		const letter = document.createElement("span");
		letter.className = "game-cover letter";
		letter.textContent = game.name.replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "?";
		return letter;
	};

	let cover;
	if (game.cover && !missingCovers.has(game.cover)) {
		cover = document.createElement("img");
		cover.className = "game-cover";
		// Asked for in "cross-origin" mode: Slow's page only shows other sites' pictures that way.
		cover.crossOrigin = "anonymous";
		cover.src = game.cover;
		cover.alt = "";
		cover.decoding = "async";
		// Fades in once it's ready, instead of popping in.
		if (!cover.complete) {
			cover.classList.add("waiting");
			cover.addEventListener("load", () => cover.classList.remove("waiting"), { once: true });
		}
		// No picture after all? Show the game's first letter instead.
		cover.addEventListener("error", () => cover.replaceWith(letterCover()));
	} else if (game.icon) {
		// Popular and Multiplayer games (shown in All) use their icon.
		cover = document.createElement("span");
		cover.className = "game-cover icon";
		cover.textContent = game.icon;
	} else {
		cover = letterCover();
	}

	const name = document.createElement("span");
	name.className = "game-name";
	name.textContent = game.name;

	btn.append(cover, name);
	// In "All", say which collection it's from (some games are in more than one).
	if (gamesView === "all" && game.from) {
		const from = document.createElement("span");
		from.className = "game-tag";
		from.textContent = game.from;
		btn.append(from);
	}
	btn.addEventListener("click", () => openGame(game));
	return btn;
}

// The count next to the title: every game on every tab (each counted once), growing as lists load.
const gamesTotal = document.getElementById("games-total");
function showGamesTotal() {
	const urls = new Set([...GAMES, ...MULTIPLAYER, ...loadedSourceGames()].map((g) => g.url));
	const loading = GAME_SOURCES.some((s) => !sourceState[s.id].games && !sourceState[s.id].failed);
	gamesTotal.textContent = `${urls.size.toLocaleString()}${loading ? "+" : ""} games`;
}

// `fresh` (opening the page or switching tabs) plays the cards' fade-in; typing doesn't, so results don't flicker.
function renderGames({ fresh = false } = {}) {
	showGamesTotal();
	const query = gamesFilter.value.trim();
	gamesClear.hidden = !query;
	gamesGrid.textContent = "";
	gamesGrid.classList.toggle("covers", !CARD_LISTS[gamesView]);
	gamesGrid.classList.toggle("animate", fresh);
	for (const btn of gamesViewBtns) {
		btn.setAttribute("aria-selected", String(btn.dataset.view === gamesView));
	}

	if (CARD_LISTS[gamesView]) {
		const shown = searchGames(CARD_LISTS[gamesView], query);
		shown.forEach((game, i) => gamesGrid.append(popularCard(game, i)));
		if (!shown.length) noMatches(query);
		gamesNote.textContent = query
			? `${shown.length} of ${CARD_LISTS[gamesView].length} games`
			: gamesView === "multiplayer"
				? "Play online against people from everywhere. Each opens the game's own site in a tab."
				: "Games open in a tab through Slow. Some need a moment to load.";
		return;
	}

	if (gamesView === "all") {
		const waiting = GAME_SOURCES.filter((s) => !sourceState[s.id].games && !sourceState[s.id].failed);
		for (const s of waiting) {
			loadSource(s).then(() => {
				if (gamesView === "all" && !gamesMenu.classList.contains("hidden")) refreshGames();
			});
		}
		showCoverGames(allGames(), query, "");
		return;
	}

	const source = gameSource(gamesView);
	const state = sourceState[source.id];
	if (!state.games) {
		if (state.failed) {
			const p = gamesMessage(`Couldn't reach ${source.name} right now. Their site may be down or blocked. `);
			const retry = document.createElement("button");
			retry.type = "button";
			retry.className = "text-btn";
			retry.textContent = "Try again";
			retry.addEventListener("click", () => {
				state.failed = false;
				renderGames();
			});
			p.append(retry);
		} else {
			gamesMessage(`Loading ${source.name} games…`);
			loadSource(source).then(() => {
				if (gamesView === source.id && !gamesMenu.classList.contains("hidden")) renderGames({ fresh: true });
			});
		}
		gamesNote.textContent = `From ${source.name}, a free collection of web games.`;
		return;
	}

	showCoverGames(state.games, query, source.name);
}

// Redraws after a list finishes loading, keeping your place in the list.
function refreshGames() {
	const scroll = gamesGrid.scrollTop;
	const drawn = coverDrawn;
	renderGames();
	while (coverDrawn < drawn && coverDrawn < coverList.length) drawMoreCovers();
	gamesGrid.scrollTop = scroll;
}

// Every game on every tab, each once, A to Z (names that start with a symbol go last).
function allGames() {
	const seen = new Set();
	const games = [];
	const add = (game) => {
		if (seen.has(game.url)) return;
		seen.add(game.url);
		games.push(game);
	};
	GAMES.forEach((g) => add({ ...g, from: "Popular" }));
	MULTIPLAYER.forEach((g) => add({ ...g, from: "Multiplayer" }));
	loadedSourceGames().forEach(add);
	const odd = (g) => !/^[a-z0-9]/i.test(g.name);
	return games.sort((a, b) => odd(a) - odd(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/* ---------- cover grid: more cards are drawn as you scroll near the end ---------- */

let coverList = []; // what the open tab is showing, in order
let coverDrawn = 0; // how many of those have cards so far
const moreSentinel = document.createElement("div");
moreSentinel.className = "games-sentinel";
const moreObserver = new IntersectionObserver(
	(entries) => {
		if (entries.some((e) => e.isIntersecting)) drawMoreCovers();
	},
	{ root: gamesGrid, rootMargin: "0px 0px 900px 0px" },
);

function drawMoreCovers() {
	const next = coverList.slice(coverDrawn, coverDrawn + SOURCE_PAGE);
	const cards = document.createDocumentFragment();
	next.forEach((game, i) => cards.append(coverCard(game, coverDrawn + i)));
	moreSentinel.before(cards);
	coverDrawn += next.length;
	moreObserver.unobserve(moreSentinel);
	// Watching again checks right away, so a tall screen keeps filling until it's full.
	if (coverDrawn < coverList.length) moreObserver.observe(moreSentinel);
	else moreSentinel.remove();
}

// `name` is the collection's (blank for All).
function showCoverGames(games, query, name) {
	coverList = searchGames(games, query);
	coverDrawn = 0;
	gamesGrid.append(moreSentinel);
	if (coverList.length) drawMoreCovers();
	else if (query) noMatches(query);
	else gamesMessage("Loading games…");

	if (query) {
		gamesNote.textContent = `${coverList.length.toLocaleString()} of ${games.length.toLocaleString()} games`;
	} else if (name) {
		gamesNote.textContent = `${games.length.toLocaleString()} games from ${name}.`;
	} else {
		const from = GAME_SOURCES.filter((s) => sourceState[s.id].games).map((s) => s.name);
		gamesNote.textContent = `${games.length.toLocaleString()} games from ${new Intl.ListFormat("en").format(["Slow's picks", ...from])}.`;
	}
}

function setGamesView(view) {
	gamesView = view;
	try {
		localStorage.setItem(GAMES_VIEW_KEY, view);
	} catch {}
	renderGames({ fresh: true });
	gamesGrid.scrollTop = 0;
	gamesFilter.focus();
}

for (const btn of gamesViewBtns) {
	btn.addEventListener("click", () => setGamesView(btn.dataset.view));
}

function setGamesMenu(open) {
	if (open === !gamesMenu.classList.contains("hidden")) return;
	gamesMenu.classList.toggle("hidden", !open);
	gamesBtn.setAttribute("aria-expanded", String(open));
	gamesBtn.classList.toggle("on", open);
	if (!open) window.__slowStarfield?.();
	if (open) {
		gamesFilter.value = "";
		renderGames({ fresh: true });
		gamesGrid.scrollTop = 0;
		gamesFilter.focus();
	}
}

gamesBtn.addEventListener("click", (event) => {
	event.stopPropagation();
	setGamesMenu(gamesMenu.classList.contains("hidden"));
});

document.getElementById("games-close").addEventListener("click", () => setGamesMenu(false));

gamesFilter.addEventListener("input", () => {
	renderGames();
	gamesGrid.scrollTop = 0;
});

function clearGamesSearch() {
	gamesFilter.value = "";
	renderGames();
	gamesGrid.scrollTop = 0;
	gamesFilter.focus();
}

gamesClear.addEventListener("click", clearGamesSearch);

// Enter opens the first game that matches.
gamesFilter.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		gamesGrid.querySelector(".game")?.click();
	}
});

document.addEventListener("keydown", (event) => {
	if (gamesMenu.classList.contains("hidden")) return;
	// Escape clears the search first, then closes the page.
	if (event.key === "Escape") {
		if (gamesFilter.value) clearGamesSearch();
		else setGamesMenu(false);
		return;
	}
	// Start typing anywhere on the page to search.
	const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
	if (typing && document.activeElement !== gamesFilter) gamesFilter.focus();
});

/* ---------- hover sound effects ---------- */

const HOVER_TARGETS = "button, .tab, .game, .palette-item, .shortcut, .theme-option";
// Tabs sound a little lower and cards (games, shortcuts, results) a little higher than buttons.
const HOVER_PITCH = [
	[".tab", 0.85],
	[".game, .palette-item, .shortcut, .theme-option", 1.15],
];
let hovered = null;

document.addEventListener("pointerover", (event) => {
	if (event.pointerType === "touch") return;
	const target = event.target.closest(HOVER_TARGETS);
	if (target === hovered) return;
	hovered = target;
	if (!target || target.disabled) return;
	const pitch = HOVER_PITCH.find(([selector]) => target.matches(selector))?.[1] ?? 1;
	sfx.hover(pitch);
});

/* ============================================================
   EXTRA ANIMATIONS
   All of these skip themselves when "Reduce motion" is on.
   ============================================================ */

/* ---------- a glass highlight that glides to the active tab ---------- */

const tabGlider = document.createElement("div");
tabGlider.className = "tab-glider";
tabGlider.setAttribute("aria-hidden", "true");
tabStrip.prepend(tabGlider);

function placeTabGlider() {
	const el = activeTab()?.el;
	if (!el || !el.isConnected) {
		tabGlider.style.opacity = "0";
		return;
	}
	tabGlider.style.opacity = "1";
	tabGlider.style.width = `${el.offsetWidth}px`;
	tabGlider.style.transform = `translateX(${el.offsetLeft}px)`;
}

// Tabs change size as they open, close and the window resizes, so follow them.
const tabSizes = new ResizeObserver(placeTabGlider);
tabSizes.observe(tabStrip);
new MutationObserver(() => {
	for (const tab of tabs) if (tab.el && !tab.el.dataset.watched) {
		tab.el.dataset.watched = "1";
		tabSizes.observe(tab.el);
	}
	placeTabGlider();
}).observe(tabStrip, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

placeTabGlider();
// The first placement jumps straight there; after that it glides.
requestAnimationFrame(() => requestAnimationFrame(() => tabGlider.classList.add("ready")));

/* ---------- start up: bring back last time's tabs, or open a fresh one ---------- */

if (!restoreSession()) newTab();

// A link ending in "#wisp=wss://..." (like the one `npm run share` prints) switches Slow to that
// wisp server and remembers it, the same as setting it in Settings > Connection.
(() => {
	const link = location.hash.match(/^#wisp=(.+)$/);
	if (!link) return;
	// Take it out of the address bar (it holds your private key).
	history.replaceState(null, "", location.pathname + location.search);
	let wispUrl = "";
	try {
		wispUrl = decodeURIComponent(link[1]);
	} catch {}
	if (!/^wss?:\/\/[^\s/]+/i.test(wispUrl)) return;
	settings.wispUrl = wispUrl;
	saveSettings();
	notify("Websites now load through your own server. You can change this in Settings > Connection.");
})();

// Connect to the proxy now, so the first site you open (and restored tabs' icons) don't wait for it.
ensureReady().catch(() => {});
