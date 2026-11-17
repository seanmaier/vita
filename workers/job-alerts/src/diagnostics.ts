import { headerValues, type ParsedMail } from './headers.ts';

const MAX_VALUE = 1000;

export interface HeaderDiagnostics {
  envelopeFrom: string;
  envelopeTo: string;
  from: string | null;
  authenticationResults: string[];
  arcAuthenticationResults: string[];
  receivedSpf: string[];
  /** Only the signing domain and selector, never the signature itself. */
  dkimSignatures: { d: string | null; s: string | null }[];
}

const valuesOf = (parsed: ParsedMail | null, key: string): string[] =>
  headerValues(parsed, key).map((v) => v.slice(0, MAX_VALUE));

const tag = (signature: string, name: string): string | null =>
  new RegExp(`(?:^|;)\\s*${name}=([^;\\s]+)`, 'i').exec(signature)?.[1] ?? null;

/**
 * What a forwarded mail tells us about its origin, for designing the sender check:
 * envelope, From and the authentication headers. Never the subject, body or signature data.
 */
export function headerDiagnostics(envelope: { from: string; to: string }, parsed: ParsedMail | null): HeaderDiagnostics {
  return {
    envelopeFrom: envelope.from,
    envelopeTo: envelope.to,
    from: parsed?.from?.address ?? null,
    authenticationResults: valuesOf(parsed, 'authentication-results'),
    arcAuthenticationResults: valuesOf(parsed, 'arc-authentication-results'),
    receivedSpf: valuesOf(parsed, 'received-spf'),
    dkimSignatures: valuesOf(parsed, 'dkim-signature').map((v) => ({ d: tag(v, 'd'), s: tag(v, 's') })),
  };
}
