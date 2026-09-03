import { describe, expect, it } from 'vitest';

import { reasonForCaptureError } from './capture-rejection';

describe('reasonForCaptureError', (): void => {
	it('maps NotAllowedError to refused', (): void => {
		expect(reasonForCaptureError(new DOMException('denied', 'NotAllowedError'))).toBe('refused');
	});

	it('maps SecurityError to refused', (): void => {
		expect(reasonForCaptureError(new DOMException('insecure context', 'SecurityError'))).toBe('refused');
	});

	it('maps NotFoundError to no-microphone', (): void => {
		expect(reasonForCaptureError(new DOMException('no device', 'NotFoundError'))).toBe('no-microphone');
	});

	it('maps OverconstrainedError to no-microphone', (): void => {
		expect(reasonForCaptureError(new DOMException('constraints unmet', 'OverconstrainedError'))).toBe(
			'no-microphone',
		);
	});

	it('maps NotReadableError to busy', (): void => {
		expect(reasonForCaptureError(new DOMException('hardware busy', 'NotReadableError'))).toBe('busy');
	});

	it('maps AbortError to busy', (): void => {
		expect(reasonForCaptureError(new DOMException('aborted', 'AbortError'))).toBe('busy');
	});

	it('maps an unrecognized DOMException name to unavailable', (): void => {
		expect(reasonForCaptureError(new DOMException('unknown', 'TypeMismatchError'))).toBe('unavailable');
	});

	it('maps a non-DOMException error to unavailable', (): void => {
		expect(reasonForCaptureError(new Error('mediaDevices is undefined'))).toBe('unavailable');
	});

	it('maps a thrown value with no name at all to unavailable', (): void => {
		expect(reasonForCaptureError('just a string')).toBe('unavailable');
		expect(reasonForCaptureError(undefined)).toBe('unavailable');
	});
});
