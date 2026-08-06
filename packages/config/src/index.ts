import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  API_PREFIX: z.string().min(1).default('api/v1'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  API_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_LOGIN_RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
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
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PASSWORD_EXPIRY_DAYS: z.coerce.number().int().nonnegative().default(0),
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
  TOTP_ISSUER: z.string().min(1).default('Vista Service'),
  TOTP_WINDOW_STEPS: z.coerce.number().int().min(0).max(2).default(1),
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
