import type { ListeningRejectionReason } from './listening-state';
import type { PlaybackState } from './playback-state';
import type { ControlSignalDeclaration } from '@/scenes/control-signals';
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

// The runtime, not the component layer, owns the encode/decode call into
// parameter-serialization.ts: routing a decoded value through setParameter is
// what keeps the clamp and the forward-only-while-playing rule in the one place
// ADR 0004 argues for, so these cases exist to prove apply never bypasses it.
describe('scene runtime parameter links', (): void => {
	it('serializes the values at rest, then a change made after', (): void => {
		const runtime = createSceneRuntime(createRecordingBackend(), createTunableScene());

		expect(runtime.serializeParameters()).toBe('level=0.5');

		runtime.setParameter('level', 0.2);

		expect(runtime.serializeParameters()).toBe('level=0.2');
	});

	it('applies a link while playing by forwarding one setParameter per schema entry, clamped', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		await runtime.start();
		const result = runtime.applySerializedParameters('level=4');

		expect(result).toEqual({ level: 1 });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 1 }]);
		expect(runtime.store.getState().parameters).toEqual({ level: 1 });
	});

	it('applies a link while idle by carrying the value into the next start, not the backend yet', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		const result = runtime.applySerializedParameters('level=0.3');

		expect(result).toEqual({ level: 0.3 });
		expect(backend.commands).toEqual([]);

		await runtime.start();

		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: { level: 0.3 } },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('falls back to the default for an unknown key and a malformed value, and leaves playback untouched', (): void => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTunableScene());

		const result = runtime.applySerializedParameters('level=not-a-number&reverb=0.4');

		expect(result).toEqual({ level: 0.5 });
		expect(runtime.getState()).toEqual({ status: 'idle' });
		expect(backend.commands).toEqual([]);
	});

	it('clamps an out-of-range value from the query string to the schema bound', (): void => {
		const runtime = createSceneRuntime(createRecordingBackend(), createTunableScene());

		const result = runtime.applySerializedParameters('level=4');

		expect(result).toEqual({ level: 1 });
	});
});

// A Control Signal moves a parameter away from where the listener set it without
// changing their setting, so the listener's values and the signal's live in
// separate store fields and meet only where a value is handed to the backend.
// Every case here is a check on that seam: what the backend hears against what
// the listener still owns.
describe('scene runtime control signals', (): void => {
	// The signal rests at 0 and reaches half the parameter's range. Both numbers
	// are exact in binary, so a combined value asserts as 0.75 rather than as
	// 0.7500000000000001. A test that fails on float noise teaches nothing about
	// modulation.
	function createModulatedScene(
		signal: ControlSignalDeclaration = { parameter: 'level', default: 0, reach: 0.5 },
	): Scene {
		return createSilentScene(
			'silent',
			{ level: { kind: 'number', label: 'Level', min: 0, max: 1, default: 0.5 } },
			{ loudness: signal },
		);
	}

	it('forwards one combined value while playing, and nothing else', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		expect(runtime.store.getState().signals).toEqual({ loudness: 0 });

		await runtime.start();
		backend.emitSignal('loudness', 0.5);

		// One setParameter and no more: a rebuilt graph would show up here as a stop
		// and a start, and the listener would hear that as a gap.
		expect(backend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 0.75 }]);
		expect(runtime.store.getState().signals).toEqual({ loudness: 0.5 });
	});

	// The acceptance criterion the whole two-field split exists for: copying a link
	// during a loud passage must share the Scene the listener chose, not the one
	// the room was making at that instant.
	it('leaves the listener values and the share link untouched', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		await runtime.start();
		backend.emitSignal('loudness', 1);

		expect(runtime.store.getState().parameters).toEqual({ level: 0.5 });
		expect(runtime.serializeParameters()).toBe('level=0.5');
	});

	it('stores the listener value but forwards the combined one when a control moves under an active signal', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		await runtime.start();
		backend.emitSignal('loudness', 0.5);
		const result = runtime.setParameter('level', 0.25);

		// The result is what the slider settles on, so it has to be the listener's
		// own value; the offset is not theirs to inherit.
		expect(result).toEqual({ ok: true, value: 0.25 });
		expect(runtime.store.getState().parameters).toEqual({ level: 0.25 });
		expect(backend.commands.slice(4)).toEqual([{ kind: 'setParameter', name: 'level', value: 0.5 }]);
	});

	it('clamps the combined value to the parameter bounds', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		runtime.setParameter('level', 0.9);
		await runtime.start();
		backend.emitSignal('loudness', 1);

		expect(backend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 1 }]);

		// A signal resting at full scale drives the parameter downward, which is the
		// only way to reach the floor from this direction.
		const fallingBackend = createRecordingBackend();
		const fallingRuntime = createSceneRuntime(
			fallingBackend,
			createModulatedScene({ parameter: 'level', default: 1, reach: 0.5 }),
		);

		fallingRuntime.setParameter('level', 0.2);
		await fallingRuntime.start();
		fallingBackend.emitSignal('loudness', 0);

		expect(fallingBackend.commands.slice(3)).toEqual([{ kind: 'setParameter', name: 'level', value: 0 }]);
	});

	// Listening hands over a raw reading, and a bad one is not hypothetical: an
	// averaged empty analysis window is NaN, and a NaN reaching a Web Audio param
	// silences that node for the rest of the session with nothing to trace.
	it('clamps a reading outside 0..1 before combining it', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		runtime.setParameter('level', 0.25);
		await runtime.start();
		backend.emitSignal('loudness', 4);
		backend.emitSignal('loudness', -3);
		backend.emitSignal('loudness', Number.NaN);

		expect(backend.commands.slice(3)).toEqual([
			{ kind: 'setParameter', name: 'level', value: 0.75 },
			{ kind: 'setParameter', name: 'level', value: 0.25 },
			{ kind: 'setParameter', name: 'level', value: 0.25 },
		]);
		expect(runtime.store.getState().signals).toEqual({ loudness: 0 });
	});

	// Same rule the listener's own values follow: held in every playback state,
	// forwarded only where a graph exists to hear them.
	it('holds a signal arriving while idle and builds the next graph at the combined value', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		backend.emitSignal('loudness', 0.5);

		expect(backend.commands).toEqual([]);
		expect(runtime.store.getState().signals).toEqual({ loudness: 0.5 });

		await runtime.start();

		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: { level: 0.75 } },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('ignores a signal name the scene never declared', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createModulatedScene());

		await runtime.start();
		const stateBefore = runtime.store.getState();
		const commandsBefore = backend.commands;
		backend.emitSignal('brightness', 0.9);

		// Identity, not equality: a store write that happened to land the same
		// values would still be a re-render for every subscriber.
		expect(runtime.store.getState()).toBe(stateBefore);
		expect(backend.commands).toEqual(commandsBefore);
	});

	// The guard for a Scene that derives nothing from live input. Every suite
	// above runs on one, so they carry the real weight here; what this case adds
	// is the seed the store starts at, which none of them reads.
	it('leaves a scene with no control signals exactly as it was', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		expect(runtime.store.getState().signals).toEqual({});

		await runtime.start();
		backend.emitSignal('loudness', 1);

		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start', scene: 'silent', parameters: {} },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	// Two signals on one parameter is the case the combining rule exists for, and
	// nothing shipped exercises it: Ember declares one. These two schemas are the
	// same pair of signals in the opposite declaration order, driven identically.
	// Before offsets were summed the result differed between them, because the
	// first offset saturated the clamp and the second had nothing left to pull
	// back down from.
	function createTwoSignalScene(reversed: boolean): Scene {
		const lift: ControlSignalDeclaration = { parameter: 'level', default: 0, reach: 1 };
		const drop: ControlSignalDeclaration = { parameter: 'level', default: 0, reach: -0.5 };
		return createSilentScene(
			'silent',
			{ level: { kind: 'number', label: 'Level', min: 0, max: 1, default: 0.5 } },
			reversed ? { drop, lift } : { lift, drop },
		);
	}

	async function driveBothSignals(reversed: boolean): Promise<number | undefined> {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, createTwoSignalScene(reversed));

		await runtime.start();
		backend.emitSignal('lift', 1);
		backend.emitSignal('drop', 1);

		return backend.commands.filter(command => command.kind === 'setParameter').at(-1)?.value;
	}

	it('sums the offsets of two signals on one parameter, whatever order they are declared in', async (): Promise<void> => {
		// 0.5 + 1 - 0.5 = 1.0, which the clamp leaves alone at the parameter's max.
		expect(await driveBothSignals(false)).toBe(1);
		expect(await driveBothSignals(true)).toBe(1);
	});

	it('holds a summed overshoot at the ceiling and leaves the listener value alone', async (): Promise<void> => {
		const backend = createRecordingBackend();
		// Each signal alone already lifts past the ceiling, so the sum is far past it.
		// The parameter still lands exactly on max, and the store still holds what the
		// listener set, which is the separation the whole modulation layer exists for.
		const runtime = createSceneRuntime(backend, createSilentScene(
			'silent',
			{ level: { kind: 'number', label: 'Level', min: 0, max: 1, default: 0.5 } },
			{
				one: { parameter: 'level', default: 0, reach: 4 },
				two: { parameter: 'level', default: 0, reach: 4 },
			},
		));

		await runtime.start();
		backend.emitSignal('one', 1);
		backend.emitSignal('two', 1);

		expect(backend.commands.filter(command => command.kind === 'setParameter').at(-1)?.value).toBe(1);
		expect(runtime.store.getState().parameters).toEqual({ level: 0.5 });
	});
});

// Listening is the second Invitation, and every case here turns on the rule that
// it never disturbs the first: whatever the microphone answers, the Bed is still
// playing afterwards. A refusal that silenced the Bed would make the Invitation a
// wall, which is the one thing CONTEXT.md says an Invitation is never.
describe('scene runtime listening', (): void => {
	const rejectionReasons: ListeningRejectionReason[] = ['refused', 'no-microphone', 'busy', 'unavailable'];

	it('opens the microphone while the bed keeps playing', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const result = await runtime.startListening();

		expect(result).toEqual({ ok: true });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'startListening' }]);
		expect(runtime.store.getState().listening).toEqual({ status: 'listening' });
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	// Everything after the three start commands is asserted whole, so a fadeOut or
	// a stop sneaking in on a refusal fails the case rather than hiding in a slice.
	it.each(rejectionReasons)('keeps the bed playing when the microphone answers %s', async (reason): Promise<void> => {
		const backend = createRecordingBackend({ listening: reason });
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const result = await runtime.startListening();

		expect(result).toEqual({ ok: false, reason });
		expect(runtime.store.getState().listening).toEqual({ status: 'refused', reason });
		expect(runtime.getState()).toEqual({ status: 'playing' });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'startListening' }]);
	});

	// The fake used to make every outcome permanent, which meant nothing could
	// prove a second press reaches the microphone after a transient refusal. A
	// sequence is what lets a test stand in for the microphone getting plugged in
	// between one press and the next, the way `worthAnotherPress` in the
	// Invitation promises the listener it will.
	it('drives a transient rejection then a grant across two presses, from one sequence', async (): Promise<void> => {
		const backend = createRecordingBackend({ listening: ['no-microphone', 'succeed'] });
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const firstPress = await runtime.startListening();
		const secondPress = await runtime.startListening();

		expect(firstPress).toEqual({ ok: false, reason: 'no-microphone' });
		expect(secondPress).toEqual({ ok: true });
		expect(runtime.store.getState().listening).toEqual({ status: 'listening' });
	});

	// The seam promises a ListeningRejection and nothing else, but a promise is not
	// a guarantee: an adapter bug throws a TypeError like anything else does. The
	// listener still needs a message, and `unavailable` is the one that does not
	// blame them for a refusal they never made.
	it('treats a throw that is not a ListeningRejection as unavailable', async (): Promise<void> => {
		const backend = createRecordingBackend();
		// Spread rather than a hand-rolled fake, so every other command still lands
		// in the recorder. The copied `commands` snapshot goes stale, which is why
		// the assertions read it off `backend` instead.
		const runtime = createSceneRuntime({
			...backend,
			startListening: (): Promise<void> => Promise.reject(new TypeError('getUserMedia is not a function')),
		}, silentScene);

		await runtime.start();
		const result = await runtime.startListening();

		expect(result).toEqual({ ok: false, reason: 'unavailable' });
		expect(runtime.store.getState().listening).toEqual({ status: 'refused', reason: 'unavailable' });
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	it('refuses to listen before anything is playing, and touches the backend not at all', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		const result = await runtime.startListening();

		expect(result).toEqual({ ok: false, reason: 'not-playing' });
		expect(backend.commands).toEqual([]);
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
	});

	it('refuses a second accept that lands while the first is still opening', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		// Fire both before awaiting either, the way the in-flight start case does:
		// the second call has to land while the first is suspended on
		// backend.startListening(), which is the only window `already-opening` covers.
		const first = runtime.startListening();
		const second = runtime.startListening();

		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toEqual({ ok: true });
		expect(secondResult).toEqual({ ok: false, reason: 'already-opening' });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'startListening' }]);
	});

	it('refuses an accept that arrives once the microphone is already open', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		await runtime.startListening();
		const result = await runtime.startListening();

		expect(result).toEqual({ ok: false, reason: 'already-listening' });
		expect(backend.commands.slice(3)).toEqual([{ kind: 'startListening' }]);
	});

	it('releases the microphone and leaves the bed playing', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		await runtime.startListening();
		const result = runtime.stopListening();

		expect(result).toEqual({ ok: true });
		expect(backend.commands.slice(4)).toEqual([{ kind: 'stopListening' }]);
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	it('refuses to release a microphone that was never opened', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const result = runtime.stopListening();

		expect(result).toEqual({ ok: false, reason: 'not-listening' });
		expect(backend.commands.slice(3)).toEqual([]);
	});

	// Order is the assertion: the microphone closes first, so no window exists
	// where a listener sees a silent Bed and a live recording indicator.
	it('closes the microphone before fading the bed out', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		await runtime.startListening();
		const result = runtime.stop();

		expect(result).toEqual({ ok: true });
		expect(backend.commands.slice(4)).toEqual([
			{ kind: 'stopListening' },
			{ kind: 'fadeOut', seconds: FADE_OUT_SECONDS },
			{ kind: 'stop', afterSeconds: FADE_OUT_SECONDS },
		]);
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
	});

	// The gap `opening` names is wide enough for the whole session to end inside
	// it: a listener presses accept, leaves the browser's prompt sitting there,
	// presses stop, and grants permission afterwards. The stop leaves through
	// `opening` without waiting, so the grant is the last thing to arrive and it
	// is the only place left to close the microphone.
	it('releases a microphone granted after stop was pressed mid-opening', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		// Nothing awaited between these two, the way the in-flight accept case does
		// it: the stop has to land while startListening is still suspended on the
		// backend, which is the only window this case covers.
		const accepting = runtime.startListening();
		const stopResult = runtime.stop();
		const result = await accepting;

		expect(stopResult).toEqual({ ok: true });
		expect(result).toEqual({ ok: false, reason: 'not-playing' });
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
		expect(runtime.getState()).toEqual({ status: 'idle' });
		// stopListening lands last because it cannot land any earlier: there was no
		// microphone to close until the grant arrived. What matters is that it lands
		// at all, and that the recording indicator goes out with it.
		expect(backend.commands.slice(3)).toEqual([
			{ kind: 'startListening' },
			{ kind: 'fadeOut', seconds: FADE_OUT_SECONDS },
			{ kind: 'stop', afterSeconds: FADE_OUT_SECONDS },
			{ kind: 'stopListening' },
		]);
	});

	// A refusal explains a microphone the listener asked for while the Bed was
	// playing. Stop ends that session, so the explanation goes with it: leaving
	// `refused` behind keeps the Invitation on screen over a stopped Bed, where
	// its button can only hit the not-playing guard and do nothing.
	it('clears a refusal when the Bed stops, so no explanation outlives it', async (): Promise<void> => {
		const backend = createRecordingBackend({ listening: 'no-microphone' });
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		await runtime.startListening();
		expect(runtime.store.getState().listening).toEqual({ status: 'refused', reason: 'no-microphone' });

		runtime.stop();

		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
	});

	// The same race with the opposite answer. Nothing needs closing here, but the
	// Invitation must not surface a refusal either: the listener stopped the app,
	// and a message about the microphone on a stopped Bed answers a question they
	// stopped asking.
	it('records no refusal when the browser says no after stop was pressed mid-opening', async (): Promise<void> => {
		const backend = createRecordingBackend({ listening: 'refused' });
		const runtime = createSceneRuntime(backend, silentScene);

		await runtime.start();
		const accepting = runtime.startListening();
		const stopResult = runtime.stop();
		const result = await accepting;

		expect(stopResult).toEqual({ ok: true });
		expect(result).toEqual({ ok: false, reason: 'not-playing' });
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
		expect(runtime.getState()).toEqual({ status: 'idle' });
		expect(backend.commands.slice(3)).toEqual([
			{ kind: 'startListening' },
			{ kind: 'fadeOut', seconds: FADE_OUT_SECONDS },
			{ kind: 'stop', afterSeconds: FADE_OUT_SECONDS },
			{ kind: 'stopListening' },
		]);
	});

	// The case the playback status cannot catch on its own. Stop, then play again,
	// and the runtime is back to `playing` while the first prompt is still up: a
	// grant landing now would open the microphone in a session nobody accepted it
	// in, with the Invitation still offering the button that would have asked.
	// Holding the grant by hand is the only way to reach it, because the fake
	// otherwise resolves before the second press can land.
	it('abandons a grant that arrives after the listener stopped and started again', async (): Promise<void> => {
		const backend = createRecordingBackend();
		let grantMicrophone: () => void = (): void => {};
		const prompt = new Promise<void>((resolve): void => {
			grantMicrophone = resolve;
		});
		// Spread rather than a hand-rolled fake, so every command except the held
		// one still reaches the recorder.
		const runtime = createSceneRuntime({ ...backend, startListening: (): Promise<void> => prompt }, silentScene);

		await runtime.start();
		const accepting = runtime.startListening();
		runtime.stop();
		await runtime.start();
		expect(runtime.getState()).toEqual({ status: 'playing' });

		grantMicrophone();
		const result = await accepting;

		expect(result).toEqual({ ok: false, reason: 'session-ended' });
		expect(runtime.store.getState().listening).toEqual({ status: 'not-listening' });
		// Still playing: the second session is untouched by an attempt that belonged
		// to the first, which is the whole point of turning the grant away here.
		expect(runtime.getState()).toEqual({ status: 'playing' });
		// The microphone the browser just handed over is closed rather than left
		// live behind a session that never asked for it.
		expect(backend.commands.at(-1)).toEqual({ kind: 'stopListening' });
	});
});
