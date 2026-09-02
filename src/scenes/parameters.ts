// Pure and Tone-free on purpose, the same way voicing.ts is: a parameter
// declaration is just a label and three numbers, so the whole schema can be
// resolved and asserted on with no AudioContext anywhere near it. The Scene
// that owns the parameter is the only thing that knows what to do with the
// resolved number.

export interface NumberParameter {
	readonly kind: 'number';
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly default: number;
}

// A union of one today. The `switch (declaration.kind)` in
// parameter-serialization.ts is the build-time tripwire: a second member
// fails the build there until the codec grows a branch for it, which is the
// point of declaring it as a union this early.
export type ParameterDeclaration = NumberParameter;

export type ParameterSchema = Readonly<Record<string, ParameterDeclaration>>;

export type ParameterValues = Readonly<Record<string, number>>;

export function defaultParameterValues(schema: ParameterSchema): ParameterValues {
	const values: Record<string, number> = {};

	for (const [name, declaration] of Object.entries(schema)) {
		values[name] = declaration.default;
	}

	return values;
}

// Correctness, not polish. Tone's `Reverb.wet` is a normalRange Signal whose
// `rampTo` throws a RangeError outside 0..1, and ADR 0004 records that a Scene's
// Control Signal is a second write path into the same parameter—one that can run
// away through the speaker-to-microphone loop before headphones are on. So the
// clamp lives here, where both paths pass through, rather than on a UI control
// only the dragging listener touches.
//
// Non-finite input falls back to the default instead of clamping, because
// Math.min and Math.max propagate NaN, and a NaN reaching a Web Audio param
// silences that node for the rest of the session with no error to trace.
export function clampParameterValue(declaration: ParameterDeclaration, value: number): number {
	if (!Number.isFinite(value)) {
		return declaration.default;
	}

	return Math.min(declaration.max, Math.max(declaration.min, value));
}

// `undefined` is the common case, not an edge one: noUncheckedIndexedAccess
// types every read off a ParameterValues as `number | undefined`, so a Scene
// asking for a parameter no stored values object carries lands here.
export function resolveParameterValue(declaration: ParameterDeclaration, value: number | undefined): number {
	if (value === undefined) {
		return declaration.default;
	}

	return clampParameterValue(declaration, value);
}
