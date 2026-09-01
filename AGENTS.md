# FieldTone

## Agent skills

### Issue tracker

GitHub Issues, driven with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md` for when to read them.

### Review guidelines

#### Scope

- Review only the diff and the code it directly touches. Do not audit
  unrelated files or propose refactors outside the change.
- Assume the author is competent. Do not explain what the diff does back
  to them, and do not comment to say something looks fine.

#### Severity

- **P0** — will break in production: data loss, auth or authorization
  bypass, leaked secrets or PII, unhandled error on a primary path,
  breaking change to a published API or exported type.
- **P1** — likely bug or real maintenance risk: incorrect logic on an
  edge case, missing error/loading state, race condition, missing test
  for new branching logic, silent behavior change.
- **P2** — everything else. Do not post P2 findings.
- If a finding could be P1 or P2, it is P2.

#### Evidence

- Every finding must name the file and line, state the concrete failure
  case ("if `items` is empty, this throws"), and propose a specific fix.
- Do not report anything you cannot confirm from code present in the diff
  or in files the diff touches. Never guess at the behavior of code you
  have not read. If you suspect a problem but cannot verify it, say so
  explicitly and mark it as a question rather than a finding.
- Do not report style, naming, formatting, or import ordering. ESLint and
  Prettier own those.

#### This codebase

- Flag any `useEffect` that synchronizes state that could be derived
  during render.
- Flag client components that could be server components, and any
  `"use client"` added to a file that does not need it.
- Flag `any`, non-null assertions (`!`), and type assertions (`as`) added
  in the diff unless there is a comment explaining why.
- Flag new UI that hardcodes color, spacing, or radius values instead of
  using design tokens or existing component variants.
- Flag interactive elements added without accessible names, keyboard
  handling, or correct semantic elements (a `div` with `onClick`).
- Flag new async server calls without error handling and without a
  loading state in the consuming UI.
- Flag secrets, tokens, or user PII in logs, error messages, or analytics
  events.

#### Output

- Lead with a one-line verdict: safe to merge, or blocked on N issues.
- Group findings by severity. No summary of the PR. No praise section.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
