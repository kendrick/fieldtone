import { expect, test } from '@playwright/test';

// 0.05 sits roughly 3.5x under the ~0.18 RMS a 220Hz sine at gain 0.25
// produces, so it clears noise-floor jitter without waiting for full level.
const AUDIBLE_THRESHOLD = 0.05;
const SILENT_THRESHOLD = 0.005;

function readLevel(): number {
	return window.__fieldtone?.readOutputLevel() ?? 0;
}

function renderRms(): Promise<number> {
	return window.__fieldtone?.renderVoiceRms() ?? Promise.resolve(0);
}

async function isRealtimeAudioAvailable(): Promise<boolean> {
	const before = window.__fieldtone?.readContextTime() ?? 0;
	await new Promise((resolve) => {
		setTimeout(resolve, 300);
	});
	const after = window.__fieldtone?.readContextTime() ?? 0;
	return after > before;
}

test.describe('audible output', () => {
	test('the voice renders as sound rather than silence', async ({ page }): Promise<void> => {
		await page.goto('/');
		// The probe is installed on the first press, so play before rendering.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Rendered offline, which needs no sound card and so answers the same way
		// on a laptop and on a CI runner. It drives the very graph playback uses,
		// so a silent bug shows up here even where nothing can be heard.
		expect(await page.evaluate(renderRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});

	test('play makes sound, stop silences it, and play works again', async ({ page }): Promise<void> => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// A machine with no audio output device reports the context as running but
		// never advances its clock, so nothing is ever rendered in real time and no
		// meter reading could mean anything. Skip rather than assert on silence.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'no realtime audio device on this machine');

		// The fade is a 0.3s ramp. Asserting its shape against a poll this coarse
		// would be flaky, so this only waits for the far side of it; ticket #4
		// covers the ramp itself through a recording fake.
		await expect.poll(() => page.evaluate(readLevel), { timeout: 5_000 }).toBeGreaterThan(AUDIBLE_THRESHOLD);

		await page.getByRole('button', { name: 'Stop' }).click();
		await expect.poll(() => page.evaluate(readLevel), { timeout: 5_000 }).toBeLessThan(SILENT_THRESHOLD);

		await page.getByRole('button', { name: 'Play' }).click();
		await expect.poll(() => page.evaluate(readLevel), { timeout: 5_000 }).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});
});
