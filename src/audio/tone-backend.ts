import type { AudioBackend } from './audio-backend';
import type { ParameterValues } from '@/scenes/parameters';
import type { BedHandle, Scene } from '@/scenes/scene';
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

// The Scene mixes its own Bed, so the envelope is only the fade and has no
// level of its own to impose.
const LEVEL = 1;
const FADE_SECONDS = 0.3;
// Long enough for the stop to have taken effect before the nodes go away:
// disposing a node mid-release cuts the tail the Bed just scheduled.
const DISPOSE_GRACE_SECONDS = 0.05;
// A handful of windows is enough to tell a live Bed from a stuck one; more
// would just be noise to eyeball in a console.
const FINGERPRINT_WINDOWS = 8;

interface Voice {
	handle: BedHandle;
	envelope: Tone.Gain;
}

interface Output {
	master: Tone.Gain;
	meter: Tone.Meter;
}

interface OutputProbe {
	readOutputLevel: () => number;
	readContextTime: () => number;
	renderBedRms: (seconds?: number) => Promise<number>;
	renderBedFingerprint: (seconds?: number) => Promise<number[]>;
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
// The Scene owns everything under the envelope; this file owns only the fade
// between the Bed and the master bus.
function createVoice(scene: Scene, parameters: ParameterValues, destination: Tone.InputNode): Voice {
	const envelope = new Tone.Gain(0).connect(destination);
	return { handle: scene.bed({ destination: envelope, parameters }), envelope };
}

function fadeVoiceIn(voice: Voice, seconds: number): void {
	voice.envelope.gain.rampTo(LEVEL, seconds);
}

function rootMeanSquare(samples: Float32Array, from: number, to: number): number {
	let total = 0;
	for (let index = from; index < to; index += 1) {
		const sample = samples[index] ?? 0;
		total += sample * sample;
	}
	return Math.sqrt(total / (to - from));
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
//
// Awaiting `ready` before the fade keeps a Reverb's tail in the render; the
// impulse renders asynchronously and a graph measured before it exists comes
// back silent. Two of these must never overlap: Offline swaps the global context
// around an awaited callback, so callers run them one at a time.
async function renderBed(scene: Scene, parameters: ParameterValues, seconds: number): Promise<Float32Array> {
	const buffer = await Tone.Offline(async (context) => {
		const voice = createVoice(scene, parameters, context.destination);
		await voice.handle.ready;
		fadeVoiceIn(voice, FADE_SECONDS);
	}, seconds);
	return buffer.getChannelData(0);
}

export function createToneBackend(): ToneBackend {
	// Closure state, not module state: two backends never share one graph, and a
	// test can throw an instance away rather than reset a module.
	let output: Output | undefined;
	let voice: Voice | undefined;
	// The Scene the probe renders. It outlives the voice so a stopped session can
	// still be measured, and it is why the render probes cannot be module-level.
	let current: Scene | undefined;
	// The values the live graph is set to, kept beside the Scene for the same
	// reason: the offline probe then measures what the listener has rather than
	// the Scene's defaults, which is the difference between an oracle and a demo.
	let currentParameters: ParameterValues = {};

	function readOutputLevel(): number {
		if (output === undefined) {
			return 0;
		}
		const value: number | number[] = output.meter.getValue();
		return Array.isArray(value) ? (value[0] ?? 0) : value;
	}

	// Both render probes answer empty rather than throw when no Scene has started:
	// they are read from a browser console and from Playwright, either of which
	// may get there before anyone presses Play.
	async function renderBedRms(seconds = 1): Promise<number> {
		if (current === undefined) {
			return 0;
		}
		const samples = await renderBed(current, currentParameters, seconds);
		// Second half only: the first half is still inside the fade.
		return rootMeanSquare(samples, Math.floor(samples.length / 2), samples.length);
	}

	async function renderBedFingerprint(seconds = 1): Promise<number[]> {
		if (current === undefined) {
			return [];
		}
		const samples = await renderBed(current, currentParameters, seconds);
		const start = Math.floor(samples.length / 2);
		const width = Math.floor((samples.length - start) / FINGERPRINT_WINDOWS);
		if (width === 0) {
			// A render too short to fill every window would divide by zero.
			return [];
		}
		const windows: number[] = [];
		for (let index = 0; index < FINGERPRINT_WINDOWS; index += 1) {
			const from = start + index * width;
			windows.push(rootMeanSquare(samples, from, from + width));
		}
		return windows;
	}

	const probe: OutputProbe = {
		readContextTime,
		readOutputLevel,
		renderBedRms,
		renderBedFingerprint,
	};

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

	function start(scene: Scene, parameters: ParameterValues): void {
		if (voice !== undefined) {
			return;
		}
		current = scene;
		currentParameters = parameters;
		voice = createVoice(scene, parameters, ensureOutput().master);
	}

	function setParameter(name: string, value: number): void {
		if (voice === undefined) {
			return;
		}
		// stop() clears `voice` before it schedules the dispose, so nothing here can
		// reach a handle whose nodes are already gone.
		currentParameters = { ...currentParameters, [name]: value };
		voice.handle.setParameter(name, value);
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
		const { handle, envelope } = voice;
		voice = undefined;
		handle.stop(Tone.now() + afterSeconds);
		// The context's own timeout is checked against the audio clock on Tone's
		// existing ticker, so the teardown costs no JS timer of ours—which
		// Principle V rules out anyway. A node `onstop` would not do: it fires for
		// one source, and a Bed is a graph.
		Tone.getContext().setTimeout(() => {
			handle.dispose();
			envelope.dispose();
		}, afterSeconds + DISPOSE_GRACE_SECONDS);
	}

	return { resume, start, setParameter, fadeIn, fadeOut, stop, probe };
}
