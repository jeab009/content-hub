import { Sentiment, SentimentSource } from '@prisma/client';
import { RuleBasedThaiSentimentClassifier } from './rule-based-thai-sentiment.classifier';

describe('RuleBasedThaiSentimentClassifier', () => {
  const classifier = new RuleBasedThaiSentimentClassifier();

  it('tags a positive Thai comment as positive with source=rule_based', async () => {
    const result = await classifier.classify('ดีมากเลยค่ะ ชอบมากๆ ประทับใจสุดๆ');
    expect(result.sentiment).toBe(Sentiment.positive);
    expect(result.source).toBe(SentimentSource.rule_based);
  });

  it('tags a negative Thai comment as negative', async () => {
    const result = await classifier.classify('บริการแย่มาก ผิดหวังมากครับ');
    expect(result.sentiment).toBe(Sentiment.negative);
  });

  it('defaults to neutral when neither polarity wins', async () => {
    const result = await classifier.classify('รับทราบครับ ขอบคุณสำหรับข้อมูล ');
    // "ขอบคุณ" is positive; use a genuinely neutral string instead.
    const neutral = await classifier.classify('ส่งของแล้วนะ');
    expect(neutral.sentiment).toBe(Sentiment.neutral);
    expect([Sentiment.positive, Sentiment.neutral]).toContain(result.sentiment);
  });

  it('applies a negation flip: "ไม่ดี" reads negative', async () => {
    const result = await classifier.classify('ไม่ดี');
    expect(result.sentiment).toBe(Sentiment.negative);
  });

  it('falls through to English terms', async () => {
    expect((await classifier.classify('this is terrible')).sentiment).toBe(Sentiment.negative);
    expect((await classifier.classify('great product, love it')).sentiment).toBe(
      Sentiment.positive,
    );
  });

  it('is deterministic', async () => {
    const a = await classifier.classify('บริการแย่มาก');
    const b = await classifier.classify('บริการแย่มาก');
    expect(a).toEqual(b);
  });
});
