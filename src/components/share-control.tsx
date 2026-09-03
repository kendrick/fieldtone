'use client';

import type { ReactElement } from 'react';

import type { SceneRuntime } from '@/audio/scene-runtime';
import { useId, useState } from 'react';

import { sceneRuntime } from '@/audio/runtime';
import { cn } from '@/lib/utils';

interface ShareControlProps {
	runtime?: SceneRuntime;
}

interface ShareOutcome {
	message: string;
	// The link itself, set only where neither path could hand it over. Pointing
	// at the address bar instead was wrong in exactly the case this feature
	// exists for: parameter-controls.tsx does not mirror anything there until a
	// control moves, so a listener who shares from a bare `/` would have copied
	// an empty query and pinned nothing.
	link: string | undefined;
}

interface ShareStatus extends ShareOutcome {
	// Keys the message element, so that a second press builds a new one. Without
	// that, both presses share an element, and an animation already partway
	// through its delay does not restart just because the text was rewritten.
	press: number;
}

const COPIED = 'Link copied';
// Names the way out rather than the failure. `writeText` refuses over plain HTTP
// and under a denied permission, and the listener can fix neither from here.
const COPY_REFUSED = 'Couldn\'t copy the link. Select it from the field below.';
const FIELD_LABEL = 'Link to this Scene';

// Matched on the name rather than with `instanceof DOMException`, for the reason
// capture-rejection.ts records: a rejection can arrive from another realm, and
// the name is the part that survives the trip.
function isDismissal(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('name' in error)) {
		return false;
	}

	// The `in` check above only proves a `name` property exists on an otherwise
	// untyped object; the cast is what lets us read it.
	const { name } = error as { name: unknown };
	return name === 'AbortError';
}

// Returns what the listener should be shown, saying nothing where there is
// nothing to say. Keeping the decision here rather than in the component is what
// lets the whole share/copy/dismiss fallback chain read top to bottom in one
// place.
async function shareLink(link: string): Promise<ShareOutcome> {
	// Detected at runtime rather than trusted from the type: lib.dom declares
	// `share` as always present, and desktop Firefox has no such thing.
	if (typeof navigator.share === 'function') {
		try {
			await navigator.share({ url: link });
			// The sheet is its own confirmation, and a message underneath it would
			// tell the listener which path ran.
			return { message: '', link: undefined };
		}
		catch (error) {
			if (isDismissal(error)) {
				// Backing out of the sheet is an answer, not a failure. Copying the
				// link anyway would hand it to a listener who just declined to send it.
				return { message: '', link: undefined };
			}
		}
	}

	try {
		// Reached both when the browser has no share sheet and when its sheet threw
		// something other than a dismissal. `navigator.clipboard` is itself
		// undefined outside a secure context, so the property read is inside the
		// try alongside the call it rejects from.
		await navigator.clipboard.writeText(link);
		return { message: COPIED, link: undefined };
	}
	catch {
		return { message: COPY_REFUSED, link };
	}
}

export function ShareControl({ runtime = sceneRuntime }: ShareControlProps): ReactElement {
	const fieldId = useId();
	const [status, setStatus] = useState<ShareStatus>({ message: '', link: undefined, press: 0 });

	async function announceShare(link: string): Promise<void> {
		// Written on every press, including the silent ones. A press supersedes
		// whatever the last one left behind, which is what takes the fallback field
		// off screen the moment a later press no longer needs it.
		const outcome = await shareLink(link);
		setStatus(previous => ({ ...outcome, press: previous.press + 1 }));
	}

	function handleClick(): void {
		// Built from the current URL rather than a bare query string, for the
		// reasons mirrorParametersToLocation gives in parameter-controls.tsx: the
		// base path next.config.ts sets for GitHub Pages rides along in the
		// pathname, and nothing here may hardcode `/`.
		const url = new URL(window.location.href);
		// Assigned wholesale rather than merged, and taken from the runtime rather
		// than from window.location.search. The runtime emits every declared
		// parameter, defaults included, so the link pins a whole setting and cannot
		// drift the day a default is retuned—which is exactly what a link copied out
		// of a bare `/` address bar does. Nothing stale in the query survives either.
		url.search = runtime.serializeParameters();
		// Await nothing before this call. `navigator.share` needs the transient user
		// activation this press carries, and an await ahead of it spends the gesture.
		void announceShare(url.href);
	}

	return (
		<div className="flex flex-col items-center gap-3">
			<button
				type="button"
				onClick={handleClick}
				className={cn(
					'min-h-12 rounded-full border border-foreground bg-transparent px-6 text-sm font-medium transition-colors',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				)}
			>
				Share this Scene
			</button>
			{/* The region is mounted here empty and stays mounted, message or not: a
			    live region created in the same commit as its first message is
			    routinely skipped, which is the lesson 349e36b left on the Invitation.
			    Only the span inside is replaced, so the announcement lands and the
			    fade still restarts on a second press. */}
			{/* No size class, so this inherits the 16px body.tsx pins for the
			    constitution's Principle II minimum. The button above may take
			    text-sm—listen-invitation.tsx sets that precedent for control
			    labels—but this carries sentences. */}
			<p role="status" className="min-h-5">
				<span
					key={status.press}
					// globals.css holds the whole lifetime of this message: a delay, a
					// fade, and a `visibility` that takes the stale text back out of the
					// accessibility tree. Nothing counts down here, because Principle V
					// rules out JS timers.
					className="share-status"
					data-shown={status.message === '' ? undefined : ''}
				>
					{status.message}
				</span>
			</p>
			{status.link !== undefined && (
				// Not faded and not keyed: a message the listener only reads may expire,
				// while a link they have to select must still be there when they reach
				// it. AC 7 forbids a stuck error state, and this is the remedy rather
				// than the error—the press above retires it.
				<div className="flex w-full max-w-sm flex-col gap-1">
					<label htmlFor={fieldId}>{FIELD_LABEL}</label>
					<input
						id={fieldId}
						type="text"
						readOnly
						value={status.link}
						// Selected on focus so the only thing left after tabbing here is
						// the copy keystroke itself. The clipboard already refused; this
						// should not be a second control to operate.
						onFocus={(event): void => {
							event.currentTarget.select();
						}}
						className={cn(
							'min-h-12 rounded-lg border border-foreground bg-transparent px-3',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
						)}
					/>
				</div>
			)}
		</div>
	);
}
