import { expect, test } from 'vitest';
import { normalizeAddress, sameMailbox } from './emailAddress.ts';

test('normalizeAddress folds case, +tags and gmail dots', () => {
  expect(normalizeAddress('Owner.Name+caf_=x@GoogleMail.com')).toBe('ownername@gmail.com');
  expect(normalizeAddress('a.b@example.org')).toBe('a.b@example.org');
});

test('normalizeAddress rejects things that are not addresses', () => {
  expect(normalizeAddress('nope')).toBe(null);
  expect(normalizeAddress(undefined)).toBe(null);
  expect(normalizeAddress(null)).toBe(null);
  expect(normalizeAddress('@example.org')).toBe(null);
  expect(normalizeAddress('+tag@example.org')).toBe(null);
});

test('sameMailbox compares normalized addresses and never matches null', () => {
  expect(sameMailbox('owner.name@gmail.com', 'OwnerName@googlemail.com')).toBe(true);
  expect(sameMailbox('owner.name@gmail.com.evil.io', 'ownername@gmail.com')).toBe(false);
  expect(sameMailbox('nope', 'nope')).toBe(false);
  expect(sameMailbox('a@example.org', null)).toBe(false);
});

test('sameMailbox matches an Outlook SRS envelope with the saved Outlook address', () => {
  expect(sameMailbox('Name+SRS=ileBF=JF=icloud.com=other@outlook.com', 'name@outlook.com')).toBe(true);
  expect(sameMailbox('name@icloud.com', 'name@icloud.com')).toBe(true);
  expect(sameMailbox('Name+SRS=ileBF=JF=icloud.com=other@outlook.com', 'other@icloud.com')).toBe(false);
});
