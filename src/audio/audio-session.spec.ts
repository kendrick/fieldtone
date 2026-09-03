import { afterEach, describe, expect, it } from 'vitest';

import { requestPlaybackSession, requestRecordSession } from './audio-session';

// jsdom ships no `audioSession` at all, and Safari's is a read-only accessor, so
// a plain assignment is not available on either. Defining the property is the
// only way to stand one up, and `configurable` is what lets afterEach take it
// back away — the absent case below is the one every desktop browser runs.
function stubAudioSession(type: AudioSessionType): AudioSession {
	const session: AudioSession = { type };
	Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session });
	return session;
}

afterEach((): void => {
	Reflect.deleteProperty(navigator, 'audioSession');
});

describe('requestPlaybackSession', (): void => {
	it('declares playback where the browser has an audio session', (): void => {
		const session = stubAudioSession('auto');

		requestPlaybackSession();

		expect(session.type).toBe('playback');
	});

	it('does nothing where the browser has no audio session', (): void => {
		expect(navigator.audioSession).toBeUndefined();
		expect((): void => {
			requestPlaybackSession();
		}).not.toThrow();
	});
});

describe('requestRecordSession', (): void => {
	// The Bed is already playing on `playback` when the listener accepts the
	// second Invitation, so this is the switch the fade has to cover.
	it('switches to play-and-record where the browser has an audio session', (): void => {
		const session = stubAudioSession('playback');

		requestRecordSession();

		expect(session.type).toBe('play-and-record');
	});

	it('does nothing where the browser has no audio session', (): void => {
		expect(navigator.audioSession).toBeUndefined();
		expect((): void => {
			requestRecordSession();
		}).not.toThrow();
	});
});
