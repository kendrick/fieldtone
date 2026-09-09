# File map

What each file under `src/audio/`, `src/scenes/` and `public/worklets/` is for, and where the UI and the tests sit. The reasons live in the files themselves, in their header comments; this only names the roles.

## The audio seam

`src/audio/audio-backend.ts` is the interface. `tone-backend.ts` is the one adapter that makes sound: it owns the envelope and the master bus, opens the microphone, loads the Level Listening worklet and holds the graph that feeds it, and on iOS fades the Bed across the session-type switch. `audio-session.ts` holds that switch, and `worklet-url.ts` works out where a worklet module is served from. `recording-backend.ts` is the fake that records commands for tests. `page-visibility.ts` declares `PageVisibility`, which answers whether the page is hidden and nothing else; `createDocumentVisibility` is its adapter over `document`, and `fake-visibility.ts` is the fake beside it. `scene-runtime.ts` sequences the seam over a Zustand store and takes a `PageVisibility` beside the backend and the Scene, and `runtime.ts` wires those three together. `app-surface.ts` is the one file that reads `navigator.standalone`, which is what tells an installed app from a Safari tab. `background-listening.ts` holds the background-Listening opt-in: the choice for this session, its persistence, and the `PageVisibility` decorator that keeps a hidden page from suspending Listening while the opt-in applies. `goertzel.ts` measures the power at one frequency, which is how the offline probe tells returned Material apart from the Bed playing under it. Every member of the seam is the runtime telling the backend something, except two that run the other way. `onSignal` is Listening telling the runtime something: a Control Signal, derived from live input rather than chosen by a listener. `onMute` is the platform telling the runtime it took the microphone away.

`playback-state.ts` and `listening-state.ts` are the two state machines the runtime holds at once, one for the play button and one for the microphone, each with one function per legal edge. `capture-rejection.ts` maps a `DOMException` name to the `ListeningRejectionReason` the Invitation phrases.

## Worklets

`public/worklets/` holds hand-written ES modules that no bundler sees and no linter checks. `level-listening.js` is the processor that runs on the audio thread, and `level-listening-maths.js` is the arithmetic it imports, kept next door so those functions can be exported and asserted on under jsdom. `material-maths.js` is the other half it imports: the ring buffer behind Recognition and the hold, return and release the processor drives it with, kept next door for the same reason.

## Scenes

`src/scenes/parameters.ts` holds a Scene's schema rules: declaration shape, clamping, default resolution, and the step grid a slider snaps to, which ADR 0006 settles. `control-signals.ts` does the same for Control Signals and combines a signal's offset with a listener's value. `parameter-serialization.ts` is the codec between parameter values and a query string. `src/scenes/ember/` is the one Scene, with its Bed builder and its own declarations.

## UI and tests

`src/app/` is the Next app shell, including the manifest and the mark; `src/components/` holds the controls. `tests/integration/` is Playwright across five browser projects, and `probe.ts` there holds the offline-render helpers and the audibility thresholds. A `*.spec.ts` beside a source file is Vitest.
