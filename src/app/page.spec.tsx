import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import HomePage from './page';

// The page now pulls in the client toggle, which imports Tone.js. jsdom has no
// AudioContext, so the audio module is swapped out wholesale rather than
// stubbing Web Audio itself.
vi.mock('@/audio/tone-backend', async () => {
	const { createRecordingBackend } = await import('@/audio/recording-backend');
	return { createToneBackend: createRecordingBackend };
});

// This is the seam that stops the suite from passing on zero tests.
describe('home page', () => {
	it('renders an h1 with the FieldTone heading', (): void => {
		const markup = renderToStaticMarkup(<HomePage />);

		expect(markup).toContain('<h1');
		expect(markup).toContain('FieldTone');
		expect(markup).toContain('Play');
	});
});
