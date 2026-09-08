// @vitest-environment node

// This is the Node prerender `next build` runs over runtime.ts: no `document`
// exists in this environment, and createDocumentVisibility must not reach for
// one anyway.
import { describe, expect, it } from 'vitest';

import { createDocumentVisibility } from './page-visibility';

describe('createDocumentVisibility in a Node environment', (): void => {
	it('falls back to always-visible no-ops with no document in scope', (): void => {
		// Fails loudly if the environment pragma above ever stops taking effect.
		expect(typeof document).toBe('undefined');

		const visibility = createDocumentVisibility();

		expect(visibility.isHidden()).toBe(false);
		expect(typeof visibility.subscribe(() => {})).toBe('function');
	});
});
