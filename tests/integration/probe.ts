// Shared helpers for reading `window.__fieldtone`, the probe the Tone backend
// installs on the first press. Every function here is passed to
// `page.evaluate` and so runs inside the browser: none of them may close over
// anything from this module's scope, only over the arguments Playwright hands
// back in.

// Ember's Bed renders a second-half RMS near 0.20, and its quietest draws sit
// around 0.13, so 0.05 clears noise-floor jitter with room to spare and without
// waiting for full level.
export const AUDIBLE_THRESHOLD = 0.05;
export const SILENT_THRESHOLD = 0.005;

// A ratio, not a level: the same frequency measured outside the burst is the
// Bed's own floor there, so this needs no calibration against a draw the way
// AUDIBLE_THRESHOLD did. A working Material path runs orders of magnitude above
// 1 because Ember's lowpass leaves almost nothing at 3 kHz — even at brightness
// 3, where the ceiling reaches 4.8 kHz and the control window is at its
// loudest. A severed one lands near 1, since both windows then measure the same
// Bed. 100 has headroom at both ends; a run that fails it has found a broken
// path, so lower it and the assertion stops meaning anything.
export const MATERIAL_CONTRAST_THRESHOLD = 100;

export function readLevel(): number {
	return window.__fieldtone?.readOutputLevel() ?? 0;
}

export function readSignal(name: string): number {
	return window.__fieldtone?.readSignal(name) ?? 0;
}

export function renderBedRms(): Promise<number> {
	return window.__fieldtone?.renderBedRms() ?? Promise.resolve(0);
}

export function renderBedFingerprint(): Promise<number[]> {
	return window.__fieldtone?.renderBedFingerprint() ?? Promise.resolve([]);
}

export function renderMaterialContrast(): Promise<number> {
	return window.__fieldtone?.renderMaterialContrast() ?? Promise.resolve(0);
}

export async function isRealtimeAudioAvailable(): Promise<boolean> {
	const before = window.__fieldtone?.readContextTime() ?? 0;
	await new Promise((resolve) => {
		setTimeout(resolve, 300);
	});
	const after = window.__fieldtone?.readContextTime() ?? 0;
	return after > before;
}
