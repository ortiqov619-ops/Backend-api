import { createSign } from 'node:crypto';

/**
 * Firebase Cloud Messaging — HTTP v1.
 *
 * Yangi bog'liqlik qo'shilmadi: OAuth tokeni service account kaliti bilan
 * `node:crypto` orqali imzolanadi. `firebase-admin` paketi bu ish uchun
 * juda katta va u butun boshqa ekotizimni tortib keladi.
 *
 * MUHIM: service account kaliti FAQAT serverda yashaydi. U mobil ilovaga
 * hech qachon tushmaydi va repozitoriyga yozilmaydi.
 *
 * Push — yordamchi kanal. U sozlanmagan bo'lsa ham yangilanish tizimi
 * to'liq ishlaydi, chunki ilova har ochilganda versiyani o'zi so'raydi.
 * Shuning uchun bu modul hech qachon chaqiruvchini yiqitmaydi.
 */

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface PushResult {
  attempted: boolean;
  sent: boolean;
  /** Xatoning qisqa sababi — logga tushadi, mijozga chiqmaydi. */
  reason?: string;
}

/**
 * `FIREBASE_SERVICE_ACCOUNT` ni o'qiydi.
 *
 * Ikkala shakl ham qabul qilinadi: xom JSON va base64. Render kabi
 * platformalarda ko'p qatorli JSON'ni muhit o'zgaruvchisiga joylash
 * noqulay, shuning uchun base64 amalda ishonchliroq.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;
  let json = value;
  if (!value.startsWith('{')) {
    try {
      json = Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const projectId = String(parsed.project_id ?? '');
    const clientEmail = String(parsed.client_email ?? '');
    const privateKey = String(parsed.private_key ?? '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey.includes('BEGIN')) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Google OAuth uchun imzolangan JWT. */
function signJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(account.privateKey))}`;
}

// Token bir soat amal qiladi. Har push uchun yangi token so'rash keraksiz
// kechikish va Google tomonida keraksiz yuk bo'lardi.
let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(account),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`oauth_failed_${response.status}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('oauth_no_token');
  cachedToken = {
    value: payload.access_token,
    expiresAtMs: Date.now() + (payload.expires_in ?? 3600) * 1_000,
  };
  return cachedToken.value;
}

/**
 * Mavzuga (topic) xabar yuboradi.
 *
 * Mavzu USER va ADMIN uchun alohida, shuning uchun bir ilovaning
 * yangilanishi ikkinchisiga hech qachon bormaydi.
 *
 * Xato tashlanmaydi: reliz allaqachon bazada saqlangan va u haqiqiy.
 * Push yuborilmagani relizni bekor qilish sababi emas — ilovalar
 * yangilanishni keyingi ochilishda baribir topadi.
 */
export async function sendUpdateToTopic(
  account: ServiceAccount | null,
  topic: string,
  message: { title: string; body: string },
  data: Record<string, string>,
): Promise<PushResult> {
  if (!account) return { attempted: false, sent: false, reason: 'not_configured' };
  try {
    const token = await accessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            topic,
            notification: { title: message.title, body: message.body },
            // `data` faqat ishora: ilova uni ko'rgach backenddan qayta
            // so'raydi va haqiqat manbai sifatida server javobini oladi.
            data,
            android: { priority: 'high' },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (response.ok) return { attempted: true, sent: true };
    // Javob matni logga tushadi, lekin unda kalit bo'lmaydi.
    return { attempted: true, sent: false, reason: `http_${response.status}` };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown';
    return { attempted: true, sent: false, reason: reason.slice(0, 120) };
  }
}
