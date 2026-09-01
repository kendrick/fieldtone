# Motion input and semantic listening deferred to v2

Both inputs would make Scenes richer. Both are deferred, for related reasons: each charges the user something before the app has earned it.

## Motion

iOS gates `DeviceMotionEvent.requestPermission()` behind a user gesture, so motion input is a second permission prompt stacked on the microphone. The v1 first-run flow is three escalating invitations — press play, then _let it listen_, then _put your headphones on_ — each earning the next. A further prompt before the user has heard anything good breaks that shape. Revisit once the invitation flow has proven it works on real people.

This is the reason Principle I's motion clause was struck in constitution 1.1.0. The constitution should govern what ships, not legislate a feature whose design nobody has examined.

## Semantic listening

An on-device classifier is the only thing that meaningfully improves selective re-injection. Onset detection knows that something happened; it cannot tell a laugh from a bus. A Scene that catches a friend's voice and weaves it back in is the point of the app. One that faithfully replays the air conditioner is noise with extra steps.

It costs a model download, bundle size, sustained CPU against a thermal budget already under pressure, and a perception problem: "it knows when you're talking" reads as invasive even though nothing leaves the device. For an app whose central promise is privacy, that last one is not cheap.

Environment fingerprinting ships in v1 without any of this. RMS distribution, onset density, and Tier 2's band energies separate a café from a train from a quiet room on statistics we already compute, which covers Scene auto-selection.

### When to buy the classifier

Revisit only when both hold:

1. In a listening test of ten five-minute sessions across varied environments, more than half of Material mode's re-injected fragments are steady mechanical sound — traffic, HVAC, engine hum — rather than transient human or incidental sound.
2. Tuning the Tier 1 onset detector and Tier 2 band weighting has already been tried against that ratio and failed to shift it.

Condition 2 matters more than condition 1. Cheap heuristics get tried first and have to demonstrably cap out. Without that bar, "the re-injections feel boring" becomes a standing argument for buying a model that may not fix it.
