import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z
  .object({
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    API_PREFIX: z.string().min(1).default('api/v1'),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    API_RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(60),
    API_RATE_LIMIT_READ_MAX: z.coerce.number().int().positive().default(240),
    API_RATE_LIMIT_REDIS_PREFIX: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9:_-]+$/)
      .default('vista:rate-limit'),
    API_RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().positive().default(20),
    API_RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
    API_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    API_RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),
    API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    BACKUP_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^(?:[a-fA-F0-9]{64})?$/,
        'BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters',
      )
      .default(''),
    BACKUP_DATABASE_SOURCE_URLS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseBackupDatabaseSourceUrls(value, context)),
    BACKUP_PRIMARY_DATABASE_SOURCE_CODE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,80}$/u)
      .default('VISTA-DB-01')
      .transform((value) => value.toUpperCase()),
    BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseBackupObjectStorageSourceConfigs(value, context)),
    BACKUP_EMAIL_SOURCE_CONFIGS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseBackupEmailSourceConfigs(value, context)),
    BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseBackupWebDavSourceConfigs(value, context)),
    BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,80}$/u)
      .default('VISTA-FILES-01')
      .transform((value) => value.toUpperCase()),
    BACKUP_FILE_SOURCE_ROOT: z.string().default(''),
    BACKUP_REPLICA_REQUIRED: booleanString.default(false),
    BACKUP_REPLICA_S3_ACCESS_KEY_ID: z.string().default(''),
    BACKUP_REPLICA_S3_BUCKET: z.string().default(''),
    BACKUP_REPLICA_S3_ENDPOINT: z.string().default(''),
    BACKUP_REPLICA_S3_FORCE_PATH_STYLE: booleanString.default(true),
    BACKUP_REPLICA_S3_REGION: z.string().default('us-east-1'),
    BACKUP_REPLICA_S3_SECRET_ACCESS_KEY: z.string().default(''),
    BACKUP_REPLICA_TARGET_CODE: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/u)
      .default('independent-vault'),
    BACKUP_S3_BUCKET: z.string().min(3).default('vista-backups'),
    BACKUP_DISPATCH_CRON: z.string().min(1).default('0 * * * * *'),
    BACKUP_ALERT_SMS_RECIPIENTS: z.string().default(''),
    BACKUP_RESTORE_DATABASE_URL: z
      .string()
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ['postgres:', 'postgresql:', 'mysql:', 'mysql2:', 'mariadb:'].includes(url.protocol) &&
            Boolean(url.hostname) &&
            url.pathname.length > 1
          );
        } catch {
          return false;
        }
      }, 'BACKUP_RESTORE_DATABASE_URL must be a PostgreSQL, MySQL, or MariaDB URL with a host and database name')
      .default(''),
    AUTH_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    AUTH_LOGIN_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
    ACCOUNT_RECOVERY_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
    BUSINESS_TIMEZONE: z.string().min(1),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim())),
    DATABASE_URL: z.url().refine((value) => value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must use the postgresql scheme',
    }),
    DEPENDENCY_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
    DIRECTORY_AUTH_PROVIDER: z.enum(['disabled', 'ldap', 'oidc', 'saml']).default('disabled'),
    DIRECTORY_EMERGENCY_EMAILS: z
      .string()
      .default('')
      .transform((value, context) => {
        const emails = [
          ...new Set(
            value
              .split(',')
              .map((entry) => entry.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
        if (emails.some((email) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/u.test(email))) {
          context.addIssue({
            code: 'custom',
            message:
              'DIRECTORY_EMERGENCY_EMAILS must be a comma-separated list of valid email addresses.',
          });
          return z.NEVER;
        }
        return emails;
      }),
    DIRECTORY_GROUP_ROLE_MAPPINGS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseDirectoryGroupRoleMappings(value, context)),
    DIRECTORY_LDAP_URL: z.string().default(''),
    DIRECTORY_LDAP_BASE_DN: z.string().default(''),
    DIRECTORY_LDAP_BIND_DN: z.string().default(''),
    DIRECTORY_LDAP_BIND_PASSWORD: z.string().default(''),
    DIRECTORY_LDAP_USER_FILTER: z.string().default('(&(objectClass=person)(mail={email}))'),
    DIRECTORY_LDAP_EMAIL_ATTRIBUTE: z.string().min(1).default('mail'),
    DIRECTORY_LDAP_DISPLAY_NAME_ATTRIBUTE: z.string().min(1).default('displayName'),
    DIRECTORY_LDAP_GROUP_ATTRIBUTE: z.string().min(1).default('memberOf'),
    DIRECTORY_OIDC_ISSUER: z.string().default(''),
    DIRECTORY_OIDC_CLIENT_ID: z.string().default(''),
    DIRECTORY_OIDC_CLIENT_SECRET: z.string().default(''),
    DIRECTORY_OIDC_CALLBACK_URL: z.string().default(''),
    DIRECTORY_OIDC_EMAIL_CLAIM: z.string().min(1).default('email'),
    DIRECTORY_OIDC_GROUPS_CLAIM: z.string().min(1).default('groups'),
    DIRECTORY_SAML_ENTRY_POINT: z.string().default(''),
    DIRECTORY_SAML_ISSUER: z.string().default(''),
    DIRECTORY_SAML_CALLBACK_URL: z.string().default(''),
    DIRECTORY_SAML_IDP_CERTIFICATE: z.string().default(''),
    DIRECTORY_SAML_EMAIL_ATTRIBUTE: z.string().min(1).default('email'),
    DIRECTORY_SAML_GROUPS_ATTRIBUTE: z.string().min(1).default('groups'),
    DIRECTORY_LOGIN_RETURN_URLS_JSON: z
      .string()
      .default('{}')
      .transform((value, context) => parseDirectoryReturnUrls(value, context)),
    FEATURE_BACKUP_EMERGENCY_ACCESS: booleanString.default(false),
    FEATURE_CUSTOMER_PORTAL: booleanString.default(false),
    FEATURE_ECOMMERCE_FISCALIZATION: booleanString.default(false),
    FEATURE_ELECTRONIC_SHELF_LABELS: booleanString.default(false),
    FEATURE_FIFO_COSTING: booleanString.default(false),
    FEATURE_POS_KIOSK: booleanString.default(false),
    POS_FISCAL_SIMULATOR_ENABLED: booleanString.default(false),
    FILE_ALLOWED_MEDIA_TYPES: z
      .string()
      .min(1)
      .default('application/pdf,image/jpeg,image/png,image/webp')
      .transform((value) => value.split(',').map((entry) => entry.trim().toLowerCase()))
      .refine(
        (values) =>
          values.length > 0 &&
          values.every((value) =>
            ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(value),
          ),
        'Only the currently inspected PDF, JPEG, PNG, and WebP media types are supported',
      ),
    FILE_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    FINANCE_PAYMENT_REMINDER_LEAD_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    FINANCE_OFFICIAL_NUMBER_BLOCK_SIZE: z.coerce.number().int().min(1).max(1_000_000).default(1000),
    CRM_SLA_EVALUATION_CRON: z.string().min(1).default('0 */5 * * * *'),
    LOGISTICS_ECONT_BASE_URL: z.url().default('https://demo.econt.com/ee/services'),
    LOGISTICS_ECONT_PASSWORD: z.string().default(''),
    LOGISTICS_ECONT_SENDER_NAME: z.string().default(''),
    LOGISTICS_ECONT_SENDER_OFFICE_CODE: z.string().default(''),
    LOGISTICS_ECONT_SENDER_PHONE: z.string().default(''),
    LOGISTICS_ECONT_USERNAME: z.string().default(''),
    LOGISTICS_SPEEDY_BASE_URL: z.url().default('https://api.speedy.bg/v1'),
    LOGISTICS_SPEEDY_PASSWORD: z.string().default(''),
    LOGISTICS_SPEEDY_SERVICE_ID: z.string().default(''),
    LOGISTICS_SPEEDY_USERNAME: z.string().default(''),
    FINANCE_PAYMENT_STATUS_CRON: z.string().min(1).default('0 25 1 * * *'),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    INTEGRATION_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(100),
    INTEGRATION_OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
    INTEGRATION_OUTBOX_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    JOB_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(1_000),
    JOB_DEFAULT_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),
    JOB_QUEUE_NAME: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .default('platform'),
    JOB_QUEUE_PREFIX: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .default('vista'),
    SALES_SUBSCRIPTION_INVOICE_CRON: z.string().min(1).default('0 15 1 * * *'),
    SERVICE_INSPECTION_REMINDER_CRON: z.string().min(1).default('0 35 1 * * *'),
    SERVICE_PLAN_VISIT_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    SERVICE_PLAN_VISIT_CRON: z.string().min(1).default('0 45 1 * * *'),
    SERVICE_WARRANTY_REMINDER_LEAD_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SERVICE_WARRANTY_REMINDER_CRON: z.string().min(1).default('0 40 1 * * *'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NOTIFICATION_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
    NOTIFICATION_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    PASSWORD_EXPIRY_DAYS: z.coerce.number().int().nonnegative().default(0),
    PASSWORD_HISTORY_COUNT: z.coerce.number().int().min(1).max(24).default(5),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(12),
    PASSWORD_REQUIRE_LOWERCASE: booleanString.default(true),
    PASSWORD_REQUIRE_NUMBER: booleanString.default(true),
    PASSWORD_REQUIRE_SYMBOL: booleanString.default(true),
    PASSWORD_REQUIRE_UPPERCASE: booleanString.default(true),
    REQUEST_LOGGING_ENABLED: booleanString.default(true),
    REDIS_URL: z.url().refine((value) => value.startsWith('redis://'), {
      message: 'REDIS_URL must use the redis scheme',
    }),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ENDPOINT: z.url(),
    S3_FORCE_PATH_STYLE: booleanString.default(true),
    S3_REGION: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
    SESSION_SECRET: z.string().min(32),
    SMTP_FROM: z.email(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive().max(65_535),
    SMTP_TLS_MODE: z.enum(['none', 'starttls', 'implicit']).default('none'),
    SMTP_USERNAME: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    SMS_PROVIDER: z.enum(['disabled', 'twilio']).default('disabled'),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_API_KEY_SID: z.string().default(''),
    TWILIO_API_KEY_SECRET: z.string().default(''),
    TWILIO_API_BASE_URL: z.url().default('https://api.twilio.com'),
    TWILIO_FROM_NUMBER: z.string().default(''),
    TWILIO_MESSAGING_SERVICE_SID: z.string().default(''),
    TOTP_ENCRYPTION_KEY: z.string().min(32),
    TOTP_ENROLLMENT_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    TOTP_ISSUER: z.string().min(1).default('Vista Service'),
    TOTP_WINDOW_STEPS: z.coerce.number().int().min(0).max(2).default(1),
    VISTA_DEPLOYMENT_STAGE: z.enum(['local', 'staging', 'production']).default('local'),
  })
  .superRefine((environment, context) => {
    if (environment.DIRECTORY_AUTH_PROVIDER === 'ldap') {
      if (
        !environment.DIRECTORY_LDAP_URL ||
        !environment.DIRECTORY_LDAP_BASE_DN ||
        !environment.DIRECTORY_LDAP_BIND_DN ||
        !environment.DIRECTORY_LDAP_BIND_PASSWORD ||
        !environment.DIRECTORY_LDAP_USER_FILTER.includes('{email}')
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'LDAP sign-in requires its URL, search base, service bind credentials, and a user filter containing {email}',
          path: ['DIRECTORY_LDAP_URL'],
        });
      }
      let ldapUrl: URL | undefined;
      try {
        ldapUrl = new URL(environment.DIRECTORY_LDAP_URL);
      } catch {
        // The URL issue is reported with the protocol validation below.
      }
      if (!ldapUrl || !['ldap:', 'ldaps:'].includes(ldapUrl.protocol)) {
        context.addIssue({
          code: 'custom',
          message: 'LDAP sign-in URL must use ldap:// or ldaps://',
          path: ['DIRECTORY_LDAP_URL'],
        });
      }
      if (environment.NODE_ENV === 'production' && ldapUrl?.protocol !== 'ldaps:') {
        context.addIssue({
          code: 'custom',
          message: 'Production directory sign-in requires LDAPS',
          path: ['DIRECTORY_LDAP_URL'],
        });
      }
    }
    if (environment.DIRECTORY_AUTH_PROVIDER === 'oidc') {
      if (
        !environment.DIRECTORY_OIDC_ISSUER ||
        !environment.DIRECTORY_OIDC_CLIENT_ID ||
        !environment.DIRECTORY_OIDC_CLIENT_SECRET ||
        !environment.DIRECTORY_OIDC_CALLBACK_URL
      ) {
        context.addIssue({
          code: 'custom',
          message: 'OIDC sign-in requires the issuer, client credentials, and callback URL',
          path: ['DIRECTORY_OIDC_ISSUER'],
        });
      }
      for (const [path, endpoint] of [
        ['DIRECTORY_OIDC_ISSUER', environment.DIRECTORY_OIDC_ISSUER],
        ['DIRECTORY_OIDC_CALLBACK_URL', environment.DIRECTORY_OIDC_CALLBACK_URL],
      ] as const) {
        if (endpoint && !isAllowedDirectoryUrl(endpoint)) {
          context.addIssue({
            code: 'custom',
            message:
              'OIDC issuer and callback must be HTTPS URLs (HTTP is allowed only for localhost development).',
            path: [path],
          });
        }
      }
      if (Object.keys(environment.DIRECTORY_LOGIN_RETURN_URLS_JSON).length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'OIDC sign-in requires an allow-listed login return URL for each app',
          path: ['DIRECTORY_LOGIN_RETURN_URLS_JSON'],
        });
      }
    }
    if (environment.DIRECTORY_AUTH_PROVIDER === 'saml') {
      if (
        !environment.DIRECTORY_SAML_ENTRY_POINT ||
        !environment.DIRECTORY_SAML_ISSUER ||
        !environment.DIRECTORY_SAML_CALLBACK_URL ||
        !environment.DIRECTORY_SAML_IDP_CERTIFICATE
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'SAML sign-in requires the IdP entry point, issuer, callback URL, and signing certificate',
          path: ['DIRECTORY_SAML_ENTRY_POINT'],
        });
      }
      for (const [path, endpoint] of [
        ['DIRECTORY_SAML_ENTRY_POINT', environment.DIRECTORY_SAML_ENTRY_POINT],
        ['DIRECTORY_SAML_CALLBACK_URL', environment.DIRECTORY_SAML_CALLBACK_URL],
      ] as const) {
        if (endpoint && !isAllowedDirectoryUrl(endpoint)) {
          context.addIssue({
            code: 'custom',
            message:
              'SAML entry point and callback must be HTTPS URLs (HTTP is allowed only for localhost development).',
            path: [path],
          });
        }
      }
      if (Object.keys(environment.DIRECTORY_LOGIN_RETURN_URLS_JSON).length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'SAML sign-in requires an allow-listed login return URL for each app',
          path: ['DIRECTORY_LOGIN_RETURN_URLS_JSON'],
        });
      }
    }
    if (environment.NODE_ENV === 'production') {
      const secureEndpointKeys =
        environment.DIRECTORY_AUTH_PROVIDER === 'oidc'
          ? [environment.DIRECTORY_OIDC_ISSUER, environment.DIRECTORY_OIDC_CALLBACK_URL]
          : environment.DIRECTORY_AUTH_PROVIDER === 'saml'
            ? [environment.DIRECTORY_SAML_ENTRY_POINT, environment.DIRECTORY_SAML_CALLBACK_URL]
            : [];
      if (secureEndpointKeys.some((endpoint) => endpoint && !endpoint.startsWith('https://'))) {
        context.addIssue({
          code: 'custom',
          message: 'Production directory sign-in endpoints must use HTTPS',
          path: ['DIRECTORY_AUTH_PROVIDER'],
        });
      }
      if (
        Object.values(environment.DIRECTORY_LOGIN_RETURN_URLS_JSON).some(
          (url) => !url.startsWith('https://'),
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Production directory return URLs must use HTTPS',
          path: ['DIRECTORY_LOGIN_RETURN_URLS_JSON'],
        });
      }
    }
    const replicaValues = [
      environment.BACKUP_REPLICA_S3_ENDPOINT,
      environment.BACKUP_REPLICA_S3_ACCESS_KEY_ID,
      environment.BACKUP_REPLICA_S3_SECRET_ACCESS_KEY,
      environment.BACKUP_REPLICA_S3_BUCKET,
    ];
    const replicaConfigured = replicaValues.every(Boolean);
    if (replicaValues.some(Boolean) && !replicaConfigured) {
      context.addIssue({
        code: 'custom',
        message:
          'An independent backup copy requires its endpoint, bucket, and separate credentials',
        path: ['BACKUP_REPLICA_S3_ENDPOINT'],
      });
    }
    if (environment.BACKUP_REPLICA_REQUIRED && !replicaConfigured) {
      context.addIssue({
        code: 'custom',
        message: 'Required independent backup copies need a complete secondary storage target',
        path: ['BACKUP_REPLICA_REQUIRED'],
      });
    }
    if (environment.VISTA_DEPLOYMENT_STAGE === 'production' && !replicaConfigured) {
      context.addIssue({
        code: 'custom',
        message: 'Production requires a separately configured independent backup copy target',
        path: ['BACKUP_REPLICA_S3_ENDPOINT'],
      });
    }
    if (replicaConfigured) {
      let replicaUrl: URL | undefined;
      try {
        replicaUrl = new URL(environment.BACKUP_REPLICA_S3_ENDPOINT);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Independent backup storage endpoint must be a valid URL',
          path: ['BACKUP_REPLICA_S3_ENDPOINT'],
        });
      }
      if (
        replicaUrl &&
        replicaUrl.hostname.toLowerCase() ===
          new URL(environment.S3_ENDPOINT).hostname.toLowerCase()
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Independent backup storage must use a different endpoint from primary storage',
          path: ['BACKUP_REPLICA_S3_ENDPOINT'],
        });
      }
      if (environment.BACKUP_REPLICA_S3_BUCKET === environment.BACKUP_S3_BUCKET) {
        context.addIssue({
          code: 'custom',
          message: 'Independent backup storage must use a different bucket',
          path: ['BACKUP_REPLICA_S3_BUCKET'],
        });
      }
      if (
        environment.BACKUP_REPLICA_S3_ACCESS_KEY_ID === environment.S3_ACCESS_KEY_ID ||
        environment.BACKUP_REPLICA_S3_SECRET_ACCESS_KEY === environment.S3_SECRET_ACCESS_KEY
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Independent backup storage must use credentials separate from primary storage',
          path: ['BACKUP_REPLICA_S3_ACCESS_KEY_ID'],
        });
      }
      if (
        environment.VISTA_DEPLOYMENT_STAGE === 'production' &&
        replicaUrl?.protocol !== 'https:'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Production independent backup storage must use HTTPS',
          path: ['BACKUP_REPLICA_S3_ENDPOINT'],
        });
      }
    }
    for (const [sourceCode, source] of Object.entries(
      environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON,
    )) {
      let sourceUrl: URL | undefined;
      try {
        sourceUrl = new URL(source.endpoint);
      } catch {
        // The JSON parser already reports invalid endpoint values.
      }
      if (environment.VISTA_DEPLOYMENT_STAGE !== 'local' && sourceUrl?.protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          message: 'Staging and production object-storage backup sources must use HTTPS',
          path: ['BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON', sourceCode],
        });
      }
      if (
        sourceUrl?.origin === new URL(environment.S3_ENDPOINT).origin &&
        source.bucket === environment.BACKUP_S3_BUCKET
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A protected object-storage source cannot be the backup destination bucket',
          path: ['BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON', sourceCode],
        });
      }
    }
    for (const [sourceCode, source] of Object.entries(
      environment.BACKUP_EMAIL_SOURCE_CONFIGS_JSON,
    )) {
      if (environment.VISTA_DEPLOYMENT_STAGE !== 'local' && source.tlsMode === 'none') {
        context.addIssue({
          code: 'custom',
          message: 'Email backup connections must use TLS outside local development.',
          path: ['BACKUP_EMAIL_SOURCE_CONFIGS_JSON', sourceCode, 'tlsMode'],
        });
      }
    }
    for (const [sourceCode, source] of Object.entries(
      environment.BACKUP_WEBDAV_SOURCE_CONFIGS_JSON,
    )) {
      let sourceUrl: URL | undefined;
      try {
        sourceUrl = new URL(source.endpoint);
      } catch {
        // The JSON parser already reports invalid endpoint values.
      }
      if (environment.VISTA_DEPLOYMENT_STAGE !== 'local' && sourceUrl?.protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          message: 'WebDAV backup connections must use HTTPS outside local development.',
          path: ['BACKUP_WEBDAV_SOURCE_CONFIGS_JSON', sourceCode, 'endpoint'],
        });
      }
    }
    if (environment.SMS_PROVIDER === 'twilio') {
      const recipients = environment.BACKUP_ALERT_SMS_RECIPIENTS.split(',')
        .map((recipient) => recipient.trim())
        .filter(Boolean);
      if (!/^AC[0-9a-fA-F]{32}$/u.test(environment.TWILIO_ACCOUNT_SID)) {
        context.addIssue({
          code: 'custom',
          message: 'Twilio SMS requires an account SID',
          path: ['TWILIO_ACCOUNT_SID'],
        });
      }
      if (!/^SK[0-9a-fA-F]{32}$/u.test(environment.TWILIO_API_KEY_SID)) {
        context.addIssue({
          code: 'custom',
          message: 'Twilio SMS requires an API key SID',
          path: ['TWILIO_API_KEY_SID'],
        });
      }
      if (environment.TWILIO_API_KEY_SECRET.length < 16) {
        context.addIssue({
          code: 'custom',
          message: 'Twilio SMS requires an API key secret',
          path: ['TWILIO_API_KEY_SECRET'],
        });
      }
      if (
        !/^MG[0-9a-fA-F]{32}$/u.test(environment.TWILIO_MESSAGING_SERVICE_SID) &&
        !/^\+[1-9][0-9]{7,14}$/u.test(environment.TWILIO_FROM_NUMBER)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Twilio SMS requires a messaging service or E.164 sender number',
          path: ['TWILIO_FROM_NUMBER'],
        });
      }
      if (
        recipients.length === 0 ||
        recipients.some((recipient) => !/^\+[1-9][0-9]{7,14}$/u.test(recipient))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Backup SMS recipients must be E.164 phone numbers',
          path: ['BACKUP_ALERT_SMS_RECIPIENTS'],
        });
      }
      const apiUrl = new URL(environment.TWILIO_API_BASE_URL);
      if (
        apiUrl.protocol !== 'https:' ||
        !(apiUrl.hostname === 'twilio.com' || apiUrl.hostname.endsWith('.twilio.com'))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Twilio SMS API URL must use HTTPS on a Twilio domain',
          path: ['TWILIO_API_BASE_URL'],
        });
      }
    }
    const econtFields = [
      environment.LOGISTICS_ECONT_USERNAME,
      environment.LOGISTICS_ECONT_PASSWORD,
      environment.LOGISTICS_ECONT_SENDER_NAME,
      environment.LOGISTICS_ECONT_SENDER_PHONE,
      environment.LOGISTICS_ECONT_SENDER_OFFICE_CODE,
    ];
    if (econtFields.some(Boolean) && econtFields.some((value) => !value)) {
      context.addIssue({
        code: 'custom',
        message:
          'Econt requires credentials and a sender name, phone, and office code before it can be enabled',
        path: ['LOGISTICS_ECONT_USERNAME'],
      });
    }
    const speedyFields = [
      environment.LOGISTICS_SPEEDY_USERNAME,
      environment.LOGISTICS_SPEEDY_PASSWORD,
      environment.LOGISTICS_SPEEDY_SERVICE_ID,
    ];
    if (speedyFields.some(Boolean) && speedyFields.some((value) => !value)) {
      context.addIssue({
        code: 'custom',
        message: 'Speedy requires a username, password, and configured service ID',
        path: ['LOGISTICS_SPEEDY_USERNAME'],
      });
    }
    if (
      environment.POS_FISCAL_SIMULATOR_ENABLED &&
      environment.VISTA_DEPLOYMENT_STAGE !== 'staging'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The POS fiscal simulator can be enabled only for the staging deployment',
        path: ['POS_FISCAL_SIMULATOR_ENABLED'],
      });
    }
    if (environment.NODE_ENV === 'production' && environment.API_RATE_LIMIT_STORE !== 'redis') {
      context.addIssue({
        code: 'custom',
        message: 'Production deployments must use the Redis rate-limit store',
        path: ['API_RATE_LIMIT_STORE'],
      });
    }
    if (
      environment.NODE_ENV === 'production' &&
      ((environment.SMTP_TLS_MODE === 'none' &&
        !['localhost', '127.0.0.1', 'mailpit'].includes(environment.SMTP_HOST)) ||
        Boolean(environment.SMTP_USERNAME) !== Boolean(environment.SMTP_PASSWORD))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'External production email requires TLS and complete credentials when authentication is used',
        path: ['SMTP_TLS_MODE'],
      });
    }
  });

function parseBackupDatabaseSourceUrls(
  value: string,
  context: z.RefinementCtx,
): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || '{}') as unknown;
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_DATABASE_SOURCE_URLS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_DATABASE_SOURCE_URLS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }

  const urls: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [sourceCode, connectionString] of Object.entries(parsed)) {
    let validConnectionString = false;
    if (typeof connectionString === 'string') {
      try {
        const connectionUrl = new URL(connectionString);
        validConnectionString =
          ['postgres:', 'postgresql:', 'mysql:', 'mysql2:', 'mariadb:'].includes(
            connectionUrl.protocol,
          ) &&
          Boolean(connectionUrl.hostname) &&
          connectionUrl.pathname.length > 1;
      } catch {
        validConnectionString = false;
      }
    }
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(sourceCode) || !validConnectionString) {
      context.addIssue({
        code: 'custom',
        message:
          'Each additional database backup entry needs a valid source code and PostgreSQL, MySQL, or MariaDB connection URL.',
      });
      return z.NEVER;
    }
    const normalizedSourceCode = sourceCode.toUpperCase();
    if (Object.hasOwn(urls, normalizedSourceCode)) {
      context.addIssue({
        code: 'custom',
        message: 'Database source codes in BACKUP_DATABASE_SOURCE_URLS_JSON must be unique.',
      });
      return z.NEVER;
    }
    urls[normalizedSourceCode] = connectionString as string;
  }
  return urls;
}

export interface BackupObjectStorageSourceConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
}

export interface BackupEmailSourceConfig {
  host: string;
  mailboxes: string[];
  password: string;
  port: number;
  tlsMode: 'implicit' | 'none' | 'starttls';
  username: string;
}

export interface BackupWebDavSourceConfig {
  endpoint: string;
  password: string;
  username: string;
}

function parseBackupWebDavSourceConfigs(
  value: string,
  context: z.RefinementCtx,
): Record<string, BackupWebDavSourceConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || '{}') as unknown;
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_WEBDAV_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }
  if (!isRecord(parsed)) {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_WEBDAV_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }

  const configs: Record<string, BackupWebDavSourceConfig> = Object.create(null) as Record<
    string,
    BackupWebDavSourceConfig
  >;
  for (const [sourceCode, entry] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(sourceCode) || !isRecord(entry)) {
      context.addIssue({
        code: 'custom',
        message: 'Each WebDAV backup entry needs a valid source code and configuration.',
      });
      return z.NEVER;
    }
    const { endpoint, password, username } = entry;
    let parsedEndpoint: URL | undefined;
    try {
      if (typeof endpoint === 'string') parsedEndpoint = new URL(endpoint);
    } catch {
      // Add the same safe validation error used for incomplete entries below.
    }
    const validEndpoint = Boolean(
      parsedEndpoint &&
      ['http:', 'https:'].includes(parsedEndpoint.protocol) &&
      parsedEndpoint.hostname &&
      !parsedEndpoint.username &&
      !parsedEndpoint.password &&
      !parsedEndpoint.search &&
      !parsedEndpoint.hash,
    );
    if (
      !validEndpoint ||
      typeof username !== 'string' ||
      !username.trim() ||
      username.length > 255 ||
      typeof password !== 'string' ||
      !password ||
      password.length > 2_000
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Each WebDAV backup entry needs a valid endpoint and account credentials.',
      });
      return z.NEVER;
    }
    const normalizedSourceCode = sourceCode.toUpperCase();
    if (Object.hasOwn(configs, normalizedSourceCode)) {
      context.addIssue({
        code: 'custom',
        message: 'WebDAV backup source codes must be unique, ignoring case.',
      });
      return z.NEVER;
    }
    configs[normalizedSourceCode] = {
      endpoint: endpoint as string,
      password,
      username,
    };
  }
  return configs;
}

function parseBackupEmailSourceConfigs(
  value: string,
  context: z.RefinementCtx,
): Record<string, BackupEmailSourceConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || '{}') as unknown;
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_EMAIL_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }
  if (!isRecord(parsed)) {
    context.addIssue({
      code: 'custom',
      message: 'BACKUP_EMAIL_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }

  const configs: Record<string, BackupEmailSourceConfig> = Object.create(null) as Record<
    string,
    BackupEmailSourceConfig
  >;
  for (const [sourceCode, valueForSource] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(sourceCode) || !isRecord(valueForSource)) {
      context.addIssue({
        code: 'custom',
        message: 'Each email backup entry needs a valid source code and configuration.',
      });
      return z.NEVER;
    }
    const { host, mailboxes, password, port, tlsMode, username } = valueForSource;
    const validHost =
      typeof host === 'string' &&
      host.length <= 253 &&
      /^[a-zA-Z0-9.-]+$/u.test(host) &&
      !host.startsWith('.') &&
      !host.endsWith('.');
    const validMailboxes =
      isStringArray(mailboxes) &&
      mailboxes.length > 0 &&
      mailboxes.length <= 500 &&
      mailboxes.every(
        (mailbox) => mailbox.length > 0 && mailbox.length <= 255 && !hasControlCharacters(mailbox),
      ) &&
      new Set(mailboxes).size === mailboxes.length;
    if (
      !validHost ||
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      !['implicit', 'starttls', 'none'].includes(String(tlsMode)) ||
      typeof username !== 'string' ||
      !username.trim() ||
      username.length > 255 ||
      typeof password !== 'string' ||
      !password ||
      !validMailboxes
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Each email backup entry needs a host, port, TLS mode, account credentials, and a unique mailbox list.',
      });
      return z.NEVER;
    }
    const normalizedSourceCode = sourceCode.toUpperCase();
    if (Object.hasOwn(configs, normalizedSourceCode)) {
      context.addIssue({
        code: 'custom',
        message: 'Email backup source codes must be unique.',
      });
      return z.NEVER;
    }
    configs[normalizedSourceCode] = {
      host,
      mailboxes: [...mailboxes],
      password,
      port,
      tlsMode: tlsMode as BackupEmailSourceConfig['tlsMode'],
      username,
    };
  }
  return configs;
}

function parseBackupObjectStorageSourceConfigs(
  value: string,
  context: z.RefinementCtx,
): Record<string, BackupObjectStorageSourceConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || '{}') as unknown;
  } catch {
    context.addIssue({
      code: 'custom',
      message:
        'BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    context.addIssue({
      code: 'custom',
      message:
        'BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON must be a JSON object keyed by source code.',
    });
    return z.NEVER;
  }

  const configs: Record<string, BackupObjectStorageSourceConfig> = Object.create(null) as Record<
    string,
    BackupObjectStorageSourceConfig
  >;
  for (const [sourceCode, valueForSource] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(sourceCode) || !isRecord(valueForSource)) {
      context.addIssue({
        code: 'custom',
        message: 'Each object-storage backup entry needs a valid source code and configuration.',
      });
      return z.NEVER;
    }
    const { accessKeyId, bucket, endpoint, forcePathStyle, region, secretAccessKey } =
      valueForSource;
    let parsedEndpoint: URL | undefined;
    try {
      if (typeof endpoint === 'string') parsedEndpoint = new URL(endpoint);
    } catch {
      // Add the same safe validation error used for incomplete entries below.
    }
    const validEndpoint = Boolean(
      parsedEndpoint &&
      ['http:', 'https:'].includes(parsedEndpoint.protocol) &&
      parsedEndpoint.hostname &&
      !parsedEndpoint.username &&
      !parsedEndpoint.password &&
      !parsedEndpoint.search &&
      !parsedEndpoint.hash,
    );
    const validBucket =
      typeof bucket === 'string' &&
      bucket.length >= 3 &&
      bucket.length <= 63 &&
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket) &&
      !bucket.includes('..');
    if (
      !validEndpoint ||
      !validBucket ||
      typeof accessKeyId !== 'string' ||
      !accessKeyId.trim() ||
      typeof secretAccessKey !== 'string' ||
      !secretAccessKey.trim() ||
      (region !== undefined && (typeof region !== 'string' || !region.trim())) ||
      (forcePathStyle !== undefined && typeof forcePathStyle !== 'boolean')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Each object-storage backup entry needs an endpoint, region, bucket, access key and secret key.',
      });
      return z.NEVER;
    }
    const normalizedSourceCode = sourceCode.toUpperCase();
    if (Object.hasOwn(configs, normalizedSourceCode)) {
      context.addIssue({
        code: 'custom',
        message: 'Object-storage backup source codes must be unique, ignoring case.',
      });
      return z.NEVER;
    }
    configs[normalizedSourceCode] = {
      accessKeyId,
      bucket,
      endpoint: endpoint as string,
      forcePathStyle: forcePathStyle ?? true,
      region: region?.trim() || 'us-east-1',
      secretAccessKey,
    };
  }
  return configs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item: unknown): item is string => typeof item === 'string')
  );
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isAllowedDirectoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export type AppEnvironment = z.infer<typeof environmentSchema>;

function parseDirectoryGroupRoleMappings(
  value: string,
  context: z.RefinementCtx,
): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('expected an object');
    const mappings: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
    for (const [group, roles] of Object.entries(parsed)) {
      if (
        !group.trim() ||
        !isStringArray(roles) ||
        roles.length === 0 ||
        roles.some((role) => !/^[A-Za-z0-9._-]{1,80}$/u.test(role))
      ) {
        throw new Error('each group must map to one or more existing role codes');
      }
      const normalizedGroup = group.trim().toLowerCase();
      if (Object.hasOwn(mappings, normalizedGroup)) {
        throw new Error('group identifiers must be unique ignoring case and whitespace');
      }
      mappings[normalizedGroup] = [...new Set(roles.map((role) => role.trim().toLowerCase()))];
    }
    return mappings;
  } catch {
    context.addIssue({
      code: 'custom',
      message:
        'DIRECTORY_GROUP_ROLE_MAPPINGS_JSON must map group names to arrays of Vista role codes',
    });
    return {};
  }
}

function parseDirectoryReturnUrls(value: string, context: z.RefinementCtx): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('expected an object');
    const urls: Record<string, string> = {};
    for (const app of ['operations', 'pos', 'recovery']) {
      const candidate = parsed[app];
      if (candidate === undefined) continue;
      if (typeof candidate !== 'string') throw new Error('expected URL strings');
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost')
        throw new Error('return URLs must use HTTPS');
      if (url.username || url.password || url.search || url.hash)
        throw new Error('return URLs must be clean application origins');
      urls[app] = url.origin;
    }
    if (Object.keys(parsed).some((app) => !['operations', 'pos', 'recovery'].includes(app)))
      throw new Error('unknown application');
    return urls;
  } catch {
    context.addIssue({
      code: 'custom',
      message:
        'DIRECTORY_LOGIN_RETURN_URLS_JSON must contain clean allow-listed app URLs for operations, pos, or recovery',
    });
    return {};
  }
}

export function parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment {
  const result = environmentSchema.safeParse(input);

  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${summary}`);
  }

  return result.data;
}
