'use client';

import type { ReactElement } from 'react';

import { useState } from 'react';

import { startTone, stopTone } from '@/audio/tone-output';
import { cn } from '@/lib/utils';

type PlaybackState = 'silent' | 'starting' | 'playing' | 'failed';

export function PlayToggle(): ReactElement {
	const [state, setState] = useState<PlaybackState>('silent');
	const isPlaying = state === 'playing';

	async function handleClick(): Promise<void> {
		if (state === 'starting') {
			return;
		}
		if (state === 'playing') {
			stopTone();
			setState('silent');
			return;
		}
		setState('starting');
		try {
			await startTone();
			setState('playing');
		}
		catch {
			setState('failed');
		}
	}

	return (
		<div className="flex flex-col items-center gap-4">
			<button
				type="button"
				// No aria-pressed: the label already flips between "Play" and "Stop",
				// so pairing it with aria-pressed would make a screen reader announce
				// "Stop, pressed" — the two cues contradict each other.
				// No disabled: a click while starting is ignored via the state guard
				// above instead, because disabling the button would drop keyboard
				// focus mid-interaction.
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
			{state === 'failed' && (
				<p role="alert">Audio could not start. Check your device sound settings and press Play again.</p>
			)}
		</div>
	);
}
