/**
 * Canonical form of a mailbox for comparing envelope senders: lowercase, no
 * `+tag`, and for Gmail no dots in the local part and googlemail.com folded
 * into gmail.com. Returns null for anything that isn't `local@domain`.
 */
export function normalizeAddress(address: string | undefined | null): string | null {
  if (typeof address !== 'string') return null;
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 1) return null;
  let local = lower.slice(0, at).split('+')[0];
  let domain = lower.slice(at + 1);
  if (!domain) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    domain = 'gmail.com';
    local = local.replaceAll('.', '');
  }
  return local ? `${local}@${domain}` : null;
}

export function sameMailbox(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = normalizeAddress(a);
  return left !== null && left === normalizeAddress(b);
}

/**
 * The domain every alert address lives under, from INBOUND_DOMAIN. Null when
 * it isn't set: then this server has no job alerts.
 */
export function inboundDomain(): string | null {
  const domain = process.env.INBOUND_DOMAIN?.trim().toLowerCase();
  return domain || null;
}
