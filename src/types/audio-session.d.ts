// The W3C Audio Session API, which TypeScript's lib.dom does not ship yet.
// Declared by hand rather than reached through a cast, because Principle III
// forbids `any` and the spec's type list is a closed set worth keeping closed.
//
// No `export` here on purpose: a script-style declaration file is what lets
// `interface Navigator` merge with the built-in one.

type AudioSessionType
	= | 'auto'
		| 'playback'
		| 'transient'
		| 'transient-solo'
		| 'ambient'
		| 'play-and-record';

interface AudioSession {
	type: AudioSessionType;
}

interface Navigator {
	// Optional because only Safari implements it, and feature detection is the
	// entire point of reading it.
	readonly audioSession?: AudioSession;
}
