import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// public/sw.js keeps its runtime asset list by hand, because these files are
// fetched by the audio backend at the first press rather than named in the HTML
// the shell scrape reads. Nothing links the two, so a worklet added or renamed
// without touching the worker would go on being served from cache forever, and
// the symptom would be a returning listener running a processor a deploy old.
//
// Read as text rather than imported: sw.js is a classic worker script that
// touches `self.registration` at module scope, and importing it under jsdom would
// mean faking the worker globals to assert on a string literal.
const worker = readFileSync('public/sw.js', 'utf8');
const backend = readFileSync('src/audio/tone-backend.ts', 'utf8');
const processor = readFileSync('public/worklets/level-listening.js', 'utf8');

function runtimeAssets(): string[] {
	const list = /const RUNTIME_ASSETS = \[([^\]]*)\]/.exec(worker)?.[1];
	if (list === undefined) {
		throw new Error('public/sw.js no longer declares RUNTIME_ASSETS');
	}
	return [...list.matchAll(/'([^']+)'/g)].map(match => match[1] ?? '');
}

describe('service worker runtime assets', (): void => {
	it('lists the module the backend loads', (): void => {
		const requested = /const LEVEL_LISTENING_MODULE = '([^']+)'/.exec(backend)?.[1];

		expect(requested).toBeDefined();
		expect(runtimeAssets()).toContain(requested);
	});

	it('lists what the processor imports beside it', (): void => {
		// The processor is served as a module and imports its maths from a sibling,
		// so that file is fetched too and goes stale the same way.
		const imported = /from '\.\/([^']+)'/.exec(processor)?.[1];

		expect(imported).toBeDefined();
		expect(runtimeAssets().some(asset => asset.endsWith(imported ?? ''))).toBe(true);
	});
});
