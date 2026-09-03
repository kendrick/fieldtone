import { expect, test } from '@playwright/test';

// Narrow to the fields this spec actually asserts on—the manifest carries
// more (name, colors), but typing those would just be unused surface.
interface WebManifestIcon {
	sizes: string;
	purpose?: string;
}

interface WebManifest {
	start_url: string;
	scope: string;
	icons: WebManifestIcon[];
}

test.describe('installable', () => {
	test('manifest link in the head resolves to a fetchable manifest', async ({ page }): Promise<void> => {
		await page.goto('./');

		const manifestLink = page.locator('link[rel="manifest"]');
		await expect(manifestLink).toHaveCount(1);

		const href = await manifestLink.getAttribute('href');
		expect(href).not.toBeNull();

		// Resolve against the page rather than assuming the href is root-relative
		// in the way a reader expects—page.request.get needs an absolute URL, and
		// new URL() applied to a relative href does what the browser itself would.
		const manifestUrl = new URL(href ?? '', page.url());
		const response = await page.request.get(manifestUrl.href);
		expect(response.ok()).toBe(true);

		const manifest: WebManifest = await response.json();

		expect(manifest.start_url).toContain('/fieldtone');
		expect(manifest.scope).toContain('/fieldtone');
	});

	test('manifest declares a maskable icon and both required sizes', async ({ page }): Promise<void> => {
		await page.goto('./');

		const href = await page.locator('link[rel="manifest"]').getAttribute('href');
		const manifestUrl = new URL(href ?? '', page.url());
		const response = await page.request.get(manifestUrl.href);
		const manifest: WebManifest = await response.json();

		expect(manifest.icons.some(icon => icon.purpose?.includes('maskable'))).toBe(true);
		expect(manifest.icons.some(icon => icon.sizes === '192x192')).toBe(true);
		expect(manifest.icons.some(icon => icon.sizes === '512x512')).toBe(true);
	});

	test('apple-touch-icon link is present for iOS home screen installs', async ({ page }): Promise<void> => {
		await page.goto('./');

		// A <link> in the head is never visible, so this counts the element
		// rather than asserting visibility on something that can't have any.
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
	});
});
