import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createRecordingBackend } from '@/audio/recording-backend';
import { createSceneRuntime } from '@/audio/scene-runtime';
import { emberParameters } from '@/scenes/ember/parameters';
import { createSilentScene } from '@/scenes/silent-scene';

import { ParameterControls } from './parameter-controls';

// jsdom has no AudioContext, and importing the real runtime module pulls in
// both Tone.js and Ember, which build real audio nodes. Swapping the whole
// module for a fake-backed, silent-Scene runtime keeps this suite's default
// runtime—the one parameter-controls.tsx falls back to when no `runtime` prop
// is passed—off that path too.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent')) };
});

describe('parameter-controls', () => {
	it('renders one labelled slider per schema entry', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		expect(screen.getByRole('slider', { name: 'Space' })).toBeDefined();
		expect(screen.getByRole('slider', { name: 'Brightness' })).toBeDefined();
	});

	it('reaches the store when a slider changes', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		const brightness = screen.getByRole('slider', { name: 'Brightness' });
		fireEvent.change(brightness, { target: { value: '2' } });

		expect(runtime.store.getState().parameters.brightness).toBe(2);
	});

	it('renders nothing for a schema with no entries', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent'));
		const { container } = render(<ParameterControls runtime={runtime} />);

		expect(container.firstChild).toBeNull();
	});
});
