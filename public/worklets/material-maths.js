// The arithmetic behind Recognition, kept in its own module for the same reason
// level-listening-maths.js is. The processor beside it cannot carry an `export`,
// because standardized-audio-context, which is what Tone's `rawContext` actually
// is, fetches a worklet's source and wraps it in an arrow function before loading
// it from a blob, and a top-level `export` inside that body is a syntax error at
// parse time. Splitting the file is what lets these functions be asserted on under
// jsdom while the processor still loads in a browser.
//
// Everything here runs on the audio thread, so createMaterialState is the only
// function that allocates. The copies below are plain loops rather than `.set`
// calls, because `.set` wants a view of its source and a view per block is garbage
// that thread pays for 375 times a second.

// Four seconds sits well inside the ten-second ceiling Principle I sets, and that
// ceiling is why the number is named here instead of sitting inline in the ring's
// constructor. Whether four is the right length is the listening test's question.
export const MATERIAL_SECONDS = 4;

// How far behind the trigger the fragment opens. Onset detection fires after a
// sound has begun, so a fragment that starts at the trigger has already lost the
// attack, and the attack is what makes a clap sound like the listener's clap
// rather than like a recording of a room. A quarter second matches
// ONSET_HOLD_OFF_SECONDS. The detector fires within a block of a transient and
// then holds off that long, so a quarter second of reach covers the attack of
// anything it can fire on.
export const PRE_ROLL_SECONDS = 0.25;

// The fragment opens and closes wherever the ring happened to be, which leaves a
// step discontinuity at both edges, and a step clicks. 15 ms is long enough to
// swallow it and short enough that the attack still arrives as an attack.
export const RETURN_FADE_SECONDS = 0.015;

// One of these per processor, built in its constructor. Module scope is evaluated
// once per worklet global, so a ring parked there would be shared by every
// processor in that scope and would be unreachable from a test—the standard
// createOnsetState already sets next door.
//
// `ring` is the only audio buffer this path has, and `held` saturating at
// `capacity` is what keeps the four-second bound a property of the arithmetic
// rather than of the caller's discipline.
export function createMaterialState(sampleRate) {
	const capacity = Math.round(MATERIAL_SECONDS * sampleRate);
	const fadeFrames = Math.round(RETURN_FADE_SECONDS * sampleRate);
	const fade = new Float32Array(fadeFrames);

	// Raised cosine rather than a line, because a linear ramp has a corner at each
	// end and a corner is audible on a fade this short. Precomputed here for the
	// same reason the onset coefficients are. The window depends only on the sample
	// rate, which cannot change under a running processor.
	const span = Math.max(1, fadeFrames - 1);

	for (let frame = 0; frame < fadeFrames; frame += 1) {
		fade[frame] = 0.5 * (1 - Math.cos((Math.PI * frame) / span));
	}

	return {
		ring: new Float32Array(capacity),
		capacity,
		preRollFrames: Math.round(PRE_ROLL_SECONDS * sampleRate),
		fade,
		writeIndex: 0,
		// Frames of real input in the ring, which is under `capacity` until Listening
		// has run for four seconds. The pre-roll clamps to `held` so an early onset
		// cannot reach back into a stretch nothing has written.
		held: 0,
		// idle → holding → returning → idle. holdMaterial ignores an onset outside
		// idle, which is what keeps a Moment to one fragment and one return.
		status: 'idle',
		start: 0,
		toHold: 0,
		read: 0,
	};
}

// Rolls the block into the ring and arms the fragment when a Moment starts. The
// next state is written back into `state` rather than returned as a fresh object,
// because an object per block is garbage the audio thread would pay for.
//
// Arming reads `writeIndex` and `held` as they stand on entry, so the pre-roll
// comes out of what the ring already holds and the onset's own block counts
// towards what is still to come.
export function holdMaterial(state, input, onset) {
	// The ring is frozen while the fragment reads out, so the read never races the
	// write and a second onset cannot re-arm mid-return.
	if (state.status === 'returning') {
		return;
	}

	const capacity = state.capacity;
	const ring = state.ring;
	const frames = input.length;

	if (onset && state.status === 'idle') {
		const preRoll = Math.min(state.preRollFrames, state.held);

		state.start = (state.writeIndex - preRoll + capacity) % capacity;
		state.toHold = capacity - preRoll;
		state.status = 'holding';
	}

	let index = state.writeIndex;

	for (let frame = 0; frame < frames; frame += 1) {
		ring[index] = input[frame];
		index += 1;

		if (index === capacity) {
			index = 0;
		}
	}

	state.writeIndex = index;
	state.held = Math.min(capacity, state.held + frames);

	if (state.status === 'holding') {
		// A block can carry `toHold` past zero, since the window is not a whole number
		// of blocks. The overshoot overwrites the opening frames of the fragment,
		// which are under the fade-in and inaudible either way.
		state.toHold -= frames;

		if (state.toHold <= 0) {
			state.toHold = 0;
			state.status = 'returning';
			state.read = 0;
		}
	}
}

// Writes the next block of the fragment into `output` and answers whether it wrote
// anything. A false leaves `output` alone, which the Web Audio spec has already
// zeroed. Filling it here would cost a write on every block of a session that is
// mostly not returning.
//
// The ring is zeroed the moment the last frame goes out, because nothing the
// listener said should stay in memory a block longer than the Moment needs it.
export function returnMaterial(state, output) {
	if (state.status !== 'returning') {
		return false;
	}

	const capacity = state.capacity;
	const ring = state.ring;
	const fade = state.fade;
	const fadeFrames = fade.length;
	const read = state.read;
	const frames = Math.min(output.length, capacity - read);

	let index = (state.start + read) % capacity;

	for (let frame = 0; frame < frames; frame += 1) {
		const position = read + frame;
		const fromEnd = capacity - 1 - position;

		let gain = 1;

		if (position < fadeFrames) {
			gain = fade[position];
		}
		else if (fromEnd < fadeFrames) {
			gain = fade[fromEnd];
		}

		output[frame] = ring[index] * gain;
		index += 1;

		if (index === capacity) {
			index = 0;
		}
	}

	state.read = read + frames;

	if (state.read >= capacity) {
		ring.fill(0);
		state.held = 0;
		state.read = 0;
		state.status = 'idle';
	}

	return true;
}

// What Suspension calls. A Suspension zeroes whatever Listening held, and this
// module holds all of it: one ring and the counters that index into it. The state
// stays usable afterwards, because consent survives a Suspension and Listening
// resumes without asking again.
export function releaseMaterial(state) {
	state.ring.fill(0);
	state.writeIndex = 0;
	state.held = 0;
	state.status = 'idle';
	state.start = 0;
	state.toHold = 0;
	state.read = 0;
}
