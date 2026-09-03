import type { Refused } from './listening-state';

import { describe, expect, it } from 'vitest';

import { beginOpening, completeOpening, endListening, notListening, refused } from './listening-state';

describe('listening state transitions', (): void => {
	it('walks the full round trip from not listening to listening and back', (): void => {
		const opening = beginOpening(notListening);
		expect(opening).toEqual({ status: 'opening' });

		const listening = completeOpening(opening);
		expect(listening).toEqual({ status: 'listening' });

		const stopped = endListening(listening);
		expect(stopped).toEqual({ status: 'not-listening' });
	});

	it('carries the rejection reason through onto the returned state', (): void => {
		const opening = beginOpening(notListening);

		expect(refused(opening, 'refused')).toEqual({ status: 'refused', reason: 'refused' });
		expect(refused(opening, 'no-microphone')).toEqual({ status: 'refused', reason: 'no-microphone' });
		expect(refused(opening, 'busy')).toEqual({ status: 'refused', reason: 'busy' });
		expect(refused(opening, 'unavailable')).toEqual({ status: 'refused', reason: 'unavailable' });
	});

	it('allows a retry: beginOpening accepts a refused state', (): void => {
		const noMicrophone: Refused = { status: 'refused', reason: 'no-microphone' };
		const retrying = beginOpening(noMicrophone);

		expect(retrying).toEqual({ status: 'opening' });
	});
});

// The ticket requires the four outcomes to come from the state rather than from
// a guard somebody has to remember. These directives are the only thing that
// checks that: if an edge's parameter type ever loosens enough to accept the
// calls below, `pnpm typecheck` fails because the directive becomes unnecessary.
describe('illegal transitions are compile errors', (): void => {
	it('rejects a second accept while getUserMedia is still out', (): void => {
		// @ts-expect-error beginOpening only accepts NotListening | Refused, not Opening.
		expect(beginOpening(beginOpening(notListening))).toEqual({ status: 'opening' });
	});

	it('rejects opening a microphone that is already open', (): void => {
		// @ts-expect-error beginOpening only accepts NotListening | Refused, not Listening.
		expect(beginOpening(completeOpening(beginOpening(notListening)))).toEqual({ status: 'opening' });
	});

	it('rejects completing an attempt that was never started', (): void => {
		// @ts-expect-error completeOpening only accepts Opening, not NotListening.
		expect(completeOpening(notListening)).toEqual({ status: 'listening' });
	});

	it('rejects a rejection for an attempt that was never started', (): void => {
		// @ts-expect-error refused only accepts Opening, not NotListening.
		expect(refused(notListening, 'busy')).toEqual({ status: 'refused', reason: 'busy' });
	});

	it('rejects stopping a microphone that never opened', (): void => {
		// @ts-expect-error endListening only accepts Listening, not NotListening.
		expect(endListening(notListening)).toEqual({ status: 'not-listening' });
	});
});
