// What the microphone is doing right now, as four states rather than a pile of
// booleans. `opening` exists because `getUserMedia` is awaited, and that gap is
// long enough for a second accept to land in it.

// Why the four outcomes are named here rather than left as a string: the
// Invitation shows a different message for each, and `unavailable` is the only
// one that says "try another browser" instead of "try again". A raw
// `DOMException` name would push that decision into the UI and vary by browser.
export type ListeningRejectionReason = 'refused' | 'no-microphone' | 'busy' | 'unavailable';

// `NotListening`, not `Idle`, because `playback-state.ts` already exports an
// `Idle` type and an `idle` value and the runtime holds both machines at once.
// One honest name here beats an aliased import at every call site.
export interface NotListening {
	readonly status: 'not-listening';
}

export interface Opening {
	readonly status: 'opening';
}

export interface Listening {
	readonly status: 'listening';
}

export interface Refused {
	readonly status: 'refused';
	readonly reason: ListeningRejectionReason;
}

export type ListeningState = NotListening | Opening | Listening | Refused;

export const notListening: NotListening = { status: 'not-listening' };

// One function per legal edge, each taking only the states that edge starts
// from, the way `playback-state.ts` does. A second accept while `getUserMedia`
// is still out, or a stop before anything opened, is then a compile error rather
// than a runtime branch nobody remembers to write.
//
// The parameter is unused at runtime and exists only to bind that type, hence
// the leading underscore for noUnusedParameters.

// `Refused` is an accepted starting point because three of the four reasons are
// worth another press: a microphone gets plugged in, the app holding it gets
// closed. Only `refused` itself is permanent, and the browser — not this
// machine — is what makes it so; the Invitation hides the button for that case.
export function beginOpening(_from: NotListening | Refused): Opening {
	return { status: 'opening' };
}

export function completeOpening(_from: Opening): Listening {
	return { status: 'listening' };
}

export function refused(_from: Opening, reason: ListeningRejectionReason): Refused {
	return { status: 'refused', reason };
}

export function endListening(_from: Listening): NotListening {
	return notListening;
}
