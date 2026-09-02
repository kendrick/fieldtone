import * as Tone from 'tone';

// Every Tone.js call in the app lives here. Ticket #4 wraps this module in an
// AudioBackend adapter and puts a recording fake beside it, so the seam is
// worth keeping narrow even while there is only one caller.
//
// Nothing is constructed at module scope. The static export evaluates this file
// in Node during prerender, and iOS refuses to start an AudioContext outside a
// user gesture, so both constraints point the same way: build on first press.

const FREQUENCY_HZ = 220;
const LEVEL = 0.25;
const FADE_SECONDS = 0.3;

interface Voice {
	oscillator: Tone.Oscillator;
	envelope: Tone.Gain;
}

interface Output {
	master: Tone.Gain;
	meter: Tone.Meter;
}

interface OutputProbe {
	readOutputLevel: () => number;
}

declare global {
	interface Window {
		// Read by the Playwright suite, which cannot hear anything. Pull-based
		// on purpose: a polling loop would burn the thermal budget Principle V
		// sets aside for the visual layer.
		__fieldtone?: OutputProbe;
	}
}

let output: Output | undefined;
let voice: Voice | undefined;

function requestPlaybackSession(): void {
	// Safari's default session behaves like `ambient`, which the physical ringer
	// switch silences. Without this the app looks broken to anyone on mute.
	if (typeof navigator !== 'undefined' && navigator.audioSession !== undefined) {
		navigator.audioSession.type = 'playback';
	}
}

export function readOutputLevel(): number {
	if (output === undefined) {
		return 0;
	}
	const value: number | number[] = output.meter.getValue();
	return Array.isArray(value) ? (value[0] ?? 0) : value;
}

function ensureOutput(): Output {
	if (output !== undefined) {
		return output;
	}
	// smoothing 0 because Meter decays per getValue() call rather than per
	// second, and this meter is read at whatever cadence the caller chooses.
	// normalRange swaps decibels for a 0..1 RMS, which reads better at a glance.
	const meter = new Tone.Meter({ normalRange: true, smoothing: 0 });
	const master = new Tone.Gain(1);
	master.connect(meter);
	master.toDestination();
	output = { master, meter };
	window.__fieldtone = { readOutputLevel };
	return output;
}

export async function startTone(): Promise<void> {
	requestPlaybackSession();
	// Tone.start() is the resume, so it has to be the first await the click
	// handler reaches. Building nodes after it is safe: the context is running.
	await Tone.start();
	const { state } = Tone.getContext();
	if (state !== 'running') {
		throw new Error(`AudioContext is ${state} rather than running`);
	}
	if (voice !== undefined) {
		return;
	}
	const { master } = ensureOutput();
	const envelope = new Tone.Gain(0).connect(master);
	const oscillator = new Tone.Oscillator(FREQUENCY_HZ, 'sine').connect(envelope);
	oscillator.start();
	envelope.gain.rampTo(LEVEL, FADE_SECONDS);
	voice = { oscillator, envelope };
}

export function stopTone(): void {
	if (voice === undefined) {
		return;
	}
	// Each press owns its own envelope, so a fast stop-then-play never lands two
	// ramps on one Param. Tone cancels the earlier ramp when that happens, which
	// would otherwise yank the fade partway through.
	const { oscillator, envelope } = voice;
	voice = undefined;
	envelope.gain.rampTo(0, FADE_SECONDS);
	oscillator.onstop = (): void => {
		oscillator.dispose();
		envelope.dispose();
	};
	oscillator.stop(Tone.now() + FADE_SECONDS);
}
