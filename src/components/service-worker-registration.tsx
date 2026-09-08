'use client';

import type { ReactElement } from 'react';
import { useEffect } from 'react';

// Renders nothing — this component exists only to run the effect below. It is
// its own file rather than a hook another component calls, so registration
// stays a single, once-per-load side effect instead of something that reruns
// wherever a hook gets imported.
export function ServiceWorkerRegistration(): ReactElement | null {
	useEffect(() => {
		// A worker caching next dev's chunks fights HMR (Principle XI), so this
		// only ever registers against a production build.
		if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
			return;
		}

		// 'sw.js' rather than '/sw.js' or '/fieldtone/sw.js': a relative URL
		// resolves against the document, which already carries the GitHub Pages
		// base path, and that resolution is also what gives the worker scope
		// /fieldtone/ instead of the whole origin. updateViaCache: 'none' keeps
		// the browser's HTTP cache off the worker script itself, so a new
		// deployment's worker is actually seen instead of served stale.
		//
		// The catch is scoped to this promise alone. A registration failure
		// means an online app, not an error — nothing else in this effect can
		// fail, and swallowing more than this would hide a bug instead of
		// degrading gracefully.
		navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
	}, []);

	return null;
}
