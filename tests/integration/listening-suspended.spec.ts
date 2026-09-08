import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// The copy listen-invitation.tsx renders for `suspended`, spelled out rather
// than imported from the component. A test that imported the string would pass
// against any wording at all, and the wording is the whole point: it is what
// tells a listener the way back is a press.
const SUSPENDED_MESSAGE = 'FieldTone stopped listening. Press Let it listen to start again.';

// Test-only, both of them, installed by the init scripts below. Neither belongs
// on the probe: production has no reason to hand out a microphone track, and
// nothing in the app lies to itself about whether the page is visible.
declare global {
	interface Window {
		__grantedTracks?: MediaStreamTrack[];
		__setHidden?: (next: boolean) => void;
	}
}

// Both flags, for the reason listening.spec.ts gives, and at file scope for the
// reason it gives too: overriding launchOptions forces a new worker, and
// Playwright will not do that for one describe group.
//
// `--use-fake-ui-for-media-stream` answers the permission prompt yes every
// time, which bounds what this file can claim. The resume below shows that the
// re-acquire needs no press from the listener. It shows nothing about whether a
// real browser would put its prompt back on screen.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

// Handed to page.evaluate, so it may close over nothing in this module. An
// array of states rather than a boolean, because the count carries as much as
// the states do: `every` over an empty array is true, so a resume that opened
// no track at all would pass a check written the other way.
function trackStates(): MediaStreamTrackState[] {
	return (window.__grantedTracks ?? []).map(track => track.readyState);
}

test.describe('listening suspended', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines cannot exercise a grant at all and are skipped
	// rather than given a getUserMedia call that hangs.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('stops Listening when the page goes away, keeps the Bed playing, and starts Listening again on the way back', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);

		// Every track getUserMedia hands out, kept where the assertion can reach
		// it. The backend holds the stream in a closure and the probe deliberately
		// does not expose it, so a page has no other way to ask whether the
		// microphone was actually released rather than merely reported as closed.
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

		// A page under Playwright is never backgrounded, so the edge the runtime
		// listens for has to be manufactured. The runtime reads
		// `document.visibilityState` rather than trusting the event, because WebKit
		// can deliver a late one already reading `visible`. So the flag and the
		// event have to move together here, or the handler reads the wrong
		// direction and the test proves nothing.
		await page.addInitScript(() => {
			let hidden = false;
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: (): DocumentVisibilityState => hidden ? 'hidden' : 'visible',
			});
			Object.defineProperty(document, 'hidden', {
				configurable: true,
				get: (): boolean => hidden,
			});
			window.__setHidden = (next: boolean): void => {
				hidden = next;
				document.dispatchEvent(new Event('visibilitychange'));
			};
		});

		await page.goto('./');

		// Scoped to the floor because share-control.tsx mounts a live region of its
		// own. Both are status roles, so a bare getByRole('status') resolves to two
		// elements and strict mode refuses to choose.
		const status = page.locator('.invitation-floor').getByRole('status');
		const invitation = page.getByRole('button', { name: 'Let it listen' });

		await page.getByRole('button', { name: 'Play' }).click();
		await invitation.click();
		await expect(status).toHaveText('Listening');

		await page.evaluate(() => {
			window.__setHidden?.(true);
		});

		// Principle I in one line: a page nobody is looking at holds no microphone.
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended']);

		// The other half, and the easier one to break by accident. Tearing the whole
		// audio session down would end every track too, and the poll above would
		// call that a pass. Rendered offline so the assertion needs no sound card,
		// and never overlapping a second render, because Tone.Offline swaps the
		// global context around the one it is running.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		await page.evaluate(() => {
			window.__setHidden?.(false);
		});

		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'live']);
		await expect(status).toHaveText('Listening');

		// Round two, because an app gets backgrounded over and over in one sitting.
		// A resume that works once and leaves the state machine somewhere it can no
		// longer suspend from is the failure this lap catches.
		await page.evaluate(() => {
			window.__setHidden?.(true);
		});
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'ended']);
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		await page.evaluate(() => {
			window.__setHidden?.(false);
		});
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'ended', 'live']);
		await expect(status).toHaveText('Listening');

		// The other suspend trigger, and the one an installed iOS app fires first:
		// the platform mutes the track roughly nine tenths of a second ahead of
		// anything the page hears. Synthetic here because a headless run has no
		// incoming call to produce a real one, and the page stays visible so that
		// nothing but the mute can account for what follows.
		await page.evaluate(() => {
			window.__grantedTracks?.at(-1)?.dispatchEvent(new Event('mute'));
		});
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'ended', 'ended']);

		// Suspending means `track.stop()` rather than `enabled = false`, and a
		// stopped track never fires `unmute`. So nothing resumes this one on its
		// own, the way back has to be a press, and the copy has to say so.
		await expect(status).toHaveText(SUSPENDED_MESSAGE);
		await expect(invitation).toBeVisible();

		await invitation.click();
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'ended', 'ended', 'live']);
		await expect(status).toHaveText('Listening');
	});
});
