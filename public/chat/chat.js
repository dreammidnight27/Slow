/*
 * Slow's chat: the Moonplayer chatroom, rebuilt to live in a panel on the side of Slow.
 *
 * It uses the same Firebase database as the Moonplayer chatroom, in the same shape, so people
 * on either one talk to each other. A few things are new (kept beside the old data, never
 * instead of it): an index of who you've messaged (userDms), when people were last online
 * (seen), message ids for replies, and the account id on each message.
 *
 * Slow's page gives the chat a few helpers (window.__slowChat in index.js): opening links in
 * Slow tabs, notifications and the unread count on Slow's chat button, Slow's sounds, and
 * loading pictures through Slow's proxy. Opened on its own, the chat works without them.
 */
"use strict";

(() => {
	const $ = (id) => document.getElementById(id);

	/* ============================================================
	   SLOW, AROUND THE CHAT
	   ============================================================ */

	const slow = (() => {
		try {
			if (window.parent !== window && window.parent.__slowChat) return window.parent.__slowChat;
		} catch {}
		return null;
	})();
	document.documentElement.classList.toggle("in-slow", Boolean(slow));

	// Slow's theme colors, kept in step with whatever theme Slow is using.
	const THEME_VARS = ["--void", "--nebula", "--aurora", "--ember", "--starlight", "--bg-1", "--bg-2", "--nebula-1", "--nebula-2"];
	function copyTheme() {
		if (!slow) return;
		try {
			const root = window.parent.document.documentElement;
			const style = window.parent.getComputedStyle(root);
			for (const name of THEME_VARS) {
				const value = style.getPropertyValue(name).trim();
				if (value) document.documentElement.style.setProperty(name, value);
			}
			document.documentElement.dataset.motion = root.dataset.motion || "full";
		} catch {}
	}
	copyTheme();
	if (slow) {
		try {
			new MutationObserver(copyTheme).observe(window.parent.document.documentElement, {
				attributes: true,
				attributeFilter: ["data-theme", "style", "data-motion"],
			});
		} catch {}
	}

	const store = {
		get(key, fallback) {
			try {
				const value = localStorage.getItem(key);
				return value == null ? fallback : JSON.parse(value);
			} catch {
				return fallback;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		},
	};

	const prefs = { sounds: true, notify: true, ...store.get("slow.chat.prefs", {}) };
	const savePrefs = () => store.set("slow.chat.prefs", prefs);

	// Slow connects the chat in the background when it opens, so messages reach you while it's closed.
	function rememberSignedIn(on) {
		try {
			if (on) localStorage.setItem("slow.chat.on", "1");
			else localStorage.removeItem("slow.chat.on");
		} catch {}
	}

	/* ============================================================
	   LITTLE HELPERS
	   ============================================================ */

	// h("button", { class: "x", text: "Hi", onclick }, ...children). Text always goes in as text.
	function h(tag, props = {}, ...children) {
		const el = document.createElement(tag);
		for (const [key, value] of Object.entries(props)) {
			if (value == null || value === false) continue;
			if (key === "class") el.className = value;
			else if (key === "text") el.textContent = value;
			else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
			else el.setAttribute(key, value === true ? "" : String(value));
		}
		for (const child of children) if (child != null && child !== false) el.append(child);
		return el;
	}

	// Icons are fixed markup written here, never anything from the chat.
	const ICONS = {
		globe: '<circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="3.8" ry="8.5" /><path d="M3.5 12h17" />',
		people: '<circle cx="9" cy="9" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="16.5" cy="9.5" r="2.6" /><path d="M15.5 14.2a4.6 4.6 0 0 1 5 4.8" />',
		user: '<circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5a7 7 0 0 1 14 0" />',
		trophy: '<path d="M8 4.5h8v4a4 4 0 0 1-8 0Z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12.5V16M8.5 19.5h7M9.5 19.5 10 16h4l.5 3.5" />',
		bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" />',
		sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />',
		out: '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" /><path d="M10 8l-4 4 4 4M6 12h9" />',
		plus: '<path d="M12 5v14M5 12h14" />',
		leave: '<path d="M9 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H9" /><path d="M15 8l4 4-4 4M19 12h-9" />',
		phone: '<path d="M6.6 3.5h2.6l1.4 4.2-2 1.5a11 11 0 0 0 6.2 6.2l1.5-2 4.2 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />',
		video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="m15.5 10.5 5.5-3v9l-5.5-3" />',
		check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
		panel: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M14.5 5v14" />',
		expand: '<path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />',
		camera: '<path d="M4.5 8.5h3L9 6h6l1.5 2.5h3A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-8a1.5 1.5 0 0 1 1.5-1.5Z" /><circle cx="12" cy="13.5" r="3.3" />',
		upload: '<path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" /><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />',
		smile: '<circle cx="12" cy="12" r="8.5" /><path d="M8.5 14a4 4 0 0 0 7 0" /><circle class="fill" cx="9" cy="10" r="1.1" /><circle class="fill" cx="15" cy="10" r="1.1" />',
		none: '<circle cx="12" cy="12" r="8" /><path d="M6.5 17.5l11-11" />',
	};
	function icon(name) {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("class", "ico");
		svg.setAttribute("aria-hidden", "true");
		svg.innerHTML = ICONS[name] || "";
		return svg;
	}

	const keyOf = (name) => String(name ?? "").toLowerCase();
	// A name usable as a database key (the Moonplayer chatroom's rule).
	const usableKey = (key) => Boolean(key) && key.length <= 40 && !/[.#$[\]/]/.test(key);
	// Anything usable as one part of a database path.
	const validSegment = (text) => Boolean(text) && text.length < 700 && !/[.#$[\]/\u0000-\u001f\u007f]/.test(text);

	// Push ids start with the time they were made, so they sort in time order.
	const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
	function pushTime(key) {
		let time = 0;
		for (let i = 0; i < 8; i++) {
			const value = PUSH_CHARS.indexOf(key?.[i]);
			if (value < 0) return 0;
			time = time * 64 + value;
		}
		return time;
	}

	const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
	const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
	const longDateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
	const dayKey = (time) => new Date(time).toDateString();

	function dayLabel(time) {
		const today = new Date();
		const yesterday = new Date(Date.now() - 86_400_000);
		if (dayKey(time) === today.toDateString()) return "Today";
		if (dayKey(time) === yesterday.toDateString()) return "Yesterday";
		return longDateFormat.format(time);
	}

	function shortAgo(time) {
		if (!time) return "";
		const minutes = Math.round((serverNow() - time) / 60_000);
		if (minutes < 1) return "now";
		if (minutes < 60) return `${minutes}m`;
		if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
		if (minutes < 7 * 24 * 60) return `${Math.round(minutes / 1440)}d`;
		return dateFormat.format(time);
	}

	function longAgo(time) {
		const minutes = Math.round((serverNow() - time) / 60_000);
		if (minutes < 2) return "Active just now";
		if (minutes < 60) return `Active ${minutes} minutes ago`;
		if (minutes < 24 * 60) return `Active ${Math.round(minutes / 60)} hours ago`;
		return `Active ${dateFormat.format(time)}`;
	}

	let clockOffset = 0;
	const serverNow = () => Date.now() + clockOffset;

	/* ============================================================
	   FIREBASE
	   ============================================================ */

	const boot = $("boot");
	function bootFail(text) {
		boot.classList.add("failed");
		$("boot-text").textContent = text;
	}

	if (typeof firebase === "undefined") {
		bootFail("Chat couldn't load. This network might be blocking Google's servers (gstatic.com).");
		return;
	}

	// (No authDomain: it's only for signing in with Google and the like, and makes Firebase load a
	// helper page that Slow's cross-origin isolation blocks. Email sign-in doesn't need it.)
	const FIREBASE = {
		apiKey: "AIzaSyAiiivtyumr_IVUdG4Ju_PUIBK_FPmJNdM",
		databaseURL: "https://moonplayer-chats-default-rtdb.europe-west1.firebasedatabase.app/",
		projectId: "moonplayer-chats",
		storageBucket: "moonplayer-chats.firebasestorage.app",
		messagingSenderId: "283838071665",
		appId: "1:283838071665:web:77c1645c79c4326f102cd0",
	};

	// For developing the chat: on this computer, with "slow.chat.emulator" set, it talks to
	// Firebase's local emulators instead of the real chat.
	const EMULATOR =
		["localhost", "127.0.0.1"].includes(location.hostname) &&
		(() => {
			try {
				return localStorage.getItem("slow.chat.emulator") === "1";
			} catch {
				return false;
			}
		})();

	firebase.initializeApp(
		EMULATOR
			? { apiKey: "demo-key", projectId: "demo-slow-chat", databaseURL: "http://127.0.0.1:9000/?ns=demo-slow-chat" }
			: FIREBASE,
	);
	const auth = firebase.auth();
	// Always the WebSocket connection. After one fails (a network blip), Firebase remembers it and
	// tries its fallback (long polling) first from then on, which Slow's cross-origin isolation
	// blocks, so the chat would never connect again. So it isn't allowed to remember.
	try {
		const FAILED = "firebase:previous_websocket_failure";
		localStorage.removeItem(FAILED);
		const setItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (key === FAILED) return;
			return setItem.call(this, key, value);
		};
	} catch {}
	const db = firebase.database();
	if (EMULATOR) {
		auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
		db.useEmulator("127.0.0.1", 9000);
	}
	const TIMESTAMP = firebase.database.ServerValue.TIMESTAMP;

	const params = new URLSearchParams(location.search);
	const ROOM = (params.get("room") || "lounge").replace(/[.#$[\]/]/g, "") || "lounge";
	const R = (path) => db.ref(`chatrooms/${ROOM}${path ? `/${path}` : ""}`);

	db.ref(".info/serverTimeOffset").on("value", (snap) => (clockOffset = snap.val() || 0));

	// listen(ref, "value", fn, bag) — starts listening and puts the "stop" in the bag.
	function listen(target, event, callback, bag) {
		const fn = target.on(event, callback, (err) => console.warn("Chat:", err?.message || err));
		const off = () => target.off(event, fn);
		bag?.push(off);
		return off;
	}
	function stopAll(bag) {
		while (bag.length) {
			try {
				bag.pop()();
			} catch {}
		}
	}

	/* ============================================================
	   CONSTANTS
	   ============================================================ */

	// The owner's name from the Moonplayer chatroom. Only someone signed in to that account can give
	// out titles and delete other people's messages (dev mode only lets you sign up with the name).
	const OWNER_NAME = "Dreamid";
	const RESERVED = new Set(["dreamid", "slow", "admin", "owner", "moderator", "system", "everyone"]);
	const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
	const PAGE = 50;
	const MAX_TEXT = 500;
	const GROUP_GAP = 5 * 60_000;
	const AVATAR_COLORS = ["#8B5CF6", "#6366F1", "#3B82F6", "#0EA5E9", "#A855F7", "#D946EF", "#EC4899", "#7C3AED", "#14B8A6", "#F59E0B"];

	// What a profile can look like. Only these exact choices are used from anyone's profile.
	const PROFILE_COLORS = ["#b98cff", "#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#a3e635", "#facc15", "#f97316", "#ef4444", "#ec4899"];
	const BANNERS = [
		["color", "Your color"],
		["nebula", "Nebula"],
		["aurora", "Aurora"],
		["midnight", "Midnight"],
		["sunset", "Sunset"],
		["ocean", "Ocean"],
		["forest", "Forest"],
		["ember", "Ember"],
		["rose", "Rose"],
	];
	const FRAMES = [
		["none", "None"],
		["ring", "Ring"],
		["glow", "Glow"],
		["aurora", "Aurora"],
	];
	const STATUS_PICKS = [
		["🎮", "Gaming"],
		["📚", "Studying"],
		["🎬", "Watching something"],
		["🎧", "Listening to music"],
		["💤", "Away"],
		["🔕", "Busy"],
	];
	const STATUS_EMOJI = ["😀", "😎", "🥳", "😴", "🤔", "😭", "🥺", "🤩", "🔥", "✨", "🌙", "⭐", "💜", "👻", "🎃", "🚀", "🎮", "📚", "🎬", "🎧", "💻", "🎨", "☕", "🍕"];
	const MAX_BIO = 240;
	const MAX_STATUS = 60;
	const MAX_PRONOUNS = 24;

	const RANKS = [
		{ min: 1, name: "Rookie", color: "#9C8FC7" },
		{ min: 5, name: "Noob", color: "#6FA287" },
		{ min: 10, name: "Pro", color: "#5B9BD5" },
		{ min: 18, name: "Hacker", color: "#8B5CF6" },
		{ min: 28, name: "God", color: "#FFD166" },
		{ min: 42, name: "Ultra God", color: "#FF3D9A" },
	];

	/* ============================================================
	   STATE
	   ============================================================ */

	let me = null; // { uid, name, key }
	let joinedAt = 0;
	const session = []; // what to stop when signing out
	let signingUp = false;

	const profiles = new Map(); // person key -> profile (or null)
	const xpOf = new Map(); // person key -> { xp, messageCount, firstSeenAt, name }
	const seenAt = new Map(); // person key -> when they were last online
	const watched = new Set();
	let titles = {};
	let online = new Set(); // keys of people connected right now
	const onlineNames = new Map(); // key -> their name, as they wrote it
	let onlineCount = 0;
	let connected = true;

	const convs = new Map(); // conversation id -> conversation
	let current = null;
	let read = {}; // conversation id -> last read message key
	let drafts = {}; // conversation id -> what you'd started writing there
	const DRAFTS_KEY = () => `slow.chat.drafts.${ROOM}.${me.key}`;
	const READ_KEY = () => `slow.chat.read.${ROOM}.${me.key}`;

	/* ============================================================
	   SOUNDS (made on the spot, no files)
	   ============================================================ */

	const SOUNDS = {
		send: [
			{ freq: 900, start: 0, dur: 0.08, gain: 0.11 },
			{ freq: 1300, start: 0.05, dur: 0.09, gain: 0.08 },
		],
		receive: [
			{ freq: 740, start: 0, dur: 0.11, gain: 0.13 },
			{ freq: 1040, start: 0.09, dur: 0.16, gain: 0.13 },
		],
		connect: [
			{ freq: 660, start: 0, dur: 0.1, gain: 0.14 },
			{ freq: 880, start: 0.09, dur: 0.1, gain: 0.14 },
			{ freq: 1100, start: 0.18, dur: 0.2, gain: 0.16 },
		],
		end: [
			{ freq: 500, start: 0, dur: 0.14, gain: 0.13 },
			{ freq: 320, start: 0.12, dur: 0.22, gain: 0.11 },
		],
		levelUp: [
			{ freq: 523, start: 0, dur: 0.12, gain: 0.13 },
			{ freq: 659, start: 0.1, dur: 0.12, gain: 0.14 },
			{ freq: 784, start: 0.2, dur: 0.14, gain: 0.15 },
			{ freq: 1047, start: 0.32, dur: 0.28, gain: 0.17 },
		],
	};
	const RINGS = {
		incoming: { every: 2000, notes: [{ freq: 950, start: 0, dur: 0.35, gain: 0.16 }, { freq: 950, start: 0.45, dur: 0.35, gain: 0.16 }] },
		ringback: { every: 3200, notes: [{ freq: 480, start: 0, dur: 0.9, gain: 0.1 }, { freq: 620, start: 1, dur: 0.9, gain: 0.08 }] },
	};

	let ownAudio = null;
	function playNotes(notes, { always = false } = {}) {
		if (!prefs.sounds && !always) return;
		try {
			if (slow?.sound) return slow.sound(notes);
			ownAudio ||= new (window.AudioContext || window.webkitAudioContext)();
			if (ownAudio.state === "suspended") ownAudio.resume().catch(() => {});
			const now = ownAudio.currentTime;
			for (const note of notes) {
				const osc = ownAudio.createOscillator();
				const gain = ownAudio.createGain();
				const t0 = now + (note.start || 0);
				gain.gain.setValueAtTime(0.0001, t0);
				gain.gain.exponentialRampToValueAtTime(note.gain, t0 + Math.min(0.02, note.dur / 3));
				gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
				osc.frequency.value = note.freq;
				osc.connect(gain).connect(ownAudio.destination);
				osc.start(t0);
				osc.stop(t0 + note.dur + 0.02);
			}
		} catch {}
	}
	const playSound = (name) => playNotes(SOUNDS[name]);

	let ringTimer = 0;
	function ringLoop(kind) {
		stopRing();
		const ring = RINGS[kind];
		playNotes(ring.notes, { always: true });
		ringTimer = setInterval(() => playNotes(ring.notes, { always: true }), ring.every);
	}
	function stopRing() {
		clearInterval(ringTimer);
		ringTimer = 0;
	}

	/* ============================================================
	   PEOPLE: avatars, levels, titles
	   ============================================================ */

	function colorFor(name) {
		const s = keyOf(name);
		let hash = 0;
		for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 100000;
		return AVATAR_COLORS[hash % AVATAR_COLORS.length];
	}

	function initialsFor(name) {
		const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
		if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
		return (words[0] || "?").slice(0, 2).toUpperCase();
	}

	const displayName = (key) => profiles.get(key)?.name || onlineNames.get(key) || xpOf.get(key)?.name || key;

	/* ---------- how someone's profile looks ---------- */

	const BANNER_IDS = new Set(BANNERS.map(([id]) => id));
	const FRAME_IDS = new Set(FRAMES.map(([id]) => id));
	const hex6 = (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);
	// One line of plain writing (no invisible characters that flip or hide text).
	const plainText = (value, max) =>
		typeof value === "string"
			? value
					.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, max)
			: "";
	// One emoji (joined ones like 👩‍💻 count as one).
	const oneEmoji = (value) =>
		typeof value === "string" && value.length <= 16 && /^\p{Extended_Pictographic}/u.test(value) && !/[\s\u0000-\u001f]/.test(value) ? value : "";

	// Someone's profile, keeping only what's allowed in it.
	function lookFrom(profile) {
		const p = profile && typeof profile === "object" ? profile : {};
		const look = {
			pfp: typeof p.pfp === "string" ? p.pfp : null,
			color: hex6(p.color),
			banner: BANNER_IDS.has(p.banner) || p.banner === "picture" ? p.banner : "color",
			bannerAt: Number(p.bannerAt) || 0,
			frame: FRAME_IDS.has(p.frame) ? p.frame : "none",
			pronouns: plainText(p.pronouns, MAX_PRONOUNS),
			status: plainText(p.status, MAX_STATUS),
			statusEmoji: oneEmoji(p.statusEmoji),
			bio: typeof p.bio === "string" ? p.bio.slice(0, MAX_BIO) : "",
		};
		if (look.banner === "picture" && !look.bannerAt) look.banner = "color";
		return look;
	}
	const lookOf = (key) => lookFrom(profiles.get(key));
	// Their color: the one they picked, or the one that comes from their name.
	const tintOf = (name, look = lookOf(keyOf(name))) => look.color || colorFor(name);
	const moodOf = (look) => [look.statusEmoji, look.status].filter(Boolean).join(" ");

	// Starts keeping someone's profile, level and last-online time up to date, the first time they show up.
	function watchPerson(name) {
		const key = keyOf(name);
		if (!me || !usableKey(key) || watched.has(key)) return;
		watched.add(key);
		listen(R(`profiles/${key}`), "value", (snap) => {
			profiles.set(key, snap.val());
			repaintPerson(key);
		}, session);
		listen(R(`xp/${key}`), "value", (snap) => {
			xpOf.set(key, snap.val());
			repaintPerson(key);
		}, session);
		listen(R(`seen/${key}`), "value", (snap) => {
			seenAt.set(key, Number(snap.val()) || 0);
			if (current?.kind === "dm" && keyOf(current.peer) === key) renderRoomHead();
		}, session);
	}

	// Pictures from other websites load through Slow's proxy (pages here can't show them directly).
	const remotePics = new Map(); // url -> object URL, "loading" or "failed"

	async function fetchImage(url) {
		let blob;
		if (slow?.fetchImage) {
			const got = await slow.fetchImage(url);
			blob = new Blob([await got.arrayBuffer()], { type: got.type });
		} else {
			const res = await fetch(url, { mode: "cors" });
			if (!res.ok) throw new Error(`The picture's website said ${res.status}`);
			blob = await res.blob();
		}
		if (!blob.type.startsWith("image/")) throw new Error("That link isn't a picture.");
		return blob;
	}

	const PICTURE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

	function pictureFor(src) {
		if (typeof src !== "string") return null;
		if (PICTURE_DATA.test(src)) return src;
		if (!/^https?:\/\/\S+$/i.test(src)) return null;
		const known = remotePics.get(src);
		if (known === undefined) {
			remotePics.set(src, "loading");
			fetchImage(src)
				.then((blob) => remotePics.set(src, URL.createObjectURL(blob)))
				.catch(() => remotePics.set(src, "failed"))
				.finally(() => {
					for (const [key, profile] of profiles) if (profile?.pfp === src) repaintPerson(key);
				});
			return null;
		}
		return known === "loading" || known === "failed" ? null : known;
	}

	// (mood: their status emoji in a little bubble on the picture)
	function avatar(name, size, { dot = true, mood = false } = {}) {
		const el = h("span", { class: "avatar", "data-person": keyOf(name), "aria-hidden": "true" });
		el.dataset.name = String(name ?? "");
		if (!dot) el.dataset.nodot = "";
		if (mood) el.dataset.mood = "";
		el.style.setProperty("--size", `${size}px`);
		watchPerson(name);
		paintAvatar(el);
		return el;
	}

	// (look: how to draw it, when it isn't their saved profile, like the preview while editing yours)
	function paintAvatar(el, look = lookOf(el.dataset.person)) {
		const key = el.dataset.person;
		const name = el.dataset.name;
		const picture = pictureFor(look.pfp);
		el.replaceChildren();
		el.style.setProperty("--tint", tintOf(name, look));
		el.dataset.frame = look.frame;
		el.classList.toggle("has-pic", Boolean(picture));
		if (picture) {
			const img = h("img", { alt: "", decoding: "async", draggable: "false" });
			img.addEventListener("error", () => {
				el.classList.remove("has-pic");
				img.replaceWith(initialsFor(name));
			});
			img.src = picture;
			el.append(img);
		} else {
			el.append(initialsFor(name));
		}
		if (!("nodot" in el.dataset) && online.has(key)) el.append(h("span", { class: "dot" }));
		if ("mood" in el.dataset && look.statusEmoji) el.append(h("span", { class: "mood", text: look.statusEmoji }));
	}

	// A name written in the color they picked.
	function paintName(el) {
		const color = lookOf(el.dataset.person).color;
		el.classList.toggle("colored", Boolean(color));
		if (color) el.style.setProperty("--name", color);
		else el.style.removeProperty("--name");
	}

	// Banner pictures are kept apart from profiles (they're bigger), and only loaded when someone
	// opens that profile.
	const bannerPics = new Map(); // person key -> { at, src } (src: the picture, "loading" or "failed")
	function bannerPicture(key, at) {
		const known = bannerPics.get(key);
		if (known?.at === at) return known.src === "loading" || known.src === "failed" ? null : known.src;
		if (!usableKey(key)) return null;
		bannerPics.set(key, { at, src: "loading" });
		R(`banners/${key}`)
			.once("value")
			.then((snap) => {
				const pic = snap.val()?.pic;
				bannerPics.set(key, { at, src: typeof pic === "string" && PICTURE_DATA.test(pic) ? pic : "failed" });
			})
			.catch(() => bannerPics.set(key, { at, src: "failed" }))
			.finally(() => {
				if (viewing && keyOf(viewing) === key) renderProfile(viewing);
				if (draft && key === me?.key) renderPreview();
			});
		return null;
	}

	function paintBanner(el, look, tint, picture = null) {
		el.style.setProperty("--tint", tint);
		el.dataset.banner = look.banner === "picture" ? (picture ? "picture" : "color") : look.banner;
		// (the picture is checked to be a picture's data: nothing else can get into the style)
		if (picture && PICTURE_DATA.test(picture)) el.style.setProperty("--banner-pic", `url("${picture}")`);
		else el.style.removeProperty("--banner-pic");
	}

	function levelForXp(xp) {
		let level = 1;
		let left = Math.max(0, Number(xp) || 0);
		let need = 50;
		while (left >= need) {
			left -= need;
			level++;
			need = 50 + (level - 1) * 25;
		}
		return { level, into: left, need };
	}

	function rankFor(level) {
		let rank = RANKS[0];
		for (const r of RANKS) if (level >= r.min) rank = r;
		return rank;
	}

	const statsFor = (name) => xpOf.get(keyOf(name)) || { xp: 0, messageCount: 0, firstSeenAt: null };

	function levelBadge(name) {
		const { level } = levelForXp(statsFor(name).xp);
		const rank = rankFor(level);
		const el = h("span", { class: "lv", "data-level": keyOf(name), title: rank.name, text: `Lv ${level}` });
		el.style.setProperty("--rank", rank.color);
		return el;
	}

	const safeColor = (value) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value)) ? value : null);

	function titleTag(name) {
		if (name === OWNER_NAME) return h("span", { class: "tag owner", text: "Owner" });
		const title = titles[keyOf(name)] || titles[name];
		if (!title?.text) return null;
		const el = h("span", { class: "tag", "data-title": keyOf(name), text: String(title.text).slice(0, 30) });
		const color = safeColor(title.color);
		if (color) el.style.setProperty("--tag", color);
		return el;
	}

	// Redraws everything showing this person, at most once per frame.
	const repaintQueue = new Set();
	let repaintFrame = 0;
	function repaintPerson(key) {
		repaintQueue.add(key);
		repaintFrame ||= requestAnimationFrame(() => {
			repaintFrame = 0;
			const keys = [...repaintQueue];
			repaintQueue.clear();
			for (const key of keys) {
				for (const el of document.querySelectorAll(`.avatar[data-person="${CSS.escape(key)}"]`)) paintAvatar(el);
				for (const el of document.querySelectorAll(`.msg-name[data-person="${CSS.escape(key)}"]`)) paintName(el);
				for (const el of document.querySelectorAll(`.lv[data-level="${CSS.escape(key)}"]`)) el.replaceWith(levelBadge(displayName(key)));
			}
			if (me && keys.includes(me.key)) {
				renderMe();
				if (draft) renderPreview();
			}
			if (viewing && keys.includes(keyOf(viewing))) renderProfile(viewing);
			if (keys.some((key) => online.has(key))) renderOnline();
			if (current?.kind === "dm" && keys.includes(keyOf(current.peer))) renderRoomHead();
		});
	}

	function repaintTitles() {
		for (const li of $("msgs").querySelectorAll(".msg[data-author]")) {
			const meta = li.querySelector(".meta");
			if (!meta) continue;
			meta.querySelector(".tag")?.remove();
			const tag = titleTag(li.dataset.name);
			if (tag) meta.querySelector(".lv")?.after(tag);
		}
		if (viewing) renderProfile(viewing);
	}

	/* ============================================================
	   SIGNING IN
	   ============================================================ */

	const authEl = $("auth");
	const shell = $("shell");
	const authForm = $("auth-form");
	const authError = $("auth-error");
	const authSubmit = $("auth-submit");
	let signUpMode = false;

	// (a drop of glass slides to the chosen one)
	const authLens = window.Liquid?.lens(document.querySelector(".auth-tabs"));

	function setAuthMode(signUp) {
		signUpMode = signUp;
		$("tab-login").setAttribute("aria-selected", String(!signUp));
		$("tab-signup").setAttribute("aria-selected", String(signUp));
		authLens?.to(signUp ? $("tab-signup") : $("tab-login"));
		$("name-field").hidden = !signUp;
		$("auth-forgot").hidden = signUp;
		authSubmit.textContent = signUp ? "Create account" : "Log in";
		$("auth-password").autocomplete = signUp ? "new-password" : "current-password";
		authError.hidden = true;
		(signUp ? $("auth-name") : $("auth-email")).focus();
	}
	$("tab-login").addEventListener("click", () => setAuthMode(false));
	$("tab-signup").addEventListener("click", () => setAuthMode(true));

	$("auth-peek").addEventListener("click", () => {
		const input = $("auth-password");
		const show = input.type === "password";
		input.type = show ? "text" : "password";
		$("auth-peek").setAttribute("aria-pressed", String(show));
		$("auth-peek").setAttribute("aria-label", show ? "Hide password" : "Show password");
	});

	function showAuthError(text) {
		authError.textContent = text;
		authError.hidden = false;
	}

	const AUTH_ERRORS = {
		"auth/invalid-email": "That email address doesn't look right.",
		"auth/missing-email": "Type your email address first.",
		"auth/invalid-credential": "That email and password don't match an account.",
		"auth/wrong-password": "That email and password don't match an account.",
		"auth/user-not-found": "That email and password don't match an account.",
		"auth/email-already-in-use": "There's already an account with that email. Log in instead.",
		"auth/weak-password": "Pick a longer password (at least 6 characters).",
		"auth/missing-password": "Type your password.",
		"auth/too-many-requests": "Too many tries. Wait a few minutes, then try again.",
		"auth/network-request-failed": "Couldn't reach the chat's server. Check your connection.",
		"auth/user-disabled": "That account has been turned off.",
		"auth/operation-not-allowed": "Signing in with email isn't turned on for this chat.",
	};
	const explainAuth = (err) => AUTH_ERRORS[err?.code] || err?.message || "Something went wrong. Try again.";

	function nameProblem(name) {
		if (name.length < 2) return "Pick a username with at least 2 characters.";
		if (name.length > 24) return "Usernames can be up to 24 characters.";
		if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}-]| (?! ))*$/u.test(name) || name.endsWith(" "))
			return "Usernames can have letters, numbers, single spaces and dashes.";
		if (RESERVED.has(keyOf(name)) && !(keyOf(name) === keyOf(OWNER_NAME) && slow?.isDev?.()))
			return "That username is taken.";
		return "";
	}

	async function usernames() {
		const snap = await R("usernames").once("value");
		return snap.val() || {};
	}

	authForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		authError.hidden = true;
		const email = $("auth-email").value.trim();
		const password = $("auth-password").value;
		const name = $("auth-name").value.trim().replace(/\s+/g, " ");
		authSubmit.disabled = true;
		try {
			if (signUpMode) {
				const problem = nameProblem(name);
				if (problem) throw new Error(problem);
				const taken = Object.keys(await usernames()).some((n) => keyOf(n) === keyOf(name));
				if (taken) throw new Error("That username is taken. Pick another one.");
				signingUp = true;
				const cred = await auth.createUserWithEmailAndPassword(email, password);
				await cred.user.updateProfile({ displayName: name });
				await R(`usernames/${name}`).set(cred.user.uid);
				signingUp = false;
				startSession(cred.user);
			} else {
				await auth.signInWithEmailAndPassword(email, password);
			}
		} catch (err) {
			signingUp = false;
			showAuthError(err.code ? explainAuth(err) : err.message);
		} finally {
			authSubmit.disabled = false;
		}
	});

	$("auth-forgot").addEventListener("click", async () => {
		const email = $("auth-email").value.trim();
		if (!email) {
			showAuthError("Type your email address, then press this again.");
			$("auth-email").focus();
			return;
		}
		try {
			await auth.sendPasswordResetEmail(email);
			showAuthError(`If there's an account for ${email}, an email to reset its password is on its way.`);
		} catch (err) {
			showAuthError(explainAuth(err));
		}
	});

	function showAuth() {
		boot.hidden = true;
		shell.hidden = true;
		authEl.hidden = false;
		$("auth-password").value = "";
		setAuthMode(signUpMode);
	}

	auth.onAuthStateChanged((user) => {
		if (user) {
			// (while signing up, the name is set a moment later; that code starts the chat)
			if (!signingUp) startSession(user);
		} else {
			endSession();
			showAuth();
		}
	});

	/* ============================================================
	   THE SESSION
	   ============================================================ */

	async function startSession(user) {
		if (me) return;
		let name = user.displayName || (user.email || "").split("@")[0] || "Someone";
		me = { uid: user.uid, name, key: keyOf(name) };
		joinedAt = Date.now();
		read = store.get(READ_KEY(), {});
		drafts = store.get(DRAFTS_KEY(), {});
		if (!drafts || typeof drafts !== "object") drafts = {};
		rememberSignedIn(true);

		// An account from the Moonplayer chatroom keeps its name in the list of taken names.
		if (validSegment(name)) {
			R(`usernames/${name}`)
				.once("value")
				.then((snap) => snap.exists() || R(`usernames/${name}`).set(user.uid))
				.catch(() => {});
		}

		boot.hidden = true;
		authEl.hidden = true;
		shell.hidden = false;
		watchPerson(name);
		renderMe();
		goOnline();

		listen(R("userTitles"), "value", (snap) => {
			titles = snap.val() || {};
			repaintTitles();
		}, session);
		listen(R("online"), "value", (snap) => {
			const all = snap.val() || {};
			for (const [key, entries] of Object.entries(all)) {
				const name = Object.values(entries || {}).find((v) => typeof v === "string");
				if (name && keyOf(name) === key) onlineNames.set(key, name.slice(0, 24));
			}
			const next = new Set(Object.keys(all));
			const changed = [...next].filter((k) => !online.has(k)).concat([...online].filter((k) => !next.has(k)));
			online = next;
			for (const key of changed) repaintPerson(key);
			renderOnline();
			if (current?.kind === "dm") renderRoomHead();
		}, session);
		listen(R("presence"), "value", (snap) => {
			onlineCount = snap.numChildren();
			if (current?.kind === "global") renderRoomHead();
		}, session);

		addConv({ id: "global", kind: "global", title: "Global chat", ref: R("messages"), typingRef: R("typing"), callRoot: R("groupCall") });
		watchMyDms();
		watchMyGroups();
		watchCalls();

		const last = store.get(`slow.chat.last.${ROOM}.${me.key}`, "global");
		const lastPeer = store.get(`slow.chat.lastPeer.${ROOM}.${me.key}`, null);
		if (String(last).startsWith("dm:") && lastPeer) addDm(lastPeer);
		// (small screens start on the list of chats)
		openConv(convs.has(last) ? last : "global", { focus: false, show: wide() });
	}

	function endSession() {
		if (!me) return;
		saveDraft();
		drafts = {};
		if (call) endCall(true);
		if (ringingCall) declineCall();
		if (group) leaveGroupCall();
		leaveRoom();
		for (const conv of convs.values()) stopAll(conv.offs);
		convs.clear();
		stopAll(session);
		goOffline();
		watched.clear();
		profiles.clear();
		xpOf.clear();
		seenAt.clear();
		online = new Set();
		current = null;
		me = null;
		$("convs").replaceChildren();
		$("msgs").replaceChildren();
		rememberSignedIn(false);
		if (slow) slow.setBadge?.(0);
		else document.title = "Chat · Slow";
		for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
	}

	// "Online": a green dot for you everywhere, the count in Global chat, and your last-online time.
	// Set again whenever the connection comes back (the server clears them when it drops).
	let presenceOffs = [];
	function goOnline() {
		const presence = R("presence").push();
		const onlineRef = usableKey(me.key) ? R(`online/${me.key}`).push() : null;
		const seenRef = usableKey(me.key) ? R(`seen/${me.key}`) : null;
		const mark = (snap) => {
			connected = snap.val() === true;
			renderRoomHead();
			if (!connected) return;
			presence.onDisconnect().remove();
			presence.set(true);
			if (onlineRef) {
				onlineRef.onDisconnect().remove();
				onlineRef.set(me.name);
			}
			if (seenRef) {
				seenRef.onDisconnect().set(TIMESTAMP);
				seenRef.set(TIMESTAMP);
			}
		};
		presenceOffs = [listen(db.ref(".info/connected"), "value", mark)];
		presenceOffs.push(() => {
			presence.onDisconnect().cancel();
			presence.remove().catch(() => {});
			if (onlineRef) {
				onlineRef.onDisconnect().cancel();
				onlineRef.remove().catch(() => {});
			}
			if (seenRef) {
				seenRef.onDisconnect().cancel();
				seenRef.set(TIMESTAMP).catch(() => {});
			}
		});
	}
	function goOffline() {
		stopAll(presenceOffs);
	}

	/* ============================================================
	   CONVERSATIONS
	   ============================================================ */

	const convsEl = $("convs");
	// Liquid glass (../liquid.js): a drop of glass marks the open chat and flows to the next one,
	// and others follow the pointer over the header's buttons and the people online.
	const Liquid = window.Liquid;
	const convLens = Liquid?.lens(convsEl);
	const onlineLens = Liquid?.lens($("online-list"), { hover: ".person" });
	Liquid?.lens(document.querySelector(".side-head"), { hover: ".side-head > .icon-btn", className: "small" });
	Liquid?.lens(document.querySelector(".room-actions"), { hover: ".room-actions > .icon-btn", className: "small" });
	const wide = () => window.innerWidth >= 640;

	function addConv(conv) {
		if (convs.has(conv.id)) return convs.get(conv.id);
		conv.offs = [];
		conv.last = null;
		convs.set(conv.id, conv);
		// The newest message, for the list's preview, unread dots and notifications.
		listen(conv.ref.orderByKey().limitToLast(1), "child_added", (snap) => onLatest(conv, snap.key, snap.val() || {}), conv.offs);
		renderConvs();
		return conv;
	}

	function removeConv(id) {
		const conv = convs.get(id);
		if (!conv) return;
		stopAll(conv.offs);
		convs.delete(id);
		if (current === conv) openConv("global");
		renderConvs();
		updateBadge();
	}

	const dmIdWith = (peer) => [me.name, peer].sort().join("_");

	function addDm(peer, { remember = false } = {}) {
		peer = String(peer ?? "").trim();
		if (!me || !peer || keyOf(peer) === me.key) return null;
		const dmId = dmIdWith(peer);
		if (!validSegment(dmId)) return null;
		const id = `dm:${dmId}`;
		if (!convs.has(id)) {
			addConv({ id, kind: "dm", peer, title: peer, ref: R(`dms/${dmId}/messages`), typingRef: R(`dms/${dmId}/typing`) });
			watchPerson(peer);
		}
		if (remember) rememberDm(peer);
		return convs.get(id);
	}

	// The list of who you've messaged, so the chat doesn't have to look through everyone's messages.
	const rememberedDms = new Set();
	function rememberDm(peer) {
		const peerKey = keyOf(peer);
		if (!usableKey(peerKey) || !usableKey(me.key) || rememberedDms.has(peerKey)) return;
		rememberedDms.add(peerKey);
		R(`userDms/${me.key}/${peerKey}`).update({ name: peer, ts: TIMESTAMP }).catch(() => {});
	}

	function watchMyDms() {
		if (usableKey(me.key)) {
			listen(R(`userDms/${me.key}`), "child_added", (snap) => {
				rememberedDms.add(snap.key);
				addDm(snap.val()?.name || snap.key);
			}, session);
		}
		// Someone messaged you (the Moonplayer chatroom does this too).
		if (validSegment(me.name)) {
			listen(R(`pings/${me.name}`), "value", (snap) => {
				const ping = snap.val();
				if (ping?.from && ping.ts > joinedAt - 60_000) addDm(ping.from, { remember: true });
			}, session);
		}
		findOldDms();
	}

	// Conversations from the Moonplayer chatroom: their names, without downloading any messages.
	async function findOldDms() {
		try {
			const base = EMULATOR
				? `http://127.0.0.1:9000/chatrooms/${ROOM}/dms.json?ns=demo-slow-chat&`
				: `${FIREBASE.databaseURL}chatrooms/${encodeURIComponent(ROOM)}/dms.json?`;
			const res = await fetch(`${base}shallow=true`);
			if (!res.ok || !me) return;
			const ids = Object.keys((await res.json()) || {});
			for (const id of ids) {
				let peer = null;
				if (id.startsWith(`${me.name}_`)) peer = id.slice(me.name.length + 1);
				else if (id.endsWith(`_${me.name}`)) peer = id.slice(0, -me.name.length - 1);
				if (peer && dmIdWith(peer) === id) addDm(peer, { remember: true });
			}
		} catch {}
	}

	function watchMyGroups() {
		if (!usableKey(me.key)) return;
		const index = R(`userGroups/${me.key}`);
		listen(index, "child_added", (snap) => addGroup(snap.key), session);
		listen(index, "child_removed", (snap) => {
			if (current?.gid === snap.key) toast("You're not in that group anymore.");
			removeConv(`group:${snap.key}`);
		}, session);
	}

	function addGroup(gid) {
		if (!validSegment(gid)) return;
		const id = `group:${gid}`;
		if (convs.has(id)) return convs.get(id);
		const base = R(`groups/${gid}`);
		const conv = addConv({
			id,
			kind: "group",
			gid,
			title: "Group",
			members: {},
			ref: base.child("messages"),
			typingRef: base.child("typing"),
			callRoot: base.child("groupCall"),
		});
		// (just the name and members: the group's messages load when it's opened)
		listen(base.child("name"), "value", (snap) => {
			conv.title = String(snap.val() || "Group").slice(0, 60);
			renderConvs();
			if (current === conv) renderRoomHead();
		}, conv.offs);
		listen(base.child("members"), "value", (snap) => {
			conv.members = snap.val() || {};
			if (current === conv) renderRoomHead();
		}, conv.offs);
		return conv;
	}

	function isUnread(conv) {
		const last = conv.last;
		return Boolean(last && keyOf(last.name) !== me.key && last.key > (read[conv.id] || ""));
	}

	// A new newest message in a conversation.
	function onLatest(conv, key, m) {
		conv.last = { key, name: String(m.name ?? ""), text: String(m.text ?? ""), time: Number(m.ts) || pushTime(key) };
		const fresh = pushTime(key) > joinedAt - 3000;
		// Messages from before you ever opened the chat on this device count as read.
		if (read[conv.id] === undefined && !fresh) markRead(conv);
		const mine = keyOf(conv.last.name) === me.key;
		if (fresh && !mine) {
			const mention = conv.kind !== "dm" && mentions(conv.last.text, me.name);
			if (mention) conv.mention = true;
			if (looking(conv)) markRead(conv);
			else if (conv.kind !== "global" || mention) alertAbout(conv);
		}
		renderConvs();
		updateBadge();
	}

	// The open conversation counts as read once you can see its newest message.
	function seeCurrent() {
		if (current && looking(current) && isUnread(current)) {
			markRead(current);
			renderConvs();
			updateBadge();
		}
	}

	function markRead(conv, { save = true } = {}) {
		if (!conv.last) return;
		if (read[conv.id] !== conv.last.key) {
			read[conv.id] = conv.last.key;
			if (save) store.set(READ_KEY(), read);
		}
		conv.mention = false;
	}

	// Are you looking at this conversation right now (scrolled to the newest message)?
	function looking(conv) {
		const shown = slow ? slow.visible?.() : !document.hidden;
		return current === conv && shown && stuck && (wide() || shell.classList.contains("show-room"));
	}

	function updateBadge() {
		if (!me) return;
		let count = 0;
		for (const conv of convs.values()) {
			if (!isUnread(conv)) continue;
			if (conv.kind !== "global" || conv.mention) count++;
		}
		if (slow) slow.setBadge?.(count);
		else document.title = count ? `(${count}) Chat · Slow` : "Chat · Slow";
	}

	function alertAbout(conv) {
		const { name, text } = conv.last;
		playSound("receive");
		if (!prefs.notify) return;
		const title = conv.kind === "group" ? conv.title : conv.kind === "global" ? `${name} mentioned you` : name;
		const message = (conv.kind === "group" ? `${name}: ${text}` : text).slice(0, 200);
		const chatOpen = slow ? slow.visible?.() : !document.hidden;
		if (chatOpen) {
			toast(message, { person: name, title, onclick: () => openConv(conv.id) });
			return;
		}
		// (one card per conversation: more messages add up on it, "3 new")
		slow?.notify?.({
			tone: "chat",
			key: `chat:${conv.id}`,
			count: true,
			title,
			message,
			avatar: { src: pictureFor(profiles.get(keyOf(name))?.pfp), text: initialsFor(name), color: tintOf(name) },
			// (answer right there in the notification, without opening the chat)
			reply: { placeholder: `Reply to ${conv.kind === "dm" ? name : conv.title}`, send: (text) => quickReply(conv.id, text) },
			onClick: () => slow.open(conv.id),
			timeout: 9000,
		});
	}

	// A reply typed into a notification: sent, and the chat counts as read.
	async function quickReply(id, text) {
		const conv = convs.get(id);
		text = String(text ?? "").trim();
		if (!conv || !me || !text) return false;
		await sendMessage(conv, text);
		markRead(conv);
		renderConvs();
		updateBadge();
		return true;
	}

	function convTime(conv) {
		return conv.last?.time || 0;
	}

	function convAvatar(conv, size) {
		if (conv.kind === "dm") return avatar(conv.peer, size);
		const el = h("span", { class: `avatar glyph ${conv.kind}`, "aria-hidden": "true" }, icon(conv.kind === "global" ? "globe" : "people"));
		el.style.setProperty("--size", `${size}px`);
		if (conv.kind === "group") el.style.setProperty("--tint", colorFor(conv.gid));
		return el;
	}

	function previewText(conv) {
		if (!conv.last) return conv.kind === "global" ? "Everyone on Slow" : "No messages yet";
		const who = keyOf(conv.last.name) === me.key ? "You" : conv.kind === "dm" ? "" : conv.last.name;
		const text = conv.last.text.replace(/\s+/g, " ");
		return who ? `${who}: ${text}` : text;
	}

	function renderConvs() {
		if (!me) return;
		const query = $("find").value.trim().toLowerCase();
		const list = [...convs.values()]
			.filter((c) => !query || c.title.toLowerCase().includes(query))
			.sort((a, b) => (a.kind === "global" ? -1 : b.kind === "global" ? 1 : convTime(b) - convTime(a)));
		convsEl.replaceChildren(
			...(convLens ? [convLens.el] : []),
			...list.map((conv) => {
				const unread = isUnread(conv);
				// (what you'd started writing in another chat shows instead of its last message)
				const draft = conv !== current && typeof drafts[conv.id] === "string" ? drafts[conv.id].replace(/\s+/g, " ").trim() : "";
				return h(
					"button",
					{
						class: `conv${conv === current ? " active" : ""}${unread ? " unread" : ""}`,
						type: "button",
						"data-conv": conv.id,
						onclick: () => openConv(conv.id),
					},
					convAvatar(conv, 40),
					h(
						"span",
						{ class: "conv-text" },
						h("span", { class: "conv-top" }, h("span", { class: "conv-name", text: conv.title }), h("span", { class: "conv-time", text: shortAgo(convTime(conv)) })),
						draft
							? h("span", { class: "conv-last" }, h("span", { class: "draft-tag", text: "Draft: " }), draft)
							: h("span", { class: "conv-last", text: previewText(conv) }),
					),
					unread && h("span", { class: conv.mention ? "badge mention" : "badge", text: conv.mention ? "@" : "" }),
				);
			}),
		);
		if (!list.length) convsEl.append(h("p", { class: "empty", text: query ? "No chats match that." : "" }));
		convLens?.to(convsEl.querySelector(".conv.active"));
	}
	$("find").addEventListener("input", renderConvs);
	// Enter opens the first chat that matches; Escape clears the search.
	$("find").addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			const first = convsEl.querySelector(".conv");
			if (!first) return;
			event.preventDefault();
			$("find").value = "";
			openConv(first.dataset.conv);
			renderConvs();
		} else if (event.key === "Escape" && $("find").value) {
			event.preventDefault();
			event.stopPropagation();
			$("find").value = "";
			renderConvs();
		}
	});
	setInterval(() => me && renderConvs(), 60_000); // keeps "5m" times current

	function renderOnline() {
		if (!me) return;
		const keys = [...online].filter((k) => k !== me.key);
		$("online-count").textContent = keys.length ? String(keys.length) : "";
		$("online-list").replaceChildren(
			...(onlineLens ? [onlineLens.el] : []),
			...keys.slice(0, 40).map((key) => {
				const mood = moodOf(lookOf(key));
				return h(
					"button",
					{ class: "person", type: "button", title: mood ? `${displayName(key)} · ${mood}` : displayName(key), onclick: () => openProfile(displayName(key)) },
					avatar(displayName(key), 40, { mood: true }),
					h("span", { class: "person-name", text: displayName(key) }),
				);
			}),
		);
		$("online-list").closest(".online").classList.toggle("none", !keys.length);
	}

	function renderMe() {
		if (!me) return;
		$("me-name").textContent = me.name;
		const { level } = levelForXp(statsFor(me.name).xp);
		// (your status, when you've set one)
		$("me-sub").textContent = moodOf(lookOf(me.key)) || `Lv ${level} · ${rankFor(level).name}`;
		$("me-avatar").replaceChildren(avatar(me.name, 34));
	}

	/* ============================================================
	   THE OPEN CONVERSATION
	   ============================================================ */

	const feed = $("feed");
	const msgsEl = $("msgs");
	const rendered = new Map(); // message key -> { li, m }
	let roomBag = []; // stops for things about the open conversation
	let liveBag = []; // stops for its messages
	let loadToken = 0;
	let oldestKey = null;
	let hasMore = false;
	let loadingOlder = false;
	let stuck = true; // scrolled to the newest message
	let unseenBelow = 0;

	function leaveRoom() {
		stopAll(liveBag);
		stopAll(roomBag);
		clearMyTyping();
		typingNow = {};
		renderTyping();
		cancelReply();
		hideTools();
		rendered.clear();
		msgsEl.replaceChildren();
	}

	function openConv(id, { focus = true, show = true } = {}) {
		const conv = convs.get(id);
		if (!conv || !me) return;
		if (show) shell.classList.add("show-room");
		if (current === conv && rendered.size) {
			seeCurrent();
			if (focus) $("text").focus();
			return;
		}
		saveDraft();
		leaveRoom();
		current = conv;
		store.set(`slow.chat.last.${ROOM}.${me.key}`, id);
		store.set(`slow.chat.lastPeer.${ROOM}.${me.key}`, conv.peer || null);
		renderRoomHead();
		renderConvs();
		$("text").placeholder = conv.kind === "global" ? "Message everyone" : `Message ${conv.title}`;
		// (each chat keeps what you'd started writing in it)
		$("text").value = drafts[conv.id] || "";
		updateComposer();

		const token = ++loadToken;
		oldestKey = null;
		hasMore = false;
		stuck = true;
		unseenBelow = 0;
		$("jump").hidden = true;
		$("feed-top").replaceChildren(h("span", { class: "loading", text: "Loading messages…" }));

		conv.ref
			.orderByKey()
			.limitToLast(PAGE)
			.once("value")
			.then((snap) => {
				if (token !== loadToken) return;
				const items = [];
				snap.forEach((child) => {
					items.push([child.key, child.val()]);
				});
				hasMore = items.length >= PAGE;
				oldestKey = items[0]?.[0] ?? null;
				for (const [key, m] of items) placeMessage(key, m);
				renderFeedTop();
				decorate();
				toBottom();
				watchMessages(token);
				markRead(conv);
				renderConvs();
				updateBadge();
			})
			.catch((err) => {
				$("feed-top").replaceChildren(h("span", { class: "loading", text: `Couldn't load messages: ${err.message}` }));
			});

		// Who's typing, and whether there's a call going.
		listen(conv.typingRef, "value", (snap) => {
			typingNow = snap.val() || {};
			renderTyping();
		}, roomBag);
		if (conv.callRoot) {
			listen(conv.callRoot.child("participants"), "value", (snap) => {
				conv.inCall = snap.numChildren();
				renderJoinCall();
			}, roomBag);
		}
		renderJoinCall();
		if (focus && (wide() || slow)) $("text").focus();
	}

	// Every message from the oldest one showing onward: new ones, reactions, deletions.
	function watchMessages(token) {
		stopAll(liveBag);
		const conv = current;
		const query = oldestKey ? conv.ref.orderByKey().startAt(oldestKey) : conv.ref.orderByKey();
		listen(query, "child_added", (snap) => {
			if (token !== loadToken) return;
			const isNew = !rendered.has(snap.key);
			placeMessage(snap.key, snap.val());
			if (!isNew) return;
			rendered.get(snap.key)?.li.classList.add("arrive");
			oldestKey ??= snap.key;
			const m = snap.val() || {};
			const mine = keyOf(m.name) === me.key;
			if (!stuck && !mine) {
				unseenBelow++;
				$("jump-text").textContent = unseenBelow === 1 ? "1 new message" : `${unseenBelow} new messages`;
				$("jump").hidden = false;
			}
			if (mine) stuck = true;
			schedule();
		}, liveBag);
		listen(query, "child_changed", (snap) => token === loadToken && placeMessage(snap.key, snap.val()), liveBag);
		listen(query, "child_removed", (snap) => {
			if (token !== loadToken) return;
			rendered.get(snap.key)?.li.remove();
			rendered.delete(snap.key);
			schedule();
		}, liveBag);
	}

	function renderFeedTop() {
		const top = $("feed-top");
		if (hasMore) {
			top.replaceChildren(h("button", { class: "older", type: "button", text: "Show earlier messages", onclick: loadOlder }));
		} else {
			const label = current.kind === "global" ? "the Global chat" : current.kind === "group" ? current.title : `your messages with ${current.peer}`;
			top.replaceChildren(
				h("div", { class: "start" }, convAvatar(current, 56), h("p", { class: "start-title", text: current.title }), h("p", { class: "start-text", text: `This is the start of ${label}.` })),
			);
		}
	}

	async function loadOlder() {
		if (!hasMore || loadingOlder || !oldestKey) return;
		loadingOlder = true;
		const token = loadToken;
		const conv = current;
		$("feed-top").replaceChildren(h("span", { class: "loading", text: "Loading earlier messages…" }));
		try {
			const snap = await conv.ref.orderByKey().endAt(oldestKey).limitToLast(PAGE + 1).once("value");
			if (token !== loadToken) return;
			const items = [];
			snap.forEach((child) => {
				if (child.key !== oldestKey) items.push([child.key, child.val()]);
			});
			hasMore = items.length >= PAGE;
			const fromBottom = feed.scrollHeight - feed.scrollTop;
			for (const [key, m] of items) placeMessage(key, m);
			if (items.length) oldestKey = items[0][0];
			renderFeedTop();
			decorate();
			feed.scrollTop = feed.scrollHeight - fromBottom;
			watchMessages(token); // (so reactions on these update too)
		} catch {
			renderFeedTop();
		} finally {
			loadingOlder = false;
		}
	}

	feed.addEventListener("scroll", () => {
		const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
		stuck = distance < 60;
		if (stuck) {
			unseenBelow = 0;
			$("jump").hidden = true;
			seeCurrent();
		}
		if (feed.scrollTop < 120 && hasMore) loadOlder();
		hideTools();
	}, { passive: true });

	const calm = () => document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
	$("jump").addEventListener("click", () => {
		feed.scrollTo({ top: feed.scrollHeight, behavior: calm() ? "auto" : "smooth" });
	});

	function toBottom() {
		feed.scrollTop = feed.scrollHeight;
		stuck = true;
	}

	// Re-draws the day lines and which messages run together, after messages come and go.
	let scheduled = 0;
	function schedule() {
		scheduled ||= requestAnimationFrame(() => {
			scheduled = 0;
			const stick = stuck;
			decorate();
			if (stick) toBottom();
			seeCurrent();
		});
	}

	function decorate() {
		for (const line of msgsEl.querySelectorAll(":scope > .day")) line.remove();
		let prev = null;
		let prevDay = null;
		for (const li of msgsEl.querySelectorAll(":scope > .msg")) {
			const time = Number(li.dataset.time);
			const day = dayKey(time);
			let joined = false;
			if (day !== prevDay) {
				msgsEl.insertBefore(h("li", { class: "day", role: "separator" }, h("span", { text: dayLabel(time) })), li);
				prevDay = day;
			} else if (prev && prev.dataset.author === li.dataset.author && time - Number(prev.dataset.time) < GROUP_GAP && !li.classList.contains("replying")) {
				joined = true;
			}
			li.classList.toggle("cont", joined);
			prev?.classList.toggle("has-next", joined);
			prev = li;
		}
		prev?.classList.remove("has-next");
	}

	function placeMessage(key, m) {
		if (!m || typeof m !== "object") return;
		const known = rendered.get(key);
		const data = JSON.stringify(m);
		if (known?.data === data) return; // (the same message again, from a new listener)
		const li = messageEl(key, m);
		if (known) {
			// Changed (a reaction, usually): swap it in, keeping how it sits with its neighbours.
			for (const name of ["cont", "has-next"]) li.classList.toggle(name, known.li.classList.contains(name));
			const toolsHere = tools.parentElement === known.li;
			known.li.replaceWith(li);
			if (toolsHere) li.append(tools);
			rendered.set(key, { li, m, data });
			return;
		}
		rendered.set(key, { li, m, data });
		// Usually the newest; otherwise slot it in by its key (keys are in time order).
		const last = msgsEl.lastElementChild;
		if (!last || last.dataset.key < key) {
			msgsEl.append(li);
			return;
		}
		for (const other of msgsEl.querySelectorAll(":scope > .msg")) {
			if (other.dataset.key > key) {
				msgsEl.insertBefore(li, other);
				return;
			}
		}
		msgsEl.append(li);
	}

	function mentions(text, name) {
		if (!name) return false;
		const at = String(text).toLowerCase().indexOf(`@${keyOf(name)}`);
		if (at < 0) return false;
		const after = String(text)[at + name.length + 1];
		return !after || !/[\p{L}\p{N}]/u.test(after);
	}

	const LINK = /(\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,:;!?)\]}])|(\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*[^\s<>"'.,:;!?)\]}])?)|(@[\p{L}\p{N}][\p{L}\p{N}-]{0,23}(?: [\p{L}\p{N}][\p{L}\p{N}-]{0,23})?)/giu;

	// Message text: plain text, with links you can click (they open in a Slow tab) and @mentions.
	function richText(text) {
		const frag = document.createDocumentFragment();
		let at = 0;
		for (const match of text.matchAll(LINK)) {
			let [whole, url, www, mention] = match;
			if (mention) {
				// "@Two Words" only counts as a mention of someone actually called that.
				const key = keyOf(mention.slice(1));
				if (mention.includes(" ") && key !== me?.key && !profiles.get(key) && !xpOf.get(key)) {
					mention = mention.split(" ")[0];
					whole = mention;
				}
			}
			frag.append(text.slice(at, match.index));
			at = match.index + whole.length;
			if (url || www) {
				const href = url || `https://${www}`;
				frag.append(h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer", text: whole }));
			} else {
				const isMe = me && keyOf(mention.slice(1)) === me.key;
				frag.append(h("span", { class: isMe ? "mention me" : "mention", text: whole }));
			}
		}
		frag.append(text.slice(at));
		return frag;
	}

	const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*\s*){1,3}$/u;

	function messageEl(key, m) {
		const name = String(m.name ?? "?");
		const text = String(m.text ?? "");
		const time = Number(m.ts) || pushTime(key);
		const mine = keyOf(name) === me.key;
		const reply = m.replyTo && typeof m.replyTo === "object" ? m.replyTo : null;

		const li = h("li", {
			class: `msg${mine ? " mine" : ""}${reply ? " replying" : ""}${!mine && mentions(text, me.name) ? " pinged" : ""}`,
			"data-key": key,
			"data-author": keyOf(name),
			"data-time": time,
		});
		li.dataset.name = name;

		if (!mine) {
			const face = avatar(name, 34);
			face.classList.add("msg-avatar");
			face.addEventListener("click", () => openProfile(name));
			li.append(face);
		}

		const body = h("div", { class: "msg-body" });
		const meta = h("div", { class: "meta" });
		if (!mine) {
			const who = h("button", { class: "msg-name", type: "button", "data-person": keyOf(name), text: name, onclick: () => openProfile(name) });
			paintName(who);
			meta.append(who, levelBadge(name));
		}
		const tag = !mine && titleTag(name);
		if (tag) meta.append(tag);
		meta.append(h("time", { datetime: new Date(time).toISOString(), title: new Date(time).toLocaleString(), text: clockFormat.format(time) }));
		body.append(meta);

		if (reply) {
			const quote = h(
				"button",
				{ class: "quote", type: "button", onclick: () => jumpTo(String(reply.id ?? "")) },
				h("span", { class: "quote-name", text: String(reply.name ?? "") }),
				h("span", { class: "quote-text", text: String(reply.text ?? "").slice(0, 140) }),
			);
			body.append(quote);
		}

		const bubble = h("div", { class: `bubble${EMOJI_ONLY.test(text.trim()) ? " big" : ""}` });
		bubble.append(richText(text));
		body.append(bubble);

		const reactions = m.reactions && typeof m.reactions === "object" ? m.reactions : null;
		if (reactions) {
			const row = h("div", { class: "reactions" });
			for (const [emoji, people] of Object.entries(reactions)) {
				const keys = people && typeof people === "object" ? Object.keys(people) : [];
				if (!keys.length || emoji.length > 8) continue;
				const names = keys.map(displayName);
				row.append(
					h(
						"button",
						{
							class: `reaction${people[me.key] ? " mine" : ""}`,
							type: "button",
							title: names.length > 8 ? `${names.slice(0, 8).join(", ")} and ${names.length - 8} more` : names.join(", "),
							"aria-pressed": String(Boolean(people[me.key])),
							onclick: () => react(key, emoji),
						},
						h("span", { class: "reaction-emoji", text: emoji }),
						h("span", { class: "reaction-count", text: keys.length }),
					),
				);
			}
			if (row.childElementCount) body.append(row);
		}
		li.append(body);
		return li;
	}

	function jumpTo(key) {
		const target = rendered.get(key)?.li;
		if (!target) {
			toast("That message is further back than what's loaded.");
			return;
		}
		target.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
		target.classList.remove("flash");
		void target.offsetWidth;
		target.classList.add("flash");
	}

	function systemLine(text) {
		msgsEl.append(h("li", { class: "system", "data-key": "~", text }));
		if (stuck) toBottom();
	}

	/* ---------- reactions, replies, copying, deleting ---------- */

	function react(key, emoji) {
		if (!current || !me || !usableKey(me.key)) return;
		const ref = current.ref.child(key).child("reactions").child(emoji).child(me.key);
		ref.once("value")
			.then((snap) => {
				if (snap.exists()) return ref.remove();
				awardXp(1, "reaction", 1500);
				return ref.set(true);
			})
			.catch(() => toast("Couldn't add that reaction."));
	}

	const tools = $("msg-tools");
	window.Liquid?.lens(tools, { hover: ".tool", className: "small" });
	let toolsKey = null;
	$("msg-react").append(
		...REACTIONS.map((emoji) =>
			h("button", { class: "tool emoji", type: "button", title: `React ${emoji}`, text: emoji, onclick: () => toolsKey && react(toolsKey, emoji) }),
		),
	);

	function showTools(li) {
		if (!li?.dataset.key || li.dataset.key === "~") return;
		toolsKey = li.dataset.key;
		const mine = li.classList.contains("mine");
		// (the owner can delete anyone's message: the button says so, with the owner's mark)
		const asOwner = !mine && canModerate();
		const del = $("tool-delete");
		del.hidden = !(mine || asOwner);
		del.classList.toggle("as-owner", asOwner);
		del.title = asOwner ? `Delete ${li.dataset.name}'s message (owner)` : "Delete";
		del.setAttribute("aria-label", asOwner ? `Delete ${li.dataset.name}'s message, as the chat's owner` : "Delete message");
		tools.hidden = false;
		tools.classList.toggle("left", mine);
		li.append(tools);
	}
	function hideTools() {
		tools.hidden = true;
		toolsKey = null;
		if (tools.parentElement !== document.body) document.body.append(tools);
	}

	msgsEl.addEventListener("mouseover", (event) => {
		const li = event.target.closest(".msg");
		if (li && tools.parentElement !== li) showTools(li);
	});
	msgsEl.addEventListener("mouseleave", hideTools);
	// On touch screens, tapping a message shows its buttons.
	msgsEl.addEventListener("click", (event) => {
		if (event.pointerType === "mouse" || event.target.closest("a, button")) return;
		const li = event.target.closest(".msg");
		if (!li) return;
		if (tools.parentElement === li && !tools.hidden) hideTools();
		else showTools(li);
	});

	// Links in messages open in a Slow tab.
	msgsEl.addEventListener("click", (event) => {
		const link = event.target.closest("a.link");
		if (!link) return;
		event.preventDefault();
		openLink(link.href);
	});

	function openLink(url) {
		if (!/^https?:\/\//i.test(url)) return;
		if (slow?.openTab) slow.openTab(url);
		else window.open(url, "_blank", "noopener");
	}

	$("tool-reply").addEventListener("click", () => {
		const item = rendered.get(toolsKey);
		if (!item) return;
		startReply(toolsKey, item.m);
		hideTools();
	});

	$("tool-copy").addEventListener("click", async () => {
		const item = rendered.get(toolsKey);
		hideTools();
		if (!item) return;
		try {
			await navigator.clipboard.writeText(String(item.m.text ?? ""));
			toast("Copied.");
		} catch {
			toast("Couldn't copy it.");
		}
	});

	$("tool-delete").addEventListener("click", async () => {
		const key = toolsKey;
		const conv = current;
		const item = rendered.get(key);
		hideTools();
		if (!key || !conv || !item) return;
		const author = String(item.m.name ?? "");
		const theirs = keyOf(author) !== me.key;
		const said = String(item.m.text ?? "").replace(/\s+/g, " ").trim();
		const quote = said.length > 90 ? `${said.slice(0, 90)}…` : said;
		const ok = await confirmSheet(
			theirs
				? {
						title: `Delete ${author}'s message?`,
						text: `“${quote}” will be gone for everyone. You're deleting it as the chat's owner.`,
						yes: "Delete it",
					}
				: { title: "Delete this message?", text: "It's deleted for everyone.", yes: "Delete" },
		);
		if (!ok) return;
		conv.ref
			.child(key)
			.remove()
			.catch(() => toast(theirs ? "Couldn't delete it. Only the owner's account can delete other people's messages." : "Couldn't delete it."));
	});

	let replyTo = null;
	function startReply(key, m) {
		replyTo = { id: key, name: String(m.name ?? ""), text: String(m.text ?? "").slice(0, 140) };
		$("reply-label").textContent = `Replying to ${replyTo.name}`;
		$("reply-text").textContent = replyTo.text;
		$("reply-bar").hidden = false;
		$("text").focus();
	}
	function cancelReply() {
		replyTo = null;
		$("reply-bar").hidden = true;
	}
	$("reply-cancel").addEventListener("click", () => {
		cancelReply();
		$("text").focus();
	});

	/* ---------- the room's header ---------- */

	function renderRoomHead() {
		if (!current || !me) return;
		const conv = current;
		$("room-title").textContent = conv.title;
		$("room-avatar").replaceChildren(convAvatar(conv, 34));
		let sub = "";
		if (!connected) sub = "Reconnecting…";
		else if (conv.kind === "global") sub = onlineCount === 1 ? "1 person here" : `${onlineCount} people here`;
		else if (conv.kind === "group") {
			const n = Object.keys(conv.members || {}).length;
			sub = n === 1 ? "1 member" : `${n} members`;
		}
		if (conv.kind === "dm" && connected) {
			// Online (or when they last were), and their status.
			const key = keyOf(conv.peer);
			const live = online.has(key);
			const mood = moodOf(lookOf(key));
			const presence = live ? "Online" : seenAt.get(key) ? longAgo(seenAt.get(key)) : "";
			$("room-sub").replaceChildren(
				...(presence ? [h("span", { class: live ? "live" : null, text: presence })] : []),
				...(presence && mood ? [" · "] : []),
				...(mood ? [mood] : []),
			);
		} else {
			$("room-sub").textContent = sub;
		}
		$("room-sub").classList.remove("live");
		$("btn-voice").hidden = false;
		$("btn-video").hidden = false;
		const groupish = conv.kind !== "dm";
		$("btn-voice").title = $("btn-voice").ariaLabel = groupish ? "Start a voice call with everyone here" : "Voice call";
		$("btn-video").title = $("btn-video").ariaLabel = groupish ? "Start a video call with everyone here" : "Video call";
		$("btn-room-menu").hidden = conv.kind === "global";
	}

	function renderJoinCall() {
		const btn = $("call-join");
		const count = current?.inCall || 0;
		const here = group && group.conv === current;
		btn.hidden = !count || here;
		btn.textContent = `Join call · ${count}`;
	}

	$("call-join").addEventListener("click", (event) => {
		openMenu(event.currentTarget, [
			{ label: "Join with voice", icon: "phone", run: () => joinGroupCall(current, false) },
			{ label: "Join with video", icon: "video", run: () => joinGroupCall(current, true) },
		]);
	});
	$("btn-voice").addEventListener("click", () => (current.kind === "dm" ? startCall(current.peer, false) : joinGroupCall(current, false)));
	$("btn-video").addEventListener("click", () => (current.kind === "dm" ? startCall(current.peer, true) : joinGroupCall(current, true)));

	$("room-info").addEventListener("click", () => {
		if (!current) return;
		if (current.kind === "dm") openProfile(current.peer);
		else if (current.kind === "group") openMembers(current);
		else openBoard();
	});

	$("room-back").addEventListener("click", () => {
		shell.classList.remove("show-room");
		$("find").focus({ preventScroll: true });
	});

	$("btn-room-menu").addEventListener("click", (event) => {
		const conv = current;
		if (conv?.kind === "dm") {
			openMenu(event.currentTarget, [{ label: `${conv.peer}'s profile`, icon: "user", run: () => openProfile(conv.peer) }]);
		} else if (conv?.kind === "group") {
			openMenu(event.currentTarget, [
				{ label: "Members", icon: "people", run: () => openMembers(conv) },
				{ label: "Add people", icon: "plus", run: () => openGroupSheet("add", conv) },
				{ separator: true },
				{ label: "Leave group", icon: "leave", danger: true, run: () => leaveGroup(conv) },
			]);
		}
	});

	/* ---------- typing ---------- */

	let typingNow = {};
	let typingSentAt = 0;

	function renderTyping() {
		const now = serverNow();
		const names = Object.values(typingNow)
			.filter((t) => t && t.name && keyOf(t.name) !== me?.key && Math.abs(now - (Number(t.ts) || 0)) < 8000)
			.map((t) => String(t.name));
		const el = $("typing");
		if (!names.length) {
			el.replaceChildren();
			return;
		}
		const who =
			names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names.length} people are typing`;
		el.replaceChildren(h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), who);
	}
	setInterval(renderTyping, 2000);

	function clearMyTyping() {
		if (current && me && usableKey(me.key)) current.typingRef.child(me.key).remove().catch(() => {});
		typingSentAt = 0;
	}

	/* ---------- writing a message ---------- */

	const textEl = $("text");
	const COMMANDS = [
		{ cmd: "/profile", about: "Edit your profile" },
		{ cmd: "/status", about: "[emoji] [what you're up to] (nothing clears it)" },
		{ cmd: "/leaderboard", about: "See who's on top" },
		{ cmd: "/title give", about: "<title> [#color] <username>", owner: true },
		{ cmd: "/title clear", about: "<username>", owner: true },
	];

	// Deleting other people's messages and giving titles: only the owner's account (the database's
	// rules check the same thing, so nobody else can, even from the browser's developer tools).
	const canModerate = () => Boolean(me && me.name === OWNER_NAME);

	// The message box grows with what you write, up to a point, and then scrolls.
	function fitComposer() {
		textEl.style.height = "auto";
		const full = textEl.scrollHeight;
		// (while the chat is hidden nothing has a size, so it's measured again once it shows)
		if (!full) {
			textEl.style.height = "";
			return;
		}
		textEl.style.height = `${Math.min(full, 140)}px`;
		textEl.style.overflowY = full > 140 ? "auto" : "hidden";
	}
	// (again when its width changes: when the chat shows, or goes from full screen to the side)
	let composerWidth = 0;
	new ResizeObserver(() => {
		if (textEl.clientWidth === composerWidth) return;
		composerWidth = textEl.clientWidth;
		fitComposer();
	}).observe(textEl);

	function updateComposer() {
		fitComposer();
		const length = textEl.value.length;
		$("send").disabled = !textEl.value.trim();
		$("count").hidden = length < MAX_TEXT - 100;
		$("count").textContent = `${length}/${MAX_TEXT}`;
		refreshHints();
	}

	// What you've started writing stays with that chat (even after closing Slow), and comes back
	// when you open it again.
	let draftTimer = 0;
	function saveDraft() {
		clearTimeout(draftTimer);
		if (!current || !me) return;
		const text = textEl.value;
		if (text.trim()) drafts[current.id] = text.slice(0, MAX_TEXT);
		else delete drafts[current.id];
		store.set(DRAFTS_KEY(), drafts);
	}
	function saveDraftSoon() {
		clearTimeout(draftTimer);
		draftTimer = setTimeout(saveDraft, 400);
	}

	/* ---------- suggestions above the message box: commands, and people to @mention ---------- */

	let hints = []; // { label, about, person, pick() }
	let hintsKind = "";
	let hintAt = 0; // the highlighted one (↑ ↓ to move, Tab or Enter to use it)
	let hintsDismissed = false; // (Escape hides them until you type again)

	function refreshHints() {
		const typed = textEl.value;
		hints = [];
		if (hintsDismissed) hintsKind = "";
		else if (typed.startsWith("/") && !typed.includes("\n")) {
			hintsKind = "command";
			hints = COMMANDS.filter((c) => (!c.owner || canModerate()) && (c.cmd.startsWith(typed.trim()) || typed.startsWith(`${c.cmd} `))).map((c) => ({
				label: c.cmd,
				about: c.about,
				pick: () => putText(`${c.cmd} `),
			}));
		} else {
			hintsKind = "mention";
			hints = mentionHints();
		}
		renderHints();
	}

	function renderHints() {
		const list = $("cmd-hint");
		list.hidden = !hints.length;
		hintAt = Math.min(hintAt, Math.max(0, hints.length - 1));
		list.replaceChildren(
			...hints.map((o, i) =>
				h(
					"li",
					{ role: "option", "aria-selected": String(i === hintAt) },
					h(
						"button",
						{
							type: "button",
							tabindex: "-1",
							class: i === hintAt ? "on" : null,
							// (so the message box keeps the keyboard)
							onmousedown: (event) => event.preventDefault(),
							onclick: () => o.pick(),
						},
						o.person ? avatar(o.person, 22, { dot: false }) : null,
						h("b", { text: o.label }),
						o.about ? h("span", { text: o.about }) : null,
					),
				),
			),
		);
	}

	function putText(value, caret = value.length) {
		textEl.value = value;
		textEl.focus();
		textEl.setSelectionRange(caret, caret);
		updateComposer();
		saveDraftSoon();
	}

	// "@jo" just before the cursor: who it could be. People in this chat come first (in a DM,
	// the other person; in a group, its members), then whoever wrote here lately and who's online.
	function mentionHints() {
		const caret = textEl.selectionStart;
		if (!current || !me || caret !== textEl.selectionEnd) return [];
		const before = textEl.value.slice(0, caret);
		const match = before.match(/(?:^|\s)@([\p{L}\p{N}-]{0,24})$/u);
		if (!match) return [];
		const typed = match[1].toLowerCase();
		const names = new Map(); // key -> their name
		const add = (name) => {
			const n = String(name ?? "").trim();
			const key = keyOf(n);
			if (n && key !== me.key && usableKey(key) && !names.has(key)) names.set(key, n);
		};
		if (current.kind === "dm") add(current.peer);
		if (current.kind === "group") for (const member of Object.values(current.members || {})) add(member?.name);
		for (const { m } of [...rendered.values()].reverse()) add(m?.name);
		for (const key of online) add(displayName(key));
		const all = [...names.values()];
		const found = [...all.filter((n) => n.toLowerCase().startsWith(typed)), ...all.filter((n) => typed && !n.toLowerCase().startsWith(typed) && n.toLowerCase().includes(typed))];
		const start = caret - match[1].length - 1; // (where the @ is)
		return found.slice(0, 6).map((name) => ({
			label: name,
			about: online.has(keyOf(name)) ? "Online" : "",
			person: name,
			pick: () => {
				const value = `${textEl.value.slice(0, start)}@${name} ${textEl.value.slice(caret)}`;
				putText(value, start + name.length + 2);
			},
		}));
	}

	// (moving the cursor changes what it's next to)
	textEl.addEventListener("click", refreshHints);
	textEl.addEventListener("keyup", (event) => {
		if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refreshHints();
	});

	textEl.addEventListener("input", () => {
		hintsDismissed = false;
		hintAt = 0;
		updateComposer();
		saveDraftSoon();
		if (!current || !me || !usableKey(me.key) || !textEl.value.trim()) return;
		const now = Date.now();
		if (now - typingSentAt < 2500) return;
		typingSentAt = now;
		const mine = current.typingRef.child(me.key);
		mine.onDisconnect().remove();
		mine.set({ name: me.name, ts: TIMESTAMP }).catch(() => {});
	});

	textEl.addEventListener("keydown", (event) => {
		// Choosing from the suggestions with the keyboard.
		if (hints.length && !event.isComposing) {
			const typed = textEl.value.trim();
			const wholeCommand = hintsKind === "command" && COMMANDS.some((c) => typed === c.cmd || textEl.value.startsWith(`${c.cmd} `));
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				hintAt = (hintAt + (event.key === "ArrowDown" ? 1 : -1) + hints.length) % hints.length;
				renderHints();
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !wholeCommand)) {
				event.preventDefault();
				hints[hintAt]?.pick();
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			$("composer").requestSubmit();
		} else if (event.key === "ArrowUp" && !textEl.value) {
			// Up in an empty box: reply to the newest message.
			const last = [...rendered.entries()].at(-1);
			if (last) {
				event.preventDefault();
				startReply(last[0], last[1].m);
			}
		}
	});

	$("composer").addEventListener("submit", (event) => {
		event.preventDefault();
		const text = textEl.value.trim();
		if (!text || !current || !me) return;
		if (text.startsWith("/") && runCommand(text)) {
			textEl.value = "";
			updateComposer();
			saveDraft();
			return;
		}
		sendMessage(current, text, { quote: replyTo }).catch((err) => toast(`Didn't send: ${err.message}`));
		textEl.value = "";
		cancelReply();
		updateComposer();
		saveDraft();
		clearMyTyping();
		stuck = true;
	});

	// Sends a message to a chat: from the message box, or a reply typed into one of Slow's
	// notifications.
	function sendMessage(conv, text, { quote = null } = {}) {
		const message = { name: me.name, text: text.slice(0, MAX_TEXT), ts: TIMESTAMP, uid: me.uid };
		if (quote) message.replyTo = quote;
		const sent = conv.ref.push(message);
		playSound("send");
		awardXp(5, "message", 8000);
		if (conv.kind === "dm") {
			// (the Moonplayer chatroom finds new messages this way)
			if (validSegment(conv.peer)) R(`pings/${conv.peer}`).set({ from: me.name, text: text.slice(0, 120), ts: Date.now() }).catch(() => {});
			rememberDm(conv.peer);
			const peerKey = keyOf(conv.peer);
			if (usableKey(peerKey) && usableKey(me.key)) R(`userDms/${peerKey}/${me.key}`).update({ name: me.name, ts: TIMESTAMP }).catch(() => {});
		}
		return sent;
	}

	function runCommand(text) {
		const lower = text.toLowerCase();
		if (lower === "/profile") {
			openEdit();
			return true;
		}
		if (lower === "/status" || lower.startsWith("/status ")) {
			setStatus(text.slice(7).trim());
			return true;
		}
		if (lower === "/leaderboard") {
			openBoard();
			return true;
		}
		if (lower.startsWith("/title")) {
			titleCommand(text);
			return true;
		}
		return false;
	}

	const TITLE_USAGE = "Use /title give <title> [#color] <username>, or /title clear <username>.";

	// Works out where the title ends and the name starts by checking the real list of usernames
	// (names can have spaces), longest match first.
	async function titleCommand(text) {
		if (!canModerate()) {
			toast("Only the chat's owner can give titles.");
			return;
		}
		const parts = text.trim().split(/\s+/);
		const sub = (parts[1] || "").toLowerCase();
		const rest = parts.slice(2);
		if ((sub !== "give" && sub !== "clear") || !rest.length) {
			toast(TITLE_USAGE);
			return;
		}
		let known = [];
		try {
			known = Object.keys(await usernames());
		} catch {}
		known.push(OWNER_NAME);
		const byKey = new Map(known.map((n) => [keyOf(n), n]));
		let target = null;
		let used = 0;
		for (let n = rest.length; n >= 1; n--) {
			const hit = byKey.get(keyOf(rest.slice(rest.length - n).join(" ").replace(/^@/, "")));
			if (hit) {
				target = hit;
				used = n;
				break;
			}
		}
		if (!target || !usableKey(keyOf(target))) {
			toast(`Couldn't find anyone called "${rest.at(-1).replace(/^@/, "")}".`);
			return;
		}
		const ref = R(`userTitles/${keyOf(target)}`);
		if (sub === "clear") {
			ref.remove().then(() => toast(`Took ${target}'s title away.`), (err) => toast(`Couldn't: ${err.message}`));
			return;
		}
		const words = rest.slice(0, rest.length - used);
		const hex = words.length && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(words.at(-1)) ? words.pop() : null;
		const title = words.join(" ").slice(0, 24);
		if (!title) {
			toast(TITLE_USAGE);
			return;
		}
		const color = hex ? (hex.startsWith("#") ? hex : `#${hex}`) : "#8B5CF6";
		ref.set({ text: title, color }).then(() => toast(`${target} is now "${title}".`), (err) => toast(`Couldn't: ${err.message}`));
	}

	/* ============================================================
	   LEVELS
	   ============================================================ */

	const xpCooldowns = {};
	// A little XP for taking part, with a cooldown per kind so mashing buttons doesn't level you up.
	async function awardXp(amount, kind, cooldown) {
		if (!me || !usableKey(me.key)) return;
		const now = Date.now();
		if (xpCooldowns[kind] && now - xpCooldowns[kind] < cooldown) return;
		xpCooldowns[kind] = now;
		try {
			const result = await R(`xp/${me.key}`).transaction((cur) => {
				cur = cur || {};
				cur.name = me.name;
				cur.xp = (Number(cur.xp) || 0) + amount;
				if (kind === "message") cur.messageCount = (Number(cur.messageCount) || 0) + 1;
				cur.firstSeenAt ||= Date.now();
				return cur;
			});
			if (!result.committed) return;
			const total = result.snapshot.val()?.xp || 0;
			const before = levelForXp(total - amount).level;
			const after = levelForXp(total).level;
			if (after > before) {
				playSound("levelUp");
				toast(`Level ${after}! You're a ${rankFor(after).name} now.`, { person: me.name, sticky: true });
			}
		} catch {}
	}

	/* ============================================================
	   SHEETS: profiles, editing yours, new chats, groups, leaderboard
	   ============================================================ */

	for (const dialog of document.querySelectorAll("dialog.sheet")) {
		// Clicking outside a sheet closes it.
		dialog.addEventListener("click", (event) => {
			if (event.target === dialog) dialog.close();
		});
		for (const btn of dialog.querySelectorAll("[data-close]")) btn.addEventListener("click", () => dialog.close(btn.value || ""));
	}

	let viewing = null;
	const profileSheet = $("profile");

	function openProfile(name) {
		if (!name || !me) return;
		viewing = String(name);
		watchPerson(viewing);
		renderProfile(viewing);
		hideTools();
		if (!profileSheet.open) {
			showStats(false, { instant: true });
			profileSheet.showModal();
		}
	}
	profileSheet.addEventListener("close", () => {
		viewing = null;
		showStats(false, { instant: true });
	});

	/* ---------- their stats: tucked behind a button, and springing open like a drop ---------- */

	const statsDrawer = $("pf-stats");
	const statsCard = $("pf-level-card");
	const statsBtn = $("pf-stats-btn");
	let statsOpen = false;
	let statsSpring = null; // 0: closed, 1: open (it overshoots a little, like water)

	const statsMotion = {
		step: (dt) => statsSpring.step(dt),
		render() {
			paintStats(statsSpring.value);
			if (!statsSpring.still) return true;
			settleStats();
			return false;
		},
	};

	// The drawer opens to the card's height, and the card swells up out of the Stats button.
	function paintStats(v) {
		const t = Math.min(1, Math.max(0, v));
		statsDrawer.style.height = `${Math.max(0, v) * statsDrawer.firstElementChild.offsetHeight}px`;
		statsCard.style.opacity = String(Math.min(1, t * 1.6));
		statsCard.style.transform = `translateY(${(1 - t) * 12}px) scale(${0.86 + 0.14 * t}, ${Math.max(0.4, 0.5 + 0.5 * v)})`;
	}

	function settleStats() {
		statsDrawer.style.height = "";
		statsCard.style.opacity = "";
		statsCard.style.transform = "";
		statsDrawer.hidden = !statsOpen;
	}

	function showStats(open, { instant = false } = {}) {
		const ring = $("pf-ring");
		const wasHidden = statsDrawer.hidden;
		statsOpen = open;
		statsBtn.setAttribute("aria-expanded", String(open));
		if (!open) ring.style.setProperty("--p", 0);
		const Liquid = window.Liquid;
		if (instant || !Liquid || Liquid.calm()) {
			statsSpring?.set(open ? 1 : 0);
			settleStats();
			if (open) ring.style.setProperty("--p", ring.dataset.p || 0);
			return;
		}
		statsSpring ||= new Liquid.Spring(0, { stiffness: 300, damping: 21 });
		if (open && wasHidden) {
			statsDrawer.hidden = false;
			statsSpring.set(0);
			paintStats(0);
		}
		statsSpring.target = open ? 1 : 0;
		Liquid.animate(statsMotion);
		// (the ring fills up as it opens)
		if (open) requestAnimationFrame(() => statsOpen && ring.style.setProperty("--p", ring.dataset.p || 0));
	}
	statsBtn.addEventListener("click", () => showStats(!statsOpen));

	function renderProfile(name) {
		const key = keyOf(name);
		const profile = profiles.get(key);
		const isMe = key === me.key;
		const shown = profile?.name || name;
		const look = lookFrom(profile);
		const tint = tintOf(shown, look);
		profileSheet.style.setProperty("--pf", tint);
		$("pf-avatar").replaceChildren(avatar(shown, 84));
		paintBanner($("pf-banner"), look, tint, look.banner === "picture" ? bannerPicture(key, look.bannerAt) : null);
		$("pf-name").textContent = shown;
		$("pf-pronouns").textContent = look.pronouns;
		$("pf-pronouns").hidden = !look.pronouns;
		$("pf-mood-emoji").textContent = look.statusEmoji;
		$("pf-mood-text").textContent = look.status;
		$("pf-mood").hidden = !moodOf(look);
		$("pf-status").textContent = online.has(key) ? "Online" : seenAt.get(key) ? longAgo(seenAt.get(key)) : "";
		$("pf-status").classList.toggle("live", online.has(key));
		$("pf-tags").replaceChildren(...[levelBadge(shown), titleTag(shown)].filter(Boolean));

		const stats = statsFor(shown);
		const { level, into, need } = levelForXp(stats.xp);
		const rank = rankFor(level);
		// (a ring around their level fills up as they get closer to the next one)
		const progress = Math.round((into / need) * 100);
		$("pf-level-card").style.setProperty("--rank", rank.color);
		$("pf-rank").textContent = rank.name;
		$("pf-level").textContent = level;
		$("pf-ring").dataset.p = progress;
		if (statsOpen) $("pf-ring").style.setProperty("--p", progress);
		$("pf-ring").setAttribute("aria-label", `Level ${level}, ${progress}% of the way to level ${level + 1}`);
		$("pf-xp-text").textContent = `${into.toLocaleString()} / ${need.toLocaleString()} XP`;
		$("pf-xp-text").title = `${(need - into).toLocaleString()} XP to level ${level + 1}`;
		$("pf-count").textContent = Number(stats.messageCount || 0).toLocaleString();
		$("pf-since").textContent = stats.firstSeenAt ? new Date(stats.firstSeenAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";

		const bio = look.bio;
		$("pf-bio").textContent = bio || (isMe ? "You haven't written a bio yet." : "No bio yet.");
		$("pf-bio").classList.toggle("empty", !bio);
		for (const id of ["pf-voice", "pf-video", "pf-message"]) $(id).hidden = isMe;
		$("pf-edit").hidden = !isMe;
	}

	$("pf-message").addEventListener("click", () => {
		const target = viewing;
		profileSheet.close();
		const conv = addDm(target);
		if (conv) openConv(conv.id);
		else toast("That name can't get messages here.");
	});
	$("pf-voice").addEventListener("click", () => startCall(viewing, false));
	$("pf-video").addEventListener("click", () => startCall(viewing, true));
	$("pf-edit").addEventListener("click", () => {
		profileSheet.close();
		openEdit();
	});
	$("me-open").addEventListener("click", () => me && openProfile(me.name));

	/* ---------- your profile ---------- */

	const editSheet = $("edit");
	let draft = null; // the look you're making, while you edit it
	let pendingPic; // your picture: undefined: unchanged, null: removed, string: new
	let pendingBanner; // a new banner picture, when you've chosen one

	function editError(text) {
		$("edit-error").textContent = text;
		$("edit-error").hidden = !text;
	}

	function openEdit() {
		if (!me) return;
		draft = lookOf(me.key);
		pendingPic = undefined;
		pendingBanner = undefined;
		editError("");
		$("edit-url").value = "";
		$("edit-url-row").hidden = true;
		toggleEmojiGrid(false);
		$("edit-status").value = draft.status;
		$("edit-pronouns").value = draft.pronouns;
		$("edit-bio").value = draft.bio;
		renderPreview();
		editSheet.showModal();
	}
	editSheet.addEventListener("close", () => (draft = null));

	// Your profile as it'll look, from the choices and the boxes as they are now.
	function draftLook() {
		return {
			...draft,
			pfp: pendingPic === undefined ? draft.pfp : pendingPic,
			pronouns: plainText($("edit-pronouns").value, MAX_PRONOUNS),
			status: plainText($("edit-status").value, MAX_STATUS),
			bio: $("edit-bio").value.slice(0, MAX_BIO),
		};
	}

	function draftBanner() {
		if (draft.banner !== "picture") return null;
		return typeof pendingBanner === "string" ? pendingBanner : bannerPicture(me.key, draft.bannerAt);
	}

	// Your picture drawn the way it would look (not your saved one).
	function draftFace(look, size) {
		const el = h("span", { class: "avatar", "aria-hidden": "true" });
		el.dataset.name = me.name;
		el.dataset.nodot = "";
		el.style.setProperty("--size", `${size}px`);
		paintAvatar(el, look);
		return el;
	}

	function renderPreview() {
		if (!draft || !me) return;
		const look = draftLook();
		const tint = tintOf(me.name, look);
		editSheet.style.setProperty("--pf", tint);

		// the profile card
		paintBanner($("ed-banner"), look, tint, draftBanner());
		$("ed-avatar").replaceChildren(draftFace(look, 84), h("span", { class: "avatar-hint", "aria-hidden": "true" }, icon("camera")));
		$("ed-name").textContent = me.name;
		$("ed-pronouns").textContent = look.pronouns;
		$("ed-pronouns").hidden = !look.pronouns;
		const { level } = levelForXp(statsFor(me.name).xp);
		$("ed-level").textContent = `Level ${level} · ${rankFor(level).name}`;
		$("ed-mood-emoji").textContent = look.statusEmoji;
		$("ed-mood-text").textContent = look.status;
		$("ed-mood").hidden = !moodOf(look);
		$("ed-bio").textContent = look.bio.trim() || "Your bio shows here.";
		$("ed-bio").classList.toggle("empty", !look.bio.trim());

		// and in a chat
		$("ed-msg-avatar").replaceChildren(draftFace(look, 34));
		$("ed-msg-name").textContent = me.name;
		$("ed-msg-name").classList.toggle("colored", Boolean(look.color));
		if (look.color) $("ed-msg-name").style.setProperty("--name", look.color);
		else $("ed-msg-name").style.removeProperty("--name");

		$("edit-remove").hidden = !look.pfp;
		$("edit-count").textContent = `${$("edit-bio").value.length}/${MAX_BIO}`;
		$("edit-emoji").replaceChildren(look.statusEmoji || icon("smile"));

		// the choices, drawn with your picture and color
		for (const btn of $("edit-frames").children) {
			btn.setAttribute("aria-pressed", String(btn.dataset.value === look.frame));
			btn.querySelector(".frame-face").replaceChildren(draftFace({ ...look, frame: btn.dataset.value }, 36));
		}
		for (const el of $("edit-colors").querySelectorAll("[data-value]")) el.setAttribute("aria-pressed", String(el.dataset.value === (look.color || "auto")));
		$("edit-color-auto").style.setProperty("--swatch", colorFor(me.name));
		const custom = look.color && !PROFILE_COLORS.includes(look.color) ? look.color : null;
		$("edit-color-custom").classList.toggle("on", Boolean(custom));
		if (custom) $("edit-color-custom").style.setProperty("--swatch", custom);
		else $("edit-color-custom").style.removeProperty("--swatch");
		$("edit-color-input").value = look.color || colorFor(me.name).toLowerCase();
		for (const btn of $("edit-banners").querySelectorAll("[data-value]")) {
			btn.style.setProperty("--tint", tint);
			btn.setAttribute("aria-pressed", String(btn.dataset.value === look.banner));
		}
		// (your banner picture, new or saved, stays a choice)
		const picTile = $("edit-banner-pic");
		picTile.hidden = !(typeof pendingBanner === "string" || draft.bannerAt);
		const tilePic = typeof pendingBanner === "string" ? pendingBanner : draft.bannerAt ? bannerPicture(me.key, draft.bannerAt) : null;
		paintBanner(picTile, { banner: "picture" }, tint, tilePic);
	}

	function pick(change) {
		if (!draft) return;
		Object.assign(draft, change);
		renderPreview();
	}

	// The choices (made once: renderPreview shows which one is picked).
	for (const [id, label] of FRAMES) {
		$("edit-frames").append(
			h(
				"button",
				{ class: "frame-tile", type: "button", "data-value": id, "aria-pressed": "false", onclick: () => pick({ frame: id }) },
				h("span", { class: "frame-face" }),
				h("span", { class: "frame-label", text: label }),
			),
		);
	}

	{
		const input = h("input", { id: "edit-color-input", type: "color", "aria-label": "Any color" });
		input.addEventListener("input", () => pick({ color: hex6(input.value) }));
		$("edit-colors").append(
			h("button", { id: "edit-color-auto", class: "swatch auto", type: "button", "data-value": "auto", title: "From your name", "aria-label": "Color from your name", onclick: () => pick({ color: null }) }),
			...PROFILE_COLORS.map((color) => {
				const el = h("button", { class: "swatch", type: "button", "data-value": color, title: color, "aria-label": `Color ${color}`, onclick: () => pick({ color }) });
				el.style.setProperty("--swatch", color);
				return el;
			}),
			h("label", { id: "edit-color-custom", class: "swatch custom", title: "Any color" }, input),
		);
	}

	for (const [id, label] of BANNERS) {
		$("edit-banners").append(
			h("button", { class: "banner banner-tile", type: "button", "data-value": id, "data-banner": id, title: label, "aria-label": `${label} banner`, "aria-pressed": "false", onclick: () => pick({ banner: id }) }),
		);
	}
	$("edit-banners").append(
		h("button", { id: "edit-banner-pic", class: "banner banner-tile", type: "button", "data-value": "picture", title: "Your picture", "aria-label": "Your banner picture", "aria-pressed": "false", hidden: true, onclick: () => pick({ banner: "picture" }) }),
		h("button", { class: "banner-tile upload", type: "button", title: "Upload a picture", "aria-label": "Upload a banner picture", onclick: () => $("edit-banner-file").click() }, icon("upload")),
	);

	// Status: an emoji and a few words.
	function toggleEmojiGrid(open = $("edit-emoji-grid").hidden) {
		$("edit-emoji-grid").hidden = !open;
		$("edit-emoji").setAttribute("aria-expanded", String(open));
	}
	$("edit-emoji").addEventListener("click", () => toggleEmojiGrid());
	$("edit-emoji-grid").append(
		h("button", { class: "emoji-pick", type: "button", title: "No emoji", "aria-label": "No emoji", onclick: () => (pick({ statusEmoji: "" }), toggleEmojiGrid(false)) }, icon("none")),
		...STATUS_EMOJI.map((emoji) => h("button", { class: "emoji-pick", type: "button", text: emoji, onclick: () => (pick({ statusEmoji: emoji }), toggleEmojiGrid(false)) })),
	);
	$("edit-status-picks").append(
		...STATUS_PICKS.map(([emoji, text]) =>
			h(
				"button",
				{
					class: "status-pick",
					type: "button",
					onclick: () => {
						$("edit-status").value = text;
						pick({ statusEmoji: emoji });
					},
				},
				h("span", { text: emoji }),
				h("span", { text }),
			),
		),
	);
	$("edit-status-clear").addEventListener("click", () => {
		$("edit-status").value = "";
		pick({ statusEmoji: "" });
		$("edit-status").focus();
	});
	for (const id of ["edit-status", "edit-pronouns", "edit-bio"]) $(id).addEventListener("input", renderPreview);

	// Pictures: from a file or a link, then moved and zoomed to fit.
	async function choosePicture(blob, kind) {
		editError("");
		if (!blob.type.startsWith("image/")) return editError("That file isn't a picture.");
		try {
			const pic = await cropPicture(blob, kind);
			if (!pic || !draft) return;
			if (kind === "banner") {
				pendingBanner = pic;
				draft.banner = "picture";
			} else {
				pendingPic = pic;
			}
			renderPreview();
		} catch (err) {
			editError(err.message);
		}
	}

	for (const [id, kind] of [
		["edit-file", "avatar"],
		["edit-banner-file", "banner"],
	]) {
		$(id).addEventListener("change", () => {
			const file = $(id).files?.[0];
			$(id).value = ""; // (so picking the same file again still works)
			if (file) choosePicture(file, kind);
		});
	}
	$("ed-avatar").addEventListener("click", () => $("edit-file").click());
	$("ed-banner").addEventListener("click", () => $("edit-banner-file").click());

	$("edit-link").addEventListener("click", () => {
		$("edit-url-row").hidden = !$("edit-url-row").hidden;
		if (!$("edit-url-row").hidden) $("edit-url").focus();
	});

	async function pictureFromLink() {
		const url = $("edit-url").value.trim();
		if (!url) return;
		if (!/^https?:\/\/\S+$/i.test(url)) return editError("Picture links start with https://");
		editError("");
		$("edit-url-go").disabled = true;
		try {
			const blob = await fetchImage(url);
			$("edit-url").value = "";
			$("edit-url-row").hidden = true;
			await choosePicture(blob, "avatar");
		} catch (err) {
			editError(`Couldn't use that picture: ${err.message}`);
		} finally {
			$("edit-url-go").disabled = false;
		}
	}
	$("edit-url-go").addEventListener("click", pictureFromLink);
	$("edit-url").addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		pictureFromLink();
	});

	$("edit-remove").addEventListener("click", () => {
		pendingPic = null;
		editError("");
		renderPreview();
	});

	$("edit-save").addEventListener("click", async () => {
		if (!me || !draft) return;
		if (!usableKey(me.key)) return editError("Your username has characters that can't be saved.");
		const look = draftLook();
		const old = lookOf(me.key);
		const payload = { name: me.name, bio: look.bio.trim(), updated: Date.now() };
		const pfp = pendingPic === undefined ? profiles.get(me.key)?.pfp : pendingPic;
		if (typeof pfp === "string" && pfp) payload.pfp = pfp;
		if (look.color) payload.color = look.color;
		if (look.frame !== "none") payload.frame = look.frame;
		if (look.pronouns) payload.pronouns = look.pronouns;
		if (look.status) payload.status = look.status;
		if (look.statusEmoji) payload.statusEmoji = look.statusEmoji;
		let banner = look.banner;
		$("edit-save").disabled = true;
		try {
			if (banner === "picture") {
				if (typeof pendingBanner === "string") {
					const at = Date.now();
					// (with your name: the database checks that it's yours)
					await R(`banners/${me.key}`).set({ pic: pendingBanner, at, name: me.name });
					bannerPics.set(me.key, { at, src: pendingBanner });
					payload.bannerAt = at;
				} else if (old.banner === "picture") {
					payload.bannerAt = old.bannerAt;
				} else {
					banner = "color";
				}
			}
			if (banner !== "color") payload.banner = banner;
			await R(`profiles/${me.key}`).set(payload);
			// (a banner picture you've stopped using isn't kept)
			if (old.banner === "picture" && banner !== "picture") R(`banners/${me.key}`).remove().catch(() => {});
			editSheet.close();
			toast("Profile saved.");
		} catch (err) {
			editError(`Couldn't save: ${err.message}`);
		} finally {
			$("edit-save").disabled = false;
		}
	});

	// "/status 🎮 Playing Roblox" sets your status without opening your profile; "/status" clears it.
	async function setStatus(raw) {
		if (!me || !usableKey(me.key)) return;
		const match = raw.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*(.*)$/su);
		const emoji = oneEmoji(match?.[1] || "");
		const text = plainText(match ? match[2] : raw, MAX_STATUS);
		try {
			await R(`profiles/${me.key}`).update({ name: me.name, status: text || null, statusEmoji: emoji || null, updated: Date.now() });
			toast(emoji || text ? `Status: ${[emoji, text].filter(Boolean).join(" ")}` : "Status cleared.");
		} catch (err) {
			toast(`Couldn't set your status: ${err.message}`);
		}
	}

	/* ---------- fitting a picture: moving and zooming it ---------- */

	const cropSheet = $("crop");
	const cropStage = $("crop-stage");
	const cropImg = $("crop-img");
	const cropZoom = $("crop-zoom");
	let crop = null; // { kind, url, img, iw, ih, base, zoom, x, y, done }
	let cropDrag = null;

	// Shows the picture to move and zoom, and gives back the part you chose (or null).
	function cropPicture(blob, kind) {
		return new Promise((resolve, reject) => {
			finishCrop(null);
			const url = URL.createObjectURL(blob);
			const img = new Image();
			img.onload = () => {
				crop = { kind, url, img, iw: img.naturalWidth, ih: img.naturalHeight, base: 1, zoom: 1, x: 0, y: 0, done: resolve };
				cropImg.src = url;
				cropImg.style.width = `${crop.iw}px`;
				cropImg.style.height = `${crop.ih}px`;
				cropSheet.dataset.kind = kind;
				$("crop-title").textContent = kind === "banner" ? "Fit your banner" : "Fit your picture";
				cropSheet.showModal();
				fitCrop();
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error("Couldn't open that picture."));
			};
			img.src = url;
		});
	}

	// (sizes as laid out: the sheet may still be springing open)
	const stageSize = () => [cropStage.clientWidth, cropStage.clientHeight];

	function fitCrop() {
		const [W, H] = stageSize();
		crop.base = Math.max(W / crop.iw, H / crop.ih);
		crop.zoom = 1;
		crop.x = (W - crop.iw * crop.base) / 2;
		crop.y = (H - crop.ih * crop.base) / 2;
		cropZoom.value = "1";
		placeCrop();
	}

	// (the picture always covers the frame)
	function placeCrop() {
		const [W, H] = stageSize();
		const s = crop.base * crop.zoom;
		crop.x = Math.min(0, Math.max(W - crop.iw * s, crop.x));
		crop.y = Math.min(0, Math.max(H - crop.ih * s, crop.y));
		cropImg.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${s})`;
	}

	// Zooms around a point in the frame (its middle, unless given).
	function zoomCrop(zoom, cx, cy) {
		if (!crop) return;
		const [W, H] = stageSize();
		const before = crop.zoom;
		crop.zoom = Math.min(4, Math.max(1, zoom));
		const ratio = crop.zoom / before;
		cx ??= W / 2;
		cy ??= H / 2;
		crop.x = cx - (cx - crop.x) * ratio;
		crop.y = cy - (cy - crop.y) * ratio;
		cropZoom.value = String(crop.zoom);
		placeCrop();
	}

	cropZoom.addEventListener("input", () => zoomCrop(Number(cropZoom.value)));
	cropStage.addEventListener(
		"wheel",
		(event) => {
			if (!crop) return;
			event.preventDefault();
			const box = cropStage.getBoundingClientRect();
			const scale = box.width / cropStage.clientWidth || 1;
			zoomCrop(crop.zoom * Math.exp(-event.deltaY * 0.0015), (event.clientX - box.left) / scale, (event.clientY - box.top) / scale);
		},
		{ passive: false },
	);
	cropStage.addEventListener("pointerdown", (event) => {
		if (!crop || event.button !== 0) return;
		cropStage.setPointerCapture(event.pointerId);
		cropDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: crop.x, oy: crop.y };
		cropStage.classList.add("dragging");
	});
	cropStage.addEventListener("pointermove", (event) => {
		if (!crop || cropDrag?.id !== event.pointerId) return;
		crop.x = cropDrag.ox + event.clientX - cropDrag.x;
		crop.y = cropDrag.oy + event.clientY - cropDrag.y;
		placeCrop();
	});
	for (const type of ["pointerup", "pointercancel"]) {
		cropStage.addEventListener(type, (event) => {
			if (cropDrag?.id !== event.pointerId) return;
			cropDrag = null;
			cropStage.classList.remove("dragging");
		});
	}
	// Arrow keys move it, + and - zoom.
	cropStage.addEventListener("keydown", (event) => {
		if (!crop) return;
		const step = event.shiftKey ? 24 : 6;
		const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		if (moves[event.key]) {
			crop.x += moves[event.key][0];
			crop.y += moves[event.key][1];
			placeCrop();
		} else if (event.key === "+" || event.key === "=") zoomCrop(crop.zoom * 1.1);
		else if (event.key === "-") zoomCrop(crop.zoom / 1.1);
		else return;
		event.preventDefault();
	});

	$("crop-use").addEventListener("click", () => {
		if (!crop) return;
		const [W, H] = stageSize();
		const s = crop.base * crop.zoom;
		const [outW, outH] = crop.kind === "banner" ? [600, 200] : [160, 160];
		try {
			const canvas = document.createElement("canvas");
			canvas.width = outW;
			canvas.height = outH;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#120c22"; // (under see-through pictures)
			ctx.fillRect(0, 0, outW, outH);
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(crop.img, -crop.x / s, -crop.y / s, W / s, H / s, 0, 0, outW, outH);
			finishCrop(canvas.toDataURL("image/jpeg", crop.kind === "banner" ? 0.74 : 0.84));
		} catch {
			finishCrop(null);
			editError("Couldn't use that picture.");
		}
	});
	cropSheet.addEventListener("close", () => finishCrop(null));

	function finishCrop(result) {
		if (!crop) return;
		const { url, done } = crop;
		crop = null;
		cropDrag = null;
		cropStage.classList.remove("dragging");
		URL.revokeObjectURL(url);
		cropImg.removeAttribute("src");
		if (cropSheet.open) cropSheet.close();
		done(result);
	}

	/* ---------- sharing the page you're on in Slow ---------- */

	const shareSheet = $("share");
	let shareLink = "";

	function openShare(url, title) {
		let host = "";
		try {
			const parsed = new URL(url);
			if (!/^https?:$/.test(parsed.protocol)) return;
			host = parsed.hostname.replace(/^www\./, "");
		} catch {
			return;
		}
		shareLink = url;
		$("share-page").textContent = title && title !== host ? title : host;
		$("share-host").textContent = host;
		$("share-find").value = "";
		renderShare();
		if (!shareSheet.open) shareSheet.showModal();
		$("share-find").focus();
	}

	// Your chats, the one that's open first, then the newest.
	function renderShare() {
		const query = $("share-find").value.trim().toLowerCase();
		const list = [...convs.values()]
			.filter((c) => !query || c.title.toLowerCase().includes(query))
			.sort((a, b) => (a === current ? -1 : b === current ? 1 : convTime(b) - convTime(a)));
		$("share-list").replaceChildren(
			...list.map((conv) =>
				h(
					"button",
					{ class: "person-row", type: "button", onclick: () => shareTo(conv.id) },
					convAvatar(conv, 32),
					h("span", { class: "person-row-name", text: conv.title }),
					conv === current ? h("span", { class: "share-now", text: "Open now" }) : null,
				),
			),
		);
		if (!list.length) $("share-list").append(h("p", { class: "empty", text: "No chats match that." }));
	}

	// The chat opens with the link in its message box (after anything you'd started writing), to send with Enter.
	function shareTo(id) {
		const link = shareLink;
		shareSheet.close();
		openConv(id);
		const before = textEl.value.trimEnd();
		putText(before ? `${before} ${link}` : link);
	}

	$("share-find").addEventListener("input", renderShare);
	$("share-find").addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		const first = $("share-list").querySelector("button");
		if (!first) return;
		event.preventDefault();
		first.click();
	});

	/* ---------- finding people ---------- */

	let nameList = null; // every username, loaded when needed
	async function allNames() {
		try {
			nameList = Object.keys(await usernames());
		} catch {
			nameList ||= [];
		}
		return nameList;
	}

	function personRow(name, { onclick, picked = false, picker = false } = {}) {
		return h(
			"button",
			{ class: `person-row${picked ? " picked" : ""}`, type: "button", "aria-pressed": picker ? String(picked) : null, onclick },
			avatar(name, 32),
			h("span", { class: "person-row-name", text: name }),
			picker && h("span", { class: "tick", "aria-hidden": "true" }, icon("check")),
		);
	}

	function matchNames(names, query, exclude = new Set()) {
		const q = keyOf(query.trim());
		const list = names.filter((n) => !exclude.has(keyOf(n)) && keyOf(n) !== me.key);
		if (!q) return [];
		return list
			.filter((n) => keyOf(n).includes(q))
			.sort((a, b) => keyOf(a).indexOf(q) - keyOf(b).indexOf(q) || a.length - b.length)
			.slice(0, 8);
	}

	const newDmSheet = $("new-dm");
	$("btn-new-dm").addEventListener("click", async () => {
		$("new-dm-name").value = "";
		$("new-dm-error").hidden = true;
		renderNewDm();
		newDmSheet.showModal();
		$("new-dm-name").focus();
		await allNames();
		renderNewDm();
	});

	function renderNewDm() {
		const query = $("new-dm-name").value;
		const results = $("new-dm-results");
		const start = (name) => {
			newDmSheet.close();
			const conv = addDm(name);
			if (conv) openConv(conv.id);
		};
		let names = matchNames(nameList || [], query);
		if (!query.trim()) {
			// Before typing: people online now.
			names = [...online].filter((k) => k !== me.key).map(displayName).slice(0, 8);
			results.replaceChildren(
				...(names.length ? [h("p", { class: "label", text: "Online now" }), ...names.map((n) => personRow(n, { onclick: () => start(n) }))] : []),
			);
			return;
		}
		results.replaceChildren(
			...(names.length ? names.map((n) => personRow(n, { onclick: () => start(n) })) : [h("p", { class: "empty", text: nameList ? "Nobody's called that." : "Looking…" })]),
		);
	}
	$("new-dm-name").addEventListener("input", renderNewDm);
	$("new-dm-name").addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			$("new-dm-results").querySelector(".person-row")?.click();
		}
	});

	/* ---------- groups ---------- */

	const groupSheet = $("group");
	let groupMode = "create";
	let groupTarget = null;
	let picked = new Map(); // key -> name

	function openGroupSheet(mode, conv = null) {
		groupMode = mode;
		groupTarget = conv;
		picked = new Map();
		$("group-title").textContent = mode === "add" ? `Add people to ${conv.title}` : "New group";
		$("group-confirm").textContent = mode === "add" ? "Add" : "Create group";
		$("group-name-field").hidden = mode === "add";
		$("group-name").value = "";
		$("group-find").value = "";
		$("group-error").hidden = true;
		renderGroupPeople();
		groupSheet.showModal();
		(mode === "add" ? $("group-find") : $("group-name")).focus();
		allNames().then(renderGroupPeople);
	}
	$("btn-new-group").addEventListener("click", () => openGroupSheet("create"));

	function renderGroupPeople() {
		const members = new Set(groupMode === "add" ? Object.keys(groupTarget?.members || {}) : []);
		const query = $("group-find").value;
		const suggestions = query.trim()
			? matchNames(nameList || [], query, members)
			: [...convs.values()].filter((c) => c.kind === "dm" && !members.has(keyOf(c.peer))).map((c) => c.peer).slice(0, 8);
		const toggle = (name) => {
			const key = keyOf(name);
			if (picked.has(key)) picked.delete(key);
			else picked.set(key, name);
			renderGroupPeople();
		};
		const chosen = [...picked.values()];
		const rest = suggestions.filter((n) => !picked.has(keyOf(n)));
		$("group-people").replaceChildren(
			...chosen.map((n) => personRow(n, { picker: true, picked: true, onclick: () => toggle(n) })),
			...rest.map((n) => personRow(n, { picker: true, onclick: () => toggle(n) })),
		);
		if (!chosen.length && !rest.length) {
			$("group-people").append(h("p", { class: "empty", text: query.trim() ? (nameList ? "Nobody's called that." : "Looking…") : "Search for people to add." }));
		}
		$("group-confirm").disabled = !chosen.length;
	}
	$("group-find").addEventListener("input", renderGroupPeople);

	$("group-confirm").addEventListener("click", async () => {
		const names = [...picked.values()].filter((n) => usableKey(keyOf(n)));
		if (!names.length) return;
		$("group-confirm").disabled = true;
		try {
			if (groupMode === "create") {
				const gid = R("groups").push().key;
				const everyone = [me.name, ...names];
				const updates = {};
				const members = {};
				for (const n of everyone) {
					members[keyOf(n)] = { name: n, addedAt: Date.now() };
					updates[`userGroups/${keyOf(n)}/${gid}`] = true;
				}
				updates[`groups/${gid}/name`] = $("group-name").value.trim().slice(0, 40) || names.join(", ").slice(0, 60);
				updates[`groups/${gid}/createdBy`] = me.name;
				updates[`groups/${gid}/createdAt`] = Date.now();
				updates[`groups/${gid}/members`] = members;
				await R().update(updates);
				groupSheet.close();
				const conv = addGroup(gid);
				if (conv) openConv(conv.id);
			} else {
				const gid = groupTarget.gid;
				const updates = {};
				for (const n of names) {
					updates[`groups/${gid}/members/${keyOf(n)}`] = { name: n, addedAt: Date.now() };
					updates[`userGroups/${keyOf(n)}/${gid}`] = true;
				}
				await R().update(updates);
				groupSheet.close();
				toast(`Added ${names.join(", ")}.`);
			}
		} catch (err) {
			$("group-error").textContent = `That didn't work: ${err.message}`;
			$("group-error").hidden = false;
		} finally {
			$("group-confirm").disabled = false;
		}
	});

	async function leaveGroup(conv) {
		const ok = await confirmSheet({ title: `Leave ${conv.title}?`, text: "You can come back if someone adds you again.", yes: "Leave" });
		if (!ok) return;
		if (group?.conv === conv) leaveGroupCall();
		const updates = {};
		updates[`groups/${conv.gid}/members/${me.key}`] = null;
		updates[`userGroups/${me.key}/${conv.gid}`] = null;
		R().update(updates).catch(() => {});
		removeConv(conv.id);
	}

	function openMembers(conv) {
		const list = Object.values(conv.members || {})
			.map((m) => String(m?.name ?? ""))
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
		openMenu($("room-info"), [
			...list.map((name) => ({ label: name, person: name, run: () => openProfile(name) })),
			{ separator: true },
			{ label: "Add people", icon: "plus", run: () => openGroupSheet("add", conv) },
		]);
	}

	/* ---------- leaderboard ---------- */

	const boardSheet = $("board");
	async function openBoard() {
		const list = $("board-list");
		list.replaceChildren(h("li", { class: "empty", text: "Loading…" }));
		boardSheet.showModal();
		try {
			const snap = await R("xp").orderByChild("xp").limitToLast(20).once("value");
			const rows = Object.values(snap.val() || {})
				.filter((r) => r && r.name)
				.sort((a, b) => (Number(b.xp) || 0) - (Number(a.xp) || 0));
			if (!rows.length) {
				list.replaceChildren(h("li", { class: "empty", text: "Nobody has XP yet. Send a message to get on the board." }));
				return;
			}
			list.replaceChildren(
				...rows.map((row, i) => {
					const name = String(row.name);
					const { level } = levelForXp(row.xp);
					const rank = rankFor(level);
					const sub = h("span", { class: "board-sub", text: `Lv ${level} · ${rank.name}` });
					sub.style.color = rank.color;
					return h(
						"li",
						{ class: `board-row${keyOf(name) === me.key ? " me" : ""}` },
						h("span", { class: `board-place p${i + 1}`, text: i + 1 }),
						h(
							"button",
							{ class: "board-person", type: "button", onclick: () => openProfile(name) },
							avatar(name, 32),
							h("span", { class: "board-text" }, h("span", { class: "board-name", text: name }), sub),
						),
						h("span", { class: "board-xp", text: `${Number(row.xp || 0).toLocaleString()} XP` }),
					);
				}),
			);
		} catch {
			list.replaceChildren(h("li", { class: "empty", text: "Couldn't load the leaderboard." }));
		}
	}

	/* ---------- yes/no ---------- */

	const confirmEl = $("confirm");
	function confirmSheet({ title, text, yes = "OK", danger = true, only = false }) {
		$("confirm-title").textContent = title;
		$("confirm-text").textContent = text || "";
		const yesBtn = $("confirm-yes");
		yesBtn.textContent = yes;
		yesBtn.className = danger ? "btn danger" : "btn primary";
		confirmEl.querySelector("[data-close]").hidden = only;
		confirmEl.returnValue = "";
		confirmEl.showModal();
		yesBtn.focus();
		return new Promise((resolve) => {
			const done = () => {
				confirmEl.removeEventListener("close", done);
				resolve(confirmEl.returnValue === "yes");
			};
			confirmEl.addEventListener("close", done);
		});
	}
	$("confirm-yes").addEventListener("click", () => confirmEl.close("yes"));

	/* ============================================================
	   MENUS AND TOASTS
	   ============================================================ */

	const menu = $("menu");
	const menuLens = window.Liquid?.lens(menu, { hover: ".menu-item" });
	let menuButton = null;

	function openMenu(button, items) {
		closeMenu();
		menuButton = button;
		button.setAttribute("aria-expanded", "true");
		menu.replaceChildren(
			...(menuLens ? [menuLens.el] : []),
			...items.map((item) => {
				if (item.separator) return h("div", { class: "menu-sep", role: "separator" });
				return h(
					"button",
					{
						class: `menu-item${item.danger ? " danger" : ""}`,
						type: "button",
						role: item.checked === undefined ? "menuitem" : "menuitemcheckbox",
						"aria-checked": item.checked === undefined ? null : String(item.checked),
						onclick: () => {
							closeMenu();
							item.run?.();
						},
					},
					item.person ? avatar(item.person, 22) : item.icon ? icon(item.icon) : null,
					h("span", { text: item.label }),
					item.checked !== undefined && h("span", { class: `switch${item.checked ? " on" : ""}`, "aria-hidden": "true" }),
				);
			}),
		);
		menu.hidden = false;
		menuLens?.to(null, { instant: true });
		// Below the button, or above it when there's no room.
		const box = button.getBoundingClientRect();
		const { width, height } = menu.getBoundingClientRect();
		const left = Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8));
		const below = box.bottom + 6;
		const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 6) : below;
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
		menu.querySelector(".menu-item")?.focus();
	}

	function closeMenu() {
		if (menu.hidden) return;
		menu.hidden = true;
		menuButton?.setAttribute("aria-expanded", "false");
		menuButton = null;
	}

	document.addEventListener("pointerdown", (event) => {
		if (!menu.hidden && !menu.contains(event.target) && !menuButton?.contains(event.target)) closeMenu();
	});
	menu.addEventListener("keydown", (event) => {
		const items = [...menu.querySelectorAll(".menu-item")];
		const at = items.indexOf(document.activeElement);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
		}
	});

	$("me-menu").addEventListener("click", (event) => {
		openMenu(event.currentTarget, [
			{ label: "Your profile", icon: "user", run: () => openProfile(me.name) },
			{ label: "Leaderboard", icon: "trophy", run: openBoard },
			{ separator: true },
			{ label: "Sounds", icon: "sound", checked: prefs.sounds, run: () => ((prefs.sounds = !prefs.sounds), savePrefs()) },
			{ label: "Message pop-ups", icon: "bell", checked: prefs.notify, run: () => ((prefs.notify = !prefs.notify), savePrefs()) },
			{ separator: true },
			{ label: "Log out", icon: "out", danger: true, run: () => {
				endSession();
				auth.signOut();
			} },
		]);
	});

	function toast(text, { person = null, title = null, onclick = null, sticky = false } = {}) {
		const stack = $("toasts");
		const el = h(
			"button",
			{ class: `toast${onclick ? " clickable" : ""}`, type: "button" },
			person ? avatar(person, title ? 34 : 28, { dot: false }) : null,
			h("span", { class: "toast-body" }, title && h("span", { class: "toast-title", text: title }), h("span", { class: "toast-text", text })),
		);
		const dismiss = () => {
			el.classList.add("leaving");
			setTimeout(() => el.remove(), 250);
		};
		el.addEventListener("click", () => {
			onclick?.();
			dismiss();
		});
		stack.append(el);
		while (stack.children.length > 3) stack.firstElementChild.remove();
		setTimeout(dismiss, sticky ? 7000 : 4000);
	}

	/* ============================================================
	   CALLS
	   Voice and video go straight between the people in the call (WebRTC), set up through
	   the database in the same way as the Moonplayer chatroom, so calls work between the two.
	   Only public STUN servers are used: two networks that both block direct connections
	   can't call each other (that needs a TURN relay server, which costs money).
	   ============================================================ */

	const RTC = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
	const callEl = $("call");
	const stage = $("call-stage");
	let call = null; // a call with one person
	let ringingCall = null; // { ref, data, offs, timer }
	let group = null; // a group call

	function media(video) {
		if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(Object.assign(new Error("insecure"), { name: "Insecure" }));
		return navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true },
			video: video ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
		});
	}

	function callError(err) {
		const name = err?.name;
		const text =
			name === "Insecure"
				? "Calls need Slow to be opened over https (or on this computer)."
				: name === "NotAllowedError" || name === "SecurityError"
					? "Your browser didn't let Slow use your microphone or camera. Allow it from the icon at the left of the address bar, then try again."
					: name === "NotFoundError" || name === "OverconstrainedError"
						? "Couldn't find a microphone or camera."
						: name === "NotReadableError"
							? "Another app is using your microphone or camera."
							: err?.message || "Something went wrong starting the call.";
		confirmSheet({ title: "Can't start the call", text, yes: "OK", danger: false, only: true });
	}

	// ICE candidates can arrive before the other side's description; they wait until it's in.
	function addCandidate(peer, candidate) {
		if (!peer?.pc || !candidate) return;
		if (peer.pc.remoteDescription) peer.pc.addIceCandidate(candidate).catch(() => {});
		else peer.pending.push(candidate);
	}
	async function setRemote(peer, description) {
		await peer.pc.setRemoteDescription(new RTCSessionDescription(description));
		for (const candidate of peer.pending.splice(0)) peer.pc.addIceCandidate(candidate).catch(() => {});
	}

	/* ---------- the call screen ---------- */

	let callTimer = 0;
	function showCallScreen() {
		callEl.hidden = false;
		$("call-pill").hidden = true;
	}
	function minimizeCall() {
		callEl.hidden = true;
		$("call-pill").hidden = !(call || group);
	}
	function hideCallScreen() {
		callEl.hidden = true;
		$("call-pill").hidden = true;
		callEl.classList.remove("wide");
		slow?.setWide?.(false);
		slow?.setCall?.(null);
		clearInterval(callTimer);
		stage.replaceChildren();
		$("audio-sink").replaceChildren();
	}
	function setCallStatus(text) {
		$("call-status").textContent = text;
		$("call-pill-text").textContent = text ? `${$("call-who").textContent} · ${text}` : $("call-who").textContent;
		slow?.setCall?.({ text: $("call-pill-text").textContent });
	}
	function startTimer(since) {
		clearInterval(callTimer);
		const tick = () => {
			const secs = Math.floor((Date.now() - since) / 1000);
			setCallStatus(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
		};
		tick();
		callTimer = setInterval(tick, 1000);
	}

	$("call-min").addEventListener("click", minimizeCall);
	$("call-pill").addEventListener("click", showCallScreen);
	$("call-wide").addEventListener("click", () => {
		const on = !callEl.classList.contains("wide");
		callEl.classList.toggle("wide", on);
		slow?.setWide?.(on);
	});
	$("call-hangup").addEventListener("click", () => (group ? leaveGroupCall() : endCall(true)));

	$("call-mute").addEventListener("click", () => {
		const stream = call?.stream || group?.stream;
		const tracks = stream?.getAudioTracks() || [];
		if (!tracks.length) return;
		const on = !tracks[0].enabled;
		for (const t of tracks) t.enabled = on;
		$("call-mute").setAttribute("aria-pressed", String(!on));
		$("call-mute").setAttribute("aria-label", on ? "Mute" : "Unmute");
		if (group) group.tiles.get(me.key)?.classList.toggle("muted", !on);
	});

	$("call-cam").addEventListener("click", () => {
		const stream = call?.stream || group?.stream;
		const tracks = stream?.getVideoTracks() || [];
		if (!tracks.length) return;
		const on = !tracks[0].enabled;
		for (const t of tracks) t.enabled = on;
		$("call-cam").setAttribute("aria-pressed", String(!on));
		$("call-cam").setAttribute("aria-label", on ? "Turn camera off" : "Turn camera on");
		stage.querySelector("video.self")?.classList.toggle("off", !on);
		if (group) showTileVideo(me.key);
	});

	function resetCallButtons(video) {
		$("call-mute").setAttribute("aria-pressed", "false");
		$("call-mute").setAttribute("aria-label", "Mute");
		$("call-cam").setAttribute("aria-pressed", "false");
		$("call-cam").setAttribute("aria-label", "Turn camera off");
		$("call-cam").hidden = !video;
	}

	/* ---------- calling one person ---------- */

	function duoStage(peer, stream, video) {
		const remote = h("video", { class: "remote", autoplay: true, playsinline: true, hidden: true });
		remote.muted = true; // (its sound plays from the audio element)
		const self = h("video", { class: "self", autoplay: true, playsinline: true, hidden: !video });
		self.muted = true;
		self.srcObject = stream;
		const face = h("div", { class: "face" }, avatar(peer, 104, { dot: false }));
		stage.replaceChildren(h("div", { class: "duo" }, face, remote, self));
		const audio = h("audio", { autoplay: true });
		$("audio-sink").replaceChildren(audio);
		return { remote, face, audio };
	}

	function duoPeer(c, candidatePath) {
		const pc = new RTCPeerConnection(RTC);
		for (const track of c.stream.getTracks()) pc.addTrack(track, c.stream);
		pc.onicecandidate = (event) => {
			if (event.candidate && c.ref) c.ref.child(candidatePath).push(event.candidate.toJSON()).catch(() => {});
		};
		pc.ontrack = (event) => {
			const stream = event.streams[0];
			c.view.audio.srcObject = stream;
			c.view.remote.srcObject = stream;
			if (c.video) {
				c.view.remote.hidden = false;
				c.view.face.hidden = true;
			}
		};
		pc.onconnectionstatechange = () => {
			if (call !== c) return;
			if (pc.connectionState === "connected" && !c.startedAt) {
				c.startedAt = Date.now();
				stopRing();
				clearTimeout(c.noAnswer);
				playSound("connect");
				awardXp(10, "call", 30000);
				startTimer(c.startedAt);
			} else if (pc.connectionState === "failed") {
				setCallStatus("Couldn't connect");
				setTimeout(() => endCall(true), 1500);
			}
		};
		return pc;
	}

	function openDuoScreen(c, status) {
		$("call-who").textContent = c.peer;
		c.view = duoStage(c.peer, c.stream, c.video);
		resetCallButtons(c.video);
		showCallScreen();
		setCallStatus(status);
		slow?.open?.();
	}

	async function startCall(target, video) {
		if (!me || !target || keyOf(target) === me.key) return;
		if (call || ringingCall || group) return toast("You're already in a call.");
		const targetKey = keyOf(target);
		if (!usableKey(targetKey)) return callError(new Error("That name can't get calls."));
		profileSheet.close();
		let stream;
		try {
			stream = await media(video);
		} catch (err) {
			return callError(err);
		}
		const c = { role: "caller", peer: target, video, stream, ref: R(`calls/${targetKey}`).push(), pc: null, pending: [], startedAt: 0, offs: [] };
		call = c;
		openDuoScreen(c, "Ringing…");
		ringLoop("ringback");
		c.pc = duoPeer(c, "callerCandidates");
		try {
			const offer = await c.pc.createOffer();
			await c.pc.setLocalDescription(offer);
			if (call !== c) return;
			await c.ref.set({
				from: me.name,
				fromKey: me.key,
				to: target,
				type: video ? "video" : "audio",
				offer: { type: offer.type, sdp: offer.sdp },
				status: "ringing",
				ts: Date.now(),
			});
			c.ref.onDisconnect().remove();
		} catch (err) {
			endCall(false);
			return callError(err);
		}
		listen(c.ref, "value", (snap) => onCallChange(c, snap.val()), c.offs);
		listen(c.ref.child("calleeCandidates"), "child_added", (snap) => addCandidate(c, snap.val()), c.offs);
		c.noAnswer = setTimeout(() => {
			if (call === c && !c.startedAt) {
				setCallStatus("No answer");
				setTimeout(() => call === c && endCall(true), 1500);
			}
		}, 45_000);
	}

	async function onCallChange(c, data) {
		if (call !== c) return;
		if (!data) return endCall(false);
		if (c.role === "caller" && data.answer && !c.pc.currentRemoteDescription) {
			setCallStatus("Connecting…");
			try {
				await setRemote(c, data.answer);
			} catch {}
		}
		if (data.status === "declined") {
			setCallStatus("Declined");
			setTimeout(() => call === c && endCall(false), 1400);
		} else if (data.status === "busy") {
			setCallStatus("They're on another call");
			setTimeout(() => call === c && endCall(false), 1600);
		} else if (data.status === "ended") {
			endCall(false);
		}
	}

	function watchCalls() {
		if (!usableKey(me.key)) return;
		listen(R(`calls/${me.key}`), "child_added", (snap) => {
			const data = snap.val();
			if (!data || data.status !== "ringing") return;
			if (data.ts && data.ts < joinedAt - 10_000) {
				snap.ref.remove().catch(() => {}); // a ring left over from before
				return;
			}
			if (call || ringingCall || group) {
				snap.ref.update({ status: "busy" }).catch(() => {});
				return;
			}
			ringingCall = { ref: snap.ref, data, offs: [] };
			const from = String(data.from ?? "Someone");
			$("ring-avatar").replaceChildren(avatar(from, 44, { dot: false }));
			$("ring-name").textContent = from;
			$("ring-kind").textContent = data.type === "video" ? "Video call" : "Voice call";
			$("ringing").hidden = false;
			ringLoop("incoming");
			slow?.incomingCall?.(from, data.type === "video");
			listen(snap.ref, "value", (s) => {
				const v = s.val();
				if (!v || v.status === "ended") dismissRinging();
			}, ringingCall.offs);
			ringingCall.timer = setTimeout(declineCall, 45_000);
		}, session);
	}

	function dismissRinging() {
		if (!ringingCall) return;
		stopRing();
		stopAll(ringingCall.offs);
		clearTimeout(ringingCall.timer);
		ringingCall = null;
		$("ringing").hidden = true;
		slow?.incomingCall?.(null);
	}

	function declineCall() {
		ringingCall?.ref.update({ status: "declined" }).catch(() => {});
		dismissRinging();
	}

	async function acceptCall() {
		if (!ringingCall) return;
		const { ref, data } = ringingCall;
		const video = data.type === "video";
		dismissRinging();
		let stream;
		try {
			stream = await media(video);
		} catch (err) {
			ref.update({ status: "declined" }).catch(() => {});
			return callError(err);
		}
		const c = { role: "callee", peer: String(data.from ?? "Someone"), video, stream, ref, pc: null, pending: [], startedAt: 0, offs: [] };
		call = c;
		openDuoScreen(c, "Connecting…");
		c.pc = duoPeer(c, "calleeCandidates");
		try {
			await setRemote(c, data.offer);
			const answer = await c.pc.createAnswer();
			await c.pc.setLocalDescription(answer);
			await ref.update({ answer: { type: answer.type, sdp: answer.sdp }, status: "accepted" });
		} catch (err) {
			endCall(true);
			return callError(err);
		}
		listen(ref, "value", (snap) => onCallChange(c, snap.val()), c.offs);
		listen(ref.child("callerCandidates"), "child_added", (snap) => addCandidate(c, snap.val()), c.offs);
	}

	$("ring-accept").addEventListener("click", acceptCall);
	$("ring-decline").addEventListener("click", declineCall);

	function endCall(tellThem) {
		const c = call;
		if (!c) return;
		call = null;
		stopRing();
		clearTimeout(c.noAnswer);
		stopAll(c.offs);
		if (c.ref) {
			c.ref.onDisconnect().cancel();
			if (tellThem) c.ref.update({ status: "ended" }).catch(() => {});
			// The caller made the call's entry, so the caller tidies it away.
			if (c.role === "caller") setTimeout(() => c.ref.remove().catch(() => {}), 2000);
		}
		try {
			c.pc?.close();
		} catch {}
		for (const track of c.stream?.getTracks() || []) track.stop();
		hideCallScreen();
		if (c.startedAt) {
			playSound("end");
			const secs = Math.floor((Date.now() - c.startedAt) / 1000);
			const length = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
			if (current?.kind === "dm" && keyOf(current.peer) === keyOf(c.peer)) systemLine(`Call ended · ${length}`);
			else toast(`Call with ${c.peer} ended · ${length}`);
		}
	}

	/* ---------- group calls ----------
	   Everyone connects to everyone (fine for a handful of people). Signals live at
	   …/groupCall: participants/{key} = { name, joinedAt }, and
	   connections/{to}/{from} = { name, offer, answer, callerCandidates, calleeCandidates }.
	   Whoever joins later calls the people already there. */

	async function joinGroupCall(conv, video) {
		if (!conv?.callRoot || !me) return;
		if (group) {
			if (group.conv === conv) return showCallScreen();
			return toast("Leave your other call first.");
		}
		if (call || ringingCall) return toast("Finish your other call first.");
		if (!usableKey(me.key)) return callError(new Error("Your username can't be used for calls."));
		let stream;
		try {
			stream = await media(video);
		} catch (err) {
			return callError(err);
		}
		const root = conv.callRoot;
		const parts = root.child("participants");
		let existing = {};
		try {
			existing = (await parts.once("value")).val() || {};
			// Nobody's there: start clean, clearing anything left over from an earlier call.
			if (!Object.keys(existing).length) await root.set({ host: me.name, startedAt: Date.now() });
		} catch (err) {
			for (const track of stream.getTracks()) track.stop();
			return toast(`Couldn't join: ${err.message}`);
		}

		const g = { conv, root, parts, stream, video, peers: new Map(), tiles: new Map(), offs: [], outgoing: new Set() };
		group = g;
		g.myRef = parts.child(me.key);
		g.inbox = root.child("connections").child(me.key);

		$("call-who").textContent = conv.title;
		stage.replaceChildren(h("div", { class: "tiles" }));
		resetCallButtons(video);
		showCallScreen();
		slow?.open?.();
		renderJoinCall();
		addTile(me.key, me.name, true);

		await g.myRef.set({ name: me.name, joinedAt: Date.now() });
		g.myRef.onDisconnect().remove();
		g.inbox.onDisconnect().remove();

		for (const [key, p] of Object.entries(existing)) {
			if (key === me.key) continue;
			addTile(key, p?.name || key);
			connectTo(g, key);
		}
		listen(parts, "child_added", (snap) => {
			if (group !== g || snap.key === me.key) return;
			addTile(snap.key, snap.val()?.name || snap.key);
			updateGroupStatus();
		}, g.offs);
		listen(parts, "child_removed", (snap) => {
			if (group !== g) return;
			if (snap.key === me.key) return leaveGroupCall();
			dropPeer(g, snap.key);
			g.tiles.get(snap.key)?.remove();
			g.tiles.delete(snap.key);
			updateGroupStatus();
		}, g.offs);
		listen(g.inbox, "child_added", (snap) => answerPeer(g, snap.key, snap.val()), g.offs);
		listen(g.inbox, "child_changed", (snap) => answerPeer(g, snap.key, snap.val()), g.offs);

		updateGroupStatus();
		playSound("connect");
		awardXp(10, "call", 30000);
	}

	function updateGroupStatus() {
		if (!group) return;
		const n = group.tiles.size;
		setCallStatus(n === 1 ? "Just you so far" : `${n} in the call`);
	}

	function addTile(key, name, isMe = false) {
		const g = group;
		if (!g || g.tiles.has(key)) return;
		const video = h("video", { autoplay: true, playsinline: true, hidden: true });
		if (isMe) {
			video.muted = true; // (never hear yourself)
			video.srcObject = g.stream;
		}
		const tile = h(
			"div",
			{ class: `tile${isMe ? " me" : ""}` },
			video,
			h("div", { class: "face" }, avatar(name, 64, { dot: false })),
			h("span", { class: "tile-name", text: isMe ? `${name} (you)` : name }),
		);
		g.tiles.set(key, tile);
		stage.querySelector(".tiles")?.append(tile);
		if (isMe) showTileVideo(key);
	}

	function showTileVideo(key) {
		const tile = group?.tiles.get(key);
		const video = tile?.querySelector("video");
		const stream = video?.srcObject;
		const track = stream?.getVideoTracks?.()[0];
		const on = Boolean(track && track.enabled);
		if (!video) return;
		video.hidden = !on;
		tile.querySelector(".face").hidden = on;
	}

	function groupPeer(g, key, role) {
		const peer = { pc: new RTCPeerConnection(RTC), role, pending: [], offs: [] };
		for (const track of g.stream.getTracks()) peer.pc.addTrack(track, g.stream);
		// Joined with just your voice: still ask for other people's video.
		if (role === "caller" && !g.stream.getVideoTracks().length) peer.pc.addTransceiver("video", { direction: "recvonly" });
		peer.pc.ontrack = (event) => {
			const video = g.tiles.get(key)?.querySelector("video");
			if (!video) return;
			video.srcObject = event.streams[0];
			showTileVideo(key);
			event.track.addEventListener("unmute", () => showTileVideo(key));
		};
		peer.pc.onconnectionstatechange = () => {
			if (["failed", "closed"].includes(peer.pc.connectionState)) dropPeer(g, key);
		};
		g.peers.set(key, peer);
		return peer;
	}

	function dropPeer(g, key) {
		const peer = g.peers.get(key);
		if (!peer) return;
		g.peers.delete(key);
		stopAll(peer.offs);
		try {
			peer.pc.close();
		} catch {}
	}

	// Calling someone who was already in the call.
	async function connectTo(g, key) {
		if (g.peers.has(key) || key === me.key) return;
		const peer = groupPeer(g, key, "caller");
		const ref = g.root.child("connections").child(key).child(me.key);
		g.outgoing.add(key);
		peer.pc.onicecandidate = (event) => {
			if (event.candidate) ref.child("callerCandidates").push(event.candidate.toJSON()).catch(() => {});
		};
		try {
			await ref.remove();
			const offer = await peer.pc.createOffer();
			await peer.pc.setLocalDescription(offer);
			await ref.set({ name: me.name, offer: { type: offer.type, sdp: offer.sdp } });
			ref.onDisconnect().remove();
			listen(ref.child("answer"), "value", (snap) => {
				const answer = snap.val();
				if (answer && !peer.pc.currentRemoteDescription) setRemote(peer, answer).catch(() => {});
			}, peer.offs);
			listen(ref.child("calleeCandidates"), "child_added", (snap) => addCandidate(peer, snap.val()), peer.offs);
		} catch {
			dropPeer(g, key);
		}
	}

	// Answering someone who joined after you (or rejoined).
	async function answerPeer(g, from, data) {
		if (group !== g || !data?.offer?.sdp) return;
		const known = g.peers.get(from);
		if (known?.offerSdp === data.offer.sdp) return;
		// Both called each other at once: keep just one of the two connections.
		if (known?.role === "caller") {
			if (me.key < from) return;
			g.root.child("connections").child(from).child(me.key).remove().catch(() => {});
			g.outgoing.delete(from);
		}
		dropPeer(g, from);
		addTile(from, data.name || from);
		const peer = groupPeer(g, from, "callee");
		peer.offerSdp = data.offer.sdp;
		const ref = g.inbox.child(from);
		peer.pc.onicecandidate = (event) => {
			if (event.candidate) ref.child("calleeCandidates").push(event.candidate.toJSON()).catch(() => {});
		};
		try {
			await setRemote(peer, data.offer);
			const answer = await peer.pc.createAnswer();
			await peer.pc.setLocalDescription(answer);
			await ref.child("answer").set({ type: answer.type, sdp: answer.sdp });
			listen(ref.child("callerCandidates"), "child_added", (snap) => addCandidate(peer, snap.val()), peer.offs);
		} catch {
			dropPeer(g, from);
		}
	}

	function leaveGroupCall() {
		const g = group;
		if (!g) return;
		group = null;
		stopAll(g.offs);
		for (const key of [...g.peers.keys()]) dropPeer(g, key);
		g.myRef.onDisconnect().cancel();
		g.myRef.remove().catch(() => {});
		g.inbox.onDisconnect().cancel();
		g.inbox.remove().catch(() => {});
		for (const key of g.outgoing) {
			const ref = g.root.child("connections").child(key).child(me?.key || "");
			ref.onDisconnect().cancel();
			ref.remove().catch(() => {});
		}
		for (const track of g.stream.getTracks()) track.stop();
		hideCallScreen();
		renderJoinCall();
		playSound("end");
	}

	window.addEventListener("pagehide", () => {
		saveDraft();
		if (call) endCall(true);
		if (group) leaveGroupCall();
		clearMyTyping();
	});

	/* ============================================================
	   KEYS, AND WHAT SLOW ASKS OF THE CHAT
	   ============================================================ */

	document.addEventListener("keydown", (event) => {
		const mod = event.ctrlKey || event.metaKey;
		// Slow's Alt shortcuts work in here too (Alt+C closes the chat).
		if (event.altKey && !mod && slow) {
			if (event.code === "KeyC") {
				event.preventDefault();
				slow.toggle?.();
				return;
			}
			if (/^(KeyT|KeyW|KeyL|KeyK|Digit[1-8])$/.test(event.code)) {
				try {
					if (window.parent.__slowKey?.(event.code, event.shiftKey)) event.preventDefault();
				} catch {}
				return;
			}
		}
		// Ctrl+K: Slow's search, from in here too.
		if (mod && !event.altKey && !event.shiftKey && event.code === "KeyK" && slow) {
			try {
				if (window.parent.__slowKey?.("KeyK", false)) event.preventDefault();
			} catch {}
			return;
		}
		// Reloading (F5, Ctrl+R) reloads just the chat, not all of Slow and its tabs.
		// (Ctrl+Shift+R and Shift+F5 still reload everything)
		if (slow && !event.shiftKey && !event.altKey && ((event.key === "F5" && !mod) || (mod && event.code === "KeyR"))) {
			event.preventDefault();
			saveDraft();
			location.reload();
			return;
		}
		if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
		if (!menu.hidden) return closeMenu();
		if (!callEl.hidden) return minimizeCall();
		// (suggestions showing: Escape just puts them away)
		if (!$("cmd-hint").hidden) {
			hintsDismissed = true;
			return refreshHints();
		}
		if (replyTo) return cancelReply();
		if (!wide() && shell.classList.contains("show-room") && !textEl.value) return shell.classList.remove("show-room");
		if (!textEl.value) slow?.close?.();
	});

	for (const btn of document.querySelectorAll("[data-close-dock]")) btn.addEventListener("click", () => slow?.close?.());
	if (!slow) for (const btn of document.querySelectorAll("[data-close-dock]")) btn.hidden = true;

	// Full screen or a side panel (Slow remembers which; it's in Slow's settings too).
	const fullScreen = () => slow?.mode?.() !== "dock";
	function renderMode() {
		const full = fullScreen();
		const label = full ? "Open as a side panel" : "Open full screen";
		for (const btn of document.querySelectorAll("[data-mode-toggle]")) {
			btn.hidden = !slow?.setMode;
			btn.replaceChildren(icon(full ? "panel" : "expand"));
			btn.title = label;
			btn.setAttribute("aria-label", label);
		}
		// (calls already fill the screen when the chat does)
		$("call-wide").hidden = full;
		if (full) callEl.classList.remove("wide");
	}
	for (const btn of document.querySelectorAll("[data-mode-toggle]")) {
		btn.addEventListener("click", () => slow?.setMode?.(fullScreen() ? "dock" : "full"));
	}
	renderMode();

	window.addEventListener("resize", () => {
		if (wide()) shell.classList.add("show-room");
	});


	// What Slow's page calls.
	window.__chat = {
		// The panel opened.
		shown() {
			if (!me) return;
			seeCurrent();
			if (!callEl.hidden || ringingCall) return;
			if (shell.classList.contains("show-room") || wide()) textEl.focus({ preventScroll: true });
		},
		openConv(id) {
			if (convs.has(id)) openConv(id);
		},
		// Opened with the chat button: straight to the newest chat with something new for you
		// (unless the one that's open has something new too).
		openUnread() {
			if (!me) return false;
			const waiting = [...convs.values()].filter((c) => isUnread(c) && (c.kind !== "global" || c.mention)).sort((a, b) => convTime(b) - convTime(a));
			if (!waiting.length || waiting.includes(current)) return false;
			openConv(waiting[0].id);
			return true;
		},
		// Your chats, for Slow's search (Ctrl+K).
		chats() {
			if (!me) return [];
			return [...convs.values()]
				.sort((a, b) => (a.kind === "global" ? -1 : b.kind === "global" ? 1 : convTime(b) - convTime(a)))
				.map((c) => ({
					id: c.id,
					kind: c.kind,
					title: c.title,
					unread: isUnread(c) && (c.kind !== "global" || c.mention),
					preview: previewText(c),
					avatar: c.kind === "dm" ? { src: pictureFor(profiles.get(keyOf(c.peer))?.pfp), text: initialsFor(c.peer), color: tintOf(c.peer) } : null,
				}));
		},
		reply: quickReply,
		// Sharing the page you're on: pick a chat, and its link is ready to send there.
		share(link) {
			if (!me) return false;
			openShare(String(link?.url || ""), String(link?.title || ""));
			return true;
		},
		modeChanged: renderMode,
		signedIn: () => Boolean(me),
	};

	updateComposer();
})();
