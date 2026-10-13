// Settings for where Slow is published as plain files (like GitHub Pages).
// (When Slow runs on its own server, `npm start`, the server sends its own settings instead,
// so websites load through that server's built-in wisp.)
window.SLOW_CONFIG = {
	// The wisp server that websites load through, like "wss://wisp.example.org/".
	// GitHub Pages can't run a wisp server, so this is set to a public one.
	// People can still change it for themselves in Settings > Connection
	// (or with the link `npm run share` prints, to load through your own computer).
	// Mercury Workshop's public wisp server (the makers of Scramjet).
	wisp: "wss://wisp.mercurywork.shop/",
};
