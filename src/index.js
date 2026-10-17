import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js
// (By default it also refuses to connect to this computer or other devices on your home network.)

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	// Cloudflare's family DNS: blocks malware and adult sites.
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

/* ---------- your private key ----------
   On this computer, Slow works at http://localhost:8080 as always. From anywhere else (another
   device, or through `npm run share`), Slow and its wisp server are only reachable under
   /<key>/, so only people with your full link can browse through your internet connection.
   The key is made once and kept in .slow-key (not uploaded to GitHub). Delete that file to
   make a new key, which stops old links from working. */

const keyFile = fileURLToPath(new URL("../.slow-key", import.meta.url));
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(12).toString("base64url") + "\n");
const KEY_PATH = `/${readFileSync(keyFile, "utf8").trim()}`;

// A visit from this computer itself (not another device, and not through a tunnel).
function fromThisComputer(req) {
	const address = req.socket.remoteAddress || "";
	const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
	const forwarded =
		req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["forwarded"];
	return loopback && !forwarded;
}

const fastify = Fastify({
	// Slow under /<key>/ is the same Slow as at /.
	rewriteUrl: (req) => (req.url.startsWith(`${KEY_PATH}/`) ? req.url.slice(KEY_PATH.length) : req.url),
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				if (!fromThisComputer(req)) {
					if (req.url === KEY_PATH) {
						res.writeHead(301, { Location: `${KEY_PATH}/` }).end();
						return;
					}
					// Without the key there's nothing here.
					if (!req.url.startsWith(`${KEY_PATH}/`)) {
						res.writeHead(404).end();
						return;
					}
				}
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				const path = req.url.split("?")[0];
				const allowed = path === `${KEY_PATH}/wisp/` || (path === "/wisp/" && fromThisComputer(req));
				if (allowed) wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

// When Slow is opened from this server, it uses this server's own wisp (public/config.js
// is for static hosting like GitHub Pages, which can't run one).
fastify.get("/config.js", (req, reply) => {
	reply
		.type("text/javascript")
		.header("Cache-Control", "no-cache")
		.send('// Served by Slow\'s own server: websites load through this server.\nwindow.SLOW_CONFIG = { wisp: "" };\n');
});

// Share Slow's page (QR code and links for your other devices). Only this computer can open it:
// the links hold your private key.
const sharePage = fileURLToPath(new URL("./share.html", import.meta.url));
const shareFile = fileURLToPath(new URL("../.slow-share.json", import.meta.url));

fastify.get("/share", (req, reply) => {
	if (!fromThisComputer(req.raw)) return reply.code(404).send();
	reply.type("text/html").header("Cache-Control", "no-store").send(readFileSync(sharePage));
});

fastify.get("/share.json", (req, reply) => {
	if (!fromThisComputer(req.raw) || !existsSync(shareFile)) return reply.code(404).send();
	reply.type("application/json").header("Cache-Control", "no-store").send(readFileSync(shareFile));
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();
	console.log("Slow is running.");
	console.log(`\tOn this computer:  http://localhost:${address.port}`);
	console.log('\tOn other devices:  run "npm run share" for your private link');
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
