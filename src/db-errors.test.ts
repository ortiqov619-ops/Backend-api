import assert from 'node:assert/strict';
import test from 'node:test';
import { translateDatabaseError } from './db-errors';

/** Production incidentining aynan o'zi: audio tasdiqlash `500` bergan. */
test('42P08 is reported as a server defect, not as user error', () => {
  const fault = translateDatabaseError({ code: '42P08', message: 'inconsistent types deduced for parameter $2' });
  assert.equal(fault?.status, 500);
  assert.equal(fault?.serverDefect, true);
});

test('unique violations become 409 with a constraint specific message', () => {
  const word = translateDatabaseError({ code: '23505', constraint: 'words_unique_phonetic_per_region' });
  assert.equal(word?.status, 409);
  assert.match(String(word?.message), /allaqachon mavjud/);

  const audio = translateDatabaseError({ code: '23505', constraint: 'audio_submissions_one_per_request' });
  assert.equal(audio?.status, 409);
  assert.match(String(audio?.message), /audio allaqachon biriktirilgan/i);
});

test('unknown constraint still yields a safe generic message', () => {
  const fault = translateDatabaseError({ code: '23505', constraint: 'some_new_index' });
  assert.equal(fault?.status, 409);
  assert.equal(fault?.message, 'Bunday yozuv allaqachon mavjud.');
});

test('data faults map to 422 and never leak the driver message', () => {
  for (const code of ['23502', '23503', '23514', '22P02', '22001', '22003']) {
    const fault = translateDatabaseError({ code, message: 'Key (word)=(gelyatir) already exists', detail: 'maxfiy' });
    assert.equal(fault?.status, 422, `${code} → 422 bo‘lishi kerak`);
    assert.equal(fault?.serverDefect, false);
    assert.doesNotMatch(String(fault?.message), /gelyatir|maxfiy|Key \(/);
  }
});

test('lock and serialization faults are retryable conflicts', () => {
  for (const code of ['40001', '40P01', '55P03']) {
    assert.equal(translateDatabaseError({ code })?.status, 409);
  }
});

test('database availability faults map to 503', () => {
  for (const code of ['53300', '57014', '08006']) {
    assert.equal(translateDatabaseError({ code })?.status, 503);
  }
});

test('unknown or non-database errors fall through to the caller', () => {
  assert.equal(translateDatabaseError(new Error('tarmoq uzildi')), null);
  assert.equal(translateDatabaseError({ code: 'ZZZZZ' }), null);
  assert.equal(translateDatabaseError(null), null);
});
