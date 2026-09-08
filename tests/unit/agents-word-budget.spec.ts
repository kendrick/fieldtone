import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every agent loads all of AGENTS.md on every turn, whatever the task, so the file
// has a 900-word budget. The check runs here rather than as a CI step so `pnpm test`
// catches an overrun locally, before the push.
//
// The nextjs-agent-rules block sits outside the budget because `next dev` writes it back.
// Counting words this repo cannot cut would let a Next.js upgrade evict constraints
// someone here chose.
const BUDGET = 900;
const VENDOR_BLOCK = /<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->/;

const agents = readFileSync('AGENTS.md', 'utf8');

function budgetedWords(markdown: string): number {
	return markdown.replace(VENDOR_BLOCK, ' ').split(/\s+/).filter(Boolean).length;
}

describe('the AGENTS.md word budget', (): void => {
	it('holds the repo\'s own prose inside the budget', (): void => {
		expect(budgetedWords(agents)).toBeLessThan(BUDGET);
	});

	it('rejects an addition the file has no room for', (): void => {
		const overflow = `${agents}\n\n${'word '.repeat(200)}`;

		expect(budgetedWords(overflow)).toBeGreaterThanOrEqual(BUDGET);
	});

	// A Next.js upgrade that renames the markers would start counting the vendor
	// block again, and the 95 words the block adds would read as this repo's own.
	it('still finds the block it excludes', (): void => {
		expect(VENDOR_BLOCK.test(agents)).toBe(true);
	});
});
