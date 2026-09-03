import type { SceneRuntime } from '@/audio/scene-runtime';

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';
import { emberParameters } from '@/scenes/ember/parameters';
import { createSilentScene } from '@/scenes/silent-scene';

import { ShareControl } from './share-control';

// jsdom has no AudioContext, and importing the real runtime module pulls in
// both Tone.js and Ember, which build real audio nodes. Swapping the whole
// module for a fake-backed, silent-Scene runtime keeps this suite's default
// runtime—the one share-control.tsx falls back to when no `runtime` prop is
// passed—off that path too.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent')) };
});

// jsdom ships neither API, so a case that wants one defines an own property on
// the shared navigator and afterEach deletes it again. That absence is also what
// the clipboard cases below stand on: a browser with no `navigator.share` is the
// desktop-Firefox path the fallback exists for, and here it needs no stubbing.
function stubShare(share: unknown): void {
	Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
}

function stubWriteText(writeText: unknown): void {
	Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: { writeText } });
}

// The link has to carry every declared parameter, so the assertion compares the
// whole query string against what the runtime would serialize rather than
// spot-checking the key the case happened to move.
function expectTotalLink(link: unknown, runtime: SceneRuntime): void {
	expect(typeof link).toBe('string');
	const url = new URL(String(link));
	expect([...url.searchParams].sort()).toEqual([...new URLSearchParams(runtime.serializeParameters())].sort());
}

// Throws rather than returning undefined, so a case asserting on the field says
// so in its own failure message instead of comparing undefined to a URL.
function fieldValue(): string {
	const field = screen.getByRole('textbox', { name: 'Link to this Scene' });
	if (!(field instanceof HTMLInputElement)) {
		throw new TypeError('the link field is not an input');
	}

	return field.value;
}

async function press(): Promise<void> {
	// act rather than a bare click: the handler resolves through a promise chain
	// two or three microtasks deep, and this is what drains it before the
	// assertions read the live region.
	await act(async () => {
		screen.getByRole('button', { name: 'Share this Scene' }).click();
	});
}

describe('share-control', () => {
	afterEach(() => {
		Reflect.deleteProperty(navigator, 'share');
		Reflect.deleteProperty(navigator, 'clipboard');
		window.history.replaceState(null, '', '/');
	});

	it('renders a button named for the Scene it shares', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		expect(screen.getByRole('button', { name: 'Share this Scene' })).toBeDefined();
	});

	it('mounts the status region empty, before there is anything to say', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		expect(screen.getByRole('status').textContent).toBe('');
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('hands a total link to the share sheet where the browser has one', async () => {
		// The link is captured by the stub rather than read back out of
		// `mock.calls`, which is typed as possibly empty and would need a cast to
		// index into.
		let shared: unknown;
		const share = vi.fn(async (data: ShareData) => {
			shared = data.url;
		});
		stubShare(share);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		runtime.setParameter('space', 0.6);
		render(<ShareControl runtime={runtime} />);

		await press();

		expect(share).toHaveBeenCalledTimes(1);
		expectTotalLink(shared, runtime);
		// Brightness was never touched. The link pins it anyway, which is the whole
		// reason this reads the runtime instead of the address bar.
		expect(String(shared)).toContain('brightness=1');
	});

	it('copies the link and says so where there is no share sheet', async () => {
		let copied: unknown;
		const writeText = vi.fn(async (link: string) => {
			copied = link;
		});
		stubWriteText(writeText);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		await press();

		expect(writeText).toHaveBeenCalledTimes(1);
		expectTotalLink(copied, runtime);
		expect(screen.getByRole('status').textContent).toBe('Link copied');
	});

	it('hands over the link itself when the clipboard refuses', async () => {
		stubWriteText(vi.fn().mockRejectedValue(new Error('denied')));
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		await press();

		expect(screen.getByRole('status').textContent).toBe('Couldn\'t copy the link. Select it from the field below.');
		// The address bar is empty until a control moves, so pointing at it would
		// hand back the bare `/` this whole feature exists to replace. The field
		// carries the total link instead, and it has to be the same one the
		// clipboard was offered.
		const field = screen.getByRole('textbox', { name: 'Link to this Scene' });
		expect(field).toBeInstanceOf(HTMLInputElement);
		expectTotalLink((field as HTMLInputElement).value, runtime);
		expect((field as HTMLInputElement).readOnly).toBe(true);
	});

	it('takes the field back once a press succeeds', async () => {
		const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
		stubWriteText(writeText);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		await press();
		expect(screen.queryByRole('textbox', { name: 'Link to this Scene' })).not.toBeNull();

		await press();

		// AC 7: nothing the failure put on screen may outlive it. The message
		// fades on its own, and the field goes the moment it has no job left.
		expect(screen.queryByRole('textbox', { name: 'Link to this Scene' })).toBeNull();
		expect(screen.getByRole('status').textContent).toBe('Link copied');
	});

	it('says nothing when the listener dismisses the share sheet', async () => {
		const dismissal = new Error('dismissed');
		dismissal.name = 'AbortError';
		const share = vi.fn().mockRejectedValue(dismissal);
		stubShare(share);
		const writeText = vi.fn().mockResolvedValue(undefined);
		stubWriteText(writeText);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		await press();

		expect(share).toHaveBeenCalledTimes(1);
		// A dismissal is an answer, not a failure, so it neither leaves a message
		// behind nor quietly copies a link the listener declined to share.
		expect(writeText).not.toHaveBeenCalled();
		expect(screen.getByRole('status').textContent).toBe('');
		// The field comes anyway, because `AbortError` is also what a browser with
		// no share targets rejects with, and the name cannot tell the two apart.
		// Offering the link asserts nothing about which one happened; staying
		// silent would leave that browser a button that does nothing at all.
		expectTotalLink(fieldValue(), runtime);
	});

	it('falls through to the clipboard when the share sheet fails for any other reason', async () => {
		stubShare(vi.fn().mockRejectedValue(new Error('no handler')));
		const writeText = vi.fn().mockResolvedValue(undefined);
		stubWriteText(writeText);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		await press();

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('status').textContent).toBe('Link copied');
	});

	it('lets the newest press win when an older one settles late', async () => {
		let rejectFirst: ((reason: Error) => void) | undefined;
		const writeText = vi.fn<(text: string) => Promise<void>>()
			.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
				rejectFirst = reject;
			}))
			.mockResolvedValue(undefined);
		stubWriteText(writeText);
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ShareControl runtime={runtime} />);

		// Two presses in flight at once. The second settles first, which is the
		// order a share sheet produces: it holds its promise open for as long as it
		// is on screen while a second press rejects immediately and reaches the
		// clipboard underneath it.
		await press();
		await press();
		expect(screen.getByRole('status').textContent).toBe('Link copied');

		if (rejectFirst === undefined) {
			throw new Error('the first write never started');
		}

		const reject = rejectFirst;
		await act(async () => {
			reject(new Error('denied'));
		});

		// The stale failure must not reopen a question the newer press already
		// answered, and must not put an older snapshot of the link on screen.
		expect(screen.getByRole('status').textContent).toBe('Link copied');
		expect(screen.queryByRole('textbox', { name: 'Link to this Scene' })).toBeNull();
	});

	it('leaves playback and every parameter exactly where the listener left them', async () => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createSilentScene('silent', emberParameters));
		stubWriteText(vi.fn().mockResolvedValue(undefined));
		render(<ShareControl runtime={runtime} />);
		const before = runtime.store.getState();

		await press();

		expect(runtime.store.getState().parameters).toEqual(before.parameters);
		expect(runtime.store.getState().playback).toEqual(before.playback);
		// serializeParameters is a read. Anything else the handler called would
		// show up here as a command the listener never asked for.
		expect(backend.commands).toHaveLength(0);
	});
});
