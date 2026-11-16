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

/** Line endings and BOM do not count as a difference between two copies. */
function normalise(text: string): string {
  return stripBom(text).replace(/\r\n/g, '\n');
}

export type PullPlan = 'write' | 'keep-local-missing-on-server' | 'conflict' | 'unchanged';

/**
 * Decides what `pull` does with one document. A local file with unpushed edits
 * is never overwritten: it is a conflict, and the server copy goes next to it.
 */
export function planPull(local: string | null, server: string | null): PullPlan {
  if (server === null) return local === null ? 'write' : 'keep-local-missing-on-server';
  if (local === null) return 'write';
  return normalise(local) === normalise(server) ? 'unchanged' : 'conflict';
}

/** Where the server copy is stored when it conflicts with the working copy. */
export function serverCopyPath(doc: Doc): string {
  return `private/knowledge/${doc}.server.md`;
}
