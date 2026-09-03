import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// A separate file only because of this line. `--use-fake-ui-for-media-stream`
// answers the permission prompt yes and `=deny` answers it no, launchOptions
// cannot vary per describe group, and Playwright's own permission API cannot
// produce a denial once the fake UI is answering: granted, never granted and
// cleared all come back granted. `=deny` is what yields a real NotAllowedError,
// which is the DOMException a listener pressing Block produces.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream=deny'] } });

test.describe('listen invitation refused', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('a returning listener who is denied the microphone still hears the Bed', async ({ page }): Promise<void> => {
		await page.addInitScript((key: string) => {
			window.localStorage.setItem(key, 'offered');
		}, OFFERED_KEY);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();
		await page.getByRole('button', { name: 'Let it listen' }).click();

		await expect(page.getByRole('status')).toHaveText(
			'Your browser is holding on to that answer, so FieldTone cannot ask again. Change the microphone permission for this site in your browser settings.',
		);

		// The refusal costs the listener nothing they already had, which is the
		// whole claim the second Invitation rests on.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		// Pressing again could only produce the same answer, so the button goes.
		await expect(page.getByRole('button', { name: 'Let it listen' })).toBeHidden();
	});
});
