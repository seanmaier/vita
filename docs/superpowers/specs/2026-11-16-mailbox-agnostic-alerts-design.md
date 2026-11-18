# Job alerts from any standard mailbox: design (short)

**Status:** approach 1 chosen by the user on 2026-11-17, after the header spike; implemented in #70.

## Intent
Job alerts should work with the mailboxes users actually have: Gmail, Outlook/Hotmail and iCloud, not only Gmail. Each user sets up one forwarding rule for their alert senders, and the jobs show up as leads.

## What the spike showed (real headers, 2026-11-16)
- **iCloud** (rule "forward"): envelope sender is the user's address itself (`name@icloud.com`). Cloudflare: `dkim=pass` for the original domain, `spf=pass smtp.mailfrom=<envelope>`.
- **Outlook.com** (rule "redirect"): envelope sender is `name+SRS=…@outlook.de`, i.e. the user's address plus a `+SRS=` tag. Cloudflare: `dkim=neutral (body hash did not verify)` because Outlook alters the body, `spf=pass smtp.mailfrom=<envelope>`.
- **Gmail** (filter "forward to"): envelope `name+caf_=…@gmail.com` (known from before).
- So a DKIM check on the job site's signature (former approach A) would reject every Outlook redirect. The envelope sender, however, identifies the user with all three providers once the `+tag` is dropped.

## The check (approach 1)
A mail to an alert address is accepted only if all of these hold:
1. The recipient is an existing secret alert address (unchanged).
2. **The envelope sender, without its `+tag`, equals the user's saved forwarding address.** The app already does this: `sameMailbox()` in `server/emailAddress.ts` strips `+tags` and folds Gmail dots. Unchanged.
3. **New: Cloudflare confirms the envelope sender with SPF.** The topmost `Authentication-Results` header must start with authserv-id `mx.cloudflare.net` and contain `spf=pass` with `smtp.mailfrom=` equal to the envelope sender (case-insensitive). Only the topmost header counts; lower ones come from earlier hops or the sender and can be forged.

This also applies to Gmail confirmation mails: their envelope (`forwarding-noreply@google.com`) must pass SPF too.

**Where the SPF check runs:** in the worker, because it alone sees the headers. If SPF does not pass, the worker does not send the mail's content as leads or a confirmation. It reports `kind: 'failed'` with detail `sender not verified (SPF)`. The app records that event only if check 2 matches (as today for `failed`), otherwise it answers 403 and the mail bounces. The app API does not change, so the worker and the app can be deployed in either order.

## Account page
- The field "Forwarding Gmail address" becomes "Address you forward from" (placeholder `you@outlook.com`). Hints and the red warning lose the word Gmail.
- The setup guide gets one short block per provider (a select or tabs: Gmail / Outlook / iCloud):
  - **Gmail:** add the address under Forwarding, enter the code shown below, then a filter "from:(…)" with "Forward to".
  - **Outlook:** rule "From contains linkedin.com …", action **"Redirect to"**, not "Forward to" (a forwarded mail comes from you, so no jobs can be read from it).
  - **iCloud:** icloud.com → Mail → Settings → Rules, "From contains …", "Forward to".
- Shared steps stay: create the address, save the forwarding address, the admin activates the address.
- "Other mail providers than Gmail are not supported" goes away.

## Non-goals
- Microsoft 365 business tenants, GMX, web.de, Proton …: untested. Business tenants use a different SRS form (`bounces+SRS=…@tenant`), which would not match.
- Verifying DKIM ourselves.
- Reading leads from Outlook-redirected alerts is assumed to work (the body changes, but probably only in encoding); a real LinkedIn alert confirms it later.

## Approaches considered
- **1 (chosen):** envelope sender without `+tag` equals the saved address, plus Cloudflare SPF pass. Works with all three providers, independent of body changes.
- **A (dropped after the spike):** DKIM pass for the job site. Fails for Outlook, which breaks the body hash.
- **DKIM where it holds, else envelope:** two paths for the same result.
- **Only the secret address:** a leaked address would let anyone inject fake leads with phishing links.

## Data migration
Not needed. `inbound_addresses.forwarding_from` keeps its meaning ("the address you forward from") and the API field `forwardingFrom` keeps its name. Saved Gmail addresses stay valid; an Outlook or iCloud user saves their own address instead.

## Left to the builder
- Parsing the Authentication-Results header (several `spf=` entries; the one with `smtp.mailfrom` counts).
- The exact wording of the per-provider steps.
