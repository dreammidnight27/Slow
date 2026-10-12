// Builds a static copy of Slow in dist/ for hosts that only serve files, like GitHub Pages.
// It's Slow's own files plus the Scramjet, libcurl and bare-mux files that `npm start` serves.
// Websites still need a wisp server: set one in public/config.js before publishing.

import { cpSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const dist = root("dist");

rmSync(dist, { recursive: true, force: true });
// (skips .claude, which only holds local editor settings)
cpSync(root("public"), dist, { recursive: true, filter: (path) => basename(path) !== ".claude" });
cpSync(scramjetPath, `${dist}/scram`, { recursive: true });
cpSync(libcurlPath, `${dist}/libcurl`, { recursive: true });
cpSync(baremuxPath, `${dist}/baremux`, { recursive: true });

// Tells GitHub Pages to serve the files as they are (no Jekyll processing).
writeFileSync(`${dist}/.nojekyll`, "");

console.log("Built Slow for static hosting in dist/");
