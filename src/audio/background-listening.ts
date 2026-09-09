import type { PageVisibility } from './page-visibility';
import { isInstalledApp } from './app-surface';

// Namespaced because localStorage is shared across an origin, and GitHub
// Pages serves every project page of an account from one — the reasoning
// listen-invitation.tsx's OFFERED_KEY carries at lines 19-20.
export const KEEP_LISTENING_KEY = 'fieldtone.listening.background';

// What this tab is going for, latched on the first read and the only answer
// after that. Storage is where it comes from and where it goes to survive a
// reload; once read, it is not consulted again.
//
// Two failures shaped this. A write localStorage refuses still has to take
// effect: a refused disable used to leave `readKeepListening` reporting the old
// `on`, so Listening ran on in the background over a control the listener had
// just switched off. And a second tab on the same origin must not move this one:
// the component shows what it read when it mounted, so a tab that kept re-reading
// storage could suppress its own suspension while its box still said off.
//
// Principle I is non-negotiable, and both come to the same rule. A tab may never
// hold the microphone more freely than its own control has shown.
let sessionChoice: boolean | undefined;

// DOM-guarded rather than DOM-free, the same reason app-surface.ts guards
// `navigator`: src/audio/runtime.ts constructs keepListeningVisibility at
// module scope, and Node evaluates that construction during the static
// export's prerender, where no `window` exists.
export function readKeepListening(): boolean {
	if (sessionChoice !== undefined) {
		return sessionChoice;
	}

	if (typeof window === 'undefined') {
		return false;
	}

	try {
		sessionChoice = window.localStorage.getItem(KEEP_LISTENING_KEY) === 'on';
	}
	catch {
		// A browser set to block site data throws on read, same as
		// listen-invitation's readOffered. Latching that as `false` fails toward
		// Principle I: a setting nobody could actually confirm is on must not be
		// the reason Listening outlives the page in the background.
		sessionChoice = false;
	}

	return sessionChoice;
}

// Drops the session choice so the next read falls back to storage. Test support
// living in src/ rather than beside the specs, following the recording backend:
// module state that outlives one test is exactly what makes the next one lie.
export function forgetKeepListening(): void {
	sessionChoice = undefined;
}

export function writeKeepListening(on: boolean): void {
	// Ahead of the write, and never conditional on it: this is what makes the
	// listener's choice take effect whether or not storage accepts it.
	sessionChoice = on;

	if (typeof window === 'undefined') {
		return;
	}

	try {
		window.localStorage.setItem(KEEP_LISTENING_KEY, on ? 'on' : 'off');
	}
	catch {
		// Safari's private mode throws on write, and a shared origin over quota
		// throws with the key already set. Swallowed because the session choice
		// above already carries the decision; all that is lost is surviving a
		// reload.
	}
}

// Asked on every isHidden() rather than captured when this port was built, the
// same no-cache rule createDocumentVisibility follows: isHidden fires on a rare
// event, so the call costs nothing and nothing here can go stale against the
// control the listener just flipped.
//
// What comes back is this tab's latched choice, so the answer moves only when
// the listener moves it here — not when storage refuses a write, and not when
// another tab on the origin flips its own box.
//
// The opt-in is honored only where the platform can honor it. An installed
// iOS app suspends capture itself the moment it backgrounds (ADR 0004)
// whatever a Safari tab's localStorage says, and even on the surfaces where
// an installed app does share storage with the tab that set this flag, a
// choice made in the tab must not act inside the installed app: capture there
// suspends regardless, so isInstalledApp() is the veto.
export function keepListeningVisibility(inner: PageVisibility): PageVisibility {
	function applies(): boolean {
		return readKeepListening() && !isInstalledApp();
	}

	return {
		isHidden: (): boolean => !applies() && inner.isHidden(),

		subscribe: (listener: () => void): (() => void) => inner.subscribe((): void => {
			// The hide edge is swallowed while the opt-in applies rather than passed
			// through against an `isHidden` that reports visible. scene-runtime's
			// handler reads the direction off this port instead of the event, so a
			// hide arriving while the port says visible sends it down the resume
			// branch: `resumeSuspended` over a suspension the track's own mute
			// caused, issuing getUserMedia from a hidden page. That call parks
			// instead of rejecting, and strands the attempt in `opening` with
			// nothing left to answer it — which is what resumeSuspended's own
			// comment says only the visible edge may risk.
			//
			// The show edge still goes through, and the asymmetry is the point. A
			// mute suspension is unconditional and outlives the opt-in, so coming
			// back to the page is exactly when it should recover, the same recovery
			// a listener who never opted in already gets.
			if (applies() && inner.isHidden()) {
				return;
			}

			listener();
		}),
	};
}
