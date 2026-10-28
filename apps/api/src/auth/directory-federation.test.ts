import { vi, describe, expect, it, beforeEach } from 'vitest';

const federationMocks = vi.hoisted(() => ({
  oidc: {
    authorizationCodeGrant: vi.fn(),
    buildAuthorizationUrl: vi.fn(),
    calculatePKCECodeChallenge: vi.fn(),
    discovery: vi.fn(),
    randomNonce: vi.fn(),
    randomPKCECodeVerifier: vi.fn(),
  },
  saml: {
    authorize: vi.fn(),
    constructedWith: vi.fn(),
    metadata: vi.fn(),
    validate: vi.fn(),
  },
}));

vi.mock('openid-client', () => federationMocks.oidc);
vi.mock('@node-saml/node-saml', () => ({
  SAML: class {
    constructor(options: unknown) {
      federationMocks.saml.constructedWith(options);
    }

    getAuthorizeUrlAsync(...args: unknown[]) {
      const result: unknown = federationMocks.saml.authorize(...args);
      return Promise.resolve(result);
    }

    validatePostResponseAsync(...args: unknown[]) {
      const result: unknown = federationMocks.saml.validate(...args);
      return Promise.resolve(result);
    }

    generateServiceProviderMetadata(...args: unknown[]) {
      const result: unknown = federationMocks.saml.metadata(...args);
      if (typeof result !== 'string') throw new Error('Expected test SAML metadata');
      return result;
    }
  },
  ValidateInResponseTo: { always: 'always' },
}));

import { parseEnvironment } from '@vista/config';

import { DirectoryAuthenticationService } from './directory-authentication.service.js';

function providerEnvironment(provider: 'oidc' | 'saml') {
  return parseEnvironment({
    BUSINESS_TIMEZONE: 'Europe/Sofia',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://vista:password@localhost:5432/vista',
    DIRECTORY_AUTH_PROVIDER: provider,
    DIRECTORY_LOGIN_RETURN_URLS_JSON: JSON.stringify({
      operations: 'https://ops.example.invalid',
      pos: 'https://pos.example.invalid',
      recovery: 'https://recovery.example.invalid',
    }),
    DIRECTORY_OIDC_ISSUER: 'https://identity.example.invalid/tenant',
    DIRECTORY_OIDC_CLIENT_ID: 'vista-client',
    DIRECTORY_OIDC_CLIENT_SECRET: 'test-client-secret',
    DIRECTORY_OIDC_CALLBACK_URL: 'https://api.example.invalid/api/v1/auth/directory/oidc/callback',
    DIRECTORY_SAML_ENTRY_POINT: 'https://identity.example.invalid/sso',
    DIRECTORY_SAML_ISSUER: 'https://vista.example.invalid/saml',
    DIRECTORY_SAML_CALLBACK_URL: 'https://api.example.invalid/api/v1/auth/directory/saml/callback',
    DIRECTORY_SAML_IDP_CERTIFICATE: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
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

function redisFixture() {
  const entries = new Map<string, string>();
  return {
    entries,
    redis: {
      set: vi.fn((key: string, value: string) => {
        if (entries.has(key)) return Promise.resolve(null);
        entries.set(key, value);
        return Promise.resolve('OK');
      }),
      get: vi.fn((key: string) => Promise.resolve(entries.get(key) ?? null)),
      eval: vi.fn((_script: string, _keyCount: number, key: string) => {
        const value = entries.get(key);
        entries.delete(key);
        return Promise.resolve(value ?? null);
      }),
    },
  };
}

function getAuthorizationState(entries: Map<string, string>): string {
  const stored = [...entries.values()].find((value) => value.includes('"provider"'));
  if (!stored) throw new Error('Expected a pending directory authorization state');
  return (JSON.parse(stored) as { state: string }).state;
}

describe('OIDC and SAML sign-in adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses OIDC state, nonce and PKCE, then returns only a verified email and mapped groups', async () => {
    const { entries, redis } = redisFixture();
    federationMocks.oidc.randomPKCECodeVerifier.mockReturnValue('one-time-verifier');
    federationMocks.oidc.randomNonce.mockReturnValue('one-time-nonce');
    federationMocks.oidc.calculatePKCECodeChallenge.mockResolvedValue('challenge');
    federationMocks.oidc.discovery.mockResolvedValue({ provider: 'discovered' });
    federationMocks.oidc.buildAuthorizationUrl.mockReturnValue(
      new URL('https://identity.example.invalid/authorize'),
    );
    federationMocks.oidc.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({
        email: 'finance@vista.local',
        email_verified: true,
        groups: ['CN=Finance,OU=Groups'],
        name: 'Vista Finance Officer',
      }),
    });
    const service = new DirectoryAuthenticationService(providerEnvironment('oidc'), {
      ensureConnected: () => Promise.resolve(redis),
    } as never);

    const started = await service.startLogin('operations');
    const state = getAuthorizationState(entries);
    const completed = await service.completeOidcCallback(
      new URL(
        `https://api.example.invalid/api/v1/auth/directory/oidc/callback?code=code&state=${state}`,
      ),
    );

    expect(started.authorizationUrl).toContain('identity.example.invalid/authorize');
    expect(federationMocks.oidc.buildAuthorizationUrl).toHaveBeenCalledWith(
      { provider: 'discovered' },
      expect.objectContaining({
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        nonce: 'one-time-nonce',
        state,
      }),
    );
    expect(federationMocks.oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      { provider: 'discovered' },
      expect.any(URL),
      expect.objectContaining({
        expectedNonce: 'one-time-nonce',
        expectedState: state,
        pkceCodeVerifier: 'one-time-verifier',
      }),
    );
    expect(completed.redirectUrl).toBe(
      `https://ops.example.invalid/#directory_ticket=${completed.ticket}`,
    );
    await expect(service.readTicket(completed.ticket)).resolves.toMatchObject({
      email: 'finance@vista.local',
      groups: ['CN=Finance,OU=Groups'],
      provider: 'oidc',
    });
    await expect(
      service.completeOidcCallback(
        new URL(
          `https://api.example.invalid/api/v1/auth/directory/oidc/callback?code=code&state=${state}`,
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('requires signed, replay-checked SAML responses bound to a pending request', async () => {
    const { entries, redis } = redisFixture();
    federationMocks.saml.authorize.mockResolvedValue(
      'https://identity.example.invalid/sso?SAMLRequest=example',
    );
    federationMocks.saml.validate.mockResolvedValue({
      loggedOut: false,
      profile: {
        email: 'backup.operator@vista.local',
        groups: ['CN=Backup Operators'],
        displayName: 'Vista Backup Operator',
      },
    });
    federationMocks.saml.metadata.mockReturnValue('<EntityDescriptor />');
    const service = new DirectoryAuthenticationService(providerEnvironment('saml'), {
      ensureConnected: () => Promise.resolve(redis),
    } as never);

    expect(service.samlMetadata()).toBe('<EntityDescriptor />');
    const started = await service.startLogin('recovery');
    const relayState = getAuthorizationState(entries);
    const completed = await service.completeSamlCallback('signed-assertion', relayState);
    const options = federationMocks.saml.constructedWith.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(started.authorizationUrl).toContain('SAMLRequest=example');
    expect(options).toMatchObject({
      validateInResponseTo: 'always',
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      rejectReplayedAssertions: true,
    });
    expect(completed.redirectUrl).toBe(
      `https://recovery.example.invalid/#directory_ticket=${completed.ticket}`,
    );
    await expect(service.readTicket(completed.ticket)).resolves.toMatchObject({
      email: 'backup.operator@vista.local',
      groups: ['CN=Backup Operators'],
      provider: 'saml',
    });
    await expect(
      service.completeSamlCallback('replayed-assertion', relayState),
    ).rejects.toMatchObject({
      status: 401,
    });
  });
});
