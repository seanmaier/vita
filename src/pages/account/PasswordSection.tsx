import { useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { changePassword } from '../../utils/api';
import { hintText, nafInput, nafLabel, nafSection, primaryButton } from '../../styles/formStyles';
import type { AccountOutletContext } from './AccountLayout';

// Mirrors MIN_PASSWORD_LENGTH on the server, which has the final say.
const MIN_PASSWORD_LENGTH = 10;

export function PasswordSection() {
  const { username } = useOutletContext<AccountOutletContext>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSuccess(false);
    if (next.length < MIN_PASSWORD_LENGTH)
      return setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirmNext) return setError("The new passwords don't match.");
    if (next === current) return setError('The new password must differ from the current one.');

    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirmNext('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Changing the password failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="max-w-[400px] flex flex-col gap-5" onSubmit={submit}>
      <span className={nafLabel}>Change password</span>
      {/* Lets password managers attach the new password to the right account */}
      <input type="text" autoComplete="username" value={username ?? ''} readOnly hidden />
      <label className={nafSection}>
        <span className={nafLabel}>Current password</span>
        <input
          className={nafInput}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className={nafSection}>
        <span className={nafLabel}>New password</span>
        <input
          className={nafInput}
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <span className={hintText}>At least {MIN_PASSWORD_LENGTH} characters.</span>
      </label>
      <label className={nafSection}>
        <span className={nafLabel}>Repeat new password</span>
        <input
          className={nafInput}
          type="password"
          autoComplete="new-password"
          required
          value={confirmNext}
          onChange={(e) => setConfirmNext(e.target.value)}
        />
      </label>

      {error && <p className="text-[12px] text-status-rejected">{error}</p>}
      {success && (
        <p className="text-[12px] text-status-offer">Password changed. You've been logged out on all other devices.</p>
      )}

      <button className={primaryButton} type="submit" disabled={busy}>
        {busy ? 'saving…' : 'change password'}
      </button>
    </form>
  );
}
