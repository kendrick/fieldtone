// The static export copies this to out/sw.js, so the worker is served from the
// app's own directory and a relative registration scopes it there. AGENTS.md
// reserves writing the base path by hand for src/app/manifest.ts, so no path
// below spells one out: each resolves against the scope or this worker's URL.
const CACHE = 'fieldtone-shell-v1';
const SHELL = self.registration.scope;

// Next fingerprints its chunks, so the shell's asset list exists only in the HTML
// that names them. Both attributes count: script chunks arrive as src=, the CSS
// chunk and a duplicate preload as href=. Anchoring on _next/static/ rather than
// on the attribute keeps manifest.webmanifest and the icon links out of the cache.
const CHUNKS = /(?:src|href)="([^"]*_next\/static\/[^"]*)"/g;

// Shared by install and by every navigation that reaches the network. That sharing
// is what moves a returning visitor onto a build published since their last visit
// instead of stranding them on the one they first installed.
async function reviseShell(response) {
	// Throwing rather than returning is what fails an install that could not reach
	// the shell. A fulfilled install would skipWaiting and activate against an empty
	// cache, and the next cache-name bump would then delete the working cache the
	// outgoing worker left behind. The navigation path swallows this instead.
	if (!response.ok)
		throw new Error('shell unavailable');
	const cache = await caches.open(CACHE);
	// Clone before text() drains the body. This copy is what gets cached below.
	const shell = response.clone();
	const html = await response.text();
	const wanted = new Set([...html.matchAll(CHUNKS)].map((match) => new URL(match[1], SHELL).href));
	const held = await cache.keys();
	// Add first, replace second, delete last. addAll rejects atomically on one bad
	// response, so deleting ahead of it would strand a returning visitor with fresh
	// HTML and no chunks, and a single flaky refresh would cost them the offline app
	// they already had. In this order a rejection leaves the previous build whole.
	await cache.addAll([...wanted].filter((url) => !held.some((request) => request.url === url)));
	// put() rather than addAll() so the key is the bare scope URL. A shared link
	// carries a query string, and offline that navigation has to find this entry.
	await cache.put(SHELL, shell);
	await Promise.all(held
		.filter((request) => request.url.includes('_next/static/') && !wanted.has(request.url))
		.map((request) => cache.delete(request)));
}

async function cacheFirst(request) {
	const hit = await caches.match(request);
	if (hit)
		return hit;
	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(CACHE);
		await cache.put(request, response.clone());
	}
	return response;
}

self.addEventListener('install', (event) => {
	// './' resolves against this worker's URL, which is the scope directory. The
	// no-cache is what stops the HTTP cache from handing back the very build this
	// worker was deployed to replace.
	event.waitUntil(fetch('./', { cache: 'no-cache' })
		.then(reviseShell)
		.then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		// CacheStorage partitions by origin and not by scope, so caches.keys() hands
		// back the caches of every other project site sharing kendrick.github.io.
		// Only names carrying this app's own prefix are ours to delete.
		const names = await caches.keys();
		await Promise.all(names
			.filter((name) => name.startsWith('fieldtone-') && name !== CACHE)
			.map((name) => caches.delete(name)));
		// Claiming makes the first visit a controlled one, so the app works offline
		// without a second load, and so a test can wait on the controller appearing
		// rather than on a reload.
		await self.clients.claim();
	})());
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin)
		return;
	if (request.mode !== 'navigate') {
		event.respondWith(cacheFirst(request));
		return;
	}
	// Cache-first for the document would pin a visitor to the build that was current
	// the day they installed, with no way off it. reviseShell runs beside the
	// response rather than ahead of it, so a fresh set of chunks never delays the
	// page that is about to ask for them.
	const network = fetch(request);
	event.waitUntil(network.then((response) => reviseShell(response.clone())).catch(() => {}));
	event.respondWith(network.catch(() => caches.match(SHELL)));
});
