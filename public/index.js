"use strict";

/* ============================================================
   SETTINGS - easy things to change
   ============================================================ */

// Where typed searches can go. %s is replaced by what you typed.
// Bing is first (and the default): it serves a full results page through the proxy without a fuss.
// Google blocks the proxy's shared address with an "unusual traffic" CAPTCHA wall, so searches
// sent there just fail for most people — it's kept as a choice, but it isn't the default anymore.
const SEARCH_ENGINES = {
	bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
	// "udm=14" is Google's plain "Web" results. Google often answers the proxy with a CAPTCHA
	// ("unusual traffic from your network"), and its full results page also has scripts (like the
	// AI Overview's) that the proxy can't adapt yet, which leaves gaps and overlapping text.
	google: { name: "Google (may ask for a CAPTCHA)", url: "https://www.google.com/search?q=%s&udm=14" },
	duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
	brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
	startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
};

const MAX_TABS = 8;

/* ============================================================
   USER SETTINGS (changed from the settings panel, saved in this browser)
   ============================================================ */

const SETTINGS_KEY = "slow.settings";

const DEFAULT_SETTINGS = {
	searchEngine: "bing",
	showShortcuts: true,
	history: true,
	suggestions: true,
	searchSuggestions: true,
	warnOnLeave: false,
	// Stops ads (and YouTube's video ads) on websites.
	blockAds: true,
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
	// The chat opens "full" (full screen) or as a "dock" (a panel on the side).
	chatMode: "full",
};

const settings = (() => {
	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
		// Older versions had an on/off "sounds" switch; keep it off for people who turned it off.
		if (saved.sounds === false && saved.hoverSound === undefined) saved.hoverSound = "off";
		delete saved.sounds;
		// Google used to be the default, but it now blocks the proxy's shared address with a
		// CAPTCHA wall, so those searches fail. Move anyone still on that old default over to Bing
		// (which works) one time. If they deliberately pick Google again afterward, the marker
		// keeps this from undoing their choice on the next visit.
		if (!saved.searchMovedOffGoogle) {
			if (saved.searchEngine === "google") saved.searchEngine = "bing";
			saved.searchMovedOffGoogle = true;
		}
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
	return (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing).url;
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
		// The chat's sounds (messages, calls): a few tones at Slow's volume.
		melody(notes) {
			if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
			try {
				if (!audio()) return;
				for (const note of notes) {
					const t0 = ctx.currentTime + (note.start || 0);
					const env = ctx.createGain();
					env.gain.setValueAtTime(0.0001, t0);
					env.gain.exponentialRampToValueAtTime(note.gain, t0 + Math.min(0.02, note.dur / 3));
					env.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
					env.connect(out);
					const osc = ctx.createOscillator();
					osc.frequency.value = note.freq;
					osc.connect(env);
					osc.start(t0);
					osc.stop(t0 + note.dur + 0.02);
				}
			} catch {}
		},
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
// (libcurl, with WebSockets that keep long messages whole: see transport.mjs)
const TRANSPORT = BASE + "transport.mjs";
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

				// Your own server (set in Settings, or by Share Slow's link) is off or not sharing:
				// use the built-in one for now, and keep yours as the default for next time.
				const fallback = defaultWispUrl();
				if (settings.wispUrl && settings.wispUrl !== fallback && !(await connectionWorks())) {
					await connection.setTransport(transportUrl, [{ websocket: fallback }]);
					connectedWisp = fallback;
					notify({
						tone: "warning",
						icon: "server",
						key: "wisp",
						title: "Your server isn't answering",
						message: "Slow is using the public server for now. Is your computer on, with Share Slow running?",
						actions: [
							{
								label: "Try mine again",
								run: () => {
									readyPromise = null;
									connectedWisp = null;
									ensureReady().catch(() => {});
								},
							},
						],
						timeout: 12000,
					});
				}
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
const loadbar = document.getElementById("loadbar");

/* ============================================================
   TABS
   Each tab is an object: { id, title, url, frame }
   "frame" is the Scramjet frame, created the first time the tab loads a page.
   ============================================================ */

const tabs = [];
let activeId = null;
let chatUnread = 0; // chats with new messages for you (in the window's title too; see CHAT)
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

// `focus: false` opens it without switching to it (links opened in the background).
function newTab({ focus = true } = {}) {
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
	if (focus) activate(tab.id);
	else renderTabs();
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
		notify({ icon: "tab", key: "closed-tab", message: `Closed ${hostOf(closedUrl)}`, actions: [{ label: "Undo", run: reopenClosedTab }], timeout: 6000 });
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

			// Drag a tab to move it.
			el.draggable = true;
			el.addEventListener("dragstart", (event) => {
				draggedTab = tab;
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", tab.url || tab.pendingUrl || "");
				el.classList.add("dragging");
			});
			el.addEventListener("dragend", () => {
				el.classList.remove("dragging");
				draggedTab = null;
				// The tabs take the order they were dropped in.
				const order = [...tabStrip.querySelectorAll(".tab")];
				tabs.sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
				saveSession();
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

	updateNavButtons();
	saveSession();
}

/* ---------- moving tabs by dragging them ---------- */

let draggedTab = null;

tabStrip.addEventListener("dragover", (event) => {
	if (!draggedTab) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	const over = tabs.find((t) => {
		if (t === draggedTab || !t.el) return false;
		const box = t.el.getBoundingClientRect();
		return event.clientX >= box.left && event.clientX <= box.right;
	});
	if (!over) return;
	const box = over.el.getBoundingClientRect();
	const before = event.clientX < box.left + box.width / 2;
	const spot = before ? over.el : over.el.nextSibling;
	if (spot !== draggedTab.el && draggedTab.el.nextSibling !== spot) tabStrip.insertBefore(draggedTab.el, spot);
});

tabStrip.addEventListener("drop", (event) => {
	if (draggedTab) event.preventDefault();
});

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
	const unread = chatUnread ? `(${chatUnread}) ` : "";
	document.title = unread + (showingFrame ? `${current.title} | Slow` : "Slow");
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
	showLinkStatus(null);
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
		notify(`${hostOf(url)} was already open, so you're back on that tab.`, [
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

		// When the page finishes loading, stop the loading bar. (Ignores the very early event the
		// empty frame fires when it's first created; quick pages after that still count.)
		const born = performance.now();
		tab.frame.frame.addEventListener("load", () => {
			if (performance.now() - born > 250) finishLoading(tab);
			applyPageDarkMode(tab);
			applyPageLayout(tab);
			recoverConnection(tab);
		});
	}

	tab.url = url;
	tab.title = hostOf(url);
	tab.error = null;
	trailStart(trailOf(tab), url);
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

/* ---------- each tab's own history ----------
   All of Slow's tabs live in one browser window, which keeps a single history for all of them,
   so the browser's own "back" went back in whichever tab changed last. Each tab (and each app)
   keeps its own list of pages instead, and back and forward move through that. */

const makeTrail = () => ({ list: [], at: -1, pending: false, time: 0, from: null });
const trailOf = (holder) => (holder.trail ||= makeTrail());

// Slow itself is sending the frame to a page (typed address, link from Slow, shortcut...).
function trailStart(trail, url) {
	trail.from = trail.list[trail.at] ?? null;
	if (trail.list[trail.at] !== url) {
		trail.list.splice(trail.at + 1);
		trail.list.push(url);
		trail.at = trail.list.length - 1;
	}
	trail.pending = true;
	trail.time = Date.now();
}

// The frame is now showing `url` (it followed a link, or a page it was sent to has landed).
function trailSaw(trail, url) {
	if (!url) return;
	const current = trail.list[trail.at];
	if (url === current) {
		trail.pending = false;
		return;
	}
	// Until the new page arrives, the frame can still be showing the page it's leaving.
	if (trail.pending && url === trail.from) return;
	// The page went back or forward by itself (its own back button, say): move there, don't add a copy.
	if (!trail.pending && (url === trail.list[trail.at - 1] || url === trail.list[trail.at + 1])) {
		trail.at += url === trail.list[trail.at - 1] ? -1 : 1;
		trail.time = Date.now();
		return;
	}
	// Where a page Slow sent it to ended up, or a redirect a moment later: the same entry.
	if (trail.at >= 0 && (trail.pending || Date.now() - trail.time < 1200)) {
		trail.list[trail.at] = url;
	} else {
		trail.list.splice(trail.at + 1);
		trail.list.push(url);
		trail.at = trail.list.length - 1;
	}
	trail.pending = false;
	trail.time = Date.now();
}

// The page `step` away (-1 back, 1 forward), or null if there isn't one.
function trailStep(trail, step) {
	const at = trail.at + step;
	if (at < 0 || at >= trail.list.length) return null;
	trail.from = trail.list[trail.at];
	trail.at = at;
	trail.pending = true;
	trail.time = Date.now();
	return trail.list[at];
}

// Back / forward / reload for the open tab.
function frameAction(name) {
	const tab = activeTab();
	if (!tab) return;
	const trail = trailOf(tab);
	if (!tab.frame) {
		// On the new tab page, back returns to the page the tab was on.
		if (name === "back" && trail.list.length) navigate(tab, trail.list[trail.at], { here: true });
		return;
	}
	if (name === "reload") {
		try {
			tab.frame.reload();
		} catch {}
		return;
	}
	const url = trailStep(trail, name === "back" ? -1 : 1);
	if (!url) return;
	tab.url = url;
	tab.title = hostOf(url);
	startLoading(tab);
	tab.frame.go(url);
	renderTabs();
	updateView();
}

function updateNavButtons() {
	const tab = activeTab();
	const trail = tab && trailOf(tab);
	backBtn.disabled = !trail || !(trail.at > 0 || (!tab.frame && trail.list.length));
	forwardBtn.disabled = !trail || trail.at >= trail.list.length - 1;
}

/* ============================================================
   ERRORS
   ============================================================ */

// Something went wrong: a red notification, with the technical details (if any) underneath.
let errorNotice = null;
function showError(message, code = "") {
	errorNotice = notify({ tone: "error", key: "error", message, detail: code, timeout: 9000 });
}

function hideError() {
	errorNotice?.close();
	errorNotice = null;
}

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
		const real = current && /^https?:\/\//.test(current) && !current.startsWith(location.origin);
		// The tab's own history follows the frame even while it loads (it ignores the page being left).
		let showing = null;
		try {
			showing = String(tab.frame.url);
		} catch {}
		if (showing && /^https?:\/\//.test(showing) && !showing.startsWith(location.origin)) trailSaw(trailOf(tab), showing);
		if (real && current !== tab.url) {
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
// What the new tab page starts with, until you add or remove one of your own.
const STARTER_SHORTCUTS = [
	{ url: "https://www.youtube.com/", title: "YouTube" },
	{ url: "https://www.tiktok.com/", title: "TikTok" },
	{ url: "https://github.com/", title: "GitHub" },
];
const savedShortcuts = (() => {
	try {
		return localStorage.getItem(SHORTCUT_KEY) !== null;
	} catch {
		return false;
	}
})();
let shortcuts = savedShortcuts
	? readList(SHORTCUT_KEY).map((s) => ({ ...s, url: String(s.url).replace(/^http:\/\//, "https://") }))
	: STARTER_SHORTCUTS.map((s) => ({ ...s }));

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
		// (the letter goes: even invisible, it took up room and pushed the icon off center)
		letterEl.replaceChildren(img);
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
		notify({ tone: "warning", icon: "star", message: `You can have up to ${SHORTCUT_SLOTS} shortcuts. Remove one to add another.` });
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
	const feed = SUGGEST_FEEDS[settings.searchEngine] || SUGGEST_FEEDS.bing;
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
			const engine = (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing).name;
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
const customEditor = document.getElementById("custom-editor");

// Ready-made colors for the custom theme (any color still works through the pickers).
const ACCENT_PRESETS = ["#b98cff", "#5ec8ff", "#6dffb1", "#c6f36b", "#ffd166", "#ff8a5c", "#ff6f9c", "#e8ecff"];
const BG_PRESETS = ["#07050f", "#050b16", "#04110e", "#140608", "#0a0a0c", "#151022"];

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
		const on = btn.dataset.theme === theme.id;
		btn.setAttribute("aria-checked", String(on));
		btn.tabIndex = on ? 0 : -1;
	}
	// The color editor only shows for the custom theme, so it's clear what it changes.
	customEditor.hidden = theme.id !== "custom";
	updateCustomSwatch();
}

// A tiny picture of Slow in a theme's colors: its background, glowing moon, bar and text.
function paintPreview(preview, [bg, accent, alt]) {
	preview.style.setProperty("--p-bg", bg);
	preview.style.setProperty("--p-accent", accent);
	preview.style.setProperty("--p-alt", alt);
}

function updateCustomSwatch() {
	const preview = themeGrid.querySelector(':scope > [data-theme="custom"] .theme-preview');
	if (preview) paintPreview(preview, [customColors.bg, customColors.accent, customColors.accent]);
	for (const dot of document.querySelectorAll("#accent-presets .color-dot")) {
		dot.setAttribute("aria-pressed", String(dot.dataset.color === customColors.accent));
	}
	for (const dot of document.querySelectorAll("#bg-presets .color-dot")) {
		dot.setAttribute("aria-pressed", String(dot.dataset.color === customColors.bg));
	}
	document.getElementById("custom-accent-hex").textContent = customColors.accent.toUpperCase();
	document.getElementById("custom-bg-hex").textContent = customColors.bg.toUpperCase();
}

function renderThemeGrid() {
	themeGrid.textContent = "";
	for (const theme of [...THEMES, CUSTOM_THEME]) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "theme-option" + (theme.id === "custom" ? " custom" : "");
		btn.dataset.theme = theme.id;
		btn.setAttribute("role", "radio");
		btn.setAttribute("aria-label", theme.id === "custom" ? "Custom theme: your own colors" : `${theme.name} theme`);

		const preview = document.createElement("span");
		preview.className = "theme-preview";
		preview.innerHTML = '<span class="tp-bar"></span><span class="tp-moon"></span><span class="tp-line"></span><span class="tp-line short"></span>';
		if (theme.colors) paintPreview(preview, theme.colors);

		const name = document.createElement("span");
		name.className = "theme-name";
		name.textContent = theme.name;

		btn.append(preview, name);
		btn.addEventListener("click", () => applyTheme(theme.id));
		themeGrid.append(btn);
	}

	// The color dots in the custom editor.
	const dots = (box, colors, key) => {
		const holder = document.getElementById(box);
		holder.textContent = "";
		for (const color of colors) {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "color-dot";
			dot.dataset.color = color;
			dot.style.setProperty("--dot", color);
			dot.setAttribute("aria-label", color);
			dot.addEventListener("click", () => {
				setCustomColors({ ...customColors, [key]: color });
				fillCustomColorInputs();
				applyTheme("custom", { animate: false });
			});
			holder.append(dot);
		}
	};
	dots("accent-presets", ACCENT_PRESETS, "accent");
	dots("bg-presets", BG_PRESETS, "bg");
	updateCustomSwatch();
}

// Arrow keys move between themes, like other choose-one lists.
themeGrid.addEventListener("keydown", (event) => {
	const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
	if (!step) return;
	event.preventDefault();
	const options = [...themeGrid.children];
	const at = options.indexOf(document.activeElement);
	const next = options[(at + step + options.length) % options.length];
	next.focus();
	applyTheme(next.dataset.theme);
});

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
	syncAdblock();
}

// Websites look up to this page for the setting (adblock.js); the service worker is told directly.
function syncAdblock() {
	window.__slowBlockAds = settings.blockAds;
	navigator.serviceWorker?.controller?.postMessage({ type: "adblock", on: settings.blockAds });
}
navigator.serviceWorker?.addEventListener("controllerchange", syncAdblock);

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
	settingsFind.value = "";
	findSetting();
	settingsDialog.showModal();
	settingsBody.scrollTop = 0;
	markSettingsSection();
	raiseTrail();
}

/* ---------- the side list of sections, "you are here", and finding a setting ---------- */

const settingsBody = settingsDialog.querySelector(".settings-body");
const settingsLinks = document.getElementById("settings-links");
const settingsCrumb = document.getElementById("settings-crumb");
const settingsFind = document.getElementById("settings-find");
const settingsNone = document.getElementById("settings-none");

const SECTION_ICONS = {
	Theme: '<circle cx="12" cy="12" r="8" /><circle class="fill" cx="9" cy="9.5" r="1.3" /><circle class="fill" cx="14.5" cy="8.8" r="1.3" /><circle class="fill" cx="15.6" cy="13.6" r="1.3" /><path d="M12 20a2 2 0 0 1 0-4h1.5" />',
	Search: '<circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />',
	Tabs: '<path d="M3.5 18.5V8.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />',
	Wellbeing: '<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8.1a3.9 3.9 0 0 1 7 2.3c0 5.2-7 9.6-7 9.6Z" />',
	"New tab page": '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z" />',
	Privacy: '<path d="M12 3.5 5 6.2v5.3c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.2Z" /><path d="m9.2 12 2 2 3.8-4" />',
	Appearance: '<path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /><circle cx="12" cy="12" r="3" />',
	Sound: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />',
	Connection: '<circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.4 2.2 2.4 13.8 0 16M12 4c-2.4 2.2-2.4 13.8 0 16" />',
	Chat: '<path d="M5.5 4.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-6.3L7.5 21v-3.5h-2A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5Z" />',
	"Your data": '<ellipse cx="12" cy="6.5" rx="7" ry="2.5" /><path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />',
};

const settingsSections = [...settingsBody.querySelectorAll(":scope > section")].map((section) => {
	const title = section.querySelector(":scope > h3").textContent.trim();
	section.id = `settings-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

	// Everything under a section's title sits together on one card.
	const card = document.createElement("div");
	card.className = "settings-card";
	card.append(...[...section.children].filter((el) => el.tagName !== "H3"));
	section.append(card);

	const link = document.createElement("button");
	link.type = "button";
	link.className = "settings-link";
	const ico = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	ico.setAttribute("viewBox", "0 0 24 24");
	ico.setAttribute("aria-hidden", "true");
	ico.classList.add("ico");
	ico.innerHTML = SECTION_ICONS[title] || SECTION_ICONS.Appearance; // (Slow's own fixed drawings)
	const name = document.createElement("span");
	name.textContent = title;
	link.append(ico, name);
	link.addEventListener("click", () => {
		// The one you picked stays marked while the list scrolls to it (sections near the end can't reach the top).
		pickedSection = section;
		settingsBody.scrollTo({ top: section.offsetTop - 8, behavior: calm() ? "auto" : "smooth" });
		markSettingsSection(section);
	});
	settingsLinks.append(link);
	return { section, title, card, link };
});

// Highlights the section you're reading (or the one just picked) and names it at the top.
function markSettingsSection(picked) {
	let current = picked;
	if (!current) {
		const shown = settingsSections.filter((s) => !s.section.hidden);
		const atBottom =
			settingsBody.scrollTop > 0 && settingsBody.scrollTop + settingsBody.clientHeight >= settingsBody.scrollHeight - 4;
		current = atBottom ? shown.at(-1)?.section : null;
		for (const s of shown) if (!current && s.section.offsetTop + s.section.offsetHeight - 40 > settingsBody.scrollTop) current = s.section;
	}
	if (!current) settingsCrumb.textContent = "Settings";
	for (const s of settingsSections) {
		const on = s.section === current;
		s.link.classList.toggle("on", on);
		if (on) {
			s.link.setAttribute("aria-current", "true");
			settingsCrumb.textContent = s.title;
		} else {
			s.link.removeAttribute("aria-current");
		}
	}
}

let settingsScrollFrame = 0;
let pickedSection = null;
settingsBody.addEventListener("scroll", () => {
	cancelAnimationFrame(settingsScrollFrame);
	settingsScrollFrame = requestAnimationFrame(() => markSettingsSection(pickedSection));
});
// Scrolling yourself (wheel, touch, keys) goes back to marking whatever you're reading.
for (const type of ["wheel", "touchmove", "keydown"]) {
	settingsBody.addEventListener(type, () => (pickedSection = null), { passive: true });
}

// Shows only the settings that mention what you typed (a section whose name matches shows whole).
function findSetting() {
	const words = settingsFind.value.toLowerCase().split(/\s+/).filter(Boolean);
	// Each typed word has to start a word ("ads" finds "Block ads", not "loads").
	const matches = (text) => {
		const have = text.toLowerCase().split(/[^a-z0-9]+/);
		return words.every((w) => have.some((h) => h.startsWith(w)));
	};
	let any = false;
	for (const s of settingsSections) {
		const whole = !words.length || matches(s.title);
		let shown = whole;
		for (const part of s.card.children) {
			const keep = whole || matches(part.textContent);
			part.classList.toggle("filtered-out", !keep);
			if (keep) shown = true;
		}
		s.section.hidden = !shown;
		s.link.classList.toggle("dim", !shown);
		any ||= shown;
	}
	settingsNone.hidden = any;
	pickedSection = null;
	settingsBody.scrollTop = 0;
	markSettingsSection();
}

settingsFind.addEventListener("input", findSetting);
settingsFind.addEventListener("keydown", (event) => {
	// Enter would otherwise submit (and close) the settings form.
	if (event.key === "Enter") {
		event.preventDefault();
		settingsBody.querySelector("section:not([hidden]) :is(input, select, button):not(.filtered-out *)")?.focus();
	}
});

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
   NOTIFICATIONS
   Cards that stack in the bottom right corner (newest nearest the corner), with an icon,
   an optional title and buttons. Pointing at them pauses their countdown; the × or a swipe
   to the right puts one away.

     notify("Text")
     notify("Text", [{ label, run }], timeout)
     notify({ title, message, actions, timeout, tone, icon, avatar, key, count, onClick })

   tone: "info" (default), "success", "warning", "error", "update" or "chat" (sets the color
   and the icon). icon: one of NOTICE_ICONS, or an element. avatar: { src, text, color } for a
   person's picture. key: a new one with the same key takes the old one's place (count: true
   adds up how many there were, like "3 new"). timeout 0 keeps it until it's answered.
   ============================================================ */

const noticesEl = document.getElementById("notices");
const NOTICE_MAX = 4;
const noticeList = []; // oldest first
let noticesPaused = false;

// (Slow's own fixed drawings, on the same 24px grid as the toolbar's icons)
const NOTICE_ICONS = {
	info: '<circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle class="fill" cx="12" cy="7.8" r="1.1" />',
	success: '<circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.6 2.6 5-5.4" />',
	warning: '<path d="M12 4.2 2.9 19.5h18.2Z" /><path d="M12 10v4.4" /><circle class="fill" cx="12" cy="16.9" r="1.05" />',
	error: '<circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" />',
	update: '<path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4.5V9h-4.5" />',
	chat: '<path d="M5.5 4.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-6.3L7.5 21v-3.5h-2A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5Z" />',
	tab: '<rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10h17M8.5 6v4" />',
	bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" />',
	lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />',
	break: '<path d="M5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3" />',
	moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />',
	server: '<rect x="4" y="4.5" width="16" height="6" rx="2" /><rect x="4" y="13.5" width="16" height="6" rx="2" /><circle class="fill" cx="8" cy="7.5" r="1" /><circle class="fill" cx="8" cy="16.5" r="1" />',
	star: '<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2l-4.8 2.6 1-5.4-4-3.7 5.4-.7Z" />',
	history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.7h3.7M12 8v4.5l3 1.8" />',
};
const NOTICE_TONES = ["info", "success", "warning", "error", "update", "chat"];

function noticeArt(o, tone) {
	const art = document.createElement("span");
	art.className = "notice-art";
	art.setAttribute("aria-hidden", "true");
	if (o.avatar) {
		art.classList.add("person");
		const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(o.avatar.color) ? o.avatar.color : "";
		if (color) art.style.setProperty("--tint", color);
		// (pictures come from the chat, already made safe: a data: or blob: address)
		if (typeof o.avatar.src === "string" && /^(data:image\/|blob:)/.test(o.avatar.src)) {
			const img = document.createElement("img");
			img.alt = "";
			img.src = o.avatar.src;
			img.addEventListener("error", () => img.replaceWith(String(o.avatar.text || "")));
			art.append(img);
		} else {
			art.textContent = String(o.avatar.text || "").slice(0, 2);
		}
	} else if (o.icon instanceof Element) {
		art.append(o.icon);
	} else {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", "ico");
		svg.innerHTML = NOTICE_ICONS[o.icon] || NOTICE_ICONS[tone] || NOTICE_ICONS.info;
		art.append(svg);
	}
	return art;
}

function notify(message, actions = [], timeout = 7000) {
	const o =
		message && typeof message === "object"
			? { actions: [], timeout: 7000, ...message }
			: { message, actions, timeout };
	const tone = NOTICE_TONES.includes(o.tone) ? o.tone : "info";
	const old = o.key ? noticeList.find((n) => n.key === o.key) : null;
	// (someone's writing a reply in the old one: it just takes in the news, so their words stay)
	if (old?.el.classList.contains("replying")) {
		if (o.count) old.count++;
		const text = old.el.querySelector(".notice-text");
		if (text && o.message) text.textContent = o.message;
		const title = old.el.querySelector(".notice-title");
		if (title && old.count > 1) {
			let chip = title.querySelector(".notice-count");
			if (!chip) title.append((chip = Object.assign(document.createElement("span"), { className: "notice-count" })));
			chip.textContent = `${old.count} new`;
		}
		return { close: () => dismissNotice(old) };
	}
	const n = { key: o.key || null, count: old && o.count ? old.count + 1 : 1, timeout: Math.max(0, Number(o.timeout) || 0) };

	const el = document.createElement("div");
	el.className = `notice tone-${tone}${o.onClick ? " clickable" : ""}`;
	el.setAttribute("role", tone === "error" || tone === "warning" ? "alert" : "status");
	n.el = el;

	const body = document.createElement("div");
	body.className = "notice-body";
	if (o.title) {
		const title = document.createElement("p");
		title.className = "notice-title";
		const text = document.createElement("span");
		text.textContent = o.title;
		title.append(text);
		if (n.count > 1) {
			const chip = document.createElement("span");
			chip.className = "notice-count";
			chip.textContent = `${n.count} new`;
			title.append(chip);
		}
		body.append(title);
	}
	if (o.message) {
		const text = document.createElement("p");
		text.className = "notice-text";
		text.textContent = o.message;
		body.append(text);
	}
	if (o.detail) {
		const detail = document.createElement("pre");
		detail.className = "notice-detail";
		detail.textContent = String(o.detail).slice(0, 400);
		body.append(detail);
	}
	const reply = o.reply && typeof o.reply.send === "function" ? noticeReply(n, o.reply) : null;
	if (o.actions?.length || reply) {
		const row = document.createElement("div");
		row.className = "notice-actions";
		if (reply) row.append(reply.button);
		for (const action of o.actions || []) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "notice-btn";
			btn.textContent = action.label;
			btn.addEventListener("click", (event) => {
				event.stopPropagation();
				dismissNotice(n);
				action.run?.();
			});
			row.append(btn);
		}
		body.append(row);
		if (reply) body.append(reply.form);
	}

	const close = document.createElement("button");
	close.type = "button";
	close.className = "notice-x";
	close.setAttribute("aria-label", "Dismiss");
	close.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>';
	close.addEventListener("click", (event) => {
		event.stopPropagation();
		dismissNotice(n);
	});

	el.append(noticeArt(o, tone), body, close);
	if (o.onClick) {
		el.addEventListener("click", () => {
			if (n.swiped) return;
			dismissNotice(n);
			o.onClick();
		});
	}
	swipeAway(n);

	// A thin bar along the bottom counts down until it goes by itself.
	if (n.timeout) {
		el.classList.add("timed");
		el.style.setProperty("--life", `${n.timeout}ms`);
		n.left = n.timeout;
	}

	if (old) {
		// (in its place, without the coming and going)
		dismissNotice(old, { instant: true });
		el.classList.add("again");
	}
	noticeList.push(n);
	noticesEl.append(el);
	if (!noticesPaused) armNotice(n);

	// Only a few at once: the oldest ones that would go by themselves go first.
	while (noticeList.length > NOTICE_MAX) dismissNotice(noticeList.find((x) => x.timeout) || noticeList[0]);
	return { close: () => dismissNotice(n) };
}

// "Reply" on a chat notification: a box opens right in it, and Enter sends (the chat stays closed).
// reply: { placeholder, send(text) }, where send gives back a promise.
function noticeReply(n, { placeholder, send }) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "notice-btn";
	button.textContent = "Reply";

	const form = document.createElement("form");
	form.className = "notice-reply";
	form.hidden = true;
	const input = document.createElement("input");
	input.type = "text";
	input.maxLength = 500;
	input.autocomplete = "off";
	input.placeholder = String(placeholder || "Reply");
	input.setAttribute("aria-label", input.placeholder);
	const go = document.createElement("button");
	go.type = "submit";
	go.className = "notice-send";
	go.setAttribute("aria-label", "Send");
	go.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 6l6 6-6 6" /></svg>';
	form.append(input, go);

	// (typing in it isn't a click on the notification)
	form.addEventListener("click", (event) => event.stopPropagation());
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		button.hidden = true;
		form.hidden = false;
		n.el.classList.add("replying");
		// While you write, it stays.
		clearTimeout(n.timer);
		n.timeout = 0;
		n.el.classList.remove("timed");
		input.focus();
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const text = input.value.trim();
		if (!text || form.classList.contains("sending")) return;
		form.classList.add("sending");
		input.disabled = go.disabled = true;
		try {
			await send(text);
			form.replaceChildren(Object.assign(document.createElement("span"), { className: "notice-sent", textContent: "Sent" }));
			setTimeout(() => dismissNotice(n), 900);
		} catch {
			form.classList.remove("sending");
			input.disabled = go.disabled = false;
			input.placeholder = "Didn't send. Try again?";
			input.focus();
		}
	});
	return { button, form };
}

function armNotice(n) {
	if (!n.timeout || n.gone) return;
	clearTimeout(n.timer);
	n.ends = Date.now() + n.left;
	n.timer = setTimeout(() => dismissNotice(n), n.left);
}

function dismissNotice(n, { instant = false } = {}) {
	if (!n || n.gone) return;
	n.gone = true;
	clearTimeout(n.timer);
	noticeList.splice(noticeList.indexOf(n), 1);
	if (instant) {
		n.el.remove();
		return;
	}
	n.el.style.height = `${n.el.offsetHeight}px`;
	n.el.classList.add("leaving");
	setTimeout(() => n.el.remove(), 260);
}

// Put away every notification whose key starts with this (the chat's, once you open it).
function dismissNotices(prefix) {
	for (const n of [...noticeList]) if (n.key?.startsWith(prefix)) dismissNotice(n);
}

// Pointing at them (or moving into them with the keyboard) stops the clock, for all of them.
function pauseNotices(paused) {
	if (paused === noticesPaused) return;
	noticesPaused = paused;
	noticesEl.classList.toggle("paused", paused);
	for (const n of noticeList) {
		if (!n.timeout) continue;
		if (paused) {
			clearTimeout(n.timer);
			n.left = Math.max(1000, n.ends - Date.now());
		} else {
			armNotice(n);
		}
	}
}
noticesEl.addEventListener("pointerenter", () => pauseNotices(true));
noticesEl.addEventListener("pointerleave", () => pauseNotices(noticesEl.contains(document.activeElement)));
noticesEl.addEventListener("focusin", () => pauseNotices(true));
noticesEl.addEventListener("focusout", (event) => {
	if (!noticesEl.contains(event.relatedTarget) && !noticesEl.matches(":hover")) pauseNotices(false);
});
noticesEl.addEventListener("keydown", (event) => {
	if (event.key !== "Escape") return;
	const n = noticeList.find((x) => x.el.contains(event.target));
	if (n) {
		event.stopPropagation();
		dismissNotice(n);
	}
});

// Swipe one to the right (with a finger or the mouse) to put it away.
function swipeAway(n) {
	const el = n.el;
	el.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || event.target.closest("button, input, form")) return;
		const startX = event.clientX;
		let dx = 0;
		const move = (e) => {
			dx = Math.max(0, e.clientX - startX);
			if (dx > 6 && !el.classList.contains("swiping")) {
				el.classList.add("swiping");
				el.setPointerCapture?.(event.pointerId);
			}
			if (!el.classList.contains("swiping")) return;
			el.style.transform = `translateX(${dx}px)`;
			el.style.opacity = String(Math.max(0.2, 1 - dx / 260));
		};
		const up = () => {
			el.removeEventListener("pointermove", move);
			if (!el.classList.contains("swiping")) return;
			el.classList.remove("swiping");
			n.swiped = true;
			setTimeout(() => (n.swiped = false), 0); // (so the click that ends a swipe doesn't count)
			if (dx > 90) {
				el.classList.add("swiped");
				dismissNotice(n);
			} else {
				el.style.transform = "";
				el.style.opacity = "";
			}
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up, { once: true });
		el.addEventListener("pointercancel", up, { once: true });
	});
}

// When a new version of Slow's service worker takes over while Slow is open, offer a reload.
// (Not on the very first visit, when there was no worker before.)
if (navigator.serviceWorker) {
	const hadWorker = Boolean(navigator.serviceWorker.controller);
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!hadWorker) return;
		notify({
			tone: "update",
			key: "update",
			title: "Slow was updated",
			message: "Reload to start using the new version.",
			actions: [{ label: "Reload", run: () => location.reload() }, { label: "Later" }],
			timeout: 0,
		});
	});
}

/* ============================================================
   ANNOUNCEMENTS
   Messages from Slow's developers, kept in announcements.json (posted from dev mode).
   The bell shows when there are any, with a dot for ones you haven't read.
   "Important" ones also pop up once when you open Slow.
   ============================================================ */

const NEWS_SEEN_KEY = "slow.newsSeen";
const newsBtn = document.getElementById("btn-news");
const newsDot = newsBtn.querySelector(".news-dot");
const newsDialog = document.getElementById("news");
const newsList = document.getElementById("news-list");

let announcements = [];
let newsSeen = new Set(readList(NEWS_SEEN_KEY));
const newsPopped = new Set();

// Only well-formed announcements that haven't run out; newest first.
function liveAnnouncements(list) {
	const now = Date.now();
	return (Array.isArray(list) ? list : [])
		.filter((a) => a && typeof a.id === "string" && typeof a.title === "string" && typeof a.message === "string")
		.filter((a) => !a.expires || Date.parse(a.expires) > now)
		.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

function safeLink(value) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

function openInNewTab(url) {
	const tab = newTab();
	if (tab) navigate(tab, url, { here: true });
}

async function loadAnnouncements() {
	try {
		const res = await fetch(BASE + "announcements.json", { cache: "no-cache" });
		if (!res.ok) return;
		announcements = liveAnnouncements((await res.json()).announcements);
	} catch {
		return;
	}
	updateNewsButton();
	const important = announcements.find((a) => a.important && !newsSeen.has(a.id) && !newsPopped.has(a.id));
	if (important) {
		newsPopped.add(important.id);
		notify({
			icon: "bell",
			key: "news",
			title: important.title,
			message: important.message.length > 120 ? `${important.message.slice(0, 120)}…` : important.message,
			actions: [{ label: "Read", run: openNews }, { label: "Later" }],
			timeout: 0,
		});
	}
}

function updateNewsButton() {
	newsBtn.hidden = announcements.length === 0;
	newsDot.hidden = !announcements.some((a) => !newsSeen.has(a.id));
}

function formatDay(value) {
	const date = new Date(value);
	if (isNaN(date)) return "";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderNews() {
	newsList.textContent = "";
	if (!announcements.length) {
		const empty = document.createElement("p");
		empty.className = "news-empty";
		empty.textContent = "Nothing new right now.";
		newsList.append(empty);
		return;
	}
	for (const a of announcements) {
		const item = document.createElement("article");
		item.className = "news-item" + (a.important ? " important" : "");

		const meta = document.createElement("div");
		meta.className = "news-meta";
		const day = document.createElement("span");
		day.textContent = formatDay(a.date);
		meta.append(day);
		if (!newsSeen.has(a.id)) {
			const tag = document.createElement("span");
			tag.className = "news-tag";
			tag.textContent = "New";
			meta.append(tag);
		}

		const title = document.createElement("h3");
		title.textContent = a.title;
		const message = document.createElement("p");
		message.textContent = a.message;
		item.append(meta, title, message);

		const link = a.link && safeLink(a.link);
		if (link) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "pill-btn";
			btn.textContent = `Open ${hostOf(link)}`;
			btn.addEventListener("click", () => {
				newsDialog.close();
				openInNewTab(link);
			});
			item.append(btn);
		}
		newsList.append(item);
	}
}

function openNews() {
	renderNews();
	newsDialog.showModal();
	raiseTrail();
	// Everything shown now counts as read (the "New" tags stay until next time).
	for (const a of announcements) newsSeen.add(a.id);
	writeList(NEWS_SEEN_KEY, [...newsSeen].slice(-100));
	updateNewsButton();
}

newsBtn.addEventListener("click", openNews);
newsDialog.addEventListener("click", (event) => {
	if (event.target === newsDialog) newsDialog.close();
});

loadAnnouncements();
// New ones show up without reloading, while Slow is on screen.
setInterval(() => {
	if (!document.hidden) loadAnnouncements();
}, 10 * 60_000);

/* ============================================================
   DEV MODE (for Slow's developers only)
   Unlocks only with a GitHub token that can push to Slow's repository, and GitHub checks
   that, not this page, so finding this menu isn't enough to post anything. The token is
   kept in memory only (never saved), because websites opened through Slow share its
   address and storage.
   ============================================================ */

const DEV_REPO = "dreammidnight27/Slow";
const NEWS_PATH = "public/announcements.json";

const devDialog = document.getElementById("dev");
const devBadge = document.getElementById("dev-badge");
const devUnlockForm = document.getElementById("dev-unlock");
const devTokenInput = document.getElementById("dev-token");
const devUnlockNote = document.getElementById("dev-unlock-note");
const devPanel = document.getElementById("dev-panel");
const newsForm = document.getElementById("news-form");
const newsNote = document.getElementById("news-note");
const devNews = document.getElementById("dev-news");
const devInfo = document.getElementById("dev-info");

document.getElementById("dev-repo-name").textContent = DEV_REPO;

let devToken = null;
let devLogin = "";

async function github(path, options = {}, token = devToken) {
	const res = await fetch(`https://api.github.com/repos/${DEV_REPO}${path}`, {
		...options,
		cache: "no-store",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			...(options.body ? { "Content-Type": "application/json" } : {}),
		},
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const error = new Error(data.message || `GitHub said ${res.status}`);
		error.status = res.status;
		throw error;
	}
	return data;
}

const toBase64 = (text) => {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

function openDev() {
	if (palette.open) palette.close();
	if (settingsDialog.open) settingsDialog.close();
	showDevView();
	devDialog.showModal();
	raiseTrail();
	if (devToken) {
		refreshDevPanel();
		document.getElementById("news-title-input").focus();
	} else {
		devTokenInput.focus();
	}
}

function showDevView() {
	devUnlockForm.hidden = Boolean(devToken);
	devPanel.hidden = !devToken;
	devBadge.hidden = !devToken;
	document.getElementById("dev-title").textContent = devToken ? `Dev mode · ${devLogin}` : "Dev mode";
}

devUnlockForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const token = devTokenInput.value.trim();
	if (!token) return;
	devUnlockNote.textContent = "Checking with GitHub…";
	try {
		const repo = await github("", {}, token);
		if (!repo.permissions?.push) {
			devUnlockNote.textContent = "That token works, but it can't edit Slow's repository, so dev mode stays locked.";
			return;
		}
		devToken = token;
		devLogin = (await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}` } })
			.then((r) => r.json())
			.catch(() => ({}))).login || "dev";
	} catch (err) {
		devUnlockNote.textContent =
			err.status === 401 ? "GitHub didn't accept that token." : `Couldn't check the token: ${err.message}`;
		return;
	}
	devTokenInput.value = "";
	devUnlockNote.textContent = "";
	showDevView();
	refreshDevPanel();
});

function lockDev() {
	devToken = null;
	devLogin = "";
	showDevView();
	devDialog.close();
	notify({ icon: "lock", message: "Dev mode is locked." });
}

/* ---------- announcements, straight from the repository ---------- */

async function readNewsFile() {
	try {
		const file = await github(`/contents/${NEWS_PATH}?ref=main`);
		const list = JSON.parse(fromBase64(file.content)).announcements;
		return { list: Array.isArray(list) ? list : [], sha: file.sha };
	} catch (err) {
		if (err.status === 404) return { list: [], sha: undefined };
		throw err;
	}
}

async function writeNewsFile(list, sha, message) {
	const content = JSON.stringify({ announcements: list }, null, "\t") + "\n";
	await github(`/contents/${NEWS_PATH}`, {
		method: "PUT",
		body: JSON.stringify({ message, content: toBase64(content), sha, branch: "main" }),
	});
	announcements = liveAnnouncements(list);
	updateNewsButton();
}

function explainGithubError(err) {
	if (err.status === 409 || err.status === 422) return "The announcements changed on GitHub just now. Try again.";
	if (err.status === 401) return "GitHub stopped accepting the token. Lock dev mode and unlock it again.";
	return `GitHub said: ${err.message}`;
}

async function renderDevNews() {
	devNews.textContent = "Loading…";
	let list;
	try {
		({ list } = await readNewsFile());
	} catch (err) {
		devNews.textContent = explainGithubError(err);
		return;
	}
	devNews.textContent = "";
	const shown = liveAnnouncements(list);
	if (!shown.length) {
		devNews.textContent = "Nothing posted.";
		return;
	}
	for (const a of shown) {
		const row = document.createElement("div");
		row.className = "dev-news-row";
		const title = document.createElement("span");
		title.textContent = a.title;
		const when = document.createElement("small");
		when.textContent = (a.important ? "Pop-up · " : "") + formatDay(a.date) + (a.expires ? ` – ${formatDay(a.expires)}` : "");
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "pill-btn danger";
		remove.textContent = "Remove";
		remove.addEventListener("click", async () => {
			if (!window.confirm(`Remove “${a.title}” for everyone?`)) return;
			remove.disabled = true;
			try {
				const { list: current, sha } = await readNewsFile();
				await writeNewsFile(current.filter((x) => x.id !== a.id), sha, `Remove announcement: ${a.title}`);
				notify({ tone: "success", message: "Removed. It disappears for everyone in about a minute." });
			} catch (err) {
				notify({ tone: "error", title: "Couldn't remove it", message: explainGithubError(err) });
			}
			renderDevNews();
		});
		row.append(title, when, remove);
		devNews.append(row);
	}
}

newsForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const title = document.getElementById("news-title-input").value.trim();
	const message = document.getElementById("news-message").value.trim();
	const linkText = document.getElementById("news-link").value.trim();
	const days = Number(document.getElementById("news-days").value);
	const important = document.getElementById("news-important").checked;

	if (!title || !message) {
		newsNote.textContent = "Add a title and a message.";
		return;
	}
	const link = linkText ? safeLink(/^[a-z]+:/i.test(linkText) ? linkText : `https://${linkText}`) : null;
	if (linkText && !link) {
		newsNote.textContent = "That link doesn't look right.";
		return;
	}

	const now = new Date();
	const item = {
		id: now.getTime().toString(36),
		title,
		message,
		...(link ? { link } : {}),
		important,
		date: now.toISOString(),
		...(days ? { expires: new Date(now.getTime() + days * 86_400_000).toISOString() } : {}),
	};

	const submit = newsForm.querySelector("[type=submit]");
	submit.disabled = true;
	newsNote.textContent = "Posting…";
	try {
		const { list, sha } = await readNewsFile();
		await writeNewsFile([item, ...liveAnnouncements(list)], sha, `Announcement: ${title}`);
		newsForm.reset();
		newsNote.textContent = "Posted. Everyone sees it in about a minute, once GitHub Pages updates.";
	} catch (err) {
		newsNote.textContent = explainGithubError(err);
	}
	submit.disabled = false;
	renderDevNews();
});

/* ---------- diagnostics and tools ---------- */

async function renderDevInfo(extra = {}) {
	const storage = await navigator.storage?.estimate?.().catch(() => null);
	const covers = await caches
		.open(COVER_CACHE)
		.then((c) => c.keys())
		.then((k) => k.length)
		.catch(() => "?");
	const rows = {
		"Wisp server": settings.wispUrl || defaultWispUrl(),
		Connection: extra.connection || "not tested",
		"Service worker": navigator.serviceWorker?.controller ? "running" : "not running",
		Isolated: crossOriginIsolated ? "yes" : "no",
		Tabs: `${tabs.length} open, ${tabs.filter((t) => t.frame).length} loaded`,
		"Storage used": storage ? `${(storage.usage / 1048576).toFixed(1)} MB` : "?",
		"Game pictures": `${covers} saved`,
		Announcements: `${announcements.length} showing`,
	};
	devInfo.textContent = "";
	for (const [name, value] of Object.entries(rows)) {
		const dt = document.createElement("dt");
		dt.textContent = name;
		const dd = document.createElement("dd");
		dd.textContent = value;
		devInfo.append(dt, dd);
	}
}

function refreshDevPanel() {
	renderDevNews();
	renderDevInfo();
}

document.getElementById("dev-test").addEventListener("click", async (event) => {
	const btn = event.currentTarget;
	btn.disabled = true;
	renderDevInfo({ connection: "testing…" });
	const start = performance.now();
	const works = await connectionWorks();
	const ms = Math.round(performance.now() - start);
	renderDevInfo({ connection: works ? `working (${ms} ms)` : "not working" });
	btn.disabled = false;
});

document.getElementById("dev-reconnect").addEventListener("click", async (event) => {
	try {
		await reconnect();
		confirmOnButton(event.currentTarget, "Reconnected");
	} catch {
		confirmOnButton(event.currentTarget, "Failed");
	}
});

document.getElementById("dev-covers").addEventListener("click", async (event) => {
	await caches.delete(COVER_CACHE);
	confirmOnButton(event.currentTarget, "Cleared");
	renderDevInfo();
});

document.getElementById("dev-update").addEventListener("click", async () => {
	await (await navigator.serviceWorker?.getRegistration())?.update().catch(() => {});
	location.reload();
});

document.getElementById("dev-lock").addEventListener("click", lockDev);
document.getElementById("dev-close").addEventListener("click", () => devDialog.close());
devBadge.addEventListener("click", openDev);
devDialog.addEventListener("click", (event) => {
	if (event.target === devDialog) devDialog.close();
});

/* ============================================================
   REOPEN CLOSED TABS
   ============================================================ */

const closedTabs = [];

function reopenClosedTab() {
	const last = closedTabs.pop();
	if (!last) {
		notify({ icon: "tab", message: "There are no closed tabs to bring back." });
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
	// (after a crash one place is kept free for the fresh page opened instead)
	const urls = (saved?.urls || []).filter((u) => typeof u === "string").slice(0, crashedLastTime ? MAX_TABS - 1 : MAX_TABS);
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
	if (!crashedLastTime) {
		activate(active.id);
		return true;
	}
	// Opening the tab you were on could crash Slow again, so every tab waits until you choose it.
	newTab();
	const suspect = saved.urls?.[saved.active] ? hostOf(saved.urls[saved.active]) : "";
	notify({
		tone: "warning",
		title: "Slow stopped unexpectedly",
		message: `That happened last time${suspect ? ` while ${suspect} was open` : ""}. Your tabs are back, and each one loads when you open it.`,
		actions: [{ label: "OK" }],
		timeout: 0,
	});
	return true;
}

/* ---------- noticing a crash ----------
   A page that crashes Slow would crash it again every time, since Slow reopens the tab you were on.
   While Slow is open it leaves a mark in this browser tab's own storage, and removes it when it
   closes normally. Finding the mark on startup means the last run crashed. (It's kept per browser
   tab, so a second Slow window open at the same time doesn't look like a crash.) */
const RUNNING_KEY = "slow.running";
const crashedLastTime = (() => {
	try {
		return sessionStorage.getItem(RUNNING_KEY) === "1";
	} catch {
		return false;
	}
})();
try {
	sessionStorage.setItem(RUNNING_KEY, "1");
} catch {}
window.addEventListener("pagehide", () => {
	try {
		sessionStorage.removeItem(RUNNING_KEY);
	} catch {}
});

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
	notify({
		icon: "break",
		key: "break",
		title: "Time for a break",
		message: `You've been browsing for ${breakLength(minutes)}. Look at something far away, stretch, or grab some water.`,
		actions: [
			{
				label: "Remind me in 10 min",
				run: () => (activeSince = Date.now() - Math.max(0, minutes - 10) * 60_000),
			},
			{ label: "Thanks", run: () => (activeSince = Date.now()) },
		],
		timeout: 0,
	});
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
	chat: "💬",
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
		{ label: chatDock.hidden ? "Open chat" : "Close chat", hint: "Alt+C", run: toggleChat },
		activeTab()?.url && { label: "Share this page in chat", detail: hostOf(activeTab().url), run: () => shareInChat(activeTab()) },
		activeTab()?.url && { label: "Copy this page's link", detail: hostOf(activeTab().url), run: () => copyLink(activeTab()) },
		{ label: "Keyboard shortcuts", hint: "?", run: openKeys },
		{ label: "Settings", run: openSettings },
		announcements.length && { label: "Announcements", run: openNews },
		devToken && { label: "Dev mode", detail: devLogin, run: openDev },
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
				notify({
					icon: "break",
					message: settings.breakMinutes
						? "Break reminders are on. You can change how often in Settings."
						: "Break reminders are off.",
				});
			},
		},
		recent.length && {
			label: "Clear history",
			run: () => {
				recent = [];
				writeList(RECENT_KEY, recent);
				notify({ tone: "success", icon: "history", message: "History cleared." });
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
	// Your chats (once you've signed in to the chat): the ones with something new come first.
	const chats = chatList().map((c) => ({
		kind: "chat",
		// (typing someone's name finds their chat first)
		name: c.title,
		label: c.kind === "dm" ? `Chat with ${c.title}` : c.kind === "global" ? "Global chat" : c.title,
		detail: c.preview,
		hint: c.unread ? "New" : "Chat",
		img: c.avatar?.src || null,
		unread: c.unread,
		run: () => openChat(c.id),
	}));

	if (!words.length) {
		return [...chats.filter((c) => c.unread), ...openTabs, ...paletteActions(), ...history.slice(0, 5)];
	}

	// Typed something: offer to go there or search for it, plus everything that matches.
	const target = search(q, searchTemplate());
	const isSearch = target === searchTemplate().replace("%s", encodeURIComponent(q));
	const engine = (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.bing).name;
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
	// Dev mode isn't listed anywhere; it only shows up when you type "dev".
	const dev = !devToken && /\bdev/i.test(q) ? [{ kind: "action", label: "Dev mode", detail: "For Slow's developers", run: openDev }] : [];
	const all = [...dev, ...openTabs, ...chats, ...paletteActions(), ...saved, ...games, ...history].filter(matches);
	const strong = all.filter((item) => item.label.toLowerCase().startsWith(words[0]) || item.name?.toLowerCase().startsWith(words[0]));
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
		icon.className = `palette-icon kind-${item.kind}`;
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

// Typing in a box (so a key is a letter, not a shortcut)?
const typingIn = (el) => Boolean(el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']"));

// F5 or Ctrl+R (not with Shift, which still reloads everything).
const isReloadKey = (event, mod) =>
	!event.shiftKey && !event.altKey && ((event.key === "F5" && !mod) || (mod && event.code === "KeyR"));

document.addEventListener("keydown", (event) => {
	const mod = isMac ? event.metaKey : event.ctrlKey;

	if (mod && !event.altKey && !event.shiftKey && event.code === "KeyK") {
		event.preventDefault();
		openPalette();
		return;
	}

	// Reloading reloads the page you're looking at, not all of Slow (and every tab, game and call).
	if (isReloadKey(event, mod) && reloadHere()) {
		event.preventDefault();
		return;
	}

	const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
	const overlay = document.querySelector("dialog[open]") || !gamesMenu.classList.contains("hidden");
	// "?" shows every shortcut.
	if (plain && event.key === "?" && !typingIn(event.target) && !document.querySelector("dialog[open]")) {
		event.preventDefault();
		openKeys();
		return;
	}
	// On the new tab page, just start typing to search.
	if (plain && event.key.length === 1 && event.key !== " " && !typingIn(event.target) && !overlay && showingHome()) {
		homeSearch.focus();
		return;
	}

	if (!event.altKey || event.ctrlKey || event.metaKey) return;
	if (runShortcut(event.code, event.shiftKey)) event.preventDefault();
});

const showingHome = () => !home.classList.contains("hidden") && appView.classList.contains("hidden") && chatDock.hidden;

// Every shortcut, in one place ("?", or "Keyboard shortcuts" in Ctrl+K).
const keysDialog = document.getElementById("keys");
function openKeys() {
	if (palette.open) palette.close();
	if (keysDialog.open) return;
	keysDialog.showModal();
	raiseTrail();
}
keysDialog.addEventListener("click", (event) => {
	if (event.target === keysDialog || event.target.closest("[data-keys-close]")) keysDialog.close();
});

// What F5 / Ctrl+R reload: the app or the tab's page on screen. (On the new tab page there's
// nothing but Slow, so Slow reloads as usual.)
function reloadHere() {
	if (shownApp && !appView.classList.contains("hidden")) {
		document.getElementById("app-reload").click();
		return true;
	}
	if (activeTab()?.frame && home.classList.contains("hidden")) {
		reloadBtn.click();
		return true;
	}
	return false;
}

// Slow's Alt shortcuts. Websites inside Slow pass them on too (browsing.js), so they work
// wherever you are. Says whether it did something.
function runShortcut(code, shift) {
	if (code === "KeyT" && shift) reopenClosedTab();
	else if (code === "KeyT") newTab();
	else if (code === "KeyW") closeTab(activeId);
	else if (code === "KeyC") toggleChat();
	else if (code === "KeyK") openPalette();
	else if (code === "ArrowLeft" || code === "ArrowRight") {
		// back and forward, in the tab (or app) on screen
		const step = code === "ArrowLeft" ? -1 : 1;
		if (shownApp && !appView.classList.contains("hidden")) appStep(shownApp, step);
		else frameAction(step < 0 ? "back" : "forward");
	} else if (code === "KeyL") {
		address.focus();
		address.select();
	} else if (/^Digit[1-8]$/.test(code)) {
		const tab = tabs[Number(code.slice(5)) - 1];
		if (!tab) return false;
		activate(tab.id);
	} else {
		return false;
	}
	return true;
}

/* ---------- what websites inside Slow ask of it (browsing.js) ---------- */

// Links that would open a new browser tab open a Slow tab, next to the tab they came from
// (after any others opened from it), like other browsers.
function openLinkInTab(url, { background = false } = {}) {
	const opener = activeTab();
	const tab = newTab({ focus: !background });
	if (!tab) return;
	const after = opener?.lastOpened && tabs.includes(opener.lastOpened) ? opener.lastOpened : opener;
	if (after) {
		tabs.splice(tabs.indexOf(tab), 1);
		const index = tabs.indexOf(after) + 1;
		tabs.splice(index, 0, tab);
		tabStrip.insertBefore(tab.el, tabs[index + 1]?.el ?? null);
		opener.lastOpened = tab;
	}
	navigate(tab, url, { here: true });
	if (background) playEnter(tab.el);
}

window.__slowOpenTab = openLinkInTab;
window.__slowKey = runShortcut;
window.__slowReload = reloadHere;

// Pointing at a link shows where it goes, at the bottom left.
const linkStatus = document.getElementById("link-status");
let linkStatusTimer = 0;

function showLinkStatus(url) {
	clearTimeout(linkStatusTimer);
	let link = null;
	try {
		link = url ? new URL(url) : null;
	} catch {}
	if (!link) {
		linkStatusTimer = setTimeout(() => linkStatus.classList.remove("show"), 120);
		return;
	}
	const host = document.createElement("b");
	host.textContent = link.hostname.replace(/^www\./, "");
	const rest = link.pathname === "/" && !link.search ? "" : link.pathname + link.search;
	linkStatus.replaceChildren(host, rest);
	linkStatus.classList.add("show");
}

window.__slowLinkHover = showLinkStatus;

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
	notify({ icon: "moon", message: index === -1 ? `Dark mode is off for ${host}.` : `Dark mode is back on for ${host}.` });
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
	tabMenu.querySelector("[data-action=copy]").disabled = !menuTab.url;
	tabMenu.querySelector("[data-action=share]").disabled = !menuTab.url;
}

// The real address of a tab's page (not Slow's proxied one).
async function copyLink(tab) {
	if (!tab?.url) return;
	try {
		await navigator.clipboard.writeText(tab.url);
		notify({ tone: "success", icon: "tab", message: "Link copied.", timeout: 2500 });
	} catch {
		notify({ tone: "error", message: "Couldn't copy the link." });
	}
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
	} else if (action === "copy") {
		copyLink(tab);
	} else if (action === "share") {
		shareInChat(tab);
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
// Chicken King's Vault, kept on jsDelivr like UGS (sw.js relabels its pages as web pages).
const CKV_FILES = "https://cdn.jsdelivr.net/gh/carbonicality/ChickenKingsVault@main/gamefiles/"; // also in sw.js
const CKV_IMAGES = "https://cdn.jsdelivr.net/gh/carbonicality/ChickenKingsVault@main/gameimages/"; // also in sw.js

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
	{
		id: "ckv",
		name: "CKV",
		lists: ["https://cdn.jsdelivr.net/gh/carbonicality/ChickenKingsVault@main/games.json"],
		// Chicken King's Vault: [{ name, html, img }], each game a page in gamefiles/.
		toGames: (list) =>
			list
				.filter((g) => typeof g.html === "string" && g.html && typeof g.name === "string")
				.map((g) => ({
					name: g.name,
					url: CKV_FILES + encodeURIComponent(g.html),
					cover: g.img ? CKV_IMAGES + encodeURIComponent(g.img) : "",
					tag: "",
					author: "",
				})),
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
const RECENT_GAMES_KEY = "slow.recentGames";
const FAVORITE_GAMES_KEY = "slow.favoriteGames";
const gamesBtn = document.getElementById("btn-games");
const gamesMenu = document.getElementById("games-menu");
const gamesBody = document.getElementById("games-body");
const gamesFilter = document.getElementById("games-filter");
const gamesClear = document.getElementById("games-clear");
const gamesNote = document.getElementById("games-note");
const gamesViews = document.getElementById("games-views");

/* ---------- the side list: Home, the picks, everything, then each collection ---------- */

const VIEW_ICONS = {
	home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z" />',
	favorites: '<path d="M12 19.5s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.2-7 9.6-7 9.6Z" />',
	popular: '<path d="M12 3.5c.6 3.2 4.5 5 4.5 9.3A4.5 4.5 0 0 1 12 17.5a4.5 4.5 0 0 1-4.5-4.7c0-2 1.1-3.3 2.1-4.2.2 1.4.8 2.3 1.6 2.6-.3-2.7.4-5.4.8-7.7Z" /><path d="M9 20.5h6" />',
	multiplayer: '<circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14.2a4.6 4.6 0 0 1 5 4.8" />',
	all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />',
	collection: '<path d="M5 6.5h14M5 12h14M5 17.5h9" />',
};

const PICK_VIEWS = [
	{ id: "home", name: "Home" },
	{ id: "favorites", name: "Favorites", blurb: "Games you've saved. Point at any game and press its heart to add it." },
	{ id: "popular", name: "Popular", blurb: "Slow's picks: quick to start and they run well through Slow." },
	{ id: "multiplayer", name: "Multiplayer", blurb: "Play online against people from everywhere. Each opens the game's own site." },
	{ id: "all", name: "All games", blurb: "Every game from every collection, A to Z." },
];

function viewButton(view, icon) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "games-view";
	btn.dataset.view = view.id;
	const ico = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	ico.setAttribute("viewBox", "0 0 24 24");
	ico.setAttribute("aria-hidden", "true");
	ico.classList.add("ico");
	ico.innerHTML = VIEW_ICONS[icon]; // (Slow's own fixed drawings above)
	const name = document.createElement("span");
	name.className = "games-view-name";
	name.textContent = view.name;
	const count = document.createElement("span");
	count.className = "games-view-count";
	btn.append(ico, name, count);
	btn.addEventListener("click", () => setGamesView(view.id));
	return btn;
}

gamesViews.textContent = "";
for (const view of PICK_VIEWS) gamesViews.append(viewButton(view, view.id));
const collectionsLabel = document.createElement("span");
collectionsLabel.className = "games-views-label";
collectionsLabel.textContent = "Collections";
gamesViews.append(collectionsLabel);
for (const source of GAME_SOURCES) gamesViews.append(viewButton(source, "collection"));
const gamesViewBtns = gamesViews.querySelectorAll("[data-view]");
// Liquid glass (liquid.js): a drop of glass marks the open list and flows to the next one you pick.
const gamesLens = Liquid.lens(gamesViews);
// ...another follows the pointer over the bar's buttons...
Liquid.lens(document.querySelector(".games-bar"), { hover: ".games-bar > .icon-btn", className: "small" });
// ...and cards lean toward the pointer and catch the light.
Liquid.tilt(gamesBody, { item: ".game-open", part: ".game-frame" });
Liquid.tilt(gamesBody, { item: ".games-collection", angle: 6, lift: 3 });
Liquid.tilt(gamesBody, { item: ".games-hero-art", angle: 10, lift: 2 });

const knownView = (id) =>
	id === "home" || id === "favorites" || id === "all" || Boolean(CARD_LISTS[id]) || Boolean(gameSource(id));

let gamesView = (() => {
	try {
		const saved = localStorage.getItem(GAMES_VIEW_KEY);
		return knownView(saved) ? saved : "home";
	} catch {
		return "home";
	}
})();

function viewInfo(id) {
	return PICK_VIEWS.find((v) => v.id === id) || gameSource(id);
}

function updateViewCounts() {
	const counts = {
		favorites: favoriteGames.length,
		popular: GAMES.length,
		multiplayer: MULTIPLAYER.length,
		all: allGamesCount(),
	};
	for (const s of GAME_SOURCES) {
		const state = sourceState[s.id];
		counts[s.id] = state.games ? state.games.length : state.failed ? "!" : "…";
	}
	for (const btn of gamesViewBtns) {
		const value = counts[btn.dataset.view];
		btn.querySelector(".games-view-count").textContent = typeof value === "number" ? value.toLocaleString() : value ?? "";
		const current = btn.dataset.view === gamesView;
		btn.classList.toggle("on", current);
		if (current) btn.setAttribute("aria-current", "page");
		else btn.removeAttribute("aria-current");
	}
	gamesLens.to(gamesViews.querySelector(".games-view.on"));
}

/* ---------- games you opened lately ---------- */

function recentGames() {
	return readList(RECENT_GAMES_KEY).filter((g) => g && typeof g.url === "string" && typeof g.name === "string");
}

function rememberGame(game) {
	if (!settings.history) return;
	const list = recentGames().filter((g) => g.url !== game.url);
	list.unshift(keepGame(game));
	writeList(RECENT_GAMES_KEY, list.slice(0, 12));
}

/* ---------- favorites (the heart on each game) ---------- */

const keepGame = ({ name, url, cover, icon, hue, tag, from }) => ({ name, url, cover, icon, hue, tag, from });

let favoriteGames = readList(FAVORITE_GAMES_KEY).filter((g) => g && typeof g.url === "string" && typeof g.name === "string");

const isFavorite = (game) => favoriteGames.some((g) => g.url === game.url);

function toggleFavorite(game) {
	favoriteGames = isFavorite(game)
		? favoriteGames.filter((g) => g.url !== game.url)
		: [keepGame(game), ...favoriteGames];
	writeList(FAVORITE_GAMES_KEY, favoriteGames);
	updateViewCounts();
}

// Games play inside Slow's app view (the back arrow returns to the games page).
function openGame(game) {
	rememberGame(game);
	openApp("game", {
		name: game.name,
		sub: game.from || game.tag || "Game",
		url: game.url,
		icon: () => gameArt(game),
		backToGames: true,
	});
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

/* ---------- cards ---------- */

// Games without a picture get a color of their own (the same one every time), not plain grey.
function hueFor(name) {
	let h = 0;
	for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

// Slow's own picks (Popular, Multiplayer) only have an emoji; most of them are also in a
// collection with real artwork, so they borrow that picture (matched by name).
let borrowed = { key: "", covers: new Map() };

function pictureFor(game) {
	if (game.cover) return missingCovers.has(game.cover) ? "" : game.cover;
	if (!game.icon) return "";
	const key = GAME_SOURCES.map((s) => sourceState[s.id].games?.length ?? "-").join(",");
	if (borrowed.key !== key) {
		const covers = new Map();
		for (const g of loadedSourceGames()) {
			const name = squash(g.name);
			if (g.cover && !missingCovers.has(g.cover) && !covers.has(name)) covers.set(name, g.cover);
		}
		borrowed = { key, covers };
	}
	return borrowed.covers.get(squash(game.name)) || "";
}

function gameArt(game) {
	// Without a picture: its emoji (Slow's picks), otherwise its first letter on its own color.
	const fallback = () => {
		const el = document.createElement("span");
		if (game.icon) {
			el.className = "game-art icon";
			el.textContent = game.icon;
			el.setAttribute("aria-hidden", "true");
		} else {
			el.className = "game-art letter";
			el.textContent = game.name.replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "?";
		}
		return el;
	};
	const picture = pictureFor(game);
	if (!picture) return fallback();
	const img = document.createElement("img");
	img.className = "game-art";
	// Asked for in "cross-origin" mode: Slow's page only shows other sites' pictures that way.
	img.crossOrigin = "anonymous";
	img.loading = "lazy";
	img.decoding = "async";
	img.alt = "";
	img.src = picture;
	if (!img.complete) {
		img.classList.add("waiting");
		img.addEventListener("load", () => img.classList.remove("waiting"), { once: true });
	}
	img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
	return img;
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.5s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.2-7 9.6-7 9.6Z" /></svg>';

function gameCard(game, i, { meta = game.tag || game.from || "" } = {}) {
	const card = document.createElement("div");
	card.className = "game";
	card.style.setProperty("--i", String(i % SOURCE_PAGE));
	card.style.setProperty("--hue", String(game.hue ?? hueFor(game.name)));

	const open = document.createElement("button");
	open.type = "button";
	open.className = "game-open";
	open.title = game.author ? `Play ${game.name} (by ${game.author})` : `Play ${game.name}`;

	const frame = document.createElement("span");
	frame.className = "game-frame";
	const play = document.createElement("span");
	play.className = "game-play";
	play.setAttribute("aria-hidden", "true");
	frame.append(gameArt(game), play);

	const name = document.createElement("span");
	name.className = "game-name";
	name.textContent = game.name;
	open.append(frame, name);
	if (meta) {
		const sub = document.createElement("span");
		sub.className = "game-meta";
		sub.textContent = meta;
		open.append(sub);
	}
	open.addEventListener("click", () => openGame(game));

	const fav = document.createElement("button");
	fav.type = "button";
	fav.className = "game-fav";
	fav.innerHTML = HEART; // (Slow's own fixed drawing)
	const showFav = () => {
		const on = isFavorite(game);
		fav.classList.toggle("on", on);
		fav.setAttribute("aria-pressed", String(on));
		fav.setAttribute("aria-label", `${on ? "Remove" : "Save"} ${game.name} ${on ? "from" : "to"} favorites`);
		fav.title = on ? "Remove from favorites" : "Add to favorites";
	};
	showFav();
	fav.addEventListener("click", () => {
		toggleFavorite(game);
		showFav();
		fav.classList.remove("pop");
		void fav.offsetWidth;
		fav.classList.add("pop");
		// Lists that show favorites change with it.
		if (gamesView === "favorites" || (gamesView === "home" && !gamesFilter.value.trim())) refreshGames();
	});

	card.append(open, fav);
	return card;
}

/* ---------- page parts ---------- */

function gamesSectionHead(title, blurb) {
	const head = document.createElement("div");
	head.className = "games-head";
	const h = document.createElement("h3");
	h.textContent = title;
	head.append(h);
	if (blurb) {
		const p = document.createElement("p");
		p.textContent = blurb;
		head.append(p);
	}
	gamesBody.append(head);
	return head;
}

function gamesMessage(text) {
	const p = document.createElement("p");
	p.className = "games-empty";
	p.textContent = text;
	gamesBody.append(p);
	return p;
}

// "Nothing found", with a quick way to look everywhere else.
function noMatches(query) {
	const p = gamesMessage(`No games match “${query}” here. `);
	if (gamesView !== "all" && gamesView !== "home") {
		const everywhere = document.createElement("button");
		everywhere.type = "button";
		everywhere.className = "text-btn";
		everywhere.textContent = "Search all games";
		everywhere.addEventListener("click", () => setGamesView("all"));
		p.append(everywhere);
	}
}

function textButton(label, run) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "text-btn";
	btn.textContent = label;
	btn.addEventListener("click", run);
	return btn;
}

// A titled row of cards that scrolls sideways.
function gamesRow(title, games, action) {
	const row = document.createElement("section");
	row.className = "games-row";
	const head = document.createElement("div");
	head.className = "games-row-head";
	const h = document.createElement("h3");
	h.textContent = title;
	head.append(h);
	if (action) head.append(action);
	const track = document.createElement("div");
	track.className = "games-track";
	games.forEach((game, i) => track.append(gameCard(game, i)));
	row.append(head, track);
	gamesBody.append(row);
	return row;
}

/* ---------- Home ---------- */

let featured = null;

// Games the collections mark as gory or for older players are still listed, just never featured.
const NOT_FEATURED = /gore|13\+|16\+|18\+|nsfw|mature|horror/i;

function pickFeatured() {
	const withPictures = loadedSourceGames().filter(
		(g) => g.cover && !missingCovers.has(g.cover) && !NOT_FEATURED.test(`${g.name} ${g.tag}`),
	);
	const pool = withPictures.length > 20 ? withPictures : GAMES;
	let next = featured;
	for (let tries = 0; tries < 5 && (!next || next === featured); tries++) next = pool[Math.floor(Math.random() * pool.length)];
	featured = next;
}

function gamesHero() {
	if (!featured) pickFeatured();
	const game = featured;
	const hero = document.createElement("section");
	hero.className = "games-hero";
	hero.style.setProperty("--hue", String(game.hue ?? hueFor(game.name)));

	const picture = pictureFor(game);
	if (picture) {
		const glow = document.createElement("img");
		glow.className = "games-hero-glow";
		glow.crossOrigin = "anonymous";
		glow.alt = "";
		glow.src = picture;
		glow.addEventListener("error", () => glow.remove(), { once: true });
		hero.append(glow);
	}

	const text = document.createElement("div");
	text.className = "games-hero-text";
	const kicker = document.createElement("span");
	kicker.className = "games-kicker";
	kicker.textContent = "Featured";
	const title = document.createElement("h3");
	title.textContent = game.name;
	const meta = document.createElement("p");
	meta.textContent = [game.tag, game.from].filter(Boolean).join(" · ") || "A game picked for you";
	const actions = document.createElement("div");
	actions.className = "games-hero-actions";
	const play = document.createElement("button");
	play.type = "button";
	play.className = "pill-btn primary";
	play.textContent = "Play";
	play.addEventListener("click", () => openGame(game));
	const shuffle = document.createElement("button");
	shuffle.type = "button";
	shuffle.className = "pill-btn";
	shuffle.textContent = "Shuffle";
	shuffle.addEventListener("click", () => {
		pickFeatured();
		const next = gamesHero();
		hero.replaceWith(next);
		next.classList.add("swap");
	});
	actions.append(play, shuffle);
	text.append(kicker, title, meta, actions);

	const art = document.createElement("button");
	art.type = "button";
	art.className = "games-hero-art";
	art.title = `Play ${game.name}`;
	art.append(gameArt(game));
	art.addEventListener("click", () => openGame(game));

	hero.append(text, art);
	return hero;
}

function renderHome() {
	gamesBody.append(gamesHero());

	const recent = recentGames();
	if (recent.length) {
		gamesRow(
			"Continue playing",
			recent,
			textButton("Clear", () => {
				writeList(RECENT_GAMES_KEY, []);
				renderGames();
			}),
		);
	}
	if (favoriteGames.length) {
		gamesRow("Favorites", favoriteGames, textButton("See all", () => setGamesView("favorites")));
	}
	gamesRow("Popular", GAMES, textButton("See all", () => setGamesView("popular")));
	gamesRow("Multiplayer", MULTIPLAYER, textButton("See all", () => setGamesView("multiplayer")));

	const shelf = document.createElement("section");
	shelf.className = "games-row";
	const head = document.createElement("div");
	head.className = "games-row-head";
	const h = document.createElement("h3");
	h.textContent = "Collections";
	head.append(h, textButton("Browse everything", () => setGamesView("all")));
	const grid = document.createElement("div");
	grid.className = "games-collections";
	for (const source of GAME_SOURCES) grid.append(collectionTile(source));
	shelf.append(head, grid);
	gamesBody.append(shelf);

	gamesNote.textContent = "Games open in a tab through Slow. Some need a moment to load.";
}

function collectionTile(source) {
	const state = sourceState[source.id];
	const tile = document.createElement("button");
	tile.type = "button";
	tile.className = "games-collection";
	tile.style.setProperty("--hue", String(hueFor(source.name)));

	const peek = document.createElement("span");
	peek.className = "games-collection-peek";
	const pictures = (state.games || []).filter((g) => g.cover && !missingCovers.has(g.cover)).slice(0, 3);
	for (const game of pictures) peek.append(gameArt(game));
	if (!pictures.length) {
		const letter = document.createElement("span");
		letter.className = "game-art letter";
		letter.textContent = source.name.charAt(0).toUpperCase();
		peek.append(letter);
	}

	const name = document.createElement("span");
	name.className = "games-collection-name";
	name.textContent = source.name;
	const count = document.createElement("span");
	count.className = "games-collection-count";
	count.textContent = state.games
		? `${state.games.length.toLocaleString()} games`
		: state.failed
			? "Couldn't load"
			: "Loading…";

	tile.append(peek, name, count);
	tile.addEventListener("click", () => setGamesView(source.id));
	if (!state.games && !state.failed) {
		loadSource(source).then(() => {
			if (gamesView === "home" && !gamesFilter.value.trim() && !gamesMenu.classList.contains("hidden")) refreshGames();
		});
	}
	return tile;
}

/* ---------- the count, and drawing whichever list is open ---------- */

// Every game on every tab (each counted once), growing as lists load.
const gamesTotal = document.getElementById("games-total");
let allCache = { key: "", games: [] };

// Every game on every tab, each once, A to Z (names that start with a symbol go last).
function allGames() {
	const key = GAME_SOURCES.map((s) => sourceState[s.id].games?.length ?? "-").join(",");
	if (allCache.key === key) return allCache.games;
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
	games.sort((a, b) => odd(a) - odd(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
	allCache = { key, games };
	return games;
}

const allGamesCount = () => allGames().length;

function showGamesTotal() {
	const loading = GAME_SOURCES.some((s) => !sourceState[s.id].games && !sourceState[s.id].failed);
	const total = `${allGamesCount().toLocaleString()}${loading ? "+" : ""}`;
	gamesTotal.textContent = `${total} games`;
	gamesFilter.placeholder = gamesView === "home" || gamesView === "all" ? `Search ${total} games` : `Search ${viewInfo(gamesView)?.name || "games"}`;
}

// `fresh` (opening the page or switching lists) plays the cards' fade-in; typing doesn't, so results don't flicker.
function renderGames({ fresh = false } = {}) {
	showGamesTotal();
	updateViewCounts();
	const query = gamesFilter.value.trim();
	gamesClear.hidden = !query;
	gamesBody.textContent = "";
	gamesBody.classList.toggle("animate", fresh);
	coverList = [];
	coverDrawn = 0;

	if (gamesView === "home") {
		// Searching from Home looks through every game.
		if (query) return showCoverGames(allGames(), query, "");
		return renderHome();
	}

	const info = viewInfo(gamesView);
	if (!query) gamesSectionHead(info.name, info.blurb || `A free collection of web games, from ${info.name}.`);

	if (CARD_LISTS[gamesView]) return showCoverGames(CARD_LISTS[gamesView], query, info.name);

	if (gamesView === "favorites") {
		if (!favoriteGames.length) {
			gamesMessage("Nothing saved yet. Point at any game and press its heart, and it'll wait for you here.");
			gamesNote.textContent = "";
			return;
		}
		return showCoverGames(favoriteGames, query, "Favorites");
	}

	if (gamesView === "all") {
		for (const s of GAME_SOURCES.filter((s) => !sourceState[s.id].games && !sourceState[s.id].failed)) {
			loadSource(s).then(() => {
				if (gamesView === "all" && !gamesMenu.classList.contains("hidden")) refreshGames();
			});
		}
		return showCoverGames(allGames(), query, "");
	}

	const state = sourceState[info.id];
	if (!state.games) {
		if (state.failed) {
			const p = gamesMessage(`Couldn't reach ${info.name} right now. Their site may be down or blocked. `);
			p.append(
				textButton("Try again", () => {
					state.failed = false;
					renderGames();
				}),
			);
		} else {
			gamesMessage(`Loading ${info.name} games…`);
			loadSource(info).then(() => {
				if (gamesView === info.id && !gamesMenu.classList.contains("hidden")) renderGames({ fresh: true });
			});
		}
		gamesNote.textContent = "";
		return;
	}
	showCoverGames(state.games, query, info.name);
}

// Redraws after a list finishes loading, keeping your place.
function refreshGames() {
	const scroll = gamesBody.scrollTop;
	const drawn = coverDrawn;
	renderGames();
	while (coverDrawn < drawn && coverDrawn < coverList.length) drawMoreCovers();
	gamesBody.scrollTop = scroll;
}

/* ---------- grids: more cards are drawn as you scroll near the end ---------- */

let coverList = []; // what the open list is showing, in order
let coverDrawn = 0; // how many of those have cards so far
let coverGrid = null;
const moreSentinel = document.createElement("div");
moreSentinel.className = "games-sentinel";
const moreObserver = new IntersectionObserver(
	(entries) => {
		if (entries.some((e) => e.isIntersecting)) drawMoreCovers();
	},
	{ root: gamesBody, rootMargin: "0px 0px 900px 0px" },
);

function drawMoreCovers() {
	const next = coverList.slice(coverDrawn, coverDrawn + SOURCE_PAGE);
	const cards = document.createDocumentFragment();
	// In All (and search results from Home), each card says where it's from; elsewhere, its kind.
	const showFrom = gamesView === "all" || gamesView === "home" || gamesView === "favorites";
	next.forEach((game, i) =>
		cards.append(gameCard(game, coverDrawn + i, { meta: showFrom ? game.from || game.tag || "" : game.tag || "" })),
	);
	moreSentinel.before(cards);
	coverDrawn += next.length;
	moreObserver.unobserve(moreSentinel);
	// Watching again checks right away, so a tall screen keeps filling until it's full.
	if (coverDrawn < coverList.length) moreObserver.observe(moreSentinel);
	else moreSentinel.remove();
}

// `name` is the list's (blank for All and for searching everything).
function showCoverGames(games, query, name) {
	coverList = searchGames(games, query);
	coverDrawn = 0;
	if (query) gamesSectionHead(`Results for “${query}”`, `${coverList.length.toLocaleString()} of ${games.length.toLocaleString()} games`);
	coverGrid = document.createElement("div");
	coverGrid.className = "games-grid";
	coverGrid.append(moreSentinel);
	gamesBody.append(coverGrid);
	if (coverList.length) drawMoreCovers();
	else if (query) noMatches(query);
	else gamesMessage("Loading games…");

	if (query) {
		gamesNote.textContent = "Enter opens the first one.";
	} else if (name) {
		gamesNote.textContent = `${games.length.toLocaleString()} games in ${name}.`;
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
	gamesBody.scrollTop = 0;
	gamesFilter.focus();
}

function setGamesMenu(open) {
	if (open === !gamesMenu.classList.contains("hidden")) return;
	gamesMenu.classList.toggle("hidden", !open);
	gamesBtn.setAttribute("aria-expanded", String(open));
	gamesBtn.classList.toggle("on", open);
	if (!open) {
		// Let go of the cards (and their pictures) while the page is closed.
		gamesBody.textContent = "";
		coverList = [];
		coverDrawn = 0;
		window.__slowStarfield?.();
	}
	if (open) {
		gamesFilter.value = "";
		pickFeatured();
		renderGames({ fresh: true });
		gamesBody.scrollTop = 0;
		gamesFilter.focus();
	}
}

gamesBtn.addEventListener("click", (event) => {
	event.stopPropagation();
	setGamesMenu(gamesMenu.classList.contains("hidden"));
});

document.getElementById("games-close").addEventListener("click", () => setGamesMenu(false));

/* ============================================================
   APPS: movies, music, cloud games and games open inside Slow
   They fill Slow's window with their own slim bar instead of being a website in a tab.
   Music keeps playing when you close it (open it again to get back to it); the others stop.
   ============================================================ */

const iconOf = (buttonId) => () => document.querySelector(`#${buttonId} svg`).cloneNode(true);

const APPS = {
	// (Aether's own /noads page turns its ads off, saves that, and goes on to its home page.)
	movies: { name: "Movies", sub: "Aether", url: "https://aether.st/noads", icon: iconOf("btn-movies"), button: "btn-movies" },
	music: { name: "Music", sub: "Spotify", url: "https://open.spotify.com/", icon: iconOf("btn-music"), button: "btn-music", keep: true },
	cloud: {
		name: "Cloud games",
		sub: "Niche",
		url: "https://churchofmoses.b-cdn.net/launcher.html",
		icon: iconOf("btn-cloud"),
		button: "btn-cloud",
	},
};

const appView = document.getElementById("app-view");
const appBody = document.getElementById("app-body");
const appVeil = document.getElementById("app-veil");
const appVeilText = document.getElementById("app-veil-text");
const runningApps = new Map(); // id -> { app, frame, loaded }
let shownApp = null;

async function openApp(id, app = APPS[id]) {
	setGamesMenu(false);
	if (palette.open) palette.close();
	let run = runningApps.get(id);
	// A different game in the game slot: the old one stops.
	if (run && run.app.url !== app.url) {
		stopApp(id);
		run = null;
	}

	document.getElementById("app-title").textContent = app.name;
	document.getElementById("app-sub").textContent = app.sub || "";
	document.getElementById("app-icon").replaceChildren(app.icon());
	document.getElementById("app-back").title = "Back";
	appView.classList.remove("hidden");
	shownApp = id;
	for (const [key, other] of runningApps) other.frame.frame.hidden = key !== id;
	raiseTrail();

	if (!run) {
		appVeilText.textContent = `Opening ${app.name}…`;
		appVeil.hidden = false;
		try {
			await ensureReady();
		} catch (err) {
			appView.classList.add("hidden");
			showError("Slow could not start the proxy.", err.toString());
			return;
		}
		const frame = scramjet.createFrame();
		frame.frame.className = "app-frame";
		frame.frame.setAttribute("allow", "autoplay; fullscreen; gamepad; encrypted-media; picture-in-picture; clipboard-write");
		run = { app, frame, loaded: false };
		trailStart(trailOf(run), app.url);
		runningApps.set(id, run);
		appBody.append(frame.frame);
		frame.frame.addEventListener("load", () => {
			run.loaded = true;
			if (shownApp === id) appVeil.hidden = true;
		});
		frame.go(app.url);
	} else {
		appVeil.hidden = run.loaded;
	}
	showRunningApps();
}

function stopApp(id) {
	const run = runningApps.get(id);
	if (!run) return;
	run.frame.frame.remove();
	runningApps.delete(id);
	showRunningApps();
}

function closeApp({ toGames = false } = {}) {
	if (!shownApp) return;
	const id = shownApp;
	const run = runningApps.get(id);
	shownApp = null;
	appView.classList.add("hidden");
	if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
	if (run?.app.keep) {
		run.frame.frame.hidden = true;
		notify({
			icon: run.app.icon(),
			key: `app:${id}`,
			title: `${run.app.name} keeps playing`,
			message: "Open it again from the new tab page to get back to it.",
			actions: [{ label: "Stop it", run: () => stopApp(id) }],
		});
	} else {
		stopApp(id);
	}
	showRunningApps();
	if (toGames) setGamesMenu(true);
}

// A dot on the new tab page's button while an app keeps running in the background (music).
function showRunningApps() {
	for (const [id, app] of Object.entries(APPS)) {
		document.getElementById(app.button).classList.toggle("running", runningApps.has(id) && shownApp !== id);
	}
}

for (const [id, app] of Object.entries(APPS)) {
	document.getElementById(app.button).addEventListener("click", () => openApp(id));
}

document.getElementById("app-close").addEventListener("click", () => closeApp());
document.getElementById("app-back").addEventListener("click", () => appStep(shownApp, -1));

// Back (or forward) in an app's own pages; back from its first page of a game returns to the games.
function appStep(id, step) {
	const run = runningApps.get(id);
	if (!run) return;
	const url = trailStep(trailOf(run), step);
	if (url) {
		appVeil.hidden = false;
		run.loaded = false;
		run.frame.go(url);
	} else if (step < 0 && run.app.backToGames) {
		closeApp({ toGames: true });
	}
}

// Apps' pages change as you use them; their history follows.
setInterval(() => {
	for (const run of runningApps.values()) {
		try {
			const url = run.frame.url.href;
			if (/^https?:\/\//.test(url)) trailSaw(trailOf(run), url);
		} catch {}
	}
}, 500);

// The mouse's back and forward buttons, pressed inside a website (browsing.js passes them on):
// back or forward in whichever tab or app that website is in.
window.__slowStep = (frameWindow, step) => {
	const tab = tabs.find((t) => t.frame?.frame.contentWindow === frameWindow);
	if (tab) {
		if (tab.id !== activeId) activate(tab.id);
		frameAction(step < 0 ? "back" : "forward");
		return true;
	}
	for (const [id, run] of runningApps) {
		if (run.frame.frame.contentWindow === frameWindow) {
			appStep(id, step);
			return true;
		}
	}
	return false;
};

// The mouse's back and forward buttons on Slow's own bar: the open tab's (or app's) history,
// not the browser's single history for every tab.
for (const type of ["mousedown", "mouseup"]) {
	document.addEventListener(
		type,
		(event) => {
			if (event.button !== 3 && event.button !== 4) return;
			event.preventDefault();
			if (type !== "mouseup") return;
			const step = event.button === 3 ? -1 : 1;
			if (shownApp) appStep(shownApp, step);
			else frameAction(step < 0 ? "back" : "forward");
		},
		true,
	);
}
document.getElementById("app-reload").addEventListener("click", () => {
	const run = runningApps.get(shownApp);
	if (!run) return;
	appVeil.hidden = false;
	run.loaded = false;
	run.frame.reload();
});
document.getElementById("app-full").addEventListener("click", () => {
	if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
	else appBody.requestFullscreen().catch(() => {});
});
// Out of the app view and into an ordinary tab, on the page it's showing now.
document.getElementById("app-tab").addEventListener("click", () => {
	const id = shownApp;
	const run = runningApps.get(id);
	if (!run) return;
	let url = run.app.url;
	try {
		url = run.frame.url.href;
	} catch {}
	shownApp = null;
	appView.classList.add("hidden");
	stopApp(id);
	const tab = newTab();
	if (tab) navigate(tab, url, { here: true });
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && shownApp && !appView.classList.contains("hidden") && !document.fullscreenElement) closeApp();
});

gamesFilter.addEventListener("input", () => {
	renderGames();
	gamesBody.scrollTop = 0;
});

function clearGamesSearch() {
	gamesFilter.value = "";
	renderGames();
	gamesBody.scrollTop = 0;
	gamesFilter.focus();
}

gamesClear.addEventListener("click", clearGamesSearch);

// Enter opens the first game that matches.
gamesFilter.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		gamesBody.querySelector(".game-open")?.click();
	}
});

// The dice: a random game from whatever is showing (search results, the open list, or everything).
document.getElementById("games-random").addEventListener("click", () => {
	const pool = coverList.length ? coverList : gamesView === "favorites" && favoriteGames.length ? favoriteGames : allGames();
	if (pool.length) openGame(pool[Math.floor(Math.random() * pool.length)]);
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
   CHAT
   The chat (chat/) opens full screen, like the other apps, or (Settings > Chat) in a panel
   on the right beside the page you're on. Once you've signed in, Slow connects it in the
   background when it opens, so messages and calls reach you while it's closed.
   ============================================================ */

const chatBtn = document.getElementById("btn-chat");
const chatBadge = chatBtn.querySelector(".chat-badge");
const chatDock = document.getElementById("chat-dock");
const chatGrip = document.getElementById("chat-grip");
const chatCall = document.getElementById("chat-call");
const CHAT_WIDTH_KEY = "slow.chatWidth";
let chatCallState = null;

const chatDocked = () => settings.chatMode === "dock";
let chatFrame = null;
let chatWide = false; // bigger for a while, during a call


function savedChatWidth() {
	try {
		const width = Number(localStorage.getItem(CHAT_WIDTH_KEY));
		if (width >= 300) return width;
	} catch {}
	return 380;
}

// The page beside the chat keeps at least 360px.
const chatMaxWidth = () => Math.max(320, Math.min(980, window.innerWidth - 360));

function applyChatWidth(width = savedChatWidth()) {
	const wanted = chatWide ? Math.max(width, 760) : width;
	document.documentElement.style.setProperty("--chat-w", `${Math.round(Math.min(chatMaxWidth(), Math.max(320, wanted)))}px`);
}
applyChatWidth();
window.addEventListener("resize", () => applyChatWidth());

function loadChat() {
	if (chatFrame) return chatFrame;
	chatFrame = document.createElement("iframe");
	chatFrame.className = "chat-frame";
	chatFrame.title = "Chat";
	// (calls need the microphone and camera)
	chatFrame.setAttribute("allow", "microphone; camera; autoplay; clipboard-write; display-capture");
	chatFrame.src = new URL("chat/index.html", location.href).href;
	chatDock.append(chatFrame);
	return chatFrame;
}

// Runs once the chat's page is ready (straight away if it already is).
function withChat(run) {
	const api = chatFrame?.contentWindow?.__chat;
	if (api) run(api);
	else chatFrame?.addEventListener("load", () => chatFrame.contentWindow?.__chat && run(chatFrame.contentWindow.__chat), { once: true });
}

// Full screen, or a panel beside the page (which moves over to make room).
function applyChatMode() {
	const docked = chatDocked();
	chatDock.classList.toggle("full", !docked);
	document.body.classList.toggle("chat-docked", docked && !chatDock.hidden);
	if (!docked) chatWide = false;
	applyChatWidth();
	withChat((api) => api.modeChanged?.());
}

function setChatMode(mode) {
	settings.chatMode = mode === "dock" ? "dock" : "full";
	saveSettings();
	applyChatMode();
}

// (unread: opened with the chat button or Alt+C, so it goes straight to whatever's new)
function openChat(convId, { unread = false } = {}) {
	loadChat();
	if (chatDock.hidden) {
		chatDock.hidden = false;
		applyChatMode();
		chatBtn.setAttribute("aria-expanded", "true");
		setGamesMenu(false);
		if (palette.open) palette.close();
		playEnter(chatDock);
	}
	showChatCall();
	dismissNotices("chat:");
	withChat((api) => {
		if (convId) api.openConv(convId);
		else if (unread) api.openUnread?.();
	});
	chatFrame.focus();
	// (once it's on screen: until then nothing in it can take the keyboard, so you can type straight away)
	requestAnimationFrame(() => withChat((api) => api.shown()));
}

// Your chats, for Ctrl+K (none until you've signed in to the chat).
function chatList() {
	try {
		const api = chatFrame?.contentWindow?.__chat;
		return api?.signedIn?.() ? api.chats?.() || [] : [];
	} catch {
		return [];
	}
}

// Sharing a page: the chat opens, you pick who it's for, and its link is ready to send there.
function shareInChat(tab) {
	const url = tab?.url;
	if (!url) return;
	// (a page that didn't load has Slow's "Couldn't load" title, which isn't the page's)
	const title = /^Couldn't load /.test(tab.title || "") ? "" : tab.title;
	openChat();
	withChat((api) => {
		if (!api.share?.({ url, title })) notify({ tone: "chat", message: "Sign in to the chat, then share the page again." });
	});
}

// Closing or reloading Slow in the middle of a call would hang up, so the browser asks first.
window.addEventListener("beforeunload", (event) => {
	if (!chatCallState) return;
	event.preventDefault();
	event.returnValue = "";
});

function closeChat() {
	if (chatDock.hidden) return;
	const hadFocus = chatDock.contains(document.activeElement) || document.activeElement === chatFrame;
	chatDock.hidden = true;
	document.body.classList.remove("chat-docked");
	chatBtn.setAttribute("aria-expanded", "false");
	chatWide = false;
	applyChatWidth();
	showChatCall();
	if (hadFocus) {
		if (!home.classList.contains("hidden")) chatBtn.focus();
		else activeTab()?.frame?.frame.focus();
	}
}

// On a call with the chat closed: a button to get back to it.
function showChatCall() {
	chatCall.hidden = !chatCallState || !chatDock.hidden;
	document.getElementById("chat-call-text").textContent = chatCallState?.text || "";
}
chatCall.addEventListener("click", () => openChat());
settingsForm.addEventListener("change", (event) => {
	if (event.target.name === "chatMode") applyChatMode();
});
applyChatMode();

function toggleChat() {
	if (chatDock.hidden) openChat(null, { unread: true });
	else closeChat();
}

chatBtn.addEventListener("click", toggleChat);

// What the chat asks of Slow (chat/chat.js).
window.__slowChat = {
	openTab: (url) => openLinkInTab(url),
	notify: (options) => notify(options),
	open: openChat,
	close: closeChat,
	toggle: toggleChat,
	visible: () => !chatDock.hidden && !document.hidden,
	isDev: () => Boolean(devToken),
	sound: (notes) => sfx.melody(notes),
	mode: () => (chatDocked() ? "dock" : "full"),
	setMode: setChatMode,
	setWide(on) {
		chatWide = Boolean(on) && chatDocked();
		applyChatWidth();
	},
	// The number on the chat button (and in the window's title): chats with new messages for you.
	setBadge(count) {
		chatUnread = Math.max(0, Number(count) || 0);
		chatBadge.hidden = !chatUnread;
		chatBadge.textContent = chatUnread > 9 ? "9+" : String(chatUnread);
		chatBtn.setAttribute("aria-label", chatUnread ? `Chat, ${chatUnread} new` : "Chat");
		updateView();
	},
	setCall(state) {
		chatCallState = state?.text ? { text: String(state.text) } : null;
		chatBtn.classList.toggle("in-call", Boolean(chatCallState));
		showChatCall();
	},
	// Someone's calling: the chat opens so you can answer.
	incomingCall(from) {
		chatBtn.classList.toggle("ringing", Boolean(from));
		if (from && chatDock.hidden) openChat();
	},
	// Pictures from other websites, through the proxy (Slow's page can't show them directly).
	async fetchImage(url) {
		await ensureReady();
		const res = await proxyFetch(url);
		if (!res.ok) throw new Error(`The picture's website said ${res.status}`);
		return res.blob();
	},
};

/* ---------- making the chat wider or narrower ---------- */

function setChatWidth(width) {
	chatWide = false;
	const clamped = Math.round(Math.min(chatMaxWidth(), Math.max(320, width)));
	try {
		localStorage.setItem(CHAT_WIDTH_KEY, String(clamped));
	} catch {}
	applyChatWidth(clamped);
}

chatGrip.addEventListener("pointerdown", (event) => {
	if (event.button !== 0) return;
	event.preventDefault();
	chatGrip.setPointerCapture(event.pointerId);
	document.body.classList.add("chat-resizing");
	const move = (e) => setChatWidth(window.innerWidth - e.clientX);
	const done = () => {
		chatGrip.removeEventListener("pointermove", move);
		document.body.classList.remove("chat-resizing");
	};
	chatGrip.addEventListener("pointermove", move);
	chatGrip.addEventListener("pointerup", done, { once: true });
	chatGrip.addEventListener("pointercancel", done, { once: true });
});

chatGrip.addEventListener("keydown", (event) => {
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const now = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--chat-w"), 10) || savedChatWidth();
	setChatWidth(now + (event.key === "ArrowLeft" ? 24 : -24));
});

// Signed in before: connect in the background (a moment after Slow starts, so it doesn't slow that down).
try {
	if (localStorage.getItem("slow.chat.on") === "1") {
		setTimeout(() => (window.requestIdleCallback || ((fn) => fn()))(loadChat, { timeout: 3000 }), 1500);
	}
} catch {}

/* ============================================================
   EXTRA ANIMATIONS
   All of these skip themselves when "Reduce motion" is on.
   ============================================================ */

/* ---------- liquid glass (liquid.js) ---------- */

// The open tab is a drop of glass that flows to whichever tab you open, stretching on the way.
const tabGlider = document.createElement("div");
tabGlider.className = "tab-glider liquid-glass";
tabGlider.setAttribute("aria-hidden", "true");
tabStrip.prepend(tabGlider);
const tabLens = Liquid.lens(tabStrip, { element: tabGlider, track: "x" });

function placeTabGlider() {
	const el = activeTab()?.el;
	tabLens.to(el?.isConnected ? el : null);
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

// The toolbar's buttons and the new tab page's apps: a drop of glass follows your pointer between them.
Liquid.lens(document.querySelector(".toolbar"), { hover: ".toolbar > .icon-btn", className: "small" });
Liquid.lens(document.querySelector(".home-apps"), { hover: ".home-app", className: "small" });

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
	notify({ tone: "success", icon: "server", title: "Using your own server", message: "Websites now load through your computer. You can change this in Settings > Connection." });
})();

// Connect to the proxy now, so the first site you open (and restored tabs' icons) don't wait for it.
ensureReady().catch(() => {});
