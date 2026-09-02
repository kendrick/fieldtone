import type { PlaybackState } from './playback-state';
import type { Scene } from '@/scenes/scene';

import { describe, expect, it } from 'vitest';

import { createSilentScene } from '@/scenes/silent-scene';
import { createRecordingBackend } from './recording-backend';
import { createSceneRuntime, FADE_IN_SECONDS, FADE_OUT_SECONDS } from './scene-runtime';

const silentScene = createSilentScene('silent');

// One parameter is enough for every case below: what is under test is the
// runtime's bookkeeping around a value, not the shape of a schema.
function createTunableScene(): Scene {
	return createSilentScene('silent', {
		level: { kind: 'number', label: 'Level', min: 0, max: 1, default: 0.5 },
	});
}

describe('scene runtime', (): void => {
	it('starts by resuming, starting, and fading in, then reports playing', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		const result = await runtime.start();

		expect(result).toEqual({ ok: true });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	it('stops a playing scene by fading out then stopping, and reports idle', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const result = runtime.stop();

		expect(result).toEqual({ ok: true });
		expect(backend.commands.slice(3)).toEqual([
			{ kind: 'fadeOut', seconds: FADE_OUT_SECONDS },
			{ kind: 'stop', afterSeconds: FADE_OUT_SECONDS },
		]);
		expect(runtime.getState()).toEqual({ status: 'idle' });
	});

	it('refuses to stop a scene that never started, and touches the backend not at all', (): void => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		const result = runtime.stop();

		expect(result).toEqual({ ok: false, reason: 'not-playing' });
		expect(backend.commands).toEqual([]);
	});

	it('refuses a second start while already playing, and records nothing further', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const commandsAfterFirstStart = backend.commands;
		const result = await runtime.start();

		expect(result).toEqual({ ok: false, reason: 'already-playing' });
		expect(backend.commands).toEqual(commandsAfterFirstStart);
	});

	it('refuses a start that lands while another start is still in flight', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		// Fire both starts before awaiting either: the second call must land while
		// the first is still suspended on backend.resume(), which is the only
		// window `already-starting` guards.
		const first = runtime.start();
		const second = runtime.start();

		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toEqual({ ok: true });
		expect(secondResult).toEqual({ ok: false, reason: 'already-starting' });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('fails to start when resume rejects, then succeeds on a later retry', async (): Promise<void> => {
		const failingBackend = createRecordingBackend({ resume: 'fail' });
		const failingRuntime = createSceneRuntime(failingBackend, silentScene);

		const failedResult = await failingRuntime.start();

		expect(failedResult).toEqual({ ok: false, reason: 'audio-unavailable' });
		expect(failingRuntime.getState()).toEqual({
			status: 'failed',
			reason: 'AudioContext is suspended rather than running',
		});

		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);
		const retryResult = await runtime.start();

		expect(retryResult).toEqual({ ok: true });
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	// Everything after resume used to sit outside the try, so a throw from any of
	// it escaped as a rejected promise. The caller discards that promise, so it
	// surfaced nowhere and left the button dead for good. One test per command,
	// because covering only the first would let the other slip back out.
	it('reports a failure when starting the graph throws, rather than rejecting', async (): Promise<void> => {
		const backend = createRecordingBackend({ start: 'fail' });
		const runtime = createSceneRuntime(backend, silentScene);

		const result = await runtime.start();

		expect(result).toEqual({ ok: false, reason: 'audio-unavailable' });
		expect(runtime.getState()).toEqual({
			status: 'failed',
			reason: 'OscillatorNode could not be constructed',
		});
		expect(backend.commands).toEqual([{ kind: 'resume' }, { kind: 'start', scene: 'silent', parameters: {} }]);
	});

	it('reports a failure when the fade in throws, rather than rejecting', async (): Promise<void> => {
		const backend = createRecordingBackend({ fadeIn: 'fail' });
		const runtime = createSceneRuntime(backend, silentScene);

		const result = await runtime.start();

		expect(result).toEqual({ ok: false, reason: 'audio-unavailable' });
		expect(runtime.getState()).toEqual({
			status: 'failed',
			reason: 'gain ramp could not be scheduled',
		});
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	// A listener whose first press failed presses again and gets sound, on the same
	// runtime. `already-starting` on the second press would mean it never left the
	// starting state and no press could ever get through again.
	it('recovers on a second press after the graph failed to build', async (): Promise<void> => {
		const backend = createRecordingBackend({ start: 'fail-once' });
		const runtime = createSceneRuntime(backend, silentScene);

		const firstPress = await runtime.start();
		const secondPress = await runtime.start();

		expect(firstPress).toEqual({ ok: false, reason: 'audio-unavailable' });
		expect(secondPress).toEqual({ ok: true });
		expect(runtime.getState()).toEqual({ status: 'playing' });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('publishes the same status through the store as getState, in order, across a start then a stop', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);
		const statuses: PlaybackState['status'][] = [];

		const unsubscribe = runtime.store.subscribe((state): void => {
			statuses.push(state.playback.status);
			expect(state.playback).toEqual(runtime.getState());
		});

		await runtime.start();
		runtime.stop();
		unsubscribe();

		expect(statuses).toEqual(['starting', 'playing', 'idle']);
	});

	// The runtime must carry no Scene-specific knowledge of its own: it only
	// forwards whatever Scene it was given. A single Scene passing through would
	// pass just as well if the runtime hardcoded that one id, so this proves it
	// by running two runtimes over two Scenes and checking each fake got its own.
	it('forwards each runtime its own scene id, not the other one', async (): Promise<void> => {
		const backendOne = createRecordingBackend();
		const backendTwo = createRecordingBackend();
		const runtimeOne = createSceneRuntime(backendOne, createSilentScene('one'));
		const runtimeTwo = createSceneRuntime(backendTwo, createSilentScene('two'));

		await runtimeOne.start();
		await runtimeTwo.start();

		expect(backendOne.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'one', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
		expect(backendTwo.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'two', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});
});

// A setting the listener chose is theirs until they change it. The runtime holds
// it in the store in every playback state and only forwards it to the backend
// while a graph exists, which is what keeps a value from drifting back to the
// default across a stop and a restart.
describe('scene runtime parameters', (): void => {
	it('starts the store at the schema defaults', (): void => {
		const runtime = createSceneRuntime(createRecordingBackend(), createTunableScene());

		expect(runtime.store.getState().parameters).toEqual({ level: 0.5 });
		expect(runtime.schema).toEqual({
			level: { kind: 'number', label: 'Level', min: 0, max: 1, default: 0.5 },
		});
	});

	it('forwards a change made while playing without restarting the graph', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		await runtime.start();
		const result = runtime.setParameter('level', 0.8);

		expect(result).toEqual({ ok: true, value: 0.8 });
		// Everything after the three start commands: one setParameter and nothing
		// else. A stop or a start in here would mean the graph was rebuilt, which the
		// listener would hear as a gap.
		expect(backend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 0.8 }]);
		expect(runtime.store.getState().parameters).toEqual({ level: 0.8 });
	});

	it('clamps an out-of-range value in both the result and the command', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		await runtime.start();
		const result = runtime.setParameter('level', 4);

		expect(result).toEqual({ ok: true, value: 1 });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 1 }]);
		expect(runtime.store.getState().parameters).toEqual({ level: 1 });
	});

	it('rejects a name the schema does not declare, and touches neither the backend nor the playback state', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		await runtime.start();
		const commandsBefore = backend.commands;
		const result = runtime.setParameter('reverb', 0.4);

		expect(result).toEqual({ ok: false, reason: 'unknown-parameter' });
		expect(backend.commands).toEqual(commandsBefore);
		expect(runtime.getState()).toEqual({ status: 'playing' });
		expect(runtime.store.getState().parameters).toEqual({ level: 0.5 });
	});

	it('carries a value set while idle into the next start', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		const result = runtime.setParameter('level', 0.2);
		await runtime.start();

		expect(result).toEqual({ ok: true, value: 0.2 });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: { level: 0.2 } },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('carries a value set during an in-flight start into that start', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		// Do not await: the set has to land while the runtime is suspended on
		// backend.resume(), which is the window a start that read its values too
		// early would drop.
		const starting = runtime.start();
		const result = runtime.setParameter('level', 0.3);
		await starting;

		expect(result).toEqual({ ok: true, value: 0.3 });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: { level: 0.3 } },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('keeps a value across a stop and a restart', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		await runtime.start();
		runtime.setParameter('level', 0.9);
		runtime.stop();
		await runtime.start();

		expect(runtime.store.getState().parameters).toEqual({ level: 0.9 });
		expect(backend.commands.slice(6)).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: { level: 0.9 } },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});
});
