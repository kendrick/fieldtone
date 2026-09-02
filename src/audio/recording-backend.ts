import type { AudioBackend } from './audio-backend';
import type { ParameterValues } from '@/scenes/parameters';
import type { Scene } from '@/scenes/scene';

// This is the second implementation of the seam. A seam with one implementation
// is hypothetical; with two, the seam is real. The command list is the
// runtime's observable output, so tests assert on the sequence instead of
// reaching into Tone.js.

export type BackendCommand
	= | { kind: 'resume' }
		| { kind: 'start'; scene: string; parameters: ParameterValues }
		| { kind: 'setParameter'; name: string; value: number }
		| { kind: 'fadeIn'; seconds: number }
		| { kind: 'fadeOut'; seconds: number }
		| { kind: 'stop'; afterSeconds: number };

export interface RecordingBackend extends AudioBackend {
	readonly commands: readonly BackendCommand[];
}

// `fail-once` is what lets a test watch a runtime recover: the command throws on
// the first call and works after, the way a listener presses again and gets
// sound. `fail` never relents.
export type CommandOutcome = 'succeed' | 'fail' | 'fail-once';

export interface RecordingBackendOptions {
	resume?: CommandOutcome;
	// Everything after resume is real Web Audio work in the Tone adapter:
	// constructing nodes, starting an oscillator, scheduling a ramp. Any of it can
	// throw, so the runtime has to survive all of it, and these are how a test
	// makes each one happen.
	start?: CommandOutcome;
	fadeIn?: CommandOutcome;
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
		stop: (afterSeconds: number): void => {
			recordedCommands.push({ kind: 'stop', afterSeconds });
		},
	};
}
