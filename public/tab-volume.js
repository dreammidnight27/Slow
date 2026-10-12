/*
 * Per-tab volume for Slow.
 *
 * Slow's service worker adds this script to every proxied page (and to frames inside
 * pages) before the page's own scripts run. It scales all of the page's sound by the
 * tab's volume, which Slow sets on the tab's page as window.__slowTabVolume (0 to 1):
 *  - <audio> and <video>: the page still sees the volume it asked for, but what you
 *    hear is that times the tab's volume.
 *  - Web Audio (used by most games): sound is routed through a volume knob Slow controls.
 */
(() => {
	if (window.__slowVolumeHook) return;
	window.__slowVolumeHook = true;

	// The tab's volume: set by Slow on the tab's page, which frames inside it look up to.
	function level() {
		let w = window;
		for (let i = 0; i < 12; i++) {
			try {
				if (typeof w.__slowTabVolume === "number") return w.__slowTabVolume;
				if (w.parent === w) break;
				w = w.parent;
			} catch {
				break;
			}
		}
		return 1;
	}

	/* ---------- <audio> and <video> ---------- */

	const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
	const asked = new WeakMap(); // the volume the page asked for, per element
	const media = new Set();

	function apply(el) {
		const want = asked.has(el) ? asked.get(el) : 1;
		const target = Math.min(1, Math.max(0, want * level()));
		// Only touch it when it changes, so the page doesn't get a flood of "volumechange" events.
		if (Math.abs(volume.get.call(el) - target) > 0.001) volume.set.call(el, target);
	}

	function track(el) {
		if (!media.has(el)) {
			media.add(el);
			if (!asked.has(el)) asked.set(el, volume.get.call(el));
		}
		apply(el);
	}

	Object.defineProperty(HTMLMediaElement.prototype, "volume", {
		configurable: true,
		enumerable: true,
		get() {
			return asked.has(this) ? asked.get(this) : volume.get.call(this);
		},
		set(value) {
			// Let the browser reject bad values exactly as it normally would.
			if (!(value >= 0 && value <= 1)) return volume.set.call(this, value);
			asked.set(this, value);
			track(this);
		},
	});

	const play = HTMLMediaElement.prototype.play;
	HTMLMediaElement.prototype.play = function () {
		track(this);
		return play.apply(this, arguments);
	};

	/* ---------- Web Audio ---------- */

	const Base = window.BaseAudioContext || window.AudioContext;
	const gains = new Set();
	const destination = Base && Object.getOwnPropertyDescriptor(Base.prototype, "destination");

	if (destination) {
		Object.defineProperty(Base.prototype, "destination", {
			configurable: true,
			enumerable: true,
			get() {
				const real = destination.get.call(this);
				// Offline rendering (making audio files, not playing them) stays untouched.
				if (window.OfflineAudioContext && this instanceof OfflineAudioContext) return real;
				if (!this.__slowGain) {
					const gain = this.createGain();
					gain.gain.value = level();
					gain.connect(real);
					this.__slowGain = gain;
					gains.add(gain);
				}
				return this.__slowGain;
			},
		});
	}

	/* ---------- keep everything at the tab's volume ---------- */

	function applyAll() {
		const l = level();
		for (const gain of gains) {
			if (Math.abs(gain.gain.value - l) > 0.001) gain.gain.value = l;
		}
		for (const el of document.querySelectorAll("audio, video")) track(el);
		for (const el of media) apply(el);
	}

	window.__slowApplyVolume = applyAll;
	setInterval(applyAll, 300);
})();
