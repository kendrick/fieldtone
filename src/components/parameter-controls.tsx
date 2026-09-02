'use client';

import type { ChangeEvent, ReactElement } from 'react';

import type { RuntimeState, SceneRuntime } from '@/audio/scene-runtime';

import type { ParameterDeclaration } from '@/scenes/parameters';
import { useEffect, useId, useRef } from 'react';

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
					// h-6 rather than the 16px a range input defaults to: WCAG 2.2's
					// target-size minimum is 24px, and the taller row around it does
					// not count, since the input itself is the only thing you can grab.
					'h-6 flex-1 accent-foreground',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background',
				)}
			/>
		</div>
	);
}

// Module scope, not inline in the effect below: this is the one place the
// URL-preserving logic needs to be read, and a stable identity is what lets
// the effect hand it straight to addEventListener without redefining a
// closure on every render.
function mirrorParametersToLocation(runtime: SceneRuntime): void {
	// Built from the current URL rather than a bare query string: a future
	// `scene=` key or a tracking parameter someone appended has to survive a
	// slider move, and the pathname and hash need to ride along untouched.
	// Nothing here may hardcode a path—next.config.ts sets no basePath yet,
	// and the hosting target isn't decided.
	const url = new URL(window.location.href);
	for (const [name, text] of new URLSearchParams(runtime.serializeParameters())) {
		url.searchParams.set(name, text);
	}
	try {
		window.history.replaceState(window.history.state, '', url);
	}
	catch {
		// Safari throws SecurityError past ~100 replaceState calls inside 30
		// seconds, and a held arrow key can get there. The store already holds
		// the true value and the next commit rewrites the URL, so a refused
		// write only leaves the link stale for a moment—nothing is lost by
		// swallowing this.
	}
}

export function ParameterControls({ runtime = sceneRuntime }: ParameterControlsProps): ReactElement | null {
	const entries = Object.entries(runtime.schema);
	const fieldsetRef = useRef<HTMLFieldSetElement>(null);

	// Both effects sit ahead of the empty-schema return below: hooks have to
	// run on every render regardless of what this component ends up
	// rendering.

	// Applies the link's query string once, after hydration, rather than
	// reading it during render. The static export prerenders this component
	// in Node, where `window` doesn't exist, and reading the URL during
	// render would make the client's first render disagree with the server
	// HTML—a hydration mismatch on every slider's `value`. Effects don't run
	// during prerender, so the server HTML and the first client render both
	// show the schema defaults, and the link's values land immediately after.
	// This is an external input read once, not state derived from props, so
	// it has no business being computed during render.
	useEffect(() => {
		const search = window.location.search;
		if (search !== '') {
			runtime.applySerializedParameters(search);
		}
	}, [runtime]);

	// One delegated listener on the fieldset rather than one per slider:
	// native `change` bubbles, so a single add/remove pair covers every
	// parameter. The `null` guard also covers the empty-schema case, where no
	// fieldset ever renders.
	//
	// Native `change`, not React's `onChange`: React's `onChange` on a range
	// input is really the browser's `input` event, which fires on every step
	// of a drag—a full drag would be on the order of a hundred replaceState
	// calls. The browser's own `change` event is the commit: it fires once on
	// pointer release and once per keyboard-driven change, which is what
	// removes the need for a throttle (Principle V rules out a JS timer as
	// the alternative anyway). Not `onPointerUp`, `onKeyUp`, or `onBlur`:
	// pointerup can fire with no value change, keyup fires on Tab with
	// nothing committed, and a touch drag on iOS can end in `pointercancel`
	// instead of either.
	useEffect(() => {
		const fieldset = fieldsetRef.current;
		if (fieldset === null) {
			return;
		}

		function handleChange(): void {
			// Deferred a microtask rather than read straight from the handler,
			// because the store is only reliably current for one of the two ways
			// a `change` arrives. A pointer release or a key press fires `input`
			// first, and React's onChange rides that event, so the store already
			// holds the new value by the time `change` follows (verified in both
			// Chromium and WebKit). A `change` dispatched on its own carries no
			// preceding `input`, and React's delegated listener sits on its root
			// container above this fieldset—native bubble order is target-to-root,
			// so this handler would run first and mirror the previous value.
			// queueMicrotask is neither a timer nor a poll: it waits only for the
			// synchronous dispatch already in flight, React's handler included.
			queueMicrotask(() => {
				mirrorParametersToLocation(runtime);
			});
		}

		fieldset.addEventListener('change', handleChange);
		return () => {
			fieldset.removeEventListener('change', handleChange);
		};
	}, [runtime]);

	// A Scene with nothing to tune should render no chrome at all, rather than
	// an empty fieldset with a legend and nothing under it.
	if (entries.length === 0) {
		return null;
	}

	return (
		<fieldset ref={fieldsetRef}>
			<legend>Parameters</legend>
			{entries.map(([name, declaration]) => (
				<ParameterSlider key={name} runtime={runtime} name={name} declaration={declaration} />
			))}
		</fieldset>
	);
}
