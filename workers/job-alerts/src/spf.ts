const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net';

/**
 * Splits an Authentication-Results value (RFC 8601) into `;`-separated segments of
 * whitespace-separated tokens. Comments `( … )`, nested ones included, are dropped; quoted
 * strings `" … "` (with `\` escapes) stay inside their token, so a `;` or space in them
 * neither starts a segment nor a token. An unclosed comment or quote swallows the rest.
 */
function segments(value: string): string[][] {
  const result: string[][] = [];
  let tokens: string[] = [];
  let token = '';
  let depth = 0;
  let quoted = false;
  const endToken = () => {
    if (token) tokens.push(token);
    token = '';
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quoted) {
      if (ch === '\\' && i + 1 < value.length) token += value[++i];
      else if (ch === '"') quoted = false;
      else token += ch;
    } else if (depth > 0) {
      if (ch === '\\') i++;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    } else if (ch === '(') {
      endToken();
      depth = 1;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ';') {
      endToken();
      result.push(tokens);
      tokens = [];
    } else if (/\s/.test(ch)) {
      endToken();
    } else {
      token += ch;
    }
  }
  endToken();
  result.push(tokens);
  return result;
}

const property = (tokens: string[], name: string): string | undefined =>
  tokens.find((t) => t.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1);

/**
 * Whether Cloudflare's own MX confirmed the envelope sender by SPF. Only the topmost
 * Authentication-Results header counts: Cloudflare adds it last, lower ones come from
 * earlier hops or the sender and can be forged. Exactly one result may name an
 * `smtp.mailfrom`; a second one can only be smuggled in (e.g. through the HELO) and fails closed.
 */
export function cloudflareSpfPass(authResults: string[], envelopeFrom: string): boolean {
  const top = authResults[0];
  if (!top) return false;
  const [head, ...results] = segments(top);
  if (head.length !== 1 || head[0].toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) return false;
  const withMailfrom = results.filter((tokens) => property(tokens, 'smtp.mailfrom') !== undefined);
  if (withMailfrom.length !== 1) return false;
  const [tokens] = withMailfrom;
  return (
    tokens[0]?.toLowerCase() === 'spf=pass' &&
    property(tokens, 'smtp.mailfrom')?.toLowerCase() === envelopeFrom.trim().toLowerCase()
  );
}
