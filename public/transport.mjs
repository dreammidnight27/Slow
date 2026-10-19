/*
 * How Slow reaches the internet: libcurl, through the wisp server. bare-mux runs this in its worker.
 *
 * Websites' pages and files go through libcurl's HTTP, as always. WebSockets go through libcurl
 * too, but this file speaks the WebSocket protocol itself, over libcurl's secure sockets. When a
 * server sends one long message in several pieces, libcurl's own WebSockets hand over each piece as
 * if it were a whole message, which cut messages off at about 4 KB. That's what kept cloud games
 * stuck on "Connecting…" (the message that sets up their video is long).
 */

// (when Slow reconnects with a fresh copy of this file, it gets a fresh libcurl too)
const fresh = new URL(import.meta.url).search;
const libcurlFile = new URL(`libcurl/index.mjs${fresh}`, import.meta.url).href;

// libcurl's file keeps its sockets to itself, so it's loaded with one line added that shares them.
// (If that ever fails, WebSockets go through libcurl's own, as before.)
let Libcurl;
let libcurl = null;
try {
	const source = await (await fetch(libcurlFile)).text();
	const shared = URL.createObjectURL(new Blob([`${source}\nexport { libcurl as __slowLibcurl };\n`], { type: "text/javascript" }));
	({ default: Libcurl, __slowLibcurl: libcurl } = await import(shared));
	URL.revokeObjectURL(shared);
	if (typeof libcurl?.TLSSocket !== "function") libcurl = null;
} catch {
	libcurl = null;
}
if (!Libcurl) ({ default: Libcurl } = await import(libcurlFile));

export default class SlowTransport {
	ready = false;

	// options: { websocket: "wss://…/wisp/" }, the wisp server
	constructor(options = {}) {
		this.http = new Libcurl(options);
	}

	async init() {
		// (libcurl's engine starts a moment after its file loads; it has to be running first)
		if (libcurl && !libcurl.ready) {
			await new Promise((resolve) => libcurl.events.addEventListener("libcurl_load", resolve, { once: true }));
		}
		await this.http.init();
		this.ready = true;
	}

	async meta() {}

	request(remote, method, body, headers, signal) {
		return this.http.request(remote, method, body, headers, signal);
	}

	connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
		if (!libcurl) return this.http.connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror);
		return openWebSocket(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror);
	}
}

/* ============================================================
   A WEBSOCKET (RFC 6455), over one of libcurl's connections
   ============================================================ */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function join(chunks, size) {
	if (chunks.length === 1) return chunks[0];
	const out = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

// A connection to the website's server: encrypted by libcurl for wss://, plain for ws://.
function connectTo(url, { open, data, closed, failed }) {
	if (url.protocol === "wss:") {
		const socket = new libcurl.TLSSocket(url.hostname, Number(url.port) || 443);
		socket.onopen = open;
		socket.onmessage = (bytes) => data(bytes);
		socket.onclose = () => closed();
		socket.onerror = (code) => failed(`connection error ${code}`);
		// (handed over a little at a time: a big piece at once doesn't all make it through)
		const send = (bytes) => {
			for (let at = 0; at < bytes.length; at += 8192) socket.send(bytes.subarray(at, at + 8192));
		};
		return { send, close: () => socket.close() };
	}
	const socket = new libcurl.wisp.WispWebSocket(`${libcurl.websocket_url}${url.hostname}:${Number(url.port) || 80}`);
	socket.binaryType = "arraybuffer";
	socket.onopen = open;
	socket.onmessage = (event) => data(new Uint8Array(event.data));
	socket.onclose = () => closed();
	socket.onerror = () => failed("connection error");
	return { send: (bytes) => socket.send(bytes), close: () => socket.close() };
}

const clean = (text) => String(text).replace(/[\r\n]/g, "");

function openWebSocket(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
	let state = "connecting"; // then "open", "closing", "closed"
	let buffer = new Uint8Array(0); // received, not read yet
	let queue = []; // received since, not joined onto the buffer yet
	let queued = 0;
	let want = 0; // how much the buffer needs before reading on is worth it
	let message = null; // a message arriving in pieces: { text, chunks, size }
	const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

	let finished = false;
	function finish(code = 1006, reason = "") {
		if (finished) return;
		finished = true;
		state = "closed";
		clearTimeout(waiting);
		try {
			socket.close();
		} catch {}
		onclose(code, reason);
	}
	function fail(reason) {
		if (finished) return;
		onerror(reason);
		finish(1006, "");
	}
	const waiting = setTimeout(() => state === "connecting" && fail("The server didn't answer"), 30_000);

	const socket = connectTo(url, {
		// Ask to switch the connection over to WebSocket.
		open() {
			const lines = [
				`GET ${url.pathname || "/"}${url.search} HTTP/1.1`,
				`Host: ${url.host}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Key: ${key}`,
				"Sec-WebSocket-Version: 13",
			];
			if (protocols?.length) lines.push(`Sec-WebSocket-Protocol: ${clean([].concat(protocols).join(", "))}`);
			for (const [name, value] of Object.entries(requestHeaders || {})) {
				if (/^(host|upgrade|connection|sec-websocket-.*|content-length)$/i.test(name)) continue;
				for (const one of [].concat(value)) lines.push(`${clean(name)}: ${clean(one)}`);
			}
			socket.send(encoder.encode(`${lines.join("\r\n")}\r\n\r\n`));
		},
		data(bytes) {
			queue.push(bytes);
			queued += bytes.length;
			if (buffer.length + queued < want) return; // (a big message is still arriving)
			buffer = join([buffer, ...queue], buffer.length + queued);
			queue = [];
			queued = 0;
			want = 0;
			if (state === "connecting") readAnswer();
			if (state === "open" || state === "closing") readFrames();
		},
		closed: () => finish(1006, ""),
		failed: (reason) => fail(reason),
	});

	// The server's answer to the switch: "101 Switching Protocols", or it refused.
	function readAnswer() {
		let end = -1;
		for (let i = 3; i < buffer.length; i++) {
			if (buffer[i] === 10 && buffer[i - 1] === 13 && buffer[i - 2] === 10 && buffer[i - 3] === 13) {
				end = i + 1;
				break;
			}
		}
		if (end < 0) return;
		const [status, ...lines] = decoder.decode(buffer.subarray(0, end)).split("\r\n");
		buffer = buffer.subarray(end);
		if (!/^HTTP\/1\.[01] 101\b/.test(status)) return fail(`The server said ${status.slice(9) || "no"}`);
		let protocol = "";
		for (const line of lines) {
			const at = line.indexOf(":");
			if (at > 0 && line.slice(0, at).trim().toLowerCase() === "sec-websocket-protocol") protocol = line.slice(at + 1).trim();
		}
		state = "open";
		clearTimeout(waiting);
		onopen(protocol);
	}

	// Frames: each is a whole message, or a piece of one (those are kept until the last piece).
	function readFrames() {
		while (!finished) {
			if (buffer.length < 2) return void (want = 2);
			let length = buffer[1] & 0x7f;
			let at = 2;
			if (length === 126) {
				if (buffer.length < 4) return void (want = 4);
				length = (buffer[2] << 8) | buffer[3];
				at = 4;
			} else if (length === 127) {
				if (buffer.length < 10) return void (want = 10);
				length = 0;
				for (let i = 2; i < 10; i++) length = length * 256 + buffer[i];
				at = 10;
			}
			const masked = buffer[1] & 0x80;
			if (masked) at += 4;
			if (buffer.length < at + length) return void (want = at + length);
			const payload = buffer.slice(at, at + length);
			if (masked) {
				const mask = buffer.subarray(at - 4, at);
				for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
			}
			const first = buffer[0];
			buffer = buffer.subarray(at + length);
			frame(first & 0x80, first & 0x0f, payload);
		}
	}

	function frame(last, opcode, payload) {
		if (opcode === 0x8) {
			// closing: answer it, then it's over
			const code = payload.length >= 2 ? (payload[0] << 8) | payload[1] : 1005;
			const reason = payload.length > 2 ? decoder.decode(payload.subarray(2)) : "";
			if (state === "open") send(0x8, payload.subarray(0, 2));
			return finish(code, reason);
		}
		if (opcode === 0x9) return send(0xa, payload); // ping: pong
		if (opcode === 0xa) return;
		if (opcode === 0x1 || opcode === 0x2) message = { text: opcode === 0x1, chunks: [payload], size: payload.length };
		else if (opcode === 0x0 && message) {
			message.chunks.push(payload);
			message.size += payload.length;
		} else return;
		if (!last) return;
		const whole = join(message.chunks, message.size);
		const text = message.text;
		message = null;
		onmessage(text ? decoder.decode(whole) : whole.buffer);
	}

	// Frames from us are masked, as the protocol asks of browsers.
	function send(opcode, payload) {
		const length = payload.length;
		const head = length < 126 ? 2 : length < 65536 ? 4 : 10;
		const out = new Uint8Array(head + 4 + length);
		out[0] = 0x80 | opcode;
		if (length < 126) out[1] = 0x80 | length;
		else if (length < 65536) {
			out[1] = 0x80 | 126;
			out[2] = length >> 8;
			out[3] = length & 255;
		} else {
			out[1] = 0x80 | 127;
			let n = length;
			for (let i = 9; i >= 2; i--) {
				out[i] = n % 256;
				n = Math.floor(n / 256);
			}
		}
		const mask = crypto.getRandomValues(new Uint8Array(4));
		out.set(mask, head);
		for (let i = 0; i < length; i++) out[head + 4 + i] = payload[i] ^ mask[i & 3];
		socket.send(out);
	}

	return [
		async (data) => {
			if (state !== "open") return;
			if (typeof data === "string") return send(0x1, encoder.encode(data));
			if (data instanceof Blob) data = await data.arrayBuffer();
			const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
			send(0x2, bytes);
		},
		(code, reason = "") => {
			if (state !== "open") return finish(code || 1000, reason);
			state = "closing";
			const valid = code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
			const words = encoder.encode(reason).subarray(0, 123);
			const body = new Uint8Array(2 + words.length);
			body[0] = valid >> 8;
			body[1] = valid & 255;
			body.set(words, 2);
			send(0x8, body);
			// (the server answers, or Slow stops waiting)
			setTimeout(() => finish(valid, reason), 1500);
		},
	];
}
