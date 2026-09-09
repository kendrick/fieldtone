import { expect, test } from '@playwright/test';
import { isRealtimeAudioAvailable, MATERIAL_CONTRAST_THRESHOLD, readSignal, renderMaterialContrast } from './probe';

// See listening.spec.ts for what this flag pre-sets and why.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// The ring is four seconds and the pre-roll a quarter of one, so a return opens
// about 3.75s after the onset that armed it and runs the full four. The bursts
// below arrive every two seconds, so a first onset is never far off either. Both
// numbers are budgets: nothing here asserts on when a Moment lands, only that it
// does.
const RECOGNITION_ARRIVES_MS = 10_000;
const RECOGNITION_ENDS_MS = 6_000;

// Test-only, all three installed by the init scripts below. None belongs on the
// probe: production has no reason to hand out a microphone track, nothing in the
// app lies to itself about whether the page is visible, and the release message
// is a private word between the adapter and its processor.
declare global {
	interface Window {
		__grantedTracks?: MediaStreamTrack[];
		__setHidden?: (next: boolean) => void;
		__released?: number;
	}
}

// Both flags, matching listening.spec.ts: the fake device alone leaves headless
// Chromium throwing NotSupportedError from getUserMedia, and the UI flag is what
// answers the permission prompt. File scope rather than inside a describe,
// because overriding launchOptions forces a new worker and Playwright refuses to
// do that for one group. The offline case below needs no microphone, but the
// live cases that join it here do.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

// Handed to page.addInitScript, so they close over nothing in this module.

function seedInvitationOffered(key: string): void {
	window.localStorage.setItem(key, 'offered');
}

// A microphone that makes a sound on a schedule. Chromium's fake device beeps,
// but nothing guarantees that beep clears the detector's 6 dB margin over the
// floor it tracks, and a Recognition that only sometimes arms is a flake. Short
// bursts of a loud sine over silence fire the detector every time, and they ride
// the audio clock, so a slow machine stretches the wall clock without changing
// what the worklet hears.
//
// The context is built inside the call rather than beside the patch, because by
// then the press has been spent: a context constructed at init time has no
// gesture behind it and starts suspended, and a suspended context renders
// nothing into the stream.
//
// The flags above stay on regardless: they keep the permission prompt and the
// device list behaving the way the rest of the suite assumes, and this shim
// replaces only what the call hands back.
function installBurstingMicrophone(): void {
	const granted: MediaStreamTrack[] = [];
	window.__grantedTracks = granted;
	navigator.mediaDevices.getUserMedia = (): Promise<MediaStream> => {
		const context = new AudioContext();
		const oscillator = context.createOscillator();
		oscillator.frequency.value = 1000;
		const gate = context.createGain();
		const destination = context.createMediaStreamDestination();
		oscillator.connect(gate).connect(destination);
		gate.gain.setValueAtTime(0, context.currentTime);

		// A second of silence first, so the detector seeds its noise floor on a quiet
		// room rather than on a burst it would then have to climb back down from. Two
		// seconds apart is well clear of the quarter-second hold-off, so every burst
		// is its own Moment, and the schedule outlasts any run of this file.
		for (let burst = 0; burst < 60; burst += 1) {
			const at = context.currentTime + 1 + burst * 2;
			gate.gain.setValueAtTime(0.5, at);
			gate.gain.setValueAtTime(0, at + 0.1);
		}

		oscillator.start();
		// Belt and braces against the autoplay policy: every caller here is inside a
		// press, but a context that started suspended would hand back a stream of
		// silence rather than fail, and silence looks exactly like a broken worklet.
		void context.resume();
		granted.push(...destination.stream.getTracks());

		return Promise.resolve(destination.stream);
	};
}

// The one observable half of a release. stopListening posts { name: 'release' }
// so the processor can zero its ring, and nothing on the main thread can watch a
// four-second buffer in the audio thread go to zeros—by design, since that is the
// whole reason the samples live over there. Counting the message at the port is
// what is left, and the ring's own zeroing is covered by the maths spec.
function countReleaseMessages(): void {
	window.__released = 0;
	// One name per postMessage overload, because `.call` on the raw reference
	// resolves to the last signature alone and would drop a transfer list. This
	// patch sits under every port on the page—Tone's and the service worker's
	// included, none of which asked to be rewritten.
	const postTransfer: (this: MessagePort, message: unknown, transfer: Transferable[]) => void
		= MessagePort.prototype.postMessage;
	const postOptions: (this: MessagePort, message: unknown, options?: StructuredSerializeOptions) => void
		= MessagePort.prototype.postMessage;
	MessagePort.prototype.postMessage = function (
		this: MessagePort,
		message: unknown,
		options?: StructuredSerializeOptions | Transferable[],
	): void {
		if (typeof message === 'object' && message !== null && 'name' in message && message.name === 'release') {
			window.__released = (window.__released ?? 0) + 1;
		}

		if (Array.isArray(options)) {
			postTransfer.call(this, message, options);
		}
		else {
			postOptions.call(this, message, options);
		}
	};
}

// A page under Playwright is never backgrounded, so the edge the runtime listens
// for has to be manufactured. See listening-suspended.spec.ts for why the flag
// and the event have to move together.
function installVisibilityShim(): void {
	let hidden = false;
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: (): DocumentVisibilityState => hidden ? 'hidden' : 'visible',
	});
	Object.defineProperty(document, 'hidden', {
		configurable: true,
		get: (): boolean => hidden,
	});
	window.__setHidden = (next: boolean): void => {
		hidden = next;
		document.dispatchEvent(new Event('visibilitychange'));
	};
}

// Handed to page.evaluate, so these close over nothing either. States rather
// than a boolean, for the reason listening-suspended.spec.ts gives: `every` over
// an empty array is true, so a resume that opened no track would pass a check
// written the other way.

function trackStates(): MediaStreamTrackState[] {
	return (window.__grantedTracks ?? []).map(track => track.readyState);
}

function releaseCount(): number {
	return window.__released ?? 0;
}

function setHidden(next: boolean): void {
	window.__setHidden?.(next);
}

test.describe('recognition', () => {
	// Fake capture devices are a Chromium flag with no WebKit or Firefox
	// equivalent, so those engines cannot reach a returned fragment at all.
	test.skip(({ browserName }) => browserName !== 'chromium', 'fake capture devices are a Chromium-only flag');

	test('material put into the scene comes back through it', async ({ page }): Promise<void> => {
		await page.goto('./');
		// The probe is installed on the first press, so play before rendering.
		await page.getByRole('button', { name: 'Play' }).click();
		await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

		// Rendered offline, which needs no sound card and so answers the same way on
		// a laptop and on a CI runner. This is the acceptance criterion the ear
		// cannot check for us: it drives the same Bed builder playback does, so a
		// Material node the Scene never connected shows up here as a ratio near 1.
		//
		// Listening is not involved. The worklet returns Material into this node in
		// the live graph; what this proves is that the node reaches the listener
		// once a Scene has taken it, which is the half a headless run can see.
		expect(await page.evaluate(renderMaterialContrast)).toBeGreaterThan(MATERIAL_CONTRAST_THRESHOLD);
	});

	test('a sound made in the room is held and returned once', async ({ page }): Promise<void> => {
		// The Moment costs about eight seconds of audio clock to arrive and four more
		// to finish, and the default thirty leaves no room for a slow preview server
		// on top of that.
		test.setTimeout(90_000);
		await page.addInitScript(seedInvitationOffered, OFFERED_KEY);
		await page.addInitScript(installBurstingMicrophone);
		await page.goto('./');

		await page.getByRole('button', { name: 'Play' }).click();

		// A frozen audio clock never runs the worklet's process() at all, so the ring
		// would never fill and every poll below would time out on a machine with no
		// realtime audio. That is the environment failing rather than Recognition.
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'no realtime audio clock available');

		await page.getByRole('button', { name: 'Let it listen' }).click();
		// Scoped to the floor because share-control.tsx mounts a live region of its
		// own, and strict mode refuses to choose between two status roles.
		await expect(page.locator('.invitation-floor').getByRole('status')).toHaveText('Listening');

		// The Control Signal half of the Moment: a burst was loud enough over the
		// floor to count as something someone did.
		await expect.poll(() => page.evaluate(readSignal, 'onset')).toBe(1);

		// And the Material half. The worklet posts this on the edge into returning,
		// so a 1 here means the fragment is going out through Ember's Reverb rather
		// than sitting in the ring.
		await expect
			.poll(() => page.evaluate(readSignal, 'recognition'), { timeout: RECOGNITION_ARRIVES_MS })
			.toBe(1);

		// One fragment, one return. Bursts keep arriving every two seconds, so a
		// state machine that re-armed mid-return, or looped the ring, would hold the
		// reading at 1 rather than let it fall back.
		await expect
			.poll(() => page.evaluate(readSignal, 'recognition'), { timeout: RECOGNITION_ENDS_MS })
			.toBe(0);

		// Audibility, which no signal reading covers: a return posted on a path that
		// reaches nothing would satisfy every poll above. Rendered offline so the
		// assertion needs no sound card, and after the polls rather than beside them,
		// because Tone.Offline swaps the global context around the render.
		expect(await page.evaluate(renderMaterialContrast)).toBeGreaterThan(MATERIAL_CONTRAST_THRESHOLD);
	});

	test('a suspension mid-return releases what was held, and the next Moment starts over', async ({ page }): Promise<void> => {
		// Two Moments end to end, each about eight seconds of audio clock away.
		test.setTimeout(120_000);
		await page.addInitScript(seedInvitationOffered, OFFERED_KEY);
		await page.addInitScript(installBurstingMicrophone);
		await page.addInitScript(countReleaseMessages);
		await page.addInitScript(installVisibilityShim);
		await page.goto('./');

		const status = page.locator('.invitation-floor').getByRole('status');

		await page.getByRole('button', { name: 'Play' }).click();
		test.skip(!(await page.evaluate(isRealtimeAudioAvailable)), 'no realtime audio clock available');

		await page.getByRole('button', { name: 'Let it listen' }).click();
		await expect(status).toHaveText('Listening');

		// Read before the wait rather than after it, so the round trip that would
		// otherwise sit between the poll below and the suspension does not eat into
		// the four seconds a return is audible for.
		const releasedBefore = await page.evaluate(releaseCount);

		await expect.poll(() => page.evaluate(readSignal, 'onset')).toBe(1);
		await expect
			.poll(() => page.evaluate(readSignal, 'recognition'), { timeout: RECOGNITION_ARRIVES_MS })
			.toBe(1);

		// The worst moment to take the microphone away: a fragment is halfway out.
		await page.evaluate(setHidden, true);

		// A processor whose process() returns true is an active source the spec keeps
		// alive after disconnect and after the main thread drops the node, so without
		// the release message a Suspension would leave four seconds of the listener's
		// room running in the audio thread until the context closed.
		await expect.poll(() => page.evaluate(releaseCount)).toBeGreaterThan(releasedBefore);
		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended']);

		// Both readings go with the release, in the same synchronous teardown that
		// posted it, so this is a plain read rather than a poll. A `recognition` left
		// at 1 would claim a return that has already been cut off, and the zero here
		// is what makes the 1 further down a new Moment.
		expect(await page.evaluate(readSignal, 'recognition')).toBe(0);
		expect(await page.evaluate(readSignal, 'onset')).toBe(0);

		await page.evaluate(setHidden, false);

		await expect.poll(() => page.evaluate(trackStates)).toEqual(['ended', 'live']);
		await expect(status).toHaveText('Listening');

		// Nothing carried across. The resumed Listening has to hear something new
		// before it can hold anything, and it holds it in a ring that starts empty.
		await expect.poll(() => page.evaluate(readSignal, 'onset')).toBe(1);

		// Still 0 on the block the onset landed in: the window has to fill before the
		// return opens, which is the 3.75s that separates the two halves of a Moment.
		// A resume that had somehow kept the old fragment would read 1 here.
		expect(await page.evaluate(readSignal, 'recognition')).toBe(0);

		await expect
			.poll(() => page.evaluate(readSignal, 'recognition'), { timeout: RECOGNITION_ARRIVES_MS })
			.toBe(1);
	});
});
