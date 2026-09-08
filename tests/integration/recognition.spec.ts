import { expect, test } from '@playwright/test';
import { MATERIAL_CONTRAST_THRESHOLD, renderMaterialContrast } from './probe';

// Both flags, matching listening.spec.ts: the fake device alone leaves headless
// Chromium throwing NotSupportedError from getUserMedia, and the UI flag is what
// answers the permission prompt. File scope rather than inside a describe,
// because overriding launchOptions forces a new worker and Playwright refuses to
// do that for one group. The offline case below needs no microphone, but the
// live cases that join it here do.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test.describe('recognition', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines cannot reach a returned fragment at all.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('material put into the scene comes back through it', async ({ page }): Promise<void> => {
		await page.goto('./');
		// The probe is installed on the first press, so play before rendering.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Rendered offline, which needs no sound card and so answers the same way on
		// a laptop and on a CI runner. This is the acceptance criterion the ear
		// cannot check for us: it drives the same Bed builder playback does, so a
		// Material node the Scene never connected shows up here as a ratio near 1.
		//
		// Listening is not involved. The worklet returns Material into this node in
		// the live graph; what this proves is that the node reaches the listener
		// once a Scene has taken it, which is the half a headless run can see.
		expect(await page.evaluate(renderMaterialContrast)).toBeGreaterThan(MATERIAL_CONTRAST_THRESHOLD);
	});
});
