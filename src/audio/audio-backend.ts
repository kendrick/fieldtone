import type { ParameterValues } from '@/scenes/parameters';
import type { Scene } from '@/scenes/scene';

// The seam between the play button and Tone.js. Everything below the line is
// synchronous and fire-and-forget, which is what lets a test fake record calls
// in order and assert on them without a clock.

// The one channel that runs upward instead of down. Every other member here is
// the runtime telling the backend something; a Control Signal is Listening
// telling the runtime something, derived from live input rather than chosen by
// a listener. Naming it (rather than, say, a single fixed "level" channel) is
// what lets one Scene's Bed react to a signal another Scene never produces.
export type SignalListener = (name: string, value: number) => void;

export interface AudioBackend {
	// iOS will not start an AudioContext outside a user gesture, so this has to
	// be the first await on the click path: anything awaited before it spends
	// the gesture. Rejects when the context comes back as anything but running.
	resume: () => Promise<void>;
	// The Scene names which Bed to build; the backend owns the envelope around it.
	// The Bed starts silent, and fading it in is a separate command, so the caller
	// decides when audio becomes audible. The values come in with the Scene rather
	// than as later setParameter calls, so the graph is built at the settings the
	// listener already chose instead of audibly sliding to them after the fade.
	start: (scene: Scene, parameters: ParameterValues) => void;
	// A no-op when nothing is playing. The runtime keeps the value either way, so
	// a setting made while idle reaches the graph through the next start.
	setParameter: (name: string, value: number) => void;
	fadeIn: (seconds: number) => void;
	fadeOut: (seconds: number) => void;
	// The delay rides on the command rather than a setTimeout because the
	// runtime owns no timers (Principle V rules out timers and polling loops).
	// The audio clock already schedules this precisely; a JS timer would not.
	stop: (afterSeconds: number) => void;
	// Returns the unsubscribe rather than exposing a separate `offSignal`, so a
	// caller that stops caring (a Scene torn down, a control retired) can drop
	// its own listener without needing to keep the original function reference
	// around to hand back.
	onSignal: (listener: SignalListener) => () => void;
}
