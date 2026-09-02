import type { NumberParameter, ParameterSchema } from './parameters';

import { describe, expect, it } from 'vitest';

import { clampParameterValue, defaultParameterValues, resolveParameterValue } from './parameters';

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
