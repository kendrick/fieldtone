import type { ListeningRejectionReason } from '@/audio/listening-state';
import type { RecordingBackend } from '@/audio/recording-backend';

import type { SceneRuntime } from '@/audio/scene-runtime';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';
import { createSilentScene } from '@/scenes/silent-scene';

import { ListenInvitation } from './listen-invitation';

// jsdom implements no AnimationEvent, and react-dom reads `'AnimationEvent' in
// window` when it is first imported to decide whether to bind `animationend` or
// the webkit-prefixed name. Left alone, React listens for `webkitAnimationEnd`
// here and fireEvent.animationEnd reaches nothing. That is a hole in jsdom, not
// in the component: every browser this ships to has the event. vi.hoisted is
// what gets the stub in place ahead of react-dom's own evaluation.
vi.hoisted(() => {
	Object.defineProperty(globalThis, 'AnimationEvent', {
		configurable: true,
		writable: true,
		value: class extends Event {},
	});
});

// jsdom has no AudioContext, and importing the real runtime module pulls in both
// Tone.js and Ember, which build real audio nodes. Swapping the whole module for
// a fake-backed, silent-Scene runtime keeps this suite's default runtime—the one
// listen-invitation.tsx falls back to when no `runtime` prop is passed—off that
// path too.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent')) };
});

const OFFERED_KEY = 'fieldtone.invitation.listen';

interface PlayingRuntime {
	backend: RecordingBackend;
	runtime: SceneRuntime;
}

// The Invitation is offered only over a Bed that is already playing, so nearly
// every case here has to get the runtime there before the first render.
async function playingRuntime(listening?: ListeningRejectionReason): Promise<PlayingRuntime> {
	const backend = createRecordingBackend(listening === undefined ? {} : { listening });
	const runtime = createSceneRuntime(backend, createSilentScene('silent'));
	await runtime.start();
	return { backend, runtime };
}

// Found by class rather than a test id, because the class is what the CSS floor
// keys off: asserting through it proves the wrapper carrying `data-returning` is
// the same one the animation targets. The throw narrows the null away without an
// `as`.
function invitationFloor(container: HTMLElement): Element {
	const floor = container.querySelector('.invitation-floor');
	if (floor === null) {
		throw new Error('no .invitation-floor wrapper rendered');
	}
	return floor;
}

describe('listen-invitation', () => {
	// Both of these outlive a test: jsdom shares one localStorage across the
	// file, and the throwing-storage case replaces a prototype method.
	afterEach(() => {
		window.localStorage.clear();
		vi.restoreAllMocks();
	});

	it('renders nothing while the Bed is idle', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent'));
		const { container } = render(<ListenInvitation runtime={runtime} />);

		expect(container.firstChild).toBeNull();
	});

	it('offers the Invitation once the Bed is playing', async () => {
		const { runtime } = await playingRuntime();
		render(<ListenInvitation runtime={runtime} />);

		expect(screen.getByRole('button', { name: 'Let it listen' })).toBeDefined();
	});

	it('reaches the backend as startListening when the Invitation is accepted', async () => {
		const { backend, runtime } = await playingRuntime();
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		// The state settles a microtask past the click, and findBy is what lets
		// React flush that inside act.
		await screen.findByRole('button', { name: 'Stop listening' });

		expect(backend.commands).toContainEqual({ kind: 'startListening' });
		expect(screen.getByRole('status').textContent).toBe('Listening');
	});

	it('releases the microphone when the listener stops listening', async () => {
		const { backend, runtime } = await playingRuntime();
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		fireEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));

		expect(backend.commands).toContainEqual({ kind: 'stopListening' });
		expect(screen.getByRole('button', { name: 'Let it listen' })).toBeDefined();
	});

	// One case per reason rather than a loop, because the two halves of each case
	// differ: what the listener is told, and whether pressing again could change
	// the answer.
	it('tells a refused listener to change the browser setting, and stops offering', async () => {
		const { runtime } = await playingRuntime('refused');
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		const message = await screen.findByRole('status');

		expect(message.textContent).toMatch(/browser/i);
		expect(message.textContent).toMatch(/settings/i);
		expect(screen.queryByRole('button', { name: 'Let it listen' })).toBeNull();
	});

	it('keeps the Invitation open when no microphone is attached', async () => {
		const { runtime } = await playingRuntime('no-microphone');
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		const message = await screen.findByRole('status');

		expect(message.textContent).toMatch(/no microphone/i);
		expect(screen.getByRole('button', { name: 'Let it listen' })).toBeDefined();
	});

	it('keeps the Invitation open when another app holds the microphone', async () => {
		const { runtime } = await playingRuntime('busy');
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		const message = await screen.findByRole('status');

		expect(message.textContent).toMatch(/another app/i);
		expect(screen.getByRole('button', { name: 'Let it listen' })).toBeDefined();
	});

	it('stops offering when the browser cannot open a microphone at all', async () => {
		const { runtime } = await playingRuntime('unavailable');
		render(<ListenInvitation runtime={runtime} />);

		fireEvent.click(screen.getByRole('button', { name: 'Let it listen' }));
		const message = await screen.findByRole('status');

		expect(message.textContent).toMatch(/cannot open a microphone/i);
		expect(screen.queryByRole('button', { name: 'Let it listen' })).toBeNull();
	});

	it('remembers that the Invitation was offered once the reveal finishes', async () => {
		const { runtime } = await playingRuntime();
		const { container } = render(<ListenInvitation runtime={runtime} />);

		fireEvent.animationEnd(invitationFloor(container));

		expect(window.localStorage.getItem(OFFERED_KEY)).toBe('offered');
	});

	it('waits out the floor for a listener who has never been offered it', async () => {
		const { runtime } = await playingRuntime();
		const { container } = render(<ListenInvitation runtime={runtime} />);

		expect(invitationFloor(container).hasAttribute('data-returning')).toBe(false);
	});

	it('drops the floor for a returning listener', async () => {
		window.localStorage.setItem(OFFERED_KEY, 'offered');
		const { runtime } = await playingRuntime();
		const { container } = render(<ListenInvitation runtime={runtime} />);

		expect(invitationFloor(container).hasAttribute('data-returning')).toBe(true);
	});

	it('still offers the Invitation when localStorage throws', async () => {
		// Safari's private mode throws on write, and a browser set to block site
		// data throws on read. Neither has anything to do with the microphone, so
		// neither may cost the listener the Invitation.
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('site data is blocked');
		});
		const { runtime } = await playingRuntime();

		const { container } = render(<ListenInvitation runtime={runtime} />);

		expect(screen.getByRole('button', { name: 'Let it listen' })).toBeDefined();
		expect(() => fireEvent.animationEnd(invitationFloor(container))).not.toThrow();
	});
});
