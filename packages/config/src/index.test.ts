import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './index';

const validEnvironment: NodeJS.ProcessEnv = {
  BUSINESS_TIMEZONE: 'Europe/Sofia',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
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
};

describe('parseEnvironment', () => {
  it('normalizes values and keeps optional capabilities disabled by default', () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.API_PORT).toBe(3000);
    expect(environment.API_RATE_LIMIT_MAX).toBe(120);
    expect(environment.API_RATE_LIMIT_PUBLIC_MAX).toBe(60);
    expect(environment.API_RATE_LIMIT_READ_MAX).toBe(240);
    expect(environment.API_RATE_LIMIT_SENSITIVE_MAX).toBe(20);
    expect(environment.API_RATE_LIMIT_STORE).toBe('memory');
    expect(environment.API_RATE_LIMIT_TTL_MS).toBe(60_000);
    expect(environment.API_RATE_LIMIT_WRITE_MAX).toBe(60);
    expect(environment.API_TRUST_PROXY_HOPS).toBe(0);
    expect(environment.AUTH_LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(environment.DEPENDENCY_HEALTH_TIMEOUT_MS).toBe(2_000);
    expect(environment.FEATURE_CUSTOMER_PORTAL).toBe(false);
    expect(environment.FEATURE_FIFO_COSTING).toBe(false);
    expect(environment.FILE_ALLOWED_MEDIA_TYPES).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(environment.FILE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(environment.IDEMPOTENCY_TTL_SECONDS).toBe(86_400);
    expect(environment.POS_FISCAL_SIMULATOR_ENABLED).toBe(false);
    expect(environment.SMS_PROVIDER).toBe('disabled');
    expect(environment.BACKUP_ALERT_SMS_RECIPIENTS).toBe('');
    expect(environment.BACKUP_REPLICA_REQUIRED).toBe(false);
    expect(environment.BACKUP_REPLICA_S3_ENDPOINT).toBe('');
    expect(environment.BACKUP_DATABASE_SOURCE_URLS_JSON).toEqual({});
    expect(environment.BACKUP_PRIMARY_DATABASE_SOURCE_CODE).toBe('VISTA-DB-01');
    expect(environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON).toEqual({});
    expect(environment.BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE).toBe('VISTA-FILES-01');
    expect(environment.BACKUP_WEBDAV_SOURCE_CONFIGS_JSON).toEqual({});
    expect(environment.VISTA_DEPLOYMENT_STAGE).toBe('local');
    expect(environment.JOB_DEFAULT_ATTEMPTS).toBe(5);
    expect(environment.JOB_QUEUE_NAME).toBe('platform');
    expect(environment.FINANCE_PAYMENT_REMINDER_LEAD_DAYS).toBe(7);
    expect(environment.FINANCE_PAYMENT_STATUS_CRON).toBe('0 25 1 * * *');
    expect(environment.CRM_SLA_EVALUATION_CRON).toBe('0 */5 * * * *');
    expect(environment.SALES_SUBSCRIPTION_INVOICE_CRON).toBe('0 15 1 * * *');
    expect(environment.SERVICE_INSPECTION_REMINDER_CRON).toBe('0 35 1 * * *');
    expect(environment.SERVICE_PLAN_VISIT_HORIZON_DAYS).toBe(90);
    expect(environment.SERVICE_PLAN_VISIT_CRON).toBe('0 45 1 * * *');
    expect(environment.SERVICE_WARRANTY_REMINDER_LEAD_DAYS).toBe(30);
    expect(environment.SERVICE_WARRANTY_REMINDER_CRON).toBe('0 40 1 * * *');
    expect(environment.PASSWORD_EXPIRY_DAYS).toBe(0);
    expect(environment.PASSWORD_HISTORY_COUNT).toBe(5);
    expect(environment.PASSWORD_MIN_LENGTH).toBe(12);
    expect(environment.REQUEST_LOGGING_ENABLED).toBe(true);
    expect(environment.SESSION_TTL_SECONDS).toBe(28_800);
    expect(environment.DIRECTORY_AUTH_PROVIDER).toBe('disabled');
    expect(environment.DIRECTORY_GROUP_ROLE_MAPPINGS_JSON).toEqual({});
    expect(environment.DIRECTORY_EMERGENCY_EMAILS).toEqual([]);
  });

  it('rejects an unsafe password-history depth', () => {
    expect(() => parseEnvironment({ ...validEnvironment, PASSWORD_HISTORY_COUNT: '0' })).toThrow(
      'PASSWORD_HISTORY_COUNT',
    );
  });

  it('requires complete Twilio credentials, sender and recipients before enabling SMS', () => {
    expect(() => parseEnvironment({ ...validEnvironment, SMS_PROVIDER: 'twilio' })).toThrow(
      'Invalid environment configuration',
    );
    const enabled = parseEnvironment({
      ...validEnvironment,
      BACKUP_ALERT_SMS_RECIPIENTS: '+359888123456',
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
      TWILIO_API_KEY_SECRET: 'twilio-test-key-secret',
      TWILIO_API_BASE_URL: 'https://api.twilio.com',
      TWILIO_MESSAGING_SERVICE_SID: `MG${'c'.repeat(32)}`,
    });
    expect(enabled.SMS_PROVIDER).toBe('twilio');
  });

  it('fails fast when required configuration is missing', () => {
    expect(() => parseEnvironment({})).toThrow('Invalid environment configuration');
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/vista' }),
    ).toThrow('DATABASE_URL must use the postgresql scheme');
  });

  it('validates directory provider setup and normalizes group mappings and emergency accounts', () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, DIRECTORY_AUTH_PROVIDER: 'ldap' }),
    ).toThrow('LDAP sign-in requires');

    const configured = parseEnvironment({
      ...validEnvironment,
      DIRECTORY_AUTH_PROVIDER: 'oidc',
      DIRECTORY_OIDC_ISSUER: 'https://login.example.invalid/tenant/v2.0',
      DIRECTORY_OIDC_CLIENT_ID: 'vista-client',
      DIRECTORY_OIDC_CLIENT_SECRET: 'not-a-real-secret',
      DIRECTORY_OIDC_CALLBACK_URL:
        'https://api.example.invalid/api/v1/auth/directory/oidc/callback',
      DIRECTORY_LOGIN_RETURN_URLS_JSON: JSON.stringify({
        operations: 'https://ops.example.invalid',
        pos: 'https://pos.example.invalid',
        recovery: 'https://recovery.example.invalid',
      }),
      DIRECTORY_GROUP_ROLE_MAPPINGS_JSON: '{" Finance Users ":["finance","viewer"]}',
      DIRECTORY_EMERGENCY_EMAILS: ' Local.Admin@Vista.local, emergency@vista.local ',
    });
    expect(configured.DIRECTORY_GROUP_ROLE_MAPPINGS_JSON).toEqual({
      'finance users': ['finance', 'viewer'],
    });
    expect(configured.DIRECTORY_EMERGENCY_EMAILS).toEqual([
      'local.admin@vista.local',
      'emergency@vista.local',
    ]);
    expect(configured.DIRECTORY_LOGIN_RETURN_URLS_JSON).toEqual({
      operations: 'https://ops.example.invalid',
      pos: 'https://pos.example.invalid',
      recovery: 'https://recovery.example.invalid',
    });
  });

  it('rejects directory role mappings to malformed role codes and untrusted return URLs', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DIRECTORY_GROUP_ROLE_MAPPINGS_JSON: '{"Finance":["*","administrator; DROP"]}',
      }),
    ).toThrow('DIRECTORY_GROUP_ROLE_MAPPINGS_JSON');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DIRECTORY_LOGIN_RETURN_URLS_JSON:
          '{"operations":"https://ops.example.invalid/?next=https://evil.invalid"}',
      }),
    ).toThrow('DIRECTORY_LOGIN_RETURN_URLS_JSON');
  });

  it('rejects ambiguous group mappings and invalid emergency-access identities', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DIRECTORY_GROUP_ROLE_MAPPINGS_JSON: '{"Finance":["finance"]," finance ":["viewer"]}',
      }),
    ).toThrow('DIRECTORY_GROUP_ROLE_MAPPINGS_JSON');
    expect(() =>
      parseEnvironment({ ...validEnvironment, DIRECTORY_EMERGENCY_EMAILS: 'not-an-email' }),
    ).toThrow('DIRECTORY_EMERGENCY_EMAILS');
  });

  it('rejects insecure and malformed organization-provider endpoints', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DIRECTORY_AUTH_PROVIDER: 'oidc',
        DIRECTORY_OIDC_ISSUER: 'not-a-url',
        DIRECTORY_OIDC_CLIENT_ID: 'vista-client',
        DIRECTORY_OIDC_CLIENT_SECRET: 'not-a-real-secret',
        DIRECTORY_OIDC_CALLBACK_URL: 'http://identity.example.invalid/callback',
        DIRECTORY_LOGIN_RETURN_URLS_JSON: '{"operations":"https://ops.example.invalid"}',
      }),
    ).toThrow('DIRECTORY_OIDC_ISSUER');
  });

  it('maps additional PostgreSQL, MySQL, and MariaDB sources without exposing credentials in errors', () => {
    const configured = parseEnvironment({
      ...validEnvironment,
      BACKUP_DATABASE_SOURCE_URLS_JSON:
        '{"REPORTING-DB":"postgresql://backup:private-secret@db.example.invalid/reporting","CRM-MYSQL":"mysql://backup:private-secret@mysql.example.invalid/crm?ssl-mode=VERIFY_IDENTITY&ssl-ca=%2Fetc%2Fssl%2Fca.pem","LEGACY-MARIA":"mariadb://backup:private-secret@maria.example.invalid/legacy"}',
      BACKUP_PRIMARY_DATABASE_SOURCE_CODE: 'primary-db',
      BACKUP_RESTORE_DATABASE_URL:
        'mariadb://restore:restore-secret@recovery.example.invalid/recovery',
    });
    expect(configured.BACKUP_DATABASE_SOURCE_URLS_JSON).toEqual({
      'REPORTING-DB': 'postgresql://backup:private-secret@db.example.invalid/reporting',
      'CRM-MYSQL':
        'mysql://backup:private-secret@mysql.example.invalid/crm?ssl-mode=VERIFY_IDENTITY&ssl-ca=%2Fetc%2Fssl%2Fca.pem',
      'LEGACY-MARIA': 'mariadb://backup:private-secret@maria.example.invalid/legacy',
    });
    expect(configured.BACKUP_PRIMARY_DATABASE_SOURCE_CODE).toBe('PRIMARY-DB');
    expect(configured.BACKUP_RESTORE_DATABASE_URL).toBe(
      'mariadb://restore:restore-secret@recovery.example.invalid/recovery',
    );

    for (const invalid of [
      '{invalid-secret-json',
      '{"BAD CODE":"postgresql://backup:private-secret@db.example.invalid/reporting"}',
      '{"REPORTING-DB":"sqlserver://backup:private-secret@db.example.invalid/reporting"}',
    ]) {
      try {
        parseEnvironment({ ...validEnvironment, BACKUP_DATABASE_SOURCE_URLS_JSON: invalid });
        throw new Error('Expected invalid connection configuration to be rejected');
      } catch (error) {
        expect(error).toHaveProperty('message');
        expect((error as Error).message).toContain('BACKUP_DATABASE_SOURCE_URLS_JSON');
        expect((error as Error).message).not.toContain('private-secret');
      }
    }
  });

  it('maps read-only IMAP backup sources by protected source code without exposing credentials', () => {
    const configured = parseEnvironment({
      ...validEnvironment,
      BACKUP_EMAIL_SOURCE_CONFIGS_JSON: JSON.stringify({
        'VISTA-MAIL-01': {
          host: 'mail.example.invalid',
          mailboxes: ['INBOX', 'Sent'],
          password: 'deployment-only-secret',
          port: 993,
          tlsMode: 'implicit',
          username: 'backup@example.invalid',
        },
      }),
    });
    expect(configured.BACKUP_EMAIL_SOURCE_CONFIGS_JSON['VISTA-MAIL-01']).toEqual({
      host: 'mail.example.invalid',
      mailboxes: ['INBOX', 'Sent'],
      password: 'deployment-only-secret',
      port: 993,
      tlsMode: 'implicit',
      username: 'backup@example.invalid',
    });

    for (const invalid of [
      '{invalid-secret-json',
      JSON.stringify({
        'VISTA-MAIL-01': {
          host: 'mail.example.invalid',
          mailboxes: ['INBOX', 'INBOX'],
          password: 'deployment-only-secret',
          port: 993,
          tlsMode: 'implicit',
          username: 'backup@example.invalid',
        },
      }),
      JSON.stringify({
        'VISTA-MAIL-01': {
          host: 'mail.example.invalid',
          mailboxes: ['INBOX'],
          password: 'deployment-only-secret',
          port: 993,
          tlsMode: 'cleartext',
          username: 'backup@example.invalid',
        },
      }),
    ]) {
      expect(() =>
        parseEnvironment({ ...validEnvironment, BACKUP_EMAIL_SOURCE_CONFIGS_JSON: invalid }),
      ).toThrow('BACKUP_EMAIL_SOURCE_CONFIGS_JSON');
    }
  });

  it('requires TLS for configured email backup sources outside local development', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        VISTA_DEPLOYMENT_STAGE: 'staging',
        BACKUP_EMAIL_SOURCE_CONFIGS_JSON: JSON.stringify({
          'VISTA-MAIL-01': {
            host: 'mail.example.invalid',
            mailboxes: ['INBOX'],
            password: 'deployment-only-secret',
            port: 143,
            tlsMode: 'none',
            username: 'backup@example.invalid',
          },
        }),
      }),
    ).toThrow('Email backup connections must use TLS outside local development.');
  });

  it('maps WebDAV cloud sources by protected source code without exposing credentials', () => {
    const configured = parseEnvironment({
      ...validEnvironment,
      BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: JSON.stringify({
        'CLOUD-DOCUMENTS': {
          endpoint: 'https://cloud.example.invalid/dav/users/vista/',
          password: 'deployment-only-secret',
          username: 'backup-reader',
        },
      }),
    });
    expect(configured.BACKUP_WEBDAV_SOURCE_CONFIGS_JSON['CLOUD-DOCUMENTS']).toEqual({
      endpoint: 'https://cloud.example.invalid/dav/users/vista/',
      password: 'deployment-only-secret',
      username: 'backup-reader',
    });

    for (const invalid of [
      '{invalid-secret-json',
      JSON.stringify({
        'CLOUD-DOCUMENTS': {
          endpoint: 'https://user:secret@cloud.example.invalid/dav/',
          password: 'deployment-only-secret',
          username: 'backup-reader',
        },
      }),
      JSON.stringify({
        'CLOUD-DOCUMENTS': {
          endpoint: 'file:///etc/',
          password: 'deployment-only-secret',
          username: 'backup-reader',
        },
      }),
    ]) {
      expect(() =>
        parseEnvironment({ ...validEnvironment, BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: invalid }),
      ).toThrow('BACKUP_WEBDAV_SOURCE_CONFIGS_JSON');
    }
  });

  it('requires HTTPS for configured WebDAV sources outside local development', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        VISTA_DEPLOYMENT_STAGE: 'staging',
        BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: JSON.stringify({
          'CLOUD-DOCUMENTS': {
            endpoint: 'http://cloud.example.invalid/dav/',
            password: 'deployment-only-secret',
            username: 'backup-reader',
          },
        }),
      }),
    ).toThrow('WebDAV backup connections must use HTTPS outside local development.');
  });

  it('maps read-only S3-compatible backup sources by protected source code', () => {
    const configured = parseEnvironment({
      ...validEnvironment,
      BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: JSON.stringify({
        'CUSTOM-DOCS': {
          accessKeyId: 'read-only-access',
          bucket: 'vista-customer-documents',
          endpoint: 'https://s3.example.invalid',
          forcePathStyle: false,
          region: 'eu-central-1',
          secretAccessKey: 'deployment-secret-only',
        },
      }),
    });
    expect(configured.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON).toEqual({
      'CUSTOM-DOCS': {
        accessKeyId: 'read-only-access',
        bucket: 'vista-customer-documents',
        endpoint: 'https://s3.example.invalid',
        forcePathStyle: false,
        region: 'eu-central-1',
        secretAccessKey: 'deployment-secret-only',
      },
    });
  });

  it.each([
    '{invalid-secret-json',
    JSON.stringify({
      INVALID: {
        accessKeyId: 'access',
        bucket: 'bad',
        endpoint: 'file:///tmp',
        secretAccessKey: 'secret',
      },
    }),
    JSON.stringify({
      INVALID: {
        accessKeyId: 'access',
        bucket: 'Bad_bucket',
        endpoint: 'https://s3.example.invalid',
        secretAccessKey: 'secret',
      },
    }),
    JSON.stringify({
      INVALID: {
        accessKeyId: 'access',
        bucket: 'vista-docs',
        endpoint: 'https://user:secret@s3.example.invalid',
        secretAccessKey: 'secret',
      },
    }),
  ])('rejects malformed or unsafe S3 backup source configuration', (value) => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: value }),
    ).toThrow('BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON');
  });

  it.each(['staging', 'production'] as const)(
    'requires HTTPS for configured external object storage in %s',
    (stage) => {
      expect(() =>
        parseEnvironment({
          ...validEnvironment,
          VISTA_DEPLOYMENT_STAGE: stage,
          BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: JSON.stringify({
            'CUSTOM-DOCS': {
              accessKeyId: 'read-only-access',
              bucket: 'vista-customer-documents',
              endpoint: 'http://s3.example.invalid',
              region: 'eu-central-1',
              secretAccessKey: 'deployment-secret-only',
            },
          }),
        }),
      ).toThrow('Staging and production object-storage backup sources must use HTTPS');
    },
  );

  it('rejects unsafe or unbounded operational settings', () => {
    expect(() => parseEnvironment({ ...validEnvironment, API_RATE_LIMIT_MAX: '0' })).toThrow(
      'API_RATE_LIMIT_MAX',
    );
    expect(() => parseEnvironment({ ...validEnvironment, API_TRUST_PROXY_HOPS: '11' })).toThrow(
      'API_TRUST_PROXY_HOPS',
    );
    expect(() => parseEnvironment({ ...validEnvironment, JOB_DEFAULT_ATTEMPTS: '21' })).toThrow(
      'JOB_DEFAULT_ATTEMPTS',
    );
    expect(() => parseEnvironment({ ...validEnvironment, PASSWORD_MIN_LENGTH: '7' })).toThrow(
      'PASSWORD_MIN_LENGTH',
    );
    expect(() =>
      parseEnvironment({ ...validEnvironment, FILE_ALLOWED_MEDIA_TYPES: 'text/plain' }),
    ).toThrow('FILE_ALLOWED_MEDIA_TYPES');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        FILE_UPLOAD_MAX_BYTES: String(25 * 1024 * 1024 + 1),
      }),
    ).toThrow('FILE_UPLOAD_MAX_BYTES');
    expect(() =>
      parseEnvironment({ ...validEnvironment, FINANCE_PAYMENT_REMINDER_LEAD_DAYS: '91' }),
    ).toThrow('FINANCE_PAYMENT_REMINDER_LEAD_DAYS');
  });

  it('requires the distributed Redis limiter in production', () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        API_RATE_LIMIT_STORE: 'memory',
        NODE_ENV: 'production',
      }),
    ).toThrow('Production deployments must use the Redis rate-limit store');
    expect(
      parseEnvironment({
        ...validEnvironment,
        API_RATE_LIMIT_STORE: 'redis',
        NODE_ENV: 'production',
      }).API_RATE_LIMIT_STORE,
    ).toBe('redis');
  });

  it('allows the fiscal simulator flag only in staging', () => {
    expect(
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        API_RATE_LIMIT_STORE: 'redis',
        POS_FISCAL_SIMULATOR_ENABLED: 'true',
        VISTA_DEPLOYMENT_STAGE: 'staging',
      }).POS_FISCAL_SIMULATOR_ENABLED,
    ).toBe(true);
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        POS_FISCAL_SIMULATOR_ENABLED: 'true',
        VISTA_DEPLOYMENT_STAGE: 'production',
      }),
    ).toThrow('POS_FISCAL_SIMULATOR_ENABLED');
  });

  it('accepts an independent copy target only with distinct endpoint, bucket, and credentials', () => {
    const target = {
      BACKUP_REPLICA_REQUIRED: 'true',
      BACKUP_REPLICA_S3_ACCESS_KEY_ID: 'vault-writer',
      BACKUP_REPLICA_S3_BUCKET: 'vista-independent-backups',
      BACKUP_REPLICA_S3_ENDPOINT: 'https://vault.example.invalid',
      BACKUP_REPLICA_S3_SECRET_ACCESS_KEY: 'separate-vault-secret',
    };
    expect(parseEnvironment({ ...validEnvironment, ...target }).BACKUP_REPLICA_REQUIRED).toBe(true);

    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        ...target,
        BACKUP_REPLICA_S3_ENDPOINT: validEnvironment.S3_ENDPOINT,
      }),
    ).toThrow('different endpoint');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        ...target,
        BACKUP_REPLICA_S3_ENDPOINT: 'http://localhost:9100',
      }),
    ).toThrow('different endpoint');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        ...target,
        BACKUP_REPLICA_S3_BUCKET: 'vista-backups',
      }),
    ).toThrow('different bucket');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        ...target,
        BACKUP_REPLICA_S3_ACCESS_KEY_ID: validEnvironment.S3_ACCESS_KEY_ID,
      }),
    ).toThrow('credentials separate');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        BACKUP_REPLICA_REQUIRED: 'true',
      }),
    ).toThrow('complete secondary storage target');
  });

  it('requires an HTTPS independent backup target for production deployment', () => {
    const production = {
      ...validEnvironment,
      API_RATE_LIMIT_STORE: 'redis',
      BACKUP_REPLICA_S3_ACCESS_KEY_ID: 'vault-writer',
      BACKUP_REPLICA_S3_BUCKET: 'vista-independent-backups',
      BACKUP_REPLICA_S3_ENDPOINT: 'https://vault.example.invalid',
      BACKUP_REPLICA_S3_SECRET_ACCESS_KEY: 'separate-vault-secret',
      NODE_ENV: 'production',
      VISTA_DEPLOYMENT_STAGE: 'production',
    };
    expect(parseEnvironment(production).BACKUP_REPLICA_S3_ENDPOINT).toBe(
      'https://vault.example.invalid',
    );
    expect(() =>
      parseEnvironment({
        ...production,
        BACKUP_REPLICA_S3_ENDPOINT: 'http://vault.example.invalid',
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        API_RATE_LIMIT_STORE: 'redis',
        NODE_ENV: 'production',
        VISTA_DEPLOYMENT_STAGE: 'production',
      }),
    ).toThrow('separately configured independent backup copy target');
  });
});
