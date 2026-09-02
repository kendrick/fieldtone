import type { AudioBackend } from './audio-backend';
import * as Tone from 'tone';

// Every Tone.js call in the app lives here: this is the one AudioBackend that
// makes a sound, and the recording fake beside it is the one that does not. The
// seam is worth keeping narrow even while there is only one caller.
//
// Nothing is constructed at module scope. The static export evaluates this file
// in Node during prerender, and iOS refuses to start an AudioContext outside a
// user gesture, so both constraints point the same way: build on first press.
// Calling the factory builds nothing either; the first Tone node appears in
// resume/start.

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
	readContextTime: () => number;
	renderVoiceRms: (seconds?: number) => Promise<number>;
}

// The runtime never reads `probe`. It hangs off the backend so the adapter's
// surface is honest about the window hook it installs behind everyone's back.
export interface ToneBackend extends AudioBackend {
	readonly probe: OutputProbe;
}

declare global {
	interface Window {
		// Read by the Playwright suite, which cannot hear anything. Pull-based
		// on purpose: a polling loop would burn the thermal budget Principle V
		// sets aside for the visual layer.
		__fieldtone?: OutputProbe;
	}
}

function requestPlaybackSession(): void {
	// Safari's default session behaves like `ambient`, which the physical ringer
	// switch silences. Without this the app looks broken to anyone on mute.
	if (typeof navigator !== 'undefined' && navigator.audioSession !== undefined) {
		navigator.audioSession.type = 'playback';
	}
}

// Builds at silence and stays there. Fading up is a separate step so `start` and
// `fadeIn` can be separate commands, and so the offline render can reuse both.
function createVoice(destination: Tone.InputNode): Voice {
	const envelope = new Tone.Gain(0).connect(destination);
	const oscillator = new Tone.Oscillator(FREQUENCY_HZ, 'sine').connect(envelope);
	oscillator.start();
	return { oscillator, envelope };
}

function fadeVoiceIn(voice: Voice, seconds: number): void {
	voice.envelope.gain.rampTo(LEVEL, seconds);
}

// A browser with no audio output device reports the context as `running` but
// never advances its clock past the first block, so nothing is ever rendered
// in real time. Tests read this to tell a silent bug from a silent machine.
export function readContextTime(): number {
	return Tone.getContext().currentTime;
}

// The same voice, rendered offline. OfflineAudioContext needs no sound card, so
// this is the one measurement of "does this graph make a sound" that holds on a
// headless CI runner. It shares createVoice and fadeVoiceIn with playback rather
// than modelling either a second time, which is the only reason the answer means
// anything — and without the fade the render would measure silence.
export async function renderVoiceRms(seconds = 1): Promise<number> {
	const buffer = await Tone.Offline((context) => {
		fadeVoiceIn(createVoice(context.destination), FADE_SECONDS);
	}, seconds);
	const samples = buffer.getChannelData(0);
	// Second half only: the first half is still inside the fade.
	const start = Math.floor(samples.length / 2);
	let total = 0;
	for (let index = start; index < samples.length; index += 1) {
		const sample = samples[index] ?? 0;
		total += sample * sample;
	}
	return Math.sqrt(total / (samples.length - start));
}

export function createToneBackend(): ToneBackend {
	// Closure state, not module state: two backends never share one graph, and a
	// test can throw an instance away rather than reset a module.
	let output: Output | undefined;
	let voice: Voice | undefined;

	function readOutputLevel(): number {
		if (output === undefined) {
			return 0;
		}
		const value: number | number[] = output.meter.getValue();
		return Array.isArray(value) ? (value[0] ?? 0) : value;
	}

	const probe: OutputProbe = { readContextTime, readOutputLevel, renderVoiceRms };

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
		window.__fieldtone = probe;
		return output;
	}

	async function resume(): Promise<void> {
		// Synchronous, before the first await: the iOS gesture is spent by whatever
		// the click handler awaits first, so nothing may come between the press and
		// this call.
		requestPlaybackSession();
		// Tone.start() is the resume, so it has to be the first await the click
		// handler reaches. Building nodes after it is safe: the context is running.
		await Tone.start();
		const { state } = Tone.getContext();
		if (state !== 'running') {
			throw new Error(`AudioContext is ${state} rather than running`);
		}
	}

	// A later ticket gives `start` a Scene graph declaration to build from, and
	// the Scene's own graph builder replaces createVoice. The other four commands
	// are untouched by that change: resume, fadeIn, fadeOut and stop say nothing
	// about what the graph contains.
	function start(): void {
		if (voice !== undefined) {
			return;
		}
		voice = createVoice(ensureOutput().master);
	}

	function fadeIn(seconds: number): void {
		if (voice === undefined) {
			return;
		}
		fadeVoiceIn(voice, seconds);
	}

	function fadeOut(seconds: number): void {
		if (voice === undefined) {
			return;
		}
		voice.envelope.gain.rampTo(0, seconds);
	}

	function stop(afterSeconds: number): void {
		if (voice === undefined) {
			return;
		}
		// Each press owns its own envelope, so a fast stop-then-play never lands two
		// ramps on one Param. Tone cancels the earlier ramp when that happens, which
		// would otherwise yank the fade partway through. Clearing the slot before
		// scheduling the stop is what makes the next press build a fresh one.
		const { oscillator, envelope } = voice;
		voice = undefined;
		oscillator.onstop = (): void => {
			oscillator.dispose();
			envelope.dispose();
		};
		oscillator.stop(Tone.now() + afterSeconds);
	}

	return { resume, start, fadeIn, fadeOut, stop, probe };
}
