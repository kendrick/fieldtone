import { expect, test } from '@playwright/test';
import { isRealtimeAudioAvailable } from './probe';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// Desktop Chromium has no Audio Session API at all, which is exactly the gap
// this suite exists to close: without a stub, `needsRecordSession()` always
// sees `undefined` and the switch this ticket is about never runs here. A
// plain data property, not the write-recording accessor
// `src/audio/audio-session.spec.ts` uses: an assignment lands on it, `type`
// reads back whatever was last written, and nothing else happens. That is
// exactly the branch coverage this suite needs — the fake covers which branch
// this repo takes, and the phone stays responsible for what iOS actually does
// with it.
function stubAudioSession(): void {
	Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
}

// See listening.spec.ts for why both flags are needed and why launchOptions
// has to be set at file scope.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test.describe('audio session', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines are skipped rather than given a getUserMedia
	// call that hangs. See listening.spec.ts for the same guard.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('pressing Play declares the session for playback', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(stubAudioSession);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();

		// The switch this ticket is about rides the audio clock, and a machine
		// with no realtime audio freezes that clock at the first block. Skip
		// rather than hang: AC 8 asks for state assertions only, never a
		// realtime meter, and this guard is what keeps every remaining case
		// deterministic instead of stuck on an await that never resolves.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'the switch rides the audio clock and this machine has no realtime audio');

		expect(await page.evaluate(() => navigator.audioSession?.type)).toBe('playback');
	});

	test('a returning listener who grants the microphone moves the session to play-and-record', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(stubAudioSession);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'the switch rides the audio clock and this machine has no realtime audio');

		await page.getByRole('button', { name: 'Let it listen' }).click();

		// Scoped to the floor for the reason listening.spec.ts gives: the share
		// control mounts a second status region and a bare getByRole('status')
		// is ambiguous.
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');
		expect(await page.evaluate(() => navigator.audioSession?.type)).toBe('play-and-record');
	});

	// AC 9. The window to land this in is SESSION_FADE_SECONDS, 0.3s of audio-
	// clock time, so the two clicks are issued back to back with no assertion
	// between them: awaiting one before the other risks missing the window and
	// passing for the wrong reason, a grant that already completed.
	test('Stop pressed immediately after accepting leaves the session on playback', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(stubAudioSession);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'the switch rides the audio clock and this machine has no realtime audio');

		const acceptButton = page.getByRole('button', { name: 'Let it listen' });
		// `exact: true` because "Stop listening" contains "Stop" and Playwright's
		// default name match is a substring: once a grant completes fast enough
		// for that button to render, a fuzzy match here resolves to two elements
		// instead of picking the transport toggle.
		const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
		await acceptButton.click();
		await stopButton.click();

		// Stopping playback drops `offered` to false regardless of which side of
		// the fade the click landed on, which is what makes this half of the
		// assertion deterministic even though the type below is not: the runtime's
		// own orphan recheck unmounts the floor whether or not the backend's
		// session switch had already completed.
		await expect(page.locator('.invitation-floor')).toBeHidden();
		expect(await page.evaluate(() => navigator.audioSession?.type)).toBe('playback');
	});

	test('Stop then Play after a grant returns the session to playback', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(stubAudioSession);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'the switch rides the audio clock and this machine has no realtime audio');

		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');
		expect(await page.evaluate(() => navigator.audioSession?.type)).toBe('play-and-record');

		// resume() sets the session back to playback on every run, which is what
		// this asserts: a fresh Bed after a grant does not inherit the previous
		// press's play-and-record session. `exact: true` for the reason above:
		// the grant is already settled here, so "Stop listening" is on screen too.
		await page.getByRole('button', { name: 'Stop', exact: true }).click();
		await page.getByRole('button', { name: 'Play' }).click();

		expect(await page.evaluate(() => navigator.audioSession?.type)).toBe('playback');
	});
});
