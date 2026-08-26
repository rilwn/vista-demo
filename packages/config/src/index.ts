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
    FEATURE_BACKUP_EMERGENCY_ACCESS: booleanString.default(false),
    FEATURE_CUSTOMER_PORTAL: booleanString.default(false),
    FEATURE_ECOMMERCE_FISCALIZATION: booleanString.default(false),
    FEATURE_ELECTRONIC_SHELF_LABELS: booleanString.default(false),
    FEATURE_FIFO_COSTING: booleanString.default(false),
    FEATURE_POS_BACKUP_ROUTER: booleanString.default(false),
    FEATURE_POS_KIOSK: booleanString.default(false),
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
    CRM_SLA_EVALUATION_CRON: z.string().min(1).default('0 */5 * * * *'),
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
    TOTP_ENCRYPTION_KEY: z.string().min(32),
    TOTP_ENROLLMENT_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    TOTP_ISSUER: z.string().min(1).default('Vista Service'),
    TOTP_WINDOW_STEPS: z.coerce.number().int().min(0).max(2).default(1),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && environment.API_RATE_LIMIT_STORE !== 'redis') {
      context.addIssue({
        code: 'custom',
        message: 'Production deployments must use the Redis rate-limit store',
        path: ['API_RATE_LIMIT_STORE'],
      });
    }
  });

export type AppEnvironment = z.infer<typeof environmentSchema>;

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
