// Pure and Tone-free on purpose: a Voicing is just numbers, so it can be
// drawn and asserted on in a plain unit test with no AudioContext involved.
// Everything Tone-shaped (oscillators, LFOs, filters) lives in index.ts,
// which turns a drawn Voicing into sound.

export type Random = () => number;

export interface Voice {
	readonly driftRateHz: number;
	readonly driftPhaseDeg: number;
}

export interface Voicing {
	readonly rootHz: number;
	readonly partnerRatio: number;
	readonly detuneSpreadCents: number;
	readonly voices: readonly [Voice, Voice];
	readonly filterRateHz: number;
	readonly filterPhaseDeg: number;
}

// A1 through G2 on the A minor pentatonic scale, so any root the draw picks
// sits in key with the others. The highest root (G2, 98 Hz) times the
// widest partner interval (2.25) gives 220.5 Hz, which the scene's filter
// floor is set 400 Hz above—raising either table without checking that
// margin would let the partner voice run into the floor.
const rootsHz: readonly number[] = [55.0, 65.41, 73.42, 82.41, 98.0];

const partnerRatios: readonly number[] = [1.5, 2, 2.25];

const detuneSpreadMinCents = 8;
const detuneSpreadMaxCents = 20;

// Base periods spread wide and then jittered, so the three LFOs share no
// small-integer ratio and the composite's repeat period outlasts any
// listening session. The jittered bands do overlap (53 s stretches to
// 63.6 s, 71 s compresses to 56.8 s), so two rates can land near each
// other; that costs a slow beat between them, not a repeat.
const driftBasePeriodOneSec = 53;
const driftBasePeriodTwoSec = 71;
const filterBasePeriodSec = 97;

const jitterMin = 0.8;
const jitterMax = 1.2;

const phaseMinDeg = 0;
const phaseMaxDeg = 360;

// noUncheckedIndexedAccess makes every table read `number | undefined`.
// Falling back to the first entry keeps drawVoicing free of `as` and `!`
// without changing behavior, since every table above is
// non-empty and the fallback chain only matters to the type checker.
function pick(table: readonly number[], random: Random): number {
	const index = Math.floor(random() * table.length);
	return table[index] ?? table[0] ?? 0;
}

function drawJitter(random: Random): number {
	return jitterMin + random() * (jitterMax - jitterMin);
}

function drawPhaseDeg(random: Random): number {
	return phaseMinDeg + random() * (phaseMaxDeg - phaseMinDeg);
}

// The jitter multiplies the period, not the rate, so a 1.2x draw means the LFO
// runs a fifth slower rather than faster. Read the ranges above that way.
// `rate` fields below carry the resulting Hz, not seconds.
function drawRateHz(basePeriodSec: number, random: Random): number {
	return 1 / (basePeriodSec * drawJitter(random));
}

// Draw order is a contract: voicing.spec.ts feeds drawVoicing a fixed sequence
// of numbers and asserts on the result, so reordering these calls breaks it.
export function drawVoicing(random: Random): Voicing {
	const rootHz = pick(rootsHz, random);
	const partnerRatio = pick(partnerRatios, random);
	const detuneSpreadCents = detuneSpreadMinCents + random() * (detuneSpreadMaxCents - detuneSpreadMinCents);

	const driftRateOneHz = drawRateHz(driftBasePeriodOneSec, random);
	const driftRateTwoHz = drawRateHz(driftBasePeriodTwoSec, random);

	const driftPhaseOneDeg = drawPhaseDeg(random);
	const driftPhaseTwoDeg = drawPhaseDeg(random);

	const filterRateHz = drawRateHz(filterBasePeriodSec, random);
	const filterPhaseDeg = drawPhaseDeg(random);

	return {
		rootHz,
		partnerRatio,
		detuneSpreadCents,
		voices: [
			{ driftRateHz: driftRateOneHz, driftPhaseDeg: driftPhaseOneDeg },
			{ driftRateHz: driftRateTwoHz, driftPhaseDeg: driftPhaseTwoDeg },
		],
		filterRateHz,
		filterPhaseDeg,
	};
}
