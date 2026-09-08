// Safari's non-standard `navigator.standalone`, which lib.dom does not ship.
// Declared by hand rather than reached through a cast, because Principle III
// forbids `any` and app-surface.ts is the one place allowed to read it.
//
// No `export` here on purpose: a script-style declaration file is what lets
// `interface Navigator` merge with the built-in one.

interface Navigator {
	// Optional because only Safari implements it, and feature detection is the
	// entire point of reading it.
	readonly standalone?: boolean;
}
