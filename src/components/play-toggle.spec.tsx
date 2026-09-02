import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { startTone } from '@/audio/tone-output';

import { PlayToggle } from './play-toggle';

// The rejection path only happens when the browser refuses to resume an
// AudioContext, which real browsers won't do on demand in a test run. Mock
// the module boundary instead of the Web Audio API so the component's own
// failure handling is what's under test.
vi.mock('@/audio/tone-output', () => ({
	readOutputLevel: vi.fn((): number => 0),
	startTone: vi.fn((): Promise<void> => Promise.resolve()),
	stopTone: vi.fn((): void => {}),
}));

describe('play-toggle', () => {
	it('shows an alert and keeps the play label when starting audio fails', async (): Promise<void> => {
		vi.mocked(startTone).mockRejectedValueOnce(new Error('suspended'));
		render(<PlayToggle />);

		screen.getByRole('button', { name: 'Play' }).click();

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/could not start/i);
		expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
	});
});
