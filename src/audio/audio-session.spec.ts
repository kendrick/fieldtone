import { afterEach, describe, expect, it } from 'vitest';

import { needsRecordSession, requestPlaybackSession, requestRecordSession } from './audio-session';

// jsdom ships no `audioSession` at all, and Safari's is a read-only accessor, so
// a plain assignment is not available on either. Defining the property is the
// only way to stand one up, and `configurable` is what lets afterEach take it
// back away — the absent case below is the one every desktop browser runs.
//
// The stub records every write rather than only holding the current value,
// because "leaves a session that is already record-capable alone" is a claim
// about the write and not about what the session ends up on. Both spellings
// finish on `play-and-record`, and only the write count tells them apart.
function stubAudioSession(initial: AudioSessionType): { readonly writes: AudioSessionType[] } {
	const writes: AudioSessionType[] = [];
	let current = initial;
	const session: AudioSession = {
		get type(): AudioSessionType {
			return current;
		},
		set type(next: AudioSessionType) {
			writes.push(next);
			current = next;
		},
	};
	Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session });
	return { writes };
}

afterEach((): void => {
	Reflect.deleteProperty(navigator, 'audioSession');
});

describe('requestPlaybackSession', (): void => {
	it('declares playback where the browser has an audio session', (): void => {
		const { writes } = stubAudioSession('auto');

		requestPlaybackSession();

		expect(writes).toEqual(['playback']);
	});

	it('does nothing where the browser has no audio session', (): void => {
		expect(navigator.audioSession).toBeUndefined();
		expect((): void => {
			requestPlaybackSession();
		}).not.toThrow();
	});
});

describe('needsRecordSession', (): void => {
	it('is true while the session is still on playback', (): void => {
		stubAudioSession('playback');

		expect(needsRecordSession()).toBe(true);
	});

	// The path a listener takes by stopping Listening and starting it again
	// without stopping playback. Nothing switches, so nothing should fade.
	it('is false once the session is already record-capable', (): void => {
		stubAudioSession('play-and-record');

		expect(needsRecordSession()).toBe(false);
	});

	it('is false where the browser has no audio session', (): void => {
		expect(navigator.audioSession).toBeUndefined();
		expect(needsRecordSession()).toBe(false);
	});
});

describe('requestRecordSession', (): void => {
	it('switches to play-and-record where the session is on playback', (): void => {
		const { writes } = stubAudioSession('playback');

		requestRecordSession();

		expect(writes).toEqual(['play-and-record']);
	});

	it('leaves a session that is already record-capable alone', (): void => {
		const { writes } = stubAudioSession('play-and-record');

		requestRecordSession();

		expect(writes).toEqual([]);
	});

	it('does nothing where the browser has no audio session', (): void => {
		expect(navigator.audioSession).toBeUndefined();
		expect((): void => {
			requestRecordSession();
		}).not.toThrow();
	});
});
