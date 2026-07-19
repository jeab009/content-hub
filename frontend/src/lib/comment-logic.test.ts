import { describe, expect, it } from '@jest/globals';
import type { Comment } from '@/lib/api-client';
import {
  buildCommentQuery,
  canReply,
  canSubmitReply,
  insertTemplate,
  isSlaBreached,
  MAX_REPLY_MESSAGE_LENGTH,
  remainingReplyChars,
} from '@/lib/comment-logic';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    postId: 'post-1',
    platform: 'facebook',
    author: 'Jane',
    text: 'Great video!',
    sentiment: 'positive',
    sentimentSource: 'rule_based',
    priority: 'question',
    slaDueAt: '2026-07-19T12:00:00.000Z',
    slaBreach: false,
    replyable: true,
    repliedAt: null,
    replyText: null,
    collectedAt: '2026-07-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildCommentQuery', () => {
  it('returns an empty string when no filters are set', () => {
    expect(buildCommentQuery()).toBe('');
    expect(buildCommentQuery({})).toBe('');
  });

  it('emits only the whitelisted params that are set', () => {
    const qs = buildCommentQuery({ platform: 'youtube', priority: 'complaint' });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('platform')).toBe('youtube');
    expect(params.get('priority')).toBe('complaint');
    expect(params.get('sentiment')).toBeNull();
  });

  it('serializes boolean and numeric filters as strings', () => {
    const qs = buildCommentQuery({ slaBreach: true, replied: false, page: 2, pageSize: 50 });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('slaBreach')).toBe('true');
    expect(params.get('replied')).toBe('false');
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe('50');
  });

  it('keeps a false boolean rather than dropping it (undefined-only omission)', () => {
    expect(buildCommentQuery({ slaBreach: false })).toBe('?slaBreach=false');
  });
});

describe('isSlaBreached', () => {
  const now = new Date('2026-07-19T13:00:00.000Z');

  it('is true when past due and unreplied', () => {
    expect(isSlaBreached(comment({ slaDueAt: '2026-07-19T12:00:00.000Z' }), now)).toBe(true);
  });

  it('is false when the due date is still in the future', () => {
    expect(isSlaBreached(comment({ slaDueAt: '2026-07-19T14:00:00.000Z' }), now)).toBe(false);
  });

  it('is false once the comment has been replied to, even if overdue', () => {
    expect(
      isSlaBreached(
        comment({ slaDueAt: '2026-07-19T12:00:00.000Z', repliedAt: '2026-07-19T12:30:00.000Z' }),
        now,
      ),
    ).toBe(false);
  });

  it('is false for a comment with no SLA clock (spam)', () => {
    expect(isSlaBreached(comment({ slaDueAt: null, priority: 'spam' }), now)).toBe(false);
  });
});

describe('canReply', () => {
  it('is true for a replyable, unreplied comment', () => {
    expect(canReply(comment())).toBe(true);
  });

  it('is false when the comment is not replyable', () => {
    expect(canReply(comment({ replyable: false }))).toBe(false);
  });

  it('is false when the comment was already replied to', () => {
    expect(canReply(comment({ repliedAt: '2026-07-19T12:30:00.000Z' }))).toBe(false);
  });
});

describe('canSubmitReply', () => {
  it('is disabled without a message', () => {
    expect(canSubmitReply({ message: '   ', password: 'secret' })).toBe(false);
  });

  it('is disabled without a password', () => {
    expect(canSubmitReply({ message: 'Thanks!', password: '  ' })).toBe(false);
  });

  it('is enabled with both a message and a password', () => {
    expect(canSubmitReply({ message: 'Thanks!', password: 'secret' })).toBe(true);
  });

  it('is disabled when the message exceeds the length cap', () => {
    const tooLong = 'x'.repeat(MAX_REPLY_MESSAGE_LENGTH + 1);
    expect(canSubmitReply({ message: tooLong, password: 'secret' })).toBe(false);
  });
});

describe('remainingReplyChars', () => {
  it('counts down from the cap', () => {
    expect(remainingReplyChars('hello')).toBe(MAX_REPLY_MESSAGE_LENGTH - 5);
  });

  it('goes negative past the cap', () => {
    expect(remainingReplyChars('x'.repeat(MAX_REPLY_MESSAGE_LENGTH + 3))).toBe(-3);
  });
});

describe('insertTemplate', () => {
  it('replaces an empty draft with the template body', () => {
    expect(insertTemplate('', 'Thanks for reaching out!')).toBe('Thanks for reaching out!');
    expect(insertTemplate('   ', 'Hello')).toBe('Hello');
  });

  it('appends after a blank line when there is existing text', () => {
    expect(insertTemplate('Hi there', 'Regards, Team')).toBe('Hi there\n\nRegards, Team');
  });

  it('trims trailing whitespace before appending', () => {
    expect(insertTemplate('Hi there   \n', 'Regards')).toBe('Hi there\n\nRegards');
  });
});
