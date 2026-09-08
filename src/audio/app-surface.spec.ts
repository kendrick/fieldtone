import { afterEach, describe, expect, it } from 'vitest';

import { isInstalledApp } from './app-surface';

// jsdom ships no `standalone` at all, and Safari's is a read-only accessor, so
// a plain assignment is not available on either. Defining the property is the
// only way to stand one up, and `configurable` is what lets afterEach take it
// back away — copied from page-visibility.spec.ts's stubVisibilityState,
// which stubs a read-only navigator/document property for the same reason.
function stubStandalone(value: boolean): void {
	Object.defineProperty(navigator, 'standalone', {
		configurable: true,
		get: () => value,
	});
}

afterEach((): void => {
	Reflect.deleteProperty(navigator, 'standalone');
});

describe('isInstalledApp', (): void => {
	it('is true once Safari reports the app running standalone', (): void => {
		stubStandalone(true);

		expect(isInstalledApp()).toBe(true);
	});

	it('is false where the browser never implemented the property', (): void => {
		expect(navigator.standalone).toBeUndefined();

		expect(isInstalledApp()).toBe(false);
	});

	it('is false while the same page is running in an ordinary tab', (): void => {
		stubStandalone(false);

		expect(isInstalledApp()).toBe(false);
	});
});
