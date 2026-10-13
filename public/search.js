"use strict";
/**
 * Turns what was typed into the address to open: a web address as it is, or a search.
 *
 * @param {string} input
 * @param {string} template Template for a search query.
 * @returns {string} Fully qualified URL
 */
function search(input, template) {
	try {
		// A full web address, like https://example.com/test?q=param.
		// (Only http and https: "minecraft:java" is a search, not an address.)
		const url = new URL(input);
		if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
	} catch (err) {
		// not a full address
	}

	try {
		// An address without the https:// part, like example.com or example.com/test.
		// Tried as https first, like other browsers (it's faster than being redirected there,
		// and nearly every site supports it).
		const url = new URL(`https://${input}`);
		// Only real-looking addresses: a name ending like ".com", or a full IP address.
		// ("3.14" is a search, not an address.)
		const typedHost = input.split(/[/?#:]/)[0];
		const hasEnding = /\.([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(url.hostname);
		const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(typedHost);
		if ((hasEnding || isIp) && !/\s/.test(input)) return url.toString();
	} catch (err) {
		// not an address
	}

	// Anything else is a search.
	return template.replace("%s", encodeURIComponent(input));
}
