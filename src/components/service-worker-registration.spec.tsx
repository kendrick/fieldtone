import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceWorkerRegistration } from './service-worker-registration';

// jsdom ships no serviceWorker container at all, so a case that wants one
// defines its own property on the shared navigator and afterEach deletes it
// again — the same pattern share-control.spec.tsx uses for `share` and
// `clipboard`, both also absent from jsdom.
function stubServiceWorker(register: unknown): void {
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		writable: true,
		value: { register },
	});
}

describe('service-worker-registration', () => {
	afterEach(() => {
		Reflect.deleteProperty(navigator, 'serviceWorker');
		vi.unstubAllEnvs();
	});

	it('renders no DOM', () => {
		vi.stubEnv('NODE_ENV', 'production');
		stubServiceWorker(vi.fn().mockResolvedValue(undefined));

		const { container } = render(<ServiceWorkerRegistration />);

		expect(container.firstChild).toBeNull();
	});

	it('registers the relative worker URL exactly once in production', () => {
		vi.stubEnv('NODE_ENV', 'production');
		const register = vi.fn().mockResolvedValue(undefined);
		stubServiceWorker(register);

		render(<ServiceWorkerRegistration />);

		expect(register).toHaveBeenCalledTimes(1);
		expect(register).toHaveBeenCalledWith('sw.js', { updateViaCache: 'none' });
	});

	it('swallows a registration failure without an unhandled rejection', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		stubServiceWorker(vi.fn().mockRejectedValue(new Error('registration failed')));

		// Nothing here needs to catch anything itself — an unhandled rejection
		// would fail the test run on its own. This case exists to prove that
		// rendering with a rejecting register does not throw and does not do that.
		expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
		// Let the effect's microtask queue drain so the rejection is actually
		// reached (and, if unswallowed, actually surfaces) before the test ends.
		await Promise.resolve();
		await Promise.resolve();
	});

	it('does nothing where the browser has no serviceWorker container', () => {
		vi.stubEnv('NODE_ENV', 'production');

		expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
	});

	it('does nothing outside production', () => {
		vi.stubEnv('NODE_ENV', 'test');
		const register = vi.fn().mockResolvedValue(undefined);
		stubServiceWorker(register);

		render(<ServiceWorkerRegistration />);

		expect(register).not.toHaveBeenCalled();
	});
});
