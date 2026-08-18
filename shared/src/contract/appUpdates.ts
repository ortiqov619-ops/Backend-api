import type { IsoDateTime, Uuid } from './common';

/**
 * Ilova yangilanishi.
 *
 * USER va ADMIN ilovalari alohida yo'llarda yuradi: har bir so'rovda
 * `appType` majburiy va server hech qachon bir ilovaning relizini
 * ikkinchisiga qaytarmaydi.
 */

export type AppType = 'USER' | 'ADMIN';
export type AppPlatform = 'ANDROID' | 'IOS';
export type UpdateType = 'OPTIONAL' | 'RECOMMENDED' | 'REQUIRED';

/** GET /app-updates/check */
export interface UpdateCheckQuery {
  appType: AppType;
  platform: AppPlatform;
  /** Taqqoslash faqat shu butun son bo'yicha bajariladi. */
  versionCode: number;
}

export interface UpdateNotAvailable {
  updateAvailable: false;
  current: true;
  latestVersionName?: string;
  latestVersionCode?: number;
}

export interface UpdateAvailable {
  updateAvailable: true;
  current: false;
  updateType: UpdateType;
  latestVersionName: string;
  latestVersionCode: number;
  minimumSupportedVersionCode: number;
  /** Android: APK manzili. iOS: do'kon havolasi. */
  downloadUrl: string | null;
  fileSize: number | null;
  /** Yuklab olingan fayl shu qiymat bilan tekshiriladi. */
  sha256: string | null;
  releaseNotes: string[];
  publishedAt: IsoDateTime;
}

export type UpdateCheckResponse = UpdateNotAvailable | UpdateAvailable;

/** POST /devices/register */
export interface DeviceRegistrationRequest {
  installationId: string;
  appType: AppType;
  platform: AppPlatform;
  appVersionName: string;
  appVersionCode: number;
  fcmToken?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
}

export interface DeviceRegistrationResponse {
  registered: true;
  /** Ro'yxatdan o'tish bilan birga yangilanish holati ham qaytadi. */
  update: UpdateCheckResponse;
}

/** POST /devices/refresh-token */
export interface DeviceTokenRefreshRequest {
  installationId: string;
  appType: AppType;
  fcmToken: string;
}

/** Admin panelidagi reliz yozuvi. */
export interface AppRelease {
  id: Uuid;
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
  isActive: boolean;
  publishedAt: IsoDateTime;
  publishedVia: string;
  /** Shu relizni ishlatayotgan qurilmalar soni. */
  deviceCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AppReleaseListResponse {
  items: AppRelease[];
}

/** PATCH /admin/app-releases/:id */
export interface UpdateAppReleaseRequest {
  updateType?: UpdateType;
  minimumSupportedVersionCode?: number;
  releaseNotes?: string[];
  /** `false` — relizni bekor qilish (rollback). */
  isActive?: boolean;
  /** Audit uchun majburiy. */
  changeReason: string;
}

export interface AppReleaseMutationResponse {
  release: AppRelease;
  auditLogId: string;
}
