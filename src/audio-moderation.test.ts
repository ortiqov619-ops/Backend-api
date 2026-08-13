import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioStatusForRequestDecision,
  AudioModerationValidationError,
  isRecordableDecision,
  isSameInstant,
  parseAudioDecision,
} from './audio-moderation';

const VALID_UPDATED_AT = '2026-08-13T18:03:00.000Z';

test('approval does not require a reason', () => {
  const parsed = parseAudioDecision({ decision: 'approved', expectedUpdatedAt: VALID_UPDATED_AT });
  assert.equal(parsed.decision, 'approved');
  assert.equal(parsed.reason, null);
});

test('rejection and clarification require a reason', () => {
  for (const decision of ['rejected', 'needs_clarification']) {
    assert.throws(
      () => parseAudioDecision({ decision, expectedUpdatedAt: VALID_UPDATED_AT }),
      (error: unknown) => error instanceof AudioModerationValidationError && error.field === 'reason',
    );
    // Faqat bo'shliqdan iborat sabab ham qabul qilinmaydi.
    assert.throws(() => parseAudioDecision({ decision, reason: '   ', expectedUpdatedAt: VALID_UPDATED_AT }));
  }
});

test('unknown decisions are rejected before touching the database', () => {
  assert.throws(
    () => parseAudioDecision({ decision: 'pending', expectedUpdatedAt: VALID_UPDATED_AT }),
    (error: unknown) => error instanceof AudioModerationValidationError && error.field === 'decision',
  );
  assert.throws(() => parseAudioDecision({}));
});

test('optimistic lock timestamp is mandatory and must be parseable', () => {
  assert.throws(
    () => parseAudioDecision({ decision: 'approved' }),
    (error: unknown) => error instanceof AudioModerationValidationError && error.field === 'expectedUpdatedAt',
  );
  assert.throws(() => parseAudioDecision({ decision: 'approved', expectedUpdatedAt: 'kecha' }));
});

test('instants compare by value, not by string formatting', () => {
  assert.equal(isSameInstant(VALID_UPDATED_AT, '2026-08-13T18:03:00.000+00:00'), true);
  assert.equal(isSameInstant(VALID_UPDATED_AT, '2026-08-13T18:03:00.001Z'), false);
  assert.equal(isSameInstant(null, VALID_UPDATED_AT), false);
  assert.equal(isSameInstant(VALID_UPDATED_AT, undefined), false);
});

/** Takliflardagi «aniqlashtirish» audioni navbatdan chiqarib yubormasligi kerak. */
test('request clarification keeps the attached audio in the queue', () => {
  assert.equal(audioStatusForRequestDecision('approved'), 'approved');
  assert.equal(audioStatusForRequestDecision('rejected'), 'rejected');
  assert.equal(audioStatusForRequestDecision('needs_clarification'), 'pending');
});

test('pending is never written as a moderation decision', () => {
  assert.equal(isRecordableDecision('pending'), false);
  assert.equal(isRecordableDecision('approved'), true);
  assert.equal(isRecordableDecision('rejected'), true);
});
