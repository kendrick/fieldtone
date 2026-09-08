import type { PageVisibility } from './page-visibility';
import { isInstalledApp } from './app-surface';

// Namespaced because localStorage is shared across an origin, and GitHub
// Pages serves every project page of an account from one — the reasoning
// listen-invitation.tsx's OFFERED_KEY carries at lines 19-20.
export const KEEP_LISTENING_KEY = 'fieldtone.listening.background';

// DOM-guarded rather than DOM-free, the same reason app-surface.ts guards
// `navigator`: src/audio/runtime.ts constructs keepListeningVisibility at
// module scope, and Node evaluates that construction during the static
// export's prerender, where no `window` exists.
export function readKeepListening(): boolean {
	if (typeof window === 'undefined') {
		return false;
	}

	try {
		return window.localStorage.getItem(KEEP_LISTENING_KEY) === 'on';
	}
	catch {
		// A browser set to block site data throws on read, same as
		// listen-invitation's readOffered. Reading that as `false` fails toward
		// Principle I: a setting nobody could actually confirm is on must not be
		// the reason Listening outlives the page in the background.
		return false;
	}
}

export function writeKeepListening(on: boolean): void {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		window.localStorage.setItem(KEEP_LISTENING_KEY, on ? 'on' : 'off');
	}
	catch {
		// Safari's private mode throws on write, same as listen-invitation's
		// rememberOffered. Nothing else remembers the choice for this session, so
		// swallowing the throw just leaves the listener on the platform default —
		// Listening suspends in the background — rather than crash the toggle.
	}
}

// Reads localStorage on every isHidden() call rather than caching the toggle
// at construction, the same no-cache rule createDocumentVisibility already
// follows: isHidden fires on a rare event, so the synchronous read costs
// nothing, no cache can drift from the control the listener just flipped, and
// storage that throws still reads back as `false` on the very next call.
//
// The opt-in is honored only where the platform can honor it. An installed
// iOS app suspends capture itself the moment it backgrounds (ADR 0004)
// whatever a Safari tab's localStorage says, and even on the surfaces where
// an installed app does share storage with the tab that set this flag, a
// choice made in the tab must not act inside the installed app: capture there
// suspends regardless, so isInstalledApp() is the veto.
export function keepListeningVisibility(inner: PageVisibility): PageVisibility {
	return {
		isHidden: (): boolean => !(readKeepListening() && !isInstalledApp()) && inner.isHidden(),
		subscribe: inner.subscribe,
	};
}
