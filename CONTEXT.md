# FieldTone

A progressive web app that turns the sound around you into generative ambient music. The lineage is [RjDj](https://en.wikipedia.org/wiki/RjDj) (Reality Jockey, 2008-2013), which is where the term Scene comes from.

## Language

**Scene**:
An authored preset that defines how the app listens and what it produces, including its visual treatment. Ships with the app; the user selects one and adjusts its parameters, but does not create or save new ones.
_Avoid_: Preset, patch, mode, soundscape

**Reactive**:
Describes output whose character is shaped in real time by live input. Reactive is the relationship between input and output, not a genre.
_Avoid_: Interactive, responsive, adaptive

**Listening**:
Reading the microphone, both to derive Control Signals and to catch Material. Listening never records and never stores audio; what it holds is bounded, in memory, and gone when Listening stops.
_Avoid_: Recording, capturing, sampling

**Listening Depth**:
How far into a sound Listening goes, and what that costs. A deeper depth earns its cost only after the shallower one has run out.
_Avoid_: Tier, analysis stage, quality setting

**Level Listening**:
The shallowest depth, which reads loudness and the moment something happens. It knows a sound occurred, never what it was.
_Avoid_: Amplitude tracking, volume detection

**Spectral Listening**:
The middle depth, which reads whether a sound is bright or dark. It separates kinds of sound without identifying any of them.
_Avoid_: Frequency analysis, spectrum, EQ

**Semantic Listening**:
The deepest depth, which reads what a sound actually is, a laugh or a bus.
_Avoid_: Classification, sound recognition (Recognition names a Moment here)

**Control Signal**:
A value derived from live input that moves a synthesis parameter away from where the listener set it, without changing their setting. The listener never hears a Control Signal, only its effect.
_Avoid_: Envelope, trigger, modulator

**Material**:
Live input the listener actually hears, transformed rather than analyzed away. A Control Signal finds the piece worth using, so the two compose rather than competing.
_Avoid_: Source audio, input audio, dry signal

**Bed**:
The generative layer of a Scene that plays without any microphone input. Every Scene has one, so the app works before the user grants microphone permission and if they refuse it.
_Avoid_: Base layer, drone, fallback

**Moment**:
A perceptible event in a Scene that catches attention without demanding it. Moments are what the app exists to produce; a Scene that never resolves into one has failed even if it runs correctly.
_Avoid_: Event, cue, hit

**Recognition**:
The Moment where a listener hears a sound they made come back changed but still identifiably theirs, and the one the app is built around. Both halves of Listening make it, a Control Signal marking the sound and Material returning it.
_Avoid_: Playback, echo, callback

**Invitation**:
An optional ask that unlocks more of the experience and is offered only after the previous one has paid off. FieldTone has three, in order: press play, let it listen, put your headphones on. An Invitation is never a wall; refusing one leaves a working app.
_Avoid_: Prompt, permission request, onboarding step

**Environment Fingerprint**:
A characterization of the listener's surroundings derived from live input, used to tell one kind of place from another. Describes the room, never the people in it.
_Avoid_: Context, profile, classification
