'use client';

import type { ChangeEvent, ReactElement } from 'react';

import type { ListeningState } from '@/audio/listening-state';

import type { RuntimeState, SceneRuntime } from '@/audio/scene-runtime';
import { useEffect, useId, useState } from 'react';

import { useStore } from 'zustand';

import { isInstalledApp } from '@/audio/app-surface';
import { readKeepListening, writeKeepListening } from '@/audio/background-listening';
import { sceneRuntime } from '@/audio/runtime';
import { cn } from '@/lib/utils';

interface BackgroundListeningProps {
	runtime?: SceneRuntime;
}

const LABEL = 'Keep listening in the background';

// An installed iOS app suspends capture the moment it leaves the screen,
// whatever the page asks for—ADR 0004 measured that. A switch there would do
// nothing, so the listener gets the reason instead.
const UNAVAILABLE = 'Background listening isn\'t available in the installed app: iOS stops the microphone when FieldTone leaves the screen.';

// Module scope, not inline, for the reason play-toggle.tsx's selectStatus gives:
// a selector defined inside the component gets a new identity every render. This
// one returns the listening object the store already holds, so a parameter write
// never re-renders the setting.
function selectListening(state: RuntimeState): ListeningState {
	return state.listening;
}

// Its own component rather than another branch inside listen-invitation.tsx:
// that file owns the one `role="status"` live region in `.invitation-floor`,
// and a second live region there would compete with it. Nothing here needs one
// anyway—a checkbox announces its own checked state, and the paragraph below
// never changes.
export function BackgroundListening({ runtime = sceneRuntime }: BackgroundListeningProps): ReactElement | null {
	const listening = useStore(runtime.store, selectListening);
	const id = useId();
	const [keeping, setKeeping] = useState(false);
	const [installed, setInstalled] = useState(false);

	// Ahead of the null return below, because hooks run on every render whatever
	// this component ends up rendering.
	//
	// Read after hydration rather than during render, the same call
	// parameter-controls.tsx makes about the URL: the static export prerenders
	// this in Node, where there is neither localStorage nor Safari's
	// `navigator.standalone`, so a render that reached for either would disagree
	// with the server HTML. Both are external inputs read once, not state derived
	// from props. The effect fires on mount, while this component still renders
	// null over a Bed nobody has asked to listen yet, so both answers are in state
	// well before the control first appears—the checkbox never renders unchecked
	// and then flips, and the installed app never flashes a switch it cannot
	// honor.
	//
	// The disable below is for that same reason. react/set-state-in-effect is
	// aimed at state derived from props, where the extra render buys nothing. A
	// browser API that does not exist during prerender has no other way in, and
	// the one alternative React offers, useSyncExternalStore, would move the read
	// back into render, which is what this shape exists to avoid.
	useEffect(() => {
		// eslint-disable-next-line react/set-state-in-effect -- see above
		setKeeping(readKeepListening());
		// eslint-disable-next-line react/set-state-in-effect -- see above
		setInstalled(isInstalledApp());
	}, []);

	// Nothing is worth keeping in the background before the listener has pressed
	// Let it listen, and a refusal leaves nothing to keep either. `suspended` is
	// in the gate because a Suspension holds on to their consent: the setting
	// that decides whether the next background trip suspends at all is exactly
	// what a listener reading "FieldTone stopped listening" would reach for.
	const asked = listening.status === 'opening'
		|| listening.status === 'listening'
		|| listening.status === 'suspended';

	if (!asked) {
		return null;
	}

	function handleChange(event: ChangeEvent<HTMLInputElement>): void {
		const on = event.currentTarget.checked;
		// Storage first, then the state that mirrors it, so the box can only show a
		// choice storage was already asked to hold. writeKeepListening swallows the
		// throw a browser blocking site data gives it, which leaves the box ticked
		// over a flag keepListeningVisibility will go on reading as off. Listening
		// then suspends the way it does by default, which is the safe half of
		// Principle I to be wrong on.
		writeKeepListening(on);
		setKeeping(on);
	}

	if (installed) {
		return <p className="max-w-sm text-center text-sm">{UNAVAILABLE}</p>;
	}

	return (
		<div className="flex min-h-12 items-center gap-3">
			{/* A native checkbox on purpose: it already carries the checkbox role,
			    announces its own checked state, is operable from the keyboard, and
			    takes its accessible name from the associated label with no ARIA
			    wiring at all—the same call parameter-controls.tsx makes for its
			    range input. */}
			<input
				id={id}
				type="checkbox"
				checked={keeping}
				onChange={handleChange}
				className={cn(
					// size-6 rather than the ~13px a checkbox defaults to: WCAG 2.2's
					// target-size minimum is 24px, and the row around it does not count,
					// since the box itself is the only thing you can hit.
					'size-6 accent-foreground',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				)}
			/>
			<label htmlFor={id}>{LABEL}</label>
		</div>
	);
}
