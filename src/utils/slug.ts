export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** The id a new application gets from its company name (also its file name in private/applications/). */
export function applicationIdFor(company: string): string {
  return slugify(company) || 'new-app';
}

/** Returns `candidate`, or `candidate-2`, `-3`, … — the first one not in `taken`. */
export function uniqueId(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  let i = 2;
  while (taken.has(`${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}
