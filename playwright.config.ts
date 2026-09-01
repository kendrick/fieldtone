import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/integration',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:3000',
		trace: 'on-first-retry',
	},
	webServer: {
		// Serve the static export rather than the dev server. The export is what
		// actually ships, so e2e tests must exercise it—dev behaves differently.
		// Requires pnpm build to have run first; a stale or missing out/ otherwise
		// gives a misleading test result.
		command: 'pnpm preview',
		port: 3000,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	// Mobile-first matrix. CI passes explicit --project flags to run only
	// Chromium-based projects; WebKit and Firefox are local checks.
	projects: [
		{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
		{ name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
		{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
		{ name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
	],
});
