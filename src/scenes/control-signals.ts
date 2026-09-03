// Pure and Tone-free on purpose, the same way parameters.ts is: a Control Signal
// declaration is a parameter name and two numbers, so a Scene's whole modulation
// story can be asserted on with no AudioContext anywhere near it. Where the
// reading comes from is Listening's problem; nothing here knows.

import type { ParameterDeclaration } from './parameters';

import { clampParameterValue } from './parameters';

export interface ControlSignalDeclaration {
	// A key in the Scene's own ParameterSchema. Left as a bare string here so this
	// module stays ignorant of any particular Scene; a Scene narrows it to its own
	// parameter union at the declaration site, which is what turns a typo into a
	// build failure instead of a signal that silently drives nothing.
	readonly parameter: string;
	// Where the signal sits when nothing is driving it, normalized 0..1. ADR 0004
	// has a Scene ramp its Control Signals back here when input suspends, rather
	// than letting near-silence drag them somewhere the Bed was never voiced for.
	readonly default: number;
	// Parameter units a full-scale signal moves the parameter. `reach`, never
	// `depth`: Listening Depth is a domain term in CONTEXT.md, and a second
	// meaning for that word would blur the one the vocabulary already spends it on.
	readonly reach: number;
}

export type ControlSignalSchema = Readonly<Record<string, ControlSignalDeclaration>>;

export type SignalValues = Readonly<Record<string, number>>;

export function defaultSignalValues(schema: ControlSignalSchema): SignalValues {
	const values: Record<string, number> = {};

	for (const [name, declaration] of Object.entries(schema)) {
		values[name] = declaration.default;
	}

	return values;
}

// A signal is normalized by definition, so the clamp reads its bounds from
// nothing. The non-finite fallback is the guard clampParameterValue carries, for
// the same reason: Math.min and Math.max propagate NaN, and a NaN reaching a Web
// Audio param silences that node for the rest of the session with no error to
// trace. Listening produces one whenever it averages an empty analysis window.
//
// The fallback is zero rather than the declaration's rest value, because zero is
// what silence reads as, and this clamps a raw reading rather than restoring a
// resting state. A signal that rests mid-scale therefore lands at full negative
// offset on a bad read, and the parameter's own clamp is what keeps that in range.
export function clampSignalValue(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(1, Math.max(0, value));
}

// The offset is measured from the signal's rest value, not from zero, which is
// what lets a Control Signal move a parameter away from where the listener set
// it without overwriting their setting: at rest the listener's value comes back
// untouched, whatever they dragged it to.
//
// Clamping against the parameter is not belt-and-braces. A Scene picks a reach
// that stays in range from the parameter's default, but the listener may have
// already pushed the slider to the ceiling, and ADR 0004 records that a signal
// running away through the speaker-to-microphone loop is a real path until
// headphones are on.
export function modulatedParameterValue(
	parameter: ParameterDeclaration,
	listenerValue: number,
	signal: ControlSignalDeclaration,
	signalValue: number,
): number {
	return clampParameterValue(parameter, listenerValue + (signalValue - signal.default) * signal.reach);
}
