import { describe, expect, it } from 'vitest';

import { resolveStep } from '../parameters';

import { emberParameters } from './parameters';

// Restated from index.ts's FILTER_FLOOR_HZ, which isn't exported: the filter
// floor this schema's brightness.min has to stay clear of.
const FILTER_FLOOR_HZ = 400;

// Restated from voicing.ts's tables, which aren't exported: G2 (98 Hz) times
// the widest partner ratio (2.25) is the highest fundamental any draw can
// produce, and the value brightness.min must keep the scaled floor above.
const HIGHEST_PARTNER_VOICE_HZ = 220.5;

// Under `step="any"` a Firefox arrow key jumps a full 1.0 across Brightness's
// 2.25-wide range, about three usable positions for anyone not using a
// pointer (#36). A range split at least this many ways keeps one arrow press
// to a small fraction of it in every engine, which is the keyboard support
// Principle II requires of every control.
const FEWEST_USABLE_POSITIONS = 50;

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

describe('ember parameter steps', (): void => {
	// The declared steps, never a derived one. A step assumed to divide the
	// range evenly is what showed 0.352 on a Space playing 0.35.
	it('lands both bounds of every parameter on its own step grid', (): void => {
		for (const declaration of Object.values(emberParameters)) {
			expect((): number => resolveStep(declaration)).not.toThrow();
		}
	});

	it('leaves every parameter enough positions to be driven by arrow keys', (): void => {
		for (const declaration of Object.values(emberParameters)) {
			const positions = (declaration.max - declaration.min) / resolveStep(declaration);

			expect(positions).toBeGreaterThanOrEqual(FEWEST_USABLE_POSITIONS);
		}
	});
});
