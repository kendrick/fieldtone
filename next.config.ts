import type { NextConfig } from 'next';

// Principle IV mandates static export. No basePath set yet; hosting target
// is still undecided and will determine routing requirements.
const nextConfig: NextConfig = {
	output: 'export',
};

export default nextConfig;
