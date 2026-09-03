import type { ListeningRejectionReason } from './listening-state';

// `getUserMedia` rejects with a `DOMException`, but jsdom's `DOMException` and
// the browser's are different constructors from different realms, so an
// `instanceof` check would fail on a perfectly ordinary rejection. The `name`
// string survives that trip intact, so match on it instead.
export function reasonForCaptureError(error: unknown): ListeningRejectionReason {
	switch (errorName(error)) {
		case 'NotAllowedError':
		case 'SecurityError':
			return 'refused';
		case 'NotFoundError':
			return 'no-microphone';
		// Not no-microphone: a device answered and was rejected only because it
		// could not meet a constraint this seam asked for. `no-microphone` tells
		// the listener to plug one in, which is wrong when one is already there.
		//
		// iOS raises InvalidStateError for the same reason: `getUserMedia` rejects
		// outright while the audio session is still `playback`. The seam now asks
		// for `play-and-record` before it asks for a microphone, so reaching this
		// case means the switch did not take—a WebKit that refused it, or one that
		// accepted the assignment without the session following. `unavailable`
		// reads as "not on this device" rather than blaming a microphone the
		// switch never reached.
		case 'OverconstrainedError':
		case 'InvalidStateError':
			return 'unavailable';
		case 'NotReadableError':
		case 'AbortError':
			return 'busy';
		default:
			// Covers a browser with no `mediaDevices` at all and any name this
			// mapping doesn't recognize. It is the one message that tells the
			// listener to try another browser rather than to try again.
			return 'unavailable';
	}
}

function errorName(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('name' in error)) {
		return undefined;
	}

	// The `in` check above only proves a `name` property exists on an
	// otherwise-untyped object; the cast just lets us read it, and the
	// `typeof` guard below is what actually decides whether it's usable.
	const { name } = error as { name: unknown };
	return typeof name === 'string' ? name : undefined;
}
