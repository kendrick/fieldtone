# FieldTone

A progressive web app that turns the sound around you into generative ambient music. Read `CONTEXT.md` before naming anything: the domain words are load-bearing and each one lists the synonyms to avoid.

## Binding documents

- `.specify/memory/constitution.md`—ten principles, ordered. When two conflict the earlier wins, and Principle I outranks everything. Four are NON-NEGOTIABLE.
- `docs/adr/`—decisions with their reasoning. Argue with an ADR by writing a new one, not by quietly diverging.
- `CONTEXT.md`—the domain vocabulary. See `docs/agents/domain.md` for when to read which.

## Agent skills

### Issue tracker

GitHub Issues, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

## Where things live

`src/audio/` holds the audio seam. `audio-backend.ts` is the interface, now also home to `ListeningRejection`, the one error `startListening` rejects with; `tone-backend.ts` is the one that makes sound and, per ADR 0004, the one that opens the microphone with every voice-processing constraint off, fading the Bed across the iOS session-type switch that has to precede it; `audio-session.ts` is where that switch lives, Tone-free and behind one `typeof navigator` guard so it can be tested with no AudioContext; `recording-backend.ts` is the fake that records commands for tests, and `scene-runtime.ts` sequences them over a Zustand store. `runtime.ts` wires those together at module scope, which is safe only because nothing it constructs allocates an audio node before the first press—read its comment before adding a Scene, because it is the one place the module-scope rule below is deliberately bent. `playback-state.ts` is the four states the play button moves through; `starting` exists because resuming the AudioContext is awaited and a second press can land in that gap. `listening-state.ts` is the same shape for the microphone, named `NotListening` rather than `Idle` because `playback-state.ts` already owns that name and the runtime holds both machines at once; `opening` exists for the same reason `starting` does, because `getUserMedia` is awaited and a second accept can land in the gap. `capture-rejection.ts` is the Tone-free, DOM-free map from a `DOMException` name to the `ListeningRejectionReason` that `listening-state.ts` declares, split out so jsdom can test it with no AudioContext anywhere near it. `onSignal` is the seam's one upward channel. Every other member is the runtime telling the backend something, and a Control Signal is Listening telling the runtime something. `recording-backend.ts` drives that channel from a test through `emitSignal`, which records no command, because a signal is input to the runtime rather than output from it. `scene-runtime.ts` holds listener values and signal values apart in the store and combines them only on the way out to the backend, which is what keeps a Control Signal out of `serializeParameters` and out of a share link. `src/scenes/parameters.ts` holds the pure schema rules—declaration shape, clamping, and default resolution—with no audio. `src/scenes/control-signals.ts` mirrors `parameters.ts` for Control Signals and stays Tone-free: declaration shape, the 0..1 signal clamp, and the two halves of combining—`signalOffset`, which is one signal's unclamped contribution, and `modulatedParameterValue`, which applies a single offset and clamps through the parameter's own rules. Several signals on one parameter sum their offsets and clamp once, because clamping each in turn made the result depend on declaration order. `src/scenes/parameter-serialization.ts` is the Tone-free codec between parameter values and a query string, and the runtime exposes it. `src/components/parameter-controls.tsx` is the only file that touches `history`, and it and `src/components/share-control.tsx` are the two that read `window.location`—share-control.tsx reads only `href` and never `search`, because a share link has to carry every parameter the Scene declares rather than whatever the address bar happens to hold, which on a bare `/` is nothing. `src/components/listen-invitation.tsx`—the second Invitation, its floor a CSS animation delay in `globals.css` rather than a JS timer—is the only file that touches `localStorage`. Each Scene's own schema and Control Signal declarations live in Tone-free files beside its Bed (like `src/scenes/ember/parameters.ts` and `src/scenes/ember/control-signals.ts`), because importing Tone at module scope builds an AudioContext that no unit test under jsdom survives. `src/app/` and `src/components/` are the UI. `src/app/manifest.ts` is the one file that writes the `/fieldtone` base path by hand, and `src/app/icon.svg` is the mark every raster derives from; read manifest.ts's comments before touching either, because they carry the base-path rule Next does not apply for you, the reason `force-static` is there, and the command that regenerates the PNGs. `tests/integration/` is Playwright across five browser projects, and `probe.ts` there holds the offline-render helpers and the audibility thresholds—every function in it is handed to `page.evaluate` and runs inside the browser, so none may close over module scope. `*.spec.ts` beside a source file is Vitest.

Run `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` before calling anything done. CI runs all five plus the static export. It drives Playwright against `mobile-chrome` and `desktop-chrome` only, though, so WebKit and Firefox are a local check—which is where a flake invisible to CI has already surfaced once. A green CI does not mean a green local run.

## Audio rules no config states

These cost real bugs to learn. Each one is invisible to the type checker and to a green test suite.

**Build audio nodes on the first press, never at module scope.** The static export evaluates every module in Node during prerender, and iOS refuses to start an AudioContext outside a user gesture. Both constraints point the same way. A `Math.random()` call at module scope has the same problem from the other side: it runs once at build time and ships one draw to every visitor.

**Keep `resume()` and `startListening()` each the first await on its own path.** iOS spends the user gesture on whichever await runs first, so anything awaited ahead of it takes the gesture and the context—or the microphone—never starts. Set `navigator.audioSession.type = 'playback'` synchronously before `resume()`'s await, which is what keeps audio alive when the physical ringer switch is silenced; `startListening()` needs no setup of its own, only the same discipline of awaiting `getUserMedia` first.

**Prove audibility with an `OfflineAudioContext`.** A headless browser reports its AudioContext as `running` and then freezes the clock at the first block, so a realtime meter reads zero whether the graph works or is broken. An offline render needs no sound card and answers the same way everywhere. Guard any assertion that depends on the realtime clock advancing, and skip rather than assert on silence. `Tone.Offline` swaps the global context around an awaited callback, so never let two renders overlap.

**Keep the runtime Tone-free, and let each Scene build its own graph.** Two kinds of file import Tone as a value: `tone-backend.ts`, which owns the envelope and the master bus, and a Scene's Bed builder, which declares the graph that Scene plays. Everything between them stays Tone-free, including `audio-backend.ts`, `scene-runtime.ts` and `recording-backend.ts`, which is what lets the runtime be tested with no AudioContext anywhere near it. Moving a Scene's node construction into the adapter would defeat that, because the adapter would then need to know every Scene and adding one would mean editing it. An `import type` from Tone is fine anywhere, since `verbatimModuleSyntax` erases it.

**Schedule against the audio clock.** Principle V rules out JS timers and polling loops. Tone's context has its own `setTimeout` that rides the existing ticker and costs nothing extra.

## Code Review Rules

**For an agent reviewing a diff against this repo.** You are reviewing the diff, not the repo. A pre-existing problem the diff did not touch is a comment at most.

### Scope

Review what the diff changes, plus anything the diff makes wrong. The second half is where the findings are: a comment that justified a threshold against code the diff deleted, a doc describing a function that got renamed, a test whose name no longer matches what it asserts. Stale reasoning reads as verified, which is what makes it worse than no reasoning.

Assume the author is competent. Do not explain the diff back to them, and do not comment to say something looks fine.

### Severity

**P0—blocks merge.** Breaks in production: leaked audio data or PII, an unhandled error on a primary path, a breaking change to an exported type, audio that cannot start on iOS, a node built at module scope that breaks prerender.

**P1—fix before merge, or say why not.** A likely bug or a real maintenance risk: wrong logic on an edge case, a missing error or loading state, a race, a silent behavior change, new branching logic with no test, a test that would pass while the behavior it names is gone.

**P2—do not post.** Everything else. If a finding could be P1 or P2, it is P2.

Rank most severe first. Zero findings is a real answer; a manufactured P2 spends the author's attention for nothing.

### Evidence

Name the file and line, quote the text, and state the concrete failure ("if `items` is empty, this throws"). Propose a specific fix.

Confirm every claim against code in the diff or in a file the diff touches. Where a finding can be checked by running something, run it and paste the real output. Report a finding you cannot reproduce as a question, with what you tried, rather than dropping it or promoting it to a certainty.

A claim about a comment is a claim about the code, so verify it against the code.

### What to check

- Anything built at module scope in an audio path, and anything awaited ahead of `resume()`.
- A test that depends on the realtime audio clock advancing without a guard.
- Tone.js imported outside `tone-backend.ts` as a value rather than a type.
- A JS timer or polling loop where the audio clock would do.
- `any`, `!`, and `as` added without a comment saying why. Principle III forbids `any` outright.
- A `useEffect` synchronizing state that could be derived during render, and `"use client"` on a file that does not need it.
- Interactive elements without accessible names, keyboard handling, or the right semantic element. Principle II is non-negotiable and a `div` with `onClick` fails it.
- Comments that explain what the code does rather than why it has this shape.

### What not to flag

- Style, naming, formatting, and import ordering. ESLint and stylelint own those.
- The `nextjs-agent-rules` block at the bottom of this file, which `next dev` rewrites.
- Long comments that record a real incident. Concision would destroy what they carry.
- A Scene importing Tone as a value. That is the design, not a leak of the seam.
- A decision an ADR already explains. Argue with the ADR instead, as a P2.

### Output

Lead with a one-line verdict: safe to merge, or blocked on N issues. Group findings by severity. Close with what you ran and what you could not check. No summary of the diff, no praise section.

State plainly when the diff is clean.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
