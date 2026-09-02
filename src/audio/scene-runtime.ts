import type { StoreApi } from 'zustand/vanilla';

import type { AudioBackend } from './audio-backend';

import type { PlaybackState } from './playback-state';

import type { ParameterSchema, ParameterValues } from '@/scenes/parameters';
import type { Scene } from '@/scenes/scene';
import { createStore } from 'zustand/vanilla';

import { deserializeParameterValues, serializeParameterValues } from '@/scenes/parameter-serialization';
import { clampParameterValue, defaultParameterValues } from '@/scenes/parameters';
import { beginStart, completeStart, failStart, idle, stop as stopPlayback } from './playback-state';

export const FADE_IN_SECONDS = 0.3;
export const FADE_OUT_SECONDS = 0.3;

// An object rather than the bare PlaybackState, so the playback status and the
// Scene's parameter values publish through one store and one subscription.
export interface RuntimeState {
	readonly playback: PlaybackState;
	readonly parameters: ParameterValues;
}

// zustand's vanilla store types the read side as `ReadonlyStoreApi`, but the
// package does not export that name. `Pick`-ing the read-only members off the
// exported `StoreApi` gets the same shape structurally, and `useStore` accepts
// it without needing the internal type.
export type RuntimeStore = Pick<StoreApi<RuntimeState>, 'getState' | 'getInitialState' | 'subscribe'>;

export type StartResult = { ok: true } | { ok: false; reason: 'already-starting' | 'already-playing' | 'audio-unavailable' };

export type StopResult = { ok: true } | { ok: false; reason: 'not-playing' };

// The clamped value comes back rather than the caller's, so a UI control can
// settle on what the runtime actually stored instead of showing a number the
// audio never used.
export type SetParameterResult = { ok: true; value: number } | { ok: false; reason: 'unknown-parameter' };

export interface SceneRuntime {
	start: () => Promise<StartResult>;
	stop: () => StopResult;
	setParameter: (name: string, value: number) => SetParameterResult;
	getState: () => PlaybackState;
	// `schema` rather than `parameters`: RuntimeState.parameters already means the
	// values, and one object carrying both under that name reads as a bug.
	readonly schema: ParameterSchema;
	readonly store: RuntimeStore;
	serializeParameters: () => string;
	applySerializedParameters: (search: string) => ParameterValues;
}

// Exhaustiveness guard: a state added to PlaybackState without a matching
// switch branch here fails the build instead of falling through silently.
function assertNever(value: never): never {
	throw new Error(`unreachable playback state: ${JSON.stringify(value)}`);
}

export function createSceneRuntime(backend: AudioBackend, scene: Scene): SceneRuntime {
	const store = createStore<RuntimeState>()(() => ({
		playback: idle,
		parameters: defaultParameterValues(scene.parameters),
	}));

	async function start(): Promise<StartResult> {
		const state = store.getState().playback;

		switch (state.status) {
			case 'starting':
				return { ok: false, reason: 'already-starting' };
			case 'playing':
				return { ok: false, reason: 'already-playing' };
			case 'idle':
			case 'failed': {
				const starting = beginStart(state);
				store.setState({ playback: starting });

				try {
					// Must be the first await on this path: iOS spends the user
					// gesture on whichever await runs first, and only resume() is
					// allowed to consume it.
					await backend.resume();
					// Read the values after the await, never before: the resume gap is
					// long enough for a listener to move a control, and a snapshot taken
					// ahead of it would build the graph at the value they just left.
					// Building the graph belongs inside the same try. It is real Web
					// Audio work and can throw on its own, and a throw that escaped
					// here would leave the state on `starting` forever: the caller
					// discards this promise, so nothing would surface, and every later
					// press would be turned away as `already-starting`.
					backend.start(scene, store.getState().parameters);
					backend.fadeIn(FADE_IN_SECONDS);
				}
				catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					store.setState({ playback: failStart(starting, reason) });
					return { ok: false, reason: 'audio-unavailable' };
				}

				store.setState({ playback: completeStart(starting) });
				return { ok: true };
			}
			default:
				return assertNever(state);
		}
	}

	function stop(): StopResult {
		const state = store.getState().playback;

		if (state.status !== 'playing') {
			return { ok: false, reason: 'not-playing' };
		}

		backend.fadeOut(FADE_OUT_SECONDS);
		backend.stop(FADE_OUT_SECONDS);
		store.setState({ playback: stopPlayback(state) });
		return { ok: true };
	}

	function setParameter(name: string, value: number): SetParameterResult {
		// noUncheckedIndexedAccess types this read as possibly undefined, and that
		// branch is exactly the unknown-name rejection—no cast needed to get it.
		const declaration = scene.parameters[name];

		if (declaration === undefined) {
			return { ok: false, reason: 'unknown-parameter' };
		}

		const clamped = clampParameterValue(declaration, value);
		// Stored in every playback state, forwarded only while a graph exists. A
		// setting made while idle or after a failed start is still the listener's
		// choice, and the next start reads it back out of here.
		store.setState({ parameters: { ...store.getState().parameters, [name]: clamped } });

		if (store.getState().playback.status === 'playing') {
			backend.setParameter(name, clamped);
		}

		return { ok: true, value: clamped };
	}

	function getState(): PlaybackState {
		return store.getState().playback;
	}

	function serializeParameters(): string {
		return serializeParameterValues(scene.parameters, store.getState().parameters);
	}

	// Total, not a diff against defaults: a key the search string omits comes back
	// from deserializeParameterValues as that parameter's default, and every
	// resolved entry is routed through setParameter rather than written to the
	// store directly. That is the only place the clamp, the store write, and the
	// forward-only-while-playing rule live, and duplicating any of it here would
	// let a link apply a value setParameter itself would have rejected or
	// reshaped. This runs once at mount, before a listener has touched a control,
	// so overwriting every parameter is a description of the Scene the link
	// carries, not a value clobbered mid-drag.
	function applySerializedParameters(search: string): ParameterValues {
		const decoded = deserializeParameterValues(scene.parameters, search);

		for (const [name, value] of Object.entries(decoded)) {
			setParameter(name, value);
		}

		return store.getState().parameters;
	}

	return { start, stop, setParameter, getState, schema: scene.parameters, store, serializeParameters, applySerializedParameters };
}
