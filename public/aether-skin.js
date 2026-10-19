/*
 * A Slow look for Aether (the movies button). Slow's service worker adds this only to Aether's
 * pages. It doesn't change how Aether works. Aether keeps all its colors as theme variables (it's
 * built on movie-web), so this repaints them in Slow's theme: its grays become Slow's night and
 * starlight shades, its blue accent becomes Slow's accent, and colors that mean something (errors,
 * success) keep their meaning. Changing theme in Slow changes Aether too. Its fonts, background
 * and the way posters lean toward the pointer come from Slow as well (aether-skin.css, liquid.js).
 */
(() => {
	if (window.__slowAetherSkin) return;
	window.__slowAetherSkin = true;

	// Slow's own files live where this page's proxied address starts.
	const at = location.pathname.indexOf("/scramjet/");
	const slowBase = location.origin + (at === -1 ? "/" : location.pathname.slice(0, at + 1));

	function slowDocument() {
		let w = window;
		for (let i = 0; i < 12; i++) {
			try {
				if (typeof w.__slowOpenTab === "function") return w.document;
				if (w.parent === w) break;
				w = w.parent;
			} catch {
				break;
			}
		}
		return null;
	}

	const slowDoc = slowDocument();
	const Liquid = slowDoc?.defaultView?.Liquid || null;
	const THEME_VARS = ["--void", "--nebula", "--aurora", "--ember", "--starlight", "--bg-1", "--moon-light", "--moon-base"];

	// The proxy would treat the stylesheet's address as one of the website's, so it's set with
	// Slow's own (untouched) setter.
	const sheet = document.createElement("link");
	sheet.rel = "stylesheet";
	const realLinkHref = Object.getOwnPropertyDescriptor((slowDoc?.defaultView || window).HTMLLinkElement.prototype, "href").set;
	realLinkHref.call(sheet, slowBase + "aether-skin.css");
	(document.head || document.documentElement).append(sheet);

	/* ---------- colors ---------- */

	// Any CSS color (Slow's themes use hex; the custom one uses hsl()) as [r, g, b].
	const paint = document.createElement("canvas").getContext("2d");
	function rgbOf(color) {
		paint.fillStyle = "#000";
		paint.fillStyle = color;
		const value = paint.fillStyle;
		if (value.startsWith("#")) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
		return value.match(/[\d.]+/g).slice(0, 3).map(Number);
	}

	const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

	function toHsl([r, g, b]) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		if (max === min) return [0, 0, l];
		const d = max - min;
		const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
		return [h, s, l];
	}

	function fromHsl(h, s, l) {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		const channel = (t) => {
			t = (t + 1) % 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => v * 255);
	}

	// (these mean something: errors, warnings, success, gold stars)
	const MEANINGFUL = /danger|error|success|warning|dropdown-highlight|onboarding-best/i;

	// Aether's own palette, as its stylesheet sets it: { "--colors-…": [r, g, b] }
	let palette = null;
	function readPalette() {
		for (const css of document.styleSheets) {
			let rules;
			try {
				rules = css.cssRules;
			} catch {
				continue;
			}
			for (const rule of rules) {
				if (rule.selectorText !== ":root" || !rule.style) continue;
				const found = {};
				for (let i = 0; i < rule.style.length; i++) {
					const name = rule.style[i];
					if (!name.startsWith("--colors-")) continue;
					const parts = rule.style.getPropertyValue(name).trim().split(/\s+/).map(Number);
					if (parts.length === 3 && parts.every(Number.isFinite)) found[name] = parts;
				}
				if (Object.keys(found).length > 20) return found;
			}
		}
		return null;
	}

	const style = document.createElement("style");

	function repaint() {
		palette ||= readPalette();
		if (!palette || !slowDoc) return false;
		const theme = getComputedStyle(slowDoc.documentElement);
		const slow = (name, fallback) => rgbOf(theme.getPropertyValue(name).trim() || fallback);
		const night = slow("--void", "#07050f");
		const nebula = slow("--nebula", "#4a2c8f");
		const accent = slow("--aurora", "#b98cff");
		const star = slow("--starlight", "#f3eeff");
		const panel = mix(night, nebula, 0.42);

		// Aether's grays, from black to white, become Slow's: night, purple-tinted panels,
		// soft lavender writing, and starlight.
		const ramp = [
			[0, night],
			[0.1, panel],
			[0.3, mix(panel, star, 0.3)],
			[1, star],
		];
		const shade = (l) => {
			for (let i = 1; i < ramp.length; i++) {
				const [l0, c0] = ramp[i - 1];
				const [l1, c1] = ramp[i];
				if (l <= l1) return mix(c0, c1, (l - l0) / (l1 - l0));
			}
			return star;
		};
		const [hue, sat] = toHsl(accent);
		// Its colors (all blue) become Slow's accent, as light or dark as they were.
		const tint = (l) => fromHsl(hue, Math.max(sat, 0.45), Math.min(0.85, Math.max(0.12, l)));

		const lines = [];
		for (const [name, rgb] of Object.entries(palette)) {
			if (MEANINGFUL.test(name)) continue;
			const [, s, l] = toHsl(rgb);
			let out = s < 0.15 ? shade(l) : tint(l);
			// Main buttons are Slow's accent, with dark writing, like Slow's.
			if (name === "--colors-buttons-primary") out = accent;
			else if (name === "--colors-buttons-primaryHover") out = mix(accent, star, 0.25);
			else if (name === "--colors-buttons-primaryText") out = night;
			lines.push(`${name}: ${out.map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(" ")} !important;`);
		}
		for (const name of THEME_VARS) {
			const value = theme.getPropertyValue(name).trim();
			// (only colors: they go into a stylesheet)
			if (/^[#\w(),.%\s/-]+$/.test(value)) lines.push(`${name}: ${value};`);
		}
		// (on the root and on any of Aether's own theme classes, so picking one there changes nothing)
		style.textContent = `:root, [class*="theme-"] {\n${lines.join("\n")}\n}`;
		if (!style.isConnected) (document.head || document.documentElement).append(style);
		return true;
	}

	// Aether's stylesheet arrives a moment after this runs: try until it's there.
	function whenReady(tries = 0) {
		if (repaint() || tries > 60) return;
		setTimeout(() => whenReady(tries + 1), 100);
	}
	whenReady();
	if (slowDoc) {
		new MutationObserver(repaint).observe(slowDoc.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
	}

	/* ---------- Slow's touches on Aether's own parts ----------
	   Aether redraws its pages as you use it, so this looks again whenever the page changes. */

	const lenses = new Map(); // tab row -> its drop of glass

	// The open tab's glass follows it (cheap: done whenever a class changes).
	function moveLenses() {
		for (const [row, lens] of lenses) {
			if (!row.isConnected) {
				lenses.delete(row);
				continue;
			}
			lens.to([...row.children].find((b) => b.tagName === "BUTTON" && b.classList.contains("text-type-link")) || null);
		}
	}

	// Looking the page over (when its content changes).
	function decorate() {
		// The home page's title, in Slow's metallic letters with its star-tipped lines and tagline.
		const search = document.querySelector("input[placeholder]");
		const hero = search?.closest(".text-center");
		const title = hero?.querySelector("h1");
		if (title && !title.classList.contains("slow-title")) {
			title.classList.add("slow-title");
			title.parentElement?.classList.add("slow-title-box");
			// (the block with the title and the search box, spaced to fit short screens)
			hero.classList.add("slow-hero");
		}
		// The search box: Slow's frosted pill.
		const box = search?.closest('[class*="rounded-[28px]"]');
		if (box && !box.classList.contains("slow-search")) box.classList.add("slow-search");

		// Movies / TV Shows / Editor Picks: a drop of glass marks the one that's open, and flows.
		for (const row of document.querySelectorAll("div.flex")) {
			const tabs = [...row.children].filter((el) => el.tagName === "BUTTON");
			if (tabs.length < 2 || !tabs.some((b) => /^(Movies|TV Shows)$/.test(b.textContent.trim()))) continue;
			row.classList.add("slow-segment");
			if (!lenses.has(row) && Liquid) lenses.set(row, Liquid.lens(row));
		}
		moveLenses();

		// Posters: glass that catches the light where you point.
		for (const poster of document.querySelectorAll('a[href*="tmdb-"] [class*="pb-[150%]"]')) {
			if (!poster.classList.contains("slow-poster")) poster.classList.add("slow-poster");
		}
	}

	let pending = 0;
	let changed = false;
	const later = (mutations) => {
		if (mutations.some((m) => m.type === "childList")) changed = true;
		pending ||= requestAnimationFrame(() => {
			pending = 0;
			if (changed) decorate();
			else moveLenses();
			changed = false;
		});
	};

	// Slow's "Reduce motion" setting stills the stars here too.
	function matchMotion() {
		document.documentElement.dataset.slowMotion = slowDoc?.documentElement.dataset.motion || "full";
	}

	function ready() {
		matchMotion();
		if (slowDoc) new MutationObserver(matchMotion).observe(slowDoc.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
		decorate();
		new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
		// Posters lean toward the pointer (liquid.js), but not the big banner at the top.
		Liquid?.tilt(document.body, {
			item: 'a[href*="tmdb-"]',
			angle: 7,
			lift: 4,
			only: (el) => el.getBoundingClientRect().width < 420,
		});
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
	else ready();
})();
