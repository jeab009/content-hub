/**
 * Typed, structured view over process.env. Every other module should read
 * config through ConfigService.get<AppConfig>('...') rather than touching
 * process.env directly, so there is one place that understands the shape.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigin: string;
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    queueDb: number;
    sessionDb: number;
  };
  session: {
    secret: string;
    cookieName: string;
    ttlMs: number;
  };
  encryption: {
    masterKeyBase64: string;
  };
  facebook: {
    appId: string;
    appSecret: string;
    redirectUri: string;
    graphApiVersion: string;
    scopes: string[];
  };
}

export default (): { app: AppConfig } => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '4000', 10),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      queueDb: parseInt(process.env.REDIS_QUEUE_DB ?? '0', 10),
      sessionDb: parseInt(process.env.REDIS_SESSION_DB ?? '1', 10),
    },
    session: {
      secret: process.env.SESSION_SECRET ?? '',
      cookieName: process.env.SESSION_COOKIE_NAME ?? 'content_hub_sid',
      ttlMs: parseInt(process.env.SESSION_TTL_MS ?? `${12 * 60 * 60 * 1000}`, 10),
    },
    encryption: {
      masterKeyBase64: process.env.APP_ENCRYPTION_KEY ?? '',
    },
    facebook: {
      appId: process.env.FACEBOOK_APP_ID ?? '',
      appSecret: process.env.FACEBOOK_APP_SECRET ?? '',
      redirectUri: process.env.FACEBOOK_REDIRECT_URI ?? '',
      graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION ?? 'v21.0',
      scopes: (
        process.env.FACEBOOK_OAUTH_SCOPES ??
        'pages_show_list,pages_read_engagement,pages_manage_posts'
      )
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
  },
});
