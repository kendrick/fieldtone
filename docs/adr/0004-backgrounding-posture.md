# Backgrounding: playback continues, Listening suspends, visuals suspend

FieldTone behaves like a music app when it goes to the background. The Bed keeps playing with the screen locked or another app in front. Listening stops, unless the listener has opted into keeping it running. The visual layer stops. The measurements behind all of this are in `docs/spikes/0013-backgrounding-platform-behavior.md`; this ADR records what we decided and why.

## Playback continues

Setting `navigator.audioSession.type` is what buys this. WebKit's `AudioContext::shouldOverrideBackgroundPlaybackRestriction` waives its blanket background restriction when the page has declared either `playback` or `play-and-record`, and one predicate covers both types with no branch between them. Measured on iPhone, iOS 18.7, Safari 26.6.1: the audio clock kept pace with wall time to `ratio=1.000` across every backgrounded run, under both types, on the lock screen and behind another app.

Desktop needs none of this. `navigator.audioSession` is not implemented in desktop Chrome, and both Chrome and Firefox kept a backgrounded tab playing past thirty seconds without it. The feature guard around `navigator.audioSession` in `src/audio/tone-backend.ts` is load-bearing rather than defensive: on desktop the property is absent, and the posture holds anyway because neither browser throttles a tab that is making sound.

That capability did not exist at the constitution's old iOS 16.4 floor. WebKit added it on 1 March 2024, and it reached users around iOS 17.5. Issue #14 raises Principle VI to iOS 18 rather than making the app degrade across a range where its central behavior is simply unavailable.

Principle V asks for processing to be suspended **or reduced** when the app is backgrounded. Suspending the visual layer is the reduction, and it is the expensive half, because ADR 0002 treats WebGL as the thermal driver. Audio alone is cheap enough that the principle is satisfied without silencing the thing the listener pressed play for.

## The session type is set late, not early

`playback` and `play-and-record` are equivalent for background audio, so their costs decide the choice between them.

They are not interchangeable for Listening. `DOMAudioSession::setType` installs an audio session _category override_. `MediaSessionManagerCocoa::updateSessionState` consults that override before reaching its capture branch, and because the capture branch is an `else if`, it never runs while an override stands. `playback` maps to `AVAudioSessionCategoryPlayback`, which has no input. A page that has declared `playback` has pinned itself to a record-incapable session, and starting capture does not move it back. On device, `getUserMedia` under `playback` rejects with `InvalidStateError`.

So Listening requires `play-and-record`. The question is when to ask for it.

Asking at startup would be simpler and is wrong. WebKit forces `Mode::VideoChat` whenever the category is `PlayAndRecord`, and bug 271305 moved that deliberately to the moment the type is set rather than the moment capture begins. It puts output on iOS's voice-chat volume scale and retunes the device's tonal equalization for voice. Every listener would pay that for a microphone most of them have not yet been offered, and the Bed is designed to be worth hearing on its own.

FieldTone therefore starts on `playback` and switches to `play-and-record` only when the listener accepts the second Invitation. The cost lands on the person who asked for Listening, at the moment they asked.

Switching under a running Bed is audible: roughly half a second to a second of silence, then a jump in level. That is a real audio event, so the Invitation has to cover it by fading the Bed down through the switch rather than letting it drop out. It is not a free configuration change.

## Listening suspends by default, and the opt-in only exists where it works

iOS does not treat the two ways FieldTone runs the same way.

Installed to the Home Screen, iOS suspends microphone capture when the app goes to the background. The track stays `live` and keeps delivering frames, but the frames sit at the noise floor. Between the Safari tab run and the installed run, peak fell from 0.448 to 0.009 and RMS from 0.027 to 0.0001. A `mute` event fires on the track, and the hardware follows it, audibly, on AirPods.

The same page in a Safari tab does not suspend. A tab holds the microphone open in the background for as long as it lives, which is the phone-in-a-pocket case, and it is where the app has to act for itself.

So FieldTone suspends Listening when it goes to the background, on both surfaces, rather than trusting either one to do it. Principle I is non-negotiable, and a microphone that stays open because nobody decided otherwise is not a defensible default.

Keeping it open is still worth offering, as a deliberate opt-in. Nothing in Principle I forbids background Listening: the principle governs where audio goes, not when it is read, and Listening never records or retains anything. What it forbids is an app that holds the microphone open without the listener choosing that.

The opt-in is honest only where the platform can honor it, which is the Safari tab. The installed app cannot keep capture alive whatever we set, so the setting is not offered there and the app says why instead of showing a control that does nothing. `navigator.standalone` is what tells the two apart. The `display-mode` media query reported `browser` for an installed app during the spike and cannot be trusted for this.

iOS shows its own recording indicator whenever capture is live, so a listener who takes the opt-in keeps a signal that FieldTone does not control and cannot suppress.

**The suspend trigger is the track's `mute` event where it fires, and `visibilitychange` otherwise.** Both fire, but `mute` arrived roughly nine tenths of a second earlier in the measured run, and it reports the thing we actually care about. `visibilitychange` is the fallback for the tab, where no `mute` ever comes and where the opt-in decides whether we act on it at all.

## Listening asks for echo cancellation off

`play-and-record` puts the session in `videoChat` mode, which turns on iOS voice processing. Voice processing ducks the device's output whenever it detects input, because in a video call that is exactly right. It stops the far end echoing back.

For FieldTone it is exactly wrong. Recognition is the Moment where a listener hears a sound they made come back changed but still theirs. Voice processing quiets the Bed at the precise instant the listener makes a sound, which is the instant the Bed most needs to be audible. It suppresses the coupling between output and input that Recognition depends on.

Measured on device, in the foreground, with the same Bed and the same AirPods: the default microphone ducks the output audibly, and a microphone requested with `echoCancellation: false` does not. `getSettings()` reports the constraint back as applied rather than accepted and ignored. The backgrounded pair of runs agrees. RMS on the constrained track came back roughly 2.7 times higher, though that last figure is not a controlled comparison.

Listening therefore requests `echoCancellation: false`. It asks for `autoGainControl` and `noiseSuppression` off in the same call, but Safari reports neither back through `getSettings()`, so treat those two as requested and unconfirmed.

The cost is that FieldTone can now hear itself. With echo cancellation off and the Bed playing through the speaker, the Bed is part of what the microphone reads, so it drives the Control Signals derived from it. The third Invitation, _put your headphones on_, removes that path entirely, which is a better reason for that Invitation than the one it was designed with.

Until headphones are on, a Scene whose Control Signal raises Bed level is a feedback loop that can run away. The clamping #6 specifies is what has to stop it, and #6 was written for a listener dragging a slider too far. A Control Signal reaching the same parameter is a second way in, so the clamp belongs at the parameter rather than at the UI. Nothing enforces that today, because no Scene has a Control Signal yet.

## Control Signals ramp to Scene defaults

The spike predicted that a suspended input would leave every Control Signal frozen at its last value, and worried about one parked near a closed filter leaving the Scene sounding broken.

The real behavior is worse in a quieter way. The track keeps delivering audio, so nothing freezes. That audio is near-silence, so anything derived from it drifts toward whatever silence maps to. The Scene ends up just as broken, and every signal looks like normal operation the whole way there.

On suspend, a Scene ramps its Control Signals to the defaults its Bed was authored against. The Bed already has to sound right with no microphone at all, because `CONTEXT.md` defines it as the layer that plays before permission is granted and if it is refused. Backgrounding reuses that state rather than inventing a new one.

## Visuals suspend

No visual layer exists yet, so this decides what to build rather than describing what happens. It suspends whenever the app is backgrounded, always, with no option.

ADR 0002 makes WebGL the thermal driver and gives it an adaptive resolution budget instead of a frame-rate target. Rendering frames nobody can see spends that budget for nothing, and Principle V's ceiling is a device that stays cool over thirty minutes. This is the "or reduced" half of Principle V's clause, and it is what lets playback claim the other half.

The visual layer suspends on `visibilitychange`, not on the microphone's `mute` event. The two signals answer different questions, and a Scene with Listening switched off still has a visual layer to stop.

## Implementation

Four issues carry this decision into code. Their acceptance criteria come from the measurements above rather than from design intent, so anything that specifies Listening should build on them rather than deriving the same requirements a second time and getting them wrong:

- Switching the session type and opening the microphone when Listening starts (#15)
- Suspending Listening when the app is backgrounded (#16)
- Offering background Listening as an opt-in, only where iOS honors it (#17)
- Ramping Control Signals to Scene defaults when input suspends (#18)

All four are `needs-triage` rather than `ready-for-agent`. Listening has no issue of its own, and #1 scopes the microphone out explicitly, so none of the four can start until Listening is scoped.

## Consequences

- Principle VI's floor moves to iOS 18 (#14).
- The second Invitation now has an audio transition to cover, not just a permission prompt.
- The background-Listening opt-in is the first setting whose availability depends on how the app was launched. Whatever reads `navigator.standalone` should live in one place rather than being checked throughout the settings UI, because the next surface-dependent capability will want it too.
- Whether `videoChat` mode audibly changes Ember's timbre is untested. The spike's probe used two sine waves, which a voice EQ has almost nothing to reshape. Check it with a real Bed when Listening ships.
- Everything about Listening was established on iOS. Desktop was measured for background playback only, because no desktop browser implements the Audio Session API that the rest of this turns on.
