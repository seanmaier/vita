// Pure helpers for scripts/knowledge.ts (kept separate so they are unit-testable).

export const DOCS = ['about-me', 'priorities'] as const;
export type Doc = (typeof DOCS)[number];

export function isDoc(value: string | undefined): value is Doc {
  return DOCS.includes(value as Doc);
}

/** Working copy of a knowledge document (gitignored). */
export function workingCopyPath(doc: Doc): string {
  return `private/knowledge/${doc}.md`;
}

/** Drops a leading UTF-8 byte order mark that some editors add. */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}
