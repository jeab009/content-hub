import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { SENTIMENT_CLASSIFIER } from './sentiment-classifier.interface';
import { RuleBasedThaiSentimentClassifier } from './rule-based-thai-sentiment.classifier';
import { ModelSentimentClassifier } from './model-sentiment.classifier';

/**
 * Binds the SENTIMENT_CLASSIFIER token to the impl named by
 * `config.sentiment.impl` at DI time — the exact analogue of the
 * PlatformAdapterRegistry choosing mock vs live. Default is the offline
 * rule-based classifier; `model` is the flagged 4C tail.
 */
export const sentimentClassifierProvider: Provider = {
  provide: SENTIMENT_CLASSIFIER,
  inject: [ConfigService, RuleBasedThaiSentimentClassifier, ModelSentimentClassifier],
  useFactory: (
    configService: ConfigService,
    ruleBased: RuleBasedThaiSentimentClassifier,
    model: ModelSentimentClassifier,
  ) => {
    const logger = new Logger('SentimentClassifierProvider');
    const impl = configService.get<AppConfig>('app')?.sentiment.impl ?? 'rule_based';
    if (impl === 'model') {
      logger.warn('SENTIMENT_IMPL=model selected — using the flagged self-hosted model classifier');
      return model;
    }
    logger.log('Using the rule-based Thai sentiment classifier (offline, deterministic)');
    return ruleBased;
  },
};
