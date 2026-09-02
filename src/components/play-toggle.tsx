'use client';

import type { ReactElement } from 'react';

import type { RuntimeState, SceneRuntime } from '@/audio/scene-runtime';

import { useStore } from 'zustand';

import { sceneRuntime } from '@/audio/runtime';
import { cn } from '@/lib/utils';

interface PlayToggleProps {
	runtime?: SceneRuntime;
}

// Module scope, not inline: a selector defined inside the component gets a new
// identity every render, and returning a fresh object (rather than the
// `status` primitive) would re-render on every store write instead of only
// when the status actually changes.
function selectStatus(state: RuntimeState): RuntimeState['playback']['status'] {
	return state.playback.status;
}

export function PlayToggle({ runtime = sceneRuntime }: PlayToggleProps): ReactElement {
	const status = useStore(runtime.store, selectStatus);
	const isPlaying = status === 'playing';

	function handleClick(): void {
		if (status === 'playing') {
			runtime.stop();
			return;
		}
		// Await nothing before this call: iOS spends the user gesture on
		// whichever await runs first, and the runtime's own `resume` has to be
		// the one that gets it. The runtime already rejects a press that lands
		// while starting, so no guard is needed here.
		void runtime.start();
	}

	return (
		<div className="flex flex-col items-center gap-4">
			<button
				type="button"
				// No aria-pressed: the label already flips between "Play" and "Stop",
				// so pairing it with aria-pressed would make a screen reader announce
				// "Stop, pressed" — the two cues contradict each other.
				// No disabled: the runtime turns away a press that lands while
				// starting, and disabling the button would drop keyboard focus
				// mid-interaction.
				onClick={handleClick}
				className={cn(
					'min-h-12 rounded-full border px-8 text-base font-medium transition-colors',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
					isPlaying
						? 'border-foreground bg-foreground text-background'
						: 'border-foreground bg-transparent text-foreground',
				)}
			>
				{isPlaying ? 'Stop' : 'Play'}
			</button>
			{status === 'failed' && (
				<p role="alert">Audio could not start. Check your device sound settings and press Play again.</p>
			)}
		</div>
	);
}
