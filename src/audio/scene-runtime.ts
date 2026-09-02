import type { StoreApi } from 'zustand/vanilla';

import type { AudioBackend } from './audio-backend';

import type { PlaybackState } from './playback-state';
import { createStore } from 'zustand/vanilla';

import { beginStart, completeStart, failStart, idle, stop as stopPlayback } from './playback-state';

export const FADE_IN_SECONDS = 0.3;
export const FADE_OUT_SECONDS = 0.3;

// An object rather than the bare PlaybackState so a later ticket can add Scene
// parameters beside `playback` without changing every reader's shape.
export interface RuntimeState {
	readonly playback: PlaybackState;
}

// zustand's vanilla store types the read side as `ReadonlyStoreApi`, but the
// package does not export that name. `Pick`-ing the read-only members off the
// exported `StoreApi` gets the same shape structurally, and `useStore` accepts
// it without needing the internal type.
export type RuntimeStore = Pick<StoreApi<RuntimeState>, 'getState' | 'getInitialState' | 'subscribe'>;

export type StartResult = { ok: true } | { ok: false; reason: 'already-starting' | 'already-playing' | 'audio-unavailable' };

export type StopResult = { ok: true } | { ok: false; reason: 'not-playing' };

export interface SceneRuntime {
	start: () => Promise<StartResult>;
	stop: () => StopResult;
	getState: () => PlaybackState;
	readonly store: RuntimeStore;
}

// Exhaustiveness guard: a state added to PlaybackState without a matching
// switch branch here fails the build instead of falling through silently.
function assertNever(value: never): never {
	throw new Error(`unreachable playback state: ${JSON.stringify(value)}`);
}

export function createSceneRuntime(backend: AudioBackend): SceneRuntime {
	const store = createStore<RuntimeState>()(() => ({ playback: idle }));

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
					// Building the graph belongs inside the same try. It is real Web
					// Audio work and can throw on its own, and a throw that escaped
					// here would leave the state on `starting` forever: the caller
					// discards this promise, so nothing would surface, and every later
					// press would be turned away as `already-starting`.
					backend.start();
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

	function getState(): PlaybackState {
		return store.getState().playback;
	}

	return { start, stop, getState, store };
}
