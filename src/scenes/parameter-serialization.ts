// Pure and Tone-free like parameters.ts, and it imports nothing from src/audio/.
// A shareable link is a string and a schema, so the whole round trip can be
// asserted on with no AudioContext anywhere near it. Every value entering or
// leaving goes through resolveParameterValue, the one clamp this codebase routes
// through for the reasons ADR 0004 records.

import type { ParameterDeclaration, ParameterSchema, ParameterValues } from './parameters';

import { resolveParameterValue } from './parameters';

// Deliberately narrower than `Number()`. `Number('')` and `Number(' ')` are both
// 0, so `?space=` would silently pin Space at the bottom of its range instead of
// falling back to its default, and `0x10`, `0b1` and `Infinity` are forms nobody
// typing a link by hand means. Exponent notation stays in because the encoder
// emits it—`String(1e-7)` is `'1e-7'`—so rejecting it would break the round trip
// for small values.
const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

// Exhaustiveness guard, same shape as the one in scene-runtime.ts: a second
// member added to ParameterDeclaration without a matching branch below fails the
// build here instead of shipping a link format that silently drops the new kind.
// It takes the discriminant rather than the declaration because
// ParameterDeclaration is a union of one today, and TypeScript reduces a member
// to never only when there is a union to reduce. The `kind` literal reduces
// either way, and starts erroring the moment a second kind appears.
function assertNever(value: never): never {
	throw new Error(`unreachable parameter kind: ${JSON.stringify(value)}`);
}

// `String(n)` is ECMA-262's shortest round-tripping form, so `Number(String(n))`
// returns the same double for every finite value. Only -0 loses its sign, which
// no clamp can tell apart from 0 anyway. Rounding here would quietly move a
// listener's setting between the link they copied and the one they opened.
function formatParameterValue(declaration: ParameterDeclaration, value: number): string {
	switch (declaration.kind) {
		case 'number':
			return String(value);
		default:
			return assertNever(declaration.kind);
	}
}

// Four clauses, and the order matters:
//
// 1. A key absent from the query string reads as `null` here and becomes
//    `undefined`, which resolveParameterValue turns into the default.
// 2. Text that does not match NUMERIC_TEXT exactly is also `undefined`, so it
//    lands on the default rather than on whatever `Number()` would coerce.
// 3. A match parses to a finite number except on overflow, where `1e999` becomes
//    `Infinity`. resolveParameterValue sends non-finite to the default and
//    clamps everything else, so a number outside the range clamps rather than
//    defaulting. Dragging a control past its bound already behaves that way.
// 4. A repeated key (`space=1&space=2`) resolves to the first, because that is
//    what URLSearchParams.get returns. First wins.
function parseParameterValue(declaration: ParameterDeclaration, text: string | null): number | undefined {
	switch (declaration.kind) {
		case 'number': {
			if (text === null || !NUMERIC_TEXT.test(text)) {
				return undefined;
			}

			return Number(text);
		}
		default:
			return assertNever(declaration.kind);
	}
}

// Every declared parameter is emitted, defaults included, so a link carries the
// full setting rather than a diff against defaults that would drift the day a
// default changes. Schema order fixes the key order, which keeps the string
// stable enough to compare in a test.
export function serializeParameterValues(schema: ParameterSchema, values: ParameterValues): string {
	const params = new URLSearchParams();

	for (const [name, declaration] of Object.entries(schema)) {
		// Resolved before formatting, never after. A stale or NaN value sitting in
		// the store must not reach a link somebody else opens.
		const value = resolveParameterValue(declaration, values[name]);
		params.set(name, formatParameterValue(declaration, value));
	}

	return params.toString();
}

// Driven by the schema, never by the query string, so the result always carries
// exactly the declared keys and a key nobody declared is never read at all.
// URLSearchParams strips a leading `?` itself, so `?a=1` and `a=1` are the same
// input here.
export function deserializeParameterValues(schema: ParameterSchema, search: string): ParameterValues {
	const params = new URLSearchParams(search);
	const values: Record<string, number> = {};

	for (const [name, declaration] of Object.entries(schema)) {
		values[name] = resolveParameterValue(declaration, parseParameterValue(declaration, params.get(name)));
	}

	return values;
}
