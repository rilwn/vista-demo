import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { authenticate, getCurrentAccount, revokeSession } from '../api/auth';

const sessionStorageKey = 'vista.erp-crm.session.v1';

export interface AuthSession extends LoginResponse {
  context: AuthenticationContextResponse;
}

interface AuthContextValue {
  hasPermission: (module: string, action?: string) => boolean;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  session: AuthSession | null;
  status: 'anonymous' | 'authenticated' | 'checking';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [initialSession] = useState<AuthSession | null>(() => readStoredSession());
  const [session, setSession] = useState<AuthSession | null>(initialSession);
  const [status, setStatus] = useState<AuthContextValue['status']>(
    initialSession ? 'checking' : 'anonymous',
  );

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(sessionStorageKey);
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    if (status !== 'checking' || !session) {
      return;
    }
    let active = true;
    void getCurrentAccount(session.sessionToken)
      .then((context) => {
        if (!active) return;
        const restored = { ...session, context };
        storeSession(restored);
        setSession(restored);
        setStatus('authenticated');
      })
      .catch(() => {
        if (active) clearSession();
      });
    return () => {
      active = false;
    };
  }, [clearSession, session, status]);

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

  const login = useCallback(async (input: LoginRequest) => {
    const authenticated = await authenticate(input);
    let context: AuthenticationContextResponse;
    try {
      context = await getCurrentAccount(authenticated.sessionToken);
    } catch (error) {
      try {
        await revokeSession(authenticated.sessionToken);
      } catch {
        // The original session-validation error is more useful to the caller.
      }
      throw error;
    }
    const nextSession = { ...authenticated, context };
    storeSession(nextSession);
    setSession(nextSession);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const token = session?.sessionToken;
    try {
      if (token) await revokeSession(token);
    } catch {
      // Local revocation still removes the bearer token if the API is unavailable.
    } finally {
      clearSession();
    }
  }, [clearSession, session?.sessionToken]);

  const hasPermission = useCallback(
    (module: string, action = 'view') =>
      session?.context.permissions.some(
        (permission) =>
          (permission.module === '*' || permission.module === module) &&
          (permission.action === '*' || permission.action === action),
      ) ?? false,
    [session?.context.permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ hasPermission, login, logout, session, status }),
    [hasPermission, login, logout, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

function readStoredSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(sessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (
      !parsed.sessionToken ||
      !parsed.context?.accountId ||
      new Date(parsed.expiresAt).getTime() <= Date.now()
    ) {
      sessionStorage.removeItem(sessionStorageKey);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(sessionStorageKey);
    return null;
  }
}

function storeSession(session: AuthSession): void {
  sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
}
