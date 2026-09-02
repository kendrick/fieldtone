import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// A range input snaps `valueAsNumber` to its own step grid while the store and
// the audio keep the exact value, so only a value sitting on that grid can be
// asserted without tolerance. The step is (max - min) / 100, which puts every
// schema bound on the grid by construction—Space's 0.8 and Brightness's 0.75
// and 3 are all exact, while Space's 0.35 default displays as 0.352. Anything
// off a bound needs at least one step of slack: Space's step is 0.008 and
// Brightness's is 0.0225.
const SPACE_DEFAULT = 0.35;

test.describe('shared link', () => {
	test('a link applies its values and the resulting graph is audible', async ({ page }): Promise<void> => {
		await page.goto('/?space=0&brightness=3');

		// Web-first assertions throughout, never a one-shot read after goto: the
		// link is applied in an effect after hydration, so both sliders paint at
		// their schema defaults and then jump. A plain read here would race the
		// jump and pass on the defaults.
		//
		// Both values are schema bounds, so they land on the step grid exactly and
		// need no tolerance.
		await expect(page.getByRole('slider', { name: 'Space' })).toHaveJSProperty('valueAsNumber', 0);
		await expect(page.getByRole('slider', { name: 'Brightness' })).toHaveJSProperty('valueAsNumber', 3);

		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// What this proves and nothing more: the graph built from a link is not
		// silent. That is the failure mode worth catching, because a Tone.Multiply
		// built with a factor of 0 renders silence that typechecks and passes every
		// unit test. It does not prove the link's values rather than the defaults
		// reached the graph—the defaults are audible too. The slider assertions
		// above carry that half.
		//
		// The corner is chosen, not incidental. Ember redraws its voicing on every
		// render, so level varies draw to draw, and space=0.8 with brightness=0.75
		// is the quietest corner there is: maximum reverb wet through the most
		// closed filter. Six offline renders there measured 0.063 to 0.215, a 3.4x
		// spread that has already put a draw under this threshold and failed a run.
		// space=0 with brightness=3 measured 0.201 to 0.235 over the same six, a
		// tight band at roughly 4x the threshold. Moving this assertion back to the
		// quiet corner buys nothing and reintroduces the flake.
		expect(await page.evaluate(renderBedRms)).toBeGreaterThan(AUDIBLE_THRESHOLD);

		// No realtime meter reading here, and so no skip guard: a headless browser
		// reports its AudioContext as running and then freezes the clock, so a
		// realtime meter reads zero whether the graph works or is broken. The
		// offline render above needs no sound card and answers the same way on a
		// laptop and on CI.
	});

	test('a mangled link falls back and still plays', async ({ page }): Promise<void> => {
		await page.goto('/?space=banana&brightness=99&bogus=1');

		// Brightness first, and deliberately: 99 clamps to the max of 3, which is a
		// visible move off the 1 the slider paints before hydration, so it is the
		// assertion that proves the link was read at all. Space is checked second
		// because its default is also what an unhydrated slider shows—on its own it
		// would pass even if the effect never ran.
		await expect(page.getByRole('slider', { name: 'Brightness' })).toHaveJSProperty('valueAsNumber', 3);

		// Polled rather than read once, for the same hydration race as above, and
		// closeTo rather than exact because 0.35 is not on the step grid.
		const space = page.getByRole('slider', { name: 'Space' });
		await expect.poll(() => space.evaluate((element: HTMLInputElement): number => element.valueAsNumber)).toBeCloseTo(SPACE_DEFAULT, 1);

		// `bogus=1` is in the link to prove an undeclared key is ignored rather
		// than throwing somewhere in the apply effect. If it did, the UI would be
		// gone by now and there would be no Play button to find.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Matched by text, not by role: Next.js keeps its own empty route announcer
		// at role "alert" mounted at all times, and the alert role takes no
		// accessible name from its content, so getByRole('alert', { name }) finds
		// nothing even when the real message is on screen—an assertion that would
		// pass whether or not this ever regressed.
		await expect(page.getByText('Audio could not start')).toHaveCount(0);
	});

	test('committing a slider writes every parameter to the address bar', async ({ page }): Promise<void> => {
		await page.goto('/');

		const brightness = page.getByRole('slider', { name: 'Brightness' });
		await brightness.focus();
		await brightness.press('End');
		await expect(brightness).toHaveJSProperty('valueAsNumber', 3);

		// The `space=` half is the point of this case. A link that carried only the
		// control somebody last touched would look right in every manual check and
		// still lose the other parameter for whoever opened it, so the assertion
		// has to name a key the test never moved.
		await expect(page).toHaveURL(/[?&]brightness=3(?:&|$)/);
		await expect(page).toHaveURL(/[?&]space=/);
	});
});
