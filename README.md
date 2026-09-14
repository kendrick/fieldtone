# FieldTone

A progressive web app that turns the sound around you into generative ambient music.

[Open FieldTone](https://kendrick.github.io/fieldtone/) in a recent browser, or install it to your home screen.

[![CI](https://github.com/kendrick/fieldtone/actions/workflows/ci.yml/badge.svg)](https://github.com/kendrick/fieldtone/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What It Does

FieldTone plays a Scene, an authored preset that decides how the app listens and what it produces. Every Scene has a Bed, the generative layer that runs with no microphone input, so there is music before you grant the app anything. Give FieldTone the microphone and it starts reading the room, folding what it hears into what it plays.

The Moment the app is built around is Recognition—hearing a sound you made come back changed but still identifiably yours. FieldTone marks the sound as it happens, a cough or a word, and holds a fragment of it. The Scene returns that fragment through its reverb a moment later.

## Your Audio Never Leaves the Device

Every bit of processing happens in your browser. FieldTone has no backend and no analytics; the whole app is a static export sitting on GitHub Pages.

- FieldTone transmits no audio to any server or service.
- It records nothing, and writes no audio to storage.
- Listening holds a bounded in-memory buffer, 10 seconds at most. That buffer is zeroed the moment Listening stops or the platform suspends it.

That is Principle I of the [constitution](.specify/memory/constitution.md), and it is non-negotiable. A feature that needs a server does not ship.

## Using It

FieldTone asks for three things, in order. Press play and the Scene starts on its own. Let it listen, and the microphone begins feeding the Scene. Put your headphones on, and the app stops hearing its own output come back through the speaker. Refuse any of them and you still have a working app.

## Ember

Ember is a slow chord drifting through a filter sweep, with a reverb behind it. Two controls:

| Control    | What it moves                     |
| ---------- | --------------------------------- |
| Space      | How wet the reverb runs           |
| Brightness | How high the filter sweep reaches |

Loudness in the room lifts Brightness above wherever you left the slider, then lets it settle back when the room goes quiet. Your setting never changes; the Control Signal moves the value around that setting. It drives Brightness rather than Space on purpose. Without headphones FieldTone hears its own output, and a signal that raised the reverb would keep feeding itself louder ([ADR 0004](docs/adr/0004-backgrounding-posture.md)).

Press Share and you get a link carrying every parameter the Scene declares, whether or not you moved a slider first.

## Browser Support

iOS Safari 18+, the last two versions of Chrome on Android, and current desktop Chrome, Firefox, Safari and Edge. Background playback sets the iOS floor. Keeping an AudioContext alive once the app leaves the screen needs `navigator.audioSession.type`, which reached users around iOS 17.5. Below that version the Bed stops when the app is backgrounded.

## Development

Install Node 24 (pinned in `.nvmrc`) and pnpm 11.25, then:

```bash
pnpm install
pnpm dev
```

The dev server comes up at `http://localhost:3000/fieldtone`. That base path lives in `next.config.ts` rather than in the deploy workflow, so the export you test locally is byte-for-byte the one that ships.

Five checks, and CI runs all of them:

```bash
pnpm lint
pnpm lint:css
pnpm typecheck
pnpm test      # Vitest under jsdom
pnpm test:e2e  # Playwright against the static export
```

CI drives Playwright on Chromium only, so WebKit and Firefox are a local check. Run them before you call anything audio-related done; a flake invisible to CI has already turned up that way.

### Reading the Code

`src/audio/` holds the runtime, which imports no Tone.js, and `runtime.ts` is where its pieces get wired together. `src/scenes/` has one directory per Scene. A Scene's parameter schema and Control Signal declarations sit in Tone-free files beside the builder that makes its graph, so they can be tested with no AudioContext anywhere near them. `src/components/` is the UI. `public/worklets/` is the analysis worklet, and its header is required reading before you edit it.

Two files are worth opening before you write anything. [CONTEXT.md](CONTEXT.md) is the domain vocabulary, where every word is load-bearing and each one lists the synonyms to avoid. [AGENTS.md](AGENTS.md) collects the constraints that cost real bugs to learn, most of them invisible to the type checker and to a green test suite. Decisions and the reasoning behind them live in [docs/adr/](docs/adr/).

## Deploying

Push to `main` and [deploy.yml](.github/workflows/deploy.yml) publishes the static export to GitHub Pages. Pages needs "GitHub Actions" selected as its source in repo settings, which the workflow cannot do for itself.

## Acknowledgements

The lineage is [RjDj](https://en.wikipedia.org/wiki/RjDj) (Reality Jockey, 2008–2013), where the word Scene comes from.

## License

[MIT](LICENSE)
