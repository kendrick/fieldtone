import type { Scene } from '@/scenes/scene';

// The seam between the play button and Tone.js. Everything below the line is
// synchronous and fire-and-forget, which is what lets a test fake record calls
// in order and assert on them without a clock.
export interface AudioBackend {
	// iOS will not start an AudioContext outside a user gesture, so this has to
	// be the first await on the click path: anything awaited before it spends
	// the gesture. Rejects when the context comes back as anything but running.
	resume: () => Promise<void>;
	// The Scene names which Bed to build; the backend owns the envelope around it.
	// The Bed starts silent, and fading it in is a separate command, so the caller
	// decides when audio becomes audible.
	start: (scene: Scene) => void;
	fadeIn: (seconds: number) => void;
	fadeOut: (seconds: number) => void;
	// The delay rides on the command rather than a setTimeout because the
	// runtime owns no timers (Principle V rules out timers and polling loops).
	// The audio clock already schedules this precisely; a JS timer would not.
	stop: (afterSeconds: number) => void;
}
