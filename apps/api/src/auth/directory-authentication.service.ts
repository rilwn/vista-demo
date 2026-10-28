import { createHash, randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { Client as LdapClient } from 'ldapts';
import * as oidc from 'openid-client';
import {
  SAML,
  ValidateInResponseTo,
  type CacheItem,
  type CacheProvider,
  type Profile,
} from '@node-saml/node-saml';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { RedisService } from '../database/redis.service.js';

export type DirectoryProvider = 'ldap' | 'oidc' | 'saml';
export type DirectoryApplication = 'operations' | 'pos' | 'recovery';

export interface DirectoryIdentity {
  displayName?: string;
  email: string;
  groups: string[];
  provider: DirectoryProvider;
}

class RedisSamlCacheProvider implements CacheProvider {
  constructor(private readonly redisService: RedisService) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const redis = await this.redisService.ensureConnected();
    const createdAt = Date.now();
    const saved = await redis.set(this.key(key), value, 'EX', 300, 'NX');
    return saved === 'OK' ? { value, createdAt } : null;
  }

  async getAsync(key: string): Promise<string | null> {
    return (await this.redisService.ensureConnected()).get(this.key(key));
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    return this.consumeAsync(key);
  }

  async consumeAsync(key: string): Promise<string | null> {
    const redis = await this.redisService.ensureConnected();
    const result = await redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      this.key(key),
    );
    return typeof result === 'string' ? result : null;
  }

  async saveIfAbsentAsync(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    const redis = await this.redisService.ensureConnected();
    return (await redis.set(this.key(key), value, 'PXAT', expiresAtMs, 'NX')) === 'OK';
  }

  private key(key: string): string {
    return `vista:directory:saml:${createHash('sha256').update(key).digest('hex')}`;
  }
}

interface AuthorizationState {
  app: DirectoryApplication;
  codeVerifier?: string;
  nonce?: string;
  provider: 'oidc' | 'saml';
  state: string;
}

interface DirectoryLoginTicket {
  identity: DirectoryIdentity;
}

@Injectable()
export class DirectoryAuthenticationService {
  private readonly samlCache: CacheProvider;
  private readonly saml: SAML | undefined;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(RedisService) private readonly redisService: RedisService,
  ) {
    this.samlCache = new RedisSamlCacheProvider(redisService);
    if (environment.DIRECTORY_AUTH_PROVIDER === 'saml') {
      this.saml = new SAML({
        callbackUrl: environment.DIRECTORY_SAML_CALLBACK_URL,
        entryPoint: environment.DIRECTORY_SAML_ENTRY_POINT,
        issuer: environment.DIRECTORY_SAML_ISSUER,
        idpCert: environment.DIRECTORY_SAML_IDP_CERTIFICATE,
        validateInResponseTo: ValidateInResponseTo.always,
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: true,
        rejectReplayedAssertions: true,
        cacheProvider: this.samlCache,
        requestIdExpirationPeriodMs: 300_000,
      });
    }
  }

  options(): {
    enabled: boolean;
    emergencyAccessAvailable: boolean;
    method: DirectoryProvider | null;
  } {
    const provider = this.environment.DIRECTORY_AUTH_PROVIDER;
    return {
      enabled: provider !== 'disabled',
      emergencyAccessAvailable:
        provider !== 'disabled' && this.environment.DIRECTORY_EMERGENCY_EMAILS.length > 0,
      method: provider === 'disabled' ? null : provider,
    };
  }

  async authenticatePassword(
    email: string,
    password: string,
  ): Promise<DirectoryIdentity | undefined> {
    if (this.environment.DIRECTORY_AUTH_PROVIDER !== 'ldap') return undefined;
    const normalizedEmail = email.trim().toLowerCase();
    const url = this.environment.DIRECTORY_LDAP_URL;
    const service = new LdapClient({ url, timeout: 8_000, connectTimeout: 5_000 });
    let userDn: string | undefined;
    let userAttributes: Record<string, unknown> | undefined;
    try {
      await service.bind(
        this.environment.DIRECTORY_LDAP_BIND_DN,
        this.environment.DIRECTORY_LDAP_BIND_PASSWORD,
      );
      const filter = this.environment.DIRECTORY_LDAP_USER_FILTER.replace(
        /\{email\}/gu,
        escapeLdapFilterValue(normalizedEmail),
      );
      const { searchEntries } = await service.search(this.environment.DIRECTORY_LDAP_BASE_DN, {
        attributes: [
          this.environment.DIRECTORY_LDAP_EMAIL_ATTRIBUTE,
          this.environment.DIRECTORY_LDAP_DISPLAY_NAME_ATTRIBUTE,
          this.environment.DIRECTORY_LDAP_GROUP_ATTRIBUTE,
        ],
        scope: 'sub',
        filter,
        sizeLimit: 2,
        timeLimit: 5,
      });
      if (searchEntries.length !== 1) return undefined;
      const entry = searchEntries.at(0);
      if (!entry) return undefined;
      userDn = typeof entry.dn === 'string' ? entry.dn : undefined;
      userAttributes = entry;
    } catch (error) {
      if (isInvalidCredentials(error)) return undefined;
      throw directoryUnavailable();
    } finally {
      await service.unbind().catch(() => undefined);
    }
    if (!userDn || !userAttributes) return undefined;

    const user = new LdapClient({ url, timeout: 8_000, connectTimeout: 5_000 });
    try {
      await user.bind(userDn, password);
    } catch (error) {
      if (isInvalidCredentials(error)) return undefined;
      throw directoryUnavailable();
    } finally {
      await user.unbind().catch(() => undefined);
    }

    const verifiedEmail = firstText(
      userAttributes[this.environment.DIRECTORY_LDAP_EMAIL_ATTRIBUTE],
    );
    if (!verifiedEmail || verifiedEmail.trim().toLowerCase() !== normalizedEmail) return undefined;
    const displayName = firstText(
      userAttributes[this.environment.DIRECTORY_LDAP_DISPLAY_NAME_ATTRIBUTE],
    );
    return {
      email: normalizedEmail,
      provider: 'ldap',
      groups: values(userAttributes[this.environment.DIRECTORY_LDAP_GROUP_ATTRIBUTE]),
      ...(displayName ? { displayName } : {}),
    };
  }

  async startLogin(app: DirectoryApplication): Promise<{ authorizationUrl: string }> {
    const provider = this.environment.DIRECTORY_AUTH_PROVIDER;
    if (provider !== 'oidc' && provider !== 'saml') throw directoryNotConfigured();
    if (!this.environment.DIRECTORY_LOGIN_RETURN_URLS_JSON[app]) throw directoryNotConfigured();
    const redis = await this.redisService.ensureConnected();
    const state = randomBytes(32).toString('base64url');

    if (provider === 'oidc') {
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const nonce = oidc.randomNonce();
      const config = await this.oidcConfiguration();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const authorizationUrl = oidc.buildAuthorizationUrl(config, {
        redirect_uri: this.environment.DIRECTORY_OIDC_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      await redis.set(
        stateKey(state),
        JSON.stringify({ app, codeVerifier, nonce, provider, state } satisfies AuthorizationState),
        'EX',
        300,
        'NX',
      );
      return { authorizationUrl: authorizationUrl.href };
    }

    const saml = this.saml;
    if (!saml) throw directoryNotConfigured();
    await redis.set(
      stateKey(state),
      JSON.stringify({ app, provider, state } satisfies AuthorizationState),
      'EX',
      300,
      'NX',
    );
    return { authorizationUrl: await saml.getAuthorizeUrlAsync(state, undefined) };
  }

  async completeOidcCallback(callbackUrl: URL): Promise<{ redirectUrl: string; ticket: string }> {
    if (this.environment.DIRECTORY_AUTH_PROVIDER !== 'oidc') throw directoryNotConfigured();
    const state = callbackUrl.searchParams.get('state') ?? '';
    const authState = await this.consumeState(state, 'oidc');
    try {
      const config = await this.oidcConfiguration();
      if (!authState.codeVerifier || !authState.nonce) throw identityRejected();
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        expectedState: authState.state,
        expectedNonce: authState.nonce,
        pkceCodeVerifier: authState.codeVerifier,
      });
      const claims = tokens.claims();
      if (!claims) throw identityRejected();
      const email = claimText(claims[this.environment.DIRECTORY_OIDC_EMAIL_CLAIM]);
      const verified = claims['email_verified'];
      if (!email || verified !== true) throw identityRejected();
      const groups = values(claims[this.environment.DIRECTORY_OIDC_GROUPS_CLAIM]);
      return this.createLoginTicket(authState.app, {
        email: email.trim().toLowerCase(),
        groups,
        provider: 'oidc',
        ...(claimText(claims['name']) ? { displayName: claimText(claims['name'])! } : {}),
      });
    } catch (error) {
      if (error instanceof ApiErrorException) throw error;
      throw identityRejected();
    }
  }

  async completeSamlCallback(
    samlResponse: string,
    relayState: string,
  ): Promise<{ redirectUrl: string; ticket: string }> {
    if (this.environment.DIRECTORY_AUTH_PROVIDER !== 'saml' || !this.saml)
      throw directoryNotConfigured();
    const authState = await this.consumeState(relayState, 'saml');
    try {
      const result = await this.saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      const profile = result.profile;
      if (!profile || result.loggedOut) throw identityRejected();
      const email = samlAttribute(profile, this.environment.DIRECTORY_SAML_EMAIL_ATTRIBUTE);
      if (!firstText(email)) throw identityRejected();
      return this.createLoginTicket(authState.app, {
        email: firstText(email)!.toLowerCase(),
        groups: values(samlAttribute(profile, this.environment.DIRECTORY_SAML_GROUPS_ATTRIBUTE)),
        provider: 'saml',
        ...(firstText(samlAttribute(profile, 'displayName'))
          ? { displayName: firstText(samlAttribute(profile, 'displayName'))! }
          : {}),
      });
    } catch {
      throw identityRejected();
    }
  }

  samlMetadata(): string {
    if (!this.saml) throw directoryNotConfigured();
    return this.saml.generateServiceProviderMetadata(null);
  }

  async readTicket(ticket: string): Promise<DirectoryIdentity> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(ticket)) throw identityRejected();
    const raw = await (await this.redisService.ensureConnected()).get(ticketKey(ticket));
    if (!raw) throw identityRejected();
    try {
      return (JSON.parse(raw) as DirectoryLoginTicket).identity;
    } catch {
      throw identityRejected();
    }
  }

  async claimTicket(ticket: string): Promise<string | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(ticket)) return undefined;
    const redis = await this.redisService.ensureConnected();
    const claim = randomBytes(18).toString('base64url');
    const result = await redis.set(ticketClaimKey(ticket), claim, 'EX', 20, 'NX');
    return result === 'OK' ? claim : undefined;
  }

  async finishTicket(ticket: string, claim: string, consume: boolean): Promise<void> {
    const redis = await this.redisService.ensureConnected();
    const script = consume
      ? "if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[1]); redis.call('DEL', KEYS[2]); return 1 end; return 0"
      : "if redis.call('GET', KEYS[2]) == ARGV[1] then return redis.call('DEL', KEYS[2]) end; return 0";
    await redis.eval(script, 2, ticketKey(ticket), ticketClaimKey(ticket), claim);
  }

  async createLoginTicket(
    app: DirectoryApplication,
    identity: DirectoryIdentity,
  ): Promise<{ redirectUrl: string; ticket: string }> {
    const origin = this.environment.DIRECTORY_LOGIN_RETURN_URLS_JSON[app];
    if (!origin) throw directoryNotConfigured();
    const ticket = randomBytes(32).toString('base64url');
    await (
      await this.redisService.ensureConnected()
    ).set(
      ticketKey(ticket),
      JSON.stringify({ identity } satisfies DirectoryLoginTicket),
      'EX',
      180,
      'NX',
    );
    return { redirectUrl: `${origin}/#directory_ticket=${encodeURIComponent(ticket)}`, ticket };
  }

  async consumeState(state: string, provider: 'oidc' | 'saml'): Promise<AuthorizationState> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(state)) throw identityRejected();
    const redis = await this.redisService.ensureConnected();
    const serialized = await redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      stateKey(state),
    );
    if (typeof serialized !== 'string') throw identityRejected();
    try {
      const parsed = JSON.parse(serialized) as AuthorizationState;
      if (parsed.state !== state || parsed.provider !== provider) throw identityRejected();
      return parsed;
    } catch {
      throw identityRejected();
    }
  }

  private async oidcConfiguration(): Promise<oidc.Configuration> {
    try {
      return await oidc.discovery(
        new URL(this.environment.DIRECTORY_OIDC_ISSUER),
        this.environment.DIRECTORY_OIDC_CLIENT_ID,
        this.environment.DIRECTORY_OIDC_CLIENT_SECRET,
      );
    } catch {
      throw directoryUnavailable();
    }
  }
}

export function mapDirectoryGroupsToRoleCodes(
  groups: string[],
  mappings: Record<string, string[]>,
): string[] {
  const normalizedMappings = new Map(
    Object.entries(mappings).map(([group, roles]) => [group.trim().toLowerCase(), roles]),
  );
  return [
    ...new Set(groups.flatMap((group) => normalizedMappings.get(group.trim().toLowerCase()) ?? [])),
  ];
}

export function escapeLdapFilterValue(value: string): string {
  return value
    .replace(/[\\*()]/gu, (character) => {
      switch (character) {
        case '\\':
          return '\\5c';
        case '*':
          return '\\2a';
        case '(':
          return '\\28';
        case ')':
          return '\\29';
        default:
          return character;
      }
    })
    .replaceAll('\u0000', '\\00');
}

function samlAttribute(profile: Profile, key: string): string | string[] | undefined {
  const value = (profile as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' || Array.isArray(value)
    ? (value as string | string[])
    : undefined;
}

function firstText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value))
    return value
      .find((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      ?.trim();
  return undefined;
}

function values(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [
    ...new Set(
      source
        .filter(
          (item): item is string =>
            typeof item === 'string' && Boolean(item.trim()) && item.length <= 512,
        )
        .slice(0, 500)
        .map((item) => item.trim()),
    ),
  ];
}

function claimText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stateKey(state: string): string {
  return `vista:directory:state:${createHash('sha256').update(state).digest('hex')}`;
}

function ticketKey(ticket: string): string {
  return `vista:directory:ticket:${createHash('sha256').update(ticket).digest('hex')}`;
}

function ticketClaimKey(ticket: string): string {
  return `${ticketKey(ticket)}:claim`;
}

function isInvalidCredentials(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate?.code === 49 ||
    candidate?.code === '49' ||
    candidate?.name === 'InvalidCredentialsError'
  );
}

function directoryUnavailable(): ApiErrorException {
  return new ApiErrorException(
    'DIRECTORY_UNAVAILABLE',
    'Organization sign-in is temporarily unavailable. Try again shortly.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function directoryNotConfigured(): ApiErrorException {
  return new ApiErrorException(
    'DIRECTORY_SIGN_IN_UNAVAILABLE',
    'Organization sign-in is not configured for this application.',
    HttpStatus.NOT_FOUND,
  );
}

function identityRejected(): ApiErrorException {
  return new ApiErrorException(
    'DIRECTORY_SIGN_IN_FAILED',
    'Organization sign-in could not be verified. Try again or contact your administrator.',
    HttpStatus.UNAUTHORIZED,
  );
}
