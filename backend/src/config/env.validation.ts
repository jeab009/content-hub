import * as Joi from 'joi';

/**
 * Validates process.env at boot. Fails fast with a clear error instead of
 * letting the app start with a missing secret and fail obscurely later.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(4000),
  CORS_ORIGIN: Joi.string().required(),

  DATABASE_URL: Joi.string().uri().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_QUEUE_DB: Joi.number().default(0),
  REDIS_SESSION_DB: Joi.number().default(1),

  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_COOKIE_NAME: Joi.string().default('content_hub_sid'),
  SESSION_TTL_MS: Joi.number().default(12 * 60 * 60 * 1000),

  APP_ENCRYPTION_KEY: Joi.string().required(),

  FACEBOOK_APP_ID: Joi.string().required(),
  FACEBOOK_APP_SECRET: Joi.string().required(),
  FACEBOOK_REDIRECT_URI: Joi.string().uri().required(),
  FACEBOOK_GRAPH_API_VERSION: Joi.string().default('v21.0'),
  FACEBOOK_OAUTH_SCOPES: Joi.string().default(
    'pages_show_list,pages_read_engagement,pages_manage_posts',
  ),

  SEED_ADMIN_EMAIL: Joi.string().email().optional(),
  SEED_ADMIN_NAME: Joi.string().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().allow('').optional(),
});
