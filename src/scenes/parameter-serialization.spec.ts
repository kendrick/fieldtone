import type { ParameterSchema, ParameterValues } from './parameters';

import { describe, expect, it } from 'vitest';

import { deserializeParameterValues, serializeParameterValues } from './parameter-serialization';

// Ember's own two parameters, defaults included. This codec exists for the link
// Ember's controls produce, so a test should clamp against ranges a listener can
// actually reach.
const schema: ParameterSchema = {
	space: { kind: 'number', label: 'Space', min: 0, max: 0.8, default: 0.35 },
	brightness: { kind: 'number', label: 'Brightness', min: 0.75, max: 3, default: 1 },
};

// A range straddling zero, which Ember has none of today. Nothing else in this
// file would catch a minus sign lost by the formatter or by the query string.
const detuneSchema: ParameterSchema = {
	detune: { kind: 'number', label: 'Detune', min: -12, max: 12, default: 0 },
};

function roundTrip(from: ParameterSchema, values: ParameterValues): ParameterValues {
	return deserializeParameterValues(from, serializeParameterValues(from, values));
}

describe('serializeParameterValues', (): void => {
	// Compared as an exact string rather than a parse of one. Only the literal pins
	// the key order to the schema order and shows there is no leading `?`.
	it('writes every declared parameter in schema order', (): void => {
		expect(serializeParameterValues(schema, { space: 0.35, brightness: 1 })).toBe('space=0.35&brightness=1');
	});

	it('clamps a value that sits outside the declared range', (): void => {
		expect(serializeParameterValues(schema, { space: 9, brightness: 0 })).toBe('space=0.8&brightness=0.75');
	});

	// A NaN in the store is a bug somewhere upstream, but it must not become a
	// link that hands the same NaN to whoever opens it.
	it('falls back to the default for a non-finite value', (): void => {
		expect(serializeParameterValues(schema, { space: Number.NaN, brightness: 2 })).toBe('space=0.35&brightness=2');
	});

	// noUncheckedIndexedAccess types every read off a ParameterValues as possibly
	// undefined, so a caller lands here often.
	it('falls back to the default for a parameter missing from the values', (): void => {
		expect(serializeParameterValues(schema, { brightness: 2 })).toBe('space=0.35&brightness=2');
	});

	it('returns an empty string for an empty schema', (): void => {
		expect(serializeParameterValues({}, {})).toBe('');
	});
});

describe('round trip', (): void => {
	// toEqual, never toBeCloseTo. An approximate match would hide the precision loss
	// that the `String(n)` format exists to rule out.
	it('returns the defaults unchanged', (): void => {
		expect(roundTrip(schema, { space: 0.35, brightness: 1 })).toEqual({ space: 0.35, brightness: 1 });
	});

	it('returns a long decimal bit for bit', (): void => {
		expect(roundTrip(schema, { space: 0.123456789, brightness: 1 })).toEqual({ space: 0.123456789, brightness: 1 });
	});

	// The encoder emits exponent form on its own, since `String(1e-7)` is `'1e-7'`.
	// NUMERIC_TEXT has to accept that form or the round trip breaks here.
	it('returns a value small enough to serialize in exponent form', (): void => {
		expect(roundTrip(schema, { space: 1e-7, brightness: 1 })).toEqual({ space: 1e-7, brightness: 1 });
	});

	it('returns a negative value with its sign', (): void => {
		expect(roundTrip(detuneSchema, { detune: -6.5 })).toEqual({ detune: -6.5 });
	});
});

describe('deserializeParameterValues', (): void => {
	it('returns every default for an empty search string', (): void => {
		expect(deserializeParameterValues(schema, '')).toEqual({ space: 0.35, brightness: 1 });
	});

	// URLSearchParams strips the `?` itself, so a caller can pass `location.search`
	// or a bare query string.
	it('reads a leading question mark the same as a bare query string', (): void => {
		expect(deserializeParameterValues(schema, '?space=0.5&brightness=2')).toEqual(deserializeParameterValues(schema, 'space=0.5&brightness=2'));
	});

	it('applies the keys it finds and defaults the rest', (): void => {
		expect(deserializeParameterValues(schema, 'brightness=2')).toEqual({ space: 0.35, brightness: 2 });
	});

	// The result is built from the schema, so an unknown key is never read rather
	// than read and discarded.
	it('ignores a key the schema does not declare', (): void => {
		expect(deserializeParameterValues(schema, 'space=0.5&reverbTail=4')).toEqual({ space: 0.5, brightness: 1 });
	});

	// Number('') is 0, which would pin Space at silence instead of its default.
	it('falls back to the default for an empty value', (): void => {
		expect(deserializeParameterValues(schema, 'space=')).toEqual({ space: 0.35, brightness: 1 });
	});

	it('falls back to the default for text that is not a plain decimal', (): void => {
		for (const search of ['space=banana', 'space=0x10', 'space=1e', 'space=%201']) {
			expect(deserializeParameterValues(schema, search)).toEqual({ space: 0.35, brightness: 1 });
		}
	});

	// A finite value outside the range clamps rather than defaulting, matching what
	// dragging a control past its bound already does. Only unparseable text falls
	// back to the default.
	it('clamps a finite value that overshoots either bound', (): void => {
		expect(deserializeParameterValues(schema, 'space=1e3')).toEqual({ space: 0.8, brightness: 1 });
		expect(deserializeParameterValues(schema, 'space=99')).toEqual({ space: 0.8, brightness: 1 });
		expect(deserializeParameterValues(schema, 'space=-1')).toEqual({ space: 0, brightness: 1 });
	});

	// Number('1e999') is Infinity, and clamping an infinity would hand Web Audio a
	// number no ramp can use.
	it('falls back to the default when the exponent overflows to infinity', (): void => {
		expect(deserializeParameterValues(schema, 'space=1e999')).toEqual({ space: 0.35, brightness: 1 });
	});

	it('takes the first of a repeated key', (): void => {
		expect(deserializeParameterValues(schema, 'space=0.1&space=0.7')).toEqual({ space: 0.1, brightness: 1 });
	});

	it('returns an empty object for an empty schema', (): void => {
		expect(deserializeParameterValues({}, 'space=1')).toEqual({});
	});
});
