import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// The localStorage flag listen-invitation.tsx writes once the floor's
// animation ends. Pre-setting it here is what a returning listener's browser
// would already hold, and it is the only way to skip the 20s floor without
// waiting it out for real.
const OFFERED_KEY = 'fieldtone.invitation.listen';

test.describe('listen invitation', () => {
	// --use-fake-device-for-media-stream is a Chromium flag; there is no WebKit
	// or Firefox equivalent, so those engines cannot exercise a real grant or
	// denial and are skipped rather than given a getUserMedia call that hangs.
	test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream'] } });
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('stays hidden for the first Invitation, which proves the floor is real', async ({ page }): Promise<void> => {
		await page.goto('./');
		await page.getByRole('button', { name: 'Play' }).click();

		// The floor is 20s; 2s is cheap proof this is "not on load" without
		// paying for the whole wait in every run.
		const invitation = page.getByRole('button', { name: 'Let it listen' });
		await expect(invitation).toBeHidden();
		await page.waitForTimeout(2_000);
		await expect(invitation).toBeHidden();
	});

	test('a returning listener who grants the microphone hears Listening start while the Bed keeps playing', async ({ page, context }): Promise<void> => {
		await context.grantPermissions(['microphone']);
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

	test('a returning listener who is denied the microphone still hears the Bed', async ({ page }): Promise<void> => {
		// No grantPermissions call: Chromium auto-denies a getUserMedia prompt
		// it was never told to answer, which is the same outcome a listener who
		// clicks "Block" produces.
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();

		await expect(page.getByRole('status')).toHaveText(
			'Your browser is holding on to that answer, so FieldTone cannot ask again. Change the microphone permission for this site in your browser settings.',
		);
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});

	test('has no accessibility violations once the Invitation is visible', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Let it listen' })).toBeVisible();

		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations).toEqual([]);
	});
});
