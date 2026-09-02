import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

// This is the seam that stops the suite from passing on zero tests.
describe('home page', () => {
	it('renders an h1 with the FieldTone heading', (): void => {
		const markup = renderToStaticMarkup(<HomePage />);

		expect(markup).toContain('<h1');
		expect(markup).toContain('FieldTone');
	});
});
