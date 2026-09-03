import type { NextConfig } from 'next';

// Principle IV mandates static export. GitHub Pages serves this repo as a project
// page under /fieldtone, so the deploy workflow sets PAGES_BASE_PATH and nothing
// else does. Baking the base path in unconditionally would break the e2e run:
// Playwright serves out/ at the root because the export is the artifact that
// actually ships, and every asset URL would 404 against a prefix nothing honors.
// The cost is that the deployed build is not the one the suite exercises, so the
// deploy workflow greps the built HTML for the prefix instead.
const basePath = process.env.PAGES_BASE_PATH ?? '';

const nextConfig: NextConfig = {
	output: 'export',
	basePath,
};

export default nextConfig;
