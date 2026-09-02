import { ember } from '@/scenes/ember';
import { createSceneRuntime } from './scene-runtime';

import { createToneBackend } from './tone-backend';

// Safe at module scope: the static export evaluates this file in Node during
// prerender. The Tone adapter allocates no audio node until `resume` runs,
// and Ember's Bed builds no node until the runtime calls it on a press, so
// no AudioContext exists before the listener's first press.
export const sceneRuntime = createSceneRuntime(createToneBackend(), ember);
