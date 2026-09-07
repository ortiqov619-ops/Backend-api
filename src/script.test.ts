import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDisplayScript,
  foldScript,
  hasCyrillic,
  isDisplayScript,
  toCyrillicScript,
  toLatinScript,
} from '@xorazm/shared';

test('o‘zbek juftliklari kirilchaga to‘g‘ri o‘giriladi', () => {
  assert.equal(toCyrillicScript('shamol'), 'шамол');
  assert.equal(toCyrillicScript('choy'), 'чой');
  assert.equal(toCyrillicScript("o'g'il"), 'ўғил');
  assert.equal(toCyrillicScript('qishloq'), 'қишлоқ');
  assert.equal(toCyrillicScript('hovli'), 'ҳовли');
  assert.equal(toCyrillicScript('yashil'), 'яшил');
});

test('turli apostrof shakllari bir xil natija beradi', () => {
  for (const apostrophe of ["'", '‘', '’', 'ʻ', 'ʼ']) {
    assert.equal(toCyrillicScript(`o${apostrophe}zbek`), 'ўзбек');
  }
});

test('bosh harf saqlanadi', () => {
  assert.equal(toCyrillicScript('Xorazm'), 'Хоразм');
  assert.equal(toCyrillicScript('Shovot'), 'Шовот');
  assert.equal(toCyrillicScript("G'urlan"), 'Ғурлан');
});

test('kirilcha lotinchaga qaytadi', () => {
  assert.equal(toLatinScript('шамол'), 'shamol');
  assert.equal(toLatinScript('қишлоқ'), 'qishloq');
  assert.equal(toLatinScript('ўғил'), 'o‘g‘il');
  assert.equal(toLatinScript('Хоразм'), 'Xorazm');
});

test('lotincha matn `toLatinScript` da o‘zgarmaydi', () => {
  // Aralash ro'yxatda lotincha yozuvlar ikki marta o'girilib
  // buzilmasligi kerak.
  assert.equal(toLatinScript('gelyatir'), 'gelyatir');
  assert.equal(toLatinScript("Qo‘shko‘pir"), "Qo‘shko‘pir");
});

test('kirilcha matn `toCyrillicScript` da o‘zgarmaydi', () => {
  assert.equal(toCyrillicScript('шамол'), 'шамол');
});

test('raqam, tinish belgisi va bo‘shliq tegilmaydi', () => {
  assert.equal(toCyrillicScript('3 ta so‘z, 2024-yil.'), '3 та сўз, 2024-йил.');
});

test('bo‘sh matn xatoga olib kelmaydi', () => {
  assert.equal(toCyrillicScript(''), '');
  assert.equal(toLatinScript(''), '');
  assert.equal(applyDisplayScript('', 'cyrillic'), '');
});

test('applyDisplayScript tanlangan yozuvni qo‘llaydi', () => {
  assert.equal(applyDisplayScript('shamol', 'cyrillic'), 'шамол');
  assert.equal(applyDisplayScript('шамол', 'latin'), 'shamol');
  assert.equal(applyDisplayScript('shamol', 'latin'), 'shamol');
});

test('qidiruv kaliti ikkala yozuvda ham bir xil', () => {
  // Foydalanuvchi «шамол» deb qidirsa lotincha yozuvni ham topishi kerak.
  assert.equal(foldScript('шамол'), foldScript('shamol'));
  assert.equal(foldScript("Qo‘shko‘pir"), foldScript('Қўшкўпир'));
  assert.equal(foldScript("O'ZBEK"), foldScript('ўзбек'));
});

test('qidiruv kaliti turli so‘zlarni birlashtirmaydi', () => {
  assert.notEqual(foldScript('shamol'), foldScript('samol'));
  assert.notEqual(foldScript('qish'), foldScript('kish'));
});

test('hasCyrillic va isDisplayScript', () => {
  assert.equal(hasCyrillic('шамол'), true);
  assert.equal(hasCyrillic('shamol'), false);
  assert.equal(isDisplayScript('latin'), true);
  assert.equal(isDisplayScript('cyrillic'), true);
  assert.equal(isDisplayScript('arabic'), false);
  assert.equal(isDisplayScript(null), false);
});

// ---------------------------------------------------------------------------
// Qamrov: ilovada haqiqatan ishlatiladigan matnlar
// ---------------------------------------------------------------------------

/** IntroScreen, UpdateGate, PronunciationRecorder va alertlardan olingan. */
const APP_STRINGS = [
  'XORAZMNING OVOZI',
  'TIRIK LUG‘AT',
  'Lug‘atni ochish',
  'Lug‘at ochilmoqda…',
  'Ilovani yangilash kerak',
  'YANGI VERSIYADA',
  'Yangilanish tavsiya qilinadi',
  'O‘rnatishga ruxsat kerak',
  'Android oynasida «O‘rnatish»ni tasdiqlang.',
  'Mikrofonga ruxsat yo‘q',
  'Yozuv juda qisqa — so‘zni to‘liq talaffuz qiling.',
  'Audio avtomatik tahlildan o‘tadi, lekin yakuniy qarorni moderator qabul qiladi.',
  'Qishloq / oba / ovul / jamoa xo‘jaligi',
  'Urug‘ / laqab (ixtiyoriy)',
  'Hisobdan chiqasizmi?',
  'Bizning telegram kanal',
  'Shevalar atlasi',
  'Hali statistika yo‘q',
];

test('ilovadagi barcha matnlar kirilchaga to‘liq o‘giriladi', () => {
  for (const text of APP_STRINGS) {
    const cyrillic = toCyrillicScript(text);
    // Lotin harfi qolib ketmasligi kerak — qolsa u o'girilmagan degani.
    assert.ok(!/[a-zA-Z]/.test(cyrillic), `o‘girilmagan harf qoldi: ${text} → ${cyrillic}`);
    // Uzunlik nolga tushmasligi va matn yo'qolmasligi kerak.
    assert.ok(cyrillic.length > 0, text);
  }
});

test('tinish belgilari va qavslar o‘girishda saqlanadi', () => {
  for (const text of APP_STRINGS) {
    const cyrillic = toCyrillicScript(text);
    for (const mark of ['«', '»', '(', ')', '/', '…', '—', '?', '.', ',']) {
      assert.equal(
        cyrillic.split(mark).length, text.split(mark).length,
        `«${mark}» belgisi yo‘qoldi yoki ko‘paydi: ${text}`,
      );
    }
  }
});

test('applyDisplayScript hech qachon bo‘sh natija bermaydi', () => {
  for (const text of APP_STRINGS) {
    for (const script of ['latin', 'cyrillic'] as const) {
      assert.ok(applyDisplayScript(text, script).trim().length > 0, `${script}: ${text}`);
    }
  }
});

test('qidiruv kaliti ilovadagi matnlar uchun ikkala yozuvda mos', () => {
  for (const text of APP_STRINGS) {
    assert.equal(
      foldScript(text), foldScript(toCyrillicScript(text)),
      `qidiruv kaliti ajralib ketdi: ${text}`,
    );
  }
});
