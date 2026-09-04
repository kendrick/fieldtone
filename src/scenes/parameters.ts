// Pure and Tone-free on purpose, the same way voicing.ts is: a parameter
// declaration is just a label, three numbers and an optional step, so the
// whole schema can be resolved and asserted on with no AudioContext anywhere
// near it. The Scene that owns the parameter is the only thing that knows
// what to do with the resolved number.

export interface NumberParameter {
	readonly kind: 'number';
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly default: number;
	// Optional because only a rendered slider needs a step, and the inline
	// schema fixtures across the specs never render one.
	readonly step?: number;
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

// 0.01 divides both of Ember's ranges into whole steps and leaves each of
// them 80 positions or more. #36 measured the alternatives: a hundredth of
// the range divides neither Ember default evenly, and `step="any"` displays
// the right number but moves a Firefox arrow key a full 1.0 across
// Brightness's 2.25-wide range.
const DEFAULT_STEP = 0.01;

// Wide enough to absorb float noise. Ember's own four divisions all come out
// exactly integer, but the division is not reliable in general: a parameter
// declaring a default of 0.29 on a 0.01 grid divides to 28.999999999999996,
// which an equality check would reject for a schema that is correct. Browsers
// do their own form arithmetic in decimal and never see this, so the tolerance
// covers this check alone. It stays far narrower than the smallest miss that
// matters, which is half a step.
const GRID_TOLERANCE = 1e-6;

// A range input snaps its value to `min + n * step`, so a step that misses a
// bound leaves the widget showing a number the Scene is not playing: 0.352 on
// a Space set to 0.35 (#36). Nothing else tests whether a step divides its
// range evenly, so this function does. A Scene that declares a bound off its
// own grid then fails the moment something reads its schema, rather than at a
// listener's slider.
//
// `max` earns the same check as `default`: it is where End lands, and it can
// miss the grid while the default sits right on it.
export function resolveStep(declaration: NumberParameter): number {
	const step = declaration.step ?? DEFAULT_STEP;

	// Ahead of the grid check, because that check divides by `step` and compares
	// what comes back. A zero step makes 0/0, a non-finite one makes Infinity minus
	// Infinity, and every comparison against NaN is false, so an invalid step would
	// pass straight through the function written to reject it. clampParameterValue
	// above guards its own arithmetic the same way and for the same reason.
	//
	// Worth rejecting rather than falling back to DEFAULT_STEP: a range input
	// refuses a step that is not positive and uses its own default of 1, which on
	// Space's 0 to 0.8 range leaves one reachable value. Measured in all three
	// engines, the thumb pins to 0 and no arrow key moves it.
	if (!Number.isFinite(step) || step <= 0) {
		throw new RangeError(
			`${declaration.label} declares a step of ${step}, which has to be a finite number greater than zero.`,
		);
	}

	assertOnStepGrid(declaration, 'default', declaration.default, step);
	assertOnStepGrid(declaration, 'max', declaration.max, step);

	return step;
}

// RangeError rather than a plain Error, because Tone already throws a
// RangeError for a value outside what a parameter can hold. A bound off the
// grid is the same mistake, caught before any audio node sees it.
function assertOnStepGrid(declaration: NumberParameter, bound: 'default' | 'max', value: number, step: number): void {
	const steps = (value - declaration.min) / step;

	if (Math.abs(steps - Math.round(steps)) > GRID_TOLERANCE) {
		throw new RangeError(
			`${declaration.label} declares a ${bound} of ${value}, which is not a whole number of ${step} steps above its min of ${declaration.min}.`,
		);
	}
}
