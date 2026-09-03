import type { NextConfig } from 'next';

// Principle IV mandates static export. GitHub Pages serves this repo as a project
// page under /fieldtone, and that prefix is set here rather than only in the deploy
// workflow so the export Playwright exercises is byte-for-byte the one that ships.
// `pnpm preview` stages out/ under a matching directory to serve it; changing this
// value means changing that script and Playwright's baseURL with it.
const nextConfig: NextConfig = {
	output: 'export',
	basePath: '/fieldtone',
};

export default nextConfig;
