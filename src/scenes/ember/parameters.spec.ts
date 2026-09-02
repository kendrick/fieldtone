import { describe, expect, it } from 'vitest';

import { emberParameters } from './parameters';

// Restated from index.ts's FILTER_FLOOR_HZ, which isn't exported: the filter
// floor this schema's brightness.min has to stay clear of.
const FILTER_FLOOR_HZ = 400;

// Restated from voicing.ts's tables, which aren't exported: G2 (98 Hz) times
// the widest partner ratio (2.25) is the highest fundamental any draw can
// produce, and the value brightness.min must keep the scaled floor above.
const HIGHEST_PARTNER_VOICE_HZ = 220.5;

describe('ember parameters', (): void => {
	it('keeps every default inside its own declared range', (): void => {
		for (const declaration of Object.values(emberParameters)) {
			expect(declaration.default).toBeGreaterThanOrEqual(declaration.min);
			expect(declaration.default).toBeLessThanOrEqual(declaration.max);
		}
	});

	it('keeps space under the normalRange ceiling past which rampTo throws', (): void => {
		expect(emberParameters.space.max).toBeLessThanOrEqual(1);
	});

	it('keeps the scaled filter floor above the highest partner voice', (): void => {
		expect(emberParameters.brightness.min * FILTER_FLOOR_HZ).toBeGreaterThan(HIGHEST_PARTNER_VOICE_HZ);
	});
});
