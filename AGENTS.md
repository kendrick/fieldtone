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

### Code review

For an agent reviewing a diff against this repo. See `docs/agents/code-review.md`.

## Where things live

Changing `src/audio/` or `src/scenes/`? `docs/agents/file-map.md` names what each file there is for. What it and the tree cannot show:

`runtime.ts` wires the seam together at module scope, which is safe only because nothing it constructs allocates an audio node before the first press. Read its comment before adding a Scene, because it is the one place the module-scope rule below is deliberately bent.

The runtime holds listener values and signal values apart in the store and combines them only on the way out to the backend, which is what keeps a Control Signal out of `serializeParameters` and out of a share link.

A Scene's schema and Control Signal declarations live in Tone-free files beside its Bed, so they can be asserted on under jsdom.

`src/components/parameter-controls.tsx` is the only file that touches `history`. It and `share-control.tsx` are the two that read `window.location`, and share-control reads `href` alone, never `search`, so a link carries every parameter the Scene declares rather than what a bare `/` holds. `listen-invitation.tsx` is the only file that touches `localStorage`.

`src/app/manifest.ts` is the one file that writes the `/fieldtone` base path by hand. Its comments carry the base-path rule Next does not apply, the reason `force-static` is there, and the command that regenerates every icon from `icon.svg`.

Every function in `tests/integration/probe.ts` is handed to `page.evaluate` and runs inside the browser, so none may close over module scope.

Run `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` before calling anything done. CI runs all five plus the static export but drives Playwright on Chromium only, so WebKit and Firefox are a local check, where a flake invisible to CI has already surfaced.

## Audio rules no config states

These cost real bugs to learn. Each one is invisible to the type checker and to a green test suite.

**Build audio nodes on the first press, never at module scope.** The static export evaluates every module in Node during prerender, and iOS refuses to start an AudioContext outside a user gesture. Both constraints point the same way. A `Math.random()` call at module scope has the same problem from the other side: it runs once at build time and ships one draw to every visitor.

**Keep `resume()` the first await on the play path.** iOS spends the user gesture on whichever await runs first, so anything ahead of it takes the gesture and the context never starts. Set `navigator.audioSession.type = 'playback'` synchronously before it, which keeps audio alive with the ringer switch silenced. `startListening()` is the measured exception: on iOS a 300 ms audio-clock fade runs ahead of `getUserMedia` and the tap's activation survives it (PR #42). Nothing else may come between the press and the prompt.

**Prove audibility with an `OfflineAudioContext`.** A headless browser reports its AudioContext as `running` and then freezes the clock at the first block, so a realtime meter reads zero whether the graph works or is broken. An offline render needs no sound card and answers the same way everywhere. Guard any assertion that depends on the realtime clock advancing, and skip rather than assert on silence. `Tone.Offline` swaps the global context around an awaited callback, so never let two renders overlap.

**Keep the runtime Tone-free, and let each Scene build its own graph.** Two kinds of file import Tone as a value: `tone-backend.ts`, which owns the envelope and the master bus, and a Scene's Bed builder, which declares the graph that Scene plays. Everything between them stays Tone-free, including `audio-backend.ts`, `scene-runtime.ts` and `recording-backend.ts`, which is what lets the runtime be tested with no AudioContext anywhere near it. Moving a Scene's node construction into the adapter would defeat that, because the adapter would then need to know every Scene and adding one would mean editing it. An `import type` from Tone is fine anywhere, since `verbatimModuleSyntax` erases it.

**Schedule against the audio clock.** Principle V rules out JS timers and polling loops. Tone's context has its own `setTimeout` that rides the existing ticker and costs nothing extra.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
