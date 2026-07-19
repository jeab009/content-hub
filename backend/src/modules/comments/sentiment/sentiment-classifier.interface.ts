import { Sentiment, SentimentSource } from '@prisma/client';

/**
 * A single classification result. `sentiment` reuses the existing Phase 1
 * `Sentiment` enum (positive/negative/neutral); `source` records WHICH
 * classifier produced it so a later re-classification stays auditable
 * (ADR-P4-4).
 */
export interface SentimentClassification {
  sentiment: Sentiment;
  source: SentimentSource;
}

/**
 * Pluggable sentiment classifier. The concrete implementation is chosen at DI
 * time from `config.sentiment.impl` — the exact analogue of the
 * PUBLISHER_IMPL_* mock/live adapter gate. Classification is ALWAYS in-process
 * / in-container: comments never leave infra (decision D1), which is what
 * sidesteps the third-party-DPA gate. Sentiment is advisory only — it never
 * triggers an automatic action (risk R2).
 */
export interface SentimentClassifier {
  classify(text: string): Promise<SentimentClassification>;
}

/** DI token for the selected SentimentClassifier instance. */
export const SENTIMENT_CLASSIFIER = Symbol('SENTIMENT_CLASSIFIER');
