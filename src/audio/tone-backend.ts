import type { AudioBackend, SignalListener } from './audio-backend';
import type { ParameterValues } from '@/scenes/parameters';
import type { BedHandle, Scene } from '@/scenes/scene';
import * as Tone from 'tone';
import { ListeningRejection } from './audio-backend';
import { needsRecordSession, requestPlaybackSession, requestRecordSession } from './audio-session';
import { reasonForCaptureError } from './capture-rejection';
import { powerAt } from './goertzel';
import { workletModuleUrl } from './worklet-url';

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
// The silence the platform imposes after the switch. The Bed waits it out before
// it fades back, because a ramp started the moment the switch returns runs to
// completion inside a dropout the listener is still hearing, and audio would come
// back at full level rather than fading in.
//
// Tuned by ear on an iPhone 15 Pro, iOS 26.6.1, Safari 26.6, across both the
// accept and the denial path, which share this constant (#57). At 0.7 the dead
// air before the fade was obvious. At 0.3 it was still a shade long. 0.25 is one
// step below the last value anyone actually heard, which makes it the only number
// in this comment not confirmed on a phone; the failure to listen for is the Bed
// snapping back at full level, which means the ramp finished inside the dropout
// and this wants to go back up.
//
// Shorter than ADR 0004, which puts the switch's silence at roughly half a second
// to a second. Not a contradiction. That figure is the one measurement in the ADR
// with no device or OS written beside it, and the ADR's other numbers were taken
// on iOS 18.7, so it most likely describes a platform two majors older than this
// tuning. Principle VI still requires iOS 18, and a dropout at the top of that
// range would outlast this wait and the whole ramp after it, putting the Bed back
// at full level. Unmeasured there; #61 is the ticket that settles it.
const SESSION_SWITCH_DROPOUT_SECONDS = 0.25;
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

// The name public/worklets/level-listening.js registers its processor under, and
// the path it is served from.
const LEVEL_LISTENING_PROCESSOR = 'level-listening';
const LEVEL_LISTENING_MODULE = 'worklets/level-listening.js';

// What the worklet posts up its port. Declared here rather than imported,
// because the worklet is plain JS served as a static asset and no bundler ever
// sees the two files together. Nothing but agreement keeps the two ends in step.
//
// A name no Scene declared is normal traffic—`onset` is here for Recognition and
// Ember has no use for it—so nothing filters on the way through.
interface SignalMessage {
	readonly name: string;
	readonly value: number;
}

// The one message that travels the other way, and the only thing that ends a
// return. A processor whose `process()` returns true is an active source: the
// spec keeps it running after `disconnect()` and after the main thread drops the
// node, so a stop that only tore the graph down would leave four seconds of held
// Material rolling in the audio thread until the context closed. Principle I is
// non-negotiable, which is why this is a message rather than a nicety.
const RELEASE_MESSAGE = { name: 'release' };

// What the offline contrast probe injects into `material`, and where it looks
// for it afterwards. 3 kHz sits far above anything Ember's lowpass passes — its
// ceiling is 4.8 kHz only at brightness 3, and the Bed's triangle harmonics are
// long gone by then — so the same frequency measured outside the burst is the
// Bed's own floor at that frequency, whatever voicing the render happened to
// draw. That is what makes one render enough: Ember redraws its voicing from an
// unseeded Math.random, so two renders cannot be compared with each other.
const MATERIAL_PROBE_HZ = 3000;
const MATERIAL_PROBE_DB = -12;
const MATERIAL_PROBE_SECONDS = 1.2;
const MATERIAL_PROBE_BURST_FROM = 0.8;
const MATERIAL_PROBE_BURST_TO = 1;
// Well clear of the 0.3 s fade in, and far enough ahead of the burst that the
// Reverb's pre-roll cannot bleed backwards into it.
const MATERIAL_PROBE_CONTROL_FROM = 0.5;
const MATERIAL_PROBE_CONTROL_TO = 0.7;

interface Voice {
	handle: BedHandle;
	envelope: Tone.Gain;
}

interface Output {
	master: Tone.Gain;
	meter: Tone.Meter;
	// Where Listening hands the Material it returns, and what a Bed reaches for
	// when it wants to do something with it. Held on Output rather than beside
	// the microphone nodes because it outlives any one Listening session: a Bed
	// connects to it once, at build time, and Listening can start and stop under
	// it any number of times.
	material: Tone.Gain;
	// Gain 0, straight to master. Web Audio pulls the graph backwards from the
	// destination, so a node the master bus cannot reach is never processed at
	// all — a Bed with no use for `material` would silently stop the worklet
	// dead, and with it every Control Signal. This keeps the pull alive while
	// letting nothing untransformed through.
	materialPull: Tone.Gain;
}

interface OutputProbe {
	readOutputLevel: () => number;
	readContextTime: () => number;
	// The last value Listening emitted under this name, and 0 for a name never
	// seen. A signal resting at silence reads 0 as well, which no caller has to
	// separate: the suite reading this polls until a value moves.
	readSignal: (name: string) => number;
	renderBedRms: (seconds?: number) => Promise<number>;
	renderBedFingerprint: (seconds?: number) => Promise<number[]>;
	// How much louder the probe frequency is inside an injected burst than it is
	// in the Bed alone. A ratio rather than a level, because the Bed's own energy
	// is the control: nothing here has to know what a given draw sounds like.
	renderMaterialContrast: () => Promise<number>;
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
function createVoice(scene: Scene, parameters: ParameterValues, destination: Tone.InputNode, material: Tone.ToneAudioNode): Voice {
	const envelope = new Tone.Gain(0).connect(destination);
	return { handle: scene.bed({ destination: envelope, parameters, material }), envelope };
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
//
// The Material node is built here rather than handed in, because the live one
// belongs to a context this render has just swapped out from under itself.
// `inject` is how a caller puts a signal through it, and the renders that only
// want the Bed pass nothing, which leaves the node connected but silent — the
// same thing a listener who never granted the microphone hears.
async function renderBed(scene: Scene, parameters: ParameterValues, seconds: number, inject?: (material: Tone.Gain) => void): Promise<Float32Array> {
	const buffer = await Tone.Offline(async (context) => {
		const material = new Tone.Gain(1);
		const voice = createVoice(scene, parameters, context.destination, material);
		await voice.handle.ready;
		inject?.(material);
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
	// Every reading Level Listening posts is fanned out here, unfiltered. Which
	// names a Scene has a use for is the runtime's question, not this file's. The
	// adapter reports what the microphone gives it, and a Scene's declarations
	// decide what any of it drives.
	const signalListeners = new Set<SignalListener>();
	// Fanned out when the platform takes the microphone away, not when a reading
	// arrives. One handler serves every track, and it is a named function so
	// stopListening can hand the same reference back to removeEventListener.
	const muteListeners = new Set<() => void>();
	function handleTrackMute(): void {
		for (const listener of muteListeners) {
			listener();
		}
	}
	// The last value per name, kept for the probe. The runtime holds the copy the
	// app runs on, in its own store; this one answers a suite that has no ears and
	// needs to see that a reading arrived at all.
	const lastSignalValues = new Map<string, number>();
	// The open microphone, or nothing. Closure state like the rest, which is what
	// lets stopListening be a no-op rather than something the caller has to guard.
	let stream: MediaStream | undefined;
	// The two nodes that carry the microphone into Level Listening, held so
	// stopListening can take them down. Native Web Audio nodes rather than Tone
	// ones, because Principle IV puts the analysis in a raw worklet and Tone has no
	// wrapper for a processor it did not register itself.
	let listeningInput: MediaStreamAudioSourceNode | undefined;
	let levelListening: AudioWorkletNode | undefined;
	// The worklet module load, remembered so a stop-then-listen refetches nothing.
	let levelListeningModule: Promise<void> | undefined;
	// Bumped by every stopListening, so an attempt that is still out can tell
	// whether the session it belongs to has since ended. `stream` cannot answer
	// that: it reads undefined both before a grant arrives and after a stop, and
	// the two need opposite handling. A grant landing after a stop must be closed
	// where it lands, because the module await below it may never settle and the
	// runtime's own recheck sits on the far side of that await.
	let listeningEpoch = 0;

	function readOutputLevel(): number {
		if (output === undefined) {
			return 0;
		}
		const value: number | number[] = output.meter.getValue();
		return Array.isArray(value) ? (value[0] ?? 0) : value;
	}

	function readSignal(name: string): number {
		return lastSignalValues.get(name) ?? 0;
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

	// Proof that a signal put into `material` reaches the listener, rendered
	// offline so it holds on a machine with no sound card. It measures the same
	// frequency twice inside one render — once under an injected burst, once
	// where there is only the Bed — because Ember draws its voicing from an
	// unseeded Math.random and so no two renders can be compared with each other.
	// A broken path leaves the two windows equal and the ratio near 1.
	async function renderMaterialContrast(): Promise<number> {
		if (current === undefined) {
			return 0;
		}
		const samples = await renderBed(current, currentParameters, MATERIAL_PROBE_SECONDS, (material) => {
			// Started and stopped against the offline clock, which is the only clock
			// there is in here. Nothing to dispose: the context and everything in it
			// goes away with the render.
			new Tone.Oscillator({ frequency: MATERIAL_PROBE_HZ, type: 'sine', volume: MATERIAL_PROBE_DB })
				.connect(material)
				.start(MATERIAL_PROBE_BURST_FROM)
				.stop(MATERIAL_PROBE_BURST_TO);
		});
		// Offline renders at whatever rate the context runs at, and renderBed hands
		// back samples rather than the buffer, so the rate is read back off the
		// length instead of being assumed.
		const sampleRate = samples.length / MATERIAL_PROBE_SECONDS;
		const frameAt = (seconds: number): number => Math.round(seconds * sampleRate);
		const burst = powerAt(samples, frameAt(MATERIAL_PROBE_BURST_FROM), frameAt(MATERIAL_PROBE_BURST_TO), MATERIAL_PROBE_HZ, sampleRate);
		const control = powerAt(samples, frameAt(MATERIAL_PROBE_CONTROL_FROM), frameAt(MATERIAL_PROBE_CONTROL_TO), MATERIAL_PROBE_HZ, sampleRate);
		// A Bed that happens to render dead silence at the probe frequency would
		// divide by zero and report Infinity, which reads as a pass for the wrong
		// reason.
		return burst / Math.max(control, 1e-12);
	}

	const probe: OutputProbe = {
		readContextTime,
		readOutputLevel,
		readSignal,
		renderBedRms,
		renderBedFingerprint,
		renderMaterialContrast,
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
		const material = new Tone.Gain(1);
		const materialPull = new Tone.Gain(0).connect(master);
		material.connect(materialPull);
		output = { master, meter, material, materialPull };
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
		const { master, material } = ensureOutput();
		voice = createVoice(scene, parameters, master, material);
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

	// Hands the timeout id back so a denial can cancel a return that has not fired
	// yet, rather than let it ramp the Bed up into a session about to switch back.
	// Inside the factory because it reads `voice`. The identity check belongs in
	// the callback rather than out here: a stop-then-play landing in the dropout
	// leaves a fresh voice running its own fade, and ramping the old envelope
	// would fight it.
	function bringBackAfterSwitch(faded: Voice): number {
		return Tone.getContext().setTimeout(() => {
			if (voice === faded) {
				fadeVoiceIn(faded, SESSION_FADE_SECONDS);
			}
		}, SESSION_SWITCH_DROPOUT_SECONDS);
	}

	// Reaching past Tone to the raw context, and caching the promise here, because
	// `Tone.getContext().addAudioWorkletModule` keeps one `_workletPromise` per
	// context and awaits whichever URL reached it first. Tone registers its own
	// worklets in this same context, so that call would either swallow this URL or
	// block Tone's from ever registering, depending on which one got there first.
	// `rawContext` is on Tone's public surface and its `audioWorklet` carries no
	// such cache.
	//
	// The specifier stays relative, which is what keeps `/fieldtone` out of this
	// file: `next.config.ts` sets that as the basePath and manifest.ts is the one
	// place allowed to write it by hand. The app has a single route, so
	// `document.baseURI` is this page and the worklet resolves under whatever base
	// the export is served from.
	function loadLevelListeningModule(): Promise<void> {
		// worklet-url.ts owns the arithmetic and carries the reasoning. A 404 here
		// rejects addModule, and the seam turns that into `unavailable`, so getting
		// it wrong tells the listener their browser cannot open a microphone when
		// the browser was never the problem.
		const url = workletModuleUrl(document.baseURI, LEVEL_LISTENING_MODULE);

		// Cleared again on rejection, so the cache holds successes only. A dropped
		// request would otherwise be remembered as a permanent verdict: every later
		// press would reuse the rejected promise without touching the network. There
		// is no button to retry with, because `unavailable` leaves none, but Stop and
		// Play offer the Invitation again and that press has to be able to work.
		levelListeningModule ??= Tone.getContext().rawContext.audioWorklet.addModule(url).catch((error: unknown) => {
			levelListeningModule = undefined;
			throw error;
		});
		return levelListeningModule;
	}

	async function startListening(): Promise<void> {
		// Read before anything is awaited, compared once the microphone is in hand.
		const epoch = listeningEpoch;
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
		//
		// Two bindings rather than one, because they differ when nothing is playing:
		// `switching` says the session has to move and so a denial has to move it
		// back, `faded` says there is a Bed to fade across the move.
		const switching = needsRecordSession();
		const faded = switching ? voice : undefined;
		if (faded !== undefined) {
			faded.envelope.gain.rampTo(0, SESSION_FADE_SECONDS);
			await new Promise<void>((resolve) => {
				// The context's own timeout rides Tone's existing ticker against the
				// audio clock, the same way the teardown in stop() does. A JS timer
				// would drift away from the ramp it is waiting on, and Principle V
				// rules one out regardless.
				Tone.getContext().setTimeout(resolve, SESSION_FADE_SECONDS);
			});
			// Stop can land inside the fade, and the fade is what created that window:
			// before it, nothing was awaited between the press and getUserMedia. The
			// runtime's orphan recheck releases a microphone opened late, but it cannot
			// undo a session type, so switching here would leave a listener who stopped
			// on `play-and-record`, paying the voice-chat volume scale for Listening
			// that never started.
			//
			// Resolving rather than rejecting, because that recheck owns this outcome
			// either way and a rejection would phrase a stop as something the listener
			// was refused. Nothing to bring back on the way out: the voice this faded is
			// already scheduled for disposal, and a stop-then-play in the gap left a
			// fresh one running its own fade.
			if (voice !== faded) {
				return;
			}
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
		// Scheduled before the prompt, not after it. `getUserMedia` stays pending for
		// as long as the permission prompt is on screen, which the listener can leave
		// up indefinitely, so anything waiting on that promise holds the Bed at
		// silence until they answer. CONTEXT.md defines the Bed as the layer that
		// plays whether or not permission is granted, and it cannot do that from
		// behind a prompt. Registering the timeout is synchronous, so it takes
		// nothing from the tap's activation on the way to the call below.
		const returning = faded !== undefined ? bringBackAfterSwitch(faded) : undefined;
		let opened: MediaStream;
		try {
			// Nothing but the fade may come between the tap and this call. Safari
			// spends the gesture on whichever await runs first, exactly as it spends
			// the play tap on resume, so an enumerateDevices here would take the
			// gesture and hand back unlabeled devices anyway.
			opened = await navigator.mediaDevices.getUserMedia(LISTENING_CONSTRAINTS);
		}
		catch (error) {
			// Every rejection reason means no microphone, so none of them has earned
			// `play-and-record`. ADR 0004 charges the voice-chat volume scale to the
			// person who asked for a microphone at the moment they asked, and someone
			// who was denied asked without receiving. Nothing else puts the type back:
			// `stopListening` leaves it alone on purpose, and resume() is the only
			// other caller of `requestPlaybackSession`. Guarded on `switching` because
			// a path that moved nothing has nothing to undo.
			//
			// Guarded on the epoch as well, because a denial can arrive long after the
			// attempt that asked stopped being the one that matters: the listener can
			// leave the prompt up while the app is backgrounded and resumed, and the
			// resume opens a microphone of its own. Putting the session back then would
			// pull `play-and-record` out from under a live capture. A superseded attempt
			// leaves the pending return alone too, since that timeout is what brings the
			// Bed back and nothing below would re-arm it.
			if (switching && epoch === listeningEpoch) {
				if (returning !== undefined) {
					Tone.getContext().clearTimeout(returning);
				}
				if (faded !== undefined && voice === faded) {
					// The reverse switch needs a fade of its own, because the envelope is
					// no longer at zero: the scheduled return may have fired, and may be
					// partway through its ramp. Same audio-clock await as the fade down.
					faded.envelope.gain.rampTo(0, SESSION_FADE_SECONDS);
					await new Promise<void>((resolve) => {
						Tone.getContext().setTimeout(resolve, SESSION_FADE_SECONDS);
					});
				}
				// Read again after the fade. A suspend or a stop can land inside those
				// 300 ms, and by then the session belongs to whoever holds the
				// microphone. The Bed still comes back below either way; only the
				// session move is skipped, because a voice faded to zero with nothing
				// scheduled to raise it is silence for the life of the page.
				if (epoch === listeningEpoch) {
					requestPlaybackSession();
				}
				if (faded !== undefined) {
					bringBackAfterSwitch(faded);
				}
			}
			// One error type out of this seam, so the Invitation branches on a reason
			// it can phrase rather than on a DOMException name that varies by browser.
			// The reverse switch above delays this throw by a fade, and the Invitation
			// holds "Asking your browser for the microphone." across it. A stop landing
			// in that window still belongs to the runtime's orphan recheck.
			throw new ListeningRejection(reasonForCaptureError(error), { cause: error });
		}
		// A stop landed while the prompt was still up. Closing the track here rather
		// than holding it, because everything below waits on a module fetch that may
		// never come back, and a microphone opened for a session that already ended
		// may not sit behind that wait. Principle I is non-negotiable.
		if (epoch !== listeningEpoch) {
			for (const track of opened.getTracks()) {
				track.stop();
			}
			return;
		}
		// Held before the module load rather than after it. A Stop landing inside that
		// await still has to find tracks to stop, and `stream` is the only thing
		// stopListening reads to find them.
		stream = opened;
		// Attached here for the reason `stream` is set here. A mute can land inside
		// the module fetch below, and the runtime still has to hear about it. Above
		// the epoch check would be wrong, because that path stops the tracks and
		// returns without ever holding them.
		//
		// A mute with the page still visible, an incoming call being the usual one,
		// does not resume itself when the call ends. Principle I is non-negotiable,
		// so suspending Listening means `track.stop()` rather than
		// `enabled = false`, and a stopped track is ended, so it will never fire
		// `unmute` and there is nothing to resume from. Offering the Invitation
		// again is the deliberate way back.
		for (const track of opened.getTracks()) {
			track.addEventListener('mute', handleTrackMute);
		}
		// A track can arrive muted, when the interruption that muted it was already
		// under way as the listener answered the prompt. An incoming call is the
		// ordinary way in. The event fired before anything was listening for it, or
		// never fired at all, so waiting for one waits for the life of the page while
		// the Invitation says Listening over a room it cannot hear.
		//
		// Read after attaching rather than before, so a mute landing between the two
		// is caught by the listener instead of falling through the gap. That can fire
		// the handler twice, which costs nothing: suspending is idempotent because an
		// installed app fires mute and visibilitychange for the same suspension.
		if (opened.getTracks().some(track => track.muted)) {
			handleTrackMute();
		}
		// Awaiting here is safe in a way that awaiting ahead of getUserMedia would not
		// be. iOS spends the tap's activation on whichever await runs first, which is
		// why everything above stays synchronous, but nothing past the prompt needs
		// the gesture any more.
		// Everything past the grant runs inside the catch, because the microphone is
		// already open by the time any of it can fail. A module that 404s or a fetch
		// that drops leaves a live track and a lit recording indicator underneath a
		// message saying the microphone never opened, and nothing later takes it back:
		// the runtime lands in `refused`, where its own stopListening returns on the
		// status guard before it reaches this seam. Principle I is non-negotiable, so
		// the failing path hands the microphone back itself.
		try {
			await loadLevelListeningModule();
			// The same identity check the fade above makes, for the same reason. A
			// listener who stopped inside the fetch has already had their tracks released,
			// and the nodes below would then be reading a dead stream with nothing left to
			// take them down: stopListening cleared its references before either node
			// existed.
			if (stream !== opened) {
				return;
			}
			const context = Tone.getContext();
			const input = context.createMediaStreamSource(opened);
			const listening = context.createAudioWorkletNode(LEVEL_LISTENING_PROCESSOR);
			input.connect(listening);
			// Into `material` rather than the master bus, because the worklet's output
			// is no longer silence: it is the Material it returns, and the Scene decides
			// what that sounds like. A line straight to master would put the untouched
			// thing under whatever the Scene made of it. The pull behind `material` is
			// what keeps the old reason for this connection satisfied — Web Audio
			// processes only what the destination can reach, so an unconnected worklet
			// posts nothing at all, Control Signals included.
			Tone.connect(listening, ensureOutput().material);
			listening.port.onmessage = (event: MessageEvent<SignalMessage>): void => {
				const { name, value } = event.data;
				lastSignalValues.set(name, value);
				for (const listener of signalListeners) {
					listener(name, value);
				}
			};
			listeningInput = input;
			levelListening = listening;
		}
		catch (error) {
			// Only when this attempt still owns the microphone. A stop, or a stop and a
			// second press, already released `opened` and moved `stream` on, and stopping
			// again here would take down a session that succeeded.
			if (stream === opened) {
				stopListening();
			}
			// `unavailable` because nothing here is the listener's answer: they granted
			// the microphone and the app could not use it. Rejecting with the seam's own
			// error rather than letting this escape raw also makes audio-backend.ts's
			// promise of a ListeningRejection and nothing else true, where before the
			// runtime's catch-all was quietly covering for it.
			throw new ListeningRejection('unavailable', { cause: error });
		}
	}

	function stopListening(): void {
		// The session stays on `play-and-record` deliberately. Switching back would
		// cost a second audible dropout to undo a mode the listener has already been
		// through once, and iOS drops its recording indicator on the released track
		// rather than on the session type, so nothing about Principle I turns on it.
		//
		// A track outlives the stream object, so releasing the reference alone leaves
		// the recording indicator lit. Principle I makes that non-negotiable.
		//
		// The graph comes down before the tracks do, and the message handler goes with
		// it. A source node whose tracks have stopped still outputs silence, and a
		// worklet still being pulled would go on reading that silence and go on posting
		// it, sliding every parameter a Control Signal drives down to what an empty
		// room looks like.
		//
		// Tearing the graph down is not enough on its own, though, which is why the
		// release goes out first: disconnecting a processor does not end it, and the
		// Material it holds has to be zeroed by the only thread that can see it.
		//
		// The runtime's signals are left wherever they last read. Ramping them back to
		// their declared defaults when input suspends is a Scene's job under ADR 0004,
		// not this seam's. The probe's copy below is a different thing and does get
		// cleared: it exists to show a suite with no ears that a reading arrived, and a
		// `recognition` left at 1 would show a return that has already ended.
		// Ahead of the teardown, so an attempt still waiting on the prompt or on the
		// module fetch sees the bump whichever side of it wakes up first.
		listeningEpoch += 1;
		listeningInput?.disconnect();
		if (levelListening !== undefined) {
			// Ahead of both lines under it: the port is how the message travels, and a
			// processor that never hears it holds four seconds of Material and keeps
			// running whatever the main thread does with the node.
			levelListening.port.postMessage(RELEASE_MESSAGE);
			levelListening.port.onmessage = null;
			levelListening.disconnect();
		}
		listeningInput = undefined;
		levelListening = undefined;
		lastSignalValues.clear();
		for (const track of stream?.getTracks() ?? []) {
			// Removed before the stop, so a mute the platform fires while releasing the
			// track cannot read as the platform taking a microphone the app is already
			// handing back. onMute answers for a track the backend still holds.
			track.removeEventListener('mute', handleTrackMute);
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

	function onMute(listener: () => void): () => void {
		muteListeners.add(listener);
		return (): void => {
			muteListeners.delete(listener);
		};
	}

	return { resume, start, setParameter, fadeIn, fadeOut, startListening, stopListening, stop, onSignal, onMute, probe };
}
