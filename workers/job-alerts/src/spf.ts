const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net';

/** Drops RFC 8601 comments like "(mx.cloudflare.net: domain of … designates …)", nested ones included. */
function withoutComments(value: string): string {
  let out = value;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, ' ');
  }
  return out;
}

/**
 * Whether Cloudflare's own MX confirmed the envelope sender by SPF. Only the topmost
 * Authentication-Results header counts: Cloudflare adds it last, lower ones come from
 * earlier hops or the sender and can be forged.
 */
export function cloudflareSpfPass(authResults: string[], envelopeFrom: string): boolean {
  const top = authResults[0];
  if (!top) return false;
  const [authservId, ...results] = withoutComments(top).split(';').map((part) => part.trim());
  if (authservId.toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) return false;
  const envelope = envelopeFrom.trim().toLowerCase();
  return results.some((result) => {
    if (!/^spf=pass(\s|$)/i.test(result)) return false;
    const mailfrom = /(?:^|\s)smtp\.mailfrom=("?)([^\s"]+)\1/i.exec(result)?.[2];
    return mailfrom !== undefined && mailfrom.toLowerCase() === envelope;
  });
}
