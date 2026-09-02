import type { Random } from './voicing';

import { describe, expect, it } from 'vitest';

import { drawVoicing } from './voicing';

// Restated from voicing.ts's module-level constants, which aren't exported.
// These are the contract this spec checks the draw against, not values this
// spec is free to retune independently of the source.
const ROOTS_HZ: readonly number[] = [55.0, 65.41, 73.42, 82.41, 98.0];
const PARTNER_RATIOS: readonly number[] = [1.5, 2, 2.25];

const DETUNE_SPREAD_MIN_CENTS = 8;
const DETUNE_SPREAD_MAX_CENTS = 20;

const DRIFT_BASE_PERIOD_ONE_SEC = 53;
const DRIFT_BASE_PERIOD_TWO_SEC = 71;
const FILTER_BASE_PERIOD_SEC = 97;

const JITTER_MIN = 0.8;
const JITTER_MAX = 1.2;

const PHASE_MIN_DEG = 0;
const PHASE_MAX_DEG = 360;

const SAMPLE_LCG_SEED = 42;

// The jitter multiplies the period, not the rate, so the lowest rate comes from
// the largest jittered period and vice versa. Getting this backwards would let a
// bounds check pass against inverted ranges and never catch a real regression.
function minRateHz(basePeriodSec: number): number {
	return 1 / (basePeriodSec * JITTER_MAX);
}

function maxRateHz(basePeriodSec: number): number {
	return 1 / (basePeriodSec * JITTER_MIN);
}

// Numerical Recipes' LCG constants: cheap, deterministic, and seed-reproducible,
// so a failure here can be replayed exactly instead of chasing a Math.random
// flake that only shows up once a month on CI.
function createLcg(seed: number): Random {
	let state = seed >>> 0;

	return (): number => {
		state = (Math.imul(1664525, state) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

describe('ember voicing', (): void => {
	it('draws different voicings for a random of 0 and a random of 0.999', (): void => {
		const zero: Random = (): number => 0;
		const almostOne: Random = (): number => 0.999;

		const fromZero = drawVoicing(zero);
		const fromAlmostOne = drawVoicing(almostOne);

		expect(fromZero).not.toEqual(fromAlmostOne);
	});

	it('keeps every field inside its declared bounds across a sweep of fixed random values', (): void => {
		// Each fixed value stands in for a point along random()'s full range, including
		// both ends: 0 hits every table's first entry and every range's minimum, and a
		// value just under 1 hits the last entry and each range's maximum.
		const sweepValues: readonly number[] = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999];

		for (const value of sweepValues) {
			const random: Random = (): number => value;
			const voicing = drawVoicing(random);
			const [voiceOne, voiceTwo] = voicing.voices;

			expect(ROOTS_HZ).toContain(voicing.rootHz);
			expect(PARTNER_RATIOS).toContain(voicing.partnerRatio);

			expect(voicing.detuneSpreadCents).toBeGreaterThanOrEqual(DETUNE_SPREAD_MIN_CENTS);
			expect(voicing.detuneSpreadCents).toBeLessThanOrEqual(DETUNE_SPREAD_MAX_CENTS);

			expect(voiceOne.driftRateHz).toBeGreaterThanOrEqual(minRateHz(DRIFT_BASE_PERIOD_ONE_SEC));
			expect(voiceOne.driftRateHz).toBeLessThanOrEqual(maxRateHz(DRIFT_BASE_PERIOD_ONE_SEC));
			expect(voiceOne.driftPhaseDeg).toBeGreaterThanOrEqual(PHASE_MIN_DEG);
			expect(voiceOne.driftPhaseDeg).toBeLessThanOrEqual(PHASE_MAX_DEG);

			expect(voiceTwo.driftRateHz).toBeGreaterThanOrEqual(minRateHz(DRIFT_BASE_PERIOD_TWO_SEC));
			expect(voiceTwo.driftRateHz).toBeLessThanOrEqual(maxRateHz(DRIFT_BASE_PERIOD_TWO_SEC));
			expect(voiceTwo.driftPhaseDeg).toBeGreaterThanOrEqual(PHASE_MIN_DEG);
			expect(voiceTwo.driftPhaseDeg).toBeLessThanOrEqual(PHASE_MAX_DEG);

			expect(voicing.filterRateHz).toBeGreaterThanOrEqual(minRateHz(FILTER_BASE_PERIOD_SEC));
			expect(voicing.filterRateHz).toBeLessThanOrEqual(maxRateHz(FILTER_BASE_PERIOD_SEC));
			expect(voicing.filterPhaseDeg).toBeGreaterThanOrEqual(PHASE_MIN_DEG);
			expect(voicing.filterPhaseDeg).toBeLessThanOrEqual(PHASE_MAX_DEG);
		}
	});

	it('keeps the two drift rates and the filter rate pairwise distinct across many draws', (): void => {
		// The three rate bands overlap (drift one spans 42.4-63.6s, drift two spans
		// 56.8-85.2s, the filter spans 77.6-116.4s), so distinctness isn't something the
		// ranges guarantee structurally. It has to be checked against actual draws, or a
		// coincidence in the overlap could silently collide two LFOs and this test would
		// never notice.
		const random = createLcg(SAMPLE_LCG_SEED);
		const drawCount = 500;

		for (let i = 0; i < drawCount; i += 1) {
			const voicing = drawVoicing(random);
			const [voiceOne, voiceTwo] = voicing.voices;

			expect(voiceOne.driftRateHz).not.toBe(voiceTwo.driftRateHz);
			expect(voiceOne.driftRateHz).not.toBe(voicing.filterRateHz);
			expect(voiceTwo.driftRateHz).not.toBe(voicing.filterRateHz);
		}
	});

	it('draws distinct voicings on every consecutive pair from a seeded lcg', (): void => {
		const random = createLcg(SAMPLE_LCG_SEED);
		const drawCount = 20;
		let previous = drawVoicing(random);

		for (let i = 0; i < drawCount; i += 1) {
			const next = drawVoicing(random);
			expect(next).not.toEqual(previous);
			previous = next;
		}
	});
});
