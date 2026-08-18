import dotenv from 'dotenv';

dotenv.config({ path: process.env.API_ENV_FILE ?? '.env' });

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} muhit o‘zgaruvchisi kiritilmagan.`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: env('DATABASE_URL'),
  jwtSecret: env('ADMIN_JWT_SECRET'),
  integrationMasterKey: env('INTEGRATION_MASTER_KEY'),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:8081,http://localhost:19006').split(',').map((item) => item.trim()).filter(Boolean),
  storageMode: process.env.AUDIO_STORAGE_MODE === 'supabase' ? 'supabase' as const : 'local' as const,
  uploadDir: process.env.AUDIO_UPLOAD_DIR ?? './var/uploads',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'xorazm-audio',
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3',
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL
    ?? process.env.RENDER_EXTERNAL_URL
    ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`
  ).replace(/\/+$/, ''),
  /** CI reliz nashr qilish uchun mashinaviy token. Bo'sh bo'lsa endpoint yopiq. */
  releaseToken: process.env.RELEASE_TOKEN,
  /** FCM service account (xom JSON yoki base64). Bo'sh bo'lsa push o'chirilgan. */
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  /** APK fayllari saqlanadigan katalog. Renderda doimiy diskda bo'lishi shart. */
  apkDir: process.env.APK_UPLOAD_DIR ?? './var/apk',
  /** Har bir ilova turi uchun diskda saqlanadigan reliz soni. */
  apkRetention: Math.max(1, Number(process.env.APK_RETENTION ?? 5)),
  /**
   * APK yuklab olish manzilining ochiq bazasi.
   *
   * Odatda bu Cloudflare Worker manzili bo'ladi: telefon Render'ga
   * to'g'ridan-to'g'ri ulanganda O'zbekistondan TCP ~15 soniya oladi,
   * Cloudflare orqali esa ~0.2 soniya. 35 MB faylni yuklab olishda bu
   * farq juda katta.
   */
  publicDownloadBaseUrl: (process.env.PUBLIC_DOWNLOAD_BASE_URL ?? '').replace(/\/+$/, ''),
  trustProxy: process.env.TRUST_PROXY === 'true'
    || Boolean(process.env.RENDER)
    || Boolean(process.env.RAILWAY_ENVIRONMENT),
};

export function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const usesSupabase = config.storageMode === 'supabase' && !!config.supabaseUrl && !!config.supabaseServiceRoleKey;
  const usesPersistentDisk = config.storageMode === 'local'
    && (Boolean(process.env.RENDER) || Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH))
    && (config.uploadDir.startsWith('/var/data/') || config.uploadDir.startsWith('/data/'));
  if (!usesSupabase && !usesPersistentDisk) {
    throw new Error('Production audio uchun Supabase Storage yoki hostingning doimiy diski majburiy.');
  }
}
