// The arithmetic behind Level Listening, kept in its own module because the
// processor beside it cannot carry an `export`. standardized-audio-context, which
// is what Tone's `rawContext` actually is, fetches a worklet's source and wraps it
// in an arrow function before loading it from a blob, and a top-level `export`
// inside that body is a syntax error at parse time. Its wrapper hoists leading
// `import` statements out and rewrites their specifiers to absolute URLs, so an
// import survives the wrap where an export does not. Splitting the file is what
// lets these functions stay exported and asserted on under jsdom while the
// processor still loads in a browser.
//
// The constants here are starting points rather than results. Every one of them
// answers to how a room sounds, so expect to retune them on a device, in a room.

// The window a normalized loudness spans. -60 dBFS is about where a quiet room
// sits with automatic gain off, and -10 dBFS is a sound made deliberately close
// to the microphone; mapping over that rather than over the full 0..-Infinity
// range is what keeps the useful half of the scale off the very bottom.
export const LOUDNESS_FLOOR_DBFS = -60;
export const LOUDNESS_CEILING_DBFS = -10;

// Fast up, slow down, which is how a level meter has to behave to sound like the
// room rather than like arithmetic. An attack that lags loses the transient a
// clap opens with, and a release that snaps makes brightness step from block to
// block instead of moving.
export const SMOOTHING_ATTACK_SECONDS = 0.03;
export const SMOOTHING_RELEASE_SECONDS = 0.4;

// How far over the tracked floor a block has to sit to count as something
// someone did, and the absolute level below which nothing counts however quiet
// the floor got. The minimum is what stops a silent room from making an onset
// out of its own hiss once the floor has settled far enough down.
const ONSET_MARGIN_DB = 6;
const ONSET_MINIMUM_DBFS = -40;

// Two claps inside this window are one Moment. Also the debounce that keeps a
// level hovering on the threshold from chattering across it.
export const ONSET_HOLD_OFF_SECONDS = 0.25;

// The floor follows a room going quiet quickly and a room getting louder slowly,
// which is the asymmetry the whole detector rests on: a clap outruns the rise
// and reads as margin over the floor, while a fan spinning up or a train pulling
// in is tracked and never fires. Rise is one second rather than the several a
// noise floor would usually take, because a one-pole lags a rising level by the
// drift rate times its time constant, and that lag has to stay under
// ONSET_MARGIN_DB or an ordinary drift starts firing.
const NOISE_FLOOR_RISE_SECONDS = 1;
const NOISE_FLOOR_FALL_SECONDS = 0.25;

// Where an RMS of zero lands on the dB scale. Real -Infinity would stick in the
// floor tracker permanently and make every later block an onset; a headroom
// figure no microphone reaches keeps the arithmetic finite without ever standing
// in for a level something might actually produce.
const SILENCE_DBFS = -120;

// Sum of squares over the block, root of the mean. Silence is 0 and a full-scale
// square wave is 1. An empty block reads 0 rather than the NaN a zero divisor
// gives, because Chromium hands over a zero-length channel for a block where the
// input is disconnected, and a NaN from here rides all the way to a Web Audio
// param and silences that node for the rest of the session.
export function blockRms(samples) {
	if (samples.length === 0) {
		return 0;
	}

	let sumOfSquares = 0;

	for (let frame = 0; frame < samples.length; frame += 1) {
		sumOfSquares += samples[frame] * samples[frame];
	}

	return Math.sqrt(sumOfSquares / samples.length);
}

// dBFS, with silence and NaN both reading as 0 rather than escaping into the
// signal. clampSignalValue in src/scenes/control-signals.ts catches a non-finite
// value downstream, but a producer that emits one is a bug here, not something
// to lean on the clamp for. The `!(rms > 0)` shape is deliberate, because it
// catches NaN, which every ordinary comparison lets through.
export function loudnessFromRms(rms) {
	if (!(rms > 0)) {
		return 0;
	}

	const dbfs = 20 * Math.log10(rms);
	const normalized = (dbfs - LOUDNESS_FLOOR_DBFS) / (LOUDNESS_CEILING_DBFS - LOUDNESS_FLOOR_DBFS);

	return Math.min(1, Math.max(0, normalized));
}

// The per-step blend of a one-pole filter with this time constant. Exponential
// rather than a plain fraction, so the smoothing means the same thing at 44.1 kHz
// as at 48. A raw per-block coefficient smooths 9% faster at the higher rate.
export function onePoleCoefficient(timeConstantSeconds, stepSeconds) {
	if (timeConstantSeconds <= 0) {
		return 1;
	}

	return 1 - Math.exp(-stepSeconds / timeConstantSeconds);
}

// One pole, two coefficients, picked by direction of travel.
export function smooth(previous, target, attackCoefficient, releaseCoefficient) {
	const coefficient = target > previous ? attackCoefficient : releaseCoefficient;

	return previous + (target - previous) * coefficient;
}

// Onset carries state across blocks, and that state is passed in rather than
// held at module scope. Module scope is evaluated once per worklet global, so a
// value parked there would be shared by every processor in that scope and would
// be unreachable from a test. One of these per processor, built in its
// constructor.
//
// The coefficients are baked in here rather than derived per block because they
// depend only on the sample rate, which cannot change under a running processor.
export function createOnsetState(blockSeconds) {
	return {
		blockSeconds,
		riseCoefficient: onePoleCoefficient(NOISE_FLOOR_RISE_SECONDS, blockSeconds),
		fallCoefficient: onePoleCoefficient(NOISE_FLOOR_FALL_SECONDS, blockSeconds),
		// Unseeded. Listening starts in whatever room it starts in, and there is
		// nothing to compare a first block against, so the first one sets the floor
		// instead of reading as a sound.
		seeded: false,
		noiseFloorDbfs: SILENCE_DBFS,
		holdOffRemainingSeconds: 0,
		// Cleared on a fire, and set again only once the level has fallen back under
		// the threshold. Without it a sound that goes on holding outlasts the hold-off
		// and fires again, four times a second, until the floor has climbed to meet
		// it. A Recognition wants the start of a sound, not a report that it is still
		// going.
		armed: true,
	};
}

// Reads one block and answers whether a Moment started in it. The next state is
// written back into `state` rather than returned as a fresh object. process()
// runs 375 times a second on the one thread in the app that must never pause,
// and an object per block is garbage that thread would pay for.
export function detectOnset(state, rms) {
	const dbfs = rms > 0 ? Math.max(SILENCE_DBFS, 20 * Math.log10(rms)) : SILENCE_DBFS;

	if (!state.seeded) {
		state.seeded = true;
		state.noiseFloorDbfs = dbfs;

		return false;
	}

	state.holdOffRemainingSeconds = Math.max(0, state.holdOffRemainingSeconds - state.blockSeconds);

	const threshold = Math.max(state.noiseFloorDbfs + ONSET_MARGIN_DB, ONSET_MINIMUM_DBFS);
	const over = dbfs > threshold;
	const fired = over && state.armed && state.holdOffRemainingSeconds === 0;

	if (fired) {
		state.armed = false;
		state.holdOffRemainingSeconds = ONSET_HOLD_OFF_SECONDS;
	}
	else if (!over) {
		state.armed = true;
	}

	const coefficient = dbfs > state.noiseFloorDbfs ? state.riseCoefficient : state.fallCoefficient;
	state.noiseFloorDbfs += (dbfs - state.noiseFloorDbfs) * coefficient;

	return fired;
}
