import type { Refused, Suspended } from './listening-state';

import { describe, expect, it } from 'vitest';

import { abandonOpening, beginOpening, completeOpening, dismissRefusal, dismissSuspension, endListening, notListening, refused, suspendListening } from './listening-state';

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

	it('leaves a refusal for a stopped session', (): void => {
		const busy: Refused = { status: 'refused', reason: 'busy' };

		expect(dismissRefusal(busy)).toEqual({ status: 'not-listening' });
	});

	it('allows a retry: beginOpening accepts a refused state', (): void => {
		const noMicrophone: Refused = { status: 'refused', reason: 'no-microphone' };
		const retrying = beginOpening(noMicrophone);

		expect(retrying).toEqual({ status: 'opening' });
	});

	// The answer arrived, but too late to be worth anything. Back to where the
	// listener started, with no refusal recorded against them.
	it('abandons an attempt that outlived the reason for it', (): void => {
		const opening = beginOpening(notListening);

		expect(abandonOpening(opening)).toEqual({ status: 'not-listening' });
	});

	it('suspends an open microphone and reopens it from there', (): void => {
		const listening = completeOpening(beginOpening(notListening));
		const suspended = suspendListening(listening);
		expect(suspended).toEqual({ status: 'suspended' });

		expect(beginOpening(suspended)).toEqual({ status: 'opening' });
	});

	it('suspends an attempt still out at the prompt', (): void => {
		const opening = beginOpening(notListening);

		expect(suspendListening(opening)).toEqual({ status: 'suspended' });
	});

	it('leaves a suspension for a stopped session', (): void => {
		const suspended: Suspended = { status: 'suspended' };

		expect(dismissSuspension(suspended)).toEqual({ status: 'not-listening' });
	});
});

// The ticket requires the four outcomes to come from the state rather than from
// a guard somebody has to remember. These directives are the only thing that
// checks that: if an edge's parameter type ever loosens enough to accept the
// calls below, `pnpm typecheck` fails because the directive becomes unnecessary.
describe('illegal transitions are compile errors', (): void => {
	it('rejects a second accept while getUserMedia is still out', (): void => {
		// @ts-expect-error beginOpening only accepts NotListening | Refused | Suspended, not Opening.
		expect(beginOpening(beginOpening(notListening))).toEqual({ status: 'opening' });
	});

	it('rejects opening a microphone that is already open', (): void => {
		// @ts-expect-error beginOpening only accepts NotListening | Refused | Suspended, not Listening.
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

	// Abandoning an open microphone would drop the stream on the floor: nothing
	// left holding it, and no `stopListening` on the way past. `endListening` is
	// the edge that closes one, and the types are what keep the two apart.
	it('rejects abandoning a microphone that is already open', (): void => {
		// @ts-expect-error abandonOpening only accepts Opening, not Listening.
		expect(abandonOpening(completeOpening(beginOpening(notListening)))).toEqual({ status: 'not-listening' });
	});

	it('rejects suspending a microphone that was never opened', (): void => {
		// @ts-expect-error suspendListening only accepts Listening | Opening, not NotListening.
		expect(suspendListening(notListening)).toEqual({ status: 'suspended' });
	});

	it('rejects suspending a refusal', (): void => {
		const busy = refused(beginOpening(notListening), 'busy');

		// @ts-expect-error suspendListening only accepts Listening | Opening, not Refused.
		expect(suspendListening(busy)).toEqual({ status: 'suspended' });
	});

	it('rejects dismissing a suspension that was never suspended', (): void => {
		const listening = completeOpening(beginOpening(notListening));

		// @ts-expect-error dismissSuspension only accepts Suspended, not Listening.
		expect(dismissSuspension(listening)).toEqual({ status: 'not-listening' });
	});

	// A suspended session has no open microphone left for `endListening` to
	// close: `suspendListening` already released it, and treating a suspension
	// as though it were still `Listening` would double-release a track that
	// `dismissSuspension` is the edge meant to walk back from.
	it('rejects stopping a microphone that is only suspended', (): void => {
		const suspended = suspendListening(completeOpening(beginOpening(notListening)));

		// @ts-expect-error endListening only accepts Listening, not Suspended.
		expect(endListening(suspended)).toEqual({ status: 'not-listening' });
	});

	it('rejects completing a suspension as though it were an open attempt', (): void => {
		const suspended = suspendListening(completeOpening(beginOpening(notListening)));

		// @ts-expect-error completeOpening only accepts Opening, not Suspended.
		expect(completeOpening(suspended)).toEqual({ status: 'listening' });
	});
});
