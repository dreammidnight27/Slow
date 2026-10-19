/*
 * Liquid: Slow's "liquid glass" motion, made with real physics. Slow's page and the chat use it.
 *
 *  - Springs: a weight on a spring, with friction. Things overshoot, wobble and settle depending
 *    on how fast they were going, like water does.
 *  - lens(container): a drop of glass that flows between choices (the open tab, the button you're
 *    pointing at), stretching out as it moves and bending the light behind it at its edges.
 *  - tilt(container, { item }): glass cards lean toward your pointer on springs and catch the
 *    light where you point (the stylesheet draws the shine from --liquid-mx and --liquid-my).
 *
 * Everything here stays still when Slow's "Reduce motion" is on.
 */
(() => {
	if (window.Liquid) return;
	const root = document.documentElement;

	// Slow's own setting decides; on its own, the system's.
	const calm = () =>
		root.dataset.motion ? root.dataset.motion === "reduced" : matchMedia("(prefers-reduced-motion: reduce)").matches;

	// Chrome and Edge can bend what's behind glass (an SVG filter on the backdrop); others just blur it.
	if (navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand))) root.classList.add("liquid-refract");

	/* ============================================================
	   SPRINGS, and one loop that moves everything that's moving
	   ============================================================ */

	class Spring {
		constructor(value, { stiffness = 260, damping = 20, precision = 0.001 } = {}) {
			this.value = this.target = value;
			this.velocity = 0;
			this.stiffness = stiffness;
			this.damping = damping;
			this.precision = precision;
		}
		set(value) {
			this.value = this.target = value;
			this.velocity = 0;
		}
		step(dt) {
			const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
			this.velocity += force * dt;
			this.value += this.velocity * dt;
		}
		get still() {
			return Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 20;
		}
	}

	// Each body has step(dt), and render() that says whether it's still moving.
	const moving = new Set();
	let frame = 0;
	let last = 0;
	const STEP = 1 / 240; // (small steps keep stiff springs steady)

	function tick(now) {
		const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
		last = now;
		const steps = Math.max(1, Math.ceil(dt / STEP));
		for (const body of [...moving]) {
			for (let i = 0; i < steps; i++) body.step(dt / steps);
			if (!body.render()) moving.delete(body);
		}
		frame = moving.size ? requestAnimationFrame(tick) : 0;
	}

	function animate(body) {
		moving.add(body);
		if (!frame) {
			last = performance.now();
			frame = requestAnimationFrame(tick);
		}
	}

	/* ============================================================
	   SVG FILTERS: the lens (glass that bends light)
	   ============================================================ */

	// How the glass bends what's behind it: hardly at all in the middle, more and more toward its
	// rim, pulling the picture inward like the edge of a lens. (Red = sideways, green = up/down.)
	function lensMap(size = 96) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext("2d");
		const img = ctx.createImageData(size, size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const nx = ((x + 0.5) / size) * 2 - 1;
				const ny = ((y + 0.5) / size) * 2 - 1;
				const d = Math.pow(nx ** 4 + ny ** 4, 0.25); // a rounded square: 0 in the middle, 1 at the rim
				const rim = Math.max(0, Math.min(1, (d - 0.5) / 0.5)) ** 2;
				const len = Math.hypot(nx, ny) || 1;
				const i = (y * size + x) * 4;
				img.data[i] = 128 - (nx / len) * rim * 127;
				img.data[i + 1] = 128 - (ny / len) * rim * 127;
				img.data[i + 2] = 128;
				img.data[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas.toDataURL();
	}

	function addFilters() {
		const svgNS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNS, "svg");
		svg.setAttribute("class", "liquid-defs");
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		// (fixed markup written here; only the lens picture is filled in)
		svg.innerHTML = `
			<filter id="liquid-lens" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
				<feImage x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
				<feDisplacementMap in="SourceGraphic" in2="map" scale="0.3" xChannelSelector="R" yChannelSelector="G" />
			</filter>
			<filter id="liquid-lens-wide" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
				<feImage x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
				<feDisplacementMap in="SourceGraphic" in2="map" scale="0.07" xChannelSelector="R" yChannelSelector="G" />
			</filter>`;
		// (how the glass bends: the same for small drops of glass, gentler for wide pieces)
		const map = lensMap();
		for (const image of svg.querySelectorAll("feImage")) image.setAttribute("href", map);
		document.body.append(svg);
	}

	/* ============================================================
	   LENS: a drop of glass that flows between choices
	   ============================================================ */

	// lens(container, { element, items, hover }):
	//   element: use this element as the drop (made for you if left out)
	//   track: "x" moves it sideways only (its height and top stay as the stylesheet has them)
	//   hover: a selector; the drop follows the pointer between these and fades when it leaves
	function lens(container, { element = null, track = "xy", hover = null, className = "" } = {}) {
		const el = element || document.createElement("div");
		if (!element) {
			el.className = `liquid-lens liquid-glass ${className}`.trim();
			el.setAttribute("aria-hidden", "true");
			container.prepend(el);
		}
		container.classList.add("has-lens");
		const flow = { stiffness: 210, damping: 19, precision: 0.05 };
		const x = new Spring(0, flow);
		const y = new Spring(0, flow);
		const w = new Spring(0, flow);
		const h = new Spring(0, flow);
		const o = new Spring(0, { stiffness: 220, damping: 24, precision: 0.002 });
		let placed = false;

		const body = {
			step(dt) {
				x.step(dt);
				y.step(dt);
				w.step(dt);
				h.step(dt);
				o.step(dt);
			},
			render() {
				// Moving fast, it stretches out the way it's going and thins, like a drop of water.
				const vx = Math.abs(x.velocity);
				const vy = track === "x" ? 0 : Math.abs(y.velocity);
				const upDown = vy > vx;
				const speed = upDown ? vy : vx;
				const stretch = Math.min((upDown ? h.value : w.value) * 0.7, speed * 0.05);
				const thin = Math.min(0.24, speed / 4200);
				const shown = Math.max(0, Math.min(1, o.value));
				el.style.opacity = shown.toFixed(3);
				if (track === "x") {
					el.style.width = `${Math.max(0, w.value + stretch).toFixed(2)}px`;
					el.style.transform = `translateX(${(x.value - stretch / 2).toFixed(2)}px) scaleY(${(1 - thin).toFixed(4)})`;
				} else {
					const width = Math.max(0, upDown ? w.value * (1 - thin) : w.value + stretch);
					const height = Math.max(0, upDown ? h.value + stretch : h.value * (1 - thin));
					// (it swells into being, and shrinks away as it fades, like a drop evaporating)
					const grow = 0.55 + 0.45 * shown;
					el.style.width = `${width.toFixed(2)}px`;
					el.style.height = `${height.toFixed(2)}px`;
					el.style.transform = `translate(${(x.value + (w.value - width) / 2).toFixed(2)}px, ${(y.value + (h.value - height) / 2).toFixed(2)}px) scale(${grow.toFixed(4)})`;
				}
				return !(x.still && y.still && w.still && h.still && o.still);
			},
		};

		// to(element) flows to it; to(null) fades away. { instant: true } skips the flowing.
		function to(target, { instant = false } = {}) {
			if (target && !container.getClientRects().length) return; // (not on screen yet)
			if (!target || !target.isConnected) {
				o.target = 0;
				if (instant || calm()) o.set(0);
				animate(body);
				return;
			}
			// (by layout, so a squished or swelling target doesn't throw it off)
			let tx, ty, tw, th;
			if (target.offsetParent === container) {
				tx = target.offsetLeft;
				ty = target.offsetTop;
				tw = target.offsetWidth;
				th = target.offsetHeight;
			} else {
				const r = target.getBoundingClientRect();
				const c = container.getBoundingClientRect();
				tx = r.left - c.left - container.clientLeft + container.scrollLeft;
				ty = r.top - c.top - container.clientTop + container.scrollTop;
				tw = r.width;
				th = r.height;
			}
			// Faded away (or the first time): it appears where it's needed instead of flying over.
			if (!placed || instant || o.value < 0.08 || calm()) {
				x.set(tx);
				y.set(ty);
				w.set(tw);
				h.set(th);
				placed = true;
			} else {
				x.target = tx;
				y.target = ty;
				w.target = tw;
				h.target = th;
			}
			o.target = 1;
			if (calm()) o.set(1);
			animate(body);
		}

		if (hover) {
			container.addEventListener("pointerover", (event) => {
				const item = event.target.closest?.(hover);
				if (item && container.contains(item) && !item.disabled) to(item);
			});
			container.addEventListener("pointerleave", () => to(null));
			container.addEventListener("focusin", (event) => {
				const item = event.target.closest?.(hover);
				if (item?.matches(":focus-visible")) to(item);
			});
			container.addEventListener("focusout", () => {
				if (!container.matches(":hover")) to(null);
			});
		}
		return { el, to };
	}

	/* ============================================================
	   TILT: glass cards lean toward your pointer and catch the light
	   ============================================================ */

	// tilt(container, { item, part, angle, lift, only }): pointing at an item leans it (or the part
	// inside it) toward the pointer and lifts it a little, on springs, so it sways and settles when
	// you move on. --liquid-mx and --liquid-my say where the light catches it. only(element) can
	// leave some out (a full-width banner, say).
	function tilt(container, { item, part = null, angle = 8, lift = 4, only = null } = {}) {
		const leaning = new Map(); // element -> its springs
		let current = null;

		function bodyFor(el) {
			let body = leaning.get(el);
			if (body) return body;
			const sway = { stiffness: 170, damping: 13, precision: 0.01 };
			body = {
				rx: new Spring(0, sway),
				ry: new Spring(0, sway),
				up: new Spring(0, sway),
				step(dt) {
					this.rx.step(dt);
					this.ry.step(dt);
					this.up.step(dt);
				},
				render() {
					const settled = this.rx.still && this.ry.still && this.up.still;
					if (settled && !this.rx.target && !this.ry.target && !this.up.target) {
						el.style.transform = "";
						el.classList.remove("liquid-tilting");
						leaning.delete(el);
						return false;
					}
					el.classList.add("liquid-tilting");
					el.style.transform = `translateY(${(-this.up.value).toFixed(2)}px) perspective(700px) rotateX(${this.rx.value.toFixed(3)}deg) rotateY(${this.ry.value.toFixed(3)}deg)`;
					return !settled;
				},
			};
			leaning.set(el, body);
			return body;
		}

		function release(el) {
			const body = leaning.get(el);
			if (!body) return;
			body.rx.target = body.ry.target = body.up.target = 0;
			animate(body);
		}

		container.addEventListener("pointermove", (event) => {
			if (event.pointerType === "touch" || calm()) return;
			const hit = event.target.closest?.(item);
			let el = hit && container.contains(hit) ? (part ? hit.querySelector(part) : hit) : null;
			if (el && only && !only(el)) el = null;
			if (el !== current) {
				if (current) release(current);
				current = el;
			}
			if (!el) return;
			const box = el.getBoundingClientRect();
			const px = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
			const py = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
			const body = bodyFor(el);
			body.ry.target = (px - 0.5) * 2 * angle;
			body.rx.target = -(py - 0.5) * 2 * angle;
			body.up.target = lift;
			el.style.setProperty("--liquid-mx", `${(px * 100).toFixed(1)}%`);
			el.style.setProperty("--liquid-my", `${(py * 100).toFixed(1)}%`);
			animate(body);
		});
		container.addEventListener("pointerleave", () => {
			if (current) release(current);
			current = null;
		});
	}

	/* ============================================================ */

	if (document.body) addFilters();
	else document.addEventListener("DOMContentLoaded", addFilters, { once: true });

	window.Liquid = { Spring, animate, lens, tilt, calm };
})();
