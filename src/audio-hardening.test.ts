import assert from 'node:assert/strict';
import test from 'node:test';
import { fixedWindow, normalizeExpectedText, sameAudioFingerprint } from './audio-hardening';

test('audio idempotency only accepts the same target and bytes', () => {
  const original = {
    contributionRequestId: 'request-1',
    wordId: null,
    checksumSha256: 'abc',
    mimeType: 'audio/mp4',
    durationMs: 1_200,
    expectedText: '  Gelyatir ',
  };
  assert.equal(sameAudioFingerprint(original, { ...original, expectedText: 'gelyatir' }), true);
  assert.equal(sameAudioFingerprint(original, { ...original, checksumSha256: 'different' }), false);
  assert.equal(sameAudioFingerprint(original, { ...original, contributionRequestId: 'request-2' }), false);
});

test('expected text normalization is stable for idempotent retries', () => {
  assert.equal(normalizeExpectedText('  JOLLiMi   yaxshimi  '), 'jollimi yaxshimi');
});

test('rate limit windows have deterministic reset boundaries', () => {
  assert.deepEqual(fixedWindow(901_234, 300), { windowStartMs: 900_000, resetAtMs: 1_200_000 });
});
