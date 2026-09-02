import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';

import { PlayToggle } from './play-toggle';

// Swaps the Tone.js backend for the recording fake so jsdom never loads
// Tone.js, including for the module-level sceneRuntime that play-toggle.tsx
// imports as its default runtime.
vi.mock('@/audio/tone-backend', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	return { createToneBackend: createRecordingBackend };
});

describe('play-toggle', () => {
	it('shows an alert and keeps the play label when starting audio fails', async (): Promise<void> => {
		const runtime = createSceneRuntime(createRecordingBackend({ resume: 'fail' }));
		render(<PlayToggle runtime={runtime} />);

		screen.getByRole('button', { name: 'Play' }).click();

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/could not start/i);
		expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
	});

	it('toggles from play to stop and back on the happy path', async (): Promise<void> => {
		const runtime = createSceneRuntime(createRecordingBackend());
		render(<PlayToggle runtime={runtime} />);

		screen.getByRole('button', { name: 'Play' }).click();

		const stopButton = await screen.findByRole('button', { name: 'Stop' });
		stopButton.click();

		expect(await screen.findByRole('button', { name: 'Play' })).toBeDefined();
	});
});
