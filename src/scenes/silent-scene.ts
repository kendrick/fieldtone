import type { ParameterSchema } from './parameters';
import type { Scene } from './scene';

// Test support under src/ rather than beside the specs, following the recording
// backend: a fake the type checker holds to the real contract is worth more than
// one free to drift from it. The builder ignores its host and constructs nothing,
// which is what lets a spec run under jsdom, where there is no AudioContext to
// build into.

// The schema is a parameter so a spec can give this Scene whatever parameters
// the case under test needs, rather than asserting against one baked-in set.
export function createSilentScene(id: string, schema: ParameterSchema = {}): Scene {
	return {
		id,
		parameters: schema,
		bed: (_host) => {
			return {
				stop: () => {},
				dispose: () => {},
				setParameter: () => {},
			};
		},
	};
}
