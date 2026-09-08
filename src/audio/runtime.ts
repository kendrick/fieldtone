import { ember } from '@/scenes/ember';
import { createDocumentVisibility } from './page-visibility';
import { createSceneRuntime } from './scene-runtime';

import { createToneBackend } from './tone-backend';

// Safe at module scope: the static export evaluates this file in Node during
// prerender. The Tone adapter allocates no audio node until `resume` runs,
// and Ember's Bed builds no node until the runtime calls it on a press, so
// no AudioContext exists before the listener's first press. Constructing the
// runtime here also subscribes to `visibilitychange` at client import time,
// but that's a document listener, not an audio node, so the same reasoning
// holds. `createDocumentVisibility` returns inert no-ops when there's no
// `document`, which is what keeps this prerender safe (see
// page-visibility.prerender.spec.ts).
export const sceneRuntime = createSceneRuntime(createToneBackend(), ember, createDocumentVisibility());
