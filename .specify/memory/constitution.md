<!--
  Sync Impact Report
  Version change: none → 1.0.0 (initial ratification)
  Principles (ordered by priority):
    1. Privacy & Security (NON-NEGOTIABLE)
    2. Accessibility (NON-NEGOTIABLE)
    3. TypeScript Standards (NON-NEGOTIABLE)
    4. Technology Stack (NON-NEGOTIABLE)
    5. State Management
    6. Performance & Battery Efficiency
    7. Browser Compatibility
    8. Progressive Web App
    9. Testing Strategy
    10. Code Quality
    11. Deployment
    12. Development Experience
  Added sections: State Management, Progressive Web App, Motion/Sensor Policy (within Privacy)
  Removed sections: none
  Templates requiring updates:
    - plan-template.md ✅ no conflicts (Constitution Check is dynamic)
    - spec-template.md ✅ no conflicts
    - tasks-template.md ✅ no conflicts
  Follow-up TODOs:
    - Web Audio library selection (deferred to planning phase)
-->

# FieldTone Constitution

FieldTone is a progressive web app that transforms ambient sound
into reactive soundscapes. All principles below are ordered by
priority; when principles conflict, higher-numbered principles
take precedence over lower-numbered ones.

## Core Principles

### I. Privacy & Security (NON-NEGOTIABLE)

- ALL audio processing MUST happen client-side only
- NO audio data may be transmitted to any server or external service
- NO audio recording or persistent storage of raw audio data
- Motion sensor data (accelerometer, gyroscope) MUST NOT be
  transmitted off-device; access MUST be gated behind an explicit
  user permission prompt
- Security headers and Content Security Policy MUST follow OWASP
  recommendations for static web apps

### II. Accessibility (NON-NEGOTIABLE)

- Full keyboard navigation support for all UI controls
- Proper ARIA labels and semantic HTML throughout
- Focus management for scene selection and parameter controls
- Visual feedback for audio state (playing, paused, processing)
- Color contrast ratios MUST meet WCAG 2.1 AA minimums
- Readable typography with a minimum body text size of 16 px
- Screen reader compatibility for all interactive elements

### III. TypeScript Standards (NON-NEGOTIABLE)

- Strict mode MUST be enabled in tsconfig.json
- The `any` type is FORBIDDEN in all code
- All function parameters and return types MUST be explicitly typed
- Type inference is acceptable for obvious variable assignments only

### IV. Technology Stack (NON-NEGOTIABLE)

- **Framework**: Next.js with static export (`output: 'export'`)
- **UI Components**: shadcn/ui with Tailwind CSS 4
- **Language**: TypeScript (strict mode; see Principle III)
- **State Management**: Zustand for all non-trivial shared state
  (audio graph state, scene parameters, UI state); local
  `useState` is acceptable for component-scoped ephemeral state
- **Web Audio**: TODO(WEB_AUDIO_LIBRARY): Library selection deferred
  to planning phase. MUST be modern, actively maintained, and
  production-ready. Candidates will be evaluated during feature
  planning.

### V. Performance & Battery Efficiency

- Battery drain MUST NOT be appreciably noticeable during normal
  use. Proxy metric: sustained CPU usage SHOULD remain below 30 %
  on a mid-range mobile device during steady-state playback.
- Devices MUST NOT feel appreciably hot during extended sessions
  (> 30 minutes continuous use)
- UI animations MUST target 60 fps; audio processing latency
  SHOULD stay under 20 ms
- Use Page Visibility API to suspend or reduce processing when
  the app is backgrounded
- Optimize for efficiency but do not over-engineer

### VI. Browser Compatibility

- Target browsers released within the last 2 years
- MUST support: iOS Safari 16.4+, Chrome Android (latest 2 major
  versions), modern desktop browsers (Chrome, Firefox, Safari,
  Edge — latest 2 major versions each)
- Progressive enhancement: core audio features work without
  motion sensors; enhanced reactivity when sensors are available
- Graceful degradation for unsupported Web Audio features with
  clear user-facing messaging

### VII. Progressive Web App

- App MUST be installable via a valid web app manifest
- Service worker MUST cache the app shell for offline launch
- Offline mode: previously loaded scenes MUST remain playable
  without a network connection; network-dependent features (if
  any) MUST degrade gracefully with user notification

### VIII. Testing Strategy

- Strategic, lightweight testing focused on preventing regressions
- Test coverage MUST target areas most likely to break:
  - Web Audio graph connections and parameter bounds
  - Zustand store logic and state transitions
  - API feature detection and graceful degradation
  - Scene parameter serialization / deserialization
- Manual experiential testing is acceptable for subjective audio
  quality
- Avoid over-testing; focus on high-value test cases only

### IX. Code Quality

- All code MUST pass linting before commits
- Functional programming patterns preferred: pure functions for
  audio parameter calculations; React components use hooks (no
  class components)
- Immutability encouraged for state management (Zustand slices
  SHOULD use immutable update patterns)
- Clear separation of concerns between UI components and audio
  processing logic

### X. Deployment

- Static hosting (Vercel, Netlify, or GitHub Pages)
- App MUST work as a standalone Next.js static export
- If a backend becomes necessary during planning, it MUST be
  justified with clear technical reasoning and documented as a
  constitution amendment

### XI. Development Experience

- Next.js dev server with hot module reloading MUST work during
  development
- Dev server MUST start in under 10 seconds on a modern machine
- Clear error messages and debugging support
- Component structure MUST be modular and composable

## Governance

- This constitution supersedes all other technical decisions
- Deviations from NON-NEGOTIABLE principles are not permitted
  without a formal amendment (see below)
- Deviations from other principles require:
  1. Written justification in the relevant spec or plan document
  2. Explicit approval from the project owner before implementation
- **Amendment procedure**: propose the change as a pull request to
  this file. The PR description MUST include the rationale, the
  affected principles, and a migration plan if existing code is
  impacted. Amendments take effect upon merge.
- **Versioning**: this constitution follows semantic versioning.
  MAJOR = principle removal or redefinition; MINOR = new principle
  or material expansion; PATCH = wording, typos, clarifications.
- When principles conflict, resolve by priority order (I highest).

**Version**: 1.0.0 | **Ratified**: 2026-04-08 | **Last Amended**: 2026-04-08
