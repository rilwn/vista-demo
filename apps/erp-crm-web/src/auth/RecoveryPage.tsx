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
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useLocalization } from '../i18n/LocalizationProvider';
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
  const { dateLocale, t } = useLocalization();
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
      setError(t('recovery.error.mismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await completeAccountRecovery({ email, newPassword, recoveryCode });
      setStep(result.requiresTotpEnrollment ? 'enrollment-ready' : 'complete');
    } catch (failure) {
      setError(recoveryError(failure, t));
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
      setError(recoveryError(failure, t));
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
      setError(recoveryError(failure, t));
      setAuthenticatorCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page recovery-page">
      <div className="login-language-control">
        <LanguageSwitcher placement="login" />
      </div>
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
              <small>{t('recovery.secureAccess')}</small>
              <strong>{t('recovery.accountRecovery')}</strong>
            </span>
          </header>
          {step === 'form' ? (
            <>
              <h2>{t('recovery.title')}</h2>
              <p className="login-form-subtitle">{t('recovery.subtitle')}</p>
              <form className="login-form" onSubmit={(event) => void submitRecovery(event)}>
                {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
                <TextField
                  autoComplete="email"
                  autoFocus
                  hint={t('recovery.emailHint')}
                  id="recovery-email"
                  label={t('login.workEmail')}
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
                <TextField
                  autoComplete="one-time-code"
                  hint={t('recovery.codeHint')}
                  id="recovery-code"
                  label={t('recovery.code')}
                  maxLength={64}
                  onChange={(event) => setRecoveryCode(event.target.value.trim())}
                  required
                  type="password"
                  value={recoveryCode}
                />
                <TextField
                  autoComplete="new-password"
                  hint={t('recovery.passwordHint')}
                  id="recovery-password"
                  label={t('recovery.newPassword')}
                  maxLength={128}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
                <TextField
                  autoComplete="new-password"
                  id="recovery-password-confirm"
                  label={t('recovery.confirmPassword')}
                  maxLength={128}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
                <Button busy={busy} busyLabel={t('recovery.updating')} fullWidth type="submit">
                  {t('recovery.reset')}
                </Button>
              </form>
            </>
          ) : null}

          {step === 'enrollment-ready' ? (
            <RecoveryStatus detail={t('recovery.moreStepDetail')} title={t('recovery.moreStep')}>
              {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
              <Button
                busy={busy}
                busyLabel={t('recovery.preparing')}
                onClick={() => void startEnrollment()}
              >
                {t('recovery.setup')}
              </Button>
            </RecoveryStatus>
          ) : null}

          {step === 'enrollment' && enrollment ? (
            <>
              <h2>{t('recovery.setupTitle')}</h2>
              <p className="login-form-subtitle">{t('recovery.setupSubtitle')}</p>
              <form className="login-form" onSubmit={(event) => void verifyEnrollment(event)}>
                {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
                <AuthenticatorQrCode provisioningUri={enrollment.provisioningUri} />
                <section className="authenticator-setup-key" aria-label={t('recovery.setupKey')}>
                  <span>{t('recovery.manualKey')}</span>
                  <code>{groupAuthenticatorKey(enrollment.manualEntryKey)}</code>
                </section>
                <details className="authenticator-setup-link">
                  <summary>{t('recovery.useLink')}</summary>
                  <TextField
                    id="recovery-authenticator-link"
                    label={t('recovery.setupLink')}
                    hint={t('recovery.setupLinkHint')}
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
                  label={t('login.code')}
                  maxLength={6}
                  onChange={(event) =>
                    setAuthenticatorCode(event.target.value.replace(/\D/gu, '').slice(0, 6))
                  }
                  pattern="[0-9]{6}"
                  required
                  value={authenticatorCode}
                />
                <Button busy={busy} busyLabel={t('recovery.verifying')} fullWidth type="submit">
                  {t('recovery.finish')}
                </Button>
                <p className="recovery-expiry">
                  {t('recovery.expires', {
                    date: formatDateTime(enrollment.expiresAt, dateLocale),
                  })}
                </p>
              </form>
            </>
          ) : null}

          {step === 'complete' ? (
            <RecoveryStatus detail={t('recovery.completeDetail')} title={t('recovery.complete')}>
              <Link className="vista-button vista-button--primary recovery-sign-in" to="/login">
                {t('recovery.back')}
              </Link>
            </RecoveryStatus>
          ) : null}

          {step !== 'complete' ? (
            <p className="login-support">
              {t('recovery.needCode')} <Link to="/login">{t('recovery.back')}</Link>
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

function recoveryError(failure: unknown, t: ReturnType<typeof useLocalization>['t']): string {
  if (!(failure instanceof ApiClientError)) {
    return t('recovery.error.default');
  }
  switch (failure.code) {
    case 'RECOVERY_CODE_INVALID':
      return t('recovery.error.invalid');
    case 'PASSWORD_POLICY_VIOLATION':
      return t('recovery.error.policy');
    case 'PASSWORD_REUSE_NOT_ALLOWED':
      return t('recovery.error.reuse');
    case 'TOTP_CODE_INVALID':
      return t('recovery.error.totp');
    case 'RATE_LIMITED':
      return t('recovery.error.rate');
    default:
      return t('recovery.error.default');
  }
}

function groupAuthenticatorKey(key: string): string {
  return key.match(/.{1,4}/gu)?.join(' ') ?? key;
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
