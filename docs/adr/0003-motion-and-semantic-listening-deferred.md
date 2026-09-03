# Motion input and semantic listening deferred to v2

Both inputs would make Scenes richer. Both are deferred, for related reasons: each charges the user something before the app has earned it.

## Motion

iOS gates `DeviceMotionEvent.requestPermission()` behind a user gesture, so motion input is a second permission prompt stacked on the microphone. The v1 first-run flow is three escalating invitations — press play, then _let it listen_, then _put your headphones on_ — each earning the next. A further prompt before the user has heard anything good breaks that shape. Revisit once the invitation flow has proven it works on real people.

This is the reason Principle I's motion clause was struck in constitution 1.1.0. The constitution should govern what ships, not legislate a feature whose design nobody has examined.

## Semantic listening

An on-device classifier is the only thing that meaningfully improves selective re-injection. Onset detection knows that something happened; it cannot tell a laugh from a bus. A Scene that catches a friend's voice and weaves it back in is the point of the app. One that faithfully replays the air conditioner is noise with extra steps.

It costs a model download, bundle size, sustained CPU against a thermal budget already under pressure, and a perception problem: "it knows when you're talking" reads as invasive even though nothing leaves the device. For an app whose central promise is privacy, that last one is not cheap.

Environment fingerprinting needs none of this. RMS distribution, onset density, and Spectral Listening's band energies separate a café from a train from a quiet room, which would cover Scene auto-selection.

### When to buy the classifier

Revisit only when both hold:

1. In a listening test of ten five-minute sessions across varied environments, more than half of Material mode's re-injected fragments are steady mechanical sound — traffic, HVAC, engine hum — rather than transient human or incidental sound.
2. Tuning Level Listening's onset detector and Spectral Listening's band weighting has already been tried against that ratio and failed to shift it.

Condition 2 matters more than condition 1. Cheap heuristics get tried first and have to demonstrably cap out. Without that bar, "the re-injections feel boring" becomes a standing argument for buying a model that may not fix it.

## Correction, 2026-09-02

This ADR originally committed environment fingerprinting to v1, resting it on statistics it claimed the app already had. Neither held. No analysis code existed then and none exists now, and the stated payoff was Scene auto-selection, which needs more than one Scene and some way to choose between them. #22 scopes Listening without fingerprinting and carries the reasoning.

The numbered tier labels above were renamed in the same change. They named an escalation this repo defined nowhere; `CONTEXT.md` now defines Level Listening, Spectral Listening and Semantic Listening in their place.
