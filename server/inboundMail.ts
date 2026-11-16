// Delivery endpoint for the Cloudflare Email Worker. The worker holds one
// service token (scope `inbound:deliver`); the target user comes only from the
// recipient address, never from the token's owner.
import { Hono } from 'hono';
import type { JobLeadInput } from '../src/types.ts';
import { db } from './db.ts';
import { inboundDomain, sameMailbox } from './emailAddress.ts';
import { invalid, readBody, type V1Env } from './http.ts';
import { insertLeads } from './jobLeads.ts';
import { validateLeadInput } from './jobLeadsValidation.ts';

const MAX_BATCH = 100;
const MAX_SHORT = 300;
const MAX_DETAIL = 2000;
const GOOGLE_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';
const KINDS = ['leads', 'confirmation', 'failed'] as const;
type Kind = (typeof KINDS)[number];

export const inboundMail = new Hono<V1Env>();

/** Housekeeping: delivery events are only a short-lived diagnostic log. */
export function purgeOldInboundEvents(): number {
  const result = db.prepare("DELETE FROM inbound_events WHERE received_at < datetime('now', '-30 days')").run();
  return Number(result.changes);
}

/** The user an alert address belongs to, plus the Gmail they registered. */
function findRecipient(raw: string): { userId: number; forwardingFrom: string | null } | null {
  const recipient = raw.trim();
  const at = recipient.lastIndexOf('@');
  if (at < 1 || recipient.slice(at + 1).toLowerCase() !== inboundDomain()) return null;
  const row = db
    .prepare('SELECT user_id, forwarding_from FROM inbound_addresses WHERE local_part = ?')
    .get(recipient.slice(0, at).toLowerCase()) as { user_id: number; forwarding_from: string | null } | undefined;
  return row ? { userId: row.user_id, forwardingFrom: row.forwarding_from } : null;
}

const clipped = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

inboundMail.post('/', async (c) => {
  if (c.get('tokenScope') !== 'inbound:deliver') {
    return c.json({ error: 'This endpoint is for the mail worker only.' }, 403);
  }
  const body = await readBody(c, ['recipient', 'envelopeFrom', 'kind', 'subject', 'sender', 'detail', 'leads']);
  if (Array.isArray(body)) return invalid(c, body);
  const { recipient, envelopeFrom, kind, leads } = body;
  const errors: string[] = [];
  if (typeof recipient !== 'string') errors.push('"recipient" must be a string.');
  if (typeof envelopeFrom !== 'string') errors.push('"envelopeFrom" must be a string.');
  if (!KINDS.includes(kind as Kind)) errors.push(`"kind" must be one of: ${KINDS.join(', ')}.`);
  if (errors.length) return invalid(c, errors);

  const target = findRecipient(recipient as string);
  if (!target) return c.json({ error: 'Unknown recipient.' }, 404);

  const from = envelopeFrom as string;
  const forbidden = () => c.json({ error: 'Sender not accepted.' }, 403);
  const record = (eventKind: Kind, detail: unknown) =>
    db
      .prepare('INSERT INTO inbound_events (user_id, kind, subject, sender, detail) VALUES (?, ?, ?, ?, ?)')
      .run(
        target.userId,
        eventKind,
        clipped(body.subject, MAX_SHORT),
        clipped(body.sender, MAX_SHORT),
        clipped(detail, MAX_DETAIL),
      );

  if (kind === 'confirmation') {
    if (from.trim().toLowerCase() !== GOOGLE_CONFIRMATION_SENDER) return forbidden();
    record('confirmation', body.detail);
    return c.json({ ok: true }, 201);
  }
  if (!sameMailbox(from, target.forwardingFrom)) return forbidden();

  if (kind === 'failed') {
    record('failed', body.detail);
    return c.json({ ok: true }, 201);
  }

  if (!Array.isArray(leads) || leads.length < 1 || leads.length > MAX_BATCH) {
    return invalid(c, [`"leads" must contain 1-${MAX_BATCH} entries.`]);
  }
  const parsed: JobLeadInput[] = [];
  const leadErrors: string[] = [];
  leads.forEach((entry, i) => {
    const result = validateLeadInput(entry);
    if (result.ok) parsed.push(result.value);
    else leadErrors.push(...result.errors.map((e) => `leads[${i}].${e}`));
  });
  if (leadErrors.length) return invalid(c, leadErrors);

  const counts = insertLeads(target.userId, parsed);
  record('leads', `${counts.created} neu, ${counts.duplicates} doppelt`);
  return c.json(counts, 201);
});
