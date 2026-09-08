// isHidden reads `document` fresh on every call rather than caching the last
// event, because on WebKit `visibilitychange` races process suspension: it may
// not get out before the app is suspended, and when it does fire it can arrive
// late, on resume, already reading `visible` (WebKit bug 207256, traced in
// docs/spikes/0013-backgrounding-platform-behavior.md). A cache would trust the
// edge; this port never does.
//
// The `typeof document === 'undefined'` guard is what keeps `next build` safe.
// `src/audio/runtime.ts` constructs the runtime at module scope, and Node
// evaluates that construction during the static export's prerender, where no
// `document` exists.
//
// This port carries no Listening policy of its own — it only answers "is the
// page hidden." background-listening.ts's keepListeningVisibility composes
// the opt-in for background Listening in a Safari tab on top of this port,
// wrapping isHidden to report false while the opt-in applies; the runtime
// that consumes this port never learns that opt-in exists.
export interface PageVisibility {
	isHidden: () => boolean;
	subscribe: (listener: () => void) => () => void;
}

export const alwaysVisible: PageVisibility = {
	isHidden: () => false,
	subscribe: () => () => {},
};

export function createDocumentVisibility(): PageVisibility {
	if (typeof document === 'undefined') {
		return alwaysVisible;
	}

	return {
		isHidden: () => document.visibilityState === 'hidden',
		subscribe: (listener: () => void): (() => void) => {
			document.addEventListener('visibilitychange', listener);
			return (): void => {
				document.removeEventListener('visibilitychange', listener);
			};
		},
	};
}
