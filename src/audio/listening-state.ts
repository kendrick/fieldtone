// What the microphone is doing right now, as five states rather than a pile of
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

// A page the listener has navigated away from or backgrounded, not a browser
// refusal and not a stop. Nobody answered the second Invitation either way, so
// the state that comes back when they return has to be neither `refused` nor
// `not-listening`.
export interface Suspended {
	readonly status: 'suspended';
}

export type ListeningState = NotListening | Opening | Listening | Refused | Suspended;

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
// closed. Only `refused` itself is permanent, and the browser—not this
// machine—is what makes it so; the Invitation hides the button for that case.
// `Suspended` joins `NotListening | Refused` here for the same reason a stop
// does not clear it away on its own: a page that comes back from the
// background is a fresh press, and the listener asking again is what
// `beginOpening` already means for the other two starting points.
export function beginOpening(_from: NotListening | Refused | Suspended): Opening {
	return { status: 'opening' };
}

export function completeOpening(_from: Opening): Listening {
	return { status: 'listening' };
}

export function refused(_from: Opening, reason: ListeningRejectionReason): Refused {
	return { status: 'refused', reason };
}

// The way out of `opening` that neither claims a microphone the listener no
// longer wants nor records a refusal nobody made. An attempt can outlive the
// reason for it—Stop pressed while the browser's prompt is still up—and
// without this edge the two ways to leave both lie: `completeOpening` would
// light the recording indicator over a stopped Bed, and `refused` would put a
// message on screen blaming a browser that had said yes.
export function abandonOpening(_from: Opening): NotListening {
	return notListening;
}

// A refusal is an answer about a Bed that was playing when the listener asked.
// Stop ends that session, and the answer has nothing left to explain: kept
// around it holds the Invitation on screen over a stopped Bed, offering a button
// that can only be turned away by the not-playing guard.
export function dismissRefusal(_from: Refused): NotListening {
	return notListening;
}

export function endListening(_from: Listening): NotListening {
	return notListening;
}

// Accepts `Listening` and `Opening` both, because the backend holds the
// microphone stream from the moment the grant lands—`stream = opened` in
// tone-backend.ts runs before startListening resolves—so a suspension landing
// mid-fetch still has a real track to release, not just a promise to let run.
// Leaving `Opening` unhandled would strand that track: a getUserMedia parked
// by a hidden page only resolves once the page is visible again, and by then
// a newer attempt already owns the store, so nothing left in `opening` would
// ever get the chance to close what it opened.
export function suspendListening(_from: Listening | Opening): Suspended {
	return { status: 'suspended' };
}

// Its own edge rather than a reuse of `endListening` or `abandonOpening`,
// because both of those would lie about what happened. `endListening` says a
// microphone was open and is now closed, but a suspended session may never
// have gotten past the prompt. `abandonOpening` says an attempt is still out
// waiting on the browser, but a suspension already resolved that one way or
// the other before landing here. Only `dismissSuspension` describes what is
// actually true: nobody answered, and now nobody is asking.
export function dismissSuspension(_from: Suspended): NotListening {
	return notListening;
}
