import type { RecordingBackend } from '@/audio/recording-backend';

import type { SceneRuntime } from '@/audio/scene-runtime';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetKeepListening, KEEP_LISTENING_KEY } from '@/audio/background-listening';
import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';
import { createSilentScene } from '@/scenes/silent-scene';

import { BackgroundListening } from './background-listening';

// jsdom has no AudioContext, and importing the real runtime module pulls in both
// Tone.js and Ember, which build real audio nodes. Swapping the whole module for
// a fake-backed, silent-Scene runtime keeps this suite's default runtime—the
// one background-listening.tsx falls back to when no `runtime` prop is passed—
// off that path too. Copied from listen-invitation.spec.tsx, which needs it for
// the same reason.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent')) };
});

const LABEL = 'Keep listening in the background';

interface PlayingRuntime {
	backend: RecordingBackend;
	runtime: SceneRuntime;
}

async function playingRuntime(): Promise<PlayingRuntime> {
	const backend = createRecordingBackend();
	const runtime = createSceneRuntime(backend, createSilentScene('silent'));
	await runtime.start();
	return { backend, runtime };
}

// Every state is reached before the first render rather than after it, so no
// case here has to drive a store write through act. `startListening` writes
// `opening` ahead of its first await, which is what lets the un-awaited call in
// the opening case land synchronously.
async function listeningRuntime(): Promise<PlayingRuntime> {
	const playing = await playingRuntime();
	await playing.runtime.startListening();
	return playing;
}

// jsdom ships no `standalone` at all, and Safari's is a read-only accessor, so a
// plain assignment is not available on either—the same reasoning
// app-surface.spec.ts records for its own stub. `configurable` is what lets
// afterEach take it back away.
function stubStandalone(value: boolean): void {
	Object.defineProperty(navigator, 'standalone', { configurable: true, value });
}

function checkbox(): HTMLInputElement {
	const found = screen.getByRole('checkbox', { name: LABEL });
	if (!(found instanceof HTMLInputElement)) {
		throw new TypeError('the checkbox role is on something other than an input');
	}
	return found;
}

describe('background-listening', () => {
	// All four outlive a test: jsdom shares one localStorage across the file, the
	// session choice behind the setting is module state, the throwing-storage case
	// replaces a prototype method, and `standalone` is defined on the shared
	// navigator.
	afterEach(() => {
		window.localStorage.clear();
		forgetKeepListening();
		vi.restoreAllMocks();
		Reflect.deleteProperty(navigator, 'standalone');
	});

	it('offers nothing while the Bed is idle', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent'));
		const { container } = render(<BackgroundListening runtime={runtime} />);

		expect(container.firstChild).toBeNull();
	});

	it('offers nothing over a Bed playing without Listening', async () => {
		const { runtime } = await playingRuntime();
		const { container } = render(<BackgroundListening runtime={runtime} />);

		expect(container.firstChild).toBeNull();
	});

	// A refusal has nothing to keep. Offering the setting there would ask the
	// listener to configure a microphone their browser already said no to.
	it('offers nothing to a listener whose browser refused the microphone', async () => {
		const backend = createRecordingBackend({ listening: 'refused' });
		const runtime = createSceneRuntime(backend, createSilentScene('silent'));
		await runtime.start();
		await runtime.startListening();

		const { container } = render(<BackgroundListening runtime={runtime} />);

		expect(runtime.store.getState().listening.status).toBe('refused');
		expect(container.firstChild).toBeNull();
	});

	it('offers the setting while Listening is open', async () => {
		const { runtime } = await listeningRuntime();
		render(<BackgroundListening runtime={runtime} />);

		expect(checkbox()).toBeDefined();
	});

	// The browser's prompt can sit on screen for as long as the listener leaves it
	// there, and the setting is about what happens after they answer, so it has no
	// reason to appear and then disappear across that wait.
	it('offers the setting while the browser is still deciding', async () => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(
			{ ...backend, startListening: (): Promise<void> => new Promise<void>((): void => {}) },
			createSilentScene('silent'),
		);
		await runtime.start();
		void runtime.startListening();

		render(<BackgroundListening runtime={runtime} />);

		expect(runtime.store.getState().listening.status).toBe('opening');
		expect(checkbox()).toBeDefined();
	});

	// A Suspension keeps the listener's consent, so the setting that decides
	// whether the next background trip suspends at all is exactly what they might
	// reach for here.
	it('offers the setting while Listening is suspended', async () => {
		const { backend, runtime } = await listeningRuntime();
		backend.emitMute();

		render(<BackgroundListening runtime={runtime} />);

		expect(runtime.store.getState().listening.status).toBe('suspended');
		expect(checkbox()).toBeDefined();
	});

	it('starts unchecked, because the platform default is what a listener has not chosen', async () => {
		const { runtime } = await listeningRuntime();
		render(<BackgroundListening runtime={runtime} />);

		expect(checkbox().checked).toBe(false);
	});

	it('comes back checked for a listener who turned it on before', async () => {
		window.localStorage.setItem(KEEP_LISTENING_KEY, 'on');
		const { runtime } = await listeningRuntime();

		render(<BackgroundListening runtime={runtime} />);

		expect(checkbox().checked).toBe(true);
	});

	it('writes the choice where the next page load reads it back', async () => {
		const { runtime } = await listeningRuntime();
		render(<BackgroundListening runtime={runtime} />);

		fireEvent.click(checkbox());

		expect(window.localStorage.getItem(KEEP_LISTENING_KEY)).toBe('on');
		expect(checkbox().checked).toBe(true);

		fireEvent.click(checkbox());

		expect(window.localStorage.getItem(KEEP_LISTENING_KEY)).toBe('off');
		expect(checkbox().checked).toBe(false);
	});

	it('still renders when localStorage throws, with the setting off', async () => {
		// Safari's private mode throws on write, and a browser set to block site
		// data throws on read. Neither has anything to do with the microphone, so
		// neither may cost the listener the control. Unchecked is the only safe
		// reading, since Principle I forbids Listening outliving the page on a
		// setting nobody could confirm.
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});
		const { runtime } = await listeningRuntime();

		render(<BackgroundListening runtime={runtime} />);

		expect(checkbox().checked).toBe(false);
		expect(() => fireEvent.click(checkbox())).not.toThrow();
	});

	// ADR 0004: an installed iOS app suspends capture itself whatever the page
	// sets, so a switch here would do nothing. The listener gets the reason
	// instead.
	it('explains itself instead of offering a switch in the installed app', async () => {
		stubStandalone(true);
		const { runtime } = await listeningRuntime();

		render(<BackgroundListening runtime={runtime} />);

		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(screen.getByText(/isn't available in the installed app/i)).toBeDefined();
	});

	it('keeps the switch in a Safari tab, where the page can honor it', async () => {
		stubStandalone(false);
		const { runtime } = await listeningRuntime();

		render(<BackgroundListening runtime={runtime} />);

		expect(checkbox()).toBeDefined();
	});

	// Principle II is non-negotiable, and this is the assertion that a native
	// checkbox is doing the work rather than a div wearing a role. jsdom does not
	// map Space to a click the way a browser does, and this repo carries no
	// user-event dependency, so the click below stands in for the keystroke the
	// browser would synthesize once focus is here.
	it('is reachable and operable from the keyboard', async () => {
		const { runtime } = await listeningRuntime();
		render(<BackgroundListening runtime={runtime} />);

		const input = checkbox();
		input.focus();

		expect(document.activeElement).toBe(input);
		expect(input.disabled).toBe(false);
		expect(input.tabIndex).toBeGreaterThanOrEqual(0);

		fireEvent.click(input);

		expect(checkbox().checked).toBe(true);
	});
});
