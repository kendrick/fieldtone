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

export function readLevel(): number {
	return window.__fieldtone?.readOutputLevel() ?? 0;
}

export function renderBedRms(): Promise<number> {
	return window.__fieldtone?.renderBedRms() ?? Promise.resolve(0);
}

export function renderBedFingerprint(): Promise<number[]> {
	return window.__fieldtone?.renderBedFingerprint() ?? Promise.resolve([]);
}

export async function isRealtimeAudioAvailable(): Promise<boolean> {
	const before = window.__fieldtone?.readContextTime() ?? 0;
	await new Promise((resolve) => {
		setTimeout(resolve, 300);
	});
	const after = window.__fieldtone?.readContextTime() ?? 0;
	return after > before;
}
