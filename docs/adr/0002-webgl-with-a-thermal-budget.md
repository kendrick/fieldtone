# WebGL rendering, with a thermal budget instead of a frame-rate target

Canvas 2D is CPU-bound and shares the main thread with Tone.js's scheduler, so a visually rich Scene would compete with audio timing and the symptom would be jitter in the music. A fragment shader moves per-pixel work to the GPU and leaves the main thread to the audio. WebGL is the safer choice for audio stability, not only the prettier one.

The cost is sustained GPU power draw, which lands on what Principle V actually cares about: the device must not feel hot over a long session. Frame rate was the wrong lever to pull. Dropping to 30fps makes motion visibly worse while barely addressing heat.

Instead the visual layer renders at a fraction of device resolution and upscales, and that fraction adapts to keep within the thermal requirement. Motion stays smooth, and a soft low-resolution image reads as a deliberate style rather than as a stutter. Constitution 1.1.0 amended Principle V to match, replacing its 60fps mandate.
