// `npm run share`: use Slow, browsing through this computer, from any device.
//
// Starts Slow's server (unless it's already running) and a free Cloudflare tunnel, which gives
// this computer a temporary public https address, then prints your private links.
// Keep the window open while you use them; Ctrl+C stops sharing.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

// Your published Slow (for the second link). Change it if your site moves.
const SITE = "https://dreammidnight27.github.io/Slow/";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const port = parseInt(process.env.PORT || "") || 8080;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serverIsUp() {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.end();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

let server = null;
let tunnel = null;

function stop(code = 0) {
	process.exit(code);
}
// The links being shared right now, for the share page (only this computer can open it).
const shareFile = fileURLToPath(new URL("../.slow-share.json", import.meta.url));

// However this ends, the tunnel (and the server, if this started it) end with it.
process.on("exit", () => {
	tunnel?.kill();
	server?.kill();
	rmSync(shareFile, { force: true });
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0)); // the window was closed

/* ---------- 1. Slow's server ---------- */

if (await serverIsUp()) {
	console.log(`Using Slow's server that's already running on port ${port}.`);
} else {
	server = spawn(process.execPath, [root("src/index.js")], {
		stdio: ["ignore", "ignore", "inherit"],
		env: { ...process.env, PORT: String(port) },
	});
	server.on("exit", (code) => {
		console.error("Slow's server stopped.");
		stop(code ?? 1);
	});
	for (let i = 0; i < 50 && !(await serverIsUp()); i++) await wait(200);
}

const keyFile = root(".slow-key");
if (!existsSync(keyFile)) {
	console.error('Slow\'s server is running an older version. Stop it, then run "npm run share" again.');
	stop(1);
}
const key = readFileSync(keyFile, "utf8").trim();

/* ---------- 2. the tunnel ---------- */

const cloudflared =
	[root("tools/cloudflared.exe"), root("tools/cloudflared")].find((path) => existsSync(path)) || "cloudflared";

tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
	stdio: ["ignore", "pipe", "pipe"],
});

const log = []; // cloudflared's messages, shown only if something goes wrong
let shared = false;

function watch(chunk) {
	const text = String(chunk);
	log.push(...text.split("\n").filter(Boolean));
	if (log.length > 40) log.splice(0, log.length - 40);
	const address = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
	if (address && !shared) {
		shared = true;
		share(address);
	}
}
tunnel.stdout.on("data", watch);
tunnel.stderr.on("data", watch);

tunnel.on("error", () => {
	console.error(
		"Couldn't start cloudflared, Cloudflare's tunnel program. Put cloudflared.exe in the tools folder, or install it.",
	);
	stop(1);
});

tunnel.on("exit", (code) => {
	console.error("\nThe tunnel closed, so the links above stopped working.");
	if (!shared) console.error(log.slice(-10).join("\n"));
	stop(code ?? 1);
});

setTimeout(() => {
	if (shared) return;
	console.error("The tunnel is taking a long time to start. Cloudflare said:\n" + log.slice(-10).join("\n"));
}, 30000);

function share(address) {
	const wisp = `${address.replace(/^https/, "wss")}/${key}/wisp/`;
	const siteLink = `${SITE}#wisp=${encodeURIComponent(wisp)}`;
	copyToClipboard(wisp);
	writeFileSync(shareFile, JSON.stringify({ siteLink, privateLink: `${address}/${key}/`, wisp, since: Date.now() }));
	openInBrowser(`http://localhost:${port}/share`);
	console.log(`
  Slow is shared. Websites you open with these links load through this computer.
  Keep this window open while you use them. Ctrl+C stops sharing.

  Your private link (works on any device):
      ${address}/${key}/

  Or your usual Slow site, set to load through this computer
  (open it once on a device and that device keeps using this computer):
      ${siteLink}

  The share page that just opened has a QR code for your phone.

  Your wisp server (paste into Settings > Connection on any copy of Slow):
      ${wisp}${copied ? "\n      (already copied to your clipboard)" : ""}

  These change each time you start sharing. Keep them private: anyone with
  one can browse through your internet connection.

  To copy from this window, select the text first. Ctrl+C with nothing
  selected stops sharing.
`);
}

// Opens the share page in this computer's usual browser.
function openInBrowser(url) {
	const [command, args] =
		process.platform === "win32"
			? ["rundll32", ["url.dll,FileProtocolHandler", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	try {
		const opener = spawn(command, args, { stdio: "ignore", detached: true });
		opener.on("error", () => {});
		opener.unref();
	} catch {}
}

// Puts the wisp address on the clipboard (Windows), so there's nothing to copy by hand.
let copied = false;
function copyToClipboard(text) {
	if (process.platform !== "win32") return;
	try {
		const clip = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"] });
		clip.on("error", () => {});
		clip.stdin.end(text);
		copied = true;
	} catch {}
}
