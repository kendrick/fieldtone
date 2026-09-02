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

`src/audio/` holds the audio seam. `audio-backend.ts` is the interface, `tone-backend.ts` is the one that makes sound, `recording-backend.ts` is the fake that records commands for tests, and `scene-runtime.ts` sequences them over a Zustand store. `src/app/` and `src/components/` are the UI. `tests/integration/` is Playwright across five browser projects; `*.spec.ts` beside a source file is Vitest.

Run `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` before calling anything done. CI runs all five plus the static export.

## Audio rules no config states

These cost real bugs to learn. Each one is invisible to the type checker and to a green test suite.

**Build audio nodes on the first press, never at module scope.** The static export evaluates every module in Node during prerender, and iOS refuses to start an AudioContext outside a user gesture. Both constraints point the same way. A `Math.random()` call at module scope has the same problem from the other side: it runs once at build time and ships one draw to every visitor.

**Keep `resume()` the first await on the start path.** iOS spends the user gesture on whichever await runs first, so anything awaited ahead of it takes the gesture and the context never starts. Set `navigator.audioSession.type = 'playback'` synchronously before that await, which is what keeps audio alive when the physical ringer switch is silenced.

**Prove audibility with an `OfflineAudioContext`.** A headless browser reports its AudioContext as `running` and then freezes the clock at the first block, so a realtime meter reads zero whether the graph works or is broken. An offline render needs no sound card and answers the same way everywhere. Guard any assertion that depends on the realtime clock advancing, and skip rather than assert on silence. `Tone.Offline` swaps the global context around an awaited callback, so never let two renders overlap.

**Import Tone.js in `tone-backend.ts` and nowhere else.** Everything else under `src/audio/` stays Tone-free, which is what lets the runtime be tested with no AudioContext anywhere near it. A `import type` from Tone is fine anywhere, since `verbatimModuleSyntax` erases it.

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
- A decision an ADR already explains. Argue with the ADR instead, as a P2.

### Output

Lead with a one-line verdict: safe to merge, or blocked on N issues. Group findings by severity. Close with what you ran and what you could not check. No summary of the diff, no praise section.

State plainly when the diff is clean.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
