import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import HomePage from './page';

// The page pulls in the client toggle, which imports the runtime module, and
// that module now imports both Tone.js and Ember. jsdom has no
// AudioContext, so the whole runtime module is swapped for a fake-backed,
// silent-Scene one rather than stubbing Web Audio itself.
vi.mock('@/audio/runtime', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	const { createSceneRuntime } = await import('@/audio/scene-runtime');
	const { createSilentScene } = await import('@/scenes/silent-scene');
	const { emberParameters } = await import('@/scenes/ember/parameters');
	return { sceneRuntime: createSceneRuntime(createRecordingBackend(), createSilentScene('silent', emberParameters)) };
});

// This is the seam that stops the suite from passing on zero tests.
describe('home page', () => {
	it('renders an h1 with the FieldTone heading', (): void => {
		const markup = renderToStaticMarkup(<HomePage />);

		expect(markup).toContain('<h1');
		expect(markup).toContain('FieldTone');
		expect(markup).toContain('Play');
		expect(markup).toContain('Space');
		expect(markup).toContain('Brightness');
	});
});
