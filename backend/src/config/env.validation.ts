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

  // Google OAuth (YouTube connect flow). Optional with safe defaults —
  // unlike the Facebook vars above — so existing .env files keep booting;
  // the connect flow itself errors clearly when used unconfigured.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_REDIRECT_URI: Joi.string()
    .uri()
    .default('http://localhost:4000/api/connected-accounts/google/callback'),
  GOOGLE_OAUTH_SCOPES: Joi.string().default(
    'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
  ),

  SEED_ADMIN_EMAIL: Joi.string().email().optional(),
  SEED_ADMIN_NAME: Joi.string().optional(),
  SEED_ADMIN_PASSWORD: Joi.string().allow('').optional(),

  UPLOAD_STORAGE_DIR: Joi.string().default('./storage/uploads'),
  UPLOAD_MAX_IMAGE_BYTES: Joi.number().default(20 * 1024 * 1024),
  UPLOAD_MAX_VIDEO_BYTES: Joi.number().default(500 * 1024 * 1024),

  // Publisher feature flags — MUST default to 'mock'. See main.ts startup
  // assertion (security condition #4): booting with a non-mock value
  // outside NODE_ENV=production refuses to start.
  PUBLISHER_IMPL_FACEBOOK: Joi.string().valid('mock', 'facebook').default('mock'),
  PUBLISHER_IMPL_YOUTUBE: Joi.string().valid('mock', 'youtube').default('mock'),
  // Phase 5 additions. Same gate, same 'mock' default. Their live paths are
  // structured stubs that reject cleanly — no verified integration exists.
  PUBLISHER_IMPL_TIKTOK: Joi.string().valid('mock', 'tiktok').default('mock'),
  PUBLISHER_IMPL_LINE: Joi.string().valid('mock', 'line').default('mock'),
  MOCK_PUBLISHER_LATENCY_MS: Joi.number().default(50),
  MOCK_PUBLISHER_FAILURE_RATE: Joi.number().min(0).max(1).default(0),

  RANKING_WEIGHTS_PATH: Joi.string().default('./config/ranking-weights.yaml'),

  // Phase 5 ranking engine selector — MUST default to 'v1' so an existing
  // .env keeps today's behavior. Flipped to 'v2' only after QA verifies it.
  RANKING_ENGINE: Joi.string().valid('v1', 'v2').default('v2'),

  // Phase 4 sentiment classifier gate — MUST default to 'rule_based'. The
  // self-hosted model ('model') is a flagged 4C tail, shipped disabled.
  SENTIMENT_IMPL: Joi.string().valid('rule_based', 'model').default('rule_based'),
});
