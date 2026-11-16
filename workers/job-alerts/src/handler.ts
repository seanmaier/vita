import PostalMime from 'postal-mime';
import { parseAlert, sourceForSender } from './parsers.ts';
import type { JobLeadInput } from './types.ts';

export interface Env {
  APP_URL: string;
  APP_TOKEN: string;
  OWNER_GMAIL: string;
  OWNER_EMAIL: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export type EmailOutcome = 'confirmation' | 'rejected' | 'ingested' | 'forwarded-on-error';

type Message = Pick<ForwardableEmailMessage, 'from' | 'to' | 'raw' | 'headers' | 'forward' | 'setReject'>;

const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';
const MAX_LEADS = 100;
const RETRY_DELAY_MS = 2000;

/**
 * Gmail's auto-forward envelope looks like `name+caf_=…@gmail.com`. Compare ignoring case and the +suffix;
 * for Gmail addresses also ignore dots in the local part and treat googlemail.com as gmail.com.
 */
export function isFromOwnerGmail(envelopeFrom: string, ownerGmail: string | undefined): boolean {
  const normalize = (address: string | undefined) => {
    if (typeof address !== 'string') return null;
    const lower = address.trim().toLowerCase();
    const at = lower.lastIndexOf('@');
    if (at < 1) return null;
    let local = lower.slice(0, at).split('+')[0];
    let domain = lower.slice(at + 1);
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      domain = 'gmail.com';
      local = local.replaceAll('.', '');
    }
    return local ? `${local}@${domain}` : null;
  };
  const from = normalize(envelopeFrom);
  return from !== null && from === normalize(ownerGmail);
}

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

async function postLeads(
  env: Env,
  leads: JobLeadInput[],
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; status: string; retryable: boolean }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.APP_TOKEN}`,
  };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  try {
    const res = await fetchImpl(`${env.APP_URL.replace(/\/+$/, '')}/api/v1/job-leads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leads }),
      // Never follow redirects: they would drop the POST body and could carry the bearer token elsewhere.
      redirect: 'manual',
    });
    // Only the app's 201 counts; a 200 (e.g. an Access login page) or any 3xx is a failure.
    if (res.status === 201) return { ok: true };
    return { ok: false, status: String(res.status), retryable: res.status >= 500 };
  } catch {
    return { ok: false, status: 'network', retryable: true };
  }
}

export async function handleEmail(
  message: Message,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EmailOutcome> {
  const finish = (outcome: EmailOutcome, detail = '') => {
    console.log(`job-alerts: ${outcome}${detail}`);
    return outcome;
  };
  const forwardToOwner = async (errorTag: string) => {
    await message.forward(env.OWNER_EMAIL, new Headers({ 'X-Vita-Ingest-Error': errorTag }));
  };

  if (message.from.trim().toLowerCase() === GMAIL_CONFIRMATION_SENDER) {
    await message.forward(env.OWNER_EMAIL);
    return finish('confirmation');
  }
  if (!isFromOwnerGmail(message.from, env.OWNER_GMAIL)) {
    message.setReject('not accepted');
    return finish('rejected', ' (envelope sender)');
  }

  const buffer = await new Response(message.raw).arrayBuffer();
  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(buffer);
  } catch {
    await forwardToOwner('unparseable');
    return finish('forwarded-on-error', ' (unparseable mail)');
  }

  const source = parsed.from?.address ? sourceForSender(parsed.from.address) : null;
  if (!source) {
    message.setReject('not accepted');
    return finish('rejected', ' (unknown sender)');
  }

  const leads = sanitize(parseAlert(source, parsed.html ?? ''));
  if (leads.length === 0) {
    await forwardToOwner('no-leads');
    return finish('forwarded-on-error', ` source=${source} leads=0`);
  }

  let result = await postLeads(env, leads, fetchImpl);
  if (!result.ok && result.retryable) {
    await sleep(RETRY_DELAY_MS);
    result = await postLeads(env, leads, fetchImpl);
  }
  if (!result.ok) {
    await forwardToOwner(result.status);
    return finish('forwarded-on-error', ` source=${source} leads=${leads.length} status=${result.status}`);
  }
  return finish('ingested', ` source=${source} leads=${leads.length}`);
}
