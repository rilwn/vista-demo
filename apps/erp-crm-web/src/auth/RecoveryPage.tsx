import { Button, InlineAlert, TextField, VistaMark } from '@vista/ui';
import { type FormEvent, useState } from 'react';

import {
  ApiClientError,
  completeAccountRecovery,
  startAccountRecoveryTotpEnrollment,
  verifyAccountRecoveryTotpEnrollment,
} from '../api/auth';
import { AuthenticatorQrCode } from '../components/AuthenticatorQrCode';
import { Icon } from '../components/Icon';
import { messages } from '../messages';
import { Link } from '../routing/Router';

type RecoveryStep = 'form' | 'enrollment-ready' | 'enrollment' | 'complete';

interface Enrollment {
  enrollmentId: string;
  expiresAt: string;
  manualEntryKey: string;
  provisioningUri: string;
}

export function RecoveryPage() {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authenticatorCode, setAuthenticatorCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [step, setStep] = useState<RecoveryStep>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await completeAccountRecovery({ email, newPassword, recoveryCode });
      setStep(result.requiresTotpEnrollment ? 'enrollment-ready' : 'complete');
    } catch (failure) {
      setError(recoveryError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function startEnrollment() {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await startAccountRecoveryTotpEnrollment({ email, recoveryCode }));
      setStep('enrollment');
    } catch (failure) {
      setError(recoveryError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError('');
    try {
      await verifyAccountRecoveryTotpEnrollment(enrollment.enrollmentId, {
        code: authenticatorCode,
        email,
        recoveryCode,
      });
      setStep('complete');
      setAuthenticatorCode('');
      setEnrollment(null);
    } catch (failure) {
      setError(recoveryError(failure));
      setAuthenticatorCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page recovery-page">
      <section className="login-context" aria-label={messages.product.name}>
        <VistaMark product="Vista Service" />
      </section>

      <section className="login-form-pane">
        <div className="login-form-wrap recovery-form-wrap">
          <header className="login-card-context">
            <span className="login-product-icon" aria-hidden="true">
              <Icon name="shield" size={24} />
            </span>
            <span>
              <small>Secure staff access</small>
              <strong>Account recovery</strong>
            </span>
          </header>
          {step === 'form' ? (
            <>
              <h2>Recover your account</h2>
              <p className="login-form-subtitle">
                Enter the one-time code supplied by your administrator and choose a new password.
              </p>
              <form className="login-form" onSubmit={(event) => void submitRecovery(event)}>
                {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
                <TextField
                  autoComplete="email"
                  autoFocus
                  hint="Use the employee email verified by your administrator."
                  id="recovery-email"
                  label="Work email"
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
                <TextField
                  autoComplete="one-time-code"
                  hint="Enter the full code exactly as it was issued."
                  id="recovery-code"
                  label="Recovery code"
                  maxLength={64}
                  onChange={(event) => setRecoveryCode(event.target.value.trim())}
                  required
                  type="password"
                  value={recoveryCode}
                />
                <TextField
                  autoComplete="new-password"
                  hint="Use at least 12 characters, including upper and lower case letters, a number, and a symbol."
                  id="recovery-password"
                  label="New password"
                  maxLength={128}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <TextField
                  autoComplete="new-password"
                  id="recovery-password-confirm"
                  label="Confirm new password"
                  maxLength={128}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
                <Button busy={busy} busyLabel="Updating access" fullWidth type="submit">
                  Reset password
                </Button>
              </form>
            </>
          ) : null}

          {step === 'enrollment-ready' ? (
            <RecoveryStatus
              detail="Your password has been updated. Because this account administers access, set up a new authenticator before signing in."
              title="One more security step"
            >
              {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
              <Button
                busy={busy}
                busyLabel="Preparing authenticator setup"
                onClick={() => void startEnrollment()}
              >
                Set up authenticator
              </Button>
            </RecoveryStatus>
          ) : null}

          {step === 'enrollment' && enrollment ? (
            <>
              <h2>Set up your authenticator</h2>
              <p className="login-form-subtitle">
                Add a time-based code in your authenticator app, then enter its current six-digit
                code below.
              </p>
              <form className="login-form" onSubmit={(event) => void verifyEnrollment(event)}>
                {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
                <AuthenticatorQrCode provisioningUri={enrollment.provisioningUri} />
                <section className="authenticator-setup-key" aria-label="Setup key">
                  <span>Manual setup key</span>
                  <code>{groupAuthenticatorKey(enrollment.manualEntryKey)}</code>
                </section>
                <details className="authenticator-setup-link">
                  <summary>Use a setup link instead</summary>
                  <TextField
                    id="recovery-authenticator-link"
                    label="Setup link"
                    hint="Use this only if your authenticator app supports setup links."
                    readOnly
                    type="text"
                    value={enrollment.provisioningUri}
                  />
                </details>
                <TextField
                  autoComplete="one-time-code"
                  autoFocus
                  id="recovery-authenticator-code"
                  inputMode="numeric"
                  label="Authentication code"
                  maxLength={6}
                  onChange={(event) =>
                    setAuthenticatorCode(event.target.value.replace(/\D/gu, '').slice(0, 6))
                  }
                  pattern="[0-9]{6}"
                  required
                  value={authenticatorCode}
                />
                <Button busy={busy} busyLabel="Verifying authenticator" fullWidth type="submit">
                  Verify and finish
                </Button>
                <p className="recovery-expiry">
                  Setup expires {formatDateTime(enrollment.expiresAt)}.
                </p>
              </form>
            </>
          ) : null}

          {step === 'complete' ? (
            <RecoveryStatus
              detail="Your password has been updated and previous sign-ins have been closed. You can now sign in with your new credentials."
              title="Account recovered"
            >
              <Link className="vista-button vista-button--primary recovery-sign-in" to="/login">
                Back to sign in
              </Link>
            </RecoveryStatus>
          ) : null}

          {step !== 'complete' ? (
            <p className="login-support">
              Need a recovery code? Contact a Vista Service administrator.{' '}
              <Link to="/login">Back to sign in</Link>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function RecoveryStatus({
  children,
  detail,
  title,
}: {
  children: React.ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <section className="recovery-status" aria-live="polite">
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="recovery-status-actions">{children}</div>
    </section>
  );
}

function recoveryError(failure: unknown): string {
  if (!(failure instanceof ApiClientError)) {
    return 'Account recovery could not be completed. Check the details and try again.';
  }
  switch (failure.code) {
    case 'RECOVERY_CODE_INVALID':
      return 'The recovery code is invalid, expired, or has already been used.';
    case 'PASSWORD_POLICY_VIOLATION':
      return 'Choose a password that meets the requirements shown.';
    case 'PASSWORD_REUSE_NOT_ALLOWED':
      return 'Choose a password that has not been used recently.';
    case 'TOTP_CODE_INVALID':
      return 'Enter the current six-digit code from your authenticator app.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a moment before trying again.';
    default:
      return 'Account recovery could not be completed. Check the details and try again.';
  }
}

function groupAuthenticatorKey(key: string): string {
  return key.match(/.{1,4}/gu)?.join(' ') ?? key;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
