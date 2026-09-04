// Where a worklet module served out of public/ actually lives, worked out from
// the page URL. Its own file because the arithmetic is subtle enough to have
// been wrong twice, and Tone-free so it can be asserted on under jsdom with no
// AudioContext anywhere near it.

// `next.config.ts` sets `basePath: '/fieldtone'`, and AGENTS.md makes
// `src/app/manifest.ts` the only file allowed to write that prefix by hand. So
// the specifier stays relative and the page URL supplies the prefix.
//
// Two things make that harder than it reads. The dev server serves this route
// as `/fieldtone` while the static export serves it as `/fieldtone/`, and
// relative resolution against the slashless form replaces the last path segment
// rather than extending it, which drops the prefix entirely. And a share link
// carries the Scene's parameters as a query, so the URL frequently ends in a
// digit; testing the whole string for a trailing slash answers a question about
// the query rather than about the path.
//
// Resolving against the path alone settles both. The query and fragment are
// dropped on the way, which is correct: they describe the Scene, not the asset.
export function workletModuleUrl(baseUri: string, specifier: string): string {
	const page = new URL(baseUri);
	const directory = page.pathname.endsWith('/') ? page.pathname : `${page.pathname}/`;

	return new URL(specifier, `${page.origin}${directory}`).href;
}
