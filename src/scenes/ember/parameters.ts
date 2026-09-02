// Pure and Tone-free on purpose, the same way voicing.ts is: a schema is just
// labels and numbers, so it can be resolved and asserted on with no
// AudioContext anywhere near it. index.ts is the only thing that knows what
// to do with a resolved value.

import type { NumberParameter } from '../parameters';

export type EmberParameter = 'space' | 'brightness';

export const emberParameters: Readonly<Record<EmberParameter, NumberParameter>> = {
	// Drives the Reverb's `wet`. The max stays under Tone's normalRange
	// ceiling of 1—past that, `rampTo` throws a RangeError instead of clamping.
	space: { kind: 'number', label: 'Space', min: 0, max: 0.8, default: 0.35 },
	// Scales the filter's sweep. The min is load-bearing against the floor
	// comment in index.ts: the floor sits at 400 Hz, and the highest
	// fundamental any voicing draw can produce is G2 (98 Hz) times the widest
	// partner ratio (2.25), or 220.5 Hz. At 0.75 the floor lands at 300 Hz,
	// still clear of that, so no reachable brightness lets the sweep dip into
	// the partner voice. Widening either table in voicing.ts, or lowering
	// this min, needs that margin rechecked.
	brightness: { kind: 'number', label: 'Brightness', min: 0.75, max: 3, default: 1 },
};

// Both defaults reproduce today's graph exactly, so BED_LEVEL's tuning and
// the end-to-end audible threshold hold unchanged now that they route
// through this schema instead of index.ts's own constants.
