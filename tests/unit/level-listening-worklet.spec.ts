import { describe, expect, it } from 'vitest';

import {
	blockRms,
	createOnsetState,
	detectOnset,
	LOUDNESS_CEILING_DBFS,
	LOUDNESS_FLOOR_DBFS,
	loudnessFromRms,
	onePoleCoefficient,
	ONSET_HOLD_OFF_SECONDS,
	smooth,
	SMOOTHING_ATTACK_SECONDS,
	SMOOTHING_RELEASE_SECONDS,
} from '../../public/worklets/level-listening-maths.js';

// The maths sits in its own module so it can be imported here at all. The
// processor beside it may not carry an `export`, because standardized-audio-context
// re-wraps a worklet's source in an arrow function before loading it and a
// top-level export inside that body is a syntax error. Nothing in this file
// reaches AudioWorkletProcessor or registerProcessor, neither of which jsdom has.

// The render quantum every Web Audio implementation uses, at the rate the
// browsers this ships to report. The hold-off and both one-pole coefficients are
// measured in block durations, so driving the maths at anything else would pin
// numbers the processor never sees.
const BLOCK_FRAMES = 128;
const SAMPLE_RATE = 48_000;
const BLOCK_SECONDS = BLOCK_FRAMES / SAMPLE_RATE;

// A quiet room and a sound someone made in it. The quiet one sits under the
// absolute minimum an onset has to clear; the loud one is well over it.
const QUIET_ROOM_DBFS = -60;
const DELIBERATE_SOUND_DBFS = -20;

function rmsFromDbfs(dbfs: number): number {
	return 10 ** (dbfs / 20);
}

function blocks(seconds: number): number {
	return Math.round(seconds / BLOCK_SECONDS);
}

// Holds a level for a while and counts what onset made of it. The state object
// is threaded back in on every call, which is the reason for the shape. The
// worklet keeps exactly one per processor, and module scope keeps none.
function hold(state: ReturnType<typeof createOnsetState>, dbfs: number, seconds: number): number {
	const rms = rmsFromDbfs(dbfs);
	let fires = 0;

	for (let block = 0; block < blocks(seconds); block += 1) {
		if (detectOnset(state, rms)) {
			fires += 1;
		}
	}

	return fires;
}

describe('blockRms', (): void => {
	it('reads silence as zero', (): void => {
		expect(blockRms(new Float32Array(BLOCK_FRAMES))).toBe(0);
	});

	it('reads a full-scale square wave as one', (): void => {
		const square = new Float32Array(BLOCK_FRAMES);

		for (let frame = 0; frame < BLOCK_FRAMES; frame += 1) {
			square[frame] = frame % 2 === 0 ? 1 : -1;
		}

		expect(blockRms(square)).toBe(1);
	});

	// Chromium hands the processor a zero-length channel for a block where the
	// input is disconnected, and a sum of squares over nothing divides by zero.
	it('reads an empty block as zero rather than NaN', (): void => {
		expect(blockRms(new Float32Array(0))).toBe(0);
	});
});

describe('loudnessFromRms', (): void => {
	it('reads the floor as zero', (): void => {
		expect(loudnessFromRms(rmsFromDbfs(LOUDNESS_FLOOR_DBFS))).toBe(0);
	});

	it('reads the ceiling as full scale', (): void => {
		expect(loudnessFromRms(rmsFromDbfs(LOUDNESS_CEILING_DBFS))).toBe(1);
	});

	it('reads the midpoint between them as half scale', (): void => {
		const midpoint = (LOUDNESS_FLOOR_DBFS + LOUDNESS_CEILING_DBFS) / 2;

		expect(loudnessFromRms(rmsFromDbfs(midpoint))).toBe(0.5);
	});

	it('clamps a room quieter than the floor to zero', (): void => {
		expect(loudnessFromRms(rmsFromDbfs(LOUDNESS_FLOOR_DBFS - 30))).toBe(0);
	});

	it('clamps a room louder than the ceiling to full scale', (): void => {
		expect(loudnessFromRms(1)).toBe(1);
	});

	// Math.log10(0) is -Infinity, and a signal producer that emits one is a bug
	// at the source rather than something to leave for the clamp downstream.
	it('reads an RMS of zero as zero', (): void => {
		expect(loudnessFromRms(0)).toBe(0);
	});

	it('reads NaN as zero', (): void => {
		expect(loudnessFromRms(Number.NaN)).toBe(0);
	});
});

describe('smooth', (): void => {
	const attack = onePoleCoefficient(SMOOTHING_ATTACK_SECONDS, BLOCK_SECONDS);
	const release = onePoleCoefficient(SMOOTHING_RELEASE_SECONDS, BLOCK_SECONDS);

	// A one-pole approaches its target and never lands on it, so "settled" is a
	// tolerance, not equality. A hundredth of full scale is finer than brightness
	// resolves by ear.
	const SETTLED = 0.01;

	function blocksToSettle(from: number, to: number): number {
		let value = from;
		let elapsed = 0;

		while (Math.abs(to - value) > SETTLED) {
			value = smooth(value, to, attack, release);
			elapsed += 1;
		}

		return elapsed;
	}

	it('moves further towards a rise than towards a fall of the same size', (): void => {
		expect(smooth(0, 1, attack, release)).toBeGreaterThan(1 - smooth(1, 0, attack, release));
	});

	it('settles a rise in fewer blocks than the fall back down', (): void => {
		expect(blocksToSettle(0, 1)).toBeLessThan(blocksToSettle(1, 0));
	});

	it('leaves a reading already on its target alone', (): void => {
		expect(smooth(0.5, 0.5, attack, release)).toBe(0.5);
	});
});

describe('detectOnset', (): void => {
	// Nothing to compare a first block against, and Listening starts in whatever
	// room it starts in. Firing here would arm a Recognition on the press itself.
	it('takes the first block it sees as the floor rather than as a sound', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);

		expect(detectOnset(state, rmsFromDbfs(-6))).toBe(false);
	});

	it('fires on a step from a quiet room to a deliberate sound', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);

		expect(hold(state, QUIET_ROOM_DBFS, 1)).toBe(0);
		expect(hold(state, DELIBERATE_SOUND_DBFS, ONSET_HOLD_OFF_SECONDS)).toBe(1);
	});

	it('fires once for a sound that goes on holding, not once per hold-off', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);
		hold(state, QUIET_ROOM_DBFS, 1);

		expect(hold(state, DELIBERATE_SOUND_DBFS, ONSET_HOLD_OFF_SECONDS * 8)).toBe(1);
	});

	it('swallows a second sound inside the hold-off and takes the one after it', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);
		hold(state, QUIET_ROOM_DBFS, 1);

		expect(hold(state, DELIBERATE_SOUND_DBFS, 0.02)).toBe(1);
		hold(state, QUIET_ROOM_DBFS, ONSET_HOLD_OFF_SECONDS / 2);
		expect(hold(state, DELIBERATE_SOUND_DBFS, 0.02)).toBe(0);
		hold(state, QUIET_ROOM_DBFS, ONSET_HOLD_OFF_SECONDS);
		expect(hold(state, DELIBERATE_SOUND_DBFS, 0.02)).toBe(1);
	});

	it('stays quiet through a steady floor', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);

		expect(hold(state, QUIET_ROOM_DBFS, 5)).toBe(0);
	});

	// Above the absolute minimum, so the margin over the tracked floor is what
	// keeps this case quiet rather than the minimum doing it for free.
	it('stays quiet through a steady floor loud enough to clear the minimum', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);

		expect(hold(state, -30, 5)).toBe(0);
	});

	// An air conditioner starting up, or a train pulling in: 30 dB over twenty
	// seconds, straight through the absolute minimum. The floor has to climb with
	// it, because a Recognition armed by the room warming up is a false Moment.
	it('stays quiet while the floor drifts up past the minimum', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);
		const total = blocks(20);
		let fires = 0;

		for (let block = 0; block < total; block += 1) {
			if (detectOnset(state, rmsFromDbfs(-60 + (30 * block) / total))) {
				fires += 1;
			}
		}

		expect(fires).toBe(0);
	});

	// Silence is an RMS of exactly 0, whose dBFS is -Infinity. Letting that into
	// the floor tracker leaves it at -Infinity forever and every later block
	// reads as an onset.
	it('survives outright silence and still hears the sound after it', (): void => {
		const state = createOnsetState(BLOCK_SECONDS);

		for (let block = 0; block < blocks(1); block += 1) {
			expect(detectOnset(state, 0)).toBe(false);
		}

		expect(hold(state, DELIBERATE_SOUND_DBFS, ONSET_HOLD_OFF_SECONDS)).toBe(1);
	});
});
