/**
 * Thai (+ English fallthrough) sentiment & triage lexicons for the rule-based
 * classifier. Deliberately small, transparent, and offline — the classifier
 * is a readable rule set, never a black box (ADR-P4-4). Tuning these lists is
 * the whole "training" surface for the rule-based default; the self-hosted
 * model (4C) supersedes it behind a flag.
 *
 * Matching is lowercased substring containment, so entries should be stems.
 */
export const POSITIVE_TERMS: readonly string[] = [
  'ดี',
  'ดีมาก',
  'ชอบ',
  'ประทับใจ',
  'สุดยอด',
  'เยี่ยม',
  'ขอบคุณ',
  'รัก',
  'ยอดเยี่ยม',
  'คุ้ม',
  'แนะนำ',
  'good',
  'great',
  'love',
  'excellent',
  'thanks',
  'awesome',
];

// Note: negated-positive phrases (e.g. "ไม่ดี" / "ไม่ประทับใจ") are DELIBERATELY
// NOT listed here — the negation flip below derives them from the positive stem
// so they aren't double-counted (a phrase matching both lists would tie to
// neutral). Only inherently-negative stems belong here.
export const NEGATIVE_TERMS: readonly string[] = [
  'แย่',
  'ห่วย',
  'ผิดหวัง',
  'เสีย',
  'โกง',
  'ช้า',
  'แพง',
  'เกลียด',
  'bad',
  'terrible',
  'worst',
  'hate',
  'awful',
  'disappointed',
  'scam',
];

/**
 * Negation markers that flip a matched sentiment. Kept small — the rule is
 * "if a negation term co-occurs, invert positive<->negative" (transparent, if
 * imperfect; the model handles nuance in 4C).
 */
export const NEGATION_TERMS: readonly string[] = ['ไม่', 'ไม่ได้', 'not', "don't", 'no'];

/** Complaint markers → priority `complaint` when combined with negative sentiment. */
export const COMPLAINT_TERMS: readonly string[] = [
  'ร้องเรียน',
  'แย่',
  'ผิดหวัง',
  'โกง',
  'เสีย',
  'ปัญหา',
  'ไม่ได้รับ',
  'คืนเงิน',
  'complaint',
  'refund',
  'broken',
  'problem',
];

/** Interrogatives → priority `question`. Thai question particles + EN wh-words + '?'. */
export const QUESTION_TERMS: readonly string[] = [
  'ไหม',
  'หรือ',
  'เท่าไหร่',
  'เท่าไร',
  'อย่างไร',
  'ยังไง',
  'เมื่อไหร่',
  'ที่ไหน',
  'ทำไม',
  'อะไร',
  'how',
  'what',
  'when',
  'where',
  'why',
  'which',
  '?',
];

/** Spam heuristics → priority `spam` (link/promo keywords). First match wins. */
export const SPAM_TERMS: readonly string[] = [
  'http://',
  'https://',
  'www.',
  '.com',
  'โปรโมชั่น',
  'คลิกเลย',
  'แอดไลน์',
  'line id',
  'promo',
  'click here',
  'free money',
  'ฟรี',
];
