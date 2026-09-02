import { createSceneRuntime } from './scene-runtime';
import { createToneBackend } from './tone-backend';

// Safe at module scope: the static export evaluates this file in Node during
// prerender, and the Tone adapter allocates no audio node until `resume`
// runs, so no AudioContext exists before the listener's first press.
export const sceneRuntime = createSceneRuntime(createToneBackend());
