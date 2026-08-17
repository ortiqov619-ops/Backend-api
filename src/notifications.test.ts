import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioDecisionNotification,
  deliver,
  likeNotification,
  submissionNotification,
  usefulDrafts,
  wordDecisionNotification,
  type NotificationDraft,
  type QueryExecutor,
} from './notifications';

function draft(overrides: Partial<NotificationDraft> = {}): NotificationDraft {
  return {
    recipientUserId: 'user-1',
    actorUserId: 'user-2',
    type: 'WORD_APPROVED',
    title: 'sarlavha',
    body: 'matn',
    entityType: 'word',
    entityId: 'word-1',
    ...overrides,
  };
}

test('har bir moderator qarori foydalanuvchiga tushunarli xabar beradi', () => {
  const approved = wordDecisionNotification('approved', 'gelyatir', null);
  assert.equal(approved.type, 'WORD_APPROVED');
  assert.match(approved.body, /gelyatir/);

  const revision = wordDecisionNotification('needs_clarification', 'qarpiz', 'Ma’nosi aniq emas');
  assert.equal(revision.type, 'WORD_REVISION_REQUESTED');
  // Sabab xabar ichida ko'rinishi shart: foydalanuvchi nimani tuzatishini
  // faqat shundan biladi.
  assert.match(revision.body, /Ma’nosi aniq emas/);

  const rejected = wordDecisionNotification('rejected', 'gavun', 'Bu so‘z sheva emas');
  assert.equal(rejected.type, 'WORD_REJECTED');
  assert.match(rejected.body, /Bu so‘z sheva emas/);
});

test('sabab yo‘q bo‘lsa xabarga bo‘sh "Sabab:" qo‘shilmaydi', () => {
  for (const reason of [null, undefined, '', '   ']) {
    const message = wordDecisionNotification('rejected', 'gavun', reason);
    assert.ok(!message.body.includes('Sabab:'), `bo‘sh sabab uchun: ${JSON.stringify(reason)}`);
  }
});

test('juda uzun sabab xabarni cheksiz o‘stirmaydi', () => {
  const message = wordDecisionNotification('rejected', 'x'.repeat(200), 'y'.repeat(2_000));
  // Bazadagi `body` ustuni 600 belgi bilan cheklangan — xabar unga sig'ishi
  // kerak, aks holda qaror tranzaksiyasi yiqilardi.
  assert.ok(message.body.length <= 600, `uzunlik: ${message.body.length}`);
  assert.ok(message.title.length <= 160);
});

test('audio qarori so‘z qarori bilan aralashib ketmaydi', () => {
  assert.equal(audioDecisionNotification('approved', 'paqir', null).type, 'AUDIO_APPROVED');
  assert.equal(audioDecisionNotification('needs_clarification', 'paqir', 'shovqin').type, 'AUDIO_REVISION_REQUESTED');
  assert.equal(audioDecisionNotification('rejected', 'paqir', 'boshqa so‘z').type, 'AUDIO_REJECTED');
});

test('hisobsiz yuborilgan taklif moderatorga "Mehmon" deb ko‘rinadi', () => {
  assert.match(submissionNotification('new', 'nema', null).body, /Mehmon/);
  assert.match(submissionNotification('new', 'nema', '  ').body, /Mehmon/);
  assert.match(submissionNotification('new', 'nema', 'Dilnoza').body, /Dilnoza/);
  assert.equal(submissionNotification('resubmitted', 'nema', 'Dilnoza').type, 'WORD_RESUBMITTED');
});

test('o‘z amalidan xabar kelmaydi', () => {
  const drafts = usefulDrafts([
    draft({ recipientUserId: 'same', actorUserId: 'same' }),
    draft({ recipientUserId: 'other', actorUserId: 'same' }),
  ]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.recipientUserId, 'other');
});

test('bir odam bir xil xabarni ikki marta olmaydi', () => {
  // Moderator ham `admin`, ham `moderator` rolida bo'lsa ro'yxatga ikki
  // marta tushishi mumkin edi.
  const drafts = usefulDrafts([draft(), draft(), draft({ entityId: 'word-2' })]);
  assert.equal(drafts.length, 2);
});

test('qabul qiluvchisi yo‘q qoralama tashlab yuboriladi', () => {
  assert.equal(usefulDrafts([draft({ recipientUserId: '' })]).length, 0);
});

test('tizim xabari aktyorsiz bo‘lsa ham yetkaziladi', () => {
  const drafts = usefulDrafts([draft({ actorUserId: null, type: 'SYSTEM' })]);
  assert.equal(drafts.length, 1);
});

test('deliver faqat foydali qoralamalarni bazaga yozadi', async () => {
  const executed: unknown[][] = [];
  const executor: QueryExecutor = {
    async query(_text, values) {
      executed.push(values ?? []);
      return { rows: [], rowCount: 1 };
    },
  };

  const written = await deliver(executor, [
    draft({ recipientUserId: 'a', actorUserId: 'b' }),
    // O'ziga o'zi — yozilmaydi.
    draft({ recipientUserId: 'c', actorUserId: 'c' }),
  ]);

  assert.equal(written, 1);
  assert.equal(executed.length, 1);
  assert.equal(executed[0]?.[0], 'a');
  // `data` JSON string sifatida uzatiladi: massiv/obyektni to'g'ridan-to'g'ri
  // berish PostgreSQL massiv literaliga aylanib ketardi.
  assert.equal(typeof executed[0]?.[7], 'string');
});

test('yoqtirish xabari kimning yoqtirganini aytadi', () => {
  const message = likeNotification('Ozod', 'boldiz');
  assert.equal(message.type, 'LIKE_RECEIVED');
  assert.match(message.body, /Ozod/);
  assert.match(message.body, /boldiz/);
});

test('bo‘sh qoralama ro‘yxatida bazaga umuman murojaat qilinmaydi', async () => {
  let calls = 0;
  const executor: QueryExecutor = {
    async query() {
      calls += 1;
      return { rows: [], rowCount: 0 };
    },
  };
  assert.equal(await deliver(executor, []), 0);
  assert.equal(calls, 0);
});
