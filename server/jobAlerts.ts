// Each user's own alert address (where their job alert mails get forwarded to)
// and the address they forward from. Cookie or full token only.
import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import type { User } from './auth.ts';
import { db } from './db.ts';
import { inboundDomain, normalizeAddress } from './emailAddress.ts';
import { invalid, readBody } from './http.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const NOT_SET_UP = 'Job alerts are not set up on this server (INBOUND_DOMAIN is not set).';

export const jobAlerts = new Hono<{ Variables: { user: User } }>();

interface AddressRow {
  local_part: string;
  forwarding_from: string | null;
}

function state(userId: number) {
  const row = db.prepare('SELECT local_part, forwarding_from FROM inbound_addresses WHERE user_id = ?').get(userId) as
    | AddressRow
    | undefined;
  const domain = inboundDomain();
  return {
    available: domain !== null,
    address: row && domain ? `${row.local_part}@${domain}` : null,
    forwardingFrom: row?.forwarding_from ?? null,
  };
}

function randomLocalPart(): string {
  let id = '';
  for (let i = 0; i < 10; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return `jobs-${id}`;
}

jobAlerts.get('/', (c) => c.json(state(c.get('user').id)));

jobAlerts.post('/address', (c) => {
  if (inboundDomain() === null) return c.json({ error: NOT_SET_UP }, 503);
  const userId = c.get('user').id;
  // A new address keeps the registered forwarding address; the old address stops working at once.
  db.prepare(
    `INSERT INTO inbound_addresses (user_id, local_part) VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE SET local_part = excluded.local_part`,
  ).run(userId, randomLocalPart());
  return c.json(state(userId));
});

jobAlerts.put('/', async (c) => {
  const body = await readBody(c, ['forwardingFrom']);
  if (Array.isArray(body)) return invalid(c, body);
  const { forwardingFrom } = body;
  let value: string | null;
  if (forwardingFrom === null) value = null;
  else if (typeof forwardingFrom === 'string' && normalizeAddress(forwardingFrom) !== null) value = forwardingFrom.trim();
  else return invalid(c, ['"forwardingFrom" must be an email address or null.']);

  const userId = c.get('user').id;
  const result = db.prepare('UPDATE inbound_addresses SET forwarding_from = ? WHERE user_id = ?').run(value, userId);
  if (!Number(result.changes)) return c.json({ error: 'Create an alert address first.' }, 404);
  return c.json(state(userId));
});

interface EventRow {
  id: number;
  kind: string;
  received_at: string;
  subject: string | null;
  sender: string | null;
  detail: string | null;
}

jobAlerts.get('/events', (c) => {
  const rawLimit = c.req.query('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > MAX_LIMIT) {
      return invalid(c, [`"limit" must be an integer 1-${MAX_LIMIT}.`]);
    }
  }
  const rows = db
    .prepare(
      'SELECT id, kind, received_at, subject, sender, detail FROM inbound_events WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(c.get('user').id, limit) as unknown as EventRow[];
  return c.json(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      receivedAt: r.received_at,
      subject: r.subject,
      sender: r.sender,
      detail: r.detail,
    })),
  );
});
