import { afterEach, describe, expect, it, vi } from 'vitest';

import { alwaysVisible, createDocumentVisibility } from './page-visibility';

// jsdom's `visibilityState` is a read-only accessor, so a plain assignment is
// not available. Defining the property is the only way to stand one up, and
// `configurable` is what lets afterEach take it back away — copied from
// audio-session.spec.ts's stubAudioSession, which stubs navigator.audioSession
// for the same reason.
function stubVisibilityState(state: DocumentVisibilityState): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	});
}

afterEach((): void => {
	Reflect.deleteProperty(document, 'visibilityState');
});

describe('createDocumentVisibility', (): void => {
	it('reads hidden from the document at call time, not from the event', (): void => {
		stubVisibilityState('hidden');
		const visibility = createDocumentVisibility();

		expect(visibility.isHidden()).toBe(true);

		// No visibilitychange dispatched. If isHidden cached the last event
		// instead of re-reading the document, this would still report true —
		// exactly the stale read WebKit bug 207256 makes unsafe to trust.
		stubVisibilityState('visible');

		expect(visibility.isHidden()).toBe(false);
	});

	it('notifies a subscriber on visibilitychange and stops after unsubscribe', (): void => {
		stubVisibilityState('visible');
		const visibility = createDocumentVisibility();
		const listener = vi.fn();

		const unsubscribe = visibility.subscribe(listener);
		document.dispatchEvent(new Event('visibilitychange'));

		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		document.dispatchEvent(new Event('visibilitychange'));

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe('alwaysVisible', (): void => {
	it('never hides and never calls back', (): void => {
		const listener = vi.fn();

		expect(alwaysVisible.isHidden()).toBe(false);

		const unsubscribe = alwaysVisible.subscribe(listener);
		document.dispatchEvent(new Event('visibilitychange'));

		expect(listener).not.toHaveBeenCalled();
		expect((): void => {
			unsubscribe();
		}).not.toThrow();
	});
});
