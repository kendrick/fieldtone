import type { StoreApi } from 'zustand/vanilla';

import type { AudioBackend } from './audio-backend';

import type { PlaybackState } from './playback-state';

import type { SignalValues } from '@/scenes/control-signals';
import type { ParameterSchema, ParameterValues } from '@/scenes/parameters';
import type { Scene } from '@/scenes/scene';
import { createStore } from 'zustand/vanilla';

import { clampSignalValue, defaultSignalValues, modulatedParameterValue } from '@/scenes/control-signals';
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
	// Held apart from `parameters` rather than folded into it, because a Control
	// Signal moves a parameter without changing the listener's setting. Merge the
	// two here and the listener's own value is gone the moment the room gets loud.
	// Their slider would jump under their hand, and the share link would carry
	// whatever the microphone was hearing.
	readonly signals: SignalValues;
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
		// Seeded rather than left empty, so the Bed sounds right before the
		// microphone Invitation is ever offered: ADR 0004 rests a Scene at its
		// declared signal defaults whenever input is absent or suspended, and the
		// first press happens long before anything is listening.
		signals: defaultSignalValues(scene.controlSignals),
	}));

	// The one place the listener's values and the signals' readings meet.
	// Everything upstream holds them apart, and a value combines only on its way
	// out to the backend, which is what keeps a signal out of the store and out of
	// a share link.
	function effectiveParameters(): ParameterValues {
		const { parameters, signals } = store.getState();
		const combined: Record<string, number> = { ...parameters };

		for (const [name, signal] of Object.entries(scene.controlSignals)) {
			const declaration = scene.parameters[signal.parameter];
			// noUncheckedIndexedAccess types all three reads as possibly undefined,
			// and one of them is a real case: a signal is free to name a parameter its
			// Scene never declared. There is no min or max to clamp that against, so
			// the only safe move is to drive nothing.
			const listenerValue = combined[signal.parameter];
			const signalValue = signals[name];

			if (declaration === undefined || listenerValue === undefined || signalValue === undefined) {
				continue;
			}

			// Reading back out of `combined` rather than out of `parameters`, so two
			// signals bound to one parameter stack their offsets instead of the last
			// one silently winning.
			combined[signal.parameter] = modulatedParameterValue(declaration, listenerValue, signal, signalValue);
		}

		return combined;
	}

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
					backend.start(scene, effectiveParameters());
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
			// The graph hears the combined value; the caller gets the listener's. A
			// slider that settled on the combined one would show the room's reading as
			// the listener's own setting, and the next drag would start from there.
			backend.setParameter(name, effectiveParameters()[name] ?? clamped);
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

	// Subscribed at creation, not at start: a reading that lands while idle is
	// still the state of the room, and the next press builds the graph at it.
	//
	// The unsubscribe is deliberately dropped. A runtime and the backend under it
	// are constructed together in runtime.ts and live as long as the module does,
	// so neither can outlive the other and there is nothing to leak. Holding the
	// function in a field nothing calls would only imply a teardown SceneRuntime
	// does not have; the day a runtime becomes disposable, that method is where
	// this call goes.
	backend.onSignal((name: string, value: number): void => {
		const signal = scene.controlSignals[name];

		// A backend is free to derive whatever Listening gives it. A Scene that
		// declared no use for this one is not an error, so it writes nothing at all:
		// a store write here would re-render every subscriber for a value no Scene
		// reads.
		if (signal === undefined) {
			return;
		}

		const clamped = clampSignalValue(value);
		store.setState({ signals: { ...store.getState().signals, [name]: clamped } });

		if (store.getState().playback.status !== 'playing') {
			return;
		}

		const effective = effectiveParameters()[signal.parameter];

		// undefined only where the signal names an undeclared parameter, which
		// effectiveParameters already skipped. Nothing to forward.
		if (effective === undefined) {
			return;
		}

		backend.setParameter(signal.parameter, effective);
	});

	return { start, stop, setParameter, getState, schema: scene.parameters, store, serializeParameters, applySerializedParameters };
}
