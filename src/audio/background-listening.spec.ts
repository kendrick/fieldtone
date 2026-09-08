import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSilentScene } from '@/scenes/silent-scene';
import {
	KEEP_LISTENING_KEY,
	keepListeningVisibility,
	readKeepListening,
	writeKeepListening,
} from './background-listening';
import { createFakeVisibility } from './fake-visibility';
import { createRecordingBackend } from './recording-backend';

import { createSceneRuntime } from './scene-runtime';

const silentScene = createSilentScene('silent');

// Copied from app-surface.spec.ts's stubStandalone: jsdom ships no `standalone`
// at all, and Safari's is a read-only accessor, so a plain assignment is not
// available on either. `configurable` is what lets afterEach take it back away.
function stubStandalone(value: boolean): void {
	Object.defineProperty(navigator, 'standalone', {
		configurable: true,
		get: () => value,
	});
}

afterEach((): void => {
	window.localStorage.clear();
	Reflect.deleteProperty(navigator, 'standalone');
	vi.restoreAllMocks();
});

describe('readKeepListening / writeKeepListening', (): void => {
	it('reads false before the listener has ever chosen', (): void => {
		expect(readKeepListening()).toBe(false);
	});

	it('round-trips a write', (): void => {
		writeKeepListening(true);

		expect(readKeepListening()).toBe(true);

		writeKeepListening(false);

		expect(readKeepListening()).toBe(false);
	});

	it('reads false, and does not throw, where a browser set to block site data throws on read', (): void => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});

		expect(() => readKeepListening()).not.toThrow();
		expect(readKeepListening()).toBe(false);
	});

	it('does not throw where Safari private mode throws on write', (): void => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});

		expect(() => writeKeepListening(true)).not.toThrow();
	});

	it('namespaces the key, because localStorage is shared across every project page an origin serves', (): void => {
		expect(KEEP_LISTENING_KEY).toBe('fieldtone.listening.background');
	});
});

describe('keepListeningVisibility', (): void => {
	function fakeInner(hidden: boolean): { isHidden: () => boolean; subscribe: (listener: () => void) => () => void } {
		return {
			isHidden: (): boolean => hidden,
			subscribe: vi.fn((): (() => void) => (): void => {}),
		};
	}

	it('reports visible while the page is hidden, the opt-in is on, and the page is an ordinary tab', (): void => {
		writeKeepListening(true);
		const wrapped = keepListeningVisibility(fakeInner(true));

		expect(wrapped.isHidden()).toBe(false);
	});

	it('reports hidden where the opt-in is on but the page is running as an installed app', (): void => {
		writeKeepListening(true);
		stubStandalone(true);
		const wrapped = keepListeningVisibility(fakeInner(true));

		expect(wrapped.isHidden()).toBe(true);
	});

	it('reports hidden where the opt-in is off', (): void => {
		writeKeepListening(false);
		const wrapped = keepListeningVisibility(fakeInner(true));

		expect(wrapped.isHidden()).toBe(true);
	});

	it('reports visible whenever the inner port does, in every combination of the opt-in and the surface', (): void => {
		for (const keep of [true, false]) {
			for (const installed of [true, false]) {
				writeKeepListening(keep);
				stubStandalone(installed);
				const wrapped = keepListeningVisibility(fakeInner(false));

				expect(wrapped.isHidden()).toBe(false);
			}
		}
	});

	it('passes subscribe straight through to the inner port', (): void => {
		const unsubscribe = (): void => {};
		const inner = {
			isHidden: (): boolean => false,
			subscribe: vi.fn(() => unsubscribe),
		};
		const wrapped = keepListeningVisibility(inner);
		const listener = (): void => {};

		const returned = wrapped.subscribe(listener);

		expect(inner.subscribe).toHaveBeenCalledWith(listener);
		expect(returned).toBe(unsubscribe);
	});
});

// Composition through the real runtime, the same shape as the "scene runtime
// listening suspension" describe block in scene-runtime.spec.ts (from line
// 992): the decorator is only worth building if createSceneRuntime never has
// to learn the opt-in exists, so these drive it through that seam rather than
// asserting on the decorator in isolation.
describe('keepListeningVisibility composed into the scene runtime', (): void => {
	it('keeps Listening running when the page hides with the opt-in on', async (): Promise<void> => {
		writeKeepListening(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		const runtime = createSceneRuntime(backend, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		await runtime.startListening();
		const settled = backend.commands.length;
		visibility.hide();

		expect(backend.commands.slice(settled)).toEqual([]);
		expect(runtime.store.getState().listening.status).toBe('listening');
	});

	it('still suspends on mute with the opt-in on: the platform trigger stays unconditional', async (): Promise<void> => {
		writeKeepListening(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		const runtime = createSceneRuntime(backend, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		await runtime.startListening();
		backend.emitMute();

		expect(runtime.store.getState().listening).toEqual({ status: 'suspended' });
	});

	it('suspends on hide in an installed app whatever the opt-in says', async (): Promise<void> => {
		writeKeepListening(true);
		stubStandalone(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		const runtime = createSceneRuntime(backend, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		await runtime.startListening();
		visibility.hide();

		expect(runtime.store.getState().listening).toEqual({ status: 'suspended' });
	});

	it('does not suspend a grant that completes into a page already hidden with the opt-in on', async (): Promise<void> => {
		writeKeepListening(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		let grantMicrophone: () => void = (): void => {};
		const prompt = new Promise<void>((resolve): void => {
			grantMicrophone = resolve;
		});
		const runtime = createSceneRuntime({
			...backend,
			startListening: async (): Promise<void> => {
				await backend.startListening();
				return prompt;
			},
		}, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		const accepting = runtime.startListening();
		visibility.hide();
		grantMicrophone();

		expect(await accepting).toEqual({ ok: true });
		expect(runtime.store.getState().listening.status).toBe('listening');
	});
});
