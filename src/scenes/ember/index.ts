import type { BedHandle, BedHost, Scene } from '../scene';
import type { Voice } from './voicing';
import * as Tone from 'tone';
import { resolveParameterValue } from '../parameters';
import { emberParameters } from './parameters';
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

// The floor sits above the highest fundamental any draw can produce: G2 at 98 Hz
// times the widest partner ratio, 2.25, gives 220.5 Hz. So the sweep thins the
// timbre without ever dipping toward silence, and the level stays predictable
// across draws. Brightness scales both ends of this range, and at the schema's
// minimum of 0.75 the floor lands at 300 Hz—still above 220.5 Hz, so no setting
// a listener can reach drags the sweep into the partner voice. Widen either
// table in voicing.ts, or lower that minimum, and this margin needs rechecking.
const FILTER_FLOOR_HZ = 400;
const FILTER_CEILING_HZ = 1600;

const DETUNE_DEPTH_CENTS = 6;
const OSCILLATORS_PER_VOICE = 3;

// Long enough that a single step never clicks, short enough that a drag still
// feels attached to what it is moving. Param.rampTo anchors at the value the
// last ramp actually reached before starting the next one, so retargeting
// partway through a drag stays continuous without any bookkeeping here.
const PARAMETER_RAMP_SECONDS = 0.05;

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

	const space = resolveParameterValue(emberParameters.space, host.parameters.space);
	const brightness = resolveParameterValue(emberParameters.brightness, host.parameters.brightness);

	// Reverb rather than Freeverb, which loads eight AudioWorklets from blob: URLs
	// that an OWASP content security policy blocks.
	const reverb = new Tone.Reverb({
		decay: REVERB_DECAY_SECONDS,
		preDelay: REVERB_PRE_DELAY_SECONDS,
		wet: space,
	}).connect(host.destination);
	const gain = new Tone.Gain(BED_LEVEL).connect(reverb);
	const filter = new Tone.Filter(FILTER_FLOOR_HZ, 'lowpass').connect(gain);

	// The sweep reaches the cutoff through a Multiply rather than landing on
	// filter.frequency directly, because in Tone a Signal connected to a Param
	// overrides it: with the LFO wired straight to filter.frequency, ramping that
	// Param would do nothing at all and brightness would be silently inert.
	// Multiply.override is false, so the LFO sums into the multiplicand without
	// zeroing factor, and factor is a Param that rampTo can move.
	//
	// Scaling filterLfo.min and .max looks like the smaller change and is the wrong
	// one: those setters write straight through to an internal Scale, so every drag
	// step is a jump on the cutoff and the drag is audible as a run of clicks.
	//
	// The resolved brightness has to go in at construction. new Tone.Multiply() with
	// no argument defaults to a factor of 0, which pins the cutoff at DC and renders
	// silence that typechecks and passes every unit test.
	const brightnessScale = new Tone.Multiply(brightness).connect(filter.frequency);

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
	}).connect(brightnessScale);

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
		// Nothing to stop for brightnessScale: a Multiply is not a source, so it
		// falls silent with whatever feeds it.
		stop: (at) => {
			filterLfo.stop(at);
			for (const { oscillator, lfo } of voices) {
				oscillator.stop(at);
				lfo.stop(at);
			}
		},
		setParameter: (name, value) => {
			switch (name) {
				case 'space':
					reverb.wet.rampTo(value, PARAMETER_RAMP_SECONDS);
					break;
				case 'brightness':
					brightnessScale.factor.rampTo(value, PARAMETER_RAMP_SECONDS);
					break;
				default:
					// The runtime has already turned away any name this Scene does not
					// declare, so reaching here means a bug upstream, not bad input. It
					// still leaves quietly: a throw raised inside a live graph has nowhere
					// to surface—no caller is waiting on it and the Bed keeps playing
					// behind it—so it would cost the audio and buy nobody a stack trace.
			}
		},
		dispose: () => {
			for (const { oscillator, lfo } of voices) {
				oscillator.dispose();
				lfo.dispose();
			}
			filterLfo.dispose();
			brightnessScale.dispose();
			filter.dispose();
			gain.dispose();
			reverb.dispose();
		},
	};
}

export const ember: Scene = {
	id: 'ember',
	parameters: emberParameters,
	bed: buildBed,
};
