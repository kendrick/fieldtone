import { describe, expect, it } from 'vitest';

import {
	createMaterialState,
	holdMaterial,
	MATERIAL_SECONDS,
	PRE_ROLL_SECONDS,
	releaseMaterial,
	RETURN_FADE_SECONDS,
	returnMaterial,
} from '../../public/worklets/material-maths.js';

// The maths sits in its own module for the same reason Level Listening's does.
// The processor beside it may not carry an `export`, because standardized-audio-context
// re-wraps a worklet's source in an arrow function before loading it. Nothing here
// reaches AudioWorkletProcessor, which jsdom has never heard of.
//
// Principle I is NON-NEGOTIABLE and this is the first code in the repo that holds
// raw audio at all, so the four-second bound and the zeroing are proved here
// rather than respected by convention. No assertion in this file may be relaxed
// to make an implementation pass.

// The render quantum every Web Audio implementation uses, at the rate the
// browsers this ships to report. Driving the maths at anything else would pin
// numbers the processor never sees.
const BLOCK_FRAMES = 128;
const SAMPLE_RATE = 48_000;

type MaterialState = ReturnType<typeof createMaterialState>;

interface Feeder {
	feed: (blockCount: number, onsetAtBlock?: number) => void;
	frame: () => number;
}

// Every sample carries its own frame index, so a frame that comes back names the
// place it came from. Without that, a pre-roll case could only check the shape of
// the fragment, never whether the attack is the thing inside it.
function createFeeder(state: MaterialState): Feeder {
	const block = new Float32Array(BLOCK_FRAMES);
	let written = 0;

	return {
		feed(blockCount: number, onsetAtBlock = -1): void {
			for (let index = 0; index < blockCount; index += 1) {
				for (let offset = 0; offset < BLOCK_FRAMES; offset += 1) {
					block[offset] = written + offset;
				}

				holdMaterial(state, block, index === onsetAtBlock);
				written += BLOCK_FRAMES;
			}
		},
		frame: (): number => written,
	};
}

// The window fills at block granularity, so blocks go in one at a time rather
// than counted out in advance.
function feedToReturning(state: MaterialState, feeder: Feeder): void {
	const limit = (2 * state.capacity) / BLOCK_FRAMES;

	for (let index = 0; index < limit && state.status !== 'returning'; index += 1) {
		feeder.feed(1);
	}

	expect(state.status).toBe('returning');
}

// Reads the fragment out a block at a time into one contiguous array, so a
// returned frame is addressable by its position in the fragment. The limit guards
// against a return that loops; nothing real should reach it.
function drainReturn(state: MaterialState): { returned: Float32Array; blocks: number } {
	const limit = (2 * state.capacity) / BLOCK_FRAMES;
	const returned = new Float32Array((limit + 1) * BLOCK_FRAMES);
	let blocks = 0;

	while (
		blocks < limit
		&& returnMaterial(state, returned.subarray(blocks * BLOCK_FRAMES, (blocks + 1) * BLOCK_FRAMES))
	) {
		blocks += 1;
	}

	return { returned, blocks };
}

function isAllZero(samples: Float32Array): boolean {
	return samples.every((sample: number): boolean => sample === 0);
}

describe('holdMaterial', (): void => {
	// Principle I caps what Listening may hold at ten seconds, and this Scene wants
	// four. The claim under test is that the ring cannot grow past four seconds
	// however long Listening runs, in one buffer rather than a fresh one per wrap.
	it('holds four seconds and never more, in a single buffer', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);
		const ring = state.ring;

		expect(MATERIAL_SECONDS).toBe(4);
		expect(state.capacity).toBe(Math.round(MATERIAL_SECONDS * SAMPLE_RATE));
		expect(state.ring.length).toBe(state.capacity);
		expect(state.preRollFrames).toBe(Math.round(PRE_ROLL_SECONDS * SAMPLE_RATE));
		expect(state.fade.length).toBe(Math.round(RETURN_FADE_SECONDS * SAMPLE_RATE));
		expect(state.status).toBe('idle');

		const totalBlocks = (10 * state.capacity) / BLOCK_FRAMES;

		for (let index = 0; index < totalBlocks; index += 1) {
			feeder.feed(1);

			if (state.held > state.capacity) {
				throw new Error(`held ${state.held} frames, over a capacity of ${state.capacity}`);
			}
		}

		expect(state.held).toBe(state.capacity);
		expect(state.ring).toBe(ring);
	});

	// A quarter second of reach covers the attack of anything the onset detector can
	// fire on. The frame values make that checkable, because the fragment has to open
	// a quarter second before the trigger rather than at it.
	it('reaches back a quarter second so the attack comes back with the sound', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		// Well past a full ring, so the pre-roll is bounded by the quarter second
		// rather than by how little has been heard.
		feeder.feed(state.capacity / BLOCK_FRAMES + 500);

		const onsetFrame = feeder.frame();
		feeder.feed(1, 0);
		feedToReturning(state, feeder);

		const { returned } = drainReturn(state);
		const attack = onsetFrame - state.preRollFrames;

		for (const offset of [0, 1, 137, 5000]) {
			const index = state.fade.length + offset;

			expect(returned[index]).toBe(attack + index);
		}
	});

	// An onset in the first fraction of a second has no quarter second behind it.
	// Reaching back the full pre-roll anyway would open the fragment in the far
	// end of the ring, which holds nothing yet.
	it('clamps the pre-roll to what has been heard when the onset comes early', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(2);

		expect(state.held).toBeLessThan(state.preRollFrames);

		feeder.feed(1, 0);
		feedToReturning(state, feeder);

		const { returned } = drainReturn(state);

		// Frame zero is the earliest thing there is, so the fragment opens there.
		expect(returned[state.fade.length]).toBe(state.fade.length);
	});

	// One fragment and one return. A second onset inside the window would blur the
	// question this path exists to answer.
	it('takes one onset per fragment and ignores the ones inside it', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(state.capacity / BLOCK_FRAMES);
		feeder.feed(1, 0);

		const armed = state.start;

		feeder.feed(50, 10);

		expect(state.status).toBe('holding');
		expect(state.start).toBe(armed);

		feedToReturning(state, feeder);

		// Frozen while the fragment reads out, so the read never races the write.
		const frozenWrite = state.writeIndex;
		const frozenRing = Float32Array.from(state.ring);

		feeder.feed(20, 0);

		expect(state.status).toBe('returning');
		expect(state.start).toBe(armed);
		expect(state.writeIndex).toBe(frozenWrite);
		expect(state.ring).toEqual(frozenRing);

		drainReturn(state);

		expect(state.status).toBe('idle');
	});
});

describe('returnMaterial', (): void => {
	it('returns exactly four seconds, once, and then goes quiet', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(state.capacity / BLOCK_FRAMES);
		feeder.feed(1, 0);
		feedToReturning(state, feeder);

		const { blocks } = drainReturn(state);

		expect(blocks * BLOCK_FRAMES).toBe(state.capacity);
		expect(state.status).toBe('idle');

		const output = new Float32Array(BLOCK_FRAMES);

		expect(returnMaterial(state, output)).toBe(false);
		expect(isAllZero(output)).toBe(true);
	});

	// The fragment opens and closes wherever the ring happened to be, so without
	// the fades both edges are a step discontinuity and both click.
	it('fades the fragment in and out and leaves the middle alone', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(state.capacity / BLOCK_FRAMES + 500);

		const onsetFrame = feeder.frame();
		feeder.feed(1, 0);
		feedToReturning(state, feeder);

		// Read while the ring is frozen, so the zeroing afterwards cannot make the
		// edge assertions pass for free.
		const firstHeld = state.ring[state.start];
		const lastHeld = state.ring[(state.start + state.capacity - 1) % state.capacity];

		expect(firstHeld).not.toBe(0);
		expect(lastHeld).not.toBe(0);

		const { returned } = drainReturn(state);
		const middle = state.capacity / 2;

		expect(returned[0]).toBe(0);
		expect(returned[state.capacity - 1]).toBe(0);
		expect(returned[middle]).toBe(onsetFrame - state.preRollFrames + middle);
	});

	// Suspension zeroes whatever Listening held, and so does the end of a return.
	// Nothing the listener said stays in memory once the Moment has used it.
	it('zeroes the ring the moment the fragment has come back', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(state.capacity / BLOCK_FRAMES);
		feeder.feed(1, 0);
		feedToReturning(state, feeder);

		expect(isAllZero(state.ring)).toBe(false);

		drainReturn(state);

		expect(isAllZero(state.ring)).toBe(true);
		expect(state.held).toBe(0);
	});
});

describe('releaseMaterial', (): void => {
	// The mid-holding case is the one Suspension actually hits: the listener
	// backgrounds the app between the sound and its return.
	it('zeroes every sample mid-holding and returns nothing afterwards', (): void => {
		const state = createMaterialState(SAMPLE_RATE);
		const feeder = createFeeder(state);

		feeder.feed(200);
		feeder.feed(1, 0);
		feeder.feed(100);

		expect(state.status).toBe('holding');
		expect(isAllZero(state.ring)).toBe(false);

		releaseMaterial(state);

		expect(state.status).toBe('idle');
		expect(state.held).toBe(0);
		expect(isAllZero(state.ring)).toBe(true);

		const output = new Float32Array(BLOCK_FRAMES);

		expect(returnMaterial(state, output)).toBe(false);
		expect(isAllZero(output)).toBe(true);
	});
});
