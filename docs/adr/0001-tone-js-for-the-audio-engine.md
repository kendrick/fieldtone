# Tone.js for the audio engine

Generative ambient music lives or dies on scheduling, and Tone.js's transport is the part we would otherwise write badly ourselves. It is actively maintained, which Principle IV requires, and it does not block dropping to a raw AudioWorklet for the analysis path.

## Considered Options

- **WebPd** — runs actual Pure Data patches, making it the direct descendant of RjDj's architecture and the sentimental favorite. Rejected on Principle IV's "production-ready" bar, not on merit. If it matures, revisit.
- **Raw Web Audio plus AudioWorklet** — no dependency and total control, but we hand-roll a scheduler, which is the one piece this project cannot afford to get wrong.
- **Elementary Audio** — a cleaner functional model than Tone's, with a smaller community and a licensing story we did not want to think about.

## Consequences

Tone.js schedules on the main thread. That constrains what else may run there, and it is the reason [ADR 0002](0002-webgl-with-a-thermal-budget.md) rules out CPU-bound rendering.
