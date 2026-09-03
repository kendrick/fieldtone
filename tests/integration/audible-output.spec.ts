import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, isRealtimeAudioAvailable, readLevel, renderBedFingerprint, renderBedRms, SILENT_THRESHOLD } from './probe';

test.describe('audible output', () => {
	test('the bed renders as sound rather than silence', async ({ page }): Promise<void> => {
		await page.goto('./');
		// The probe is installed on the first press, so play before rendering.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Rendered offline, which needs no sound card and so answers the same way
		// on a laptop and on a CI runner. It drives the very graph playback uses,
		// so a silent bug shows up here even where nothing can be heard.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});

	test('two renders of the bed do not come back identical', async ({ page }): Promise<void> => {
		await page.goto('./');
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Awaited one at a time, never Promise.all: Tone.Offline swaps the global
		// context around an awaited callback, and two renders in flight at once
		// would stomp on each other's context.
		//
		// This is a smoke check, not proof the Bed is generative. Ember's Bed
		// redraws its voicing with drawVoicing(Math.random) on every render, but
		// even a fixed voicing would still differ here, because the reverb's noise
		// burst is randomly offset on each render regardless. So a match would be
		// a real red flag, but a difference only shows the Bed isn't a frozen
		// recording—proving the voicing itself varies is Ember's voicing spec's
		// job, not this one's.
		const first = await page.evaluate(renderBedFingerprint);
		const second = await page.evaluate(renderBedFingerprint);
		expect(second).not.toEqual(first);
	});

	test('play makes sound, stop silences it, and play works again', async ({ page }): Promise<void> => {
		await page.goto('./');
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
