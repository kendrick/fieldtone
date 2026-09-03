import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
	test('renders the app shell', async ({ page }): Promise<void> => {
		await page.goto('./');

		await expect(page.getByRole('heading', { level: 1, name: 'FieldTone' })).toBeVisible();
	});

	test('has no accessibility violations', async ({ page }): Promise<void> => {
		await page.goto('./');

		// The constitution treats accessibility as non-negotiable, so the scan
		// runs against the very first shipped shell rather than waiting for content.
		const results = await new AxeBuilder({ page }).analyze();

		expect(results.violations).toEqual([]);
	});
});
