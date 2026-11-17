import type PostalMime from 'postal-mime';

export type ParsedMail = Awaited<ReturnType<typeof PostalMime.parse>>;

/** All values of one header in message order (topmost first), folded whitespace collapsed. */
export const headerValues = (parsed: ParsedMail | null, key: string): string[] =>
  (parsed?.headers ?? []).filter((h) => h.key.toLowerCase() === key).map((h) => h.value.replace(/\s+/g, ' ').trim());
