import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  createJobAlertAddress,
  fetchJobAlertEvents,
  fetchJobAlerts,
  JOB_ALERT_EVENTS_LIMIT,
  saveForwardingFrom,
} from '../utils/api';
import type { InboundEvent, JobAlertsConfig } from '#shared/types.ts';
import { hintText, nafInput, nafLabel, primaryButton } from '../styles/formStyles';
import { JOB_ALERT_SOURCES } from '../data/jobAlertSources';
import { AlertEventsSkeleton, JobAlertsSkeleton, Spinner } from './Skeleton';

const hint = hintText;
const DAY_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 10_000;
const unverified = 'Unverified — only enter it in Gmail if you just added the forwarding address.';

// SQLite's datetime('now') is UTC without a zone marker.
function parseTimestamp(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

function formatTimestamp(value: string): string {
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type Provider = 'gmail' | 'outlook' | 'icloud';

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'icloud', label: 'iCloud' },
];

/** The mailbox provider of an address, for picking the right setup steps. Null if unknown. */
function providerOf(address: string | null | undefined): Provider | null {
  const domain = address?.trim().toLowerCase().split('@')[1];
  if (!domain) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'outlook';
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') return 'icloud';
  return null;
}

const exampleSender = <code>jobalerts-noreply@linkedin.com</code>;

// What the worker reports when a mail is from no supported job site (workers/job-alerts/src/handler.ts).
const UNKNOWN_SENDER = 'unknown alert sender';

/** The job sites whose alerts are read, so nobody wonders why another site's alerts don't arrive. */
const supportedSites = (
  <div className="flex flex-col gap-1.5">
    <span className={nafLabel}>Supported job sites</span>
    <ul className={`${hint} list-disc pl-4 m-0 flex flex-col gap-0.5`}>
      {JOB_ALERT_SOURCES.map((source) => (
        <li key={source.label}>
          <span className="text-[color:var(--ink-invert)]">{source.label}</span> ·{' '}
          {source.domains.map((domain, i) => (
            <span key={domain}>
              {i > 0 && ', '}
              <code>{domain}</code>
            </span>
          ))}
        </li>
      ))}
    </ul>
    <p className={hint}>
      Alerts from other sites (e.g. XING, Monster or the Arbeitsagentur) can't be read yet: they show up below as
      "Could not process · unknown alert sender" and add no leads.
    </p>
  </div>
);

/** The forwarding rule, per mailbox provider. */
const providerSteps: Record<Provider, ReactNode[]> = {
  gmail: [
    'In Gmail, open Settings → Forwarding and POP/IMAP and add the address as a forwarding address.',
    'The confirmation code from Google appears below; enter it in Gmail.',
    <>
      Create a filter for your job-alert senders, e.g. <code>from:(jobalerts-noreply@linkedin.com)</code>, with
      "Forward to" this address.
    </>,
  ],
  outlook: [
    <>
      In Outlook, open Settings → Mail → Rules and add a rule: "From" contains e.g. {exampleSender}.
    </>,
    <>
      As action choose <strong>"Forward as attachment"</strong> to this address: only then does the original alert
      arrive unchanged. "Redirect to" and "Forward to" rebuild the mail and lose links some sites (e.g. Instaffo)
      keep only in its plain-text part.
    </>,
  ],
  icloud: [
    <>
      On icloud.com, open Mail → Settings → Rules and add a rule: "is from" e.g. {exampleSender}.
    </>,
    'As action choose "Forward to" this address.',
  ],
};

const kindLabel: Record<InboundEvent['kind'], string> = {
  confirmation: 'Gmail confirmation',
  failed: 'Could not process',
  leads: 'Job alert',
};

/** The code line of a confirmation event's detail, if it has one. */
function confirmationCode(event: InboundEvent): string | null {
  return event.detail?.match(/^code: (\S+)/m)?.[1] ?? null;
}

/** Lets a user get a personal address for job-alert mails and see what arrived there. */
export function JobAlertsSection() {
  const [config, setConfig] = useState<JobAlertsConfig | null>(null);
  const [events, setEvents] = useState<InboundEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [forwardingFrom, setForwardingFrom] = useState('');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [provider, setProvider] = useState<Provider>('gmail');

  const apply = (next: JobAlertsConfig) => {
    setConfig(next);
    setForwardingFrom(next.forwardingFrom ?? '');
    const saved = providerOf(next.forwardingFrom);
    if (saved) setProvider(saved);
  };

  const loadEvents = () =>
    fetchJobAlertEvents()
      .then((list) => {
        setEvents(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Loading the alert activity failed.'))
      .finally(() => setEventsLoaded(true));

  const refresh = async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchJobAlerts()
      .then((c) => {
        apply(c);
        if (c.address) void loadEvents();
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Loading the job alert settings failed.'));
  }, []);

  const hasAddress = Boolean(config?.address);
  const latestConfirmation = events.find((ev) => ev.kind === 'confirmation');
  const freshConfirmation =
    latestConfirmation !== undefined && Date.now() - parseTimestamp(latestConfirmation.receivedAt).getTime() < DAY_MS;

  // The Gmail confirmation code arrives asynchronously, so keep looking until one is there.
  useEffect(() => {
    if (!hasAddress || freshConfirmation) return;
    const timer = setInterval(() => void loadEvents(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasAddress, freshConfirmation]);

  const generate = async () => {
    if (
      config?.address &&
      !confirm(
        'Replace the alert address? The old address stops working at once. The new one has to be activated by ' +
          'the admin again; then update your forwarding rule (and in Gmail the forwarding address) to it.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setCopyMessage(null);
    try {
      apply(await createJobAlertAddress());
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creating the alert address failed.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!config?.address) return;
    if (!navigator.clipboard) {
      setCopyMessage('Copy is not available here: select the address and copy it manually.');
      return;
    }
    try {
      await navigator.clipboard.writeText(config.address);
      setCopyMessage('Copied.');
    } catch {
      setCopyMessage('Copy failed: select the address and copy it manually.');
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      apply(await saveForwardingFrom(forwardingFrom.trim() || null));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the forwarding address failed.');
    } finally {
      setBusy(false);
    }
  };

  // The sender of confirmation mails can be spoofed, so only a fresh code is shown prominently.
  const freshCode = freshConfirmation && latestConfirmation ? confirmationCode(latestConfirmation) : null;

  const latestLeads = events.find((ev) => ev.kind === 'leads');
  const isSetUp = Boolean(config?.address) && Boolean(config?.forwardingFrom) && latestLeads !== undefined;
  const countRecent = (kind: InboundEvent['kind']) =>
    events.filter((ev) => ev.kind === kind && Date.now() - parseTimestamp(ev.receivedAt).getTime() < 7 * DAY_MS)
      .length;
  // The list is capped, so a full list that still reaches back less than 7 days may be missing newer-than-7-days mails.
  const oldest = events[events.length - 1];
  const countCapped =
    events.length >= JOB_ALERT_EVENTS_LIMIT &&
    Date.now() - parseTimestamp(oldest.receivedAt).getTime() < 7 * DAY_MS;
  const formatCount = (n: number) => (countCapped ? `${n}+` : String(n));
  const alertsLast7Days = formatCount(countRecent('leads'));
  const failedCount = countRecent('failed');
  const failedLast7Days = formatCount(failedCount);

  const setupGuide = (
    <>
      <span className={nafLabel}>Setup</span>
      <p className={hint}>
        Your mailbox forwards your job-alert mails from the supported job sites above to your personal address here,
        and the jobs in them show up as leads.
      </p>
      <ol className={`${hint} list-decimal pl-4 m-0 flex flex-col gap-1`}>
        <li>Create your address above and save the address you forward from.</li>
        <li>
          Send the address to the admin. It only receives mail once the admin has activated it; until then, mails
          to it bounce with "rejected".
        </li>
      </ol>
      <label className="flex flex-col gap-1.5">
        <span className={nafLabel}>Your mailbox</span>
        <select className={nafInput} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <ol className={`${hint} list-decimal pl-4 m-0 flex flex-col gap-1`} start={3}>
        {providerSteps[provider].map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className={hint}>
        You can also forward a single alert by hand from the address you saved, e.g. to test the setup; the job
        site is then read from the quoted header. Other mail providers may work if the forwarded mail is sent from
        your own address; they are untested. Microsoft 365 work accounts do not work.
      </p>
    </>
  );

  return (
    <section className="max-w-[560px] flex flex-col gap-4">
      <span className={nafLabel}>Job alerts</span>

      {!config && !error && <JobAlertsSkeleton />}
      {config && !config.available && <p className={hint}>Job alerts are not set up on this server.</p>}

      {config?.available && (
        <>
          {config.address ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <code className="[font-family:var(--font-mono)] text-[12px] break-all text-[color:var(--ink-invert)] select-all min-w-0">
                  {config.address}
                </code>
                <button className={`${primaryButton} shrink-0`} type="button" onClick={() => void copy()}>
                  copy
                </button>
              </div>
              {copyMessage && <p className={hint}>{copyMessage}</p>}
            </div>
          ) : (
            <p className={hint}>No address yet.</p>
          )}
          <button className={primaryButton} type="button" disabled={busy} onClick={() => void generate()}>
            {busy && <Spinner className="mr-1.5" />}
            {config.address ? 'replace address' : 'create address'}
          </button>

          {supportedSites}

          {config.address && (
            <>
              <form className="flex flex-col gap-2" onSubmit={save}>
                <label className="flex flex-col gap-1.5">
                  <span className={nafLabel}>Address you forward from</span>
                  <input
                    className={nafInput}
                    type="email"
                    placeholder="you@outlook.com"
                    value={forwardingFrom}
                    onChange={(e) => {
                      setForwardingFrom(e.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
                <p className={hint}>
                  The mailbox your alerts are forwarded from (Gmail, Outlook or iCloud). Mails from other senders are
                  bounced (rejected). Leave empty to clear it.
                </p>
                <div className="flex items-center gap-3">
                  <button className={primaryButton} type="submit" disabled={busy}>
                    {busy ? (
                      <>
                        <Spinner className="mr-1.5" />
                        saving…
                      </>
                    ) : (
                      'save'
                    )}
                  </button>
                  {saved && <span className={hint}>Saved.</span>}
                </div>
              </form>

              {!config.forwardingFrom && (
                <p className="text-[12px] text-[color:var(--status-rejected)]">
                  Alerts will be bounced until the address you forward from is saved (Gmail confirmation codes still
                  arrive).
                </p>
              )}
            </>
          )}

          {/* Overview or guide depends on the activity, so wait for it instead of flipping between them. */}
          {config.address && !eventsLoaded ? null : isSetUp && latestLeads ? (
            <>
              <span className={nafLabel}>Overview</span>
              <div className="flex flex-col gap-1">
                <p className={hint}>
                  Last alert: {formatTimestamp(latestLeads.receivedAt)}
                  {latestLeads.sender ? ` · ${latestLeads.sender}` : ''}
                </p>
                {latestLeads.detail && <p className={hint}>{latestLeads.detail}</p>}
                <p className={hint}>Alerts in the last 7 days: {alertsLast7Days}</p>
                {failedCount > 0 && (
                  <p className="[font-family:var(--font-mono)] text-[10.5px] leading-[1.6] text-[color:var(--status-rejected)]">
                    Failed in the last 7 days: {failedLast7Days}
                  </p>
                )}
              </div>
              <button
                className={`${hint} self-start underline bg-transparent border-0 p-0 cursor-pointer`}
                type="button"
                onClick={() => setShowGuide((v) => !v)}
              >
                {showGuide ? 'hide setup guide' : 'show setup guide'}
              </button>
              {showGuide && setupGuide}
            </>
          ) : (
            setupGuide
          )}

          {config.address && freshCode && (
            <div className="flex flex-col gap-1 border-[1.5px] border-[color:var(--accent)] rounded-[5px] p-3">
              <span className="text-[12px] text-[color:var(--ink-invert)]">Gmail confirmation code</span>
              <code className="[font-family:var(--font-mono)] text-[20px] tracking-[0.15em] text-[color:var(--ink-invert)] select-all">
                {freshCode}
              </code>
              <span className={hint}>{unverified}</span>
            </div>
          )}

          {config.address && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className={nafLabel}>Recent activity</span>
                <button className={primaryButton} type="button" disabled={refreshing} onClick={() => void refresh()}>
                  {refreshing && <Spinner className="mr-1.5" />}
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {!eventsLoaded ? (
                <AlertEventsSkeleton />
              ) : events.length === 0 ? (
                <p className={hint}>Nothing received yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 list-none p-0 m-0">
                  {events.map((ev) => (
                    <li key={ev.id} className="border border-[color:var(--rule)] rounded-[5px] px-3 py-2">
                      <div className={hint}>
                        {kindLabel[ev.kind]} · {formatTimestamp(ev.receivedAt)}
                      </div>
                      {ev.subject && (
                        <div className="text-[13px] text-[color:var(--ink-invert)] break-words">{ev.subject}</div>
                      )}
                      {ev.sender && <div className={`${hint} break-all`}>{ev.sender}</div>}
                      {ev.detail && <div className={`${hint} whitespace-pre-wrap break-all`}>{ev.detail}</div>}
                      {ev.kind === 'failed' && ev.detail === UNKNOWN_SENDER && (
                        <div className={hint}>Not from a supported job site (see the list above).</div>
                      )}
                      {ev.kind === 'confirmation' && <div className={hint}>{unverified}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {error && <p className="text-[12px] text-[color:var(--status-rejected)]">{error}</p>}
    </section>
  );
}
