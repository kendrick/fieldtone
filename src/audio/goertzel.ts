// Goertzel algorithm for efficient power measurement at a single frequency.
// Used to verify audio content in offline renders where a full FFT would be overkill.

// The Goertzel algorithm computes the power at one frequency by applying
// a recursive second-order filter tuned to that frequency. Normalized by window
// length so that equal-length windows with the same frequency produce comparable
// results regardless of the absolute scale.
export function powerAt(samples: Float32Array, from: number, to: number, hz: number, sampleRate: number): number {
	const windowLength = to - from;
	if (windowLength <= 0) {
		return 0;
	}

	// Normalized frequency: what bin index this frequency maps to in an FFT
	// with length windowLength at the given sampleRate.
	const k = (hz * windowLength) / sampleRate;
	const w = (2 * Math.PI * k) / windowLength;
	const coeff = 2 * Math.cos(w);

	let s0 = 0;
	let s1 = 0;
	let s2 = 0;

	for (let i = from; i < to; i++) {
		// Coalesce out-of-bounds reads to 0, which prevents NaN from silently
		// poisoning the result. With noUncheckedIndexedAccess, this is required
		// for type safety, and it also guards a latent bug in the caller's index math.
		s0 = (samples[i] ?? 0) + coeff * s1 - s2;
		s2 = s1;
		s1 = s0;
	}

	// Normalize by window length squared to make results comparable across
	// different sample counts, so the caller's two-window ratio stays invariant.
	const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (windowLength * windowLength);

	return power;
}
