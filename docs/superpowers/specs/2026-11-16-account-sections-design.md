# Account sections: design (short)

**Status:** approved by the user on 2026-11-16 ("der Rest ist fein für mich und kann so implementiert werden").
**Branch:** `feat/account-sections`, branched from `feat/multi-user-alerts`; that branch has the knowledge page, job alerts and API tokens.

## Intent
The account page is one long stack (password, job alerts, API tokens, plus a link to /knowledge). The user wants each area as its own section, with the knowledge documents readable in rendered form instead of as raw textareas.

## Goals
- `/account` gets a section nav: **password | job alerts | knowledge | api tokens**. Each section has its own URL:
  - `/account` (password, the index)
  - `/account/job-alerts`
  - `/account/knowledge`
  - `/account/tokens`
- `/knowledge` redirects to `/account/knowledge` so old links keep working.
- **Job alerts section** (user decision), in this order from top to bottom:
  1. The inputs: alert address with copy, create/replace, and the forwarding Gmail field.
  2. The setup description, i.e. the numbered steps and the confirmation code.
  3. Recent deliveries.
  - Once job alerts are set up (user request, 2026-11-16), the setup description is hidden and a short summary of the latest alerts is shown instead. A link toggles the guide back, e.g. for a replaced address. "Set up" (Claude's call) means:
    - the address exists,
    - the forwarding Gmail is saved,
    - at least one `leads` delivery was received.
- **Knowledge section:**
  - The document is shown rendered as Markdown by default.
  - An "edit" button switches to the textarea, with save and cancel.
  - The textarea is always somewhat taller than its content (about 3 extra lines), so there is never scrolling inside it.
  - The about-me/priorities tabs stay.
  - The unsaved-changes guard stays, and section switches are covered too, since they are navigation.
- **Tokens section:** the existing ApiTokensSection, plus a scope picker when creating a token (user decision, 2026-11-16): `full` (default) or `job-leads:ingest`. The server enforces that only these two can be created via `/api/tokens`.

## Non-goals
- `inbound:deliver` is never selectable in the UI. It can deliver to every user's address, so it stays admin and CLI only. There is no admin role, and building one is out of scope.
- No other server, API or data changes. The only server change is the optional `scope` on `POST /api/tokens`.
- The demo keeps having no account area.

## Approaches
- **Section routing.** Chosen: nested routes with a layout (header, "logged in as", nav, `<Outlet/>`). Rejected: tabs held in local state, because sections would not be linkable and the unsaved-changes blocker would not cover tab switches.
- **Markdown.** Chosen: `react-markdown` with `remark-gfm`. It renders no raw HTML, so it is safe by default, and it handles GFM lists and tables. Rejected:
  - `marked` + `dompurify`, which needs `dangerouslySetInnerHTML` and a sanitizer.
  - A hand-written renderer, which would be incomplete.

  This is Claude's call: the user talked about outcomes, not tooling.
- **Taller textarea.** Chosen: an optional `extraLines` prop on the existing `AutoTextarea` (default 0, so other users of it are unchanged). The height becomes scrollHeight plus extraLines × line-height.

## Data migration
Not needed. `api_tokens.scope` already exists. `POST /api/tokens` without `scope` keeps creating `full` tokens, so old clients are unaffected.

## Left to the builder
- Styling of the section nav: match the existing mono and tab look, e.g. KnowledgePage's `tabClass`.
- Markdown typography: headings, lists, code, tables and links in the app's mono style.
- The empty-document state: a hint plus the edit button.
