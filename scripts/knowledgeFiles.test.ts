import { expect, test } from 'vitest';
import { isDoc, planPull, serverCopyPath, stripBom, workingCopyPath } from './knowledgeFiles.ts';

test('stripBom removes only a leading BOM and keeps umlauts', () => {
  expect(stripBom('\uFEFFÄöü ß')).toBe('Äöü ß');
  expect(stripBom('a\uFEFFb')).toBe('a\uFEFFb');
});

test('isDoc accepts only known documents', () => {
  expect(isDoc('about-me')).toBeTruthy();
  expect(isDoc('priorities')).toBeTruthy();
  expect(isDoc('other')).toBe(false);
  expect(isDoc(undefined)).toBe(false);
});

test('workingCopyPath points into private/knowledge', () => {
  expect(workingCopyPath('priorities')).toBe('private/knowledge/priorities.md');
});

test('planPull writes when there is no local file', () => {
  expect(planPull(null, 'x')).toBe('write');
});

test('planPull skips when neither copy exists', () => {
  expect(planPull(null, null)).toBe('write');
});

test('planPull keeps a local file the server does not have', () => {
  expect(planPull('mine', null)).toBe('keep-local-missing-on-server');
});

test('planPull reports identical copies as unchanged, ignoring BOM and CRLF', () => {
  expect(planPull('a\nb', 'a\nb')).toBe('unchanged');
  expect(planPull('\uFEFFa\r\nb', 'a\nb')).toBe('unchanged');
});

test('planPull flags differing copies as conflict', () => {
  expect(planPull('local edit', 'server')).toBe('conflict');
});

test('serverCopyPath sits next to the working copy', () => {
  expect(serverCopyPath('about-me')).toBe('private/knowledge/about-me.server.md');
});
