/**
 * Yangilanish qarorining sof (bazasiz) mantiqi.
 *
 * Bu yerdagi yagona muhim qoida: taqqoslash HAR DOIM butun son
 * `versionCode` bo'yicha bajariladi. `versionName` ("1.2.4") faqat
 * ko'rsatish uchun — uni matn sifatida solishtirish "1.10" ni "1.9" dan
 * kichik deb hisoblaydi va reliz oqimini jimgina buzadi.
 */

export type AppType = 'USER' | 'ADMIN';
export type AppPlatform = 'ANDROID' | 'IOS';
export type UpdateType = 'OPTIONAL' | 'RECOMMENDED' | 'REQUIRED';

export const APP_TYPES: readonly AppType[] = ['USER', 'ADMIN'];
export const PLATFORMS: readonly AppPlatform[] = ['ANDROID', 'IOS'];
export const UPDATE_TYPES: readonly UpdateType[] = ['OPTIONAL', 'RECOMMENDED', 'REQUIRED'];

export class ReleaseValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'ReleaseValidationError';
  }
}

export interface ReleaseView {
  versionName: string;
  versionCode: number;
  minimumSupportedVersionCode: number;
  updateType: UpdateType;
  downloadUrl: string | null;
  fileSize: number | null;
  sha256: string | null;
  releaseNotes: string[];
  publishedAt: string;
}

export type UpdateDecision =
  | { updateAvailable: false; current: true; latestVersionCode?: number; latestVersionName?: string }
  | {
      updateAvailable: true;
      current: false;
      updateType: UpdateType;
      latestVersionName: string;
      latestVersionCode: number;
      minimumSupportedVersionCode: number;
      downloadUrl: string | null;
      fileSize: number | null;
      sha256: string | null;
      releaseNotes: string[];
      publishedAt: string;
    };

/**
 * O'rnatilgan versiyani eng yangi faol reliz bilan solishtiradi.
 *
 * Uchta holat ataylab shu tartibda tekshiriladi:
 *
 * 1. Reliz umuman yo'q — ilova hech qachon "eskirgan" deb belgilanmaydi.
 *    Bu yangi o'rnatilgan backend uchun muhim: bo'sh jadval butun
 *    foydalanuvchi bazasini bloklab qo'ymasligi kerak.
 * 2. O'rnatilgan versiya relizdan yangi yoki teng — yangilanish yo'q. Bu
 *    sinov (staging) buildlarini ham to'g'ri hal qiladi: ular odatda
 *    productiondan yuqori `versionCode` bilan yuriladi.
 * 3. Qolganda — yangilanish bor va uning majburiyligi hisoblanadi.
 */
export function decideUpdate(installedVersionCode: number, release: ReleaseView | null): UpdateDecision {
  if (!release) return { updateAvailable: false, current: true };
  if (!Number.isFinite(installedVersionCode)) {
    // Noto'g'ri kirish ilovani bloklamasligi kerak.
    return { updateAvailable: false, current: true, latestVersionCode: release.versionCode, latestVersionName: release.versionName };
  }
  if (installedVersionCode >= release.versionCode) {
    return {
      updateAvailable: false,
      current: true,
      latestVersionCode: release.versionCode,
      latestVersionName: release.versionName,
    };
  }

  return {
    updateAvailable: true,
    current: false,
    updateType: effectiveUpdateType(installedVersionCode, release),
    latestVersionName: release.versionName,
    latestVersionCode: release.versionCode,
    minimumSupportedVersionCode: release.minimumSupportedVersionCode,
    downloadUrl: release.downloadUrl,
    fileSize: release.fileSize,
    sha256: release.sha256,
    releaseNotes: release.releaseNotes,
    publishedAt: release.publishedAt,
  };
}

/**
 * Qaysi darajadagi yangilanish ekanini aniqlaydi.
 *
 * `minimumSupportedVersionCode` relizdagi `updateType` dan kuchliroq: eski
 * versiya qo'llab-quvvatlanmasa, reliz "ixtiyoriy" deb belgilangan bo'lsa
 * ham u majburiy bo'lib qoladi.
 */
export function effectiveUpdateType(installedVersionCode: number, release: ReleaseView): UpdateType {
  if (installedVersionCode < release.minimumSupportedVersionCode) return 'REQUIRED';
  return release.updateType;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface ParsedRelease {
  appType: AppType;
  platform: AppPlatform;
  versionName: string;
  versionCode: number;
  minimumSupportedVersionCode: number;
  updateType: UpdateType;
  downloadUrl: string | null;
  fileSize: number | null;
  sha256: string | null;
  releaseNotes: string[];
}

/**
 * CI yoki admin yuborgan reliz tavsifini tekshiradi.
 *
 * Android relizi uchun checksum majburiy: usiz mobil ilova yuklab olgan
 * faylni tekshira olmaydi va buzilgan yoki almashtirilgan APK'ni
 * o'rnatishga urinadi.
 */
export function parseReleaseInput(input: unknown, options: { requireArtifact?: boolean } = {}): ParsedRelease {
  const body = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};

  const appType = text(body.appType).toUpperCase() as AppType;
  if (!APP_TYPES.includes(appType)) throw new ReleaseValidationError('appType', 'appType USER yoki ADMIN bo‘lishi kerak.');

  const platform = (text(body.platform).toUpperCase() || 'ANDROID') as AppPlatform;
  if (!PLATFORMS.includes(platform)) throw new ReleaseValidationError('platform', 'platform ANDROID yoki IOS bo‘lishi kerak.');

  const versionName = text(body.versionName);
  if (!versionName || versionName.length > 40) throw new ReleaseValidationError('versionName', 'versionName noto‘g‘ri.');

  const versionCode = positiveInt(body.versionCode);
  if (!versionCode) throw new ReleaseValidationError('versionCode', 'versionCode musbat butun son bo‘lishi kerak.');

  // Diqqat: `text()` son uchun bo'sh satr qaytaradi, shuning uchun uni
  // "qiymat berilmagan" belgisi sifatida ishlatib bo'lmaydi — aks holda
  // raqam bilan yuborilgan minimum jimgina nolga aylanardi.
  const rawMinimum = body.minimumSupportedVersionCode;
  const minimumProvided = rawMinimum !== undefined
    && rawMinimum !== null
    && !(typeof rawMinimum === 'string' && rawMinimum.trim() === '');
  const minimumSupportedVersionCode = minimumProvided ? Number(rawMinimum) : 0;
  if (!Number.isSafeInteger(minimumSupportedVersionCode) || minimumSupportedVersionCode < 0) {
    throw new ReleaseValidationError('minimumSupportedVersionCode', 'minimumSupportedVersionCode manfiy bo‘lmagan butun son bo‘lishi kerak.');
  }
  // Eng yangi relizning o'zi "qo'llab-quvvatlanmaydi" bo'lib qolishi
  // mumkin emas — bu hamma foydalanuvchini chiqib bo'lmas ekranda qoldirardi.
  if (minimumSupportedVersionCode > versionCode) {
    throw new ReleaseValidationError('minimumSupportedVersionCode', 'minimumSupportedVersionCode versionCode dan katta bo‘la olmaydi.');
  }

  const updateType = (text(body.updateType).toUpperCase() || 'OPTIONAL') as UpdateType;
  if (!UPDATE_TYPES.includes(updateType)) throw new ReleaseValidationError('updateType', 'updateType noto‘g‘ri.');

  const downloadUrl = text(body.downloadUrl) || null;
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) {
    // Faqat HTTPS: APK'ni ochiq kanal orqali yuklab olish uni yo'lda
    // almashtirishga imkon berardi.
    throw new ReleaseValidationError('downloadUrl', 'downloadUrl faqat HTTPS bo‘lishi mumkin.');
  }

  const sha256 = text(body.sha256).toLowerCase() || null;
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) throw new ReleaseValidationError('sha256', 'sha256 64 belgili o‘n oltilik qiymat bo‘lishi kerak.');

  const fileSize = body.fileSize === undefined || body.fileSize === null ? null : positiveInt(body.fileSize);
  if (body.fileSize !== undefined && body.fileSize !== null && fileSize === null) {
    throw new ReleaseValidationError('fileSize', 'fileSize musbat butun son bo‘lishi kerak.');
  }

  if (options.requireArtifact && platform === 'ANDROID' && (!downloadUrl || !sha256 || !fileSize)) {
    throw new ReleaseValidationError('sha256', 'Android relizi uchun downloadUrl, sha256 va fileSize majburiy.');
  }

  const rawNotes = Array.isArray(body.releaseNotes) ? body.releaseNotes : [];
  const releaseNotes = rawNotes
    .map((note) => text(note))
    .filter((note) => note.length > 0)
    .slice(0, 20)
    .map((note) => note.slice(0, 240));

  return {
    appType,
    platform,
    versionName,
    versionCode,
    minimumSupportedVersionCode,
    updateType,
    downloadUrl,
    fileSize,
    sha256,
    releaseNotes,
  };
}

/** Push xabari matni — ilova turiga qarab. */
export function updateNotificationText(appType: AppType, versionName: string): { title: string; body: string } {
  return appType === 'ADMIN'
    ? {
        title: 'Xorazm Shevalari Admin yangilandi',
        body: `Admin ilovasining ${versionName} versiyasi tayyor.`,
      }
    : {
        title: 'Xorazm Shevalari yangilandi',
        body: `${versionName} versiyasi mavjud. Yangi versiyani o‘rnating.`,
      };
}

/** FCM mavzusi (topic). USER va ADMIN hech qachon aralashmaydi. */
export function updateTopic(appType: AppType, platform: AppPlatform): string {
  return `xorazim-${appType.toLowerCase()}-${platform.toLowerCase()}`;
}
