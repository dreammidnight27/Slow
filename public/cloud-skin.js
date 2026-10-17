/*
 * A Slow look for the cloud gaming page (the one the cloud button opens). Slow's service worker
 * adds this only to that page. It doesn't change how the page works: it restyles it in Slow's
 * theme colors (cloud-skin.css), adds a header with filters for PC and phone games, and labels
 * each game.
 */
(() => {
	if (window.__slowCloudSkin) return;
	window.__slowCloudSkin = true;

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

	const THEME_VARS = ["--void", "--nebula", "--aurora", "--ember", "--starlight", "--glass", "--glass-strong", "--line", "--moon-light"];
	const slowDoc = slowDocument();

	// The proxy would treat the stylesheet's address as one of the website's and send it off to
	// the website, so it's set with Slow's own (untouched) setter.
	const sheet = document.createElement("link");
	sheet.rel = "stylesheet";
	const realLinkHref = Object.getOwnPropertyDescriptor((slowDoc?.defaultView || window).HTMLLinkElement.prototype, "href").set;
	realLinkHref.call(sheet, slowBase + "cloud-skin.css");
	(document.head || document.documentElement).append(sheet);

	function matchTheme() {
		if (!slowDoc) return;
		const colors = getComputedStyle(slowDoc.documentElement);
		for (const name of THEME_VARS) document.documentElement.style.setProperty(name, colors.getPropertyValue(name));
	}
	matchTheme();
	// Changing theme in Slow changes this page too.
	if (slowDoc) {
		new MutationObserver(matchTheme).observe(slowDoc.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "style"],
		});
	}

	/* ---------- header, filters and labels ---------- */

	const KINDS = [
		{ id: "all", name: "All" },
		{ id: "pc", name: "PC & console" },
		{ id: "phone", name: "Phone" },
	];
	let showing = "all";

	// Raccoon Game's games are PC and console games; Synapse's (CloudMoon) are phone games.
	const kindOf = (card) => (/raccoongame/i.test(card.querySelector("img")?.src || "") ? "pc" : "phone");

	function start() {
		const grid = document.getElementById("gameGrid");
		const search = document.getElementById("gameSearch");
		if (!grid || !search || document.querySelector(".slow-cloud-head")) return;

		const head = document.createElement("header");
		head.className = "slow-cloud-head";
		const title = document.createElement("div");
		title.className = "slow-cloud-title";
		const h1 = document.createElement("h1");
		h1.textContent = "Cloud games";
		const count = document.createElement("span");
		count.className = "slow-cloud-count";
		title.append(h1, count);

		const chips = document.createElement("div");
		chips.className = "slow-cloud-chips";
		chips.setAttribute("role", "group");
		chips.setAttribute("aria-label", "Show");
		for (const kind of KINDS) {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.dataset.kind = kind.id;
			chip.innerHTML = `<span></span><small></small>`;
			chip.firstChild.textContent = kind.name;
			chip.addEventListener("click", () => {
				showing = kind.id;
				label();
			});
			chips.append(chip);
		}

		const oldBox = search.parentElement;
		head.append(title, search, chips);
		grid.parentElement.insertBefore(head, grid);
		if (oldBox && !oldBox.children.length) oldBox.classList.add("slow-gone");

		const empty = document.createElement("p");
		empty.className = "slow-cloud-empty";
		empty.textContent = "No games here match that.";
		grid.after(empty);

		// Their page redraws its games whenever you search (and as the phone games arrive).
		function label() {
			const totals = { all: 0, pc: 0, phone: 0 };
			let shown = 0;
			for (const card of grid.children) {
				if (!card.querySelector("img")) continue;
				if (!card.dataset.kind) {
					card.dataset.kind = kindOf(card);
					card.classList.add("slow-card");
					const badge = document.createElement("span");
					badge.className = "slow-badge";
					badge.textContent = card.dataset.kind === "pc" ? "PC" : "Phone";
					card.append(badge);
				}
				totals.all++;
				totals[card.dataset.kind]++;
				const hide = showing !== "all" && card.dataset.kind !== showing;
				card.classList.toggle("slow-hidden", hide);
				if (!hide) shown++;
			}
			for (const chip of chips.children) {
				chip.classList.toggle("on", chip.dataset.kind === showing);
				chip.setAttribute("aria-pressed", String(chip.dataset.kind === showing));
				chip.lastChild.textContent = String(totals[chip.dataset.kind]);
			}
			count.textContent = `${totals.all} games`;
			empty.hidden = shown > 0;
		}
		new MutationObserver(label).observe(grid, { childList: true });
		label();
	}

	// The game screen's close button gets a proper label.
	function tidyOverlay() {
		const close = document.getElementById("nicheCloseBtn");
		if (close && !close.dataset.slow) {
			close.dataset.slow = "1";
			close.textContent = "Close";
			close.setAttribute("aria-label", "Close the game");
		}
	}

	function ready() {
		start();
		tidyOverlay();
		new MutationObserver(tidyOverlay).observe(document.body, { childList: true });
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
	else ready();
})();
