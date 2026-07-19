import { CommentPriority, Sentiment } from '@prisma/client';
import { CommentTriageService } from './comment-triage.service';

describe('CommentTriageService', () => {
  const service = new CommentTriageService();
  const collectedAt = new Date('2026-07-19T00:00:00Z');

  it('classifies a link/promo comment as spam with no SLA clock', () => {
    const result = service.triage('โปรโมชั่นพิเศษ คลิกเลย http://promo.example', null, collectedAt);
    expect(result.priority).toBe(CommentPriority.spam);
    expect(result.slaDueAt).toBeNull();
  });

  it('classifies an interrogative as question (24h SLA)', () => {
    const result = service.triage('ราคาเท่าไหร่ครับ?', Sentiment.neutral, collectedAt);
    expect(result.priority).toBe(CommentPriority.question);
    expect(result.slaDueAt).toEqual(new Date('2026-07-20T00:00:00Z'));
  });

  it('classifies negative + complaint lexicon as complaint (4h SLA)', () => {
    const result = service.triage('บริการแย่มาก ผิดหวัง', Sentiment.negative, collectedAt);
    expect(result.priority).toBe(CommentPriority.complaint);
    expect(result.slaDueAt).toEqual(new Date('2026-07-19T04:00:00Z'));
  });

  it('does not mark a negative comment complaint without complaint lexicon', () => {
    // Negative sentiment but no complaint keyword and no question/spam markers.
    const result = service.triage('เศร้าจัง', Sentiment.negative, collectedAt);
    expect(result.priority).toBe(CommentPriority.general);
  });

  it('defaults to general (48h SLA)', () => {
    const result = service.triage('ส่งของแล้วนะ', Sentiment.neutral, collectedAt);
    expect(result.priority).toBe(CommentPriority.general);
    expect(result.slaDueAt).toEqual(new Date('2026-07-21T00:00:00Z'));
  });

  it('spam wins over question when both markers are present (first match wins)', () => {
    const result = service.triage(
      'สนใจไหม คลิกเลย http://x.example',
      Sentiment.neutral,
      collectedAt,
    );
    expect(result.priority).toBe(CommentPriority.spam);
  });
});
