import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createJobAlertAddress,
  fetchJobAlertEvents,
  fetchJobAlerts,
  saveForwardingFrom,
} from '../utils/api';
import type { InboundEvent, JobAlertsConfig } from '../types';
import { nafInput, nafLabel, primaryButton } from '../styles/formStyles';

const hint = '[font-family:var(--font-mono)] text-[10.5px] text-[color:var(--ink-3)] leading-[1.6]';
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
  const [forwardingFrom, setForwardingFrom] = useState('');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (next: JobAlertsConfig) => {
    setConfig(next);
    setForwardingFrom(next.forwardingFrom ?? '');
  };

  const loadEvents = () =>
    fetchJobAlertEvents()
      .then((list) => {
        setEvents(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Loading the alert activity failed.'));

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
        'Replace the alert address? The old address stops working at once. Update the Gmail forwarding address ' +
          'and the filter that forwards your job alerts to the new one.',
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

  return (
    <section className="max-w-[560px] flex flex-col gap-4">
      <span className={nafLabel}>Job alerts</span>
      <p className={hint}>
        Forward job-alert mails from your Gmail to a personal address here, and the jobs in them show up as
        leads.
      </p>
      <ol className={`${hint} list-decimal pl-4 m-0 flex flex-col gap-1`}>
        <li>Create your address here.</li>
        <li>Enter the Gmail address you forward from below.</li>
        <li>In Gmail, open Settings → Forwarding and add this address.</li>
        <li>The confirmation code appears below; enter it in Gmail.</li>
        <li>Create a filter for your job-alert senders with "Forward to" this address.</li>
      </ol>

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
            {config.address ? 'replace address' : 'create address'}
          </button>
        </>
      )}

      {config?.address && (
        <>
          <form className="flex flex-col gap-2" onSubmit={save}>
            <label className="flex flex-col gap-1.5">
              <span className={nafLabel}>Forwarding Gmail address</span>
              <input
                className={nafInput}
                type="email"
                placeholder="you@gmail.com"
                value={forwardingFrom}
                onChange={(e) => {
                  setForwardingFrom(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <p className={hint}>
              Must be the Gmail account you forward from; mails from other senders are bounced (rejected). Leave empty to
              clear it.
            </p>
            <div className="flex items-center gap-3">
              <button className={primaryButton} type="submit" disabled={busy}>
                save
              </button>
              {saved && <span className={hint}>Saved.</span>}
            </div>
          </form>

          {!config.forwardingFrom && (
            <p className="text-[12px] text-[color:var(--status-rejected)]">
              Alerts will be bounced until the forwarding Gmail address is saved (confirmation codes still
              arrive).
            </p>
          )}

          {freshCode && (
            <div className="flex flex-col gap-1 border-[1.5px] border-[color:var(--accent)] rounded-[5px] p-3">
              <span className="text-[12px] text-[color:var(--ink-invert)]">Gmail confirmation code</span>
              <code className="[font-family:var(--font-mono)] text-[20px] tracking-[0.15em] text-[color:var(--ink-invert)] select-all">
                {freshCode}
              </code>
              <span className={hint}>{unverified}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className={nafLabel}>Recent activity</span>
            <button className={primaryButton} type="button" onClick={() => void loadEvents()}>
              Refresh
            </button>
          </div>
          {events.length === 0 ? (
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
                  {ev.kind === 'confirmation' && <div className={hint}>{unverified}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="text-[12px] text-[color:var(--status-rejected)]">{error}</p>}
    </section>
  );
}
