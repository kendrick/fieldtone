// The two audio session types FieldTone ever declares. Tone-free, so the guard
// below can be tested with no AudioContext anywhere near it, and DOM-guarded
// rather than DOM-free: reading `navigator` behind a `typeof` check is what
// makes this file safe to evaluate during the static export's Node prerender.
//
// Only Safari implements the Audio Session API, so both functions do nothing on
// every desktop browser. ADR 0004 measured that the backgrounding posture holds
// there anyway, because neither Chrome nor Firefox throttles a tab making sound.

export function requestPlaybackSession(): void {
	// Safari's default session behaves like `ambient`, which the physical ringer
	// switch silences. Without this the app looks broken to anyone on mute.
	if (typeof navigator !== 'undefined' && navigator.audioSession !== undefined) {
		navigator.audioSession.type = 'playback';
	}
}

// Called when the listener accepts the second Invitation, never at startup.
// WebKit forces `Mode::VideoChat` the instant the type is set, which puts output
// on iOS's voice-chat volume scale and retunes the device's tonal equalization
// for voice. ADR 0004 charges that to the listener who asked for a microphone
// rather than to everyone who only ever pressed play.
//
// Switching under a running Bed costs up to a second of silence and then a jump
// in level, so `tone-backend.ts` fades the Bed across this call. Where there is
// no audio session there is no switch and no dropout, which is why desktop
// never fades.
export function requestRecordSession(): void {
	if (typeof navigator !== 'undefined' && navigator.audioSession !== undefined) {
		navigator.audioSession.type = 'play-and-record';
	}
}
