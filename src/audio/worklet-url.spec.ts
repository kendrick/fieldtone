import { describe, expect, it } from 'vitest';

import { workletModuleUrl } from './worklet-url';

// Every case here is a URL this app actually produces. The share link ones are
// the reason the file exists: `share-control.tsx` hands out a link carrying the
// Scene's parameters, so a listener arriving through one has a query on the URL
// for the whole session, including when they press "Let it listen".
const SPECIFIER = 'worklets/level-listening.js';

describe('workletModuleUrl', () => {
	it('keeps the base path when the page URL already ends in a slash', () => {
		expect(workletModuleUrl('http://localhost:3101/fieldtone/', SPECIFIER)).toBe(
			'http://localhost:3101/fieldtone/worklets/level-listening.js',
		);
	});

	// `next dev` serves this route without the trailing slash, and resolving
	// against it directly replaces `fieldtone` instead of extending it.
	it('keeps the base path when the page URL has no trailing slash', () => {
		expect(workletModuleUrl('http://localhost:3000/fieldtone', SPECIFIER)).toBe(
			'http://localhost:3000/fieldtone/worklets/level-listening.js',
		);
	});

	// The case that broke a hand check: the string ends in `1`, so asking whether
	// the whole URL ends in a slash answers a question about the query.
	it('keeps the base path when a share link puts a query after it', () => {
		expect(workletModuleUrl('http://localhost:3000/fieldtone?space=0.8&brightness=1', SPECIFIER)).toBe(
			'http://localhost:3000/fieldtone/worklets/level-listening.js',
		);
	});

	it('keeps the base path when a share link follows the slash', () => {
		expect(workletModuleUrl('http://localhost:3101/fieldtone/?space=0.8&brightness=1', SPECIFIER)).toBe(
			'http://localhost:3101/fieldtone/worklets/level-listening.js',
		);
	});

	it('drops a fragment rather than carrying it onto the asset', () => {
		expect(workletModuleUrl('https://kendrick.github.io/fieldtone/#listening', SPECIFIER)).toBe(
			'https://kendrick.github.io/fieldtone/worklets/level-listening.js',
		);
	});

	// Deployed without a basePath, which is what a fork serving from a domain root
	// would get. Nothing to preserve, and nothing to lose either.
	it('works when the app is served from the root', () => {
		expect(workletModuleUrl('https://fieldtone.example/', SPECIFIER)).toBe(
			'https://fieldtone.example/worklets/level-listening.js',
		);
	});
});
