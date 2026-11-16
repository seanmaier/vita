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

interface PlatformRule {
  /** Returns the external id and normalized URL for a link, or null if it is not a job link. */
  match: (href: string) => { externalId: string; url: string } | null;
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
    match: (href) => {
      const id = /[?&]jk=([0-9a-f]{16})/.exec(href)?.[1];
      return id ? { externalId: id, url: `https://de.indeed.com/viewjob?jk=${id}` } : null;
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
export function parseAlert(source: JobLeadSource, html: string): JobLeadInput[] {
  const rule = PLATFORMS[source];
  if (!rule) return [];
  const leads = new Map<string, JobLeadInput>();
  for (const { href, text } of extractAnchors(html)) {
    const hit = rule.match(href);
    if (!hit || !text) continue;
    if (!leads.has(hit.externalId)) {
      leads.set(hit.externalId, { source, externalId: hit.externalId, title: text, url: hit.url });
    }
  }
  return [...leads.values()];
}
