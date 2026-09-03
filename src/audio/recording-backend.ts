import type { AudioBackend, SignalListener } from './audio-backend';
import type { ListeningRejectionReason } from './listening-state';
import type { ParameterValues } from '@/scenes/parameters';
import type { Scene } from '@/scenes/scene';
import { ListeningRejection } from './audio-backend';

// This is the second implementation of the seam. A seam with one implementation
// is hypothetical; with two, the seam is real. The command list is the
// runtime's observable output, so tests assert on the sequence instead of
// reaching into Tone.js.
//
// `onSignal` is the same story a second time: a listener with nothing to call
// it is still hypothetical. `emitSignal` below is what makes the upward
// channel real, and it is how every test in this feature drives Listening-shaped
// behavior — no microphone, no AudioWorklet, no AudioContext, just a call.

export type BackendCommand
	= | { kind: 'resume' }
		| { kind: 'start'; scene: string; parameters: ParameterValues }
		| { kind: 'setParameter'; name: string; value: number }
		| { kind: 'fadeIn'; seconds: number }
		| { kind: 'fadeOut'; seconds: number }
		| { kind: 'startListening' }
		| { kind: 'stopListening' }
		| { kind: 'stop'; afterSeconds: number };

export interface RecordingBackend extends AudioBackend {
	readonly commands: readonly BackendCommand[];
	// Drives the upward channel from a test, standing in for Listening deriving
	// a Control Signal. It is input to the runtime rather than output from it,
	// so unlike every method above it has no BackendCommand variant and never
	// touches `commands` — recording it would make the runtime's own output log
	// include something the runtime never asked for.
	emitSignal: (name: string, value: number) => void;
}

// `fail-once` is what lets a test watch a runtime recover: the command throws on
// the first call and works after, the way a listener presses again and gets
// sound. `fail` never relents.
export type CommandOutcome = 'succeed' | 'fail' | 'fail-once';

// No `fail-once` counterpart here, deliberately. A browser that was told no
// remembers the answer, so a second accept gets the same one back without
// another prompt; a fake that relented on the retry would let a test pass
// against behavior no listener can reach.
export type ListeningOutcome = 'succeed' | ListeningRejectionReason;

export interface RecordingBackendOptions {
	resume?: CommandOutcome;
	// Everything after resume is real Web Audio work in the Tone adapter:
	// constructing nodes, starting an oscillator, scheduling a ramp. Any of it can
	// throw, so the runtime has to survive all of it, and these are how a test
	// makes each one happen.
	start?: CommandOutcome;
	fadeIn?: CommandOutcome;
	// Named by outcome rather than by a boolean, so a case reads as the answer the
	// listener would get: `{ listening: 'no-microphone' }` is the laptop with no
	// microphone attached.
	listening?: ListeningOutcome;
}

function failureGate(outcome: CommandOutcome = 'succeed'): () => boolean {
	let remaining = 0;
	if (outcome === 'fail') {
		remaining = Number.POSITIVE_INFINITY;
	}
	else if (outcome === 'fail-once') {
		remaining = 1;
	}
	return (): boolean => {
		if (remaining <= 0) {
			return false;
		}
		remaining -= 1;
		return true;
	};
}

export function createRecordingBackend(
	options: RecordingBackendOptions = {},
): RecordingBackend {
	const recordedCommands: BackendCommand[] = [];
	const resumeFails = failureGate(options.resume);
	const startFails = failureGate(options.start);
	const fadeInFails = failureGate(options.fadeIn);
	// A Set rather than an array so a listener that unsubscribes mid-emit (a
	// Scene tearing itself down inside its own handler) can't corrupt whatever
	// loop is iterating it, and so double-subscribing the same function is a
	// no-op instead of a double call.
	const signalListeners = new Set<SignalListener>();
	const listeningOutcome = options.listening ?? 'succeed';

	return {
		get commands(): readonly BackendCommand[] {
			return recordedCommands.slice();
		},
		resume: async (): Promise<void> => {
			recordedCommands.push({ kind: 'resume' });
			if (resumeFails()) {
				throw new Error('AudioContext is suspended rather than running');
			}
		},
		start: (scene: Scene, parameters: ParameterValues): void => {
			// The command carries the scene id rather than the full object,
			// since the command list exists to be toEqual'd and a function-bearing
			// object would make that brittle. The values are plain numbers, so they
			// ride along whole.
			recordedCommands.push({ kind: 'start', scene: scene.id, parameters });
			if (startFails()) {
				throw new Error('OscillatorNode could not be constructed');
			}
		},
		// No failure gate here, unlike start and fadeIn. The runtime only ever hands
		// this a name it found in the schema and a value it already clamped, so a
		// throw would be a Scene bug with no listener-facing story to test against.
		setParameter: (name: string, value: number): void => {
			recordedCommands.push({ kind: 'setParameter', name, value });
		},
		fadeIn: (seconds: number): void => {
			recordedCommands.push({ kind: 'fadeIn', seconds });
			if (fadeInFails()) {
				throw new Error('gain ramp could not be scheduled');
			}
		},
		fadeOut: (seconds: number): void => {
			recordedCommands.push({ kind: 'fadeOut', seconds });
		},
		// A real ListeningRejection rather than a stand-in error: the runtime's job
		// on this path is to read `reason` off it, and a fake that rejected with a
		// plain Error would exercise the fallback branch instead of the mapping.
		startListening: async (): Promise<void> => {
			recordedCommands.push({ kind: 'startListening' });
			if (listeningOutcome !== 'succeed') {
				throw new ListeningRejection(listeningOutcome);
			}
		},
		stopListening: (): void => {
			recordedCommands.push({ kind: 'stopListening' });
		},
		stop: (afterSeconds: number): void => {
			recordedCommands.push({ kind: 'stop', afterSeconds });
		},
		onSignal: (listener: SignalListener): (() => void) => {
			signalListeners.add(listener);
			return (): void => {
				signalListeners.delete(listener);
			};
		},
		emitSignal: (name: string, value: number): void => {
			for (const listener of signalListeners) {
				listener(name, value);
			}
		},
	};
}
