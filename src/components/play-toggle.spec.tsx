import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';
import { createSilentScene } from '@/scenes/silent-scene';

import { PlayToggle } from './play-toggle';

// jsdom has no AudioContext, and importing the real runtime module pulls in
// both Tone.js and Ember, which build real audio nodes. Swapping the whole
// module for a fake-backed, silent-Scene runtime keeps this suite's default
// runtime—the one play-toggle.tsx falls back to when no `runtime` prop is
// passed—off that path too.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent')) };
});

describe('play-toggle', () => {
	it('shows an alert and keeps the play label when starting audio fails', async (): Promise<void> => {
		const runtime = createSceneRuntime(createRecordingBackend({ resume: 'fail' }), createSilentScene('silent'));
		render(<PlayToggle runtime={runtime} />);

		screen.getByRole('button', { name: 'Play' }).click();

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/could not start/i);
		expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
	});

	it('toggles from play to stop and back on the happy path', async (): Promise<void> => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent'));
		render(<PlayToggle runtime={runtime} />);

		screen.getByRole('button', { name: 'Play' }).click();

		const stopButton = await screen.findByRole('button', { name: 'Stop' });
		stopButton.click();

		expect(await screen.findByRole('button', { name: 'Play' })).toBeDefined();
	});
});
