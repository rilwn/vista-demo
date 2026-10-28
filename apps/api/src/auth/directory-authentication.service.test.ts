import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '@vista/config';

import {
  DirectoryAuthenticationService,
  escapeLdapFilterValue,
  mapDirectoryGroupsToRoleCodes,
} from './directory-authentication.service.js';

const environment = parseEnvironment({
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
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

describe('directory authentication helpers', () => {
  it('keeps directory login disabled by default', () => {
    const service = new DirectoryAuthenticationService(environment, {
      ensureConnected: () => Promise.reject(new Error('Redis is not needed for this test')),
    } as never);

    expect(service.options()).toEqual({
      enabled: false,
      emergencyAccessAvailable: false,
      method: null,
    });
  });

  it('does not offer emergency-directory access while directory authentication is disabled', () => {
    const configuredWithAllowlist = parseEnvironment({
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
      DIRECTORY_EMERGENCY_EMAILS: 'local.admin@vista.local',
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
    const service = new DirectoryAuthenticationService(configuredWithAllowlist, {
      ensureConnected: () => Promise.reject(new Error('Redis is not needed for this test')),
    } as never);

    expect(service.options().emergencyAccessAvailable).toBe(false);
  });

  it('maps only explicitly configured groups to existing Vista role codes', () => {
    expect(
      mapDirectoryGroupsToRoleCodes(
        ['CN=Finance,OU=Groups', 'cn=finance,ou=groups', 'CN=Unknown,OU=Groups'],
        { 'cn=finance,ou=groups': ['finance', 'viewer'] },
      ),
    ).toEqual(['finance', 'viewer']);
  });

  it('escapes LDAP filter metacharacters before adding the email to a search filter', () => {
    expect(escapeLdapFilterValue('jane*(x)\\y\u0000@example.invalid')).toBe(
      'jane\\2a\\28x\\29\\5cy\\00@example.invalid',
    );
  });

  it('returns a short-lived one-use ticket to only the configured app origin', async () => {
    const values = new Map<string, string>();
    const redis = {
      set: (key: string, value: string) => {
        if (values.has(key)) return Promise.resolve(null);
        values.set(key, value);
        return Promise.resolve('OK');
      },
      get: (key: string) => Promise.resolve(values.get(key) ?? null),
      eval: (_script: string, _keyCount: number, ...args: string[]) => {
        const [ticketKey, claimKey, claim] = args;
        if (!ticketKey || !claimKey || !claim || !values.has(claimKey)) return Promise.resolve(0);
        values.delete(ticketKey);
        values.delete(claimKey);
        return Promise.resolve(1);
      },
    };
    const configured = parseEnvironment({
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
      DIRECTORY_AUTH_PROVIDER: 'oidc',
      DIRECTORY_OIDC_ISSUER: 'https://identity.example.invalid',
      DIRECTORY_OIDC_CLIENT_ID: 'vista',
      DIRECTORY_OIDC_CLIENT_SECRET: 'not-a-real-secret',
      DIRECTORY_OIDC_CALLBACK_URL:
        'https://api.example.invalid/api/v1/auth/directory/oidc/callback',
      DIRECTORY_LOGIN_RETURN_URLS_JSON: JSON.stringify({
        operations: 'https://ops.example.invalid',
        pos: 'https://pos.example.invalid',
        recovery: 'https://recovery.example.invalid',
      }),
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
    const service = new DirectoryAuthenticationService(configured, {
      ensureConnected: () => Promise.resolve(redis),
    } as never);

    const ticket = await service.createLoginTicket('pos', {
      email: 'cashier@vista.local',
      groups: ['CN=Cashiers'],
      provider: 'oidc',
    });

    expect(ticket.redirectUrl).toBe(
      `https://pos.example.invalid/#directory_ticket=${ticket.ticket}`,
    );
    expect(ticket.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(service.readTicket(ticket.ticket)).resolves.toMatchObject({
      email: 'cashier@vista.local',
      provider: 'oidc',
    });
    expect(await service.claimTicket(ticket.ticket)).toBeDefined();
    expect(await service.claimTicket(ticket.ticket)).toBeUndefined();
  });

  it('refuses to start organization sign-in when the provider is disabled', async () => {
    const service = new DirectoryAuthenticationService(environment, {
      ensureConnected: () => Promise.reject(new Error('A disabled provider must not reach Redis')),
    } as never);

    await expect(service.startLogin('operations')).rejects.toMatchObject({
      response: { code: 'DIRECTORY_SIGN_IN_UNAVAILABLE' },
    });
  });
});
