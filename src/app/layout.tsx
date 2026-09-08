import type { Metadata, Viewport } from 'next';
import type { ReactElement, ReactNode } from 'react';

import { ServiceWorkerRegistration } from '@/components/service-worker-registration';

import './globals.css';

export const metadata: Metadata = {
	title: 'FieldTone',
	description: 'FieldTone turns the sound around you into generative ambient music.',
	// capable: true is what makes an installed app open standalone rather than as
	// a bookmarked tab, and it's what makes `navigator.standalone` report true.
	// Issue #17's background-Listening Invitation reads that flag to decide
	// whether to offer at all, so this isn't decoration — remove it and that
	// Invitation loses its signal.
	appleWebApp: {
		capable: true,
		title: 'FieldTone',
		statusBarStyle: 'black-translucent',
	},
};

// themeColor moved from `metadata` to `viewport` in Next 14. The
// `metadata.themeColor` form still compiles, which is what makes it easy to
// reach for by mistake, so the value lives here instead. See manifest.ts for
// where #09090b comes from.
export const viewport: Viewport = {
	themeColor: '#09090b',
};

interface RootLayoutProps {
	children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactElement {
	return (
		<html lang="en">
			{/* text-base is pinned here per the constitution's 16px minimum body text requirement */}
			<body className="min-h-dvh bg-background text-base text-foreground antialiased">
				{children}
				<ServiceWorkerRegistration />
			</body>
		</html>
	);
}
