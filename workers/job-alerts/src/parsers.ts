import { extractAnchors } from './links.ts';
import type { JobLeadInput, JobLeadSource } from './types.ts';

const SENDER_DOMAINS: [string, JobLeadSource][] = [
  ['linkedin.com', 'linkedin'],
  ['stepstone.de', 'stepstone'],
  ['indeed.com', 'indeed'],
  ['indeed.de', 'indeed'],
  ['glassdoor.com', 'glassdoor'],
  ['glassdoor.de', 'glassdoor'],
];

/** Map a sender address (optionally "Name <addr>") to a platform by its domain; null if unknown. */
export function sourceForSender(address: string): JobLeadSource | null {
  const domain = address.match(/@([^@\s<>]+)>?\s*$/)?.[1]?.toLowerCase();
  if (!domain) return null;
  for (const [suffix, source] of SENDER_DOMAINS) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return source;
  }
  return null;
}

const FORWARDED_FROM = /\b(?:From|Von|De)\s*:[^\S\n]*([^\n]*)/gi;
const ADDRESS = /[^\s<>"'()[\]]+@[^\s<>"'()[\]]+/;

/**
 * For a mail the user forwarded by hand, the platform from the forwarded header
 * block in the body ("From: Indeed <…>" / "Von: …"); null if none is known.
 * The body is the user's own, so this only picks the parser; the app's sender
 * check still decides whether the mail is accepted.
 */
export function forwardedSource(text: string): JobLeadSource | null {
  for (const [, line] of text.matchAll(FORWARDED_FROM)) {
    const address = ADDRESS.exec(line)?.[0];
    const source = address ? sourceForSender(address) : null;
    if (source) return source;
  }
  return null;
}

type Match = { externalId: string; url: string } | null;

interface PlatformRule {
  /** Returns the external id and normalized URL for a link, or null if it is not a job link. */
  match: (href: string) => Match | Promise<Match>;
}

const INDEED_JK = /[?&]jk=([0-9a-f]{16})/;
const INDEED_TRACKING = /^\/v3\/(H4sI[A-Za-z0-9_-]{1,4000})(?:\/|$)/;
const MAX_TRACKING_JSON = 16 * 1024;

const indeedLead = (jk: string) => ({ externalId: jk, url: `https://de.indeed.com/viewjob?jk=${jk}` });

/**
 * Indeed's alert links go through cts.indeed.com/v3/<token>/<sig>, where the
 * token is base64url gzip JSON whose "u" is the real job link with the jk id.
 */
async function indeedTrackingTarget(href: string): Promise<string | null> {
  if (!URL.canParse(href)) return null;
  const { protocol, hostname, pathname } = new URL(href);
  if (protocol !== 'https:' || hostname !== 'cts.indeed.com') return null;
  const token = INDEED_TRACKING.exec(pathname)?.[1];
  if (!token) return null;
  try {
    const gzip = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const reader = new Blob([gzip]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Guard against a crafted token that inflates to something huge.
      if (size > MAX_TRACKING_JSON) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { u?: unknown };
    return typeof json.u === 'string' ? json.u : null;
  } catch {
    return null;
  }
}

const PLATFORMS: Partial<Record<JobLeadSource, PlatformRule>> = {
  linkedin: {
    match: (href) => {
      const id = /\/jobs\/view\/(\d+)/.exec(href)?.[1];
      return id ? { externalId: id, url: `https://www.linkedin.com/jobs/view/${id}/` } : null;
    },
  },
  stepstone: {
    match: (href) => {
      const id = /--(\d+)-inline\.html/.exec(href)?.[1];
      if (!id || !URL.canParse(href)) return null;
      const { protocol, hostname, pathname } = new URL(href);
      // Pin the host: a forged link in a mail must not become a lead pointing elsewhere.
      if (protocol !== 'https:' || (hostname !== 'stepstone.de' && !hostname.endsWith('.stepstone.de'))) return null;
      return { externalId: id, url: `https://${hostname}${pathname}` };
    },
  },
  indeed: {
    match: async (href) => {
      const direct = INDEED_JK.exec(href)?.[1];
      if (direct) return indeedLead(direct);
      const target = await indeedTrackingTarget(href);
      if (!target || !URL.canParse(target)) return null;
      const { protocol, hostname, search } = new URL(target);
      // Only a real Indeed job link counts; the lead URL is rebuilt from the id anyway.
      if (protocol !== 'https:' || (hostname !== 'indeed.com' && !hostname.endsWith('.indeed.com'))) return null;
      const jk = INDEED_JK.exec(search)?.[1];
      return jk ? indeedLead(jk) : null;
    },
  },
  glassdoor: {
    match: (href) => {
      const id = /jobListingId=(\d+)/.exec(href)?.[1];
      return id ? { externalId: id, url: `https://www.glassdoor.de/job-listing/index.htm?jl=${id}` } : null;
    },
  },
};

/** Turn an alert mail's HTML into leads: one per job id, titled by the first non-empty link text. */
export async function parseAlert(source: JobLeadSource, html: string): Promise<JobLeadInput[]> {
  const rule = PLATFORMS[source];
  if (!rule) return [];
  const leads = new Map<string, JobLeadInput>();
  for (const { href, text } of extractAnchors(html)) {
    if (!text) continue;
    const hit = await rule.match(href);
    if (!hit) continue;
    if (!leads.has(hit.externalId)) {
      leads.set(hit.externalId, { source, externalId: hit.externalId, title: text, url: hit.url });
    }
  }
  return [...leads.values()];
}
