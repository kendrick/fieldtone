import type { ReactElement } from 'react';

import { PlayToggle } from '@/components/play-toggle';

export default function HomePage(): ReactElement {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-5xl font-semibold tracking-tight">FieldTone</h1>
			<PlayToggle />
		</main>
	);
}
