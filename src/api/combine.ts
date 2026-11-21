interface QueryLike<T> {
  data: T | undefined;
  error: Error | null;
  refetch: () => unknown;
}

/** A query's data once it has loaded. */
type Data<Q extends QueryLike<unknown>> = Exclude<Q['data'], undefined>;

/**
 * Several queries as one, for a page that needs all of them before it can
 * show anything (see QueryState): data once every one has it, the first error,
 * and a refetch of all.
 */
export function combine<Q extends Record<string, QueryLike<unknown>>>(
  queries: Q,
): QueryLike<{ [K in keyof Q]: Data<Q[K]> }> {
  const entries = Object.entries(queries);
  const ready = entries.every(([, q]) => q.data !== undefined);
  return {
    data: ready
      ? (Object.fromEntries(entries.map(([k, q]) => [k, q.data])) as { [K in keyof Q]: Data<Q[K]> })
      : undefined,
    error: entries.find(([, q]) => q.error)?.[1].error ?? null,
    refetch: () => Promise.all(entries.map(([, q]) => q.refetch())),
  };
}
