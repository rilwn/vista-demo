import { useCallback, useEffect, useMemo, useState } from 'react';

export interface BrowserSessionCredential {
  expiresAt: string;
  sessionToken: string;
}

export type BrowserAuthenticatedSession<
  TCredential extends BrowserSessionCredential,
  TContext,
> = TCredential & { context: TContext };

export interface BrowserSessionApi<TInput, TCredential extends BrowserSessionCredential, TContext> {
  authenticate: (input: TInput) => Promise<TCredential>;
  getCurrentAccount: (token: string) => Promise<TContext>;
  revokeSession: (token: string) => Promise<void>;
}

export interface BrowserSessionOptions<
  TInput,
  TCredential extends BrowserSessionCredential,
  TContext,
> extends BrowserSessionApi<TInput, TCredential, TContext> {
  isContextValid: (value: unknown) => value is TContext;
  storageKey: string;
}

export interface BrowserSessionState<
  TInput,
  TCredential extends BrowserSessionCredential,
  TContext,
> {
  login: (input: TInput) => Promise<void>;
  logout: () => Promise<void>;
  session: BrowserAuthenticatedSession<TCredential, TContext> | null;
  status: 'anonymous' | 'authenticated' | 'checking';
}

/**
 * Shares the same bearer-session lifecycle across browser applications while
 * keeping each application origin's session storage isolated by design.
 */
export function useBrowserSession<TInput, TCredential extends BrowserSessionCredential, TContext>(
  options: BrowserSessionOptions<TInput, TCredential, TContext>,
): BrowserSessionState<TInput, TCredential, TContext> {
  const { authenticate, getCurrentAccount, isContextValid, revokeSession, storageKey } = options;
  const [initialSession] = useState<BrowserAuthenticatedSession<TCredential, TContext> | null>(() =>
    readStoredSession(storageKey, isContextValid),
  );
  const [session, setSession] = useState(initialSession);
  const [status, setStatus] = useState<
    BrowserSessionState<TInput, TCredential, TContext>['status']
  >(initialSession ? 'checking' : 'anonymous');

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setSession(null);
    setStatus('anonymous');
  }, [storageKey]);

  useEffect(() => {
    if (status !== 'checking' || !session) return;
    let active = true;
    void getCurrentAccount(session.sessionToken)
      .then((context) => {
        if (!active) return;
        const restored = { ...session, context };
        storeSession(storageKey, restored);
        setSession(restored);
        setStatus('authenticated');
      })
      .catch(() => {
        if (active) clearSession();
      });
    return () => {
      active = false;
    };
  }, [clearSession, getCurrentAccount, session, status, storageKey]);

  useEffect(() => {
    if (!session) return;
    const expiresAt = new Date(session.expiresAt).getTime();
    let timer: number | undefined;
    const scheduleExpiry = () => {
      const delay = expiresAt - Date.now();
      if (delay <= 0) {
        clearSession();
        return;
      }
      timer = window.setTimeout(scheduleExpiry, Math.min(delay, 2_147_483_647));
    };
    scheduleExpiry();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [clearSession, session]);

  const login = useCallback(
    async (input: TInput) => {
      const authenticated = await authenticate(input);
      let context: TContext;
      try {
        context = await getCurrentAccount(authenticated.sessionToken);
      } catch (error) {
        try {
          await revokeSession(authenticated.sessionToken);
        } catch {
          // The validation error is more useful to the sign-in form.
        }
        throw error;
      }
      const nextSession = { ...authenticated, context };
      storeSession(storageKey, nextSession);
      setSession(nextSession);
      setStatus('authenticated');
    },
    [authenticate, getCurrentAccount, revokeSession, storageKey],
  );

  const logout = useCallback(async () => {
    const token = session?.sessionToken;
    try {
      if (token) await revokeSession(token);
    } catch {
      // Local removal still protects this browser if the API is unavailable.
    } finally {
      clearSession();
    }
  }, [clearSession, revokeSession, session?.sessionToken]);

  return useMemo(() => ({ login, logout, session, status }), [login, logout, session, status]);
}

function readStoredSession<TCredential extends BrowserSessionCredential, TContext>(
  storageKey: string,
  isContextValid: (value: unknown) => value is TContext,
): BrowserAuthenticatedSession<TCredential, TContext> | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredSession(parsed, isContextValid)) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return parsed as BrowserAuthenticatedSession<TCredential, TContext>;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function isStoredSession<TContext>(
  value: unknown,
  isContextValid: (value: unknown) => value is TContext,
): value is BrowserAuthenticatedSession<BrowserSessionCredential, TContext> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['sessionToken'] === 'string' &&
    typeof candidate['expiresAt'] === 'string' &&
    isContextValid(candidate['context'])
  );
}

function storeSession<TCredential extends BrowserSessionCredential, TContext>(
  storageKey: string,
  session: BrowserAuthenticatedSession<TCredential, TContext>,
): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session));
}
