import { expect, test } from 'bun:test';
import { isNewer } from './update';

test('isNewer compares semver', () => {
	expect(isNewer('0.2.0', '0.1.0')).toBe(true);
	expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
	expect(isNewer('0.1.10', '0.1.9')).toBe(true);
	expect(isNewer('0.1.0', '0.1.0')).toBe(false);
	expect(isNewer('0.1.0', '0.2.0')).toBe(false);
});
