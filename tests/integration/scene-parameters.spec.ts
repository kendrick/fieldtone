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

	test('Space and Brightness sliders sit exactly on their step grid', async ({ page }): Promise<void> => {
		await page.goto('./');

		// 0.01 divides both of Ember's ranges evenly (see the DEFAULT_STEP comment
		// in parameters.ts), so valueAsNumber lands on the same number the store
		// holds with no rounding gap to paper over—#36 was a slider showing 0.352
		// for a store value of 0.35, and this is the regression guard for it.
		const space = page.getByRole('slider', { name: 'Space' });
		const brightness = page.getByRole('slider', { name: 'Brightness' });
		await expect(space).toHaveJSProperty('valueAsNumber', 0.35);
		await expect(brightness).toHaveJSProperty('valueAsNumber', 1);

		// One key at a time off the default, checked before the next moves it
		// again: ArrowRight proves the grid itself is 0.01 wide rather than some
		// other divisor that happens to land on the same default, and Home/End
		// are the schema's own min and max.
		await space.focus();
		await space.press('ArrowRight');
		await expect(space).toHaveJSProperty('valueAsNumber', 0.36);
		await space.press('Home');
		await expect(space).toHaveJSProperty('valueAsNumber', 0);
		await space.press('End');
		await expect(space).toHaveJSProperty('valueAsNumber', 0.8);

		await brightness.focus();
		await brightness.press('ArrowRight');
		await expect(brightness).toHaveJSProperty('valueAsNumber', 1.01);
		await brightness.press('Home');
		await expect(brightness).toHaveJSProperty('valueAsNumber', 0.75);
		await brightness.press('End');
		await expect(brightness).toHaveJSProperty('valueAsNumber', 3);
	});
});
