import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
	title: 'FieldTone',
	description: 'FieldTone turns the sound around you into generative ambient music.',
};

interface RootLayoutProps {
	children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactElement {
	return (
		<html lang="en">
			{/* text-base is pinned here per the constitution's 16px minimum body text requirement */}
			<body className="min-h-dvh bg-zinc-950 text-base text-zinc-50 antialiased">
				{children}
			</body>
		</html>
	);
}
