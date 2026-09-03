import type * as Tone from 'tone';
import type { ControlSignalSchema } from './control-signals';
import type { ParameterSchema, ParameterValues } from './parameters';

// An object rather than a bare node, so a Bed gets its destination and its
// opening parameter values in one argument. The values arrive already resolved
// against the Scene's schema: every declared name is present and in range, so a
// builder reads them without re-checking anything.
export interface BedHost {
	readonly destination: Tone.InputNode;
	readonly parameters: ParameterValues;
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
	// Required rather than optional: the backend then never has to guard the call,
	// and a Scene that declares a parameter cannot quietly ship without wiring it.
	// A Scene with no parameters writes a no-op, which costs one line.
	readonly setParameter: (name: string, value: number) => void;
}

export type BedBuilder = (host: BedHost) => BedHandle;

// Reserved by ADR 0002 for the fragment shader the visual layer will run.
// Nothing reads it yet.
export interface ShaderDeclaration {
	readonly fragment: string;
}

export interface Scene {
	readonly id: string;
	readonly bed: BedBuilder;
	// Required, `{}` for a Scene with nothing to tune. Optional would make every
	// reader handle an absent schema, and the runtime needs one to seed its store
	// before anything is playing.
	readonly parameters: ParameterSchema;
	// Required too, `{}` for a Scene that derives nothing from live input. Same
	// argument as `parameters`, plus one of its own: ADR 0004 rests a Scene at its
	// declared signal defaults whenever input is suspended or absent, and the Bed
	// has to sound right before the microphone Invitation is ever offered. So the
	// runtime reads this schema with nothing listening, and an optional one would
	// put a guard on every read.
	readonly controlSignals: ControlSignalSchema;
	readonly shader?: ShaderDeclaration;
}
