import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// The localStorage flag listen-invitation.tsx writes once the floor's
// animation ends. Pre-setting it here is what a returning listener's browser
// would already hold, and it is the only way to skip the 20s floor without
// waiting it out for real.
const OFFERED_KEY = 'fieldtone.invitation.listen';

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

		await expect(page.getByRole('status')).toHaveText('Listening');

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
});
