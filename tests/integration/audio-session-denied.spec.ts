import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, isRealtimeAudioAvailable, readLevel } from './probe';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// See audio-session.spec.ts for why this is a plain data property rather than
// the write-recording accessor `src/audio/audio-session.spec.ts` uses.
function stubAudioSession(): void {
	Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
}

// A separate file for the reason listening-refused.spec.ts gives:
// `--use-fake-ui-for-media-stream=deny` is the flag that produces a real
// NotAllowedError, and launchOptions cannot vary per describe group.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream=deny'] } });

test.describe('audio session denied', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('a denial leaves the session on playback and the Bed audible', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(stubAudioSession);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();

		// The rejection path fades the Bed down and back across the same
		// audio-clock await the grant path does, so it needs the same guard: a
		// machine with no realtime audio would freeze on it rather than fail.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'the switch rides the audio clock and this machine has no realtime audio');

		await page.getByRole('button', { name: 'Let it listen' }).click();

		// Scoped for the reason listening.spec.ts and listening-refused.spec.ts
		// give: the share control has a status region too, and only the floor's
		// belongs to the Invitation.
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText(
			'Your browser is holding on to that answer, so FieldTone cannot ask again. Change the microphone permission for this site in your browser settings.',
		);

		// Nothing on today's rejection path restores `playback` after the switch
		// to `play-and-record` — this is the failing half of the ticket, and it
		// is expected to fail against unmodified src/. Polled rather than read
		// once: the fix this failure is waiting on runs the restore on its own
		// audio-clock timeout, well after the status text above has already
		// settled.
		await expect.poll(() => page.evaluate(() => navigator.audioSession?.type)).toBe('playback');

		// The live envelope, not an offline render. `renderBedRms` builds a fresh
		// voice in an OfflineAudioContext and fades it in unconditionally, so it
		// answers "this Scene still makes a sound" and cannot see where the playing
		// Bed's gain actually sits: delete the return scheduled above and it stays
		// green. Measured, not argued — that mutation was run, and only this poll
		// caught it. AC 3 is a claim about the level the listener is left at, so the
		// meter is the only probe that speaks to it.
		//
		// This is the one assertion here that rides the realtime clock, which the
		// `isRealtimeAudioAvailable` guard above already covers: a machine with no
		// audio device skips rather than reading a meter frozen at zero. Same shape
		// as audible-output.spec.ts, which polls this probe behind the same guard.
		await expect.poll(() => page.evaluate(readLevel), { timeout: 5_000 }).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});
});
