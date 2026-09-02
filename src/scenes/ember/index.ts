import type { BedHandle, BedHost, Scene } from '../scene';
import type { Voice } from './voicing';
import * as Tone from 'tone';
import { drawVoicing } from './voicing';

// Tuned against renderBedRms over 40 draws in Chrome: this lands the median
// second-half RMS near 0.20, with the middle 80 percent of draws between about
// 0.15 and 0.25. The spread is the voicing doing its job, not drift—chord
// ratio, detune spread and filter phase all move the level—so no one constant
// puts every draw in that band, and the quietest draw still clears the e2e
// audible threshold of 0.05 by roughly 2.6x. Retune here if the graph changes.
const BED_LEVEL = 0.34;

const REVERB_DECAY_SECONDS = 4;
const REVERB_PRE_DELAY_SECONDS = 0.02;
const REVERB_WET = 0.35;

// The floor sits above the highest fundamental any draw can produce: G2 at 98 Hz
// times the widest partner ratio, 2.25, gives 220.5 Hz. So the sweep thins the
// timbre without ever dipping toward silence, and the level stays predictable
// across draws. Widen either table in voicing.ts and this margin needs rechecking.
const FILTER_FLOOR_HZ = 400;
const FILTER_CEILING_HZ = 1600;

const DETUNE_DEPTH_CENTS = 6;
const OSCILLATORS_PER_VOICE = 3;

interface DriftingVoice {
	readonly oscillator: Tone.FatOscillator;
	readonly lfo: Tone.LFO;
}

function buildVoice(frequencyHz: number, spreadCents: number, voice: Voice, destination: Tone.InputNode): DriftingVoice {
	const oscillator = new Tone.FatOscillator({
		frequency: frequencyHz,
		type: 'triangle',
		count: OSCILLATORS_PER_VOICE,
		spread: spreadCents,
	}).connect(destination);

	const lfo = new Tone.LFO({
		frequency: voice.driftRateHz,
		type: 'sine',
		phase: voice.driftPhaseDeg,
		min: -DETUNE_DEPTH_CENTS,
		max: DETUNE_DEPTH_CENTS,
	}).connect(oscillator.detune);

	return { oscillator, lfo };
}

function buildBed(host: BedHost): BedHandle {
	// Drawn per press, never at module scope. The static export evaluates this file
	// in Node during prerender, so a draw up there would land in the build and give
	// every visitor the same voicing.
	const voicing = drawVoicing(Math.random);

	// Reverb rather than Freeverb, which loads eight AudioWorklets from blob: URLs
	// that an OWASP content security policy blocks.
	const reverb = new Tone.Reverb({
		decay: REVERB_DECAY_SECONDS,
		preDelay: REVERB_PRE_DELAY_SECONDS,
		wet: REVERB_WET,
	}).connect(host.destination);
	const gain = new Tone.Gain(BED_LEVEL).connect(reverb);
	const filter = new Tone.Filter(FILTER_FLOOR_HZ, 'lowpass').connect(gain);

	// A Filter plus an LFO instead of the AutoFilter that packages the two. Tone 15
	// gives AutoFilter's internal LFO no phase option and keeps that LFO protected,
	// so the drawn phase would be unreachable and every session would open on the
	// same upward sweep.
	const filterLfo = new Tone.LFO({
		frequency: voicing.filterRateHz,
		type: 'sine',
		phase: voicing.filterPhaseDeg,
		min: FILTER_FLOOR_HZ,
		max: FILTER_CEILING_HZ,
	}).connect(filter.frequency);

	const [rootVoice, partnerVoice] = voicing.voices;
	const voices = [
		buildVoice(voicing.rootHz, voicing.detuneSpreadCents, rootVoice, filter),
		buildVoice(voicing.rootHz * voicing.partnerRatio, voicing.detuneSpreadCents, partnerVoice, filter),
	];

	// A stopped LFO holds one value forever. Leave any of these three unstarted and
	// it pins the cutoff or a detune where it started, and the Bed sits still.
	filterLfo.start();
	for (const { oscillator, lfo } of voices) {
		oscillator.start();
		lfo.start();
	}

	return {
		ready: reverb.ready,
		stop: (at) => {
			filterLfo.stop(at);
			for (const { oscillator, lfo } of voices) {
				oscillator.stop(at);
				lfo.stop(at);
			}
		},
		dispose: () => {
			for (const { oscillator, lfo } of voices) {
				oscillator.dispose();
				lfo.dispose();
			}
			filterLfo.dispose();
			filter.dispose();
			gain.dispose();
			reverb.dispose();
		},
	};
}

export const ember: Scene = {
	id: 'ember',
	bed: buildBed,
};
