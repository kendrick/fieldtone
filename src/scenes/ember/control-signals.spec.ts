import { describe, expect, it } from 'vitest';

import { emberControlSignals } from './control-signals';
import { emberParameters } from './parameters';

describe('ember control signals', (): void => {
	it('binds every signal to a parameter this Scene actually declares', (): void => {
		for (const signal of Object.values(emberControlSignals)) {
			expect(emberParameters).toHaveProperty(signal.parameter);
		}
	});

	// ADR 0004: with echo cancellation off and no headphones, the Bed is part of
	// what Listening reads, so a signal driving anything that raises Bed level
	// runs away through the speaker-to-microphone loop. `space` drives the
	// Reverb's wet, which is that path.
	it('leaves space unbound', (): void => {
		for (const signal of Object.values(emberControlSignals)) {
			expect(signal.parameter).not.toBe('space');
		}
	});

	it('rests at no offset, so the Bed sounds as authored with nothing listening', (): void => {
		expect(emberControlSignals.loudness.default).toBe(0);
	});

	// Full scale from the schema default has to land inside the declared range on
	// its own. The clamp is there for a listener who has already dragged the
	// slider up, not to make a badly chosen reach survive.
	it('reaches full scale without needing the clamp from the parameter default', (): void => {
		const brightness = emberParameters.brightness;
		const atFullScale = brightness.default + emberControlSignals.loudness.reach;

		expect(atFullScale).toBeLessThanOrEqual(brightness.max);
		expect(atFullScale).toBeGreaterThan(brightness.default);
	});
});
