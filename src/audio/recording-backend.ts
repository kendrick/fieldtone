import type { AudioBackend } from './audio-backend';

// This is the second implementation of the seam. A seam with one implementation
// is hypothetical; with two, the seam is real. The command list is the
// runtime's observable output, so tests assert on the sequence instead of
// reaching into Tone.js.

export type BackendCommand
	= | { kind: 'resume' }
		| { kind: 'start' }
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
		start: (): void => {
			recordedCommands.push({ kind: 'start' });
			if (startFails()) {
				throw new Error('OscillatorNode could not be constructed');
			}
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
