import { type Anchor, extractAnchors, textNodes } from './links.ts';
import type { JobLeadInput, JobLeadSource } from './types.ts';

// Shown on the account page too (src/data/jobAlertSources.ts); a test keeps both in sync.
export const SENDER_DOMAINS: [string, JobLeadSource][] = [
  ['linkedin.com', 'linkedin'],
  ['stepstone.de', 'stepstone'],
  ['indeed.com', 'indeed'],
  ['indeed.de', 'indeed'],
  ['glassdoor.com', 'glassdoor'],
  ['glassdoor.de', 'glassdoor'],
  ['instaffo.com', 'instaffo'],
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

// The first address after each label, within the same line. Forwarders such as iCloud may put the
// whole quoted header block on one line, so a label must not swallow the rest of the line.
const FORWARDED_FROM = /\b(?:From|Von|De)\s*:[^\n@]{0,100}?([^\s<>"'()[\]]+@[^\s<>"'()[\]]+)/gi;

/**
 * For a mail the user forwarded by hand, the platform from the forwarded header
 * block in the body ("From: Indeed <…>" / "Von: …"); null if none is known.
 * The body is the user's own, so this only picks the parser; the app's sender
 * check still decides whether the mail is accepted.
 */
export function forwardedSource(text: string): JobLeadSource | null {
  for (const [, address] of text.matchAll(FORWARDED_FROM)) {
    const source = sourceForSender(address);
    if (source) return source;
  }
  return null;
}

type Match = { externalId: string; url: string } | null;
type Details = Partial<Pick<JobLeadInput, 'title' | 'company' | 'location' | 'snippet'>>;

/** The app's limit for a lead's snippet (server/jobLeadsValidation.ts); a test keeps both in sync. */
export const MAX_SNIPPET = 500;

/** The extra pieces of a job card as one line, cut to the app's limit; undefined if there are none. */
export function snippetOf(parts: (string | undefined)[]): string | undefined {
  const line = parts.filter(Boolean).join(' · ');
  if (!line) return undefined;
  return line.length > MAX_SNIPPET ? `${line.slice(0, MAX_SNIPPET - 1)}…` : line;
}

interface PlatformRule {
  /** Returns the external id and normalized URL for a link, or null if it is not a job link. */
  match: (href: string) => Match | Promise<Match>;
  /** Title, company, location and snippet from the markup around a job link, where the mail's layout gives them. */
  details?: (anchor: Anchor) => Details;
}

const BOLD_BLOCK = /<(p|div|span|h[1-6]|strong|b)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const BOLD_STYLE = /font-weight\s*:\s*(?:[6-9]00|bold)/i;

/** The text of the first bold element in a fragment (inline style or <b>/<strong>). */
function boldText(html: string): string | undefined {
  for (const [, tag, attrs, inner] of html.matchAll(BOLD_BLOCK)) {
    if (/^(?:b|strong)$/i.test(tag) || BOLD_STYLE.test(attrs)) {
      const text = textNodes(inner).join(' ');
      if (text) return text;
    }
  }
  return undefined;
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
    // Job alert cards: the title link, then company and location as the next two text lines,
    // then salary, "Einfach bewerben" and the posting's age.
    details: ({ after }) => {
      const [company, location, ...rest] = textNodes(after);
      return { company, location, snippet: snippetOf(rest) };
    },
  },
  glassdoor: {
    match: (href) => {
      const id = /jobListingId=(\d+)/.exec(href)?.[1];
      return id ? { externalId: id, url: `https://www.glassdoor.de/job-listing/index.htm?jl=${id}` } : null;
    },
    // The whole card is one link: company (and rating) first, then the bold title, then the location
    // and the posting's age.
    details: ({ inner }) => {
      const title = boldText(inner);
      if (!title) return {};
      const nodes = textNodes(inner);
      const at = nodes.indexOf(title);
      return {
        title,
        ...(at > 0 ? { company: nodes[0] } : {}),
        ...(at >= 0 && nodes[at + 1] ? { location: nodes[at + 1] } : {}),
        snippet: snippetOf([nodes.slice(1, Math.max(at, 1)).join(' '), ...nodes.slice(at + 2)]),
      };
    },
  },
};

const INSTAFFO_JOB_LINK =
  /\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(https:\/\/app\.instaffo\.com\/candidate\/job\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#][^)\s]*)?\)/g;
const INSTAFFO_LOCATION = /\[Ort\]\s*([^\n[]+)/;
// A fact about the job as a link label, e.g. "[Gehalt] 40.000 € – 65.000 €" or "[Remote] Hybrid".
const INSTAFFO_FACT = /^\s*\[([^\]]+)\]\s*(\S.*)$/;
// Text-part labels start with icon placeholders such as "[Logo]".
const sameText = (value: string) =>
  value
    .replace(/^(?:\s*\[[^\]]*\])+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Instaffo's HTML links are opaque click trackers (a different one per link), but the text part
 * carries the real job links. The HTML gives the order — title, then the company link — and the
 * text part maps the title to the job id; a company only counts if it labels the same job there.
 */
function parseInstaffo(html: string, text: string): JobLeadInput[] {
  const idByLabel = new Map<string, string>();
  const labelsById = new Map<string, Set<string>>();
  const locationById = new Map<string, string>();
  const factsById = new Map<string, Set<string>>();
  for (const line of text.split('\n')) {
    for (const [, rawLabel, id] of line.matchAll(INSTAFFO_JOB_LINK)) {
      const label = sameText(rawLabel);
      if (!idByLabel.has(label)) idByLabel.set(label, id);
      labelsById.set(id, (labelsById.get(id) ?? new Set()).add(label));
      const location = INSTAFFO_LOCATION.exec(line)?.[1]?.trim();
      if (location && !locationById.has(id)) locationById.set(id, location);
      const [, tag, value] = INSTAFFO_FACT.exec(rawLabel) ?? [];
      if (tag && value && tag !== 'Logo') {
        factsById.set(id, (factsById.get(id) ?? new Set()).add(`${tag}: ${value.trim()}`));
      }
    }
  }
  const texts = extractAnchors(html)
    .map((anchor) => anchor.text)
    .filter((linkText) => linkText && !linkText.startsWith('✨'));
  const leads = new Map<string, JobLeadInput>();
  for (const [i, title] of texts.entries()) {
    const id = idByLabel.get(sameText(title));
    if (!id || leads.has(id)) continue;
    const next = texts[i + 1];
    const company = next && labelsById.get(id)?.has(sameText(next)) ? next : undefined;
    const location = locationById.get(id);
    const snippet = snippetOf([...(factsById.get(id) ?? [])]);
    leads.set(id, {
      source: 'instaffo',
      externalId: id,
      title,
      ...(company ? { company } : {}),
      ...(location ? { location } : {}),
      ...(snippet ? { snippet } : {}),
      // Rebuilt from the id: the mail's link carries a login token ("sso") that must not be stored.
      url: `https://app.instaffo.com/candidate/job/${id}`,
    });
  }
  return [...leads.values()];
}

/**
 * Turn an alert mail into leads: one per job id, titled by the first non-empty link text unless
 * the platform's layout gives a better title. `text` is the mail's plain-text part.
 */
export async function parseAlert(source: JobLeadSource, html: string, text = ''): Promise<JobLeadInput[]> {
  if (source === 'instaffo') return parseInstaffo(html, text);
  const rule = PLATFORMS[source];
  if (!rule) return [];
  const leads = new Map<string, JobLeadInput>();
  for (const anchor of extractAnchors(html)) {
    if (!anchor.text) continue;
    const hit = await rule.match(anchor.href);
    if (!hit || leads.has(hit.externalId)) continue;
    const { title, company, location, snippet } = rule.details?.(anchor) ?? {};
    leads.set(hit.externalId, {
      source,
      externalId: hit.externalId,
      title: title ?? anchor.text,
      ...(company ? { company } : {}),
      ...(location ? { location } : {}),
      ...(snippet ? { snippet } : {}),
      url: hit.url,
    });
  }
  return [...leads.values()];
}
