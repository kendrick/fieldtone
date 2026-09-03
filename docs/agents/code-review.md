# Code Review Rules

**For an agent reviewing a diff against this repo.** You are reviewing the diff, not the repo. A pre-existing problem the diff did not touch is a comment at most.

## Scope

Review what the diff changes, plus anything the diff makes wrong. The second half is where the findings are: a comment that justified a threshold against code the diff deleted, a doc describing a function that got renamed, a test whose name no longer matches what it asserts. Stale reasoning reads as verified, which is what makes it worse than no reasoning.

Assume the author is competent. Do not explain the diff back to them, and do not comment to say something looks fine.

## Severity

**P0—blocks merge.** Breaks in production: leaked audio data or PII, an unhandled error on a primary path, a breaking change to an exported type, audio that cannot start on iOS, a node built at module scope that breaks prerender.

**P1—fix before merge, or say why not.** A likely bug or a real maintenance risk: wrong logic on an edge case, a missing error or loading state, a race, a silent behavior change, new branching logic with no test, a test that would pass while the behavior it names is gone.

**P2—do not post.** Everything else. If a finding could be P1 or P2, it is P2.

Rank most severe first. Zero findings is a real answer; a manufactured P2 spends the author's attention for nothing.

## Evidence

Name the file and line, quote the text, and state the concrete failure ("if `items` is empty, this throws"). Propose a specific fix.

Confirm every claim against code in the diff or in a file the diff touches. Where a finding can be checked by running something, run it and paste the real output. Report a finding you cannot reproduce as a question, with what you tried, rather than dropping it or promoting it to a certainty.

A claim about a comment is a claim about the code, so verify it against the code.

## What to check

- Anything built at module scope in an audio path, and anything awaited ahead of `resume()`.
- A test that depends on the realtime audio clock advancing without a guard.
- Tone.js imported outside `tone-backend.ts` as a value rather than a type.
- A JS timer or polling loop where the audio clock would do.
- `any`, `!`, and `as` added without a comment saying why. Principle III forbids `any` outright.
- A `useEffect` synchronizing state that could be derived during render, and `"use client"` on a file that does not need it.
- Interactive elements without accessible names, keyboard handling, or the right semantic element. Principle II is non-negotiable and a `div` with `onClick` fails it.
- Comments that explain what the code does rather than why it has this shape.

## What not to flag

- Style, naming, formatting, and import ordering. ESLint and stylelint own those.
- The `nextjs-agent-rules` block at the bottom of `AGENTS.md`, which `next dev` rewrites.
- Long comments that record a real incident. Concision would destroy what they carry.
- A Scene importing Tone as a value. That is the design, not a leak of the seam.
- A decision an ADR already explains. Argue with the ADR instead, as a P2.

## Output

Lead with a one-line verdict: safe to merge, or blocked on N issues. Group findings by severity. Close with what you ran and what you could not check. No summary of the diff, no praise section.

State plainly when the diff is clean.
