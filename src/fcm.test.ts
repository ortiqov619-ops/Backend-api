import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServiceAccount, sendUpdateToTopic } from './fcm';

test('sozlanmagan push jim va xavfsiz o‘tadi', async () => {
  // Reliz push'siz ham to'liq haqiqiy bo'lib qoladi.
  const result = await sendUpdateToTopic(null, 'xorazim-user-android', { title: 'a', body: 'b' }, {});
  assert.equal(result.attempted, false);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_configured');
});

test('bo‘sh yoki buzuq service account null beradi', () => {
  for (const value of [undefined, '', '   ', 'salom', '{}', '{"project_id":"x"}']) {
    assert.equal(parseServiceAccount(value), null, `qiymat: ${JSON.stringify(value)}`);
  }
});

test('xom JSON service account o‘qiladi', () => {
  const account = parseServiceAccount(JSON.stringify({
    project_id: 'xorazm-test',
    client_email: 'ci@xorazm.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n',
  }));
  assert.equal(account?.projectId, 'xorazm-test');
  // `\n` ketma-ketligi haqiqiy qator uzilishiga aylanishi kerak, aks holda
  // kalitni o'qib bo'lmaydi.
  assert.ok(account?.privateKey.includes('\n'));
});

test('base64 service account ham o‘qiladi', () => {
  // Render'da ko'p qatorli JSON'ni env sifatida saqlash noqulay.
  const raw = JSON.stringify({
    project_id: 'xorazm-test',
    client_email: 'ci@xorazm.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  });
  const account = parseServiceAccount(Buffer.from(raw).toString('base64'));
  assert.equal(account?.projectId, 'xorazm-test');
});
