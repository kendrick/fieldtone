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

export interface RecordingBackendOptions {
	resume?: 'succeed' | 'fail';
	// Building the graph is real Web Audio work in the Tone adapter: constructing
	// nodes and starting an oscillator. Any of it can throw, so the runtime has to
	// survive it, and this is how a test makes it happen.
	start?: 'succeed' | 'fail';
}

export function createRecordingBackend(
	options: RecordingBackendOptions = {},
): RecordingBackend {
	const recordedCommands: BackendCommand[] = [];

	return {
		get commands(): readonly BackendCommand[] {
			return recordedCommands.slice();
		},
		resume: async (): Promise<void> => {
			recordedCommands.push({ kind: 'resume' });
			if (options.resume === 'fail') {
				throw new Error('AudioContext is suspended rather than running');
			}
		},
		start: (): void => {
			recordedCommands.push({ kind: 'start' });
			if (options.start === 'fail') {
				throw new Error('OscillatorNode could not be constructed');
			}
		},
		fadeIn: (seconds: number): void => {
			recordedCommands.push({ kind: 'fadeIn', seconds });
		},
		fadeOut: (seconds: number): void => {
			recordedCommands.push({ kind: 'fadeOut', seconds });
		},
		stop: (afterSeconds: number): void => {
			recordedCommands.push({ kind: 'stop', afterSeconds });
		},
	};
}
