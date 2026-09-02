import type * as Tone from 'tone';

// An object rather than a bare node, so #6 can hand a Bed its initial parameter
// values without changing every builder's signature.
export interface BedHost {
	readonly destination: Tone.InputNode;
}

export interface BedHandle {
	// Resolves once every node in the graph can sound, which for a Reverb means
	// its impulse has rendered. Playback never waits on `ready`. The offline probe
	// does, because a graph rendered before its impulse exists comes back silent
	// and passes anyway.
	readonly ready?: Promise<void>;
	// A stopped node is silent; a disposed one is gone. stop and dispose stay
	// separate because dispose() on its own leaves a native oscillator processing
	// in the audio thread.
	readonly stop: (at: number) => void;
	readonly dispose: () => void;
}

export type BedBuilder = (host: BedHost) => BedHandle;

// Reserved by ADR 0002 for the fragment shader the visual layer will run.
// Nothing reads it yet.
export interface ShaderDeclaration {
	readonly fragment: string;
}

// #6 adds a `parameters` field beside `bed` and `shader`.
export interface Scene {
	readonly id: string;
	readonly bed: BedBuilder;
	readonly shader?: ShaderDeclaration;
}
