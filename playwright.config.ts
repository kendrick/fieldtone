import { defineConfig, devices } from '@playwright/test';

// Each git worktree runs its own preview server, so a hardcoded port would let
// two worktrees collide on 3000. E2E_PORT lets each worktree claim its own.
const port = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
	testDir: 'tests/integration',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${port}/fieldtone/`,
		trace: 'on-first-retry',
	},
	webServer: {
		// Serve the static export rather than the dev server. The export is what
		// actually ships, so e2e tests must exercise it—dev behaves differently.
		// Requires pnpm build to have run first; a stale or missing out/ otherwise
		// gives a misleading test result.
		command: 'pnpm preview',
		port,
		// Default to off, not !CI: an orphaned `serve` from a dead session once
		// held port 3000 for two hours returning 404 for /fieldtone/, and the
		// suite kept passing against it because reuse silently adopted it. Opt
		// in per-run with E2E_REUSE_SERVER=1 when reuse is actually wanted.
		reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
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
