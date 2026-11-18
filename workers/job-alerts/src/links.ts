export interface Anchor {
  href: string;
  text: string;
  /** Raw HTML inside the link (a job card can be one big link). */
  inner: string;
  /** Raw HTML between this link and the next one (company and location often follow the title link). */
  after: string;
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

const collapse = (value: string) => value.replace(/[\s\u200b]+/g, ' ').trim();

/** The visible text pieces of an HTML fragment, one per run of text between tags, empty ones dropped. */
export function textNodes(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/<[^>]*>/)
    .map((piece) => collapse(decodeEntities(piece)))
    .filter(Boolean);
}

/** Extract every `<a href>` with its decoded href, plain whitespace-collapsed text and surrounding HTML. */
export function extractAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  const matches = [...html.matchAll(ANCHOR)];
  matches.forEach((match, i) => {
    const [whole, attrs, inner] = match;
    const hrefMatch = HREF.exec(attrs);
    if (!hrefMatch) return;
    const after = html.slice(match.index + whole.length, matches[i + 1]?.index ?? html.length);
    const href = decodeEntities((hrefMatch[1] ?? hrefMatch[2]).trim());
    const text = collapse(decodeEntities(inner.replace(/<[^>]*>/g, ' ')));
    anchors.push({ href, text, inner, after });
  });
  return anchors;
}
