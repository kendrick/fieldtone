import type { ControlSignalSchema } from './control-signals';
import type { ParameterSchema } from './parameters';
import type { Scene } from './scene';

// Test support under src/ rather than beside the specs, following the recording
// backend: a fake the type checker holds to the real contract is worth more than
// one free to drift from it. The builder ignores its host and constructs nothing,
// which is what lets a spec run under jsdom, where there is no AudioContext to
// build into.

// Both schemas are arguments so a spec can hand this Scene whatever parameters
// and Control Signals the case under test needs, rather than asserting against
// one baked-in set. They default to empty because most specs want neither.
export function createSilentScene(
	id: string,
	schema: ParameterSchema = {},
	controlSignals: ControlSignalSchema = {},
): Scene {
	return {
		id,
		parameters: schema,
		controlSignals,
		bed: (_host) => {
			return {
				stop: () => {},
				dispose: () => {},
				setParameter: () => {},
			};
		},
	};
}
