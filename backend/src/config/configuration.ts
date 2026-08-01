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
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  };
  upload: {
    storageDir: string;
    maxImageBytes: number;
    maxVideoBytes: number;
  };
  publisher: {
    facebookImpl: 'mock' | 'facebook';
    youtubeImpl: 'mock' | 'youtube';
    // Phase 5: same mock/live gate for the two new platforms. Their live
    // paths are structured stubs that reject cleanly — no verified
    // integration exists (no credentials; see phase5-project-plan.md C-A).
    tiktokImpl: 'mock' | 'tiktok';
    lineImpl: 'mock' | 'line';
    mockLatencyMs: number;
    mockFailureRate: number;
  };
  ranking: {
    weightsPath: string;
    // Which ranking engine serves recommendations. Defaults to 'v1' until QA
    // verifies v2 live (phase5-project-plan.md Decision 2); every persisted
    // score row is tagged with the engine that produced it either way.
    engine: 'v1' | 'v2';
  };
  commerce: {
    // Mirrors PUBLISHER_IMPL_* exactly (Phase 6, System Analyst SA-7): MUST
    // default to 'mock' everywhere except an explicit production opt-in — see
    // assertAdapterFlagsAreSafe in main.ts. Live impls are rejecting stubs;
    // no HTTP client exists for either channel (Decision 5, out of scope).
    shopeeImpl: 'mock' | 'shopee';
    tiktokShopImpl: 'mock' | 'tiktok_shop';
  };
  paid: {
    // See env.validation.ts PAID_IMPL_META. 'disabled' (default, safe) vs
    // 'meta' (live — gated by assertAdapterFlagsAreSafe outside production,
    // same contract as every other *_IMPL_* flag). No 'mock' value: Paid has
    // no mock data-pull to select between this phase (manual entry only —
    // docs/phase7d-live-integration-spec.md).
    metaImpl: 'disabled' | 'meta';
  };
  sentiment: {
    // 'rule_based' (default, offline, deterministic) | 'model' (self-hosted, flagged).
    // Mirrors the PUBLISHER_IMPL_* mock/live gate. CI + demo never set it, so the
    // rule-based path is the only one exercised by tests (Phase 4 D2).
    impl: 'rule_based' | 'model';
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
    google: {
      // Optional (default '') so existing .env files keep booting; the
      // Google connect flow returns a clear error if used unconfigured.
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri:
        process.env.GOOGLE_REDIRECT_URI ??
        'http://localhost:4000/api/connected-accounts/google/callback',
      // Google scopes are space-separated (unlike Meta's comma convention).
      scopes: (
        process.env.GOOGLE_OAUTH_SCOPES ??
        'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
      )
        .split(' ')
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
    upload: {
      storageDir: process.env.UPLOAD_STORAGE_DIR ?? './storage/uploads',
      // Documented NFR assumption (System Analyst item 1): 20MB is generous
      // for a single JPEG/PNG social-post image; 500MB covers a few minutes
      // of H.264 MP4 at typical social-post bitrates without accepting
      // arbitrary large uploads.
      maxImageBytes: parseInt(process.env.UPLOAD_MAX_IMAGE_BYTES ?? `${20 * 1024 * 1024}`, 10),
      maxVideoBytes: parseInt(process.env.UPLOAD_MAX_VIDEO_BYTES ?? `${500 * 1024 * 1024}`, 10),
    },
    publisher: {
      // MUST default to 'mock' everywhere except an explicit opt-in — see
      // the startup assertion in main.ts (security condition #4).
      facebookImpl: (process.env.PUBLISHER_IMPL_FACEBOOK ?? 'mock') as 'mock' | 'facebook',
      youtubeImpl: (process.env.PUBLISHER_IMPL_YOUTUBE ?? 'mock') as 'mock' | 'youtube',
      tiktokImpl: (process.env.PUBLISHER_IMPL_TIKTOK ?? 'mock') as 'mock' | 'tiktok',
      lineImpl: (process.env.PUBLISHER_IMPL_LINE ?? 'mock') as 'mock' | 'line',
      mockLatencyMs: parseInt(process.env.MOCK_PUBLISHER_LATENCY_MS ?? '50', 10),
      mockFailureRate: parseFloat(process.env.MOCK_PUBLISHER_FAILURE_RATE ?? '0'),
    },
    ranking: {
      weightsPath: process.env.RANKING_WEIGHTS_PATH ?? './config/ranking-weights.yaml',
      // Defaults to 'v2' since 2026-07-20 (admin decision at the Phase 5D
      // close-out). v2 shipped disabled through Phase 5A/5B while BUG-P5-02
      // let v1 and v2 score rows mix in one recommendation; 5D.1 made score
      // reads engine-scoped, which was the gate on enabling it. Set
      // RANKING_ENGINE=v1 to roll back — reads are engine-scoped both ways, so
      // a rollback ignores v2 rows rather than blending them.
      engine: (process.env.RANKING_ENGINE ?? 'v2') as 'v1' | 'v2',
    },
    commerce: {
      shopeeImpl: (process.env.COMMERCE_IMPL_SHOPEE ?? 'mock') as 'mock' | 'shopee',
      tiktokShopImpl: (process.env.COMMERCE_IMPL_TIKTOK_SHOP ?? 'mock') as 'mock' | 'tiktok_shop',
    },
    paid: {
      metaImpl: (process.env.PAID_IMPL_META ?? 'disabled') as 'disabled' | 'meta',
    },
    sentiment: {
      // MUST default to 'rule_based' — the self-hosted model (4C) is a flagged
      // tail and ships disabled. Comments never leave infra either way (D1).
      impl: (process.env.SENTIMENT_IMPL ?? 'rule_based') as 'rule_based' | 'model',
    },
  },
});
