// @vitest-environment node

// This is the Node prerender `next build` runs over runtime.ts. Node ships a
// real global `navigator` (added in Node 21+), so unlike page-visibility's
// prerender spec, `navigator` itself is not the thing genuinely absent here —
// `document` is, and the first case below leans on that instead.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isInstalledApp } from './app-surface';

afterEach((): void => {
	vi.unstubAllGlobals();
});

describe('isInstalledApp in a Node environment', (): void => {
	it('reports false during the Node prerender', (): void => {
		// document is what's genuinely absent here; navigator is not. Fails
		// loudly if the pragma above ever stops taking effect.
		expect(typeof document).toBe('undefined');

		expect(isInstalledApp()).toBe(false);
	});

	it('reports false where there is no navigator at all', (): void => {
		// Node ships a navigator; other JS runtimes don't. This is the case
		// the `typeof navigator` guard in app-surface.ts actually exists for.
		vi.stubGlobal('navigator', undefined);

		expect(typeof navigator).toBe('undefined');
		expect(isInstalledApp()).toBe(false);
	});
});
