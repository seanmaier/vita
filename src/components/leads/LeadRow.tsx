import type { JobLead, JobLeadStatus } from '#shared/types.ts';
import { CriteriaBreakdown } from '../CriteriaBreakdown';
import { CHECK_SCORE, WORTH_SCORE } from '../../utils/leadTriage';

export interface LeadAction {
  label: string;
  status: JobLeadStatus;
}

const ESTIMATED_TITLE = "Estimated: the posting wasn't readable, so only title, company and location were rated";

export const actionButton =
  'font-mono text-[11px] bg-transparent border border-rule text-ink-2 rounded px-2.5 py-1 cursor-pointer transition-colors duration-150 hover:text-ink-invert hover:border-ink-2';

function scoreClass(score: number): string {
  if (score >= WORTH_SCORE) return 'text-status-offer border-status-offer';
  if (score >= CHECK_SCORE) return 'text-ink-2 border-ink-2';
  return 'text-ink-3 border-rule';
}

function ScoreBadge({ lead }: { lead: JobLead }) {
  if (lead.score === null) return null;
  const estimated = lead.basis === 'estimated';
  return (
    <span
      className={`font-mono text-[12px] font-semibold border rounded px-2 py-0.5 shrink-0 tabular-nums ${scoreClass(lead.score)} ${estimated ? 'border-dashed' : ''}`}
      title={estimated ? ESTIMATED_TITLE : 'Match score, from the posting'}
    >
      {estimated && <span className="sr-only">estimated </span>}
      {estimated ? '~' : ''}
      {lead.score}%
    </span>
  );
}

/** One job lead as a compact row: what it is, how it was rated and what can be done with it. */
export function LeadRow({
  lead,
  actions,
  onAction,
}: {
  lead: JobLead;
  actions: LeadAction[];
  onAction: (status: JobLeadStatus) => void;
}) {
  const meta = [lead.company, lead.location, lead.source].filter(Boolean).join(' · ');
  return (
    <li className="bg-surface border border-rule rounded-[5px] px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <ScoreBadge lead={lead} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink-invert break-words m-0">
            <a
              className="text-inherit no-underline hover:underline"
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {lead.title}
            </a>
          </h3>
          <p className="font-mono text-[11px] text-ink-3 break-words m-0 mt-0.5">
            {meta}
            {lead.basis === 'estimated' && <span className="ml-2 text-ink-2">· estimated</span>}
          </p>
        </div>
      </div>
      {lead.verdict && <p className="text-[12.5px] leading-[1.5] text-ink-2 m-0 line-clamp-2">{lead.verdict}</p>}
      {lead.exclusion && !lead.criteria?.length && (
        <p className="font-mono text-[11px] text-status-rejected m-0">Excluded: {lead.exclusion}</p>
      )}
      <CriteriaBreakdown criteria={lead.criteria} exclusion={lead.exclusion} />
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="font-mono text-[11px] text-accent no-underline hover:underline mr-1"
          href={lead.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open posting ↗
        </a>
        {actions.map((a) => (
          <button
            key={a.status}
            className={actionButton}
            type="button"
            aria-label={`${a.label}: ${lead.title}`}
            onClick={() => onAction(a.status)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </li>
  );
}
