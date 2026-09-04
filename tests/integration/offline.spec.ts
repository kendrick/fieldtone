import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// Handed to page.evaluate, so it runs inside the browser and may not close
// over anything from this module — only the global `navigator` it's given.
function hasServiceWorkerController(): boolean {
	return Boolean(navigator.serviceWorker.controller);
}

// Also handed to page.evaluate, and bound by the same rule. Reports how many
// _next/static/ URLs the served document references and which of them no
// FieldTone cache holds, so the caller can tell an empty answer apart from a
// document that referenced nothing at all.
async function shellCacheCoverage(): Promise<{ referenced: number; missing: string[] }> {
	const referenced = new Set(
		[...document.querySelectorAll('script[src], link[href]')]
			.map(element => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
			.filter(value => value.includes('_next/static/'))
			.map(value => new URL(value, document.baseURI).href),
	);
	const names = (await caches.keys()).filter(name => name.startsWith('fieldtone-'));
	const stores = await Promise.all(names.map(name => caches.open(name)));
	const missing: string[] = [];
	for (const url of referenced) {
		const hits = await Promise.all(stores.map(store => store.match(url)));
		if (!hits.some(hit => hit !== undefined)) {
			missing.push(url);
		}
	}
	return { referenced: referenced.size, missing };
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

		// Reloading offline is not on its own proof that CacheStorage is complete.
		// Firefox will serve a fingerprinted chunk out of its own HTTP cache while
		// the context is offline, so a worker that cached no chunk at all still gets
		// through the reload there. Naming the misses reads the same on every engine.
		const coverage = await page.evaluate(shellCacheCoverage);
		expect(coverage.referenced).toBeGreaterThan(0);
		expect(coverage.missing).toEqual([]);

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
