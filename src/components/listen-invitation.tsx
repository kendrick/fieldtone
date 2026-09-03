'use client';

import type { ReactElement } from 'react';

import type { ListeningRejectionReason, ListeningState } from '@/audio/listening-state';

import type { RuntimeState, SceneRuntime } from '@/audio/scene-runtime';
import { useEffect, useState } from 'react';

import { useStore } from 'zustand';

import { sceneRuntime } from '@/audio/runtime';
import { cn } from '@/lib/utils';

interface ListenInvitationProps {
	runtime?: SceneRuntime;
}

// Namespaced because localStorage is shared across everything on an origin, and
// GitHub Pages serves every project page of an account from a single one.
const OFFERED_KEY = 'fieldtone.invitation.listen';

// Module scope, not inline, for the reason play-toggle.tsx's selectStatus gives:
// a selector defined inside the component gets a new identity every render. Both
// selectors return a value the store already holds, a status string and the
// listening object itself, so a parameter write never re-renders the Invitation.
function selectPlaybackStatus(state: RuntimeState): RuntimeState['playback']['status'] {
	return state.playback.status;
}

function selectListening(state: RuntimeState): ListeningState {
	return state.listening;
}

// A sentence per reason, because "press it again" is true for only two of them.
// `refused` is an answer the browser keeps rather than one FieldTone can ask
// about a second time, so the only move left is in the browser's settings.
// `unavailable` is nothing the listener did, so that message says nothing about
// trying again.
const rejectionMessages: Record<ListeningRejectionReason, string> = {
	'refused': 'Your browser is holding on to that answer, so FieldTone cannot ask again. Change the microphone permission for this site in your browser settings.',
	'no-microphone': 'FieldTone found no microphone. Plug one in, then press Let it listen again.',
	'busy': 'Another app has the microphone. Close that app, then press Let it listen again.',
	'unavailable': 'This browser cannot open a microphone.',
};

// A microphone can be plugged in and the app holding one can be closed, so both
// of these reasons are worth a second press. The other two are not, and an
// Invitation that can only be refused again is a wall.
const worthAnotherPress: readonly ListeningRejectionReason[] = ['no-microphone', 'busy'];

function readOffered(): boolean {
	try {
		return window.localStorage.getItem(OFFERED_KEY) === 'offered';
	}
	catch {
		// A browser set to block site data throws on read. Forgetting a returning
		// listener makes them wait out the floor again, which is a worse welcome
		// than they earned and still a working app.
		return false;
	}
}

function rememberOffered(): void {
	try {
		window.localStorage.setItem(OFFERED_KEY, 'offered');
	}
	catch {
		// Safari's private mode throws on this write, and nothing reads the flag
		// again this session, so swallowing the throw costs the listener nothing.
	}
}

export function ListenInvitation({ runtime = sceneRuntime }: ListenInvitationProps): ReactElement | null {
	const playbackStatus = useStore(runtime.store, selectPlaybackStatus);
	const listening = useStore(runtime.store, selectListening);
	const [returning, setReturning] = useState(false);

	// Ahead of the null return below, because hooks run on every render whatever
	// this component ends up rendering.
	//
	// Read after hydration rather than during render, the same call
	// parameter-controls.tsx makes about the URL: the static export prerenders
	// this in Node, where there is no localStorage, so a render that reached for
	// it would disagree with the server HTML. This is an external input read
	// once, not state derived from props. The effect fires on mount, while this
	// component still renders null over an idle Bed, so the answer is in state
	// well before the wrapper first appears and the floor is never applied at
	// full length and then yanked.
	//
	// The disable below is for that same reason. react/set-state-in-effect is
	// aimed at state derived from props, where the extra render buys nothing. A
	// browser API that does not exist during prerender has no other way in, and
	// the one alternative React offers, useSyncExternalStore, would move the read
	// back into render, which is what this shape exists to avoid.
	useEffect(() => {
		// eslint-disable-next-line react/set-state-in-effect -- see above
		setReturning(readOffered());
	}, []);

	// `listening` and `refused` are in the gate beside `playing` so that stopping
	// the Bed cannot pull an outcome out from under a listener still reading it.
	const offered = playbackStatus === 'playing' || listening.status === 'listening' || listening.status === 'refused';

	if (!offered) {
		return null;
	}

	function handleAccept(): void {
		// Await nothing before this call. Safari spends the user gesture on
		// whichever await runs first, and getUserMedia has to be the one that gets
		// it. The runtime already turns away a press that lands while the browser
		// is still deciding, so no guard is needed here.
		void runtime.startListening();
	}

	function handleStop(): void {
		runtime.stopListening();
	}

	const isListening = listening.status === 'listening';
	const rejection = listening.status === 'refused' ? listening : null;
	const offering = rejection === null || worthAnotherPress.includes(rejection.reason);

	const buttonClasses = cn(
		'min-h-12 rounded-full border border-foreground px-6 text-sm font-medium transition-colors',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
	);

	return (
		<div
			// The class is the whole floor: globals.css holds the delay, and the
			// `visibility` in its keyframes is what keeps this button out of the tab
			// order and the accessibility tree until the wait is up. Nothing here
			// counts down, because Principle V rules out JS timers.
			className="invitation-floor flex flex-col items-center gap-3 text-center"
			data-returning={returning ? '' : undefined}
			onAnimationEnd={rememberOffered}
		>
			{isListening
				? (
						<>
							<p role="status">Listening</p>
							<button type="button" onClick={handleStop} className={buttonClasses}>
								Stop listening
							</button>
						</>
					)
				: (
						<>
							{offering && (
								<button type="button" onClick={handleAccept} className={buttonClasses}>
									Let it listen
								</button>
							)}
							{/* status, not alert: the Bed is still playing and nothing here
							    is urgent enough to interrupt a screen reader mid-sentence. */}
							{rejection !== null && <p role="status">{rejectionMessages[rejection.reason]}</p>}
						</>
					)}
		</div>
	);
}
