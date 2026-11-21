// Sorts rated job leads into what deserves attention first, so the leads page
// can be worked through top to bottom.
import type { JobLead } from '#shared/types.ts';

export type TriageGroup = 'worth' | 'check' | 'unlikely';

/** The push threshold of /stellenradar (priorities, section "Radar"); the app doesn't read that file yet. */
export const WORTH_SCORE = 70;
/** Below this a lead is unlikely, whether read or estimated. */
export const CHECK_SCORE = 50;

export const TRIAGE_GROUPS: { group: TriageGroup; label: string; hint: string }[] = [
  { group: 'worth', label: 'Worth a look', hint: `read the posting, ${WORTH_SCORE}% or more` },
  { group: 'check', label: 'Check', hint: `estimated, or ${CHECK_SCORE}–${WORTH_SCORE - 1}%` },
  { group: 'unlikely', label: 'Unlikely', hint: `below ${CHECK_SCORE}% or excluded` },
];

/**
 * Which group a rated lead belongs in. Only a rating that read the posting can be
 * "worth a look"; an estimate at most asks to be checked. Leads rated before the
 * basis was recorded count as read, since estimates were marked in their verdict
 * and the server derives those.
 */
export function triageGroup(lead: JobLead): TriageGroup {
  if (lead.exclusion || lead.score === null || lead.score < CHECK_SCORE) return 'unlikely';
  if (lead.basis !== 'estimated' && lead.score >= WORTH_SCORE) return 'worth';
  return 'check';
}

/** Best score first; leads without a score last. */
export function byScoreDesc(a: JobLead, b: JobLead): number {
  return (b.score ?? -1) - (a.score ?? -1);
}

/** The leads of each group, best score first. */
export function groupLeads(leads: JobLead[]): Record<TriageGroup, JobLead[]> {
  const groups: Record<TriageGroup, JobLead[]> = { worth: [], check: [], unlikely: [] };
  for (const lead of [...leads].sort(byScoreDesc)) groups[triageGroup(lead)].push(lead);
  return groups;
}
