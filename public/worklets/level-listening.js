import {
	blockRms,
	createOnsetState,
	detectOnset,
	loudnessFromRms,
	onePoleCoefficient,
	smooth,
	SMOOTHING_ATTACK_SECONDS,
	SMOOTHING_RELEASE_SECONDS
} from './level-listening-maths.js';

// Nothing may go above that import, not even this comment. Read on for why.
//
// Level Listening, the shallowest depth: loudness, and the moment something
// happens. Nothing here knows what a sound was.
//
// Hand-written ES modules served straight out of public/. No bundler sees them,
// so the seam to tone-backend.ts is agreement alone: the processor name and the
// { name, value } message shape are written out at both ends, and nothing checks
// that the two still match.
//
// Two rules govern the shape of this file, and both come from the same place.
// Tone's `rawContext` is a standardized-audio-context AudioContext, not a native
// one, so its addModule fetches this source and re-wraps the body in an arrow
// function before loading it from a blob.
//
// First: not one `export` may appear here. A top-level export inside that body
// throws `SyntaxError: Unexpected token 'export'`, the rejection escapes
// startListening, and the microphone never opens. That is why the maths lives
// next door and arrives by import instead.
//
// Second: the import has to lead the file, and its last name carries no
// trailing comma. The wrapper hoists leading imports back out and rewrites their
// specifiers to absolute URLs, but it finds them with a regex anchored to the
// start of the source, having stripped only whitespace, and that regex wants a
// closing brace straight after the last name. A comment above the import, or a
// comma the repo's own style would put after SMOOTHING_RELEASE_SECONDS, leaves
// the import inside the arrow function—the same syntax error by another route.
//
// The class declaration and registerProcessor stay inside the guard at the
// bottom for an unrelated reason: AudioWorkletProcessor does not exist outside
// an AudioWorkletGlobalScope, and `class X extends undefined` throws at
// evaluation, not at construction.

// The render quantum, fixed by the Web Audio spec. Posting loudness every 16
// blocks is 2048 frames, about 43 ms at 48 kHz, so roughly 22 readings a second.
// Fast enough that brightness tracks a room by ear, slow enough that the main
// thread is not fielding a message per 2.7 ms alongside Tone's scheduling.
const RENDER_QUANTUM_FRAMES = 128;
const LOUDNESS_POST_INTERVAL_BLOCKS = 16;

// Everything below runs only inside an AudioWorkletGlobalScope. Outside one, in
// jsdom or in Node during the static export's prerender, the guard is false and
// the class is never declared.
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
