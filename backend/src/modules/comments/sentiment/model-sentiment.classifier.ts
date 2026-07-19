import { Injectable } from '@nestjs/common';
import { SentimentClassification, SentimentClassifier } from './sentiment-classifier.interface';

/**
 * Phase 4C (flagged tail) — self-hosted model classifier. Ships DISABLED:
 * only selected when `SENTIMENT_IMPL=model`, which CI/demo never set. When
 * built out it will call the model IN-PROCESS / IN-CONTAINER (no egress, D1)
 * and set `source: 'model'`. Until then it fails loudly rather than silently
 * mis-tagging, so an accidental flag flip is obvious.
 */
@Injectable()
export class ModelSentimentClassifier implements SentimentClassifier {
  classify(_text: string): Promise<SentimentClassification> {
    return Promise.reject(
      new Error(
        'ModelSentimentClassifier is not implemented (Phase 4C). ' +
          'Set SENTIMENT_IMPL=rule_based (the default) until the self-hosted model ships.',
      ),
    );
  }
}
