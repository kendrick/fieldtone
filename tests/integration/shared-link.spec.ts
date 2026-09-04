import { expect, test } from '@playwright/test';
import { AUDIBLE_THRESHOLD, renderBedRms } from './probe';

// A range input snaps `valueAsNumber` to its own step grid while the store and
// the audio keep the exact value. Ember's step is 0.01 (see parameters.ts),
// which divides both ranges evenly, so every value asserted here—bound or
// default—lands on the grid exactly and needs no tolerance.

declare global {
	interface Window {
		// Written by the clipboard stub the cases below install with
		// addInitScript, so a page.evaluate afterward can read back what
		// share-control.tsx passed to writeText without a cast—lib.dom types
		// Window with no such member on its own.
		__sharedLink?: string;
		// Same idea for the native share path: each stubbed navigator.share call
		// appends its argument here, so the assertion can check the call count
		// as well as what it carried.
		__shareCalls?: Array<{ url?: string }>;
	}
}

test.describe('shared link', () => {
	test('a link applies its values and the resulting graph is audible', async ({ page }): Promise<void> => {
		await page.goto('./?space=0&brightness=3');

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
		await page.goto('./?space=banana&brightness=99&bogus=1');

		// Brightness first, and deliberately: 99 clamps to the max of 3, which is a
		// visible move off the 1 the slider paints before hydration, so it is the
		// assertion that proves the link was read at all. Space is checked second
		// because its default is also what an unhydrated slider shows—on its own it
		// would pass even if the effect never ran.
		await expect(page.getByRole('slider', { name: 'Brightness' })).toHaveJSProperty('valueAsNumber', 3);

		// Web-first rather than a one-shot read, for the same hydration race as
		// above.
		const space = page.getByRole('slider', { name: 'Space' });
		await expect(space).toHaveJSProperty('valueAsNumber', 0.35);

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
		await page.goto('./');

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

	test('the clipboard fallback carries every parameter through untouched and moved sliders', async ({ page }): Promise<void> => {
		// Whether the browser exposes navigator.share varies by platform, so the
		// share-control.tsx branch under test has to be forced rather than hoped
		// for—this is the same reason listening.spec.ts:44 pins the microphone
		// grant with an init script instead of trusting what the engine ships.
		// Registered on the page rather than run once: Playwright reapplies an
		// init script to every document the page loads, and the round trip below
		// needs the same stub standing after the `page.goto` partway through it.
		await page.addInitScript(() => {
			// `share` lives on Navigator.prototype in WebKit, so
			// Reflect.deleteProperty(window.navigator, 'share') returns true having
			// deleted nothing—there is no own property to remove, and the
			// prototype's getter answers right through it. Shadowing it with an own
			// property is what actually turns `typeof navigator.share` to
			// 'undefined' on every engine, WebKit included.
			Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined });

			Object.defineProperty(window.navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: (text: string): Promise<void> => {
						window.__sharedLink = text;
						return Promise.resolve();
					},
				},
			});
		});

		await page.goto('./');

		// Pressed before anything moves, which is the case this feature exists to
		// close: a bare `/` carries no query at all, so a link built from the
		// address bar would carry nothing either. It has to hold both declared
		// keys anyway. This press comes first because the round trip below leaves
		// the address bar already carrying them, and a press after that would pass
		// against an implementation reading window.location.search—the one thing
		// #21's second criterion rules out.
		await page.getByRole('button', { name: 'Share this Scene' }).click();
		await expect(page.getByRole('status')).toHaveText('Link copied');

		const untouchedLink = await page.evaluate(() => window.__sharedLink);
		if (untouchedLink === undefined) {
			throw new Error('writeText was never called');
		}

		const untouchedParams = new URL(untouchedLink).searchParams;
		expect(untouchedParams.has('space')).toBe(true);
		expect(untouchedParams.has('brightness')).toBe(true);

		const space = page.getByRole('slider', { name: 'Space' });
		const brightness = page.getByRole('slider', { name: 'Brightness' });

		// Both bounds, not two arbitrary points, so both land on the step grid
		// exactly per the header comment above and need no tolerance.
		await space.focus();
		await space.press('End');
		await brightness.focus();
		await brightness.press('Home');
		await expect(space).toHaveJSProperty('valueAsNumber', 0.8);
		await expect(brightness).toHaveJSProperty('valueAsNumber', 0.75);

		await page.getByRole('button', { name: 'Share this Scene' }).click();
		await expect(page.getByRole('status')).toHaveText('Link copied');

		const movedLink = await page.evaluate(() => window.__sharedLink);
		if (movedLink === undefined) {
			throw new Error('writeText was never called');
		}

		await page.goto(movedLink);

		// Web-first, for the same hydration race the first test in this file
		// guards against: the link is applied in an effect after paint.
		await expect(page.getByRole('slider', { name: 'Space' })).toHaveJSProperty('valueAsNumber', 0.8);
		await expect(page.getByRole('slider', { name: 'Brightness' })).toHaveJSProperty('valueAsNumber', 0.75);

		const movedParams = new URL(movedLink).searchParams;
		expect(movedParams.has('space')).toBe(true);
		expect(movedParams.has('brightness')).toBe(true);
	});

	test('the native share sheet receives one call carrying every parameter', async ({ page }): Promise<void> => {
		// Defined rather than left to the platform, so every project exercises
		// the share branch deterministically instead of whichever branch the
		// engine happens to expose—Firefox has no navigator.share at all.
		await page.addInitScript(() => {
			Object.defineProperty(window.navigator, 'share', {
				configurable: true,
				value: (data: { url?: string }): Promise<void> => {
					const calls = window.__shareCalls ?? [];
					calls.push(data);
					window.__shareCalls = calls;
					return Promise.resolve();
				},
			});
		});

		await page.goto('./');
		await page.getByRole('button', { name: 'Share this Scene' }).click();

		// Polled rather than read once: a successful share shows no status
		// message (announceShare returns '' and never calls setState), so
		// there is no visible signal to wait on beside the call landing itself.
		await expect.poll(() => page.evaluate(() => window.__shareCalls?.length ?? 0)).toBe(1);

		const calls = await page.evaluate(() => window.__shareCalls ?? []);
		const shared = calls[0];
		if (shared?.url === undefined) {
			throw new Error('navigator.share was not called with a url');
		}

		const params = new URL(shared.url).searchParams;
		expect(params.has('space')).toBe(true);
		expect(params.has('brightness')).toBe(true);
	});
});
