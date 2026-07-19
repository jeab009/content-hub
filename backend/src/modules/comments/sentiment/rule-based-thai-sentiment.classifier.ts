import { Injectable } from '@nestjs/common';
import { Sentiment, SentimentSource } from '@prisma/client';
import { SentimentClassification, SentimentClassifier } from './sentiment-classifier.interface';
import { NEGATION_TERMS, NEGATIVE_TERMS, POSITIVE_TERMS } from './sentiment.constants';

/**
 * Offline, deterministic Thai (+ EN fallthrough) sentiment classifier — the
 * default `SENTIMENT_IMPL=rule_based` implementation. Scores positive vs
 * negative lexicon hits, applies a simple negation flip, and defaults to
 * `neutral` when neither side wins. Never touches the network (D1) and never
 * logs the text it classifies (System Analyst condition C6b).
 */
@Injectable()
export class RuleBasedThaiSentimentClassifier implements SentimentClassifier {
  classify(text: string): Promise<SentimentClassification> {
    return Promise.resolve({
      sentiment: this.score(text),
      source: SentimentSource.rule_based,
    });
  }

  private score(text: string): Sentiment {
    const haystack = text.toLowerCase();
    const positiveHits = countHits(haystack, POSITIVE_TERMS);
    const negativeHits = countHits(haystack, NEGATIVE_TERMS);
    const negated = NEGATION_TERMS.some((term) => haystack.includes(term));

    // Negation flips ONLY a single-polarity signal so a genuinely mixed but
    // strongly-negative comment that happens to contain "ไม่" isn't inverted:
    //   "ไม่ดี" (not good)  -> positive stem only, negated  -> negative
    //   "ไม่แย่" (not bad)  -> negative stem only, negated  -> positive
    // A comment with BOTH polarities present falls through to the plain
    // comparison (transparent, if coarse — nuance is the model's job in 4C).
    if (negated && positiveHits > 0 && negativeHits === 0) {
      return Sentiment.negative;
    }
    if (negated && negativeHits > 0 && positiveHits === 0) {
      return Sentiment.positive;
    }

    if (negativeHits > positiveHits) {
      return Sentiment.negative;
    }
    if (positiveHits > negativeHits) {
      return Sentiment.positive;
    }
    return Sentiment.neutral;
  }
}

function countHits(haystack: string, terms: readonly string[]): number {
  return terms.reduce(
    (count, term) => (haystack.includes(term.toLowerCase()) ? count + 1 : count),
    0,
  );
}
