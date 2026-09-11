import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
import type {
  ChangePasswordResponse,
  DisableTotpResponse,
  PasswordPolicyResponse,
  StartTotpEnrollmentResponse,
  TotpEnrollmentStatus,
  VerifyTotpEnrollmentResponse,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

import {
  changePassword,
  disableTotp,
  getPasswordPolicy,
  getTotpStatus,
  startTotpEnrollment,
  verifyTotpEnrollment,
} from '../api/auth';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { AuthenticatorQrCode } from '../components/AuthenticatorQrCode';
import { Icon } from '../components/Icon';
import { messages, moduleMessages } from '../messages';

interface PasswordFields {
  confirmNewPassword?: string;
  currentPassword?: string;
  newPassword?: string;
}

export function AccessPage() {
  const { session } = useAuth();
  const [authenticatorOpen, setAuthenticatorOpen] = useState(false);
  const [disableAuthenticatorOpen, setDisableAuthenticatorOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [totpStatus, setTotpStatus] = useState<TotpEnrollmentStatus | null>(null);
  const [totpStatusRevision, setTotpStatusRevision] = useState(0);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void getTotpStatus(session.sessionToken)
      .then((status) => {
        if (active) setTotpStatus(status);
      })
      .catch(() => {
        if (active) setTotpStatus(null);
      });
    return () => {
      active = false;
    };
  }, [session, totpStatusRevision]);

  if (!session) return null;
  const permissions = [...session.context.permissions].sort((left, right) =>
    `${left.module}:${left.action}`.localeCompare(`${right.module}:${right.action}`),
  );

  function passwordChanged(result: ChangePasswordResponse) {
    setPasswordOpen(false);
    setNotice(
      result.revokedOtherSessionCount > 0
        ? messages.access.passwordChangedWithSessions(result.revokedOtherSessionCount)
        : messages.access.passwordChanged,
    );
  }

  function authenticatorChanged(result: VerifyTotpEnrollmentResponse | DisableTotpResponse) {
    setAuthenticatorOpen(false);
    setDisableAuthenticatorOpen(false);
    setTotpStatus({
      enrolled: result.enrolled,
      ...(result.enrolledAt ? { enrolledAt: result.enrolledAt } : {}),
    });
    setTotpStatusRevision((value) => value + 1);
    setNotice(
      result.enrolled
        ? messages.access.authenticatorEnrollmentSuccess
        : messages.access.authenticatorDisableSuccess,
    );
  }

  return (
    <div className="page-stack access-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{messages.access.eyebrow}</p>
          <h1>{messages.access.title}</h1>
          <p>{messages.access.subtitle}</p>
        </div>
        <span className="security-pill">
          {session.context.twoFactorVerified ? messages.home.twoFactor : messages.home.passwordOnly}
        </span>
      </header>

      {notice ? (
        <Toast onDismiss={() => setNotice('')} tone="success">
          {notice}
        </Toast>
      ) : null}

      <section className="content-panel access-panel">
        <div className="account-detail-row">
          <div>
            <span>{messages.access.employee}</span>
            <strong>{session.context.displayName}</strong>
          </div>
          <div>
            <span>{messages.access.email}</span>
            <strong>{session.context.email}</strong>
          </div>
          <div>
            <span>{messages.access.accessLevel}</span>
            <strong>
              {session.context.isAdministrative
                ? messages.home.adminAccess
                : messages.home.standardAccess}
            </strong>
          </div>
        </div>

        <div className="access-security-card">
          <span aria-hidden="true">
            <Icon name="shield" />
          </span>
          <div>
            <strong>{messages.access.passwordSecurityTitle}</strong>
            <p>{messages.access.passwordSecurityDescription}</p>
          </div>
          <Button onClick={() => setPasswordOpen(true)} variant="secondary">
            {messages.access.changePassword}
          </Button>
        </div>

        <div className="access-security-card">
          <span aria-hidden="true">
            <Icon name="key" />
          </span>
          <div>
            <strong>{messages.access.authenticatorSecurityTitle}</strong>
            <p>
              {totpStatus?.enrolled
                ? messages.access.authenticatorEnrolled
                : messages.access.authenticatorNotEnrolled}
            </p>
          </div>
          {totpStatus?.enrolled ? (
            <Button onClick={() => setDisableAuthenticatorOpen(true)} variant="quiet">
              {messages.access.disableAuthenticator}
            </Button>
          ) : (
            <Button
              disabled={totpStatus === null}
              onClick={() => setAuthenticatorOpen(true)}
              variant="secondary"
            >
              {messages.access.setUpAuthenticator}
            </Button>
          )}
        </div>

        {permissions.length > 0 ? (
          <div className="table-scroll">
            <table className="access-table">
              <thead>
                <tr>
                  <th>{messages.access.module}</th>
                  <th>{messages.access.action}</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={`${permission.module}:${permission.action}`}>
                    <td>{formatModule(permission.module)}</td>
                    <td>
                      <span className="permission-tag">{formatAction(permission.action)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-copy">{messages.access.empty}</p>
        )}
      </section>

      {passwordOpen ? (
        <PasswordChangeDrawer
          onChanged={passwordChanged}
          onClose={() => setPasswordOpen(false)}
          token={session.sessionToken}
        />
      ) : null}
      {authenticatorOpen ? (
        <AuthenticatorEnrollmentDrawer
          onChanged={authenticatorChanged}
          onClose={() => setAuthenticatorOpen(false)}
          token={session.sessionToken}
        />
      ) : null}
      {disableAuthenticatorOpen ? (
        <DisableAuthenticatorDrawer
          onChanged={authenticatorChanged}
          onClose={() => setDisableAuthenticatorOpen(false)}
          token={session.sessionToken}
        />
      ) : null}
    </div>
  );
}

function AuthenticatorEnrollmentDrawer({
  onChanged,
  onClose,
  token,
}: {
  onChanged: (result: VerifyTotpEnrollmentResponse) => void;
  onClose: () => void;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [enrollment, setEnrollment] = useState<StartTotpEnrollmentResponse | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; currentPassword?: string }>({});

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  async function begin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      setEnrollment(await startTotpEnrollment(token, { currentPassword }));
      setCurrentPassword('');
    } catch (failure) {
      const mapped = authenticatorErrors(failure, 'setup');
      setError(mapped.message);
      setFieldErrors(mapped.fields);
      if (mapped.fields.currentPassword) setCurrentPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      onChanged(await verifyTotpEnrollment(token, enrollment.enrollmentId, { code }));
    } catch (failure) {
      const mapped = authenticatorErrors(failure, 'verify');
      setError(mapped.message);
      setFieldErrors(mapped.fields);
      if (mapped.fields.code) setCode('');
      if (failure instanceof ApiClientError && failure.code === 'TOTP_ENROLLMENT_EXPIRED') {
        setEnrollment(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const verifying = enrollment !== null;
  return (
    <SecurityDrawer
      busy={busy}
      onClose={onClose}
      subtitle={
        verifying
          ? messages.access.authenticatorSetupInstructions
          : messages.access.authenticatorSecurityDescription
      }
      title={messages.access.authenticatorSetupTitle}
    >
      {!verifying ? (
        <form
          className="security-admin-form access-authenticator-form"
          onSubmit={(event) => void begin(event)}
        >
          {error ? (
            <InlineAlert tone="error">
              <p>{error}</p>
            </InlineAlert>
          ) : null}
          <TextField
            autoComplete="current-password"
            autoFocus
            {...(fieldErrors.currentPassword ? { error: fieldErrors.currentPassword } : {})}
            id="authenticator-current-password"
            label={messages.access.currentPassword}
            maxLength={128}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
          <div className="security-drawer-actions">
            <Button disabled={busy} onClick={onClose} variant="quiet">
              {messages.access.cancelAuthenticator}
            </Button>
            <Button busy={busy} busyLabel={messages.access.settingUpAuthenticator} type="submit">
              {messages.access.setUpAuthenticator}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="security-admin-form access-authenticator-form"
          onSubmit={(event) => void verify(event)}
        >
          {error ? (
            <InlineAlert tone="error">
              <p>{error}</p>
            </InlineAlert>
          ) : null}
          <AuthenticatorQrCode provisioningUri={enrollment.provisioningUri} />
          <section
            className="authenticator-setup-key"
            aria-label={messages.access.authenticatorSetupCode}
          >
            <span>Manual setup key</span>
            <code>{groupAuthenticatorKey(enrollment.manualEntryKey)}</code>
          </section>
          <details className="authenticator-setup-link">
            <summary>Use a setup link instead</summary>
            <TextField
              id="authenticator-setup-link"
              label={messages.access.authenticatorSetupLink}
              hint={messages.access.authenticatorSetupLinkHint}
              readOnly
              type="text"
              value={enrollment.provisioningUri}
            />
          </details>
          <TextField
            autoComplete="one-time-code"
            autoFocus
            {...(fieldErrors.code ? { error: fieldErrors.code } : {})}
            id="authenticator-code"
            inputMode="numeric"
            label={messages.access.authenticatorCode}
            hint={messages.access.authenticatorCodeHint}
            maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
            pattern="[0-9]{6}"
            required
            value={code}
          />
          <div className="security-drawer-actions">
            <Button disabled={busy} onClick={onClose} variant="quiet">
              {messages.access.cancelAuthenticator}
            </Button>
            <Button busy={busy} busyLabel={messages.access.verifyingAuthenticator} type="submit">
              {messages.access.verifyAuthenticator}
            </Button>
          </div>
        </form>
      )}
    </SecurityDrawer>
  );
}

function DisableAuthenticatorDrawer({
  onChanged,
  onClose,
  token,
}: {
  onChanged: (result: DisableTotpResponse) => void;
  onClose: () => void;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; currentPassword?: string }>({});

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      onChanged(await disableTotp(token, { code, currentPassword }));
    } catch (failure) {
      const mapped = authenticatorErrors(failure, 'disable');
      setError(mapped.message);
      setFieldErrors(mapped.fields);
      if (mapped.fields.currentPassword) setCurrentPassword('');
      if (mapped.fields.code) setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SecurityDrawer
      busy={busy}
      onClose={onClose}
      subtitle={messages.access.removeAuthenticatorWarning}
      title={messages.access.authenticatorDisableTitle}
    >
      <form
        className="security-admin-form access-authenticator-form"
        onSubmit={(event) => void submit(event)}
      >
        {error ? (
          <InlineAlert tone="error">
            <p>{error}</p>
          </InlineAlert>
        ) : null}
        <TextField
          autoComplete="current-password"
          autoFocus
          {...(fieldErrors.currentPassword ? { error: fieldErrors.currentPassword } : {})}
          id="disable-authenticator-current-password"
          label={messages.access.currentPassword}
          maxLength={128}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
        <TextField
          autoComplete="one-time-code"
          {...(fieldErrors.code ? { error: fieldErrors.code } : {})}
          id="disable-authenticator-code"
          inputMode="numeric"
          label={messages.access.authenticatorCode}
          hint={messages.access.authenticatorCodeHint}
          maxLength={6}
          onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
          pattern="[0-9]{6}"
          required
          value={code}
        />
        <div className="security-drawer-actions">
          <Button disabled={busy} onClick={onClose} variant="quiet">
            {messages.access.cancelAuthenticator}
          </Button>
          <Button busy={busy} busyLabel={messages.access.disablingAuthenticator} type="submit">
            {messages.access.disableAuthenticator}
          </Button>
        </div>
      </form>
    </SecurityDrawer>
  );
}

function SecurityDrawer({
  busy,
  children,
  onClose,
  subtitle,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={messages.access.cancelAuthenticator}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer access-authenticator-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label="Back to my access"
            className="panel-back-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            Back
          </button>
          <button
            aria-label={messages.access.cancelAuthenticator}
            className="panel-close-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function PasswordChangeDrawer({
  onChanged,
  onClose,
  token,
}: {
  onChanged: (result: ChangePasswordResponse) => void;
  onClose: () => void;
  token: string;
}) {
  const [policy, setPolicy] = useState<PasswordPolicyResponse | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [policyError, setPolicyError] = useState(false);
  const [policyRevision, setPolicyRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<PasswordFields>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  useEffect(() => {
    let active = true;
    setLoadingPolicy(true);
    setPolicyError(false);
    void getPasswordPolicy(token)
      .then((result) => {
        if (active) setPolicy(result);
      })
      .catch(() => {
        if (active) setPolicyError(true);
      })
      .finally(() => {
        if (active) setLoadingPolicy(false);
      });
    return () => {
      active = false;
    };
  }, [policyRevision, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (newPassword !== confirmNewPassword) {
      setFieldErrors({ confirmNewPassword: messages.access.passwordMismatch });
      return;
    }
    setBusy(true);
    try {
      const result = await changePassword(token, { currentPassword, newPassword });
      onChanged(result);
    } catch (failure) {
      const mapped = passwordErrors(failure);
      setFieldErrors(mapped.fields);
      setError(mapped.message);
      if (mapped.fields.currentPassword) setCurrentPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={messages.access.closePassword}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={messages.access.passwordTitle}
        aria-modal="true"
        className="security-drawer access-password-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label="Back to my access"
            className="panel-back-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            Back
          </button>
          <button
            aria-label={messages.access.closePassword}
            className="panel-close-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{messages.access.passwordTitle}</h2>
            <p>{messages.access.passwordSubtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">
          {loadingPolicy ? <PasswordPolicySkeleton /> : null}
          {policyError ? (
            <InlineAlert tone="error">
              <p>{messages.access.loadPolicyError}</p>
              <Button onClick={() => setPolicyRevision((value) => value + 1)} variant="quiet">
                {messages.access.retryPolicy}
              </Button>
            </InlineAlert>
          ) : null}
          {policy ? <PasswordPolicy policy={policy} /> : null}

          <form
            className="security-admin-form access-password-form"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            {error ? (
              <InlineAlert tone="error">
                <p>{error}</p>
              </InlineAlert>
            ) : null}
            <TextField
              autoComplete="current-password"
              autoFocus
              {...(fieldErrors.currentPassword ? { error: fieldErrors.currentPassword } : {})}
              id="access-current-password"
              label={messages.access.currentPassword}
              maxLength={128}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
            <TextField
              autoComplete="new-password"
              {...(fieldErrors.newPassword ? { error: fieldErrors.newPassword } : {})}
              id="access-new-password"
              label={messages.access.newPassword}
              maxLength={128}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
            <TextField
              autoComplete="new-password"
              {...(fieldErrors.confirmNewPassword ? { error: fieldErrors.confirmNewPassword } : {})}
              id="access-confirm-password"
              label={messages.access.confirmPassword}
              maxLength={128}
              onChange={(event) => setConfirmNewPassword(event.target.value)}
              required
              type="password"
              value={confirmNewPassword}
            />
            <div className="security-drawer-actions">
              <Button disabled={busy} onClick={onClose} variant="quiet">
                {messages.access.cancelPassword}
              </Button>
              <Button
                busy={busy}
                busyLabel={messages.access.changingPassword}
                disabled={!policy || policyError}
                type="submit"
              >
                {messages.access.savePassword}
              </Button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}

function PasswordPolicy({ policy }: { policy: PasswordPolicyResponse }) {
  const requirements = [
    messages.access.passwordRequirementLength(policy.minimumLength),
    ...(policy.requireUppercase ? [messages.access.passwordRequirementUppercase] : []),
    ...(policy.requireLowercase ? [messages.access.passwordRequirementLowercase] : []),
    ...(policy.requireNumber ? [messages.access.passwordRequirementNumber] : []),
    ...(policy.requireSymbol ? [messages.access.passwordRequirementSymbol] : []),
    messages.access.passwordRequirementHistory(policy.historyCount),
  ];
  return (
    <section className="access-password-policy" aria-label={messages.access.passwordPolicyTitle}>
      <strong>{messages.access.passwordPolicyTitle}</strong>
      <ul>
        {requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
    </section>
  );
}

function PasswordPolicySkeleton() {
  return (
    <div className="access-password-policy is-loading" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function passwordErrors(error: unknown): { fields: PasswordFields; message: string } {
  if (!(error instanceof ApiClientError)) {
    return { fields: {}, message: messages.access.passwordError };
  }
  if (error.code === 'CURRENT_PASSWORD_INVALID') {
    return {
      fields: { currentPassword: messages.access.currentPasswordInvalid },
      message: '',
    };
  }
  if (error.code === 'PASSWORD_POLICY_VIOLATION') {
    return {
      fields: { newPassword: messages.access.passwordPolicyInvalid },
      message: '',
    };
  }
  if (error.code === 'PASSWORD_REUSE_NOT_ALLOWED') {
    return { fields: { newPassword: messages.access.passwordReuse }, message: '' };
  }
  if (error.code === 'RATE_LIMITED') {
    return { fields: {}, message: messages.access.passwordRateLimited };
  }
  return { fields: {}, message: messages.access.passwordError };
}

function authenticatorErrors(
  error: unknown,
  mode: 'disable' | 'setup' | 'verify',
): { fields: { code?: string; currentPassword?: string }; message: string } {
  const fallback =
    mode === 'disable'
      ? messages.access.authenticatorDisableError
      : mode === 'setup'
        ? messages.access.authenticatorSetupError
        : messages.access.authenticatorEnrollmentError;
  if (!(error instanceof ApiClientError)) return { fields: {}, message: fallback };
  if (error.code === 'CURRENT_PASSWORD_INVALID') {
    return { fields: { currentPassword: messages.access.currentPasswordInvalid }, message: '' };
  }
  if (error.code === 'TOTP_CODE_INVALID') {
    return { fields: { code: messages.access.authenticatorCodeInvalid }, message: '' };
  }
  if (error.code === 'RATE_LIMITED') {
    return { fields: {}, message: messages.access.passwordRateLimited };
  }
  return { fields: {}, message: fallback };
}

function groupAuthenticatorKey(key: string): string {
  return key.match(/.{1,4}/gu)?.join(' ') ?? key;
}

function formatModule(module: string): string {
  if (module === '*') return messages.access.wildcard;
  return moduleMessages[module as keyof typeof moduleMessages]?.label ?? module;
}

function formatAction(action: string): string {
  if (action === '*') return messages.access.wildcard;
  return action.charAt(0).toUpperCase() + action.slice(1);
}
