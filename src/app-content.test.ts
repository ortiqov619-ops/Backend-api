import assert from 'node:assert/strict';
import test from 'node:test';
import { appContentLinkUrl, FALLBACK_APP_CONTENT } from '@xorazm/shared';
import { AppContentValidationError, parseAppContentUpdate } from './app-content';

const reason = { changeReason: 'test' };

test('telegram kanali @handle, t.me havolasi va yalang‘och nomdan yig‘iladi', () => {
  for (const value of ['@xorazmshevalari', 'xorazmshevalari', 'https://t.me/xorazmshevalari', 't.me/xorazmshevalari/']) {
    assert.equal(appContentLinkUrl('telegram_channel', value), 'https://t.me/xorazmshevalari');
  }
});

test('yopiq telegram guruh havolasi ham qabul qilinadi', () => {
  assert.equal(appContentLinkUrl('telegram_group', 'https://t.me/+AbCdEf12345'), 'https://t.me/+AbCdEf12345');
  assert.equal(appContentLinkUrl('telegram_group', 'joinchat/AbCdEf12345'), 'https://t.me/joinchat/AbCdEf12345');
});

test('telefon raqam `tel:` sxemasiga aylanadi', () => {
  assert.equal(appContentLinkUrl('phone', '+998 90 123 45 67'), 'tel:+998901234567');
  assert.equal(appContentLinkUrl('phone', '(62) 224-11-22'), 'tel:622241122');
});

test('instagram profili to‘liq manzilga aylanadi', () => {
  assert.equal(appContentLinkUrl('instagram', '@xorazm.shevalari'), 'https://instagram.com/xorazm.shevalari');
  assert.equal(appContentLinkUrl('instagram', 'https://www.instagram.com/xorazm.shevalari/'), 'https://instagram.com/xorazm.shevalari');
});

test('sxemasiz sayt https ga keltiriladi', () => {
  assert.equal(appContentLinkUrl('website', 'xorazm-shevalari.uz'), 'https://xorazm-shevalari.uz');
  assert.equal(appContentLinkUrl('website', 'http://xorazm.uz/haqida'), 'https://xorazm.uz/haqida');
  assert.equal(appContentLinkUrl('website', 'https://xorazm.uz/haqida?x=1'), 'https://xorazm.uz/haqida?x=1');
});

test('xavfli sxema hech qachon havolaga aylanmaydi', () => {
  // Ilova bu qiymatni `Linking.openURL` ga beradi, shuning uchun
  // `javascript:` va `intent:` serverdan chiqmasligi shart.
  for (const value of [
    'javascript:alert(1)',
    'intent://evil',
    'file:///etc/passwd',
    'data:text/html,x',
    'JavaScript:alert(1)',
    'https://xorazm.uz" onclick="x',
  ]) {
    assert.equal(appContentLinkUrl('link', value), null, value);
  }
});

test('bo‘sh va tushunarsiz qiymat rad etiladi', () => {
  assert.equal(appContentLinkUrl('telegram_channel', '  '), null);
  assert.equal(appContentLinkUrl('telegram_channel', 'a'), null);
  assert.equal(appContentLinkUrl('phone', 'qo‘ng‘iroq qiling'), null);
  assert.equal(appContentLinkUrl('website', 'localhost'), null);
});

test('sarlavha va matn tozalanib qaytadi', () => {
  const parsed = parseAppContentUpdate({ ...reason, title: '  Biz   haqimizda ', body: ' Xorazm lug‘ati.  ' });
  assert.equal(parsed.title, 'Biz haqimizda');
  assert.equal(parsed.body, 'Xorazm lug‘ati.');
});

test('bo‘sh yoki juda uzun sarlavha rad etiladi', () => {
  for (const title of ['', '   ', 'x'.repeat(161)]) {
    assert.throws(
      () => parseAppContentUpdate({ ...reason, title }),
      (error: unknown) => error instanceof AppContentValidationError && error.field === 'title',
    );
  }
});

test('havola serverda hisoblangan url bilan qaytadi', () => {
  const parsed = parseAppContentUpdate({
    ...reason,
    links: [{ kind: 'telegram_channel', label: 'Bizning telegram kanal', value: '@xorazmshevalari' }],
  });
  assert.deepEqual(parsed.links, [{
    id: null,
    kind: 'telegram_channel',
    label: 'Bizning telegram kanal',
    value: '@xorazmshevalari',
    url: 'https://t.me/xorazmshevalari',
    sortOrder: 0,
    isActive: true,
  }]);
});

test('mijoz yuborgan `url` e’tiborga olinmaydi', () => {
  const parsed = parseAppContentUpdate({
    ...reason,
    links: [{ kind: 'website', label: 'Sayt', value: 'xorazm.uz', url: 'javascript:alert(1)' }],
  });
  assert.equal(parsed.links?.[0]?.url, 'https://xorazm.uz');
});

test('noto‘g‘ri tur, nom va qiymat maydon bilan birga xato beradi', () => {
  assert.throws(
    () => parseAppContentUpdate({ ...reason, links: [{ kind: 'sms', label: 'x', value: 'y' }] }),
    (error: unknown) => error instanceof AppContentValidationError && error.field === 'links.0.kind',
  );
  assert.throws(
    () => parseAppContentUpdate({ ...reason, links: [{ kind: 'link', label: '', value: 'xorazm.uz' }] }),
    (error: unknown) => error instanceof AppContentValidationError && error.field === 'links.0.label',
  );
  assert.throws(
    () => parseAppContentUpdate({ ...reason, links: [{ kind: 'phone', label: 'Qo‘ng‘iroq', value: 'yo‘q' }] }),
    (error: unknown) => error instanceof AppContentValidationError && error.field === 'links.0.value',
  );
});

test('havolalar soni cheklangan', () => {
  const links = Array.from({ length: 25 }, (_, index) => ({ kind: 'link', label: `L${index}`, value: 'xorazm.uz' }));
  assert.throws(
    () => parseAppContentUpdate({ ...reason, links }),
    (error: unknown) => error instanceof AppContentValidationError && error.field === 'links',
  );
});

test('berilmagan maydon o‘zgarmaydi (qisman yangilash)', () => {
  const parsed = parseAppContentUpdate({ ...reason, title: 'Faqat sarlavha' });
  assert.equal(parsed.body, undefined);
  assert.equal(parsed.links, undefined);
});

test('lokal fallback bo‘sh emas', () => {
  assert.ok(FALLBACK_APP_CONTENT.title.length > 0);
  assert.ok(FALLBACK_APP_CONTENT.body.length > 0);
  assert.deepEqual(FALLBACK_APP_CONTENT.links, []);
});
