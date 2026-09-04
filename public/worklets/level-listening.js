// Level Listening, the shallowest depth: loudness, and the moment something
// happens. Nothing here knows what a sound was.
//
// Hand-written ES module served straight out of public/. No bundler sees it, so
// nothing here may import, and the seam to tone-backend.ts is agreement alone.
// The processor name and the { name, value } message shape are written out at
// both ends, and nothing checks that the two still match.
//
// Worklet scripts are module scripts, which is what lets the maths below be
// exported and asserted on under jsdom. That holds only while the class
// declaration and registerProcessor stay inside the guard at the bottom:
// AudioWorkletProcessor does not exist outside an AudioWorkletGlobalScope, and
// `class X extends undefined` throws at evaluation, not at construction.
//
// The constants below are starting points rather than results. Every one of them
// answers to how a room sounds, so expect to retune them on a device, in a room.

// The render quantum, fixed by the Web Audio spec. Posting loudness every 16
// blocks is 2048 frames, about 43 ms at 48 kHz, so roughly 22 readings a second.
// Fast enough that brightness tracks a room by ear, slow enough that the main
// thread is not fielding a message per 2.7 ms alongside Tone's scheduling.
const RENDER_QUANTUM_FRAMES = 128;
const LOUDNESS_POST_INTERVAL_BLOCKS = 16;

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

// Everything below runs only inside an AudioWorkletGlobalScope. Outside one, in
// jsdom or in Node during the static export's prerender, the guard is false, the
// class is never declared, and importing this file costs a handful of constants.
if (typeof registerProcessor === 'function') {
	class LevelListeningProcessor extends AudioWorkletProcessor {
		constructor() {
			super();

			// `sampleRate` is an AudioWorkletGlobalScope global, which is the other
			// reason none of this can live outside the guard.
			const blockSeconds = RENDER_QUANTUM_FRAMES / sampleRate;

			this.attackCoefficient = onePoleCoefficient(SMOOTHING_ATTACK_SECONDS, blockSeconds);
			this.releaseCoefficient = onePoleCoefficient(SMOOTHING_RELEASE_SECONDS, blockSeconds);
			this.onset = createOnsetState(blockSeconds);
			this.loudness = 0;
			this.blocksSincePost = 0;
			// One message object for the life of the processor. postMessage clones its
			// argument synchronously, so the receiver never sees this instance and
			// reuse is safe. A fresh object per post is the only allocation process()
			// would otherwise still be making.
			this.message = { name: 'loudness', value: 0 };
		}

		// Never writes to outputs. The node is connected to the master bus because an
		// analysis node nothing reaches from the destination is never pulled and never
		// runs; the Web Audio spec zeroes the output buffers before each call, so
		// leaving them alone is what makes that connection silent.
		process(inputs) {
			const input = inputs[0];
			const channel = input === undefined ? undefined : input[0];

			// No input this block, because the microphone track ended or the node is
			// not wired yet. Returning true keeps the processor alive for when it is.
			if (channel === undefined) {
				return true;
			}

			const rms = blockRms(channel);

			this.loudness = smooth(
				this.loudness,
				loudnessFromRms(rms),
				this.attackCoefficient,
				this.releaseCoefficient,
			);

			// Posted on the block it happens rather than on the loudness cadence,
			// because a Recognition is armed by when a sound started and 43 ms of
			// rounding is audible on a transient.
			if (detectOnset(this.onset, rms)) {
				this.message.name = 'onset';
				this.message.value = 1;
				this.port.postMessage(this.message);
			}

			this.blocksSincePost += 1;

			if (this.blocksSincePost >= LOUDNESS_POST_INTERVAL_BLOCKS) {
				this.blocksSincePost = 0;
				this.message.name = 'loudness';
				this.message.value = this.loudness;
				this.port.postMessage(this.message);
			}

			return true;
		}
	}

	registerProcessor('level-listening', LevelListeningProcessor);
}
