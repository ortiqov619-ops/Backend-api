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
