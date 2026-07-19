import { Injectable } from '@nestjs/common';
import { CommentPriority, Sentiment } from '@prisma/client';
import { SLA_HOURS_BY_PRIORITY } from './comments.constants';
import { COMPLAINT_TERMS, QUESTION_TERMS, SPAM_TERMS } from './sentiment/sentiment.constants';

export interface TriageResult {
  priority: CommentPriority;
  /** `collectedAt + SLA hours`, or null when the priority has no SLA (spam). */
  slaDueAt: Date | null;
}

/**
 * Rule-based, transparent triage (capability e) — assigns a priority and an
 * SLA due timestamp at ingestion, after sentiment. Never a black box: the
 * rules are first-match-wins and readable. Never logs raw text (C6b).
 *
 * Priority rules (first match wins):
 *   1. spam heuristics (link/promo keywords) -> spam
 *   2. interrogative markers (Thai/EN question words, '?') -> question
 *   3. negative sentiment + complaint lexicon -> complaint
 *   4. otherwise -> general
 */
@Injectable()
export class CommentTriageService {
  triage(text: string, sentiment: Sentiment | null, collectedAt: Date): TriageResult {
    const priority = this.classifyPriority(text, sentiment);
    return { priority, slaDueAt: this.dueAt(priority, collectedAt) };
  }

  private classifyPriority(text: string, sentiment: Sentiment | null): CommentPriority {
    const haystack = text.toLowerCase();

    if (containsAny(haystack, SPAM_TERMS)) {
      return CommentPriority.spam;
    }
    if (containsAny(haystack, QUESTION_TERMS)) {
      return CommentPriority.question;
    }
    if (sentiment === Sentiment.negative && containsAny(haystack, COMPLAINT_TERMS)) {
      return CommentPriority.complaint;
    }
    return CommentPriority.general;
  }

  private dueAt(priority: CommentPriority, collectedAt: Date): Date | null {
    const hours = SLA_HOURS_BY_PRIORITY[priority];
    if (hours === null) {
      return null;
    }
    return new Date(collectedAt.getTime() + hours * 60 * 60 * 1000);
  }
}

function containsAny(haystack: string, terms: readonly string[]): boolean {
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}
