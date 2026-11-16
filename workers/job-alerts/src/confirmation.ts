export interface Confirmation {
  code?: string;
  url?: string;
}

const CODE = /(?:confirmation code|best(?:ä|ae)tigungscode)\s*:?\s*(\d{4,12})/i;
const URL_RE = /https:\/\/mail(?:-settings)?\.google\.com\/[^\s<>"')]+/i;

/** Pull the code and the link out of Gmail's forwarding confirmation mail (English or German). */
export function extractConfirmation(text: string): Confirmation {
  const code = CODE.exec(text)?.[1];
  const url = URL_RE.exec(text)?.[0];
  return { ...(code ? { code } : {}), ...(url ? { url } : {}) };
}
