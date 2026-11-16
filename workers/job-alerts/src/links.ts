export interface Anchor {
  href: string;
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  shy: '',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** Rough plain text of an HTML body: line breaks at block ends, tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(?:br|\/(?:p|div|tr|li|h[1-6]|blockquote))\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

/** Extract every `<a href>` with its decoded href and plain, whitespace-collapsed text. */
export function extractAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  for (const [, attrs, inner] of html.matchAll(ANCHOR)) {
    const hrefMatch = HREF.exec(attrs);
    if (!hrefMatch) continue;
    const href = decodeEntities((hrefMatch[1] ?? hrefMatch[2]).trim());
    const text = decodeEntities(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    anchors.push({ href, text });
  }
  return anchors;
}
