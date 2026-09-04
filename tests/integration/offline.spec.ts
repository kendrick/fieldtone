import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// Handed to page.evaluate, so it runs inside the browser and may not close
// over anything from this module — only the global `navigator` it's given.
function hasServiceWorkerController(): boolean {
	return Boolean(navigator.serviceWorker.controller);
}

test.describe('offline shell', () => {
	test('the shell and its Bed still work with the network cut', async ({ page, context, browserName }): Promise<void> => {
		// clients.claim() in activate makes the very first load a controlled one,
		// so a cut network still has to serve a shell the worker installed on a
		// prior visit. WebKit can't stand in for that prior visit under
		// Playwright: context.setOffline(true) followed by a navigation throws
		// "WebKit encountered an internal error" regardless of whether a worker
		// is controlling the page (microsoft/playwright#34402), which is true of
		// both mobile-safari and desktop-safari here since both drive WebKit.
		test.skip(browserName === 'webkit', 'WebKit cannot navigate a page while the Playwright context is offline (microsoft/playwright#34402)');

		await page.goto('./');
		await expect.poll(() => page.evaluate(hasServiceWorkerController)).toBe(true);

		await context.setOffline(true);
		await page.reload();

		await expect(page.getByRole('heading', { level: 1, name: 'FieldTone' })).toBeVisible();

		// A shell that paints and makes no sound offline is the exact failure
		// this spec exists to catch, so the heading alone doesn't finish the
		// job — press Play and prove the cached shell can still produce audio.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// renderBedRms drives an OfflineAudioContext, which needs no sound card
		// and no network of its own, so it reads the same offline as it does on
		// a machine with a live connection.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		await context.setOffline(false);
	});
});
