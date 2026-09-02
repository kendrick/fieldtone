import type { Failed } from './playback-state';

import { describe, expect, it } from 'vitest';

import { beginStart, completeStart, failStart, idle, stop } from './playback-state';

describe('playback state transitions', (): void => {
	it('walks the full round trip from idle to playing and back', (): void => {
		const starting = beginStart(idle);
		expect(starting).toEqual({ status: 'starting' });

		const playing = completeStart(starting);
		expect(playing).toEqual({ status: 'playing' });

		const stopped = stop(playing);
		expect(stopped).toEqual({ status: 'idle' });
	});

	it('carries the failure reason through onto the returned state', (): void => {
		const starting = beginStart(idle);
		const failed = failStart(starting, 'audio context suspended');

		expect(failed).toEqual({ status: 'failed', reason: 'audio context suspended' });
	});

	it('allows a retry: beginStart accepts a failed state', (): void => {
		const failed: Failed = { status: 'failed', reason: 'audio context suspended' };
		const retrying = beginStart(failed);

		expect(retrying).toEqual({ status: 'starting' });
	});
});

// The ticket requires a double start and a stop before start to be unrepresentable
// at compile time rather than merely guarded at runtime. These directives are the
// only thing that checks that claim: if a transition's parameter type ever loosens
// enough to accept these calls, `pnpm typecheck` fails because the directive below
// becomes unnecessary.
describe('illegal transitions are compile errors', (): void => {
	it('rejects stopping a state that never started', (): void => {
		// @ts-expect-error stop only accepts Playing, not Idle.
		expect(stop(idle)).toEqual({ status: 'idle' });
	});

	it('rejects starting a state that is already starting', (): void => {
		// @ts-expect-error beginStart only accepts Idle | Failed, not Starting.
		expect(beginStart(beginStart(idle))).toEqual({ status: 'starting' });
	});
});
