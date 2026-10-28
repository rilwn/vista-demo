import { vi, describe, expect, it } from 'vitest';

const ldapMocks = vi.hoisted(() => ({ clients: [] as Array<Record<string, unknown>> }));

vi.mock('ldapts', () => ({
  Client: vi.fn(() => ldapMocks.clients.shift() ?? {}),
}));

import { parseEnvironment } from '@vista/config';

import { DirectoryAuthenticationService } from './directory-authentication.service.js';

function ldapEnvironment() {
  return parseEnvironment({
    BUSINESS_TIMEZONE: 'Europe/Sofia',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
    DIRECTORY_AUTH_PROVIDER: 'ldap',
    DIRECTORY_LDAP_URL: 'ldaps://directory.example.invalid',
    DIRECTORY_LDAP_BASE_DN: 'dc=example,dc=invalid',
    DIRECTORY_LDAP_BIND_DN: 'cn=service,dc=example,dc=invalid',
    DIRECTORY_LDAP_BIND_PASSWORD: 'service-secret',
    REDIS_URL: 'redis://localhost:6379/0',
    S3_ACCESS_KEY_ID: 'local',
    S3_BUCKET: 'vista-development',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_SECRET_ACCESS_KEY: 'local-secret',
    SESSION_SECRET: 'a-session-secret-with-at-least-32-characters',
    SMTP_FROM: 'no-reply@example.invalid',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    TOTP_ENCRYPTION_KEY: 'a-totp-encryption-key-at-least-32-chars',
  });
}

describe('LDAP directory password authentication', () => {
  it('searches by escaped email, verifies the user password, and returns group attributes', async () => {
    const serviceBind = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn().mockResolvedValue({
      searchEntries: [
        {
          dn: 'uid=jane,dc=example,dc=invalid',
          mail: 'jane@example.invalid',
          displayName: 'Jane Vista',
          memberOf: ['CN=Finance,OU=Groups'],
        },
      ],
    });
    const serviceUnbind = vi.fn().mockResolvedValue(undefined);
    const userBind = vi.fn().mockResolvedValue(undefined);
    const userUnbind = vi.fn().mockResolvedValue(undefined);
    ldapMocks.clients.push(
      { bind: serviceBind, search, unbind: serviceUnbind },
      { bind: userBind, unbind: userUnbind },
    );
    const service = new DirectoryAuthenticationService(ldapEnvironment(), {
      ensureConnected: () => Promise.reject(new Error('LDAP password login does not need Redis')),
    } as never);

    await expect(
      service.authenticatePassword('JANE@example.invalid', 'user-password'),
    ).resolves.toEqual({
      displayName: 'Jane Vista',
      email: 'jane@example.invalid',
      groups: ['CN=Finance,OU=Groups'],
      provider: 'ldap',
    });
    expect(search).toHaveBeenCalledWith(
      'dc=example,dc=invalid',
      expect.objectContaining({
        filter: '(&(objectClass=person)(mail=jane@example.invalid))',
        scope: 'sub',
        sizeLimit: 2,
      }),
    );
    expect(userBind).toHaveBeenCalledWith('uid=jane,dc=example,dc=invalid', 'user-password');
    expect(serviceUnbind).toHaveBeenCalledOnce();
    expect(userUnbind).toHaveBeenCalledOnce();
  });

  it('rejects ambiguous directory matches without trying a user bind', async () => {
    const search = vi.fn().mockResolvedValue({
      searchEntries: [{ dn: 'uid=one' }, { dn: 'uid=two' }],
    });
    const unbind = vi.fn().mockResolvedValue(undefined);
    ldapMocks.clients.push({ bind: vi.fn().mockResolvedValue(undefined), search, unbind });
    const service = new DirectoryAuthenticationService(ldapEnvironment(), {
      ensureConnected: () => Promise.reject(new Error('LDAP password login does not need Redis')),
    } as never);

    await expect(
      service.authenticatePassword('jane@example.invalid', 'user-password'),
    ).resolves.toBeUndefined();
    expect(ldapMocks.clients).toHaveLength(0);
    expect(unbind).toHaveBeenCalledOnce();
  });

  it('treats rejected user credentials as a normal sign-in failure and always closes the client', async () => {
    const search = vi.fn().mockResolvedValue({
      searchEntries: [{ dn: 'uid=jane', mail: 'jane@example.invalid' }],
    });
    const serviceUnbind = vi.fn().mockResolvedValue(undefined);
    const userUnbind = vi.fn().mockResolvedValue(undefined);
    ldapMocks.clients.push(
      { bind: vi.fn().mockResolvedValue(undefined), search, unbind: serviceUnbind },
      {
        bind: vi.fn().mockRejectedValue(Object.assign(new Error('bad password'), { code: 49 })),
        unbind: userUnbind,
      },
    );
    const service = new DirectoryAuthenticationService(ldapEnvironment(), {
      ensureConnected: () => Promise.reject(new Error('LDAP password login does not need Redis')),
    } as never);

    await expect(
      service.authenticatePassword('jane@example.invalid', 'wrong-password'),
    ).resolves.toBeUndefined();
    expect(serviceUnbind).toHaveBeenCalledOnce();
    expect(userUnbind).toHaveBeenCalledOnce();
  });
});
