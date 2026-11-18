import PostalMime from 'postal-mime';
import type { ParsedMail } from './headers.ts';
import { sourceForSender } from './parsers.ts';
import type { JobLeadSource } from './types.ts';

/** Attached mails are parsed separately, never merged into the outer text and html. */
export const PARSE_OPTIONS = { forceRfc822Attachments: true } as const;

const MAX_ATTACHED_MAILS = 5;

const isMail = (a: ParsedMail['attachments'][number]) =>
  a.mimeType.toLowerCase() === 'message/rfc822' || /\.eml$/i.test(a.filename ?? '');

/**
 * The first attached original from a known job site, as sent by "forward as attachment".
 * Inline forwarding lets the mail client rebuild the mail (e.g. Outlook regenerates the text
 * part from the html and drops the links Instaffo keeps only there); an attachment arrives
 * untouched. Only the outer mail is verified by SPF, so like a hand-forwarded quote, the
 * attachment only picks the parser and its content; the app's sender check still applies.
 */
export async function attachedAlert(
  parsed: ParsedMail,
): Promise<{ mail: ParsedMail; source: JobLeadSource } | null> {
  for (const attachment of parsed.attachments.filter(isMail).slice(0, MAX_ATTACHED_MAILS)) {
    try {
      const mail = await PostalMime.parse(attachment.content, PARSE_OPTIONS);
      const source = mail.from?.address ? sourceForSender(mail.from.address) : null;
      if (source) return { mail, source };
    } catch {
      // An unreadable attachment is skipped; the outer mail still decides.
    }
  }
  return null;
}
