import type { ReactNode } from 'react';
import { Spinner } from './Skeleton';

interface QueryLike<T> {
  data: T | undefined;
  error: Error | null;
  refetch: () => unknown;
}

/**
 * Shows `children` with the query's data once it's there; until then a
 * spinner (or `loading`), and on failure the error with a way to try again.
 */
export function QueryState<T>({
  query,
  loading,
  children,
}: {
  query: QueryLike<T>;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) {
    return (
      <div role="alert" className="font-mono text-[12px] text-status-rejected flex items-center gap-3 p-4">
        <span>{query.error.message}</span>
        <button
          className="bg-transparent border border-rule text-ink-2 rounded px-2.5 py-1 cursor-pointer hover:text-ink-invert"
          onClick={() => query.refetch()}
        >
          try again
        </button>
      </div>
    );
  }
  return (
    <>
      {loading ?? (
        <div className="flex justify-center p-6" aria-busy="true">
          <Spinner />
        </div>
      )}
    </>
  );
}
