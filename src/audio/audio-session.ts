// The two audio session types FieldTone ever declares. Tone-free, so the guard
// below can be tested with no AudioContext anywhere near it, and DOM-guarded
// rather than DOM-free: reading `navigator` behind a `typeof` check is what
// makes this file safe to evaluate during the static export's Node prerender.
//
// Only Safari implements the Audio Session API, so all three functions do
// nothing on every desktop browser. ADR 0004 measured that the backgrounding
// posture holds there anyway, because neither Chrome nor Firefox throttles a
// tab making sound.

function audioSession(): AudioSession | undefined {
	return typeof navigator === 'undefined' ? undefined : navigator.audioSession;
}

export function requestPlaybackSession(): void {
	// Safari's default session behaves like `ambient`, which the physical ringer
	// switch silences. Without this the app looks broken to anyone on mute.
	const session = audioSession();
	if (session !== undefined) {
		session.type = 'playback';
	}
}

// True when Listening would move the session rather than find it already there.
// A predicate rather than something `requestRecordSession` reports afterwards,
// because the caller fades the Bed across the move and has to start that fade
// before the move happens.
//
// `false` is ordinary, not an edge case. `stopListening` leaves the session on
// `play-and-record`, so a listener who stops and restarts Listening without
// stopping playback needs no second switch and should pay no second fade.
// Pressing Stop and then Play does need one, because `resume()` puts the
// session back on `playback` every time it runs.
export function needsRecordSession(): boolean {
	const session = audioSession();
	return session !== undefined && session.type !== 'play-and-record';
}

// Called when the listener accepts the second Invitation, never at startup.
// WebKit forces `Mode::VideoChat` the instant the type is set, which puts output
// on iOS's voice-chat volume scale and retunes the device's tonal equalization
// for voice. ADR 0004 charges that to the listener who asked for a microphone
// rather than to everyone who only ever pressed play.
//
// Switching under a running Bed costs up to a second of silence and then a jump
// in level, so `tone-backend.ts` fades the Bed across this call. Reading before
// writing is what keeps a redundant assignment from costing a second dropout:
// nothing says WebKit treats a same-value write as a no-op rather than as
// another session transition, and it is cheaper to not find out.
export function requestRecordSession(): void {
	const session = audioSession();
	if (session !== undefined && session.type !== 'play-and-record') {
		session.type = 'play-and-record';
	}
}
