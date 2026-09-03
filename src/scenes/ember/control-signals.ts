// Pure and Tone-free on purpose, the same way parameters.ts beside it is: a
// binding is a parameter name and two numbers, so it can be asserted on with no
// AudioContext anywhere near it. index.ts is the only thing that knows what to
// do with a modulated value.

import type { ControlSignalDeclaration } from '../control-signals';
import type { EmberParameter } from './parameters';

// Narrowing `parameter` to Ember's own union is the whole reason this type
// exists. A binding that names a parameter the Scene never declared would
// otherwise typecheck, then drive nothing, with nothing to notice it.
interface EmberControlSignal extends ControlSignalDeclaration {
	readonly parameter: EmberParameter;
}

export const emberControlSignals: Readonly<Record<'loudness', EmberControlSignal>> = {
	// Brightness rests at 1 with a max of 3, so a full-scale signal reaches 2.5
	// and stays in range on its own. The clamp downstream is for a listener who
	// has already dragged brightness up, not for this arithmetic.
	//
	// Bound to brightness and deliberately not to space: ADR 0004 records that
	// with echo cancellation off and no headphones, the Bed is part of what
	// Listening reads, so a Control Signal that raises Bed level runs away
	// through the speaker-to-microphone loop. Space drives the Reverb's wet,
	// which is exactly that path—louder Bed, louder reading, wetter still.
	loudness: { parameter: 'brightness', default: 0, reach: 1.5 },
};
