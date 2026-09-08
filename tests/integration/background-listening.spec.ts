import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// background-listening.ts's storage key, spelled out rather than imported:
// importing the module from a spec would pull its jsdom-safe guards into a
// suite that only needs the string a listener's browser would already hold.
const KEEP_LISTENING_KEY = 'fieldtone.listening.background';

// listen-invitation.tsx's copy for `suspended`, spelled out for the reason
// listening-suspended.spec.ts gives: a test that imported the string would
// pass against any wording at all, and the wording is what tells a listener
// the way back is a press.
const SUSPENDED_MESSAGE = 'FieldTone stopped listening. Press Let it listen to start again.';

// background-listening.tsx's copy for the installed app, spelled out for the
// same reason. This is the only sentence proving the paragraph rendered
// rather than the checkbox.
const UNAVAILABLE_MESSAGE = 'Background listening isn\'t available in the installed app: iOS stops the microphone when FieldTone leaves the screen.';

const LABEL = 'Keep listening in the background';

// Test-only, installed by the init scripts below. Neither belongs on the
// probe: production has no reason to hand out a microphone track, and
// nothing in the app lies to itself about whether the page is visible.
declare global {
	interface Window {
		__grantedTracks?: MediaStreamTrack[];
		__setHidden?: (next: boolean) => void;
	}
}

// Both flags, at file scope, for the reason listening.spec.ts gives:
// overriding launchOptions forces a new worker and Playwright will not do
// that for one describe group.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

// Handed to page.evaluate, so it may close over nothing in this module. An
// array of states rather than a boolean, for the reason
// listening-suspended.spec.ts gives: `every` over an empty array is true, so a
// check written the other way would pass when no track opened at all.
function trackStates(): MediaStreamTrackState[] {
	return (window.__grantedTracks ?? []).map(track => track.readyState);
}

// Handed to page.addInitScript, so it may close over nothing in this module.
// Every track getUserMedia hands out, kept where the assertion can reach it:
// the backend holds the stream in a closure and the probe deliberately does
// not expose it, so a page has no other way to ask whether a microphone was
// actually released rather than merely reported as closed.
function trackGranted(): void {
	const granted: MediaStreamTrack[] = [];
	window.__grantedTracks = granted;
	const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
	navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
		const stream = await open(constraints);
		granted.push(...stream.getTracks());
		return stream;
	};
}

// A page under Playwright is never backgrounded, so the edge the runtime
// listens for has to be manufactured. The runtime reads
// `document.visibilityState` rather than trusting the event, because WebKit
// can deliver a late one already reading `visible`. So the flag and the event
// have to move together here, or the handler reads the wrong direction and
// the test proves nothing.
function installVisibilityShim(): void {
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
}

// Desktop Chromium has no `navigator.standalone` at all, which is exactly the
// gap this stub closes: without it `isInstalledApp()` always sees `undefined`
// and the installed-app case below never runs here. A plain data property,
// the same shape audio-session.spec.ts's stubAudioSession uses for
// `navigator.audioSession`, following tests/integration/audio-session.spec.ts:16-18.
// This proves the code path this session can reach; the device check itself
// is the main session's job.
function stubInstalledApp(): void {
	Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
}

// Handed to page.evaluate, so it may close over nothing in this module. A
// string rather than a number, because `getComputedStyle` already hands one
// back and comparing against the exact `'1'` a finished animation settles on
// is plainer than parsing it first.
function invitationFloorOpacity(): string {
	const floor = document.querySelector('.invitation-floor');
	return floor ? getComputedStyle(floor).opacity : '0';
}

test.describe('background listening', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines cannot exercise a grant at all and are
	// skipped rather than given a getUserMedia call that hangs.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('a listener who never touches the setting is suspended in the background, tracks and all', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(trackGranted);
		await page.addInitScript(installVisibilityShim);
		await page.goto('./');

		// Scoped to the floor because share-control.tsx mounts a live region of
		// its own. Both are status roles, so a bare getByRole('status') resolves
		// to two elements and strict mode refuses to choose.
		const status = page.locator('.invitation-floor').getByRole('status');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(status).toHaveText('Listening');

		await page.evaluate(() => {
			window.__setHidden?.(true);
		});

		// The platform default, unchanged: a listener who leaves the setting
		// alone gets Principle I's answer, a page nobody is looking at holds no
		// microphone.
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended']);
		await expect(status).toHaveText(SUSPENDED_MESSAGE);
	});

	test('an opted-in listener keeps Listening through a background trip and back', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript(trackGranted);
		await page.addInitScript(installVisibilityShim);
		await page.goto('./');

		const status = page.locator('.invitation-floor').getByRole('status');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(status).toHaveText('Listening');

		await page.getByRole('checkbox', { name: LABEL }).check();

		await page.evaluate(() => {
			window.__setHidden?.(true);
		});

		// The opt-in's whole point: the track that would otherwise end stays
		// open, and the status never moves off Listening to say otherwise.
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['live']);
		await expect(status).toHaveText('Listening');

		await page.evaluate(() => {
			window.__setHidden?.(false);
		});

		// Coming back to a page that never suspended is a no-op, not a second
		// grant, so the same track is still the only one and it is still live.
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['live']);
		await expect(status).toHaveText('Listening');
	});

	test('the installed app suspends anyway, and offers the reason instead of a switch', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'on');
		}, KEEP_LISTENING_KEY);
		await page.addInitScript(stubInstalledApp);
		await page.addInitScript(trackGranted);
		await page.addInitScript(installVisibilityShim);
		await page.goto('./');

		const status = page.locator('.invitation-floor').getByRole('status');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(status).toHaveText('Listening');

		// ADR 0004's veto, standing even over a flag already on: the checkbox an
		// installed app cannot honor is withheld rather than shown and ignored,
		// and the paragraph explains why in its place.
		await expect(page.getByRole('checkbox', { name: LABEL })).toBeHidden();
		await expect(page.getByText(UNAVAILABLE_MESSAGE)).toBeVisible();

		await page.evaluate(() => {
			window.__setHidden?.(true);
		});

		// Whatever the tab's own storage says, an installed iOS app suspends
		// capture the moment it leaves the screen (ADR 0004) — this is the one
		// case this suite can actually reach, since Chromium has no real
		// `navigator.standalone`; the device itself is the main session's job.
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended']);
		await expect(status).toHaveText(SUSPENDED_MESSAGE);
	});

	test('the opt-in survives a reload', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');

		await page.getByRole('checkbox', { name: LABEL }).check();

		// The init scripts above re-run on a reload of the same page, which is
		// what puts OFFERED_KEY back before the first paint; the checkbox's own
		// write already went to that same localStorage; nothing here re-seeds
		// it, so what survives is only what writeKeepListening actually wrote.
		await page.reload();

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');

		await expect(page.getByRole('checkbox', { name: LABEL })).toBeChecked();
	});

	test('has no accessibility violations with the control visible', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');
		await expect(page.getByRole('checkbox', { name: LABEL })).toBeVisible();

		// globals.css fades `.invitation-floor` in over 600ms, and axe reads
		// whatever opacity the page holds at the moment it runs. A scan that
		// lands mid-fade catches the status text and Stop button blended toward
		// the background and reports a contrast violation neither one actually
		// has once the animation settles — a false positive about timing, not
		// about color.
		await expect.poll(() => page.evaluate(invitationFloorOpacity)).toBe('1');

		const results = await new AxeBuilder({ page }).analyze();

		expect(results.violations).toEqual([]);
	});
});
