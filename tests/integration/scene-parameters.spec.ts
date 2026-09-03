import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, isRealtimeAudioAvailable, readLevel, renderBedRms } from './probe';

test.describe('scene parameters', () => {
	test('dragging Brightness to its maximum keeps the Scene playing and audible', async ({ page }): Promise<void> => {
		await page.goto('./');
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Querying by role and accessible name, rather than a selector, is the
		// check that the control is actually reachable—Principle II leaves no
		// room to fake that with a div.
		const brightness = page.getByRole('slider', { name: 'Brightness' });
		await brightness.focus();
		await brightness.press('End');
		await expect(brightness).toHaveJSProperty('valueAsNumber', 3);

		// A parameter move must not stop the Scene or surface the play toggle's
		// failure state. Matched by text, not by role: Next.js keeps its own empty
		// route announcer at role "alert" mounted at all times, and the alert role
		// takes no accessible name from its content, so getByRole('alert', { name })
		// finds nothing even when the real message is on screen—an assertion that
		// would pass whether or not this ever regressed.
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
		await expect(page.getByText('Audio could not start')).toHaveCount(0);

		// Brightness rather than Space: opening the filter can only add level, so
		// this can't flake on a quiet draw. Space at its maximum pushes more
		// signal into the reverb's wet path and hasn't been measured across
		// draws, so it isn't safe to assert on yet.
		//
		// Rendered offline, which needs no sound card, so this must come before
		// the realtime skip below—otherwise a machine with no audio device would
		// skip the one check built to work without one.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		// A machine with no audio output device reports the context as running but
		// never advances its clock, so nothing is ever rendered in real time and no
		// meter reading could mean anything. Skip rather than assert on silence.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'no realtime audio device on this machine');

		await expect.poll(() => page.evaluate(readLevel), { timeout: 5_000 }).toBeGreaterThan(AUDIBLE_THRESHOLD);
	});
});
