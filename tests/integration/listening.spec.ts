import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, isRealtimeAudioAvailable, readSignal, renderBedRms } from './probe';

// The localStorage flag listen-invitation.tsx writes once the floor's
// animation ends. Pre-setting it here is what a returning listener's browser
// would already hold, and it is the only way to skip the 20s floor without
// waiting it out for real.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// Test-only, installed by the worklet-failure case below. It lives here rather
// than on the probe because production has no reason to hand out a microphone
// track, and the probe is the app's surface rather than the suite's.
declare global {
	interface Window {
		__grantedTracks?: MediaStreamTrack[];
		__releaseGrant?: () => void;
	}
}

// Both flags, not just the device one. The fake device alone leaves headless
// Chromium throwing NotSupportedError from getUserMedia, which this app maps to
// `unavailable` — so a suite missing the second flag tests the try-another-browser
// path while claiming to test a grant. The UI flag is what answers the permission
// prompt, and it answers yes unconditionally, which is why a refusal cannot live
// in this file and has its own spec beside it.
//
// File scope rather than inside the describe, because overriding launchOptions
// forces a new worker and Playwright refuses to do that for one describe group.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test.describe('listen invitation', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines cannot exercise a grant at all and are skipped
	// rather than given a getUserMedia call that hangs.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('stays hidden for the first Invitation, which proves the floor is real', async ({ page }): Promise<void> => {
		await page.goto('./');
		await page.getByRole('button', { name: 'Play' }).click();

		// No flag pre-set here, deliberately: this is the one case that has to sit
		// through the real floor. 2s is cheap proof of "not on load" without paying
		// for the whole 20s wait in every run.
		const invitation = page.getByRole('button', { name: 'Let it listen' });
		await expect(invitation).toBeHidden();
		await page.waitForTimeout(2_000);
		await expect(invitation).toBeHidden();
	});

	test('a returning listener who grants the microphone hears Listening start while the Bed keeps playing', async ({ page }): Promise<void> => {
		// Runs before any app script, which is what zeroes the floor: the
		// component reads this flag on mount, not on click.
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();

		// Scoped to the floor because share-control.tsx mounts a live region of its
		// own, permanently and empty so that a first message is announced. Both are
		// status roles, so a bare getByRole('status') resolves to two elements the
		// moment the Invitation is revealed and strict mode refuses to choose.
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');

		// Rendered offline so the assertion needs no sound card, and it drives
		// the same graph playback uses, so a Bed silenced by the microphone
		// grant would show up here.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});

	test('has no accessibility violations once the Invitation is visible', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Let it listen' })).toBeVisible();

		// Wait out the reveal before scanning. `toBeVisible` returns the moment
		// `visibility` flips, while the fade still has most of its 600ms left, and
		// axe reads the composited color: it measured 2.35:1 against a button
		// sitting at opacity 0.135 and called it a contrast violation. What a
		// listener actually reads is the settled state.
		await expect(page.locator('.invitation-floor')).toHaveCSS('opacity', '1');

		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations).toEqual([]);
	});

	test('the worklet feeds a real loudness signal while the Bed keeps playing', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();

		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');

		// A frozen audio clock (headless CI with no sound card) never runs the
		// worklet's process() at all, so the signal would sit at 0 forever. That
		// is the environment failing rather than the worklet, and it has to skip
		// rather than hang the poll below or fail on a false negative.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'no realtime audio clock available');

		// Chromium's fake capture device emits a beeping tone, which is the
		// sound the worklet's blockRms/loudnessFromRms chain is measuring here.
		await expect.poll(() => page.evaluate(readSignal, 'loudness')).toBeGreaterThan(0);

		// Rendered offline, same as the grant case above: proves the Bed is
		// still audible with the worklet node wired into the graph, not that
		// its RMS tracks the signal. Ember redraws its voicing per render, so
		// the two numbers have no reason to agree from one call to the next.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});

	// Service worker off for both of these. #50's worker proxies every same-origin
	// GET, and page.route never sees a request the worker made rather than the page,
	// so the abort and the hang below both land nowhere: the module loads, Listening
	// starts, and one test fails while its twin passes having stalled nothing.
	// Blocking the worker puts the request back on the wire where the route can reach
	// it. What is under test is unchanged either way, because a module that never
	// arrives rejects addModule wherever the request was made.
	test.describe('with the worklet module unreachable', () => {
		test.use({ serviceWorkers: 'block' });

		test('hands the microphone back when the worklet module never arrives', async ({ page }): Promise<void> => {
			await page.addInitScript((key: string) => {
				window.localStorage.setItem(key, 'offered');
			}, OFFERED_KEY);

			// Every track getUserMedia hands out, kept where the assertion can reach it.
			// The backend holds the stream in a closure and the probe deliberately does
			// not expose it, so a page has no other way to ask whether the microphone
			// was actually released rather than merely reported as failed.
			await page.addInitScript(() => {
				const granted: MediaStreamTrack[] = [];
				window.__grantedTracks = granted;
				const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
				navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
					const stream = await open(constraints);
					granted.push(...stream.getTracks());
					return stream;
				};
			});

			// A deploy that shipped the page without the worklet, or a network that drops
			// the request. Either way the grant has already happened by the time the load
			// fails, which is the case Principle I turns on.
			await page.route('**/worklets/level-listening.js', route => route.abort());
			await page.goto('./');

			await page.getByRole('button', { name: 'Play' }).click();
			await page.getByRole('button', { name: 'Let it listen' }).click();

			await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText(
				'This browser cannot open a microphone.',
			);

			// The message is the easy half. Nothing captured may outlive the session that
			// captured it, so a failure after the grant still has to stop the track. Left
			// running it lights the recording indicator underneath a message saying the
			// microphone never opened, and no later press releases it: the runtime reaches
			// `refused`, where its own stopListening guard returns before the backend.
			await expect
				.poll(() => page.evaluate(() => window.__grantedTracks?.every(track => track.readyState === 'ended') ?? false))
				.toBe(true);
		});

		// The stalled twin of the case above. A request that hangs rather than fails
		// never reaches the catch in tone-backend.ts, so the microphone is released
		// here by Stop reaching the backend during `opening` instead.
		test('hands the microphone back when the module load never settles', async ({ page }): Promise<void> => {
			await page.addInitScript((key: string) => {
				window.localStorage.setItem(key, 'offered');
			}, OFFERED_KEY);
			await page.addInitScript(() => {
				const granted: MediaStreamTrack[] = [];
				window.__grantedTracks = granted;
				const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
				navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
					const stream = await open(constraints);
					granted.push(...stream.getTracks());
					return stream;
				};
			});
			// Never fulfilled, never aborted. The request simply hangs.
			await page.route('**/worklets/level-listening.js', () => {});
			await page.goto('./');

			await page.getByRole('button', { name: 'Play' }).click();
			await page.getByRole('button', { name: 'Let it listen' }).click();
			await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText(
				'Asking your browser for the microphone.',
			);
			await page.getByRole('button', { name: 'Stop' }).click();

			await expect
				.poll(() => page.evaluate(() => window.__grantedTracks?.every(track => track.readyState === 'ended') ?? false))
				.toBe(true);
		});

		// The third window a grant can land in, and the only one the runtime cannot
		// clean up after. Its siblings above stop during the module fetch, where the
		// backend already holds `stream` and finds tracks to release. This one stops
		// while the prompt is still up, so the backend holds nothing yet, and the
		// grant arrives afterwards to a session that already ended.
		//
		// scene-runtime.ts hands the microphone back for that case too, but only once
		// startListening resolves, and the hung route below means it never does. The
		// epoch check in tone-backend.ts is the only thing left, which is why removing
		// it leaves every other case in this file green.
		test('hands the microphone back when a stop lands while the prompt is still up', async ({ page }): Promise<void> => {
			await page.addInitScript((key: string) => {
				window.localStorage.setItem(key, 'offered');
			}, OFFERED_KEY);
			await page.addInitScript(() => {
				const granted: MediaStreamTrack[] = [];
				window.__grantedTracks = granted;
				const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
				// Held until the test lets it go. Chromium's fake UI answers the prompt
				// instantly, which closes the window this case needs; a real prompt stays
				// pending for as long as the listener takes to read it.
				navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
					await new Promise<void>((release) => {
						window.__releaseGrant = release;
					});
					const stream = await open(constraints);
					granted.push(...stream.getTracks());
					return stream;
				};
			});
			// Hung rather than aborted, so the attempt parks past the grant and the
			// runtime's own recheck never runs.
			await page.route('**/worklets/level-listening.js', () => {});
			await page.goto('./');

			await page.getByRole('button', { name: 'Play' }).click();
			await page.getByRole('button', { name: 'Let it listen' }).click();
			await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText(
				'Asking your browser for the microphone.',
			);

			// Stop first, grant second. That order is the whole case.
			await page.getByRole('button', { name: 'Stop' }).click();
			await page.evaluate(() => {
				window.__releaseGrant?.();
			});

			await expect
				.poll(() => page.evaluate(() => (window.__grantedTracks?.length ?? 0) > 0))
				.toBe(true);
			await expect
				.poll(() => page.evaluate(() => window.__grantedTracks?.every(track => track.readyState === 'ended') ?? false))
				.toBe(true);
		});
	});
});
