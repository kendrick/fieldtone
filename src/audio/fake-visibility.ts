import type { PageVisibility } from './page-visibility';

// Test support under src/ rather than beside the specs, following silent-scene:
// a fake the type checker holds to the real PageVisibility contract is worth
// more than one free to drift from it.

// Four drivers instead of the two a real document offers, because a later
// wave has to reproduce WebKit's visibilitychange race (docs/spikes/0013):
// the event and the value it would read can arrive apart, and setHidden/notify
// let a spec drive each independently, while hide/show cover the ordinary case
// where they move together.
export interface FakeVisibility extends PageVisibility {
	setHidden: (hidden: boolean) => void;
	notify: () => void;
	hide: () => void;
	show: () => void;
}

export function createFakeVisibility(): FakeVisibility {
	let hidden = false;
	const listeners = new Set<() => void>();

	function notify(): void {
		for (const listener of listeners) {
			listener();
		}
	}

	return {
		isHidden: () => hidden,
		subscribe: (listener: () => void): (() => void) => {
			listeners.add(listener);
			return (): void => {
				listeners.delete(listener);
			};
		},
		setHidden: (next: boolean): void => {
			hidden = next;
		},
		notify,
		hide: (): void => {
			hidden = true;
			notify();
		},
		show: (): void => {
			hidden = false;
			notify();
		},
	};
}
