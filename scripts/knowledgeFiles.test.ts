import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDoc, planPull, serverCopyPath, stripBom, workingCopyPath } from './knowledgeFiles.ts';

test('stripBom removes only a leading BOM and keeps umlauts', () => {
  assert.equal(stripBom('\uFEFFÄöü ß'), 'Äöü ß');
  assert.equal(stripBom('a\uFEFFb'), 'a\uFEFFb');
});

test('isDoc accepts only known documents', () => {
  assert.ok(isDoc('about-me'));
  assert.ok(isDoc('priorities'));
  assert.ok(!isDoc('other'));
  assert.ok(!isDoc(undefined));
});

test('workingCopyPath points into private/knowledge', () => {
  assert.equal(workingCopyPath('priorities'), 'private/knowledge/priorities.md');
});

test('planPull writes when there is no local file', () => {
  assert.equal(planPull(null, 'x'), 'write');
});

test('planPull skips when neither copy exists', () => {
  assert.equal(planPull(null, null), 'write');
});

test('planPull keeps a local file the server does not have', () => {
  assert.equal(planPull('mine', null), 'keep-local-missing-on-server');
});

test('planPull reports identical copies as unchanged, ignoring BOM and CRLF', () => {
  assert.equal(planPull('a\nb', 'a\nb'), 'unchanged');
  assert.equal(planPull('\uFEFFa\r\nb', 'a\nb'), 'unchanged');
});

test('planPull flags differing copies as conflict', () => {
  assert.equal(planPull('local edit', 'server'), 'conflict');
});

test('serverCopyPath sits next to the working copy', () => {
  assert.equal(serverCopyPath('about-me'), 'private/knowledge/about-me.server.md');
});
