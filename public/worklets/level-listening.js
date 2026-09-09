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
import {
	createMaterialState,
	holdMaterial,
	releaseMaterial,
	returnMaterial
} from './material-maths.js';
// Nothing may go above those imports, not even this comment. Read on for why.
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
// Second: the imports have to lead the file, back to back, and neither one's
// last name carries a trailing comma. The wrapper hoists leading imports back out
// and rewrites their specifiers to absolute URLs, but it finds them with a regex
// anchored to the start of the source, having stripped only whitespace, and that
// regex wants a closing brace straight after the last name. A comment above
// either one, or a comma the repo's own style would put after
// SMOOTHING_RELEASE_SECONDS or returnMaterial, leaves an import inside the arrow
// function—the same syntax error by another route. A third module goes
// directly under the second, in the same shape.
//
// The class declaration and registerProcessor stay inside the guard at the
// bottom for an unrelated reason: AudioWorkletProcessor does not exist outside
// an AudioWorkletGlobalScope, and `class X extends undefined` throws at
// evaluation, not at construction.

// The render quantum, fixed by the Web Audio spec. Posting loudness every 16
// blocks is 2048 frames, which is 43 ms and 23 readings a second at 48 kHz, and
// 46 ms and 22 readings at 44.1. An iPhone 15 Pro on iOS 26.6.1 reports 48 kHz.
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
			// Recognition's ring and state machine, one per processor for the reason
			// createMaterialState's own comment gives. `materialStatus` is this file's
			// memory of what the state read last block: the state itself carries no
			// history, and posting on every change would tell the main thread about
			// idle-to-holding too, which nothing outside this file needs to know.
			this.material = createMaterialState(sampleRate);
			this.materialStatus = this.material.status;
			this.loudness = 0;
			this.blocksSincePost = 0;
			// One message object for the life of the processor. postMessage clones its
			// argument synchronously, so the receiver never sees this instance and
			// reuse is safe. A fresh object per post is the only allocation process()
			// would otherwise still be making.
			this.message = { name: 'loudness', value: 0 };
			// Set once and read every block rather than compared against a status, so a
			// released processor cannot be resurrected by a message arriving out of
			// order. A Suspension zeroes the ring; this stops the block after that from
			// ever writing into it again.
			this.released = false;

			// stopListening posts this before it disconnects and drops the node, because
			// a processor whose process() returns true is an active source the spec
			// keeps alive regardless of what the main thread still references.
			this.port.onmessage = (event) => {
				if (event.data.name === 'release') {
					releaseMaterial(this.material);
					this.released = true;
				}
			};
		}

		// Writes outputs[0] whenever Recognition has a fragment to return, and leaves
		// the buffers alone every other block, which the Web Audio spec has already
		// zeroed. The node stays connected downstream regardless of which blocks
		// write: an analysis path nothing reaches from the destination is never
		// pulled and process() never runs at all.
		process(inputs, outputs) {
			if (this.released) {
				return false;
			}

			const output = outputs[0];
			const wroteMaterial = returnMaterial(this.material, output[0]);

			// The node defaults to two output channels; a caller downstream of only
			// the first hears nothing on the right. Filling in the rest is done from
			// the fragment itself, never from the ring twice, so a fade is applied once.
			if (wroteMaterial) {
				for (let channelIndex = 1; channelIndex < output.length; channelIndex += 1) {
					output[channelIndex].set(output[0]);
				}
			}

			// Posted only on the edge into or out of returning, not on idle-to-holding,
			// which is what keeps this message meaning "the Moment is audible now."
			if (this.material.status !== this.materialStatus) {
				if (this.material.status === 'returning' || this.materialStatus === 'returning') {
					this.message.name = 'recognition';
					this.message.value = this.material.status === 'returning' ? 1 : 0;
					this.port.postMessage(this.message);
				}

				this.materialStatus = this.material.status;
			}

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
			const onset = detectOnset(this.onset, rms);

			if (onset) {
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

			// holdMaterial already no-ops while returning, since the ring is frozen so
			// the read never races the write; the guard here is belt-and-braces, kept
			// because it says the same thing at the call site.
			if (this.material.status !== 'returning') {
				holdMaterial(this.material, channel, onset);
			}

			return true;
		}
	}

	registerProcessor('level-listening', LevelListeningProcessor);
}
