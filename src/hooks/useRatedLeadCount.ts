import { useEffect, useState } from 'react';
import { fetchLeads } from '../utils/api';
import { isDemo } from '../demo/demoMode';

/** How many job leads are rated and waiting, or null while unknown (loading, failed, demo). */
export function useRatedLeadCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    fetchLeads('rated')
      .then((leads) => {
        if (!cancelled) setCount(leads.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}
