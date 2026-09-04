import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
	// Every URL-round-trip case below leaves a query string on jsdom's shared
	// location. Resetting it here, rather than trusting the next test to
	// overwrite what it cares about, is what keeps one test's leftover
	// `?space=` out of another's assertions.
	afterEach(() => {
		window.history.replaceState(null, '', '/');
	});

	it('renders one labelled slider per schema entry', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		expect(screen.getByRole('slider', { name: 'Space' })).toBeDefined();
		expect(screen.getByRole('slider', { name: 'Brightness' })).toBeDefined();
	});

	// #36: a step of (max - min) / 100 leaves Ember's own defaults off their
	// grid, so the widget showed 0.352 for a Space the store held at 0.35. The
	// schema's declared step is what the rendered input has to carry.
	it('sets the declared step on the rendered Space and Brightness sliders', () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		expect(screen.getByRole('slider', { name: 'Space' }).getAttribute('step')).toBe('0.01');
		expect(screen.getByRole('slider', { name: 'Brightness' }).getAttribute('step')).toBe('0.01');
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

	it('applies a search string present on load to the store', () => {
		window.history.replaceState(null, '', '/?space=0.6');
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		expect(runtime.store.getState().parameters.space).toBe(0.6);
	});

	it('falls back to defaults for a malformed search without throwing', () => {
		window.history.replaceState(null, '', '/?space=banana&bogus=1');
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));

		expect(() => render(<ParameterControls runtime={runtime} />)).not.toThrow();
		expect(runtime.store.getState().parameters.space).toBe(emberParameters.space.default);
	});

	it('mirrors a committed change to the address bar for every declared parameter', async () => {
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		const brightness = screen.getByRole('slider', { name: 'Brightness' });
		// fireEvent.change dispatches a real bubbling `change` event, which is
		// what the fieldset's delegated listener is waiting for.
		fireEvent.change(brightness, { target: { value: '2' } });
		// The listener defers its read a microtask past the native dispatch—see
		// the comment on handleChange—so the assertion has to wait one too.
		await Promise.resolve();

		expect(window.location.search).toContain('brightness=2');
		// Proves every declared parameter gets written on commit, not only the
		// one the listener moved.
		expect(window.location.search).toContain('space=');
	});

	it('preserves a foreign query key, the pathname, and the hash across a commit', async () => {
		window.history.replaceState(null, '', '/some/path?scene=x#top');
		const runtime = createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters));
		render(<ParameterControls runtime={runtime} />);

		const brightness = screen.getByRole('slider', { name: 'Brightness' });
		fireEvent.change(brightness, { target: { value: '2' } });
		await Promise.resolve();

		expect(window.location.search).toContain('scene=x');
		expect(window.location.pathname).toBe('/some/path');
		expect(window.location.hash).toBe('#top');
	});
});
