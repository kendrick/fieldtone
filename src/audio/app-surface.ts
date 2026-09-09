// ADR 0004 measured `display-mode: browser` reported for an installed web app
// during the spike, so that media query cannot be trusted to tell the two
// surfaces apart. `navigator.standalone` is what the spike relied on instead,
// and the ADR asks that whatever reads it live in one place rather than being
// checked throughout the settings UI — this is that place.
//
// Tone-free, so this can be asserted on under jsdom with no AudioContext
// anywhere near it, and DOM-guarded rather than DOM-free, the same pattern
// audio-session.ts uses for `navigator.audioSession`. Node ships a `navigator`
// of its own, so the static export's prerender never needs the `typeof` check;
// it is there for a runtime that ships none.

export function isInstalledApp(): boolean {
	return typeof navigator !== 'undefined' && navigator.standalone === true;
}
