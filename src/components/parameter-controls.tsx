'use client';

import type { ChangeEvent, ReactElement } from 'react';

import type { RuntimeState, SceneRuntime } from '@/audio/scene-runtime';

import type { ParameterDeclaration } from '@/scenes/parameters';
import { useId } from 'react';

import { useStore } from 'zustand';

import { sceneRuntime } from '@/audio/runtime';
import { cn } from '@/lib/utils';

interface ParameterControlsProps {
	runtime?: SceneRuntime;
}

interface ParameterSliderProps {
	runtime: SceneRuntime;
	name: string;
	declaration: ParameterDeclaration;
}

// One child component per entry, each subscribing to only its own scalar: a
// parent reading the whole `parameters` object would hand every slider a
// fresh render on every write, including the ones the listener isn't
// touching. The inline selector below is safe only because it returns that
// scalar rather than a new object—see the module-scope comment on
// play-toggle.tsx's selectStatus for the failure mode this avoids.
function ParameterSlider({ runtime, name, declaration }: ParameterSliderProps): ReactElement {
	const id = useId();
	const value = useStore(runtime.store, (state: RuntimeState): number => state.parameters[name] ?? declaration.default);

	function handleChange(event: ChangeEvent<HTMLInputElement>): void {
		runtime.setParameter(name, event.currentTarget.valueAsNumber);
	}

	return (
		<div className="flex min-h-12 items-center gap-4">
			<label htmlFor={id} className="flex-1">
				{declaration.label}
			</label>
			{/* A native range input on purpose: it already carries the slider role,
			    is keyboard-operable, and takes its accessible name from the
			    associated label with no extra ARIA wiring. */}
			<input
				id={id}
				type="range"
				min={declaration.min}
				max={declaration.max}
				step={(declaration.max - declaration.min) / 100}
				value={value}
				onChange={handleChange}
				className={cn(
					'flex-1 accent-foreground',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				)}
			/>
		</div>
	);
}

export function ParameterControls({ runtime = sceneRuntime }: ParameterControlsProps): ReactElement | null {
	const entries = Object.entries(runtime.schema);

	// A Scene with nothing to tune should render no chrome at all, rather than
	// an empty fieldset with a legend and nothing under it.
	if (entries.length === 0) {
		return null;
	}

	return (
		<fieldset>
			<legend>Parameters</legend>
			{entries.map(([name, declaration]) => (
				<ParameterSlider key={name} runtime={runtime} name={name} declaration={declaration} />
			))}
		</fieldset>
	);
}
