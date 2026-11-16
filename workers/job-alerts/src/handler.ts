import PostalMime from 'postal-mime';
import { extractConfirmation } from './confirmation.ts';
import { parseAlert, sourceForSender } from './parsers.ts';
import type { JobLeadInput } from './types.ts';

export interface Env {
  APP_URL: string;
  APP_TOKEN: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export type EmailOutcome = 'delivered' | 'rejected' | 'unavailable';

type Message = Pick<ForwardableEmailMessage, 'from' | 'to' | 'raw' | 'headers' | 'setReject'>;
type ParsedMail = Awaited<ReturnType<typeof PostalMime.parse>>;

interface InboundPayload {
  recipient: string;
  envelopeFrom: string;
  kind: 'leads' | 'confirmation' | 'failed';
  subject?: string;
  sender?: string;
  detail?: string;
  leads?: JobLeadInput[];
}

const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';
const MAX_LEADS = 100;
const MAX_SHORT_FIELD = 300;
const MAX_DETAIL = 2000;
const RETRY_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 10_000;
const TEMPORARY_REJECT = 'Vita is unavailable right now; please forward this mail again later';

/** Make leads safe for the app's all-or-nothing validation (it rejects the whole batch on one bad entry). */
export function sanitize(leads: JobLeadInput[]): JobLeadInput[] {
  const clean: JobLeadInput[] = [];
  for (const lead of leads) {
    const title = lead.title.trim().slice(0, 300);
    if (!lead.url.startsWith('https://') || !URL.canParse(lead.url) || !title) continue;
    if (!lead.externalId || lead.externalId.length > 200) continue;
    clean.push({
      ...lead,
      title,
      ...(lead.company ? { company: lead.company.slice(0, 200) } : {}),
      ...(lead.location ? { location: lead.location.slice(0, 200) } : {}),
    });
    if (clean.length === MAX_LEADS) break;
  }
  return clean;
}

async function postInbound(
  env: Env,
  payload: InboundPayload,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; status: string; retryable: boolean }> {
  // A missing secret is a setup error: keep the mail retryable until it is set.
  if (!env.APP_URL) return { ok: false, status: 'APP_URL not set', retryable: true };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.APP_TOKEN}`,
  };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  try {
    const res = await fetchImpl(`${env.APP_URL.replace(/\/+$/, '')}/api/v1/inbound-mail`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // Never follow redirects: they would drop the POST body and could carry the bearer token elsewhere.
      redirect: 'manual',
      // A hanging app or Access endpoint must become a retryable error, not a killed worker.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Only the app's 201 counts; a 200 (e.g. an Access login page) or any 3xx is a failure.
    if (res.status === 201) return { ok: true };
    // The app decided (unknown recipient, sender mismatch, bad body): retrying cannot change that.
    const decided = res.status === 400 || res.status === 403 || res.status === 404;
    return { ok: false, status: String(res.status), retryable: !decided };
  } catch {
    return { ok: false, status: 'network', retryable: true };
  }
}

const truncate = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);

function formatSender(from: { name?: string; address?: string } | undefined): string | undefined {
  if (!from?.address) return undefined;
  return from.name ? `${from.name} <${from.address}>` : from.address;
}

/** Decide what the app is told about this mail. The app does the per-user sender check. */
function buildPayload(message: Message, parsed: ParsedMail | null): { payload: InboundPayload; log: string } {
  const base = { recipient: message.to, envelopeFrom: message.from };
  if (!parsed) return { payload: { ...base, kind: 'failed', detail: 'unparseable' }, log: 'failed (unparseable)' };

  const common = {
    ...base,
    subject: truncate(parsed.subject, MAX_SHORT_FIELD),
    sender: truncate(formatSender(parsed.from), MAX_SHORT_FIELD),
  };

  if (message.from.trim().toLowerCase() === GMAIL_CONFIRMATION_SENDER) {
    const { code, url } = extractConfirmation(parsed.text ?? parsed.html ?? '');
    const parts = [code ? `code: ${code}` : '', url ? `url: ${url}` : ''].filter(Boolean);
    const detail = truncate(parts.join('\n') || 'no code found', MAX_DETAIL);
    return { payload: { ...common, kind: 'confirmation', detail }, log: 'confirmation' };
  }

  const source = parsed.from?.address ? sourceForSender(parsed.from.address) : null;
  if (!source) {
    return { payload: { ...common, kind: 'failed', detail: 'unknown alert sender' }, log: 'failed (unknown sender)' };
  }

  const leads = sanitize(parseAlert(source, parsed.html ?? ''));
  if (leads.length === 0) {
    return { payload: { ...common, kind: 'failed', detail: 'no leads found' }, log: `failed source=${source} leads=0` };
  }
  return { payload: { ...common, kind: 'leads', leads }, log: `leads source=${source} leads=${leads.length}` };
}

export async function handleEmail(
  message: Message,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EmailOutcome> {
  const bounce = (): EmailOutcome => {
    // Bounce to the sender instead of dropping the mail silently.
    message.setReject(TEMPORARY_REJECT);
    return 'unavailable';
  };
  try {
    const buffer = await new Response(message.raw).arrayBuffer();
    let parsed: ParsedMail | null = null;
    try {
      parsed = await PostalMime.parse(buffer);
    } catch {
      parsed = null;
    }

    const { payload, log } = buildPayload(message, parsed);
    let result = await postInbound(env, payload, fetchImpl);
    if (!result.ok && result.retryable) {
      await sleep(RETRY_DELAY_MS);
      result = await postInbound(env, payload, fetchImpl);
    }
    if (result.ok) {
      console.log(`job-alerts: delivered ${log}`);
      return 'delivered';
    }
    if (!result.retryable) {
      message.setReject('not accepted');
      console.log(`job-alerts: rejected ${log} status=${result.status}`);
      return 'rejected';
    }
    console.log(`job-alerts: unavailable ${log} status=${result.status}`);
    return bounce();
  } catch (error) {
    // Log the error type only, never mail content.
    console.log(`job-alerts: unavailable (unexpected ${error instanceof Error ? error.name : typeof error})`);
    return bounce();
  }
}
