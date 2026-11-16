import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDoc, stripBom, workingCopyPath } from './knowledgeFiles.ts';

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
