import type { ControlSignalDeclaration, ControlSignalSchema } from './control-signals';
import type { NumberParameter } from './parameters';

import { describe, expect, it } from 'vitest';

import { clampSignalValue, defaultSignalValues, modulatedParameterValue } from './control-signals';

// Ember's brightness, because it is the binding these helpers exist for: a
// listener's setting the Control Signal has to move without overwriting.
const brightness: NumberParameter = {
	kind: 'number',
	label: 'Brightness',
	min: 0.75,
	max: 3,
	default: 1,
};

const loudness: ControlSignalDeclaration = { parameter: 'brightness', default: 0, reach: 1.5 };

// A signal that rests mid-scale rather than at zero, so the offset arithmetic
// gets exercised in both directions.
const centred: ControlSignalDeclaration = { parameter: 'brightness', default: 0.5, reach: 1 };

const schema: ControlSignalSchema = { loudness, centred };

describe('defaultSignalValues', (): void => {
	it('reads every rest value off the schema alone', (): void => {
		expect(defaultSignalValues(schema)).toEqual({ loudness: 0, centred: 0.5 });
	});

	it('returns an empty object for a Scene that declares no Control Signals', (): void => {
		expect(defaultSignalValues({})).toEqual({});
	});
});

describe('clampSignalValue', (): void => {
	it('raises a negative reading to zero', (): void => {
		expect(clampSignalValue(-0.25)).toBe(0);
	});

	it('lowers a reading above full scale to one', (): void => {
		expect(clampSignalValue(4)).toBe(1);
	});

	it('leaves a reading inside the range alone', (): void => {
		expect(clampSignalValue(0.3)).toBe(0.3);
	});

	it('leaves a reading sitting exactly on either bound alone', (): void => {
		expect(clampSignalValue(0)).toBe(0);
		expect(clampSignalValue(1)).toBe(1);
	});

	// An empty analysis window divides by zero, and a NaN survives Math.min and
	// Math.max, so it would ride all the way to a Web Audio param and silence
	// that node for the rest of the session.
	it('falls back to zero for NaN', (): void => {
		expect(clampSignalValue(Number.NaN)).toBe(0);
	});

	it('falls back to zero for either infinity', (): void => {
		expect(clampSignalValue(Number.POSITIVE_INFINITY)).toBe(0);
		expect(clampSignalValue(Number.NEGATIVE_INFINITY)).toBe(0);
	});
});

describe('modulatedParameterValue', (): void => {
	it('returns the listener value untouched while the signal rests', (): void => {
		expect(modulatedParameterValue(brightness, 1.2, loudness, loudness.default)).toBe(1.2);
		expect(modulatedParameterValue(brightness, 1.2, centred, centred.default)).toBe(1.2);
	});

	it('adds the full reach at full scale', (): void => {
		expect(modulatedParameterValue(brightness, 1, loudness, 1)).toBe(2.5);
	});

	it('scales the offset with the distance from rest', (): void => {
		expect(modulatedParameterValue(brightness, 1, loudness, 0.5)).toBe(1.75);
	});

	// A signal resting mid-scale reaches below the listener's setting as well as
	// above it, which is the whole point of measuring the offset from `default`
	// rather than from zero.
	it('subtracts when the signal falls below its rest value', (): void => {
		expect(modulatedParameterValue(brightness, 2, centred, 0)).toBe(1.5);
	});

	it('clamps to the parameter\'s declared range rather than the signal\'s', (): void => {
		// A listener who has already pushed brightness to its ceiling: the same
		// reach that stays in range from the default would run off the end here.
		expect(modulatedParameterValue(brightness, 3, loudness, 1)).toBe(3);
		expect(modulatedParameterValue(brightness, 0.75, centred, 0)).toBe(0.75);
	});

	// The parameter clamp is the last thing between a bad reading and the audio
	// thread, so it has to answer for a NaN that arrived unclamped.
	it('falls back to the parameter default for a non-finite reading', (): void => {
		expect(modulatedParameterValue(brightness, 1.2, loudness, Number.NaN)).toBe(1);
	});
});
