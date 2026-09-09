import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSilentScene } from '@/scenes/silent-scene';
import {
	forgetKeepListening,
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

function hiddenPort(): { isHidden: () => boolean; subscribe: () => () => void } {
	return { isHidden: (): boolean => true, subscribe: () => (): void => {} };
}

afterEach((): void => {
	window.localStorage.clear();
	// The session choice outlives a test the way localStorage does, so it gets
	// cleared the same way: state carried into the next case makes it lie.
	forgetKeepListening();
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

describe('a second tab on the same origin', (): void => {
	// The component shows what it read when it mounted. A tab that kept re-reading
	// storage would answer to a box somewhere else: this one would go on showing
	// off while suppressing its own suspension, holding the microphone open in the
	// background over a control that said it would not.
	it('does not move this tab, which would leave its box saying off over a live microphone', (): void => {
		const shownInTheBox = readKeepListening();

		window.localStorage.setItem(KEEP_LISTENING_KEY, 'on');

		expect(readKeepListening()).toBe(shownInTheBox);
		expect(keepListeningVisibility(hiddenPort()).isHidden()).toBe(true);
	});

	// The latch is this tab's, not a refusal to ever read storage: a reload is a
	// new tab as far as this is concerned, which is what makes the setting stick.
	it('is read again from storage once the tab starts over', (): void => {
		window.localStorage.setItem(KEEP_LISTENING_KEY, 'on');
		forgetKeepListening();

		expect(readKeepListening()).toBe(true);
	});
});

describe('a write localStorage refuses', (): void => {
	function refuseWrites(): void {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
	}

	// The dangerous half. A shared origin can run out of quota with this key
	// already set to `on`, and before the session choice carried the decision a
	// swallowed write left Listening running in the background over a control
	// the listener had just switched off. Principle I is non-negotiable, so a
	// disable has to take effect whether or not storage accepts it.
	it('still turns the setting off, so no storage failure can hold the microphone open', (): void => {
		window.localStorage.setItem(KEEP_LISTENING_KEY, 'on');
		refuseWrites();

		writeKeepListening(false);

		expect(readKeepListening()).toBe(false);
		expect(keepListeningVisibility(hiddenPort()).isHidden()).toBe(true);
	});

	// The safe half, and the reason storage is persistence rather than the
	// source of truth: the choice holds for this session and is forgotten on
	// reload, rather than not taking at all.
	it('still turns the setting on for this session, and forgets it on reload', (): void => {
		refuseWrites();

		writeKeepListening(true);

		expect(readKeepListening()).toBe(true);
		expect(keepListeningVisibility(hiddenPort()).isHidden()).toBe(false);

		forgetKeepListening();

		expect(readKeepListening()).toBe(false);
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

	// Asserted through the notification rather than by function identity: the
	// decorator now hands the inner port a wrapper of its own, so that it can
	// drop the hide edge the opt-in makes unsafe to answer. What has to hold is
	// that one subscription reaches the inner port, that a notification from it
	// reaches the listener, and that the inner port's unsubscribe is what comes
	// back.
	it('subscribes to the inner port once and hands its unsubscribe back', (): void => {
		const unsubscribe = (): void => {};
		let notifyInner = (): void => {};
		const inner = {
			isHidden: (): boolean => false,
			subscribe: vi.fn((onChange: () => void) => {
				notifyInner = onChange;
				return unsubscribe;
			}),
		};
		const wrapped = keepListeningVisibility(inner);
		const listener = vi.fn();

		const returned = wrapped.subscribe(listener);
		notifyInner();

		expect(inner.subscribe).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledTimes(1);
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

	// The hide edge is swallowed rather than answered while the opt-in applies,
	// because scene-runtime reads the direction off the port: a hide arriving
	// while the port reports visible takes the resume branch. Over a suspension
	// the track's mute caused — an incoming call — that asks for the microphone
	// again from a hidden page, and getUserMedia parks there instead of
	// rejecting, stranding the attempt in `opening`.
	it('does not ask for the microphone again when the page hides over a mute suspension', async (): Promise<void> => {
		writeKeepListening(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		const runtime = createSceneRuntime(backend, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		await runtime.startListening();
		backend.emitMute();
		const settled = backend.commands.length;

		visibility.hide();

		expect(backend.commands.slice(settled)).toEqual([]);
		expect(runtime.store.getState().listening.status).toBe('suspended');
	});

	// The other half of that asymmetry. A mute suspension outlives the opt-in, so
	// coming back to the page is when it recovers, exactly as it does for a
	// listener who never opted in.
	it('resumes a mute suspension when the listener comes back', async (): Promise<void> => {
		writeKeepListening(true);
		const backend = createRecordingBackend();
		const visibility = createFakeVisibility();
		const runtime = createSceneRuntime(backend, silentScene, keepListeningVisibility(visibility));

		await runtime.start();
		await runtime.startListening();
		backend.emitMute();
		visibility.hide();
		const settled = backend.commands.length;

		visibility.show();

		expect(backend.commands.slice(settled)).toEqual([{ kind: 'startListening' }]);
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
