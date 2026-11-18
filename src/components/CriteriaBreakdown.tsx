import type { FitCriterion } from '../types';
import { criterionPoints } from '../utils/fitCriteria';

const cell = 'py-1 pr-3 text-left font-normal';
const num = 'py-1 pl-3 text-right tabular-nums';

/** How a rating breaks down per criterion, folded away until opened; nothing without criteria. */
export function CriteriaBreakdown({ criteria, exclusion }: { criteria?: FitCriterion[]; exclusion?: string }) {
  if (!criteria?.length) return null;
  return (
    <details className="font-mono text-[11px] text-ink-2">
      <summary className="cursor-pointer text-ink-3 hover:text-ink-invert select-none">
        Breakdown
      </summary>
      {exclusion && (
        <p className="m-0 mt-2 text-status-rejected">Excluded: {exclusion}</p>
      )}
      <div className="overflow-x-auto">
        <table className="mt-2 border-collapse w-full">
          <thead className="text-ink-3 border-b border-rule">
            <tr>
              <th className={cell}>Criterion</th>
              <th className={`${num} font-normal`}>Weight</th>
              <th className={`${num} font-normal`}>Fulfilled</th>
              <th className={`${num} font-normal`}>Points</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.name} className="border-b border-rule last:border-b-0">
                <td className={`${cell} break-words`}>{c.name}</td>
                <td className={num}>{c.weight}</td>
                <td className={num}>{c.fulfilled} %</td>
                <td className={`${num} text-ink-invert`}>{criterionPoints(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
