import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAddress, sameMailbox } from './emailAddress.ts';

test('normalizeAddress folds case, +tags and gmail dots', () => {
  assert.equal(normalizeAddress('Owner.Name+caf_=x@GoogleMail.com'), 'ownername@gmail.com');
  assert.equal(normalizeAddress('a.b@example.org'), 'a.b@example.org');
});

test('normalizeAddress rejects things that are not addresses', () => {
  assert.equal(normalizeAddress('nope'), null);
  assert.equal(normalizeAddress(undefined), null);
  assert.equal(normalizeAddress(null), null);
  assert.equal(normalizeAddress('@example.org'), null);
  assert.equal(normalizeAddress('+tag@example.org'), null);
});

test('sameMailbox compares normalized addresses and never matches null', () => {
  assert.equal(sameMailbox('owner.name@gmail.com', 'OwnerName@googlemail.com'), true);
  assert.equal(sameMailbox('owner.name@gmail.com.evil.io', 'ownername@gmail.com'), false);
  assert.equal(sameMailbox('nope', 'nope'), false);
  assert.equal(sameMailbox('a@example.org', null), false);
});

test('sameMailbox matches an Outlook SRS envelope with the saved Outlook address', () => {
  assert.equal(sameMailbox('Name+SRS=ileBF=JF=icloud.com=other@outlook.com', 'name@outlook.com'), true);
  assert.equal(sameMailbox('name@icloud.com', 'name@icloud.com'), true);
  assert.equal(sameMailbox('Name+SRS=ileBF=JF=icloud.com=other@outlook.com', 'other@icloud.com'), false);
});
