import type { PlaybackState } from './playback-state';

import { describe, expect, it } from 'vitest';

import { createRecordingBackend } from './recording-backend';
import { createSceneRuntime, FADE_IN_SECONDS, FADE_OUT_SECONDS } from './scene-runtime';

describe('scene runtime', (): void => {
	it('starts by resuming, starting, and fading in, then reports playing', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);

		const result = await runtime.start();

		expect(result).toEqual({ ok: true });
		expect(backend.commands).toEqual([
			{ kind: 'resume' },
			{ kind: 'start' },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	it('stops a playing scene by fading out then stopping, and reports idle', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);

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
		const runtime = createSceneRuntime(backend);

		const result = runtime.stop();

		expect(result).toEqual({ ok: false, reason: 'not-playing' });
		expect(backend.commands).toEqual([]);
	});

	it('refuses a second start while already playing, and records nothing further', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);

		await runtime.start();
		const commandsAfterFirstStart = backend.commands;
		const result = await runtime.start();

		expect(result).toEqual({ ok: false, reason: 'already-playing' });
		expect(backend.commands).toEqual(commandsAfterFirstStart);
	});

	it('refuses a start that lands while another start is still in flight', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);

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
			{ kind: 'start' },
			{ kind: 'fadeIn', seconds: FADE_IN_SECONDS },
		]);
	});

	it('fails to start when resume rejects, then succeeds on a later retry', async (): Promise<void> => {
		const failingBackend = createRecordingBackend({ resume: 'fail' });
		const failingRuntime = createSceneRuntime(failingBackend);

		const failedResult = await failingRuntime.start();

		expect(failedResult).toEqual({ ok: false, reason: 'audio-unavailable' });
		expect(failingRuntime.getState()).toEqual({
			status: 'failed',
			reason: 'AudioContext is suspended rather than running',
		});

		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);
		const retryResult = await runtime.start();

		expect(retryResult).toEqual({ ok: true });
		expect(runtime.getState()).toEqual({ status: 'playing' });
	});

	it('publishes the same status through the store as getState, in order, across a start then a stop', async (): Promise<void> => {
		const backend = createRecordingBackend();
		const runtime = createSceneRuntime(backend);
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
});
