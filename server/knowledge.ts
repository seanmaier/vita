// The user's personal knowledge documents (about-me, priorities), kept in the
// DB so assistants can reach them from anywhere.
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { User } from './auth.ts';
import { invalid, jsonBody } from './http.ts';
import { knowledgeDoc as storedDoc, setKnowledgeDoc } from './data/documents.ts';

export const KNOWLEDGE_DOCS = ['about-me', 'priorities'] as const;
export type KnowledgeDoc = (typeof KNOWLEDGE_DOCS)[number];
export const MAX_KNOWLEDGE_LENGTH = 200_000;

function isKnowledgeDoc(name: string): name is KnowledgeDoc {
  return (KNOWLEDGE_DOCS as readonly string[]).includes(name);
}

/** The :doc parameter as a KnowledgeDoc, or a 404 for any other name. */
const knowledgeDoc = validator('param', (params, c) => {
  const doc = params.doc ?? '';
  return isKnowledgeDoc(doc) ? { doc } : c.json({ error: 'No such knowledge document.' }, 404);
});

export const knowledge = new Hono<{ Variables: { user: User } }>()
  .get('/:doc', knowledgeDoc, (c) => {
    const { doc } = c.req.valid('param');
    const content = storedDoc(c.get('user').id, doc);
    return content === null ? c.json({ error: 'Not saved yet.' }, 404) : c.json({ doc, content });
  })
  .put('/:doc', knowledgeDoc, jsonBody(['content']), async (c) => {
    const { doc } = c.req.valid('param');
    const { content } = c.req.valid('json');
    if (typeof content !== 'string') return invalid(c, ['"content" must be a string.']);
    if (content.length > MAX_KNOWLEDGE_LENGTH) {
      return invalid(c, [`"content" must be at most ${MAX_KNOWLEDGE_LENGTH} characters.`]);
    }
    setKnowledgeDoc(c.get('user').id, doc, content);
    return c.json({ doc, content });
  });
