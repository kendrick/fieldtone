// What the play button is doing right now, as four states rather than a pile of
// booleans. `starting` exists because resuming the AudioContext is awaited, and
// that gap is long enough for a second press to land in it.

export interface Idle {
	readonly status: 'idle';
}

export interface Starting {
	readonly status: 'starting';
}

export interface Playing {
	readonly status: 'playing';
}

export interface Failed {
	readonly status: 'failed';
	readonly reason: string;
}

export type PlaybackState = Idle | Starting | Playing | Failed;

export const idle: Idle = { status: 'idle' };

// There is no `stopping` state. It would need a completion signal to leave, and
// each press already owns its own voice, so a fast stop-then-play cannot land
// two ramps on one Param. Revisit if a Scene's Bed ever needs a clean handoff.

// One function per legal edge, each taking only the states that edge starts
// from. A double start or a stop before start is then a compile error, not a
// runtime branch nobody remembers to write: the ticket asks for those to be
// unrepresentable rather than merely guarded.
//
// The parameter is unused at runtime and exists only to bind that type, hence
// the leading underscore for noUnusedParameters.
export function beginStart(_from: Idle | Failed): Starting {
	return { status: 'starting' };
}

export function completeStart(_from: Starting): Playing {
	return { status: 'playing' };
}

export function failStart(_from: Starting, reason: string): Failed {
	return { status: 'failed', reason };
}

export function stop(_from: Playing): Idle {
	return idle;
}
