import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPages, DEFAULT_MAX_PAGES, defaultPageKey, type PageEnvelope } from '@xorazm/shared';

type Row = { id: string };

/** Sahifalarni beradigan soxta server; nechta so'rov kelganini sanaydi. */
function pager(pages: Row[][], totalPages = pages.length) {
  let calls = 0;
  const load = async (page: number): Promise<PageEnvelope<Row>> => {
    calls += 1;
    return { items: pages[page - 1] ?? [], meta: { totalPages } };
  };
  return { load, callCount: () => calls };
}

test('barcha sahifalar yig‘iladi — 100 talik chegara yo‘q', () => {
  const pages = Array.from({ length: 3 }, (_, p) =>
    Array.from({ length: 100 }, (_, i) => ({ id: `p${p}-${i}` })));
  return collectPages(pager(pages).load).then((items) => {
    assert.equal(items.length, 300);
  });
});

test('har bir sahifa aynan bir marta so‘raladi', async () => {
  const source = pager([[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]]);
  await collectPages(source.load);
  assert.equal(source.callCount(), 3);
});

test('sahifalar orasida qo‘shilgan yozuv dublikat bermaydi', async () => {
  // Haqiqiy poyga: 1-sahifa olingandan keyin yangi so'z qo'shiladi,
  // ro'yxat suriladi va `a` 2-sahifada ham chiqadi.
  const load = async (page: number): Promise<PageEnvelope<Row>> => (
    page === 1
      ? { items: [{ id: 'a' }, { id: 'b' }], meta: { totalPages: 2 } }
      : { items: [{ id: 'b' }, { id: 'c' }], meta: { totalPages: 2 } }
  );
  const items = await collectPages(load);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c']);
});

test('buzilgan totalPages cheksiz siklga olib kelmaydi', async () => {
  for (const broken of [Number.NaN, Infinity, -5, undefined as unknown as number]) {
    const source = pager([[{ id: 'x' }]], broken);
    const items = await collectPages(source.load);
    // Yaroqsiz meta bitta sahifaga tushiriladi.
    assert.ok(source.callCount() <= DEFAULT_MAX_PAGES, `so‘rov soni oshib ketdi: ${source.callCount()}`);
    assert.equal(items.length, 1);
  }
});

test('juda katta totalPages qattiq chegara bilan cheklanadi', async () => {
  const source = pager([[{ id: 'x' }]], 10_000);
  await collectPages(source.load, { maxPages: 5 });
  assert.equal(source.callCount(), 5);
});

test('bo‘sh javob va yo‘q items yiqilmaydi', async () => {
  const load = async (): Promise<PageEnvelope<Row>> => ({ items: undefined as unknown as Row[], meta: { totalPages: 1 } });
  assert.deepEqual(await collectPages(load), []);
});

test('idsiz elementlar filtrlanmaydi', async () => {
  // Kalitsiz turlar (masalan audit qatorlari) yo'qolib qolmasligi kerak.
  const load = async (): Promise<PageEnvelope<{ name: string }>> => ({
    items: [{ name: 'a' }, { name: 'a' }], meta: { totalPages: 1 },
  });
  assert.equal((await collectPages(load)).length, 2);
});

test('ichki kalit bilan dublikat aniqlanadi', async () => {
  type Nested = { submission: { id: string } };
  const load = async (page: number): Promise<PageEnvelope<Nested>> => (
    page === 1
      ? { items: [{ submission: { id: 'a' } }], meta: { totalPages: 2 } }
      : { items: [{ submission: { id: 'a' } }, { submission: { id: 'b' } }], meta: { totalPages: 2 } }
  );
  const items = await collectPages(load, { keyOf: (item) => item.submission.id });
  assert.deepEqual(items.map((item) => item.submission.id), ['a', 'b']);
});

test('defaultPageKey faqat matnli id ni oladi', () => {
  assert.equal(defaultPageKey({ id: 'a' }), 'a');
  assert.equal(defaultPageKey({ id: 7 }), null);
  assert.equal(defaultPageKey({}), null);
  assert.equal(defaultPageKey(null), null);
});
