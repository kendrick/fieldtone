import { describe, expect, it } from 'vitest';

import { powerAt } from './goertzel';

describe('goertzel algorithm', (): void => {
	it('detects high power at the input frequency', (): void => {
		const sampleRate = 48000;
		const frequency = 1000;
		const durationSeconds = 1;
		const sampleCount = sampleRate * durationSeconds;
		const samples = new Float32Array(sampleCount);

		for (let i = 0; i < sampleCount; i++) {
			const phase = (2 * Math.PI * frequency * i) / sampleRate;
			samples[i] = Math.sin(phase);
		}

		const power = powerAt(samples, 0, sampleCount, frequency, sampleRate);

		expect(power).toBeGreaterThan(0.1);
	});

	it('detects near-zero power at offset frequencies', (): void => {
		const sampleRate = 48000;
		const frequency = 1000;
		const durationSeconds = 1;
		const sampleCount = sampleRate * durationSeconds;
		const samples = new Float32Array(sampleCount);

		for (let i = 0; i < sampleCount; i++) {
			const phase = (2 * Math.PI * frequency * i) / sampleRate;
			samples[i] = Math.sin(phase);
		}

		const powerAtOffset = powerAt(samples, 0, sampleCount, frequency + 300, sampleRate);

		expect(powerAtOffset).toBeLessThan(0.01);
	});

	it('detects zero power in silence', (): void => {
		const sampleRate = 48000;
		const durationSeconds = 1;
		const sampleCount = sampleRate * durationSeconds;
		const samples = new Float32Array(sampleCount);

		const power = powerAt(samples, 0, sampleCount, 1000, sampleRate);

		expect(power).toBeLessThan(1e-10);
	});
});
