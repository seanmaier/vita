/** Parses a stored JSON value; a corrupt one reads as missing. */
export function parseStored<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
