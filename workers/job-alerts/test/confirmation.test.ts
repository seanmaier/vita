import { expect, test } from 'vitest';
import { extractConfirmation } from '../src/confirmation.ts';

test('extracts code and url from an English confirmation mail', () => {
  const text = [
    'user@example.org has requested to automatically forward mail to your email address jobs@alerts.example.org.',
    'Confirmation code: 123456',
    'To allow user@example.org to automatically forward mail to your address, please click the link below to confirm the request:',
    'https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc',
  ].join('\n');
  expect(extractConfirmation(text)).toEqual({
    code: '123456',
    url: 'https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc',
  });
});

test('extracts code and url from a German confirmation mail', () => {
  const text = [
    'Bestätigungscode: 987654',
    'Klicken Sie auf den folgenden Link, um die Anfrage zu bestätigen:',
    'https://mail.google.com/mail/vf-xyz?x=1&y=2 ',
  ].join('\n');
  expect(extractConfirmation(text)).toEqual({ code: '987654', url: 'https://mail.google.com/mail/vf-xyz?x=1&y=2' });
});

test('returns an empty object when nothing is found and ignores foreign links', () => {
  expect(extractConfirmation('hello https://evil.example/mail.google.com/x')).toEqual({});
});
