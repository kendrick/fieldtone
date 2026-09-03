import type { AudioBackend, SignalListener } from './audio-backend';
import type { ParameterValues } from '@/scenes/parameters';
import type { BedHandle, Scene } from '@/scenes/scene';
import * as Tone from 'tone';
import { ListeningRejection } from './audio-backend';
import { needsRecordSession, requestPlaybackSession, requestRecordSession } from './audio-session';
import { reasonForCaptureError } from './capture-rejection';

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
// The fade that covers the switch to `play-and-record`. ADR 0004 measured that
// switch on device as up to a second of silence followed by a jump in level, so
// the Bed has to be taken down before it and brought back after it. Same length
// as FADE_SECONDS by default rather than by derivation—this one answers to what
// the dropout sounds like on an iPhone, and is expected to be tuned there.
const SESSION_FADE_SECONDS = 0.3;
// Long enough for the stop to have taken effect before the nodes go away:
// disposing a node mid-release cuts the tail the Bed just scheduled.
const DISPOSE_GRACE_SECONDS = 0.05;
// A handful of windows is enough to tell a live Bed from a stuck one; more
// would just be noise to eyeball in a console.
const FINGERPRINT_WINDOWS = 8;

// All three off because iOS voice processing ducks the output the moment it
// hears input, which is the moment Recognition needs the Bed audible. ADR 0004
// measured that on device: the default microphone ducks, one asked for with
// `echoCancellation: false` does not. Safari reports the other two back as
// neither applied nor refused, so treat them as requested and unconfirmed.
//
// Raw getUserMedia rather than Tone.UserMedia because `open()` sets echo
// cancellation and noise suppression off but never touches automatic gain, and
// a gain stage that quietly normalizes the room defeats Level Listening.
const LISTENING_CONSTRAINTS: MediaStreamConstraints = {
	audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
};

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
	// Registration only, for now: nothing in this file ever calls a listener.
	// Deriving a Control Signal from Listening and emitting it is the next
	// ticket (#27); this set is what that ticket's emission lands against
	// without the subscribe side changing too.
	const signalListeners = new Set<SignalListener>();
	// The open microphone, or nothing. Closure state like the rest, which is what
	// lets stopListening be a no-op rather than something the caller has to guard.
	let stream: MediaStream | undefined;

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

	async function startListening(): Promise<void> {
		// The absent-API case never reaches getUserMedia, so nothing maps it for us.
		// It is `unavailable` for the same reason an unrecognized DOMException name
		// is: try another browser, not try again.
		if (navigator.mediaDevices?.getUserMedia === undefined) {
			throw new ListeningRejection('unavailable');
		}
		// The voice this fade is spent on, pinned before the wait. The fade exists to
		// cover a session switch, so it runs only where one is about to happen: no audio
		// session at all (every desktop browser, which is why the Chromium suite never
		// sees a fade) and one already on `play-and-record` both mean no dropout to
		// cover, and the transition below collapses to the getUserMedia call that
		// shipped before it.
		const faded = needsRecordSession() ? voice : undefined;
		if (faded !== undefined) {
			faded.envelope.gain.rampTo(0, SESSION_FADE_SECONDS);
			await new Promise<void>((resolve) => {
				// The context's own timeout rides Tone's existing ticker against the
				// audio clock, the same way the teardown in stop() does. A JS timer
				// would drift away from the ramp it is waiting on, and Principle V
				// rules one out regardless.
				Tone.getContext().setTimeout(resolve, SESSION_FADE_SECONDS);
			});
		}
		// Outside the fade, because iOS requires the switch and the fade only covers
		// it: `getUserMedia` rejects outright while the session is still `playback`
		// (ADR 0004), and a Bed that is not playing has nothing to fade but still
		// needs the session moved. A no-op where there is no audio session, and where
		// the switch already happened.
		//
		// Putting the fade ahead of this bets that the tap's transient activation
		// outlives 300ms. The HTML spec sizes that window in seconds and nothing has
		// measured it here, so a physical iPhone is what settles the bet.
		requestRecordSession();
		let opened: MediaStream;
		try {
			// Nothing but the fade may come between the tap and this call. Safari
			// spends the gesture on whichever await runs first, exactly as it spends
			// the play tap on resume, so an enumerateDevices here would take the
			// gesture and hand back unlabeled devices anyway.
			opened = await navigator.mediaDevices.getUserMedia(LISTENING_CONSTRAINTS);
		}
		catch (error) {
			// One error type out of this seam, so the Invitation branches on a reason
			// it can phrase rather than on a DOMException name that varies by browser.
			throw new ListeningRejection(reasonForCaptureError(error), { cause: error });
		}
		finally {
			// Both paths bring the Bed back: a listener who denies the browser prompt
			// still paid for the switch, and leaving them in silence would read as the
			// app breaking. The identity check keeps this off a voice stop() cleared
			// while we were awaiting—that envelope is already scheduled for disposal,
			// and a stop-then-play in the gap left a fresh one running its own fade.
			if (faded !== undefined && voice === faded) {
				fadeVoiceIn(faded, SESSION_FADE_SECONDS);
			}
		}
		// Held, not wired: connecting the stream to the graph is #27. Until then this
		// opens the microphone and nothing else, on a session that can now carry it.
		stream = opened;
	}

	function stopListening(): void {
		// The session stays on `play-and-record` deliberately. Switching back would
		// cost a second audible dropout to undo a mode the listener has already been
		// through once, and iOS drops its recording indicator on the released track
		// rather than on the session type, so nothing about Principle I turns on it.
		//
		// A track outlives the stream object, so releasing the reference alone leaves
		// the recording indicator lit. Principle I makes that non-negotiable.
		for (const track of stream?.getTracks() ?? []) {
			track.stop();
		}
		stream = undefined;
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

	function onSignal(listener: SignalListener): () => void {
		signalListeners.add(listener);
		return (): void => {
			signalListeners.delete(listener);
		};
	}

	return { resume, start, setParameter, fadeIn, fadeOut, startListening, stopListening, stop, onSignal, probe };
}
