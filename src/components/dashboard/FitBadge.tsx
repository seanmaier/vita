import type { FitRecommendation, JobFit } from '../../types';
import { breakdownText } from '../../utils/fitCriteria';

const COLORS: Record<FitRecommendation, string> = {
  apply: 'var(--status-offer)',
  'apply-if': 'var(--status-sent)',
  unlikely: 'var(--status-ghosted)',
  exclude: 'var(--status-rejected)',
};

const LABELS: Record<FitRecommendation, string> = {
  apply: 'apply',
  'apply-if': 'apply if …',
  unlikely: 'unlikely',
  exclude: 'excluded',
};

/** The score that counts: after a cap from the priorities, if one applied. */
export function fitScore(fit: JobFit): number {
  return fit.cappedScore ?? fit.score;
}

/** The job check's score, coloured by its recommendation; the reason and the breakdown show on hover. */
export function FitBadge({ fit, className = '' }: { fit?: JobFit; className?: string }) {
  if (!fit) return <span className={`text-[color:var(--ink-3)] ${className}`}>—</span>;
  const capped = fit.cappedScore !== undefined ? ` (capped from ${fit.score} %)` : '';
  const breakdown = fit.criteria ? `\n\n${breakdownText(fit.criteria, fit.exclusion)}` : '';
  return (
    <span
      className={`[font-family:var(--font-mono)] font-semibold ${className}`}
      style={{ color: COLORS[fit.recommendation] }}
      title={`${LABELS[fit.recommendation]}${capped}: ${fit.reason}${breakdown}`}
    >
      {fitScore(fit)} %
    </span>
  );
}
