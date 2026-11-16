// The user's personal knowledge documents (about-me, priorities), kept in the
// DB so assistants can reach them from anywhere.
import { Hono } from 'hono';
import type { User } from './auth.ts';
import { invalid, readBody } from './http.ts';
import { getValue, KEYS, setValue } from './store.ts';

export const KNOWLEDGE_DOCS = ['about-me', 'priorities'] as const;
export type KnowledgeDoc = (typeof KNOWLEDGE_DOCS)[number];
export const MAX_KNOWLEDGE_LENGTH = 200_000;

export const knowledge = new Hono<{ Variables: { user: User } }>();

function isKnowledgeDoc(name: string): name is KnowledgeDoc {
  return (KNOWLEDGE_DOCS as readonly string[]).includes(name);
}

knowledge.get('/:doc', (c) => {
  const doc = c.req.param('doc');
  if (!isKnowledgeDoc(doc)) return c.json({ error: 'No such knowledge document.' }, 404);
  const content = getValue(c.get('user').id, KEYS.knowledge(doc));
  return content === null ? c.json({ error: 'Not saved yet.' }, 404) : c.json({ doc, content });
});

knowledge.put('/:doc', async (c) => {
  const doc = c.req.param('doc');
  if (!isKnowledgeDoc(doc)) return c.json({ error: 'No such knowledge document.' }, 404);
  const body = await readBody(c, ['content']);
  if (Array.isArray(body)) return invalid(c, body);
  const { content } = body;
  if (typeof content !== 'string') return invalid(c, ['"content" must be a string.']);
  if (content.length > MAX_KNOWLEDGE_LENGTH) {
    return invalid(c, [`"content" must be at most ${MAX_KNOWLEDGE_LENGTH} characters.`]);
  }
  setValue(c.get('user').id, KEYS.knowledge(doc), content);
  return c.json({ doc, content });
});
