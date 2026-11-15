import { expect, test } from 'bun:test';
import { normaliseServerUrl } from './settings';

test('normaliseServerUrl keeps only the https origin', () => {
	const site = 'https://zerostash.utkarshchourasia.in';
	expect(normaliseServerUrl('https://zerostash.utkarshchourasia.in/dashboard')).toBe(site);
	expect(normaliseServerUrl('  https://zerostash.utkarshchourasia.in/dashboard/lists/x?q=1#top ')).toBe(site);
	expect(normaliseServerUrl('http://zerostash.utkarshchourasia.in/dashboard')).toBe(site);
	expect(normaliseServerUrl('zerostash.utkarshchourasia.in/dashboard')).toBe(site);
	expect(normaliseServerUrl('HTTPS://Zerostash.UtkarshChourasia.in/')).toBe(site);
	expect(normaliseServerUrl('https://user:pass@zerostash.utkarshchourasia.in')).toBe(site);
	expect(normaliseServerUrl('http://zerostash.example.com:8080/x')).toBe('https://zerostash.example.com:8080');
});

test('normaliseServerUrl leaves a local dev server on http', () => {
	expect(normaliseServerUrl('http://localhost:5174/dashboard')).toBe('http://localhost:5174');
	expect(normaliseServerUrl('localhost:5174')).toBe('http://localhost:5174');
	expect(normaliseServerUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
	expect(normaliseServerUrl('https://localhost:5174')).toBe('https://localhost:5174');
});

test('normaliseServerUrl rejects other schemes and junk', () => {
	expect(() => normaliseServerUrl('ftp://zerostash.example.com')).toThrow();
	expect(() => normaliseServerUrl('')).toThrow();
	expect(() => normaliseServerUrl('http://')).toThrow();
});
