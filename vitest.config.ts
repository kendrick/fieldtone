import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		// Customize per project — these defaults are conservative.
		include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx', 'scripts/**/*.spec.mjs'],
		exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**', '**/out/**'],
		// Uncomment if you have a setup file:
		// setupFiles: ['./tests/setup.ts'],
	},
	resolve: {
		// Must match the '@/*' -> './src/*' mapping in tsconfig.json and the
		// aliases in components.json, or the same import specifier resolves
		// to two different places in tests versus the app.
		alias: { '@': path.resolve(import.meta.dirname, './src') },
	},
	// tsconfig sets jsx: "preserve" so Next's compiler handles JSX. Vitest 4
	// runs on Vite 8, which uses Oxc and would otherwise inherit "preserve"
	// and fail to compile JSX in spec files — this override is what lets
	// .tsx specs run.
	oxc: { jsx: { runtime: 'automatic' } },
});
