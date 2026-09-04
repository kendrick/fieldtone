import type { NumberParameter, ParameterSchema } from './parameters';

import { describe, expect, it } from 'vitest';

import { clampParameterValue, defaultParameterValues, resolveParameterValue, resolveStep } from './parameters';

// A reverb wet declaration, because that is the case the clamp exists for:
// Tone's `Reverb.wet` is a normalRange Signal that throws outside 0..1.
const wet: NumberParameter = {
	kind: 'number',
	label: 'Space',
	min: 0,
	max: 1,
	default: 0.4,
};

const schema: ParameterSchema = {
	wet,
	brightnessHz: {
		kind: 'number',
		label: 'Brightness',
		min: 200,
		max: 8000,
		default: 1200,
	},
};

describe('defaultParameterValues', (): void => {
	it('reads every default off the schema alone', (): void => {
		expect(defaultParameterValues(schema)).toEqual({ wet: 0.4, brightnessHz: 1200 });
	});

	it('returns an empty object for an empty schema', (): void => {
		expect(defaultParameterValues({})).toEqual({});
	});
});

describe('clampParameterValue', (): void => {
	it('raises a value below the minimum to the minimum', (): void => {
		expect(clampParameterValue(wet, -0.5)).toBe(0);
	});

	it('lowers a value above the maximum to the maximum', (): void => {
		expect(clampParameterValue(wet, 2.5)).toBe(1);
	});

	it('leaves a value inside the range alone', (): void => {
		expect(clampParameterValue(wet, 0.75)).toBe(0.75);
	});

	it('leaves a value sitting exactly on either bound alone', (): void => {
		expect(clampParameterValue(wet, 0)).toBe(0);
		expect(clampParameterValue(wet, 1)).toBe(1);
	});

	// A NaN survives Math.min/Math.max, so clamping it would hand Web Audio a NaN
	// and silence the graph for the rest of the session.
	it('falls back to the default for NaN', (): void => {
		expect(clampParameterValue(wet, Number.NaN)).toBe(0.4);
	});

	it('falls back to the default for either infinity', (): void => {
		expect(clampParameterValue(wet, Number.POSITIVE_INFINITY)).toBe(0.4);
		expect(clampParameterValue(wet, Number.NEGATIVE_INFINITY)).toBe(0.4);
	});
});

describe('resolveParameterValue', (): void => {
	// noUncheckedIndexedAccess means every read off a ParameterValues is
	// `number | undefined`, so callers hit this branch constantly.
	it('falls back to the default when the name is absent from the values', (): void => {
		expect(resolveParameterValue(wet, undefined)).toBe(0.4);
	});

	it('clamps a value that is present', (): void => {
		expect(resolveParameterValue(wet, 9)).toBe(1);
		expect(resolveParameterValue(wet, 0.2)).toBe(0.2);
	});

	it('falls back to the default for a present but non-finite value', (): void => {
		expect(resolveParameterValue(wet, Number.NaN)).toBe(0.4);
	});
});

describe('resolveStep', (): void => {
	it('hands back a declared step untouched', (): void => {
		expect(resolveStep({ kind: 'number', label: 'Space', min: 0, max: 0.8, step: 0.05, default: 0.35 })).toBe(0.05);
	});

	// Most declarations say nothing about a step, so the fallback is the step
	// the grid rule checks most of the time.
	it('falls back to 0.01 when the declaration names no step', (): void => {
		expect(resolveStep(wet)).toBe(0.01);
	});

	// Ember's real Space declaration: 0.35 sits 35 whole steps above 0, which is
	// what lets a slider show 0.35 rather than the 0.352 a coarser step snaps it
	// to.
	it('accepts a default that lands on its own grid', (): void => {
		expect(resolveStep({ kind: 'number', label: 'Space', min: 0, max: 0.8, step: 0.01, default: 0.35 })).toBe(0.01);
	});

	// A range input refuses a step that is not positive and falls back to its own
	// default of 1, which on a range narrower than 1 leaves a single reachable
	// value: measured in Chromium, Firefox and WebKit, the thumb pins to 0 and no
	// arrow key moves it. The grid check below cannot catch these on its own,
	// because dividing by them yields NaN and every comparison against NaN is
	// false.
	it.each([
		['zero', 0],
		['negative', -0.01],
		['NaN', Number.NaN],
		['infinite', Number.POSITIVE_INFINITY],
	])('rejects a %s step rather than passing it to the control', (_name: string, step: number): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Space', min: 0, max: 0.8, step, default: 0.35 }),
		).toThrow(RangeError);
	});

	it('names the parameter whose step is invalid', (): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Brightness', min: 0, max: 1, step: 0, default: 0 }),
		).toThrow(/Brightness/);
	});

	it('rejects a default that does not land on the grid', (): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Space', min: 0, max: 1, step: 0.05, default: 0.023 }),
		).toThrow(/default/);
	});

	// A max off the grid is the quieter failure. The default still displays
	// correctly and only End disagrees with the schema, so it needs its own case.
	it('rejects a max that does not land on the grid', (): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Space', min: 0, max: 0.855, step: 0.01, default: 0.35 }),
		).toThrow(/max/);
	});

	it('names the offending parameter, so a whole schema does not have to be searched', (): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Brightness', min: 0.75, max: 3, step: 0.02, default: 1 }),
		).toThrow(/Brightness/);
	});

	it('throws a RangeError, the same failure Tone raises for an out-of-range parameter', (): void => {
		expect((): number =>
			resolveStep({ kind: 'number', label: 'Space', min: 0, max: 1, step: 0.05, default: 0.023 }),
		).toThrow(RangeError);
	});
});
